import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, makeTempDir, until } from '../test-support/harness.mjs';
import { counterSource, flakySource } from '../test-support/models.mjs';

const heartbeatIntervalMs = 60_000;
const startWallTimeMs = 1_700_000_000_000;

function setActive(statePath, active) {
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  saved.active = active;
  writeFileSync(statePath, `${JSON.stringify(saved, null, 2)}\n`);
}

async function getJson(app, path) {
  const response = await app.get(path);
  assert.equal(response.status, 200, `GET ${path} failed`);
  return response.json();
}

async function health(app) {
  return getJson(app, '/health');
}

async function assertPausedFrozen(app) {
  const snapshot = await health(app);
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.simulatedSeconds, 0);
  assert.equal(snapshot.pendingActions, 2);
  assert.equal(snapshot.batch?.targetSimulatedSeconds, 60);
  assert.equal(snapshot.batch?.attempts, 1);
  return snapshot;
}

function startupProbeSource(markerPath) {
  return `
import { writeFileSync } from 'node:fs';

export const id = 'probe';
export const actionTypes = [];
export const initialState = { heartbeats: 0 };

export function initialize() {
  writeFileSync(${JSON.stringify(markerPath)}, 'ran');
  return {};
}

export function heartbeat(io) {
  const prev = io.read('probe') ?? {};
  io.write({ ...prev, heartbeats: (prev.heartbeats ?? 0) + 1 });
}
`;
}

