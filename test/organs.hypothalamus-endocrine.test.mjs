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
} from '../organs/human-organs/brain/hypothalamus-endocrine.ts';

const HALF_TIME_MIN = 30;
const MAX_RELATIVE = 3;
const parametersUrl = new URL(
  '../organs/human-organs/brain/hypothalamus-endocrine.parameters.json',
  import.meta.url,
);
const parameterValues = loadParameters(parametersUrl);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

function retention(dtMin) {
  return 2 ** (-dtMin / HALF_TIME_MIN);
}

function targetFor(gain, peripheralRelative) {
  return Math.min(MAX_RELATIVE, Math.max(0, 1 + gain * (1 - peripheralRelative)));
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function round({
  state = initialState,
  thyroid,
  adrenal,
  thermoregulation,
  glucose,
  physicalActivity,
  dt = 60,
  actions = [],
  writes = [],
} = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'hypothalamusEndocrine') return state;
      if (partId === 'thyroid') return thyroid;
      if (partId === 'adrenal') return adrenal;
      if (partId === 'thermoregulation') return thermoregulation;
      if (partId === 'glucose') return glucose;
      if (partId === 'physicalActivity') return physicalActivity;
      throw new Error(`unexpected read: ${partId}`);
    },
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
    notify: () => { throw new Error('hypothalamusEndocrine must not notify'); },
    transfer: () => { throw new Error('hypothalamusEndocrine must not transfer'); },
  });
  return writes[writes.length - 1];
}

test('hypothalamus endocrine exports the organ module contract', () => {
  assert.equal(id, 'hypothalamusEndocrine');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    trhRelative: { unit: '1', mode: 'absolute' },
    crhRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { trhRelative: 1, crhRelative: 1 });
});

test('the feedback gains are design parameters with no source', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'hypothalamusEndocrine');
  assert.deepEqual(parameterValues, {
    'hypothalamusEndocrine.trhFeedbackGain': 1,
    'hypothalamusEndocrine.crhFeedbackGain': 1,
  });
  assert.deepEqual(
    parameterFile.parameters.map(({ id: parameterId, unit, status, source }) => ({
      parameterId,
      unit,
      status,
      source,
    })),
    [
      {
        parameterId: 'hypothalamusEndocrine.trhFeedbackGain',
        unit: '1/1',
        status: 'design',
        source: null,
      },
      {
        parameterId: 'hypothalamusEndocrine.crhFeedbackGain',
        unit: '1/1',
        status: 'design',
        source: null,
      },
    ],
  );
});

test('peripheral signals at 1 keep TRH and CRH exactly at 1', () => {
  const next = round({
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 1 },
  });
  assert.deepEqual(next, { trhRelative: 1, crhRelative: 1 });
});

test('missing thyroid or adrenal parts fall back to 1 and stay inert', () => {
  assert.deepEqual(round(), { trhRelative: 1, crhRelative: 1 });
  assert.deepEqual(
    round({ thyroid: { thyroxineRelative: 1 } }),
    { trhRelative: 1, crhRelative: 1 },
  );
  assert.deepEqual(
    round({ adrenal: { cortisolRelative: 1 } }),
    { trhRelative: 1, crhRelative: 1 },
  );
  assert.deepEqual(
    round({ adrenal: { cortisolRelative: 2 } }),
    { trhRelative: 1, crhRelative: retention(1) },
  );
  assert.deepEqual(
    round({ thyroid: { thyroxineRelative: 2 } }),
    { trhRelative: retention(1), crhRelative: 1 },
  );
});

test('thyroxine 2 lowers TRH toward the zero target', () => {
  const next = round({ thyroid: { thyroxineRelative: 2 } });
  const target = targetFor(1, 2);
  assert.equal(target, 0);
  assertClose(next.trhRelative, target + (1 - target) * retention(1), 'T4=2');
  assert.ok(next.trhRelative < 1);
  assert.ok(next.trhRelative > 0);
});

test('thyroxine 0.5 raises TRH toward 1.5', () => {
  const next = round({ thyroid: { thyroxineRelative: 0.5 } });
  const target = targetFor(1, 0.5);
  assert.equal(target, 1.5);
  assertClose(next.trhRelative, target + (1 - target) * retention(1), 'T4=0.5');
  assert.ok(next.trhRelative > 1);
  assert.ok(next.trhRelative < target);
});

