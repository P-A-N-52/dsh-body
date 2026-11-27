import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_HISTORY_PER_TYPE,
  TRANSLATOR_TOOL_NAME,
  createBodyTranslationStore,
  resolveTranslationHistoryPath,
  scoreDescriptionSimilarity,
  selectReferenceTranslations,
} from '../action-translator.js';
import { startGateway } from '../gateway.js';
import { apply } from '../index.js';
import { checkpoint } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';
import { registerBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function toolCallStream(argsJson, { callId = 'tc-1', toolName = TRANSLATOR_TOOL_NAME, finishReason = { kind: 'stop' } } = {}) {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    const text = typeof argsJson === 'string' ? argsJson : JSON.stringify(argsJson);
    const half = Math.ceil(text.length / 2);
    yield { type: 'tool-call-delta', index: 0, id: callId, name: toolName, argumentsDelta: text.slice(0, half) };
    yield { type: 'tool-call-delta', index: 0, id: callId, name: toolName, argumentsDelta: text.slice(half) };
    yield { type: 'finish', reason: finishReason };
  })();
}

function textOnlyStream(text = '大约 25 mL') {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'finish', reason: { kind: 'stop' } };
  })();
}

function makeAgentExec({
  sessionId = 'session-translate',
  callId = 'call-1',
  headerRoute = { provider: 'deepseek', model: 'deepseek-chat' },
  signal,
} = {}) {
  return {
    agent: {
      session: {
        id: sessionId,
        requestHeader: () => (headerRoute ? { config: headerRoute } : undefined),
      },
      options: headerRoute ?? {},
    },
    callId,
    signal: signal ?? new AbortController().signal,
  };
}

