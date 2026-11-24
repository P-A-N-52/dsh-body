import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { assertJsonValue } from '../json-safe.js';
import { loadParameters, requireParameter } from '../lib/parameters.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/kidney/gluconeogenesis.ts';

const parametersUrl = new URL(
  '../organs/human-organs/kidney/gluconeogenesis.parameters.json',
  import.meta.url,
);
const maxOutputRateGPerMin = 0.5;
const maxOutputPerRoundG = 0.6;
const baselineMgDl = 90;

function expectedOutputG({
  concentrationMgDl = baselineMgDl,
  glucagonRelative = 1,
  dt = 60,
} = {}) {
  const deficitMgDl = Math.max(0, baselineMgDl - concentrationMgDl);
  const excessMgDl = Math.max(0, concentrationMgDl - baselineMgDl);
  const suppression = 1 / (1 + excessMgDl / 30);
  const rawRate = 0.024 * suppression
    + 0.005 * deficitMgDl
    + 0.05 * Math.max(0, glucagonRelative - 1);
  const rate = Math.min(maxOutputRateGPerMin, Math.max(0, rawRate));
  return Math.min(rate * (dt / 60), maxOutputPerRoundG);
}

function glucoseAt(concentrationMgDl) {
  return { concentrationMgDl };
}

function pancreasAt(glucagonRelative) {
  return { glucagonRelative };
}

function round({
  state = initialState,
  glucose,
  pancreas,
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  let written;
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'kidneyGluconeogenesis') return state;
      if (partId === 'glucose') return glucose;
      if (partId === 'pancreasEndocrine') return pancreas;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds,
    write: (next) => {
      written = next;
      writes.push(next);
    },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written, writes, transfers };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

test('kidneyGluconeogenesis exports the single output field contract', () => {
  assert.equal(id, 'kidneyGluconeogenesis');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    glucoseOutputG: {
      unit: 'g',
      mode: 'absolute',
      transferOut: ['glucose.glucoseMassG'],
    },
  });
  assert.deepEqual(initialState, { glucoseOutputG: 0 });
});

test('the six design parameters keep their documented values and null sources', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'kidneyGluconeogenesis');
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'kidneyGluconeogenesis.basalOutputRateGPerMin',
    'kidneyGluconeogenesis.baselineMgDl',
    'kidneyGluconeogenesis.glucagonOutputGainGPerMin',
    'kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl',
    'kidneyGluconeogenesis.maxOutputPerRoundG',
    'kidneyGluconeogenesis.maxOutputRateGPerMin',
  ]);
  assert.equal(byId['kidneyGluconeogenesis.maxOutputRateGPerMin'].unit, 'g/min');
  assert.equal(byId['kidneyGluconeogenesis.maxOutputRateGPerMin'].value, 0.5);
  assert.equal(byId['kidneyGluconeogenesis.maxOutputPerRoundG'].unit, 'g');
  assert.equal(byId['kidneyGluconeogenesis.maxOutputPerRoundG'].value, 0.6);
  assert.equal(byId['kidneyGluconeogenesis.baselineMgDl'].unit, 'mg/dL');
  assert.equal(byId['kidneyGluconeogenesis.baselineMgDl'].value, 90);
  assert.equal(byId['kidneyGluconeogenesis.basalOutputRateGPerMin'].unit, 'g/min');
  assert.equal(byId['kidneyGluconeogenesis.basalOutputRateGPerMin'].value, 0.024);
  assert.equal(
    byId['kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl'].unit,
    'g/(min·mg/dL)',
  );
  assert.equal(byId['kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl'].value, 0.005);
  assert.equal(byId['kidneyGluconeogenesis.glucagonOutputGainGPerMin'].unit, 'g/min');
  assert.equal(byId['kidneyGluconeogenesis.glucagonOutputGainGPerMin'].value, 0.05);
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }

  const parameters = loadParameters(parametersUrl);
  assert.equal(
    requireParameter(parameters, 'kidneyGluconeogenesis.maxOutputRateGPerMin'),
    0.5,
  );
  assert.equal(
    requireParameter(parameters, 'kidneyGluconeogenesis.maxOutputPerRoundG'),
    0.6,
  );
  assert.equal(requireParameter(parameters, 'kidneyGluconeogenesis.baselineMgDl'), 90);
  assert.equal(requireParameter(parameters, 'kidneyGluconeogenesis.basalOutputRateGPerMin'), 0.024);
  assert.equal(
    requireParameter(parameters, 'kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl'),
    0.005,
  );
  assert.equal(requireParameter(parameters, 'kidneyGluconeogenesis.glucagonOutputGainGPerMin'), 0.05);
});

