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

function round(bloodOxygen) {
  const writes = [];
  heartbeat({
    read: (partId) => (partId === 'bloodOxygen' ? bloodOxygen : undefined),
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
  assertClose(initialState.alveolarO2MlMin, 900, 'initial alveolar oxygen');
  assert.equal(initialState.alveolarO2CapacityMlMin, 9000);

  const { written, writes } = round(demand(250));
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(written).sort(), Object.keys(fields).sort());
  assert.equal(written.tidalVolumeMl, 500);
  assert.equal(written.respiratoryRatePerMin, 12);
  assert.equal(written.ventilationMlMin, 6000);
  assertClose(written.alveolarO2MlMin, 900, 'resting alveolar oxygen');
  assert.equal(written.alveolarO2CapacityMlMin, 9000);
});

test('alveolar oxygen capacity is 9000 mL/min independent of demand', () => {
  const cases = [
    ['basal fallback', undefined],
    ['zero demand', demand(0)],
    ['resting demand', demand(250)],
    ['at the capacity', demand(9000)],
    ['above the capacity', demand(12000)],
  ];

  for (const [label, reading] of cases) {
    const { written } = round(reading);
    assert.equal(written.alveolarO2CapacityMlMin, 9000, label);
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
    'lungsVentilation.inspiredO2Fraction': { value: 0.21, unit: '1' },
    'lungsVentilation.deadSpaceFactor': { value: 1.4, unit: '1' },
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
  const cases = [
    ['missing part', undefined],
    ['null part', null],
    ['explicit basal demand', demand(250)],
    ['demand below the resting target', demand(100)],
    ['demand at the resting target', demand(900)],
  ];

  for (const [label, reading] of cases) {
    const { written, writes } = round(reading);
    assert.equal(writes.length, 1, label);
    assert.equal(written.tidalVolumeMl, 500, label);
    assert.equal(written.respiratoryRatePerMin, 12, label);
    assert.equal(written.ventilationMlMin, 6000, label);
    assertClose(written.alveolarO2MlMin, 900, `${label}: alveolar oxygen`);
  }
});

test('rising demand raises ventilation and respiratory rate above resting', () => {
  const low = round(demand(1200)).written;
  const high = round(demand(2000)).written;

  assert.equal(low.tidalVolumeMl, 500);
  assertClose(low.ventilationMlMin, 8000, 'low demand ventilation');
  assertClose(low.respiratoryRatePerMin, 16, 'low demand rate');
  assertClose(low.alveolarO2MlMin, 1200, 'low demand alveolar oxygen');

  assert.equal(high.tidalVolumeMl, 500);
  assertClose(high.ventilationMlMin, 13333.333333333334, 'high demand ventilation');
  assertClose(high.respiratoryRatePerMin, 26.666666666666668, 'high demand rate');
  assertClose(high.alveolarO2MlMin, 2000, 'high demand alveolar oxygen');

  assert.ok(high.ventilationMlMin > low.ventilationMlMin);
  assert.ok(high.respiratoryRatePerMin > low.respiratoryRatePerMin);
  assert.ok(high.alveolarO2MlMin > low.alveolarO2MlMin);
});

test('hitting maxVentilationMlMin caps alveolar oxygen supply', () => {
  const atCap = round(demand(9000)).written;
  assert.equal(atCap.ventilationMlMin, 60000);
  assert.equal(atCap.respiratoryRatePerMin, 40);
  assertClose(atCap.alveolarO2MlMin, 9000, 'oxygen at the ventilation cap');

  const aboveCap = round(demand(12000)).written;
  assert.equal(aboveCap.ventilationMlMin, 60000);
  assert.equal(aboveCap.respiratoryRatePerMin, 40);
  assertClose(aboveCap.alveolarO2MlMin, 9000, 'oxygen above the ventilation cap');
  assert.ok(aboveCap.alveolarO2MlMin < 12000, 'supply stays below the unmet demand');
});

test('zero demand stays at resting ventilation without NaN', () => {
  const { written } = round(demand(0));

  assert.equal(written.tidalVolumeMl, 500);
  assert.equal(written.ventilationMlMin, 6000);
  assert.equal(written.respiratoryRatePerMin, 12);
  assertClose(written.alveolarO2MlMin, 900, 'zero demand alveolar oxygen');
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
