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
  mouthMoistureMm,
} from '../organs/human-organs/salivary-glands/saliva.ts';

const parametersUrl = new URL(
  '../organs/human-organs/salivary-glands/saliva.parameters.json',
  import.meta.url,
);

const BASAL_RATE = 0.5;
const MEAL_GAIN = 3;
const BASAL_MOISTURE = 100;

function round({ state, bodyFluid, actions = [], dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'salivaryGlands') return state;
      if (partId === 'bodyFluid') return bodyFluid;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written: writes[writes.length - 1], writes, transfers };
}

function eat(volumeMl = 250) {
  return { type: 'eat', volumeMl, energyKcal: 300, mealKind: 'solid' };
}

function drink(volumeMl = 240) {
  return { type: 'drink', volumeMl };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('salivaryGlands exports the saliva contract without transfers', () => {
  assert.equal(id, 'salivaryGlands');
  assert.deepEqual(actionTypes, ['eat', 'drink']);
  assert.deepEqual(fields, {
    salivaRateMlPerMin: { unit: 'mL/min', mode: 'absolute' },
    mealStimulusMin: { unit: 'min', mode: 'absolute' },
    mouthMoistureMm: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    salivaRateMlPerMin: BASAL_RATE,
    mealStimulusMin: 0,
    mouthMoistureMm: BASAL_MOISTURE,
  });

  const { written, transfers } = round();
  assertClose(written.salivaRateMlPerMin, BASAL_RATE, 'basal rate');
  assert.equal(written.mealStimulusMin, 0);
  assertClose(written.mouthMoistureMm, BASAL_MOISTURE, 'basal moisture');
  assert.deepEqual(transfers, []);
});

test('saliva parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'salivaryGlands');

  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'salivaryGlands.basalRateMlPerMin',
    'salivaryGlands.dehydrationFactor',
    'salivaryGlands.mealGain',
    'salivaryGlands.mealWindowMin',
  ]);
  for (const [parameterId, value, unit] of [
    ['salivaryGlands.basalRateMlPerMin', 0.5, 'mL/min'],
    ['salivaryGlands.mealGain', 3, '1'],
    ['salivaryGlands.mealWindowMin', 5, 'min'],
    ['salivaryGlands.dehydrationFactor', 0.5, '1'],
  ]) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }

  const consumerById = Object.fromEntries(
    (data.consumerParameters ?? []).map((parameter) => [parameter.id, parameter]),
  );
  const amylaseGain = consumerById['duodenum.salivaryAmylaseGain'];
  assert.ok(amylaseGain, 'duodenum.salivaryAmylaseGain must be declared');
  assert.equal(amylaseGain.value, 0.05);
  assert.equal(amylaseGain.unit, '1');
  assert.equal(amylaseGain.status, 'design');
  assert.equal(amylaseGain.source, null);

  assert.deepEqual(loadParameters(parametersUrl), {
    'salivaryGlands.basalRateMlPerMin': 0.5,
    'salivaryGlands.mealGain': 3,
    'salivaryGlands.mealWindowMin': 5,
    'salivaryGlands.dehydrationFactor': 0.5,
  });
});

test('eat and drink raise the rate threefold for a five minute window', () => {
  for (const [label, action] of [['eat', eat()], ['drink', drink()]]) {
    const { written } = round({ actions: [action] });
    assert.equal(written.mealStimulusMin, 5, label);
    assertClose(written.salivaRateMlPerMin, BASAL_RATE * MEAL_GAIN, `${label}: stimulated rate`);
    assertClose(written.mouthMoistureMm, 100, `${label}: stimulated moisture`);
  }

  let state = round({ actions: [eat()] }).written;
  for (let remaining = 4; remaining >= 1; remaining--) {
    const { written } = round({ state });
    assert.equal(written.mealStimulusMin, remaining, `stimulus minute ${remaining}`);
    assertClose(written.salivaRateMlPerMin, BASAL_RATE * MEAL_GAIN, `stimulus minute ${remaining}: rate`);
    assertClose(written.mouthMoistureMm, 100, `stimulus minute ${remaining}: moisture`);
    state = written;
  }

  const { written } = round({ state });
  assert.equal(written.mealStimulusMin, 0, 'window exhausted');
  assertClose(written.salivaRateMlPerMin, BASAL_RATE, 'back to basal');
  assertClose(written.mouthMoistureMm, BASAL_MOISTURE, 'basal moisture');
});

test('non-intake actions, zero-volume intakes, and malformed eat actions do not stimulate saliva', () => {
  const ignored = [
    { type: 'urinate' },
    { type: 'eat', volumeMl: 0, energyKcal: 300, mealKind: 'solid' },
    { type: 'drink', volumeMl: -240 },
    { type: 'drink', volumeMl: '240' },
    { type: 'eat', volumeMl: Number.NaN, energyKcal: 300, mealKind: 'solid' },
    { type: 'eat', volumeMl: 250 },
    { type: 'eat', volumeMl: 250, energyKcal: 300 },
    { type: 'eat', volumeMl: 250, energyKcal: 300, mealKind: 'snack' },
    { type: 'eat', volumeMl: 250, energyKcal: -10, mealKind: 'solid' },
    { type: 'eat', volumeMl: 250, energyKcal: Number.NaN, mealKind: 'solid' },
    { type: 'eat', volumeMl: 250, energyKcal: 300, mealKind: 'solid', durationMin: -1 },
    { type: 'drink', volumeMl: 240, carbohydrateG: -5 },
  ];

  for (const action of ignored) {
    const { written } = round({ actions: [action] });
    assert.equal(written.mealStimulusMin, 0, JSON.stringify(action));
    assertClose(written.salivaRateMlPerMin, BASAL_RATE, JSON.stringify(action));
  }
});

