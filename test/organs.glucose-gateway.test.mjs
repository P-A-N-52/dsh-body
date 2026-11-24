import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const muscleRegions = ['muscleHead', 'muscleTrunk', 'muscleLimbs'];

function muscleSum(parts, field) {
  return muscleRegions.reduce((sum, region) => sum + parts[region][field], 0);
}
const baselineMassG = 12.69;
const baselineConcentrationMgDl = 90;
const distributionVolumeDl = 141;
const residualHalfTimeMin = 60;
const basalConsumptionGPerMin = 0.12;
const renalThresholdMgDl = 339 / 1.88;
const initialLiverGlycogenG = 80;
const initialLiverCapacityG = 100;
const initialMuscleGlycogenG = 300;
const initialRegionGlycogen = {
  muscleHead: 15,
  muscleTrunk: 135,
  muscleLimbs: 150,
};
const ledgerToleranceG = 1e-6;
const waterToleranceMl = 1e-6;

function fakeExec({ sessionId = 'glucose-session', callId = 'call-1' } = {}) {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
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
  const gateway = startGateway({
    manifestPath: rootManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  return { gateway, tools: createBodyTools(gateway) };
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-glucose-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  const body = boot(statePath);
  t.after(async () => {
    await body.gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await body.gateway.ready;
  return { ...body, dir, statePath };
}

function queuedCarbohydrateG(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingCarbohydrateG ?? 0), 0);
}

function carbohydrateLedgerG(
  parts,
  cumulativeDisposedG,
  cumulativeExcretedG,
  cumulativeMuscleConsumedG,
  cumulativeKidneyOutputG = 0,
) {
  return parts.stomach.carbohydrateG
    + queuedCarbohydrateG(parts.stomach)
    + parts.smallIntestine.carbohydrateG
    + (parts.glucose.glucoseMassG - baselineMassG)
    + cumulativeDisposedG
    + cumulativeExcretedG
    + (muscleSum(parts, 'glycogenG') - initialMuscleGlycogenG)
    + muscleSum(parts, 'uptakeG')
    + parts.muscleGlucose.uptakeG
    + cumulativeMuscleConsumedG
    + (parts.liver.glycogenG - initialLiverGlycogenG)
    + parts.liver.storageG
    - cumulativeKidneyOutputG;
}

function expectedDisposedG(massG, dtSeconds = 60) {
  const dtMin = dtSeconds / 60;
  const concentrationMgDl = Math.max(0, massG) * 1000 / distributionVolumeDl;
  const basalG = Math.min(
    Math.max(0, massG),
    basalConsumptionGPerMin * dtMin * Math.min(1, Math.max(0, concentrationMgDl / 50)),
  );
  const excessG = Math.max(0, massG - baselineMassG) * (1 - 2 ** (-dtMin / residualHalfTimeMin));
  return Math.min(Math.max(0, massG), basalG + excessG);
}

function expectedExcretionRequestG(concentrationMgDl, dtSeconds = 60) {
  const dtMin = dtSeconds / 60;
  return Math.max(0, concentrationMgDl * 1.88 - 339) * 0.0005 * 75 * dtMin / 1000;
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

function glucosePoolLedgerG(
  parts,
  { disposedG, excretedG, muscleConsumedG, kidneyOutputG = 0 },
  initialGlucoseMassG,
  initialGlycogenG,
) {
  return parts.glucose.glucoseMassG
    + parts.liver.glycogenG
    + parts.liver.storageG
    + muscleSum(parts, 'glycogenG')
    + muscleSum(parts, 'uptakeG')
    + parts.muscleGlucose.uptakeG
    + disposedG
    + excretedG
    + muscleConsumedG
    - initialGlucoseMassG
    - initialGlycogenG
    - kidneyOutputG;
}

function waterLedgerMl(parts, cumulativeVoidedMl, initialMl, cumulativeSweatMl = 0) {
  return parts.stomach.waterVolumeMl
    + parts.stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0)
    + parts.smallIntestine.waterVolumeMl
    + (parts.colon?.residueWaterMl ?? 0)
    + (parts.bodyFluid.waterVolumeMl - initialMl)
    + parts.bladder.volumeMl
    + cumulativeVoidedMl
    + cumulativeSweatMl;
}

test('a 60 g drink and an equal no-carb drink diverge through glucose and duodenum feedback', async (t) => {
  silence(t);
  const withCarb = await startBody(t);
  const withoutCarb = await startBody(t);
  const initialWithCarb = withCarb.gateway.getState().parts;
  const initialWithoutCarb = withoutCarb.gateway.getState().parts;
  const initialWaterWithCarbMl = initialWithCarb.bodyFluid.waterVolumeMl;
  const initialWaterWithoutCarbMl = initialWithoutCarb.bodyFluid.waterVolumeMl;

  assert.ok(initialWithCarb.glucose, 'the root manifest must load the glucose part');
  assert.ok(initialWithoutCarb.glucose, 'the root manifest must load the glucose part');
  assert.ok(initialWithCarb.pancreasEndocrine, 'the root manifest must load the pancreas part');
  assert.ok(initialWithCarb.kidneyGlucose, 'the root manifest must load the kidney glucose part');
  assert.ok(Math.abs(initialWithCarb.glucose.glucoseMassG - baselineMassG) <= 1e-9);
  assert.ok(Math.abs(initialWithCarb.glucose.concentrationMgDl - baselineConcentrationMgDl) <= 1e-9);
  assert.equal(initialWithoutCarb.glucose.disposedGlucoseG, 0);
  assert.equal(initialWithCarb.glucose.excessMassG, 0);
  assert.deepEqual(initialWithCarb.pancreasEndocrine, { insulinRelative: 1, glucagonRelative: 1 });
  assert.deepEqual(initialWithCarb.muscleGlucose, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
  for (const region of muscleRegions) {
    assert.deepEqual(initialWithCarb[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(initialWithCarb.liver, {
    glycogenCapacityG: initialLiverCapacityG,
    glycogenG: initialLiverGlycogenG,
    storageG: 0,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(initialWithCarb.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });

  const meal = { type: 'drink', volumeMl: 240, energyKcal: 100, durationMin: 1 };
  const queuedWithCarb = await withCarb.tools.body_act.execute(
    { ...meal, carbohydrateG: 60 },
    fakeExec({ sessionId: 'glucose-with-carb', callId: 'meal' }),
  );
  const queuedWithoutCarb = await withoutCarb.tools.body_act.execute(
    { ...meal },
    fakeExec({ sessionId: 'glucose-without-carb', callId: 'meal' }),
  );
  assert.equal(queuedWithCarb.statusCode, 202);
  assert.equal(queuedWithCarb.receipt.status, 'queued');
  assert.equal(queuedWithoutCarb.statusCode, 202);

  let withCarbDisposedG = 0;
  let withoutCarbDisposedG = 0;
  let withCarbExcretedG = 0;
  let withoutCarbExcretedG = 0;
  let withCarbMuscleConsumedG = 0;
  let withoutCarbMuscleConsumedG = 0;
  let withCarbKidneyOutputG = 0;
  let withoutCarbKidneyOutputG = 0;
  let withCarbVoidedMl = 0;
  let withoutCarbVoidedMl = 0;
  let withCarbSweatMl = 0;
  let withoutCarbSweatMl = 0;
  let withCarbPeakMgDl = -Infinity;

  async function advance(round, { trackPeak = true } = {}) {
    const beforeWithCarb = withCarb.gateway.getState().parts;
    const beforeWithoutCarb = withoutCarb.gateway.getState().parts;
    withCarbKidneyOutputG += renalOutputG(beforeWithCarb);
    withoutCarbKidneyOutputG += renalOutputG(beforeWithoutCarb);
    await withCarb.gateway.tick();
    await withoutCarb.gateway.tick();
    const withCarbParts = withCarb.gateway.getState().parts;
    const withoutCarbParts = withoutCarb.gateway.getState().parts;
    assert.ok(withCarbParts.glucose, `A round ${round}: missing glucose part`);
    assert.ok(withoutCarbParts.glucose, `B round ${round}: missing glucose part`);
    assert.ok(withCarbParts.pancreasEndocrine, `A round ${round}: missing pancreas part`);
    assert.ok(withoutCarbParts.pancreasEndocrine, `B round ${round}: missing pancreas part`);
    assert.ok(withCarbParts.kidneyGlucose, `A round ${round}: missing kidney glucose part`);
    assert.ok(withoutCarbParts.kidneyGlucose, `B round ${round}: missing kidney glucose part`);
    assert.ok(withCarbParts.liver, `A round ${round}: missing liver part`);
    assert.ok(withoutCarbParts.liver, `B round ${round}: missing liver part`);
    withCarbDisposedG += withCarbParts.glucose.disposedGlucoseG;
    withoutCarbDisposedG += withoutCarbParts.glucose.disposedGlucoseG;
    withCarbExcretedG += withCarbParts.kidneyGlucose.excretedGlucoseG;
    withoutCarbExcretedG += withoutCarbParts.kidneyGlucose.excretedGlucoseG;
    withCarbMuscleConsumedG += muscleSum(withCarbParts, 'glycogenConsumedG');
    withoutCarbMuscleConsumedG += muscleSum(withoutCarbParts, 'glycogenConsumedG');
    withCarbVoidedMl += withCarbParts.bladder.voidedMl;
    withoutCarbVoidedMl += withoutCarbParts.bladder.voidedMl;
    withCarbSweatMl += withCarbParts.skin?.sweatVolumeMl ?? 0;
    withoutCarbSweatMl += withoutCarbParts.skin?.sweatVolumeMl ?? 0;
    if (trackPeak) {
      withCarbPeakMgDl = Math.max(withCarbPeakMgDl, withCarbParts.glucose.concentrationMgDl);
    }
    assert.ok(
      withCarbParts.glucose.concentrationMgDl >= 85,
      `A round ${round}: concentration ${withCarbParts.glucose.concentrationMgDl} dropped unexpectedly low`,
    );
    assert.ok(
      Math.abs(withoutCarbParts.glucose.glucoseMassG - baselineMassG) <= 1e-9,
      `B round ${round}: glucose mass ${withoutCarbParts.glucose.glucoseMassG}`,
    );
    assert.ok(
      Math.abs(withoutCarbParts.glucose.concentrationMgDl - 90) <= 1e-9,
      `B round ${round}: concentration ${withoutCarbParts.glucose.concentrationMgDl}`,
    );
    assert.ok(
      Math.abs(withoutCarbParts.pancreasEndocrine.insulinRelative - 1) <= 1e-12,
      `B round ${round}: insulin ${withoutCarbParts.pancreasEndocrine.insulinRelative}`,
    );
    assert.equal(
      withoutCarbParts.kidneyGlucose.excretionRequestG,
      0,
      `B round ${round}: renal glucose request`,
    );
    assert.equal(
      withoutCarbParts.kidneyGlucose.excretedGlucoseG,
      0,
      `B round ${round}: renal glucose transfer`,
    );

    const withCarbLedgerG = carbohydrateLedgerG(
      withCarbParts,
      withCarbDisposedG,
      withCarbExcretedG,
      withCarbMuscleConsumedG,
      withCarbKidneyOutputG,
    );
    assert.ok(
      Math.abs(withCarbLedgerG - 60) <= ledgerToleranceG,
      `A round ${round}: carbohydrate ledger ${withCarbLedgerG}`,
    );
    const withoutCarbLedgerG = carbohydrateLedgerG(
      withoutCarbParts,
      withoutCarbDisposedG,
      withoutCarbExcretedG,
      withoutCarbMuscleConsumedG,
      withoutCarbKidneyOutputG,
    );
    assert.ok(
      Math.abs(withoutCarbLedgerG) <= ledgerToleranceG,
      `B round ${round}: external carbohydrate ledger ${withoutCarbLedgerG}`,
    );
    const withCarbWaterMl = waterLedgerMl(withCarbParts, withCarbVoidedMl, initialWaterWithCarbMl, withCarbSweatMl);
    assert.ok(
      Math.abs(withCarbWaterMl - 240) <= waterToleranceMl,
      `A round ${round}: water ledger ${withCarbWaterMl}`,
    );
    const withoutCarbWaterMl = waterLedgerMl(
      withoutCarbParts,
      withoutCarbVoidedMl,
      initialWaterWithoutCarbMl,
      withoutCarbSweatMl,
    );
    assert.ok(
      Math.abs(withoutCarbWaterMl - 240) <= waterToleranceMl,
      `B round ${round}: water ledger ${withoutCarbWaterMl}`,
    );
    return { withCarbParts, withoutCarbParts };
  }

  const { withCarbParts: round1A, withoutCarbParts: round1B } = await advance(1);
  assert.ok(Math.abs(round1A.stomach.carbohydrateG - 60) <= 1e-9, 'round 1: stomach carbohydrate');
  assert.equal(round1A.stomach.solidCarbohydrateG, 0);
  assert.equal(round1A.stomach.emptiedCarbohydrateG, 0);
  assert.equal(round1A.smallIntestine.carbohydrateG, 0);
  assert.equal(round1A.smallIntestine.absorbedCarbohydrateG, 0);
  assert.ok(Math.abs(round1A.glucose.concentrationMgDl - 90) <= 1e-9);
  assert.ok(Math.abs(round1A.glucose.glucoseMassG - baselineMassG) <= 1e-9);
  assert.ok(Math.abs(round1A.glucose.disposedGlucoseG - 0.12) <= 1e-12);
  assert.equal(round1B.stomach.carbohydrateG, 0);
  assert.equal(round1B.smallIntestine.carbohydrateG, 0);

  const { withCarbParts: round2A, withoutCarbParts: round2B } = await advance(2);
  assert.ok(round2A.stomach.carbohydrateG > 0, 'round 2: stomach still holds carbohydrate');
  assert.ok(round2A.stomach.carbohydrateG < 60, 'round 2: stomach emptied some carbohydrate');
  assert.ok(round2A.stomach.emptiedCarbohydrateG > 0, 'round 2: gastric carbohydrate emptying');
  assert.ok(round2A.smallIntestine.carbohydrateG > 0, 'round 2: intestinal carbohydrate at round end');
  assert.ok(
    Math.abs(round2A.smallIntestine.carbohydrateG - round2A.stomach.emptiedCarbohydrateG) <= 1e-9,
    'round 2: the intestine received exactly the gastric transfer',
  );
  assert.equal(round2A.smallIntestine.absorbedCarbohydrateG, 0);
  assert.ok(Math.abs(round2A.glucose.concentrationMgDl - 90) <= 1e-9);
  assert.ok(Math.abs(round2A.glucose.glucoseMassG - baselineMassG) <= 1e-9);
  assert.equal(round2B.stomach.carbohydrateG, 0);
  assert.equal(round2B.smallIntestine.carbohydrateG, 0);

  const { withCarbParts: round3A } = await advance(3);
  assert.ok(round3A.smallIntestine.absorbedCarbohydrateG > 0, 'round 3: intestinal absorption');
  assert.ok(round3A.glucose.glucoseMassG > baselineMassG, 'round 3: absorbed mass reaches glucose');
  assert.ok(Math.abs(round3A.glucose.concentrationMgDl - 90) <= 1e-9);

  const { withCarbParts: round4A, withoutCarbParts: round4B } = await advance(4);
  assert.ok(round4A.glucose.concentrationMgDl > 90.01, 'round 4: concentration reads the new mass');
  assert.ok(round4A.glucose.glucoseMassG > round4B.glucose.glucoseMassG);
  assert.ok(Math.abs(round4B.glucose.concentrationMgDl - 90) <= 1e-9);
  assert.ok(
    Math.abs(round4A.pancreasEndocrine.insulinRelative - 1) <= 1e-12,
    'round 4: the pancreas still reads the old baseline concentration',
  );
  const expectedDisposed4G = expectedDisposedG(round3A.glucose.glucoseMassG);
  assert.ok(
    Math.abs(round4A.glucose.disposedGlucoseG - expectedDisposed4G) <= 1e-12,
    'round 4: disposal uses basal consumption plus excess disposal',
  );
  assert.equal(round4A.muscleGlucose.uptakeG, 0, 'round 4: no earlier muscle request to settle');
  assert.equal(round4A.liver.storageG, 0, 'round 4: no earlier liver request to settle');

  const { withCarbParts: round5A, withoutCarbParts: round5B } = await advance(5);
  assert.ok(
    round5A.pancreasEndocrine.insulinRelative > 1,
    `round 5: insulin ${round5A.pancreasEndocrine.insulinRelative} should rise`,
  );
  const expectedDisposed5G = expectedDisposedG(round4A.glucose.glucoseMassG);
  assert.ok(
    Math.abs(round5A.glucose.disposedGlucoseG - expectedDisposed5G) <= 1e-12,
    'round 5: disposal ignores the rising insulin signal',
  );
  assert.ok(round5A.muscleGlucose.uptakeRequestG > 0, 'round 5: muscle writes its first request');
  assert.ok(round5A.liver.storageRequestG > 0, 'round 5: liver writes its first request');
  assert.equal(round5A.muscleGlucose.uptakeG, 0, 'round 5: the fresh request is not paid yet');
  assert.equal(round5A.liver.storageG, 0, 'round 5: the fresh request is not paid yet');
  assert.equal(round5A.kidneyGlucose.excretionRequestG, 0);
  assert.equal(round5A.kidneyGlucose.excretedGlucoseG, 0);
  assert.ok(Math.abs(round5B.glucose.concentrationMgDl - 90) <= 1e-9);

  const { withCarbParts: round6A } = await advance(6);
  const expectedDisposed6G = expectedDisposedG(round5A.glucose.glucoseMassG);
  assert.ok(
    Math.abs(round6A.glucose.disposedGlucoseG - expectedDisposed6G) <= 1e-12,
    'round 6: disposal still ignores insulin',
  );
  assert.ok(
    Math.abs(round6A.muscleGlucose.uptakeG - round5A.muscleGlucose.uptakeRequestG) <= 1e-12,
    'round 6: muscle receives the previous round request',
  );
  assert.ok(
    Math.abs(round6A.liver.storageG - round5A.liver.storageRequestG) <= 1e-12,
    'round 6: liver receives the previous round request',
  );
  assert.equal(round6A.kidneyGlucose.excretionRequestG, 0);
  assert.equal(round6A.kidneyGlucose.excretedGlucoseG, 0);

  for (let round = 7; round <= 299; round++) {
    await advance(round);
  }
  const { withCarbParts: finalWithCarb, withoutCarbParts: finalWithoutCarb } = await advance(300, {
    trackPeak: false,
  });

  assert.ok(withCarbPeakMgDl > 100, `A peak concentration ${withCarbPeakMgDl}`);
  assert.ok(
    finalWithCarb.glucose.concentrationMgDl < withCarbPeakMgDl,
    `A concentration ${finalWithCarb.glucose.concentrationMgDl} should fall from peak ${withCarbPeakMgDl}`,
  );
  assert.ok(
    finalWithCarb.glucose.concentrationMgDl >= 85 && finalWithCarb.glucose.concentrationMgDl <= 95,
    `A final concentration ${finalWithCarb.glucose.concentrationMgDl} must settle near baseline`,
  );
  assert.ok(finalWithCarb.stomach.carbohydrateG < 1, 'A stomach has emptied most carbohydrate');
  assert.ok(finalWithCarb.smallIntestine.carbohydrateG < 2, 'A intestine has absorbed most carbohydrate');
  assert.ok(Math.abs(finalWithoutCarb.glucose.glucoseMassG - baselineMassG) <= 1e-9);
  assert.ok(Math.abs(finalWithoutCarb.glucose.concentrationMgDl - 90) <= 1e-9);
  assert.ok(Math.abs(finalWithoutCarb.glucose.disposedGlucoseG - 0.12) <= 1e-12);
  assert.ok(
    Math.abs(finalWithoutCarb.liver.glycogenG - (initialLiverGlycogenG - 300 * 0.096)) <= 1e-9,
    'fasting liver glycogen depletes at 0.096 g/min while holding 90 mg/dL steady',
  );
  assert.deepEqual(finalWithoutCarb.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.ok(Math.abs(finalWithoutCarb.pancreasEndocrine.insulinRelative - 1) <= 1e-12);
});

test('a preset high concentration writes requests, then settles them one round later without double counting', async (t) => {
  silence(t);
  const highMassG = 50.76;
  const highConcentrationMgDl = 360;
  const startExcessG = highMassG - baselineMassG;
  const startInsulinRelative = 1;
  const expectedRequestG = expectedExcretionRequestG(highConcentrationMgDl);
  const expectedMuscleRequestG = 0.5
    * startExcessG / (startExcessG + 20)
    * (1 + 1.0 * (startInsulinRelative - 1));
  const expectedLiverRequestG = Math.min(
    0.2 * startExcessG / (startExcessG + 15)
      * (1 + 0.5 * (startInsulinRelative - 1)),
    initialLiverCapacityG - initialLiverGlycogenG,
  );
  const { gateway } = await startBody(t, {
    parts: {
      glucose: {
        glucoseMassG: highMassG,
        concentrationMgDl: highConcentrationMgDl,
        disposedGlucoseG: 0,
        excessMassG: startExcessG,
      },
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
      pancreasEndocrine: { insulinRelative: startInsulinRelative, glucagonRelative: 1 },
    },
  });
  const expectedDisposed1G = expectedDisposedG(highMassG);
  const kidney1G = renalOutputG(gateway.getState().parts);

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.equal(first.muscleGlucose.uptakeG, 0, 'round 1: no request is settled yet');
  assert.equal(first.liver.storageG, 0, 'round 1: no request is settled yet');
  assert.ok(
    Math.abs(first.muscleGlucose.uptakeRequestG - expectedMuscleRequestG) <= 1e-12,
    `round 1: muscle request ${first.muscleGlucose.uptakeRequestG} != ${expectedMuscleRequestG}`,
  );
  assert.ok(
    Math.abs(first.liver.storageRequestG - expectedLiverRequestG) <= 1e-12,
    `round 1: liver request ${first.liver.storageRequestG} != ${expectedLiverRequestG}`,
  );
  assert.ok(
    Math.abs(first.kidneyGlucose.excretionRequestG - expectedRequestG) <= 1e-12,
    `round 1: request ${first.kidneyGlucose.excretionRequestG} != ${expectedRequestG}`,
  );
  assert.equal(first.kidneyGlucose.excretedGlucoseG, 0, 'round 1: a new request must not transfer yet');
  assert.ok(Math.abs(first.glucose.disposedGlucoseG - expectedDisposed1G) <= 1e-12);
  assert.ok(
    Math.abs(first.glucose.glucoseMassG - (highMassG - expectedDisposed1G + first.liver.outputG + kidney1G)) <= 1e-12,
    'round 1 writes disposal and receives suppressed EGP, no request settlement',
  );
  assert.ok(first.pancreasEndocrine.insulinRelative > startInsulinRelative);
  assert.ok(first.pancreasEndocrine.glucagonRelative < 1);

  const kidney2G = renalOutputG(first);
  await gateway.tick();
  const second = gateway.getState().parts;
  const expectedDisposed2G = expectedDisposedG(first.glucose.glucoseMassG);
  assert.ok(Math.abs(second.glucose.disposedGlucoseG - expectedDisposed2G) <= 1e-12);
  assert.ok(
    Math.abs(second.kidneyGlucose.excretedGlucoseG - expectedRequestG) <= 1e-12,
    `round 2: transfer ${second.kidneyGlucose.excretedGlucoseG} != request ${expectedRequestG}`,
  );
  assert.ok(
    Math.abs(second.muscleGlucose.uptakeG - expectedMuscleRequestG) <= 1e-12,
    'round 2: muscle receives the previous round request',
  );
  assert.ok(
    Math.abs(second.liver.storageG - expectedLiverRequestG) <= 1e-12,
    'round 2: liver receives the previous round request',
  );
  assert.ok(
    Math.abs(
      second.glucose.glucoseMassG
        - (first.glucose.glucoseMassG
          - expectedDisposed2G
          - second.muscleGlucose.uptakeG
          - second.liver.storageG
          - expectedRequestG
          + second.liver.outputG
          + kidney2G),
    ) <= 1e-12,
    'the same round must subtract disposal and sinks and add suppressed EGP',
  );
  assert.ok(
    Math.abs(
      highMassG
        + first.liver.outputG
        + second.liver.outputG
        + kidney1G
        + kidney2G
        - (
          second.glucose.glucoseMassG
          + expectedDisposed1G
          + expectedDisposed2G
          + second.muscleGlucose.uptakeG
          + second.liver.storageG
          + expectedRequestG
        ),
    ) <= 1e-9,
    'disposal, muscle uptake, liver storage, renal transfer and EGP must balance without double counting',
  );
});

test('a full liver requests only its basal-output gap while muscle still takes up glucose', async (t) => {
  silence(t);
  const startMassG = 50.76;
  const startConcentrationMgDl = 360;
  const initialGlycogenG = 100;
  const startExcessG = startMassG - baselineMassG;
  const seedParts = {
    glucose: {
      glucoseMassG: startMassG,
      concentrationMgDl: startConcentrationMgDl,
      disposedGlucoseG: 0,
      excessMassG: startExcessG,
    },
    pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
  };
  const { gateway } = await startBody(t, {
    parts: {
      ...seedParts,
      liver: {
        glycogenCapacityG: initialLiverCapacityG,
        glycogenG: initialGlycogenG,
        storageG: 0,
        outputG: 0,
      },
    },
  });
  const free = await startBody(t, {
    parts: {
      ...seedParts,
      liver: {
        glycogenCapacityG: initialLiverCapacityG,
        glycogenG: initialLiverGlycogenG,
        storageG: 0,
        outputG: 0,
      },
    },
  });
  const expectedDisposedGVal = expectedDisposedG(startMassG);
  const cumulative = { disposedG: 0, excretedG: 0, muscleConsumedG: 0, kidneyOutputG: 0 };

  cumulative.kidneyOutputG += renalOutputG(gateway.getState().parts);
  await gateway.tick();
  await free.gateway.tick();
  const first = gateway.getState().parts;
  const firstFree = free.gateway.getState().parts;
  assert.equal(first.liver.storageRequestG, 0, 'a full liver must request no storage at start');
  assert.ok(firstFree.liver.storageRequestG > 0, 'a free liver must request storage');
  assert.equal(first.liver.storageG, 0, 'round 1 has no settlement yet');
  assert.ok(
    Math.abs(first.glucose.disposedGlucoseG - expectedDisposedGVal) <= 1e-12,
    'disposal covers basal consumption plus excess disposal',
  );
  assert.ok(
    Math.abs(first.muscleGlucose.uptakeRequestG - firstFree.muscleGlucose.uptakeRequestG) <= 1e-12,
    'the full liver does not change the muscle request',
  );

  cumulative.kidneyOutputG += renalOutputG(first);
  await gateway.tick();
  await free.gateway.tick();
  const second = gateway.getState().parts;
  const secondFree = free.gateway.getState().parts;
  assert.equal(second.liver.storageG, 0, 'round 2 receives the zero round-1 request');
  assert.ok(
    Math.abs(second.liver.storageRequestG - first.liver.outputG) <= 1e-12,
    'full liver requests only the gap created by its basal output',
  );
  assert.ok(second.liver.glycogenG <= initialGlycogenG, 'glycogen must not exceed capacity');
  assert.ok(second.muscleGlucose.uptakeG > 0, 'muscle still receives the prior request');
  assert.ok(secondFree.liver.storageG > 0, 'a free liver receives the prior request');

  cumulative.disposedG += first.glucose.disposedGlucoseG + second.glucose.disposedGlucoseG;
  cumulative.excretedG += first.kidneyGlucose.excretedGlucoseG
    + second.kidneyGlucose.excretedGlucoseG;
  cumulative.muscleConsumedG += muscleSum(first, 'glycogenConsumedG')
    + muscleSum(second, 'glycogenConsumedG');
  let previousMassG = second.glucose.glucoseMassG;
  for (let round = 3; round <= 5; round++) {
    cumulative.kidneyOutputG += renalOutputG(gateway.getState().parts);
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.liver.glycogenG <= initialGlycogenG, `round ${round}: glycogen stays <= capacity`);
    cumulative.disposedG += parts.glucose.disposedGlucoseG;
    cumulative.excretedG += parts.kidneyGlucose.excretedGlucoseG;
    cumulative.muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    const ledgerG = glucosePoolLedgerG(parts, cumulative, startMassG, initialGlycogenG + initialMuscleGlycogenG);
    assert.ok(
      Math.abs(ledgerG) <= ledgerToleranceG,
      `round ${round}: internal glucose ledger ${ledgerG}`,
    );
    assert.ok(parts.glucose.glucoseMassG < previousMassG, `round ${round}: mass must fall`);
    previousMassG = parts.glucose.glucoseMassG;
  }
});

test('an old checkpoint without the new fields settles after the request lag and never excretes retroactively', async (t) => {
  silence(t);
  const oldMassG = 50.76;
  const oldConcentrationMgDl = 360;
  const { gateway } = await startBody(t, {
    parts: {
      glucose: {
        glucoseMassG: oldMassG,
        concentrationMgDl: oldConcentrationMgDl,
        disposedGlucoseG: 2,
      },
    },
  });
  const loaded = gateway.getState().parts;
  assert.equal(loaded.glucose.glucoseMassG, oldMassG);
  assert.equal(loaded.glucose.disposedGlucoseG, 2);
  assert.equal(loaded.glucose.excessMassG, 0, 'the missing excess signal starts at zero');
  assert.deepEqual(loaded.muscleGlucose, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
  for (const region of muscleRegions) {
    assert.deepEqual(loaded[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(loaded.pancreasEndocrine, { insulinRelative: 1, glucagonRelative: 1 });
  assert.deepEqual(loaded.liver, {
    glycogenCapacityG: initialLiverCapacityG,
    glycogenG: initialLiverGlycogenG,
    storageG: 0,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(loaded.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });

  const expectedRequestG = expectedExcretionRequestG(oldConcentrationMgDl);
  const expectedDisposed1G = expectedDisposedG(oldMassG);
  const kidney1G = renalOutputG(loaded);
  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(Math.abs(first.glucose.disposedGlucoseG - expectedDisposed1G) <= 1e-12);
  assert.ok(
    Math.abs(first.glucose.glucoseMassG - (oldMassG - expectedDisposed1G + first.liver.outputG + kidney1G)) <= 1e-12,
    'the first round writes disposal and adds suppressed EGP',
  );
  assert.equal(first.muscleGlucose.uptakeG, 0, 'the old checkpoint has no earlier muscle request');
  assert.equal(first.liver.storageG, 0, 'the old checkpoint has no earlier liver request');
  assert.equal(first.muscleGlucose.uptakeRequestG, 0, 'the old excess signal is zero in round 1');
  assert.equal(first.liver.storageRequestG, 0, 'the old excess signal is zero in round 1');
  assert.equal(first.kidneyGlucose.excretedGlucoseG, 0, 'the old checkpoint must not excrete retroactively');
  assert.ok(
    Math.abs(first.kidneyGlucose.excretionRequestG - expectedRequestG) <= 1e-12,
    'the first round writes only a request from the round-start concentration',
  );

  await gateway.tick();
  const second = gateway.getState().parts;
  const expectedDisposed2G = expectedDisposedG(first.glucose.glucoseMassG);
  assert.ok(Math.abs(second.glucose.disposedGlucoseG - expectedDisposed2G) <= 1e-12);
  assert.ok(
    Math.abs(second.kidneyGlucose.excretedGlucoseG - expectedRequestG) <= 1e-12,
    'the request written in the first round transfers in the second',
  );
  assert.equal(second.muscleGlucose.uptakeG, 0, 'muscle requests start only after round 1');
  assert.equal(second.liver.storageG, 0, 'liver requests start only after round 1');
  assert.ok(second.muscleGlucose.uptakeRequestG > 0, 'muscle writes its first request in round 2');
  assert.ok(second.liver.storageRequestG > 0, 'liver writes its first request in round 2');

  await gateway.tick();
  const third = gateway.getState().parts;
  assert.ok(
    Math.abs(third.muscleGlucose.uptakeG - second.muscleGlucose.uptakeRequestG) <= 1e-12,
    'the round-2 muscle request transfers in round 3',
  );
  assert.ok(
    Math.abs(third.liver.storageG - second.liver.storageRequestG) <= 1e-12,
    'the round-2 liver request transfers in round 3',
  );
});

test('concentrations at or below the renal threshold never request or transfer kidney glucose', async (t) => {
  silence(t);
  for (const concentrationMgDl of [renalThresholdMgDl - 1, renalThresholdMgDl]) {
    const massG = concentrationMgDl * distributionVolumeDl / 1000;
    const { gateway } = await startBody(t, {
      parts: {
        glucose: { glucoseMassG: massG, concentrationMgDl: concentrationMgDl, disposedGlucoseG: 0 },
      },
    });
    for (let round = 1; round <= 3; round++) {
      await gateway.tick();
      const parts = gateway.getState().parts;
      assert.equal(
        parts.kidneyGlucose.excretionRequestG,
        0,
        `${concentrationMgDl} mg/dL round ${round}: request`,
      );
      assert.equal(
        parts.kidneyGlucose.excretedGlucoseG,
        0,
        `${concentrationMgDl} mg/dL round ${round}: transfer`,
      );
    }
  }
});

test('a preseeded low glucose save with liver glycogen refills toward baseline and spends the store', async (t) => {
  silence(t);
  const initialGlucoseMassG = 6;
  const initialConcentrationMgDl = initialGlucoseMassG * 1000 / distributionVolumeDl;
  const initialGlycogenG = 80;
  const { gateway } = await startBody(t, {
    parts: {
      glucose: {
        glucoseMassG: initialGlucoseMassG,
        concentrationMgDl: initialConcentrationMgDl,
        disposedGlucoseG: 0,
      },
      liver: {
        glycogenCapacityG: initialLiverCapacityG,
        glycogenG: initialGlycogenG,
        storageG: 0,
        outputG: 0,
      },
      pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
    },
  });
  const cumulative = { disposedG: 0, excretedG: 0, muscleConsumedG: 0, kidneyOutputG: 0 };
  let previousMassG = initialGlucoseMassG;
  let previousConcentrationMgDl = initialConcentrationMgDl;
  let previousGlycogenG = initialGlycogenG;
  let peakConcentrationMgDl = initialConcentrationMgDl;

  for (let round = 1; round <= 40; round++) {
    const before = gateway.getState().parts;
    cumulative.kidneyOutputG += renalOutputG(before);
    await gateway.tick();
    const parts = gateway.getState().parts;
    const releaseG = parts.liver.outputG;
    assert.ok(releaseG >= 0, `round ${round}: release must not be negative`);
    if (round === 1) {
      assert.ok(releaseG > 0, 'round 1: low glucose must trigger a liver release');
      assert.ok(
        Math.abs(parts.liver.glycogenG - (initialGlycogenG - releaseG)) <= 1e-12,
        'round 1: the release must be deducted from glycogen',
      );
      assert.ok(parts.pancreasEndocrine.glucagonRelative > 1, 'round 1: glucagon must rise');
      assert.ok(parts.pancreasEndocrine.insulinRelative < 1, 'round 1: insulin must fall');
    }
    cumulative.disposedG += parts.glucose.disposedGlucoseG;
    cumulative.excretedG += parts.kidneyGlucose.excretedGlucoseG;
    cumulative.muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    const ledgerG = glucosePoolLedgerG(
      parts,
      cumulative,
      initialGlucoseMassG,
      initialGlycogenG + initialMuscleGlycogenG,
    );
    assert.ok(
      Math.abs(ledgerG) <= ledgerToleranceG,
      `round ${round}: internal glucose ledger ${ledgerG}`,
    );
    previousMassG = parts.glucose.glucoseMassG;
    previousConcentrationMgDl = parts.glucose.concentrationMgDl;
    previousGlycogenG = parts.liver.glycogenG;
    peakConcentrationMgDl = Math.max(peakConcentrationMgDl, previousConcentrationMgDl);
  }

  assert.ok(
    Math.abs(previousConcentrationMgDl - baselineConcentrationMgDl) < 5,
    `concentration ${previousConcentrationMgDl} must settle smoothly near ${baselineConcentrationMgDl}`,
  );
  assert.ok(
    peakConcentrationMgDl < 105,
    `smooth recovery must not overshoot into >120 mg/dL sawtooth, peak was ${peakConcentrationMgDl}`,
  );
  assert.ok(previousMassG > initialGlucoseMassG, 'glucose mass must be refilled');
  assert.ok(previousGlycogenG < initialGlycogenG, 'liver glycogen must be spent');
});

test('a low glucose save without liver glycogen is refilled by kidney gluconeogenesis', async (t) => {
  silence(t);
  const initialGlucoseMassG = 6;
  const initialConcentrationMgDl = initialGlucoseMassG * 1000 / distributionVolumeDl;
  const { gateway } = await startBody(t, {
    parts: {
      glucose: {
        glucoseMassG: initialGlucoseMassG,
        concentrationMgDl: initialConcentrationMgDl,
        disposedGlucoseG: 0,
      },
      liver: {
        glycogenCapacityG: initialLiverCapacityG,
        glycogenG: 0,
        storageG: 0,
        outputG: 0,
      },
      pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
    },
  });
  const cumulative = { disposedG: 0, excretedG: 0, muscleConsumedG: 0, kidneyOutputG: 0 };
  let previousMassG = initialGlucoseMassG;

  for (let round = 1; round <= 40; round++) {
    const before = gateway.getState().parts;
    const expectedOutputG = renalOutputG(before);
    assert.ok(expectedOutputG > 0.024, `round ${round}: low glucose must drive above-basal rate`);
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(parts.liver.outputG, 0, `round ${round}: empty liver must not release`);
    assert.equal(parts.liver.glycogenG, 0, `round ${round}: glycogen must stay empty`);
    assert.deepEqual(
      parts.kidneyGluconeogenesis,
      { glucoseOutputG: 0 },
      `round ${round}: the transfer must drain the kidney output field`,
    );
    assert.ok(
      Math.abs(parts.glucose.glucoseMassG - (previousMassG - parts.glucose.disposedGlucoseG + expectedOutputG)) <= 1e-12,
      `round ${round}: kidney output minus basal consumption must equal pool change`,
    );
    if (round === 1) {
      assert.ok(parts.pancreasEndocrine.glucagonRelative > 1, 'glucagon still rises without glycogen');
    }
    cumulative.disposedG += parts.glucose.disposedGlucoseG;
    cumulative.excretedG += parts.kidneyGlucose.excretedGlucoseG;
    cumulative.muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    cumulative.kidneyOutputG += expectedOutputG;
    const ledgerG = glucosePoolLedgerG(parts, cumulative, initialGlucoseMassG, initialMuscleGlycogenG);
    assert.ok(Math.abs(ledgerG) <= ledgerToleranceG, `round ${round}: ledger ${ledgerG}`);
    previousMassG = parts.glucose.glucoseMassG;
  }

  assert.ok(previousMassG > initialGlucoseMassG, 'the kidney must refill the glucose pool');
  assert.ok(
    gateway.getState().parts.glucose.concentrationMgDl > initialConcentrationMgDl,
    'concentration must rise with the refilled mass',
  );
});

test('the root manifest fails to start when the liver transfer declarations are missing', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-glucose-no-liver-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts
      .filter((path) => !path.includes('/liver/'))
      .map((path) => relative(dir, join(root, path))),
  }));
  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    gateway.ready,
    /transferOut target "liver\.storageG" is not declared/,
  );
});

test('a three-round solid meal releases its queue and keeps the solid subset in the ledger', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t);
  const queued = await tools.body_act.execute(
    {
      type: 'eat',
      volumeMl: 300,
      energyKcal: 600,
      mealKind: 'solid',
      durationMin: 3,
      carbohydrateG: 90,
    },
    fakeExec({ sessionId: 'solid-three-round', callId: 'meal' }),
  );
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  const solidFraction = 1 - 2 ** (-1 / 68.7);
  const round1StomachG = 30;
  const round2StomachG = round1StomachG - round1StomachG * solidFraction + 30;
  const round3StomachG = round2StomachG - round2StomachG * solidFraction + 30;
  const expectedStomachG = [round1StomachG, round2StomachG, round3StomachG];
  const expectedEmptiedG = [0, round1StomachG * solidFraction, round2StomachG * solidFraction];
  const expectedQueueG = [60, 30, 0];

  let disposedG = 0;
  let excretedG = 0;
  let muscleConsumedG = 0;
  let kidneyOutputG = 0;
  for (let round = 1; round <= 3; round++) {
    kidneyOutputG += renalOutputG(gateway.getState().parts);
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.glucose, `round ${round}: missing glucose part`);
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    const expectedG = expectedStomachG[round - 1];
    assert.ok(
      Math.abs(parts.stomach.carbohydrateG - expectedG) <= 1e-9,
      `round ${round}: stomach carbohydrate ${parts.stomach.carbohydrateG} != ${expectedG}`,
    );
    assert.ok(
      Math.abs(parts.stomach.solidCarbohydrateG - expectedG) <= 1e-9,
      `round ${round}: solid subset ${parts.stomach.solidCarbohydrateG} != ${expectedG}`,
    );
    assert.ok(
      Math.abs(parts.stomach.emptiedCarbohydrateG - expectedEmptiedG[round - 1]) <= 1e-9,
      `round ${round}: emptied carbohydrate ${parts.stomach.emptiedCarbohydrateG}`,
    );
    assert.ok(
      Math.abs(queuedCarbohydrateG(parts.stomach) - expectedQueueG[round - 1]) <= 1e-9,
      `round ${round}: queued carbohydrate ${queuedCarbohydrateG(parts.stomach)}`,
    );
    if (round < 3) {
      assert.ok(Math.abs(parts.stomach.mealQueue[0].rateCarbohydrateGPerRound - 30) <= 1e-9);
    }
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 90) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );

    if (round === 2) {
      assert.ok(Math.abs(parts.smallIntestine.carbohydrateG - expectedEmptiedG[1]) <= 1e-9);
      assert.equal(parts.smallIntestine.absorbedCarbohydrateG, 0);
    }
    if (round === 3) {
      const absorbedG = expectedEmptiedG[1] * (1 - 2 ** (-1 / 20));
      assert.ok(
        Math.abs(parts.smallIntestine.absorbedCarbohydrateG - absorbedG) <= 1e-9,
        `round 3: absorbed ${parts.smallIntestine.absorbedCarbohydrateG} != ${absorbedG}`,
      );
      assert.ok(
        Math.abs(parts.glucose.glucoseMassG - (baselineMassG + absorbedG)) <= 1e-9,
        `round 3: glucose mass ${parts.glucose.glucoseMassG}`,
      );
      assert.ok(Math.abs(parts.glucose.concentrationMgDl - 90) <= 1e-9);
      assert.equal(parts.stomach.mealQueue.length, 0);
    }
  }

  kidneyOutputG += renalOutputG(gateway.getState().parts);
  await gateway.tick();
  const afterQueue = gateway.getState().parts;
  assert.ok(afterQueue.glucose, 'missing glucose part after the queue');
  disposedG += afterQueue.glucose.disposedGlucoseG;
  excretedG += afterQueue.kidneyGlucose.excretedGlucoseG;
  muscleConsumedG += muscleSum(afterQueue, 'glycogenConsumedG');
  assert.ok(afterQueue.glucose.concentrationMgDl > 90.01, 'the delayed concentration rises after the queue');
  assert.ok(
    Math.abs(carbohydrateLedgerG(afterQueue, disposedG, excretedG, muscleConsumedG, kidneyOutputG) - 90)
      <= ledgerToleranceG,
  );

  for (let round = 5; round <= 60; round++) {
    kidneyOutputG += renalOutputG(gateway.getState().parts);
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.glucose, `round ${round}: missing glucose part`);
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    assert.ok(
      parts.stomach.solidCarbohydrateG <= parts.stomach.carbohydrateG + 1e-9,
      `round ${round}: solid subset exceeds total carbohydrate`,
    );
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 90) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );
  }
});

