import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint, launch, makeTempDir, rawRequest } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';
import { rmSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function bindingProbeSource() {
  return `
export const id = 'probe';
export const actionTypes = ['eat'];
export const initialState = { seenBoundIds: [], rounds: 0, appliedIds: [] };
export const fields = {
  seenBoundIds: { unit: '1', mode: 'absolute' },
  rounds: { unit: '1', mode: 'absolute' },
  appliedIds: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io) {
  const prev = io.read('probe') ?? initialState;
  const rounds = (prev.rounds ?? 0) + 1;
  const seenBoundIds = [...(prev.seenBoundIds ?? []), io.boundSessionId ?? null];
  const appliedIds = [...(prev.appliedIds ?? []), ...io.actions.map((action) => action.id)];
  io.write({ seenBoundIds, rounds, appliedIds });
  if (io.boundSessionId) {
    io.notify({
      mode: 'context',
      sessionId: io.boundSessionId,
      text: '身体感到微渴。',
    });
  }
}
`;
}

test('requireBinding starts dormant, skips catchUp, halts heartbeats, and rejects POST /actions with 409', async (t) => {
  let nowMs = 1_000_000;
  const seed = checkpoint({
    wallTimeMs: 100_000,
    simulatedSeconds: 120,
    parts: {
      counter: { rounds: [], applied: [], volumeMl: 0 },
    },
  });

  const body = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed,
    catchUpMinutes: 10,
    heartbeatIntervalMs: 60_000,
    autoTick: false,
    gatewayOptions: {
      now: () => nowMs,
      requireBinding: true,
      defaultNsfw: false,
    },
  });

  assert.equal(body.gateway.isDormant(), true);
  assert.equal(body.gateway.getBoundSessionId(), null);
  assert.equal(body.gateway.getNsfw(), false);

  const healthRes = await body.get('/health');
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.active, true);
  assert.equal(health.dormant, true);
  assert.equal(health.boundSessionId, null);
  assert.equal(health.nsfw, false);
  assert.equal(health.simulatedSeconds, 120);
  assert.equal(health.wallTimeMs, 1_000_000);

  const saved = body.state();
  assert.equal(saved.startup.caughtUpSeconds, 0);
  assert.deepEqual(saved.snapshot.parts.counter.rounds, []);

  const tickOutcome = await body.tick();
  assert.deepEqual(tickOutcome, { ran: false, failed: false, dormant: true });
  assert.equal(body.gateway.getState().simulatedSeconds, 120);

  const actionRes = await body.post('/actions', {
    id: 'act-while-dormant',
    type: 'eat',
    volumeMl: 200,
    sessionId: 'session-a',
  });
  assert.equal(actionRes.status, 409);
  const actionBody = await actionRes.json();
  assert.equal(actionBody.dormant, true);
  assert.equal(actionBody.boundSessionId, null);
  assert.match(actionBody.error, /dormant/i);
  assert.deepEqual(body.state().pendingActionIds, []);
});

