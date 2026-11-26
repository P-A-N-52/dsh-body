import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { checkpoint, launch, makeTempDir, rawRequest } from '../test-support/harness.mjs';
import {
  counterSource,
  flakySource,
  getterSource,
  sharedSource,
  sparseActionTypesSource,
} from '../test-support/models.mjs';

const brainNotifyUrl = new URL('../organs/human-organs/brain/notify.ts', import.meta.url).href;

function brainNotifySource() {
  return `
export { id, actionTypes, initialState, fields, heartbeat } from ${JSON.stringify(brainNotifyUrl)};
`;
}

test('v1 migration sorts pending actions by effectiveAt', async (t) => {
  const seed = {
    wallTimeMs: Date.now(),
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActions: [{ id: 'a', type: 'eat' }, { id: 'b', type: 'eat' }],
    receipts: {
      a: { id: 'a', effectiveAt: 120 },
      b: { id: 'b', effectiveAt: 60 },
    },
    notifications: [],
  };
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
  });

  assert.deepEqual(app.state().pendingActionIds, ['b', 'a']);
  await app.tick();
  await app.tick();
  const rounds = app.state().snapshot.parts.counter.rounds;
  assert.deepEqual(rounds[0].ids, ['b']);
  assert.deepEqual(rounds[1].ids, ['a']);
});

test('a legacy applied receipt without a digest is not treated as idempotent', async (t) => {
  const seed = {
    wallTimeMs: Date.now(),
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActions: [],
    receipts: { a1: { id: 'a1', type: 'eat', effectiveAt: 60 } },
    notifications: [],
  };
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
  });

  const response = await app.post('/actions', { id: 'a1', type: 'eat', volumeMl: 999 });
  assert.equal(response.status, 409);
  assert.equal(app.state().pendingActionIds.length, 0);
});

test('a v2 checkpoint with a missing action record is rejected with the id', async (t) => {
  const seed = checkpoint({ pendingActionIds: ['x'] });
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /x/);
});

test('a v2 checkpoint with a non-object body part is rejected', async (t) => {
  const seed = checkpoint({ parts: { counter: 'broken' } });
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /counter/);
});

test('a v2 active batch without targetWallTimeMs is rejected at load', async (t) => {
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 60,
    receivedAtWallTimeMs: Date.now(),
    queuedAtSimulatedSeconds: 0,
    batchId: null,
    attempts: 0,
    lastError: null,
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const seed = checkpoint({
    pendingActionIds: ['a1'],
    actions: { a1: action },
    lastEffectiveAt: 60,
    activeBatch: {
      id: 60,
      targetSimulatedSeconds: 60,
      actionIds: ['a1'],
      attempts: 0,
      lastError: null,
      startedAtWallTimeMs: Date.now(),
    },
  });
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /active batch|targetWallTimeMs/i);
});

test('an action that would exceed the checkpoint budget is rejected before writing', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    gatewayOptions: { maxCheckpointBytes: 2500 },
  });

  const big = await app.post('/actions', {
    id: 'big',
    type: 'eat',
    text: 'x'.repeat(3000),
  });
  assert.equal(big.status, 413);
  assert.equal(app.state().pendingActionIds.length, 0);

  const small = await app.post('/actions', { id: 'small', type: 'eat', volumeMl: 1 });
  assert.equal(small.status, 202);
});

test('prototype-named action ids are stored as own properties', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const named = await app.post('/actions', { id: 'toString', type: 'eat' });
  assert.equal(named.status, 202);
  const detail = await app.get('/actions/toString');
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).id, 'toString');

  const proto = await app.post('/actions', { id: '__proto__', type: 'eat' });
  assert.equal(proto.status, 202);
  await app.tick();
  assert.equal(Object.hasOwn(app.state().actions, '__proto__'), true);
});

test('an inbound non-finite number is rejected before enqueue', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const response = await rawRequest(app.base, {
    method: 'POST',
    path: '/actions',
    headers: { 'content-type': 'application/json' },
    body: '{"id":"a1","type":"eat","volumeMl":1e999}',
  });
  assert.equal(response.status, 400);
  assert.equal(app.state().pendingActionIds.length, 0);
});

test('a worker getter is cloned once and cannot substitute a Map', async (t) => {
  const app = await launch(t, {
    modules: { 'getter.mjs': getterSource() },
  });

  await app.tick();
  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.equal(state.snapshot.parts.getter.v, 1);
});

test('shared references are allowed and cycles are still rejected', async (t) => {
  const app = await launch(t, {
    modules: { 'shared.mjs': sharedSource() },
  });

  await app.tick();
  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.deepEqual(state.snapshot.parts.shared.a, { x: 1 });
  assert.deepEqual(state.snapshot.parts.shared.b, { x: 1 });
});

