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
  sweatRequestMl,
} from '../organs/human-organs/skin/sweat.ts';

const parametersUrl = new URL(
  '../organs/human-organs/skin/sweat.parameters.json',
  import.meta.url,
);

function round({
  state,
  activity,
  thermoregulation,
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'skin') return state;
      if (partId === 'physicalActivity') return activity;
      if (partId === 'thermoregulation') return thermoregulation;
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

function expectSweatError(activity, label, thermoregulation) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'physicalActivity') return activity;
        if (partId === 'thermoregulation') return thermoregulation;
        return undefined;
      },
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

test('skin exports the sweat request and actual volume contract without actions', () => {
  assert.equal(id, 'skin');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    sweatRequestMl: { unit: 'mL', mode: 'absolute' },
    sweatVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  });
  assert.deepEqual(initialState, { sweatRequestMl: 0, sweatVolumeMl: 0 });

  const { written, transfers } = round();
  assert.deepEqual(written, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(transfers, []);
});

test('skin sweat parameters are design defaults with no measurements', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'skin');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'skin.heatGain',
    'skin.sweat.ambientGainPerC',
    'skin.sweat.ambientTemperatureC',
    'skin.sweat.maxRateMlPerMin',
    'skin.sweat.referenceRateMlPerMin',
  ]);

  const expected = [
    ['skin.sweat.ambientTemperatureC', 25, '°C'],
    ['skin.sweat.referenceRateMlPerMin', 0.6, 'mL/min'],
    ['skin.sweat.ambientGainPerC', 0.04, '1/°C'],
    ['skin.sweat.maxRateMlPerMin', 15, 'mL/min'],
    ['skin.heatGain', 5, 'mL/(min·°C)'],
  ];
  for (const [parameterId, value, unit] of expected) {
    assert.equal(byId[parameterId].value, value, parameterId);
    assert.equal(byId[parameterId].unit, unit, parameterId);
    assert.equal(byId[parameterId].status, 'design', parameterId);
    assert.equal(byId[parameterId].source, null, parameterId);
  }

  assert.deepEqual(loadParameters(parametersUrl), {
    'skin.sweat.ambientTemperatureC': 25,
    'skin.sweat.referenceRateMlPerMin': 0.6,
    'skin.sweat.ambientGainPerC': 0.04,
    'skin.sweat.maxRateMlPerMin': 15,
    'skin.heatGain': 5,
  });
});

