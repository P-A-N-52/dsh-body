import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/liver/glycogen.ts';

const parametersUrl = new URL(
  '../organs/human-organs/liver/glycogen.parameters.json',
  import.meta.url,
);
const baselineMgDl = 90;

function glucoseAt(concentrationMgDl, excessMassG = 0) {
  return {
    glucoseMassG: 12.69,
    concentrationMgDl,
    excessMassG,
    disposedGlucoseG: 0,
  };
}

function pancreasAt(glucagonRelative, insulinRelative = 1) {
  return { insulinRelative, glucagonRelative };
}

function adrenalAt(cortisolRelative) {
  return { cortisolRelative };
}

function round({
  state,
  glucose,
  pancreas,
  adrenal,
  dt = 60,
  simulatedSeconds = 60,
  writes = [],
  transfers = [],
} = {}) {
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'liver') return state;
      if (partId === 'glucose') return glucose;
      if (partId === 'pancreasEndocrine') return pancreas;
      if (partId === 'adrenal') return adrenal;
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

function expectedReleaseG({
  glucoseMgDl = baselineMgDl,
  glucagonRelative = 1,
  cortisolRelative = 1,
  storedG = 80,
  dt = 60,
} = {}) {
  const deficitMgDl = Math.max(0, baselineMgDl - glucoseMgDl);
  const excessMgDl = Math.max(0, glucoseMgDl - baselineMgDl);
  const suppression = 1 / (1 + excessMgDl / 30);
  const rawRate = (
    0.096 * suppression
    + 0.015 * deficitMgDl
    + 0.15 * Math.max(0, glucagonRelative - 1)
  ) * Math.max(0, cortisolRelative);
  const rate = Math.min(1, Math.max(0, rawRate));
  return Math.min(rate * (dt / 60), Math.max(0, storedG));
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('liver exports the glycogen storage and release contract', () => {
  assert.equal(id, 'liver');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    glycogenG: {
      unit: 'g',
      mode: 'absolute',
      transferOut: ['glucose.glucoseMassG'],
    },
    storageG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    glycogenCapacityG: { unit: 'g', mode: 'absolute' },
    storageRequestG: { unit: 'g', mode: 'absolute' },
    outputG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    glycogenG: 80,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0,
  });
});

test('the capacity field stays at 100 regardless of the stored glycogen', () => {
  const cases = [
    { glycogenG: 0, storageG: 0 },
    { glycogenG: 70, storageG: 5 },
    { glycogenG: 100, storageG: 0 },
  ];

  for (const state of cases) {
    const { written } = round({
      state: { ...state, outputG: 0, glycogenCapacityG: 100 },
      glucose: glucoseAt(110),
      pancreas: pancreasAt(0.5),
    });
    assert.equal(
      written.glycogenCapacityG,
      100,
      `store ${state.glycogenG} + ${state.storageG}`,
    );
  }
});

test('the liver parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'liver');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'liver.basalOutputRateGPerMin',
    'liver.glucagonOutputGainGPerMin',
    'liver.glycogenCapacityG',
    'liver.halfMaxExcessG',
    'liver.hypoglycemiaOutputGainGPerMinPerMgDl',
    'liver.initialGlycogenG',
    'liver.insulinSensitivity',
    'liver.maxOutputRateGPerMin',
    'liver.maxUptakeRateGPerMin',
  ]);

  const expected = {
    'liver.maxOutputRateGPerMin': [1, 'g/min'],
    'liver.basalOutputRateGPerMin': [0.096, 'g/min'],
    'liver.hypoglycemiaOutputGainGPerMinPerMgDl': [0.015, 'g/(min·mg/dL)'],
    'liver.glucagonOutputGainGPerMin': [0.15, 'g/min'],
    'liver.initialGlycogenG': [80, 'g'],
    'liver.glycogenCapacityG': [100, 'g'],
    'liver.maxUptakeRateGPerMin': [0.2, 'g/min'],
    'liver.halfMaxExcessG': [15, 'g'],
    'liver.insulinSensitivity': [0.5, '1'],
  };
  for (const [parameterId, [value, unit]] of Object.entries(expected)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }

  assert.deepEqual(loadParameters(parametersUrl), {
    'liver.maxOutputRateGPerMin': 1,
    'liver.basalOutputRateGPerMin': 0.096,
    'liver.hypoglycemiaOutputGainGPerMinPerMgDl': 0.015,
    'liver.glucagonOutputGainGPerMin': 0.15,
    'liver.initialGlycogenG': 80,
    'liver.glycogenCapacityG': 100,
    'liver.maxUptakeRateGPerMin': 0.2,
    'liver.halfMaxExcessG': 15,
    'liver.insulinSensitivity': 0.5,
  });
});

