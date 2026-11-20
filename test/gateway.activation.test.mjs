import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkpoint, launch, makeTempDir } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';

const interval = 25;
const startWallTimeMs = 1_700_000_000_000;

function recordingInitSource(markerPath) {
  return `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function initialize(_snapshot, context) {
  mkdirSync(dirname(${JSON.stringify(markerPath)}), { recursive: true });
  writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify(context));
  return {};
}
`;
}

function probeSource() {
  return `
export const id = 'probe';
export const actionTypes = ['eat'];
export const initialState = { value: 100, seen: null };

export function heartbeat(io) {
  const prev = io.read('probe') ?? {};
  io.write({ ...prev, seen: prev.value });
}
`;
}

function patchProbeInitSource() {
  return `
export function initialize() {
  return { probe: { value: 999 } };
}
`;
}

function taggedCounterSource({ loadMarker, heartbeatMarker }) {
  return `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

mkdirSync(dirname(${JSON.stringify(loadMarker)}), { recursive: true });
writeFileSync(${JSON.stringify(loadMarker)}, 'loaded');

export const id = 'counter';
export const actionTypes = ['eat'];
export const initialState = { rounds: [], applied: [], volumeMl: 0 };

export function heartbeat(io) {
  mkdirSync(dirname(${JSON.stringify(heartbeatMarker)}), { recursive: true });
  writeFileSync(${JSON.stringify(heartbeatMarker)}, String(io.simulatedSeconds));
  const prev = io.read('counter') ?? {};
  const rounds = [...(prev.rounds ?? []), { t: io.simulatedSeconds, ids: io.actions.map((action) => action.id) }];
  io.write({ ...prev, rounds });
}
`;
}

function savedWithActive(seed, active) {
  return { ...seed, active };
}

async function untilImmediate(check, { timeout = 4000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('untilImmediate: timed out');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('a new body without an active flag starts enabled', async (t) => {
  let clock = startWallTimeMs;
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    gatewayOptions: { now: () => clock },
  });

  const health = await (await app.get('/health')).json();
  assert.equal(health.active, true);
  assert.equal(app.state().active, true);

  const outcome = await app.tick();
  assert.equal(outcome.ran, true);
  assert.equal(app.state().snapshot.simulatedSeconds, 60);
});

test('v1 and v2 archives without an active flag are treated as enabled', async (t) => {
  let clock = startWallTimeMs;
  const v1 = {
    wallTimeMs: clock,
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActions: [],
    receipts: {},
    notifications: [],
  };
  const first = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed: v1,
    gatewayOptions: { now: () => clock },
  });
  assert.equal((await (await first.get('/health')).json()).active, true);
  assert.equal(first.state().schemaVersion, 2);
  assert.equal(first.state().active, true);

  const second = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed: checkpoint({ wallTimeMs: clock }),
    gatewayOptions: { now: () => clock },
  });
  assert.equal((await (await second.get('/health')).json()).active, true);
  assert.equal(second.state().active, true);
});

test('an invalid active value is rejected without rewriting the archive', async (t) => {
  let clock = startWallTimeMs;
  for (const active of ['true', 1, null, {}]) {
    const seed = savedWithActive(checkpoint({ wallTimeMs: clock }), active);
    const app = await launch(t, {
      modules: { 'counter.mjs': counterSource() },
      seed,
      expectReadyReject: true,
      gatewayOptions: { now: () => clock },
    });

    assert.ok(app.readyError);
    assert.match(app.readyError.message, /active/);
    assert.equal(readFileSync(app.statePath, 'utf8'), JSON.stringify(seed));
  }
});

