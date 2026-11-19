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

test('a sparse actionTypes array is rejected', async (t) => {
  const app = await launch(t, {
    modules: { 'sparse.mjs': sparseActionTypesSource() },
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /actionTypes/);
});
