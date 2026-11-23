import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import * as muscleGlucose from '../organs/human-organs/skeletal-muscle/glucose-uptake.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const baselineMassG = 12.69;
const baselineConcentrationMgDl = 90;
const distributionVolumeDl = 141;
const residualHalfTimeMin = 60;
const initialLiverGlycogenG = 80;
const liverCapacityG = 100;
const ledgerToleranceG = 1e-6;
const poolToleranceG = 1e-9;
const muscleRegions = ['muscleHead', 'muscleTrunk', 'muscleLimbs'];

function muscleSum(parts, field) {
  return muscleRegions.reduce((sum, region) => sum + parts[region][field], 0);
}

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
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
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tissue-uptake-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);
  const gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, statePath };
}

function queuedCarbohydrateG(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingCarbohydrateG ?? 0), 0);
}

function carbohydrateLedgerG(parts, cumulative) {
  return parts.stomach.carbohydrateG
    + queuedCarbohydrateG(parts.stomach)
    + parts.smallIntestine.carbohydrateG
    + (parts.glucose.glucoseMassG - baselineMassG)
    + cumulative.disposedG
    + cumulative.excretedG
    + muscleSum(parts, 'glycogenG')
    + muscleSum(parts, 'uptakeG')
    + parts.muscleGlucose.uptakeG
    + cumulative.muscleConsumedG
    + (parts.liver.glycogenG - initialLiverGlycogenG)
    + parts.liver.storageG;
}

// 逐轮池质量账：轮初入账的小肠吸收 + 肝释放 − 残余清除 − 肾糖 − 肝储存到账 − 肌摄糖到账。
function assertPoolBalance(previousMassG, parts, label) {
  const expectedG = previousMassG
    + parts.smallIntestine.absorbedCarbohydrateG
    + parts.liver.outputG
    - parts.glucose.disposedGlucoseG
    - parts.kidneyGlucose.excretedGlucoseG
    - parts.liver.storageG
    - parts.muscleGlucose.uptakeG;
  assert.ok(
    Math.abs(parts.glucose.glucoseMassG - expectedG) <= poolToleranceG,
    `${label}: pool ${parts.glucose.glucoseMassG} != ${expectedG}`,
  );
}

function highGlucoseParts({ insulinRelative = 1, liver } = {}) {
  const massG = baselineMassG + 38.07;
  return {
    glucose: {
      glucoseMassG: massG,
      concentrationMgDl: 360,
      disposedGlucoseG: 0,
      excessMassG: massG - baselineMassG,
    },
    kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    pancreasEndocrine: { insulinRelative, glucagonRelative: 1 },
    ...(liver === undefined ? {} : { liver }),
  };
}

test('a carb meal produces an emergent rise-then-fall trajectory with a per-round ledger', async (t) => {
  const { gateway } = await startBody(t);
  assert.equal(
    gateway.submitAction({
      id: 'tissue-uptake-meal',
      type: 'drink',
      volumeMl: 240,
      energyKcal: 100,
      durationMin: 1,
      carbohydrateG: 60,
    }).statusCode,
    202,
  );

  const cumulative = { disposedG: 0, excretedG: 0, muscleConsumedG: 0 };
  let previousMassG = baselineMassG;
  let peakMgDl = 0;
  let peakRound = 0;
  let sawMuscleUptake = false;
  let sawLiverStorage = false;

  for (let round = 1; round <= 240; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    const label = `round ${round}`;
    assert.ok(
      Math.abs(parts.glucose.excessMassG - Math.max(0, previousMassG - baselineMassG)) <= 1e-9,
      `${label}: excessMassG must come from the round-start mass`,
    );
    cumulative.disposedG += parts.glucose.disposedGlucoseG;
    cumulative.excretedG += parts.kidneyGlucose.excretedGlucoseG;
    cumulative.muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    assert.ok(
      Math.abs(carbohydrateLedgerG(parts, cumulative) - 60) <= ledgerToleranceG,
      `${label}: carbohydrate ledger ${carbohydrateLedgerG(parts, cumulative)}`,
    );
    assertPoolBalance(previousMassG, parts, label);
    if (parts.glucose.concentrationMgDl > peakMgDl) {
      peakMgDl = parts.glucose.concentrationMgDl;
      peakRound = round;
    }
    if (parts.muscleGlucose.uptakeG > 0) sawMuscleUptake = true;
    if (parts.liver.storageG > 0) sawLiverStorage = true;
    previousMassG = parts.glucose.glucoseMassG;
  }

  const final = gateway.getState().parts;
  assert.ok(peakMgDl > baselineConcentrationMgDl + 20, `peak ${peakMgDl} mg/dL must rise`);
  assert.ok(peakRound > 1, `peak must occur after the absorption delay; peak round ${peakRound}`);
  assert.ok(
    final.glucose.concentrationMgDl < peakMgDl - 10,
    `final ${final.glucose.concentrationMgDl} mg/dL must fall from peak ${peakMgDl}`,
  );
  assert.ok(sawMuscleUptake, 'muscle must receive some of the meal');
  assert.ok(sawLiverStorage, 'liver must receive some of the meal');
  assert.ok(final.glucose.excessMassG >= 0);
});

