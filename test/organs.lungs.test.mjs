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
  respiratoryWaterLossRequestMl,
} from '../organs/human-organs/lungs/respiratory-water-loss.ts';

const parametersUrl = new URL(
  '../organs/human-organs/lungs/respiratory-water-loss.parameters.json',
  import.meta.url,
);

function round({ state, activity, dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'lungs') return state;
      if (partId === 'physicalActivity') return activity;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written: writes[writes.length - 1], writes, transfers };
}

function active(remainingExerciseMin = 10, intensity = 1) {
  return { remainingExerciseMin, intensity };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function expectLungError(activity, label) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => (partId === 'physicalActivity' ? activity : undefined),
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { writes.push(next); },
      transfer: () => {},
    }),
    Error,
    label,
  );
  assert.equal(writes.length, 0, `${label}: the round must not write`);
}

test('lungs exports the respiratory water loss contract without actions', () => {
  assert.equal(id, 'lungs');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    respiratoryWaterLossRequestMl: { unit: 'mL', mode: 'absolute' },
    respiratoryWaterLossMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  });
  assert.deepEqual(initialState, {
    respiratoryWaterLossRequestMl: 0,
    respiratoryWaterLossMl: 0,
  });

  const { written, transfers } = round();
  assert.deepEqual(written, {
    respiratoryWaterLossRequestMl: 0,
    respiratoryWaterLossMl: 0,
  });
  assert.deepEqual(transfers, []);
});

test('the respiratory water loss parameter is a design default with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'lungs');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId), [
    'lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin',
  ]);

  const parameter = byId['lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin'];
  assert.equal(parameter.value, 0.3);
  assert.equal(parameter.unit, 'mL/min');
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
  assert.deepEqual(parameter.range, [0, 2]);

  assert.deepEqual(loadParameters(parametersUrl), {
    'lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin': 0.3,
  });
});

test('the request is the reference rate times intensity and dt while exercise remains', () => {
  assertClose(
    respiratoryWaterLossRequestMl({ remainingExerciseMin: 10, intensity: 1, dtMin: 1 }),
    0.3,
    'intensity 1 for one minute',
  );
  assertClose(
    respiratoryWaterLossRequestMl({ remainingExerciseMin: 10, intensity: 0.5, dtMin: 1 }),
    0.15,
    'intensity 0.5',
  );
  assertClose(
    respiratoryWaterLossRequestMl({ remainingExerciseMin: 10, intensity: 1, dtMin: 0.5 }),
    0.15,
    'dt scales the request',
  );
  assert.equal(
    respiratoryWaterLossRequestMl({ remainingExerciseMin: 0, intensity: 1, dtMin: 1 }),
    0,
    'zero remaining minutes requests nothing',
  );
  assert.equal(
    respiratoryWaterLossRequestMl({ remainingExerciseMin: 0.5, intensity: 0, dtMin: 1 }),
    0,
    'zero intensity requests nothing',
  );
});

test('a missing physicalActivity requests no respiratory water loss', () => {
  const { written } = round({
    state: { respiratoryWaterLossRequestMl: 2, respiratoryWaterLossMl: 1 },
  });
  assert.deepEqual(written, {
    respiratoryWaterLossRequestMl: 0,
    respiratoryWaterLossMl: 0,
  });
});

test('the request scales with io.dt and not simulatedSeconds', () => {
  const oneMinute = round({ activity: active(), dt: 60, simulatedSeconds: 60 })
    .written.respiratoryWaterLossRequestMl;
  const twoMinutes = round({ activity: active(), dt: 120, simulatedSeconds: 60 })
    .written.respiratoryWaterLossRequestMl;
  const later = round({ activity: active(), dt: 60, simulatedSeconds: 6000 })
    .written.respiratoryWaterLossRequestMl;

  assertClose(oneMinute, 0.3, 'one minute');
  assertClose(twoMinutes, 0.6, 'two minutes');
  assertClose(later, oneMinute, 'simulatedSeconds is not elapsed time');
});

test('every write resets the actual respiratory water loss before the transfer', () => {
  const { written, transfers } = round({
    state: { respiratoryWaterLossRequestMl: 5, respiratoryWaterLossMl: 4.2 },
    activity: active(),
  });

  assert.equal(written.respiratoryWaterLossRequestMl, 0.3);
  assert.equal(written.respiratoryWaterLossMl, 0);
  assert.deepEqual(transfers, []);
});

test('a loaded activity part with missing or invalid fields fails the round', () => {
  const invalid = [
    ['empty part', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining minutes', { intensity: 1 }],
    ['non-finite remaining minutes', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['negative remaining minutes', { remainingExerciseMin: -1, intensity: 1 }],
    ['intensity below zero', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above one', { remainingExerciseMin: 10, intensity: 1.0001 }],
    ['non-finite intensity', { remainingExerciseMin: 10, intensity: Number.POSITIVE_INFINITY }],
  ];

  for (const [label, activity] of invalid) {
    expectLungError(activity, label);
  }
});

test('lungs output is finite and JSON-safe for inactive and active rounds', () => {
  const cases = [
    { label: 'missing activity', options: {} },
    { label: 'active', options: { activity: active() } },
    { label: 'fractional activity and dt', options: { activity: active(10, 0.37), dt: 90 } },
    {
      label: 'old state and short activity',
      options: {
        state: { respiratoryWaterLossRequestMl: 9, respiratoryWaterLossMl: 4 },
        activity: active(0.5, 1),
      },
    },
    { label: 'finished activity', options: { activity: active(0, 1) } },
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