test('low glucose produces smooth proportional output and transfers it to glucose', () => {
  const { written, writes, transfers } = round({
    state: { glucoseOutputG: 5 },
    glucose: glucoseAt(70),
  });
  const expected = expectedOutputG({ concentrationMgDl: 70 });
  assert.equal(writes.length, 1);
  assertClose(written.glucoseOutputG, expected, 'output at 70 mg/dL');
  assertClose(expected, 0.024 + 0.005 * 20, 'basal + hypoglycemia gain');
  assert.deepEqual(transfers, [
    ['kidneyGluconeogenesis', 'glucoseOutputG', 'glucose', 'glucoseMassG', written.glucoseOutputG],
  ]);
});

test('glucagon above baseline increases output above 0.3 g/min when hypoglycemia is severe', () => {
  const at110 = round({
    glucose: glucoseAt(110),
    pancreas: pancreasAt(2),
  });
  assertClose(
    at110.written.glucoseOutputG,
    expectedOutputG({ concentrationMgDl: 110, glucagonRelative: 2 }),
    'glucagon at 110 mg/dL',
  );
  assert.deepEqual(at110.transfers, [
    ['kidneyGluconeogenesis', 'glucoseOutputG', 'glucose', 'glucoseMassG', at110.written.glucoseOutputG],
  ]);

  const baseLow = round({
    glucose: glucoseAt(20),
    pancreas: pancreasAt(1),
  });
  const highGlucagonLow = round({
    glucose: glucoseAt(20),
    pancreas: pancreasAt(2),
  });
  assert.ok(highGlucagonLow.written.glucoseOutputG > 0.3, 'not choked at 0.3 g');
  assert.ok(highGlucagonLow.written.glucoseOutputG > baseLow.written.glucoseOutputG);
});

test('high glucose smoothly suppresses basal output and resets the prior field', () => {
  const { written, writes, transfers } = round({
    state: { glucoseOutputG: 7 },
    glucose: glucoseAt(120),
    pancreas: pancreasAt(1),
  });
  assert.equal(writes.length, 1);
  assertClose(written.glucoseOutputG, 0.012, 'halved at 120 mg/dL');
  assert.deepEqual(transfers, [
    ['kidneyGluconeogenesis', 'glucoseOutputG', 'glucose', 'glucoseMassG', 0.012],
  ]);
});

test('counter-regulation is continuous across 90 mg/dL and equals 0.024 at baseline', () => {
  const at90 = round({ glucose: glucoseAt(90), pancreas: pancreasAt(0.5) });
  assertClose(at90.written.glucoseOutputG, 0.024, 'basal at 90 mg/dL');

  const at150 = round({ glucose: glucoseAt(150), pancreas: pancreasAt(0.5) });
  assertClose(at150.written.glucoseOutputG, 0.024 / 3, 'suppressed at 150 mg/dL');

  for (const concentrationMgDl of [89, 70, 0]) {
    const { written, transfers } = round({
      glucose: glucoseAt(concentrationMgDl),
      pancreas: pancreasAt(0.5),
    });
    assertClose(
      written.glucoseOutputG,
      expectedOutputG({ concentrationMgDl, glucagonRelative: 0.5 }),
      `C=${concentrationMgDl}`,
    );
    assert.equal(transfers.length, 1, `C=${concentrationMgDl} must transfer`);
  }
});

