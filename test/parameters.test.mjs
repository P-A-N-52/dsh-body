import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters, requireParameter } from '../lib/parameters.js';

const parametersFiles = [
  { label: 'organs/human-organs/stomach/motility.parameters.json', url: new URL('../organs/human-organs/stomach/motility.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/duodenum/nutrient-exposure.parameters.json', url: new URL('../organs/human-organs/duodenum/nutrient-exposure.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/salivary-glands/saliva.parameters.json', url: new URL('../organs/human-organs/salivary-glands/saliva.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/ghrelin.parameters.json', url: new URL('../organs/human-organs/stomach/ghrelin.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/gastric-sensory.parameters.json', url: new URL('../organs/human-organs/stomach/gastric-sensory.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/interoception.parameters.json', url: new URL('../organs/human-organs/brain/interoception.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/notify.parameters.json', url: new URL('../organs/human-organs/brain/notify.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/small-intestine/water-absorption.parameters.json', url: new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/body-water/water.parameters.json', url: new URL('../organs/human-compartments/body-water/water.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/blood-oxygen/oxygen.parameters.json', url: new URL('../organs/human-compartments/blood-oxygen/oxygen.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/skin/sweat.parameters.json', url: new URL('../organs/human-organs/skin/sweat.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/lungs/respiratory-water-loss.parameters.json', url: new URL('../organs/human-organs/lungs/respiratory-water-loss.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/lungs/ventilation.parameters.json', url: new URL('../organs/human-organs/lungs/ventilation.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/glucose/glucose.parameters.json', url: new URL('../organs/human-compartments/glucose/glucose.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/liver/glycogen.parameters.json', url: new URL('../organs/human-organs/liver/glycogen.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json', url: new URL('../organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/pancreas/insulin.parameters.json', url: new URL('../organs/human-organs/pancreas/insulin.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/glucose-excretion.parameters.json', url: new URL('../organs/human-organs/kidney/glucose-excretion.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/urine-production.parameters.json', url: new URL('../organs/human-organs/kidney/urine-production.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-adh.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-adh.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-thirst.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-thirst.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-endocrine.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-endocrine.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/pituitary.parameters.json', url: new URL('../organs/human-organs/brain/pituitary.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/thyroid/thyroid.parameters.json', url: new URL('../organs/human-organs/thyroid/thyroid.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/adrenal/cortisol.parameters.json', url: new URL('../organs/human-organs/adrenal/cortisol.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/pineal/melatonin.parameters.json', url: new URL('../organs/human-organs/pineal/melatonin.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/bladder/storage.parameters.json', url: new URL('../organs/human-organs/bladder/storage.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/hypothalamus-adh-di-central.parameters.json', url: new URL('../organs/human-organs/brain/hypothalamus-adh-di-central.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/urine-production-di-central.parameters.json', url: new URL('../organs/human-organs/kidney/urine-production-di-central.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/urine-production-di-nephrogenic.parameters.json', url: new URL('../organs/human-organs/kidney/urine-production-di-nephrogenic.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/ovaries/menstrual-cycle.parameters.json', url: new URL('../organs/human-organs/ovaries/menstrual-cycle.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/uterus/uterus.parameters.json', url: new URL('../organs/human-organs/uterus/uterus.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/mammary-glands/milk.parameters.json', url: new URL('../organs/human-organs/mammary-glands/milk.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/sexual-response/response.parameters.json', url: new URL('../organs/human-organs/sexual-response/response.parameters.json', import.meta.url) },
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
    'glucose.baselineConcentrationMgDl',
    'glucose.distributionVolumeDlPerKg',
    'glucose.referenceBodyMassKg',
    'glucose.residualDisposalHalfTimeMin',
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
  assert.equal(byId['glucose.baselineConcentrationMgDl'].source, null);
  assert.equal(byId['glucose.residualDisposalHalfTimeMin'].value, 60);
  assert.equal(byId['glucose.residualDisposalHalfTimeMin'].unit, 'min');
  assert.equal(byId['glucose.residualDisposalHalfTimeMin'].status, 'design');
  assert.equal(byId['glucose.residualDisposalHalfTimeMin'].source, null);
  assert.deepEqual(byId['glucose.residualDisposalHalfTimeMin'].range, [10, 300]);
});

test('the parameter inventory covers thirty-four files including blood oxygen, liver glycogen, the endocrine axes, salivary glands and mammary glands', () => {
  assert.equal(parametersFiles.length, 34);
  const labels = parametersFiles.map(({ label }) => label);
  assert.ok(labels.includes('organs/human-organs/salivary-glands/saliva.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/pancreas/insulin.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/kidney/glucose-excretion.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/liver/glycogen.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/skin/sweat.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/lungs/respiratory-water-loss.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/lungs/ventilation.parameters.json'));
  assert.ok(labels.includes('organs/human-compartments/blood-oxygen/oxygen.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/ovaries/menstrual-cycle.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/uterus/uterus.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/mammary-glands/milk.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/sexual-response/response.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/brain/hypothalamus-endocrine.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/brain/pituitary.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/thyroid/thyroid.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/adrenal/cortisol.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/pineal/melatonin.parameters.json'));
});

test('endocrine parameters keep their design-only defaults', () => {
  const expected = {
    'organs/human-organs/brain/hypothalamus-endocrine.parameters.json': {
      'hypothalamusEndocrine.trhFeedbackGain': 1,
      'hypothalamusEndocrine.crhFeedbackGain': 1,
    },
    'organs/human-organs/brain/pituitary.parameters.json': {
      'pituitary.tshFeedbackGain': 1,
      'pituitary.acthFeedbackGain': 1,
    },
    'organs/human-organs/thyroid/thyroid.parameters.json': {
      'thyroid.thyroxineHalfTimeMin': 60,
    },
    'organs/human-organs/adrenal/cortisol.parameters.json': {
      'adrenal.responseHalfTimeMin': 15,
    },
    'organs/human-organs/pineal/melatonin.parameters.json': {
      'pineal.melatoninBaseRelative': 1,
      'pineal.melatoninAmplitudeRelative': 0.8,
      'pineal.melatoninPeakHour': 2,
      'pineal.melatoninPeriodHours': 24,
    },
  };

  for (const [label, values] of Object.entries(expected)) {
    const data = readParameters(new URL(`../${label}`, import.meta.url));
    assert.deepEqual(loadParameters(new URL(`../${label}`, import.meta.url)), values, label);
    for (const parameter of data.parameters) {
      assert.equal(parameter.status, 'design', `${parameter.id}: status`);
      assert.equal(parameter.source, null, `${parameter.id}: source`);
    }
  }
});

test('sexualResponse keeps six design defaults for arousal and release timing', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/sexual-response/response.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));

  assert.deepEqual(Object.keys(byId).sort(), [
    'sexualResponse.arousalHalfTimeMin',
    'sexualResponse.orgasmAllowedMm',
    'sexualResponse.orgasmDurationMin',
    'sexualResponse.orgasmForcedMm',
    'sexualResponse.refractoryMin',
    'sexualResponse.resolutionHalfTimeMin',
  ]);

  const expected = {
    'sexualResponse.arousalHalfTimeMin': 5,
    'sexualResponse.resolutionHalfTimeMin': 15,
    'sexualResponse.orgasmAllowedMm': 70,
    'sexualResponse.orgasmForcedMm': 95,
    'sexualResponse.orgasmDurationMin': 1,
    'sexualResponse.refractoryMin': 20,
  };
  for (const [parameterId, value] of Object.entries(expected)) {
    assert.equal(byId[parameterId].value, value, `${parameterId}: value`);
    assert.equal(byId[parameterId].status, 'design', `${parameterId}: status`);
    assert.equal(byId[parameterId].source, null, `${parameterId}: source`);
  }
  assert.equal(byId['sexualResponse.arousalHalfTimeMin'].unit, 'min');
  assert.equal(byId['sexualResponse.orgasmAllowedMm'].unit, 'mm');
  assert.equal(byId['sexualResponse.orgasmForcedMm'].unit, 'mm');
});

test('ovaries carries the Bull cycle priors and uterus takes the Bull bleeding length', () => {
  const ovaries = readParameters(new URL(
    '../organs/human-organs/ovaries/menstrual-cycle.parameters.json',
    import.meta.url,
  ));
  const ovariesById = Object.fromEntries(
    ovaries.parameters.map((parameter) => [parameter.id, parameter]),
  );

  for (const [parameterId, value] of [
    ['ovaries.cycleLengthDays', 29.3],
    ['ovaries.follicularLengthDays', 16.9],
    ['ovaries.lutealLengthDays', 12.4],
  ]) {
    const parameter = ovariesById[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, 'd', `${parameterId}: unit`);
    assert.equal(parameter.status, 'prior', `${parameterId}: status`);
    assert.equal(parameter.source, 'SRC-BULL-2019', `${parameterId}: source`);
  }
  for (const parameterId of [
    'ovaries.startCycleDay',
    'ovaries.estradiolNadirRelative',
    'ovaries.estradiolLutealBumpRelative',
    'ovaries.progesteroneBaselineRelative',
  ]) {
    assert.equal(ovariesById[parameterId].status, 'design', `${parameterId}: status`);
    assert.equal(ovariesById[parameterId].source, null, `${parameterId}: source`);
  }

  const uterus = readParameters(new URL(
    '../organs/human-organs/uterus/uterus.parameters.json',
    import.meta.url,
  ));
  const uterusById = Object.fromEntries(
    uterus.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const menses = uterusById['uterus.mensesDays'];
  assert.equal(menses.value, 4, 'Bull self-reported bleeding length');
  assert.equal(menses.unit, 'd');
  assert.equal(menses.status, 'prior');
  assert.equal(menses.source, 'SRC-BULL-2019');
  assert.match(menses.note, /Bull/);
  for (const parameterId of [
    'uterus.flowMlPerCycle',
    'uterus.crampPeakMm',
    'uterus.crampDurationDays',
    'uterus.endometriumHalfTimeDays',
    'uterus.endometriumEstradiolWeight',
    'uterus.endometriumProgesteroneWeight',
  ]) {
    assert.equal(uterusById[parameterId].status, 'design', `${parameterId}: status`);
    assert.equal(uterusById[parameterId].source, null, `${parameterId}: source`);
  }
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

test('lungs respiratory water loss keeps the design reference rate', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/lungs/respiratory-water-loss.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin',
  ]);
  const parameter = byId['lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin'];
  assert.equal(parameter.value, 0.3);
  assert.equal(parameter.unit, 'mL/min');
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
  assert.deepEqual(parameter.range, [0, 2]);
});

test('blood oxygen and lung ventilation parameters keep the design defaults', () => {
  const oxygen = readParameters(new URL(
    '../organs/human-compartments/blood-oxygen/oxygen.parameters.json',
    import.meta.url,
  ));
  const oxygenById = Object.fromEntries(oxygen.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(oxygenById).sort(), [
    'bloodOxygen.activityGainMlMin',
    'bloodOxygen.basalMlMin',
    'bloodOxygen.baselineSpo2Percent',
    'bloodOxygen.digestionGain',
  ]);
  for (const [parameterId, value, unit] of [
    ['bloodOxygen.basalMlMin', 250, 'mL/min'],
    ['bloodOxygen.activityGainMlMin', 1000, 'mL/min'],
    ['bloodOxygen.digestionGain', 0.1, '1'],
    ['bloodOxygen.baselineSpo2Percent', 97, '%'],
  ]) {
    const parameter = oxygenById[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }

  const ventilation = readParameters(new URL(
    '../organs/human-organs/lungs/ventilation.parameters.json',
    import.meta.url,
  ));
  const ventilationById = Object.fromEntries(
    ventilation.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(ventilationById).sort(), [
    'lungsVentilation.deadSpaceFactor',
    'lungsVentilation.inspiredO2Fraction',
    'lungsVentilation.maxRatePerMin',
    'lungsVentilation.maxVentilationMlMin',
    'lungsVentilation.restingRatePerMin',
    'lungsVentilation.restingTidalVolumeMl',
    'lungsVentilation.restingVentilationMlMin',
  ]);
  for (const [parameterId, value, unit] of [
    ['lungsVentilation.restingTidalVolumeMl', 500, 'mL'],
    ['lungsVentilation.restingRatePerMin', 12, '1/min'],
    ['lungsVentilation.maxRatePerMin', 40, '1/min'],
    ['lungsVentilation.restingVentilationMlMin', 6000, 'mL/min'],
    ['lungsVentilation.maxVentilationMlMin', 60000, 'mL/min'],
    ['lungsVentilation.inspiredO2Fraction', 0.21, '1'],
    ['lungsVentilation.deadSpaceFactor', 1.4, '1'],
  ]) {
    const parameter = ventilationById[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
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
    'pancreasEndocrine.glucagon.glucoseGainPerMgDl',
    'pancreasEndocrine.glucagon.maxRelative',
    'pancreasEndocrine.glucagon.responseHalfTimeMin',
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

  for (const [parameterId, value, unit] of [
    ['pancreasEndocrine.glucagon.glucoseGainPerMgDl', 0.02, '1/(mg/dL)'],
    ['pancreasEndocrine.glucagon.responseHalfTimeMin', 10, 'min'],
    ['pancreasEndocrine.glucagon.maxRelative', 5, '1'],
  ]) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
});

test('liver glycogen parameters stay design placeholders', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/liver/glycogen.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  assert.deepEqual(Object.keys(byId).sort(), [
    'liver.glycogenCapacityG',
    'liver.halfMaxExcessG',
    'liver.initialGlycogenG',
    'liver.insulinSensitivity',
    'liver.maxOutputRateGPerMin',
    'liver.maxUptakeRateGPerMin',
  ]);
  for (const [parameterId, value, unit] of [
    ['liver.maxOutputRateGPerMin', 1, 'g/min'],
    ['liver.initialGlycogenG', 80, 'g'],
    ['liver.glycogenCapacityG', 100, 'g'],
    ['liver.maxUptakeRateGPerMin', 0.2, 'g/min'],
    ['liver.halfMaxExcessG', 15, 'g'],
    ['liver.insulinSensitivity', 0.5, '1'],
  ]) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
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
