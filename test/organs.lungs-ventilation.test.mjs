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
} from '../organs/human-organs/lungs/ventilation.ts';

const parametersUrl = new URL(
  '../organs/human-organs/lungs/ventilation.parameters.json',
  import.meta.url,
);

function round(bloodOxygen, thermoregulation) {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'bloodOxygen') return bloodOxygen;
      if (partId === 'thermoregulation') return thermoregulation;
      return undefined;
    },
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function demand(value) {
  return { oxygenConsumptionMlMin: value };
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

const extraction = 0.058333;
const deadSpace = 1.4;
const capacityO2 = 60000 * (extraction / deadSpace);
const restingO2 = 6000 * (extraction / deadSpace);

test('lungsVentilation exports the automatic ventilation contract without actions', () => {
  assert.equal(id, 'lungsVentilation');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    tidalVolumeMl: { unit: 'mL', mode: 'absolute' },
    respiratoryRatePerMin: { unit: '1/min', mode: 'absolute' },
    ventilationMlMin: { unit: 'mL/min', mode: 'absolute' },
    alveolarO2MlMin: { unit: 'mL/min', mode: 'absolute' },
    alveolarO2CapacityMlMin: { unit: 'mL/min', mode: 'absolute' },
  });
  assert.equal(initialState.tidalVolumeMl, 500);
  assert.equal(initialState.respiratoryRatePerMin, 12);
  assert.equal(initialState.ventilationMlMin, 6000);
  assertClose(initialState.alveolarO2MlMin, restingO2, 'initial alveolar oxygen');
  assertClose(initialState.alveolarO2CapacityMlMin, capacityO2, 'initial alveolar capacity');
  assertClose(initialState.alveolarO2CapacityMlMin, 2500, 'capacity matches ~2500 mL/min VO2max', 0.1);

  const { written, writes } = round(demand(250));
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(written).sort(), Object.keys(fields).sort());
  assert.equal(written.tidalVolumeMl, 500);
  assertClose(written.respiratoryRatePerMin, 12, 'resting rate ~12', 1e-3);
  assertClose(written.ventilationMlMin, 6000, 'resting ventilation ~6000', 0.1);
  assertClose(written.alveolarO2MlMin, 250, 'resting alveolar oxygen');
  assertClose(written.alveolarO2CapacityMlMin, capacityO2, 'capacity');
});

test('alveolar oxygen capacity is ~2500 mL/min independent of demand', () => {
  const cases = [
    ['basal fallback', undefined],
    ['zero demand', demand(0)],
    ['resting demand', demand(250)],
    ['at the capacity', demand(capacityO2)],
    ['above the capacity', demand(4000)],
  ];

  for (const [label, reading] of cases) {
    const { written } = round(reading);
    assertClose(written.alveolarO2CapacityMlMin, capacityO2, label);
    assert.equal(written.tidalVolumeMl, 500, label);
  }
});

