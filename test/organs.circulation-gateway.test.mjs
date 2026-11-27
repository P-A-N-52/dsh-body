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
const heartEntry = './organs/human-organs/heart/heart.ts';
const bloodEntry = './organs/human-compartments/blood/blood.ts';

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
  const dir = mkdtempSync(join(tmpdir(), 'dsh-circulation-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
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

function prepareLowOutputManifest(dir) {
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const heartDir = join(dir, 'organs/human-organs/heart');
  const bloodDir = join(dir, 'organs/human-compartments/blood');
  mkdirSync(heartDir, { recursive: true });
  mkdirSync(bloodDir, { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  copyFileSync(join(root, 'organs/human-organs/heart/heart.ts'), join(heartDir, 'heart.ts'));
  copyFileSync(join(root, 'organs/human-compartments/blood/blood.ts'), join(bloodDir, 'blood.ts'));
  copyFileSync(
    join(root, 'organs/human-compartments/blood/blood.parameters.json'),
    join(bloodDir, 'blood.parameters.json'),
  );
  for (const path of ['lib/parameters.js', 'lib/thermal-profile.js', 'json-safe.js']) {
    copyFileSync(join(root, path), join(dir, path));
  }

  const heartParameters = JSON.parse(
    readFileSync(join(root, 'organs/human-organs/heart/heart.parameters.json'), 'utf8'),
  );
  const strokeVolume = heartParameters.parameters.find(
    (parameter) => parameter.id === 'heart.restingStrokeVolumeMl',
  );
  assert.equal(strokeVolume.value, 70, 'the low-output variant starts from the root default');
  strokeVolume.value = 10;
  writeFileSync(join(heartDir, 'heart.parameters.json'), JSON.stringify(heartParameters));

  const manifest = {
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts.map((entry) => {
      if (entry === heartEntry) return './organs/human-organs/heart/heart.ts';
      if (entry === bloodEntry) return './organs/human-compartments/blood/blood.ts';
      return relative(dir, join(root, entry));
    }),
  };
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

function exercise(gateway, id) {
  assert.equal(
    gateway.submitAction({ id, type: 'exercise', intensity: 1, durationMin: 10 }).statusCode,
    202,
  );
}

test('exercise raises heart rate, cardiac output and oxygen delivery while SpO2 stays at baseline', async (t) => {
  const body = createBody(t);
  const gateway = await body.start();
  const resting = gateway.getState().parts;
  assert.deepEqual(resting.heart, {
    heartRatePerMin: 70,
    strokeVolumeMl: 70,
    cardiacOutputMlMin: 4900,
    maxCardiacOutputMlMin: 16380,
  });
  assert.equal(resting.blood.systolicMmHg, 120);
  assert.equal(resting.blood.diastolicMmHg, 80);

  exercise(gateway, 'exercise-circulation');
  await gateway.tick();
  await gateway.tick();

  const active = gateway.getState().parts;
  assert.equal(active.heart.heartRatePerMin, 175);
  assert.equal(active.heart.cardiacOutputMlMin, 15925);
  assert.ok(active.heart.cardiacOutputMlMin > resting.heart.cardiacOutputMlMin);
  assert.equal(active.bloodOxygen.oxygenConsumptionMlMin, 1250);
  assert.equal(active.bloodOxygen.oxygenSupplyMlMin, 1250);
  assert.equal(active.bloodOxygen.spo2Percent, 97);

  const deliveryBefore = active.blood.oxygenDeliveryMlMin;
  await gateway.tick();
  const transported = gateway.getState().parts;
  assert.ok(
    transported.blood.oxygenDeliveryMlMin > deliveryBefore,
    `${transported.blood.oxygenDeliveryMlMin} must exceed ${deliveryBefore}`,
  );
  assert.ok(transported.blood.oxygenDeliveryMlMin > resting.blood.oxygenDeliveryMlMin);
  assert.equal(transported.bloodOxygen.spo2Percent, 97);
  assert.equal(transported.bloodOxygen.oxygenDeficit, 0);
});

test('a low blood volume lowers GFR and urine while raising ADH', async (t) => {
  const normalBody = createBody(t);
  const lowBody = createBody(t, {
    parts: { bodyFluid: { waterVolumeMl: 18000, waterDeficit: 0.4 } },
  });
  const normal = await normalBody.start();
  const low = await lowBody.start();

  for (let round = 1; round <= 8; round++) {
    await normal.tick();
    await low.tick();
  }

  const normalParts = normal.getState().parts;
  const lowParts = low.getState().parts;
  assert.ok(normalParts.blood.bloodVolumeMl > 4990 && normalParts.blood.bloodVolumeMl <= 5000);
  assert.ok(normalParts.blood.gfrMlMin > 99 && normalParts.blood.gfrMlMin <= 100);
  assert.ok(lowParts.blood.bloodVolumeMl > 2990 && lowParts.blood.bloodVolumeMl <= 3000);
  assert.ok(lowParts.blood.gfrMlMin > 59 && lowParts.blood.gfrMlMin <= 60);
  assert.ok(lowParts.blood.gfrMlMin < normalParts.blood.gfrMlMin);
  assert.ok(lowParts.heart.cardiacOutputMlMin < normalParts.heart.cardiacOutputMlMin);
  assert.ok(lowParts.blood.systolicMmHg < normalParts.blood.systolicMmHg);
  assert.ok(
    lowParts.kidney.urineProductionRequestMl < normalParts.kidney.urineProductionRequestMl,
    `low-volume request ${lowParts.kidney.urineProductionRequestMl} must be below ${normalParts.kidney.urineProductionRequestMl}`,
  );
  assert.ok(
    lowParts.bladder.volumeMl < normalParts.bladder.volumeMl,
    `low-volume urine ${lowParts.bladder.volumeMl} must be below ${normalParts.bladder.volumeMl}`,
  );
  assert.ok(
    lowParts.hypothalamusAdh.relativeConcentration
      > normalParts.hypothalamusAdh.relativeConcentration,
    'low volume must raise ADH',
  );
  assert.ok(lowParts.hypothalamusAdh.relativeConcentration > 1.1);
});

test('a low-output heart desaturates blood oxygen during exercise', async (t) => {
  const body = createBody(t, { prepare: prepareLowOutputManifest });
  const gateway = await body.start();
  exercise(gateway, 'exercise-low-output');

  await gateway.tick();
  await gateway.tick();
  const desaturated = gateway.getState().parts;
  assert.ok(desaturated.heart.cardiacOutputMlMin < 6000, 'the variant heart has low output');
  assert.equal(desaturated.bloodOxygen.oxygenConsumptionMlMin, 1250);
  assert.ok(desaturated.bloodOxygen.oxygenSupplyMlMin < 1250);
  assert.ok(desaturated.bloodOxygen.spo2Percent < 97);
  assert.ok(desaturated.bloodOxygen.spo2Percent > 0);
  assert.ok(desaturated.bloodOxygen.oxygenDeficit > 0);

  await gateway.tick();
  const transported = gateway.getState().parts;
  assert.ok(
    transported.blood.oxygenDeliveryMlMin < transported.bloodOxygen.oxygenConsumptionMlMin,
    'the lagged oxygen delivery readout must also be below demand',
  );
  assert.ok(transported.interoception.dyspneaMm > 0, 'desaturation must raise dyspnea');
});

test('restarting on the same state path continues the circulation chain', async (t) => {
  const body = createBody(t);
  let gateway = await body.start();
  exercise(gateway, 'exercise-circulation-restart');
  for (let round = 1; round <= 3; round++) await gateway.tick();

  const before = gateway.getState();
  assert.equal(before.parts.heart.heartRatePerMin, 175);
  assert.equal(before.parts.blood.oxygenDeliveryMlMin, 15925 * (97 * 2) / 1000);
  assert.equal(before.parts.bloodOxygen.spo2Percent, 97);
  await gateway.stop();

  gateway = await body.start();
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(after.heart.heartRatePerMin, 175);
  assert.ok(
    after.heart.cardiacOutputMlMin <= 15925 && after.heart.cardiacOutputMlMin > 15900,
    `cardiac output reflects slight preload water loss: ${after.heart.cardiacOutputMlMin}`,
  );
  assert.equal(after.bloodOxygen.spo2Percent, 97);
  assert.equal(
    after.physicalActivity.remainingExerciseMin,
    before.parts.physicalActivity.remainingExerciseMin - 1,
  );
  assert.ok(
    after.thermoregulation.coreTemperatureC > before.parts.thermoregulation.coreTemperatureC,
  );
});