test('high insulin raises muscle uptake more than liver storage (1.0 vs 0.5 sensitivity)', async (t) => {
  const baselineBody = await startBody(t, { parts: highGlucoseParts({ insulinRelative: 1 }) });
  const highInsulinBody = await startBody(t, { parts: highGlucoseParts({ insulinRelative: 2 }) });

  const excessG = highGlucoseParts().glucose.excessMassG;
  const expectedMuscleG = (insulin) => 0.5
    * excessG / (excessG + 20)
    * (1 + 1.0 * (insulin - 1));
  const expectedLiverG = (insulin) => Math.min(
    0.2 * excessG / (excessG + 15)
      * (1 + 0.5 * (insulin - 1)),
    liverCapacityG - initialLiverGlycogenG,
  );

  await baselineBody.gateway.tick();
  await highInsulinBody.gateway.tick();
  const baselineRequests = baselineBody.gateway.getState().parts;
  const highRequests = highInsulinBody.gateway.getState().parts;

  assert.ok(
    Math.abs(baselineRequests.muscleGlucose.uptakeRequestG - expectedMuscleG(1)) <= 1e-12,
  );
  assert.ok(
    Math.abs(baselineRequests.liver.storageRequestG - expectedLiverG(1)) <= 1e-12,
  );
  assert.ok(
    Math.abs(highRequests.muscleGlucose.uptakeRequestG - expectedMuscleG(2)) <= 1e-12,
  );
  assert.ok(
    Math.abs(highRequests.liver.storageRequestG - expectedLiverG(2)) <= 1e-12,
  );
  const muscleIncreaseG = highRequests.muscleGlucose.uptakeRequestG
    - baselineRequests.muscleGlucose.uptakeRequestG;
  const liverIncreaseG = highRequests.liver.storageRequestG
    - baselineRequests.liver.storageRequestG;
  assert.ok(muscleIncreaseG > 0, 'high insulin must raise the muscle request');
  assert.ok(liverIncreaseG > 0, 'high insulin must raise the liver request');
  assert.ok(
    muscleIncreaseG > liverIncreaseG,
    `muscle increase ${muscleIncreaseG} g must exceed liver ${liverIncreaseG} g`,
  );

  await baselineBody.gateway.tick();
  await highInsulinBody.gateway.tick();
  const baselinePaid = baselineBody.gateway.getState().parts;
  const highPaid = highInsulinBody.gateway.getState().parts;
  assert.ok(
    Math.abs(baselinePaid.muscleGlucose.uptakeG - expectedMuscleG(1)) <= 1e-12,
  );
  assert.ok(
    Math.abs(highPaid.muscleGlucose.uptakeG - expectedMuscleG(2)) <= 1e-12,
  );
  assert.ok(
    Math.abs(baselinePaid.liver.storageG - expectedLiverG(1)) <= 1e-12,
  );
  assert.ok(
    Math.abs(highPaid.liver.storageG - expectedLiverG(2)) <= 1e-12,
  );
  assert.ok(
    highPaid.muscleGlucose.uptakeG - baselinePaid.muscleGlucose.uptakeG
      > highPaid.liver.storageG - baselinePaid.liver.storageG,
    'the paid amounts must keep the muscle-over-liver sensitivity gap',
  );
});

test('low glucose releases only from the liver and never from muscle', async (t) => {
  const startMassG = 6;
  const { gateway } = await startBody(t, {
    parts: {
      glucose: {
        glucoseMassG: startMassG,
        concentrationMgDl: startMassG * 1000 / distributionVolumeDl,
        disposedGlucoseG: 0,
      },
      liver: {
        glycogenCapacityG: liverCapacityG,
        glycogenG: initialLiverGlycogenG,
        storageG: 0,
        outputG: 0,
      },
      pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
    },
  });

  let previousMassG = startMassG;
  for (let round = 1; round <= 5; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.liver.outputG > 0, `round ${round}: liver must release`);
    assert.equal(parts.glucose.disposedGlucoseG, 0, `round ${round}: below-baseline residual`);
    assert.equal(parts.kidneyGlucose.excretedGlucoseG, 0, `round ${round}: renal transfer`);
    assert.equal(parts.muscleGlucose.uptakeRequestG, 0, `round ${round}: muscle request`);
    assert.equal(parts.muscleGlucose.uptakeG, 0, `round ${round}: muscle uptake`);
    assert.equal(parts.liver.storageG, 0, `round ${round}: liver storage`);
    assert.equal(parts.liver.storageRequestG, 0, `round ${round}: liver storage request`);
    assert.ok(
      Math.abs(parts.glucose.glucoseMassG - (previousMassG + parts.liver.outputG)) <= 1e-12,
      `round ${round}: the only source must be the liver release`,
    );
    previousMassG = parts.glucose.glucoseMassG;
  }
  assert.ok(previousMassG > startMassG, 'the release must refill the glucose pool');

  const transferOuts = Object.values(muscleGlucose.fields)
    .flatMap((declaration) => declaration.transferOut ?? []);
  assert.equal(
    transferOuts.some((ref) => ref.startsWith('glucose.')),
    false,
    'muscleGlucose must not declare a transfer into glucose',
  );
});