test('a failed in-flight batch survives a paused restart and resumes in order without catch-up', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const statePath = join(root, 'state', 'body-state.json');
  const startedPath = join(root, 'control', 'started');
  const releasePath = join(root, 'control', 'release');
  const countPath = join(root, 'control', 'count');
  const startupMarker = join(root, 'control', 'startup-ran');
  mkdirSync(join(root, 'control'), { recursive: true });

  const modules = {
    'flaky.mjs': flakySource({ startedPath, releasePath, countPath }),
    'startup-probe.mjs': startupProbeSource(startupMarker),
  };
  let clock = startWallTimeMs;
  const launchOptions = {
    dir: root,
    statePath,
    modules,
    startupScripts: ['modules/startup-probe.mjs'],
    catchUpMinutes: 120,
    heartbeatIntervalMs,
    gatewayOptions: { now: () => clock },
  };

  const first = await launch(t, launchOptions);
  assert.equal((await health(first)).active, true);
  assert.equal(first.exists(startupMarker), true);

  const queued = await first.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).effectiveAt, 60);

  const failing = first.tick();
  try {
    await until(() => first.exists(startedPath));

    const inFlight = await health(first);
    assert.equal(inFlight.heartbeat.inFlight, true);
    assert.equal(inFlight.batch?.targetSimulatedSeconds, 60);
    assert.equal(inFlight.batch?.attempts, 0);

    const next = await first.post('/actions', { id: 'a2', type: 'eat' });
    assert.equal(next.status, 202);
    assert.equal((await next.json()).effectiveAt, 120);
  } finally {
    writeFileSync(releasePath, '');
  }

  const failed = await failing;
  assert.equal(failed.failed, true);

  let snapshot = await health(first);
  assert.equal(snapshot.simulatedSeconds, 0);
  assert.equal(snapshot.pendingActions, 2);
  assert.equal(snapshot.batch?.targetSimulatedSeconds, 60);
  assert.equal(snapshot.batch?.attempts, 1);

  const failedReceipt = await getJson(first, '/actions/a1');
  assert.equal(failedReceipt.status, 'queued');
  assert.equal(failedReceipt.attempts, 1);
  assert.match(failedReceipt.lastError, /planned failure/);

  await first.gateway.stop();
  setActive(statePath, false);
  rmSync(startupMarker, { force: true });

  clock = startWallTimeMs + 2 * 60 * 60 * 1000;
  const paused = await launch(t, launchOptions);
  await assertPausedFrozen(paused);
  assert.equal(paused.exists(startupMarker), false);

  const pausedState = await getJson(paused, '/state');
  assert.equal(pausedState.simulatedSeconds, 0);
  assert.equal(pausedState.parts.probe.heartbeats, 0);

  const pausedReceipt = await getJson(paused, '/actions/a1');
  assert.equal(pausedReceipt.status, 'queued');
  assert.equal(pausedReceipt.attempts, 1);
  assert.match(pausedReceipt.lastError, /planned failure/);
  assert.equal((await getJson(paused, '/actions/a2')).effectiveAt, 120);

  const idleTick = await paused.tick();
  assert.equal(idleTick.ran, false);
  await assertPausedFrozen(paused);

  const replay = await paused.post('/actions', { id: 'a1', type: 'eat' });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).status, 'queued');

  const rejected = await paused.post('/actions', { id: 'a3', type: 'eat' });
  assert.equal(rejected.status, 409);
  await assertPausedFrozen(paused);

  await paused.gateway.stop();

  clock = startWallTimeMs + 5 * 60 * 60 * 1000;
  const stillPaused = await launch(t, launchOptions);
  await assertPausedFrozen(stillPaused);
  assert.equal((await getJson(stillPaused, '/state')).parts.probe.heartbeats, 0);
  assert.equal((await stillPaused.tick()).ran, false);
  await assertPausedFrozen(stillPaused);
  await stillPaused.gateway.stop();

  const resumedAt = startWallTimeMs + 7 * 60 * 60 * 1000;
  clock = resumedAt;
  setActive(statePath, true);
  const resumed = await launch(t, launchOptions);

  snapshot = await health(resumed);
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.simulatedSeconds, 0);
  assert.equal(snapshot.pendingActions, 2);
  assert.equal(snapshot.batch?.targetSimulatedSeconds, 60);
  assert.equal(snapshot.batch?.attempts, 1);

  assert.equal((await getJson(resumed, '/state')).simulatedSeconds, 0);
  assert.equal((await getJson(resumed, '/actions/a1')).status, 'queued');
  assert.equal((await getJson(resumed, '/actions/a2')).effectiveAt, 120);

  clock = resumedAt + heartbeatIntervalMs;
  const originalBatchTick = await resumed.tick();
  assert.equal(originalBatchTick.ran, true);
  let state = await getJson(resumed, '/state');
  assert.equal(state.simulatedSeconds, 60);
  assert.deepEqual(state.parts.flaky.rounds, [{ t: 60, ids: ['a1'] }]);
  assert.deepEqual(state.parts.flaky.applied, ['a1']);
  assert.equal(state.parts.probe.heartbeats, 1);
  let receipt = await health(resumed);
  assert.equal(receipt.simulatedSeconds, 60);
  assert.equal(receipt.pendingActions, 1);
  assert.equal(receipt.batch, null);
  assert.equal(receipt.wallTimeMs, resumedAt + heartbeatIntervalMs);

  clock = resumedAt + 2 * heartbeatIntervalMs;
  const laterActionTick = await resumed.tick();
  assert.equal(laterActionTick.ran, true);
  state = await getJson(resumed, '/state');
  assert.equal(state.simulatedSeconds, 120);
  assert.deepEqual(state.parts.flaky.rounds, [
    { t: 60, ids: ['a1'] },
    { t: 120, ids: ['a2'] },
  ]);
  assert.deepEqual(state.parts.flaky.applied, ['a1', 'a2']);
  assert.equal((await getJson(resumed, '/actions/a1')).appliedAtSimulatedSeconds, 60);
  assert.equal((await getJson(resumed, '/actions/a2')).appliedAtSimulatedSeconds, 120);
  receipt = await health(resumed);
  assert.equal(receipt.simulatedSeconds, 120);
  assert.equal(receipt.pendingActions, 0);
  assert.equal(receipt.wallTimeMs, resumedAt + 2 * heartbeatIntervalMs);

  const afterRecovery = await resumed.post('/actions', { id: 'a3', type: 'eat' });
  assert.equal(afterRecovery.status, 202);
  const a3Receipt = await afterRecovery.json();
  assert.equal(a3Receipt.effectiveAt, 180);
  assert.equal(
    (await getJson(resumed, '/actions/a3')).receivedAtWallTimeMs,
    resumedAt + 2 * heartbeatIntervalMs,
  );

  clock = resumedAt + 3 * heartbeatIntervalMs;
  await resumed.tick();
  state = await getJson(resumed, '/state');
  assert.equal(state.simulatedSeconds, 180);
  assert.deepEqual(state.parts.flaky.rounds, [
    { t: 60, ids: ['a1'] },
    { t: 120, ids: ['a2'] },
    { t: 180, ids: ['a3'] },
  ]);
  assert.deepEqual(state.parts.flaky.applied, ['a1', 'a2', 'a3']);
  assert.equal((await health(resumed)).wallTimeMs, resumedAt + 3 * heartbeatIntervalMs);
});

test('a normal restart while active still catches up by the manifest policy', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const statePath = join(root, 'state', 'body-state.json');
  let clock = startWallTimeMs;

  const options = {
    dir: root,
    statePath,
    modules: { 'counter.mjs': counterSource() },
    catchUpMinutes: 120,
    heartbeatIntervalMs,
    gatewayOptions: { now: () => clock },
  };

  const first = await launch(t, options);
  assert.equal((await health(first)).active, true);
  assert.equal((await getJson(first, '/state')).simulatedSeconds, 0);
  await first.gateway.stop();

  clock = startWallTimeMs + 3 * heartbeatIntervalMs;
  const second = await launch(t, options);
  const healthAfterRestart = await health(second);
  const state = await getJson(second, '/state');
  assert.equal(healthAfterRestart.active, true);
  assert.equal(healthAfterRestart.simulatedSeconds, 180);
  assert.equal(healthAfterRestart.pendingActions, 0);
  assert.equal(state.parts.counter.rounds.length, 3);
  assert.ok(healthAfterRestart.wallTimeMs >= clock);
});
