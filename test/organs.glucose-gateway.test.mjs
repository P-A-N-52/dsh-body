import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const baselineMassG = 12.69;
const baselineConcentrationMgDl = 90;
const distributionVolumeDl = 141;
const disposalHalfTimeMin = 60;
const renalThresholdMgDl = 339 / 1.88;
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
) {
  return parts.stomach.carbohydrateG
    + queuedCarbohydrateG(parts.stomach)
    + parts.smallIntestine.carbohydrateG
    + (parts.glucose.glucoseMassG - baselineMassG)
    + cumulativeDisposedG
    + cumulativeExcretedG
    + parts.muscleGlucose.glycogenG
    + parts.muscleGlucose.uptakeG
    + cumulativeMuscleConsumedG;
}

function expectedExcretionRequestG(concentrationMgDl, dtSeconds = 60) {
  const dtMin = dtSeconds / 60;
  return Math.max(0, concentrationMgDl * 1.88 - 339) * 0.0005 * 75 * dtMin / 1000;
}

function waterLedgerMl(parts, cumulativeVoidedMl, initialMl) {
  return parts.stomach.waterVolumeMl
    + parts.stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0)
    + parts.smallIntestine.waterVolumeMl
    + (parts.bodyFluid.waterVolumeMl - initialMl)
    + parts.bladder.volumeMl
    + cumulativeVoidedMl;
}

