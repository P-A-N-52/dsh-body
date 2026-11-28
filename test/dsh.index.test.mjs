import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { checkpoint, until } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';

function makeContext(home, agentsMap, { systemPrompt, withEvents = false } = {}) {
  const registeredTools = new Map();
  const disposers = [];
  const listeners = new Map();
  const ctx = {
    get(service) {
      if (service === 'profileContext') return { home };
      if (service === 'agents') return agentsMap;
      if (service === 'systemPrompt' && systemPrompt) return systemPrompt;
      throw new Error(`Unknown service: ${service}`);
    },
    effect(callback) {
      const disposer = callback();
      disposers.push(disposer);
      return disposer;
    },
    tools: {
      register(definition) {
        registeredTools.set(definition.name, definition);
        return () => {
          registeredTools.delete(definition.name);
        };
      },
    },
    ...(withEvents
      ? {
        on(eventName, handler) {
          if (!listeners.has(eventName)) listeners.set(eventName, new Set());
          listeners.get(eventName).add(handler);
          return () => {
            listeners.get(eventName)?.delete(handler);
          };
        },
      }
      : {}),
  };
  return {
    ctx,
    registeredTools,
    listeners,
    emit(eventName, ...args) {
      const results = [];
      for (const handler of [...(listeners.get(eventName) ?? [])]) {
        results.push(handler(...args));
      }
      return results;
    },
    async disposeAll() {
      if (withEvents) {
        for (const handler of [...(listeners.get('dispose') ?? [])]) {
          handler();
        }
      }
      for (const disposer of [...disposers].reverse()) {
        await disposer?.();
      }
    },
  };
}

function makeSystemPromptMock() {
  const sections = new Map();
  const contexts = new Map();
  return {
    sections,
    contexts,
    service: {
      section(entry) {
        assert.equal(typeof entry, 'object');
        assert.equal(typeof entry.name, 'string');
        assert.equal(typeof entry.order, 'number');
        assert.equal(typeof entry.text, 'string');
        sections.set(entry.name, entry);
        return () => sections.delete(entry.name);
      },
      context(entry) {
        assert.equal(typeof entry, 'object');
        assert.equal(typeof entry.name, 'string');
        assert.equal(typeof entry.order, 'number');
        assert.equal(typeof entry.text, 'function');
        contexts.set(entry.name, entry);
        return () => contexts.delete(entry.name);
      },
    },
  };
}

function setupManifest(dir) {
  const modulesDir = join(dir, 'modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(modulesDir, 'counter.mjs'), counterSource());
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./modules/counter.mjs'],
    catchUpMinutes: 0,
    scriptTimeoutMs: 2000,
  }));
  return manifestPath;
}

