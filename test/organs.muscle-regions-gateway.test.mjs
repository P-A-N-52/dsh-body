import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const muscleRegions = ['muscleHead', 'muscleTrunk', 'muscleLimbs'];
const regionShares = { muscleHead: 0.05, muscleTrunk: 0.45, muscleLimbs: 0.5 };
const normalAggregatorPath = './organs/human-organs/skeletal-muscle/glucose-uptake.ts';
const noLimbsAggregatorPath = './organs/human-organs/skeletal-muscle/glucose-uptake.no-limbs.ts';
const limbsPath = './organs/human-organs/skeletal-muscle/regions/limbs.ts';

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function makeDir(t, label) {
  const base = join(tmpdir(), 'dsh-body');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, `muscle-regions.${label}.`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
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

async function startBody(t, { manifestPath = rootManifestPath, parts = {}, dir = null } = {}) {
  const bodyDir = dir ?? makeDir(t, 'body');
  const statePath = join(bodyDir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);
  const gateway = boot(manifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
  });
  await gateway.ready;
  return { gateway, statePath, dir: bodyDir };
}

function regionSum(parts, field) {
  return muscleRegions.reduce((sum, region) => sum + parts[region][field], 0);
}

function seededRegions(glycogenG = 10) {
  return Object.fromEntries(muscleRegions.map((region) => [region, {
    uptakeG: 0,
    glycogenG,
    glycogenConsumedG: 0,
  }]));
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function writeNoLimbsManifest(t, dir) {
  const manifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const scripts = manifest.scripts
    .map((entry) => (typeof entry === 'string' ? entry : entry.path))
    .filter((path) => path !== limbsPath)
    .map((path) => relative(dir, join(root, path === normalAggregatorPath ? noLimbsAggregatorPath : path)));
  const manifestPath = join(dir, 'body-modules.no-limbs.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...manifest,
    startupScripts: manifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts,
  }));
  return manifestPath;
}

test('a carb meal fills the three regions by share and exercise consumes each region', async (t) => {
  const { gateway } = await startBody(t, { parts: seededRegions(10) });
  const queued = gateway.submitAction({
    id: 'regional-meal',
    type: 'drink',
    volumeMl: 240,
    energyKcal: 100,
    durationMin: 1,
    carbohydrateG: 60,
  });
  assert.equal(queued.statusCode, 202);

  let paymentsG = 0;
  let consumedG = 0;
  for (let round = 1; round <= 120; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    paymentsG += parts.muscleGlucose.uptakeG;
    consumedG += regionSum(parts, 'glycogenConsumedG');
    assertClose(
      regionSum(parts, 'glycogenG')
        + regionSum(parts, 'uptakeG')
        + parts.muscleGlucose.uptakeG
        + consumedG,
      seededRegions(10).muscleHead.glycogenG * muscleRegions.length + paymentsG,
      `round ${round}: regional mass ledger`,
      1e-6,
    );
    assert.equal(Object.hasOwn(parts.muscleGlucose, 'glycogenG'), false, `round ${round}: no total`);
    assert.equal(Object.hasOwn(parts.muscleGlucose, 'glycogenConsumedG'), false, `round ${round}: no total flux`);
  }

  const afterMeal = gateway.getState().parts;
  const distributedG = paymentsG - afterMeal.muscleGlucose.uptakeG;
  assert.ok(distributedG > 0, 'the meal must settle some muscle uptake');
  for (const region of muscleRegions) {
    const incrementG = afterMeal[region].glycogenG + afterMeal[region].uptakeG - 10;
    assertClose(incrementG, distributedG * regionShares[region], `${region}: meal share`, 1e-9);
  }

  const exerciseStartG = regionSum(afterMeal, 'glycogenG')
    + regionSum(afterMeal, 'uptakeG')
    + afterMeal.muscleGlucose.uptakeG;
  assert.equal(
    gateway.submitAction({
      id: 'regional-exercise',
      type: 'exercise',
      intensity: 1,
      durationMin: 5,
    }).statusCode,
    202,
  );

  let exercisePaymentsG = 0;
  for (let round = 1; round <= 7; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    exercisePaymentsG += parts.muscleGlucose.uptakeG;
    if (round === 1) {
      assert.equal(regionSum(parts, 'glycogenConsumedG'), 0, 'the action round has no round-start activity');
    } else if (round <= 6) {
      for (const region of muscleRegions) {
        assertClose(
          parts[region].glycogenConsumedG,
          0.5 * regionShares[region],
          `round ${round}: ${region} consumption`,
          1e-12,
        );
      }
      assertClose(regionSum(parts, 'glycogenConsumedG'), 0.5, `round ${round}: total consumption 0.5 g/min`, 1e-12);
    } else {
      assert.equal(regionSum(parts, 'glycogenConsumedG'), 0, 'consumption stops with the activity');
    }
  }
  const afterExercise = gateway.getState().parts;
  assertClose(
    regionSum(afterExercise, 'glycogenG')
      + regionSum(afterExercise, 'uptakeG')
      + afterExercise.muscleGlucose.uptakeG,
    exerciseStartG + exercisePaymentsG - 2.5,
    'five one-minute rounds consume 2.5 g total across the three share-scaled regions',
    1e-6,
  );
});

