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
const basalPmolL = 60;
const glucoseGain = 0.085;
const clearanceKmPmolL = 3890;
const clearanceVmaxPmolLPerMin = 274;
const maxInsulinPmolL = 900;
const basalSecretion = (clearanceVmaxPmolLPerMin * basalPmolL) / (clearanceKmPmolL + basalPmolL);
const glucagonHypoThresholdMgDl = 68;
const glucagonHalfTimeMin = 10;
const glucagonMaxRelative = 5;
const glucagonGainPerMgDl = 0.02;
const glucagonCounterregGainPerMgDl = 0.06;
const oneMinuteRetention = 2 ** (-1 / glucagonHalfTimeMin);

function glucagonTargetAt(concentrationMgDl) {
  const deepDrop = Math.max(0, glucagonHypoThresholdMgDl - concentrationMgDl);
  const raw = 1
    + glucagonGainPerMgDl * (referenceGlucoseMgDl - concentrationMgDl)
    + glucagonCounterregGainPerMgDl * deepDrop;
  return Math.min(glucagonMaxRelative, Math.max(0, raw));
}

function integrateExpectedInsulin(startPmolL, glucoseMgDl, dtMin) {
  if (dtMin <= 0) return Math.min(maxInsulinPmolL, Math.max(0, startPmolL));
  const secretion = glucoseMgDl >= referenceGlucoseMgDl
    ? basalSecretion + glucoseGain * (glucoseMgDl - referenceGlucoseMgDl)
    : Math.max(0, basalSecretion * Math.max(0, (glucoseMgDl - 45) / (referenceGlucoseMgDl - 45)));
  const steps = Math.max(1, Math.min(480, Math.ceil(dtMin / 0.5)));
  const h = dtMin / steps;
  let c = Math.min(maxInsulinPmolL, Math.max(0, startPmolL));
  const dCdt = (val) => secretion - (clearanceVmaxPmolLPerMin * val) / (clearanceKmPmolL + val);
  for (let i = 0; i < steps; i++) {
    const k1 = dCdt(c);
    const mid = Math.min(maxInsulinPmolL, Math.max(0, c + h * k1));
    c = Math.min(maxInsulinPmolL, Math.max(0, c + 0.5 * h * (k1 + dCdt(mid))));
  }
  return c;
}

function glucoseAt(concentrationMgDl) {
  return {
    glucoseMassG: 12.69,
    concentrationMgDl,
    disposedGlucoseG: 0,
  };
}

function round(state, { glucose, dt = 60, actions = [], writes = [], transfers = [] } = {}) {
  const pancreas = { insulinPmolL: basalPmolL, glucagonRelative: 1, ...state };
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
    insulinPmolL: { unit: 'pmol/L', mode: 'absolute' },
    glucagonRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { insulinPmolL: 60, glucagonRelative: 1 });

  const transfers = [];
  const withActions = round({ insulinPmolL: 60 }, {
    glucose: glucoseAt(140),
    actions: [{ type: 'eat', energyKcal: 100 }, { type: 'drink', volumeMl: 240 }],
    transfers,
  });
  const withoutActions = round({ insulinPmolL: 60 }, { glucose: glucoseAt(140) });
  assert.deepEqual(withActions, withoutActions);
  assert.deepEqual(transfers, []);
  assert.deepEqual(Object.keys(withActions), ['insulinPmolL', 'glucagonRelative']);
});

test('pancreas parameter defaults match the design', () => {
  const values = loadParameters(
    new URL('../organs/human-organs/pancreas/insulin.parameters.json', import.meta.url),
  );
  assert.deepEqual(values, {
    'pancreasEndocrine.referenceGlucoseMgDl': 90,
    'pancreasEndocrine.insulin.basalPmolL': 60,
    'pancreasEndocrine.insulin.glucoseGainPmolLPerMinPerMgDl': 0.085,
    'pancreasEndocrine.insulin.clearanceKmPmolL': 3890,
    'pancreasEndocrine.insulin.clearanceVmaxPmolLPerMin': 274,
    'pancreasEndocrine.insulin.maxPmolL': 900,
    'pancreasEndocrine.glucagon.hypoglycemiaThresholdMgDl': 68,
    'pancreasEndocrine.glucagon.glucoseGainPerMgDl': 0.02,
    'pancreasEndocrine.glucagon.counterregGainPerMgDl': 0.06,
    'pancreasEndocrine.glucagon.responseHalfTimeMin': 10,
    'pancreasEndocrine.glucagon.maxRelative': 5,
  });
});

test('the 90 mg/dL baseline with insulinPmolL 60 stays at baseline', () => {
  const next = round({ insulinPmolL: 60 }, { glucose: glucoseAt(referenceGlucoseMgDl) });
  assertClose(next.insulinPmolL, 60, 'baseline fixed point');
  assert.equal(next.glucagonRelative, 1);
});

test('one 60 s round moves insulinPmolL smoothly under saturable clearance', () => {
  const cases = [
    { label: 'G=140 raises insulin', glucoseMgDl: 140 },
    { label: 'G=70 suppresses insulin secretion', glucoseMgDl: 70 },
    { label: 'G=0 drops toward zero secretion clearance', glucoseMgDl: 0 },
    { label: 'G=400 stays bounded <= maxInsulinPmolL', glucoseMgDl: 400 },
  ];

  for (const { label, glucoseMgDl } of cases) {
    const next = round({ insulinPmolL: 60 }, { glucose: glucoseAt(glucoseMgDl) });
    assertClose(next.insulinPmolL, integrateExpectedInsulin(60, glucoseMgDl, 1), label);
  }
  assert.ok(round({ insulinPmolL: 60 }, { glucose: glucoseAt(140) }).insulinPmolL > 60);
  assert.ok(round({ insulinPmolL: 60 }, { glucose: glucoseAt(40) }).insulinPmolL < 60);
});