test('apply starts dormant with requireBinding, activates via body_bind, delivers notifications, and cleans up via ctx.effect', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-'));
  const home = join(dir, 'profile');
  const statePath = join(dir, 'state', 'body-state.json');
  const manifestPath = setupManifest(dir);

  const delivered = [];
  const agents = new Map([
    ['session-a', {
      async inject(message) {
        delivered.push({ method: 'inject', message });
      },
      async followup(message) {
        delivered.push({ method: 'followup', message });
      },
    }],
  ]);

  const notification = {
    id: 'n1',
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：口渴。',
    createdAtSimulatedSeconds: 60,
    createdAtWallTimeMs: Date.now(),
  };
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: Date.now(),
    notifications: [notification],
  })));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const clearIntervalMock = t.mock.method(globalThis, 'clearInterval');

  const { ctx, registeredTools, disposeAll } = makeContext(home, agents);
  let disposed = false;
  t.after(async () => {
    if (!disposed) await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, statePath, port: 0, notificationIntervalMs: 10 });

  assert.deepEqual([...registeredTools.keys()].sort(), ['body_act', 'body_bind', 'body_state']);
  assert.equal(delivered.length, 0);

  const dormantAct = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 200, energyKcal: 100, mealKind: 'liquid' },
    { agent: { session: { id: 'session-a' } }, callId: 'call-dormant' },
  );
  assert.equal(dormantAct.ok, false);
  assert.equal(dormantAct.statusCode, 409);
  assert.equal(dormantAct.receipt.dormant, true);

  const dormantState = await registeredTools.get('body_state').execute(
    { part: 'counter' },
    { agent: { session: { id: 'session-a' } } },
  );
  assert.equal(dormantState.status, 'dormant');
  assert.deepEqual(dormantState.feelings, []);
  assert.equal(/\d/.test(JSON.stringify(dormantState)), false);

  const bindResult = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'session-a' } } },
  );
  assert.equal(bindResult.ok, true);
  assert.equal(bindResult.bound, true);
  assert.equal(bindResult.dormant, false);
  assert.equal(bindResult.boundSessionId, 'session-a');

  await until(() => delivered.length === 1);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].method, 'followup');
  assert.equal(delivered[0].message.content[0].text, '身体感受：口渴。');
  assert.equal(delivered[0].message.source.kind, 'body-notify');

  const afterAck = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(afterAck.notifications, []);

  const actResult = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 200, energyKcal: 100, mealKind: 'liquid' },
    { agent: { session: { id: 'session-a' } }, callId: 'call-1' },
  );
  assert.equal(actResult.ok, true);
  assert.equal(actResult.statusCode, 202);

  const stateResult = await registeredTools.get('body_state').execute(
    { part: 'counter' },
    { agent: { session: { id: 'session-a' } } },
  );
  assert.equal(stateResult.status, 'active');
  assert.equal(stateResult.focus, 'all');
  assert.ok(Array.isArray(stateResult.feelings));
  assert.equal(typeof stateResult.summary, 'string');
  assert.equal(/\d/.test(JSON.stringify(stateResult)), false);

  // Calling without session context or from another session must never leak session-a's state.
  const noSessionState = await registeredTools.get('body_state').execute({ part: 'counter' });
  assert.equal(noSessionState.status, 'dormant');
  assert.deepEqual(noSessionState.feelings, []);
  const otherSessionState = await registeredTools.get('body_state').execute(
    { part: 'counter' },
    { agent: { session: { id: 'session-other' } } },
  );
  assert.equal(otherSessionState.status, 'dormant');
  assert.deepEqual(otherSessionState.feelings, []);

  await disposeAll();
  disposed = true;

  assert.equal(clearIntervalMock.mock.callCount(), 1);
  assert.equal(registeredTools.size, 0);
});

