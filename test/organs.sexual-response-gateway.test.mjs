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
const femaleManifestPath = join(root, 'body-modules.female.json');

const sexualInitial = {
  arousalMm: 0,
  phase: 'rest',
  remainingSexMin: 0,
  sexIntensity: 0,
  lastOrgasmAtSimMin: null,
  afterglowMm: 0,
  lastAttemptedOrgasmAtSimMin: null,
  lastOrgasmBlockReason: 'none',
};

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function arousalState(arousalMm) {
  return {
    arousalMm,
    phase: 'plateau',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
    afterglowMm: 0,
  };
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

async function startBody(t, { manifestPath = rootManifestPath, parts = {}, defaultNsfw = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sexual-gateway-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);
  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
    defaultNsfw,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, statePath };
}

test('sex raises arousal, feeds interoception and pays sweat, lung water and regional glycogen', async (t) => {
  const { gateway } = await startBody(t, {
    parts: {
      muscleHead: { uptakeG: 0, glycogenG: 10, glycogenConsumedG: 0 },
      muscleTrunk: { uptakeG: 0, glycogenG: 10, glycogenConsumedG: 0 },
      muscleLimbs: { uptakeG: 0, glycogenG: 10, glycogenConsumedG: 0 },
    },
  });
  assert.equal(
    gateway.submitAction({ id: 'sex-1', type: 'sex', intensity: 1, durationMin: 30 }).statusCode,
    202,
  );

  await gateway.tick();
  let parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.phase, 'excitement');
  assert.equal(parts.sexualResponse.remainingSexMin, 30);
  assert.equal(parts.sexualResponse.sexIntensity, 1);
  assertClose(
    parts.sexualResponse.arousalMm,
    100 * (1 - 2 ** (-1 / 5)),
    'round 1 arousal',
  );
  assert.equal(parts.interoception.sexualArousalMm, 0, 'the action round has no round-start arousal');
  assert.equal(parts.physicalActivity.intensity, 1);
  assert.equal(parts.muscleHead.glycogenConsumedG, 0);
  assert.equal(parts.muscleTrunk.glycogenConsumedG, 0);
  assert.equal(parts.muscleLimbs.glycogenConsumedG, 0);
  assert.equal(parts.skin.sweatRequestMl, 0);
  assert.deepEqual(parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });

  await gateway.tick();
  parts = gateway.getState().parts;
  assertClose(
    parts.interoception.sexualArousalMm,
    100 * (1 - 2 ** (-1 / 5)),
    'round 2 reads the round 1 arousal',
  );
  assert.equal(parts.physicalActivity.remainingExerciseMin, 29, 'sex is counted as activity');
  assertClose(
    parts.skin.sweatRequestMl,
    0.6,
    'near-37C resting temperature produces zero thermal sweat bonus over the exercise baseline request',
  );
  assert.equal(parts.lungs.respiratoryWaterLossRequestMl, 0.3);
  const expectedConsumedByRegion = {
    muscleHead: 0.025,
    muscleTrunk: 0.225,
    muscleLimbs: 0.25,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assertClose(parts[region].glycogenConsumedG, expectedConsumedByRegion[region], region);
    assert.ok(parts[region].glycogenG < 10, `${region}: the seeded glycogen is consumed`);
  }

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.ok(parts.skin.sweatVolumeMl > 0, 'sweat is paid the round after the request');
  assert.ok(parts.lungs.respiratoryWaterLossMl > 0, 'respiratory water loss is paid');
  assert.ok(parts.sexualResponse.arousalMm > 24, 'arousal keeps rising');
});

