import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/skeletal-muscle/activity.ts';

function round({ state, actions = [], dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => (partId === 'physicalActivity' ? state : undefined),
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function exercise(intensity, durationMin) {
  return { type: 'exercise', intensity, durationMin };
}

function sex(intensity, durationMin) {
  return { type: 'sex', intensity, durationMin };
}

test('physicalActivity exports the activity module contract', () => {
  assert.equal(id, 'physicalActivity');
  assert.deepEqual(actionTypes, ['exercise', 'sex', 'stop_exercise']);
  assert.deepEqual(fields, {
    remainingExerciseMin: { unit: 'min', mode: 'absolute' },
    intensity: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(round().written, { remainingExerciseMin: 0, intensity: 0 });
});

test('a saved activity loses io.dt minutes and keeps its intensity', () => {
  const state = { remainingExerciseMin: 10, intensity: 0.5 };
  const cases = [
    { label: 'one minute', dt: 60, simulatedSeconds: 60, expected: { remainingExerciseMin: 9, intensity: 0.5 } },
    { label: 'two minutes', dt: 120, simulatedSeconds: 60, expected: { remainingExerciseMin: 8, intensity: 0.5 } },
    { label: 'ninety seconds', dt: 90, simulatedSeconds: 60, expected: { remainingExerciseMin: 8.5, intensity: 0.5 } },
    { label: 'later simulated clock', dt: 60, simulatedSeconds: 6000, expected: { remainingExerciseMin: 9, intensity: 0.5 } },
  ];

  for (const { label, dt, simulatedSeconds, expected } of cases) {
    assert.deepEqual(round({ state, dt, simulatedSeconds }).written, expected, label);
  }
});

test('remaining exercise reaches zero exactly and clears intensity', () => {
  const cases = [
    { state: { remainingExerciseMin: 1, intensity: 0.5 }, dt: 60 },
    { state: { remainingExerciseMin: 0.25, intensity: 0.5 }, dt: 60 },
    { state: { remainingExerciseMin: 0, intensity: 0 }, dt: 60 },
  ];

  for (const { state, dt } of cases) {
    assert.deepEqual(
      round({ state, dt }).written,
      { remainingExerciseMin: 0, intensity: 0 },
    );
  }

  let state = { remainingExerciseMin: 2, intensity: 0.7 };
  state = round({ state }).written;
  assert.deepEqual(state, { remainingExerciseMin: 1, intensity: 0.7 });
  state = round({ state }).written;
  assert.deepEqual(state, { remainingExerciseMin: 0, intensity: 0 });
  state = round({ state }).written;
  assert.deepEqual(state, { remainingExerciseMin: 0, intensity: 0 });
});

test('a valid exercise replaces the remaining activity and the last valid action wins', () => {
  const state = { remainingExerciseMin: 5, intensity: 0.5 };
  const cases = [
    {
      label: 'replace instead of adding',
      actions: [exercise(0.8, 30)],
      expected: { remainingExerciseMin: 30, intensity: 0.8 },
    },
    {
      label: 'last valid exercise wins',
      actions: [exercise(0.2, 10), { type: 'drink', volumeMl: 240 }, exercise(0.9, 20)],
      expected: { remainingExerciseMin: 20, intensity: 0.9 },
    },
    {
      label: 'intake and energy payload are ignored',
      actions: [{ type: 'exercise', intensity: 0.4, durationMin: 7, volumeMl: 500, energyKcal: 40 }],
      expected: { remainingExerciseMin: 7, intensity: 0.4 },
    },
    {
      label: 'fractional duration replaces the remainder',
      actions: [exercise(1, 0.5)],
      expected: { remainingExerciseMin: 0.5, intensity: 1 },
    },
  ];

  for (const { label, actions, expected } of cases) {
    assert.deepEqual(round({ state, actions }).written, expected, label);
  }
});

test('a valid sex action replaces the remaining activity exactly like exercise', () => {
  const state = { remainingExerciseMin: 5, intensity: 0.5 };
  const cases = [
    { label: 'replace instead of adding', payload: { intensity: 0.8, durationMin: 30 } },
    { label: 'fractional duration', payload: { intensity: 1, durationMin: 0.5 } },
    { label: 'low intensity', payload: { intensity: 0.01, durationMin: 2 } },
  ];

  for (const { label, payload } of cases) {
    const sexRound = round({ state, actions: [{ type: 'sex', ...payload }] });
    const exerciseRound = round({ state, actions: [{ type: 'exercise', ...payload }] });
    assert.deepEqual(sexRound.written, exerciseRound.written, label);
    assert.deepEqual(
      sexRound.written,
      { remainingExerciseMin: payload.durationMin, intensity: payload.intensity },
      label,
    );
  }
});

test('with sex and exercise in the same round the last valid action wins', () => {
  const state = { remainingExerciseMin: 5, intensity: 0.5 };
  const cases = [
    {
      label: 'sex after exercise',
      actions: [exercise(0.2, 10), sex(0.9, 20)],
      expected: { remainingExerciseMin: 20, intensity: 0.9 },
    },
    {
      label: 'exercise after sex',
      actions: [sex(0.9, 20), exercise(0.2, 10)],
      expected: { remainingExerciseMin: 10, intensity: 0.2 },
    },
    {
      label: 'interleaved actions keep document order',
      actions: [sex(0.4, 8), { type: 'drink', volumeMl: 240 }, exercise(0.6, 15), sex(0.7, 6)],
      expected: { remainingExerciseMin: 6, intensity: 0.7 },
    },
  ];

  for (const { label, actions, expected } of cases) {
    assert.deepEqual(round({ state, actions }).written, expected, label);
  }
});

test('invalid exercise or sex fields leave the decremented activity unchanged', () => {
  const state = { remainingExerciseMin: 12, intensity: 0.4 };
  const invalid = [
    ['missing intensity', { durationMin: 30 }],
    ['missing duration', { intensity: 1 }],
    ['zero intensity', { intensity: 0, durationMin: 30 }],
    ['negative intensity', { intensity: -0.1, durationMin: 30 }],
    ['intensity above one', { intensity: 1.0001, durationMin: 30 }],
    ['NaN intensity', { intensity: Number.NaN, durationMin: 30 }],
    ['positive infinite intensity', { intensity: Number.POSITIVE_INFINITY, durationMin: 30 }],
    ['negative infinite intensity', { intensity: Number.NEGATIVE_INFINITY, durationMin: 30 }],
    ['string intensity', { intensity: '1', durationMin: 30 }],
    ['zero duration', { intensity: 1, durationMin: 0 }],
    ['negative duration', { intensity: 1, durationMin: -1 }],
    ['NaN duration', { intensity: 1, durationMin: Number.NaN }],
    ['positive infinite duration', { intensity: 1, durationMin: Number.POSITIVE_INFINITY }],
    ['negative infinite duration', { intensity: 1, durationMin: Number.NEGATIVE_INFINITY }],
    ['string duration', { intensity: 1, durationMin: '30' }],
  ];

  for (const type of ['exercise', 'sex']) {
    for (const [label, payload] of invalid) {
      const { written, writes } = round({ state, actions: [{ type, ...payload }] });
      assert.equal(writes.length, 1, `${type}: ${label}`);
      assert.deepEqual(written, { remainingExerciseMin: 11, intensity: 0.4 }, `${type}: ${label}`);
    }
  }
});

test('an invalid activity does not override an earlier valid one in the same round', () => {
  const state = { remainingExerciseMin: 12, intensity: 0.4 };
  const cases = [
    ['invalid exercise after exercise', [exercise(0.7, 15), exercise(0, 30)]],
    ['invalid sex after exercise', [exercise(0.7, 15), sex(0, 30)]],
    ['invalid sex after sex', [sex(0.7, 15), sex(0, 30)]],
    ['invalid exercise after sex', [sex(0.7, 15), exercise(1.5, 30)]],
  ];

  for (const [label, actions] of cases) {
    assert.deepEqual(
      round({ state, actions }).written,
      { remainingExerciseMin: 15, intensity: 0.7 },
      label,
    );
  }
});

test('actions other than exercise, sex, stop_exercise, and sleep never change the activity', () => {
  const state = { remainingExerciseMin: 12, intensity: 0.4 };
  const actions = [
    { type: 'drink', volumeMl: 240 },
    { type: 'eat', volumeMl: 300, energyKcal: 400, mealKind: 'solid' },
    { type: 'urinate' },
  ];
  assert.deepEqual(
    round({ state, actions }).written,
    { remainingExerciseMin: 11, intensity: 0.4 },
  );
});

test('stop_exercise and sleep clear ongoing exercise cleanly and respect round action order', () => {
  const state = { remainingExerciseMin: 12, intensity: 0.6 };
  const cases = [
    {
      label: 'stop_exercise clears saved activity',
      actions: [{ type: 'stop_exercise' }],
      expected: { remainingExerciseMin: 0, intensity: 0 },
    },
    {
      label: 'sleep clears saved activity',
      actions: [{ type: 'sleep' }],
      expected: { remainingExerciseMin: 0, intensity: 0 },
    },
    {
      label: 'stop_exercise clears an earlier exercise in the same round',
      actions: [exercise(0.9, 25), { type: 'stop_exercise' }],
      expected: { remainingExerciseMin: 0, intensity: 0 },
    },
    {
      label: 'sleep clears an earlier sex action in the same round',
      actions: [sex(0.8, 15), { type: 'sleep' }],
      expected: { remainingExerciseMin: 0, intensity: 0 },
    },
    {
      label: 'exercise after stop_exercise in the same round starts the new exercise',
      actions: [{ type: 'stop_exercise' }, exercise(0.5, 10)],
      expected: { remainingExerciseMin: 10, intensity: 0.5 },
    },
  ];

  for (const { label, actions, expected } of cases) {
    assert.deepEqual(round({ state, actions }).written, expected, label);
  }
  assert.deepEqual(
    round({ state: { remainingExerciseMin: 0, intensity: 0 }, actions: [{ type: 'stop_exercise' }] }).written,
    { remainingExerciseMin: 0, intensity: 0 },
    'stop_exercise at rest stays zero',
  );
});

test('activity output is finite and JSON-safe', () => {
  const cases = [
    { label: 'missing state', options: {} },
    { label: 'saved state and fractional dt', options: { state: { remainingExerciseMin: 3.5, intensity: 0.25 }, dt: 90 } },
    { label: 'finished state', options: { state: { remainingExerciseMin: 0, intensity: 0 } } },
    { label: 'valid action', options: { actions: [exercise(1, 30)] } },
    { label: 'valid sex action', options: { actions: [sex(0.8, 30)] } },
    { label: 'stop_exercise action', options: { state: { remainingExerciseMin: 4, intensity: 0.5 }, actions: [{ type: 'stop_exercise' }] } },
    { label: 'sleep action', options: { state: { remainingExerciseMin: 4, intensity: 0.5 }, actions: [{ type: 'sleep' }] } },
    { label: 'invalid action', options: { state: { remainingExerciseMin: 4, intensity: 0.5 }, actions: [exercise(0, 30)] } },
    { label: 'invalid sex action', options: { state: { remainingExerciseMin: 4, intensity: 0.5 }, actions: [sex(0, 30)] } },
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
