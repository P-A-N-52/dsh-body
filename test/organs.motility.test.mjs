import test from 'node:test';
import assert from 'node:assert/strict';
import { fields, heartbeat, initialState } from '../organs/human-organs/stomach/motility.ts';
import {
  heartbeat as hydrationHeartbeat,
  initialState as hydrationInitialState,
} from '../organs/human-organs/stomach/hydration.ts';

function hydrationRound(state, actions = []) {
  let written;
  const transfers = [];
  hydrationHeartbeat({
    read: () => state,
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => { transfers.push(args); },
  });
  return { state: written, transfers };
}

function withoutWaterMetadata(state) {
  return {
    ...state,
    mealQueue: state.mealQueue.map(({ remainingWaterMl, rateWaterMl, ...meal }) => meal),
  };
}

function assertNoWaterMetadata(state) {
  for (const meal of state.mealQueue) {
    assert.equal(Object.hasOwn(meal, 'remainingWaterMl'), false);
    assert.equal(Object.hasOwn(meal, 'rateWaterMl'), false);
  }
}

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

test('an energy-bearing drink counts volume and energy', () => {
  const next = round({ ...initialState }, [{ type: 'drink', volumeMl: 330, energyKcal: 140 }]);
  assert.equal(next.mealQueue.length, 0);
  assert.equal(next.lastIntakeAt, 60);
  assert.equal(next.volumeMl, 330);
  assert.equal(next.energyKcal, 140);
});

test('a zero-energy drink adds volume but no energy', () => {
  const withZero = round({ ...initialState }, [{ type: 'drink', volumeMl: 240, energyKcal: 0 }]);
  assert.equal(withZero.volumeMl, 240);
  assert.equal(withZero.energyKcal, 0);
  const withoutEnergy = round({ ...initialState }, [{ type: 'drink', volumeMl: 240 }]);
  assert.equal(withoutEnergy.volumeMl, 240);
  assert.equal(withoutEnergy.energyKcal, 0);
});

test('a drink with negative or non-finite energy is ignored entirely', () => {
  for (const energyKcal of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const next = round({ ...initialState }, [{ type: 'drink', volumeMl: 330, energyKcal }]);
    assert.equal(next.volumeMl, 0);
    assert.equal(next.energyKcal, 0);
    assert.equal(next.lastIntakeAt, null);
  }
});

test('drink volume and energy are conserved over 200 rounds', () => {
  let state = { ...initialState };
  let emptiedMl = 0;
  let emptiedKcal = 0;
  for (let i = 0; i < 200; i++) {
    state = round(state, i === 0 ? [{ type: 'drink', volumeMl: 330, energyKcal: 140 }] : []);
    emptiedMl += state.emptiedMl;
    emptiedKcal += state.emptiedKcal;
  }
  assert.ok(Math.abs(emptiedMl + state.volumeMl - 330) < 0.01);
  assert.ok(Math.abs(emptiedKcal + state.energyKcal - 140) < 0.01);
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

test('a solid meal starts its subtotal with the first slice and empties nothing', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 300, energyKcal: 200, mealKind: 'solid', durationMin: 3 },
  ]);
  assert.equal(next.solidVolumeMl, 100);
  assert.equal(next.solidEnergyKcal, 200 / 3);
  assert.equal(next.volumeMl, 100);
  assert.equal(next.energyKcal, 200 / 3);
  assert.equal(next.emptiedMl, 0);
  assert.equal(next.emptiedKcal, 0);
  assert.equal(next.mealQueue.length, 1);
  assert.equal(next.mealQueue[0].mealKind, 'solid');
});

