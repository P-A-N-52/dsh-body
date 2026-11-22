import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters, requireParameter } from '../lib/parameters.js';

const parametersFiles = [
  { label: 'organs/human-organs/stomach/motility.parameters.json', url: new URL('../organs/human-organs/stomach/motility.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/duodenum/nutrient-exposure.parameters.json', url: new URL('../organs/human-organs/duodenum/nutrient-exposure.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/ghrelin.parameters.json', url: new URL('../organs/human-organs/stomach/ghrelin.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/gastric-sensory.parameters.json', url: new URL('../organs/human-organs/stomach/gastric-sensory.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/interoception.parameters.json', url: new URL('../organs/human-organs/brain/interoception.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/notify.parameters.json', url: new URL('../organs/human-organs/brain/notify.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/small-intestine/water-absorption.parameters.json', url: new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/body-water/water.parameters.json', url: new URL('../organs/human-compartments/body-water/water.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/skin/sweat.parameters.json', url: new URL('../organs/human-organs/skin/sweat.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/glucose/glucose.parameters.json', url: new URL('../organs/human-compartments/glucose/glucose.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/pancreas/insulin.parameters.json', url: new URL('../organs/human-organs/pancreas/insulin.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/glucose-excretion.parameters.json', url: new URL('../organs/human-organs/kidney/glucose-excretion.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/urine-production.parameters.json', url: new URL('../organs/human-organs/kidney/urine-production.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-adh.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-adh.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-thirst.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-thirst.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/bladder/storage.parameters.json', url: new URL('../organs/human-organs/bladder/storage.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-adh-di-central.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-adh-di-central.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/urine-production-di-central.parameters.json', url: new URL('../organs/human-organs/kidney/urine-production-di-central.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/urine-production-di-nephrogenic.parameters.json', url: new URL('../organs/human-organs/kidney/urine-production-di-nephrogenic.parameters.json', import.meta.url) },
];

const sourcedStatuses = new Set(['prior', 'fitted_dev', 'validated']);

function readParameters(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

for (const { label, url } of parametersFiles) {
  test(`${label}: schema, ids, unset/null and sources are consistent`, () => {
    const data = readParameters(url);
    assert.equal(data.schemaVersion, 1, 'schemaVersion must be 1');
    assert.equal(typeof data.owner, 'string', 'owner must be a string');
    assert.ok(data.owner.length > 0, 'owner must not be empty');

    const ids = data.parameters.map((parameter) => parameter.id);
    assert.equal(new Set(ids).size, ids.length, 'parameter ids must be unique');

    for (const parameter of data.parameters) {
      assert.ok(parameter.id.startsWith(`${data.owner}.`), `${parameter.id} must start with ${data.owner}.`);
      assert.equal(parameter.status === 'unset', parameter.value === null, `${parameter.id}: unset status and null value must match`);
      if (sourcedStatuses.has(parameter.status)) {
        assert.ok(typeof parameter.source === 'string' && parameter.source.length > 0, `${parameter.id} needs a source`);
      }
    }

    const values = loadParameters(url);
    assert.deepEqual(Object.keys(values).sort(), [...ids].sort());
    for (const parameter of data.parameters) {
      assert.equal(values[parameter.id], parameter.value, `${parameter.id}: loader value`);
    }
  });
}

test('small intestine declares a separate carbohydrate absorption half-time', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/small-intestine/water-absorption.parameters.json',
    import.meta.url,
  ));
  const parameter = data.parameters.find(
    (entry) => entry.id === 'smallIntestine.carbohydrateAbsorption.halfTimeMin',
  );
  assert.ok(parameter, 'smallIntestine.carbohydrateAbsorption.halfTimeMin must be declared');
  assert.equal(parameter.unit, 'min');
  assert.equal(parameter.value, 20);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
});

test('glucose parameters keep the fixed design defaults', () => {
  const data = readParameters(new URL(
    '../organs/human-compartments/glucose/glucose.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'glucose.apparentDisposalHalfTimeMin',
    'glucose.baselineConcentrationMgDl',
    'glucose.distributionVolumeDlPerKg',
    'glucose.referenceBodyMassKg',
  ]);

  assert.equal(byId['glucose.referenceBodyMassKg'].value, 75);
  assert.equal(byId['glucose.referenceBodyMassKg'].unit, 'kg');
  assert.equal(byId['glucose.referenceBodyMassKg'].status, 'design');
  assert.equal(byId['glucose.distributionVolumeDlPerKg'].value, 1.88);
  assert.equal(byId['glucose.distributionVolumeDlPerKg'].unit, 'dL/kg');
  assert.equal(byId['glucose.distributionVolumeDlPerKg'].status, 'design');
  assert.equal(byId['glucose.distributionVolumeDlPerKg'].source, 'SRC-DALLAMAN-2007');
  assert.equal(byId['glucose.baselineConcentrationMgDl'].value, 90);
  assert.equal(byId['glucose.baselineConcentrationMgDl'].unit, 'mg/dL');
  assert.equal(byId['glucose.baselineConcentrationMgDl'].status, 'design');
  assert.equal(byId['glucose.apparentDisposalHalfTimeMin'].value, 60);
  assert.equal(byId['glucose.apparentDisposalHalfTimeMin'].unit, 'min');
  assert.equal(byId['glucose.apparentDisposalHalfTimeMin'].status, 'design');
});

test('the parameter inventory covers nineteen files including pancreas, kidney glucose and skin sweat', () => {
  assert.equal(parametersFiles.length, 19);
  const labels = parametersFiles.map(({ label }) => label);
  assert.ok(labels.includes('organs/human-organs/pancreas/insulin.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/kidney/glucose-excretion.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/skin/sweat.parameters.json'));
});

test('skin sweat parameters keep the design defaults and units', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/skin/sweat.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'skin.sweat.ambientGainPerC',
    'skin.sweat.ambientTemperatureC',
    'skin.sweat.maxRateMlPerMin',
    'skin.sweat.referenceRateMlPerMin',
  ]);
  assert.equal(byId['skin.sweat.ambientTemperatureC'].value, 25);
  assert.equal(byId['skin.sweat.ambientTemperatureC'].unit, '°C');
  assert.equal(byId['skin.sweat.referenceRateMlPerMin'].value, 0.6);
  assert.equal(byId['skin.sweat.referenceRateMlPerMin'].unit, 'mL/min');
  assert.equal(byId['skin.sweat.ambientGainPerC'].value, 0.04);
  assert.equal(byId['skin.sweat.ambientGainPerC'].unit, '1/°C');
  assert.equal(byId['skin.sweat.maxRateMlPerMin'].value, 2);
  assert.equal(byId['skin.sweat.maxRateMlPerMin'].unit, 'mL/min');
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }
});

test('pancreas parameters reuse the glucose baseline and keep engineering defaults', () => {
  const glucose = readParameters(new URL(
    '../organs/human-compartments/glucose/glucose.parameters.json',
    import.meta.url,
  ));
  const glucoseById = Object.fromEntries(
    glucose.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const pancreas = readParameters(new URL(
    '../organs/human-organs/pancreas/insulin.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(
    pancreas.parameters.map((parameter) => [parameter.id, parameter]),
  );

  assert.deepEqual(Object.keys(byId).sort(), [
    'pancreasEndocrine.insulin.glucoseGainPerMgDl',
    'pancreasEndocrine.insulin.maxRelative',
    'pancreasEndocrine.insulin.responseHalfTimeMin',
    'pancreasEndocrine.referenceGlucoseMgDl',
  ]);

  const reference = byId['pancreasEndocrine.referenceGlucoseMgDl'];
  assert.equal(reference.value, glucoseById['glucose.baselineConcentrationMgDl'].value);
  assert.equal(reference.unit, 'mg/dL');
  assert.equal(reference.status, 'design');
  assert.equal(reference.source, null);

  const gain = byId['pancreasEndocrine.insulin.glucoseGainPerMgDl'];
  assert.equal(gain.value, 0.02);
  assert.equal(gain.unit, '1/(mg/dL)');
  assert.equal(gain.status, 'design');
  assert.equal(gain.source, null);

  const halfTime = byId['pancreasEndocrine.insulin.responseHalfTimeMin'];
  assert.equal(halfTime.value, 10);
  assert.equal(halfTime.unit, 'min');
  assert.equal(halfTime.status, 'design');
  assert.equal(halfTime.source, null);

  const maximum = byId['pancreasEndocrine.insulin.maxRelative'];
  assert.equal(maximum.value, 5);
  assert.equal(maximum.unit, '1');
  assert.equal(maximum.status, 'design');
  assert.equal(maximum.source, null);
});

test('kidney glucose parameters reuse the glucose body and carry the Dalla Man priors', () => {
  const glucose = readParameters(new URL(
    '../organs/human-compartments/glucose/glucose.parameters.json',
    import.meta.url,
  ));
  const glucoseById = Object.fromEntries(
    glucose.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const kidney = readParameters(new URL(
    '../organs/human-organs/kidney/glucose-excretion.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(
    kidney.parameters.map((parameter) => [parameter.id, parameter]),
  );

  assert.deepEqual(Object.keys(byId).sort(), [
    'kidneyGlucose.distributionVolumeDlPerKg',
    'kidneyGlucose.filtrationRatePerMin',
    'kidneyGlucose.referenceBodyMassKg',
    'kidneyGlucose.renalThresholdMgKg',
  ]);

  const filtration = byId['kidneyGlucose.filtrationRatePerMin'];
  assert.equal(filtration.value, 0.0005);
  assert.equal(filtration.unit, 'min^-1');
  assert.equal(filtration.status, 'prior');
  assert.equal(filtration.source, 'SRC-DALLAMAN-2007');

  const threshold = byId['kidneyGlucose.renalThresholdMgKg'];
  assert.equal(threshold.value, 339);
  assert.equal(threshold.unit, 'mg/kg');
  assert.equal(threshold.status, 'prior');
  assert.equal(threshold.source, 'SRC-DALLAMAN-2007');

  const volume = byId['kidneyGlucose.distributionVolumeDlPerKg'];
  assert.equal(volume.value, glucoseById['glucose.distributionVolumeDlPerKg'].value);
  assert.equal(volume.unit, 'dL/kg');
  assert.equal(volume.status, 'design');

  const bodyMass = byId['kidneyGlucose.referenceBodyMassKg'];
  assert.equal(bodyMass.value, glucoseById['glucose.referenceBodyMassKg'].value);
  assert.equal(bodyMass.unit, 'kg');
  assert.equal(bodyMass.status, 'design');
});

test('parameter ids are unique across all parameter files', () => {
  const ids = parametersFiles.flatMap(({ url }) => readParameters(url).parameters.map((parameter) => parameter.id));
  assert.equal(new Set(ids).size, ids.length, 'parameter ids must be unique across files');
});

test('requireParameter rejects missing and unset ids with the id in the message', () => {
  const values = { 'interoception.unset': null };

  assert.throws(() => requireParameter(values, 'interoception.missing'), (error) => error.message.includes('interoception.missing'));
  assert.throws(() => requireParameter(values, 'interoception.unset'), (error) => error.message.includes('interoception.unset'));
});
