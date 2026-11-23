import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const BASAL_RATE_ML_PER_MIN = 0.5;
const MEAL_GAIN = 3;
const BASAL_MOISTURE_MM = 100 / MEAL_GAIN;

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-salivary-gateway-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);

  const gateways = [];
  async function boot() {
    const gateway = startGateway({
      manifestPath: rootManifestPath,
      statePath,
      port: 0,
      autoTick: false,
      now: () => 0,
    });
    gateways.push(gateway);
    await gateway.ready;
    return gateway;
  }

  const gateway = await boot();
  t.after(async () => {
    for (const started of gateways) await started.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return { gateway, statePath, boot };
}

test('eat and drink raise saliva threefold for five rounds and then return to basal', async (t) => {
  for (const [label, action] of [
    ['eat', { id: 'meal', type: 'eat', volumeMl: 300, energyKcal: 300, mealKind: 'solid' }],
    ['drink', { id: 'drink', type: 'drink', volumeMl: 240 }],
  ]) {
    const { gateway } = await startBody(t);
    assert.equal(gateway.submitAction(action).statusCode, 202);

    for (let round = 1; round <= 5; round++) {
      await gateway.tick();
      const saliva = gateway.getState().parts.salivaryGlands;
      assert.equal(saliva.mealStimulusMin, 6 - round, `${label} round ${round}: stimulus window`);
      assert.ok(
        saliva.salivaRateMlPerMin > BASAL_RATE_ML_PER_MIN * MEAL_GAIN * 0.99
          && saliva.salivaRateMlPerMin <= BASAL_RATE_ML_PER_MIN * MEAL_GAIN,
        `${label} round ${round}: stimulated rate, got ${saliva.salivaRateMlPerMin}`,
      );
      assert.ok(
        saliva.mouthMoistureMm > 99 && saliva.mouthMoistureMm <= 100,
        `${label} round ${round}: moisture, got ${saliva.mouthMoistureMm}`,
      );
      const dryMouth = gateway.getState().parts.interoception.dryMouthMm;
      if (round === 1) {
        assertClose(dryMouth, 100 - BASAL_MOISTURE_MM, `${label} round 1: dry mouth`);
      } else {
        assert.ok(dryMouth < 1, `${label} round ${round}: dry mouth, got ${dryMouth}`);
      }
    }

    await gateway.tick();
    const saliva = gateway.getState().parts.salivaryGlands;
    assert.equal(saliva.mealStimulusMin, 0, `${label}: window exhausted`);
    assert.ok(
      Math.abs(saliva.salivaRateMlPerMin - BASAL_RATE_ML_PER_MIN) < 0.01,
      `${label}: rate returns to basal, got ${saliva.salivaRateMlPerMin}`,
    );
    assert.ok(
      saliva.mouthMoistureMm > 30 && saliva.mouthMoistureMm < 40,
      `${label}: moisture returns to the basal readout, got ${saliva.mouthMoistureMm}`,
    );

    await gateway.tick();
    assert.ok(
      gateway.getState().parts.interoception.dryMouthMm > 60,
      `${label}: dry mouth returns once the stimulus expires`,
    );
  }
});

test('a carbohydrate meal raises nutrient exposure by the stimulated salivary amylase gain', async (t) => {
  const { gateway } = await startBody(t);
  assert.equal(gateway.submitAction({
    id: 'carb-meal',
    type: 'eat',
    volumeMl: 300,
    energyKcal: 300,
    mealKind: 'solid',
    carbohydrateG: 50,
  }).statusCode, 202);

  await gateway.tick();
  await gateway.tick();
  const before = gateway.getState().parts;
  await gateway.tick();
  const exposure = gateway.getState().parts.duodenum.nutrientExposure;

  assert.ok(before.stomach.emptiedCarbohydrateG > 0, 'the meal must empty carbohydrate');
  assertClose(before.salivaryGlands.salivaRateMlPerMin, BASAL_RATE_ML_PER_MIN * MEAL_GAIN, 'stimulated saliva');

  const arrivalWithoutGain = before.stomach.emptiedKcal * (1 - Math.exp(-1 / 10));
  const expected = arrivalWithoutGain * (1 + 0.05 * MEAL_GAIN);
  assertClose(exposure, expected, 'exposure with the amylase gain');
  assert.ok(exposure > arrivalWithoutGain, 'the amylase gain must raise exposure above the unstimulated base');
});

test('a dehydrated checkpoint lowers saliva and raises dry mouth on the next round', async (t) => {
  const { gateway } = await startBody(t, {
    parts: { bodyFluid: { waterVolumeMl: 29750, waterDeficit: 0.5 } },
  });

  await gateway.tick();
  let parts = gateway.getState().parts;
  assertClose(parts.salivaryGlands.salivaRateMlPerMin, BASAL_RATE_ML_PER_MIN * 0.75, 'dehydrated rate');
  assertClose(parts.salivaryGlands.mouthMoistureMm, 25, 'dehydrated moisture');
  assertClose(parts.interoception.dryMouthMm, 100 - BASAL_MOISTURE_MM, 'dry mouth still reads the round-start moisture');

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.ok(parts.salivaryGlands.salivaRateMlPerMin < BASAL_RATE_ML_PER_MIN, 'saliva stays below basal');
  assertClose(parts.interoception.dryMouthMm, 75, 'dry mouth follows the reduced moisture');
  assert.ok(parts.interoception.dryMouthMm > 100 - BASAL_MOISTURE_MM, 'dry mouth rises above the hydrated baseline');
});

test('restarting on the same statePath keeps the saliva stimulus window', async (t) => {
  const { gateway: first, boot } = await startBody(t);
  assert.equal(first.submitAction({
    id: 'restart-meal',
    type: 'eat',
    volumeMl: 300,
    energyKcal: 300,
    mealKind: 'solid',
  }).statusCode, 202);
  await first.tick();
  await first.tick();

  const before = first.getState();
  assert.equal(before.parts.salivaryGlands.mealStimulusMin, 4);
  assertClose(before.parts.salivaryGlands.salivaRateMlPerMin, BASAL_RATE_ML_PER_MIN * MEAL_GAIN, 'before restart');
  await first.stop();

  const second = await boot();
  const restored = second.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  await second.tick();
  const saliva = second.getState().parts.salivaryGlands;
  assert.equal(saliva.mealStimulusMin, 3, 'the window keeps decaying after restart');
  assertClose(saliva.salivaRateMlPerMin, BASAL_RATE_ML_PER_MIN * MEAL_GAIN, 'stimulus survives restart');
  assertClose(saliva.mouthMoistureMm, 100, 'moisture survives restart');
});
