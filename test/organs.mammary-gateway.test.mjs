import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const femaleManifestPath = join(root, 'body-modules.female.json');
const initialBodyWaterMl = 30000;

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

function writeState(dir, parts = {}) {
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  return statePath;
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function emptyAccumulator() {
  return { voidedMl: 0, sweatMl: 0, lungsMl: 0, bleedingMl: 0, milkMl: 0 };
}

function accumulate(accumulator, parts) {
  accumulator.voidedMl += parts.bladder.voidedMl;
  accumulator.sweatMl += parts.skin.sweatVolumeMl;
  accumulator.lungsMl += parts.lungs.respiratoryWaterLossMl;
  accumulator.bleedingMl += parts.uterus.bleedingMl;
  accumulator.milkMl += parts.mammaryGlands.milkMl;
}

function waterLedgerMl(parts, accumulator) {
  return parts.stomach.waterVolumeMl
    + queuedWaterMl(parts.stomach)
    + parts.smallIntestine.waterVolumeMl
    + (parts.bodyFluid.waterVolumeMl - initialBodyWaterMl)
    + parts.bladder.volumeMl
    + accumulator.voidedMl
    + accumulator.sweatMl
    + accumulator.lungsMl
    + accumulator.bleedingMl
    + accumulator.milkMl;
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('seeded prolactin drives milk, the lactose sink and mammary discomfort in the female manifest', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-'));
  const statePath = writeState(dir, {
    pituitary: { prolactinRelative: 3 },
    mammaryGlands: { fullnessMm: 68 },
  });
  const gateway = boot(femaleManifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const booted = gateway.getState().parts;
  assert.equal(Object.keys(booted).length, 41);
  assert.ok(booted.mammaryGlands, 'the female manifest must load mammaryGlands');
  assert.equal(booted.pituitary.prolactinRelative, 3);
  assert.equal(booted.mammaryGlands.fullnessMm, 68);

  const accumulator = emptyAccumulator();

  await gateway.tick();
  const first = gateway.getState().parts;
  assertClose(first.mammaryGlands.milkRequestMl, 1.5, 'round 1 milk request at prolactin 3');
  assertClose(first.mammaryGlands.lactoseRequestG, 0.105, 'round 1 lactose request');
  assert.equal(first.mammaryGlands.milkMl, 0, 'round 1 pays the round-start request of zero');
  assert.equal(first.mammaryGlands.lactoseG, 0);
  assertClose(first.mammaryGlands.fullnessMm, 74, 'fullness rises by 4 mm per unremoved mL');
  assert.equal(first.interoception.discomfort, 0, 'round 1 still reads the seeded fullness 68');
  assert.ok(first.pituitary.prolactinRelative > 2.9, 'prolactin decays toward its target');
  accumulate(accumulator, first);
  assertClose(waterLedgerMl(first, accumulator), 0, 'round 1 water ledger');

  await gateway.tick();
  const second = gateway.getState().parts;
  assertClose(second.mammaryGlands.milkMl, 1.5, 'round 2 pays the 1.5 mL milk request');
  assertClose(second.mammaryGlands.lactoseG, 0.105, 'round 2 pays the lactose request');
  assertClose(second.glucose.glucoseMassG, 12.69 - 0.105, 'the lactose sink leaves the glucose pool');
  assert.ok(second.mammaryGlands.lactoseG > 0);
  assert.ok(second.mammaryGlands.fullnessMm > 74, 'fullness keeps rising while production exceeds payout');
  assertClose(second.interoception.discomfort, (100 * (74 - 70)) / (100 - 70), 'round 2 discomfort reads fullness 74');
  accumulate(accumulator, second);
  assert.ok(accumulator.milkMl > 0, 'the water ledger must accumulate actual milk');
  assertClose(waterLedgerMl(second, accumulator), 0, 'round 2 water ledger includes mammaryGlands.milkMl');

  await gateway.tick();
  const third = gateway.getState().parts;
  assert.ok(third.mammaryGlands.milkMl > 0, 'milk keeps being paid');
  assert.ok(third.mammaryGlands.lactoseG > 0, 'the lactose sink keeps being paid');
  assert.ok(third.interoception.discomfort > second.interoception.discomfort, 'discomfort follows the higher fullness');
  accumulate(accumulator, third);
  assertClose(waterLedgerMl(third, accumulator), 0, 'round 3 water ledger');
});

test('the root manifest has no mammary part and still boots with the three-sink glucose entry', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-root-'));
  const statePath = writeState(dir);
  const gateway = boot(rootManifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const parts = gateway.getState().parts;
  assert.equal(Object.keys(parts).length, 38);
  assert.equal(Object.hasOwn(parts, 'mammaryGlands'), false);
  assert.equal(parts.pituitary.prolactinRelative, 1);

  await gateway.tick();
  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(Object.hasOwn(after, 'mammaryGlands'), false);
  assert.deepEqual(after.glucose, {
    glucoseMassG: 12.69,
    concentrationMgDl: 90,
    disposedGlucoseG: 0,
    excessMassG: 0,
  });
  assert.equal(after.pituitary.prolactinRelative, 1);
  assert.equal(after.interoception.discomfort, 0);
});

test('a female manifest without mammaryGlands fails at startup on the undeclared target', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-missing-'));
  const femaleManifest = JSON.parse(readFileSync(femaleManifestPath, 'utf8'));
  const manifestPath = join(dir, 'body-modules.female.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...femaleManifest,
    startupScripts: femaleManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: femaleManifest.scripts
      .filter((path) => !path.includes('/mammary-glands/'))
      .map((path) => relative(dir, join(root, path))),
  }));
  const statePath = writeState(dir);
  const gateway = boot(manifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    gateway.ready,
    /transferOut target "mammaryGlands\.milkMl" is not declared/,
  );
});

test('a restart on the same state path continues mammary requests and payouts', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-restart-'));
  const statePath = writeState(dir, { pituitary: { prolactinRelative: 3 } });
  let gateway = boot(femaleManifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  await gateway.tick();
  await gateway.tick();
  const before = gateway.getState();
  assert.ok(before.parts.mammaryGlands.milkMl > 0, 'the first run must pay milk');
  assert.ok(before.parts.mammaryGlands.lactoseG > 0, 'the first run must pay lactose');
  await gateway.stop();

  gateway = boot(femaleManifestPath, statePath);
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(after.mammaryGlands.milkMl > 0, true, 'milk payout resumes after restart');
  assert.equal(after.mammaryGlands.lactoseG > 0, true, 'lactose payout resumes after restart');
  assert.ok(after.mammaryGlands.milkRequestMl > 0);
  assert.ok(after.pituitary.prolactinRelative > 1);
});
