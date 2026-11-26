import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the root manifest loads all forty-three body parts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
    profile: { timezoneOffsetMin: 0 },
  }));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const info = await gateway.ready;

  const capabilities = await (await fetch(`http://127.0.0.1:${info.port}/capabilities`)).json();
  assert.deepEqual(capabilities.drink, ['esophagus', 'stomach', 'stomachGhrelin', 'salivaryGlands']);
  assert.deepEqual(capabilities.eat, ['esophagus', 'stomach', 'stomachGhrelin', 'salivaryGlands']);
  assert.deepEqual(capabilities.urinate, ['bladder']);
  assert.deepEqual(capabilities.defecate, ['colon']);
  assert.deepEqual(capabilities.exercise, ['physicalActivity']);
  assert.deepEqual(capabilities.stop_exercise, ['physicalActivity']);
  assert.deepEqual(capabilities.sleep, ['sleep']);
  assert.deepEqual(capabilities.wake_up, ['sleep']);
  assert.equal(Object.hasOwn(capabilities, 'sex'), false);
  assert.equal(Object.hasOwn(capabilities, 'orgasm'), false);
  assert.deepEqual(
    Object.keys(capabilities).sort(),
    ['defecate', 'drink', 'eat', 'exercise', 'sleep', 'stop_exercise', 'urinate', 'wake_up'],
  );

  for (const type of ['sex', 'orgasm']) {
    const blocked = await fetch(`http://127.0.0.1:${info.port}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: `blocked-${type}`, type, intensity: 0.5, durationMin: 5 }),
    });
    assert.equal(blocked.status, 403, `${type} must be blocked when nsfw is false`);
  }

  const response = await fetch(`http://127.0.0.1:${info.port}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'cola-1', type: 'drink', volumeMl: 330, energyKcal: 140 }),
  });
  assert.equal(response.status, 202);
  await gateway.tick();

  const first = await (await fetch(`http://127.0.0.1:${info.port}/state`)).json();
  assert.deepEqual(Object.keys(first.parts).sort(), [
    'adrenal',
    'autonomic',
    'bladder',
    'blood',
    'bloodCalcium',
    'bloodOxygen',
    'bodyFluid',
    'brainNotify',
    'colon',
    'duodenum',
    'esophagus',
    'glucose',
    'heart',
    'hypothalamusAdh',
    'hypothalamusEndocrine',
    'hypothalamusThirst',
    'interoception',
    'kidney',
    'kidneyGluconeogenesis',
    'kidneyGlucose',
    'liver',
    'lungs',
    'lungsVentilation',
    'muscleGlucose',
    'muscleHead',
    'muscleLimbs',
    'muscleTrunk',
    'pancreasEndocrine',
    'parathyroid',
    'physicalActivity',
    'pineal',
    'pituitary',
    'reward',
    'salivaryGlands',
    'sexualResponse',
    'skin',
    'sleep',
    'smallIntestine',
    'stomach',
    'stomachGhrelin',
    'stomachSensory',
    'thermoregulation',
    'thyroid',
  ]);
  assert.equal(first.parts.stomach.volumeMl, 330);
  assert.equal(first.parts.stomach.waterVolumeMl, 330);
  assert.equal(first.parts.stomach.emptiedWaterMl, 0);
  assert.equal(first.parts.esophagus.bolusVolumeMl, 330);
  assert.equal(first.parts.esophagus.transitMin, 0.2);
  assert.ok(Math.abs(first.parts.esophagus.chokingMm - 16) < 1e-12);
  assert.deepEqual(first.parts.colon, {
    residueWaterMl: 0,
    stoolG: 0.01,
    defecatedG: 0,
    reclaimedWaterMl: 0,
    bowelUrgencyMm: 0.005,
  });
  assert.equal(first.parts.interoception.bowelUrgencyMm, 0);
  assert.equal(first.parts.smallIntestine.waterVolumeMl, 0);
  assert.ok(first.parts.stomach.energyKcal > 0);
  assert.ok(first.parts.stomachGhrelin.relativeConcentration < 1);
  assert.ok(first.parts.stomachSensory.mechanical >= 0);
  assert.ok(first.parts.duodenum.nutrientExposure >= 0);
  assert.ok(Number.isFinite(first.parts.interoception.hunger));
  assert.ok(Number.isFinite(first.parts.interoception.fullness));
  assert.equal(first.parts.interoception.thirst, 50);
  assert.ok(Number.isFinite(first.parts.interoception.urinaryUrgency));
  assert.deepEqual(first.parts.heart, {
    heartRatePerMin: 70,
    strokeVolumeMl: 70,
    cardiacOutputMlMin: 4900,
    maxCardiacOutputMlMin: 16380,
  });
  assert.deepEqual(first.parts.blood, {
    bloodVolumeMl: 5000,
    cardiacOutputMlMin: 4900,
    systolicMmHg: 120,
    diastolicMmHg: 80,
    oxygenDeliveryMlMin: 4900 * (97 * 2) / 1000,
    maxOxygenDeliveryMlPerMin: 3177.72,
    gfrMlMin: 100,
  });
  assert.ok(
    Math.abs(
      first.parts.thermoregulation.coreTemperatureC
        - (37 + (0.005 * 250 - 0.104167 * 12) / 60),
    ) < 1e-12,
  );
  assert.equal(first.parts.interoception.heatMm, 0);
  assert.equal(first.parts.interoception.coldMm, 0);
  assert.equal(first.parts.bodyFluid.waterVolumeMl, 30000);
  assert.equal(first.parts.bodyFluid.waterDeficit, 0);
  assert.equal(first.parts.hypothalamusAdh.relativeConcentration, 1);
  assert.equal(first.parts.hypothalamusThirst.thirst, 50);
  assert.equal(first.parts.kidney.urineProductionRequestMl, 1);
  assert.deepEqual(first.parts.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.deepEqual(first.parts.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assert.deepEqual(first.parts.muscleGlucose, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
  const initialRegionGlycogen = {
    muscleHead: 15,
    muscleTrunk: 135,
    muscleLimbs: 150,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(first.parts[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(first.parts.pancreasEndocrine, { insulinPmolL: 60, glucagonRelative: 1 });
  assert.equal(first.parts.hypothalamusEndocrine.trhRelative, 1);
  assert.ok(Number.isFinite(first.parts.hypothalamusEndocrine.crhRelative));
  assert.equal(first.parts.pituitary.tshRelative, 1);
  assert.ok(first.parts.pituitary.acthPgMl > 0 && Number.isFinite(first.parts.pituitary.acthPgMl));
  assert.ok(first.parts.pituitary.prolactinNgMl > 0 && Number.isFinite(first.parts.pituitary.prolactinNgMl));
  assert.ok(first.parts.pituitary.oxytocinPgMl > 0 && Number.isFinite(first.parts.pituitary.oxytocinPgMl));
  assert.deepEqual(first.parts.thyroid, { thyroxineRelative: 1 });
  assert.ok(first.parts.adrenal.cortisolNmolL > 170 && first.parts.adrenal.cortisolNmolL < 190);
  assert.ok(Number.isFinite(first.parts.reward.wantingMm));
  assert.ok(Number.isFinite(first.parts.reward.hedonicMm));
  assert.ok(Number.isFinite(first.parts.reward.satietyMm));
  const midnightCurve = 1 + 0.8 * Math.cos((2 * Math.PI * (1 / 60 - 2)) / 24);
  const expectedAwakeSuppressed = 0.2 + (midnightCurve - 0.2) * (1 - 120 / (120 + 100));
  const expectedMelatonin = 1 + (expectedAwakeSuppressed - 1) * (1 - 2 ** (-1 / 39.4));
  assert.ok(
    Math.abs(first.parts.pineal.melatoninRelative - expectedMelatonin) < 1e-12,
  );
  assert.equal(first.parts.interoception.stressMm, 0);
  assert.ok(first.parts.interoception.sleepinessMm >= 0 && first.parts.interoception.sleepinessMm <= 25);
  assert.deepEqual(first.parts.sleep, {
    sleeping: false,
    sleepPressureMm: 0.08,
    sleepDurationMin: 0,
    sleepStage: 'awake',
    sleepInertiaMm: 0,
    wakeEvent: 'none',
  });
  assert.deepEqual(first.parts.liver, {
    glycogenCapacityG: 100,
    glycogenG: 80 - 0.096,
    storageG: 0,
    storageRequestG: 0,
    outputG: 0.096,
  });
  assert.deepEqual(first.parts.glucose, {
    glucoseMassG: 12.69,
    concentrationMgDl: 90,
    disposedGlucoseG: 0.12,
    excessMassG: 0,
  });
  assert.equal(first.parts.bladder.volumeMl, 0);
  assert.deepEqual(first.parts.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(first.parts.sexualResponse, {
    arousalMm: 0,
    phase: 'rest',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
    afterglowMm: 0,
  });
  assert.equal(first.parts.interoception.sexualArousalMm, 0);
  assert.equal(first.parts.interoception.libidoMm, 0, 'root manifest has no testes, so libido falls back to 0');
  assert.deepEqual(first.parts.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(first.parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
  assert.deepEqual(first.parts.bloodOxygen, {
    oxygenConsumptionMlMin: 250,
    oxygenSupplyMlMin: 250,
    spo2Percent: 97,
    oxygenDeficit: 0,
  });
  assert.deepEqual(first.parts.lungsVentilation, {
    tidalVolumeMl: 500,
    respiratoryRatePerMin: (250 * 1.4 / 0.058333) / 500,
    ventilationMlMin: 250 * 1.4 / 0.058333,
    alveolarO2MlMin: 250,
    alveolarO2CapacityMlMin: 60000 * (0.058333 / 1.4),
  });
  assert.equal(first.parts.interoception.dyspneaMm, 0);
  assert.deepEqual(first.parts.salivaryGlands, {
    salivaRateMlPerMin: 1.5,
    mealStimulusMin: 5,
    mouthMoistureMm: 100,
  });
  assert.equal(first.parts.interoception.dryMouthMm, 0);
  assert.equal(first.parts.brainNotify.lastSessionId, null);
  assert.deepEqual(first.parts.brainNotify.sessions, {});

  await gateway.tick();

  const second = await (await fetch(`http://127.0.0.1:${info.port}/state`)).json();
  assert.ok(second.parts.stomach.volumeMl < first.parts.stomach.volumeMl);
  assert.ok(second.parts.stomach.emptiedWaterMl > 0);
  assert.ok(second.parts.smallIntestine.waterVolumeMl > 0);
  assert.deepEqual(second.parts.esophagus, {
    bolusVolumeMl: 0,
    transitMin: 0,
    chokingMm: 0,
    intakeQueue: [],
  });
  assert.ok(second.parts.bodyFluid.waterVolumeMl < 30000);
  assert.equal(second.parts.bladder.volumeMl, 1);
  assert.equal(second.parts.hypothalamusThirst.thirst, 50);
  assert.ok(second.parts.interoception.fullness > 0);
  assert.ok(second.parts.interoception.hunger < 50);
  assert.deepEqual(second.parts.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(second.parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
});

test('the root manifest fails to start when the skin transfer target is missing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-no-skin-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
    profile: { timezoneOffsetMin: 0 },
  }));
  const rootManifest = JSON.parse(readFileSync(join(root, 'body-modules.json'), 'utf8'));
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts
      .filter((path) => !path.includes('/skin/'))
      .map((path) => relative(dir, join(root, path))),
  }));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    gateway.ready,
    /transferOut target "skin\.sweatVolumeMl" is not declared/,
  );
});

test('the root manifest fails to start when the lungs transfer target is missing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-no-lungs-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
    profile: { timezoneOffsetMin: 0 },
  }));
  const rootManifest = JSON.parse(readFileSync(join(root, 'body-modules.json'), 'utf8'));
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts
      .filter((path) => !path.includes('/lungs/'))
      .map((path) => relative(dir, join(root, path))),
  }));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    gateway.ready,
    /transferOut target "lungs\.respiratoryWaterLossMl" is not declared/,
  );
});

test('the root manifest fails to start when the muscle glucose transfer target is missing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-no-muscle-glucose-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
    profile: { timezoneOffsetMin: 0 },
  }));
  const rootManifest = JSON.parse(readFileSync(join(root, 'body-modules.json'), 'utf8'));
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts
      .filter((path) => !path.includes('/skeletal-muscle/glucose-uptake'))
      .map((path) => relative(dir, join(root, path))),
  }));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    gateway.ready,
    /transferOut target "muscleGlucose\.uptakeG" is not declared/,
  );
});
