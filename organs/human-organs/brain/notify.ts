/*
 * 部位 `brainNotify`：神经系统提醒策略（P1b）。每轮只读 `interoception.hunger/fullness/
 * thirst/urinaryUrgency`、轮初 `bladder.voidedMl` 和本轮动作里的 `sessionId`/`type`，
 * 写自己的 `brainNotify` 部位；在饥饿、饱满、口渴或尿意达到明显档位时调用
 * `io.notify`。不写其他部位，不做投递、ACK 或提醒历史。
 *
 * 来源：无直接人体证据。`organs/human-organs/references/source-index.csv` 没有提醒阈值、
 * 冷却或次数上限的人体测量；本文件所有阈值、冷却、每小时/每天上限与档位划分都是
 * `policy` / `design`，不是人体测量，也不是开发集拟合或独立验证。设计灵感只到定性层面：
 * 显著性（只有明显档位才提醒）、习惯化 / 滞回（同档不重复：再次提醒同档需先降到
 * `resetBelow` 40 mm 以下复位水位；40–64 mm 保持原水位锁定，升到更高档可直接提醒）
 * 与不应期（最小间隔）；没有搬用论文方程或参数。`resetBelow` 区分观测 0 档（< 40）与
 * 1 档（40–64），用于门控的 `levels` 保留 0/2/3，并在 1 档区间维持锁定不复位。
 *
 * 输入口径：`interoception.hunger/fullness/thirst/urinaryUrgency` 是 0–100 mm VAS 代理
 * （见 `brain/interoception.ts`；`thirst` 是下丘脑口渴驱动的原样代理，不是血浆渗透压
 * 或实测 VAS），不是物理长度、激素浓度、神经放电或膀胱压力；本脚本只对代理值做阈值
 * 比较，不跨量纲换算。缺失或非有限读数按饥饿 50、口渴 50、饱满 / 尿意 0 处理，
 * `±Infinity` 不会经钳位变成 100；口渴缺失回落到 50 mm，落在明显档以下，因此不提醒。
 * 轮初 `bladder.voidedMl > 0` 或本轮动作已含 `urinate` 时，尿意候选视为不可用并按
 * 0 mm 回落，避免排尿后补发仍来自旧体感的尿意提醒；其他信号不受影响。口渴没有对应的
 * 动作抑制：`drink` 不会在当轮清零口渴水位，饮水要经胃、小肠和体液改变亏缺后才回落。
 *
 * 每会话用 `levels: { hunger, fullness, urinary, thirst }` 分别记录滞回水位，只有被
 * 选中并实际发送的信号才抬高自己的水位；未选区信号不消耗水位。冷却、每小时/每天配额
 * 仍按会话共享，每轮最多一条；合格候选先取最高档，同档优先级为尿意 > 口渴 > 饱满 >
 * 饥饿。`lastKind` 记录最近一次实际提醒的信号；`lastLevel` 保留既有下降闩锁并供旧档
 * 迁移，实际门控由 `levels` 负责。旧会话已有 `levels` 对象时只把缺失的 `thirst` 等
 * 水位补 0，其他信号水位不变；更旧会话缺少 `levels` 时用 `lastKind/lastLevel` 惰性
 * 迁移，不反推历史，也不升存档 schemaVersion。
 *
 * 未建模：疼痛、恶心、腹胀、撑感、情绪、疾病、睡眠与昼夜节律；`discomfort` 聚合代理
 * 不接入通知；通知文本是固定模板，不由 LLM 生成，也不含水量、诊断或饮水指令；口渴不
 * 自动产生 `drink` 动作；`wake` 只用于强档位，且与 `context` 共用同一套冷却和配额。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'brainNotify';
export const actionTypes: string[] = [];

type Kind = 'hunger' | 'fullness' | 'urinary' | 'thirst';
type Level = 0 | 1 | 2 | 3;
type WaterLevel = 0 | 2 | 3;
type Mode = 'context' | 'wake';

type Levels = Record<Kind, WaterLevel>;

type SessionState = {
  lastSentAt: number | null;
  lastLevel: Level;
  lastKind: Kind | null;
  hourStartedAt: number;
  hourCount: number;
  dayStartedAt: number;
  dayCount: number;
  lastSeenAt: number;
  levels: Levels;
};

type StoredSessionState = Omit<SessionState, 'levels'> & {
  levels?: Partial<Record<Kind, unknown>>;
};

type BrainNotifyState = {
  lastSessionId: string | null;
  sessions: Record<string, StoredSessionState>;
};

type InteroceptionReading = {
  hunger?: number;
  fullness?: number;
  thirst?: number;
  urinaryUrgency?: number;
};

type BladderReading = {
  voidedMl?: number;
};

type Action = {
  readonly type?: unknown;
  readonly sessionId?: unknown;
};

type IO = {
  read(id: 'brainNotify'): Readonly<BrainNotifyState> | undefined;
  read(id: 'interoception'): Readonly<InteroceptionReading> | undefined;
  read(id: 'bladder'): Readonly<BladderReading> | undefined;
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
const urinaryMarked = requireParameter(parameters, 'brainNotify.urinary.marked');
const urinaryStrong = requireParameter(parameters, 'brainNotify.urinary.strong');
const thirstMarked = requireParameter(parameters, 'brainNotify.thirst.marked');
const thirstStrong = requireParameter(parameters, 'brainNotify.thirst.strong');
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
const URINARY_FALLBACK = 0;
const THIRST_FALLBACK = 50;

// 选择顺序也是同档优先级：尿意 > 口渴 > 饱满 > 饥饿。
const SIGNAL_ORDER: readonly Kind[] = ['urinary', 'thirst', 'fullness', 'hunger'];

const TEXTS: Record<Kind, Record<2 | 3, string>> = {
  hunger: {
    2: '身体感受：胃里有些空，饥饿感开始明显。',
    3: '身体感受：胃里很空，饥饿感很明显。',
  },
  fullness: {
    2: '身体感受：胃里有些满，饱足感开始明显。',
    3: '身体感受：胃里很满，饱足感很明显，可能不太想再吃。',
  },
  urinary: {
    2: '身体感受：膀胱有些满，尿意开始明显。',
    3: '身体感受：膀胱很满，尿意很明显。',
  },
  thirst: {
    2: '身体感受：有些口渴。',
    3: '身体感受：很口渴。',
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

function isKind(value: unknown): value is Kind {
  return value === 'hunger'
    || value === 'fullness'
    || value === 'urinary'
    || value === 'thirst';
}

function waterLevelOrZero(value: unknown): WaterLevel {
  return value === 2 || value === 3 ? value : 0;
}

function normalizeLevels(
  raw: Readonly<StoredSessionState> | undefined,
  lastKind: Kind | null,
  lastLevel: Level,
): Levels {
  const levels: Levels = { hunger: 0, fullness: 0, urinary: 0, thirst: 0 };
  const stored = raw?.levels;
  if (stored !== undefined && stored !== null && typeof stored === 'object') {
    for (const kind of SIGNAL_ORDER) levels[kind] = waterLevelOrZero(stored[kind]);
    return levels;
  }
  if (lastKind !== null) levels[lastKind] = waterLevelOrZero(lastLevel);
  return levels;
}

function normalizeSession(raw: Readonly<StoredSessionState> | undefined, now: number): SessionState {
  const lastLevel = raw?.lastLevel;
  const normalizedLevel = lastLevel === 1 || lastLevel === 2 || lastLevel === 3 ? lastLevel : 0;
  const lastKind = isKind(raw?.lastKind) ? raw.lastKind : null;
  return {
    lastSentAt: finiteOrNull(raw?.lastSentAt),
    lastLevel: normalizedLevel,
    lastKind,
    hourStartedAt: finiteOr(raw?.hourStartedAt, now),
    hourCount: countOrZero(raw?.hourCount),
    dayStartedAt: finiteOr(raw?.dayStartedAt, now),
    dayCount: countOrZero(raw?.dayCount),
    lastSeenAt: finiteOr(raw?.lastSeenAt, now),
    levels: normalizeLevels(raw, lastKind, normalizedLevel),
  };
}

function levelOf(value: number, marked: number, strong: number): Level {
  if (value >= strong) return 3;
  if (value >= marked) return 2;
  if (value >= resetBelow) return 1;
  return 0;
}

function observeSignals(io: IO): Record<Kind, Level> {
  const reading = io.read('interoception');
  const hunger = levelOf(finiteOr(reading?.hunger, HUNGER_FALLBACK), hungerMarked, hungerStrong);
  const fullness = levelOf(
    finiteOr(reading?.fullness, FULLNESS_FALLBACK),
    fullnessMarked,
    fullnessStrong,
  );
  const thirst = levelOf(
    finiteOr(reading?.thirst, THIRST_FALLBACK),
    thirstMarked,
    thirstStrong,
  );
  const voidedMl = finiteOr(io.read('bladder')?.voidedMl, 0);
  const voiding = voidedMl > 0 || io.actions.some((action) => action?.type === 'urinate');
  const urinary = voiding
    ? 0
    : levelOf(
      finiteOr(reading?.urinaryUrgency, URINARY_FALLBACK),
      urinaryMarked,
      urinaryStrong,
    );
  return { hunger, fullness, urinary, thirst };
}

function reconcileLevels(levels: Levels, observed: Record<Kind, Level>): void {
  for (const kind of SIGNAL_ORDER) {
    const obs = observed[kind];
    if (obs === 0) {
      levels[kind] = 0;
    } else if (obs === 2 && levels[kind] > 2) {
      levels[kind] = 2;
    }
  }
}

function pickCandidate(
  levels: Levels,
  observed: Record<Kind, Level>,
): { kind: Kind; level: WaterLevel } | null {
  let picked: { kind: Kind; level: WaterLevel } | null = null;
  for (const kind of SIGNAL_ORDER) {
    const level = observed[kind];
    if (level !== 2 && level !== 3) continue;
    if (level <= levels[kind]) continue;
    if (picked === null || level > picked.level) picked = { kind, level };
  }
  return picked;
}

function highestObserved(observed: Record<Kind, Level>): Level {
  let highest: Level = 0;
  for (const kind of SIGNAL_ORDER) {
    if (observed[kind] > highest) highest = observed[kind];
  }
  return highest;
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

  const observed = observeSignals(io);
  reconcileLevels(session.levels, observed);
  const candidate = pickCandidate(session.levels, observed);
  const canNotify = candidate !== null
    && (session.lastSentAt === null || now - session.lastSentAt >= minIntervalMin * 60)
    && session.hourCount < maxPerHour
    && session.dayCount < maxPerDay
    && sessionId.length <= MAX_SESSION_ID_LENGTH;

  if (candidate !== null && canNotify) {
    io.notify({
      mode: candidate.level >= wakeAtLevel ? 'wake' : 'context',
      sessionId,
      text: TEXTS[candidate.kind][candidate.level],
    });
    session.lastSentAt = now;
    session.lastLevel = candidate.level;
    session.lastKind = candidate.kind;
    session.levels[candidate.kind] = candidate.level;
    session.hourCount += 1;
    session.dayCount += 1;
  } else {
    const selectedLevel = candidate?.level ?? highestObserved(observed);
    if (selectedLevel < session.lastLevel) session.lastLevel = selectedLevel;
  }

  sessions[sessionId] = session;
  io.write({
    lastSessionId: sessionId,
    sessions: pruneSessions(sessions, sessionId, maxTrackedSessions),
  });
}
