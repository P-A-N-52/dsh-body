import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { startGateway } from './gateway.js';
import { createBodyFacade, resolveBodySpecs } from './multibody.js';
import { createNotificationPump } from './notifications.js';
import { formatBodyFeelingsContext, registerBodyTools } from './tools.js';

export const name = 'dsh-body';
export const inject = ['tools', 'agents'];

const notificationIntervalMs = 1000;
const defaultBootTimeoutMs = 30_000;

function buildBodyCognitionPrompt({ nsfwEnabled = false } = {}) {
  const lines = [
    '【身体认知与纯感觉交互准则】',
    '你拥有一具实时运行的虚拟身体，但你只能以纯粹的主观定性感受来体会自身状态（如饥饿、饱腹、口渴、口干、尿意、便意、呼吸顺畅或发闷、心跳与循环感受、冷暖出汗、肌肉疲乏、低血糖发虚、钙稳态异样如手脚发麻抽紧或倦怠、困倦与精力起伏、紧张焦虑或舒畅惬意，以及下腹不适与经期感受）。',
    '严禁在任何回复中凭空编造、扮演或输出具体生理数值、百分比、体积或计量单位（例如体温、心率、血压、毫升、千卡、毫克或分钟数）。',
    nsfwEnabled
      ? '当身体处于未绑定休眠状态时，先通过 body_bind 将身体绑定到当前会话；需要细致体会某处或全身状态时调用 body_state；要通过进食、喝水、运动、排尿、排便、中止运动（stop_exercise）、入睡（sleep）、醒来（wake_up）以及亲密互动或泌乳护理（sex、orgasm、express_milk、breastfeed）等行为回应身体需求时调用 body_act，并对吃喝/运动/亲密互动用 description 如实描述自然行为（如“吃了一口米饭”“慢跑一会”），无需自己估算或填入热量、毫升数与强度数字；进食或喝水后若返回定性味道与口感反馈（tasteFeedback），请直接以当下的感官体验自然回应。'
      : '当身体处于未绑定休眠状态时，先通过 body_bind 将身体绑定到当前会话；需要细致体会某处或全身状态时调用 body_state；要通过进食、喝水、运动、排尿、排便、中止运动（stop_exercise）、入睡（sleep）或醒来（wake_up）等行为回应身体需求时调用 body_act，并对吃喝/运动用 description 如实描述自然行为（如“吃了一口米饭”“慢跑一会”），无需自己估算或填入热量、毫升数与强度数字；进食或喝水后若返回定性味道与口感反馈（tasteFeedback），请直接以当下的感官体验自然回应。',
    '收到来源为身体通知（body-notify）的消息时，那是你自身发出的内部体感信号，而不是外界用户在说话，请以第一人称的真实体验自然回应。',
  ];
  return lines.join('\n');
}

const SLEEP_CONTEXT_NOTICE = [
  '[睡眠状态行为规则]',
  '你当前正处于睡眠状态，请保持安静，不要主动在对话或群聊中搭话，也不要发起吃喝、运动等日常身体活动。',
  '若在睡眠状态下强行回复文本消息或调用非豁免操作工具，身体将会被自动唤醒并脱离睡眠状态。',
].join(' ');

const SLEEP_EXEMPT_TOOL_NAMES = new Set(['body_state', 'body_bind']);

function reportDeliveryError(error) {
  console.error('Failed to deliver body notifications', error);
}

function reportUnbindError(error) {
  console.error('Failed to unbind disposed session from body gateway', error);
}

function reportWakeError(error) {
  console.error('Failed to wake sleeping body from host activity', error);
}

function tryGetService(ctx, serviceName) {
  try {
    return ctx.get?.(serviceName) ?? null;
  } catch {
    return null;
  }
}

function extractSessionId(event) {
  if (typeof event === 'string') return event;
  if (!event || typeof event !== 'object') return null;
  return event.sessionId
    ?? event.session?.id
    ?? event.agent?.session?.id
    ?? event.agent?.id
    ?? event.id
    ?? null;
}

function hasAssistantText(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.text === 'string' && data.text.trim()) return true;
  const content = data.content ?? data.message?.content;
  if (typeof content === 'string' && content.trim()) return true;
  if (Array.isArray(content)) {
    return content.some((block) => (
      block
      && typeof block === 'object'
      && block.type === 'text'
      && typeof block.text === 'string'
      && block.text.trim() !== ''
    ));
  }
  return false;
}

function isSleepExemptTool(exec) {
  const toolName = exec?.name;
  if (SLEEP_EXEMPT_TOOL_NAMES.has(toolName)) return true;
  if (toolName === 'body_act') {
    const args = exec?.arguments ?? exec?.args;
    const actionType = args?.type ?? args?.action;
    if (actionType === 'sleep' || actionType === 'wake_up') return true;
  }
  return false;
}

