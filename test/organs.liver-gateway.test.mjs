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
const baselineMassG = 12.69;
const baselineConcentrationMgDl = 90;
const distributionVolumeDl = 141;
const initialLiverGlycogenG = 80;
const initialMuscleGlycogenG = 300;
const ledgerToleranceG = 1e-6;
const muscleRegions = ['muscleHead', 'muscleTrunk', 'muscleLimbs'];

function muscleSum(parts, field) {
  return muscleRegions.reduce((sum, region) => sum + parts[region][field], 0);
}

function renalOutputG(parts) {
  const concentrationMgDl = parts.glucose?.concentrationMgDl ?? baselineConcentrationMgDl;
  const glucagonRelative = parts.pancreasEndocrine?.glucagonRelative ?? 1;
  const deficitMgDl = Math.max(0, baselineConcentrationMgDl - concentrationMgDl);
  const excessMgDl = Math.max(0, concentrationMgDl - baselineConcentrationMgDl);
  const suppression = 1 / (1 + excessMgDl / 30);
  const rawRate = 0.024 * suppression
    + 0.005 * deficitMgDl
    + 0.05 * Math.max(0, glucagonRelative - 1);
  return Math.min(0.6, Math.min(0.5, Math.max(0, rawRate)));
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

function makeBody(t, parts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-liver-'));
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
  return gateway;
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
    + (muscleSum(parts, 'glycogenG') - initialMuscleGlycogenG)
    + muscleSum(parts, 'uptakeG')
    + parts.muscleGlucose.uptakeG
    + cumulative.muscleConsumedG
    + (parts.liver.glycogenG - initialLiverGlycogenG)
    + parts.liver.storageG
    - cumulative.kidneyOutputG;
}

test('a carb-rich meal raises glucose, then disposal lowers it while the liver stores glycogen', async (t) => {
  const gateway = makeBody(t);
  await gateway.ready;
  assert.equal(
    gateway.submitAction({
      id: 'liver-meal',
      type: 'drink',
      volumeMl: 240,
      energyKcal: 100,
      durationMin: 1,
      carbohydrateG: 60,
    }).statusCode,
    202,
  );

  const cumulative = { disposedG: 0, excretedG: 0, muscleConsumedG: 0, kidneyOutputG: 0 };
  let peakMgDl = 0;
  let peakRound = 0;
  let maxStorageG = 0;
  let maxStorageRound = 0;
  let peakGlycogenG = initialLiverGlycogenG;

  for (let round = 1; round <= 240; round++) {
    const before = gateway.getState().parts;
    cumulative.kidneyOutputG += renalOutputG(before);
    await gateway.tick();
    const parts = gateway.getState().parts;
    if (parts.glucose.concentrationMgDl > peakMgDl) {
      peakMgDl = parts.glucose.concentrationMgDl;
      peakRound = round;
    }
    if (parts.liver.storageG > maxStorageG) {
      maxStorageG = parts.liver.storageG;
      maxStorageRound = round;
    }
    peakGlycogenG = Math.max(peakGlycogenG, parts.liver.glycogenG);
    cumulative.disposedG += parts.glucose.disposedGlucoseG;
    cumulative.excretedG += parts.kidneyGlucose.excretedGlucoseG;
    cumulative.muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    const ledgerG = carbohydrateLedgerG(parts, cumulative);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );
  }

  const final = gateway.getState().parts;
  assert.ok(peakMgDl > 120, `peak ${peakMgDl} mg/dL must rise above 120`);
  assert.ok(
    final.glucose.concentrationMgDl < peakMgDl - 20,
    `final ${final.glucose.concentrationMgDl} must fall from peak ${peakMgDl} (round ${peakRound})`,
  );
  assert.ok(
    maxStorageG > 0.01,
    `liver storage ${maxStorageG} g in round ${maxStorageRound} must be positive`,
  );
  assert.ok(
    peakGlycogenG > initialLiverGlycogenG,
    `peak liver glycogen ${peakGlycogenG} g must accumulate above ${initialLiverGlycogenG} g during absorption`,
  );
  assert.ok(
    final.liver.glycogenG > initialLiverGlycogenG - 240 * 0.096 + 10,
    `post-absorptive liver glycogen ${final.liver.glycogenG} g must stay well above fasting depletion`,
  );
  assert.ok(final.liver.outputG <= 0.1, 'basal liver output stays near or below basal');
});

