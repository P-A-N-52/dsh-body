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
const initialBodyWaterMl = 30000;
const sweatMlPerRound = 0.6;
const lungMlPerRound = 0.3;

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function writeState(dir, parts = {}) {
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  return statePath;
}

function boot(statePath) {
  return startGateway({
    manifestPath: rootManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sweat-'));
  const statePath = writeState(dir, parts);
  silence(t);
  const gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, statePath };
}

function queuedWaterMl(stomach) {
  return (stomach.mealQueue ?? []).reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function waterLedgerMl(parts, {
  cumulativeVoidedMl = 0,
  cumulativeSweatMl = 0,
  cumulativeLungMl = 0,
} = {}) {
  return parts.stomach.waterVolumeMl
    + queuedWaterMl(parts.stomach)
    + parts.smallIntestine.waterVolumeMl
    + (parts.bodyFluid.waterVolumeMl - initialBodyWaterMl)
    + parts.bladder.volumeMl
    + cumulativeVoidedMl
    + cumulativeSweatMl
    + cumulativeLungMl;
}

test('a 30 minute exercise produces 18 mL of sweat and 9 mL of respiratory water loss, then stops', async (t) => {
  const { gateway } = await startBody(t);
  assert.equal(
    gateway.submitAction({ id: 'exercise-30', type: 'exercise', intensity: 1, durationMin: 30 }).statusCode,
    202,
  );

  let cumulativeSweatMl = 0;
  let cumulativeVoidedMl = 0;
  let cumulativeLungMl = 0;
  let round2Thirst;
  let round4Thirst;
  let round2BodyWaterMl;

  for (let round = 1; round <= 40; round++) {
    const before = gateway.getState().parts;
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(gateway.getState().simulatedSeconds, round * 60);
    cumulativeSweatMl += parts.skin.sweatVolumeMl;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    cumulativeLungMl += parts.lungs.respiratoryWaterLossMl;

    if (round === 1) {
      assert.equal(gateway.getReceipt('exercise-30').status, 'applied');
      assert.deepEqual(parts.physicalActivity, { remainingExerciseMin: 30, intensity: 1 });
      assert.equal(parts.skin.sweatRequestMl, 0);
      assert.equal(parts.skin.sweatVolumeMl, 0);
      assert.deepEqual(parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
    }
    if (round === 2) {
      assert.equal(parts.physicalActivity.remainingExerciseMin, 29);
      assert.equal(parts.physicalActivity.intensity, 1);
      assert.equal(parts.skin.sweatRequestMl, sweatMlPerRound);
      assert.equal(parts.skin.sweatVolumeMl, 0);
      assert.equal(parts.lungs.respiratoryWaterLossRequestMl, lungMlPerRound);
      assert.equal(parts.lungs.respiratoryWaterLossMl, 0);
      assert.equal(parts.bodyFluid.waterVolumeMl, 29999);
      round2Thirst = parts.hypothalamusThirst.thirst;
      round2BodyWaterMl = parts.bodyFluid.waterVolumeMl;
    }
    if (round === 3) {
      assert.equal(parts.physicalActivity.remainingExerciseMin, 28);
      assert.equal(parts.skin.sweatRequestMl, sweatMlPerRound);
      assert.equal(parts.skin.sweatVolumeMl, sweatMlPerRound);
      assert.equal(parts.lungs.respiratoryWaterLossRequestMl, lungMlPerRound);
      assert.equal(parts.lungs.respiratoryWaterLossMl, lungMlPerRound);
    }
    if (round === 4) {
      round4Thirst = parts.hypothalamusThirst.thirst;
      assert.ok(round4Thirst > round2Thirst, `round 4 thirst ${round4Thirst} should exceed ${round2Thirst}`);
      assert.ok(Math.abs(round4Thirst - 50.1) < 1e-12, `round 4 thirst ${round4Thirst}`);
    }
    if (round === 5) {
      assert.equal(parts.interoception.thirst, before.hypothalamusThirst.thirst);
    }
    if (round === 32) {
      assert.deepEqual(parts.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
      assert.equal(parts.skin.sweatRequestMl, 0);
      assert.equal(parts.skin.sweatVolumeMl, sweatMlPerRound);
      assert.equal(parts.lungs.respiratoryWaterLossRequestMl, 0);
      assert.equal(parts.lungs.respiratoryWaterLossMl, lungMlPerRound);
      assert.ok(Math.abs(cumulativeSweatMl - 18) <= 1e-9, `cumulative sweat ${cumulativeSweatMl}`);
      assert.ok(Math.abs(cumulativeLungMl - 9) <= 1e-9, `cumulative lung ${cumulativeLungMl}`);
      assert.ok(parts.bodyFluid.waterVolumeMl < round2BodyWaterMl, 'body water must fall');
      assert.ok(parts.hypothalamusThirst.thirst > 50, `thirst ${parts.hypothalamusThirst.thirst}`);
      assert.ok(parts.interoception.thirst > 50, `interoception thirst ${parts.interoception.thirst}`);
    }
    if (round >= 33) {
      assert.equal(parts.skin.sweatRequestMl, 0, `round ${round}: sweat request`);
      assert.equal(parts.skin.sweatVolumeMl, 0, `round ${round}: sweat volume`);
      assert.equal(parts.lungs.respiratoryWaterLossRequestMl, 0, `round ${round}: lung request`);
      assert.equal(parts.lungs.respiratoryWaterLossMl, 0, `round ${round}: lung volume`);
    }

    const ledgerMl = waterLedgerMl(parts, { cumulativeVoidedMl, cumulativeSweatMl, cumulativeLungMl });
    assert.ok(Math.abs(ledgerMl) <= 1e-6, `round ${round}: water ledger ${ledgerMl}`);
  }

  assert.ok(Math.abs(cumulativeSweatMl - 18) <= 1e-9, `final cumulative sweat ${cumulativeSweatMl}`);
  assert.ok(Math.abs(cumulativeLungMl - 9) <= 1e-9, `final cumulative lung ${cumulativeLungMl}`);
  const final = gateway.getState().parts;
  assert.equal(final.skin.sweatVolumeMl, 0);
  assert.equal(final.lungs.respiratoryWaterLossRequestMl, 0);
  assert.equal(final.lungs.respiratoryWaterLossMl, 0);
  assert.equal(final.physicalActivity.remainingExerciseMin, 0);
  assert.equal(final.stomach.waterVolumeMl, 0);
  assert.equal(final.stomach.mealQueue.length, 0);
  assert.equal(final.bladder.voidedMl, 0);
});

test('without exercise the ten-round trajectory matches the existing golden baseline', async (t) => {
  const { gateway } = await startBody(t);

  let cumulativeSweatMl = 0;
  let cumulativeVoidedMl = 0;
  let cumulativeLungMl = 0;
  for (let round = 1; round <= 10; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.physicalActivity, `round ${round}: physicalActivity part is missing`);
    assert.ok(parts.skin, `round ${round}: skin part is missing`);
    assert.ok(parts.lungs, `round ${round}: lungs part is missing`);
    cumulativeSweatMl += parts.skin.sweatVolumeMl;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    cumulativeLungMl += parts.lungs.respiratoryWaterLossMl;
    assert.deepEqual(parts.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
    assert.equal(parts.skin.sweatRequestMl, 0);
    assert.equal(parts.skin.sweatVolumeMl, 0);
    assert.deepEqual(parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
    assert.ok(Math.abs(waterLedgerMl(parts, {
      cumulativeVoidedMl,
      cumulativeSweatMl,
      cumulativeLungMl,
    })) <= 1e-6);
  }

  const parts = gateway.getState().parts;
  const expected = {
    adh: 1.0044262289516583,
    request: 0.9965802716913408,
    bodyWater: 29991.006062492746,
    deficit: 0.015992909993670763,
    thirst: 50.699818558396146,
    bladder: 8.99393750725631,
  };
  for (const [actual, want] of [
    [parts.hypothalamusAdh.relativeConcentration, expected.adh],
    [parts.kidney.urineProductionRequestMl, expected.request],
    [parts.bodyFluid.waterVolumeMl, expected.bodyWater],
    [parts.bodyFluid.waterDeficit, expected.deficit],
    [parts.hypothalamusThirst.thirst, expected.thirst],
    [parts.bladder.volumeMl, expected.bladder],
  ]) {
    assert.ok(Math.abs(actual - want) < 1e-12, `${actual} != ${want}`);
  }
});

test('a legacy checkpoint fills zero activity, skin request and lung flux without backfilling sweat or respiratory loss', async (t) => {
  const { gateway } = await startBody(t, {
    parts: {
      bodyFluid: { waterVolumeMl: 29950, waterDeficit: 0.1 },
      bladder: { volumeMl: 50, voidedMl: 0 },
    },
  });

  const loaded = gateway.getState().parts;
  assert.deepEqual(loaded.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(loaded.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(loaded.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
  assert.equal(loaded.bodyFluid.waterVolumeMl, 29950);
  assert.equal(loaded.bodyFluid.waterDeficit, 0.1);
  assert.equal(loaded.bladder.volumeMl, 50);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.deepEqual(after.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(after.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(after.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
  assert.equal(after.bodyFluid.waterVolumeMl, 29950);
  assert.equal(after.bladder.volumeMl, 50);
});

test('restarting keeps the remaining exercise and continues the same sweat and lung water ledger', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sweat-restart-'));
  const statePath = writeState(dir);
  silence(t);

  let gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  assert.equal(
    gateway.submitAction({ id: 'exercise-restart', type: 'exercise', intensity: 1, durationMin: 30 }).statusCode,
    202,
  );

  let cumulativeVoidedMl = 0;
  let cumulativeSweatMl = 0;
  let cumulativeLungMl = 0;
  const assertLedger = (parts, label) => {
    const ledgerMl = waterLedgerMl(parts, {
      cumulativeVoidedMl,
      cumulativeSweatMl,
      cumulativeLungMl,
    });
    assert.ok(Math.abs(ledgerMl) <= 1e-6, `${label}: water ledger ${ledgerMl}`);
  };
  for (let round = 1; round <= 10; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    cumulativeSweatMl += parts.skin.sweatVolumeMl;
    cumulativeLungMl += parts.lungs.respiratoryWaterLossMl;
    assertLedger(parts, `round ${round}`);
  }
  const before = gateway.getState();
  assert.equal(before.parts.physicalActivity.remainingExerciseMin, 21);
  assert.equal(before.parts.physicalActivity.intensity, 1);
  assert.equal(before.parts.skin.sweatRequestMl, sweatMlPerRound);
  assert.equal(before.parts.lungs.respiratoryWaterLossRequestMl, lungMlPerRound);
  assert.equal(before.parts.lungs.respiratoryWaterLossMl, lungMlPerRound);
  assert.ok(Math.abs(cumulativeSweatMl - 8 * sweatMlPerRound) <= 1e-9);
  assert.ok(Math.abs(cumulativeLungMl - 8 * lungMlPerRound) <= 1e-9);
  await gateway.stop();

  gateway = boot(statePath);
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);
  assertLedger(restored.parts, 'restored checkpoint');

  let round11LungMl;
  for (let round = 11; round <= 32; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    cumulativeSweatMl += parts.skin.sweatVolumeMl;
    cumulativeLungMl += parts.lungs.respiratoryWaterLossMl;
    assertLedger(parts, `round ${round}`);
    if (round === 11) round11LungMl = parts.lungs.respiratoryWaterLossMl;
  }
  assert.equal(round11LungMl, lungMlPerRound, 'the archived last-round lung flux must not be counted again');
  assert.ok(Math.abs(cumulativeSweatMl - 18) <= 1e-9, `cumulative sweat ${cumulativeSweatMl}`);
  assert.ok(Math.abs(cumulativeLungMl - 9) <= 1e-9, `cumulative lung ${cumulativeLungMl}`);
  const after = gateway.getState().parts;
  assert.deepEqual(after.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.equal(after.skin.sweatRequestMl, 0);

  await gateway.tick();
  const finalParts = gateway.getState().parts;
  cumulativeVoidedMl += finalParts.bladder.voidedMl;
  cumulativeSweatMl += finalParts.skin.sweatVolumeMl;
  cumulativeLungMl += finalParts.lungs.respiratoryWaterLossMl;
  assert.equal(finalParts.skin.sweatVolumeMl, 0);
  assert.equal(finalParts.lungs.respiratoryWaterLossMl, 0);
  assertLedger(finalParts, 'round 33');
});
