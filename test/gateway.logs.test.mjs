import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway } from '../gateway.js';
import { NOTIFICATION_HISTORY_RELATIVE, STATE_HISTORY_RELATIVE } from '../gateway/logs.js';
import { checkpoint } from '../test-support/harness.mjs';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-body-logs-'));
}

function tickerModuleSource() {
  return `
export const id = 'ticker';
export const actionTypes = ['poke'];
export const initialState = { ticks: 0, pokes: 0 };
export const fields = {
  ticks: { unit: '1', mode: 'absolute' },
  pokes: { unit: '1', mode: 'absolute' },
};
export function heartbeat(io) {
  const prev = io.read('ticker') ?? initialState;
  const ticks = prev.ticks + 1;
  const pokes = prev.pokes + io.actions.filter((action) => action?.type === 'poke').length;
  if (ticks % 2 === 0) {
    io.notify({ mode: 'context', sessionId: 's1', text: '周期提醒' });
  }
  io.write({ ticks, pokes });
}
`;
}

function quietModuleSource() {
  return `
export const id = 'quiet';
export const actionTypes = [];
export const initialState = { level: 1 };
export const fields = { level: { unit: '1', mode: 'absolute' } };
export function heartbeat(io) {
  io.write(io.read('quiet') ?? initialState);
}
`;
}

test('logs/ records state deltas and notification lifecycle and rolls at configured bounds', async (t) => {
  const dir = makeTempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'ticker.mjs'), tickerModuleSource());
  writeFileSync(join(dir, 'quiet.mjs'), quietModuleSource());
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./ticker.mjs', './quiet.mjs'],
    catchUpMinutes: 0,
    scriptTimeoutMs: 2000,
  }));
  const statePath = join(dir, 'body-state.json');

  let clock = 1_760_000_000_000;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => clock,
    maxStateHistory: 3,
    maxNotificationHistory: 2,
  });
  t.after(() => gateway.stop());
  const info = await gateway.ready;

  const logsDir = join(dir, 'logs');
  const stateLogPath = join(dir, STATE_HISTORY_RELATIVE);
  const notificationLogPath = join(dir, NOTIFICATION_HISTORY_RELATIVE);
  assert.equal(existsSync(stateLogPath), true);
  assert.equal(existsSync(notificationLogPath), false);

  let stateHistory = gateway.getStateHistory();
  assert.equal(stateHistory.length, 1);
  assert.equal(stateHistory[0].reason, 'boot');
  assert.equal(stateHistory[0].simulatedSeconds, 0);
  assert.deepEqual(stateHistory[0].changedParts.quiet, { level: 1 });

  const poke = await fetch(`${info.url}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'p1', type: 'poke' }),
  });
  assert.equal(poke.status, 202);
  clock += 60_000;
  await gateway.tick();

  clock += 60_000;
  await gateway.tick();

  stateHistory = gateway.getStateHistory();
  assert.equal(stateHistory.length, 3);
  assert.equal(stateHistory[1].reason, 'heartbeat');
  assert.deepEqual(stateHistory[1].actionIds, ['p1']);
  assert.deepEqual(stateHistory[1].changedParts, { ticker: { ticks: 1, pokes: 1 } });
  assert.equal(Object.hasOwn(stateHistory[1].changedParts, 'quiet'), false);
  assert.deepEqual(stateHistory[2].changedParts, { ticker: { ticks: 2 } });

  // Notifications logged on commit -> ack -> receipt
  const pending = await (await fetch(`${info.url}/notifications`)).json();
  assert.equal(pending.length, 1);
  const n1 = pending[0];

  let notifHistory = gateway.getNotificationHistory();
  assert.equal(notifHistory.length, 1);
  assert.equal(notifHistory[0].id, n1.id);
  assert.equal(notifHistory[0].status, 'queued');
  assert.equal(notifHistory[0].messageId, null);

  clock += 1_000;
  const ack = await fetch(`${info.url}/notifications/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: n1.id, messageId: 'msg-1' }),
  });
  assert.equal(ack.status, 200);
  assert.deepEqual(await ack.json(), { id: n1.id, acked: true });

  notifHistory = gateway.getNotificationHistory();
  assert.equal(notifHistory[0].status, 'acked');
  assert.equal(notifHistory[0].messageId, 'msg-1');
  assert.equal(notifHistory[0].ackedAtWallTimeMs, clock);
  assert.equal(notifHistory[0].insertedAtWallTimeMs, null);

  clock += 500;
  const receipt = await fetch(`${info.url}/notifications/receipt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messageId: 'msg-1' }),
  });
  assert.equal(receipt.status, 200);
  const receiptJson = await receipt.json();
  assert.equal(receiptJson.matched, true);
  assert.equal(receiptJson.notificationId, n1.id);
  assert.equal(receiptJson.insertedAtWallTimeMs, clock);

  notifHistory = gateway.getNotificationHistory();
  assert.equal(notifHistory[0].status, 'inserted');
  assert.equal(notifHistory[0].insertedAtWallTimeMs, clock);

  // Unknown ACKs must not pollute notification history
  const unknownAck = await fetch(`${info.url}/notifications/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'does-not-exist' }),
  });
  assert.deepEqual(await unknownAck.json(), { id: 'does-not-exist', acked: false });
  assert.equal(gateway.getNotificationHistory().length, 1);

  // HTTP /logs/state & /logs/notifications respect ?limit and validate bad limit
  const limitedState = await (await fetch(`${info.url}/logs/state?limit=1`)).json();
  assert.equal(limitedState.entries.length, 1);
  assert.equal(limitedState.entries[0].simulatedSeconds, 120);
  assert.equal((await fetch(`${info.url}/logs/state?limit=0`)).status, 400);
  assert.equal((await fetch(`${info.url}/logs/notifications?limit=abc`)).status, 400);

  // Advance enough ticks to trigger rolling compaction (>= 2 * maxStateHistory = 6)
  for (let i = 0; i < 6; i++) {
    clock += 60_000;
    await gateway.tick();
  }
  const rawLines = readFileSync(join(logsDir, 'state-history.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.ok(rawLines.length <= 5, `expected compacted line count < 6, got ${rawLines.length}`);
  assert.equal(gateway.getStateHistory().length, 3);
  assert.equal(gateway.getNotificationHistory().length, 2);

  // Restart does not emit duplicate state entry when nothing changed on boot
  await gateway.stop();
  const restarted = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => clock,
    maxStateHistory: 3,
    maxNotificationHistory: 2,
  });
  t.after(() => restarted.stop());
  await restarted.ready;
  assert.equal(restarted.getStateHistory().length, 3);
  assert.equal(restarted.getStateHistory().at(-1).simulatedSeconds, 480);
  assert.equal(restarted.getNotificationHistory().length, 2);
});