test('high glucose disposes into muscle and liver, then low glucose releases liver glycogen', async (t) => {
  const high = makeBody(t, {
    glucose: {
      glucoseMassG: 30,
      concentrationMgDl: 30 * 1000 / distributionVolumeDl,
      disposedGlucoseG: 0,
    },
  });
  await high.ready;
  await high.tick();
  const high1 = high.getState().parts;
  assert.equal(high1.muscleGlucose.uptakeG, 0, 'round 1 has no prior uptake request');
  assert.equal(high1.liver.storageG, 0, 'round 1 has no prior storage request');
  assert.ok(high1.glucose.disposedGlucoseG > 0, 'high glucose must drive residual disposal');
  assert.ok(high1.pancreasEndocrine.insulinRelative > 1, 'high glucose must raise insulin');
  assert.ok(high1.pancreasEndocrine.glucagonRelative < 1, 'high glucose must lower glucagon');
  assert.equal(high1.muscleGlucose.uptakeRequestG, 0, 'the old excess signal is zero in round 1');
  assert.equal(high1.liver.storageRequestG, 0, 'the old excess signal is zero in round 1');

  await high.tick();
  const high2 = high.getState().parts;
  assert.ok(high2.kidneyGlucose.excretedGlucoseG > 0, 'the prior renal request must transfer');
  assert.equal(high2.muscleGlucose.uptakeG, 0, 'the round-2 request is settled one round later');
  assert.equal(high2.liver.storageG, 0, 'the round-2 request is settled one round later');
  assert.ok(high2.muscleGlucose.uptakeRequestG > 0, 'muscle writes its first request in round 2');
  assert.ok(high2.liver.storageRequestG > 0, 'liver writes its first request in round 2');
  assert.ok(
    high2.glucose.glucoseMassG < high1.glucose.glucoseMassG,
    'residual disposal must lower the committed glucose mass',
  );

  await high.tick();
  const high3 = high.getState().parts;
  assert.ok(high3.muscleGlucose.uptakeG > 0, 'requests written after the lag must reach muscle');
  assert.ok(high3.liver.storageG > 0, 'requests written after the lag must reach the liver');
  assert.ok(high3.liver.glycogenG < initialLiverGlycogenG, 'suppressed basal release precedes storage booking');

  await high.tick();
  const high4 = high.getState().parts;
  assert.ok(
    high4.liver.glycogenG > high3.liver.glycogenG,
    'the liver must book the previous round storage',
  );
  assert.ok(
    muscleSum(high4, 'uptakeG') > 0,
    'the muscle regions must receive the previous round uptake',
  );

  await high.tick();
  const high5 = high.getState().parts;
  assert.ok(
    muscleSum(high5, 'glycogenG') > initialMuscleGlycogenG,
    'the muscle regions must book the previous round uptake',
  );

  const low = makeBody(t, {
    glucose: {
      glucoseMassG: 6,
      concentrationMgDl: 6 * 1000 / distributionVolumeDl,
      disposedGlucoseG: 0,
    },
    liver: {
      glycogenCapacityG: 100,
      glycogenG: initialLiverGlycogenG,
      storageG: 0,
      outputG: 0,
    },
    pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
  });
  await low.ready;
  await low.tick();
  const low1 = low.getState().parts;
  assert.ok(low1.liver.outputG > 0, 'low glucose must trigger a liver release');
  assert.ok(low1.glucose.glucoseMassG > 6, 'the liver release must raise glucose mass');
  assert.ok(low1.liver.glycogenG < initialLiverGlycogenG, 'the release must spend glycogen');
  assert.equal(low1.muscleGlucose.uptakeG, 0, 'muscle must not take up glucose below baseline');
  assert.equal(low1.muscleGlucose.uptakeRequestG, 0, 'muscle must not request glucose below baseline');
  assert.equal(low1.liver.storageG, 0, 'the liver must not store while releasing');
  assert.ok(low1.pancreasEndocrine.glucagonRelative > 1, 'low glucose must raise glucagon');
  assert.ok(low1.pancreasEndocrine.insulinRelative < 1, 'low glucose must lower insulin');

  let peakConcentrationMgDl = 0;
  let releaseRounds = 0;
  for (let round = 2; round <= 40; round++) {
    await low.tick();
    const parts = low.getState().parts;
    if (parts.liver.outputG > 0) releaseRounds += 1;
    if (parts.glucose.concentrationMgDl > peakConcentrationMgDl) {
      peakConcentrationMgDl = parts.glucose.concentrationMgDl;
    }
  }
  const low40 = low.getState().parts;
  assert.ok(releaseRounds > 0, 'the release must continue smoothly');
  assert.ok(
    peakConcentrationMgDl < 105,
    `smooth recovery must not overshoot into >120 mg/dL sawtooth, got peak ${peakConcentrationMgDl} mg/dL`,
  );
  assert.ok(
    Math.abs(low40.glucose.concentrationMgDl - 90) < 5,
    `round 40 concentration ${low40.glucose.concentrationMgDl} must settle near 90 mg/dL`,
  );
  assert.ok(
    low40.liver.glycogenG < initialLiverGlycogenG,
    'glycogen must remain spent after recovery',
  );
});

test('restarting on the same state path continues the liver release', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-liver-restart-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts: {
      glucose: {
        glucoseMassG: 6,
        concentrationMgDl: 6 * 1000 / distributionVolumeDl,
        disposedGlucoseG: 0,
      },
      liver: {
        glycogenCapacityG: 100,
        glycogenG: initialLiverGlycogenG,
        storageG: 0,
        outputG: 0,
      },
      pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
    },
  })));
  silence(t);
  let gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  for (let round = 1; round <= 5; round++) await gateway.tick();
  const beforeRestart = gateway.getState();
  assert.ok(beforeRestart.parts.liver.outputG > 0, 'the pre-restart round must still release');
  assert.ok(
    beforeRestart.parts.liver.glycogenG < initialLiverGlycogenG,
    'the pre-restart liver must have spent glycogen',
  );
  await gateway.stop();

  gateway = boot(statePath);
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, beforeRestart.simulatedSeconds);
  assert.deepEqual(restored.parts, beforeRestart.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.ok(
    after.liver.glycogenG < beforeRestart.parts.liver.glycogenG,
    'the restarted liver must keep releasing from the restored store',
  );
  assert.ok(
    after.glucose.glucoseMassG > beforeRestart.parts.glucose.glucoseMassG,
    'the restarted release must keep refilling glucose',
  );
  assert.ok(
    after.pancreasEndocrine.glucagonRelative > 1,
    'the restarted pancreas must keep glucagon above baseline while glucose is still below baseline',
  );
});
