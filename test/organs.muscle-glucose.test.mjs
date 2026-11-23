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

function round({
  state,
  activity,
  glucose = { excessMassG: 0 },
  pancreas,
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'muscleGlucose') return state;
      if (partId === 'physicalActivity') return activity;
      if (partId === 'glucose') return glucose === null ? undefined : glucose;
      if (partId === 'pancreasEndocrine') return pancreas;
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

function expectMuscleError({
  activity,
  glucose = { excessMassG: 0 },
  pancreas,
} = {}, label) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'physicalActivity') return activity;
        if (partId === 'glucose') return glucose === null ? undefined : glucose;
        if (partId === 'pancreasEndocrine') return pancreas;
        return undefined;
      },
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

test('muscleGlucose exports the uptake, request, glycogen and consumption contract', () => {
  assert.equal(id, 'muscleGlucose');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    uptakeG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    uptakeRequestG: { unit: 'g', mode: 'absolute' },
    glycogenG: { unit: 'g', mode: 'absolute' },
    glycogenConsumedG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    uptakeG: 0,
    uptakeRequestG: 0,
    glycogenG: 0,
    glycogenConsumedG: 0,
  });

  const { written } = round();
  assert.deepEqual(written, {
    uptakeG: 0,
    uptakeRequestG: 0,
    glycogenG: 0,
    glycogenConsumedG: 0,
  });
});

test('the parameters replace the disposal share with an autonomous response', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'muscleGlucose');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId), [
    'muscleGlucose.glycogenUseRateGPerMin',
    'muscleGlucose.maxUptakeRateGPerMin',
    'muscleGlucose.halfMaxExcessG',
    'muscleGlucose.insulinSensitivity',
  ]);

  const useRate = byId['muscleGlucose.glycogenUseRateGPerMin'];
  assert.equal(useRate.value, 0.5);
  assert.equal(useRate.unit, 'g/min');
  assert.equal(useRate.status, 'design');
  assert.equal(useRate.source, null);
  assert.deepEqual(useRate.range, [0, 5]);

  const expected = {
    'muscleGlucose.maxUptakeRateGPerMin': [0.5, 'g/min', [0, 5]],
    'muscleGlucose.halfMaxExcessG': [20, 'g', [0.1, 500]],
    'muscleGlucose.insulinSensitivity': [1, '1', [0, 5]],
  };
  for (const [parameterId, [value, unit, range]] of Object.entries(expected)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
    assert.deepEqual(parameter.range, range, `${parameterId}: range`);
  }

  assert.deepEqual(loadParameters(parametersUrl), {
    'muscleGlucose.glycogenUseRateGPerMin': 0.5,
    'muscleGlucose.maxUptakeRateGPerMin': 0.5,
    'muscleGlucose.halfMaxExcessG': 20,
    'muscleGlucose.insulinSensitivity': 1,
  });
});

test('the uptake request follows the saturating excess and insulin response formula', () => {
  const baseline = round({
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 1 },
    dt: 60,
  });
  assertClose(
    baseline.written.uptakeRequestG,
    0.5 * (20 / 40),
    '20 g excess at baseline insulin over one minute',
  );

  const doubled = round({
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 2 },
    dt: 60,
  });
  assertClose(
    doubled.written.uptakeRequestG,
    0.5 * (20 / 40) * 2,
    'insulin sensitivity 1 doubles the response at relative 2',
  );

  const fractionalMinute = round({
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 2 },
    dt: 30,
  });
  assertClose(
    fractionalMinute.written.uptakeRequestG,
    0.5 * (20 / 40) * 2 * 0.5,
    'the request scales with dt',
  );

  const noExcess = round({
    glucose: { excessMassG: 0 },
    pancreas: { insulinRelative: 2 },
    dt: 60,
  });
  assert.equal(noExcess.written.uptakeRequestG, 0, 'no excess yields no request');

  const saturating = round({
    glucose: { excessMassG: 60 },
    pancreas: { insulinRelative: 1 },
    dt: 60,
  });
  assertClose(
    saturating.written.uptakeRequestG,
    0.5 * (60 / 80),
    'the half-max excess keeps the response below the maximum rate',
  );
});