test('output scales with glucagon and dtMin and is capped per round at 0.6 g', () => {
  const cases = [
    { dt: 30, glucagonRelative: 1, concentrationMgDl: 70 },
    { dt: 30, glucagonRelative: 2, concentrationMgDl: 70 },
    { dt: 60, glucagonRelative: 0.5, concentrationMgDl: 70 },
    { dt: 90, glucagonRelative: 0.5, concentrationMgDl: 70 },
    { dt: 120, glucagonRelative: 1, concentrationMgDl: 70 },
    { dt: 120, glucagonRelative: 3, concentrationMgDl: 110 },
    { dt: 600, glucagonRelative: 10, concentrationMgDl: 110 },
  ];
  for (const { dt, glucagonRelative, concentrationMgDl } of cases) {
    const expectedG = expectedOutputG({ dt, glucagonRelative, concentrationMgDl });
    const { written, transfers } = round({
      glucose: glucoseAt(concentrationMgDl),
      pancreas: pancreasAt(glucagonRelative),
      dt,
    });
    assertClose(written.glucoseOutputG, expectedG, `dt=${dt}, glucagon=${glucagonRelative}`);
    assert.equal(transfers.length, 1);
    assertClose(transfers[0][4], expectedG, `transfer dt=${dt}, glucagon=${glucagonRelative}`);
  }
  const capped = round({
    glucose: glucoseAt(20),
    pancreas: pancreasAt(5),
    dt: 600,
  });
  assert.equal(capped.written.glucoseOutputG, 0.6);
});

test('the rate signal uses io.dt rather than io.simulatedSeconds', () => {
  const { written } = round({
    glucose: glucoseAt(70),
    dt: 30,
    simulatedSeconds: 3600,
  });
  assertClose(written.glucoseOutputG, expectedOutputG({ concentrationMgDl: 70, dt: 30 }), 'dt=30 s');
});

test('missing glucose falls back to 90 mg/dL with basal 0.024 g/min output', () => {
  const { written, transfers } = round({ state: { glucoseOutputG: 4 } });
  assertClose(written.glucoseOutputG, 0.024, 'basal fallback at 90 mg/dL');
  assert.deepEqual(transfers, [
    ['kidneyGluconeogenesis', 'glucoseOutputG', 'glucose', 'glucoseMassG', 0.024],
  ]);

  const glucagonDriven = round({ pancreas: pancreasAt(2) });
  assertClose(glucagonDriven.written.glucoseOutputG, 0.024 + 0.05, 'basal + glucagon');
  assert.deepEqual(glucagonDriven.transfers, [
    ['kidneyGluconeogenesis', 'glucoseOutputG', 'glucose', 'glucoseMassG', glucagonDriven.written.glucoseOutputG],
  ]);
});

test('missing pancreas falls back to glucagonRelative 1', () => {
  const missing = round({ glucose: glucoseAt(70) });
  const explicit = round({ glucose: glucoseAt(70), pancreas: pancreasAt(1) });
  assert.deepEqual(missing.written, explicit.written);
  assert.deepEqual(missing.transfers, explicit.transfers);
  assertClose(missing.written.glucoseOutputG, expectedOutputG({ concentrationMgDl: 70 }), '70 mg/dL');
});

