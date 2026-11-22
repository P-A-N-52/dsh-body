import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../test-support/harness.mjs';
import { counterSource, hangSource } from '../test-support/models.mjs';

test('ready exposes the listening port and /health reports the body clock', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  assert.ok(app.info.port > 0);
  assert.match(app.info.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const healthResponse = await app.get('/health');
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.simulatedSeconds, 0);
  assert.equal(health.pendingActions, 0);
  assert.equal(health.notifications, 0);

  const stateResponse = await app.get('/state');
  assert.equal(stateResponse.status, 200);
  const snapshot = await stateResponse.json();
  assert.equal(snapshot.simulatedSeconds, 0);
  assert.deepEqual(snapshot.parts.counter.rounds, []);
});

test('stop closes the listener and can be called twice', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  await app.gateway.stop();
  await assert.rejects(fetch(`${app.base}/health`));
  await app.gateway.stop();
});

test('a hanging module aborts the round without committing', async (t) => {
  const app = await launch(t, {
    modules: { 'hang.mjs': hangSource() },
    scriptTimeoutMs: 100,
    heartbeatIntervalMs: 60_000,
  });

  const response = await app.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(response.status, 202);

  await app.tick();

  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 0);
  assert.equal(state.activeBatch.attempts, 1);
  assert.match(state.activeBatch.lastError, /timed out after 100 ms/);
  assert.equal(state.actions.a1.status, 'queued');
  assert.equal(state.actions.a1.attempts, 1);
  assert.match(state.actions.a1.lastError, /timed out after 100 ms/);
});