test('a full liver requests and receives no storage while muscle still receives glucose', async (t) => {
  const { gateway } = await startBody(t, {
    parts: highGlucoseParts({
      liver: {
        glycogenCapacityG: liverCapacityG,
        glycogenG: liverCapacityG,
        storageG: 0,
        outputG: 0,
      },
    }),
  });

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.equal(first.liver.storageRequestG, 0, 'full liver must request zero storage');
  assert.equal(first.liver.storageG, 0, 'full liver must receive no storage');
  assert.ok(first.muscleGlucose.uptakeRequestG > 0, 'muscle must still request glucose');

  await gateway.tick();
  const second = gateway.getState().parts;
  assert.equal(second.liver.storageRequestG, 0, 'full liver must keep requesting zero');
  assert.equal(second.liver.storageG, 0, 'full liver must keep receiving no storage');
  assert.equal(second.liver.glycogenG, liverCapacityG, 'full glycogen must stay full');
  assert.ok(second.muscleGlucose.uptakeG > 0, 'muscle must receive the prior request');
});

test('restarting keeps pending requests and books the in-flight uptake and storage exactly once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tissue-uptake-restart-'));
  const statePath = join(dir, 'body-state.json');
  const seedParts = highGlucoseParts();
  const seededLedgerG = seedParts.glucose.excessMassG;
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts: seedParts,
  })));
  silence(t);
  let gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  const cumulative = { disposedG: 0, excretedG: 0, muscleConsumedG: 0 };
  let previousMassG = highGlucoseParts().glucose.glucoseMassG;
  for (let round = 1; round <= 3; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assertPoolBalance(previousMassG, parts, `pre-restart round ${round}`);
    cumulative.disposedG += parts.glucose.disposedGlucoseG;
    cumulative.excretedG += parts.kidneyGlucose.excretedGlucoseG;
    cumulative.muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    previousMassG = parts.glucose.glucoseMassG;
  }

  const beforeRestart = gateway.getState();
  assert.ok(beforeRestart.parts.muscleGlucose.uptakeG > 0, 'an in-flight muscle uptake must exist');
  assert.ok(beforeRestart.parts.liver.storageG > 0, 'an in-flight liver storage must exist');
  assert.ok(beforeRestart.parts.muscleGlucose.uptakeRequestG > 0, 'a pending request must exist');
  assert.ok(beforeRestart.parts.liver.storageRequestG > 0, 'a pending request must exist');
  await gateway.stop();

  gateway = boot(statePath);
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, beforeRestart.simulatedSeconds);
  assert.deepEqual(restored.parts, beforeRestart.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  const before = beforeRestart.parts;
  assert.ok(
    Math.abs(muscleSum(after, 'uptakeG') - before.muscleGlucose.uptakeG) <= 1e-12,
    'the restored muscle uptake must move to the regions exactly once',
  );
  assert.ok(
    Math.abs(
      muscleSum(after, 'glycogenG')
        - (muscleSum(before, 'glycogenG') + muscleSum(before, 'uptakeG')),
    ) <= 1e-12,
    'the handoff round books only the regional uptake that was already in flight',
  );
  assert.ok(
    Math.abs(
      after.liver.glycogenG - (before.liver.glycogenG + before.liver.storageG),
    ) <= 1e-12,
    'the restored liver storage must be booked exactly once',
  );
  assert.ok(
    Math.abs(
      after.glucose.excessMassG - Math.max(0, before.glucose.glucoseMassG - baselineMassG),
    ) <= 1e-12,
    'the first restored round must derive excess from the restored mass',
  );
  assertPoolBalance(before.glucose.glucoseMassG, after, 'post-restart round');

  await gateway.tick();
  const booked = gateway.getState().parts;
  assert.ok(
    Math.abs(
      muscleSum(booked, 'glycogenG')
        - (muscleSum(before, 'glycogenG')
          + muscleSum(before, 'uptakeG')
          + before.muscleGlucose.uptakeG),
    ) <= 1e-12,
    'the restored muscle uptake must be booked exactly once',
  );

  cumulative.disposedG += after.glucose.disposedGlucoseG;
  cumulative.excretedG += after.kidneyGlucose.excretedGlucoseG;
  cumulative.muscleConsumedG += muscleSum(after, 'glycogenConsumedG');
  assert.ok(
    Math.abs(carbohydrateLedgerG(after, cumulative) - seededLedgerG) <= ledgerToleranceG,
    'the seeded excess ledger must stay balanced across restart',
  );
});