test('a paused start skips catch-up, initialization and every heartbeat path', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const control = join(root, 'control');
  mkdirSync(control, { recursive: true });
  const initMarker = join(control, 'init.json');
  const loadMarker = join(control, 'module-loaded');
  const heartbeatMarker = join(control, 'heartbeat');
  writeFileSync(join(root, 'init.mjs'), recordingInitSource(initMarker));

  let clock = startWallTimeMs;
  const wallTimeMs = clock - 10 * interval;
  const seed = savedWithActive(checkpoint({ wallTimeMs }), false);
  const app = await launch(t, {
    dir: root,
    seed,
    modules: {
      'tagged.mjs': taggedCounterSource({ loadMarker, heartbeatMarker }),
    },
    startupScripts: ['./init.mjs'],
    catchUpMinutes: 10,
    heartbeatIntervalMs: interval,
    autoTick: true,
    gatewayOptions: { now: () => clock },
  });

  const health = await (await app.get('/health')).json();
  assert.equal(health.active, false);
  assert.equal(health.simulatedSeconds, 0);
  assert.equal(app.state().wallTimeMs, wallTimeMs);
  assert.equal(app.state().activeBatch, null);
  assert.equal(app.exists(initMarker), false);
  assert.equal(app.exists(loadMarker), false);

  assert.equal((await app.tick()).ran, false);
  assert.equal((await app.tick()).ran, false);
  await new Promise((resolve) => setTimeout(resolve, 80));

  const stopped = await (await app.get('/health')).json();
  assert.equal(stopped.active, false);
  assert.equal(stopped.simulatedSeconds, 0);
  assert.equal(stopped.heartbeat.inFlight, false);
  assert.equal(app.state().snapshot.simulatedSeconds, 0);
  assert.equal(app.state().activeBatch, null);
  assert.equal(app.exists(initMarker), false);
  assert.equal(app.exists(loadMarker), false);
  assert.equal(app.exists(heartbeatMarker), false);
});

test('a paused start preserves parts, pending actions, an in-flight batch and notifications', async (t) => {
  let clock = startWallTimeMs;
  const wallTimeMs = clock - 10 * interval;
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 180,
    receivedAtWallTimeMs: wallTimeMs,
    queuedAtSimulatedSeconds: 120,
    batchId: null,
    attempts: 2,
    lastError: 'planned failure',
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const batch = {
    id: 180,
    targetSimulatedSeconds: 180,
    targetWallTimeMs: wallTimeMs + interval,
    actionIds: ['a1'],
    attempts: 2,
    lastError: 'planned failure',
    startedAtWallTimeMs: wallTimeMs,
  };
  const seed = savedWithActive(checkpoint({
    wallTimeMs,
    simulatedSeconds: 120,
    parts: { counter: { rounds: [{ t: 60, ids: [] }], applied: ['old'], volumeMl: 42 } },
    pendingActionIds: ['a1'],
    actions: { a1: action },
    activeBatch: batch,
    lastEffectiveAt: 180,
    notifications: [{ id: 'n1', mode: 'context', sessionId: 'session-a', text: 'hello' }],
  }), false);

  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 10,
    heartbeatIntervalMs: interval,
    gatewayOptions: { now: () => clock },
  });

  let state = app.state();
  assert.deepEqual(state.snapshot, seed.snapshot);
  assert.deepEqual(state.pendingActionIds, ['a1']);
  assert.equal(state.actions.a1.status, 'queued');
  assert.equal(state.actions.a1.attempts, 2);
  assert.equal(state.actions.a1.failedReason, null);
  assert.deepEqual(state.activeBatch, batch);
  assert.deepEqual(state.notifications, seed.notifications);
  assert.equal(state.wallTimeMs, wallTimeMs);

  await app.tick();
  state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 120);
  assert.deepEqual(state.activeBatch, batch);
  assert.equal(state.actions.a1.status, 'queued');

  assert.equal((await app.get('/actions/a1')).status, 200);
  const ack = await app.post('/notifications/ack', { id: 'n1' });
  assert.deepEqual(await ack.json(), { id: 'n1', acked: true });

  state = app.state();
  assert.deepEqual(state.snapshot, seed.snapshot);
  assert.deepEqual(state.pendingActionIds, ['a1']);
  assert.deepEqual(state.activeBatch, batch);
  assert.deepEqual(state.notifications, []);
});

