import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const ventilationEntry = './organs/human-organs/lungs/ventilation.ts';

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function boot(manifestPath, statePath) {
  return startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
}

function createBody(t, { parts = {}, prepare } = {}) {
  const base = join(tmpdir(), 'dsh-body');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'oxygen-task4.'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  const manifestPath = prepare ? prepare(dir) : rootManifestPath;
  silence(t);
  const gateways = [];
  t.after(async () => {
    for (const gateway of gateways) await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    statePath,
    async start() {
      const gateway = boot(manifestPath, statePath);
      gateways.push(gateway);
      await gateway.ready;
      return gateway;
    },
  };
}

function prepareLowCapacityManifest(dir) {
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const sourceDir = join(root, 'organs/human-organs/lungs');
  const targetDir = join(dir, 'organs/human-organs/lungs');
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(join(sourceDir, 'ventilation.ts'), join(targetDir, 'ventilation.ts'));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  copyFileSync(join(root, 'lib/parameters.js'), join(dir, 'lib/parameters.js'));

  const parameters = JSON.parse(
    readFileSync(join(sourceDir, 'ventilation.parameters.json'), 'utf8'),
  );
  const maxVentilation = parameters.parameters.find(
    (parameter) => parameter.id === 'lungsVentilation.maxVentilationMlMin',
  );
  assert.equal(maxVentilation.value, 60000, 'low-capacity variant starts from the root default');
  maxVentilation.value = 6000;
  writeFileSync(join(targetDir, 'ventilation.parameters.json'), JSON.stringify(parameters));

  const manifest = {
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts.map((entry) => {
      const path = typeof entry === 'string' ? entry : entry.path;
      if (path === ventilationEntry) return './organs/human-organs/lungs/ventilation.ts';
      return relative(dir, join(root, path));
    }),
  };
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

test('exercise and sex raise demand and ventilation with SpO2 at baseline from the first activity round', async (t) => {
  for (const type of ['exercise', 'sex']) {
    const body = createBody(t);
    const gateway = await body.start();
    assert.equal(
      gateway.submitAction({ id: `${type}-1`, type, intensity: 1, durationMin: 10 }).statusCode,
      202,
    );

    let peakDemandMlMin = 0;
    let peakVentilationMlMin = 0;
    for (let round = 1; round <= 10; round++) {
      await gateway.tick();
      const { bloodOxygen, lungsVentilation, interoception } = gateway.getState().parts;
      peakDemandMlMin = Math.max(peakDemandMlMin, bloodOxygen.oxygenConsumptionMlMin);
      peakVentilationMlMin = Math.max(peakVentilationMlMin, lungsVentilation.ventilationMlMin);
      assert.equal(bloodOxygen.spo2Percent, 97, `${type} round ${round}: SpO2`);
      assert.equal(bloodOxygen.oxygenDeficit, 0, `${type} round ${round}: deficit`);
      assert.equal(
        bloodOxygen.oxygenSupplyMlMin,
        bloodOxygen.oxygenConsumptionMlMin,
        `${type} round ${round}: supply`,
      );
      assert.equal(interoception.dyspneaMm, 0, `${type} round ${round}: dyspnea`);
    }
    assert.equal(peakDemandMlMin, 1300, `${type}: peak demand`);
    assert.ok(
      peakVentilationMlMin > 6000,
      `${type}: ventilation must rise above resting, got ${peakVentilationMlMin}`,
    );
  }
});

test('a meal raises duodenum nutrient exposure and the digestive oxygen demand', async (t) => {
  const body = createBody(t);
  const gateway = await body.start();
  assert.equal(
    gateway.submitAction({
      id: 'meal-1',
      type: 'eat',
      volumeMl: 300,
      energyKcal: 200,
      mealKind: 'solid',
    }).statusCode,
    202,
  );

  let digestionRound = null;
  for (let round = 1; round <= 30; round++) {
    const exposureBefore = gateway.getState().parts.duodenum.nutrientExposure;
    await gateway.tick();
    const { bloodOxygen, duodenum } = gateway.getState().parts;
    const expectedDemandMlMin = 250 * (0.8 + 0.4) + 0.1 * exposureBefore * 250;
    assert.ok(
      Math.abs(bloodOxygen.oxygenConsumptionMlMin - expectedDemandMlMin) < 1e-9,
      `round ${round}: demand ${bloodOxygen.oxygenConsumptionMlMin} != ${expectedDemandMlMin}`,
    );
    assert.equal(bloodOxygen.spo2Percent, 97, `round ${round}: SpO2`);
    if (exposureBefore > 0 && digestionRound === null) digestionRound = round;
    if (round === 30) {
      assert.ok(duodenum.nutrientExposure > 0, 'the meal must raise nutrient exposure');
    }
  }
  assert.ok(digestionRound !== null, 'digestive oxygen demand must rise above basal');
});

test('a low ventilation capacity caps supply and raises dyspnea above zero', async (t) => {
  const body = createBody(t, { prepare: prepareLowCapacityManifest });
  const gateway = await body.start();
  assert.equal(
    gateway.submitAction({
      id: 'exercise-low-capacity',
      type: 'exercise',
      intensity: 1,
      durationMin: 30,
    }).statusCode,
    202,
  );

  for (let round = 1; round <= 5; round++) {
    await gateway.tick();
    const { bloodOxygen, lungsVentilation, interoception } = gateway.getState().parts;
    if (round === 1) {
      assert.equal(bloodOxygen.oxygenConsumptionMlMin, 250 * (0.8 + 0.4));
      assert.equal(bloodOxygen.spo2Percent, 97);
      assert.equal(interoception.dyspneaMm, 0);
    }
    if (round >= 2) {
      assert.equal(bloodOxygen.oxygenConsumptionMlMin, 1300);
      assert.equal(bloodOxygen.oxygenSupplyMlMin, 900);
      assert.equal(bloodOxygen.oxygenDeficit, 400 / 1300);
      assert.equal(bloodOxygen.spo2Percent, 97 * (900 / 1300));
      assert.equal(lungsVentilation.ventilationMlMin, 6000);
      assert.equal(lungsVentilation.alveolarO2MlMin, 900);
      assert.equal(lungsVentilation.alveolarO2CapacityMlMin, 900);
    }
    if (round >= 3) {
      assert.ok(
        Math.abs(interoception.dyspneaMm - (100 * 400) / 1300) < 1e-9,
        `round ${round}: dyspnea ${interoception.dyspneaMm}`,
      );
    }
  }
});

test('restarting on the same statePath continues the supply and demand chain', async (t) => {
  const body = createBody(t);
  let gateway = await body.start();
  assert.equal(
    gateway.submitAction({
      id: 'exercise-restart',
      type: 'exercise',
      intensity: 1,
      durationMin: 30,
    }).statusCode,
    202,
  );
  for (let round = 1; round <= 5; round++) await gateway.tick();

  const before = gateway.getState();
  assert.equal(before.parts.bloodOxygen.oxygenConsumptionMlMin, 1300);
  assert.equal(before.parts.bloodOxygen.oxygenSupplyMlMin, 1300);
  assert.equal(before.parts.bloodOxygen.spo2Percent, 97);
  assert.ok(
    before.parts.lungsVentilation.ventilationMlMin > 8666.6
      && before.parts.lungsVentilation.ventilationMlMin < 8668,
    `thermoregulation adds a small panting term: ${before.parts.lungsVentilation.ventilationMlMin}`,
  );
  await gateway.stop();

  gateway = await body.start();
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  await gateway.tick();
  const parts = gateway.getState().parts;
  assert.equal(parts.bloodOxygen.oxygenConsumptionMlMin, 1300);
  assert.equal(parts.bloodOxygen.oxygenSupplyMlMin, 1300);
  assert.equal(parts.bloodOxygen.spo2Percent, 97);
  assert.equal(
    parts.physicalActivity.remainingExerciseMin,
    before.parts.physicalActivity.remainingExerciseMin - 1,
  );
});

test('the root body boots the endocrine parts at baseline and keeps resting demand at the T4-scaled baseline', async (t) => {
  const body = createBody(t);
  const gateway = await body.start();
  const booted = gateway.getState().parts;
  assert.deepEqual(booted.hypothalamusEndocrine, { trhRelative: 1, crhRelative: 1 });
  assert.deepEqual(booted.pituitary, { tshRelative: 1, acthRelative: 1, prolactinRelative: 1 });
  assert.deepEqual(booted.thyroid, { thyroxineRelative: 1 });
  assert.deepEqual(booted.adrenal, { cortisolRelative: 1 });
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(booted[region], {
      uptakeG: 0,
      glycogenG: 0,
      glycogenConsumedG: 0,
    }, region);
  }
  assert.equal(typeof booted.pineal.melatoninRelative, 'number');
  assert.deepEqual(booted.salivaryGlands, {
    salivaRateMlPerMin: 0.5,
    mealStimulusMin: 0,
    mouthMoistureMm: 100 / 3,
  });

  await gateway.tick();
  assert.equal(
    gateway.getState().parts.bloodOxygen.oxygenConsumptionMlMin,
    250 * (0.8 + 0.4),
  );
  assert.equal(gateway.getState().parts.bloodOxygen.oxygenDeficit, 0);
});