test('previous storage is folded into the stored glycogen before release', () => {
  const { written, transfers } = round({
    state: { glycogenG: 70, storageG: 5, outputG: 0 },
    glucose: glucoseAt(110),
    pancreas: pancreasAt(0.5),
  });
  const expected = expectedReleaseG({ glucoseMgDl: 110, glucagonRelative: 0.5, storedG: 75 });
  assert.equal(written.glycogenG, 75);
  assert.equal(written.storageG, 0);
  assert.equal(written.glycogenCapacityG, 100);
  assert.equal(written.storageRequestG, 0);
  assertClose(written.outputG, expected, 'suppressed basal release');
  assert.deepEqual(transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', expected],
  ]);
});

test('low glucose with high glucagon releases smoothly via proportional counter-regulation', () => {
  const oneMinute = round({
    state: { glycogenG: 70, storageG: 0, outputG: 1 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
  });
  const expected1 = expectedReleaseG({ glucoseMgDl: 70, glucagonRelative: 2, storedG: 70 });
  assertClose(expected1, 0.096 + 0.015 * 20 + 0.15 * 1, 'expected 1 min rate');
  assert.equal(oneMinute.written.glycogenG, 70);
  assert.equal(oneMinute.written.storageG, 0);
  assert.equal(oneMinute.written.glycogenCapacityG, 100);
  assert.equal(oneMinute.written.storageRequestG, 0);
  assertClose(oneMinute.written.outputG, expected1, 'one minute round');
  assert.deepEqual(oneMinute.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', oneMinute.written.outputG],
  ]);

  const twoMinutes = round({
    state: { glycogenG: 70, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    dt: 120,
  });
  assertClose(twoMinutes.written.outputG, expected1 * 2, 'two minute round');
  assert.deepEqual(twoMinutes.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', twoMinutes.written.outputG],
  ]);
});

test('high glucose smoothly suppresses basal liver release without abrupt zeroing', () => {
  const at110 = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110),
    pancreas: pancreasAt(0.5),
  });
  const at150 = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(150),
    pancreas: pancreasAt(0.5),
  });
  assertClose(at110.written.outputG, 0.096 / (1 + 20 / 30), '110 mg/dL suppression');
  assertClose(at150.written.outputG, 0.096 / (1 + 60 / 30), '150 mg/dL suppression');
  assert.ok(at150.written.outputG < at110.written.outputG);
  assert.ok(at110.written.outputG < 0.096);
});

test('glucagon above baseline increases liver release even when glucose is not low', () => {
  const { written, transfers } = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110),
    pancreas: pancreasAt(2),
  });
  const expected = expectedReleaseG({ glucoseMgDl: 110, glucagonRelative: 2 });
  assertClose(written.outputG, expected, 'glucagon-driven release at 110 mg/dL');
  assert.deepEqual(transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', written.outputG],
  ]);
});

test('cortisol above baseline scales the release rate proportionally', () => {
  const baseline = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(1),
  });
  const doubled = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(2),
  });
  const expectedBase = expectedReleaseG({ glucoseMgDl: 70, glucagonRelative: 2, cortisolRelative: 1 });
  const expectedDoubled = expectedReleaseG({ glucoseMgDl: 70, glucagonRelative: 2, cortisolRelative: 2 });
  assertClose(baseline.written.outputG, expectedBase, 'baseline cortisol');
  assertClose(doubled.written.outputG, expectedDoubled, 'doubled cortisol clamped at max');
  assert.ok(doubled.written.outputG > baseline.written.outputG);
  assert.deepEqual(doubled.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', doubled.written.outputG],
  ]);
});

