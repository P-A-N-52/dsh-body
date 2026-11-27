/*
 * 部位 `brainNotify`：大脑三档无数字感觉通知策略（普通 / 重要 / 紧急）。
 *
 * 策略与状态边界（均标 `policy`，不是人体测量）：
 * - 三级通知：
 *   1. **普通 (`normal`, `mode: 'context'`)**：清醒时 `[65, 85)` mm 静默注入；睡眠中隐藏不发，
 *      存入会话 `sleepBacklog`。
 *   2. **重要 (`important`, `mode: 'wake'`)**：清醒时 `>= 85 mm` 触发唤醒；**睡眠时抬高门槛**
 *      （浅睡/REM 默认 `92 mm`、深睡默认 `95 mm`），低于睡眠门槛者同样存入 `sleepBacklog`，
 *      跨过门槛则触发常规唤醒脱离睡眠（不触发剧烈交感惊跳）。
 *   3. **紧急 (`emergency`, `mode: 'wake'`)**：高危危机（严重缺氧 >= 90、高热/失温/低血糖 >= 85、
 *      休克 SBP < 78、漏尿边沿、扩展 `urgent: true`），无视睡眠门槛直接惊醒并触发交感活跃；
 *      **紧急压过普通与重要两级**，触发紧急的当条通知暂不显示普通与重要信号。
 * - 睡眠堆积与醒来集中发：
 *   - 睡眠中达标但未触发惊醒的普通/未过门槛重要感受累计进 `sleepBacklog`（含醒来仍明显与
 *     睡着中途曾出现并已平复的小插曲）；
 *   - 脱离睡眠瞬间（自然醒 / `wake_up` / 重要唤醒 / 动作或说话唤醒），强制发一条 `mode: 'wake'`
 *     通知明确告知已脱离睡眠并汇总注入 `sleepBacklog`；若为紧急惊醒，优先只发紧急警报，
 *     被压住的 `sleepBacklog` 顺延至随后非紧急轮次补发。
 * - 严格无数字输出与滞回指数退避（普通 20→240 min、紧急/重要 5→60 min）。
 */
import { getNsfwSetting, loadParameters, requireParameter } from '../../../lib/parameters.js';
import {
  DYSPNEA_CRISIS_MM,
  evaluateSleepTransition,
  evaluateSleepWakeSignals,
  resolveSleepImportantThresholdMm,
  SEVERE_HYPOTENSION_SBP_MMHG,
  type SleepStage,
  type WakeEvent,
} from './wake-evaluation.ts';

export const id = 'brainNotify';
export const actionTypes: string[] = [];

type CoreKind = 'hunger' | 'fullness' | 'urinary' | 'thirst';
type ExpandedKey =
  | 'dryMouth'
  | 'bowelUrgency'
  | 'dyspnea'
  | 'heat'
  | 'cold'
  | 'hypoglycemia'
  | 'hypocalcemia'
  | 'hypercalcemia'
  | 'palpitation'
  | 'sweatDamp'
  | 'muscleFatigue'
  | 'stress'
  | 'sleepiness'
  | 'uterineCramp'
  | 'sexualArousal'
  | 'libido'
  | 'mammaryFullness';

type Level = 0 | 1 | 2 | 3;
type WaterLevel = 0 | 2 | 3;
type Mode = 'context' | 'wake';
type Tier = 'normal' | 'important' | 'emergency';

type Levels = Record<CoreKind, WaterLevel>;

type SleepBacklogEntry = {
  id: string;
  tier: 'normal' | 'important';
  level: WaterLevel;
  clause: string;
  resolvedClause: string;
  stillActive: boolean;
  order: number;
  coreKind?: CoreKind;
  expandedKey?: ExpandedKey;
  extensibleKey?: string;
};

type SessionState = {
  lastSentAt: number | null;
  backoffStep: number;
  lastUrgentSentAt: number | null;
  urgentBackoffStep: number;
  lastInvoluntaryVoidedMl: number;
  lastOrgasmAtSimMin?: number | null;
  lastAttemptedOrgasmAtSimMin?: number | null;
  lastLevel: Level;
  lastKind: CoreKind | null;
  lastSeenAt: number;
  levels: Levels;
  sensations: Record<string, WaterLevel>;
  sensationLevels?: Record<string, WaterLevel>;
  wasSleeping?: boolean;
  sleepBacklog?: Record<string, SleepBacklogEntry>;
};

type StoredSessionState = Partial<Omit<SessionState, 'levels' | 'sensations' | 'sensationLevels' | 'sleepBacklog'>> & {
  levels?: Partial<Record<CoreKind, unknown>>;
  sensations?: Record<string, unknown>;
  sensationLevels?: Record<string, unknown>;
  sleepBacklog?: Record<string, unknown>;
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
  dryMouthMm?: number;
  bowelUrgencyMm?: number;
  dyspneaMm?: number;
  heatMm?: number;
  coldMm?: number;
  hypoglycemiaMm?: number;
  hypocalcemiaMm?: number;
  hypercalcemiaMm?: number;
  palpitationMm?: number;
  sweatDampMm?: number;
  muscleFatigueMm?: number;
  stressMm?: number;
  sleepinessMm?: number;
  uterineCrampMm?: number;
  sexualArousalMm?: number;
  libidoMm?: number;
  mammaryFullnessMm?: number;
  hedonicCalmMm?: number;
  sensations?: Readonly<Record<string, unknown>>;
};

type BladderReading = {
  voidedMl?: number;
  involuntaryVoidedMl?: number;
};

type ColonReading = {
  defecatedG?: number;
};

type SleepReading = {
  sleeping?: unknown;
  sleepStage?: unknown;
  sleepPressureMm?: unknown;
  sleepDurationMin?: unknown;
  wakeEvent?: unknown;
};

type PinealReading = {
  melatoninRelative?: unknown;
};

type BloodReading = {
  systolicMmHg?: unknown;
};

type UterusReading = {
  crampMm?: unknown;
};

type MammaryGlandsReading = {
  fullnessMm?: unknown;
  ejectedMilkMl?: unknown;
  lactating?: unknown;
};

type SexualResponseReading = {
  phase?: unknown;
  lastOrgasmAtSimMin?: unknown;
  lastAttemptedOrgasmAtSimMin?: unknown;
  lastOrgasmBlockReason?: unknown;
};

type Action = {
  readonly type?: unknown;
  readonly sessionId?: unknown;
  readonly reason?: unknown;
  readonly startle?: unknown;
};