test('the request follows the design intensity, temperature, cap and dt', () => {
  const cases = [
    {
      label: '25 C at intensity 1',
      input: { remainingExerciseMin: 10, intensity: 1, dtMin: 1, ambientTemperatureC: 25 },
      expected: 0.6,
    },
    {
      label: 'intensity 0.5 halves the request',
      input: { remainingExerciseMin: 10, intensity: 0.5, dtMin: 1, ambientTemperatureC: 25 },
      expected: 0.3,
    },
    {
      label: '35 C multiplies by 1.4',
      input: { remainingExerciseMin: 10, intensity: 1, dtMin: 1, ambientTemperatureC: 35 },
      expected: 0.84,
    },
    {
      label: 'the rate caps at 15 mL/min',
      input: {
        remainingExerciseMin: 10,
        intensity: 1,
        dtMin: 1,
        ambientTemperatureC: 100,
        coreTemperatureC: 40,
      },
      expected: 15,
    },
    {
      label: 'the cap is on the rate, not the request',
      input: {
        remainingExerciseMin: 10,
        intensity: 1,
        dtMin: 2,
        ambientTemperatureC: 100,
        coreTemperatureC: 40,
      },
      expected: 30,
    },
    {
      label: 'dt scales the request',
      input: { remainingExerciseMin: 10, intensity: 1, dtMin: 0.5, ambientTemperatureC: 25 },
      expected: 0.3,
    },
    {
      label: 'zero remaining minutes at 37 C requests nothing',
      input: { remainingExerciseMin: 0, intensity: 1, dtMin: 1, ambientTemperatureC: 25 },
      expected: 0,
    },
    {
      label: 'zero remaining minutes at 38 C triggers thermal sweating',
      input: {
        remainingExerciseMin: 0,
        intensity: 0,
        dtMin: 1,
        ambientTemperatureC: 25,
        coreTemperatureC: 38,
      },
      expected: 5,
    },
    {
      label: 'zero intensity at 37 C requests nothing',
      input: { remainingExerciseMin: 10, intensity: 0, dtMin: 1, ambientTemperatureC: 25 },
      expected: 0,
    },
    {
      label: 'the temperature factor floors at zero',
      input: { remainingExerciseMin: 10, intensity: 1, dtMin: 1, ambientTemperatureC: -25 },
      expected: 0,
    },
    {
      label: 'a 38 C core temperature adds 5 mL/min thermal sweat',
      input: {
        remainingExerciseMin: 10,
        intensity: 1,
        dtMin: 1,
        ambientTemperatureC: 25,
        coreTemperatureC: 38,
      },
      expected: 5.6,
    },
    {
      label: 'a core temperature below the setpoint does not reduce the request',
      input: {
        remainingExerciseMin: 10,
        intensity: 1,
        dtMin: 1,
        ambientTemperatureC: 25,
        coreTemperatureC: 35,
      },
      expected: 0.6,
    },
  ];

  for (const { label, input, expected } of cases) {
    assertClose(sweatRequestMl(input), expected, label);
  }
});