test('cortisol below baseline scales release down and zero suppresses it', () => {
  const half = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(0.5),
  });
  assertClose(
    half.written.outputG,
    expectedReleaseG({ glucoseMgDl: 70, glucagonRelative: 2, cortisolRelative: 0.5 }),
    'half cortisol',
  );

  const suppressed = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(0),
  });
  assert.deepEqual(suppressed.written, {
    glycogenG: 80,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(suppressed.transfers, []);
});

test('a missing adrenal falls back to cortisolRelative 1', () => {
  const missing = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
  });
  const explicit = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(1),
  });
  assert.deepEqual(missing.written, explicit.written);
  assert.deepEqual(missing.transfers, explicit.transfers);
});

test('cortisol only scales release, not the storage request', () => {
  const atBaseline = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(0.5, 1),
  });
  const highCortisol = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(0.5, 1),
    adrenal: adrenalAt(3),
  });
  assert.deepEqual(highCortisol.written, atBaseline.written);
  assert.deepEqual(highCortisol.transfers, []);
});

test('release is clamped to the stored glycogen with high cortisol', () => {
  const { written, transfers } = round({
    state: { glycogenG: 0.5, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(2),
  });
  assert.deepEqual(written, {
    glycogenG: 0.5,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0.5,
  });
  assert.deepEqual(transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 0.5],
  ]);
});

test('release is clamped to the stored glycogen and is zero once depleted', () => {
  const first = round({
    state: { glycogenG: 0.2, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
  });
  assert.deepEqual(first.written, {
    glycogenG: 0.2,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0.2,
  });
  assert.deepEqual(first.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 0.2],
  ]);

  // Gateway 先应用 write 再结算 transfer；扣掉释放后存量为 0，下一轮不再释放。
  const depleted = {
    glycogenG: first.written.glycogenG - first.written.outputG,
    storageG: first.written.storageG,
    glycogenCapacityG: first.written.glycogenCapacityG,
    outputG: first.written.outputG,
  };
  const second = round({
    state: depleted,
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
  });
  assert.deepEqual(second.written, {
    glycogenG: 0,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(second.transfers, []);
});

test('a missing pancreas falls back to glucagonRelative 1', () => {
  const low = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
  });
  const expectedLow = expectedReleaseG({ glucoseMgDl: 70, glucagonRelative: 1 });
  assertClose(low.written.outputG, expectedLow, 'missing pancreas at 70 mg/dL');
  assert.deepEqual(low.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', low.written.outputG],
  ]);

  const high = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
  });
  assert.deepEqual(high.written, {
    glycogenG: 0,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0.1,
    outputG: 0,
  });
  assert.deepEqual(high.transfers, []);
});

test('smooth counter-regulatory output equals basal 0.096 at 90 mg/dL and increases proportionally below 90', () => {
  const atBaseline = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(baselineMgDl),
  });
  assertClose(atBaseline.written.outputG, 0.096, 'fasting basal output at 90 mg/dL');

  const below = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(baselineMgDl - 0.1),
  });
  assertClose(below.written.outputG, 0.096 + 0.015 * 0.1, 'proportional increase below 90');

  const above = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(baselineMgDl + 30),
  });
  assertClose(above.written.outputG, 0.048, 'halved at 120 mg/dL');
});

test('a missing glucose falls back to the 90 mg/dL baseline reference with basal output', () => {
  const { written, transfers } = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
  });
  assert.deepEqual(written, {
    glycogenG: 80,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0.096,
  });
  assert.deepEqual(transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 0.096],
  ]);
});

test('autonomous storage request follows rate × half-saturation × insulin response × dtMin', () => {
  const oneMinute = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(0.5),
  });
  assertClose(
    oneMinute.written.storageRequestG,
    0.2 * (15 / 30) * 1,
    'I = 1 request',
  );
  assert.deepEqual(oneMinute.transfers, []);

  const twoMinutes = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(0.5),
    dt: 120,
  });
  assertClose(
    twoMinutes.written.storageRequestG,
    0.2 * (15 / 30) * 2,
    'two-minute request',
  );
});

test('the liver insulin response is 1 + 0.5 × (insulinRelative − 1)', () => {
  const atOne = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(1, 1),
  });
  const atThree = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(1, 3),
  });
  const response = 1 + 0.5 * (3 - 1);
  assert.equal(response, 2);
  assertClose(
    atThree.written.storageRequestG,
    0.2 * (15 / 30) * response,
    'I = 3 request',
  );
  assertClose(
    atThree.written.storageRequestG / atOne.written.storageRequestG,
    response,
    'I = 3 response ratio',
  );
});

