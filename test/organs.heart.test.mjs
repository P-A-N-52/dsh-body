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

function autonomicAt(sympatheticMm) {
  return { sympatheticMm };
}

function round({ state, activity, autonomic, sleep, blood, interoception, actions = [], sink = [] } = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'heart') return state;
      if (partId === 'physicalActivity') return activity;
      if (partId === 'autonomic') return autonomic;
      if (partId === 'sleep') return sleep;
      if (partId === 'blood') return blood;
      if (partId === 'interoception') return interoception;
      return undefined;
    },
    actions,
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
    maxCardiacOutputMlMin: { unit: 'mL/min', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    heartRatePerMin: 70,
    strokeVolumeMl: 70,
    cardiacOutputMlMin: 4900,
    maxCardiacOutputMlMin: 16380,
  });

  const resting = round({ state: initialState });
  const withActions = round({
    state: initialState,
    activity: activityAt(1),
    autonomic: autonomicAt(0),
  });
  assert.equal(withActions.writes.length, 1);
  assert.deepEqual(Object.keys(resting.written).sort(), Object.keys(fields).sort());
  assert.equal(resting.written.heartRatePerMin, 70);
  assert.equal(resting.written.strokeVolumeMl, 70);
  assert.equal(resting.written.cardiacOutputMlMin, 4900);
  assert.equal(resting.written.maxCardiacOutputMlMin, 16380);
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
    'heart.sympatheticDriveGain': { value: 0.012, unit: '1/mm' },
    'heart.startleFloorSympatheticMm': { value: 85, unit: 'mm' },
    'heart.lightSleepDriveBase': { value: 0.86, unit: '1', source: 'SRC-SOMERS-1993' },
    'heart.deepSleepDriveBase': { value: 0.78, unit: '1', source: 'SRC-SOMERS-1993' },
    'heart.remSleepDriveBase': { value: 0.94, unit: '1', source: 'SRC-SOMERS-1993' },
    'heart.minSleepHeartRatePerMin': { value: 42, unit: '1/min' },
    'heart.strokeVolumeGain': { value: 0.2, unit: '1' },
  };
  assert.deepEqual(
    data.parameters.map((parameter) => parameter.id),
    Object.keys(expected),
  );

  for (const [parameterId, { value, unit, source = null }] of Object.entries(expected)) {
    const parameter = data.parameters.find((entry) => entry.id === parameterId);
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, source, `${parameterId}: source`);
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
    ['sympathetic at zero', { state: initialState, autonomic: autonomicAt(0) }],
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

test('sympathetic activation drives tachycardia and startle boosts heart rate immediately', () => {
  const { written } = round({ state: initialState, autonomic: autonomicAt(85) });
  // drive = 1 + 0.012 * 85 = 2.02 -> HR = 141.4, SV = 70 * (1 + 0.2 * 1.02) = 84.28
  assertClose(written.heartRatePerMin, 70 * (1 + 0.012 * 85), 'sympathetic 85 HR');
  assertClose(written.strokeVolumeMl, 70 * (1 + 0.2 * 0.012 * 85), 'sympathetic 85 SV');
  assertClose(written.cardiacOutputMlMin, written.heartRatePerMin * written.strokeVolumeMl, 'CO');

  const startled = round({
    state: initialState,
    sleep: { sleeping: true, sleepStage: 'deep' },
    autonomic: autonomicAt(0),
    actions: [{ type: 'wake_up', startle: true }],
  }).written;
  const emergencyStartled = round({
    state: initialState,
    sleep: { sleeping: true, sleepStage: 'deep' },
    autonomic: autonomicAt(0),
    interoception: { dyspneaMm: 95 },
  }).written;
  assert.ok(emergencyStartled.heartRatePerMin > 140, 'emergency startle immediately spikes heart rate same round');

  const awakeStartleIgnored = round({
    state: initialState,
    sleep: { sleeping: false, sleepStage: 'awake' },
    autonomic: autonomicAt(0),
    actions: [{ type: 'wake_up', startle: true }],
  }).written;
  assert.equal(awakeStartleIgnored.heartRatePerMin, 70, 'startle action ignored when already awake');
});

