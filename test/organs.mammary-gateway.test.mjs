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

function boot(manifestPath, statePath, { defaultNsfw = false } = {}) {
  return startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
    defaultNsfw,
  });
}

function writeState(dir, parts = {}, profile) {
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
    ...(profile === undefined ? {} : { profile }),
  })));
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

test('default female manifest does not lactate and starts with prolactin 8 ng/mL', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-default-'));
  const statePath = writeState(dir);
  const gateway = boot(femaleManifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const booted = gateway.getState().parts;
  assert.equal(booted.mammaryGlands.lactating, false);
  assert.equal(booted.pituitary.prolactinNgMl, 8);

  const accumulator = emptyAccumulator();
  for (let round = 1; round <= 10; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(parts.mammaryGlands.lactating, false);
    assert.equal(parts.mammaryGlands.milkRequestMl, 0);
    assert.equal(parts.mammaryGlands.milkMl, 0);
    assert.equal(parts.mammaryGlands.lactoseRequestG, 0);
    assert.equal(parts.mammaryGlands.lactoseG, 0);
    assert.equal(parts.mammaryGlands.fullnessMm, 0);
    assert.ok(parts.pituitary.prolactinNgMl > 0);
    assert.equal(Object.hasOwn(parts.pituitary, 'prolactinRelative'), false);
    assertClose(parts.glucose.concentrationMgDl, 90, `round ${round}: fasting glucose`);
    accumulate(accumulator, parts);
    assertClose(waterLedgerMl(parts, accumulator), 0, `round ${round}: water ledger`);
  }
  assert.equal(accumulator.milkMl, 0);
});

test('seeded lactating female with prolactin drives milk, the lactose sink and discomfort without ratcheting', async (t) => {
  silence(t);
  const safeDir = mkdtempSync(join(tmpdir(), 'dsh-mammary-safe-'));
  const safeStatePath = writeState(safeDir, {
    pituitary: { prolactinNgMl: 24 },
    mammaryGlands: { lactating: true, fullnessMm: 80 },
  });
  const safeGateway = boot(femaleManifestPath, safeStatePath);
  t.after(async () => {
    await safeGateway.stop();
    rmSync(safeDir, { recursive: true, force: true });
  });
  await safeGateway.ready;
  await safeGateway.tick();
  const safeParts = safeGateway.getState().parts;
  assert.equal(safeParts.mammaryGlands.lactating, false, 'nsfw false forces mammaryGlands non-lactating');
  assert.equal(safeParts.mammaryGlands.milkRequestMl, 0);
  assert.equal(safeParts.mammaryGlands.milkMl, 0);
  assert.equal(safeParts.mammaryGlands.lactoseRequestG, 0);
  assert.equal(safeParts.mammaryGlands.lactoseG, 0);

  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-'));
  const statePath = writeState(dir, {
    pituitary: { prolactinNgMl: 24 },
    mammaryGlands: { lactating: true, fullnessMm: 80 },
  });
  const gateway = boot(femaleManifestPath, statePath, { defaultNsfw: true });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const booted = gateway.getState().parts;
  assert.equal(Object.keys(booted).length, JSON.parse(readFileSync(femaleManifestPath, 'utf8')).scripts.length);
  assert.ok(booted.mammaryGlands, 'the female manifest must load mammaryGlands');
  assert.ok(booted.reward, 'the female manifest must load reward');
  assert.equal(booted.mammaryGlands.lactating, true);
  assert.equal(booted.pituitary.prolactinNgMl, 24);
  assert.equal(booted.mammaryGlands.fullnessMm, 80);

  const accumulator = emptyAccumulator();

  await gateway.tick();
  const first = gateway.getState().parts;
  assertClose(first.mammaryGlands.milkRequestMl, 0.5184, 'round 1 milk request at prolactin 24');
  assertClose(first.mammaryGlands.lactoseRequestG, 0.0383616, 'round 1 lactose request');
  assert.equal(first.mammaryGlands.milkMl, 0, 'round 1 pays the round-start request of zero');
  assert.equal(first.mammaryGlands.lactoseG, 0);
  const expectedFullness1 = 80 * 2 ** (-1 / 15);
  assertClose(first.mammaryGlands.fullnessMm, expectedFullness1, 'empty storage lets fullness decay');
  assertClose(first.interoception.discomfort, 100 / 3, 'round 1 reads the seeded fullness 80');
  assert.ok(first.pituitary.prolactinNgMl > 24, 'the lactation floor raises prolactin');
  accumulate(accumulator, first);
  assertClose(waterLedgerMl(first, accumulator), 0, 'round 1 water ledger');

  await gateway.tick();
  const second = gateway.getState().parts;
  assertClose(second.mammaryGlands.milkMl, 0.5184, 'round 2 pays the first milk request');
  assertClose(second.mammaryGlands.lactoseG, 0.0383616, 'round 2 pays the lactose request');
  assert.ok(second.mammaryGlands.lactoseG > 0);
  assertClose(
    second.interoception.discomfort,
    (100 * (expectedFullness1 - 70)) / (100 - 70),
    'round 2 discomfort reads round 1 fullness',
  );
  accumulate(accumulator, second);
  assert.ok(accumulator.milkMl > 0, 'the water ledger must accumulate actual milk');
  assertClose(waterLedgerMl(second, accumulator), 0, 'round 2 water ledger includes mammaryGlands.milkMl');

  await gateway.tick();
  const third = gateway.getState().parts;
  assert.ok(third.mammaryGlands.fullnessMm < second.mammaryGlands.fullnessMm, 'fullness decays once previous milk payout is observed');
  accumulate(accumulator, third);

  for (let round = 4; round <= 60; round++) {
    await gateway.tick();
    accumulate(accumulator, gateway.getState().parts);
  }
  const later = gateway.getState().parts;
  assert.ok(later.mammaryGlands.milkMl > 0, 'milk keeps being paid');
  assert.ok(later.mammaryGlands.lactoseG > 0, 'the lactose sink keeps being paid');
  assert.ok(later.mammaryGlands.fullnessMm < 30, 'fullness does not ratchet permanently');
  assertClose(waterLedgerMl(later, accumulator), 0, 'round 60 water ledger');
});