test('the storage request is clamped to the remaining glycogen capacity', () => {
  const { written, transfers } = round({
    state: { glycogenG: 99.95, storageG: 0.02, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(1, 1),
  });
  assertClose(written.storageRequestG, 0.03, 'remaining capacity');
  assertClose(written.glycogenG, 99.97, 'folded storage');
  assertClose(written.outputG, expectedReleaseG({ glucoseMgDl: 110 }), 'suppressed basal output');
  assert.deepEqual(transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', written.outputG],
  ]);
});

test('zero insulin never produces a negative storage request', () => {
  const { written } = round({
    state: { glycogenG: 0, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110, 15),
    pancreas: pancreasAt(1, 0),
  });
  assert.ok(written.storageRequestG >= 0);
});

test('a full or over-capacity liver requests no storage', () => {
  const cases = [
    { glycogenG: 100, storageG: 0 },
    { glycogenG: 90, storageG: 10 },
    { glycogenG: 99, storageG: 2 },
  ];

  for (const state of cases) {
    const { written } = round({
      state: { ...state, outputG: 0 },
      glucose: glucoseAt(110, 50),
      pancreas: pancreasAt(1, 5),
    });
    assert.equal(
      written.storageRequestG,
      0,
      `stored ${state.glycogenG} + ${state.storageG}`,
    );
  }
});

