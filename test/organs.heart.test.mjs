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
} from '../organs/human-organs/heart/heart.ts';

const parametersUrl = new URL(
  '../organs/human-organs/heart/heart.parameters.json',
  import.meta.url,
);

function activityAt(intensity, remainingExerciseMin = 10) {
  return { remainingExerciseMin, intensity };
}

function adrenalAt(cortisolRelative) {
  return { cortisolRelative };
}

function round({ state, activity, adrenal, blood, sink = [] } = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'heart') return state;
      if (partId === 'physicalActivity') return activity;
      if (partId === 'adrenal') return adrenal;
      if (partId === 'blood') return blood;
      return undefined;
    },
    actions: [],
    write: (next) => { sink.push(next); },
  });
  return { written: sink[sink.length - 1], writes: sink };
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('heart exports the pump contract without actions', () => {
  assert.equal(id, 'heart');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    heartRatePerMin: { unit: '1/min', mode: 'absolute' },
    strokeVolumeMl: { unit: 'mL', mode: 'absolute' },
    cardiacOutputMlMin: { unit: 'mL/min', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    heartRatePerMin: 70,
    strokeVolumeMl: 70,
    cardiacOutputMlMin: 4900,
  });

  const resting = round({ state: initialState });
  const withActions = round({
    state: initialState,
    activity: activityAt(1),
    adrenal: adrenalAt(1),
  });
  assert.equal(withActions.writes.length, 1);
  assert.deepEqual(Object.keys(resting.written).sort(), Object.keys(fields).sort());
  assert.equal(resting.written.heartRatePerMin, 70);
  assert.equal(resting.written.strokeVolumeMl, 70);
  assert.equal(resting.written.cardiacOutputMlMin, 4900);
});

test('the heart parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'heart');

  const expected = {
    'heart.restingHeartRatePerMin': { value: 70, unit: '1/min' },
    'heart.maxHeartRatePerMin': { value: 180, unit: '1/min' },
    'heart.restingStrokeVolumeMl': { value: 70, unit: 'mL' },
    'heart.activityGain': { value: 1.5, unit: '1' },
    'heart.catecholamineGain': { value: 0.5, unit: '1' },
  };
  assert.deepEqual(
    data.parameters.map((parameter) => parameter.id),
    Object.keys(expected),
  );

  for (const [parameterId, { value, unit }] of Object.entries(expected)) {
    const parameter = data.parameters.find((entry) => entry.id === parameterId);
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expected).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('resting physiology without upstream parts stays at 70 / 70', () => {
  for (const [label, options] of [
    ['missing state and upstream', {}],
    ['saved initial state', { state: initialState }],
    ['cortisol at baseline', { state: initialState, adrenal: adrenalAt(1) }],
    ['zero remaining activity', {
      state: initialState,
      activity: activityAt(1, 0),
    }],
  ]) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    assert.equal(written.heartRatePerMin, 70, label);
    assert.equal(written.strokeVolumeMl, 70, label);
    assert.equal(written.cardiacOutputMlMin, 4900, label);
  }
});

test('activity intensity 1 drives the heart to drive 2.5', () => {
  const { written } = round({ state: initialState, activity: activityAt(1) });

  assertClose(written.heartRatePerMin, 175, 'heart rate');
  assertClose(written.strokeVolumeMl, 91, 'stroke volume');
  assertClose(written.cardiacOutputMlMin, 175 * 91, 'cardiac output');
});

test('cortisol 2 adds 0.5 to drive above baseline', () => {
  const { written } = round({ state: initialState, adrenal: adrenalAt(2) });

  assertClose(written.heartRatePerMin, 105, 'heart rate');
  assertClose(written.strokeVolumeMl, 77, 'stroke volume');
  assertClose(written.cardiacOutputMlMin, 105 * 77, 'cardiac output');
});

test('activity and cortisol gains add before the heart-rate clamp', () => {
  const { written } = round({
    state: initialState,
    activity: activityAt(1, 30),
    adrenal: adrenalAt(2),
  });

  assertClose(written.heartRatePerMin, 180, 'heart rate clamped at max');
  assertClose(written.strokeVolumeMl, 98, 'stroke volume');
  assertClose(written.cardiacOutputMlMin, 180 * 98, 'cardiac output');
});

test('heart rate clamps at 180 while stroke volume keeps following drive', () => {
  const { written } = round({
    state: initialState,
    activity: activityAt(1),
    adrenal: adrenalAt(3),
  });

  assertClose(written.heartRatePerMin, 180, 'heart rate stays at max');
  assertClose(written.strokeVolumeMl, 105, 'stroke volume at drive 3.5');
  assertClose(written.cardiacOutputMlMin, 180 * 105, 'cardiac output');
});

test('heart rate never drops below resting when cortisol is low', () => {
  const { written } = round({ state: initialState, adrenal: adrenalAt(0) });

  assertClose(written.heartRatePerMin, 70, 'heart rate clamped at resting');
  assertClose(written.strokeVolumeMl, 63, 'stroke volume follows drive 0.5');
  assertClose(written.cardiacOutputMlMin, 70 * 63, 'cardiac output');
});