test('a missing physicalActivity requests no sweat at 37 C, but sweats when coreTemperatureC > 37', () => {
  const { written } = round({
    state: { sweatRequestMl: 2, sweatVolumeMl: 1 },
  });
  assert.deepEqual(written, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(
    round({ state: {} }).written,
    { sweatRequestMl: 0, sweatVolumeMl: 0 },
  );

  const hyperthermicRest = round({
    thermoregulation: { coreTemperatureC: 38.5 },
  }).written;
  assertClose(hyperthermicRest.sweatRequestMl, 7.5, 'resting hyperthermia sweats');
  assert.equal(hyperthermicRest.sweatVolumeMl, 0);
});

test('25 C and intensity 1 request 0.6 mL in a 60 s round', () => {
  const { written } = round({ activity: active(), dt: 60 });
  assert.deepEqual(written, { sweatRequestMl: 0.6, sweatVolumeMl: 0 });

  const half = round({ activity: active(10, 0.5), dt: 60 }).written;
  assertClose(half.sweatRequestMl, 0.3, 'half intensity');
});

test('a hot core temperature adds thermal sweat rate, cold does not', () => {
  const atSetpoint = round({
    activity: active(),
    thermoregulation: { coreTemperatureC: 37 },
  }).written;
  const hot = round({
    activity: active(),
    thermoregulation: { coreTemperatureC: 38 },
  }).written;
  const hotter = round({
    activity: active(),
    thermoregulation: { coreTemperatureC: 39 },
  }).written;
  const extreme = round({
    activity: active(),
    thermoregulation: { coreTemperatureC: 42 },
  }).written;
  const cold = round({
    activity: active(),
    thermoregulation: { coreTemperatureC: 35 },
  }).written;

  assertClose(atSetpoint.sweatRequestMl, 0.6, 'at the setpoint');
  assertClose(hot.sweatRequestMl, 5.6, 'one degree above the setpoint');
  assertClose(hotter.sweatRequestMl, 10.6, 'two degrees above the setpoint');
  assertClose(extreme.sweatRequestMl, 15, 'capped at 15 mL/min');
  assertClose(cold.sweatRequestMl, 0.6, 'below the setpoint has no reduction');
});

test('missing thermoregulation keeps the unmultiplied request', () => {
  const missing = round({ activity: active() }).written;
  const explicit = round({
    activity: active(),
    thermoregulation: { coreTemperatureC: 37 },
  }).written;
  assert.deepEqual(missing, explicit);
  assertClose(missing.sweatRequestMl, 0.6, 'missing thermoregulation');
});

test('a loaded thermoregulation with an invalid core temperature fails without writing', () => {
  const invalid = [
    ['empty part', {}],
    ['missing temperature', { setpointC: 37 }],
    ['null temperature', { coreTemperatureC: null }],
    ['NaN temperature', { coreTemperatureC: Number.NaN }],
    ['positive infinite temperature', { coreTemperatureC: Number.POSITIVE_INFINITY }],
    ['negative infinite temperature', { coreTemperatureC: Number.NEGATIVE_INFINITY }],
    ['string temperature', { coreTemperatureC: '38' }],
    ['non-object part', 42],
  ];

  for (const [label, thermoregulation] of invalid) {
    expectSweatError(active(), label, thermoregulation);
  }
});

test('the request scales with io.dt and not simulatedSeconds', () => {
  const oneMinute = round({ activity: active(), dt: 60, simulatedSeconds: 60 })
    .written.sweatRequestMl;
  const twoMinutes = round({ activity: active(), dt: 120, simulatedSeconds: 60 })
    .written.sweatRequestMl;
  const later = round({ activity: active(), dt: 60, simulatedSeconds: 6000 })
    .written.sweatRequestMl;

  assertClose(oneMinute, 0.6, 'one minute');
  assertClose(twoMinutes, 1.2, 'two minutes');
  assertClose(later, oneMinute, 'simulatedSeconds is not elapsed time');
});

test('activity with no remaining minutes requests no sweat', () => {
  const { written } = round({ activity: active(0, 1) });
  assert.deepEqual(written, { sweatRequestMl: 0, sweatVolumeMl: 0 });
});

test('every write resets the actual sweat volume before the transfer', () => {
  const { written, transfers } = round({
    state: { sweatRequestMl: 5, sweatVolumeMl: 4.2 },
    activity: active(),
  });

  assert.equal(written.sweatRequestMl, 0.6);
  assert.equal(written.sweatVolumeMl, 0);
  assert.deepEqual(transfers, []);
});

test('a loaded activity part with missing or invalid fields fails the round', () => {
  const invalid = [
    ['empty part', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining minutes', { intensity: 1 }],
    ['NaN remaining minutes', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['positive infinite remaining minutes', { remainingExerciseMin: Number.POSITIVE_INFINITY, intensity: 1 }],
    ['negative infinite remaining minutes', { remainingExerciseMin: Number.NEGATIVE_INFINITY, intensity: 1 }],
    ['negative remaining minutes', { remainingExerciseMin: -1, intensity: 1 }],
    ['string remaining minutes', { remainingExerciseMin: '10', intensity: 1 }],
    ['NaN intensity', { remainingExerciseMin: 10, intensity: Number.NaN }],
    ['positive infinite intensity', { remainingExerciseMin: 10, intensity: Number.POSITIVE_INFINITY }],
    ['negative infinite intensity', { remainingExerciseMin: 10, intensity: Number.NEGATIVE_INFINITY }],
    ['negative intensity', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above one', { remainingExerciseMin: 10, intensity: 1.0001 }],
    ['string intensity', { remainingExerciseMin: 10, intensity: '1' }],
  ];

  for (const [label, activity] of invalid) {
    expectSweatError(activity, label);
  }
});

test('skin output is finite and JSON-safe for inactive and active rounds', () => {
  const cases = [
    { label: 'missing activity', options: {} },
    { label: 'active', options: { activity: active() } },
    { label: 'fractional activity and dt', options: { activity: active(10, 0.37), dt: 90 } },
    { label: 'old state and short activity', options: { state: { sweatRequestMl: 9, sweatVolumeMl: 4 }, activity: active(0.5, 1) } },
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
