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
  'bladder',
  'bodyFluid',
  'brainNotify',
  'duodenum',
  'hypothalamusAdh',
  'hypothalamusThirst',
  'interoception',
  'kidney',
  'smallIntestine',
  'stomach',
  'stomachGhrelin',
  'stomachSensory',
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

function waterTotal(parts, initialMl = initialBodyWaterMl) {
  return parts.stomach.waterVolumeMl
    + parts.smallIntestine.waterVolumeMl
    + (parts.bodyFluid.waterVolumeMl - initialMl)
    + parts.bladder.volumeMl;
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function waterLedgerMl(parts, cumulativeVoidedMl, initialMl = initialBodyWaterMl) {
  return parts.stomach.waterVolumeMl
    + queuedWaterMl(parts.stomach)
    + parts.smallIntestine.waterVolumeMl
    + (parts.bodyFluid.waterVolumeMl - initialMl)
    + parts.bladder.volumeMl
    + cumulativeVoidedMl;
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
  assert.deepEqual(loaded.smallIntestine, { waterVolumeMl: 0, absorbedWaterMl: 0 });
  assert.deepEqual(loaded.bodyFluid, { waterVolumeMl: 30000, waterDeficit: 0 });
  assert.deepEqual(loaded.hypothalamusAdh, { relativeConcentration: 1 });
  assert.deepEqual(loaded.hypothalamusThirst, { thirst: 50 });
  assert.deepEqual(loaded.kidney, { urineProductionRequestMl: 0 });
  assert.deepEqual(loaded.bladder, { volumeMl: 0, voidedMl: 0 });

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.equal(after.stomach.waterVolumeMl, 0);
  assert.equal(after.stomach.emptiedWaterMl, 0);
  assert.equal(after.smallIntestine.waterVolumeMl, 0);
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

    const controlTotal = waterTotal(controlParts);
    assert.ok(Math.abs(controlTotal) <= 1e-6, `control round ${round}: ${controlTotal}`);
    const drinkTotal = waterTotal(drinkParts);
    maxErrorMl = Math.max(maxErrorMl, Math.abs(drinkTotal - 240));
    assert.ok(Math.abs(drinkTotal - 240) <= 1e-6, `drink round ${round}: ${drinkTotal}`);
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
  for (let round = 1; round <= 20; round++) {
    await gateway.tick();
    const stomach = gateway.getState().parts.stomach;
    cumulativeEmptiedMl += stomach.emptiedMl;
    cumulativeEmptiedWaterMl += stomach.emptiedWaterMl;
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
  assert.ok(Math.abs(waterTotal(parts) - 240) <= 1e-6);
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

  const before = await tools.body_state.execute({ part: 'bladder' }, readExec('read-before'));
  assert.deepEqual(before.parts.bladder, { volumeMl: 250, voidedMl: 0 });
  const urgeBefore = await tools.body_state.execute({ part: 'interoception' }, readExec('read-urge-before'));
  assert.equal(urgeBefore.parts.interoception.urinaryUrgency, 0);

  const queued = await tools.body_act.execute({ type: 'urinate' }, voidExec);
  assert.equal(queued.ok, true);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  await gateway.tick();
  assert.equal(gateway.getReceipt(queued.receipt.id).status, 'applied');

  const afterVoid = await tools.body_state.execute({ part: 'bladder' }, readExec('read-after-void'));
  assert.deepEqual(afterVoid.parts.bladder, { volumeMl: 40, voidedMl: 250 });
  const urgeAfterVoid = await tools.body_state.execute({ part: 'interoception' }, readExec('read-urge-after-void'));
  assert.ok(Math.abs(urgeAfterVoid.parts.interoception.urinaryUrgency - (100 * 250) / 410) < 1e-9);

  await gateway.tick();
  const next = await tools.body_state.execute({ part: 'bladder' }, readExec('read-next'));
  assert.equal(next.parts.bladder.voidedMl, 0);
  assert.ok(next.parts.bladder.volumeMl > 40);
  const urgeNext = await tools.body_state.execute({ part: 'interoception' }, readExec('read-urge-next'));
  assert.ok(urgeNext.parts.interoception.urinaryUrgency < urgeAfterVoid.parts.interoception.urinaryUrgency);

  const replay = await tools.body_act.execute({ type: 'urinate' }, voidExec);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.receipt.id, queued.receipt.id);
  assert.equal(replay.receipt.status, 'applied');
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);

  const bodyWaterBeforeRetry = gateway.getState().parts.bodyFluid.waterVolumeMl;
  await gateway.tick();
  const afterRetry = await tools.body_state.execute({ part: 'bladder' }, readExec('read-after-retry'));
  assert.equal(afterRetry.parts.bladder.voidedMl, 0);
  assert.ok(gateway.getState().parts.bodyFluid.waterVolumeMl < bodyWaterBeforeRetry);
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
    cumulativeVoidedMl += parts.bladder.voidedMl;
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
      assert.ok(
        Math.abs(parts.smallIntestine.waterVolumeMl - voidBefore.smallIntestine.waterVolumeMl
          - (parts.stomach.emptiedWaterMl - parts.smallIntestine.absorbedWaterMl)) <= 1e-9,
        `round ${round}: only the normal chain changed the intestine`,
      );
      assert.ok(
        Math.abs(parts.bodyFluid.waterVolumeMl - voidBefore.bodyFluid.waterVolumeMl
          + newUrineMl - parts.smallIntestine.absorbedWaterMl) <= 1e-9,
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
      assert.ok(
        Math.abs(parts.bodyFluid.waterVolumeMl - retryBefore.bodyFluid.waterVolumeMl
          + newUrineMl - parts.smallIntestine.absorbedWaterMl) <= 1e-9,
        `round ${round}: retry did not drain body fluid`,
      );
      assert.equal(cumulativeVoidedMl, voidBefore.bladder.volumeMl);
    }

    const ledgerMl = waterLedgerMl(parts, cumulativeVoidedMl);
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
  assert.ok(Math.abs(waterLedgerMl(final, cumulativeVoidedMl) - intakeMl) <= 1e-6);
});