function makeMockCtx({ llm, agentDefaultModel, agentsMap, home, extraServices = {} } = {}) {
  const registeredTools = new Map();
  const disposers = [];
  const ctx = {
    get(service) {
      if (service === 'llm' && llm) return llm;
      if (service === 'agentDefaultModel' && agentDefaultModel) return agentDefaultModel;
      if (service === 'agents' && agentsMap) return agentsMap;
      if (service === 'profileContext' && home) return { home };
      if (Object.hasOwn(extraServices, service)) return extraServices[service];
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
  return {
    ctx,
    registeredTools,
    async disposeAll() {
      for (const disposer of [...disposers].reverse()) {
        await disposer?.();
      }
    },
  };
}

async function startBodyEnv(t, {
  manifestPath = join(root, 'body-modules.json'),
  llm = null,
  agentDefaultModel = null,
  requireBinding = false,
  defaultNsfw = false,
  translatorConfig = {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-translator-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0 })));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
    requireBinding,
    defaultNsfw,
  });
  await gateway.ready;

  const { ctx, registeredTools, disposeAll } = makeMockCtx({ llm, agentDefaultModel });
  const tools = registerBodyTools(ctx, gateway, { translator: translatorConfig });
  t.after(async () => {
    await disposeAll();
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  return { dir, statePath, gateway, tools, registeredTools };
}

test('translation history store isolates per-body directory, stays separate from body-state.json, caps at 100 per type, and matches similar Chinese descriptions', async (t) => {
  const dirA = mkdtempSync(join(tmpdir(), 'dsh-hist-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'dsh-hist-b-'));
  t.after(() => {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  const historyPathA = resolveTranslationHistoryPath({ getStatePath: () => join(dirA, 'body-state.json') });
  const historyPathB = resolveTranslationHistoryPath({ getStatePath: () => join(dirB, 'body-state.json') });
  assert.equal(historyPathA, join(dirA, 'logs', 'action-translations.json'));
  assert.equal(historyPathB, join(dirB, 'logs', 'action-translations.json'));

  const storeA = createBodyTranslationStore(historyPathA);
  const storeB = createBodyTranslationStore(historyPathB);

  for (let i = 0; i < 105; i += 1) {
    await storeA.record({
      type: 'eat',
      description: i === 50 ? '吃了一小口米饭配红烧肉' : `第${i}顿轻食样本`,
      actions: [{ type: 'eat', volumeMl: 30 + i, energyKcal: 40 + i, mealKind: 'solid' }],
      simulatedSeconds: i * 60,
      wallTimeMs: 1000 + i,
    });
  }
  await storeA.record({
    type: 'drink',
    description: '喝了两口冰可乐',
    actions: [{ type: 'drink', volumeMl: 45, energyKcal: 19, carbohydrateG: 4.7 }],
    simulatedSeconds: 7000,
    wallTimeMs: 9000,
  });
  await storeB.record({
    type: 'eat',
    description: '另一具身体的米饭记录',
    actions: [{ type: 'eat', volumeMl: 500, energyKcal: 800, mealKind: 'solid' }],
    simulatedSeconds: 60,
    wallTimeMs: 2000,
  });

  const persistedA = JSON.parse(readFileSync(historyPathA, 'utf8'));
  const persistedB = JSON.parse(readFileSync(historyPathB, 'utf8'));
  assert.equal(persistedA.byType.eat.length, DEFAULT_MAX_HISTORY_PER_TYPE);
  assert.equal(persistedA.byType.eat[0].description, '第5顿轻食样本');
  assert.equal(persistedA.byType.drink.length, 1);
  assert.equal(persistedB.byType.eat.length, 1);

  assert.ok(
    scoreDescriptionSimilarity('又吃了一口米饭配红烧肉', '吃了一小口米饭配红烧肉')
      > scoreDescriptionSimilarity('又吃了一口米饭配红烧肉', '喝了两口冰可乐'),
  );

  const refs = await storeA.getReferences('eat', '又吃了一口米饭配红烧肉');
  assert.equal(refs.similar[0].description, '吃了一小口米饭配红烧肉');
  assert.ok(refs.recent.length <= 2);
  assert.equal(refs.recent.some((item) => item.type !== 'eat'), false);
  assert.equal(refs.similar.some((item) => item.description.includes('另一具身体')), false);

  const manualSelection = selectReferenceTranslations(persistedA, 'eat', '又吃了一口米饭配红烧肉');
  assert.equal(manualSelection.similar[0].description, '吃了一小口米饭配红烧肉');
});

test('body_act translates qualitative eat description via ctx.llm.stream with single tool schema, feeds similar history on next call, and separates history from body-state.json', async (t) => {
  const calls = [];
  const llm = {
    async resolveModelInfo(provider, model) {
      assert.equal(provider, 'deepseek');
      assert.equal(model, 'deepseek-chat');
      return { supportedReasoningEfforts: ['off', 'high'] };
    },
    stream(options) {
      calls.push(options);
      if (calls.length === 1) {
        return toolCallStream({
          actions: [{ type: 'eat', volumeMl: 25, energyKcal: 32, carbohydrateG: 7, mealKind: 'solid', durationMin: 0.5 }],
        });
      }
      return toolCallStream({
        actions: [{ type: 'eat', volumeMl: 28, energyKcal: 36, carbohydrateG: 8, mealKind: 'solid', durationMin: 0.5 }],
      }, { callId: 'tc-2' });
    },
  };

  const { dir, statePath, gateway, tools } = await startBodyEnv(t, { llm });

  const first = await tools.body_act.execute(
    { type: 'eat', description: '吃了一口白米饭' },
    makeAgentExec({ sessionId: 'session-eat', callId: 'bite-1' }),
  );
  assert.equal(first.ok, true);
  assert.equal(first.statusCode, 202);
  assert.equal(first.receipt.type, 'eat');
  assert.equal(first.receipt.status, 'queued');
  assert.equal(/\d/.test(JSON.stringify({ id: first.receipt.id, type: first.receipt.type })), true);
  assert.equal(Object.hasOwn(first.receipt, 'volumeMl'), false);
  assert.equal(Object.hasOwn(first.receipt, 'energyKcal'), false);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, undefined);
  assert.equal(calls[0].reasoningEffort, 'off');
  assert.deepEqual(calls[0].tools.map((tool) => tool.name), [TRANSLATOR_TOOL_NAME]);
  assert.equal(calls[0].tools[0].parameters.properties.actions.items.properties.type.enum.includes('sex'), false);
  assert.match(calls[0].messages[0].content[0].text, /吃了一口白米饭/);

  const checkpointAfterQueue = JSON.parse(readFileSync(statePath, 'utf8'));
  const queuedRecord = checkpointAfterQueue.actions[first.receipt.id];
  assert.equal(queuedRecord.action.volumeMl, 25);
  assert.equal(queuedRecord.action.energyKcal, 32);
  assert.equal(queuedRecord.action.mealKind, 'solid');
  assert.equal(Object.hasOwn(queuedRecord.action, 'description'), false);
  assert.equal(Object.hasOwn(checkpointAfterQueue, 'translationHistory'), false);

  const historyPath = join(dir, 'logs', 'action-translations.json');
  assert.equal(existsSync(historyPath), true);

  await gateway.tick();
  assert.ok(gateway.getState().parts.stomach.volumeMl > 0);
  assert.ok(gateway.getState().parts.stomach.energyKcal > 0);

  const second = await tools.body_act.execute(
    { type: 'eat', description: '又吃了一大口白米饭' },
    makeAgentExec({ sessionId: 'session-eat-next', callId: 'bite-2' }),
  );
  assert.equal(second.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[0].content[0].text, /吃了一口白米饭/);
  assert.match(calls[1].messages[0].content[0].text, /"energyKcal":32/);
});

test('body_act supports compound eat+drink translation splits, explicit numeric overrides, zero-arg passthrough, and omits unsupported reasoningEffort', async (t) => {
  const calls = [];
  const llm = {
    async resolveModelInfo() {
      return { supportedReasoningEfforts: ['medium', 'high'] };
    },
    stream(options) {
      calls.push(options);
      if (calls.length === 1) {
        return toolCallStream({
          actions: [
            { type: 'eat', volumeMl: 350, energyKcal: 420, carbohydrateG: 55, mealKind: 'mixed', durationMin: 12 },
            { type: 'drink', volumeMl: 60, energyKcal: 25, carbohydrateG: 6, durationMin: 1 },
          ],
        });
      }
      return toolCallStream({
        actions: [{ type: 'exercise', intensity: 0.55, durationMin: 5 }],
      });
    },
  };

  const { gateway, tools } = await startBodyEnv(t, { llm });

  const compound = await tools.body_act.execute(
    { type: 'eat', description: '吃了半碗牛肉面，还喝了两口冰可乐' },
    makeAgentExec({ callId: 'meal-combo' }),
  );
  assert.equal(compound.ok, true);
  assert.equal(compound.statusCode, 202);
  assert.equal(calls[0].reasoningEffort, undefined);
  assert.equal(compound.receipt.receipts.length, 2);
  assert.equal(compound.receipt.receipts[0].type, 'eat');
  assert.equal(compound.receipt.receipts[1].type, 'drink');

  await gateway.tick();
  const afterCombo = gateway.getState();
  assert.ok(afterCombo.parts.stomach.waterVolumeMl > 0);
  assert.ok(afterCombo.parts.stomach.energyKcal > 50);
  assert.equal(afterCombo.parts.stomach.mealQueue.length, 1);

  const runWithOverride = await tools.body_act.execute(
    { type: 'exercise', description: '轻松慢跑了一会', durationMin: 20 },
    makeAgentExec({ callId: 'run-override' }),
  );
  assert.equal(runWithOverride.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[0].content[0].text, /"durationMin":20/);

  await gateway.tick();
  assert.equal(gateway.getState().parts.physicalActivity.remainingExerciseMin, 20);
  assert.equal(gateway.getState().parts.physicalActivity.intensity, 0.55);

  await tools.body_act.execute({ type: 'sleep' }, makeAgentExec({ callId: 'sleep-zero' }));
  await tools.body_act.execute({ type: 'drink', volumeMl: 150 }, makeAgentExec({ callId: 'direct-water' }));
  assert.equal(calls.length, 2);
});

test('body_act retries once on invalid LLM translator output, refuses without inventing values on persistent errors, and respects dormancy, NSFW, and idempotency', async (t) => {
  let attempt = 0;
  let mode = 'retry-then-ok';
  const llm = {
    stream() {
      attempt += 1;
      if (mode === 'retry-then-ok') {
        if (attempt === 1) return textOnlyStream('大概三百毫升吧');
        return toolCallStream({
          actions: [{ type: 'drink', volumeMl: 300, energyKcal: 0 }],
        });
      }
      if (mode === 'always-invalid') {
        return toolCallStream({
          actions: [{ type: 'eat', volumeMl: -5, energyKcal: 100, mealKind: 'solid' }],
        });
      }
      if (mode === 'nsfw-leak') {
        return toolCallStream({
          actions: [{ type: 'sex', intensity: 0.6, durationMin: 15 }],
        });
      }
      return (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 120));
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };

  const { statePath, gateway, tools } = await startBodyEnv(t, {
    llm,
    requireBinding: true,
    defaultNsfw: false,
    translatorConfig: { timeoutMs: 40, maxAttempts: 2 },
  });

  const dormantBeforeBind = await tools.body_act.execute(
    { type: 'eat', description: '吃一口面包' },
    makeAgentExec({ sessionId: 's1', callId: 'dormant-eat' }),
  );
  assert.equal(dormantBeforeBind.ok, false);
  assert.equal(dormantBeforeBind.statusCode, 409);
  assert.equal(dormantBeforeBind.receipt.dormant, true);
  assert.equal(attempt, 0);

  await gateway.bindSession('s1');

  const nsfwBlocked = await tools.body_act.execute(
    { type: 'sex', description: '亲密互动' },
    makeAgentExec({ sessionId: 's1', callId: 'sex-blocked' }),
  );
  assert.equal(nsfwBlocked.ok, false);
  assert.equal(nsfwBlocked.statusCode, 400);
  assert.equal(attempt, 0);

  const recovered = await tools.body_act.execute(
    { type: 'drink', description: '喝了一大杯水' },
    makeAgentExec({ sessionId: 's1', callId: 'retry-drink' }),
  );
  assert.equal(recovered.ok, true);
  assert.equal(recovered.statusCode, 202);
  assert.equal(attempt, 2);

  const idempotent = await tools.body_act.execute(
    { type: 'drink', description: '喝了一大杯水' },
    makeAgentExec({ sessionId: 's1', callId: 'retry-drink' }),
  );
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.statusCode, 200);
  assert.equal(idempotent.receipt.id, recovered.receipt.id);
  assert.equal(attempt, 2);

  const conflict = await tools.body_act.execute(
    { type: 'drink', description: '喝了两瓶水' },
    makeAgentExec({ sessionId: 's1', callId: 'retry-drink' }),
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.statusCode, 409);
  assert.equal(attempt, 2);

  mode = 'always-invalid';
  attempt = 0;
  const failed = await tools.body_act.execute(
    { type: 'eat', description: '吃了一块蛋糕' },
    makeAgentExec({ sessionId: 's1', callId: 'bad-eat' }),
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.statusCode, 502);
  assert.match(failed.receipt.error, /volumeMl/);
  assert.equal(attempt, 2);

  mode = 'nsfw-leak';
  const nsfwLeakRejected = await tools.body_act.execute(
    { type: 'eat', description: '奇怪输入' },
    makeAgentExec({ sessionId: 's1', callId: 'leak-eat' }),
  );
  assert.equal(nsfwLeakRejected.ok, false);
  assert.equal(nsfwLeakRejected.statusCode, 502);

  mode = 'timeout';
  const timedOut = await tools.body_act.execute(
    { type: 'eat', description: '吃苹果' },
    makeAgentExec({ sessionId: 's1', callId: 'timeout-eat' }),
  );
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.statusCode, 504);

  const checkpointAfterFailures = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(checkpointAfterFailures.pendingActionIds.length, 1);
});

test('body_act fails cleanly with 503 when ctx.llm or model route is unavailable without fabricating values', async (t) => {
  const { statePath, tools: noLlmTools } = await startBodyEnv(t, { llm: null });
  const missingLlm = await noLlmTools.body_act.execute(
    { type: 'eat', description: '吃了一口面包' },
    makeAgentExec({ callId: 'no-llm' }),
  );
  assert.equal(missingLlm.ok, false);
  assert.equal(missingLlm.statusCode, 503);
  assert.match(missingLlm.receipt.error, /ctx\.llm/);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);

  const { tools: noRouteTools } = await startBodyEnv(t, {
    llm: {
      stream() {
        throw new Error('should not stream without route');
      },
    },
  });
  const missingRoute = await noRouteTools.body_act.execute(
    { type: 'drink', description: '喝了一口茶' },
    { agent: { session: { id: 'no-route-session' } }, callId: 'no-route', signal: new AbortController().signal },
  );
  assert.equal(missingRoute.ok, false);
  assert.equal(missingRoute.statusCode, 503);
  assert.match(missingRoute.receipt.error, /route/i);
});

test('apply(ctx) wires translator using agentDefaultModel fallback and stores history in body home logs/', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-translator-'));
  const home = join(dir, 'dsh-home');
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

  const agents = new Map([
    ['live-session', { async inject() {}, async followup() {} }],
  ]);
  const seenStreams = [];
  const llm = {
    stream(options) {
      seenStreams.push(options);
      return toolCallStream({
        actions: [{ type: 'eat', volumeMl: 180, energyKcal: 210, carbohydrateG: 42, mealKind: 'solid' }],
      });
    },
  };
  const agentDefaultModel = {
    currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
  };

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx, registeredTools, disposeAll } = makeMockCtx({
    llm,
    agentDefaultModel,
    agentsMap: agents,
    home,
  });
  t.after(async () => {
    await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, port: 0 });
  await registeredTools.get('body_bind').execute(
    { action: 'bind' },
    { agent: { session: { id: 'live-session' } } },
  );

  const actResult = await registeredTools.get('body_act').execute(
    { type: 'eat', description: '吃了一碗白米饭' },
    { agent: { session: { id: 'live-session' } }, callId: 'meal-1', signal: new AbortController().signal },
  );
  assert.equal(actResult.ok, true);
  assert.equal(actResult.statusCode, 202);
  assert.equal(seenStreams.length, 1);
  assert.equal(seenStreams[0].provider, 'deepseek');
  assert.equal(seenStreams[0].model, 'deepseek-chat');

  const logPath = join(home, 'dsh-body', 'logs', 'action-translations.json');
  assert.equal(existsSync(logPath), true);
  const logDoc = JSON.parse(readFileSync(logPath, 'utf8'));
  assert.equal(logDoc.byType.eat.length, 1);
  assert.equal(logDoc.byType.eat[0].description, '吃了一碗白米饭');
});