test('a 60 g drink and an equal no-carb drink diverge only through the glucose chain', async (t) => {
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
  assert.deepEqual(initialWithCarb.pancreasEndocrine, { insulinRelative: 1 });
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
  let withCarbVoidedMl = 0;
  let withoutCarbVoidedMl = 0;
  let withCarbPeakMgDl = -Infinity;
  const recordedRounds = [];

  async function advance(round, { trackPeak = true } = {}) {
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
    for (const [field, withCarbValue, withoutCarbValue] of [
      ['stomach.volumeMl', withCarbParts.stomach.volumeMl, withoutCarbParts.stomach.volumeMl],
      ['stomach.energyKcal', withCarbParts.stomach.energyKcal, withoutCarbParts.stomach.energyKcal],
      ['stomach.waterVolumeMl', withCarbParts.stomach.waterVolumeMl, withoutCarbParts.stomach.waterVolumeMl],
      ['smallIntestine.waterVolumeMl', withCarbParts.smallIntestine.waterVolumeMl, withoutCarbParts.smallIntestine.waterVolumeMl],
      ['bodyFluid.waterVolumeMl', withCarbParts.bodyFluid.waterVolumeMl, withoutCarbParts.bodyFluid.waterVolumeMl],
      ['bladder.volumeMl', withCarbParts.bladder.volumeMl, withoutCarbParts.bladder.volumeMl],
    ]) {
      assert.equal(
        withCarbValue,
        withoutCarbValue,
        `round ${round}: ${field} differs (${withCarbValue} != ${withoutCarbValue})`,
      );
    }
    withCarbDisposedG += withCarbParts.glucose.disposedGlucoseG;
    withoutCarbDisposedG += withoutCarbParts.glucose.disposedGlucoseG;
    withCarbExcretedG += withCarbParts.kidneyGlucose.excretedGlucoseG;
    withoutCarbExcretedG += withoutCarbParts.kidneyGlucose.excretedGlucoseG;
    withCarbMuscleConsumedG += withCarbParts.muscleGlucose.glycogenConsumedG;
    withoutCarbMuscleConsumedG += withoutCarbParts.muscleGlucose.glycogenConsumedG;
    withCarbVoidedMl += withCarbParts.bladder.voidedMl;
    withoutCarbVoidedMl += withoutCarbParts.bladder.voidedMl;
    if (trackPeak) {
      withCarbPeakMgDl = Math.max(withCarbPeakMgDl, withCarbParts.glucose.concentrationMgDl);
    }
    assert.ok(
      withCarbParts.glucose.concentrationMgDl >= 90 - 1e-9,
      `A round ${round}: concentration fell below baseline`,
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
    );
    assert.ok(
      Math.abs(withoutCarbLedgerG) <= ledgerToleranceG,
      `B round ${round}: external carbohydrate ledger ${withoutCarbLedgerG}`,
    );
    const withCarbWaterMl = waterLedgerMl(withCarbParts, withCarbVoidedMl, initialWaterWithCarbMl);
    assert.ok(
      Math.abs(withCarbWaterMl - 240) <= waterToleranceMl,
      `A round ${round}: water ledger ${withCarbWaterMl}`,
    );
    const withoutCarbWaterMl = waterLedgerMl(withoutCarbParts, withoutCarbVoidedMl, initialWaterWithoutCarbMl);
    assert.ok(
      Math.abs(withoutCarbWaterMl - 240) <= waterToleranceMl,
      `B round ${round}: water ledger ${withoutCarbWaterMl}`,
    );
    recordedRounds.push({ round, parts: withCarbParts });
    return { withCarbParts, withoutCarbParts };
  }

  const { withCarbParts: round1A, withoutCarbParts: round1B } = await advance(1);
  assert.ok(Math.abs(round1A.stomach.carbohydrateG - 60) <= 1e-9, 'round 1: stomach carbohydrate');
  assert.equal(round1A.stomach.solidCarbohydrateG, 0);
  assert.equal(round1A.stomach.emptiedCarbohydrateG, 0);
  assert.equal(round1A.smallIntestine.carbohydrateG, 0);
  assert.equal(round1A.smallIntestine.absorbedCarbohydrateG, 0);
  assert.ok(Math.abs(round1A.glucose.concentrationMgDl - 90) <= 1e-9);
  assert.equal(round1A.glucose.glucoseMassG, baselineMassG);
  assert.equal(round1A.glucose.disposedGlucoseG, 0);
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
  assert.equal(round2A.glucose.glucoseMassG, baselineMassG);
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
  const expectedDisposed4G = (round3A.glucose.glucoseMassG - baselineMassG)
    * (1 - 2 ** (-1 / disposalHalfTimeMin)) * 0.25;
  assert.ok(
    Math.abs(round4A.glucose.disposedGlucoseG - expectedDisposed4G) <= 1e-12,
    'round 4: residual disposal is a quarter of the total at I=1',
  );

  const { withCarbParts: round5A, withoutCarbParts: round5B } = await advance(5);
  assert.ok(
    round5A.pancreasEndocrine.insulinRelative > 1,
    `round 5: insulin ${round5A.pancreasEndocrine.insulinRelative} should rise`,
  );
  const expectedDisposed5G = (round4A.glucose.glucoseMassG - baselineMassG)
    * (1 - 2 ** (-1 / disposalHalfTimeMin)) * 0.25;
  assert.ok(
    Math.abs(round5A.glucose.disposedGlucoseG - expectedDisposed5G) <= 1e-12,
    'round 5: residual disposal still uses the round-start I=1 signal',
  );
  assert.equal(round5A.kidneyGlucose.excretionRequestG, 0);
  assert.equal(round5A.kidneyGlucose.excretedGlucoseG, 0);
  assert.ok(Math.abs(round5B.glucose.concentrationMgDl - 90) <= 1e-9);

  const { withCarbParts: round6A } = await advance(6);
  const surplus5G = round5A.glucose.glucoseMassG - baselineMassG;
  const baselineDisposed6G = surplus5G
    * (1 - 2 ** (-1 / disposalHalfTimeMin)) * 0.25;
  const acceleratedDisposed6G = surplus5G
    * (1 - 2 ** (-round5A.pancreasEndocrine.insulinRelative / disposalHalfTimeMin)) * 0.25;
  assert.ok(
    round6A.glucose.disposedGlucoseG > baselineDisposed6G + 1e-9,
    `round 6: disposal ${round6A.glucose.disposedGlucoseG} should exceed the I=1 ${baselineDisposed6G}`,
  );
  assert.ok(
    Math.abs(round6A.glucose.disposedGlucoseG - acceleratedDisposed6G) <= 1e-12,
    'round 6: disposal uses the previous round insulin signal',
  );
  assert.equal(round6A.kidneyGlucose.excretionRequestG, 0);
  assert.equal(round6A.kidneyGlucose.excretedGlucoseG, 0);

  for (let round = 7; round <= 239; round++) {
    await advance(round);
  }
  const { withCarbParts: finalWithCarb, withoutCarbParts: finalWithoutCarb } = await advance(240, {
    trackPeak: false,
  });

  assert.ok(withCarbPeakMgDl > 100, `A peak concentration ${withCarbPeakMgDl}`);
  assert.ok(
    finalWithCarb.glucose.concentrationMgDl < withCarbPeakMgDl,
    `A concentration ${finalWithCarb.glucose.concentrationMgDl} should fall from peak ${withCarbPeakMgDl}`,
  );
  assert.ok(finalWithCarb.glucose.concentrationMgDl >= 90 - 1e-9);
  assert.ok(finalWithCarb.stomach.carbohydrateG < 1, 'A stomach has emptied most carbohydrate');
  assert.ok(finalWithCarb.smallIntestine.carbohydrateG < 2, 'A intestine has absorbed most carbohydrate');
  assert.ok(withCarbExcretedG > 0, 'the 60 g meal must eventually transfer kidney glucose');
  assert.ok(Math.abs(finalWithoutCarb.glucose.glucoseMassG - baselineMassG) <= 1e-9);
  assert.ok(Math.abs(finalWithoutCarb.glucose.concentrationMgDl - 90) <= 1e-9);
  assert.equal(finalWithoutCarb.glucose.disposedGlucoseG, 0);
  assert.deepEqual(finalWithoutCarb.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.ok(Math.abs(finalWithoutCarb.pancreasEndocrine.insulinRelative - 1) <= 1e-12);

  const crossingIndex = recordedRounds.findIndex(
    ({ parts }) => parts.glucose.concentrationMgDl > renalThresholdMgDl,
  );
  assert.ok(
    crossingIndex >= 0,
    `the 60 g meal must cross ${renalThresholdMgDl} mg/dL; peak ${withCarbPeakMgDl}`,
  );
  for (const { round, parts } of recordedRounds.slice(0, crossingIndex + 1)) {
    assert.equal(parts.kidneyGlucose.excretionRequestG, 0, `round ${round}: premature renal request`);
    assert.equal(parts.kidneyGlucose.excretedGlucoseG, 0, `round ${round}: premature renal transfer`);
  }
  const crossing = recordedRounds[crossingIndex];
  const requestRound = recordedRounds[crossingIndex + 1];
  const transferRound = recordedRounds[crossingIndex + 2];
  assert.ok(requestRound && transferRound, 'crossing must leave a request round and a transfer round');
  assert.ok(
    requestRound.parts.kidneyGlucose.excretionRequestG > 0,
    `round ${requestRound.round}: the crossing concentration must write a request`,
  );
  assert.ok(
    Math.abs(
      requestRound.parts.kidneyGlucose.excretionRequestG
        - expectedExcretionRequestG(crossing.parts.glucose.concentrationMgDl),
    ) <= 1e-12,
    `round ${requestRound.round}: request does not match the round-start concentration`,
  );
  assert.equal(
    requestRound.parts.kidneyGlucose.excretedGlucoseG,
    0,
    `round ${requestRound.round}: a new request must not transfer in the same round`,
  );
  assert.ok(
    transferRound.parts.kidneyGlucose.excretedGlucoseG > 0,
    `round ${transferRound.round}: the previous request must transfer`,
  );
  assert.ok(
    Math.abs(
      transferRound.parts.kidneyGlucose.excretedGlucoseG
        - requestRound.parts.kidneyGlucose.excretionRequestG,
    ) <= 1e-12,
    `round ${transferRound.round}: transfer must equal the previous request`,
  );
});

test('a preset high concentration requests next round and transfers the following round without double counting', async (t) => {
  silence(t);
  const highMassG = 50.76;
  const highConcentrationMgDl = 360;
  const startInsulinRelative = 1;
  const { gateway } = await startBody(t, {
    parts: {
      glucose: { glucoseMassG: highMassG, concentrationMgDl: highConcentrationMgDl, disposedGlucoseG: 0 },
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
      pancreasEndocrine: { insulinRelative: startInsulinRelative },
    },
  });
  const expectedRequestG = expectedExcretionRequestG(highConcentrationMgDl);
  const expectedDisposed1G = (highMassG - baselineMassG)
    * (1 - 2 ** (-1 / disposalHalfTimeMin)) * 0.25;

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.muscleGlucose.uptakeG > 0, 'round 1: the muscle share must transfer');
  assert.ok(
    Math.abs(first.kidneyGlucose.excretionRequestG - expectedRequestG) <= 1e-12,
    `round 1: request ${first.kidneyGlucose.excretionRequestG} != ${expectedRequestG}`,
  );
  assert.equal(first.kidneyGlucose.excretedGlucoseG, 0, 'round 1: a new request must not transfer yet');
  assert.ok(Math.abs(first.glucose.disposedGlucoseG - expectedDisposed1G) <= 1e-12);
  assert.ok(
    Math.abs(
      first.glucose.glucoseMassG
        - (highMassG - expectedDisposed1G - first.muscleGlucose.uptakeG),
    ) <= 1e-12,
  );
  assert.ok(first.pancreasEndocrine.insulinRelative > startInsulinRelative);
  const insulin1 = first.pancreasEndocrine.insulinRelative;

  await gateway.tick();
  const second = gateway.getState().parts;
  const expectedDisposed2G = (first.glucose.glucoseMassG - baselineMassG)
    * (1 - 2 ** (-insulin1 / disposalHalfTimeMin)) * 0.25;
  assert.ok(Math.abs(second.glucose.disposedGlucoseG - expectedDisposed2G) <= 1e-12);
  assert.ok(
    Math.abs(second.kidneyGlucose.excretedGlucoseG - expectedRequestG) <= 1e-12,
    `round 2: transfer ${second.kidneyGlucose.excretedGlucoseG} != request ${expectedRequestG}`,
  );
  assert.ok(
    Math.abs(
      second.glucose.glucoseMassG
        - (first.glucose.glucoseMassG
          - expectedDisposed2G
          - second.muscleGlucose.uptakeG
          - expectedRequestG),
    ) <= 1e-12,
    'the same round must subtract residual disposal, muscle uptake and renal transfer',
  );
  assert.ok(
    Math.abs(
      highMassG
        - (
          second.glucose.glucoseMassG
          + expectedDisposed1G
          + expectedDisposed2G
          + first.muscleGlucose.uptakeG
          + second.muscleGlucose.uptakeG
          + expectedRequestG
        ),
    ) <= 1e-9,
    'insulin disposal, muscle uptake and renal transfer must not double count',
  );
});

