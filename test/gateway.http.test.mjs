import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, rawRequest } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';

test('POST requires application/json', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const response = await rawRequest(app.base, {
    method: 'POST',
    path: '/actions',
    headers: { 'content-type': 'text/plain' },
    body: '{"id":"a1","type":"eat"}',
  });
  assert.equal(response.status, 415);
  assert.equal(app.state().pendingActionIds.length, 0);
});

test('a declared oversized body is rejected before it is read', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const response = await rawRequest(app.base, {
    method: 'POST',
    path: '/actions',
    headers: { 'content-type': 'application/json', 'content-length': '70000' },
  });
  assert.equal(response.status, 413);
  assert.equal(app.state().pendingActionIds.length, 0);
});

test('unexpected Host and Origin headers are rejected', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const badHost = await rawRequest(app.base, {
    path: '/health',
    headers: { host: 'evil.example' },
  });
  assert.equal(badHost.status, 403);

  const badOrigin = await rawRequest(app.base, {
    method: 'POST',
    path: '/actions',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    body: '{"id":"a1","type":"eat"}',
  });
  assert.equal(badOrigin.status, 403);

  const nullOrigin = await rawRequest(app.base, {
    method: 'POST',
    path: '/actions',
    headers: { origin: 'null', 'content-type': 'application/json' },
    body: '{"id":"a1","type":"eat"}',
  });
  assert.equal(nullOrigin.status, 403);
});

test('pathname routing, method rejection and health are observable', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const state = await rawRequest(app.base, { path: '/state?x=1' });
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.body).simulatedSeconds, 0);

  const wrongMethod = await rawRequest(app.base, { path: '/actions' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'POST');

  const health = await app.get('/health');
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'ok');
  assert.equal(body.pendingActions, 0);
  assert.equal(body.batch, null);
  assert.equal(body.heartbeat.consecutiveFailures, 0);
});

test('same-origin JSON with charset is accepted', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const response = await rawRequest(app.base, {
    method: 'POST',
    path: '/actions',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      origin: app.base,
    },
    body: '{"id":"a1","type":"eat"}',
  });
  assert.equal(response.status, 202);
  assert.equal(app.state().pendingActionIds.length, 1);
});

test('malformed action encodings return 400 and unknown ids return 404', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const malformed = await rawRequest(app.base, { path: '/actions/%E0%A4%A' });
  assert.equal(malformed.status, 400);

  const missing = await rawRequest(app.base, { path: '/actions/missing' });
  assert.equal(missing.status, 404);
});

test('ACK for an unknown notification is still a successful idempotent call', async (t) => {
  const app = await launch(t, {
    modules: { 'counter.mjs': counterSource() },
  });

  const response = await app.post('/notifications/ack', { id: 'missing' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'missing', acked: false });
});