type IO = {
  read(id: 'brainNotify'): Readonly<BrainNotifyState> | undefined;
  read(id: 'interoception'): Readonly<InteroceptionReading> | undefined;
  read(id: 'bladder'): Readonly<BladderReading> | undefined;
  read(id: 'colon'): Readonly<ColonReading> | undefined;
  read(id: 'sleep'): Readonly<SleepReading> | undefined;
  read(id: 'pineal'): Readonly<PinealReading> | undefined;
  read(id: 'blood'): Readonly<BloodReading> | undefined;
  read(id: 'uterus'): Readonly<UterusReading> | undefined;
  read(id: 'mammaryGlands'): Readonly<MammaryGlandsReading> | undefined;
  read(id: 'sexualResponse'): Readonly<SexualResponseReading> | undefined;
  readonly actions: readonly Action[];
  readonly dt?: number;
  readonly simulatedSeconds: number;
  readonly suppressNotifications?: boolean;
  readonly boundSessionId?: string | null;
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
const defaultMarked = requireParameter(parameters, 'brainNotify.default.marked');
const defaultStrong = requireParameter(parameters, 'brainNotify.default.strong');
const resetBelow = requireParameter(parameters, 'brainNotify.resetBelow');
const baseIntervalMin = requireParameter(parameters, 'brainNotify.baseIntervalMin');
const maxIntervalMin = requireParameter(parameters, 'brainNotify.maxIntervalMin');
const urgentBaseIntervalMin = requireParameter(parameters, 'brainNotify.urgentBaseIntervalMin');
const urgentMaxIntervalMin = requireParameter(parameters, 'brainNotify.urgentMaxIntervalMin');
const wakeAtLevel = requireParameter(parameters, 'brainNotify.wakeAtLevel');
const maxTrackedSessions = requireParameter(parameters, 'brainNotify.maxTrackedSessions');

const MAX_SESSION_ID_LENGTH = 256;
const MAX_AGGREGATED_TEXT_LENGTH = 280;
const MAX_WAKE_SUMMARY_TEXT_LENGTH = 420;
const MAX_SLEEP_BACKLOG_ENTRIES = 24;
const HUNGER_FALLBACK = 50;
const FULLNESS_FALLBACK = 0;
const URINARY_FALLBACK = 0;
const THIRST_FALLBACK = 0;

const CORE_ORDER: readonly CoreKind[] = ['urinary', 'thirst', 'fullness', 'hunger'];

const EXPANDED_KEYS: readonly ExpandedKey[] = [
  'dyspnea',
  'palpitation',
  'hypoglycemia',
  'heat',
  'cold',
  'hypocalcemia',
  'hypercalcemia',
  'bowelUrgency',
  'dryMouth',
  'uterineCramp',
  'muscleFatigue',
  'sweatDamp',
  'stress',
  'sleepiness',
  'mammaryFullness',
  'sexualArousal',
  'libido',
];

const TEXTS: Record<CoreKind, Record<2 | 3, string>> = {
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

const CORE_CLAUSES: Record<CoreKind, Record<2 | 3, string>> = {
  hunger: {
    2: '胃里有些空，开始觉得有点饿',
    3: '胃里空得难受，饥饿感很强烈',
  },
  fullness: {
    2: '胃里有些满，饱足感比较明显',
    3: '胃里很胀，撑得有点难受',
  },
  urinary: {
    2: '隐约有尿意了',
    3: '膀胱胀满，尿意非常迫切',
  },
  thirst: {
    2: '有些口渴了',
    3: '非常口渴，急需喝水',
  },
};

const EXPANDED_CLAUSES: Record<ExpandedKey, Record<2 | 3, string>> = {
  dyspnea: {
    2: '呼吸变得有点急，胸口微微发闷',
    3: '呼吸困难、喘不上气，胸口发闷',
  },
  palpitation: {
    2: '觉得心跳有些乱或发快，头略微发沉',
    3: '心跳剧烈发慌、阵阵眩晕站不稳',
  },
  hypoglycemia: {
    2: '觉得有点发虚乏力，精神微微发晃',
    3: '脑子发昏、手脚发软发慌，整个人很虚脱',
  },
  hypocalcemia: {
    2: '指尖和口周有些隐隐发麻、肌肉略微抽紧',
    3: '四肢和口周明显麻木刺痛，肌肉阵阵抽搐发紧',
  },
  hypercalcemia: {
    2: '浑身有些倦怠发沉，隐隐觉得乏力口渴',
    3: '浑身极度沉重倦怠，精神混浊、反胃无力',
  },
  heat: {
    2: '身上有些燥热冒温',
    3: '浑身滚烫发昏，热得很难受',
  },
  cold: {
    2: '身上觉得有点发凉',
    3: '浑身冰冷打颤，手脚发僵',
  },
  bowelUrgency: {
    2: '肚子有些发沉，隐约有便意',
    3: '下腹坠胀明显，急需排便',
  },
  dryMouth: {
    2: '嘴里和舌头有些发干',
    3: '口腔干涩发紧，咽口水都不顺畅',
  },
  uterineCramp: {
    2: '下腹有些隐隐发坠发紧',
    3: '小腹一阵阵绞痛得厉害，整个人直不起腰',
  },
  muscleFatigue: {
    2: '四肢肌肉有点发酸发沉',
    3: '肌肉酸痛发软，已经很疲乏使不上力',
  },
  sweatDamp: {
    2: '后背和皮肤有些出汗潮湿',
    3: '浑身湿透粘腻，汗水流个不停',
  },
  stress: {
    2: '心神有些紧绷发焦',
    3: '心头焦躁紧绷得很，难以平静下来',
  },
  sleepiness: {
    2: '眼皮有些发沉，脑子开始犯困',
    3: '困意极重，上下眼皮直打架，几乎撑不住',
  },
  mammaryFullness: {
    2: '胸口觉得有些发胀',
    3: '胸部胀痛沉重得十分明显',
  },
  sexualArousal: {
    2: '体内泛起明显的燥热与悸动',
    3: '强烈的冲动与反应翻涌上来',
  },
  libido: {
    2: '心底有些隐隐的悸动与渴望',
    3: '渴望与冲动变得十分强烈',
  },
};

const RESOLVED_EPISODE_LABELS: Readonly<Record<string, string>> = {
  hunger: '一度觉得饿',
  fullness: '一度有些撑胀',
  urinary: '一度憋过尿',
  thirst: '一度有些口渴',
  bowelUrgency: '一度有过便意',
  dryMouth: '一度嘴干',
  dyspnea: '呼吸一度发闷',
  palpitation: '心跳一度发快发慌',
  hypoglycemia: '一度发虚乏力',
  hypocalcemia: '手脚口周一度发麻发紧',
  hypercalcemia: '浑身一度沉重倦怠',
  heat: '一度燥热出过温',
  cold: '一度觉得发凉',
  uterineCramp: '下腹一度隐隐发紧发痛',
  muscleFatigue: '肌肉一度酸沉',
  sweatDamp: '出过汗有点潮湿',
  stress: '心神一度紧绷',
  mammaryFullness: '胸口一度发胀',
  sexualArousal: '一度泛起燥热悸动',
  libido: '一度有些悸动',
};

const INVOLUNTARY_VOID_CLAUSE = '身体一阵失控热流，刚才意外漏尿了';
const SEXUAL_ORGASM_CLAUSE = '强烈的冲动翻涌着，刚经历过一阵释放余韵';

const FALLBACK_SENSATION_TEXTS: Readonly<Record<2 | 3, string>> = {
  2: '身体感受：出现明显的异样感受。',
  3: '身体感受：出现强烈的异样感受。',
};

const SIGNAL_PRIORITY: Readonly<Record<string, number>> = {
  involuntaryVoid: 0,
  dyspnea: 1,
  palpitation: 2,
  hypoglycemia: 3,
  heat: 4,
  cold: 5,
  hypocalcemia: 5.5,
  hypercalcemia: 5.6,
  urinary: 6,
  bowelUrgency: 7,
  thirst: 8,
  dryMouth: 9,
  fullness: 10,
  hunger: 11,
  uterineCramp: 12,
  muscleFatigue: 13,
  sweatDamp: 14,
  stress: 15,
  sleepiness: 16,
  mammaryFullness: 17,
  sexualOrgasm: 17.5,
  sexualOrgasmBlocked: 17.8,
  sexualArousal: 18,
  libido: 19,
};

export const initialState: BrainNotifyState = {
  lastSessionId: null,
  sessions: {},
};

export const fields = {
  lastSessionId: { unit: '1', mode: 'absolute' },
  sessions: { unit: '1', mode: 'absolute' },
};

type ObservedCore = Record<CoreKind, { level: Level; raw: number }>;

type ObservedExpanded = Record<ExpandedKey, {
  level: Level;
  raw: number;
  isCrisis: boolean;
}>;

type ObservedExtensible = {
  key: string;
  level: Level;
  raw: number;
  urgent: boolean;
  text: string;
};

type Candidate = {
  id: string;
  source: 'core' | 'expanded' | 'extensible';
  coreKind?: CoreKind;
  expandedKey?: ExpandedKey;
  extensibleKey?: string;
  level: WaterLevel;
  rawMm: number;
  isCrisis: boolean;
  isUrgent: boolean;
  tier: Tier;
  order: number;
  singleText?: string;
  clause: string;
  resolvedClause: string;
};

const DISALLOWED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(key: string): boolean {
  return key.length > 0 && !DISALLOWED_KEYS.has(key);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stepOrZero(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function waterLevelOrZero(value: unknown): WaterLevel {
  return value === 2 || value === 3 ? value : 0;
}

function validSessionString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isCoreKind(value: unknown): value is CoreKind {
  return value === 'hunger' || value === 'fullness' || value === 'urinary' || value === 'thirst';
}

function hasDigits(text: string): boolean {
  return /\d|\p{Nd}/u.test(text);
}

function stripClauseAffixes(text: string): string {
  return text.trim().replace(/^身体感受[：:]\s*/u, '').replace(/[。！？!?.]+$/u, '').trim();
}

function qualitativeTextOf(rawText: unknown, level: 2 | 3): string {
  if (typeof rawText !== 'string') return FALLBACK_SENSATION_TEXTS[level];
  const trimmed = rawText.trim();
  if (!trimmed || hasDigits(trimmed)) return FALLBACK_SENSATION_TEXTS[level];
  return trimmed;
}

function levelOf(value: number, marked: number, strong: number): Level {
  if (value >= strong) return 3;
  if (value >= marked) return 2;
  if (value >= resetBelow) return 1;
  return 0;
}

function normalizeLevels(
  raw: Readonly<StoredSessionState> | undefined,
  legacyKind: CoreKind | null,
  legacyLevel: Level,
): Levels {
  const levels: Levels = {
    hunger: waterLevelOrZero(raw?.levels?.hunger),
    fullness: waterLevelOrZero(raw?.levels?.fullness),
    urinary: waterLevelOrZero(raw?.levels?.urinary),
    thirst: waterLevelOrZero(raw?.levels?.thirst),
  };
  if (raw?.levels === undefined && legacyKind !== null && (legacyLevel === 2 || legacyLevel === 3)) {
    levels[legacyKind] = legacyLevel;
  }
  return levels;
}

function normalizeWatermarkMap(raw: Record<string, unknown> | undefined): Record<string, WaterLevel> {
  const levels: Record<string, WaterLevel> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!isSafeKey(key)) continue;
      const level = waterLevelOrZero(value);
      if (level > 0) levels[key] = level;
    }
  }
  return levels;
}

function normalizeSleepBacklog(raw: Record<string, unknown> | undefined): Record<string, SleepBacklogEntry> {
  const result: Record<string, SleepBacklogEntry> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (!isSafeKey(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const level = waterLevelOrZero(rec.level);
    if (level === 0) continue;
    const clause = typeof rec.clause === 'string' && !hasDigits(rec.clause) ? rec.clause : '';
    const resolvedClause = typeof rec.resolvedClause === 'string' && !hasDigits(rec.resolvedClause)
      ? rec.resolvedClause
      : '';
    if (!clause) continue;
    result[key] = {
      id: key,
      tier: rec.tier === 'important' ? 'important' : 'normal',
      level,
      clause,
      resolvedClause: resolvedClause || clause,
      stillActive: rec.stillActive === true,
      order: typeof rec.order === 'number' && Number.isFinite(rec.order) ? rec.order : 100,
      ...(isCoreKind(rec.coreKind) ? { coreKind: rec.coreKind } : {}),
      ...(typeof rec.expandedKey === 'string' && EXPANDED_KEYS.includes(rec.expandedKey as ExpandedKey)
        ? { expandedKey: rec.expandedKey as ExpandedKey }
        : {}),
      ...(typeof rec.extensibleKey === 'string' && isSafeKey(rec.extensibleKey)
        ? { extensibleKey: rec.extensibleKey }
        : {}),
    };
  }
  return result;
}

function pruneSleepBacklog(backlog: Record<string, SleepBacklogEntry>): Record<string, SleepBacklogEntry> {
  const entries = Object.entries(backlog);
  if (entries.length <= MAX_SLEEP_BACKLOG_ENTRIES) return backlog;
  entries.sort((a, b) => {
    if (a[1].stillActive !== b[1].stillActive) return a[1].stillActive ? -1 : 1;
    if (b[1].level !== a[1].level) return b[1].level - a[1].level;
    if (a[1].order !== b[1].order) return a[1].order - b[1].order;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return Object.fromEntries(entries.slice(0, MAX_SLEEP_BACKLOG_ENTRIES));
}

function normalizeSession(raw: Readonly<StoredSessionState> | undefined, now: number): SessionState {
  const lastLevel = raw?.lastLevel;
  const normalizedLevel: Level = lastLevel === 1 || lastLevel === 2 || lastLevel === 3 ? lastLevel : 0;
  const lastKind = isCoreKind(raw?.lastKind) ? raw.lastKind : null;
  const sensationLevels = normalizeWatermarkMap(raw?.sensationLevels);
  const sleepBacklog = normalizeSleepBacklog(raw?.sleepBacklog);
  const lastOrgasmAtSimMin = finiteOrNull(raw?.lastOrgasmAtSimMin);
  const lastAttemptedOrgasmAtSimMin = finiteOrNull(raw?.lastAttemptedOrgasmAtSimMin);
  return {
    lastSentAt: finiteOrNull(raw?.lastSentAt),
    backoffStep: stepOrZero(raw?.backoffStep),
    lastUrgentSentAt: finiteOrNull(raw?.lastUrgentSentAt),
    urgentBackoffStep: stepOrZero(raw?.urgentBackoffStep),
    lastInvoluntaryVoidedMl: nonNegativeOrZero(raw?.lastInvoluntaryVoidedMl),
    ...(lastOrgasmAtSimMin !== null ? { lastOrgasmAtSimMin } : {}),
    ...(lastAttemptedOrgasmAtSimMin !== null ? { lastAttemptedOrgasmAtSimMin } : {}),
    lastLevel: normalizedLevel,
    lastKind,
    lastSeenAt: finiteOr(raw?.lastSeenAt, now),
    levels: normalizeLevels(raw, lastKind, normalizedLevel),
    sensations: normalizeWatermarkMap(raw?.sensations),
    ...(Object.keys(sensationLevels).length > 0 ? { sensationLevels } : {}),
    ...(raw?.wasSleeping === true ? { wasSleeping: true } : {}),
    ...(Object.keys(sleepBacklog).length > 0 ? { sleepBacklog } : {}),
  };
}

function requiredIntervalSec(step: number, baseMin: number, maxMin: number): number {
  const safeBase = Math.max(0, baseMin);
  const safeMax = Math.max(safeBase, maxMin);
  const minutes = Math.min(safeMax, safeBase * (2 ** Math.max(0, step)));
  return minutes * 60;
}

function maxBackoffStep(baseMin: number, maxMin: number): number {
  if (baseMin <= 0 || maxMin <= baseMin) return 0;
  return Math.ceil(Math.log2(maxMin / baseMin));
}

function latestSessionId(
  actions: readonly Action[],
  boundSessionId: unknown,
  previous: string | null | undefined,
): string | null {
  const bound = validSessionString(boundSessionId);
  if (bound !== null) return bound;
  let fromAction: string | null = null;
  for (const action of actions) {
    const candidate = validSessionString(action?.sessionId);
    if (candidate !== null) fromAction = candidate;
  }
  return fromAction ?? validSessionString(previous);
}

function collectActionTypes(actions: readonly Action[]): Set<string> {
  const types = new Set<string>();
  for (const action of actions) {
    if (typeof action?.type === 'string' && action.type.length > 0) {
      types.add(action.type);
    }
  }
  return types;
}

function observeCoreSignals(
  io: IO,
  suppressUrinary: boolean,
): ObservedCore {
  const reading = io.read('interoception');
  const rawHunger = finiteOr(reading?.hunger, HUNGER_FALLBACK);
  const rawFullness = finiteOr(reading?.fullness, FULLNESS_FALLBACK);
  const rawThirst = finiteOr(reading?.thirst, THIRST_FALLBACK);
  const rawUrinary = suppressUrinary ? 0 : finiteOr(reading?.urinaryUrgency, URINARY_FALLBACK);

  return {
    hunger: { raw: rawHunger, level: levelOf(rawHunger, hungerMarked, hungerStrong) },
    fullness: { raw: rawFullness, level: levelOf(rawFullness, fullnessMarked, fullnessStrong) },
    thirst: { raw: rawThirst, level: levelOf(rawThirst, thirstMarked, thirstStrong) },
    urinary: { raw: rawUrinary, level: suppressUrinary ? 0 : levelOf(rawUrinary, urinaryMarked, urinaryStrong) },
  };
}

function observeExpandedSignals(
  io: IO,
  options: {
    nsfwEnabled: boolean;
    suppressBowel: boolean;
    suppressSleepiness: boolean;
    suppressMammary: boolean;
  },
): ObservedExpanded {
  const reading = io.read('interoception');
  const rawUterineCramp = reading?.uterineCrampMm ?? io.read('uterus')?.crampMm;
  const rawMammaryFullness = reading?.mammaryFullnessMm ?? io.read('mammaryGlands')?.fullnessMm;
  const systolicMmHg = io.read('blood')?.systolicMmHg;
  const severeHypotension = typeof systolicMmHg === 'number'
    && Number.isFinite(systolicMmHg)
    && systolicMmHg < SEVERE_HYPOTENSION_SBP_MMHG;

  const rawByKey: Record<ExpandedKey, number> = {
    dyspnea: finiteOr(reading?.dyspneaMm, 0),
    palpitation: finiteOr(reading?.palpitationMm, 0),
    hypoglycemia: finiteOr(reading?.hypoglycemiaMm, 0),
    hypocalcemia: finiteOr(reading?.hypocalcemiaMm, 0),
    hypercalcemia: finiteOr(reading?.hypercalcemiaMm, 0),
    heat: finiteOr(reading?.heatMm, 0),
    cold: finiteOr(reading?.coldMm, 0),
    bowelUrgency: options.suppressBowel ? 0 : finiteOr(reading?.bowelUrgencyMm, 0),
    dryMouth: finiteOr(reading?.dryMouthMm, 0),
    uterineCramp: finiteOr(rawUterineCramp, 0),
    muscleFatigue: finiteOr(reading?.muscleFatigueMm, 0),
    sweatDamp: finiteOr(reading?.sweatDampMm, 0),
    stress: finiteOr(reading?.stressMm, 0),
    sleepiness: options.suppressSleepiness ? 0 : finiteOr(reading?.sleepinessMm, 0),
    mammaryFullness: !options.nsfwEnabled || options.suppressMammary
      ? 0
      : finiteOr(rawMammaryFullness, 0),
    sexualArousal: options.nsfwEnabled ? finiteOr(reading?.sexualArousalMm, 0) : 0,
    libido: options.nsfwEnabled ? finiteOr(reading?.libidoMm, 0) : 0,
  };

  const result = {} as ObservedExpanded;
  for (const key of EXPANDED_KEYS) {
    const raw = rawByKey[key];
    let level = levelOf(raw, defaultMarked, defaultStrong);
    let isCrisis = false;
    if (key === 'dyspnea' && raw >= DYSPNEA_CRISIS_MM) {
      isCrisis = true;
    } else if (key === 'palpitation' && severeHypotension) {
      isCrisis = true;
      if (level < 3) level = 3;
    } else if ((key === 'heat' || key === 'cold' || key === 'hypoglycemia') && raw >= defaultStrong) {
      isCrisis = true;
    }
    result[key] = { level, raw, isCrisis };
  }
  return result;
}

function observeExtensibleSensations(io: IO, nsfwEnabled: boolean): ObservedExtensible[] {
  const rawSensations = io.read('interoception')?.sensations;
  if (!rawSensations || typeof rawSensations !== 'object' || Array.isArray(rawSensations)) {
    return [];
  }
  const observed: ObservedExtensible[] = [];
  for (const key of Object.keys(rawSensations).sort()) {
    if (!isSafeKey(key)) continue;
    const entry = rawSensations[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Readonly<{
      intensityMm?: unknown;
      urgent?: unknown;
      nsfw?: unknown;
      contextText?: unknown;
      wakeText?: unknown;
    }>;
    if (record.nsfw === true && !nsfwEnabled) continue;
    if (typeof record.intensityMm !== 'number' || !Number.isFinite(record.intensityMm)) continue;
    const level = levelOf(record.intensityMm, defaultMarked, defaultStrong);
    const urgent = record.urgent === true;
    const rawText = level >= 3 || (level === 2 && urgent)
      ? (record.wakeText ?? record.contextText)
      : level === 2
        ? record.contextText
        : undefined;
    observed.push({
      key,
      level,
      raw: record.intensityMm,
      urgent,
      text: level === 2 || level === 3 ? qualitativeTextOf(rawText, level) : '',
    });
  }
  return observed;
}

function reconcileWatermark(
  prevLevel: WaterLevel,
  observedLevel: Level,
): { next: WaterLevel; normalRelieved: boolean; urgentRelieved: boolean } {
  if (observedLevel === 0) {
    return {
      next: 0,
      normalRelieved: prevLevel > 0,
      urgentRelieved: prevLevel >= wakeAtLevel,
    };
  }
  if (observedLevel === 2 && prevLevel > 2) {
    return {
      next: 2,
      normalRelieved: false,
      urgentRelieved: prevLevel >= wakeAtLevel,
    };
  }
  return {
    next: prevLevel,
    normalRelieved: false,
    urgentRelieved: false,
  };
}

function resetNormalBackoff(session: SessionState): void {
  session.backoffStep = 0;
  session.lastSentAt = null;
}

function resetUrgentBackoff(session: SessionState): void {
  session.urgentBackoffStep = 0;
  session.lastUrgentSentAt = null;
}

function applyActionRelief(
  session: SessionState,
  actionTypesInRound: ReadonlySet<string>,
  prevLevels: Readonly<Levels>,
  prevSensations: Readonly<Record<string, WaterLevel>>,
  prevInvoluntaryVoidedMl: number,
  options: { isSleeping: boolean; voidedMl: number; defecatedG: number; ejectedMilkMl: number },
): void {
  if (actionTypesInRound.has('urinate') || options.voidedMl > 0) {
    session.levels.urinary = 0;
    if (prevLevels.urinary > 0 || (actionTypesInRound.has('urinate') && prevInvoluntaryVoidedMl > 0)) {
      resetNormalBackoff(session);
      if (prevLevels.urinary >= wakeAtLevel || prevInvoluntaryVoidedMl > 0) {
        resetUrgentBackoff(session);
      }
    }
  }

  if (actionTypesInRound.has('defecate') || options.defecatedG > 0) {
    delete session.sensations.bowelUrgency;
    const prevBowel = prevSensations.bowelUrgency ?? 0;
    if (prevBowel > 0) {
      resetNormalBackoff(session);
      if (prevBowel >= wakeAtLevel) resetUrgentBackoff(session);
    }
  }

  if (actionTypesInRound.has('sleep') || options.isSleeping) {
    delete session.sensations.sleepiness;
    const prevSleepiness = prevSensations.sleepiness ?? 0;
    if (prevSleepiness > 0) {
      resetNormalBackoff(session);
      if (prevSleepiness >= wakeAtLevel) resetUrgentBackoff(session);
    }
  }

  if (actionTypesInRound.has('wake_up')) {
    delete session.sensations.sleepiness;
    const prevSleepiness = prevSensations.sleepiness ?? 0;
    if (prevSleepiness > 0 || options.isSleeping) {
      resetNormalBackoff(session);
      if (prevSleepiness >= wakeAtLevel) resetUrgentBackoff(session);
    }
  }

  if (actionTypesInRound.has('eat')) {
    const prevHypo = prevSensations.hypoglycemia ?? 0;
    if (prevLevels.hunger > 0 || prevHypo > 0) {
      resetNormalBackoff(session);
      if (prevLevels.hunger >= wakeAtLevel || prevHypo >= wakeAtLevel) {
        resetUrgentBackoff(session);
      }
    }
  }

  if (actionTypesInRound.has('drink')) {
    const prevDryMouth = prevSensations.dryMouth ?? 0;
    if (prevLevels.thirst > 0 || prevDryMouth > 0) {
      resetNormalBackoff(session);
      if (prevLevels.thirst >= wakeAtLevel || prevDryMouth >= wakeAtLevel) {
        resetUrgentBackoff(session);
      }
    }
  }

  if (actionTypesInRound.has('stop_exercise')) {
    const exerciseChannels: readonly ExpandedKey[] = [
      'muscleFatigue',
      'sweatDamp',
      'dyspnea',
      'palpitation',
    ];
    let relievedNormal = false;
    let relievedUrgent = false;
    for (const key of exerciseChannels) {
      const prevLevel = prevSensations[key] ?? 0;
      if (prevLevel > 0) relievedNormal = true;
      if (prevLevel >= wakeAtLevel) relievedUrgent = true;
    }
    if (relievedNormal) resetNormalBackoff(session);
    if (relievedUrgent) resetUrgentBackoff(session);
  }

  if (
    actionTypesInRound.has('express_milk')
    || actionTypesInRound.has('breastfeed')
    || options.ejectedMilkMl > 0
  ) {
    delete session.sensations.mammaryFullness;
    const prevMammary = prevSensations.mammaryFullness ?? 0;
    if (prevMammary > 0) {
      resetNormalBackoff(session);
      if (prevMammary >= wakeAtLevel) resetUrgentBackoff(session);
    }
  }
}

function buildCandidates(
  session: Readonly<SessionState>,
  nextSensationLevels: Readonly<Record<string, WaterLevel>>,
  observedCore: Readonly<ObservedCore>,
  observedExpanded: Readonly<ObservedExpanded>,
  observedExtensible: readonly ObservedExtensible[],
  involuntaryVoidTriggered: boolean,
  sexualOrgasmPhase: boolean,
  orgasmEventTriggered: boolean,
): Candidate[] {
  const candidates: Candidate[] = [];

  if (involuntaryVoidTriggered) {
    candidates.push({
      id: 'involuntaryVoid',
      source: 'expanded',
      level: 3,
      rawMm: 100,
      isCrisis: true,
      isUrgent: true,
      tier: 'emergency',
      order: SIGNAL_PRIORITY.involuntaryVoid,
      clause: INVOLUNTARY_VOID_CLAUSE,
      resolvedClause: '睡着时曾意外漏尿',
    });
  }

  if (orgasmEventTriggered) {
    candidates.push({
      id: 'sexualOrgasm',
      source: 'expanded',
      level: 3,
      rawMm: 95,
      isCrisis: false,
      isUrgent: true,
      tier: 'important',
      order: SIGNAL_PRIORITY.sexualOrgasm,
      clause: SEXUAL_ORGASM_CLAUSE,
      resolvedClause: '曾经历过一阵释放余韵',
    });
  }

  for (const kind of CORE_ORDER) {
    const { level, raw } = observedCore[kind];
    if (level !== 2 && level !== 3) continue;
    if (level <= session.levels[kind]) continue;
    const isUrgent = level >= wakeAtLevel;
    candidates.push({
      id: kind,
      source: 'core',
      coreKind: kind,
      level,
      rawMm: raw,
      isCrisis: false,
      isUrgent,
      tier: isUrgent ? 'important' : 'normal',
      order: SIGNAL_PRIORITY[kind],
      singleText: TEXTS[kind][level],
      clause: CORE_CLAUSES[kind][level],
      resolvedClause: RESOLVED_EPISODE_LABELS[kind] ?? CORE_CLAUSES[kind][level],
    });
  }

  for (const key of EXPANDED_KEYS) {
    if (key === 'sexualArousal' && orgasmEventTriggered) continue;
    const { level, raw, isCrisis } = observedExpanded[key];
    if (level !== 2 && level !== 3) continue;
    if (level <= (session.sensations[key] ?? 0)) continue;
    const clause = key === 'sexualArousal' && level === 3 && sexualOrgasmPhase
      ? SEXUAL_ORGASM_CLAUSE
      : EXPANDED_CLAUSES[key][level];
    const isUrgent = isCrisis || level >= wakeAtLevel;
    const tier: Tier = isCrisis ? 'emergency' : isUrgent ? 'important' : 'normal';
    candidates.push({
      id: key,
      source: 'expanded',
      expandedKey: key,
      level,
      rawMm: raw,
      isCrisis,
      isUrgent,
      tier,
      order: SIGNAL_PRIORITY[key],
      clause,
      resolvedClause: RESOLVED_EPISODE_LABELS[key] ?? clause,
    });
  }

  for (const entry of observedExtensible) {
    if (entry.level !== 2 && entry.level !== 3) continue;
    if (entry.level <= (nextSensationLevels[entry.key] ?? 0)) continue;
    const isUrgent = entry.urgent || entry.level >= wakeAtLevel;
    const tier: Tier = entry.urgent ? 'emergency' : isUrgent ? 'important' : 'normal';
    const stripped = stripClauseAffixes(entry.text);
    candidates.push({
      id: `ext:${entry.key}`,
      source: 'extensible',
      extensibleKey: entry.key,
      level: entry.level,
      rawMm: entry.raw,
      isCrisis: entry.urgent,
      isUrgent,
      tier,
      order: 100,
      singleText: entry.text,
      clause: stripped,
      resolvedClause: `曾${stripped}`,
    });
  }

  candidates.sort((a, b) => {
    if (a.isCrisis !== b.isCrisis) return a.isCrisis ? -1 : 1;
    if (b.level !== a.level) return b.level - a.level;
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return candidates;
}

function formatBoundedText(
  prefix: string,
  clauses: readonly string[],
  maxLen: number,
  fallbackText: string,
): string {
  const suffix = '。';
  let body = '';
  for (const rawClause of clauses) {
    const clause = stripClauseAffixes(rawClause);
    if (!clause) continue;
    const next = body ? `${body}；${clause}` : clause;
    if (prefix.length + next.length + suffix.length <= maxLen) {
      body = next;
    } else if (!body) {
      const budget = Math.max(1, maxLen - prefix.length - suffix.length);
      body = clause.slice(0, budget);
      break;
    } else {
      break;
    }
  }
  const text = body ? `${prefix}${body}${suffix}` : fallbackText;
  if (hasDigits(text) || !text.trim()) return fallbackText;
  return text;
}

function formatNotificationText(
  candidates: readonly Candidate[],
  mode: Mode,
  options: { startleWake?: boolean } = {},
): string {
  if (options.startleWake) {
    const clauses: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const clause = stripClauseAffixes(candidate.clause);
      if (!clause || seen.has(clause)) continue;
      seen.add(clause);
      clauses.push(clause);
    }
    return formatBoundedText(
      '身体感受：睡梦中被突发危机惊醒，心跳骤然加快——',
      clauses,
      MAX_AGGREGATED_TEXT_LENGTH,
      '身体感受：睡梦中被突发危机惊醒，心跳骤然加快。',
    );
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    const single = only.singleText !== undefined
      ? only.singleText
      : `身体感受：${stripClauseAffixes(only.clause)}。`;
    return hasDigits(single) || !single.trim()
      ? FALLBACK_SENSATION_TEXTS[mode === 'wake' ? 3 : 2]
      : single;
  }

  const clauses: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const clause = stripClauseAffixes(candidate.clause);
    if (!clause || seen.has(clause)) continue;
    seen.add(clause);
    clauses.push(clause);
  }
  return formatBoundedText(
    '身体感受：',
    clauses,
    MAX_AGGREGATED_TEXT_LENGTH,
    FALLBACK_SENSATION_TEXTS[mode === 'wake' ? 3 : 2],
  );
}

function wakeHeaderFor(reason: Exclude<WakeEvent, 'none'>): string {
  switch (reason) {
    case 'natural':
      return '已经自然睡醒，脱离了睡眠状态';
    case 'important':
      return '睡梦中被强烈的不适感唤醒，脱离了睡眠状态';
    case 'speech':
      return '因开口说话已经醒来，脱离了睡眠状态';
    case 'action':
      return '因起身活动已经醒来，脱离了睡眠状态';
    case 'startle':
      return '睡梦中被突发危机惊醒，脱离了睡眠状态';
  }
}

function formatWakeSummaryText(
  wakeReason: Exclude<WakeEvent, 'none'>,
  activeClauses: readonly string[],
  resolvedEpisodes: readonly string[],
  sleepInertiaMm = 0,
): string {
  const parts: string[] = [wakeHeaderFor(wakeReason)];
  if (sleepInertiaMm >= 35 && wakeReason !== 'startle') {
    parts.push('刚醒来脑子还有点昏沉犯迷糊');
  }
  const seen = new Set<string>();
  for (const clause of activeClauses) {
    const cleaned = stripClauseAffixes(clause);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    parts.push(cleaned);
  }
  const uniqueResolved: string[] = [];
  const seenResolved = new Set<string>();
  for (const ep of resolvedEpisodes) {
    const cleaned = stripClauseAffixes(ep);
    if (!cleaned || seenResolved.has(cleaned)) continue;
    seenResolved.add(cleaned);
    uniqueResolved.push(cleaned);
  }
  if (uniqueResolved.length > 0) {
    parts.push(`睡着期间曾出现过${uniqueResolved.join('、')}，后来已经平复`);
  }
  return formatBoundedText(
    '身体感受：',
    parts,
    MAX_WAKE_SUMMARY_TEXT_LENGTH,
    `身体感受：${wakeHeaderFor(wakeReason)}。`,
  );
}

function highestObservedLevel(
  observedCore: Readonly<ObservedCore>,
  observedExpanded: Readonly<ObservedExpanded>,
  observedExtensible: readonly ObservedExtensible[],
): Level {
  let highest: Level = 0;
  for (const kind of CORE_ORDER) {
    if (observedCore[kind].level > highest) highest = observedCore[kind].level;
  }
  for (const key of EXPANDED_KEYS) {
    if (observedExpanded[key].level > highest) highest = observedExpanded[key].level;
  }
  for (const entry of observedExtensible) {
    if (entry.level > highest) highest = entry.level;
  }
  return highest;
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

function applyCandidateWatermark(
  session: SessionState,
  nextSensationLevels: Record<string, WaterLevel>,
  candidate: {
    id: string;
    level: WaterLevel;
    coreKind?: CoreKind;
    expandedKey?: ExpandedKey;
    extensibleKey?: string;
  },
  involuntaryVoidedMl: number,
  curLastOrgasmAtSimMin: number | null,
  curLastAttemptedAtSimMin: number | null = null,
): void {
  if (candidate.id === 'involuntaryVoid') {
    session.lastInvoluntaryVoidedMl = involuntaryVoidedMl;
  } else if (candidate.id === 'sexualOrgasm') {
    if (curLastOrgasmAtSimMin !== null) {
      session.lastOrgasmAtSimMin = curLastOrgasmAtSimMin;
    }
  } else if (candidate.id === 'sexualOrgasmBlocked') {
    if (curLastAttemptedAtSimMin !== null) {
      session.lastAttemptedOrgasmAtSimMin = curLastAttemptedAtSimMin;
    }
  } else if (candidate.coreKind !== undefined) {
    session.levels[candidate.coreKind] = candidate.level;
  } else if (candidate.expandedKey !== undefined) {
    session.sensations[candidate.expandedKey] = candidate.level;
  } else if (candidate.extensibleKey !== undefined) {
    nextSensationLevels[candidate.extensibleKey] = candidate.level;
  }
}

export function heartbeat(io: IO): void {
  const prev = io.read(id);
  const now = finiteOr(io.simulatedSeconds, 0);
  const sessionId = latestSessionId(io.actions, io.boundSessionId, prev?.lastSessionId);

  if (sessionId === null) {
    io.write({
      lastSessionId: prev?.lastSessionId ?? null,
      sessions: prev?.sessions ?? {},
    });
    return;
  }

  const sessions: Record<string, SessionState> = {};
  for (const [key, raw] of Object.entries(prev?.sessions ?? {})) {
    if (!isSafeKey(key)) continue;
    sessions[key] = normalizeSession(raw, now);
  }

  const session = sessions[sessionId] ?? normalizeSession(undefined, now);
  session.lastSeenAt = now;

  const prevLevels: Levels = { ...session.levels };
  const prevSensations: Record<string, WaterLevel> = { ...session.sensations };
  const prevInvoluntaryVoidedMl = session.lastInvoluntaryVoidedMl;

  const actionTypesInRound = collectActionTypes(io.actions);
  const bladder = io.read('bladder');
  const voidedMl = nonNegativeOrZero(bladder?.voidedMl);
  const involuntaryVoidedMl = nonNegativeOrZero(bladder?.involuntaryVoidedMl);
  const defecatedG = nonNegativeOrZero(io.read('colon')?.defecatedG);
  const mammary = io.read('mammaryGlands');
  const ejectedMilkMl = nonNegativeOrZero(mammary?.ejectedMilkMl);
  const mammaryLactating = mammary?.lactating === true;

  const sleep = io.read('sleep');
  const prevSleeping = sleep?.sleeping === true;
  const sleepStage: SleepStage = !prevSleeping
    ? 'awake'
    : sleep?.sleepStage === 'light' || sleep?.sleepStage === 'deep' || sleep?.sleepStage === 'rem'
      ? sleep.sleepStage
      : 'light';
  const nsfwEnabled = getNsfwSetting() !== false;

  const evalIo = {
    read: (partId: string) => io.read(partId as never) as Readonly<Record<string, unknown>> | undefined,
    actions: io.actions,
  };
  const evalResult = evaluateSleepWakeSignals(evalIo, { sleepStage, nsfwEnabled });
  let wakeReason: Exclude<WakeEvent, 'none'> | null = null;
  if (prevSleeping) {
    const pineal = io.read('pineal');
    const transition = evaluateSleepTransition(evalIo, {
      prevSleeping,
      sleepStage,
      sleepPressureMm: sleep?.sleepPressureMm,
      sleepDurationMin: sleep?.sleepDurationMin,
      pinealMelatoninRelative: pineal?.melatoninRelative,
      hasPineal: pineal !== undefined,
      dtMin: Math.max(0, finiteOr(io.dt, 60) / 60),
      nsfwEnabled,
      signals: evalResult,
    });
    wakeReason = transition.sleeping || transition.wakeEvent === 'none'
      ? null
      : transition.wakeEvent;
  } else if (session.wasSleeping === true) {
    const rawWakeEvent = sleep?.wakeEvent;
    wakeReason = rawWakeEvent === 'startle'
      || rawWakeEvent === 'important'
      || rawWakeEvent === 'speech'
      || rawWakeEvent === 'action'
      || rawWakeEvent === 'natural'
      ? rawWakeEvent
      : 'natural';
  }

  const stillSleeping = prevSleeping && wakeReason === null;
  const suppressUrinary = voidedMl > 0 || involuntaryVoidedMl > 0 || actionTypesInRound.has('urinate');
  const suppressBowel = defecatedG > 0 || actionTypesInRound.has('defecate');
  const suppressSleepiness = stillSleeping || prevSleeping || actionTypesInRound.has('sleep');
  const suppressMammary = ejectedMilkMl > 0
    || (mammaryLactating && (actionTypesInRound.has('express_milk') || actionTypesInRound.has('breastfeed')));

  const observedCore = observeCoreSignals(io, suppressUrinary);
  const observedExpanded = observeExpandedSignals(io, {
    nsfwEnabled,
    suppressBowel,
    suppressSleepiness,
    suppressMammary,
  });
  const observedExtensible = observeExtensibleSensations(io, nsfwEnabled);

  let normalRelieved = false;
  let urgentRelieved = false;

  for (const kind of CORE_ORDER) {
    const res = reconcileWatermark(session.levels[kind], observedCore[kind].level);
    session.levels[kind] = res.next;
    if (res.normalRelieved) normalRelieved = true;
    if (res.urgentRelieved) urgentRelieved = true;
  }

  const nextExpanded: Record<string, WaterLevel> = {};
  for (const key of EXPANDED_KEYS) {
    const prevWater = waterLevelOrZero(session.sensations[key]);
    const obs = observedExpanded[key];
    const res = reconcileWatermark(prevWater, obs.level);
    if (res.next > 0) nextExpanded[key] = res.next;
    if (res.normalRelieved) normalRelieved = true;
    if (res.urgentRelieved) urgentRelieved = true;
  }
  session.sensations = nextExpanded;

  const nextSensationLevels: Record<string, WaterLevel> = {};
  for (const entry of observedExtensible) {
    const prevWater = waterLevelOrZero(session.sensationLevels?.[entry.key]);
    const res = reconcileWatermark(prevWater, entry.level);
    if (res.next > 0) nextSensationLevels[entry.key] = res.next;
    if (res.normalRelieved) normalRelieved = true;
    if (res.urgentRelieved) urgentRelieved = true;
  }

  if (involuntaryVoidedMl <= 0) {
    session.lastInvoluntaryVoidedMl = 0;
  }

  if (normalRelieved) resetNormalBackoff(session);
  if (urgentRelieved) resetUrgentBackoff(session);

  applyActionRelief(session, actionTypesInRound, prevLevels, prevSensations, prevInvoluntaryVoidedMl, {
    isSleeping: stillSleeping,
    voidedMl: voidedMl + involuntaryVoidedMl,
    defecatedG,
    ejectedMilkMl,
  });

  const involuntaryVoidTriggered = involuntaryVoidedMl > 0 && prevInvoluntaryVoidedMl <= 0;
  const sexualResponse = io.read('sexualResponse');
  const sexualOrgasmPhase = nsfwEnabled && sexualResponse?.phase === 'orgasm';
  const curLastOrgasmAtSimMin = nsfwEnabled
    ? finiteOrNull(sexualResponse?.lastOrgasmAtSimMin)
    : null;
  if (
    curLastOrgasmAtSimMin !== null
    && (now / 60) - curLastOrgasmAtSimMin > 5
    && session.lastOrgasmAtSimMin !== curLastOrgasmAtSimMin
  ) {
    session.lastOrgasmAtSimMin = curLastOrgasmAtSimMin;
  }
  const orgasmEventTriggered = nsfwEnabled
    && !stillSleeping
    && curLastOrgasmAtSimMin !== null
    && curLastOrgasmAtSimMin !== (session.lastOrgasmAtSimMin ?? null);

  if (orgasmEventTriggered && actionTypesInRound.has('orgasm')) {
    const hadPostActivitySensation = (prevSensations.sexualArousal ?? 0) > 0
      || (prevSensations.sweatDamp ?? 0) > 0
      || (prevSensations.palpitation ?? 0) > 0
      || (prevSensations.dyspnea ?? 0) > 0;
    if (hadPostActivitySensation) {
      resetNormalBackoff(session);
      if (
        (prevSensations.sexualArousal ?? 0) >= wakeAtLevel
        || (prevSensations.sweatDamp ?? 0) >= wakeAtLevel
        || (prevSensations.palpitation ?? 0) >= wakeAtLevel
        || (prevSensations.dyspnea ?? 0) >= wakeAtLevel
      ) {
        resetUrgentBackoff(session);
      }
    }
  }

  const curLastAttemptedAt = nsfwEnabled
    ? finiteOrNull(sexualResponse?.lastAttemptedOrgasmAtSimMin)
    : null;
  if (
    curLastAttemptedAt !== null
    && (now / 60) - curLastAttemptedAt > 5
    && session.lastAttemptedOrgasmAtSimMin !== curLastAttemptedAt
  ) {
    session.lastAttemptedOrgasmAtSimMin = curLastAttemptedAt;
  }
  const curBlockReason = sexualResponse?.lastOrgasmBlockReason;
  const blockedOrgasmReason: 'below_threshold' | 'refractory' | null = nsfwEnabled
    && !stillSleeping
    && curLastAttemptedAt !== null
    && curLastAttemptedAt !== (session.lastAttemptedOrgasmAtSimMin ?? null)
    && (curLastOrgasmAtSimMin === null || curLastAttemptedAt > curLastOrgasmAtSimMin)
    && (curBlockReason === 'below_threshold' || curBlockReason === 'refractory')
    ? curBlockReason
    : null;

  const candidates = buildCandidates(
    session,
    nextSensationLevels,
    observedCore,
    observedExpanded,
    observedExtensible,
    involuntaryVoidTriggered,
    sexualOrgasmPhase,
    orgasmEventTriggered,
  );
  if (blockedOrgasmReason !== null) {
    candidates.push({
      id: 'sexualOrgasmBlocked',
      source: 'expanded',
      level: 2,
      rawMm: 50,
      isCrisis: false,
      isUrgent: false,
      tier: 'normal',
      order: SIGNAL_PRIORITY.sexualOrgasmBlocked,
      clause: blockedOrgasmReason === 'refractory'
        ? '刚才尝试再次推进高潮，但身体仍处在不应余缓期，没能跨过去'
        : '刚才试着推向高潮，但当前唤起蓄积还不够深，没能跨过释放门槛',
      resolvedClause: '刚才试图高潮未果，情绪与唤起已渐平复',
    });
  }

  const backlog: Record<string, SleepBacklogEntry> = { ...(session.sleepBacklog ?? {}) };
  const observedLevelById = new Map<string, Level>();
  for (const kind of CORE_ORDER) observedLevelById.set(kind, observedCore[kind].level);
  for (const key of EXPANDED_KEYS) observedLevelById.set(key, observedExpanded[key].level);
  for (const entry of observedExtensible) observedLevelById.set(`ext:${entry.key}`, entry.level);

  for (const [key, entry] of Object.entries(backlog)) {
    const curLevel = observedLevelById.get(key) ?? 0;
    if (curLevel < 2) {
      backlog[key] = { ...entry, stillActive: false };
    } else {
      backlog[key] = { ...entry, stillActive: true };
    }
  }

  const sleepThreshold = resolveSleepImportantThresholdMm(sleepStage);
  if (stillSleeping) {
    for (const candidate of candidates) {
      if (candidate.tier === 'emergency') continue;
      if (candidate.expandedKey === 'sleepiness') continue;
      if (candidate.tier === 'important' && candidate.rawMm >= sleepThreshold) continue;
      const existing = backlog[candidate.id];
      const nextLevel = existing && existing.level > candidate.level ? existing.level : candidate.level;
      const useExistingClause = existing && existing.level > candidate.level;
      backlog[candidate.id] = {
        id: candidate.id,
        tier: candidate.tier,
        level: nextLevel,
        clause: useExistingClause ? existing.clause : candidate.clause,
        resolvedClause: useExistingClause ? existing.resolvedClause : candidate.resolvedClause,
        stillActive: true,
        order: candidate.order,
        ...(candidate.coreKind !== undefined ? { coreKind: candidate.coreKind } : {}),
        ...(candidate.expandedKey !== undefined ? { expandedKey: candidate.expandedKey } : {}),
        ...(candidate.extensibleKey !== undefined ? { extensibleKey: candidate.extensibleKey } : {}),
      };
    }
  }

  const emergencyCandidates = candidates.filter((candidate) => candidate.tier === 'emergency');
  const importantCandidates = candidates.filter((candidate) => candidate.tier === 'important');
  const normalCandidates = candidates.filter((candidate) => candidate.tier === 'normal');

  const urgentCooldownReady = session.lastUrgentSentAt === null
    || now - session.lastUrgentSentAt >= requiredIntervalSec(
      session.urgentBackoffStep,
      urgentBaseIntervalMin,
      urgentMaxIntervalMin,
    );
  const normalCooldownReady = session.lastSentAt === null
    || now - session.lastSentAt >= requiredIntervalSec(
      session.backoffStep,
      baseIntervalMin,
      maxIntervalMin,
    );

  const canDeliver = io.suppressNotifications !== true && sessionId.length <= MAX_SESSION_ID_LENGTH;

  let sent = false;

  if (canDeliver && emergencyCandidates.length > 0 && (wakeReason === 'startle' || urgentCooldownReady)) {
    const text = formatNotificationText(emergencyCandidates, 'wake', {
      startleWake: wakeReason === 'startle',
    });
    io.notify({ mode: 'wake', sessionId, text });
    sent = true;

    let maxSentLevel: WaterLevel = 2;
    for (const candidate of emergencyCandidates) {
      if (candidate.level > maxSentLevel) maxSentLevel = candidate.level;
      applyCandidateWatermark(
        session,
        nextSensationLevels,
        candidate,
        involuntaryVoidedMl,
        curLastOrgasmAtSimMin,
      );
    }
    session.lastLevel = maxSentLevel;
    session.lastKind = null;
    session.lastUrgentSentAt = now;
    session.urgentBackoffStep = Math.min(
      maxBackoffStep(urgentBaseIntervalMin, urgentMaxIntervalMin),
      session.urgentBackoffStep + 1,
    );
    if (!prevSleeping || Object.keys(backlog).length === 0) {
      session.lastSentAt = now;
    }
  } else if (canDeliver && wakeReason !== null) {
    // 非紧急脱离睡眠：强制以 mode: 'wake' 明确告知已醒来并集中消化 sleepBacklog
    const backlogList = Object.values(backlog).sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      if (a.order !== b.order) return a.order - b.order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const activeEntriesById = new Map<string, {
      id: string;
      level: WaterLevel;
      order: number;
      clause: string;
      coreKind?: CoreKind;
      expandedKey?: ExpandedKey;
      extensibleKey?: string;
    }>();

    for (const entry of backlogList) {
      if (!entry.stillActive) continue;
      activeEntriesById.set(entry.id, entry);
    }
    for (const candidate of [...importantCandidates, ...normalCandidates]) {
      if (candidate.expandedKey === 'sleepiness') continue;
      const prevEntry = activeEntriesById.get(candidate.id);
      if (!prevEntry || candidate.level >= prevEntry.level) {
        activeEntriesById.set(candidate.id, candidate);
      }
    }

    const activeEntries = [...activeEntriesById.values()].sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      if (a.order !== b.order) return a.order - b.order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const resolvedEpisodes = backlogList
      .filter((entry) => !entry.stillActive && !activeEntriesById.has(entry.id))
      .map((entry) => entry.resolvedClause);

    const wakeInertiaMm = prevSleeping
      ? (wakeReason === 'natural' ? 15 : sleepStage === 'deep' ? 65 : 40)
      : finiteOr(sleep?.sleepInertiaMm, 0);
    const text = formatWakeSummaryText(
      wakeReason,
      activeEntries.map((entry) => entry.clause),
      resolvedEpisodes,
      wakeInertiaMm,
    );
    io.notify({ mode: 'wake', sessionId, text });
    sent = true;

    let maxSentLevel: WaterLevel = 2;
    let hasImportantInSummary = false;
    for (const entry of activeEntries) {
      if (entry.level > maxSentLevel) maxSentLevel = entry.level;
      if (entry.level >= 3) hasImportantInSummary = true;
      applyCandidateWatermark(
        session,
        nextSensationLevels,
        entry,
        involuntaryVoidedMl,
        curLastOrgasmAtSimMin,
      );
    }
    session.lastLevel = activeEntries.length > 0 ? maxSentLevel : 0;
    session.lastKind = null;
    if (hasImportantInSummary) {
      session.lastUrgentSentAt = now;
    }
    if (activeEntries.length > 0 || resolvedEpisodes.length > 0) {
      session.lastSentAt = now;
    }
    for (const key of Object.keys(backlog)) delete backlog[key];
  } else if (canDeliver && !stillSleeping) {
    const deferredBacklog = Object.values(backlog);
    if (importantCandidates.length > 0 && urgentCooldownReady) {
      const sentCandidates = [...importantCandidates, ...normalCandidates];
      const text = formatNotificationText(sentCandidates, 'wake');
      io.notify({ mode: 'wake', sessionId, text });
      sent = true;

      let maxSentLevel: WaterLevel = 2;
      for (const candidate of sentCandidates) {
        if (candidate.level > maxSentLevel) maxSentLevel = candidate.level;
        applyCandidateWatermark(
          session,
          nextSensationLevels,
          candidate,
          involuntaryVoidedMl,
          curLastOrgasmAtSimMin,
          curLastAttemptedAt,
        );
      }
      session.lastLevel = maxSentLevel;
      session.lastKind = sentCandidates.length === 1 && sentCandidates[0].coreKind !== undefined
        ? sentCandidates[0].coreKind
        : null;
      session.lastUrgentSentAt = now;
      session.urgentBackoffStep = Math.min(
        maxBackoffStep(urgentBaseIntervalMin, urgentMaxIntervalMin),
        session.urgentBackoffStep + 1,
      );
      session.lastSentAt = now;
      for (const key of Object.keys(backlog)) delete backlog[key];
    } else if (
      (normalCandidates.length > 0 || deferredBacklog.length > 0)
      && normalCooldownReady
    ) {
      if (deferredBacklog.length > 0) {
        const activeList = deferredBacklog
          .filter((e) => e.stillActive)
          .map((e) => e.clause);
        const normalClauses = normalCandidates.map((c) => c.clause);
        const resolved = deferredBacklog
          .filter((e) => !e.stillActive)
          .map((e) => e.resolvedClause);
        const allClauses = [...activeList, ...normalClauses];
        if (resolved.length > 0) {
          allClauses.push(`此前睡着期间曾出现过${resolved.join('、')}，后来已经平复`);
        }
        const text = formatBoundedText(
          '身体感受：',
          allClauses,
          MAX_WAKE_SUMMARY_TEXT_LENGTH,
          FALLBACK_SENSATION_TEXTS[2],
        );
        io.notify({ mode: 'context', sessionId, text });
        for (const entry of deferredBacklog.filter((e) => e.stillActive)) {
          applyCandidateWatermark(
            session,
            nextSensationLevels,
            entry,
            involuntaryVoidedMl,
            curLastOrgasmAtSimMin,
          );
        }
        for (const candidate of normalCandidates) {
          applyCandidateWatermark(
            session,
            nextSensationLevels,
            candidate,
            involuntaryVoidedMl,
            curLastOrgasmAtSimMin,
            curLastAttemptedAt,
          );
        }
        for (const key of Object.keys(backlog)) delete backlog[key];
      } else {
        const text = formatNotificationText(normalCandidates, 'context');
        io.notify({ mode: 'context', sessionId, text });
        for (const candidate of normalCandidates) {
          applyCandidateWatermark(
            session,
            nextSensationLevels,
            candidate,
            involuntaryVoidedMl,
            curLastOrgasmAtSimMin,
            curLastAttemptedAt,
          );
        }
      }
      sent = true;
      session.lastLevel = 2;
      session.lastKind = normalCandidates.length === 1 && normalCandidates[0].coreKind !== undefined
        ? normalCandidates[0].coreKind
        : null;
      session.lastSentAt = now;
      session.backoffStep = Math.min(
        maxBackoffStep(baseIntervalMin, maxIntervalMin),
        session.backoffStep + 1,
      );
    } else if (blockedOrgasmReason !== null && curLastAttemptedAt !== null) {
      const blockedCandidate = normalCandidates.find((c) => c.id === 'sexualOrgasmBlocked');
      if (blockedCandidate) {
        io.notify({
          mode: 'context',
          sessionId,
          text: formatNotificationText([blockedCandidate], 'context'),
        });
        applyCandidateWatermark(
          session,
          nextSensationLevels,
          blockedCandidate,
          involuntaryVoidedMl,
          curLastOrgasmAtSimMin,
          curLastAttemptedAt,
        );
        sent = true;
      }
    }
  }

  if (!sent) {
    const highest = highestObservedLevel(observedCore, observedExpanded, observedExtensible);
    if (highest < session.lastLevel) session.lastLevel = highest;
  }

  if (stillSleeping || (actionTypesInRound.has('sleep') && !prevSleeping && wakeReason === null)) {
    session.wasSleeping = true;
  } else {
    delete session.wasSleeping;
  }

  const prunedBacklog = pruneSleepBacklog(backlog);
  if (Object.keys(prunedBacklog).length > 0) {
    session.sleepBacklog = prunedBacklog;
  } else {
    delete session.sleepBacklog;
  }

  if (Object.keys(nextSensationLevels).length > 0) {
    session.sensationLevels = nextSensationLevels;
  } else {
    delete session.sensationLevels;
  }

  sessions[sessionId] = session;
  io.write({
    lastSessionId: sessionId,
    sessions: pruneSessions(sessions, sessionId, maxTrackedSessions),
  });
}
