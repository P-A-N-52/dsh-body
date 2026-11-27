import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { checkpoint, until } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';

function makeContext(home, agentsMap, { systemPrompt, llm, agentDefaultModel, withEvents = false } = {}) {
  const registeredTools = new Map();
  const disposers = [];
  const listeners = new Map();
  const ctx = {
    get(service) {
      if (service === 'profileContext') return { home };
      if (service === 'agents') return agentsMap;
      if (service === 'systemPrompt' && systemPrompt) return systemPrompt;
      if (service === 'llm' && llm) return llm;
      if (service === 'agentDefaultModel' && agentDefaultModel) return agentDefaultModel;
      throw new Error(`Unknown service: ${service}`);
    },
    effect(callback) {
      const disposer = callback();
      if (typeof disposer === 'function') {
        disposers.push(disposer);
      }
      return disposer;
    },
    tools: {
      register(definition) {
        registeredTools.set(definition.name, definition);
        return () => registeredTools.delete(definition.name);
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
        sections.set(entry.name, entry);
        return () => sections.delete(entry.name);
      },
      context(entry) {
        contexts.set(entry.name, entry);
        return () => contexts.delete(entry.name);
      },
    },
  };
}

function setupSleepAndCounterManifest(dir, { hangModule = false } = {}) {
  const modulesDir = join(dir, 'modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(modulesDir, 'counter.mjs'), counterSource({ actionTypes: ['eat', 'drink'] }));
  writeFileSync(join(modulesDir, 'sleep-stub.mjs'), `
    export const id = 'sleep';
    export const actionTypes = ['sleep', 'wake_up', 'sex'];
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
  const scripts = ['./modules/counter.mjs', './modules/sleep-stub.mjs'];
  if (hangModule) {
    writeFileSync(join(modulesDir, 'hang.mjs'), 'await new Promise(() => {});\n');
    scripts.push('./modules/hang.mjs');
  }
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts,
    catchUpMinutes: 0,
    scriptTimeoutMs: 2000,
  }));
  return manifestPath;
}

function makeToolCallStream(actions, callId = 'tc-1') {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield {
      type: 'tool-call-delta',
      index: 0,
      id: callId,
      name: 'submit_translated_actions',
      argumentsDelta: JSON.stringify({ actions }),
    };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }());
}

test('apply mounts peer bodies from bodies.json with independent routing, notifications, translator logs, sleep wake, and disposal', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-multibody-'));
  const home = join(dir, 'profile');
  const dshBodyDir = join(home, 'dsh-body');
  const alphaDir = join(dshBodyDir, 'bodies', 'alpha');
  const betaDir = join(dshBodyDir, 'bodies', 'beta');
  mkdirSync(alphaDir, { recursive: true });
  mkdirSync(betaDir, { recursive: true });

  const manifestPath = setupSleepAndCounterManifest(dir);
  const alphaStatePath = join(alphaDir, 'body-state.json');
  const betaStatePath = join(betaDir, 'body-state.json');

  writeFileSync(alphaStatePath, JSON.stringify({
    ...checkpoint({
      wallTimeMs: Date.now(),
      parts: { sleep: { sleeping: true, sleepStage: 'light', sleepInertiaMm: 0, wakeEvent: 'none' } },
      notifications: [{
        id: 'n-alpha',
        mode: 'context',
        sessionId: 'session-alpha',
        text: '身体感受：有些口渴。',
        createdAtSimulatedSeconds: 60,
        createdAtWallTimeMs: Date.now(),
      }],
    }),
    boundSessionId: 'session-alpha',
  }));
  writeFileSync(betaStatePath, JSON.stringify({
    ...checkpoint({
      wallTimeMs: Date.now(),
      parts: { sleep: { sleeping: true, sleepStage: 'light', sleepInertiaMm: 0, wakeEvent: 'none' } },
      notifications: [{
        id: 'n-beta',
        mode: 'wake',
        sessionId: 'qq-group-232970112',
        text: '身体感受：胃里空空的。',
        createdAtSimulatedSeconds: 60,
        createdAtWallTimeMs: Date.now(),
      }],
    }),
    boundSessionId: 'qq-group-232970112',
  }));

  writeFileSync(join(dshBodyDir, 'bodies.json'), JSON.stringify({
    default: 'alpha',
    bodies: {
      alpha: { port: 0, statePath: alphaStatePath, nsfw: false },
      beta: { port: 0, statePath: betaStatePath, nsfw: true },
    },
    sessions: {
      'qq-group-232970112': 'beta',
      'group-pref-*': 'beta',
    },
  }));

  const delivered = [];
  const agents = new Map([
    ['session-alpha', {
      async inject(message) { delivered.push({ sessionId: 'session-alpha', method: 'inject', message }); },
      async followup(message) { delivered.push({ sessionId: 'session-alpha', method: 'followup', message }); },
    }],
    ['qq-group-232970112', {
      async inject(message) { delivered.push({ sessionId: 'qq-group-232970112', method: 'inject', message }); },
      async followup(message) { delivered.push({ sessionId: 'qq-group-232970112', method: 'followup', message }); },
    }],
  ]);

  let streamSeq = 0;
  const llm = {
    stream() {
      streamSeq += 1;
      return makeToolCallStream(
        [{ type: 'drink', volumeMl: streamSeq === 1 ? 150 : 250 }],
        `tc-${streamSeq}`,
      );
    },
  };
  const agentDefaultModel = {
    currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  };

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const promptMock = makeSystemPromptMock();
  const { ctx, registeredTools, emit, disposeAll } = makeContext(home, agents, {
    systemPrompt: promptMock.service,
    llm,
    agentDefaultModel,
    withEvents: true,
  });
  let disposed = false;
  t.after(async () => {
    if (!disposed) await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  // Pass nsfw: false at plugin level; beta overrides nsfw: true in bodies.json, alpha keeps false.
  await apply(ctx, { manifestPath, nsfw: false });

  // Both bodies delivered their own notifications via independent pumps
  assert.equal(delivered.length, 2);
  const alphaMsg = delivered.find((item) => item.sessionId === 'session-alpha');
  const betaMsg = delivered.find((item) => item.sessionId === 'qq-group-232970112');
  assert.equal(alphaMsg?.method, 'inject');
  assert.equal(betaMsg?.method, 'followup');

  // agent/inbox/inserted writes receipt only to the matching body's logs/
  emit('agent/inbox/inserted', { message: betaMsg.message });
  const betaHistory = JSON.parse(readFileSync(join(betaDir, 'logs', 'notification-history.json'), 'utf8'));
  const alphaHistory = JSON.parse(readFileSync(join(alphaDir, 'logs', 'notification-history.json'), 'utf8'));
  assert.equal(betaHistory.entries[0].status, 'inserted');
  assert.equal(alphaHistory.entries[0].status, 'acked');

  // Per-body nsfw gating: alpha rejects sex (400), beta allows sex (202)
  const alphaSex = await registeredTools.get('body_act').execute(
    { type: 'sex', intensity: 0.5, durationMin: 10 },
    { agent: { session: { id: 'session-alpha' } }, callId: 'sex-alpha' },
  );
  assert.equal(alphaSex.ok, false);
  assert.equal(alphaSex.statusCode, 400);

  const betaSex = await registeredTools.get('body_act').execute(
    { type: 'sex', intensity: 0.5, durationMin: 10 },
    { agent: { session: { id: 'qq-group-232970112' } }, callId: 'sex-beta' },
  );
  assert.equal(betaSex.ok, true);
  assert.equal(betaSex.statusCode, 202);

  // Per-body translator history isolation
  const alphaDrink = await registeredTools.get('body_act').execute(
    { type: 'drink', description: '喝了一口水' },
    { agent: { session: { id: 'session-alpha' } }, callId: 'drink-alpha', signal: new AbortController().signal },
  );
  const betaDrink = await registeredTools.get('body_act').execute(
    { type: 'drink', description: '喝了一杯温水' },
    { agent: { session: { id: 'qq-group-232970112' } }, callId: 'drink-beta', signal: new AbortController().signal },
  );
  assert.equal(alphaDrink.ok, true);
  assert.equal(betaDrink.ok, true);
  const alphaTranslations = JSON.parse(readFileSync(join(alphaDir, 'logs', 'action-translations.json'), 'utf8'));
  const betaTranslations = JSON.parse(readFileSync(join(betaDir, 'logs', 'action-translations.json'), 'utf8'));
  assert.deepEqual(alphaTranslations.byType.drink.map((e) => e.description), ['喝了一口水']);
  assert.deepEqual(betaTranslations.byType.drink.map((e) => e.description), ['喝了一杯温水']);

  // Global cognition must not leak beta's nsfw:true; only beta's bound feelingsContext includes NSFW notice.
  const cognitionText = promptMock.sections.get('dsh-body:cognition').text;
  assert.equal(/\bsex\b|\borgasm\b|express_milk|breastfeed/.test(cognitionText), false);

  // Both sleeping bodies inject sleep rules for their own bound session and wake independently
  const feelingsContext = promptMock.contexts.get('dsh-body:feelings').text;
  const alphaFeelings = feelingsContext({ agent: { session: { id: 'session-alpha' } } });
  const betaFeelings = feelingsContext({ agent: { session: { id: 'qq-group-232970112' } } });
  assert.ok(alphaFeelings.includes('[睡眠状态行为规则]'));
  assert.equal(alphaFeelings.includes('亲密互动'), false);
  assert.ok(betaFeelings.includes('[睡眠状态行为规则]'));
  assert.ok(betaFeelings.includes('亲密互动'));
  assert.equal(feelingsContext({ agent: { session: { id: 'unbound-session' } } }), '');

  // Unmapped sessions do NOT fall back to default body (alpha), and missing exec does NOT leak stickySessionId.
  const unmappedState = await registeredTools.get('body_state').execute(
    {},
    { agent: { session: { id: 'unbound-session' } } },
  );
  assert.equal(unmappedState.status, 'dormant');
  assert.deepEqual(unmappedState.feelings, []);
  const unmappedBind = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'unbound-session' } } },
  );
  assert.equal(unmappedBind.ok, false);
  assert.match(unmappedBind.error, /No body is mapped/);
  const unmappedAct = await registeredTools.get('body_act').execute(
    { type: 'drink', volumeMl: 100 },
    { agent: { session: { id: 'unbound-session' } }, callId: 'unmapped-act' },
  );
  assert.equal(unmappedAct.ok, false);
  assert.equal(unmappedAct.statusCode, 403);
  const missingExecState = await registeredTools.get('body_state').execute({});
  assert.equal(missingExecState.status, 'dormant');
  assert.deepEqual(missingExecState.feelings, []);

  await Promise.all([
    ...emit('tools/pre-execute', {
      name: 'send_message',
      arguments: { text: 'alpha' },
      agent: { session: { id: 'session-alpha' } },
    }, async () => ({ kind: 'allow' })),
    ...emit('tools/pre-execute', {
      name: 'send_group_message',
      arguments: { text: 'beta' },
      agent: { session: { id: 'qq-group-232970112' } },
    }, async () => ({ kind: 'allow' })),
  ]);
  await until(() => {
    const a = JSON.parse(readFileSync(alphaStatePath, 'utf8'));
    const b = JSON.parse(readFileSync(betaStatePath, 'utf8'));
    return Object.values(a.actions).some((item) => item.type === 'wake_up')
      && Object.values(b.actions).some((item) => item.type === 'wake_up');
  });

  // Unbinding/disposing beta's session leaves alpha bound, and wildcard prefix routes to beta
  emit('agent/disposed', { agent: { session: { id: 'qq-group-232970112' } } });
  await until(() => JSON.parse(readFileSync(betaStatePath, 'utf8')).boundSessionId === null);
  assert.equal(JSON.parse(readFileSync(alphaStatePath, 'utf8')).boundSessionId, 'session-alpha');

  const prefixBind = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'group-pref-999' } } },
  );
  assert.equal(prefixBind.ok, true);
  assert.equal(prefixBind.boundSessionId, 'group-pref-999');
  assert.equal(JSON.parse(readFileSync(betaStatePath, 'utf8')).boundSessionId, 'group-pref-999');
  assert.equal(JSON.parse(readFileSync(alphaStatePath, 'utf8')).boundSessionId, 'session-alpha');

  // Another session matching the same wildcard prefix cannot hijack, read, or unbind beta while occupied.
  const secondPrefixBind = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'group-pref-888' } } },
  );
  assert.equal(secondPrefixBind.ok, false);
  assert.equal(secondPrefixBind.boundSessionId, null);
  assert.equal(secondPrefixBind.feeling, undefined);
  assert.equal(JSON.parse(readFileSync(betaStatePath, 'utf8')).boundSessionId, 'group-pref-999');

  const secondPrefixState = await registeredTools.get('body_state').execute(
    {},
    { agent: { session: { id: 'group-pref-888' } } },
  );
  assert.equal(secondPrefixState.status, 'dormant');
  assert.deepEqual(secondPrefixState.feelings, []);

  await disposeAll();
  disposed = true;
});

test('malformed bodies.json rejects startup instead of collapsing into single body, and boot does not clone manifest body-state.json', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-multibody-strict-'));
  const home = join(dir, 'profile');
  const dshBodyDir = join(home, 'dsh-body');
  mkdirSync(dshBodyDir, { recursive: true });
  const manifestPath = setupSleepAndCounterManifest(dir);

  // Place a legacy body-state.json alongside the manifest to verify DSH plugin never clones it.
  writeFileSync(join(dir, 'body-state.json'), JSON.stringify({
    ...checkpoint({
      wallTimeMs: Date.now(),
      simulatedSeconds: 3600,
      notifications: [{ id: 'n-legacy', mode: 'wake', sessionId: 'legacy-session', text: '旧通知' }],
    }),
    boundSessionId: 'legacy-session',
  }));

  writeFileSync(join(dshBodyDir, 'bodies.json'), '{not-valid-json');
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx: badCtx, disposeAll: disposeBad } = makeContext(home, new Map());
  t.after(async () => {
    await disposeBad();
    rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(() => apply(badCtx, { manifestPath, port: 0 }), /Invalid bodies\.json/);

  const betaStatePath = join(dshBodyDir, 'bodies', 'beta', 'body-state.json');
  writeFileSync(join(dshBodyDir, 'bodies.json'), JSON.stringify({
    bodies: {
      alpha: { port: 0 },
      beta: { port: 0 },
    },
    sessions: {
      's-alpha': 'alpha',
      's-beta': 'beta',
    },
  }));
  const { ctx: goodCtx, disposeAll: disposeGood } = makeContext(home, new Map());
  t.after(async () => {
    await disposeGood();
  });
  await apply(goodCtx, { manifestPath, port: 0 });
  const betaSaved = JSON.parse(readFileSync(betaStatePath, 'utf8'));
  assert.equal(betaSaved.boundSessionId ?? null, null);
  assert.equal(betaSaved.snapshot.simulatedSeconds, 0);
  assert.deepEqual(betaSaved.notifications, []);
});

test('boot timeout on one body does not block healthy peer body and explicitly mapped session never hijacks another body', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-multibody-timeout-'));
  const home = join(dir, 'profile');
  const dshBodyDir = join(home, 'dsh-body');
  const healthyDir = join(dir, 'healthy');
  const hangingDir = join(dir, 'hanging');
  mkdirSync(dshBodyDir, { recursive: true });

  const healthyManifest = setupSleepAndCounterManifest(healthyDir, { hangModule: false });
  const hangingManifest = setupSleepAndCounterManifest(hangingDir, { hangModule: true });

  const alphaStatePath = join(dshBodyDir, 'body-state.json');
  const betaStatePath = join(dshBodyDir, 'bodies', 'hanging-body', 'body-state.json');

  writeFileSync(join(dshBodyDir, 'bodies.json'), JSON.stringify({
    default: 'hanging-body',
    bodies: {
      'hanging-body': { port: 0, statePath: betaStatePath, manifestPath: hangingManifest },
      'healthy-body': { port: 0, statePath: alphaStatePath, manifestPath: healthyManifest },
    },
    sessions: {
      'qq-healthy': 'healthy-body',
      'qq-hanging': 'hanging-body',
    },
  }));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx, registeredTools, disposeAll } = makeContext(home, new Map());
  t.after(async () => {
    await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  // Even when the `default` body times out on boot, healthy-body still comes up cleanly.
  await apply(ctx, { bootTimeoutMs: 250 });

  const healthyBind = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'qq-healthy' } } },
  );
  assert.equal(healthyBind.ok, true);
  assert.equal(healthyBind.boundSessionId, 'qq-healthy');

  // Session mapped to failed/timed-out body gets unavailable error and does NOT touch healthy-body.
  const hangingBind = await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'qq-hanging' } } },
  );
  assert.equal(hangingBind.ok, false);
  assert.match(hangingBind.error, /unavailable/i);

  const hangingAct = await registeredTools.get('body_act').execute(
    { type: 'drink', volumeMl: 100 },
    { agent: { session: { id: 'qq-hanging' } }, callId: 'call-unavailable' },
  );
  assert.equal(hangingAct.ok, false);
  assert.equal(hangingAct.statusCode, 503);

  const hangingState = await registeredTools.get('body_state').execute(
    {},
    { agent: { session: { id: 'qq-hanging' } } },
  );
  assert.equal(hangingState.status, 'paused');
  assert.equal(/\d/.test(JSON.stringify(hangingState)), false);

  // Healthy body remains bound to qq-healthy
  const healthyStatus = await registeredTools.get('body_bind').execute(
    { action: 'status' },
    { agent: { session: { id: 'qq-healthy' } } },
  );
  assert.equal(healthyStatus.boundSessionId, 'qq-healthy');
});

test('apply rejects cleanly when every configured body fails to boot', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-multibody-allfail-'));
  const home = join(dir, 'profile');
  const dshBodyDir = join(home, 'dsh-body');
  mkdirSync(dshBodyDir, { recursive: true });
  const hangDir = join(dir, 'hang');
  const hangingManifest = setupSleepAndCounterManifest(hangDir, { hangModule: true });

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx, disposeAll } = makeContext(home, new Map());
  t.after(async () => {
    await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    () => apply(ctx, { manifestPath: hangingManifest, port: 0, bootTimeoutMs: 200 }),
    /timed out/i,
  );
});