test('a failed resume batch leaves the gateway reachable and retries online', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const interval = 25;
  const startedPath = join(root, 'control', 'started');
  const releasePath = join(root, 'control', 'release');
  const countPath = join(root, 'control', 'count');
  mkdirSync(join(root, 'control'), { recursive: true });
  writeFileSync(releasePath, '');
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 60,
    receivedAtWallTimeMs: Date.now(),
    queuedAtSimulatedSeconds: 0,
    batchId: null,
    attempts: 0,
    lastError: null,
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const wallTimeMs = Date.now() - 2 * interval;
  const seed = checkpoint({
    wallTimeMs,
    pendingActionIds: ['a1'],
    actions: { a1: action },
    lastEffectiveAt: 60,
    activeBatch: {
      id: 60,
      targetSimulatedSeconds: 60,
      targetWallTimeMs: wallTimeMs + interval,
      actionIds: ['a1'],
      attempts: 0,
      lastError: null,
      startedAtWallTimeMs: wallTimeMs,
    },
  });
  const app = await launch(t, {
    dir: root,
    modules: {
      'flaky.mjs': flakySource({ startedPath, releasePath, countPath }),
    },
    seed,
    catchUpMinutes: 1,
    heartbeatIntervalMs: interval,
    expectReadyReject: false,
  });

  assert.equal(app.readyError, null);
  let health = await (await app.get('/health')).json();
  assert.equal(health.status, 'degraded');
  assert.equal(health.batch.attempts, 1);
  assert.match(health.heartbeat.lastError, /planned failure/);

  await app.tick();
  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.equal(state.activeBatch, null);
  assert.deepEqual(state.snapshot.parts.flaky.applied, ['a1']);
  health = await (await app.get('/health')).json();
  assert.equal(health.status, 'ok');
});

test('a failed catch-up batch retries online without delivering its historical notification', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const interval = 25;
  let clock = 1_700_000_000_000;
  const startedPath = join(root, 'control', 'started');
  const releasePath = join(root, 'control', 'release');
  const countPath = join(root, 'control', 'count');
  mkdirSync(join(root, 'control'), { recursive: true });
  writeFileSync(releasePath, '');
  const wallTimeMs = clock - 2 * interval;
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat', sessionId: 'session-a' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 60,
    receivedAtWallTimeMs: wallTimeMs,
    queuedAtSimulatedSeconds: 0,
    batchId: null,
    attempts: 0,
    lastError: null,
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const seed = checkpoint({
    wallTimeMs,
    simulatedSeconds: 0,
    parts: {
      interoception: { hunger: 70, fullness: 0, thirst: 0, urinaryUrgency: 0 },
    },
    pendingActionIds: ['a1'],
    actions: { a1: action },
    lastEffectiveAt: 60,
    activeBatch: {
      id: 60,
      targetSimulatedSeconds: 60,
      targetWallTimeMs: wallTimeMs + interval,
      actionIds: ['a1'],
      attempts: 0,
      lastError: null,
      startedAtWallTimeMs: wallTimeMs,
    },
  });
  const app = await launch(t, {
    dir: root,
    modules: {
      'flaky.mjs': flakySource({ startedPath, releasePath, countPath, failures: 2 }),
      'brain-notify.mjs': brainNotifySource(),
    },
    seed,
    catchUpMinutes: 1,
    heartbeatIntervalMs: interval,
    gatewayOptions: { now: () => clock },
  });

  assert.equal(app.readyError, null);
  let state = app.state();
  const afterFailedCatchUp = state;
  assert.equal(state.activeBatch.attempts, 1);
  assert.match(state.activeBatch.lastError, /planned failure/);
  assert.deepEqual(state.notifications, []);

  await app.tick();
  state = app.state();
  const afterFailedRetry = state;
  assert.equal(state.snapshot.simulatedSeconds, 0);
  assert.equal(state.activeBatch.attempts, 2);
  assert.match(state.activeBatch.lastError, /planned failure/);
  assert.deepEqual(state.notifications, []);

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.equal(state.activeBatch, null);
  assert.deepEqual(state.snapshot.parts.flaky.applied, ['a1']);
  assert.deepEqual(state.notifications, []);
  assert.equal(afterFailedCatchUp.activeBatch.suppressNotifications, true);
  assert.equal(afterFailedRetry.activeBatch.suppressNotifications, true);
  let stored = state.snapshot.parts.brainNotify.sessions['session-a'];
  assert.equal(stored.lastSentAt, null);
  assert.equal(stored.backoffStep, 0);
  assert.equal(stored.lastUrgentSentAt, null);
  assert.equal(stored.urgentBackoffStep, 0);
  assert.deepEqual(stored.levels, { hunger: 0, fullness: 0, urinary: 0, thirst: 0 });

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 120);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].sessionId, 'session-a');
  assert.equal(state.notifications[0].mode, 'context');
  stored = state.snapshot.parts.brainNotify.sessions['session-a'];
  assert.equal(stored.lastSentAt, 120);
  assert.equal(stored.backoffStep, 1);
  assert.equal(stored.lastUrgentSentAt, null);
  assert.equal(stored.urgentBackoffStep, 0);
  assert.deepEqual(stored.levels, { hunger: 2, fullness: 0, urinary: 0, thirst: 0 });

  await app.tick();
  state = app.state();
  assert.equal(state.notifications.length, 1);
});

