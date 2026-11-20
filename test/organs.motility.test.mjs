import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, initialState } from '../organs/human-organs/stomach/motility.ts';

function round(state, actions = []) {
  let written;
  heartbeat({
    read: () => state,
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

test('two intakes in one round keep separate queues', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid', durationMin: 10 },
    { type: 'eat', volumeMl: 200, energyKcal: 200, mealKind: 'liquid', durationMin: 5 },
  ]);
  assert.equal(next.mealQueue.length, 2);
  assert.deepEqual(next.mealQueue.map((meal) => meal.remainingRounds), [9, 4]);
  assert.deepEqual(next.mealQueue.map((meal) => meal.rateMlPerRound), [10, 40]);
  assert.equal(next.volumeMl, 50);
});

test('queues drain independently and disappear when finished', () => {
  let state = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid', durationMin: 10 },
    { type: 'eat', volumeMl: 200, energyKcal: 200, mealKind: 'liquid', durationMin: 5 },
  ]);
  for (let i = 0; i < 5; i++) state = round(state);
  assert.equal(state.mealQueue.length, 1);
  assert.equal(state.mealQueue[0].remainingRounds, 4);
});

test('water adds volume without creating a meal', () => {
  const next = round({ ...initialState, volumeMl: 35 }, [{ type: 'drink', volumeMl: 240 }]);
  assert.equal(next.mealQueue.length, 0);
  assert.equal(next.lastIntakeAt, 60);
  assert.ok(next.volumeMl > 240);
});

test('intake mass is conserved over 200 rounds', () => {
  let state = { ...initialState };
  let emptied = 0;
  for (let i = 0; i < 200; i++) {
    state = round(state, i === 0
      ? [{ type: 'eat', volumeMl: 300, energyKcal: 300, mealKind: 'liquid', durationMin: 10 }]
      : []);
    emptied += state.emptiedMl;
  }
  assert.ok(Math.abs(emptied + state.volumeMl - 300) < 0.01);
});