test('profile.lactating starts a female body in the established lactation state', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-profile-'));
  const statePath = writeState(dir, {}, { lactating: true });
  const gateway = boot(femaleManifestPath, statePath, { defaultNsfw: true });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const booted = gateway.getState().parts;
  assert.equal(booted.mammaryGlands.lactating, true);
  assert.equal(booted.mammaryGlands.inductionProgress, 1);
  assert.equal(booted.mammaryGlands.storedMilkMl, 120);
  assert.equal(booted.pituitary.prolactinNgMl, 60);
  assert.equal(booted.ovaries.cycleSuppression, 0.75);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(after.mammaryGlands.lactating, true);
  assert.ok(after.mammaryGlands.milkRequestMl > 0);
});

test('a default-oxytocin expression survives restart and ejects once when let-down arrives', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-delayed-ejection-'));
  const statePath = writeState(dir, {}, { lactating: true });
  let gateway = boot(femaleManifestPath, statePath, { defaultNsfw: true });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  assert.equal(gateway.getState().parts.pituitary.oxytocinPgMl, 2);
  assert.equal(gateway.submitAction({
    id: 'delayed-expression',
    type: 'express_milk',
    durationMin: 15,
    bilateral: true,
  }).statusCode, 202);

  await gateway.tick();
  assert.equal(gateway.getState().parts.mammaryGlands.ejectedMilkMl, 0);
  await gateway.stop();

  gateway = boot(femaleManifestPath, statePath, { defaultNsfw: true });
  await gateway.ready;
  await gateway.tick();
  const beforeLetdown = gateway.getState().parts;
  assert.equal(beforeLetdown.mammaryGlands.ejectedMilkMl, 0);
  assert.ok(beforeLetdown.pituitary.oxytocinPgMl > 5);
  const availableMilkMl = beforeLetdown.mammaryGlands.storedMilkMl
    + beforeLetdown.mammaryGlands.milkMl;

  await gateway.tick();
  const ejected = gateway.getState().parts;
  assertClose(ejected.mammaryGlands.ejectedMilkMl, availableMilkMl * 0.75, 'one bilateral PAMR');
  assertClose(ejected.mammaryGlands.storedMilkMl, availableMilkMl * 0.25, 'remaining stored milk');

  await gateway.tick();
  assert.equal(gateway.getState().parts.mammaryGlands.ejectedMilkMl, 0, 'stimulation continuation cannot eject twice');
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
  assert.equal(Object.keys(parts).length, JSON.parse(readFileSync(rootManifestPath, 'utf8')).scripts.length);
  assert.equal(Object.hasOwn(parts, 'mammaryGlands'), false);
  assert.ok(parts.reward);
  assert.equal(parts.pituitary.prolactinNgMl, 8);

  await gateway.tick();
  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(Object.hasOwn(after, 'mammaryGlands'), false);
  assertClose(after.glucose.glucoseMassG, 12.69, 'fasting glucose mass holds steady');
  assertClose(after.glucose.concentrationMgDl, 90, 'fasting glucose concentration holds steady');
  assertClose(after.glucose.disposedGlucoseG, 0.12, 'basal consumption per minute');
  assert.equal(after.glucose.excessMassG, 0);
  assert.ok(after.pituitary.prolactinNgMl > 0);
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

test('a restart on the same state path continues lactating mammary requests and payouts', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mammary-restart-'));
  const statePath = writeState(dir, {
    pituitary: { prolactinNgMl: 24 },
    mammaryGlands: { lactating: true },
  });
  let gateway = boot(femaleManifestPath, statePath, { defaultNsfw: true });
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

  gateway = boot(femaleManifestPath, statePath, { defaultNsfw: true });
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(after.mammaryGlands.milkMl > 0, true, 'milk payout resumes after restart');
  assert.equal(after.mammaryGlands.lactoseG > 0, true, 'lactose payout resumes after restart');
  assert.ok(after.mammaryGlands.milkRequestMl > 0);
  assert.ok(after.pituitary.prolactinNgMl > 8);
});