test('dehydration halves the rate at full deficit and scales linearly', () => {
  const full = round({ bodyFluid: { waterDeficit: 1 } }).written;
  assertClose(full.salivaRateMlPerMin, BASAL_RATE * 0.5, 'full deficit');
  assertClose(full.mouthMoistureMm, 50, 'full deficit moisture');

  const half = round({ bodyFluid: { waterDeficit: 0.5 } }).written;
  assertClose(half.salivaRateMlPerMin, BASAL_RATE * 0.75, 'half deficit');
  assertClose(half.mouthMoistureMm, 75, 'half deficit moisture');

  const withMeal = round({
    bodyFluid: { waterDeficit: 1 },
    actions: [eat()],
  }).written;
  assertClose(withMeal.salivaRateMlPerMin, BASAL_RATE * MEAL_GAIN * 0.5, 'stimulated full deficit');
  assertClose(withMeal.mouthMoistureMm, 100, 'stimulated full deficit moisture clamps at 100');
});

test('the deficit input and mouth moisture are clamped', () => {
  assert.equal(mouthMoistureMm(10), 100);
  assert.equal(mouthMoistureMm(-1), 0);

  const over = round({ bodyFluid: { waterDeficit: 2 } }).written;
  assertClose(over.salivaRateMlPerMin, BASAL_RATE * 0.5, 'deficit above one is clamped');
  assert.ok(over.mouthMoistureMm >= 0 && over.mouthMoistureMm <= 100);

  const under = round({ bodyFluid: { waterDeficit: -2 } }).written;
  assertClose(under.salivaRateMlPerMin, BASAL_RATE, 'deficit below zero is clamped');
  assert.ok(under.mouthMoistureMm >= 0 && under.mouthMoistureMm <= 100);
});

test('a missing bodyFluid part means zero deficit', () => {
  for (const bodyFluid of [undefined, null]) {
    const { written, writes } = round({ bodyFluid });
    assert.equal(writes.length, 1);
    assertClose(written.salivaRateMlPerMin, BASAL_RATE, String(bodyFluid));
    assertClose(written.mouthMoistureMm, BASAL_MOISTURE, String(bodyFluid));
  }
});

test('a loaded bodyFluid with an invalid waterDeficit fails the round without writing', () => {
  const invalid = [
    ['empty part', {}],
    ['null deficit', { waterDeficit: null }],
    ['string deficit', { waterDeficit: '0.5' }],
    ['NaN deficit', { waterDeficit: Number.NaN }],
    ['infinite deficit', { waterDeficit: Number.POSITIVE_INFINITY }],
    ['non-object part', 'bodyFluid'],
  ];

  for (const [label, bodyFluid] of invalid) {
    const writes = [];
    assert.throws(
      () => heartbeat({
        read: (partId) => (partId === 'bodyFluid' ? bodyFluid : undefined),
        actions: [],
        dt: 60,
        simulatedSeconds: 60,
        write: (next) => { writes.push(next); },
      }),
      /bodyFluid/,
      label,
    );
    assert.equal(writes.length, 0, `${label}: must not write`);
  }
});

test('the stimulus window decays with io.dt in minutes, not simulatedSeconds', () => {
  const twoMinutes = round({
    state: { ...initialState, mealStimulusMin: 5 },
    dt: 120,
    simulatedSeconds: 60,
  }).written;
  assert.equal(twoMinutes.mealStimulusMin, 3);
  assertClose(twoMinutes.salivaRateMlPerMin, BASAL_RATE * MEAL_GAIN, 'still stimulated');

  const expires = round({
    state: { ...initialState, mealStimulusMin: 1 },
    dt: 120,
    simulatedSeconds: 60,
  }).written;
  assert.equal(expires.mealStimulusMin, 0);
  assertClose(expires.salivaRateMlPerMin, BASAL_RATE, 'expired');

  const later = round({
    state: { ...initialState, mealStimulusMin: 5 },
    dt: 60,
    simulatedSeconds: 100000,
  }).written;
  assert.equal(later.mealStimulusMin, 4, 'simulatedSeconds does not decay the window');
});

test('an old state without salivary fields falls back to basal and no stimulus', () => {
  const { written } = round({ state: {} });
  assert.equal(written.mealStimulusMin, 0);
  assertClose(written.salivaRateMlPerMin, BASAL_RATE, 'basal rate');
  assertClose(written.mouthMoistureMm, BASAL_MOISTURE, 'basal moisture');
});

test('saliva output is finite and JSON-safe', () => {
  const cases = [
    ['quiet', {}],
    ['meal', { actions: [eat()] }],
    ['dehydrated', { bodyFluid: { waterDeficit: 0.8 } }],
    ['meal and dehydration', { bodyFluid: { waterDeficit: 1 }, actions: [drink()] }],
    ['long dt with old state', { state: { ...initialState, mealStimulusMin: 30 }, dt: 600 }],
    ['over-range deficit', { bodyFluid: { waterDeficit: 9 } }],
  ];

  for (const [label, options] of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