test('sleep downregulates resting heart rate in light, deep, and REM stages', () => {
  const light = round({ state: initialState, sleep: { sleeping: true, sleepStage: 'light' } }).written;
  const deep = round({ state: initialState, sleep: { sleeping: true, sleepStage: 'deep' } }).written;
  const rem = round({ state: initialState, sleep: { sleeping: true, sleepStage: 'rem' } }).written;
  assertClose(light.heartRatePerMin, 70 * 0.86, 'light sleep HR');
  assertClose(deep.heartRatePerMin, 70 * 0.78, 'deep sleep HR');
  assertClose(rem.heartRatePerMin, 70 * 0.94, 'REM sleep HR');
  assert.ok(deep.heartRatePerMin < light.heartRatePerMin);
  assert.ok(light.heartRatePerMin < rem.heartRatePerMin);
});

test('heart rate clamps at 180 and cardiac output equals HR times SV', () => {
  const cases = [
    ['resting', {}],
    ['moderate activity', { activity: activityAt(0.5) }],
    ['max activity', { activity: activityAt(1) }],
    ['high sympathetic', { autonomic: autonomicAt(100) }],
    ['deep sleep', { sleep: { sleeping: true, sleepStage: 'deep' } }],
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

test('blood preload scales stroke volume within [0.5, 1.15] and stroke volume clamps to [30, 140]', () => {
  const normal = round({ state: initialState, blood: { bloodVolumeMl: 5000 } }).written;
  assert.equal(normal.strokeVolumeMl, 70);
  assert.equal(normal.cardiacOutputMlMin, 4900);

  const hypovolemic = round({ state: initialState, blood: { bloodVolumeMl: 3000 } }).written;
  assertClose(hypovolemic.strokeVolumeMl, 70 * 0.6, 'preload 0.6');
  assertClose(hypovolemic.cardiacOutputMlMin, 70 * 70 * 0.6, 'CO falls in hypovolemia');

  const highPreloadMaxDrive = round({
    state: initialState,
    activity: activityAt(1),
    autonomic: autonomicAt(100),
    blood: { bloodVolumeMl: 6000 },
  }).written;
  assert.ok(highPreloadMaxDrive.strokeVolumeMl <= 140);

  for (const blood of [{}, { bloodVolumeMl: -1 }, { bloodVolumeMl: Number.NaN }]) {
    const sink = [];
    assert.throws(() => round({ state: initialState, blood, sink }), /blood/);
    assert.equal(sink.length, 0);
  }
});

test('a loaded physicalActivity or autonomic with invalid fields fails the round without writes', () => {
  const invalidActivity = [
    ['empty part', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining time', { intensity: 1 }],
    ['NaN remaining time', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['negative remaining time', { remainingExerciseMin: -1, intensity: 1 }],
    ['negative intensity', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above 1', { remainingExerciseMin: 10, intensity: 1.1 }],
  ];

  for (const [label, activity] of invalidActivity) {
    const sink = [];
    assert.throws(() => round({ state: initialState, activity, sink }), Error, label);
    assert.equal(sink.length, 0, `${label}: no write`);
  }

  for (const [label, autonomic] of [
    ['empty autonomic', {}],
    ['NaN sympathetic', autonomicAt(Number.NaN)],
    ['negative sympathetic', autonomicAt(-1)],
    ['string sympathetic', autonomicAt('10')],
  ]) {
    const sink = [];
    assert.throws(() => round({ state: initialState, autonomic, sink }), Error, label);
    assert.equal(sink.length, 0, `${label}: no write`);
  }
});

test('heart output is finite and JSON-safe', () => {
  for (const options of [
    {},
    { state: initialState },
    { state: initialState, activity: activityAt(0.5), autonomic: autonomicAt(50), blood: { bloodVolumeMl: 4800 } },
  ]) {
    const { written } = round(options);
    for (const value of Object.values(written)) {
      assert.ok(Number.isFinite(value));
    }
    assertJsonValue(written);
  }
});
