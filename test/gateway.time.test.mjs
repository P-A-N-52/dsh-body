import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpoint, launch } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';

test('startup catch-up respects its limit and skips the oldest rounds', async (t) => {
  const interval = 25;
  const seed = checkpoint({
    wallTimeMs: Date.now() - 10 * interval - 10,
    simulatedSeconds: 0,
  });
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 3,
    heartbeatIntervalMs: interval,
  });

  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 180);
  assert.equal(state.startup.caughtUpSeconds, 180);
  assert.equal(state.snapshot.parts.counter.rounds.length, 3);
  assert.ok(state.wallTimeMs >= seed.wallTimeMs + 10 * interval);
  assert.ok(state.wallTimeMs <= Date.now());
});

test('a wall-clock rollback does not move simulated time backwards', async (t) => {
  const seed = checkpoint({
    wallTimeMs: Date.now() + 60_000,
    simulatedSeconds: 100,
  });
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 10,
    heartbeatIntervalMs: 60_000,
  });

  let state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 100);
  assert.equal(state.startup.caughtUpSeconds, 0);
  assert.ok(state.wallTimeMs <= Date.now() + 50);

  const response = await app.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).effectiveAt, 160);

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 160);
  assert.deepEqual(state.snapshot.parts.counter.applied, ['a1']);
});

test('an action accepted during a live catch-up waits beyond the replay horizon', async (t) => {
  const interval = 25;
  let currentNow = Date.now();
  const seed = checkpoint({
    wallTimeMs: currentNow,
    simulatedSeconds: 0,
  });
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 0,
    heartbeatIntervalMs: interval,
    gatewayOptions: { now: () => currentNow },
  });

  assert.equal(app.state().snapshot.simulatedSeconds, 0);
  currentNow += 10 * interval;
  await app.tick();
  assert.equal(app.state().snapshot.simulatedSeconds, 60);

  const response = await app.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).effectiveAt, 660);

  for (let index = 0; index < 10; index++) await app.tick();
  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 660);
  assert.deepEqual(state.snapshot.parts.counter.applied, ['a1']);
});