test('a paused gateway replays existing receipts but rejects new actions', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let clock = startWallTimeMs;
  const options = {
    dir: root,
    modules: { 'counter.mjs': counterSource() },
    catchUpMinutes: 10,
    heartbeatIntervalMs: interval,
    gatewayOptions: { now: () => clock },
  };

  const first = await launch(t, options);
  const accepted = await first.post('/actions', { id: 'a1', type: 'eat', volumeMl: 10 });
  assert.equal(accepted.status, 202);
  const receipt = await accepted.json();
  await first.gateway.stop();

  const saved = JSON.parse(readFileSync(first.statePath, 'utf8'));
  writeFileSync(first.statePath, JSON.stringify(savedWithActive(saved, false)));

  const paused = await launch(t, options);
  assert.equal((await (await paused.get('/health')).json()).active, false);

  const replay = await paused.post('/actions', { id: 'a1', type: 'eat', volumeMl: 10 });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.status, 'queued');
  assert.equal(replayBody.effectiveAt, receipt.effectiveAt);

  const conflict = await paused.post('/actions', { id: 'a1', type: 'eat', volumeMl: 99 });
  assert.equal(conflict.status, 409);

  const fresh = await paused.post('/actions', { id: 'a2', type: 'eat' });
  assert.equal(fresh.status, 409);
  assert.match((await fresh.json()).error, /paused/i);

  const state = paused.state();
  assert.deepEqual(state.pendingActionIds, ['a1']);
  assert.equal(Object.hasOwn(state.actions, 'a2'), false);

  const capabilities = await paused.get('/capabilities');
  assert.equal(capabilities.status, 200);
  assert.deepEqual(await capabilities.json(), {});
  assert.deepEqual(paused.gateway.getCapabilities(), {});
});

test('a running gateway never re-reads active from the archive', async (t) => {
  let clock = startWallTimeMs;
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    gatewayOptions: { now: () => clock },
  });

  const saved = JSON.parse(readFileSync(app.statePath, 'utf8'));
  writeFileSync(app.statePath, JSON.stringify(savedWithActive(saved, false)));

  let outcome = await app.tick();
  assert.equal(outcome.ran, true);
  assert.equal(app.state().snapshot.simulatedSeconds, 60);
  assert.equal((await (await app.get('/health')).json()).active, true);
  assert.equal(JSON.parse(readFileSync(app.statePath, 'utf8')).active, true);

  writeFileSync(app.statePath, '{ not json');
  outcome = await app.tick();
  assert.equal(outcome.ran, true);
  assert.equal(app.state().snapshot.simulatedSeconds, 120);
  assert.equal(JSON.parse(readFileSync(app.statePath, 'utf8')).active, true);
});

test('a resumed batch waits for the next normal deadline instead of running twice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const interval = 60_000;
  const resumedAt = startWallTimeMs + 7 * 60 * 60 * 1000;
  const wallTimeMs = startWallTimeMs;
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 60,
    receivedAtWallTimeMs: wallTimeMs,
    queuedAtSimulatedSeconds: 0,
    batchId: null,
    attempts: 1,
    lastError: 'planned failure',
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const batch = {
    id: 60,
    targetSimulatedSeconds: 60,
    targetWallTimeMs: wallTimeMs + interval,
    actionIds: ['a1'],
    attempts: 1,
    lastError: 'planned failure',
    startedAtWallTimeMs: wallTimeMs,
  };
  const seed = {
    ...checkpoint({
      wallTimeMs,
      simulatedSeconds: 0,
      parts: { counter: { rounds: [], applied: [], volumeMl: 0 } },
      pendingActionIds: ['a1'],
      actions: { a1: action },
      activeBatch: batch,
      lastEffectiveAt: 60,
    }),
    active: true,
    startup: {
      startedAtMs: resumedAt - interval,
      previousStartedAtMs: null,
      sincePreviousStartMs: null,
      hasSavedState: true,
      sinceCheckpointMs: 0,
      caughtUpSeconds: 0,
      catchUpError: null,
      active: false,
      resumedFromPause: false,
    },
  };
  let clock = resumedAt;
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 10,
    heartbeatIntervalMs: interval,
    autoTick: true,
    gatewayOptions: { now: () => clock },
  });

  assert.equal(app.state().snapshot.simulatedSeconds, 0);
  assert.equal(app.state().wallTimeMs, resumedAt);
  assert.equal(app.state().activeBatch.targetWallTimeMs, resumedAt + interval);

  clock = resumedAt + interval;
  t.mock.timers.tick(interval);
  await untilImmediate(() => app.state().snapshot.simulatedSeconds === 60);
  await new Promise((resolve) => setImmediate(resolve));

  let health = await (await app.get('/health')).json();
  assert.equal(health.wallTimeMs, resumedAt + interval);
  assert.equal(health.batch, null);
  assert.equal(health.heartbeat.inFlight, false);

  t.mock.timers.tick(0);
  await new Promise((resolve) => setImmediate(resolve));
  health = await (await app.get('/health')).json();
  assert.equal(health.batch, null);
  assert.equal(health.heartbeat.inFlight, false);
  assert.equal(health.simulatedSeconds, 60);
});

