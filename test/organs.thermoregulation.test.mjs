import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heatLossKcalMin,
  heatProductionKcalMin,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/thermoregulation.ts';

const parametersUrl = new URL(
  '../organs/human-organs/brain/thermoregulation.parameters.json',
  import.meta.url,
);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

function round({ state, bloodOxygen, skin, dt = 60, writes = [] } = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'thermoregulation') return state;
      if (partId === 'bloodOxygen') return bloodOxygen;
      if (partId === 'skin') return skin;
      throw new Error(`unexpected read: ${partId}`);
    },
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
    notify: () => { throw new Error('thermoregulation must not notify'); },
    transfer: () => { throw new Error('thermoregulation must not transfer'); },
  });
  return { written: writes[writes.length - 1], writes };
}

function consumption(mlMin) {
  return { oxygenConsumptionMlMin: mlMin };
}

function sweat(ml) {
  return { sweatVolumeMl: ml };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('thermoregulation exports the core temperature contract without actions', () => {
  assert.equal(id, 'thermoregulation');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    coreTemperatureC: { unit: '°C', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { coreTemperatureC: 37 });
});

test('thermoregulation parameters are design defaults with no source', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'thermoregulation');

  const expected = {
    'thermoregulation.setpointC': { value: 37, unit: '°C' },
    'thermoregulation.ambientTemperatureC': { value: 25, unit: '°C' },
    'thermoregulation.heatCapacityKcalPerC': { value: 60, unit: 'kcal/°C' },
    'thermoregulation.metabolicFactor': { value: 0.005, unit: 'kcal/mL' },
    'thermoregulation.shiveringGain': { value: 2, unit: 'kcal/(min·°C)' },
    'thermoregulation.lossGain': { value: 0.104167, unit: 'kcal/(min·°C)' },
    'thermoregulation.evaporationKcalPerMl': { value: 0.58, unit: 'kcal/mL' },
  };
  assert.deepEqual(
    parameterFile.parameters.map((parameter) => parameter.id),
    Object.keys(expected),
  );

  for (const [parameterId, { value, unit }] of Object.entries(expected)) {
    const parameter = parameterFile.parameters.find((entry) => entry.id === parameterId);
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expected).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('heat production follows oxygen consumption and shivering below the setpoint', () => {
  assertClose(heatProductionKcalMin(250, 37), 1.25, 'basal oxygen at the setpoint');
  assertClose(heatProductionKcalMin(1000, 37), 5, '1000 mL/min oxygen');
  assertClose(heatProductionKcalMin(250, 36), 3.25, 'one degree below the setpoint');
  assertClose(heatProductionKcalMin(250, 35.5), 4.25, '1.5 degrees below the setpoint');
  assertClose(heatProductionKcalMin(250, 38), 1.25, 'no shivering above the setpoint');
  assertClose(heatProductionKcalMin(0, 36), 2, 'shivering without oxygen demand');

  const restingLoss = 0.104167 * 12;
  const basal = round({ bloodOxygen: consumption(250), skin: sweat(0) }).written;
  const doubled = round({ bloodOxygen: consumption(1000), skin: sweat(0) }).written;
  assertClose(basal.coreTemperatureC, 37 + (1.25 - restingLoss) / 60, 'basal steady state at 37 C');
  assertClose(basal.coreTemperatureC, 37, 'resting 37 C stays ~37 C', 1e-6);
  assertClose(doubled.coreTemperatureC, 37 + (5 - restingLoss) / 60, 'higher oxygen demand');
  assert.ok(doubled.coreTemperatureC > basal.coreTemperatureC, 'more oxygen consumes more heat');
});

test('sweat evaporation and the temperature gradient remove heat', () => {
  const restingLoss = 0.104167 * 12;
  assertClose(heatLossKcalMin(0, 37), restingLoss, 'gradient loss at 37 C');
  assertClose(heatLossKcalMin(10, 37), 5.8 + restingLoss, '10 mL evaporating sweat in 1 min');
  assertClose(
    heatLossKcalMin(10, 37, 0.5),
    0.58 * 20 + restingLoss,
    '10 mL evaporating sweat over 0.5 min converts to 20 mL/min',
  );
  assertClose(heatLossKcalMin(10, 37, 0), restingLoss, 'zero dt gives zero evaporation rate');
  assertClose(heatLossKcalMin(0, 25), 0, 'no gradient at the ambient temperature');
  assertClose(heatLossKcalMin(0, 20), -0.104167 * 5, 'colder ambient gains heat');

  const dry = round({ bloodOxygen: consumption(250), skin: sweat(0) }).written;
  const wet = round({ bloodOxygen: consumption(250), skin: sweat(10) }).written;
  assertClose(wet.coreTemperatureC, 37 + (1.25 - (5.8 + restingLoss)) / 60, 'evaporative cooling');
  assert.ok(wet.coreTemperatureC < dry.coreTemperatureC, 'sweat cools the body');
});

test('the core temperature integrates production minus loss over dt', () => {
  const gradientLoss = 0.104167 * (38 - 25);
  const oneMinute = round({
    state: { coreTemperatureC: 38 },
    bloodOxygen: consumption(250),
    skin: sweat(10),
  }).written;
  assertClose(oneMinute.coreTemperatureC, 38 + (1.25 - (5.8 + gradientLoss)) / 60, 'one minute');

  const halfMinute = round({
    state: { coreTemperatureC: 38 },
    bloodOxygen: consumption(250),
    skin: sweat(10),
    dt: 30,
  }).written;
  assertClose(
    halfMinute.coreTemperatureC,
    38 + 0.5 * (1.25 - (0.58 * (10 / 0.5) + gradientLoss)) / 60,
    'half a minute converts sweatVolumeMl by dtMin',
  );

  const zero = round({
    state: { coreTemperatureC: 38 },
    bloodOxygen: consumption(250),
    skin: sweat(10),
    dt: 0,
  }).written;
  assertClose(zero.coreTemperatureC, 38, 'zero dt does not move the temperature');
});

test('cold temperatures add shivering heat and hot temperatures do not', () => {
  const cold = round({
    state: { coreTemperatureC: 36 },
    bloodOxygen: consumption(0),
    skin: sweat(0),
  }).written;
  assertClose(cold.coreTemperatureC, 36 + (2 - 0.104167 * 11) / 60, 'one degree below the setpoint');

  const colder = round({
    state: { coreTemperatureC: 35.5 },
    bloodOxygen: consumption(0),
    skin: sweat(0),
  }).written;
  assertClose(colder.coreTemperatureC, 35.5 + (3 - 0.104167 * 10.5) / 60, '1.5 degrees below');

  const warm = round({
    state: { coreTemperatureC: 38 },
    bloodOxygen: consumption(0),
    skin: sweat(0),
  }).written;
  assertClose(warm.coreTemperatureC, 38 - (0.104167 * 13) / 60, 'no shivering above the setpoint');
});

test('extreme inputs clamp coreTemperatureC within [25, 45] C', () => {
  const hyper = round({
    state: { coreTemperatureC: 44.5 },
    bloodOxygen: consumption(50000),
    skin: sweat(0),
    dt: 600,
  }).written;
  assert.equal(hyper.coreTemperatureC, 45, 'clamps high temperature to 45 C');

  const hypo = round({
    state: { coreTemperatureC: 25.5 },
    bloodOxygen: consumption(0),
    skin: sweat(100),
    dt: 60,
  }).written;
  assert.equal(hypo.coreTemperatureC, 25, 'clamps low temperature to 25 C');
});

test('missing upstream parts and old state fall back without NaN', () => {
  const expected = 37 + (1.25 - 0.104167 * 12) / 60;

  assertClose(round().written.coreTemperatureC, expected, 'missing bloodOxygen and skin');
  assertClose(
    round({ bloodOxygen: consumption(250) }).written.coreTemperatureC,
    expected,
    'missing skin',
  );
  assertClose(
    round({ skin: sweat(0) }).written.coreTemperatureC,
    expected,
    'missing bloodOxygen uses the basal 250 mL/min',
  );
  assertClose(
    round({ state: {}, bloodOxygen: consumption(250), skin: sweat(0) }).written.coreTemperatureC,
    expected,
    'partial state uses the setpoint',
  );
});

test('a loaded upstream with an invalid field fails the round without writing', () => {
  const invalidBloodOxygen = [
    ['empty part', {}],
    ['null demand', { oxygenConsumptionMlMin: null }],
    ['NaN demand', { oxygenConsumptionMlMin: Number.NaN }],
    ['positive infinite demand', { oxygenConsumptionMlMin: Number.POSITIVE_INFINITY }],
    ['negative infinite demand', { oxygenConsumptionMlMin: Number.NEGATIVE_INFINITY }],
    ['negative demand', { oxygenConsumptionMlMin: -1 }],
    ['string demand', { oxygenConsumptionMlMin: '250' }],
  ];
  for (const [label, bloodOxygen] of invalidBloodOxygen) {
    const writes = [];
    assert.throws(
      () => round({ bloodOxygen, skin: sweat(0), writes }),
      Error,
      `bloodOxygen ${label}`,
    );
    assert.equal(writes.length, 0, `bloodOxygen ${label}: the round must not write`);
  }

  const invalidSkin = [
    ['empty part', {}],
    ['null volume', { sweatVolumeMl: null }],
    ['NaN volume', { sweatVolumeMl: Number.NaN }],
    ['positive infinite volume', { sweatVolumeMl: Number.POSITIVE_INFINITY }],
    ['negative infinite volume', { sweatVolumeMl: Number.NEGATIVE_INFINITY }],
    ['negative volume', { sweatVolumeMl: -0.1 }],
    ['string volume', { sweatVolumeMl: '1.2' }],
  ];
  for (const [label, skin] of invalidSkin) {
    const writes = [];
    assert.throws(
      () => round({ bloodOxygen: consumption(250), skin, writes }),
      Error,
      `skin ${label}`,
    );
    assert.equal(writes.length, 0, `skin ${label}: the round must not write`);
  }
});

test('core temperature output is finite and JSON-safe', () => {
  const cases = [
    ['missing parts', {}],
    ['basal', { bloodOxygen: consumption(250), skin: sweat(0) }],
    ['hot', { state: { coreTemperatureC: 39 }, bloodOxygen: consumption(2000), skin: sweat(20) }],
    ['cold', { state: { coreTemperatureC: 35 }, bloodOxygen: consumption(0), skin: sweat(0) }],
    ['fractional', { bloodOxygen: consumption(1234.5), skin: sweat(2.25), dt: 90 }],
  ];

  for (const [label, options] of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    assert.ok(Number.isFinite(written.coreTemperatureC), `${label}: must be finite`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }

  assertJsonValue(initialState);
});