test('a loaded upstream with missing or invalid fields fails the round without writes', () => {
  const invalid = [
    [
      'glucose missing concentration',
      {
        glucose: { glucoseMassG: 12.69, excessMassG: 0 },
        pancreas: pancreasAt(2),
      },
    ],
    ['glucose NaN', { glucose: glucoseAt(Number.NaN), pancreas: pancreasAt(2) }],
    [
      'glucose positive infinity',
      { glucose: glucoseAt(Number.POSITIVE_INFINITY), pancreas: pancreasAt(2) },
    ],
    [
      'glucose negative infinity',
      { glucose: glucoseAt(Number.NEGATIVE_INFINITY), pancreas: pancreasAt(2) },
    ],
    ['glucose negative', { glucose: glucoseAt(-0.1), pancreas: pancreasAt(2) }],
    ['glucose non-number', { glucose: glucoseAt('70'), pancreas: pancreasAt(2) }],
    [
      'glucose missing excessMassG',
      {
        glucose: { glucoseMassG: 12.69, concentrationMgDl: 110 },
        pancreas: pancreasAt(2),
      },
    ],
    [
      'glucose excess NaN',
      { glucose: glucoseAt(110, Number.NaN), pancreas: pancreasAt(2) },
    ],
    [
      'glucose excess positive infinity',
      {
        glucose: glucoseAt(110, Number.POSITIVE_INFINITY),
        pancreas: pancreasAt(2),
      },
    ],
    [
      'glucose excess negative infinity',
      {
        glucose: glucoseAt(110, Number.NEGATIVE_INFINITY),
        pancreas: pancreasAt(2),
      },
    ],
    [
      'glucose excess negative',
      { glucose: glucoseAt(110, -0.1), pancreas: pancreasAt(2) },
    ],
    [
      'glucose excess non-number',
      { glucose: glucoseAt(110, '15'), pancreas: pancreasAt(2) },
    ],
    [
      'pancreas missing glucagonRelative',
      { glucose: glucoseAt(70), pancreas: { insulinRelative: 1 } },
    ],
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
    ['pancreas non-number', { glucose: glucoseAt(70), pancreas: pancreasAt('1') }],
    [
      'pancreas missing insulinRelative',
      { glucose: glucoseAt(70), pancreas: { glucagonRelative: 1 } },
    ],
    [
      'pancreas insulin NaN',
      { glucose: glucoseAt(110, 15), pancreas: pancreasAt(1, Number.NaN) },
    ],
    [
      'pancreas insulin positive infinity',
      {
        glucose: glucoseAt(110, 15),
        pancreas: pancreasAt(1, Number.POSITIVE_INFINITY),
      },
    ],
    [
      'pancreas insulin negative infinity',
      {
        glucose: glucoseAt(110, 15),
        pancreas: pancreasAt(1, Number.NEGATIVE_INFINITY),
      },
    ],
    [
      'pancreas insulin negative',
      { glucose: glucoseAt(110, 15), pancreas: pancreasAt(1, -0.1) },
    ],
    [
      'pancreas insulin non-number',
      { glucose: glucoseAt(110, 15), pancreas: pancreasAt(1, '1') },
    ],
    [
      'adrenal missing cortisolRelative',
      { glucose: glucoseAt(70), pancreas: pancreasAt(2), adrenal: {} },
    ],
    [
      'adrenal NaN',
      {
        glucose: glucoseAt(70),
        pancreas: pancreasAt(2),
        adrenal: adrenalAt(Number.NaN),
      },
    ],
    [
      'adrenal positive infinity',
      {
        glucose: glucoseAt(70),
        pancreas: pancreasAt(2),
        adrenal: adrenalAt(Number.POSITIVE_INFINITY),
      },
    ],
    [
      'adrenal negative infinity',
      {
        glucose: glucoseAt(70),
        pancreas: pancreasAt(2),
        adrenal: adrenalAt(Number.NEGATIVE_INFINITY),
      },
    ],
    [
      'adrenal negative',
      { glucose: glucoseAt(70), pancreas: pancreasAt(2), adrenal: adrenalAt(-0.1) },
    ],
    [
      'adrenal non-number',
      { glucose: glucoseAt(70), pancreas: pancreasAt(2), adrenal: adrenalAt('1') },
    ],
    [
      'adrenal NaN while not releasing',
      {
        glucose: glucoseAt(110),
        pancreas: pancreasAt(0.5),
        adrenal: adrenalAt(Number.NaN),
      },
    ],
  ];

  for (const [label, options] of invalid) {
    const writes = [];
    const transfers = [];
    assert.throws(
      () => round({ ...options, writes, transfers }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
    assert.equal(transfers.length, 0, `${label}: the round must not transfer`);
  }
});

test('liver output is finite and JSON-safe for storage and release rounds', () => {
  const cases = [
    { label: 'missing state and upstream', options: {} },
    {
      label: 'storage folded',
      options: {
        state: { glycogenG: 70, storageG: 5, outputG: 0 },
        glucose: glucoseAt(110),
        pancreas: pancreasAt(0.5),
      },
    },
    {
      label: 'low glucose with the pancreas fallback',
      options: {
        state: { glycogenG: 80, storageG: 0, outputG: 0 },
        glucose: glucoseAt(70),
      },
    },
    {
      label: 'fractional dt and signal',
      options: {
        state: { glycogenG: 0.2, storageG: 0.3, outputG: 0 },
        glucose: glucoseAt(70),
        pancreas: pancreasAt(3.7),
        dt: 90,
      },
    },
    {
      label: 'clamped release',
      options: {
        state: { glycogenG: 0.1, storageG: 0, outputG: 0 },
        glucose: glucoseAt(70),
        pancreas: pancreasAt(2),
      },
    },
    {
      label: 'cortisol-scaled release',
      options: {
        state: { glycogenG: 20, storageG: 0, outputG: 0 },
        glucose: glucoseAt(70),
        pancreas: pancreasAt(2),
        adrenal: adrenalAt(3),
        dt: 90,
      },
    },
    {
      label: 'suppressed cortisol release',
      options: {
        state: { glycogenG: 20, storageG: 0, outputG: 0 },
        glucose: glucoseAt(70),
        pancreas: pancreasAt(2),
        adrenal: adrenalAt(0),
      },
    },
    {
      label: 'autonomous request',
      options: {
        state: { glycogenG: 0, storageG: 0, outputG: 0 },
        glucose: glucoseAt(110, 15),
        pancreas: pancreasAt(1, 3),
        dt: 90,
      },
    },
    {
      label: 'request clamped to capacity',
      options: {
        state: { glycogenG: 99.9, storageG: 0.05, outputG: 0 },
        glucose: glucoseAt(110, 50),
        pancreas: pancreasAt(1, 5),
        dt: 120,
      },
    },
    {
      label: 'high glucose',
      options: {
        state: initialState,
        glucose: glucoseAt(110),
        pancreas: pancreasAt(0),
      },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