test('an old checkpoint without the new parts starts at I=1 with no renal request or transfer', async (t) => {
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
  assert.deepEqual(loaded.muscleGlucose, { uptakeG: 0, glycogenG: 0, glycogenConsumedG: 0 });
  assert.deepEqual(loaded.pancreasEndocrine, { insulinRelative: 1 });
  assert.deepEqual(loaded.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });

  const expectedRequestG = expectedExcretionRequestG(oldConcentrationMgDl);
  const expectedDisposed1G = (oldMassG - baselineMassG)
    * (1 - 2 ** (-1 / disposalHalfTimeMin)) * 0.25;
  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.muscleGlucose.uptakeG > 0, 'the old checkpoint must start transferring to muscle');
  assert.ok(Math.abs(first.glucose.disposedGlucoseG - expectedDisposed1G) <= 1e-12);
  assert.ok(
    Math.abs(
      first.glucose.glucoseMassG
        - (oldMassG - expectedDisposed1G - first.muscleGlucose.uptakeG),
    ) <= 1e-12,
  );
  assert.equal(first.kidneyGlucose.excretedGlucoseG, 0, 'the old checkpoint must not excrete retroactively');
  assert.ok(
    Math.abs(first.kidneyGlucose.excretionRequestG - expectedRequestG) <= 1e-12,
    'the first round writes only a request from the round-start concentration',
  );

  await gateway.tick();
  const second = gateway.getState().parts;
  assert.ok(
    Math.abs(second.kidneyGlucose.excretedGlucoseG - expectedRequestG) <= 1e-12,
    'the request written in the first round transfers in the second',
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
  for (let round = 1; round <= 3; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.glucose, `round ${round}: missing glucose part`);
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
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
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
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

  await gateway.tick();
  const afterQueue = gateway.getState().parts;
  assert.ok(afterQueue.glucose, 'missing glucose part after the queue');
  disposedG += afterQueue.glucose.disposedGlucoseG;
  excretedG += afterQueue.kidneyGlucose.excretedGlucoseG;
  muscleConsumedG += afterQueue.muscleGlucose.glycogenConsumedG;
  assert.ok(afterQueue.glucose.concentrationMgDl > 90.01, 'the delayed concentration rises after the queue');
  assert.ok(
    Math.abs(carbohydrateLedgerG(afterQueue, disposedG, excretedG, muscleConsumedG) - 90)
      <= ledgerToleranceG,
  );

  for (let round = 5; round <= 60; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.glucose, `round ${round}: missing glucose part`);
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
    assert.ok(
      parts.stomach.solidCarbohydrateG <= parts.stomach.carbohydrateG + 1e-9,
      `round ${round}: solid subset exceeds total carbohydrate`,
    );
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
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
      await body.gateway.tick();
      const parts = body.gateway.getState().parts;
      assert.ok(parts.glucose, `round ${round}: missing glucose part`);
      disposedG += parts.glucose.disposedGlucoseG;
      excretedG += parts.kidneyGlucose.excretedGlucoseG;
      muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
      const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
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
      await body.gateway.tick();
      const parts = body.gateway.getState().parts;
      assert.ok(parts.glucose, `round ${round}: missing glucose part`);
      disposedG += parts.glucose.disposedGlucoseG;
      excretedG += parts.kidneyGlucose.excretedGlucoseG;
      muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
      const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
      assert.ok(
        Math.abs(ledgerG - 90) <= ledgerToleranceG,
        `after restart round ${round}: carbohydrate ledger ${ledgerG}`,
      );
      if (round === 6) {
        assert.equal(parts.stomach.mealQueue.length, 0, 'the queued slice released after restart');
        const expectedDisposedG = (beforeRestart.parts.glucose.glucoseMassG - baselineMassG)
          * (1 - 2 ** (-beforeRestart.parts.pancreasEndocrine.insulinRelative / disposalHalfTimeMin))
          * 0.25;
        assert.ok(
          Math.abs(parts.glucose.disposedGlucoseG - expectedDisposedG) <= 1e-12,
          'the first round after restart must use the restored insulin signal',
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
  let previousGlycogenG = 0;
  for (let round = 1; round <= 80; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.muscleGlucose, `round ${round}: missing muscle glucose part`);
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );
    if (round >= 5) {
      assert.ok(
        parts.muscleGlucose.glycogenG > previousGlycogenG,
        `round ${round}: glycogen ${parts.muscleGlucose.glycogenG} must rise above ${previousGlycogenG}`,
      );
    }
    previousGlycogenG = parts.muscleGlucose.glycogenG;
  }
  assert.ok(
    previousGlycogenG > 15,
    `glycogen ${previousGlycogenG} must cover 30 minutes at 0.5 g/min`,
  );
  assert.equal(gateway.getState().parts.muscleGlucose.glycogenConsumedG, 0);

  const exerciseRound = 81;
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
  for (let round = exerciseRound; round <= 120; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    disposedG += parts.glucose.disposedGlucoseG;
    excretedG += parts.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
    const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `round ${round}: carbohydrate ledger ${ledgerG}`,
    );
    if (round === exerciseRound) {
      assert.equal(parts.physicalActivity.intensity, 1, 'the action round stores the activity');
      assert.equal(parts.muscleGlucose.glycogenConsumedG, 0, 'the action round has no round-start activity');
    } else if (round <= exerciseRound + 30) {
      activeRounds += 1;
      assert.equal(parts.muscleGlucose.glycogenConsumedG, 0.5, `round ${round}: consumption`);
      assert.ok(
        parts.muscleGlucose.glycogenG < previousGlycogenG,
        `round ${round}: glycogen ${parts.muscleGlucose.glycogenG} must fall below ${previousGlycogenG}`,
      );
    } else {
      assert.equal(parts.muscleGlucose.glycogenConsumedG, 0, `round ${round}: consumption must return to zero`);
    }
    previousGlycogenG = parts.muscleGlucose.glycogenG;
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
  try {
    await body.gateway.ready;
    const queued = await body.tools.body_act.execute(
      { type: 'drink', volumeMl: 240, energyKcal: 100, durationMin: 1, carbohydrateG: 60 },
      fakeExec({ sessionId: 'muscle-restart', callId: 'meal' }),
    );
    assert.equal(queued.statusCode, 202);

    for (let round = 1; round <= 30; round++) {
      await body.gateway.tick();
      const parts = body.gateway.getState().parts;
      disposedG += parts.glucose.disposedGlucoseG;
      excretedG += parts.kidneyGlucose.excretedGlucoseG;
      muscleConsumedG += parts.muscleGlucose.glycogenConsumedG;
      const ledgerG = carbohydrateLedgerG(parts, disposedG, excretedG, muscleConsumedG);
      assert.ok(
        Math.abs(ledgerG - 60) <= ledgerToleranceG,
        `before restart round ${round}: carbohydrate ledger ${ledgerG}`,
      );
    }

    const beforeRestart = body.gateway.getState();
    const inFlightG = beforeRestart.parts.muscleGlucose.uptakeG;
    const glycogenBeforeG = beforeRestart.parts.muscleGlucose.glycogenG;
    assert.ok(inFlightG > 0, 'the last committed round must leave an in-flight muscle uptake');
    assert.ok(glycogenBeforeG > 0, 'the earlier uptake must already be booked as glycogen');
    await body.gateway.stop();

    body = boot(statePath);
    await body.gateway.ready;
    const restored = body.gateway.getState();
    assert.deepEqual(restored.parts, beforeRestart.parts);
    assert.equal(restored.parts.muscleGlucose.uptakeG, inFlightG);
    let ledgerG = carbohydrateLedgerG(restored.parts, disposedG, excretedG, muscleConsumedG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `restored carbohydrate ledger ${ledgerG}`,
    );

    await body.gateway.tick();
    const after = body.gateway.getState().parts;
    assert.ok(
      Math.abs(after.muscleGlucose.glycogenG - (glycogenBeforeG + inFlightG)) <= 1e-12,
      `glycogen ${after.muscleGlucose.glycogenG} must book the in-flight ${inFlightG} once`,
    );
    disposedG += after.glucose.disposedGlucoseG;
    excretedG += after.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += after.muscleGlucose.glycogenConsumedG;
    ledgerG = carbohydrateLedgerG(after, disposedG, excretedG, muscleConsumedG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `after restart carbohydrate ledger ${ledgerG}`,
    );

    await body.gateway.tick();
    const next = body.gateway.getState().parts;
    assert.ok(
      Math.abs(
        next.muscleGlucose.glycogenG
          - (glycogenBeforeG + inFlightG + after.muscleGlucose.uptakeG),
      ) <= 1e-12,
      'the restored in-flight uptake must not be booked twice',
    );
    disposedG += next.glucose.disposedGlucoseG;
    excretedG += next.kidneyGlucose.excretedGlucoseG;
    muscleConsumedG += next.muscleGlucose.glycogenConsumedG;
    ledgerG = carbohydrateLedgerG(next, disposedG, excretedG, muscleConsumedG);
    assert.ok(
      Math.abs(ledgerG - 60) <= ledgerToleranceG,
      `second round after restart carbohydrate ledger ${ledgerG}`,
    );
  } finally {
    await body.gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
