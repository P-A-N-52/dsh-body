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
const initialBodyWaterMl = 30000;
const partIds = [
  'adrenal',
  'autonomic',
  'bladder',
  'blood',
  'bloodCalcium',
  'bloodOxygen',
  'bodyFluid',
  'brainNotify',
  'colon',
  'duodenum',
  'esophagus',
  'glucose',
  'heart',
  'hypothalamusAdh',
  'hypothalamusEndocrine',
  'hypothalamusThirst',
  'interoception',
  'kidney',
  'kidneyGluconeogenesis',
  'kidneyGlucose',
  'liver',
  'lungs',
  'lungsVentilation',
  'muscleGlucose',
  'muscleHead',
  'muscleLimbs',
  'muscleTrunk',
  'pancreasEndocrine',
  'parathyroid',
  'physicalActivity',
  'pineal',
  'pituitary',
  'reward',
  'salivaryGlands',
  'sexualResponse',
  'skin',
  'sleep',
  'smallIntestine',
  'stomach',
  'stomachGhrelin',
  'stomachSensory',
  'thermoregulation',
  'thyroid',
];

function fakeExec({ sessionId = 'water-session', callId = 'call-1' } = {}) {
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

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-water-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  const gateway = startGateway({
    manifestPath: rootManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, statePath, dir, tools: createBodyTools(gateway) };
}

function waterTotal(parts, initialMl = initialBodyWaterMl, cumulativeSweatMl = 0) {
  return parts.stomach.waterVolumeMl
    + parts.smallIntestine.waterVolumeMl
    + colonResidueMl(parts)
    + (parts.bodyFluid.waterVolumeMl - initialMl)
    + parts.bladder.volumeMl
    + cumulativeSweatMl;
}

function colonResidueMl(parts) {
  return parts.colon?.residueWaterMl ?? 0;
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function waterLedgerMl(parts, cumulativeVoidedMl, initialMl = initialBodyWaterMl, cumulativeSweatMl = 0) {
  return parts.stomach.waterVolumeMl
    + queuedWaterMl(parts.stomach)
    + parts.smallIntestine.waterVolumeMl
    + colonResidueMl(parts)
    + (parts.bodyFluid.waterVolumeMl - initialMl)
    + parts.bladder.volumeMl
    + cumulativeVoidedMl
    + cumulativeSweatMl;
}

test('the legacy motility entry still starts alone without water targets', async (t) => {
  silence(t);
  const dir = mkdtempSync(join(tmpdir(), 'dsh-legacy-stomach-'));
  const statePath = join(dir, 'body-state.json');
  const manifestPath = join(dir, 'body-modules.json');
  const motilityPath = join(root, 'organs/human-organs/stomach/motility.ts');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: [relative(dir, motilityPath)],
    catchUpMinutes: 0,
    scriptTimeoutMs: 10000,
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
  await gateway.ready;

  assert.deepEqual(Object.keys(gateway.getState().parts), ['stomach']);
  assert.deepEqual(gateway.getCapabilities(), { drink: ['stomach'], eat: ['stomach'] });
  assert.equal(gateway.submitAction({ id: 'legacy-drink', type: 'drink', volumeMl: 240 }).statusCode, 202);

  await gateway.tick();
  const afterIntake = gateway.getState().parts;
  assert.equal(afterIntake.stomach.volumeMl, 240);
  assert.equal(Object.hasOwn(afterIntake.stomach, 'waterVolumeMl'), false);
  assert.equal(Object.hasOwn(afterIntake, 'smallIntestine'), false);

  await gateway.tick();
  const afterEmptying = gateway.getState().parts;
  assert.ok(afterEmptying.stomach.volumeMl < 240);
  assert.equal(Object.hasOwn(afterEmptying, 'smallIntestine'), false);
});

test('an old root checkpoint keeps old stomach values and only fills new parts', async (t) => {
  silence(t);
  const legacyStomach = {
    volumeMl: 240,
    energyKcal: 50,
    solidVolumeMl: 100,
    solidEnergyKcal: 50,
    emptiedMl: 12,
    emptiedKcal: 3,
    lastIntakeAt: 0,
    mealQueue: [{
      remainingMl: 100,
      remainingKcal: 20,
      rateMlPerRound: 50,
      rateKcalPerRound: 10,
      remainingRounds: 2,
      mealKind: 'solid',
    }],
  };
  const { gateway } = await startBody(t, { parts: { stomach: legacyStomach } });

  const loaded = gateway.getState().parts;
  assert.deepEqual(Object.keys(loaded).sort(), partIds);
  assert.equal(loaded.stomach.volumeMl, 240);
  assert.equal(loaded.stomach.energyKcal, 50);
  assert.equal(loaded.stomach.solidVolumeMl, 100);
  assert.equal(loaded.stomach.solidEnergyKcal, 50);
  assert.equal(loaded.stomach.emptiedMl, 12);
  assert.equal(loaded.stomach.emptiedKcal, 3);
  assert.equal(loaded.stomach.lastIntakeAt, 0);
  assert.deepEqual(loaded.stomach.mealQueue, legacyStomach.mealQueue);
  assert.equal(loaded.stomach.waterVolumeMl, 0);
  assert.equal(loaded.stomach.emptiedWaterMl, 0);
  assert.equal(loaded.stomach.carbohydrateG, 0);
  assert.equal(loaded.stomach.solidCarbohydrateG, 0);
  assert.equal(loaded.stomach.emptiedCarbohydrateG, 0);
  assert.deepEqual(loaded.smallIntestine, {
    waterVolumeMl: 0,
    absorbedWaterMl: 0,
    carbohydrateG: 0,
    absorbedCarbohydrateG: 0,
  });
  assert.deepEqual(loaded.glucose, {
    glucoseMassG: 12.69,
    concentrationMgDl: 90,
    disposedGlucoseG: 0,
    excessMassG: 0,
  });
  assert.deepEqual(loaded.bodyFluid, { waterVolumeMl: 30000, waterDeficit: 0 });
  assert.deepEqual(loaded.hypothalamusAdh, { relativeConcentration: 1 });
  assert.deepEqual(loaded.hypothalamusThirst, { thirst: 50 });
  assert.deepEqual(loaded.kidney, { urineProductionRequestMl: 0 });
  assert.deepEqual(loaded.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.deepEqual(loaded.pancreasEndocrine, { insulinPmolL: 60, glucagonRelative: 1 });
  assert.deepEqual(loaded.liver, {
    glycogenCapacityG: 100,
    glycogenG: 80,
    storageG: 0,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(loaded.bladder, {
    volumeMl: 0,
    voidedMl: 0,
    voluntaryVoidedMl: 0,
    involuntaryVoidedMl: 0,
  });
  assert.deepEqual(loaded.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  const initialRegionGlycogen = {
    muscleHead: 15,
    muscleTrunk: 135,
    muscleLimbs: 150,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(loaded[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(loaded.sexualResponse, {
    arousalMm: 0,
    phase: 'rest',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
    afterglowMm: 0,
  });
  assert.deepEqual(loaded.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(loaded.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(after.stomach.waterVolumeMl, 0);
  assert.equal(after.stomach.emptiedWaterMl, 0);
  assert.equal(after.smallIntestine.waterVolumeMl, 0);
  assert.equal(after.stomach.carbohydrateG, 0);
  assert.equal(after.stomach.solidCarbohydrateG, 0);
  assert.equal(after.stomach.emptiedCarbohydrateG, 0);
  assert.equal(after.smallIntestine.carbohydrateG, 0);
  assert.equal(after.smallIntestine.absorbedCarbohydrateG, 0);
  assert.deepEqual(after.glucose, {
    glucoseMassG: 12.69,
    concentrationMgDl: 90,
    disposedGlucoseG: 0.12,
    excessMassG: 0,
  });
  assert.deepEqual(after.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.deepEqual(after.pancreasEndocrine, { insulinPmolL: 60, glucagonRelative: 1 });
  assert.equal(after.stomach.mealQueue.length, 1);
  assert.equal(after.stomach.mealQueue[0].remainingRounds, 1);

  const nonSolidEmptiedMl = 140 * (1 - 2 ** (-1 / 13));
  const solidEmptiedMl = 100 * (1 - 2 ** (-1 / 68.7));
  assert.ok(
    Math.abs(after.stomach.volumeMl - ((140 - nonSolidEmptiedMl) + (100 - solidEmptiedMl + 50))) < 1e-9,
  );
  assert.ok(
    Math.abs(after.stomach.energyKcal - ((50 - 50 * (solidEmptiedMl / 100)) + 10)) < 1e-9,
  );
  assert.equal(after.bladder.volumeMl, 0);
  assert.equal(after.bodyFluid.waterVolumeMl, 30000);
  assert.deepEqual(after.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(after.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
});

test('240 mL drink over 120 rounds conserves water and moves every signal', async (t) => {
  silence(t);
  const control = await startBody(t);
  const drink = await startBody(t);
  assert.equal(
    drink.gateway.submitAction({ id: 'drink-240', type: 'drink', volumeMl: 240 }).statusCode,
    202,
  );

  let controlVoidedMl = 0;
  let drinkVoidedMl = 0;
  let controlSweatMl = 0;
  let drinkSweatMl = 0;
  let maxErrorMl = 0;
  let controlParts;
  let drinkParts;

  for (let round = 1; round <= 120; round++) {
    await control.gateway.tick();
    await drink.gateway.tick();
    controlParts = control.gateway.getState().parts;
    drinkParts = drink.gateway.getState().parts;

    controlVoidedMl += controlParts.bladder.voidedMl;
    drinkVoidedMl += drinkParts.bladder.voidedMl;
    assert.ok(controlParts.skin, `control round ${round}: skin part is missing`);
    assert.ok(drinkParts.skin, `drink round ${round}: skin part is missing`);
    assert.ok(drinkParts.physicalActivity, `drink round ${round}: physicalActivity part is missing`);
    controlSweatMl += controlParts.skin.sweatVolumeMl;
    drinkSweatMl += drinkParts.skin.sweatVolumeMl;

    const controlTotal = waterTotal(controlParts, initialBodyWaterMl, controlSweatMl);
    assert.ok(Math.abs(controlTotal) <= 1e-6, `control round ${round}: ${controlTotal}`);
    const drinkTotal = waterTotal(drinkParts, initialBodyWaterMl, drinkSweatMl);
    maxErrorMl = Math.max(maxErrorMl, Math.abs(drinkTotal - 240));
    assert.ok(Math.abs(drinkTotal - 240) <= 1e-6, `drink round ${round}: ${drinkTotal}`);
    assert.equal(controlParts.skin.sweatRequestMl, 0, `control round ${round}: sweat request`);
    assert.equal(controlParts.skin.sweatVolumeMl, 0, `control round ${round}: sweat volume`);
    assert.equal(drinkParts.skin.sweatRequestMl, 0, `drink round ${round}: sweat request`);
    assert.equal(drinkParts.skin.sweatVolumeMl, 0, `drink round ${round}: sweat volume`);
    assert.equal(drinkParts.physicalActivity.remainingExerciseMin, 0, `drink round ${round}: activity`);
  }

  assert.ok(maxErrorMl <= 1e-6, `largest drink identity error ${maxErrorMl}`);
  assert.equal(controlVoidedMl, 0);
  assert.equal(drinkVoidedMl, 0);

  assert.ok(drinkParts.bodyFluid.waterVolumeMl > controlParts.bodyFluid.waterVolumeMl);
  assert.ok(drinkParts.bodyFluid.waterDeficit < controlParts.bodyFluid.waterDeficit);
  assert.ok(drinkParts.hypothalamusAdh.relativeConcentration < controlParts.hypothalamusAdh.relativeConcentration);
  assert.ok(drinkParts.hypothalamusThirst.thirst < controlParts.hypothalamusThirst.thirst);
  assert.ok(drinkParts.kidney.urineProductionRequestMl > controlParts.kidney.urineProductionRequestMl);
  assert.ok(drinkParts.bladder.volumeMl > controlParts.bladder.volumeMl);
  assert.ok(drinkParts.interoception.urinaryUrgency > controlParts.interoception.urinaryUrgency);

  assert.ok(drinkParts.stomach.volumeMl >= drinkParts.stomach.waterVolumeMl);
  assert.ok(
    drinkParts.stomach.waterVolumeMl
      <= drinkParts.stomach.volumeMl - drinkParts.stomach.solidVolumeMl + 1e-9,
  );
  assert.ok(
    drinkParts.colon.residueWaterMl < 15,
    `expected colon residue to stay small (~5% split minus reclamation), got ${drinkParts.colon.residueWaterMl}`,
  );
  assert.ok(
    drinkParts.stomach.waterVolumeMl + drinkParts.smallIntestine.waterVolumeMl < 10,
    'almost all 240 mL water should have left stomach and small intestine by 120 min',
  );
  const systemicGainMl = (drinkParts.bodyFluid.waterVolumeMl - controlParts.bodyFluid.waterVolumeMl)
    + (drinkParts.bladder.volumeMl - controlParts.bladder.volumeMl);
  assert.ok(
    systemicGainMl > 215,
    `expected ~95% (~225 mL) of 240 mL drink in systemic bodyFluid/bladder, got ${systemicGainMl}`,
  );
});

test('a 3-round drink keeps its pending queue water in the ledger every round', async (t) => {
  silence(t);
  const { gateway } = await startBody(t);
  const intakeMl = 240;
  assert.equal(
    gateway.submitAction({ id: 'drink-240-over-3', type: 'drink', volumeMl: intakeMl, durationMin: 3 }).statusCode,
    202,
  );

  let cumulativeVoidedMl = 0;
  let maxErrorMl = 0;
  const firstRoundsQueueWaterMl = [];

  for (let round = 1; round <= 120; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    const queueWaterMl = queuedWaterMl(parts.stomach);
    if (round <= 3) firstRoundsQueueWaterMl.push(queueWaterMl);

    const ledgerMl = parts.stomach.waterVolumeMl
      + queueWaterMl
      + parts.smallIntestine.waterVolumeMl
      + colonResidueMl(parts)
      + (parts.bodyFluid.waterVolumeMl - initialBodyWaterMl)
      + parts.bladder.volumeMl
      + cumulativeVoidedMl;
    maxErrorMl = Math.max(maxErrorMl, Math.abs(ledgerMl - intakeMl));
    assert.ok(Math.abs(ledgerMl - intakeMl) <= 1e-6, `round ${round}: water ledger ${ledgerMl}`);
  }

  assert.deepEqual(firstRoundsQueueWaterMl, [160, 80, 0]);
  assert.equal(gateway.getState().parts.stomach.mealQueue.length, 0);
  assert.equal(cumulativeVoidedMl, 0);
  assert.ok(maxErrorMl <= 1e-6, `largest water ledger error ${maxErrorMl}`);
});

test('a legacy queue without water metadata releases no water', async (t) => {
  silence(t);
  const legacyStomach = {
    volumeMl: 100,
    energyKcal: 0,
    solidVolumeMl: 0,
    solidEnergyKcal: 0,
    emptiedMl: 0,
    emptiedKcal: 0,
    lastIntakeAt: 0,
    mealQueue: [{
      remainingMl: 100,
      remainingKcal: 0,
      rateMlPerRound: 50,
      rateKcalPerRound: 0,
      remainingRounds: 2,
      mealKind: 'liquid',
    }],
  };
  const { gateway } = await startBody(t, { parts: { stomach: legacyStomach } });

  for (let round = 1; round <= 20; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(parts.stomach.waterVolumeMl, 0, `round ${round}: stomach water`);
    assert.equal(parts.stomach.emptiedWaterMl, 0, `round ${round}: emptied water`);
    assert.equal(parts.smallIntestine.waterVolumeMl, 0, `round ${round}: intestinal water`);
    assert.ok(parts.bodyFluid.waterVolumeMl <= initialBodyWaterMl, `round ${round}: body water`);
  }
  assert.deepEqual(gateway.getState().parts.stomach.mealQueue, []);
});

test('a mixed meal keeps non-water stomach content separate from the water ledger', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t);
  await tools.body_act.execute({ type: 'drink', volumeMl: 240 }, fakeExec({ sessionId: 'mixed', callId: 'drink' }));
  await tools.body_act.execute(
    { type: 'eat', volumeMl: 200, energyKcal: 100, mealKind: 'solid' },
    fakeExec({ sessionId: 'mixed', callId: 'eat' }),
  );

  let cumulativeEmptiedMl = 0;
  let cumulativeEmptiedWaterMl = 0;
  let cumulativeSweatMl = 0;
  for (let round = 1; round <= 20; round++) {
    await gateway.tick();
    const roundParts = gateway.getState().parts;
    const stomach = roundParts.stomach;
    cumulativeEmptiedMl += stomach.emptiedMl;
    cumulativeEmptiedWaterMl += stomach.emptiedWaterMl;
    cumulativeSweatMl += roundParts.skin.sweatVolumeMl;
    assert.ok(stomach.volumeMl >= stomach.waterVolumeMl, `round ${round}: water exceeds total`);
    assert.ok(
      stomach.waterVolumeMl <= stomach.volumeMl - stomach.solidVolumeMl + 1e-9,
      `round ${round}: water exceeds non-solid volume`,
    );
    assert.ok(stomach.emptiedWaterMl <= stomach.emptiedMl + 1e-9, `round ${round}: water exceeds emptied`);
  }

  assert.ok(cumulativeEmptiedMl > cumulativeEmptiedWaterMl);
  assert.ok(cumulativeEmptiedWaterMl < 240);
  const parts = gateway.getState().parts;
  assert.ok(parts.stomach.solidVolumeMl > 0);
  assert.ok(Math.abs(waterTotal(parts, initialBodyWaterMl, cumulativeSweatMl) - 240) <= 1e-6);
});

test('urinate voids the round-start bladder once and same-round urine stays', async (t) => {
  silence(t);
  const { gateway, statePath, tools } = await startBody(t, {
    parts: {
      bladder: { volumeMl: 250, voidedMl: 0 },
      kidney: { urineProductionRequestMl: 40 },
    },
  });
  const voidExec = fakeExec({ sessionId: 'session-void', callId: 'void-1' });
  const readExec = (callId) => fakeExec({ sessionId: 'session-read', callId });

  const beforeFeeling = await tools.body_state.execute({ part: 'bladder' }, readExec('read-before'));
  assert.equal(beforeFeeling.status, 'active');
  assert.equal(beforeFeeling.focus, 'bladder');
  assert.equal(Object.hasOwn(beforeFeeling, 'parts'), false);
  assert.equal(/[\d０-９]/.test(JSON.stringify(beforeFeeling)), false);
  const before = gateway.getState().parts;
  assert.deepEqual(before.bladder, {
    volumeMl: 250,
    voidedMl: 0,
    voluntaryVoidedMl: 0,
    involuntaryVoidedMl: 0,
  });
  assert.equal(before.interoception.urinaryUrgency, 0);

  const queued = await tools.body_act.execute({ type: 'urinate' }, voidExec);
  assert.equal(queued.ok, true);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  await gateway.tick();
  assert.equal(gateway.getReceipt(queued.receipt.id).status, 'applied');

  const afterVoid = gateway.getState().parts;
  assert.deepEqual(afterVoid.bladder, {
    volumeMl: 40,
    voidedMl: 250,
    voluntaryVoidedMl: 250,
    involuntaryVoidedMl: 0,
  });
  assert.ok(Math.abs(afterVoid.interoception.urinaryUrgency - (100 * 250) / 410) < 1e-9);

  await gateway.tick();
  const next = gateway.getState().parts;
  assert.equal(next.bladder.voidedMl, 0);
  assert.ok(next.bladder.volumeMl > 40);
  assert.ok(next.interoception.urinaryUrgency < afterVoid.interoception.urinaryUrgency);

  const replay = await tools.body_act.execute({ type: 'urinate' }, voidExec);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.receipt.id, queued.receipt.id);
  assert.equal(replay.receipt.status, 'applied');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);

  const bodyWaterBeforeRetry = gateway.getState().parts.bodyFluid.waterVolumeMl;
  await gateway.tick();
  const afterRetry = gateway.getState().parts;
  assert.equal(afterRetry.bladder.voidedMl, 0);
  assert.ok(afterRetry.bodyFluid.waterVolumeMl < bodyWaterBeforeRetry);
});

test('two different urinate actions in one round void only once', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t, {
    parts: {
      bladder: { volumeMl: 250, voidedMl: 0 },
      kidney: { urineProductionRequestMl: 40 },
    },
  });

  const first = await tools.body_act.execute(
    { type: 'urinate' },
    fakeExec({ sessionId: 'session-double', callId: 'void-a' }),
  );
  const second = await tools.body_act.execute(
    { type: 'urinate' },
    fakeExec({ sessionId: 'session-double', callId: 'void-b' }),
  );
  assert.equal(first.statusCode, 202);
  assert.equal(second.statusCode, 202);
  assert.notEqual(first.receipt.id, second.receipt.id);

  await gateway.tick();
  const parts = gateway.getState().parts;
  assert.equal(parts.bladder.voidedMl, 250);
  assert.equal(parts.bladder.volumeMl, 40);
  assert.equal(gateway.getReceipt(first.receipt.id).status, 'applied');
  assert.equal(gateway.getReceipt(second.receipt.id).status, 'applied');
});

test('a non-zero urinate keeps the drink ledger and leaves the same-round urine', async (t) => {
  silence(t);
  const { gateway, statePath, tools } = await startBody(t);
  const intakeMl = 240;
  const voidRound = 20;
  const retryRound = voidRound + 1;
  const drinkExec = fakeExec({ sessionId: 'session-ledger', callId: 'drink-240' });
  const voidExec = fakeExec({ sessionId: 'session-ledger', callId: 'void-after-drink' });

  const drink = await tools.body_act.execute(
    { type: 'drink', volumeMl: intakeMl, durationMin: 3 },
    drinkExec,
  );
  assert.equal(drink.statusCode, 202);

  let cumulativeVoidedMl = 0;
  let cumulativeSweatMl = 0;
  let maxQueuedWaterMl = 0;
  let voidBefore = null;
  let voidReceipt = null;
  let retryBefore = null;

  for (let round = 1; round <= 120; round += 1) {
    const before = gateway.getState().parts;

    if (round === voidRound) {
      assert.ok(before.stomach.waterVolumeMl > 0, `round ${round}: stomach water`);
      assert.ok(before.smallIntestine.waterVolumeMl > 0, `round ${round}: intestinal water`);
      assert.ok(before.bodyFluid.waterVolumeMl > initialBodyWaterMl, `round ${round}: body water increment`);
      assert.ok(before.bladder.volumeMl > 1, `round ${round}: bladder volume`);
      const queued = await tools.body_act.execute({ type: 'urinate' }, voidExec);
      assert.equal(queued.statusCode, 202);
      assert.equal(queued.receipt.status, 'queued');
      voidBefore = before;
      voidReceipt = queued.receipt;
    } else if (round === retryRound) {
      retryBefore = before;
      const replay = await tools.body_act.execute({ type: 'urinate' }, voidExec);
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.receipt.id, voidReceipt.id);
      assert.equal(replay.receipt.status, 'applied');
      assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
    }

    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.ok(parts.skin, `round ${round}: skin part is missing`);
    cumulativeVoidedMl += parts.bladder.voidedMl;
    cumulativeSweatMl += parts.skin.sweatVolumeMl;
    maxQueuedWaterMl = Math.max(maxQueuedWaterMl, queuedWaterMl(parts.stomach));

    if (round === 1) {
      assert.equal(gateway.getReceipt(drink.receipt.id).status, 'applied');
    }

    if (round === voidRound) {
      const newUrineMl = Math.min(
        voidBefore.kidney.urineProductionRequestMl,
        voidBefore.bodyFluid.waterVolumeMl,
      );
      assert.equal(gateway.getReceipt(voidReceipt.id).status, 'applied');
      assert.ok(parts.bladder.voidedMl > 1, `round ${round}: non-zero void`);
      assert.equal(parts.bladder.voidedMl, voidBefore.bladder.volumeMl);
      assert.ok(newUrineMl > 0, `round ${round}: new urine`);
      assert.equal(parts.bladder.volumeMl, newUrineMl);
      assert.ok(
        Math.abs(parts.stomach.waterVolumeMl - voidBefore.stomach.waterVolumeMl
          + parts.stomach.emptiedWaterMl) <= 1e-9,
        `round ${round}: only normal emptying left the stomach`,
      );
      const residueMl = Math.min(
        Math.max(0, voidBefore.smallIntestine.waterVolumeMl - parts.smallIntestine.absorbedWaterMl),
        parts.smallIntestine.absorbedWaterMl * (0.05 / 0.95),
      );
      const reclaimedMl = voidBefore.colon.residueWaterMl * (1 - Math.exp(-0.01));
      assert.ok(
        Math.abs(parts.smallIntestine.waterVolumeMl - voidBefore.smallIntestine.waterVolumeMl
          - (parts.stomach.emptiedWaterMl - parts.smallIntestine.absorbedWaterMl - residueMl)) <= 1e-9,
        `round ${round}: only the normal chain changed the intestine`,
      );
      assert.ok(
        Math.abs(parts.bodyFluid.waterVolumeMl - voidBefore.bodyFluid.waterVolumeMl
          + newUrineMl - parts.smallIntestine.absorbedWaterMl - reclaimedMl) <= 1e-9,
        `round ${round}: body fluid only lost the kidney request`,
      );
      assert.ok(
        parts.bodyFluid.waterVolumeMl > voidBefore.bodyFluid.waterVolumeMl - newUrineMl,
        `round ${round}: body fluid did not lose the voided volume`,
      );
    } else {
      assert.equal(parts.bladder.voidedMl, 0, `round ${round}: unexpected void`);
    }

    if (round === retryRound) {
      const newUrineMl = Math.min(
        retryBefore.kidney.urineProductionRequestMl,
        retryBefore.bodyFluid.waterVolumeMl,
      );
      assert.equal(parts.bladder.volumeMl, retryBefore.bladder.volumeMl + newUrineMl);
      const reclaimedMl = retryBefore.colon.residueWaterMl * (1 - Math.exp(-0.01));
      assert.ok(
        Math.abs(parts.bodyFluid.waterVolumeMl - retryBefore.bodyFluid.waterVolumeMl
          + newUrineMl - parts.smallIntestine.absorbedWaterMl - reclaimedMl) <= 1e-9,
        `round ${round}: retry did not drain body fluid`,
      );
      assert.equal(cumulativeVoidedMl, voidBefore.bladder.volumeMl);
    }

    const ledgerMl = waterLedgerMl(parts, cumulativeVoidedMl, initialBodyWaterMl, cumulativeSweatMl);
    assert.ok(
      Math.abs(ledgerMl - intakeMl) <= 1e-6,
      `round ${round}: water ledger ${ledgerMl} with cumulative voided ${cumulativeVoidedMl}`,
    );
  }

  const final = gateway.getState().parts;
  assert.ok(maxQueuedWaterMl > 0);
  assert.ok(cumulativeVoidedMl > 1);
  assert.equal(cumulativeVoidedMl, voidBefore.bladder.volumeMl);
  assert.equal(final.stomach.mealQueue.length, 0);
  assert.ok(Math.abs(
    waterLedgerMl(final, cumulativeVoidedMl, initialBodyWaterMl, cumulativeSweatMl) - intakeMl,
  ) <= 1e-6);
});

test('an overflow bladder voids involuntarily and keeps the water ledger', async (t) => {
  silence(t);
  const overflowMl = 650;
  const { gateway, tools } = await startBody(t, {
    parts: {
      bladder: {
        volumeMl: overflowMl,
        voidedMl: 0,
        voluntaryVoidedMl: 0,
        involuntaryVoidedMl: 0,
      },
      bodyFluid: { waterVolumeMl: initialBodyWaterMl - overflowMl, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 40 },
    },
  });
  const readExec = (callId) => fakeExec({ sessionId: 'session-overflow', callId });

  let cumulativeVoidedMl = 0;
  for (let round = 1; round <= 5; round += 1) {
    const before = gateway.getState().parts;
    await gateway.tick();
    const parts = gateway.getState().parts;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    assert.equal(
      parts.bladder.voluntaryVoidedMl + parts.bladder.involuntaryVoidedMl,
      parts.bladder.voidedMl,
      `round ${round}: subtotals must add up to voided`,
    );

    if (round === 1) {
      const newUrineMl = Math.min(
        before.kidney.urineProductionRequestMl,
        before.bodyFluid.waterVolumeMl,
      );
      assert.equal(newUrineMl, 40);
      assert.equal(parts.bladder.involuntaryVoidedMl, overflowMl);
      assert.equal(parts.bladder.voluntaryVoidedMl, 0);
      assert.equal(parts.bladder.voidedMl, overflowMl);
      assert.equal(parts.bladder.volumeMl, newUrineMl);
      assert.ok(
        Math.abs(parts.bodyFluid.waterVolumeMl - (before.bodyFluid.waterVolumeMl - newUrineMl)) <= 1e-9,
        `round ${round}: body fluid only lost the kidney request`,
      );
    } else {
      assert.equal(parts.bladder.voidedMl, 0, `round ${round}: unexpected void`);
      assert.equal(parts.bladder.involuntaryVoidedMl, 0, `round ${round}: unexpected involuntary void`);
      assert.equal(parts.bladder.voluntaryVoidedMl, 0, `round ${round}: unexpected voluntary void`);
    }

    const ledgerMl = waterLedgerMl(parts, cumulativeVoidedMl);
    assert.ok(Math.abs(ledgerMl) <= 1e-6, `round ${round}: water ledger ${ledgerMl}`);
  }

  assert.equal(cumulativeVoidedMl, overflowMl);
  const bladderFeeling = await tools.body_state.execute({ part: 'bladder' }, readExec('read-overflow'));
  assert.equal(Object.hasOwn(bladderFeeling, 'parts'), false);
  assert.equal(/[\d０-９]/.test(JSON.stringify(bladderFeeling)), false);
  const bladder = gateway.getState().parts.bladder;
  assert.ok(bladder.volumeMl > 0);
  assert.equal(bladder.involuntaryVoidedMl, 0);
});

test('a 600 mL round-start bladder does not void until the next overflow round', async (t) => {
  silence(t);
  const { gateway } = await startBody(t, {
    parts: {
      bladder: {
        volumeMl: 600,
        voidedMl: 0,
        voluntaryVoidedMl: 0,
        involuntaryVoidedMl: 0,
      },
      bodyFluid: { waterVolumeMl: initialBodyWaterMl - 600, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 40 },
    },
  });

  let cumulativeVoidedMl = 0;
  const before = gateway.getState().parts;
  await gateway.tick();
  const first = gateway.getState().parts;
  cumulativeVoidedMl += first.bladder.voidedMl;
  assert.equal(first.bladder.voidedMl, 0, '600 mL exactly must not trigger');
  assert.equal(first.bladder.involuntaryVoidedMl, 0);
  assert.equal(first.bladder.volumeMl, 600 + 40);
  assert.ok(Math.abs(waterLedgerMl(first, cumulativeVoidedMl)) <= 1e-6);

  const beforeSecond = gateway.getState().parts;
  await gateway.tick();
  const second = gateway.getState().parts;
  cumulativeVoidedMl += second.bladder.voidedMl;
  const newUrineMl = Math.min(
    beforeSecond.kidney.urineProductionRequestMl,
    beforeSecond.bodyFluid.waterVolumeMl,
  );
  assert.equal(second.bladder.involuntaryVoidedMl, beforeSecond.bladder.volumeMl);
  assert.equal(second.bladder.voluntaryVoidedMl, 0);
  assert.equal(second.bladder.volumeMl, newUrineMl);
  assert.ok(
    Math.abs(second.bodyFluid.waterVolumeMl - (beforeSecond.bodyFluid.waterVolumeMl - newUrineMl)) <= 1e-9,
  );
  assert.ok(Math.abs(waterLedgerMl(second, cumulativeVoidedMl)) <= 1e-6);
  assert.ok(before.bladder.volumeMl === 600);
});

test('urinate takes priority over overflow voiding and its retry does not void again', async (t) => {
  silence(t);
  const overflowMl = 650;
  const { gateway, statePath, tools } = await startBody(t, {
    parts: {
      bladder: {
        volumeMl: overflowMl,
        voidedMl: 0,
        voluntaryVoidedMl: 0,
        involuntaryVoidedMl: 0,
      },
      bodyFluid: { waterVolumeMl: initialBodyWaterMl - overflowMl, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 40 },
    },
  });
  const voidExec = fakeExec({ sessionId: 'session-overflow-void', callId: 'void-1' });

  const queued = await tools.body_act.execute({ type: 'urinate' }, voidExec);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  let cumulativeVoidedMl = 0;
  const before = gateway.getState().parts;
  await gateway.tick();
  const first = gateway.getState().parts;
  cumulativeVoidedMl += first.bladder.voidedMl;
  const newUrineMl = Math.min(before.kidney.urineProductionRequestMl, before.bodyFluid.waterVolumeMl);
  assert.equal(gateway.getReceipt(queued.receipt.id).status, 'applied');
  assert.equal(first.bladder.voluntaryVoidedMl, overflowMl);
  assert.equal(first.bladder.involuntaryVoidedMl, 0);
  assert.equal(first.bladder.voidedMl, overflowMl);
  assert.equal(first.bladder.volumeMl, newUrineMl);
  assert.ok(Math.abs(waterLedgerMl(first, cumulativeVoidedMl)) <= 1e-6);

  const retryBefore = gateway.getState().parts;
  const replay = await tools.body_act.execute({ type: 'urinate' }, voidExec);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.receipt.id, queued.receipt.id);
  assert.equal(replay.receipt.status, 'applied');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);

  await gateway.tick();
  const second = gateway.getState().parts;
  cumulativeVoidedMl += second.bladder.voidedMl;
  const retryNewUrineMl = Math.min(
    retryBefore.kidney.urineProductionRequestMl,
    retryBefore.bodyFluid.waterVolumeMl,
  );
  assert.equal(second.bladder.voidedMl, 0);
  assert.equal(second.bladder.voluntaryVoidedMl, 0);
  assert.equal(second.bladder.involuntaryVoidedMl, 0);
  assert.equal(second.bladder.volumeMl, retryBefore.bladder.volumeMl + retryNewUrineMl);
  assert.ok(Math.abs(waterLedgerMl(second, cumulativeVoidedMl)) <= 1e-6);
});

test('an old bladder checkpoint without subtotals loads with design zeros and can still void', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t, {
    parts: {
      bladder: { volumeMl: 250, voidedMl: 7 },
      bodyFluid: { waterVolumeMl: initialBodyWaterMl - 250, waterDeficit: 0 },
    },
  });
  const readExec = (callId) => fakeExec({ sessionId: 'session-legacy-bladder', callId });
  const voidExec = fakeExec({ sessionId: 'session-legacy-bladder', callId: 'void-1' });

  const loadedFeeling = await tools.body_state.execute({ part: 'bladder' }, readExec('read-loaded'));
  assert.equal(Object.hasOwn(loadedFeeling, 'parts'), false);
  assert.equal(/[\d０-９]/.test(JSON.stringify(loadedFeeling)), false);
  assert.deepEqual(gateway.getState().parts.bladder, {
    volumeMl: 250,
    voidedMl: 7,
    voluntaryVoidedMl: 0,
    involuntaryVoidedMl: 0,
  });

  assert.equal((await tools.body_act.execute({ type: 'urinate' }, voidExec)).statusCode, 202);
  await gateway.tick();
  const parts = gateway.getState().parts;
  assert.equal(parts.bladder.voluntaryVoidedMl, 250);
  assert.equal(parts.bladder.involuntaryVoidedMl, 0);
  assert.equal(parts.bladder.voidedMl, 250);
  assert.equal(parts.bladder.volumeMl, 0);
  assert.ok(Math.abs(waterLedgerMl(parts, 250)) <= 1e-6);
});
