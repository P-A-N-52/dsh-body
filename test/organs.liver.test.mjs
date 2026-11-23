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
    'liver.glycogenCapacityG',
    'liver.halfMaxExcessG',
    'liver.initialGlycogenG',
    'liver.insulinSensitivity',
    'liver.maxOutputRateGPerMin',
    'liver.maxUptakeRateGPerMin',
  ]);

  const maxRate = byId['liver.maxOutputRateGPerMin'];
  assert.equal(maxRate.value, 1);
  assert.equal(maxRate.unit, 'g/min');
  assert.equal(maxRate.status, 'design');
  assert.equal(maxRate.source, null);

  const initial = byId['liver.initialGlycogenG'];
  assert.equal(initial.value, 80);
  assert.equal(initial.unit, 'g');
  assert.equal(initial.status, 'design');
  assert.equal(initial.source, null);

  const capacity = byId['liver.glycogenCapacityG'];
  assert.equal(capacity.value, 100);
  assert.equal(capacity.unit, 'g');
  assert.equal(capacity.status, 'design');
  assert.equal(capacity.source, null);

  const maxUptake = byId['liver.maxUptakeRateGPerMin'];
  assert.equal(maxUptake.value, 0.2);
  assert.equal(maxUptake.unit, 'g/min');
  assert.equal(maxUptake.status, 'design');
  assert.equal(maxUptake.source, null);

  const halfMaxExcess = byId['liver.halfMaxExcessG'];
  assert.equal(halfMaxExcess.value, 15);
  assert.equal(halfMaxExcess.unit, 'g');
  assert.equal(halfMaxExcess.status, 'design');
  assert.equal(halfMaxExcess.source, null);

  const insulinSensitivity = byId['liver.insulinSensitivity'];
  assert.equal(insulinSensitivity.value, 0.5);
  assert.equal(insulinSensitivity.unit, '1');
  assert.equal(insulinSensitivity.status, 'design');
  assert.equal(insulinSensitivity.source, null);

  assert.deepEqual(loadParameters(parametersUrl), {
    'liver.maxOutputRateGPerMin': 1,
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
  assert.deepEqual(written, {
    glycogenG: 75,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(transfers, []);
});

test('low glucose with high glucagon releases min(rate × signal × dtMin, stored)', () => {
  const oneMinute = round({
    state: { glycogenG: 70, storageG: 0, outputG: 1 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
  });
  assert.deepEqual(oneMinute.written, {
    glycogenG: 70,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 2,
  });
  assert.deepEqual(oneMinute.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 2],
  ]);

  const twoMinutes = round({
    state: { glycogenG: 70, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    dt: 120,
  });
  assertClose(twoMinutes.written.outputG, 4, 'two minute round');
  assert.deepEqual(twoMinutes.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 4],
  ]);
});

test('high glucose with glucagon below baseline does not release', () => {
  const { written, transfers } = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110),
    pancreas: pancreasAt(0.5),
  });
  assert.deepEqual(written, {
    glycogenG: 80,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(transfers, []);
});

test('glucagon above baseline releases even when glucose is not low', () => {
  const { written, transfers } = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(110),
    pancreas: pancreasAt(2),
  });
  assert.equal(written.outputG, 2);
  assert.deepEqual(transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 2],
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
  assert.equal(baseline.written.outputG, 2);
  assert.equal(doubled.written.outputG, 4);
  assert.equal(
    doubled.written.outputG,
    baseline.written.outputG * 2,
    'cortisol 2 doubles the release',
  );
  assert.deepEqual(doubled.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 4],
  ]);
});

test('cortisol below baseline scales release down and zero suppresses it', () => {
  const half = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
    adrenal: adrenalAt(0.5),
  });
  assert.equal(half.written.outputG, 1);

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
    state: { glycogenG: 0.5, storageG: 0, outputG: 0 },
    glucose: glucoseAt(70),
    pancreas: pancreasAt(2),
  });
  assert.deepEqual(first.written, {
    glycogenG: 0.5,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0.5,
  });
  assert.deepEqual(first.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 0.5],
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
  assert.equal(low.written.outputG, 1);
  assert.deepEqual(low.transfers, [
    ['liver', 'glycogenG', 'glucose', 'glucoseMassG', 1],
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

test('release uses a strict glucose below the 90 mg/dL baseline trigger', () => {
  const atBaseline = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(baselineMgDl),
  });
  assert.equal(atBaseline.written.outputG, 0);

  const below = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
    glucose: glucoseAt(baselineMgDl - 0.1),
  });
  assert.equal(below.written.outputG, 1);
});

test('a missing glucose falls back to the 90 mg/dL baseline reference', () => {
  const { written, transfers } = round({
    state: { glycogenG: 80, storageG: 0, outputG: 0 },
  });
  assert.deepEqual(written, {
    glycogenG: 80,
    storageG: 0,
    glycogenCapacityG: 100,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(transfers, []);
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
  assert.deepEqual(transfers, []);
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
