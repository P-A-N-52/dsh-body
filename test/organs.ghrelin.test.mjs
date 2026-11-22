import test from 'node:test';
import assert from 'node:assert/strict';
import { fields, heartbeat, initialState } from '../organs/human-organs/stomach/ghrelin.ts';

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

test('water does not suppress ghrelin', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [{ type: 'drink', volumeMl: 240 }]);
  assert.equal(next.relativeConcentration, 1);
});

test('an energy-bearing eat suppresses to nadir', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 0.5);
});

test('a zero-energy eat does not suppress', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [
    { type: 'eat', volumeMl: 100, energyKcal: 0, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 1);
});

test('an energy-bearing drink suppresses to nadir', () => {
  const next = round({ ...initialState }, [{ type: 'drink', volumeMl: 330, energyKcal: 140 }]);
  assert.equal(next.relativeConcentration, 0.5);
});

test('a zero-energy drink does not suppress', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [
    { type: 'drink', volumeMl: 330, energyKcal: 0 },
  ]);
  assert.equal(next.relativeConcentration, 1);
});

test('a drink with negative or non-finite energy does not suppress', () => {
  for (const energyKcal of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const next = round({ ...initialState, relativeConcentration: 1 }, [
      { type: 'drink', volumeMl: 330, energyKcal },
    ]);
    assert.equal(next.relativeConcentration, 1);
  }
});

test('recovery reaches 0.75 exactly after 90 rounds', () => {
  let state = { relativeConcentration: 0.5 };
  for (let i = 0; i < 90; i++) state = round(state);
  assert.ok(Math.abs(state.relativeConcentration - 0.75) < 1e-12);
});

test('a new energy intake never raises a lower value to nadir', () => {
  const next = round({ ...initialState, relativeConcentration: 0.3 }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 0.3);
});

test('ghrelin exports the fasting clock field', () => {
  assert.deepEqual(initialState, { relativeConcentration: 1, minutesSinceEnergyIntake: 0 });
  assert.deepEqual(fields, {
    relativeConcentration: { unit: '1', mode: 'absolute' },
    minutesSinceEnergyIntake: { unit: 'min', mode: 'absolute' },
  });
});

test('missing, negative and non-finite fasting clocks fall back to zero', () => {
  const cases = [
    { relativeConcentration: 1 },
    { relativeConcentration: 1, minutesSinceEnergyIntake: -5 },
    { relativeConcentration: 1, minutesSinceEnergyIntake: Number.NaN },
    { relativeConcentration: 1, minutesSinceEnergyIntake: Number.POSITIVE_INFINITY },
    { relativeConcentration: 1, minutesSinceEnergyIntake: Number.NEGATIVE_INFINITY },
  ];

  for (const state of cases) {
    const next = round(state);
    assert.equal(next.minutesSinceEnergyIntake, 1);
    assert.equal(next.relativeConcentration, 1);
    for (const value of Object.values(next)) assert.ok(Number.isFinite(value));
  }
});

test('the fasting target holds recovery to baseline until onset', () => {
  let state = { relativeConcentration: 0.5, minutesSinceEnergyIntake: 0 };
  for (let i = 0; i < 180; i++) state = round(state);
  assert.equal(state.minutesSinceEnergyIntake, 180);
  assert.ok(Math.abs(state.relativeConcentration - 0.875) < 1e-12);
});

test('the fasting target starts rising at onset and stays below the peak', () => {
  const atOnset = round({ relativeConcentration: 1, minutesSinceEnergyIntake: 179 });
  assert.equal(atOnset.minutesSinceEnergyIntake, 180);
  assert.equal(atOnset.relativeConcentration, 1);

  const afterOnset = round(atOnset);
  assert.equal(afterOnset.minutesSinceEnergyIntake, 181);
  assert.ok(afterOnset.relativeConcentration > 1);
  assert.ok(afterOnset.relativeConcentration <= 1.8);
});

test('twenty hours without energy intake raises ghrelin toward the peak', () => {
  let state = { ...initialState };
  for (let i = 0; i < 1200; i++) state = round(state);
  assert.equal(state.minutesSinceEnergyIntake, 1200);
  assert.ok(state.relativeConcentration >= 1.7);
  assert.ok(state.relativeConcentration <= 1.8);
});

test('an energy intake resets the clock and suppresses in the same round only', () => {
  const suppressed = round(
    { relativeConcentration: 1.7, minutesSinceEnergyIntake: 500 },
    [{ type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' }],
  );
  assert.deepEqual(suppressed, { relativeConcentration: 0.5, minutesSinceEnergyIntake: 0 });

  const alreadyLower = round(
    { relativeConcentration: 0.3, minutesSinceEnergyIntake: 500 },
    [{ type: 'drink', volumeMl: 330, energyKcal: 140 }],
  );
  assert.deepEqual(alreadyLower, { relativeConcentration: 0.3, minutesSinceEnergyIntake: 0 });
});

test('water and non-energy actions keep the same fasting state as no action', () => {
  const control = round({ relativeConcentration: 1.2, minutesSinceEnergyIntake: 200 });
  const nonEnergyActions = [
    [{ type: 'drink', volumeMl: 240 }],
    [{ type: 'drink', volumeMl: 330, energyKcal: 0 }],
    [{ type: 'eat', volumeMl: 100, energyKcal: 0, mealKind: 'liquid' }],
    [{ type: 'drink', volumeMl: 330, energyKcal: -1 }],
    [{ type: 'drink', volumeMl: 330, energyKcal: Number.NaN }],
    [{ type: 'drink', volumeMl: 330, energyKcal: Number.POSITIVE_INFINITY }],
  ];

  for (const actions of nonEnergyActions) {
    assert.deepEqual(
      round({ relativeConcentration: 1.2, minutesSinceEnergyIntake: 200 }, actions),
      control,
    );
  }
});