test('loaded upstream parts with invalid fields fail the round before any write', () => {
  const invalid = [
    ['glucose missing concentration', { glucose: {} }],
    ['glucose NaN', { glucose: glucoseAt(Number.NaN) }],
    ['glucose positive infinity', { glucose: glucoseAt(Number.POSITIVE_INFINITY) }],
    ['glucose negative infinity', { glucose: glucoseAt(Number.NEGATIVE_INFINITY) }],
    ['glucose negative', { glucose: glucoseAt(-0.1) }],
    ['glucose non-number', { glucose: { concentrationMgDl: '70' } }],
    ['glucose invalid while glucagon drives', {
      glucose: glucoseAt(Number.NaN),
      pancreas: pancreasAt(2),
    }],
    ['pancreas missing glucagonRelative', { glucose: glucoseAt(70), pancreas: {} }],
    ['pancreas NaN', { glucose: glucoseAt(70), pancreas: pancreasAt(Number.NaN) }],
    [
      'pancreas positive infinity',
      { glucose: glucoseAt(70), pancreas: pancreasAt(Number.POSITIVE_INFINITY) },
    ],
    [
      'pancreas negative infinity',
      { glucose: glucoseAt(70), pancreas: pancreasAt(Number.NEGATIVE_INFINITY) },
    ],
    ['pancreas negative', { glucose: glucoseAt(70), pancreas: pancreasAt(-0.1) }],
    ['pancreas non-number', { glucose: glucoseAt(70), pancreas: { glucagonRelative: '1' } }],
    ['pancreas invalid while glucose is high', {
      glucose: glucoseAt(110),
      pancreas: pancreasAt(Number.NaN),
    }],
  ];

  for (const [label, options] of invalid) {
    const writes = [];
    const transfers = [];
    assert.throws(
      () => {
        heartbeat({
          read: (partId) => {
            if (partId === 'kidneyGluconeogenesis') return initialState;
            if (partId === 'glucose') return options.glucose;
            if (partId === 'pancreasEndocrine') return options.pancreas;
            return undefined;
          },
          actions: [],
          dt: 60,
          simulatedSeconds: 60,
          write: (next) => { writes.push(next); },
          transfer: (...args) => { transfers.push(args); },
        });
      },
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
    assert.equal(transfers.length, 0, `${label}: the round must not transfer`);
  }
});

test('a written round applies the declared transfer through the shared registry', () => {
  const registry = createFieldRegistry([
    {
      id: 'glucose',
      initialState: { glucoseMassG: 6 },
      fields: {
        glucoseMassG: {
          unit: 'g',
          mode: 'absolute',
          transferIn: ['kidneyGluconeogenesis.glucoseOutputG'],
        },
      },
    },
    { id, initialState, fields },
  ]);
  const { written, transfers } = round({ glucose: glucoseAt(70) });
  const writtenBeforeTransfer = structuredClone(written);
  const next = applyOperations({
    registry,
    snapshotParts: { glucose: { glucoseMassG: 6 }, kidneyGluconeogenesis: initialState },
    writes: { kidneyGluconeogenesis: written },
    transfers: transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
      caller: id,
      fromPart,
      fromField,
      toPart,
      toField,
      amount,
    })),
  });
  const expected = expectedOutputG({ concentrationMgDl: 70 });
  assertClose(next.glucose.glucoseMassG, 6 + expected, 'glucose mass after transfer');
  assertClose(
    next.kidneyGluconeogenesis.glucoseOutputG,
    0,
    'the transfer drains the kidney output field',
  );

  const withoutTransfer = applyOperations({
    registry,
    snapshotParts: { glucose: { glucoseMassG: 6 }, kidneyGluconeogenesis: initialState },
    writes: { kidneyGluconeogenesis: writtenBeforeTransfer },
  });
  assert.equal(withoutTransfer.glucose, undefined, 'no transfer means no glucose change');
  assertClose(
    withoutTransfer.kidneyGluconeogenesis.glucoseOutputG,
    expected,
    'the write carries the round output',
  );
});

test('kidney gluconeogenesis output is finite and JSON-safe', () => {
  const cases = [
    { label: 'missing upstream', options: {} },
    { label: 'low glucose', options: { state: { glucoseOutputG: 9 }, glucose: glucoseAt(70) } },
    { label: 'high glucagon', options: { glucose: glucoseAt(110), pancreas: pancreasAt(2) } },
    {
      label: 'fractional dt and signal',
      options: { glucose: glucoseAt(70), pancreas: pancreasAt(3.7), dt: 90 },
    },
    { label: 'inactive', options: { glucose: glucoseAt(110), pancreas: pancreasAt(0.5) } },
  ];
  for (const { label, options } of cases) {
    const { written } = round(options);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written), `${label}: JSON-safe`);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, `${label}: round-trip`);
  }
});