test('apply integrates optional systemPrompt, keeps a stale boundSessionId across boot, and auto-hibernates on agent/disposed', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-prompt-'));
  const home = join(dir, 'profile');
  const statePath = join(dir, 'state', 'body-state.json');
  const manifestPath = setupManifest(dir);

  const agents = new Map([
    ['session-a', {
      async inject() {},
      async followup() {},
    }],
  ]);

  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({ wallTimeMs: Date.now() }),
    boundSessionId: 'stale-session',
  }));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const promptMock = makeSystemPromptMock();
  const { ctx, registeredTools, listeners, emit, disposeAll } = makeContext(home, agents, {
    systemPrompt: promptMock.service,
    withEvents: true,
  });
  let disposed = false;
  t.after(async () => {
    if (!disposed) await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, statePath, port: 0 });

  assert.equal(promptMock.sections.has('dsh-body:cognition'), true);
  assert.equal(promptMock.sections.get('dsh-body:cognition').order, 120);
  const cognitionText = promptMock.sections.get('dsh-body:cognition').text;
  assert.equal(/\d/.test(cognitionText), false);
  assert.match(cognitionText, /不要主动调用 body_bind/);
  assert.equal(/\bsex\b|\borgasm\b|express_milk|breastfeed/.test(cognitionText), false);
  assert.equal(promptMock.contexts.has('dsh-body:feelings'), true);
  assert.equal(promptMock.contexts.get('dsh-body:feelings').order, 120);

  const feelingsContext = promptMock.contexts.get('dsh-body:feelings').text;

  // 重启保活：绑定会话暂不存活（agents.get 取不到）时启动保留绑定，存档不清空。
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).boundSessionId, 'stale-session');

  // 其他会话视角维持「已被其他会话占用」语义，且不泄漏持有者 ID。
  const initialStatus = await registeredTools.get('body_bind').execute(
    { action: 'status' },
    { agent: { session: { id: 'session-a' } } },
  );
  assert.equal(initialStatus.ok, false);
  assert.equal(initialStatus.bound, false);
  assert.equal(initialStatus.dormant, true);
  assert.equal(initialStatus.boundSessionId, null);
  assert.equal(initialStatus.error, 'Body is bound to another session');
  assert.equal(JSON.stringify(initialStatus).includes('stale-session'), false);
  assert.equal(feelingsContext({ agent: { session: { id: 'session-a' } } }), '');

  const staleAct = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 100, energyKcal: 50, mealKind: 'liquid' },
    { agent: { session: { id: 'session-a' } }, callId: 'call-stale' },
  );
  assert.equal(staleAct.ok, false);
  assert.equal(staleAct.statusCode, 403);

  // session-a 通过 body_bind 接管陈旧持有的身体：死持有者先解绑，再绑定新会话。
  const bound = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'session-a' } } },
  );
  assert.equal(bound.dormant, false);
  assert.equal(bound.boundSessionId, 'session-a');

  assert.equal(feelingsContext({ agent: { session: { id: 'session-other' } } }), '');
  const boundContext = feelingsContext({ agent: { session: { id: 'session-a' } } });
  assert.match(boundContext, /^\[身体背景感受\]/);
  assert.equal(/\d/.test(boundContext), false);

  // Another session cannot hijack, inspect, act on, or unbind session-a's body.
  const otherHijack = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'session-other' } } },
  );
  assert.equal(otherHijack.ok, false);
  assert.equal(otherHijack.boundSessionId, null);
  assert.equal(otherHijack.feeling, undefined);

  const otherAct = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 100, energyKcal: 50, mealKind: 'liquid' },
    { agent: { session: { id: 'session-other' } }, callId: 'call-other' },
  );
  assert.equal(otherAct.ok, false);
  assert.equal(otherAct.statusCode, 403);

  // Disposing another session keeps session-a bound.
  emit('agent/disposed', { agent: { session: { id: 'session-other' } } });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(
    (await registeredTools.get('body_bind').execute(
      { action: 'status' },
      { agent: { session: { id: 'session-a' } } },
    )).dormant,
    false,
  );

  // Disposing bound session auto-hibernates the body.
  emit('agent/disposed', { agent: { session: { id: 'session-a' } } });
  await until(async () => {
    const status = await registeredTools.get('body_bind').execute(
      { action: 'status' },
      { agent: { session: { id: 'session-a' } } },
    );
    return status.dormant === true;
  });

  const afterDisposeStatus = await registeredTools.get('body_bind').execute(
    { action: 'status' },
    { agent: { session: { id: 'session-a' } } },
  );
  assert.equal(afterDisposeStatus.bound, false);
  assert.equal(afterDisposeStatus.boundSessionId, null);
  assert.equal(feelingsContext({ agent: { session: { id: 'session-a' } } }), '');

  const actAfterDispose = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 100, energyKcal: 50, mealKind: 'liquid' },
    { agent: { session: { id: 'session-a' } }, callId: 'call-after-dispose' },
  );
  assert.equal(actAfterDispose.statusCode, 409);

  await disposeAll();
  disposed = true;

  assert.equal(promptMock.sections.size, 0);
  assert.equal(promptMock.contexts.size, 0);
  assert.equal(listeners.get('agent/disposed').size, 0);
});

test('apply handles empty string port and defaults statePath under profileContext home without optional services', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-env-'));
  const home = join(dir, 'profile');
  const manifestPath = setupManifest(dir);
  const previousPort = process.env.DSH_BODY_PORT;
  process.env.DSH_BODY_PORT = '0';

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx, registeredTools, disposeAll } = makeContext(home, new Map());
  t.after(async () => {
    await disposeAll();
    if (previousPort === undefined) delete process.env.DSH_BODY_PORT;
    else process.env.DSH_BODY_PORT = previousPort;
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, port: '' });

  assert.deepEqual([...registeredTools.keys()].sort(), ['body_act', 'body_bind', 'body_state']);
  assert.equal(existsSync(join(home, 'dsh-body', 'body-state.json')), true);
  assert.ok(registeredTools.get('body_bind').output.schema.properties.boundSessionId.oneOf);
});

