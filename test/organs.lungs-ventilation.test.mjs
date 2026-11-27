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
  assertClose(written.tidalVolumeMl, 500, 'resting tidal volume ~500', 1e-2);
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
    assert.ok(written.tidalVolumeMl >= 500 && written.tidalVolumeMl <= 2100, label);
  }
});

test('the ventilation parameters keep expected design defaults and sources', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'lungsVentilation');

  const expected = {
    'lungsVentilation.restingTidalVolumeMl': { value: 500, unit: 'mL', source: null },
    'lungsVentilation.restingRatePerMin': { value: 12, unit: '1/min', source: null },
    'lungsVentilation.maxRatePerMin': { value: 40, unit: '1/min', source: null },
    'lungsVentilation.restingVentilationMlMin': { value: 6000, unit: 'mL/min', source: null },
    'lungsVentilation.maxVentilationMlMin': { value: 60000, unit: 'mL/min', source: null },
    'lungsVentilation.inspiredO2Fraction': { value: 0.058333, unit: '1', source: null },
    'lungsVentilation.deadSpaceFactor': { value: 1.4, unit: '1', source: null },
    'lungsVentilation.pantingGain': { value: 1500, unit: 'mL/(min·°C)', source: null },
    'lungsVentilation.deepSleepFloorFactor': { value: 0.82, unit: '1', source: null },
    'lungsVentilation.lightSleepFloorFactor': { value: 0.9, unit: '1', source: null },
    'lungsVentilation.sleepSympatheticBypassThresholdMm': { value: 20, unit: 'mm', source: null },
    'lungsVentilation.sympatheticVentilationGainMlPerMinPerMm': { value: 80, unit: 'mL/(min·mm)', source: null },
    'lungsVentilation.maxTidalVolumeMl': { value: 2100, unit: 'mL', source: 'SRC-LOE-2014' },
    'lungsVentilation.tidalScaleVentilationMlMin': { value: 30000, unit: 'mL/min', source: 'SRC-NEDER-2003' },
    'lungsVentilation.restThermalThresholdOffsetC': { value: 0.8, unit: '°C', source: 'SRC-TSUJI-2012' },
    'lungsVentilation.exercisePantingFactor': { value: 0.35, unit: '1', source: 'SRC-TSUJI-2012' },
    'lungsVentilation.sympatheticTidalCompressionFactor': { value: 0.25, unit: '1', source: null },
  };
  assert.deepEqual(
    data.parameters.map((parameter) => parameter.id),
    Object.keys(expected),
  );

  for (const [parameterId, { value, unit, source }] of Object.entries(expected)) {
    const parameter = data.parameters.find((entry) => entry.id === parameterId);
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, source, `${parameterId}: source`);
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
    assertClose(written.tidalVolumeMl, 500, label, 1e-2);
    assertClose(written.respiratoryRatePerMin, 12, label, 1e-3);
    assertClose(written.ventilationMlMin, 6000, label, 0.1);
    assertClose(written.alveolarO2MlMin, 250, `${label}: alveolar oxygen`);
  }

  const belowResting = round(demand(100)).written;
  assert.equal(belowResting.ventilationMlMin, 6000);
  assert.equal(belowResting.respiratoryRatePerMin, 12);
  assertClose(belowResting.alveolarO2MlMin, restingO2, 'below resting clamps to 6000');
});

