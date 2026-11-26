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
} from '../organs/human-organs/parathyroid/parathyroid.ts';

const parametersUrl = new URL(
  '../organs/human-organs/parathyroid/parathyroid.parameters.json',
  import.meta.url,
);

const BASELINE_PTH_PG_ML = 30;
const HALF_TIME_MIN = 15;

function round({ state, bloodCalcium, dt = 60, actions = [] } = {}) {
  const writes = [];
  const transfers = [];
  const notifications = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'parathyroid') return state;
      if (partId === 'bloodCalcium') return bloodCalcium;
      throw new Error(`unexpected read: ${partId}`);
    },
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
    notify: (...args) => { notifications.push(args); },
  });
  return { written: writes.at(-1), writes, transfers, notifications };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function targetAt(mgDl) {
  return Math.min(90, Math.max(0, BASELINE_PTH_PG_ML + 15 * (9.5 - mgDl)));
}

function approach(prev, target, dtMin) {
  return target + (prev - target) * 2 ** (-dtMin / HALF_TIME_MIN);
}

function expectUpstreamError({ state, bloodCalcium, dt = 60 }, label) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'parathyroid') return state;
        if (partId === 'bloodCalcium') return bloodCalcium;
        throw new Error(`unexpected read: ${partId}`);
      },
      actions: [],
      dt,
      simulatedSeconds: 60,
      write: (next) => { writes.push(next); },
    }),
    Error,
    label,
  );
  assert.equal(writes.length, 0, `${label}: the round must not write`);
}

test('parathyroid exports the endocrine organ contract in physical pg/mL units without actions or transfers', () => {
  assert.equal(id, 'parathyroid');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    pthPgMl: { unit: 'pg/mL', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { pthPgMl: BASELINE_PTH_PG_ML });

  const withActions = round({
    state: initialState,
    bloodCalcium: { mgDl: 8 },
    actions: [{ type: 'eat', energyKcal: 100 }, { type: 'drink', volumeMl: 240 }],
  });
  const withoutActions = round({ state: initialState, bloodCalcium: { mgDl: 8 } });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(withActions.transfers, []);
  assert.deepEqual(withActions.notifications, []);
  assert.deepEqual(Object.keys(withActions.written), ['pthPgMl']);
});

test('parathyroid parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'parathyroid');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'parathyroid.baselinePthPgMl',
    'parathyroid.halfTimeMin',
    'parathyroid.maxPthPgMl',
    'parathyroid.pthGainPgMlPerMgDl',
    'parathyroid.referenceCalciumMgDl',
  ]);
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }
  assert.equal(byId['parathyroid.referenceCalciumMgDl'].unit, 'mg/dL');
  assert.equal(byId['parathyroid.referenceCalciumMgDl'].value, 9.5);
  assert.equal(byId['parathyroid.baselinePthPgMl'].unit, 'pg/mL');
  assert.equal(byId['parathyroid.baselinePthPgMl'].value, 30);
  assert.equal(byId['parathyroid.pthGainPgMlPerMgDl'].unit, 'pg/mL/(mg/dL)');
  assert.equal(byId['parathyroid.pthGainPgMlPerMgDl'].value, 15);
  assert.equal(byId['parathyroid.maxPthPgMl'].unit, 'pg/mL');
  assert.equal(byId['parathyroid.maxPthPgMl'].value, 90);
  assert.equal(byId['parathyroid.halfTimeMin'].unit, 'min');
  assert.equal(byId['parathyroid.halfTimeMin'].value, 15);

  assert.deepEqual(loadParameters(parametersUrl), {
    'parathyroid.baselinePthPgMl': 30,
    'parathyroid.halfTimeMin': 15,
    'parathyroid.maxPthPgMl': 90,
    'parathyroid.pthGainPgMlPerMgDl': 15,
    'parathyroid.referenceCalciumMgDl': 9.5,
  });
});