test('an in-flight batch skips the initializer until it retries', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'init.mjs'), patchProbeInitSource());
  let clock = startWallTimeMs;
  const interval = 60_000;
  const action = {
    id: 'a1',
    type: 'eat',
    action: { id: 'a1', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'queued',
    effectiveAt: 60,
    receivedAtWallTimeMs: clock,
    queuedAtSimulatedSeconds: 0,
    batchId: null,
    attempts: 2,
    lastError: 'planned failure',
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
  const batch = {
    id: 60,
    targetSimulatedSeconds: 60,
    targetWallTimeMs: clock + interval,
    actionIds: ['a1'],
    attempts: 2,
    lastError: 'planned failure',
    startedAtWallTimeMs: clock,
  };
  const seed = {
    ...checkpoint({
      wallTimeMs: clock,
      simulatedSeconds: 0,
      parts: { probe: { value: 100, seen: null } },
      pendingActionIds: ['a1'],
      actions: { a1: action },
      activeBatch: batch,
      lastEffectiveAt: 60,
    }),
    active: true,
    startup: {
      startedAtMs: clock - interval,
      previousStartedAtMs: null,
      sincePreviousStartMs: null,
      hasSavedState: true,
      sinceCheckpointMs: 0,
      caughtUpSeconds: 0,
      catchUpError: null,
      active: true,
      resumedFromPause: false,
    },
  };
  const options = {
    dir: root,
    modules: { 'probe.mjs': probeSource() },
    startupScripts: ['./init.mjs'],
    catchUpMinutes: 10,
    heartbeatIntervalMs: interval,
    gatewayOptions: { now: () => clock },
  };

  const app = await launch(t, { ...options, seed });
  assert.equal(app.state().snapshot.parts.probe.value, 100);
  assert.equal(app.state().activeBatch.targetSimulatedSeconds, 60);

  await app.tick();
  assert.equal(app.state().snapshot.parts.probe.seen, 100);
  assert.equal(app.state().activeBatch, null);
  await app.gateway.stop();

  const restarted = await launch(t, options);
  assert.equal(restarted.state().snapshot.parts.probe.value, 999);
  assert.equal(restarted.state().snapshot.parts.probe.seen, 100);
});

test('a paused start and ACK keep expired receipts until the body is active again', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock = startWallTimeMs;
  const options = {
    dir: root,
    modules: { 'counter.mjs': counterSource() },
    catchUpMinutes: 10,
    heartbeatIntervalMs: 60_000,
    gatewayOptions: { now: () => clock, actionRetentionMs: 1000 },
  };
  const old = {
    id: 'old',
    type: 'eat',
    action: { id: 'old', type: 'eat' },
    payloadDigest: 'sha256:test',
    status: 'applied',
    effectiveAt: 60,
    receivedAtWallTimeMs: clock - 20_000,
    queuedAtSimulatedSeconds: 0,
    batchId: 60,
    attempts: 1,
    lastError: null,
    appliedAtSimulatedSeconds: 60,
    appliedAtWallTimeMs: clock - 10_000,
    failedReason: null,
  };
  const seed = savedWithActive(checkpoint({
    wallTimeMs: clock - 60_000,
    simulatedSeconds: 60,
    parts: { counter: { rounds: [{ t: 60, ids: ['old'] }], applied: ['old'], volumeMl: 0 } },
    actions: { old },
    lastEffectiveAt: 60,
    notifications: [{ id: 'n1', mode: 'context', sessionId: 'session-a', text: 'hello' }],
  }), false);

  const paused = await launch(t, { ...options, seed });
  assert.equal(paused.state().actions.old.status, 'applied');
  assert.equal((await paused.get('/actions/old')).status, 200);

  const ack = await paused.post('/notifications/ack', { id: 'n1' });
  assert.deepEqual(await ack.json(), { id: 'n1', acked: true });
  assert.equal((await paused.get('/actions/old')).status, 200);
  assert.equal(paused.state().actions.old.status, 'applied');
  await paused.gateway.stop();

  const saved = JSON.parse(readFileSync(paused.statePath, 'utf8'));
  writeFileSync(paused.statePath, JSON.stringify(savedWithActive(saved, true)));
  const active = await launch(t, options);
  assert.equal((await active.get('/actions/old')).status, 404);
  assert.equal(Object.hasOwn(active.state().actions, 'old'), false);
});