test('a restart on the same checkpoint keeps the solid mass and pending queue conserving', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-glucose-restart-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  let body = boot(statePath);
  let disposedG = 0;
  let excretedG = 0;
  let muscleConsumedG = 0;
  let kidneyOutputG = 0;
  try {
    await body.gateway.ready;
    const queued = await body.tools.body_act.execute(
      {
        type: 'eat',
        volumeMl: 300,
        energyKcal: 600,
        mealKind: 'solid',
        durationMin: 6,
        carbohydrateG: 90,
      },
      fakeExec({ sessionId: 'restart-solid', callId: 'meal' }),
    );
    assert.equal(queued.statusCode, 202);

    for (let round = 1; round <= 5; round++) {
      kidneyOutputG += renalOutputG(body.gateway.getState().parts);
      await body.gateway.tick();
      const parts = body.gateway.getState().parts;
      assert.ok(parts.glucose, `round ${round}: missing glucose part`);
      disposedG += parts.glucose.disposedGlucoseG;
      excretedG += parts.kidneyGlucose.excretedGlucoseG;
      muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
      const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
      assert.ok(
        Math.abs(ledgerG - 90) <= ledgerToleranceG,
        `before restart round ${round}: carbohydrate ledger ${ledgerG}`,
      );
    }

    const beforeRestart = body.gateway.getState();
    assert.equal(beforeRestart.simulatedSeconds, 300);
    assert.ok(beforeRestart.parts.stomach.carbohydrateG > 30);
    assert.ok(
      beforeRestart.parts.glucose.glucoseMassG > baselineMassG,
      'at least one absorption round must be committed before restart',
    );
    assert.ok(
      beforeRestart.parts.glucose.concentrationMgDl > baselineConcentrationMgDl,
      'the committed concentration read must be above baseline before restart',
    );
    assert.ok(
      beforeRestart.parts.glucose.disposedGlucoseG > 0,
      'the committed disposal flux must be non-zero before restart',
    );
    assert.ok(
      beforeRestart.parts.pancreasEndocrine.insulinRelative > 1,
      'the committed insulin signal must be above baseline before restart',
    );
    assert.deepEqual(
      beforeRestart.parts.kidneyGlucose,
      { excretionRequestG: 0, excretedGlucoseG: 0 },
      'a sub-threshold meal must not have requested or excreted kidney glucose',
    );
    assert.ok(
      Math.abs(beforeRestart.parts.stomach.mealQueue[0].remainingCarbohydrateG - 15) <= 1e-9,
      'the last solid slice is still queued before restart',
    );
    await body.gateway.stop();

    body = boot(statePath);
    await body.gateway.ready;
    const restored = body.gateway.getState();
    assert.equal(restored.simulatedSeconds, 300);
    assert.deepEqual(restored.parts, beforeRestart.parts);
    assert.ok(
      restored.parts.glucose.glucoseMassG > baselineMassG,
      'restart reset glucose to the baseline instead of keeping the non-baseline mass',
    );
    assert.ok(
      Math.abs(restored.parts.glucose.glucoseMassG - beforeRestart.parts.glucose.glucoseMassG) <= 1e-12,
    );
    assert.ok(
      restored.parts.glucose.concentrationMgDl > baselineConcentrationMgDl,
      'restart reset the concentration read instead of keeping it',
    );
    assert.ok(
      Math.abs(restored.parts.glucose.concentrationMgDl - beforeRestart.parts.glucose.concentrationMgDl) <= 1e-12,
    );
    assert.ok(
      restored.parts.glucose.disposedGlucoseG > 0,
      'restart reset the disposal flux instead of keeping it',
    );
    assert.ok(
      Math.abs(restored.parts.glucose.disposedGlucoseG - beforeRestart.parts.glucose.disposedGlucoseG) <= 1e-12,
    );
    assert.ok(
      Math.abs(
        restored.parts.pancreasEndocrine.insulinRelative
          - beforeRestart.parts.pancreasEndocrine.insulinRelative,
      ) <= 1e-12,
      'restart must keep the committed insulin signal',
    );
    assert.deepEqual(
      restored.parts.kidneyGlucose,
      beforeRestart.parts.kidneyGlucose,
      'restart must keep the committed kidney glucose request and transfer',
    );
    assert.ok(
      Math.abs(restored.parts.stomach.mealQueue[0].remainingCarbohydrateG - 15) <= 1e-9,
      'restart lost the remaining queued carbohydrate',
    );

    for (let round = 6; round <= 20; round++) {
      kidneyOutputG += renalOutputG(body.gateway.getState().parts);
      await body.gateway.tick();
      const parts = body.gateway.getState().parts;
      assert.ok(parts.glucose, `round ${round}: missing glucose part`);
      disposedG += parts.glucose.disposedGlucoseG;
      excretedG += parts.kidneyGlucose.excretedGlucoseG;
      muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
      const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
      assert.ok(
        Math.abs(ledgerG - 90) <= ledgerToleranceG,
        `after restart round ${round}: carbohydrate ledger ${ledgerG}`,
      );
      if (round === 6) {
        assert.equal(parts.stomach.mealQueue.length, 0, 'the queued slice released after restart');
        const expectedDisposed6G = expectedDisposedG(beforeRestart.parts.glucose.glucoseMassG);
        assert.ok(
          Math.abs(parts.glucose.disposedGlucoseG - expectedDisposed6G) <= 1e-12,
          'the first round after restart computes basal consumption plus excess disposal',
        );
      }
    }
  } finally {
    await body.gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a meal fills muscle glycogen and exercise consumes it without breaking the ledger', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t);
  const queued = await tools.body_act.execute(
    { type: 'drink', volumeMl: 240, energyKcal: 100, durationMin: 1, carbohydrateG: 60 },
    fakeExec({ sessionId: 'muscle-exercise', callId: 'meal' }),
  );
  assert.equal(queued.statusCode, 202);

  let disposedG = 0;
  let excretedG = 0;
  let muscleConsumedG = 0;
  let kidneyOutputG = 0;
  let previousGlycogenG = initialMuscleGlycogenG;
  for (let round = 1; round <= 120; round++) {
    kidneyOutputG += renalOutputG(gateway.getState().parts);
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.muscleGlucose, `round ${round}: missing muscle glucose part`);
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );
    if (round >= 8) {
      assert.ok(
        muscleSum(parts, 'glycogenG') > previousGlycogenG,
        `round ${round}: regional glycogen ${muscleSum(parts, 'glycogenG')} must rise above ${previousGlycogenG}`,
      );
    }
    previousGlycogenG = muscleSum(parts, 'glycogenG');
  }
  assert.ok(
    previousGlycogenG > initialMuscleGlycogenG + 15,
    `regional glycogen ${previousGlycogenG} must accumulate during the meal`,
  );
  assert.equal(muscleSum(gateway.getState().parts, 'glycogenConsumedG'), 0);

  const exerciseRound = 121;
  assert.equal(
    gateway.submitAction({
      id: 'muscle-exercise-1',
      type: 'exercise',
      intensity: 1,
      durationMin: 30,
    }).statusCode,
    202,
  );

  let activeRounds = 0;
  const regionShares = { muscleHead: 0.05, muscleTrunk: 0.45, muscleLimbs: 0.5 };
  for (let round = exerciseRound; round <= exerciseRound + 39; round++) {
    kidneyOutputG += renalOutputG(gateway.getState().parts);
    await gateway.tick();
    const parts = gateway.getState().parts;
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );
    if (round === exerciseRound) {
      assert.equal(parts.physicalActivity.intensity, 1, 'the action round stores the activity');
      assert.equal(muscleSum(parts, 'glycogenConsumedG'), 0, 'the action round has no round-start activity');
    } else if (round <= exerciseRound + 30) {
      activeRounds += 1;
      const consumedG = muscleSum(parts, 'glycogenConsumedG');
      const totalGlycogenG = muscleSum(parts, 'glycogenG');
      assert.ok(consumedG > 0 && consumedG <= 0.5 + 1e-12, `round ${round}: consumption ${consumedG}`);
      assert.ok(totalGlycogenG < previousGlycogenG, `round ${round}: regional glycogen must fall`);
      for (const region of muscleRegions) {
        assert.ok(parts[region].glycogenConsumedG >= 0, `${round}: ${region} consumption`);
        assert.ok(
          parts[region].glycogenConsumedG <= 0.5 * regionShares[region] + 1e-12,
          `${round}: ${region} share-scaled consumption cap`,
        );
        assert.ok(parts[region].glycogenG >= 0, `${round}: ${region} glycogen`);
      }
    } else {
      assert.equal(muscleSum(parts, 'glycogenConsumedG'), 0, `round ${round}: consumption must return to zero`);
    }
    previousGlycogenG = muscleSum(parts, 'glycogenG');
  }
  assert.equal(activeRounds, 30);
  assert.equal(gateway.getState().parts.physicalActivity.remainingExerciseMin, 0);
});