test('an amputee manifest without muscleLimbs boots and normalizes over the remaining regions', async (t) => {
  const dir = makeDir(t, 'amputee');
  const manifestPath = writeNoLimbsManifest(t, dir);
  const { gateway } = await startBody(t, {
    manifestPath,
    dir,
    parts: {
      muscleGlucose: {
        uptakeG: 1,
        uptakeRequestG: 0,
        glycogenG: 100,
        glycogenConsumedG: 0,
      },
    },
  });

  const booted = gateway.getState().parts;
  assert.equal(Object.keys(booted).length, 37);
  assert.ok(booted.muscleHead, 'muscleHead must be loaded');
  assert.ok(booted.muscleTrunk, 'muscleTrunk must be loaded');
  assert.equal(Object.hasOwn(booted, 'muscleLimbs'), false);

  await gateway.tick();
  const handedOff = gateway.getState().parts;
  assertClose(handedOff.muscleHead.glycogenG, 15 + 10, 'head initial 15 + legacy stock renormalized to 0.1');
  assertClose(handedOff.muscleTrunk.glycogenG, 135 + 90, 'trunk initial 135 + legacy stock renormalized to 0.9');
  assertClose(handedOff.muscleHead.uptakeG, 0.1, 'head uptake renormalized to 0.1');
  assertClose(handedOff.muscleTrunk.uptakeG, 0.9, 'trunk uptake renormalized to 0.9');
  assert.equal(handedOff.muscleGlucose.uptakeG, 0);
  assert.equal(Object.hasOwn(handedOff.muscleGlucose, 'glycogenG'), false);

  await gateway.tick();
  const booked = gateway.getState().parts;
  assertClose(booked.muscleHead.glycogenG, 25.1, 'head books its share');
  assertClose(booked.muscleTrunk.glycogenG, 225.9, 'trunk books its share');
});

test('restarting from a committed state continues regional booking and consumption', async (t) => {
  const dir = makeDir(t, 'restart');
  const { gateway, statePath } = await startBody(t, { dir, parts: seededRegions(10) });
  assert.equal(
    gateway.submitAction({
      id: 'regional-restart-meal',
      type: 'drink',
      volumeMl: 240,
      energyKcal: 100,
      durationMin: 1,
      carbohydrateG: 60,
    }).statusCode,
    202,
  );
  for (let round = 1; round <= 30; round++) await gateway.tick();
  assert.equal(
    gateway.submitAction({
      id: 'regional-restart-exercise',
      type: 'exercise',
      intensity: 1,
      durationMin: 5,
    }).statusCode,
    202,
  );
  await gateway.tick();
  await gateway.tick();

  const beforeRestart = gateway.getState();
  await gateway.stop();
  const restarted = boot(rootManifestPath, statePath);
  t.after(async () => {
    await restarted.stop();
  });
  await restarted.ready;
  const restored = restarted.getState();
  assert.equal(restored.simulatedSeconds, beforeRestart.simulatedSeconds);
  assert.deepEqual(restored.parts, beforeRestart.parts);

  await restarted.tick();
  const after = restarted.getState().parts;
  assert.equal(
    after.physicalActivity.remainingExerciseMin,
    beforeRestart.parts.physicalActivity.remainingExerciseMin - 1,
  );
  for (const region of muscleRegions) {
    assertClose(
      after[region].glycogenConsumedG,
      0.5 * regionShares[region],
      `${region}: consumption continues after restart`,
      1e-12,
    );
  }
  assert.ok(
    after.muscleHead.glycogenG > 0 && after.muscleTrunk.glycogenG > 0 && after.muscleLimbs.glycogenG > 0,
    'restored regional glycogen must be present',
  );
});

test('an old save with only muscleGlucose.glycogenG splits it across the regions and keeps in-flight uptake', async (t) => {
  const { gateway } = await startBody(t, {
    parts: {
      muscleGlucose: {
        uptakeG: 2,
        uptakeRequestG: 0,
        glycogenG: 100,
        glycogenConsumedG: 0,
      },
    },
  });

  const booted = gateway.getState().parts;
  const expectedInitial = { muscleHead: 15, muscleTrunk: 135, muscleLimbs: 150 };
  for (const region of muscleRegions) {
    assert.deepEqual(booted[region], {
      uptakeG: 0,
      glycogenG: expectedInitial[region],
      glycogenConsumedG: 0,
    }, `${region}: default initial regional glycogen`);
  }
  assert.equal(booted.muscleGlucose.glycogenG, 100, 'the legacy total is still in the boot snapshot');

  await gateway.tick();
  const migrated = gateway.getState().parts;
  assert.equal(Object.hasOwn(migrated.muscleGlucose, 'glycogenG'), false, 'the aggregator drops the legacy total');
  assert.equal(Object.hasOwn(migrated.muscleGlucose, 'glycogenConsumedG'), false);
  assertClose(migrated.muscleHead.glycogenG, 15 + 100 * 0.05, 'head stock share');
  assertClose(migrated.muscleTrunk.glycogenG, 135 + 100 * 0.45, 'trunk stock share');
  assertClose(migrated.muscleLimbs.glycogenG, 150 + 100 * 0.5, 'limbs stock share');
  assertClose(migrated.muscleHead.uptakeG, 2 * 0.05, 'head in-flight share');
  assertClose(migrated.muscleTrunk.uptakeG, 2 * 0.45, 'trunk in-flight share');
  assertClose(migrated.muscleLimbs.uptakeG, 2 * 0.5, 'limbs in-flight share');

  await gateway.tick();
  const booked = gateway.getState().parts;
  assertClose(booked.muscleHead.glycogenG, 20.1, 'head books the in-flight share next round');
  assertClose(booked.muscleTrunk.glycogenG, 180.9, 'trunk books the in-flight share next round');
  assertClose(booked.muscleLimbs.glycogenG, 201, 'limbs books the in-flight share next round');
  assertClose(
    regionSum(booked, 'glycogenG'),
    402,
    'the initial regional store plus old total plus in-flight uptake is preserved exactly',
  );
});