test('the request is rewritten every round from the round-start snapshot', () => {
  const zeroed = round({
    state: { uptakeG: 0, uptakeRequestG: 3, glycogenG: 0, glycogenConsumedG: 0 },
    glucose: { excessMassG: 0 },
    pancreas: { insulinRelative: 1 },
  });
  assert.equal(zeroed.written.uptakeRequestG, 0, 'the old request is not carried over');

  const recomputed = round({
    state: { uptakeG: 0, uptakeRequestG: 0, glycogenG: 0, glycogenConsumedG: 0 },
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 2 },
  });
  assertClose(recomputed.written.uptakeRequestG, 0.5, 'the new request uses this round inputs');
});

test('a missing glucose or pancreas part falls back without hiding invalid loaded data', () => {
  const noGlucose = round({ glucose: null, pancreas: { insulinRelative: 1 } });
  assert.equal(noGlucose.written.uptakeRequestG, 0, 'no glucose part means no excess signal');

  const noPancreas = round({ glucose: { excessMassG: 20 }, pancreas: undefined });
  assertClose(
    noPancreas.written.uptakeRequestG,
    0.5 * (20 / 40),
    'a missing pancreas part reads baseline insulin',
  );
});

test('each round books the previous uptake into glycogen and zeroes the uptake flux', () => {
  const { written } = round({
    state: { uptakeG: 1.2, glycogenG: 10 },
  });
  assert.deepEqual(written, {
    uptakeG: 0,
    uptakeRequestG: 0,
    glycogenG: 11.2,
    glycogenConsumedG: 0,
  });
});

test('the uptake request and the transferIn flux are independent', () => {
  const { written } = round({
    state: { uptakeG: 1.2, glycogenG: 10, uptakeRequestG: 0 },
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 1 },
  });
  assert.equal(written.uptakeG, 0, 'the received flux still resets to zero');
  assertClose(written.uptakeRequestG, 0.25, 'the request comes from the upstream snapshot');
  assertClose(written.glycogenG, 11.2, 'the previous uptake still books into glycogen');
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
    uptakeRequestG: 0,
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
    expectMuscleError({ activity }, label);
  }
});

test('a loaded glucose or pancreas part with invalid fields fails with zero writes', () => {
  const invalid = [
    ['missing excess', { glucose: {} }],
    ['non-number excess', { glucose: { excessMassG: '20' } }],
    ['non-finite excess', { glucose: { excessMassG: Number.NaN } }],
    ['infinite excess', { glucose: { excessMassG: Number.POSITIVE_INFINITY } }],
    ['negative excess', { glucose: { excessMassG: -0.1 } }],
    ['missing insulin', { pancreas: {} }],
    ['non-number insulin', { pancreas: { insulinRelative: '1' } }],
    ['non-finite insulin', { pancreas: { insulinRelative: Number.NaN } }],
    ['negative insulin', { pancreas: { insulinRelative: -1 } }],
  ];

  for (const [label, parts] of invalid) {
    expectMuscleError(parts, label);
  }
});

test('muscleGlucose output is finite and JSON-safe for inactive and active rounds', () => {
  const cases = [
    { label: 'missing state and activity', options: {} },
    {
      label: 'active with an uptake request',
      options: {
        state: initialState,
        activity: active(),
        glucose: { excessMassG: 20 },
        pancreas: { insulinRelative: 2 },
      },
    },
    {
      label: 'fractional activity and dt',
      options: {
        state: { uptakeG: 1.2, glycogenG: 10, uptakeRequestG: 0.3 },
        activity: active(10, 0.37),
        glucose: { excessMassG: 7.5 },
        pancreas: { insulinRelative: 1.5 },
        dt: 90,
      },
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