test('low calcium raises PTH toward the 15-minute target', () => {
  const oneHalf = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 8 },
    dt: 15 * 60,
  });
  assertClose(oneHalf.written.pthPgMl, 41.25, 'halfway from 30 toward 52.5 pg/mL');

  const twoHalves = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 8 },
    dt: 30 * 60,
  });
  assertClose(twoHalves.written.pthPgMl, 46.875, 'two half-times');

  const oneMinute = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 8 },
    dt: 60,
  });
  assertClose(
    oneMinute.written.pthPgMl,
    approach(30, targetAt(8), 1),
    'one 60-second round is one minute of a 15-minute half-time',
  );
});

test('high calcium lowers PTH toward the 15-minute target', () => {
  const oneHalf = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 11 },
    dt: 15 * 60,
  });
  assertClose(oneHalf.written.pthPgMl, 18.75, 'halfway from 30 toward 7.5 pg/mL');

  const twoHalves = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 11 },
    dt: 30 * 60,
  });
  assertClose(twoHalves.written.pthPgMl, 13.125, 'two half-times');

  const above = round({
    state: { pthPgMl: 15 },
    bloodCalcium: { mgDl: 11 },
    dt: 15 * 60,
  });
  assertClose(above.written.pthPgMl, 11.25, 'falling from above the target');
});

test('the PTH target clamps to 0-90 pg/mL at extreme calcium readings', () => {
  const low = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 0 },
    dt: 15 * 60,
  });
  assertClose(low.written.pthPgMl, 60, 'clamped target 90, halfway from 30');

  const high = round({
    state: { pthPgMl: 30 },
    bloodCalcium: { mgDl: 20 },
    dt: 15 * 60,
  });
  assertClose(high.written.pthPgMl, 15, 'clamped target 0, halfway from 30');
});

test('a missing bloodCalcium uses the 9.5 mg/dL reference and legacy relative states restart at 30 pg/mL', () => {
  const fromHigh = round({ state: { pthPgMl: 60 }, dt: 15 * 60 });
  assertClose(fromHigh.written.pthPgMl, 45, 'PTH decays halfway toward 30 pg/mL');

  const fromBaseline = round({ state: { pthPgMl: 30 }, dt: 15 * 60 });
  assertClose(fromBaseline.written.pthPgMl, 30, 'reference is a fixed point');

  const newBody = round({ dt: 15 * 60 });
  assertClose(newBody.written.pthPgMl, 30, 'a missing state starts at baseline');

  const missingField = round({ state: { pthRelative: 2.5 }, dt: 15 * 60 });
  assertClose(missingField.written.pthPgMl, 30, 'a legacy state missing pthPgMl starts at baseline');

  const invalidPrev = round({ state: { pthPgMl: Number.NaN }, dt: 15 * 60 });
  assertClose(invalidPrev.written.pthPgMl, 30, 'a NaN PTH field starts at baseline');
});

test('a loaded bloodCalcium with an invalid mgDl fails the round without writing', () => {
  const invalid = [
    ['empty bloodCalcium', {}],
    ['null mgDl', { mgDl: null }],
    ['NaN mgDl', { mgDl: Number.NaN }],
    ['positive infinity mgDl', { mgDl: Number.POSITIVE_INFINITY }],
    ['negative infinity mgDl', { mgDl: Number.NEGATIVE_INFINITY }],
    ['negative mgDl', { mgDl: -0.1 }],
    ['non-numeric mgDl', { mgDl: '9.5' }],
    ['null bloodCalcium', null],
    ['non-object bloodCalcium', 42],
  ];
  for (const [label, bloodCalcium] of invalid) {
    expectUpstreamError({ bloodCalcium }, label);
  }
});

test('parathyroid output is finite and JSON-safe', () => {
  const cases = [
    ['no upstream parts', {}],
    ['low calcium', { state: { pthPgMl: 30 }, bloodCalcium: { mgDl: 8 } }],
    ['high calcium', { state: { pthPgMl: 75 }, bloodCalcium: { mgDl: 11 } }],
    ['extreme calcium', { state: { pthPgMl: 30 }, bloodCalcium: { mgDl: 0 } }],
    ['fractional dt', { state: { pthPgMl: 9 }, bloodCalcium: { mgDl: 9 }, dt: 90 }],
  ];

  for (const [label, input] of cases) {
    const { written, writes } = round(input);
    assert.equal(writes.length, 1, label);
    assert.ok(Number.isFinite(written.pthPgMl), `${label}: must be finite`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
