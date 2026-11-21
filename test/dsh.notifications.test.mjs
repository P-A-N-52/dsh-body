import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBodyMessage, createNotificationPump } from '../notifications.js';

const silentLogger = { error() {} };

function notification(overrides = {}) {
  return {
    id: 'n1',
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
    createdAtSimulatedSeconds: 60,
    createdAtWallTimeMs: 1_760_000_060_000,
    ...overrides,
  };
}

function fakeGateway(notifications) {
  const queue = [...notifications];
  const state = { acks: [], ackFails: false };
  return {
    queue,
    state,
    getNotifications() {
      return queue.map((item) => ({ ...item }));
    },
    ackNotification(id) {
      state.acks.push(id);
      if (state.ackFails) throw new Error('ack failed');
      const index = queue.findIndex((item) => item.id === id);
      if (index !== -1) queue.splice(index, 1);
      return { id, acked: index !== -1 };
    },
  };
}

function fakeAgent(sessionId, log) {
  return {
    async inject(message) {
      log.push({ sessionId, method: 'inject', message });
    },
    async followup(message) {
      log.push({ sessionId, method: 'followup', message });
    },
  };
}

test('message shape is a valid user message', () => {
  const message = buildBodyMessage(notification(), () => 'message-1');

  assert.deepEqual(message, {
    id: 'message-1',
    role: 'user',
    content: [{ type: 'text', text: '身体感受：胃里有些空，饥饿感开始明显。' }],
    source: { kind: 'body-notify' },
  });
});

test('context notifications are injected into the matching session', async () => {
  const gateway = fakeGateway([notification({ sessionId: 'session-a' })]);
  const delivered = [];
  const agents = {
    'session-a': fakeAgent('session-a', delivered),
    'session-b': fakeAgent('session-b', delivered),
  };
  const pump = createNotificationPump({
    gateway,
    agentFor: (sessionId) => agents[sessionId],
    makeId: () => 'message-1',
    logger: silentLogger,
  });

  const results = await pump.run();

  assert.deepEqual(results, [{ id: 'n1', status: 'delivered' }]);
  assert.deepEqual(delivered, [{
    sessionId: 'session-a',
    method: 'inject',
    message: {
      id: 'message-1',
      role: 'user',
      content: [{ type: 'text', text: '身体感受：胃里有些空，饥饿感开始明显。' }],
      source: { kind: 'body-notify' },
    },
  }]);
  assert.deepEqual(gateway.state.acks, ['n1']);
  assert.deepEqual(gateway.queue, []);
});

test('wake notifications use followup', async () => {
  const gateway = fakeGateway([notification({ mode: 'wake', text: '身体感受：已经很饿了。' })]);
  const delivered = [];
  const pump = createNotificationPump({
    gateway,
    agentFor: () => fakeAgent('session-a', delivered),
    makeId: () => 'message-1',
    logger: silentLogger,
  });

  const results = await pump.run();

  assert.deepEqual(results, [{ id: 'n1', status: 'delivered' }]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].method, 'followup');
  assert.equal(delivered[0].message.content[0].text, '身体感受：已经很饿了。');
  assert.deepEqual(gateway.queue, []);
});

test('an offline session keeps its notification pending', async () => {
  const gateway = fakeGateway([notification({ sessionId: 'session-b' })]);
  const delivered = [];
  const agents = { 'session-a': fakeAgent('session-a', delivered) };
  const pump = createNotificationPump({
    gateway,
    agentFor: (sessionId) => agents[sessionId],
    makeId: () => 'message-1',
    logger: silentLogger,
  });

  const results = await pump.run();

  assert.deepEqual(results, [{ id: 'n1', status: 'waiting' }]);
  assert.deepEqual(delivered, []);
  assert.deepEqual(gateway.state.acks, []);
  assert.deepEqual(gateway.queue.map((item) => item.id), ['n1']);
});

test('ack failure does not duplicate delivery', async () => {
  const gateway = fakeGateway([notification()]);
  gateway.state.ackFails = true;
  const delivered = [];
  const pump = createNotificationPump({
    gateway,
    agentFor: () => fakeAgent('session-a', delivered),
    makeId: () => 'message-1',
    logger: silentLogger,
  });

  let results = await pump.run();
  assert.deepEqual(results, [{ id: 'n1', status: 'failed' }]);
  assert.equal(delivered.length, 1);
  assert.deepEqual(gateway.state.acks, ['n1']);

  gateway.state.ackFails = false;
  results = await pump.run();
  assert.deepEqual(results, [{ id: 'n1', status: 'delivered' }]);
  assert.equal(delivered.length, 1);
  assert.deepEqual(gateway.state.acks, ['n1', 'n1']);
  assert.deepEqual(gateway.queue, []);
});

test('a delivery error keeps the notification and does not stop later ones', async () => {
  const gateway = fakeGateway([
    notification({ id: 'n1', sessionId: 'session-a' }),
    notification({ id: 'n2', sessionId: 'session-b', text: '身体感受：吃得有点多了。' }),
  ]);
  const errors = [];
  const delivered = [];
  let failing = true;
  const flaky = {
    async inject(message) {
      if (failing) throw new Error('agent went away');
      delivered.push({ sessionId: 'session-a', method: 'inject', message });
    },
    async followup() {
      throw new Error('unexpected followup');
    },
  };
  const pump = createNotificationPump({
    gateway,
    agentFor: (sessionId) => (sessionId === 'session-a' ? flaky : fakeAgent('session-b', delivered)),
    makeId: () => 'message-1',
    logger: { error: (...args) => errors.push(args) },
  });

  let results = await pump.run();
  assert.deepEqual(results, [
    { id: 'n1', status: 'failed' },
    { id: 'n2', status: 'delivered' },
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(gateway.state.acks, ['n2']);
  assert.deepEqual(gateway.queue.map((item) => item.id), ['n1']);

  failing = false;
  results = await pump.run();
  assert.deepEqual(results, [{ id: 'n1', status: 'delivered' }]);
  assert.deepEqual(gateway.state.acks, ['n2', 'n1']);
  assert.deepEqual(gateway.queue, []);
});

test('a notification read error is logged instead of thrown', async () => {
  const errors = [];
  const gateway = {
    getNotifications() {
      throw new Error('gateway offline');
    },
    ackNotification() {
      throw new Error('should not ack');
    },
  };
  const pump = createNotificationPump({
    gateway,
    agentFor: () => undefined,
    logger: { error: (...args) => errors.push(args) },
  });

  assert.deepEqual(await pump.run(), []);
  assert.equal(errors.length, 1);
});