test('insulin responds dose-dependently across hyperglycemia, hypoglycemia, and clamps at 900 pmol/L', () => {
  let mild = { insulinPmolL: 60 };
  let extreme = { insulinPmolL: 60 };
  let hypo = { insulinPmolL: 60 };
  for (let index = 0; index < 240; index++) {
    mild = round(mild, { glucose: glucoseAt(140) });
    extreme = round(extreme, { glucose: glucoseAt(800) });
    hypo = round(hypo, { glucose: glucoseAt(40) });
  }
  assert.ok(mild.insulinPmolL > 100 && mild.insulinPmolL < 400);
  assert.equal(extreme.insulinPmolL, maxInsulinPmolL);
  assert.ok(hypo.insulinPmolL < 5);

});

test('glucagonRelative rises above 1 below 90 mg/dL and adds counterregulation below 68 mg/dL', () => {
  const at70 = round({ insulinPmolL: 60 }, { glucose: glucoseAt(70) });
  assert.ok(at70.glucagonRelative > 1, 'G=70 must raise glucagon above 1');
  assertClose(
    at70.glucagonRelative,
    glucagonTargetAt(70) + (1 - glucagonTargetAt(70)) * oneMinuteRetention,
    'G=70 first round',
  );

  const at60 = round({ insulinPmolL: 60 }, { glucose: glucoseAt(60) });
  assert.ok(
    at60.glucagonRelative > at70.glucagonRelative,
    'hypoglycemia below 68 triggers steeper glucagon counterregulation',
  );

  let steady70 = { insulinPmolL: 60 };
  let steady60 = { insulinPmolL: 60 };
  for (let index = 0; index < 400; index++) {
    steady70 = round(steady70, { glucose: glucoseAt(70) });
    steady60 = round(steady60, { glucose: glucoseAt(60) });
  }
  assertClose(steady70.glucagonRelative, 1.4, 'G=70 steady state', 1e-9);
  assertClose(steady60.glucagonRelative, 2.08, 'G=60 steady state with counterregulation', 1e-9);
});

test('glucagonRelative falls below 1 at G = 110 and stays exactly 1 at G = 90', () => {
  const suppressed = round({ insulinPmolL: 60 }, { glucose: glucoseAt(110) });
  assert.ok(suppressed.glucagonRelative < 1, 'G=110 must suppress glucagon below 1');
  assertClose(
    suppressed.glucagonRelative,
    glucagonTargetAt(110) + (1 - glucagonTargetAt(110)) * oneMinuteRetention,
    'G=110 first round',
  );

  const baseline = round({ insulinPmolL: 60 }, { glucose: glucoseAt(referenceGlucoseMgDl) });
  assert.equal(baseline.glucagonRelative, 1);
});

test('glucagonRelative stays within its 0..5 clamp', () => {
  let high = { insulinPmolL: 60 };
  let severe = { insulinPmolL: 60 };
  for (let index = 0; index < 400; index++) {
    high = round(high, { glucose: glucoseAt(140) });
    severe = round(severe, { glucose: glucoseAt(400) });
  }
  assertClose(high.glucagonRelative, 0, 'G=140 floors the target at 0', 1e-9);
  assertClose(severe.glucagonRelative, 0, 'G=400 floors the target at 0', 1e-9);

  let low = { insulinPmolL: 60 };
  for (let index = 0; index < 400; index++) {
    low = round(low, { glucose: glucoseAt(0) });
  }
  assertClose(low.glucagonRelative, glucagonMaxRelative, 'G=0 clamps counterregulatory glucagon at 5', 1e-9);
});

test('glucagon closes half the gap to its target every 10 minutes and scales insulin by dt', () => {
  let low = { insulinPmolL: 60 };
  for (let index = 0; index < 10; index++) {
    low = round(low, { glucose: glucoseAt(70) });
  }
  assertClose(low.glucagonRelative, 1.2, '1 -> 1.4 halfway after 10 minutes');

  let baseline = { insulinPmolL: 60, glucagonRelative: 0 };
  for (let index = 0; index < 10; index++) {
    baseline = round(baseline, { glucose: glucoseAt(referenceGlucoseMgDl) });
  }
  assertClose(baseline.glucagonRelative, 0.5, '0 -> 1 halfway after 10 minutes');

  const twoMinutes = round(
    { insulinPmolL: 120, glucagonRelative: 0 },
    { glucose: glucoseAt(referenceGlucoseMgDl), dt: 120 },
  );
  assertClose(twoMinutes.glucagonRelative, 1 - 2 ** (-2 / glucagonHalfTimeMin), 'two minute round');
  assertClose(twoMinutes.insulinPmolL, integrateExpectedInsulin(120, 90, 2), 'insulin clearance scales with dt');
});

test('a missing glucose part falls back to the 90 mg/dL reference', () => {
  assertClose(round({ insulinPmolL: 60 }).insulinPmolL, 60, 'baseline stays at 60');
  assert.equal(round({ insulinPmolL: 60 }).glucagonRelative, 1);
  assert.ok(round({ insulinPmolL: 30 }).insulinPmolL > 30, 'low insulin recovers toward 60');
  assertClose(
    round({ insulinPmolL: 60, glucagonRelative: 0.5 }).glucagonRelative,
    1 - 0.5 * oneMinuteRetention,
    'missing glucose must move glucagon toward the reference target',
  );
});

test('a loaded glucose part missing concentrationMgDl fails the round', () => {
  const writes = [];
  assert.throws(
    () => round({ insulinPmolL: 60 }, {
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
      () => round({ insulinPmolL: 60 }, { glucose, writes }),
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
    const written = round({ insulinPmolL: 60 }, { glucose });
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
