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

test('overlapping pump.run() calls do not deliver the same notification twice', async () => {
  const gateway = fakeGateway([notification({ id: 'n1', mode: 'wake', sessionId: 'session-a' })]);
  let releaseFollowup;
  const followupGate = new Promise((resolve) => {
    releaseFollowup = resolve;
  });
  let followupCalls = 0;
  const agent = {
    async inject() {
      throw new Error('unexpected inject');
    },
    async followup() {
      followupCalls += 1;
      await followupGate;
    },
  };
  const pump = createNotificationPump({
    gateway,
    agentFor: () => agent,
    makeId: () => 'message-1',
    logger: silentLogger,
  });

  const first = pump.run();
  await Promise.resolve();
  assert.equal(followupCalls, 1);

  const second = pump.run();
  assert.equal(followupCalls, 1);

  releaseFollowup();
  const [firstResults, secondResults] = await Promise.all([first, second]);

  assert.equal(followupCalls, 1);
  assert.deepEqual(firstResults, [{ id: 'n1', status: 'delivered' }]);
  assert.deepEqual(secondResults, [{ id: 'n1', status: 'delivered' }]);
  assert.deepEqual(gateway.state.acks, ['n1']);
  assert.deepEqual(gateway.queue, []);
});

test('agent/inbox/inserted records read receipt both synchronously pre-ack and asynchronously post-ack', async () => {
  const queue = [
    notification({ id: 'n-sync', sessionId: 'session-a' }),
    notification({ id: 'n-async', sessionId: 'session-b' }),
  ];
  const ackMetas = [];
  const receipts = [];
  const gateway = {
    getNotifications() {
      return queue.map((item) => ({ ...item }));
    },
    ackNotification(id, meta) {
      ackMetas.push({ id, meta });
      const idx = queue.findIndex((item) => item.id === id);
      if (idx !== -1) queue.splice(idx, 1);
      return { id, acked: idx !== -1 };
    },
    confirmNotificationInserted(payload) {
      receipts.push(payload);
      return { matched: true, ...payload };
    },
  };

  let pumpRef;
  let seq = 0;
  let clock = 10_000;
  const agents = {
    'session-a': {
      async inject(message) {
        clock += 50;
        pumpRef.handleInboxInserted({ message });
      },
      async followup() {
        throw new Error('unexpected followup');
      },
    },
    'session-b': {
      async inject() {},
      async followup() {
        throw new Error('unexpected followup');
      },
    },
  };
  pumpRef = createNotificationPump({
    gateway,
    agentFor: (sessionId) => agents[sessionId],
    makeId: () => `msg-${++seq}`,
    now: () => clock,
    logger: silentLogger,
  });

  const results = await pumpRef.run();
  assert.deepEqual(results, [
    { id: 'n-sync', status: 'delivered' },
    { id: 'n-async', status: 'delivered' },
  ]);
  assert.deepEqual(ackMetas, [
    { id: 'n-sync', meta: { messageId: 'msg-1', insertedAtWallTimeMs: 10_050 } },
    { id: 'n-async', meta: { messageId: 'msg-2' } },
  ]);
  assert.deepEqual(receipts, []);

  // Unrelated user message is ignored
  assert.deepEqual(
    pumpRef.handleInboxInserted({
      message: { id: 'user-msg-1', role: 'user', source: { kind: 'web' } },
    }),
    { matched: false },
  );
  assert.deepEqual(receipts, []);

  // Async agent/inbox/inserted for msg-2 triggers confirmNotificationInserted
  clock += 200;
  const asyncReceipt = pumpRef.handleInboxInserted({
    message: { id: 'msg-2', role: 'user', source: { kind: 'body-notify' } },
  });
  assert.equal(asyncReceipt.matched, true);
  assert.deepEqual(receipts, [{
    messageId: 'msg-2',
    notificationId: 'n-async',
    insertedAtWallTimeMs: 10_250,
  }]);
});

test('retried ackNotification preserves messageId and pre-ack inbox insertion timestamp', async () => {
  const queue = [notification({ id: 'n-retry', sessionId: 'session-a' })];
  let failAck = true;
  const ackMetas = [];
  const gateway = {
    getNotifications() {
      return queue.map((item) => ({ ...item }));
    },
    ackNotification(id, meta) {
      ackMetas.push({ id, meta });
      if (failAck) throw new Error('temporary ack failure');
      const idx = queue.findIndex((item) => item.id === id);
      if (idx !== -1) queue.splice(idx, 1);
      return { id, acked: true };
    },
  };

  let pumpRef;
  pumpRef = createNotificationPump({
    gateway,
    agentFor: () => ({
      async inject(message) {
        pumpRef.handleInboxInserted({ message });
      },
      async followup() {},
    }),
    makeId: () => 'msg-retry-1',
    now: () => 50_000,
    logger: silentLogger,
  });

  assert.deepEqual(await pumpRef.run(), [{ id: 'n-retry', status: 'failed' }]);
  failAck = false;
  assert.deepEqual(await pumpRef.run(), [{ id: 'n-retry', status: 'delivered' }]);
  assert.deepEqual(ackMetas, [
    { id: 'n-retry', meta: { messageId: 'msg-retry-1', insertedAtWallTimeMs: 50_000 } },
    { id: 'n-retry', meta: { messageId: 'msg-retry-1', insertedAtWallTimeMs: 50_000 } },
  ]);
});

test('notifications are not delivered when gateway is dormant or bound to a different session', async () => {
  let boundSessionId = null;
  let dormant = true;
  const queue = [notification({ id: 'n-stale', sessionId: 'session-a' })];
  const delivered = [];
  const gateway = {
    getBoundSessionId: () => boundSessionId,
    isDormant: () => dormant,
    getNotifications: () => queue.map((item) => ({ ...item })),
    ackNotification: (id) => ({ id, acked: false }),
  };
  const pump = createNotificationPump({
    gateway,
    agentFor: (sessionId) => fakeAgent(sessionId, delivered),
    makeId: () => 'msg-ignored',
    logger: silentLogger,
  });

  assert.deepEqual(await pump.run(), [{ id: 'n-stale', status: 'waiting' }]);
  assert.deepEqual(delivered, []);

  dormant = false;
  boundSessionId = 'session-b';
  assert.deepEqual(await pump.run(), [{ id: 'n-stale', status: 'waiting' }]);
  assert.deepEqual(delivered, []);
});
