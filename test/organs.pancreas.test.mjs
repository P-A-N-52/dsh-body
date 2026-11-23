import test from 'node:test';
import assert from 'node:assert/strict';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/pancreas/insulin.ts';

const referenceGlucoseMgDl = 90;
const halfTimeMin = 10;
const maxRelative = 5;
const oneMinuteRetention = 2 ** (-1 / halfTimeMin);
const glucagonHalfTimeMin = 10;
const glucagonMaxRelative = 5;
const glucagonGainPerMgDl = 0.02;

function glucagonTargetAt(concentrationMgDl) {
  const raw = 1 + glucagonGainPerMgDl * (referenceGlucoseMgDl - concentrationMgDl);
  return Math.min(glucagonMaxRelative, Math.max(0, raw));
}

function glucoseAt(concentrationMgDl) {
  return {
    glucoseMassG: 12.69,
    concentrationMgDl,
    disposedGlucoseG: 0,
  };
}

function round(state, { glucose, dt = 60, actions = [], writes = [], transfers = [] } = {}) {
  const pancreas = { insulinRelative: 1, glucagonRelative: 1, ...state };
  heartbeat({
    read: (partId) => {
      if (partId === 'pancreasEndocrine') return pancreas;
      if (partId === 'glucose') return glucose;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
  });
  return writes[writes.length - 1];
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('pancreas exports the endocrine contract without actions or transfers', () => {
  assert.equal(id, 'pancreasEndocrine');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    insulinRelative: { unit: '1', mode: 'absolute' },
    glucagonRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { insulinRelative: 1, glucagonRelative: 1 });

  const transfers = [];
  const withActions = round({ insulinRelative: 1 }, {
    glucose: glucoseAt(140),
    actions: [{ type: 'eat', energyKcal: 100 }, { type: 'drink', volumeMl: 240 }],
    transfers,
  });
  const withoutActions = round({ insulinRelative: 1 }, { glucose: glucoseAt(140) });
  assert.deepEqual(withActions, withoutActions);
  assert.deepEqual(transfers, []);
  assert.deepEqual(Object.keys(withActions), ['insulinRelative', 'glucagonRelative']);
});

test('pancreas parameter defaults match the design', () => {
  const values = loadParameters(
    new URL('../organs/human-organs/pancreas/insulin.parameters.json', import.meta.url),
  );
  assert.deepEqual(values, {
    'pancreasEndocrine.referenceGlucoseMgDl': 90,
    'pancreasEndocrine.insulin.glucoseGainPerMgDl': 0.02,
    'pancreasEndocrine.insulin.responseHalfTimeMin': 10,
    'pancreasEndocrine.insulin.maxRelative': 5,
    'pancreasEndocrine.glucagon.glucoseGainPerMgDl': 0.02,
    'pancreasEndocrine.glucagon.responseHalfTimeMin': 10,
    'pancreasEndocrine.glucagon.maxRelative': 5,
  });
});

test('the 90 mg/dL baseline with insulinRelative 1 stays exactly 1', () => {
  const next = round({ insulinRelative: 1 }, { glucose: glucoseAt(referenceGlucoseMgDl) });
  assert.deepEqual(next, { insulinRelative: 1, glucagonRelative: 1 });
});

test('one 60 s round moves insulinRelative toward the glucose target', () => {
  const cases = [
    { label: 'G=140 target 2', glucoseMgDl: 140, expected: 2 - oneMinuteRetention },
    { label: 'G=70 target 0.6', glucoseMgDl: 70, expected: 0.6 + 0.4 * oneMinuteRetention },
    { label: 'G=0 target 0', glucoseMgDl: 0, expected: oneMinuteRetention },
    {
      label: 'G=400 clamps target at 5',
      glucoseMgDl: 400,
      expected: maxRelative - (maxRelative - 1) * oneMinuteRetention,
    },
  ];

  for (const { label, glucoseMgDl, expected } of cases) {
    const next = round({ insulinRelative: 1 }, { glucose: glucoseAt(glucoseMgDl) });
    assertClose(next.insulinRelative, expected, label);
  }
});

test('insulin approaches 2, 0.6, 0 and the 5 ceiling for the same readings', () => {
  const cases = [
    { glucoseMgDl: 140, target: 2 },
    { glucoseMgDl: 70, target: 0.6 },
    { glucoseMgDl: 0, target: 0 },
    { glucoseMgDl: 400, target: maxRelative },
  ];

  for (const { glucoseMgDl, target } of cases) {
    let state = { insulinRelative: 1 };
    for (let index = 0; index < 400; index++) {
      state = round(state, { glucose: glucoseAt(glucoseMgDl) });
    }
    assertClose(state.insulinRelative, target, `G=${glucoseMgDl} target`, 1e-9);
  }
});

test('insulin closes half the gap to its target every 10 minutes', () => {
  let state = { insulinRelative: 0 };
  for (let index = 0; index < 10; index++) {
    state = round(state, { glucose: glucoseAt(referenceGlucoseMgDl) });
  }
  assertClose(state.insulinRelative, 0.5, '0 -> 1 after 10 minutes');

  let high = { insulinRelative: 0 };
  for (let index = 0; index < 10; index++) {
    high = round(high, { glucose: glucoseAt(140) });
  }
  assertClose(high.insulinRelative, 1, '0 -> 2 after 10 minutes');
});

test('the response uses io.dt instead of a fixed 60 s round', () => {
  const next = round({ insulinRelative: 0 }, { glucose: glucoseAt(referenceGlucoseMgDl), dt: 120 });
  assertClose(next.insulinRelative, 1 - 2 ** (-2 / halfTimeMin), 'two minute round');
});

test('glucagonRelative rises above 1 as glucose falls below 90 mg/dL', () => {
  const at70 = round({ insulinRelative: 1 }, { glucose: glucoseAt(70) });
  assert.ok(at70.glucagonRelative > 1, 'G=70 must raise glucagon above 1');
  assertClose(
    at70.glucagonRelative,
    glucagonTargetAt(70) + (1 - glucagonTargetAt(70)) * oneMinuteRetention,
    'G=70 first round',
  );

  const at60 = round({ insulinRelative: 1 }, { glucose: glucoseAt(60) });
  assert.ok(
    at60.glucagonRelative > at70.glucagonRelative,
    'deeper hypoglycemia must raise glucagon further',
  );

  let steady70 = { insulinRelative: 1 };
  let steady60 = { insulinRelative: 1 };
  for (let index = 0; index < 400; index++) {
    steady70 = round(steady70, { glucose: glucoseAt(70) });
    steady60 = round(steady60, { glucose: glucoseAt(60) });
  }
  assertClose(steady70.glucagonRelative, 1.4, 'G=70 steady state', 1e-9);
  assertClose(steady60.glucagonRelative, 1.6, 'G=60 steady state', 1e-9);
});

test('glucagonRelative falls below 1 at G = 110 and stays exactly 1 at G = 90', () => {
  const suppressed = round({ insulinRelative: 1 }, { glucose: glucoseAt(110) });
  assert.ok(suppressed.glucagonRelative < 1, 'G=110 must suppress glucagon below 1');
  assertClose(
    suppressed.glucagonRelative,
    glucagonTargetAt(110) + (1 - glucagonTargetAt(110)) * oneMinuteRetention,
    'G=110 first round',
  );

  const baseline = round({ insulinRelative: 1 }, { glucose: glucoseAt(referenceGlucoseMgDl) });
  assert.equal(baseline.glucagonRelative, 1);
});

test('glucagonRelative stays within its 0..5 clamp', () => {
  // 非负 G 下目标最高来自 G=0 的 2.8，5 倍上限无法由合法读数触发；
  // 这里验证下限逐位到 0、可达上限与声明边界一致。
  let high = { insulinRelative: 1 };
  let severe = { insulinRelative: 1 };
  for (let index = 0; index < 400; index++) {
    high = round(high, { glucose: glucoseAt(140) });
    severe = round(severe, { glucose: glucoseAt(400) });
  }
  assertClose(high.glucagonRelative, 0, 'G=140 floors the target at 0', 1e-9);
  assertClose(severe.glucagonRelative, 0, 'G=400 floors the target at 0', 1e-9);

  let low = { insulinRelative: 1 };
  for (let index = 0; index < 400; index++) {
    low = round(low, { glucose: glucoseAt(0) });
  }
  assertClose(low.glucagonRelative, 2.8, 'G=0 reaches the highest target available', 1e-9);
  assert.ok(low.glucagonRelative <= glucagonMaxRelative);
});

test('glucagon closes half the gap to its target every 10 minutes', () => {
  let low = { insulinRelative: 1 };
  for (let index = 0; index < 10; index++) {
    low = round(low, { glucose: glucoseAt(70) });
  }
  assertClose(low.glucagonRelative, 1.2, '1 -> 1.4 halfway after 10 minutes');

  let baseline = { insulinRelative: 1, glucagonRelative: 0 };
  for (let index = 0; index < 10; index++) {
    baseline = round(baseline, { glucose: glucoseAt(referenceGlucoseMgDl) });
  }
  assertClose(baseline.glucagonRelative, 0.5, '0 -> 1 halfway after 10 minutes');

  const twoMinutes = round(
    { insulinRelative: 1, glucagonRelative: 0 },
    { glucose: glucoseAt(referenceGlucoseMgDl), dt: 120 },
  );
  assertClose(
    twoMinutes.glucagonRelative,
    1 - 2 ** (-2 / glucagonHalfTimeMin),
    'two minute round',
  );
});

test('a missing glucose part falls back to the 90 mg/dL reference', () => {
  assert.deepEqual(round({ insulinRelative: 1 }), { insulinRelative: 1, glucagonRelative: 1 });
  assertClose(
    round({ insulinRelative: 0.5 }).insulinRelative,
    1 - 0.5 * oneMinuteRetention,
    'missing glucose must still move toward the reference target',
  );
  assertClose(
    round({ insulinRelative: 1, glucagonRelative: 0.5 }).glucagonRelative,
    1 - 0.5 * oneMinuteRetention,
    'missing glucose must move glucagon toward the reference target',
  );
});

test('a loaded glucose part missing concentrationMgDl fails the round', () => {
  const writes = [];
  assert.throws(
    () => round({ insulinRelative: 1 }, {
      glucose: { glucoseMassG: 12.69, disposedGlucoseG: 0 },
      writes,
    }),
    Error,
  );
  assert.equal(writes.length, 0);
});

test('a loaded glucose part with an invalid reading fails the round', () => {
  const invalid = [
    { label: 'empty part', glucose: {} },
    { label: 'NaN', glucose: glucoseAt(Number.NaN) },
    { label: 'positive infinity', glucose: glucoseAt(Number.POSITIVE_INFINITY) },
    { label: 'negative infinity', glucose: glucoseAt(Number.NEGATIVE_INFINITY) },
    { label: 'negative', glucose: glucoseAt(-1) },
    { label: 'non-number', glucose: glucoseAt('90') },
  ];

  for (const { label, glucose } of invalid) {
    const writes = [];
    assert.throws(
      () => round({ insulinRelative: 1 }, { glucose, writes }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('pancreas output is finite and JSON-safe', () => {
  const cases = [
    { glucose: glucoseAt(referenceGlucoseMgDl) },
    { glucose: glucoseAt(140) },
    { glucose: glucoseAt(0) },
    { glucose: glucoseAt(400) },
    { glucose: undefined },
  ];

  for (const { glucose } of cases) {
    const written = round({ insulinRelative: 1 }, { glucose });
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
