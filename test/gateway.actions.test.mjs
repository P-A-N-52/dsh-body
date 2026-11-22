import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { launch, makeTempDir, until } from '../test-support/harness.mjs';
import {
  blockingSource,
  counterSource,
  flakySource,
} from '../test-support/models.mjs';

test('an action type with no handler is rejected without writing a receipt', async (t) => {
  const app = await launch(t, { modules: {} });

  const response = await app.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.deepEqual(body.supportedActionTypes, []);

  const state = app.state();
  assert.deepEqual(state.pendingActionIds, []);
  assert.equal(state.actions.a1, undefined);
});

test('a declared action type is queued and queryable', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    heartbeatIntervalMs: 60_000,
  });

  const capabilities = await (await app.get('/capabilities')).json();
  assert.deepEqual(capabilities, { eat: ['counter'] });

  const accepted = await app.post('/actions', {
    id: 'a1',
    type: 'eat',
    volumeMl: 120,
  });
  assert.equal(accepted.status, 202);
  const receipt = await accepted.json();
  assert.equal(receipt.status, 'queued');
  assert.equal(receipt.effectiveAt, 60);

  const detail = await (await app.get('/actions/a1')).json();
  assert.equal(detail.type, 'eat');
  assert.equal(detail.action.volumeMl, 120);
  assert.equal(detail.status, 'queued');

  const unknown = await app.post('/actions', { id: 'a2', type: 'drink' });
  assert.equal(unknown.status, 422);
});

test('the same id and payload is idempotent, a different payload conflicts', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    heartbeatIntervalMs: 60_000,
  });

  const first = await app.post('/actions', { id: 'a1', type: 'eat', volumeMl: 120 });
  const firstBody = await first.json();
  assert.equal(first.status, 202);

  const second = await app.post('/actions', { id: 'a1', type: 'eat', volumeMl: 120 });
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.effectiveAt, firstBody.effectiveAt);

  const conflict = await app.post('/actions', { id: 'a1', type: 'eat', volumeMl: 240 });
  assert.equal(conflict.status, 409);

  await app.tick();
  let state = app.state();
  assert.deepEqual(state.snapshot.parts.counter.applied, ['a1']);
  assert.equal(state.snapshot.parts.counter.volumeMl, 120);
  assert.equal(state.actions.a1.status, 'applied');
  assert.equal(state.actions.a1.appliedAtSimulatedSeconds, 60);

  const replay = await app.post('/actions', { id: 'a1', type: 'eat', volumeMl: 120 });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.status, 'applied');

  await app.tick();
  state = app.state();
  assert.deepEqual(state.snapshot.parts.counter.applied, ['a1']);
  assert.equal(state.snapshot.parts.counter.volumeMl, 120);
});

test('an action submitted while a heartbeat is running lands in the next batch', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const startedPath = join(root, 'control', 'started');
  const releasePath = join(root, 'control', 'release');
  const app = await launch(t, {
    dir: root,
    modules: {
      'blocking.mjs': blockingSource({ startedPath, releasePath }),
    },
    heartbeatIntervalMs: 60_000,
  });

  await app.post('/actions', { id: 'a1', type: 'eat' });
  const running = app.tick();
  await until(() => app.exists(startedPath));

  const during = await app.post('/actions', { id: 'a2', type: 'eat' });
  assert.equal(during.status, 202);
  assert.equal((await during.json()).effectiveAt, 120);

  await import('node:fs').then(({ writeFileSync }) => writeFileSync(releasePath, ''));
  await running;

  let state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.deepEqual(state.snapshot.parts.blocking.rounds, [{ t: 60, ids: ['a1'] }]);
  assert.equal(state.actions.a2.status, 'queued');

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 120);
  assert.deepEqual(state.snapshot.parts.blocking.rounds, [
    { t: 60, ids: ['a1'] },
    { t: 120, ids: ['a2'] },
  ]);
});

test('a failed retry keeps the original batch and does not let a later action overtake it', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const startedPath = join(root, 'control', 'started');
  const releasePath = join(root, 'control', 'release');
  const countPath = join(root, 'control', 'count');
  const app = await launch(t, {
    dir: root,
    modules: {
      'flaky.mjs': flakySource({ startedPath, releasePath, countPath }),
    },
    heartbeatIntervalMs: 60_000,
  });

  await app.post('/actions', { id: 'a1', type: 'eat' });
  const firstAttempt = app.tick();
  await until(() => app.exists(startedPath));

  const during = await app.post('/actions', { id: 'a2', type: 'eat' });
  assert.equal((await during.json()).effectiveAt, 120);

  await import('node:fs').then(({ writeFileSync }) => writeFileSync(releasePath, ''));
  await firstAttempt;

  let state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 0);
  assert.equal(state.activeBatch.targetSimulatedSeconds, 60);
  assert.deepEqual(state.activeBatch.actionIds, ['a1']);
  assert.equal(state.activeBatch.attempts, 1);
  assert.match(state.activeBatch.lastError, /planned failure/);
  assert.equal(state.actions.a1.attempts, 1);
  assert.match(state.actions.a1.lastError, /planned failure/);

  const afterFailure = await app.post('/actions', { id: 'a3', type: 'eat' });
  assert.equal((await afterFailure.json()).effectiveAt, 120);

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.deepEqual(state.snapshot.parts.flaky.rounds, [{ t: 60, ids: ['a1'] }]);
  assert.deepEqual(state.snapshot.parts.flaky.applied, ['a1']);

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 120);
  assert.deepEqual(state.snapshot.parts.flaky.rounds, [
    { t: 60, ids: ['a1'] },
    { t: 120, ids: ['a2', 'a3'] },
  ]);
  assert.deepEqual(state.snapshot.parts.flaky.applied, ['a1', 'a2', 'a3']);
});

test('a failed batch survives restart and is applied exactly once', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const startedPath = join(root, 'control', 'started');
  const releasePath = join(root, 'control', 'release');
  const countPath = join(root, 'control', 'count');
  const modules = {
    'flaky.mjs': flakySource({ startedPath, releasePath, countPath }),
  };
  const interval = 25;
  let currentNow = Date.now();
  const gatewayOptions = { now: () => currentNow };

  const first = await launch(t, {
    dir: root,
    modules,
    heartbeatIntervalMs: interval,
    expectReadyReject: false,
    gatewayOptions,
  });
  const accepted = await first.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(accepted.status, 202);
  const attempt = first.tick();
  await until(() => first.exists(startedPath));
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(releasePath, ''));
  await attempt;
  await first.gateway.stop();
  currentNow += interval;

  const saved = first.state();
  assert.equal(saved.activeBatch.targetSimulatedSeconds, 60);
  assert.deepEqual(saved.activeBatch.actionIds, ['a1']);
  assert.equal(saved.activeBatch.attempts, 1);

  const second = await launch(t, {
    dir: root,
    modules,
    heartbeatIntervalMs: interval,
    expectReadyReject: false,
    gatewayOptions,
  });
  let state = second.state();
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.equal(state.activeBatch, null);
  assert.deepEqual(state.snapshot.parts.flaky.applied, ['a1']);
  assert.equal(state.actions.a1.status, 'applied');

  await second.tick();
  state = second.state();
  assert.equal(state.snapshot.simulatedSeconds, 120);
  assert.deepEqual(state.snapshot.parts.flaky.applied, ['a1']);
});