test('an invalid sex action changes neither sexualResponse nor physicalActivity', async (t) => {
  const { gateway } = await startBody(t);
  assert.equal(
    gateway.submitAction({ id: 'bad-sex', type: 'sex', intensity: 0, durationMin: 30 }).statusCode,
    202,
  );
  await gateway.tick();

  const parts = gateway.getState().parts;
  assert.equal(gateway.getReceipt('bad-sex').status, 'applied');
  assert.deepEqual(parts.sexualResponse, sexualInitial);
  assert.deepEqual(parts.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.equal(parts.interoception.sexualArousalMm, 0);
});

test('an orgasm action at seeded arousal 80 releases and then enters refractory', async (t) => {
  const { gateway } = await startBody(t, { parts: { sexualResponse: arousalState(80) } });
  assert.equal(gateway.submitAction({ id: 'orgasm-80', type: 'orgasm' }).statusCode, 202);

  await gateway.tick();
  let parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, 1);
  assert.equal(parts.sexualResponse.phase, 'orgasm');
  assertClose(parts.sexualResponse.arousalMm, 80 * 2 ** (-1 / 15), 'release round');

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, 1);
  assert.equal(parts.sexualResponse.phase, 'refractory');
  assertClose(parts.sexualResponse.arousalMm, 80 * 2 ** (-2 / 15), 'refractory round');
});

test('an orgasm action at seeded arousal 60 is ignored', async (t) => {
  const { gateway } = await startBody(t, { parts: { sexualResponse: arousalState(60) } });
  assert.equal(gateway.submitAction({ id: 'orgasm-60', type: 'orgasm' }).statusCode, 202);

  await gateway.tick();
  const parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, null);
  assert.equal(parts.sexualResponse.phase, 'resolution');
  assertClose(parts.sexualResponse.arousalMm, 60 * 2 ** (-1 / 15), 'no release');
});

test('seeded arousal 95 releases without any action', async (t) => {
  const { gateway } = await startBody(t, { parts: { sexualResponse: arousalState(95) } });

  await gateway.tick();
  let parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, 1);
  assert.equal(parts.sexualResponse.phase, 'orgasm');
  assertClose(parts.sexualResponse.arousalMm, 95 * 2 ** (-1 / 15), 'forced release round');

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.phase, 'refractory');
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, 1);
});

test('the female manifest loads sexualResponse and releases on orgasm', async (t) => {
  const { gateway } = await startBody(t, {
    manifestPath: femaleManifestPath,
    parts: { sexualResponse: arousalState(80) },
  });

  assert.equal(Object.keys(gateway.getState().parts).length, 48);
  assert.ok(gateway.getState().parts.reward, 'reward must be loaded');
  assert.ok(gateway.getState().parts.liver, 'liver must be loaded');
  assert.ok(gateway.getState().parts.muscleHead, 'muscleHead must be loaded');
  assert.ok(gateway.getState().parts.muscleTrunk, 'muscleTrunk must be loaded');
  assert.ok(gateway.getState().parts.muscleLimbs, 'muscleLimbs must be loaded');
  assert.ok(gateway.getState().parts.bloodOxygen, 'bloodOxygen must be loaded');
  assert.ok(gateway.getState().parts.lungsVentilation, 'lungsVentilation must be loaded');
  assert.ok(gateway.getState().parts.thyroid, 'thyroid must be loaded');
  assert.ok(gateway.getState().parts.adrenal, 'adrenal must be loaded');
  assert.ok(gateway.getState().parts.pineal, 'pineal must be loaded');
  assert.ok(gateway.getState().parts.mammaryGlands, 'mammaryGlands must be loaded');
  assert.deepEqual(gateway.getCapabilities().sex, ['physicalActivity', 'sexualResponse']);
  assert.deepEqual(gateway.getCapabilities().orgasm, ['sexualResponse']);
  assert.equal(gateway.submitAction({ id: 'female-orgasm', type: 'orgasm' }).statusCode, 202);

  await gateway.tick();
  const parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, 1);
  assert.equal(parts.sexualResponse.phase, 'orgasm');
});

test('nsfw false hides sex and orgasm capabilities and rejects them with 403', async (t) => {
  const { gateway } = await startBody(t, {
    defaultNsfw: false,
    parts: { sexualResponse: arousalState(80) },
  });
  const capabilities = gateway.getCapabilities();
  assert.equal(Object.hasOwn(capabilities, 'sex'), false);
  assert.equal(Object.hasOwn(capabilities, 'orgasm'), false);
  assert.equal(gateway.submitAction({ id: 'sex-403', type: 'sex', intensity: 1, durationMin: 10 }).statusCode, 403);
  assert.equal(gateway.submitAction({ id: 'orgasm-403', type: 'orgasm' }).statusCode, 403);
});