test('cortisol 2 lowers CRH and cortisol 0.5 raises it', () => {
  const high = round({ adrenal: { cortisolRelative: 2 } });
  assertClose(high.crhRelative, retention(1), 'cortisol=2');
  assert.ok(high.crhRelative < 1);
  assert.equal(high.trhRelative, 1);

  const low = round({ adrenal: { cortisolRelative: 0.5 } });
  assertClose(low.crhRelative, 1.5 - 0.5 * retention(1), 'cortisol=0.5');
  assert.ok(low.crhRelative > 1);
  assert.equal(low.trhRelative, 1);
});

test('a 30 min round halves the distance to the target', () => {
  const next = round({
    state: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 2 },
    dt: 30 * 60,
  });
  assert.deepEqual(next, { trhRelative: 1, crhRelative: 1 });
});

test('a 15 min round keeps 2^-1/2 and a 60 s round keeps 2^-2 of the state', () => {
  const fifteenMinutes = round({
    state: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 2 },
    dt: 15 * 60,
  });
  assertClose(fifteenMinutes.trhRelative, 2 * 2 ** (-0.5), 'dt=15 min TRH');
  assertClose(fifteenMinutes.crhRelative, 2 * 2 ** (-0.5), 'dt=15 min CRH');

  const oneMinute = round({
    state: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 2 },
  });
  assertClose(oneMinute.trhRelative, 2 * retention(1), 'dt=60 s TRH');
  assertClose(oneMinute.crhRelative, 2 * retention(1), 'dt=60 s CRH');
});

test('repeated rounds converge on the clamped targets', () => {
  let state = initialState;
  for (let index = 0; index < 1000; index++) {
    state = round({
      state,
      thyroid: { thyroxineRelative: 0 },
      adrenal: { cortisolRelative: 2 },
    });
  }
  assertClose(state.trhRelative, 2, 'T4=0 converges to 2', 1e-9);
  assertClose(state.crhRelative, 0, 'cortisol=2 converges to 0', 1e-9);
});

test('targets clamp to the 0-3 band', () => {
  const highThyroxine = round({ thyroid: { thyroxineRelative: 5 } });
  assertClose(highThyroxine.trhRelative, retention(1), 'T4=5 clamps the target at 0');

  const zeroThyroxine = round({ thyroid: { thyroxineRelative: 0 } });
  assertClose(zeroThyroxine.trhRelative, 2 - retention(1), 'T4=0 target is 2');

  for (const thyroid of [{ thyroxineRelative: 0 }, { thyroxineRelative: 100 }]) {
    let state = initialState;
    for (let index = 0; index < 100; index++) {
      state = round({ state, thyroid, dt: 30 });
      assert.ok(state.trhRelative >= 0 && state.trhRelative <= MAX_RELATIVE);
    }
  }
});