test('cardiac output is always heart rate multiplied by stroke volume', () => {
  const cases = [
    ['resting', {}],
    ['moderate activity', { activity: activityAt(0.5) }],
    ['max activity', { activity: activityAt(1) }],
    ['high cortisol', { adrenal: adrenalAt(3) }],
    ['activity and cortisol', { activity: activityAt(0.75), adrenal: adrenalAt(2) }],
  ];

  for (const [label, options] of cases) {
    const { written } = round({ state: initialState, ...options });
    assert.equal(
      written.cardiacOutputMlMin,
      written.heartRatePerMin * written.strokeVolumeMl,
      label,
    );
  }
});

test('a missing part falls back to no activity and cortisol 1', () => {
  const noActivity = round({ state: initialState, adrenal: adrenalAt(2) });
  assertClose(noActivity.written.heartRatePerMin, 105, 'missing activity');

  const noAdrenal = round({ state: initialState, activity: activityAt(1) });
  assertClose(noAdrenal.written.heartRatePerMin, 175, 'missing adrenal');

  const neither = round({ state: initialState });
  assert.equal(neither.written.heartRatePerMin, 70, 'missing both');
});

test('blood preload scales stroke volume within [0.5, 1.15] and stroke volume clamps to [30, 140]', () => {
  const normal = round({ state: initialState, blood: { bloodVolumeMl: 5000 } }).written;
  assert.equal(normal.strokeVolumeMl, 70);
  assert.equal(normal.cardiacOutputMlMin, 4900);

  const hypovolemic = round({ state: initialState, blood: { bloodVolumeMl: 3000 } }).written;
  assertClose(hypovolemic.strokeVolumeMl, 70 * 0.6, 'preload 0.6');
  assertClose(hypovolemic.cardiacOutputMlMin, 70 * 70 * 0.6, 'CO falls in hypovolemia');

  const severeHypo = round({
    state: initialState,
    adrenal: adrenalAt(0),
    blood: { bloodVolumeMl: 1000 },
  }).written;
  // preloadFactor clamps at 0.5, drive=0.5 -> 70 * 0.9 * 0.5 = 31.5; with lower SV clamp 30
  assertClose(severeHypo.strokeVolumeMl, 31.5, 'severe hypovolemia with preload floor 0.5');

  const highPreloadMaxDrive = round({
    state: initialState,
    activity: activityAt(1),
    adrenal: adrenalAt(10),
    blood: { bloodVolumeMl: 6000 },
  }).written;
  assert.equal(highPreloadMaxDrive.strokeVolumeMl, 140, 'stroke volume clamps at 140 mL');

  for (const blood of [null, {}, { bloodVolumeMl: -1 }, { bloodVolumeMl: Number.NaN }]) {
    const sink = [];
    assert.throws(() => round({ state: initialState, blood, sink }), /blood/);
    assert.equal(sink.length, 0);
  }
});

test('a loaded physicalActivity with invalid fields fails the round without writes', () => {
  const invalid = [
    ['empty part', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining time', { intensity: 1 }],
    ['NaN remaining time', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['infinite remaining time', { remainingExerciseMin: Number.POSITIVE_INFINITY, intensity: 1 }],
    ['negative remaining time', { remainingExerciseMin: -1, intensity: 1 }],
    ['NaN intensity', { remainingExerciseMin: 10, intensity: Number.NaN }],
    ['infinite intensity', { remainingExerciseMin: 10, intensity: Number.POSITIVE_INFINITY }],
    ['negative intensity', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above 1', { remainingExerciseMin: 10, intensity: 1.1 }],
    ['string intensity', { remainingExerciseMin: 10, intensity: '1' }],
    ['null part', null],
    ['non-object part', 42],
  ];

  for (const [label, activity] of invalid) {
    const sink = [];
    assert.throws(
      () => round({ state: initialState, activity, sink }),
      Error,
      label,
    );
    assert.equal(sink.length, 0, `${label}: the round must not write`);
  }
});

test('a loaded adrenal with an invalid cortisol fails the round without writes', () => {
  const invalid = [
    ['empty part', {}],
    ['missing cortisol', { other: 1 }],
    ['NaN cortisol', adrenalAt(Number.NaN)],
    ['infinite cortisol', adrenalAt(Number.POSITIVE_INFINITY)],
    ['negative cortisol', adrenalAt(-0.1)],
    ['string cortisol', adrenalAt('1')],
    ['null part', null],
    ['non-object part', 42],
  ];

  for (const [label, adrenal] of invalid) {
    const sink = [];
    assert.throws(
      () => round({ state: initialState, adrenal, sink }),
      Error,
      label,
    );
    assert.equal(sink.length, 0, `${label}: the round must not write`);
  }
});

test('heart output is finite and JSON-safe', () => {
  const cases = [
    { label: 'missing upstream', options: {} },
    { label: 'saved initial state', options: { state: initialState } },
    {
      label: 'activity and cortisol',
      options: { state: initialState, activity: activityAt(1), adrenal: adrenalAt(2) },
    },
    {
      label: 'low cortisol',
      options: { state: initialState, adrenal: adrenalAt(0) },
    },
    {
      label: 'very high cortisol',
      options: { state: initialState, activity: activityAt(1), adrenal: adrenalAt(10) },
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