test('dormant Gateway with autoTick true does not advance heartbeats until bound', async (t) => {
  let nowMs = 5_000;
  const body = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    heartbeatIntervalMs: 10,
    autoTick: true,
    gatewayOptions: {
      now: () => nowMs,
      requireBinding: true,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(body.gateway.isDormant(), true);
  assert.equal(body.gateway.getState().simulatedSeconds, 0);
  assert.deepEqual(body.gateway.getState().parts.counter.rounds, []);
});

test('POST /bind and gateway.bindSession wake from dormancy, re-anchor wallTimeMs with zero catch-up, inject io.boundSessionId, and allow actions', async (t) => {
  let nowMs = 10_000;
  const body = await launch(t, {
    modules: { 'probe.mjs': bindingProbeSource() },
    catchUpMinutes: 10,
    heartbeatIntervalMs: 60_000,
    autoTick: false,
    gatewayOptions: {
      now: () => nowMs,
      requireBinding: true,
      defaultNsfw: true,
    },
  });

  // Advance wall clock significantly while dormant; binding must not catch up.
  nowMs = 6_010_000;
  const bindRes = await body.post('/bind', { sessionId: '  session-alpha  ' });
  assert.equal(bindRes.status, 200);
  const bindJson = await bindRes.json();
  assert.deepEqual(bindJson, {
    ok: true,
    active: true,
    dormant: false,
    boundSessionId: 'session-alpha',
    nsfw: true,
  });

  const health = await (await body.get('/health')).json();
  assert.equal(health.dormant, false);
  assert.equal(health.boundSessionId, 'session-alpha');
  assert.equal(health.nsfw, true);
  assert.equal(health.wallTimeMs, 6_010_000);
  assert.equal(health.simulatedSeconds, 0);
  assert.equal(body.gateway.getState().parts.probe.rounds, 0);

  const actRes = await body.post('/actions', {
    id: 'act-1',
    type: 'eat',
    volumeMl: 150,
    sessionId: 'session-alpha',
  });
  assert.equal(actRes.status, 202);

  nowMs += 60_000;
  const tickOutcome = await body.tick();
  assert.deepEqual(tickOutcome, { ran: true, failed: false });

  const state = body.gateway.getState();
  assert.equal(state.simulatedSeconds, 60);
  assert.deepEqual(state.parts.probe, {
    seenBoundIds: ['session-alpha'],
    rounds: 1,
    appliedIds: ['act-1'],
  });
  const notifications = body.gateway.getNotifications();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].sessionId, 'session-alpha');
  assert.equal(notifications[0].text, '身体感到微渴。');

  // Re-binding via gateway.bindSession or POST /bind while bound to another session is rejected with 409.
  await assert.rejects(
    () => body.gateway.bindSession('session-beta'),
    (error) => error?.statusCode === 409 && /already bound/i.test(error.message),
  );
  const rebindHttp = await body.post('/bind', { sessionId: 'session-beta' });
  assert.equal(rebindHttp.status, 409);
  assert.equal(body.gateway.getBoundSessionId(), 'session-alpha');

  // Actions from another session or missing sessionId are rejected with 403 while bound.
  const spoofAct = await body.post('/actions', {
    id: 'act-spoof',
    type: 'eat',
    volumeMl: 100,
    sessionId: 'session-beta',
  });
  assert.equal(spoofAct.status, 403);
  const missingSessionAct = await body.post('/actions', {
    id: 'act-missing-session',
    type: 'eat',
    volumeMl: 100,
  });
  assert.equal(missingSessionAct.status, 403);

  // Unbinding with a mismatching expectedSessionId fails; matching unbind clears pending notifications for that session.
  await assert.rejects(
    () => body.gateway.unbindSession('session-beta'),
    (error) => error?.statusCode === 409,
  );
  const unbindHttpMismatch = await body.post('/unbind', { sessionId: 'session-beta' });
  assert.equal(unbindHttpMismatch.status, 409);
  assert.equal(body.gateway.getBoundSessionId(), 'session-alpha');

  await body.gateway.unbindSession('session-alpha');
  assert.equal(body.gateway.getBoundSessionId(), null);
  assert.deepEqual(body.gateway.getNotifications(), []);

  await body.gateway.bindSession('session-beta');
  nowMs += 60_000;
  await body.tick();
  const afterSecondTick = body.gateway.getState();
  assert.deepEqual(afterSecondTick.parts.probe.seenBoundIds, ['session-alpha', 'session-beta']);
});