test('the ventilation parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'lungsVentilation');

  const expected = {
    'lungsVentilation.restingTidalVolumeMl': { value: 500, unit: 'mL' },
    'lungsVentilation.restingRatePerMin': { value: 12, unit: '1/min' },
    'lungsVentilation.maxRatePerMin': { value: 40, unit: '1/min' },
    'lungsVentilation.restingVentilationMlMin': { value: 6000, unit: 'mL/min' },
    'lungsVentilation.maxVentilationMlMin': { value: 60000, unit: 'mL/min' },
    'lungsVentilation.inspiredO2Fraction': { value: 0.058333, unit: '1' },
    'lungsVentilation.deadSpaceFactor': { value: 1.4, unit: '1' },
    'lungsVentilation.pantingGain': { value: 1500, unit: 'mL/(min·°C)' },
  };
  assert.deepEqual(
    data.parameters.map((parameter) => parameter.id),
    Object.keys(expected),
  );

  for (const [parameterId, { value, unit }] of Object.entries(expected)) {
    const parameter = data.parameters.find((entry) => entry.id === parameterId);
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

test('a missing bloodOxygen part falls back to basal demand and resting ventilation', () => {
  for (const [label, reading] of [
    ['missing part', undefined],
    ['explicit basal demand', demand(250)],
  ]) {
    const { written, writes } = round(reading);
    assert.equal(writes.length, 1, label);
    assert.equal(written.tidalVolumeMl, 500, label);
    assertClose(written.respiratoryRatePerMin, 12, label, 1e-3);
    assertClose(written.ventilationMlMin, 6000, label, 0.1);
    assertClose(written.alveolarO2MlMin, 250, `${label}: alveolar oxygen`);
  }

  const belowResting = round(demand(100)).written;
  assert.equal(belowResting.ventilationMlMin, 6000);
  assert.equal(belowResting.respiratoryRatePerMin, 12);
  assertClose(belowResting.alveolarO2MlMin, restingO2, 'below resting clamps to 6000');
});

test('rising demand raises ventilation and respiratory rate above resting without a dead-zone', () => {
  const moderate = round(demand(750)).written;
  const hard = round(demand(1250)).written;

  assert.equal(moderate.tidalVolumeMl, 500);
  assertClose(moderate.ventilationMlMin, 18000, 'moderate demand ventilation', 0.2);
  assertClose(moderate.respiratoryRatePerMin, 36, 'moderate demand rate', 1e-3);
  assertClose(moderate.alveolarO2MlMin, 750, 'moderate demand alveolar oxygen');

  assert.equal(hard.tidalVolumeMl, 500);
  assertClose(hard.ventilationMlMin, 30000, 'hard demand ventilation', 0.3);
  assert.equal(hard.respiratoryRatePerMin, 40, 'hard demand clamps RR at 40');
  assertClose(hard.alveolarO2MlMin, 1250, 'hard demand alveolar oxygen');

  assert.ok(hard.ventilationMlMin > moderate.ventilationMlMin);
  assert.ok(hard.alveolarO2MlMin > moderate.alveolarO2MlMin);
});

test('a hot core temperature adds the panting term on top of max(resting, metabolic) ventilation', () => {
  const atSetpoint = round(demand(750), { coreTemperatureC: 37 }).written;
  const hot = round(demand(750), { coreTemperatureC: 38 }).written;
  const hotter = round(demand(750), { coreTemperatureC: 40 }).written;
  const cold = round(demand(750), { coreTemperatureC: 36 }).written;

  const base750 = (750 * deadSpace) / extraction;
  assertClose(atSetpoint.ventilationMlMin, base750, 'at the setpoint');
  assertClose(hot.ventilationMlMin, base750 + 1500, 'one degree above the setpoint');
  assertClose(hot.respiratoryRatePerMin, (base750 + 1500) / 500, 'rate follows the panting target');
  assertClose(
    hot.alveolarO2MlMin,
    (base750 + 1500) * (extraction / deadSpace),
    'alveolar oxygen follows ventilation',
  );
  assertClose(hotter.ventilationMlMin, base750 + 4500, 'three degrees above the setpoint');
  assertClose(cold.ventilationMlMin, base750, 'below the setpoint adds no panting');
});

test('resting hyperthermia immediately raises ventilation and respiratory rate above resting', () => {
  const restingHot = round(demand(250), { coreTemperatureC: 38 }).written;
  const expectedRest = (250 * deadSpace) / extraction + 1500;
  assertClose(restingHot.ventilationMlMin, expectedRest, 'resting hyperthermia adds 1500 mL/min');
  assertClose(restingHot.respiratoryRatePerMin, expectedRest / 500, 'resting hyperthermia raises RR to ~15');

  const lowDemandHot = round(demand(100), { coreTemperatureC: 40 }).written;
  assert.equal(lowDemandHot.ventilationMlMin, 6000 + 4500, 'panting adds on top of resting floor');
  assert.equal(lowDemandHot.respiratoryRatePerMin, (6000 + 4500) / 500);

  const capped = round(demand(2499), { coreTemperatureC: 200 }).written;
  assert.equal(capped.ventilationMlMin, 60000);
  assert.equal(capped.respiratoryRatePerMin, 40);
});

test('missing thermoregulation adds no panting term', () => {
  assert.deepEqual(
    round(demand(750)).written,
    round(demand(750), { coreTemperatureC: 37 }).written,
  );
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
  ];

  for (const [label, thermoregulation] of invalid) {
    const writes = [];
    assert.throws(
      () => heartbeat({
        read: (partId) => {
          if (partId === 'bloodOxygen') return demand(750);
          if (partId === 'thermoregulation') return thermoregulation;
          return undefined;
        },
        write: (next) => { writes.push(next); },
      }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('hitting maxVentilationMlMin caps alveolar oxygen supply', () => {
  const atCap = round(demand(capacityO2)).written;
  assert.equal(atCap.ventilationMlMin, 60000);
  assert.equal(atCap.respiratoryRatePerMin, 40);
  assertClose(atCap.alveolarO2MlMin, capacityO2, 'oxygen at the ventilation cap');

  const aboveCap = round(demand(4000)).written;
  assert.equal(aboveCap.ventilationMlMin, 60000);
  assert.equal(aboveCap.respiratoryRatePerMin, 40);
  assertClose(aboveCap.alveolarO2MlMin, capacityO2, 'oxygen above the ventilation cap');
  assert.ok(aboveCap.alveolarO2MlMin < 4000, 'supply stays below the unmet demand');
});

test('zero demand stays at resting ventilation without NaN', () => {
  const { written } = round(demand(0));

  assert.equal(written.tidalVolumeMl, 500);
  assert.equal(written.ventilationMlMin, 6000);
  assert.equal(written.respiratoryRatePerMin, 12);
  assertClose(written.alveolarO2MlMin, restingO2, 'zero demand alveolar oxygen');
  for (const [field, value] of Object.entries(written)) {
    assert.ok(Number.isFinite(value), `${field} must be finite`);
  }
});

test('a loaded bloodOxygen with invalid demand fails the round without writing', () => {
  const invalid = [
    ['empty part', {}],
    ['missing demand', { other: 1 }],
    ['NaN demand', { oxygenConsumptionMlMin: Number.NaN }],
    ['infinite demand', { oxygenConsumptionMlMin: Number.POSITIVE_INFINITY }],
    ['negative infinite demand', { oxygenConsumptionMlMin: Number.NEGATIVE_INFINITY }],
    ['negative demand', { oxygenConsumptionMlMin: -1 }],
    ['null demand', { oxygenConsumptionMlMin: null }],
    ['string demand', { oxygenConsumptionMlMin: '250' }],
    ['non-object part', 42],
  ];

  for (const [label, reading] of invalid) {
    const writes = [];
    assert.throws(
      () => heartbeat({
        read: (partId) => (partId === 'bloodOxygen' ? reading : undefined),
        write: (next) => { writes.push(next); },
      }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('ventilation output is finite and JSON-safe', () => {
  const cases = [
    ['basal fallback', undefined],
    ['zero demand', demand(0)],
    ['below resting', demand(100)],
    ['between', demand(2000)],
    ['fractional', demand(1234.5)],
    ['at the cap', demand(9000)],
    ['above the cap', demand(12000)],
  ];

  for (const [label, reading] of cases) {
    const { written, writes } = round(reading);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }

  assertJsonValue(initialState);
});
