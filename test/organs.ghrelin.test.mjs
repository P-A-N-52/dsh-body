import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, initialState } from '../organs/human-organs/stomach/ghrelin.ts';

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