test('body_act returns digit-free tasteFeedback on intake without storing it, drops digit-bearing tasteFeedback, and translates lactation actions when nsfw is enabled', async (t) => {
  let callIndex = 0;
  const calls = [];
  const llm = {
    stream(options) {
      calls.push(options);
      callIndex += 1;
      if (callIndex === 1) {
        return toolCallStream({
          actions: [{ type: 'drink', volumeMl: 220, energyKcal: 85, carbohydrateG: 20 }],
          tasteFeedback: '冰凉清爽，气泡感很足，甜中带一点微酸。',
        }, { callId: 'tc-taste-1' });
      }
      if (callIndex === 2) {
        return toolCallStream({
          actions: [{ type: 'eat', volumeMl: 180, energyKcal: 260, mealKind: 'solid' }],
          tasteFeedback: '味道咸香，约3分熟，带一点胡椒辣味。',
        }, { callId: 'tc-taste-digits' });
      }
      if (callIndex === 3) {
        return toolCallStream({
          actions: [{ type: 'exercise', intensity: 0.4, durationMin: 15 }],
          tasteFeedback: '不应该出现在运动上',
        }, { callId: 'tc-non-intake' });
      }
      return toolCallStream({
        actions: [{ type: 'breastfeed', durationMin: 10, bilateral: true }],
        tasteFeedback: '不应该出现在哺乳上',
      }, { callId: 'tc-breastfeed' });
    },
  };

  const { dir, statePath, tools } = await startBodyEnv(t, {
    manifestPath: join(root, 'body-modules.female.json'),
    llm,
    defaultNsfw: true,
  });

  const drinkRes = await tools.body_act.execute(
    { type: 'drink', description: '喝了大半杯冰镇柠檬汽水' },
    makeAgentExec({ sessionId: 'taste-sess', callId: 'drink-taste' }),
  );
  assert.equal(drinkRes.ok, true);
  assert.equal(drinkRes.tasteFeedback, '冰凉清爽，气泡感很足，甜中带一点微酸。');
  assert.equal(Object.hasOwn(drinkRes.receipt, 'tasteFeedback'), false);

  const replayDrink = await tools.body_act.execute(
    { type: 'drink', description: '喝了大半杯冰镇柠檬汽水' },
    makeAgentExec({ sessionId: 'taste-sess', callId: 'drink-taste' }),
  );
  assert.equal(replayDrink.tasteFeedback, '冰凉清爽，气泡感很足，甜中带一点微酸。');

  const checkpointAfterDrink = JSON.parse(readFileSync(statePath, 'utf8'));
  const queuedDrink = checkpointAfterDrink.actions[drinkRes.receipt.id];
  assert.equal(Object.hasOwn(queuedDrink.action, 'tasteFeedback'), false);

  const historyDoc = JSON.parse(readFileSync(join(dir, 'logs', 'action-translations.json'), 'utf8'));
  assert.equal(Object.hasOwn(historyDoc.byType.drink[0], 'tasteFeedback'), false);

  const digitDropped = await tools.body_act.execute(
    { type: 'eat', description: '吃了一块黑椒牛排' },
    makeAgentExec({ sessionId: 'taste-sess', callId: 'eat-digit' }),
  );
  assert.equal(digitDropped.ok, true);
  assert.equal(Object.hasOwn(digitDropped, 'tasteFeedback'), false);

  const exerciseRes = await tools.body_act.execute(
    { type: 'exercise', description: '散了一会步' },
    makeAgentExec({ sessionId: 'taste-sess', callId: 'walk-1' }),
  );
  assert.equal(exerciseRes.ok, true);
  assert.equal(Object.hasOwn(exerciseRes, 'tasteFeedback'), false);

  const lactRes = await tools.body_act.execute(
    { type: 'breastfeed', description: '双侧亲喂了十分钟左右' },
    makeAgentExec({ sessionId: 'taste-sess', callId: 'feed-1' }),
  );
  assert.equal(lactRes.ok, true);
  assert.equal(lactRes.statusCode, 202);
  assert.equal(Object.hasOwn(lactRes, 'tasteFeedback'), false);
  const enumTypes = calls[3].tools[0].parameters.properties.actions.items.properties.type.enum;
  assert.equal(enumTypes.includes('express_milk'), true);
  assert.equal(enumTypes.includes('breastfeed'), true);
});