test('logs/ state-history is skipped when a heartbeat commit fails and catchUp logs delta', async (t) => {
  const dir = makeTempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const modulePath = join(dir, 'flaky.mjs');
  writeFileSync(modulePath, `
export const id = 'flaky';
export const actionTypes = [];
export const initialState = { count: 0, blob: '' };
export const fields = {
  count: { unit: '1', mode: 'absolute' },
  blob: { unit: '1', mode: 'absolute' },
};
export function heartbeat(io) {
  const prev = io.read('flaky') ?? initialState;
  if (prev.count === 1) {
    io.write({ count: 2, blob: 'x'.repeat(2500) });
    return;
  }
  io.write({ count: prev.count + 1, blob: '' });
}
`);
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./flaky.mjs'],
    catchUpMinutes: 5,
    scriptTimeoutMs: 2000,
  }));
  const statePath = join(dir, 'body-state.json');
  let clock = 60_000;
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts: { flaky: { count: 0, blob: '' } },
  })));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gw = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => clock,
    maxCheckpointBytes: 2048,
  });
  t.after(() => gw.stop());
  await gw.ready;

  // Boot ran 1 catch-up tick (failed at tick 2 because blob exceeded 2048 -> catchUpError at count=1)
  const historyBeforeFail = gw.getStateHistory();
  assert.equal(historyBeforeFail.length, 1);
  assert.equal(historyBeforeFail[0].reason, 'catch-up');
  assert.equal(historyBeforeFail[0].simulatedSeconds, 60);
  assert.deepEqual(historyBeforeFail[0].changedParts, { flaky: { count: 1 } });

  // Online tick also fails CHECKPOINT_TOO_LARGE -> must not write to logs/
  const outcome = await gw.tick();
  assert.equal(outcome.failed, true);
  assert.equal(gw.getStateHistory().length, 1);
});

test('sync pre-ack receipt via ackNotification metadata marks notification inserted immediately', async (t) => {
  const dir = makeTempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const modulePath = join(dir, 'quiet.mjs');
  writeFileSync(modulePath, quietModuleSource());
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./quiet.mjs'],
    catchUpMinutes: 0,
    scriptTimeoutMs: 2000,
  }));
  const statePath = join(dir, 'state', 'body-state.json');
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 1_000,
    notifications: [{
      id: 'pre-seeded-n1',
      mode: 'context',
      sessionId: 's1',
      text: '已存在于存档的通知。',
      createdAtSimulatedSeconds: 60,
      createdAtWallTimeMs: 1_000,
    }],
  })));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gw = startGateway({ manifestPath, statePath, port: 0, autoTick: false, now: () => 2_000 });
  t.after(() => gw.stop());
  await gw.ready;

  const ack = gw.ackNotification('pre-seeded-n1', {
    messageId: 'msg-pre-1',
    insertedAtWallTimeMs: 1_950,
  });
  assert.deepEqual(ack, { id: 'pre-seeded-n1', acked: true });

  const history = gw.getNotificationHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, 'pre-seeded-n1');
  assert.equal(history[0].status, 'inserted');
  assert.equal(history[0].messageId, 'msg-pre-1');
  assert.equal(history[0].insertedAtWallTimeMs, 1_950);
  assert.equal(history[0].ackedAtWallTimeMs, 2_000);
});
