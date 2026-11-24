import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpoint, launch } from '../test-support/harness.mjs';
import { counterSource, defaultsSource, notifySource } from '../test-support/models.mjs';

const brainNotifyUrl = new URL('../organs/human-organs/brain/notify.ts', import.meta.url).href;

function brainNotifySource() {
  return `
export { id, actionTypes, initialState, fields, heartbeat } from ${JSON.stringify(brainNotifyUrl)};
`;
}

test('a v1 checkpoint migrates to v2 without losing a pending action', async (t) => {
  const seed = {
    wallTimeMs: Date.now(),
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActions: [{ id: 'a1', type: 'eat', volumeMl: 10 }],
    receipts: { a1: { id: 'a1', effectiveAt: 60 } },
    notifications: [],
  };
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
  });

  let state = app.state();
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.pendingActionIds, ['a1']);
  assert.equal(state.actions.a1.status, 'queued');
  assert.equal(state.actions.a1.effectiveAt, 60);

  await app.tick();
  state = app.state();
  assert.equal(state.actions.a1.status, 'applied');
  assert.deepEqual(state.snapshot.parts.counter.applied, ['a1']);
});

test('a pending action without a receipt fails startup with the action id', async (t) => {
  const seed = {
    wallTimeMs: Date.now(),
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActions: [{ id: 'a1', type: 'eat' }],
    receipts: {},
    notifications: [],
  };
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /a1/);
});

test('non-array notifications fail startup instead of wedging the heartbeat', async (t) => {
  const seed = {
    wallTimeMs: Date.now(),
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActions: [],
    receipts: {},
    notifications: {},
  };
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /notifications/);
});

test('a future schema version is rejected without touching the file', async (t) => {
  const seed = { ...checkpoint(), schemaVersion: 99 };
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /schemaVersion 99/);
});

test('nested missing defaults are filled without overwriting saved values', async (t) => {
  const seed = checkpoint({
    parts: { defaults: { nested: { a: 5 } } },
  });
  const app = await launch(t, {
    modules: { 'defaults.mjs': defaultsSource() },
    seed,
  });

  const part = app.state().snapshot.parts.defaults;
  assert.equal(part.nested.a, 5);
  assert.equal(part.nested.b, 2);
  assert.equal(part.flat, 3);
});

test('notifications are capped and ACK is idempotent', async (t) => {
  const app = await launch(t, {
    modules: { 'notify.mjs': notifySource({ every: 1 }) },
    gatewayOptions: { maxNotifications: 2 },
  });

  await app.tick();
  await app.tick();
  await app.tick();

  let state = app.state();
  assert.equal(state.notifications.length, 2);
  const first = state.notifications[0];

  const ack = await app.post('/notifications/ack', { id: first.id });
  assert.equal(ack.status, 200);
  assert.deepEqual(await ack.json(), { id: first.id, acked: true });

  state = app.state();
  assert.equal(state.notifications.length, 1);

  const unknown = await app.post('/notifications/ack', { id: 'missing' });
  assert.deepEqual(await unknown.json(), { id: 'missing', acked: false });

  const repeat = await app.post('/notifications/ack', { id: first.id });
  assert.deepEqual(await repeat.json(), { id: first.id, acked: false });
});

test('catch-up notifications are suppressed', async (t) => {
  const interval = 25;
  const seed = checkpoint({
    wallTimeMs: Date.now() - 3 * interval - 10,
    simulatedSeconds: 0,
  });
  const app = await launch(t, {
    modules: { 'notify.mjs': notifySource({ every: 1 }) },
    seed,
    catchUpMinutes: 3,
    heartbeatIntervalMs: interval,
  });

  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 180);
  assert.equal(state.startup.caughtUpSeconds, 180);
  assert.equal(state.notifications.length, 0);
});

test('catch-up does not spend the online notification chance or quota', async (t) => {
  const interval = 25;
  const session = {
    lastSentAt: null,
    lastLevel: 0,
    lastKind: null,
    hourStartedAt: 0,
    hourCount: 1,
    dayStartedAt: 0,
    dayCount: 5,
    lastSeenAt: 0,
    levels: { hunger: 0, fullness: 0, urinary: 0, thirst: 0 },
  };
  const seed = checkpoint({
    wallTimeMs: Date.now() - 3 * interval - 10,
    simulatedSeconds: 0,
    parts: {
      interoception: { hunger: 70, fullness: 0, thirst: 0, urinaryUrgency: 0 },
      brainNotify: { lastSessionId: 'session-a', sessions: { 'session-a': session } },
    },
  });
  const app = await launch(t, {
    modules: { 'brain-notify.mjs': brainNotifySource() },
    seed,
    catchUpMinutes: 3,
    heartbeatIntervalMs: interval,
  });

  let state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 180);
  assert.equal(state.startup.caughtUpSeconds, 180);
  assert.deepEqual(state.notifications, []);
  let stored = state.snapshot.parts.brainNotify.sessions['session-a'];
  assert.equal(stored.lastSentAt, null);
  assert.equal(stored.hourCount, 1);
  assert.equal(stored.dayCount, 5);
  assert.deepEqual(stored.levels, { hunger: 0, fullness: 0, urinary: 0, thirst: 0 });

  await app.tick();
  state = app.state();
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].sessionId, 'session-a');
  assert.equal(state.notifications[0].mode, 'context');
  stored = state.snapshot.parts.brainNotify.sessions['session-a'];
  assert.equal(stored.lastSentAt, 240);
  assert.equal(stored.hourCount, 2);
  assert.equal(stored.dayCount, 6);
  assert.deepEqual(stored.levels, { hunger: 2, fullness: 0, urinary: 0, thirst: 0 });

  await app.tick();
  state = app.state();
  assert.equal(state.notifications.length, 1);
});
