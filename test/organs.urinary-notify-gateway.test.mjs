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
const sessionId = 'urgency-session';
const preloadedBladderMl = 410;
const resetBelowMm = 40;
const urinaryWakeText = '身体感受：膀胱很满，尿意很明显。';

function makeTaskTempDir() {
  const parent = join(tmpdir(), 'dsh-body');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'urinary-notify.'));
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
        bladder: { volumeMl: preloadedBladderMl },
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

test('a full bladder wakes once, then an explicit urinate voids and urgency falls without repeating', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t);

  const initial = gateway.getState().parts;
  assert.equal(initial.bladder.volumeMl, preloadedBladderMl);
  assert.equal(initial.interoception.urinaryUrgency, 0);
  assert.equal(initial.brainNotify.lastSessionId, sessionId);
  assert.deepEqual(gateway.getNotifications(), []);

  await gateway.tick();
  const afterFirstRound = gateway.getState().parts;
  assert.equal(afterFirstRound.interoception.urinaryUrgency, 100);
  assert.equal(afterFirstRound.bladder.voidedMl, 0);
  assert.deepEqual(gateway.getNotifications(), []);

  await gateway.tick();
  const afterWakeRound = gateway.getState();
  const notifications = gateway.getNotifications();
  assert.equal(notifications.length, 1, 'round 2 should send exactly one reminder');
  assert.equal(notifications[0].mode, 'wake');
  assert.equal(notifications[0].sessionId, sessionId);
  assert.equal(notifications[0].text, urinaryWakeText);
  assert.equal(notifications[0].createdAtSimulatedSeconds, afterWakeRound.simulatedSeconds);
  assert.ok(afterWakeRound.parts.interoception.urinaryUrgency >= 85);
  assert.equal(afterWakeRound.parts.bladder.voidedMl, 0, 'urgency must not void the bladder');
  assert.equal(afterWakeRound.parts.bladder.voluntaryVoidedMl, 0);
  assert.equal(afterWakeRound.parts.bladder.involuntaryVoidedMl, 0);

  const beforeVoid = gateway.getState().parts;
  const queued = await tools.body_act.execute({ type: 'urinate' }, fakeExec({ callId: 'void-urgency' }));
  assert.equal(queued.ok, true);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  await gateway.tick();
  const afterVoid = gateway.getState().parts;
  assert.equal(gateway.getReceipt(queued.receipt.id).status, 'applied');
  assert.equal(afterVoid.bladder.voluntaryVoidedMl, beforeVoid.bladder.volumeMl);
  assert.equal(afterVoid.bladder.involuntaryVoidedMl, 0);
  assert.equal(afterVoid.bladder.voidedMl, beforeVoid.bladder.volumeMl);
  const newUrineMl = Math.min(
    beforeVoid.kidney.urineProductionRequestMl,
    beforeVoid.bodyFluid.waterVolumeMl,
  );
  assert.equal(afterVoid.bladder.volumeMl, newUrineMl);
  assert.equal(gateway.getNotifications().length, 1, 'the explicit urinate must not repeat the reminder');

  await gateway.tick();
  const afterFallRound = gateway.getState().parts;
  assert.ok(afterFallRound.interoception.urinaryUrgency < resetBelowMm);
  assert.ok(afterFallRound.interoception.urinaryUrgency < afterVoid.interoception.urinaryUrgency);
  assert.equal(afterFallRound.bladder.voidedMl, 0);
  assert.equal(afterFallRound.bladder.voluntaryVoidedMl, 0);
  assert.equal(afterFallRound.bladder.involuntaryVoidedMl, 0);
  assert.equal(gateway.getNotifications().length, 1, 'falling urgency must not repeat the reminder');
});

test('a urinate submitted before the wake round suppresses the stale urinary reminder', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t);

  await gateway.tick();
  const afterFirstRound = gateway.getState().parts;
  assert.equal(afterFirstRound.interoception.urinaryUrgency, 100);
  assert.deepEqual(gateway.getNotifications(), []);

  const beforeVoid = gateway.getState().parts;
  const queued = await tools.body_act.execute({ type: 'urinate' }, fakeExec({ callId: 'void-before-wake' }));
  assert.equal(queued.ok, true);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.receipt.status, 'queued');

  await gateway.tick();
  const afterVoid = gateway.getState().parts;
  assert.equal(gateway.getReceipt(queued.receipt.id).status, 'applied');
  assert.equal(afterVoid.bladder.voluntaryVoidedMl, beforeVoid.bladder.volumeMl);
  assert.equal(afterVoid.bladder.involuntaryVoidedMl, 0);
  assert.equal(afterVoid.bladder.voidedMl, beforeVoid.bladder.volumeMl);
  assert.deepEqual(gateway.getNotifications(), [], 'the void round must not send a stale urinary reminder');

  await gateway.tick();
  const afterFallRound = gateway.getState().parts;
  assert.ok(afterFallRound.interoception.urinaryUrgency < resetBelowMm);
  assert.equal(afterFallRound.bladder.voidedMl, 0);
  assert.deepEqual(gateway.getNotifications(), [], 'falling urgency must not send a reminder');
});
