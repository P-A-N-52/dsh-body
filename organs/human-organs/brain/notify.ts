/*
 * 部位 `brainNotify`：神经系统提醒策略（P1b）。每轮只读 `interoception.hunger/fullness`
 * 和本轮动作里的 `sessionId`，写自己的 `brainNotify` 部位；在饥饿或饱满达到明显档位时
 * 调用 `io.notify`。不写其他部位，不做投递、ACK 或提醒历史。
 *
 * 来源：无直接人体证据。`organs/human-organs/references/source-index.csv` 没有提醒阈值、
 * 冷却或次数上限的人体测量；本文件所有阈值、冷却、每小时/每天上限与档位划分都是
 * `policy` / `design`，不是人体测量，也不是开发集拟合或独立验证。设计灵感只到定性层面：
 * 显著性（只有明显档位才提醒）、习惯化 / 滞回（同档不重复，降回复位阈值后才允许再次
 * 提醒）与不应期（最小间隔）；没有搬用论文方程或参数。
 *
 * 输入口径：`interoception.hunger/fullness` 是 0–100 mm VAS 代理（见
 * `brain/interoception.ts`），不是物理长度、激素浓度或神经放电；本脚本只对代理值做阈值
 * 比较，不跨量纲换算。缺失或非有限读数按 50 / 0 处理。
 *
 * 未建模：疼痛、恶心、腹胀、撑感、情绪、疾病、睡眠与昼夜节律；通知文本是固定模板，
 * 不由 LLM 生成；`wake` 只用于强档位，且与 `context` 共用同一套冷却和配额。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'brainNotify';
export const actionTypes: string[] = [];

type Level = 0 | 1 | 2 | 3;
type Kind = 'hunger' | 'fullness';
type Mode = 'context' | 'wake';

type SessionState = {
  lastSentAt: number | null;
  lastLevel: Level;
  lastKind: Kind | null;
  hourStartedAt: number;
  hourCount: number;
  dayStartedAt: number;
  dayCount: number;
  lastSeenAt: number;
};

type BrainNotifyState = {
  lastSessionId: string | null;
  sessions: Record<string, SessionState>;
};

type InteroceptionReading = {
  hunger?: number;
  fullness?: number;
};

type Action = {
  readonly sessionId?: unknown;
};

type IO = {
  read(id: 'brainNotify'): Readonly<BrainNotifyState> | undefined;
  read(id: 'interoception'): Readonly<InteroceptionReading> | undefined;
  readonly actions: readonly Action[];
  readonly simulatedSeconds: number;
  notify(notification: { mode: Mode; sessionId: string; text: string }): void;
  write(next: BrainNotifyState): void;
};

const parameters = loadParameters(new URL('./notify.parameters.json', import.meta.url));
const hungerMarked = requireParameter(parameters, 'brainNotify.hunger.marked');
const hungerStrong = requireParameter(parameters, 'brainNotify.hunger.strong');
const fullnessMarked = requireParameter(parameters, 'brainNotify.fullness.marked');
const fullnessStrong = requireParameter(parameters, 'brainNotify.fullness.strong');
const resetBelow = requireParameter(parameters, 'brainNotify.resetBelow');
const minIntervalMin = requireParameter(parameters, 'brainNotify.minIntervalMin');
const maxPerHour = requireParameter(parameters, 'brainNotify.maxPerHour');
const maxPerDay = requireParameter(parameters, 'brainNotify.maxPerDay');
const wakeAtLevel = requireParameter(parameters, 'brainNotify.wakeAtLevel');
const maxTrackedSessions = requireParameter(parameters, 'brainNotify.maxTrackedSessions');

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;
const MAX_SESSION_ID_LENGTH = 256;
const HUNGER_FALLBACK = 50;
const FULLNESS_FALLBACK = 0;

const TEXTS: Record<Kind, Record<number, string>> = {
  hunger: {
    2: '身体感受：胃里有些空，饥饿感开始明显。',
    3: '身体感受：胃里很空，饥饿感很明显。',
  },
  fullness: {
    2: '身体感受：胃里有些满，饱足感开始明显。',
    3: '身体感受：胃里很满，饱足感很明显，可能不太想再吃。',
  },
};

export const initialState: BrainNotifyState = {
  lastSessionId: null,
  sessions: {},
};

export const fields = {
  lastSessionId: { unit: '1', mode: 'absolute' },
  sessions: { unit: '1', mode: 'absolute' },
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeSession(raw: Readonly<SessionState> | undefined, now: number): SessionState {
  const lastLevel = raw?.lastLevel;
  const lastKind = raw?.lastKind;
  return {
    lastSentAt: finiteOrNull(raw?.lastSentAt),
    lastLevel: lastLevel === 1 || lastLevel === 2 || lastLevel === 3 ? lastLevel : 0,
    lastKind: lastKind === 'hunger' || lastKind === 'fullness' ? lastKind : null,
    hourStartedAt: finiteOr(raw?.hourStartedAt, now),
    hourCount: countOrZero(raw?.hourCount),
    dayStartedAt: finiteOr(raw?.dayStartedAt, now),
    dayCount: countOrZero(raw?.dayCount),
    lastSeenAt: finiteOr(raw?.lastSeenAt, now),
  };
}

function levelOf(value: number, marked: number, strong: number): Level {
  if (value >= strong) return 3;
  if (value >= marked) return 2;
  if (value >= resetBelow) return 1;
  return 0;
}

function currentSignal(io: IO): { level: Level; kind: Kind } {
  const reading = io.read('interoception');
  const hunger = finiteOr(reading?.hunger, HUNGER_FALLBACK);
  const fullness = finiteOr(reading?.fullness, FULLNESS_FALLBACK);
  const hungerLevel = levelOf(hunger, hungerMarked, hungerStrong);
  const fullnessLevel = levelOf(fullness, fullnessMarked, fullnessStrong);
  return fullnessLevel >= hungerLevel
    ? { level: fullnessLevel, kind: 'fullness' }
    : { level: hungerLevel, kind: 'hunger' };
}

function latestSessionId(actions: readonly Action[], previous: string | null): string | null {
  let sessionId: string | null = null;
  for (const action of actions) {
    const candidate = action?.sessionId;
    if (typeof candidate === 'string' && candidate.length > 0) sessionId = candidate;
  }
  if (sessionId !== null) return sessionId;
  return typeof previous === 'string' && previous.length > 0 ? previous : null;
}

// 计数窗口从会话首次出现或上次重置起算；跨过 3600/86400 秒就把计数清零。
function resetCounters(session: SessionState, now: number): void {
  if (now - session.hourStartedAt >= HOUR_SECONDS) {
    session.hourStartedAt = now;
    session.hourCount = 0;
  }
  if (now - session.dayStartedAt >= DAY_SECONDS) {
    session.dayStartedAt = now;
    session.dayCount = 0;
  }
}

function pruneSessions(
  sessions: Record<string, SessionState>,
  activeId: string,
  max: number,
): Record<string, SessionState> {
  const entries = Object.entries(sessions);
  if (entries.length <= max) return sessions;
  entries.sort((a, b) => {
    if (b[1].lastSeenAt !== a[1].lastSeenAt) return b[1].lastSeenAt - a[1].lastSeenAt;
    if (a[0] === activeId) return -1;
    if (b[0] === activeId) return 1;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return Object.fromEntries(entries.slice(0, max));
}

export function heartbeat(io: IO): void {
  const prev = io.read(id);
  const now = finiteOr(io.simulatedSeconds, 0);
  const sessionId = latestSessionId(io.actions, prev?.lastSessionId ?? null);

  if (sessionId === null) {
    // 没有会话就没有投递目标；保持原状态，避免产生永远无法投递的通知。
    io.write({
      lastSessionId: prev?.lastSessionId ?? null,
      sessions: prev?.sessions ?? {},
    });
    return;
  }

  const sessions: Record<string, SessionState> = {};
  for (const [key, raw] of Object.entries(prev?.sessions ?? {})) {
    sessions[key] = normalizeSession(raw, now);
  }

  const session = sessions[sessionId] ?? normalizeSession(undefined, now);
  session.lastSeenAt = now;
  resetCounters(session, now);

  const { level, kind } = currentSignal(io);
  const canNotify = level >= 2
    && level > session.lastLevel
    && (session.lastSentAt === null || now - session.lastSentAt >= minIntervalMin * 60)
    && session.hourCount < maxPerHour
    && session.dayCount < maxPerDay
    && sessionId.length <= MAX_SESSION_ID_LENGTH;

  if (canNotify) {
    io.notify({
      mode: level >= wakeAtLevel ? 'wake' : 'context',
      sessionId,
      text: TEXTS[kind][level],
    });
    session.lastSentAt = now;
    session.lastLevel = level;
    session.lastKind = kind;
    session.hourCount += 1;
    session.dayCount += 1;
  } else if (level < session.lastLevel) {
    session.lastLevel = level;
  }

  sessions[sessionId] = session;
  io.write({
    lastSessionId: sessionId,
    sessions: pruneSessions(sessions, sessionId, maxTrackedSessions),
  });
}
