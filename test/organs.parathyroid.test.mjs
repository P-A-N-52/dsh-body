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
  return Math.min(3, Math.max(0, 1 + 0.5 * (9.5 - mgDl)));
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

test('parathyroid exports the endocrine organ contract without actions or transfers', () => {
  assert.equal(id, 'parathyroid');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    pthRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { pthRelative: 1 });

  const withActions = round({
    state: initialState,
    bloodCalcium: { mgDl: 8 },
    actions: [{ type: 'eat', energyKcal: 100 }, { type: 'drink', volumeMl: 240 }],
  });
  const withoutActions = round({ state: initialState, bloodCalcium: { mgDl: 8 } });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(withActions.transfers, []);
  assert.deepEqual(withActions.notifications, []);
  assert.deepEqual(Object.keys(withActions.written), ['pthRelative']);
});

test('parathyroid parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'parathyroid');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'parathyroid.pthGain',
    'parathyroid.referenceCalciumMgDl',
  ]);
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }
  assert.equal(byId['parathyroid.referenceCalciumMgDl'].unit, 'mg/dL');
  assert.equal(byId['parathyroid.referenceCalciumMgDl'].value, 9.5);
  assert.equal(byId['parathyroid.pthGain'].unit, '1');
  assert.equal(byId['parathyroid.pthGain'].value, 0.5);

  assert.deepEqual(loadParameters(parametersUrl), {
    'parathyroid.pthGain': 0.5,
    'parathyroid.referenceCalciumMgDl': 9.5,
  });
});

test('low calcium raises PTH toward the 15-minute target', () => {
  const oneHalf = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 8 },
    dt: 15 * 60,
  });
  assertClose(oneHalf.written.pthRelative, 1.375, 'halfway from 1 toward 1.75');

  const twoHalves = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 8 },
    dt: 30 * 60,
  });
  assertClose(twoHalves.written.pthRelative, 1.5625, 'two half-times');

  const oneMinute = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 8 },
    dt: 60,
  });
  assertClose(
    oneMinute.written.pthRelative,
    approach(1, targetAt(8), 1),
    'one 60-second round is one minute of a 15-minute half-time',
  );
});

test('high calcium lowers PTH toward the 15-minute target', () => {
  const oneHalf = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 11 },
    dt: 15 * 60,
  });
  assertClose(oneHalf.written.pthRelative, 0.625, 'halfway from 1 toward 0.25');

  const twoHalves = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 11 },
    dt: 30 * 60,
  });
  assertClose(twoHalves.written.pthRelative, 0.4375, 'two half-times');

  const above = round({
    state: { pthRelative: 0.5 },
    bloodCalcium: { mgDl: 11 },
    dt: 15 * 60,
  });
  assertClose(above.written.pthRelative, 0.375, 'falling from above the target');
});

test('the PTH target clamps to 0-3 at extreme calcium readings', () => {
  const low = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 0 },
    dt: 15 * 60,
  });
  assertClose(low.written.pthRelative, 2, 'clamped target 3, halfway from 1');

  const high = round({
    state: { pthRelative: 1 },
    bloodCalcium: { mgDl: 20 },
    dt: 15 * 60,
  });
  assertClose(high.written.pthRelative, 0.5, 'clamped target 0, halfway from 1');
});

test('a missing bloodCalcium uses the 9.5 mg/dL reference', () => {
  const fromHigh = round({ state: { pthRelative: 2 }, dt: 15 * 60 });
  assertClose(fromHigh.written.pthRelative, 1.5, 'PTH decays halfway toward 1');

  const fromBaseline = round({ state: { pthRelative: 1 }, dt: 15 * 60 });
  assertClose(fromBaseline.written.pthRelative, 1, 'reference is a fixed point');

  const newBody = round({ dt: 15 * 60 });
  assertClose(newBody.written.pthRelative, 1, 'a missing state starts at baseline');

  const missingField = round({ state: {}, dt: 15 * 60 });
  assertClose(missingField.written.pthRelative, 1, 'a missing PTH field starts at baseline');

  const invalidPrev = round({ state: { pthRelative: Number.NaN }, dt: 15 * 60 });
  assertClose(invalidPrev.written.pthRelative, 1, 'a NaN PTH field starts at baseline');
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
    ['low calcium', { state: { pthRelative: 1 }, bloodCalcium: { mgDl: 8 } }],
    ['high calcium', { state: { pthRelative: 2.5 }, bloodCalcium: { mgDl: 11 } }],
    ['extreme calcium', { state: { pthRelative: 1 }, bloodCalcium: { mgDl: 0 } }],
    ['fractional dt', { state: { pthRelative: 0.3 }, bloodCalcium: { mgDl: 9 }, dt: 90 }],
  ];

  for (const [label, input] of cases) {
    const { written, writes } = round(input);
    assert.equal(writes.length, 1, label);
    assert.ok(Number.isFinite(written.pthRelative), `${label}: must be finite`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
