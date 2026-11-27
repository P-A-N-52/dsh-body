import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

function boot(statePath, { defaultNsfw = false } = {}) {
  return startGateway({
    manifestPath: femaleManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
    defaultNsfw,
  });
}

async function startBody(t, { parts = {}, defaultNsfw = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-reproductive-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  const gateway = boot(statePath, { defaultNsfw });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, statePath, dir };
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
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

function emptyAccumulator() {
  return { voidedMl: 0, sweatMl: 0, lungsMl: 0, bleedingMl: 0, milkMl: 0 };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

test('the female manifest boots all parts and pays menses and milk into the water ledger', async (t) => {
  silence(t);
  const { gateway } = await startBody(t, { parts: { ovaries: { cycleDay: 0 } } });
  const booted = gateway.getState().parts;
  assert.equal(Object.keys(booted).length, 48);
  assert.ok(booted.reward, 'reward must be loaded');
  assert.ok(booted.ovaries, 'ovaries must be loaded');
  assert.ok(booted.uterus, 'uterus must be loaded');
  assert.ok(booted.liver, 'liver must be loaded');
  const initialRegionGlycogen = {
    muscleHead: 15,
    muscleTrunk: 135,
    muscleLimbs: 150,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(booted[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.ok(booted.sexualResponse, 'sexualResponse must be loaded');
  assert.ok(booted.bloodOxygen, 'bloodOxygen must be loaded');
  assert.ok(booted.lungsVentilation, 'lungsVentilation must be loaded');
  assert.ok(booted.hypothalamusEndocrine, 'hypothalamusEndocrine must be loaded');
  assert.ok(booted.pituitary, 'pituitary must be loaded');
  assert.ok(booted.thyroid, 'thyroid must be loaded');
  assert.ok(booted.adrenal, 'adrenal must be loaded');
  assert.ok(booted.pineal, 'pineal must be loaded');
  assert.ok(booted.salivaryGlands, 'salivaryGlands must be loaded');
  assert.ok(booted.mammaryGlands, 'mammaryGlands must be loaded');
  assert.deepEqual(booted.mammaryGlands, {
    lactating: false,
    galactorrhea: false,
    inductionProgress: 0,
    storedMilkMl: 0,
    ejectedMilkMl: 0,
    stimulationMin: 0,
    pendingEjections: [],
    milkRequestMl: 0,
    milkMl: 0,
    lactoseRequestG: 0,
    lactoseG: 0,
    fullnessMm: 0,
  });
  assert.deepEqual(booted.bloodOxygen, {
    oxygenConsumptionMlMin: 250,
    oxygenSupplyMlMin: 250,
    spo2Percent: 97,
    oxygenDeficit: 0,
  });
  assert.deepEqual(booted.lungsVentilation, {
    tidalVolumeMl: 500,
    respiratoryRatePerMin: 12,
    ventilationMlMin: 6000,
    alveolarO2MlMin: 6000 * (0.058333 / 1.4),
    alveolarO2CapacityMlMin: 60000 * (0.058333 / 1.4),
  });
  assert.equal(booted.pituitary.prolactinNgMl, 8);
  assert.equal(booted.ovaries.cycleDay, 0);
  assert.deepEqual(booted.uterus, {
    endometriumRelative: 0.1,
    crampMm: 0,
    bleedingRequestMl: 0,
    bleedingMl: 0,
    contractionMm: 0,
    pelvicCongestionMm: 0,
  });

  const accumulator = emptyAccumulator();
  const bleedingRounds = [];
  const discomfortRounds = [];

  for (let round = 1; round <= 5; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.uterus.crampMm > 0, `round ${round}: cramp inside menses`);
    assert.ok(parts.uterus.bleedingRequestMl > 0, `round ${round}: bleeding request inside menses`);
    if (parts.uterus.bleedingMl > 0) bleedingRounds.push(round);
    if (parts.interoception.discomfort > 0) discomfortRounds.push(round);
    accumulate(accumulator, parts);
    const ledgerMl = waterLedgerMl(parts, accumulator);
    assert.ok(Math.abs(ledgerMl) <= 1e-6, `round ${round}: water ledger ${ledgerMl}`);
  }

  assert.deepEqual(bleedingRounds, [2, 3, 4, 5], 'round one writes the request, the next round pays it');
  assert.deepEqual(discomfortRounds, [2, 3, 4, 5], 'discomfort reads the previous round cramp');
  assert.ok(accumulator.bleedingMl > 0);
  assert.equal(accumulator.milkMl, 0, 'non-lactating default female has zero milk drain');
  assert.ok(gateway.getState().parts.pituitary.prolactinNgMl > 0);
  assert.ok(
    Math.abs(waterLedgerMl(gateway.getState().parts, accumulator)) <= 1e-6,
    'the ledger must still include every paid bleed',
  );
});

test('a lactating female pays milk and lactose and raises prolactin while conserving water', async (t) => {
  silence(t);
  const { gateway: safeGateway } = await startBody(t, {
    parts: {
      ovaries: { cycleDay: 10 },
      mammaryGlands: { lactating: true },
    },
  });
  await safeGateway.tick();
  const safeParts = safeGateway.getState().parts;
  assert.equal(safeParts.mammaryGlands.lactating, false, 'nsfw false forces non-lactating');
  assert.equal(safeParts.mammaryGlands.milkRequestMl, 0);
  assert.equal(safeParts.mammaryGlands.milkMl, 0);
  assert.equal(safeParts.mammaryGlands.lactoseRequestG, 0);
  assert.equal(safeParts.mammaryGlands.lactoseG, 0);

  const { gateway } = await startBody(t, {
    defaultNsfw: true,
    parts: {
      ovaries: { cycleDay: 10 },
      mammaryGlands: { lactating: true },
    },
  });
  const accumulator = emptyAccumulator();

  await gateway.tick();
  let parts = gateway.getState().parts;
  accumulate(accumulator, parts);
  assert.equal(parts.mammaryGlands.lactating, true);
  assertClose(parts.mammaryGlands.milkRequestMl, 0.1728, 'baseline PRL 8 request');
  assert.equal(parts.mammaryGlands.milkMl, 0);
  assert.equal(parts.mammaryGlands.lactoseG, 0);

  await gateway.tick();
  parts = gateway.getState().parts;
  accumulate(accumulator, parts);
  assertClose(parts.mammaryGlands.milkMl, 0.1728, 'the first request is paid');
  assertClose(parts.mammaryGlands.lactoseG, 0.0127872, 'the first lactose request is paid');

  await gateway.tick();
  parts = gateway.getState().parts;
  accumulate(accumulator, parts);
  assert.ok(parts.pituitary.prolactinNgMl > 8, 'the lactation floor raises prolactin');

  await gateway.tick();
  parts = gateway.getState().parts;
  accumulate(accumulator, parts);
  assert.ok(parts.mammaryGlands.milkRequestMl > 0.1728, 'elevated prolactin raises milk request');

  await gateway.tick();
  parts = gateway.getState().parts;
  accumulate(accumulator, parts);
  assert.ok(parts.mammaryGlands.milkMl > 0.1728, 'elevated prolactin raises milk payout');
  assert.ok(parts.mammaryGlands.lactoseG > 0.0127872, 'elevated prolactin raises lactose payout');
  assert.ok(
    Math.abs(waterLedgerMl(parts, accumulator)) <= 1e-6,
    'lactating water ledger must stay conserved',
  );
});

test('a non-menses seed keeps bleeding, cramps and requests at zero', async (t) => {
  silence(t);
  const { gateway } = await startBody(t, { parts: { ovaries: { cycleDay: 10 } } });
  const accumulator = emptyAccumulator();

  for (let round = 1; round <= 4; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(parts.uterus.crampMm, 0, `round ${round}: cramp`);
    assert.equal(parts.uterus.bleedingRequestMl, 0, `round ${round}: bleeding request`);
    assert.equal(parts.uterus.bleedingMl, 0, `round ${round}: bleeding`);
    accumulate(accumulator, parts);
    const ledgerMl = waterLedgerMl(parts, accumulator);
    assert.ok(Math.abs(ledgerMl) <= 1e-6, `round ${round}: water ledger ${ledgerMl}`);
  }

  assert.equal(accumulator.bleedingMl, 0);
  assert.equal(accumulator.milkMl, 0, 'non-lactating default female has zero milk drain outside menses');
});

test('a restart on the same state path continues the cycle and pays the pending bleed', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-reproductive-restart-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts: { ovaries: { cycleDay: 0 } },
  })));
  let gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const accumulator = emptyAccumulator();
  for (let round = 1; round <= 3; round++) {
    await gateway.tick();
    accumulate(accumulator, gateway.getState().parts);
  }

  const beforeRestart = gateway.getState();
  const pendingRequestMl = beforeRestart.parts.uterus.bleedingRequestMl;
  const cycleDayBefore = beforeRestart.parts.ovaries.cycleDay;
  assert.ok(pendingRequestMl > 0, 'the last round must leave a pending bleeding request');
  assert.ok(beforeRestart.parts.uterus.bleedingMl > 0, 'a previous request must already be paid');
  await gateway.stop();

  gateway = boot(statePath);
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, beforeRestart.simulatedSeconds);
  assert.deepEqual(restored.parts, beforeRestart.parts);
  assert.equal(restored.parts.ovaries.cycleDay, cycleDayBefore);

  await gateway.tick();
  const after = gateway.getState().parts;
  accumulate(accumulator, after);
  assert.ok(
    Math.abs(after.uterus.bleedingMl - pendingRequestMl) <= 1e-12,
    `the pending request ${pendingRequestMl} must be paid after restart, got ${after.uterus.bleedingMl}`,
  );
  assert.ok(after.ovaries.cycleDay > cycleDayBefore, 'the cycle must continue after restart');
  const ledgerMl = waterLedgerMl(after, accumulator);
  assert.ok(Math.abs(ledgerMl) <= 1e-6, `after restart water ledger ${ledgerMl}`);
});