test('a sparse actionTypes array is rejected', async (t) => {
  const app = await launch(t, {
    modules: { 'sparse.mjs': sparseActionTypesSource() },
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /actionTypes/);
});

test('catchUp with activeBatch and elapsed exceeding catchUpMinutes advances wallTimeMs without spamming online heartbeats', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const interval = 60_000;
  let clock = 1_700_000_000_000;
  const seedWallTimeMs = clock - 10 * interval;
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 60,
    receivedAtWallTimeMs: seedWallTimeMs,
    queuedAtSimulatedSeconds: 0,
    batchId: null,
    attempts: 0,
    lastError: null,
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const seed = checkpoint({
    wallTimeMs: seedWallTimeMs,
    simulatedSeconds: 0,
    pendingActionIds: ['a1'],
    actions: { a1: action },
    lastEffectiveAt: 60,
    activeBatch: {
      id: 60,
      targetSimulatedSeconds: 60,
      targetWallTimeMs: seedWallTimeMs + interval,
      actionIds: ['a1'],
      attempts: 0,
      lastError: null,
      startedAtWallTimeMs: seedWallTimeMs,
    },
  });

  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 1,
    heartbeatIntervalMs: interval,
    autoTick: true,
    gatewayOptions: { now: () => clock },
  });

  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.equal(state.wallTimeMs, clock);
  assert.equal(Object.hasOwn(state, 'catchUpError'), false);
  assert.equal(state.startup.catchUpError, null);

  t.mock.timers.tick(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.state().snapshot.simulatedSeconds, 60);
  assert.equal(app.state().snapshot.parts.counter.rounds.length, 1);

  clock += interval;
  t.mock.timers.tick(interval);
  const deadline = Date.now() + 4000;
  while (app.state().snapshot.simulatedSeconds !== 120) {
    if (Date.now() > deadline) throw new Error('timed out waiting for heartbeat to reach 120s');
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(app.state().snapshot.simulatedSeconds, 120);
});

test('FatalOperationError during catchUp keeps /health fatal and consecutiveFailures 0 without root catchUpError', async (t) => {
  const interval = 25;
  const clock = 1_700_000_000_000;
  const badAddSource = `
export const id = 'source';
export const actionTypes = [];
export const initialState = { volumeMl: 0 };
export const fields = { volumeMl: { unit: 'mL', mode: 'absolute' } };

export function heartbeat(io) {
  io.add('source', 'volumeMl', 1);
}
`;
  const app = await launch(t, {
    modules: { 'source.mjs': badAddSource },
    seed: checkpoint({ wallTimeMs: clock - 2 * interval }),
    catchUpMinutes: 1,
    heartbeatIntervalMs: interval,
    autoTick: true,
    gatewayOptions: { now: () => clock },
  });

  const state = app.state();
  assert.equal(Object.hasOwn(state, 'catchUpError'), false);
  assert.match(state.startup.catchUpError, /absolute/);

  const health = await (await app.get('/health')).json();
  assert.equal(health.status, 'fatal');
  assert.equal(health.ok, false);
  assert.equal(health.heartbeat.consecutiveFailures, 0);
  assert.equal(health.heartbeat.lastSuccessAtMs, null);
  assert.match(health.heartbeat.lastError, /absolute/);
});

test('expired action records are pruned before checking reserveForAction checkpoint budget', async (t) => {
  const clock = 1_700_000_000_000;
  const expired = {};
  for (let i = 0; i < 4; i++) {
    const id = `old-${i}`;
    expired[id] = {
      id,
      type: 'eat',
      action: { id, type: 'eat', note: 'x'.repeat(160) },
      payloadDigest: 'sha256:test',
      status: 'applied',
      effectiveAt: 60,
      receivedAtWallTimeMs: clock - 10_000,
      queuedAtSimulatedSeconds: 0,
      batchId: 60,
      attempts: 1,
      lastError: null,
      appliedAtSimulatedSeconds: 60,
      appliedAtWallTimeMs: clock - 5_000,
      failedReason: null,
    };
  }
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed: checkpoint({ wallTimeMs: clock, simulatedSeconds: 60, actions: expired, lastEffectiveAt: 60 }),
    gatewayOptions: {
      now: () => clock,
      actionRetentionMs: 1000,
      maxCheckpointBytes: 2500,
    },
  });

  const response = await app.post('/actions', { id: 'fresh', type: 'eat', volumeMl: 10 });
  assert.equal(response.status, 202);
  const state = app.state();
  assert.equal(Object.hasOwn(state.actions, 'old-0'), false);
  assert.equal(Object.hasOwn(state.actions, 'fresh'), true);
});
