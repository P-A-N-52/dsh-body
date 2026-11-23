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
} from '../organs/human-organs/skeletal-muscle/glucose-uptake.ts';

const parametersUrl = new URL(
  '../organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json',
  import.meta.url,
);

function round({ state, activity, dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'muscleGlucose') return state;
      if (partId === 'physicalActivity') return activity;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
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

function expectMuscleError(activity, label) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => (partId === 'physicalActivity' ? activity : undefined),
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { writes.push(next); },
    }),
    Error,
    label,
  );
  assert.equal(writes.length, 0, `${label}: the round must not write`);
}

test('muscleGlucose exports the uptake, glycogen and consumption contract', () => {
  assert.equal(id, 'muscleGlucose');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    uptakeG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    glycogenG: { unit: 'g', mode: 'absolute' },
    glycogenConsumedG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    uptakeG: 0,
    glycogenG: 0,
    glycogenConsumedG: 0,
  });

  const { written } = round();
  assert.deepEqual(written, {
    uptakeG: 0,
    glycogenG: 0,
    glycogenConsumedG: 0,
  });
});

test('the glycogen use rate parameter is a design default with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'muscleGlucose');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId), [
    'muscleGlucose.glycogenUseRateGPerMin',
  ]);

  const parameter = byId['muscleGlucose.glycogenUseRateGPerMin'];
  assert.equal(parameter.value, 0.5);
  assert.equal(parameter.unit, 'g/min');
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
  assert.deepEqual(parameter.range, [0, 5]);

  assert.deepEqual(loadParameters(parametersUrl), {
    'muscleGlucose.glycogenUseRateGPerMin': 0.5,
  });
});

test('each round books the previous uptake into glycogen and zeroes the uptake flux', () => {
  const { written } = round({
    state: { uptakeG: 1.2, glycogenG: 10 },
  });
  assert.deepEqual(written, {
    uptakeG: 0,
    glycogenG: 11.2,
    glycogenConsumedG: 0,
  });
});

test('exercise consumes glycogen at the reference rate times intensity and dt', () => {
  const oneMinute = round({
    state: { uptakeG: 0, glycogenG: 10 },
    activity: active(30, 1),
    dt: 60,
  });
  assertClose(oneMinute.written.glycogenConsumedG, 0.5, 'one minute at intensity 1');
  assertClose(oneMinute.written.glycogenG, 9.5, 'glycogen after one minute');

  const twoMinutes = round({
    state: { uptakeG: 0, glycogenG: 10 },
    activity: active(30, 1),
    dt: 120,
  });
  assertClose(twoMinutes.written.glycogenConsumedG, 1, 'two minutes at intensity 1');
  assertClose(twoMinutes.written.glycogenG, 9, 'glycogen after two minutes');

  const halfMinuteLeft = round({
    state: { uptakeG: 0, glycogenG: 10 },
    activity: active(0.5, 1),
    dt: 60,
  });
  assertClose(
    halfMinuteLeft.written.glycogenConsumedG,
    0.5,
    'the last partial minute still consumes the whole dt',
  );

  const scaled = round({
    state: { uptakeG: 0, glycogenG: 10 },
    activity: active(30, 0.5),
    dt: 60,
  });
  assertClose(scaled.written.glycogenConsumedG, 0.25, 'intensity 0.5 halves the rate');
});

test('consumption is clamped to the glycogen available this round', () => {
  const { written } = round({
    state: { uptakeG: 0, glycogenG: 0.2 },
    activity: active(30, 1),
    dt: 60,
  });
  assertClose(written.glycogenConsumedG, 0.2, 'only the available glycogen is consumed');
  assert.equal(written.glycogenG, 0);
});

test('a missing physicalActivity consumes no glycogen', () => {
  const { written } = round({
    state: { uptakeG: 0.4, glycogenG: 10 },
  });
  assert.deepEqual(written, {
    uptakeG: 0,
    glycogenG: 10.4,
    glycogenConsumedG: 0,
  });
});

test('a loaded activity part with missing or invalid fields fails the round', () => {
  const invalid = [
    ['empty part', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining minutes', { intensity: 1 }],
    ['non-finite remaining minutes', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['negative remaining minutes', { remainingExerciseMin: -1, intensity: 1 }],
    ['intensity below zero', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above one', { remainingExerciseMin: 10, intensity: 1.5 }],
    ['non-finite intensity', { remainingExerciseMin: 10, intensity: Number.POSITIVE_INFINITY }],
  ];

  for (const [label, activity] of invalid) {
    expectMuscleError(activity, label);
  }
});

test('muscleGlucose output is finite and JSON-safe for inactive and active rounds', () => {
  const cases = [
    { label: 'missing state and activity', options: {} },
    { label: 'active', options: { state: initialState, activity: active() } },
    {
      label: 'fractional activity and dt',
      options: { state: { uptakeG: 1.2, glycogenG: 10 }, activity: active(10, 0.37), dt: 90 },
    },
    {
      label: 'old state and short activity',
      options: { state: { uptakeG: 0.1, glycogenG: 0.1 }, activity: active(0.5, 1) },
    },
    { label: 'finished activity', options: { state: initialState, activity: active(0, 1) } },
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
