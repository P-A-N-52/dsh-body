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

test('physicalActivity exports the activity module contract', () => {
  assert.equal(id, 'physicalActivity');
  assert.deepEqual(actionTypes, ['exercise']);
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

test('invalid exercise fields leave the decremented activity unchanged', () => {
  const state = { remainingExerciseMin: 12, intensity: 0.4 };
  const invalid = [
    ['missing intensity', { type: 'exercise', durationMin: 30 }],
    ['missing duration', { type: 'exercise', intensity: 1 }],
    ['zero intensity', exercise(0, 30)],
    ['negative intensity', exercise(-0.1, 30)],
    ['intensity above one', exercise(1.0001, 30)],
    ['NaN intensity', exercise(Number.NaN, 30)],
    ['positive infinite intensity', exercise(Number.POSITIVE_INFINITY, 30)],
    ['negative infinite intensity', exercise(Number.NEGATIVE_INFINITY, 30)],
    ['string intensity', exercise('1', 30)],
    ['zero duration', exercise(1, 0)],
    ['negative duration', exercise(1, -1)],
    ['NaN duration', exercise(1, Number.NaN)],
    ['positive infinite duration', exercise(1, Number.POSITIVE_INFINITY)],
    ['negative infinite duration', exercise(1, Number.NEGATIVE_INFINITY)],
    ['string duration', exercise(1, '30')],
  ];

  for (const [label, action] of invalid) {
    const { written, writes } = round({ state, actions: [action] });
    assert.equal(writes.length, 1, label);
    assert.deepEqual(written, { remainingExerciseMin: 11, intensity: 0.4 }, label);
  }
});

test('an invalid exercise does not override an earlier valid one in the same round', () => {
  const { written } = round({
    state: { remainingExerciseMin: 12, intensity: 0.4 },
    actions: [exercise(0.7, 15), exercise(0, 30)],
  });
  assert.deepEqual(written, { remainingExerciseMin: 15, intensity: 0.7 });
});

test('non-exercise actions never change the activity', () => {
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

test('activity output is finite and JSON-safe', () => {
  const cases = [
    { label: 'missing state', options: {} },
    { label: 'saved state and fractional dt', options: { state: { remainingExerciseMin: 3.5, intensity: 0.25 }, dt: 90 } },
    { label: 'finished state', options: { state: { remainingExerciseMin: 0, intensity: 0 } } },
    { label: 'valid action', options: { actions: [exercise(1, 30)] } },
    { label: 'invalid action', options: { state: { remainingExerciseMin: 4, intensity: 0.5 }, actions: [exercise(0, 30)] } },
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
