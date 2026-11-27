import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getBodyProfile,
  getNsfwSetting,
  getNumericParameterOverride,
  getParameterOverride,
  getProfileLactating,
  hasParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
  setWorkerParameterConfig,
} from '../lib/parameters.js';

const parametersFiles = [
  { label: 'organs/body-inputs/clothing.parameters.json', url: new URL('../organs/body-inputs/clothing.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/motility.parameters.json', url: new URL('../organs/human-organs/stomach/motility.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/duodenum/nutrient-exposure.parameters.json', url: new URL('../organs/human-organs/duodenum/nutrient-exposure.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/salivary-glands/saliva.parameters.json', url: new URL('../organs/human-organs/salivary-glands/saliva.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/ghrelin.parameters.json', url: new URL('../organs/human-organs/stomach/ghrelin.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/gastric-sensory.parameters.json', url: new URL('../organs/human-organs/stomach/gastric-sensory.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/interoception.parameters.json', url: new URL('../organs/human-organs/brain/interoception.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/sleep.parameters.json', url: new URL('../organs/human-organs/brain/sleep.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/autonomic.parameters.json', url: new URL('../organs/human-organs/brain/autonomic.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/thermoregulation.parameters.json', url: new URL('../organs/human-organs/brain/thermoregulation.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/reward.parameters.json', url: new URL('../organs/human-organs/brain/reward.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/brain/notify.parameters.json', url: new URL('../organs/human-organs/brain/notify.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/small-intestine/water-absorption.parameters.json', url: new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/body-water/water.parameters.json', url: new URL('../organs/human-compartments/body-water/water.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/heart/heart.parameters.json', url: new URL('../organs/human-organs/heart/heart.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/blood/blood.parameters.json', url: new URL('../organs/human-compartments/blood/blood.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/blood-oxygen/oxygen.parameters.json', url: new URL('../organs/human-compartments/blood-oxygen/oxygen.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/skin/sweat.parameters.json', url: new URL('../organs/human-organs/skin/sweat.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/lungs/respiratory-water-loss.parameters.json', url: new URL('../organs/human-organs/lungs/respiratory-water-loss.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/lungs/ventilation.parameters.json', url: new URL('../organs/human-organs/lungs/ventilation.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/glucose/glucose.parameters.json', url: new URL('../organs/human-compartments/glucose/glucose.parameters.json', import.meta.url) },
  { label: 'organs/human-compartments/calcium/calcium.parameters.json', url: new URL('../organs/human-compartments/calcium/calcium.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/parathyroid/parathyroid.parameters.json', url: new URL('../organs/human-organs/parathyroid/parathyroid.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/esophagus/esophagus.parameters.json', url: new URL('../organs/human-organs/esophagus/esophagus.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/colon/colon.parameters.json', url: new URL('../organs/human-organs/colon/colon.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/liver/glycogen.parameters.json', url: new URL('../organs/human-organs/liver/glycogen.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/kidney/gluconeogenesis.parameters.json', url: new URL('../organs/human-organs/kidney/gluconeogenesis.parameters.json', import.meta.url) },
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
  { label: 'organs/human-organs/testes/testosterone.parameters.json', url: new URL('../organs/human-organs/testes/testosterone.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/epididymis/storage.parameters.json', url: new URL('../organs/human-organs/epididymis/storage.parameters.json', import.meta.url) },
  ...[
    'organs/human-organs/liver/bile.parameters.json',
    'organs/human-organs/gallbladder/bile-reserve.parameters.json',
    'organs/human-organs/pancreas/exocrine.parameters.json',
    'organs/human-organs/small-intestine/lipid-absorption.parameters.json',
    'organs/human-compartments/intestinal-lymph/meal-transit.parameters.json',
    'organs/human-compartments/lipid-circulation/meal-lipids.parameters.json',
    'organs/human-compartments/adipose/meal-storage.parameters.json',
  ].map((label) => ({ label, url: new URL(`../${label}`, import.meta.url) })),
];

const allowedStatuses = new Set(['design', 'policy', 'prior', 'fitted_dev', 'validated', 'unset']);
const sourcedStatuses = new Set(['prior', 'fitted_dev', 'validated']);

function readParameters(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

test('setWorkerParameterConfig overrides loaded parameters and scales by weight unless overridden', (t) => {
  t.after(() => {
    setWorkerParameterConfig({});
  });

  setWorkerParameterConfig({});
  assert.deepEqual(getBodyProfile(), { weightKg: 75, heightCm: 170 });
  assert.equal(getProfileLactating(), false);
  assert.equal(scaleByBodyWeight(100), 100);
  assert.equal(hasParameterOverride('glucose.baselineConcentrationMgDl'), false);
  assert.equal(getParameterOverride('glucose.baselineConcentrationMgDl'), undefined);

  setWorkerParameterConfig({
    profile: { weightKg: 50, heightCm: 160, lactating: true },
    parameters: {
      'glucose.baselineConcentrationMgDl': 98,
      'bodyFluid.referenceVolumeMl': 22000,
    },
  });
  assert.deepEqual(getBodyProfile(), { weightKg: 50, heightCm: 160 });
  assert.equal(getProfileLactating(), true);
  assert.equal(hasParameterOverride('bodyFluid.referenceVolumeMl'), true);
  assert.equal(getNumericParameterOverride('bodyFluid.referenceVolumeMl'), 22000);
  assert.equal(scaleByBodyWeight(30000, 'bodyFluid.referenceVolumeMl'), 30000);
  assert.ok(Math.abs(scaleByBodyWeight(75, 'glucose.referenceBodyMassKg') - 50) < 1e-12);

  const glucoseUrl = new URL('../organs/human-compartments/glucose/glucose.parameters.json', import.meta.url);
  const loaded = loadParameters(glucoseUrl);
  assert.equal(loaded['glucose.baselineConcentrationMgDl'], 98);
  assert.equal(loaded['glucose.referenceBodyMassKg'], 75);
});

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
      assert.ok(
        allowedStatuses.has(parameter.status),
        `${parameter.id}: unexpected status ${parameter.status}`,
      );
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

test('small intestine declares the colon residue fraction as a design parameter', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/small-intestine/water-absorption.parameters.json',
    import.meta.url,
  ));
  const parameter = data.parameters.find(
    (entry) => entry.id === 'smallIntestine.residueFraction',
  );
  assert.ok(parameter, 'smallIntestine.residueFraction must be declared');
  assert.equal(parameter.unit, '1');
  assert.equal(parameter.value, 0.05);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
  assert.deepEqual(parameter.range, [0, 1]);
});

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
    'glucose.basalConsumptionGPerMin',
    'glucose.baselineConcentrationMgDl',
    'glucose.distributionVolumeDlPerKg',
    'glucose.referenceBodyMassKg',
    'glucose.residualDisposalHalfTimeMin',
  ]);

  assert.equal(byId['glucose.basalConsumptionGPerMin'].value, 0.12);
  assert.equal(byId['glucose.basalConsumptionGPerMin'].unit, 'g/min');
  assert.equal(byId['glucose.basalConsumptionGPerMin'].status, 'design');
  assert.equal(byId['glucose.basalConsumptionGPerMin'].source, null);
  assert.deepEqual(byId['glucose.basalConsumptionGPerMin'].range, [0, 0.5]);
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

test('the parameter inventory covers the 55 files across the adult manifests and optional chains', () => {
  assert.equal(parametersFiles.length, 55);
  const labels = parametersFiles.map(({ label }) => label);
  assert.equal(
    labels.some((label) => label.includes('/skeletal-muscle/regions/')),
    false,
    'the three regional muscle parts reuse glucose-uptake.parameters.json; they add no parameter file',
  );
  assert.ok(labels.includes('organs/human-organs/salivary-glands/saliva.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/pancreas/insulin.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/kidney/glucose-excretion.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/kidney/gluconeogenesis.parameters.json'));
  assert.ok(labels.includes('organs/human-compartments/calcium/calcium.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/parathyroid/parathyroid.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/esophagus/esophagus.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/colon/colon.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/liver/glycogen.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/skin/sweat.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/lungs/respiratory-water-loss.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/lungs/ventilation.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/heart/heart.parameters.json'));
  assert.ok(labels.includes('organs/human-compartments/blood/blood.parameters.json'));
  assert.ok(labels.includes('organs/human-compartments/blood-oxygen/oxygen.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/brain/thermoregulation.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/ovaries/menstrual-cycle.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/uterus/uterus.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/mammary-glands/milk.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/sexual-response/response.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/testes/testosterone.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/epididymis/storage.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/brain/hypothalamus-endocrine.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/brain/pituitary.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/brain/reward.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/thyroid/thyroid.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/adrenal/cortisol.parameters.json'));
  assert.ok(labels.includes('organs/human-organs/pineal/melatonin.parameters.json'));
});

test('heart, blood and thermoregulation parameters are design defaults with no source', () => {
  const expected = {
    'organs/human-organs/heart/heart.parameters.json': {
      'heart.restingHeartRatePerMin': [70, '1/min'],
      'heart.maxHeartRatePerMin': [180, '1/min'],
      'heart.restingStrokeVolumeMl': [70, 'mL'],
      'heart.activityGain': [1.5, '1'],
      'heart.catecholamineGain': [0.5, '1'],
      'heart.sympatheticDriveGain': [0.012, '1/mm'],
      'heart.startleFloorSympatheticMm': [85, 'mm'],
      'heart.lightSleepDriveBase': [0.86, '1'],
      'heart.deepSleepDriveBase': [0.78, '1'],
      'heart.remSleepDriveBase': [0.94, '1'],
      'heart.minSleepHeartRatePerMin': [42, '1/min'],
      'heart.strokeVolumeGain': [0.2, '1'],
    },
    'organs/human-compartments/blood/blood.parameters.json': {
      'blood.referenceBloodVolumeMl': [5000, 'mL'],
      'blood.baselineSystolicMmHg': [120, 'mmHg'],
      'blood.baselineDiastolicMmHg': [80, 'mmHg'],
      'blood.baselineGfrMlMin': [100, 'mL/min'],
      'blood.oxygenContentPerPercentMlPerL': [2, 'mL/L/%'],
      'blood.sympatheticSystolicGain': [0.002, '1/mm'],
      'blood.sympatheticDiastolicGain': [0.001, '1/mm'],
      'blood.referenceMaxCardiacOutputMlMin': [16380, 'mL/min'],
    },
    'organs/human-organs/brain/thermoregulation.parameters.json': {
      'thermoregulation.setpointC': [37, '°C'],
      'thermoregulation.evaporationReferenceTemperatureC': [32, '°C'],
      'thermoregulation.evaporationConductanceMlMinPerKpa': [3, 'mL/(min·kPa)'],
      'thermoregulation.heatCapacityKcalPerC': [60, 'kcal/°C'],
      'thermoregulation.metabolicFactor': [0.005, 'kcal/mL'],
      'thermoregulation.shiveringGain': [2, 'kcal/(min·°C)'],
      'thermoregulation.lossGain': [0.104167, 'kcal/(min·°C)'],
      'thermoregulation.evaporationKcalPerMl': [0.58, 'kcal/mL'],
      'thermoregulation.circadianAmplitudeC': [0.25, '°C'],
      'thermoregulation.circadianPeakHour': [17, 'h'],
      'thermoregulation.sleepSetpointOffsetC': [0.2, '°C'],
      'thermoregulation.vasodilationGain': [0.5, 'kcal/(min·°C)'],
      'thermoregulation.maxVasodilationKcalMin': [0.55, 'kcal/min'],
    },
  };

  for (const [label, parameters] of Object.entries(expected)) {
    const data = readParameters(new URL(`../${label}`, import.meta.url));
    const byId = Object.fromEntries(
      data.parameters.map((parameter) => [parameter.id, parameter]),
    );
    assert.deepEqual(Object.keys(byId).sort(), Object.keys(parameters).sort(), label);
    for (const [parameterId, [value, unit]] of Object.entries(parameters)) {
      const parameter = byId[parameterId];
      assert.equal(parameter.value, value, `${parameterId}: value`);
      assert.equal(parameter.unit, unit, `${parameterId}: unit`);
      assert.equal(parameter.status, 'design', `${parameterId}: status`);
      if (parameterId.startsWith('heart.')) {
        assert.ok(parameter.source === null || parameter.source === 'SRC-SOMERS-1993', `${parameterId}: source`);
      } else if (parameterId === 'thermoregulation.vasodilationGain') {
        assert.equal(parameter.source, 'SRC-KRAUCHI-1994', `${parameterId}: source`);
      } else if (parameterId === 'thermoregulation.maxVasodilationKcalMin') {
        assert.equal(parameter.source, 'SRC-CRAMER-2019', `${parameterId}: source`);
      } else {
        assert.equal(parameter.source, null, `${parameterId}: source`);
      }
    }
  }
});

test('endocrine and reward parameters keep expected values, units, statuses and sources', () => {
  const expected = {
    'organs/human-organs/brain/hypothalamus-endocrine.parameters.json': {
      'hypothalamusEndocrine.trhFeedbackGain': 1,
      'hypothalamusEndocrine.crhFeedbackGain': 1,
      'hypothalamusEndocrine.crhCircadianAmplitude': 0.35,
      'hypothalamusEndocrine.crhPeakHour': 7,
      'hypothalamusEndocrine.sympatheticCrhGain': 0.01,
      'hypothalamusEndocrine.carAmplitude': 0.45,
      'hypothalamusEndocrine.carLatentMin': 10,
      'hypothalamusEndocrine.sleepCrhSuppression': 0.15,
      'hypothalamusEndocrine.rewardBufferingGain': 0.25,
    },
    'organs/human-organs/brain/pituitary.parameters.json': {
      'pituitary.tshFeedbackGain': 1,
      'pituitary.tshHalfTimeMin': 53.9,
      'pituitary.acthBasalPgMl': 12,
      'pituitary.acthFeedbackGain': 1,
      'pituitary.acthHalfTimeMin': 20,
      'pituitary.prolactinBasalNgMl': 8,
      'pituitary.prolactinCircadianAmplitudeNgMl': 2.1,
      'pituitary.prolactinSleepBoostNgMl': 6,
      'pituitary.prolactinSucklingGainNgMl': 82,
      'pituitary.prolactinOrgasmBoostNgMl': 14,
      'pituitary.prolactinHalfTimeMin': 34.6,
      'pituitary.oxytocinBasalPgMl': 2,
      'pituitary.oxytocinSucklingBoostPgMl': 14,
      'pituitary.oxytocinArousalGainPgMl': 6,
      'pituitary.oxytocinOrgasmBoostPgMl': 22,
      'pituitary.oxytocinHalfTimeMin': 3.8,
    },
    'organs/human-organs/brain/reward.parameters.json': {
      'reward.basalWantingMm': 25,
      'reward.basalHedonicMm': 15,
      'reward.sexWantingGain': 0.5,
      'reward.ghrelinWantingGainMm': 18,
      'reward.orgasmHedonicBoostMm': 68,
      'reward.orgasmSatietyBoostMm': 78,
      'reward.exerciseHedonicGainMm': 32,
      'reward.mealHedonicGainMm': 18,
      'reward.mealSatietyGainMm': 28,
      'reward.oxytocinHedonicGainMmPerPgMl': 1.2,
      'reward.stressSuppressionGain': 0.35,
      'reward.wantingHalfTimeMin': 8,
      'reward.hedonicHalfTimeMin': 25,
      'reward.satietyHalfTimeMin': 40,
    },
    'organs/human-organs/thyroid/thyroid.parameters.json': {
      'thyroid.thyroxineHalfTimeMin': 1440,
    },
    'organs/human-organs/adrenal/cortisol.parameters.json': {
      'adrenal.referenceCortisolNmolL': 180,
      'adrenal.referenceActhPgMl': 12,
      'adrenal.acthEc50PgMl': 26,
      'adrenal.maxSecretionNmolLPerMin': 10,
      'adrenal.hillExponent': 1.85,
      'adrenal.eliminationHalfTimeMin': 49,
    },
    'organs/human-organs/pineal/melatonin.parameters.json': {
      'pineal.melatoninBaseRelative': 1,
      'pineal.melatoninAmplitudeRelative': 0.8,
      'pineal.melatoninPeakHour': 2,
      'pineal.melatoninPeriodHours': 24,
      'pineal.phaseShiftHours': 0,
      'pineal.photicHalfMaxLux': 100,
      'pineal.awakeNightRoomLux': 120,
      'pineal.daylightPeakLux': 1000,
      'pineal.eyelidTransmittance': 0.05,
      'pineal.responseHalfTimeMin': 39.4,
    },
  };

  const priorParams = new Set([
    'pituitary.tshHalfTimeMin',
    'pituitary.acthHalfTimeMin',
    'pituitary.prolactinCircadianAmplitudeNgMl',
    'thyroid.thyroxineHalfTimeMin',
    'adrenal.acthEc50PgMl',
    'adrenal.maxSecretionNmolLPerMin',
    'adrenal.eliminationHalfTimeMin',
  ]);
  const sourcedParams = new Set([
    'hypothalamusEndocrine.carAmplitude',
    'pituitary.tshHalfTimeMin',
    'pituitary.acthBasalPgMl',
    'pituitary.acthHalfTimeMin',
    'pituitary.prolactinBasalNgMl',
    'pituitary.prolactinCircadianAmplitudeNgMl',
    'pituitary.prolactinOrgasmBoostNgMl',
    'pituitary.prolactinHalfTimeMin',
    'pituitary.oxytocinBasalPgMl',
    'pituitary.oxytocinSucklingBoostPgMl',
    'pituitary.oxytocinOrgasmBoostPgMl',
    'pituitary.oxytocinHalfTimeMin',
    'reward.sexWantingGain',
    'reward.orgasmHedonicBoostMm',
    'reward.orgasmSatietyBoostMm',
    'reward.oxytocinHedonicGainMmPerPgMl',
    'reward.satietyHalfTimeMin',
    'thyroid.thyroxineHalfTimeMin',
    'adrenal.referenceCortisolNmolL',
    'adrenal.referenceActhPgMl',
    'adrenal.acthEc50PgMl',
    'adrenal.maxSecretionNmolLPerMin',
    'adrenal.eliminationHalfTimeMin',
    'pineal.photicHalfMaxLux',
  ]);
  for (const [label, values] of Object.entries(expected)) {
    const data = readParameters(new URL(`../${label}`, import.meta.url));
    assert.deepEqual(loadParameters(new URL(`../${label}`, import.meta.url)), values, label);
    for (const parameter of data.parameters) {
      assert.equal(
        parameter.status,
        priorParams.has(parameter.id) ? 'prior' : 'design',
        `${parameter.id}: status`,
      );
      if (sourcedParams.has(parameter.id)) {
        assert.ok(typeof parameter.source === 'string' && parameter.source.startsWith('SRC-'), `${parameter.id}: source`);
      } else {
        assert.equal(parameter.source, null, `${parameter.id}: source`);
      }
    }
  }
});

test('sexualResponse keeps eight design defaults for arousal, pause, afterglow and release timing', () => {
  const data = readParameters(new URL(
    '../organs/human-organs/sexual-response/response.parameters.json',
    import.meta.url,
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));

  assert.deepEqual(Object.keys(byId).sort(), [
    'sexualResponse.afterglowHalfTimeMin',
    'sexualResponse.arousalHalfTimeMin',
    'sexualResponse.femalePostOrgasmPauseMin',
    'sexualResponse.orgasmAllowedMm',
    'sexualResponse.orgasmDurationMin',
    'sexualResponse.orgasmForcedMm',
    'sexualResponse.refractoryMin',
    'sexualResponse.resolutionHalfTimeMin',
    'sexualResponse.stimulusFloorWeight',
    'sexualResponse.stimulusHalfSaturation',
  ]);

  const expected = {
    'sexualResponse.arousalHalfTimeMin': 5,
    'sexualResponse.resolutionHalfTimeMin': 15,
    'sexualResponse.orgasmAllowedMm': 70,
    'sexualResponse.orgasmForcedMm': 95,
    'sexualResponse.orgasmDurationMin': 1,
    'sexualResponse.refractoryMin': 20,
    'sexualResponse.femalePostOrgasmPauseMin': 2,
    'sexualResponse.afterglowHalfTimeMin': 22,
    'sexualResponse.stimulusHalfSaturation': 0.022,
    'sexualResponse.stimulusFloorWeight': 0.77,
  };
  for (const [parameterId, value] of Object.entries(expected)) {
    assert.equal(byId[parameterId].value, value, `${parameterId}: value`);
    assert.equal(byId[parameterId].status, 'design', `${parameterId}: status`);
    assert.equal(byId[parameterId].source, null, `${parameterId}: source`);
  }
  assert.equal(byId['sexualResponse.arousalHalfTimeMin'].unit, 'min');
  assert.equal(byId['sexualResponse.femalePostOrgasmPauseMin'].unit, 'min');
  assert.equal(byId['sexualResponse.afterglowHalfTimeMin'].unit, 'min');
  assert.equal(byId['sexualResponse.orgasmAllowedMm'].unit, 'mm');
  assert.equal(byId['sexualResponse.orgasmForcedMm'].unit, 'mm');
});

test('ovaries carries the Bull cycle priors and hyperprolactinemia design entries, and uterus takes Bull/Hallberg/Bakos/Blaicher entries', () => {
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
  assert.equal(ovariesById['ovaries.startCycleDay'].status, 'design');
  assert.equal(ovariesById['ovaries.startCycleDay'].source, null);
  assert.equal(ovariesById['ovaries.hyperprolactinemiaThresholdNgMl'].value, 35);
  assert.equal(ovariesById['ovaries.hyperprolactinemiaThresholdNgMl'].status, 'design');
  assert.equal(ovariesById['ovaries.hyperprolactinemiaThresholdNgMl'].source, 'SRC-HOSKOVA-2022');
  assert.equal(ovariesById['ovaries.suppressionOnsetDays'].value, 7);
  assert.equal(ovariesById['ovaries.suppressionOnsetDays'].status, 'design');
  assert.equal(ovariesById['ovaries.suppressionOnsetDays'].source, 'SRC-PAGEWILSON-2007');
  assert.equal(ovariesById['ovaries.suppressionHalfTimeDays'].value, 5);
  assert.equal(ovariesById['ovaries.suppressionHalfTimeDays'].status, 'design');
  assert.equal(ovariesById['ovaries.suppressionHalfTimeDays'].source, 'SRC-PAGEWILSON-2007');

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
  assert.equal(uterusById['uterus.flowMlPerCycle'].value, 30);
  assert.equal(uterusById['uterus.flowMlPerCycle'].status, 'design');
  assert.equal(uterusById['uterus.flowMlPerCycle'].source, 'SRC-HALLBERG-1966');
  assert.equal(uterusById['uterus.lutealEndometriumPlateau'].value, 0.9);
  assert.equal(uterusById['uterus.lutealEndometriumPlateau'].status, 'design');
  assert.equal(uterusById['uterus.lutealEndometriumPlateau'].source, 'SRC-BAKOS-1994');
  assert.equal(uterusById['uterus.orgasmContractionPeakMm'].value, 68);
  assert.equal(uterusById['uterus.orgasmContractionPeakMm'].status, 'design');
  assert.equal(uterusById['uterus.orgasmContractionPeakMm'].source, 'SRC-BLAICHER-1999');
  for (const parameterId of [
    'uterus.crampPeakMm',
    'uterus.crampDurationDays',
    'uterus.endometriumHalfTimeDays',
    'uterus.contractionHalfTimeMin',
    'uterus.congestionHalfTimeMin',
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
    'skin.heatGain',
    'skin.interthresholdOffsetC',
    'skin.nocturnalDeadbandOffsetC',
    'skin.sweat.ambientGainPerC',
    'skin.sweat.maxRateMlPerMin',
    'skin.sweat.referenceRateMlPerMin',
  ]);
  assert.equal(byId['skin.heatGain'].value, 5);
  assert.equal(byId['skin.heatGain'].unit, 'mL/(min·°C)');
  assert.equal(byId['skin.interthresholdOffsetC'].value, 0.25);
  assert.equal(byId['skin.interthresholdOffsetC'].unit, '°C');
  assert.equal(byId['skin.nocturnalDeadbandOffsetC'].value, 0.45);
  assert.equal(byId['skin.nocturnalDeadbandOffsetC'].unit, '°C');
  assert.equal(byId['skin.sweat.referenceRateMlPerMin'].value, 0.6);
  assert.equal(byId['skin.sweat.referenceRateMlPerMin'].unit, 'mL/min');
  assert.equal(byId['skin.sweat.ambientGainPerC'].value, 0.04);
  assert.equal(byId['skin.sweat.ambientGainPerC'].unit, '1/°C');
  assert.equal(byId['skin.sweat.maxRateMlPerMin'].value, 15);
  assert.equal(byId['skin.sweat.maxRateMlPerMin'].unit, 'mL/min');
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    const expectedSource = (
      parameter.id === 'skin.interthresholdOffsetC' || parameter.id === 'skin.nocturnalDeadbandOffsetC'
    )
      ? 'SRC-WENGER-1976'
      : null;
    assert.equal(parameter.source, expectedSource, `${parameter.id}: source`);
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
    'lungsVentilation.deepSleepFloorFactor',
    'lungsVentilation.exercisePantingFactor',
    'lungsVentilation.inspiredO2Fraction',
    'lungsVentilation.lightSleepFloorFactor',
    'lungsVentilation.maxRatePerMin',
    'lungsVentilation.maxTidalVolumeMl',
    'lungsVentilation.maxVentilationMlMin',
    'lungsVentilation.pantingGain',
    'lungsVentilation.restThermalThresholdOffsetC',
    'lungsVentilation.restingRatePerMin',
    'lungsVentilation.restingTidalVolumeMl',
    'lungsVentilation.restingVentilationMlMin',
    'lungsVentilation.sleepSympatheticBypassThresholdMm',
    'lungsVentilation.sympatheticTidalCompressionFactor',
    'lungsVentilation.sympatheticVentilationGainMlPerMinPerMm',
    'lungsVentilation.tidalScaleVentilationMlMin',
  ]);
  for (const [parameterId, value, unit] of [
    ['lungsVentilation.restingTidalVolumeMl', 500, 'mL'],
    ['lungsVentilation.restingRatePerMin', 12, '1/min'],
    ['lungsVentilation.maxRatePerMin', 40, '1/min'],
    ['lungsVentilation.restingVentilationMlMin', 6000, 'mL/min'],
    ['lungsVentilation.maxVentilationMlMin', 60000, 'mL/min'],
    ['lungsVentilation.inspiredO2Fraction', 0.058333, '1'],
    ['lungsVentilation.deadSpaceFactor', 1.4, '1'],
    ['lungsVentilation.pantingGain', 1500, 'mL/(min·°C)'],
    ['lungsVentilation.deepSleepFloorFactor', 0.82, '1'],
    ['lungsVentilation.lightSleepFloorFactor', 0.9, '1'],
    ['lungsVentilation.sleepSympatheticBypassThresholdMm', 20, 'mm'],
    ['lungsVentilation.sympatheticVentilationGainMlPerMinPerMm', 80, 'mL/(min·mm)'],
    ['lungsVentilation.maxTidalVolumeMl', 2100, 'mL'],
    ['lungsVentilation.tidalScaleVentilationMlMin', 30000, 'mL/min'],
    ['lungsVentilation.restThermalThresholdOffsetC', 0.8, '°C'],
    ['lungsVentilation.exercisePantingFactor', 0.35, '1'],
    ['lungsVentilation.sympatheticTidalCompressionFactor', 0.25, '1'],
  ]) {
    const parameter = ventilationById[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    const expectedSource = {
      'lungsVentilation.maxTidalVolumeMl': 'SRC-LOE-2014',
      'lungsVentilation.tidalScaleVentilationMlMin': 'SRC-NEDER-2003',
      'lungsVentilation.restThermalThresholdOffsetC': 'SRC-TSUJI-2012',
      'lungsVentilation.exercisePantingFactor': 'SRC-TSUJI-2012',
    }[parameterId] ?? null;
    assert.equal(parameter.source, expectedSource, `${parameterId}: source`);
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
    'pancreasEndocrine.glucagon.counterregGainPerMgDl',
    'pancreasEndocrine.glucagon.glucoseGainPerMgDl',
    'pancreasEndocrine.glucagon.hypoglycemiaThresholdMgDl',
    'pancreasEndocrine.glucagon.maxRelative',
    'pancreasEndocrine.glucagon.responseHalfTimeMin',
    'pancreasEndocrine.insulin.basalPmolL',
    'pancreasEndocrine.insulin.clearanceKmPmolL',
    'pancreasEndocrine.insulin.clearanceVmaxPmolLPerMin',
    'pancreasEndocrine.insulin.glucoseGainPmolLPerMinPerMgDl',
    'pancreasEndocrine.insulin.maxPmolL',
    'pancreasEndocrine.referenceGlucoseMgDl',
  ]);

  const reference = byId['pancreasEndocrine.referenceGlucoseMgDl'];
  assert.equal(reference.value, glucoseById['glucose.baselineConcentrationMgDl'].value);
  assert.equal(reference.unit, 'mg/dL');
  assert.equal(reference.status, 'design');
  assert.equal(reference.source, null);

  for (const [parameterId, value, unit] of [
    ['pancreasEndocrine.insulin.basalPmolL', 60, 'pmol/L'],
    ['pancreasEndocrine.insulin.glucoseGainPmolLPerMinPerMgDl', 0.085, 'pmol/(L·min·mg/dL)'],
    ['pancreasEndocrine.insulin.clearanceKmPmolL', 3890, 'pmol/L'],
    ['pancreasEndocrine.insulin.clearanceVmaxPmolLPerMin', 274, 'pmol/(L·min)'],
    ['pancreasEndocrine.insulin.maxPmolL', 900, 'pmol/L'],
    ['pancreasEndocrine.glucagon.hypoglycemiaThresholdMgDl', 68, 'mg/dL'],
    ['pancreasEndocrine.glucagon.glucoseGainPerMgDl', 0.02, '1/(mg/dL)'],
    ['pancreasEndocrine.glucagon.counterregGainPerMgDl', 0.06, '1/(mg/dL)'],
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
    'liver.basalOutputRateGPerMin',
    'liver.glucagonOutputGainGPerMin',
    'liver.glycogenCapacityG',
    'liver.halfMaxExcessG',
    'liver.hypoglycemiaOutputGainGPerMinPerMgDl',
    'liver.initialGlycogenG',
    'liver.insulinSensitivity',
    'liver.maxOutputRateGPerMin',
    'liver.maxUptakeRateGPerMin',
    'liver.sympatheticOutputGain',
  ]);
  for (const [parameterId, value, unit] of [
    ['liver.maxOutputRateGPerMin', 1, 'g/min'],
    ['liver.basalOutputRateGPerMin', 0.096, 'g/min'],
    ['liver.hypoglycemiaOutputGainGPerMinPerMgDl', 0.015, 'g/(min·mg/dL)'],
    ['liver.glucagonOutputGainGPerMin', 0.15, 'g/min'],
    ['liver.initialGlycogenG', 80, 'g'],
    ['liver.glycogenCapacityG', 100, 'g'],
    ['liver.maxUptakeRateGPerMin', 0.2, 'g/min'],
    ['liver.halfMaxExcessG', 15, 'g'],
    ['liver.insulinSensitivity', 0.5, '1'],
    ['liver.sympatheticOutputGain', 0.005, '1/mm'],
  ]) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
});

test('muscleGlucose, kidneyGluconeogenesis, mammaryGlands, smallIntestine, colon and brainNotify keep expected baselines and policy statuses', () => {
  const muscle = loadParameters(new URL(
    '../organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json',
    import.meta.url,
  ));
  assert.deepEqual(muscle, {
    'muscleGlucose.glycogenUseRateGPerMin': 0.5,
    'muscleGlucose.maxUptakeRateGPerMin': 0.5,
    'muscleGlucose.halfMaxExcessG': 20,
    'muscleGlucose.insulinSensitivity': 1,
    'muscleGlucose.exerciseUptakeRateGPerMin': 0.15,
  });

  const kidneyGng = loadParameters(new URL(
    '../organs/human-organs/kidney/gluconeogenesis.parameters.json',
    import.meta.url,
  ));
  assert.deepEqual(kidneyGng, {
    'kidneyGluconeogenesis.maxOutputRateGPerMin': 0.5,
    'kidneyGluconeogenesis.maxOutputPerRoundG': 0.6,
    'kidneyGluconeogenesis.baselineMgDl': 90,
    'kidneyGluconeogenesis.basalOutputRateGPerMin': 0.024,
    'kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl': 0.005,
    'kidneyGluconeogenesis.glucagonOutputGainGPerMin': 0.05,
  });

  const mammary = loadParameters(new URL(
    '../organs/human-organs/mammary-glands/milk.parameters.json',
    import.meta.url,
  ));
  assert.deepEqual(mammary, {
    'mammaryGlands.basalMilkRateMlPerMin': 0.54,
    'mammaryGlands.storageCapacityMl': 360,
    'mammaryGlands.lactoseGPerMl': 0.074,
    'mammaryGlands.galactorrheaRateMlPerMin': 0.012,
    'mammaryGlands.inductionPrlThresholdNgMl': 45,
    'mammaryGlands.galactorrheaThreshold': 0.25,
    'mammaryGlands.hormonalInductionPerDay': 0.05,
    'mammaryGlands.stimulatedInductionPerDay': 0.055,
    'mammaryGlands.involutionHalfTimeDays': 7,
    'mammaryGlands.breastfeedPamr': 0.673,
    'mammaryGlands.expressPamr': 0.75,
    'mammaryGlands.engorgementPamrPenaltyPer100Ml': 0.14,
    'mammaryGlands.letdownOxytocinThresholdPgMl': 5,
    'mammaryGlands.fullnessHalfTimeMin': 15,
  });
  const mammaryRaw = readParameters(new URL(
    '../organs/human-organs/mammary-glands/milk.parameters.json',
    import.meta.url,
  ));
  const mammaryById = Object.fromEntries(mammaryRaw.parameters.map((p) => [p.id, p]));
  assert.equal(mammaryById['mammaryGlands.basalMilkRateMlPerMin'].status, 'prior');
  assert.equal(mammaryById['mammaryGlands.basalMilkRateMlPerMin'].source, 'SRC-KENT-2006');
  assert.equal(mammaryById['mammaryGlands.storageCapacityMl'].status, 'prior');
  assert.equal(mammaryById['mammaryGlands.storageCapacityMl'].source, 'SRC-KENT-2006');
  assert.equal(mammaryById['mammaryGlands.breastfeedPamr'].status, 'prior');
  assert.equal(mammaryById['mammaryGlands.breastfeedPamr'].source, 'SRC-KENT-2006');
  assert.equal(mammaryById['mammaryGlands.expressPamr'].status, 'prior');
  assert.equal(mammaryById['mammaryGlands.expressPamr'].source, 'SRC-PRIME-2012');

  const intestine = loadParameters(new URL(
    '../organs/human-organs/small-intestine/water-absorption.parameters.json',
    import.meta.url,
  ));
  assert.deepEqual(intestine, {
    'smallIntestine.absorption.halfTimeMin': 20,
    'smallIntestine.residueFraction': 0.05,
    'smallIntestine.carbohydrateAbsorption.halfTimeMin': 20,
    'smallIntestine.waterAbsorptionDehydrationFactor': 0.1,
    'smallIntestine.carbAbsorptionInsulinGain': 0,
    'smallIntestine.carbAbsorptionGradientGain': 0.2,
  });

  const colon = loadParameters(new URL(
    '../organs/human-organs/colon/colon.parameters.json',
    import.meta.url,
  ));
  assert.deepEqual(colon, {
    'colon.reclamationRatePerMin': 0.01,
    'colon.stoolFormationGPerMin': 0.01,
    'colon.referenceStoolG': 200,
  });

  const duodenum = loadParameters(new URL(
    '../organs/human-organs/duodenum/nutrient-exposure.parameters.json',
    import.meta.url,
  ));
  assert.deepEqual(duodenum, {
    'duodenum.exposure.timeConstantMin': 10,
    'duodenum.salivaryAmylaseGain': 0.05,
    'duodenum.referenceSalivaRateMlPerMin': 0.5,
  });

  const notify = readParameters(new URL(
    '../organs/human-organs/brain/notify.parameters.json',
    import.meta.url,
  ));
  for (const parameter of notify.parameters) {
    assert.equal(parameter.status, 'policy', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
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

test('requireParameter rejects missing, unset and prototype-named ids with the id in the message', () => {
  const values = { 'interoception.unset': null };

  assert.throws(() => requireParameter(values, 'interoception.missing'), (error) => error.message.includes('interoception.missing'));
  assert.throws(() => requireParameter(values, 'interoception.unset'), (error) => error.message.includes('interoception.unset'));
  assert.throws(() => requireParameter(values, 'toString'), (error) => error.message.includes('toString'));
});

test('loadParameters validates schemaVersion, owner, parameters array, ids, duplicates, and values', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-params-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  function writeParams(name, data) {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(data));
    return path;
  }

  assert.throws(
    () => loadParameters(writeParams('bad-version', { schemaVersion: 2, owner: 'x', parameters: [] })),
    /schemaVersion/,
  );
  assert.throws(
    () => loadParameters(writeParams('empty-owner', { schemaVersion: 1, owner: '', parameters: [] })),
    /owner/,
  );
  assert.throws(
    () => loadParameters(writeParams('bad-array', { schemaVersion: 1, owner: 'x', parameters: {} })),
    /array/,
  );
  assert.throws(
    () => loadParameters(writeParams('bad-prefix', {
      schemaVersion: 1,
      owner: 'x',
      parameters: [{ id: 'y.a', status: 'design', value: 1 }],
    })),
    /must start with x\./,
  );
  assert.throws(
    () => loadParameters(writeParams('dup', {
      schemaVersion: 1,
      owner: 'x',
      parameters: [
        { id: 'x.a', status: 'design', value: 1 },
        { id: 'x.a', status: 'design', value: 2 },
      ],
    })),
    /Duplicate parameter x\.a/,
  );
  assert.throws(
    () => loadParameters(writeParams('missing-value', {
      schemaVersion: 1,
      owner: 'x',
      parameters: [{ id: 'x.a', status: 'design' }],
    })),
    /missing value/,
  );
  assert.throws(
    () => loadParameters(writeParams('unset-mismatch', {
      schemaVersion: 1,
      owner: 'x',
      parameters: [{ id: 'x.a', status: 'unset', value: 1 }],
    })),
    /status unset and value null must match/,
  );
  assert.throws(
    () => loadParameters(writeParams('null-mismatch', {
      schemaVersion: 1,
      owner: 'x',
      parameters: [{ id: 'x.a', status: 'design', value: null }],
    })),
    /status unset and value null must match/,
  );
});

test('setWorkerParameterConfig validates and exposes nsfw setting cleanly', () => {
  try {
    setWorkerParameterConfig();
    assert.equal(getNsfwSetting(), null);
    setWorkerParameterConfig({ nsfw: false });
    assert.equal(getNsfwSetting(), false);
    setWorkerParameterConfig({ nsfw: true });
    assert.equal(getNsfwSetting(), true);
    assert.throws(
      () => setWorkerParameterConfig({ nsfw: 'yes' }),
      /nsfw setting must be a boolean/,
    );
  } finally {
    setWorkerParameterConfig();
  }
});