test('rising demand raises both tidal volume and respiratory rate along Hey plot curve', () => {
  const moderate = round(demand(750)).written;
  const hard = round(demand(1250)).written;

  assert.ok(moderate.tidalVolumeMl > 900 && moderate.tidalVolumeMl < 1200, 'VT recruits first');
  assertClose(moderate.ventilationMlMin, 18000, 'moderate demand ventilation', 0.2);
  assertClose(
    moderate.respiratoryRatePerMin,
    moderate.ventilationMlMin / moderate.tidalVolumeMl,
    'moderate demand rate follows VE / VT',
    1e-6,
  );
  assertClose(moderate.alveolarO2MlMin, 750, 'moderate demand alveolar oxygen');

  assert.ok(hard.tidalVolumeMl > moderate.tidalVolumeMl && hard.tidalVolumeMl < 2100);
  assertClose(hard.ventilationMlMin, 30000, 'hard demand ventilation', 0.3);
  assertClose(
    hard.respiratoryRatePerMin,
    hard.ventilationMlMin / hard.tidalVolumeMl,
    'hard demand rate follows VE / VT',
    1e-6,
  );
  assertClose(hard.alveolarO2MlMin, 1250, 'hard demand alveolar oxygen');

  assert.ok(hard.ventilationMlMin > moderate.ventilationMlMin);
  assert.ok(hard.respiratoryRatePerMin > moderate.respiratoryRatePerMin);
  assert.ok(hard.alveolarO2MlMin > moderate.alveolarO2MlMin);
});

test('a hot core temperature adds exercise-attenuated or rest thermal panting above threshold', () => {
  const atSetpoint = round(demand(750), { coreTemperatureC: 37 }).written;
  const hotRest = round(demand(750), { coreTemperatureC: 38 }).written;
  const hotterRest = round(demand(750), { coreTemperatureC: 40 }).written;
  const cold = round(demand(750), { coreTemperatureC: 36 }).written;

  const base750 = (750 * deadSpace) / extraction;
  assertClose(atSetpoint.ventilationMlMin, base750, 'at the setpoint');
  assertClose(hotRest.ventilationMlMin, base750 + 300, 'rest threshold 37.8 C gives 0.2 * 1500');
  assertClose(
    hotRest.respiratoryRatePerMin,
    hotRest.ventilationMlMin / hotRest.tidalVolumeMl,
    'rate follows dynamic VE / VT',
  );
  assertClose(
    hotRest.alveolarO2MlMin,
    (base750 + 300) * (extraction / deadSpace),
    'alveolar oxygen follows ventilation',
  );
  assertClose(hotterRest.ventilationMlMin, base750 + 3300, '2.2 degrees above 37.8 C threshold');
  assertClose(cold.ventilationMlMin, base750, 'below the setpoint adds no panting');
});

test('resting hyperthermia crosses passive threshold above +0.8 C without false panting at +0.5 C', () => {
  const mildPostExercise = round(demand(250), { coreTemperatureC: 37.5 }).written;
  assertClose(mildPostExercise.ventilationMlMin, 6000, '37.5 C at rest does not falsely pant', 0.1);
  assertClose(mildPostExercise.respiratoryRatePerMin, 12, 'resting RR stays calm at 37.5 C', 1e-3);

  const restingHot = round(demand(250), { coreTemperatureC: 38 }).written;
  const expectedRest = (250 * deadSpace) / extraction + 300;
  assertClose(restingHot.ventilationMlMin, expectedRest, 'resting hyperthermia above 37.8 C adds 300 mL/min');
  assertClose(restingHot.respiratoryRatePerMin, restingHot.ventilationMlMin / restingHot.tidalVolumeMl, 'rate follows VE/VT');

  const lowDemandHot = round(demand(100), { coreTemperatureC: 40 }).written;
  assertClose(lowDemandHot.ventilationMlMin, 6000 + 3300, 'panting adds on top of resting floor');
  assertClose(lowDemandHot.respiratoryRatePerMin, lowDemandHot.ventilationMlMin / lowDemandHot.tidalVolumeMl);

  const capped = round(demand(2499), { coreTemperatureC: 200 }).written;
  assert.equal(capped.ventilationMlMin, 60000);
  assertClose(capped.respiratoryRatePerMin, 60000 / capped.tidalVolumeMl);
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
  assertClose(atCap.respiratoryRatePerMin, 60000 / atCap.tidalVolumeMl);
  assertClose(atCap.alveolarO2MlMin, capacityO2, 'oxygen at the ventilation cap');

  const aboveCap = round(demand(4000)).written;
  assert.equal(aboveCap.ventilationMlMin, 60000);
  assertClose(aboveCap.respiratoryRatePerMin, 60000 / aboveCap.tidalVolumeMl);
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