test('interleaved solid, water and mixed conserve both groups every round', () => {
  const solidRetained = 2 ** (-1 / 68.7);
  const nonSolidHalfTime = (volumeMl, energyKcal) =>
    13 + 53.75 * (volumeMl > 0 ? energyKcal / volumeMl : 0);
  let emptiedMl = 0;
  let emptiedKcal = 0;
  let intakeMl = 0;
  let intakeKcal = 0;

  function settle(next, roundIntakeMl, roundIntakeKcal) {
    emptiedMl += next.emptiedMl;
    emptiedKcal += next.emptiedKcal;
    intakeMl += roundIntakeMl;
    intakeKcal += roundIntakeKcal;
    const pendingMl = next.mealQueue.reduce((sum, meal) => sum + meal.remainingMl, 0);
    const pendingKcal = next.mealQueue.reduce((sum, meal) => sum + meal.remainingKcal, 0);
    assert.ok(Math.abs(emptiedMl + next.volumeMl + pendingMl - intakeMl) < 1e-6);
    assert.ok(Math.abs(emptiedKcal + next.energyKcal + pendingKcal - intakeKcal) < 1e-6);
    return next;
  }

  let state = settle(round({ ...initialState }, [
    { type: 'eat', volumeMl: 300, energyKcal: 200, mealKind: 'solid', durationMin: 3 },
  ]), 300, 200);

  const firstRoundMl = state.volumeMl;
  const firstRoundKcal = state.energyKcal;
  state = settle(round(state, [
    { type: 'drink', volumeMl: 240, energyKcal: 0 },
    { type: 'eat', volumeMl: 200, energyKcal: 100, mealKind: 'mixed', durationMin: 1 },
  ]), 440, 100);
  assert.ok(Math.abs(state.solidVolumeMl - 100 * (solidRetained + 1)) < 1e-9);
  assert.ok(Math.abs(state.solidEnergyKcal - (200 / 3) * (solidRetained + 1)) < 1e-9);
  assert.ok(Math.abs(state.volumeMl + state.emptiedMl - (firstRoundMl + 100 + 240 + 200)) < 1e-6);
  assert.ok(Math.abs(state.energyKcal + state.emptiedKcal - (firstRoundKcal + 200 / 3 + 100)) < 1e-6);

  const thirdRoundStart = state;
  state = settle(round(state), 0, 0);
  assert.ok(Math.abs(state.solidVolumeMl - (thirdRoundStart.solidVolumeMl * solidRetained + 100)) < 1e-9);
  assert.ok(Math.abs(state.solidEnergyKcal - (thirdRoundStart.solidEnergyKcal * solidRetained + 200 / 3)) < 1e-9);
  assert.equal(state.mealQueue.length, 0);

  const fourthRoundStart = state;
  const nonSolidVolumeMl = fourthRoundStart.volumeMl - fourthRoundStart.solidVolumeMl;
  const nonSolidEnergyKcal = fourthRoundStart.energyKcal - fourthRoundStart.solidEnergyKcal;
  const nonSolidDensity = nonSolidEnergyKcal / nonSolidVolumeMl;
  const nonSolidEmptiedMl = nonSolidVolumeMl * (1 - 2 ** (-1 / nonSolidHalfTime(nonSolidVolumeMl, nonSolidEnergyKcal)));
  state = settle(round(state), 0, 0);
  assert.equal(state.mealQueue.length, 0);
  assert.ok(Math.abs(state.solidVolumeMl - fourthRoundStart.solidVolumeMl * solidRetained) < 1e-9);
  assert.ok(Math.abs(state.solidEnergyKcal - fourthRoundStart.solidEnergyKcal * solidRetained) < 1e-9);
  assert.ok(Math.abs(state.emptiedMl - (fourthRoundStart.solidVolumeMl * (1 - solidRetained) + nonSolidEmptiedMl)) < 1e-9);
  assert.ok(Math.abs(state.emptiedKcal - (fourthRoundStart.solidEnergyKcal * (1 - solidRetained) + nonSolidEmptiedMl * nonSolidDensity)) < 1e-9);
});

test('an old state without solid subtotals follows the original liquid curve', () => {
  const old = {
    volumeMl: 240,
    energyKcal: 0,
    emptiedMl: 0,
    emptiedKcal: 0,
    lastIntakeAt: null,
    mealQueue: [],
  };
  const next = round(old);
  assert.ok(Math.abs(next.volumeMl - 240 * 2 ** (-1 / 13)) < 1e-9);
  assert.equal(next.solidVolumeMl, 0);
  assert.equal(next.solidEnergyKcal, 0);
});

test('the legacy entry keeps the pre-water state shape and declares no transfers', () => {
  assert.equal(Object.hasOwn(initialState, 'waterVolumeMl'), false);
  assert.equal(Object.hasOwn(initialState, 'emptiedWaterMl'), false);
  for (const declaration of Object.values(fields)) {
    assert.equal(Object.hasOwn(declaration, 'transferOut'), false);
    assert.equal(Object.hasOwn(declaration, 'transferIn'), false);
  }
});

test('the legacy entry does not add water metadata to queued drinks', () => {
  const next = round({ ...initialState }, [{ type: 'drink', volumeMl: 240, durationMin: 3 }]);
  assert.equal(next.volumeMl, 80);
  assert.equal(next.mealQueue.length, 1);
  assert.equal(next.mealQueue[0].remainingRounds, 2);
  assert.equal(Object.hasOwn(next.mealQueue[0], 'remainingWaterMl'), false);
  assert.equal(Object.hasOwn(next.mealQueue[0], 'rateWaterMl'), false);
});

test('the legacy entry strips water metadata from a hydration queue as it advances', () => {
  const hydrated = hydrationRound(hydrationInitialState, [
    { type: 'drink', volumeMl: 240, durationMin: 3 },
  ]).state;
  assert.equal(hydrated.mealQueue.length, 1);
  assert.equal(hydrated.mealQueue[0].remainingWaterMl, 160);
  assert.equal(hydrated.mealQueue[0].rateWaterMl, 80);

  const control = round(withoutWaterMetadata(hydrated));
  const next = round(hydrated);

  assertNoWaterMetadata(next);
  assert.deepEqual(next, control);
  assert.equal(next.volumeMl, control.volumeMl);
  assert.equal(next.energyKcal, control.energyKcal);
  assert.equal(next.emptiedMl, control.emptiedMl);
  assert.equal(next.emptiedKcal, control.emptiedKcal);
  assert.equal(next.mealQueue.length, 1);
  assert.equal(next.mealQueue[0].remainingMl, 80);
  assert.equal(next.mealQueue[0].remainingRounds, 1);
});

test('the legacy entry strips queue water metadata while accepting new drinks', () => {
  const hydrated = hydrationRound(hydrationInitialState, [
    { type: 'drink', volumeMl: 240, durationMin: 3 },
  ]).state;
  const actions = [{ type: 'drink', volumeMl: 120, durationMin: 2 }];

  const control = round(withoutWaterMetadata(hydrated), actions);
  const next = round(hydrated, actions);

  assertNoWaterMetadata(next);
  assert.deepEqual(next, control);
  assert.equal(next.volumeMl, control.volumeMl);
  assert.equal(next.energyKcal, control.energyKcal);
  assert.equal(next.mealQueue.length, 2);

  let drained = next;
  for (let i = 0; i < 2; i++) {
    drained = round(drained);
    assertNoWaterMetadata(drained);
  }
  assert.equal(drained.mealQueue.length, 0);
});