test('body_act exposes sex.exertion in translator schema/prompt and supports orgasm.continueStimulation', async (t) => {
  const calls = [];
  const llm = {
    stream(options) {
      calls.push(options);
      return toolCallStream({
        actions: [{ type: 'sex', intensity: 0.35, exertion: 0.05, durationMin: 12 }],
      }, { callId: 'tc-sex-exertion' });
    },
  };

  const { gateway, tools } = await startBodyEnv(t, {
    manifestPath: join(root, 'body-modules.female.json'),
    llm,
    defaultNsfw: true,
  });

  const translated = await tools.body_act.execute(
    { type: 'sex', description: '躺着轻柔地自己抚摸十来分钟' },
    makeAgentExec({ sessionId: 'sex-sess', callId: 'sex-solo' }),
  );
  assert.equal(translated.ok, true);
  assert.equal(translated.statusCode, 202);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].system.includes('exertion'));
  assert.ok(Object.hasOwn(calls[0].tools[0].parameters.properties.actions.items.properties, 'exertion'));

  await gateway.tick();
  const stateAfterSex = gateway.getState().parts;
  assert.equal(stateAfterSex.sexualResponse.sexIntensity, 0.35);
  assert.equal(stateAfterSex.physicalActivity.intensity, 0.05);

  const orgasmToolSchema = tools.body_act.parameters;
  assert.ok(Object.hasOwn(orgasmToolSchema.properties, 'continueStimulation'));
  const badOrgasm = await tools.body_act.execute(
    { type: 'orgasm', continueStimulation: 'yes' },
    makeAgentExec({ sessionId: 'sex-sess', callId: 'bad-orgasm' }),
  );
  assert.equal(badOrgasm.ok, false);
  assert.equal(badOrgasm.statusCode, 400);
});