test('a resumed body skips paused time and gets resume-aware initializer timing', async (t) => {
  const root = makeTempDir();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const control = join(root, 'control');
  mkdirSync(control, { recursive: true });
  const initMarker = join(control, 'init.json');
  writeFileSync(join(root, 'init.mjs'), recordingInitSource(initMarker));

  let clock = startWallTimeMs;
  const options = {
    dir: root,
    modules: { 'counter.mjs': counterSource() },
    startupScripts: ['./init.mjs'],
    catchUpMinutes: 10,
    heartbeatIntervalMs: interval,
    gatewayOptions: { now: () => clock },
  };

  const first = await launch(t, options);
  const firstContext = JSON.parse(readFileSync(initMarker, 'utf8'));
  assert.equal(firstContext.active, true);
  assert.equal(firstContext.resumedFromPause, false);
  assert.equal(firstContext.sinceCheckpointMs, null);
  await first.tick();
  assert.equal(first.state().snapshot.simulatedSeconds, 60);
  await first.gateway.stop();

  let saved = JSON.parse(readFileSync(first.statePath, 'utf8'));
  writeFileSync(first.statePath, JSON.stringify(savedWithActive(saved, false)));
  rmSync(initMarker, { force: true });

  clock += 2 * interval;
  const paused = await launch(t, options);
  assert.equal((await (await paused.get('/health')).json()).active, false);
  assert.equal(paused.state().snapshot.simulatedSeconds, 60);
  assert.equal(paused.state().wallTimeMs, saved.wallTimeMs);
  assert.equal(paused.state().startup.active, false);
  assert.equal(paused.exists(initMarker), false);
  assert.equal((await paused.tick()).ran, false);
  await paused.gateway.stop();

  clock += 4 * 60 * 60 * 1000;
  const stillPaused = await launch(t, options);
  assert.equal(stillPaused.state().snapshot.simulatedSeconds, 60);
  assert.equal(stillPaused.state().startup.active, false);
  assert.equal(stillPaused.exists(initMarker), false);
  assert.equal((await stillPaused.tick()).ran, false);
  assert.equal(stillPaused.exists(initMarker), false);
  await stillPaused.gateway.stop();

  saved = JSON.parse(readFileSync(stillPaused.statePath, 'utf8'));
  writeFileSync(stillPaused.statePath, JSON.stringify(savedWithActive(saved, true)));

  clock += 3 * interval;
  const resumedAt = clock;
  const resumed = await launch(t, options);
  let state = resumed.state();
  assert.equal((await (await resumed.get('/health')).json()).active, true);
  assert.equal(state.snapshot.simulatedSeconds, 60);
  assert.equal(state.startup.active, true);
  assert.equal(state.startup.resumedFromPause, true);
  assert.equal(state.startup.caughtUpSeconds, 0);
  assert.equal(state.startup.sinceCheckpointMs, 0);
  assert.equal(state.startup.startedAtMs, resumedAt);
  assert.equal(state.wallTimeMs, resumedAt);

  const resumedContext = JSON.parse(readFileSync(initMarker, 'utf8'));
  assert.equal(resumedContext.active, true);
  assert.equal(resumedContext.resumedFromPause, true);
  assert.equal(resumedContext.caughtUpSeconds, 0);
  assert.equal(resumedContext.sinceCheckpointMs, 0);
  assert.equal(resumedContext.startedAtMs, resumedAt);

  await resumed.tick();
  assert.equal(resumed.state().snapshot.simulatedSeconds, 120);
  await resumed.tick();
  assert.equal(resumed.state().snapshot.simulatedSeconds, 180);
  await resumed.gateway.stop();

  clock += 3 * interval;
  const restarted = await launch(t, options);
  state = restarted.state();
  assert.equal(state.snapshot.simulatedSeconds, 360);
  assert.equal(state.startup.active, true);
  assert.equal(state.startup.resumedFromPause, false);
  assert.equal(state.startup.caughtUpSeconds, 180);
  assert.equal(state.startup.sinceCheckpointMs, 3 * interval);
  assert.equal((await (await restarted.get('/health')).json()).active, true);
});