function resolveBodyHome(ctx) {
  const profileContext = tryGetService(ctx, 'profileContext');
  if (typeof profileContext?.home === 'string' && profileContext.home) {
    return profileContext.home;
  }
  const dshHomePath = tryGetService(ctx, 'dshHomePath');
  const resolved = typeof dshHomePath === 'function' ? dshHomePath() : dshHomePath;
  if (typeof resolved === 'string' && resolved) {
    return resolved;
  }
  throw new Error('dsh-body requires statePath or either profileContext.home or dshHomePath');
}

function resolveBootTimeoutMs(value) {
  if (value === undefined || value === null || value === '') return defaultBootTimeoutMs;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError('bootTimeoutMs must be a positive integer');
  }
  return parsed;
}

async function awaitBodyReady(entry, timeoutMs) {
  let timer;
  try {
    const info = await Promise.race([
      Promise.resolve(entry.gateway.ready),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Body "${entry.id}" boot timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (!info) {
      throw new Error(`Body "${entry.id}" stopped before becoming ready`);
    }
    return { ok: true, entry, info };
  } catch (error) {
    try {
      await entry.gateway.stop?.();
    } catch {
      // 忽略启动失败身体自身的退出清理异常
    }
    return { ok: false, entry, error };
  } finally {
    clearTimeout(timer);
  }
}

export async function apply(ctx, config = {}) {
  const { manifestPath, statePath, port, nsfw, translator, bootTimeoutMs } = config ?? {};
  const resolvedStatePath = statePath ?? join(resolveBodyHome(ctx), 'dsh-body', 'body-state.json');
  const resolvedPort = port === undefined || port === '' ? undefined : Number(port);
  const resolvedBootTimeoutMs = resolveBootTimeoutMs(bootTimeoutMs);
  const { defaultId, sessions, specs } = resolveBodySpecs({
    resolvedStatePath,
    resolvedPort,
    manifestPath,
    nsfw,
  });

  const startedEntries = [];
  const startFailures = [];
  for (const spec of specs) {
    try {
      startedEntries.push({
        id: spec.id,
        gateway: startGateway({
          manifestPath: spec.manifestPath,
          statePath: spec.statePath,
          port: spec.port,
          requireBinding: true,
          defaultNsfw: spec.nsfw,
        }),
      });
    } catch (error) {
      startFailures.push({ id: spec.id, error });
      console.warn('[dsh-body] 身体启动失败', spec.id, error instanceof Error ? error.message : String(error));
    }
  }

  if (startedEntries.length > 0) {
    // 必须返回清理函数：Cordis 会在注册 ctx.effect 时同步执行外层回调。
    ctx.effect(() => () => Promise.allSettled(startedEntries.map((entry) => entry.gateway.stop?.())));
  }

  const readinessResults = await Promise.all(
    startedEntries.map((entry) => awaitBodyReady(entry, resolvedBootTimeoutMs)),
  );
  const readyEntries = [];
  for (const result of readinessResults) {
    if (result.ok) {
      readyEntries.push(result.entry);
    } else {
      startFailures.push({ id: result.entry.id, error: result.error });
      console.warn(
        '[dsh-body] 身体就绪失败',
        result.entry.id,
        result.error instanceof Error ? result.error.message : String(result.error),
      );
    }
  }
  if (readyEntries.length === 0) {
    throw startFailures[0]?.error ?? new Error('No body gateways became ready');
  }

  const gateway = createBodyFacade({
    entries: readyEntries,
    defaultId,
    sessions,
  });

  const agents = tryGetService(ctx, 'agents');
  for (const entry of readyEntries) {
    const initialBoundId = entry.gateway.getBoundSessionId?.();
    if (initialBoundId && typeof agents?.get === 'function' && !agents.get(initialBoundId)) {
      await entry.gateway.unbindSession();
    }
  }

  registerBodyTools(ctx, gateway, { translator });

  function findBoundGateway(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    return gateway.findBoundGateway?.(sessionId) ?? null;
  }

  function isBoundSleepingSession(sessionId) {
    const scoped = findBoundGateway(sessionId);
    if (!scoped) return false;
    const health = scoped.getHealth?.();
    const boundSessionId = scoped.getBoundSessionId?.() ?? health?.boundSessionId ?? null;
    if (!health?.active || scoped.isDormant?.() || !boundSessionId || sessionId !== boundSessionId) {
      return false;
    }
    return scoped.getState?.()?.parts?.sleep?.sleeping === true;
  }

  const wakeStateByGateway = new WeakMap();
  function getWakeState(scoped) {
    let state = wakeStateByGateway.get(scoped);
    if (!state) {
      state = { inFlight: false, lastActionId: null, lastSessionId: null, lastSimSec: null };
      wakeStateByGateway.set(scoped, state);
    }
    return state;
  }

  async function wakeBoundSession(sessionId, reason) {
    if (!isBoundSleepingSession(sessionId)) return;
    const scoped = findBoundGateway(sessionId);
    if (!scoped || typeof scoped.submitAction !== 'function') return;
    const state = getWakeState(scoped);
    if (state.inFlight) return;
    if (state.lastActionId && typeof scoped.getAction === 'function') {
      const existing = scoped.getAction(state.lastActionId);
      if (existing?.status === 'queued') return;
    } else {
      const currentSimSec = scoped.getState?.()?.simulatedSeconds ?? null;
      if (state.lastSessionId === sessionId && currentSimSec !== null && currentSimSec === state.lastSimSec) {
        return;
      }
    }
    state.inFlight = true;
    try {
      const actionId = randomUUID();
      const simSec = scoped.getState?.()?.simulatedSeconds ?? null;
      const receipt = await scoped.submitAction({
        id: actionId,
        type: 'wake_up',
        sessionId,
        reason,
      });
      if (receipt?.statusCode === 202 || receipt?.body?.status === 'queued') {
        state.lastActionId = actionId;
        state.lastSessionId = sessionId;
        state.lastSimSec = simSec;
      }
    } finally {
      state.inFlight = false;
    }
  }

  const pumps = readyEntries.map((entry) => createNotificationPump({
    gateway: entry.gateway,
    agentFor: (sessionId) => agents?.get?.(sessionId),
  }));
  async function runAllPumps() {
    await Promise.allSettled(pumps.map((pump) => pump.run().catch(reportDeliveryError)));
  }

  if (typeof ctx.on === 'function') {
    const disposers = [];
    disposers.push(ctx.on('agent/disposed', (event) => {
      const disposedSessionId = extractSessionId(event);
      if (!disposedSessionId) return;
      for (const entry of readyEntries) {
        if (entry.gateway.getBoundSessionId?.() === disposedSessionId) {
          entry.gateway.unbindSession().catch(reportUnbindError);
        }
      }
    }));

    disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
      const callerSessionId = extractSessionId(exec);
      if (isBoundSleepingSession(callerSessionId) && !isSleepExemptTool(exec)) {
        wakeBoundSession(callerSessionId, 'action').catch(reportWakeError);
      }
      if (typeof next === 'function') {
        return next();
      }
      return { kind: 'allow' };
    }));

    disposers.push(ctx.on('session/event', (session, event) => {
      if (event?.type !== 'assistant/message') return;
      const sessionId = extractSessionId(session);
      if (!isBoundSleepingSession(sessionId)) return;
      if (!hasAssistantText(event?.data)) return;
      wakeBoundSession(sessionId, 'speech').catch(reportWakeError);
    }));

    disposers.push(ctx.on('agent/inbox/inserted', (eventOrSession, maybeEvent) => {
      const payload = maybeEvent ?? eventOrSession;
      try {
        for (const pump of pumps) {
          const result = pump.handleInboxInserted?.(payload);
          if (result && typeof result.then === 'function') {
            result.catch(reportDeliveryError);
          } else if (result?.matched) {
            break;
          }
        }
      } catch (error) {
        reportDeliveryError(error);
      }
    }));

    ctx.on('dispose', () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose();
      }
    });
  }

  const systemPrompt = tryGetService(ctx, 'systemPrompt');
  if (typeof systemPrompt?.section === 'function') {
    ctx.effect(() => systemPrompt.section({
      name: 'dsh-body:cognition',
      order: 120,
      text: buildBodyCognitionPrompt({ nsfwEnabled: Boolean(gateway.getNsfw?.() ?? nsfw) }),
    }));
  }
  if (typeof systemPrompt?.context === 'function') {
    ctx.effect(() => systemPrompt.context({
      name: 'dsh-body:feelings',
      order: 120,
      text: (ctxArg) => {
        try {
          const requestSessionId = ctxArg?.agent?.session?.id
            ?? ctxArg?.agent?.id
            ?? ctxArg?.sessionId
            ?? null;
          if (typeof requestSessionId !== 'string' || !requestSessionId) {
            return '';
          }
          const scoped = findBoundGateway(requestSessionId);
          const health = scoped?.getHealth?.();
          const boundSessionId = scoped?.getBoundSessionId?.() ?? health?.boundSessionId ?? null;
          if (!health?.active || scoped?.isDormant?.() || !boundSessionId || requestSessionId !== boundSessionId) {
            return '';
          }
          const snapshot = scoped.getState();
          const base = formatBodyFeelingsContext(snapshot, {
            nsfw: Boolean(scoped.getNsfw?.() ?? health?.nsfw),
            dormant: false,
            active: true,
          });
          if (snapshot?.parts?.sleep?.sleeping === true) {
            return base ? `${base}\n${SLEEP_CONTEXT_NOTICE}` : SLEEP_CONTEXT_NOTICE;
          }
          return base;
        } catch {
          return '';
        }
      },
    }));
  }

  const timer = setInterval(() => {
    runAllPumps().catch(reportDeliveryError);
  }, notificationIntervalMs);
  timer.unref?.();
  ctx.effect(() => () => clearInterval(timer));

  await runAllPumps();
}