test('a loaded thyroid part with an invalid reading fails before writing', () => {
  const invalid = [
    ['empty part', {}],
    ['undefined field', { thyroxineRelative: undefined }],
    ['null field', { thyroxineRelative: null }],
    ['NaN', { thyroxineRelative: Number.NaN }],
    ['positive infinity', { thyroxineRelative: Number.POSITIVE_INFINITY }],
    ['negative infinity', { thyroxineRelative: Number.NEGATIVE_INFINITY }],
    ['negative', { thyroxineRelative: -1 }],
    ['non-number', { thyroxineRelative: '2' }],
  ];

  for (const [label, thyroid] of invalid) {
    const writes = [];
    assert.throws(() => round({ thyroid, writes }), Error, label);
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('a loaded adrenal part with an invalid reading fails before writing', () => {
  const invalid = [
    ['empty part', {}],
    ['undefined field', { cortisolRelative: undefined }],
    ['null field', { cortisolRelative: null }],
    ['NaN', { cortisolRelative: Number.NaN }],
    ['positive infinity', { cortisolRelative: Number.POSITIVE_INFINITY }],
    ['negative infinity', { cortisolRelative: Number.NEGATIVE_INFINITY }],
    ['negative', { cortisolRelative: -1 }],
    ['non-number', { cortisolRelative: '2' }],
  ];

  for (const [label, adrenal] of invalid) {
    const writes = [];
    assert.throws(() => round({ adrenal, writes }), Error, label);
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('a valid thyroid reading does not hide an invalid adrenal reading', () => {
  const writes = [];
  assert.throws(
    () => round({
      thyroid: { thyroxineRelative: 1.5 },
      adrenal: { cortisolRelative: Number.NaN },
      writes,
    }),
    Error,
  );
  assert.equal(writes.length, 0);
});

test('actions do not change the output and nothing is notified or transferred', () => {
  const withActions = round({
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 0.5 },
    actions: [
      { type: 'eat', energyKcal: 100 },
      { type: 'drink', volumeMl: 240 },
    ],
  });
  const withoutActions = round({
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 0.5 },
  });
  assert.deepEqual(withActions, withoutActions);
});

test('the written state is finite and JSON-safe', () => {
  const cases = [
    round(),
    round({ thyroid: { thyroxineRelative: 0 } }),
    round({ adrenal: { cortisolRelative: 0 } }),
    round({
      state: { trhRelative: 2.5, crhRelative: 0.5 },
      thyroid: { thyroxineRelative: 2 },
      adrenal: { cortisolRelative: 2 },
      dt: 0.5,
    }),
  ];

  for (const next of cases) {
    assert.deepEqual(Object.keys(next), ['trhRelative', 'crhRelative']);
    for (const value of Object.values(next)) {
      assert.ok(Number.isFinite(value));
    }
    assert.doesNotThrow(() => assertJsonValue(next));
    assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
  }
});

test('upstream cold, hypoglycemia and hard exercise drivers activate TRH/CRH while resting baseline stays 1.0', () => {
  const resting = round({
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 1 },
    thermoregulation: { coreTemperatureC: 37 },
    glucose: { concentrationMgDl: 90 },
    physicalActivity: { remainingExerciseMin: 0, intensity: 0 },
  });
  assert.deepEqual(resting, { trhRelative: 1, crhRelative: 1 });

  const deadband = round({
    thermoregulation: { coreTemperatureC: 36.8 },
    dt: 30 * 60,
  });
  assert.deepEqual(deadband, { trhRelative: 1, crhRelative: 1 }, '36.8C sits at the cold-stress deadband');

  const nearResting = round({
    thermoregulation: { coreTemperatureC: 36.99999993 },
    dt: 30 * 60,
  });
  assert.deepEqual(nearResting, { trhRelative: 1, crhRelative: 1 }, '36.99999993C stays inside deadband');

  const cold = round({
    thermoregulation: { coreTemperatureC: 35 },
    dt: 30 * 60,
  });
  assertClose(cold.trhRelative, 1 + (1.54 - 1) * 0.5, 'cold 35C drives TRH toward 1.54');
  assert.equal(cold.crhRelative, 1);

  const normoglycemia80 = round({
    glucose: { concentrationMgDl: 80 },
    dt: 30 * 60,
  });
  assert.equal(normoglycemia80.crhRelative, 1, '80 mg/dL adds +0 to CRH');

  const hypoglycemia = round({
    glucose: { concentrationMgDl: 60 },
    dt: 30 * 60,
  });
  assertClose(hypoglycemia.crhRelative, 1 + (1.4 - 1) * 0.5, 'glucose 60 drives CRH toward 1.4');
  assert.equal(hypoglycemia.trhRelative, 1);

  const moderateExercise = round({
    physicalActivity: { remainingExerciseMin: 10, intensity: 0.5 },
    dt: 30 * 60,
  });
  assert.equal(moderateExercise.crhRelative, 1, 'intensity 0.5 adds +0 to CRH');

  const hardExercise = round({
    physicalActivity: { remainingExerciseMin: 10, intensity: 1 },
    dt: 30 * 60,
  });
  assertClose(hardExercise.crhRelative, 1 + (1.2 - 1) * 0.5, 'hard exercise drives CRH toward 1.2');

  const extremeCombined = round({
    thermoregulation: { coreTemperatureC: 20 },
    glucose: { concentrationMgDl: 0 },
    physicalActivity: { remainingExerciseMin: 10, intensity: 1 },
    dt: 6000 * 60,
  });
  assert.equal(extremeCombined.trhRelative, 3);
  assertClose(extremeCombined.crhRelative, 2.8, 'hypoglycemia 1.6 + exercise 0.2');

  const clampedCombined = round({
    adrenal: { cortisolRelative: 0 },
    thermoregulation: { coreTemperatureC: 20 },
    glucose: { concentrationMgDl: 0 },
    physicalActivity: { remainingExerciseMin: 10, intensity: 1 },
    dt: 6000 * 60,
  });
  assert.equal(clampedCombined.trhRelative, 3);
  assert.equal(clampedCombined.crhRelative, 3);
});
