import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/esophagus/esophagus.ts';
import { assertJsonValue } from '../json-safe.js';

function round(state, actions = [], dt = 60) {
  let written;
  heartbeat({
    read: (partId) => (partId === 'esophagus' ? state : undefined),
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

function drink(volumeMl, extra = {}) {
  return { type: 'drink', volumeMl, ...extra };
}

function eat(volumeMl, extra = {}) {
  return { type: 'eat', volumeMl, energyKcal: 500, mealKind: 'solid', ...extra };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('esophagus exports the organ module contract', () => {
  assert.equal(id, 'esophagus');
  assert.deepEqual(actionTypes, ['eat', 'drink']);
  assert.deepEqual(fields, {
    bolusVolumeMl: { unit: 'mL', mode: 'absolute' },
    transitMin: { unit: 'min', mode: 'absolute' },
    chokingMm: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    bolusVolumeMl: 0,
    transitMin: 0,
    chokingMm: 0,
  });
});

test('the esophagus parameters are design placeholders with no source', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/esophagus/esophagus.parameters.json', import.meta.url),
    'utf8',
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  for (const [parameterId, value, unit] of [
    ['esophagus.bolusTransitMin', 0.2, 'min'],
    ['esophagus.chokeGain', 50, 'mm/1'],
    ['esophagus.referenceBolusMl', 250, 'mL'],
  ]) {
    const parameter = byId[parameterId];
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
});

test('a missing saved part falls back to the zero initial state', () => {
  assert.deepEqual(round(undefined), initialState);
  assert.deepEqual(round(undefined, []), initialState);
});

test('one drink sets a sub-threshold bolus and the transit timer', () => {
  const written = round(initialState, [drink(200)]);
  assert.equal(written.bolusVolumeMl, 200);
  assert.equal(written.transitMin, 0.2);
  assert.equal(written.chokingMm, 0);
});

test('several valid intakes in one round accumulate into one bolus', () => {
  const written = round(initialState, [drink(150), eat(150), drink(50)]);
  assert.equal(written.bolusVolumeMl, 350);
  assertClose(written.chokingMm, 20, 'choking');
});

test('a bolus above the 250 mL reference raises the choking proxy', () => {
  assert.equal(round(initialState, [drink(250)]).chokingMm, 0);
  assertClose(round(initialState, [drink(300)]).chokingMm, 10, '300 mL');
  assertClose(round(initialState, [drink(500)]).chokingMm, 50, '500 mL');
  assert.equal(round(initialState, [drink(750)]).chokingMm, 100);
  assert.equal(round(initialState, [drink(5000)]).chokingMm, 100);
});

test('the transit timer decays and the bolus clears when transit reaches zero', () => {
  const inTransit = round({ bolusVolumeMl: 500, transitMin: 0.2, chokingMm: 50 }, []);
  assert.equal(inTransit.transitMin, 0);
  assert.equal(inTransit.bolusVolumeMl, 0);
  assert.equal(inTransit.chokingMm, 0);

  const cleared = round({ bolusVolumeMl: 500, transitMin: 0, chokingMm: 50 }, [drink(300)]);
  assert.equal(cleared.bolusVolumeMl, 300);
  assertClose(cleared.chokingMm, 10, 'cleared then swallowed');
});

test('a bolus still in transit survives a shorter round', () => {
  const written = round({ bolusVolumeMl: 500, transitMin: 0.2, chokingMm: 50 }, [], 6);
  assert.equal(written.bolusVolumeMl, 500);
  assertClose(written.transitMin, 0.1, 'remaining transit');
  assertClose(written.chokingMm, 50, 'choking');
});

test('invalid intake actions are ignored', () => {
  const invalid = [
    null,
    undefined,
    {},
    { type: 'urinate' },
    drink(0),
    drink(-100),
    drink(Number.NaN),
    drink(Number.POSITIVE_INFINITY),
    drink('200'),
    drink(200, { energyKcal: -1 }),
    drink(200, { energyKcal: Number.NaN }),
    drink(200, { durationMin: -1 }),
    drink(200, { carbohydrateG: -1 }),
    { type: 'eat', volumeMl: 200, mealKind: 'solid' },
    { type: 'eat', volumeMl: 200, energyKcal: 500 },
    { type: 'eat', volumeMl: 200, energyKcal: 500, mealKind: 'paste' },
    eat(200, { energyKcal: Number.NaN }),
  ];
  for (const action of invalid) {
    assert.deepEqual(round(initialState, [action]), initialState);
  }
});

test('valid eat and drink payloads follow the stomach intake contract', () => {
  assert.equal(round(initialState, [drink(200, { energyKcal: 140, carbohydrateG: 42 })]).bolusVolumeMl, 200);
  assert.equal(round(initialState, [drink(200, { durationMin: 5 })]).bolusVolumeMl, 200);
  assert.equal(round(initialState, [eat(200, { mealKind: 'liquid' })]).bolusVolumeMl, 200);
  assert.equal(round(initialState, [eat(200, { mealKind: 'mixed' })]).bolusVolumeMl, 200);
});

test('the output stays finite and JSON-safe for corrupt state and huge intakes', () => {
  const corrupt = round({
    bolusVolumeMl: Number.NaN,
    transitMin: Number.POSITIVE_INFINITY,
    chokingMm: Number.NaN,
  }, []);
  assert.deepEqual(corrupt, initialState);
  assertJsonValue(corrupt);

  const huge = round(initialState, [drink(Number.MAX_VALUE), drink(Number.MAX_VALUE)]);
  assert.ok(Number.isFinite(huge.bolusVolumeMl));
  assert.equal(huge.chokingMm, 100);
  assertJsonValue(huge);
});
