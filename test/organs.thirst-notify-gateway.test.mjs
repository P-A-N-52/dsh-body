import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const sessionId = 'thirst-session';
const initialBodyWaterMl = 28400;
const initialWaterDeficit = 1;
const drinkMl = 2000;
const thirstMarkedMm = 65;
const thirstStrongMm = 85;
const resetBelowMm = 40;
const thirstWakeText = '身体感受：很口渴。';

function makeTaskTempDir() {
  const parent = join(tmpdir(), 'dsh-body');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'thirst-notify.'));
}

function fakeExec({ callId = 'call-1' } = {}) {
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

async function startBody(t) {
  const dir = makeTaskTempDir();
  const statePath = join(dir, 'body-state.json');
  writeFileSync(
    statePath,
    JSON.stringify(checkpoint({
      wallTimeMs: 0,
      simulatedSeconds: 0,
      parts: {
        bodyFluid: { waterVolumeMl: initialBodyWaterMl, waterDeficit: initialWaterDeficit },
        brainNotify: { lastSessionId: sessionId },
      },
    })),
  );
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
  return { gateway, tools: createBodyTools(gateway) };
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function waterLedgerMl(parts, cumulativeVoidedMl) {
  return parts.stomach.waterVolumeMl
    + queuedWaterMl(parts.stomach)
    + parts.smallIntestine.waterVolumeMl
    + (parts.colon?.residueWaterMl ?? 0)
    + (parts.bodyFluid.waterVolumeMl - initialBodyWaterMl)
    + parts.bladder.volumeMl
    + cumulativeVoidedMl;
}

function thirstWakeNotifications(gateway) {
  return gateway.getNotifications().filter((notification) => notification.text === thirstWakeText);
}

test('thirst needs three rounds to wake and the body never drinks on its own', async (t) => {
  silence(t);
  const { gateway } = await startBody(t);

  const initial = gateway.getState().parts;
  assert.equal(initial.bodyFluid.waterVolumeMl, initialBodyWaterMl);
  assert.equal(initial.bodyFluid.waterDeficit, initialWaterDeficit);
  assert.equal(initial.hypothalamusThirst.thirst, 0);
  assert.equal(initial.interoception.thirst, 0);
  assert.equal(initial.brainNotify.lastSessionId, sessionId);
  assert.equal(initial.stomach.lastIntakeAt, null);
  assert.deepEqual(gateway.getNotifications(), []);

  await gateway.tick();
  const afterFirstRound = gateway.getState().parts;
  assert.ok(afterFirstRound.hypothalamusThirst.thirst >= thirstStrongMm);
  assert.equal(afterFirstRound.interoception.thirst, 0);
  assert.equal(afterFirstRound.stomach.volumeMl, 0);
  assert.equal(afterFirstRound.stomach.waterVolumeMl, 0);
  assert.equal(afterFirstRound.stomach.lastIntakeAt, null);
  assert.deepEqual(gateway.getNotifications(), []);

  await gateway.tick();
  const afterSecondRound = gateway.getState().parts;
  assert.ok(afterSecondRound.hypothalamusThirst.thirst >= thirstStrongMm);
  assert.ok(afterSecondRound.interoception.thirst >= thirstStrongMm);
  assert.equal(afterSecondRound.stomach.volumeMl, 0);
  assert.equal(afterSecondRound.stomach.waterVolumeMl, 0);
  assert.equal(afterSecondRound.stomach.lastIntakeAt, null);
  assert.deepEqual(gateway.getNotifications(), []);

  await gateway.tick();
  const afterWakeRound = gateway.getState();
  const notifications = gateway.getNotifications();
  assert.equal(notifications.length, 1, 'round 3 should send exactly one reminder');
  assert.equal(notifications[0].mode, 'wake');
  assert.equal(notifications[0].sessionId, sessionId);
  assert.equal(notifications[0].text, thirstWakeText);
  assert.equal(notifications[0].createdAtSimulatedSeconds, afterWakeRound.simulatedSeconds);
  assert.ok(afterWakeRound.parts.interoception.thirst >= thirstStrongMm);
  assert.equal(afterWakeRound.parts.stomach.volumeMl, 0, 'thirst must not drink');
  assert.equal(afterWakeRound.parts.stomach.waterVolumeMl, 0);
  assert.equal(afterWakeRound.parts.stomach.lastIntakeAt, null);
  assert.equal(afterWakeRound.parts.brainNotify.lastSessionId, sessionId);
  const session = afterWakeRound.parts.brainNotify.sessions[sessionId];
  assert.equal(session.lastKind, 'thirst');
  assert.equal(session.lastLevel, 3);
  assert.deepEqual(session.levels, {
    hunger: 0,
    fullness: 0,
    urinary: 0,
    thirst: 3,
  });
});

test('a 2000 mL drink briefly relieves thirst, then absorption settles the rebound without another wake', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t);

  let cumulativeVoidedMl = 0;
  for (let round = 1; round <= 3; round += 1) {
    await gateway.tick();
    cumulativeVoidedMl += gateway.getState().parts.bladder.voidedMl;
  }
  assert.equal(thirstWakeNotifications(gateway).length, 1, 'the seeded thirst should wake once');

  const beforeDrink = gateway.getState().parts;
  assert.ok(Math.abs(waterLedgerMl(beforeDrink, cumulativeVoidedMl)) <= 1e-6);
  assert.equal(beforeDrink.stomach.waterVolumeMl, 0, 'no automatic drink before the explicit action');
  assert.equal(beforeDrink.brainNotify.sessions[sessionId].levels.thirst, 3);

  const queued = await tools.body_act.execute(
    { type: 'drink', volumeMl: drinkMl },
    fakeExec({ callId: 'drink-2000' }),
  );
  assert.equal(queued.ok, true);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  await gateway.tick();
  cumulativeVoidedMl += gateway.getState().parts.bladder.voidedMl;
  const afterDrink = gateway.getState().parts;
  assert.equal(gateway.getReceipt(queued.receipt.id).status, 'applied');
  assert.equal(afterDrink.stomach.waterVolumeMl, drinkMl);
  assert.equal(afterDrink.stomach.volumeMl, drinkMl);
  assert.equal(afterDrink.stomach.mealQueue.length, 0);
  assert.equal(afterDrink.smallIntestine.waterVolumeMl, 0, 'the drink is still in the stomach');
  assert.ok(
    afterDrink.bodyFluid.waterVolumeMl < initialBodyWaterMl,
    'the drink must not be added to body fluid on the action round',
  );
  assert.ok(afterDrink.interoception.thirst >= thirstStrongMm);
  assert.equal(
    afterDrink.brainNotify.sessions[sessionId].levels.thirst,
    3,
    'drink must not clear the thirst water level like urinate does',
  );
  assert.equal(afterDrink.brainNotify.sessions[sessionId].lastKind, 'thirst');
  assert.equal(
    thirstWakeNotifications(gateway).length,
    1,
    'the drink round must not repeat the wake',
  );
  assert.ok(Math.abs(waterLedgerMl(afterDrink, cumulativeVoidedMl) - drinkMl) <= 1e-6);

  let sawMarkedRebound = false;
  let settledAfterRebound = false;
  let sawStomachWater = false;
  let sawIntestinalWater = false;

  for (let round = 5; round <= 124; round += 1) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    const thirst = parts.interoception.thirst;
    cumulativeVoidedMl += parts.bladder.voidedMl;

    assert.equal(
      thirstWakeNotifications(gateway).length,
      1,
      `round ${round}: thirst must not repeat`,
    );
    const ledgerMl = waterLedgerMl(parts, cumulativeVoidedMl);
    assert.ok(
      Math.abs(ledgerMl - drinkMl) <= 1e-6,
      `round ${round}: water ledger ${ledgerMl}`,
    );

    const level = parts.brainNotify.sessions[sessionId].levels.thirst;
    if (round === 5) {
      assert.ok(parts.hypothalamusThirst.thirst >= thirstStrongMm, 'slow drive is still high');
      assert.ok(thirst < resetBelowMm, 'the first subjective relief crosses the reset threshold');
      assert.equal(level, 3, 'the notifier still reads the strong action-round snapshot');
    } else {
      assert.equal(level, 0, `round ${round}: the rebound does not send a new reminder`);
      assert.ok(thirst < thirstStrongMm, 'absorption keeps the rebound below the strong threshold');
      if (thirst >= thirstMarkedMm) sawMarkedRebound = true;
      if (sawMarkedRebound && thirst < resetBelowMm) settledAfterRebound = true;
    }
    if (parts.stomach.waterVolumeMl > 0) sawStomachWater = true;
    if (parts.smallIntestine.waterVolumeMl > 0) sawIntestinalWater = true;
  }

  const final = gateway.getState().parts;
  const finalSession = final.brainNotify.sessions[sessionId];
  assert.ok(sawMarkedRebound, 'the slow water deficit briefly reappears as the quick relief fades');
  assert.ok(settledAfterRebound, 'thirst settles below reset again as water is absorbed');
  assert.ok(sawStomachWater, 'the drink should pass through the stomach');
  assert.ok(sawIntestinalWater, 'the drink should pass through the small intestine');
  assert.ok(final.interoception.thirst < resetBelowMm);
  assert.equal(finalSession.levels.thirst, 0, 'falling below reset re-arms the thirst water level');
  assert.ok(final.bodyFluid.waterVolumeMl > initialBodyWaterMl);
  assert.equal(final.stomach.mealQueue.length, 0);
  assert.equal(
    final.stomach.lastIntakeAt,
    afterDrink.stomach.lastIntakeAt,
    'no additional intake after the explicit drink',
  );
  assert.equal(thirstWakeNotifications(gateway).length, 1);
});