test('a restart with in-flight muscle uptake books it exactly once and keeps the ledger', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-glucose-muscle-restart-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  let body = boot(statePath);
  let disposedG = 0;
  let excretedG = 0;
  let muscleConsumedG = 0;
  let kidneyOutputG = 0;
  try {
    await body.gateway.ready;
    const queued = await body.tools.body_act.execute(
      { type: 'drink', volumeMl: 240, energyKcal: 100, durationMin: 1, carbohydrateG: 60 },
      fakeExec({ sessionId: 'muscle-restart', callId: 'meal' }),
    );
    assert.equal(queued.statusCode, 202);

    for (let round = 1; round <= 30; round++) {
      kidneyOutputG += renalOutputG(body.gateway.getState().parts);
      await body.gateway.tick();
      const parts = body.gateway.getState().parts;
      disposedG += parts.glucose.disposedGlucoseG;
      excretedG += parts.kidneyGlucose.excretedGlucoseG;
      muscleConsumedG += muscleSum(parts, 'glycogenConsumedG');
      const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
      assert.ok(
        Math.abs(ledgerG - 60) <= ledgerToleranceG,
        `before restart round ${round}: carbohydrate ledger ${ledgerG}`,
      );
    }

    const beforeRestart = body.gateway.getState();
    const inFlightG = beforeRestart.parts.muscleGlucose.uptakeG;
    const glycogenBeforeG = muscleSum(beforeRestart.parts, 'glycogenG');
    const regionUptakeBeforeG = muscleSum(beforeRestart.parts, 'uptakeG');
    assert.ok(inFlightG > 0, 'the last committed round must leave an in-flight muscle uptake');
    assert.ok(glycogenBeforeG > initialMuscleGlycogenG, 'the earlier uptake must already be booked as glycogen');
    await body.gateway.stop();

    body = boot(statePath);
    await body.gateway.ready;
    const restored = body.gateway.getState();
    assert.deepEqual(restored.parts, beforeRestart.parts);
    assert.equal(restored.parts.muscleGlucose.uptakeG, inFlightG);
    let ledgerG = carbohydrateLedgerG(restored.parts, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `restored carbohydrate ledger ${ledgerG}`,
    );

    kidneyOutputG += renalOutputG(body.gateway.getState().parts);
    await body.gateway.tick();
    const after = body.gateway.getState().parts;
    assert.ok(
      Math.abs(muscleSum(after, 'uptakeG') - inFlightG) <= 1e-12,
      `regional uptake ${muscleSum(after, 'uptakeG')} must receive the in-flight ${inFlightG} once`,
    );
    assert.ok(
      Math.abs(muscleSum(after, 'glycogenG') - (glycogenBeforeG + regionUptakeBeforeG)) <= 1e-12,
      'the handoff round books only the regional uptake that was already in flight',
    );
    disposedG += after.glucose.disposedGlucoseG;
    excretedG += after.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += muscleSum(after, 'glycogenConsumedG');
    ledgerG = carbohydrateLedgerG(after, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `after restart carbohydrate ledger ${ledgerG}`,
    );

    kidneyOutputG += renalOutputG(body.gateway.getState().parts);
    await body.gateway.tick();
    const next = body.gateway.getState().parts;
    assert.ok(
      Math.abs(
        muscleSum(next, 'glycogenG') - (glycogenBeforeG + regionUptakeBeforeG + inFlightG),
      ) <= 1e-12,
      'the restored in-flight uptake must not be booked twice',
    );
    disposedG += next.glucose.disposedGlucoseG;
    excretedG += next.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += muscleSum(next, 'glycogenConsumedG');
    ledgerG = carbohydrateLedgerG(next, disposedG, excretedG, muscleConsumedG, kidneyOutputG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `second round after restart carbohydrate ledger ${ledgerG}`,
    );
  } finally {
    await body.gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