test('apply resolves statePath from DSH dshHomePath when profileContext is absent', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-dshhome-'));
  const home = join(dir, 'dsh-home');
  const manifestPath = setupManifest(dir);
  const registeredTools = new Map();
  const disposers = [];

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const ctx = {
    get(service) {
      if (service === 'dshHomePath') return () => home;
      if (service === 'agents') return new Map();
      throw new Error(`Unknown service: ${service}`);
    },
    effect(callback) {
      const disposer = callback();
      disposers.push(disposer);
      return disposer;
    },
    tools: {
      register(definition) {
        registeredTools.set(definition.name, definition);
        return () => registeredTools.delete(definition.name);
      },
    },
  };

  t.after(async () => {
    for (const disposer of [...disposers].reverse()) {
      await disposer?.();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, port: 0 });
  assert.equal(existsSync(join(home, 'dsh-body', 'body-state.json')), true);
});

test('apply injects sleep behavioral notice in systemPrompt.context and wakes bound sleeping session on active tools or speech', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-sleep-'));
  const home = join(dir, 'profile');
  const modulesDir = join(dir, 'modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(modulesDir, 'sleep-stub.mjs'), `
    export const id = 'sleep';
    export const actionTypes = ['sleep', 'wake_up'];
    export const initialState = { sleeping: false, sleepStage: 'awake', sleepInertiaMm: 0, wakeEvent: 'none' };
    export const fields = {
      sleeping: { unit: '1', mode: 'absolute' },
      sleepStage: { unit: '1', mode: 'absolute' },
      sleepInertiaMm: { unit: 'mm', mode: 'absolute' },
      wakeEvent: { unit: '1', mode: 'absolute' },
    };
    export function heartbeat(io) {
      const prev = io.read('sleep') ?? initialState;
      let sleeping = prev.sleeping === true;
      for (const action of io.actions ?? []) {
        if (action?.type === 'sleep') sleeping = true;
        if (action?.type === 'wake_up') sleeping = false;
      }
      io.write({ sleeping, sleepStage: sleeping ? 'light' : 'awake', sleepInertiaMm: 0, wakeEvent: 'none' });
    }
  `);
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./modules/sleep-stub.mjs'],
    catchUpMinutes: 0,
    scriptTimeoutMs: 2000,
  }));
  const statePath = join(dir, 'state', 'body-state.json');
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({
      wallTimeMs: 0,
      simulatedSeconds: 0,
      parts: {
        sleep: { sleeping: true, sleepStage: 'light', sleepInertiaMm: 0, wakeEvent: 'none' },
      },
    }),
    boundSessionId: 'session-sleep-bound',
  }));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const promptMock = makeSystemPromptMock();
  const agents = new Map([['session-sleep-bound', { async inject() {}, async followup() {} }]]);
  const { ctx, listeners, emit, disposeAll } = makeContext(home, agents, {
    systemPrompt: promptMock.service,
    withEvents: true,
  });
  t.after(async () => {
    await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, statePath, port: 0 });

  // 1. systemPrompt.context injects sleep rule for bound sleeping session, nothing for unbound session
  const feelingsContext = promptMock.contexts.get('dsh-body:feelings').text;
  assert.equal(feelingsContext({ agent: { session: { id: 'session-other' } } }), '');
  const boundText = feelingsContext({ agent: { session: { id: 'session-sleep-bound' } } });
  assert.ok(boundText.includes('[睡眠状态行为规则]'), 'sleeping context must include behavioral notice');

  // 2. Unbound session tools/pre-execute & session/event do NOT queue wake_up
  const preResultsUnbound = await Promise.all(emit('tools/pre-execute', {
    name: 'send_group_message',
    args: { text: 'hi' },
    agent: { session: { id: 'session-other' } },
  }, async () => ({ kind: 'allow' })));
  assert.deepEqual(preResultsUnbound, [{ kind: 'allow' }]);

  // 3. Bound session exempt tools (body_state, body_act sleep via DSH arguments) do NOT queue wake_up
  await Promise.all(emit('tools/pre-execute', {
    name: 'body_state',
    arguments: {},
    agent: { session: { id: 'session-sleep-bound' } },
  }, async () => ({ kind: 'allow' })));
  await Promise.all(emit('tools/pre-execute', {
    name: 'body_act',
    arguments: { type: 'sleep' },
    agent: { session: { id: 'session-sleep-bound' } },
  }, async () => ({ kind: 'allow' })));
  let saved = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(saved.pendingActionIds.length, 0);

  // 4. Bound session non-exempt tool (e.g. group message tool with DSH arguments) allows tool AND queues wake_up
  const preResultsBound = await Promise.all(emit('tools/pre-execute', {
    name: 'send_group_message',
    arguments: { text: 'hello' },
    agent: { session: { id: 'session-sleep-bound' } },
  }, async () => ({ kind: 'allow' })));
  assert.deepEqual(preResultsBound, [{ kind: 'allow' }]);
  await until(() => JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds.length === 1);
  saved = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(saved.actions[saved.pendingActionIds[0]].type, 'wake_up');

  // 5. Bound session assistant/message speech event (0.2.1-rc.2 event.data.message shape) queues wake_up
  const statePathSpeech = join(dir, 'state', 'body-state-speech.json');
  writeFileSync(statePathSpeech, JSON.stringify({
    ...checkpoint({
      wallTimeMs: 0,
      simulatedSeconds: 0,
      parts: {
        sleep: { sleeping: true, sleepStage: 'light', sleepInertiaMm: 0, wakeEvent: 'none' },
      },
    }),
    boundSessionId: 'session-speech-bound',
  }));
  const agentsSpeech = new Map([['session-speech-bound', { async inject() {}, async followup() {} }]]);
  const speechHarness = makeContext(home, agentsSpeech, { withEvents: true });
  t.after(async () => {
    await speechHarness.disposeAll();
  });
  await apply(speechHarness.ctx, { manifestPath, statePath: statePathSpeech, port: 0 });
  speechHarness.emit('session/event', { id: 'session-speech-bound' }, {
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 0,
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: [{ type: 'text', text: '我在呢' }],
        source: { kind: 'model' },
      },
      stream: [],
    },
  });
  await until(() => JSON.parse(readFileSync(statePathSpeech, 'utf8')).pendingActionIds.length === 1);
  const savedSpeech = JSON.parse(readFileSync(statePathSpeech, 'utf8'));
  assert.equal(savedSpeech.actions[savedSpeech.pendingActionIds[0]].type, 'wake_up');
  assert.equal(savedSpeech.actions[savedSpeech.pendingActionIds[0]].action.reason, 'speech');
  assert.ok(listeners.get('tools/pre-execute').size >= 1);
});

test('apply records agent/inbox/inserted notification read receipt into logs/notification-history.json and cleans up listener', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-receipt-'));
  const home = join(dir, 'profile');
  const statePath = join(dir, 'state', 'body-state.json');
  const manifestPath = setupManifest(dir);

  const delivered = [];
  const agents = new Map([
    ['session-r', {
      async inject(message) {
        delivered.push({ method: 'inject', message });
      },
      async followup(message) {
        delivered.push({ method: 'followup', message });
      },
    }],
  ]);

  const notification = {
    id: 'n-receipt-1',
    mode: 'context',
    sessionId: 'session-r',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
    createdAtSimulatedSeconds: 60,
    createdAtWallTimeMs: Date.now(),
  };
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({
      wallTimeMs: Date.now(),
      notifications: [notification],
    }),
    boundSessionId: 'session-r',
  }));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx, listeners, emit, disposeAll } = makeContext(home, agents, { withEvents: true });
  let disposed = false;
  t.after(async () => {
    if (!disposed) await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, statePath, port: 0, notificationIntervalMs: 10 });
  await until(() => delivered.length === 1);

  const historyPath = join(dir, 'state', 'logs', 'notification-history.json');
  await until(() => existsSync(historyPath));
  let history = JSON.parse(readFileSync(historyPath, 'utf8'));
  assert.equal(history.entries[0].id, 'n-receipt-1');
  assert.equal(history.entries[0].status, 'acked');
  assert.equal(history.entries[0].messageId, delivered[0].message.id);
  assert.equal(history.entries[0].insertedAtWallTimeMs, null);

  emit('agent/inbox/inserted', { message: delivered[0].message });
  history = JSON.parse(readFileSync(historyPath, 'utf8'));
  assert.equal(history.entries[0].status, 'inserted');
  assert.equal(Number.isSafeInteger(history.entries[0].insertedAtWallTimeMs), true);

  assert.equal(listeners.get('agent/inbox/inserted').size, 1);
  await disposeAll();
  disposed = true;
  assert.equal(listeners.get('agent/inbox/inserted').size, 0);
});

test('apply keeps a dead-holder binding alive at boot and lets a live session take over via body_bind, while a live holder still gets 409', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-keepalive-'));
  const home = join(dir, 'profile');
  const statePath = join(dir, 'state', 'body-state.json');
  const modulesDir = join(dir, 'modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(modulesDir, 'counter.mjs'), counterSource());
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./modules/counter.mjs'],
    catchUpMinutes: 60,
    scriptTimeoutMs: 2000,
  }));

  // 存档停在 35 分钟前且仍绑定 session-gone（不在 agents 中）：启动保留绑定并补算，证明身体未休眠。
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({ wallTimeMs: Date.now() - 35 * 60_000 }),
    boundSessionId: 'session-gone',
  }));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const agents = new Map([
    ['session-new', { async inject() {}, async followup() {} }],
    ['session-new2', { async inject() {}, async followup() {} }],
  ]);
  const { ctx, registeredTools, disposeAll } = makeContext(home, agents);
  t.after(async () => {
    await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, statePath, port: 0 });

  // ① 绑定保留：session-gone 不存活也解绑存档绑定；补算照常运行（身体不休眠）。
  const savedAtBoot = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(savedAtBoot.boundSessionId, 'session-gone');
  assert.ok(savedAtBoot.snapshot.simulatedSeconds >= 2000);

  // 其他会话视角维持「已被其他会话占用」语义，不泄漏持有者 ID。
  const staleStatus = await registeredTools.get('body_bind').execute(
    { action: 'status' },
    { agent: { session: { id: 'session-new' } } },
  );
  assert.equal(staleStatus.ok, false);
  assert.equal(staleStatus.bound, false);
  assert.equal(staleStatus.boundSessionId, null);
  assert.equal(staleStatus.dormant, true);
  assert.equal(staleStatus.error, 'Body is bound to another session');
  assert.equal(JSON.stringify(staleStatus).includes('session-gone'), false);

  const staleState = await registeredTools.get('body_state').execute(
    { part: 'counter' },
    { agent: { session: { id: 'session-new' } } },
  );
  assert.equal(staleState.status, 'dormant');
  assert.deepEqual(staleState.feelings, []);

  const staleAct = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 100, energyKcal: 50, mealKind: 'liquid' },
    { agent: { session: { id: 'session-new' } }, callId: 'call-stale-act' },
  );
  assert.equal(staleAct.ok, false);
  assert.equal(staleAct.statusCode, 403);

  // ④ 死持有者接管：存活会话通过 body_bind 接管成功。
  const takeover = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'session-new' } } },
  );
  assert.equal(takeover.ok, true);
  assert.equal(takeover.bound, true);
  assert.equal(takeover.boundSessionId, 'session-new');
  assert.equal(takeover.dormant, false);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).boundSessionId, 'session-new');

  // ⑤ 活持有者：其他会话仍被 409 拒绝，回执不泄漏持有者信息。
  const hijack = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'session-new2' } } },
  );
  assert.equal(hijack.ok, false);
  assert.equal(hijack.boundSessionId, null);
  assert.equal(hijack.feeling, undefined);
  assert.equal(hijack.error.includes('session-new'), false);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).boundSessionId, 'session-new');

  await disposeAll();
});