test('POST /bind injects io.boundSessionId into real brainNotify on full human-organs manifest', async (t) => {
  const dir = makeTempDir();
  const statePath = join(dir, 'body-state.json');
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  let nowMs = 0;
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath,
    port: 0,
    autoTick: false,
    now: () => nowMs,
    requireBinding: true,
    defaultNsfw: false,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const info = await gateway.ready;
  assert.equal(gateway.isDormant(), true);

  // Trigger a clear sensation before binding? Since dormant blocks actions, bind first then fast-forward or enqueue.
  await gateway.bindSession('session-real-notify');
  assert.equal(gateway.isDormant(), false);

  // Enqueue a big solid meal to stimulate fullness notice or verify brainNotify tracks boundSessionId.
  const res = await fetch(`${info.url}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'big-meal-1',
      type: 'eat',
      volumeMl: 900,
      energyKcal: 800,
      mealKind: 'solid',
      sessionId: 'session-real-notify',
    }),
  });
  assert.equal(res.status, 202);

  nowMs += 60_000;
  await gateway.tick();

  const brainNotify = gateway.getState().parts.brainNotify;
  assert.equal(brainNotify.lastSessionId, 'session-real-notify');
  assert.ok(Object.hasOwn(brainNotify.sessions, 'session-real-notify'));
});

test('POST /unbind and gateway.unbindSession return Gateway to dormant without altering active or catching up on rebind', async (t) => {
  let nowMs = 1_000;
  const body = await launch(t, {
    modules: { 'probe.mjs': bindingProbeSource() },
    seed: {
      ...checkpoint({ wallTimeMs: 1_000, simulatedSeconds: 0 }),
      boundSessionId: 'session-initial',
    },
    catchUpMinutes: 10,
    heartbeatIntervalMs: 60_000,
    autoTick: false,
    gatewayOptions: {
      now: () => nowMs,
      requireBinding: true,
    },
  });

  assert.equal(body.gateway.isDormant(), false);
  assert.equal(body.gateway.getBoundSessionId(), 'session-initial');

  const unbindRes = await body.post('/unbind', {});
  assert.equal(unbindRes.status, 200);
  const unbindJson = await unbindRes.json();
  assert.deepEqual(unbindJson, {
    ok: true,
    active: true,
    dormant: true,
    boundSessionId: null,
    nsfw: false,
  });

  assert.equal(body.gateway.isDormant(), true);
  assert.equal(body.gateway.getBoundSessionId(), null);

  const health = await (await body.get('/health')).json();
  assert.equal(health.active, true);
  assert.equal(health.dormant, true);
  assert.equal(health.boundSessionId, null);

  assert.deepEqual(await body.tick(), { ran: false, failed: false, dormant: true });
  const rejected = await body.post('/actions', {
    id: 'act-after-unbind',
    type: 'eat',
    volumeMl: 100,
    sessionId: 'session-initial',
  });
  assert.equal(rejected.status, 409);

  // Advance clock while dormant, re-bind via gateway.bindSession, ensure zero catch-up.
  nowMs = 900_000;
  const rebound = await body.gateway.bindSession('session-resumed');
  assert.equal(rebound.dormant, false);
  assert.equal(rebound.active, true);
  assert.equal(rebound.boundSessionId, 'session-resumed');
  assert.equal(body.state().wallTimeMs, 900_000);
  assert.equal(body.gateway.getState().simulatedSeconds, 0);

  // Also test gateway.unbindSession directly.
  const unboundAgain = await body.gateway.unbindSession();
  assert.equal(unboundAgain.dormant, true);
  assert.equal(unboundAgain.active, true);
  assert.equal(unboundAgain.boundSessionId, null);
});

test('bind/unbind preserve active: false when body is paused', async (t) => {
  let nowMs = 5_000;
  const body = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    seed: {
      ...checkpoint({ wallTimeMs: 1_000, simulatedSeconds: 300 }),
      active: false,
      nsfw: true,
    },
    autoTick: false,
    gatewayOptions: {
      now: () => nowMs,
      requireBinding: true,
      defaultNsfw: false,
    },
  });

  const healthBefore = await (await body.get('/health')).json();
  assert.equal(healthBefore.active, false);
  assert.equal(healthBefore.dormant, true);
  assert.equal(healthBefore.boundSessionId, null);
  assert.equal(healthBefore.nsfw, true);

  const bindRes = await body.post('/bind', { sessionId: 'session-paused' });
  assert.equal(bindRes.status, 200);
  const bindJson = await bindRes.json();
  assert.deepEqual(bindJson, {
    ok: true,
    active: false,
    dormant: false,
    boundSessionId: 'session-paused',
    nsfw: true,
  });

  assert.deepEqual(await body.tick(), { ran: false, failed: false, paused: true });
  const actionRes = await body.post('/actions', {
    id: 'act-paused',
    type: 'eat',
    volumeMl: 100,
    sessionId: 'session-paused',
  });
  assert.equal(actionRes.status, 409);
  assert.equal((await actionRes.json()).active, false);

  const unbindRes = await body.post('/unbind', {});
  assert.equal(unbindRes.status, 200);
  const unbindJson = await unbindRes.json();
  assert.deepEqual(unbindJson, {
    ok: true,
    active: false,
    dormant: true,
    boundSessionId: null,
    nsfw: true,
  });
});

test('POST /bind and /unbind validate HTTP methods, content-type, and payloads', async (t) => {
  const body = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
    autoTick: false,
    gatewayOptions: {
      now: () => 0,
      requireBinding: true,
    },
  });

  const getBind = await body.get('/bind');
  assert.equal(getBind.status, 405);
  assert.equal(getBind.headers.get('allow'), 'POST');

  const getUnbind = await body.get('/unbind');
  assert.equal(getUnbind.status, 405);
  assert.equal(getUnbind.headers.get('allow'), 'POST');

  const wrongContentType = await rawRequest(body.base, {
    method: 'POST',
    path: '/bind',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ sessionId: 'session-a' }),
  });
  assert.equal(wrongContentType.status, 415);

  const invalidJson = await rawRequest(body.base, {
    method: 'POST',
    path: '/bind',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  });
  assert.equal(invalidJson.status, 400);

  for (const invalidPayload of [{}, { sessionId: '' }, { sessionId: '   ' }, { sessionId: 42 }, []]) {
    const res = await body.post('/bind', invalidPayload);
    assert.equal(res.status, 400);
    const err = await res.json();
    assert.equal(err.error, 'Expected a nonempty sessionId');
  }

  assert.equal(body.gateway.isDormant(), true);
  assert.equal(body.gateway.getBoundSessionId(), null);

  await assert.rejects(() => body.gateway.bindSession(''), TypeError);
  await assert.rejects(() => body.gateway.bindSession('   '), TypeError);
});
