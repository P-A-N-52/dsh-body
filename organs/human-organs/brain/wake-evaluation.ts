/**
 * 睡眠唤醒与紧急惊醒共享判据（纯函数，无副作用）。
 *
 * 供 `brain/sleep`、`brain/autonomic`、`heart/heart` 与 `brain/notify` 在同一轮心跳内基于相同的
 * 轮初冻结快照判定：
 * - `emergencyTriggered`：高危生理危机（严重缺氧、高热、失温、严重低血糖、休克低血压、
 *   非自主漏尿或扩展 `urgent: true`），睡眠中触发同轮惊醒与交感活跃；
 * - `importantSleepTriggered`：一般强烈不适在睡眠期跨过抬高阈值（浅睡/REM 默认 92 mm，
 *   深睡默认 95 mm），触发常规唤醒脱离睡眠而不触发剧烈惊醒；
 * - 有序动作判定：`endsWithSleepAction` / `endsWithWakeAction` 按 `io.actions` 实际先后顺序判定；
 * - `willNaturallyWakeThisRound`：与 `brain/sleep` 共享的自然转醒预测，避免通知与自主神经滞后一轮。
 *
 * 科学方向（均标 design / policy，具体阈值无独立 PSG 拟合）：
 * - `SRC-BORBELY-2016` (borbely-2016.md)：Process S 稳态压力 + Process C 生物钟联合门控转醒；
 * - `SRC-DIJK-1995` (dijk-1995.md)：深睡慢波由高睡眠压力主导，后期及昼夜生物夜相位后移向 REM；
 * - `SRC-PHILLIPS-2007` (phillips-2007.md)：醒-睡双向切换开关与阈值滞回方向。
 */
import { getNsfwSetting, loadParameters, requireParameter } from '../../../lib/parameters.js';

export type SleepStage = 'awake' | 'light' | 'deep' | 'rem';
export type WakeEvent = 'none' | 'natural' | 'action' | 'important' | 'startle' | 'speech';

export const ACTIVE_WAKING_ACTION_TYPES: ReadonlySet<string> = new Set([
  'eat',
  'drink',
  'urinate',
  'defecate',
  'exercise',
  'sex',
  'orgasm',
  'express_milk',
  'breastfeed',
]);

const NOTIFY_PARAMS = loadParameters(new URL('./notify.parameters.json', import.meta.url));
const defaultMarked = requireParameter(NOTIFY_PARAMS, 'brainNotify.default.marked');
const defaultStrong = requireParameter(NOTIFY_PARAMS, 'brainNotify.default.strong');
const sleepImportantThresholdMm = requireParameter(NOTIFY_PARAMS, 'brainNotify.sleepImportantThresholdMm');
const deepSleepImportantThresholdMm = requireParameter(NOTIFY_PARAMS, 'brainNotify.deepSleepImportantThresholdMm');

const SLEEP_PARAMS = loadParameters(new URL('./sleep.parameters.json', import.meta.url));
const sleepRecoveryHalfTimeMin = requireParameter(SLEEP_PARAMS, 'sleep.sleepRecoveryHalfTimeMin');
const deepRecoveryMultiplier = requireParameter(SLEEP_PARAMS, 'sleep.deepRecoveryMultiplier');
const remRecoveryMultiplier = requireParameter(SLEEP_PARAMS, 'sleep.remRecoveryMultiplier');
const naturalWakePressureThresholdMm = requireParameter(SLEEP_PARAMS, 'sleep.naturalWakePressureThresholdMm');
const naturalWakeMinDurationMin = requireParameter(SLEEP_PARAMS, 'sleep.naturalWakeMinDurationMin');
const naturalWakeMelatoninCeilingRelative = requireParameter(SLEEP_PARAMS, 'sleep.naturalWakeMelatoninCeilingRelative');
const fullRestNaturalWakePressureMm = requireParameter(SLEEP_PARAMS, 'sleep.fullRestNaturalWakePressureMm');
const fullRestNaturalWakeMinDurationMin = requireParameter(SLEEP_PARAMS, 'sleep.fullRestNaturalWakeMinDurationMin');
const cyclePeriodMin = requireParameter(SLEEP_PARAMS, 'sleep.cyclePeriodMin');
const earlyDeepWindowMin = requireParameter(SLEEP_PARAMS, 'sleep.earlyDeepWindowMin');
const deepStageMaxPressureThresholdMm = requireParameter(SLEEP_PARAMS, 'sleep.deepStageMaxPressureThresholdMm');
const lightPreFraction = requireParameter(SLEEP_PARAMS, 'sleep.lightPreFraction');
const highDeepFraction = requireParameter(SLEEP_PARAMS, 'sleep.highDeepFraction');
const lowDeepFraction = requireParameter(SLEEP_PARAMS, 'sleep.lowDeepFraction');
export const DYSPNEA_CRISIS_MM = requireParameter(SLEEP_PARAMS, 'sleep.dyspneaCrisisMm');
export const SEVERE_HYPOTENSION_SBP_MMHG = requireParameter(SLEEP_PARAMS, 'sleep.severeHypotensionSbpMmHg');

export interface WakeEvalIo {
  read(id: 'interoception'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'bladder'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'colon'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'blood'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'uterus'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'mammaryGlands'): Readonly<Record<string, unknown>> | undefined;
  readonly actions: readonly Readonly<{ type?: unknown; reason?: unknown; startle?: unknown }>[];
}

export interface WakeEvaluationResult {
  emergencyTriggered: boolean;
  importantSleepTriggered: boolean;
  emergencyIds: string[];
  importantIds: string[];
  sleepImportantThresholdMm: number;
  hasActiveWakingAction: boolean;
  hasSleepAction: boolean;
  hasWakeUpAction: boolean;
  endsWithSleepAction: boolean;
  endsWithWakeAction: boolean;
  explicitStartleRequested: boolean;
  wakeUpReason: 'speech' | 'action' | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function resolveSleepImportantThresholdMm(sleepStage: SleepStage): number {
  return sleepStage === 'deep'
    ? deepSleepImportantThresholdMm
    : sleepImportantThresholdMm;
}

export function computeNextSleepStage(
  sleepDurationMin: number,
  sleepPressureMm: number,
  melatoninRelative?: number,
): Exclude<SleepStage, 'awake'> {
  const period = Math.max(1, cyclePeriodMin);
  const cyclePos = (Math.max(0, sleepDurationMin) % period) / period;
  const highCircadianNight = typeof melatoninRelative !== 'number'
    || !Number.isFinite(melatoninRelative)
    || melatoninRelative >= 0.8;
  const earlyOrHighPressure = sleepPressureMm >= deepStageMaxPressureThresholdMm
    || (sleepDurationMin < earlyDeepWindowMin && highCircadianNight);
  const deepSpan = earlyOrHighPressure ? highDeepFraction : lowDeepFraction;
  if (cyclePos < lightPreFraction) return 'light';
  if (cyclePos < lightPreFraction + deepSpan) return 'deep';
  if (cyclePos < lightPreFraction * 2 + deepSpan) return 'light';
  return 'rem';
}

export function willNaturallyWakeThisRound(options: {
  sleepPressureMm: unknown;
  sleepDurationMin: unknown;
  pinealMelatoninRelative: unknown;
  hasPineal: boolean;
  dtMin: number;
}): boolean {
  const startPressure = clamp(finiteOr(options.sleepPressureMm, 0), 0, 100);
  const nextDuration = Math.max(0, finiteOr(options.sleepDurationMin, 0)) + Math.max(0, options.dtMin);
  const melatoninRelative = finiteOr(options.pinealMelatoninRelative, 0);
  const nextStage = computeNextSleepStage(
    nextDuration,
    startPressure,
    options.hasPineal ? melatoninRelative : undefined,
  );
  const multiplier = nextStage === 'deep'
    ? deepRecoveryMultiplier
    : nextStage === 'rem'
      ? remRecoveryMultiplier
      : 1;
  const effectiveHalfTime = sleepRecoveryHalfTimeMin / multiplier;
  const nextPressure = clamp(
    startPressure * Math.pow(0.5, Math.max(0, options.dtMin) / effectiveHalfTime),
    0,
    100,
  );
  const melatoninClear = !options.hasPineal
    || melatoninRelative <= naturalWakeMelatoninCeilingRelative;
  const circadianWakeReady = nextPressure < naturalWakePressureThresholdMm
    && nextDuration >= naturalWakeMinDurationMin
    && melatoninClear;
  const fullRestOverride = nextPressure < fullRestNaturalWakePressureMm
    && nextDuration >= fullRestNaturalWakeMinDurationMin;
  return circadianWakeReady || fullRestOverride;
}

export function evaluateSleepWakeSignals(
  io: WakeEvalIo,
  options: { sleepStage: SleepStage; nsfwEnabled?: boolean },
): WakeEvaluationResult {
  const nsfwEnabled = options.nsfwEnabled ?? (getNsfwSetting() !== false);
  let hasSleepAction = false;
  let hasWakeUpAction = false;
  let wakeUpReason: 'speech' | 'action' | null = null;
  let hasActiveWakingAction = false;
  let finalIntent: 'sleep' | 'wake' | null = null;
  let explicitStartleRequested = false;
  const actionTypes = new Set<string>();

  for (const action of io.actions ?? []) {
    const type = action?.type;
    if (typeof type !== 'string' || !type) continue;
    actionTypes.add(type);
    if (type === 'sleep') {
      hasSleepAction = true;
      finalIntent = 'sleep';
    } else if (type === 'wake_up') {
      hasWakeUpAction = true;
      finalIntent = 'wake';
      wakeUpReason = action?.reason === 'speech' ? 'speech' : 'action';
      if (action?.startle === true) {
        explicitStartleRequested = true;
      }
    } else if (ACTIVE_WAKING_ACTION_TYPES.has(type)) {
      hasActiveWakingAction = true;
      finalIntent = 'wake';
    }
  }

  const intero = io.read('interoception');
  const bladder = io.read('bladder');
  const colon = io.read('colon');
  const blood = io.read('blood');
  const uterus = io.read('uterus');
  const mammary = io.read('mammaryGlands');

  const voidedMl = nonNegativeOrZero(bladder?.voidedMl);
  const involuntaryVoidedMl = nonNegativeOrZero(bladder?.involuntaryVoidedMl);
  const defecatedG = nonNegativeOrZero(colon?.defecatedG);

  const suppressUrinary = voidedMl > 0 || involuntaryVoidedMl > 0 || actionTypes.has('urinate');
  const suppressBowel = defecatedG > 0 || actionTypes.has('defecate');

  const emergencyIds: string[] = [];
  const importantIds: string[] = [];
  const threshold = resolveSleepImportantThresholdMm(options.sleepStage);

  if (involuntaryVoidedMl > 0) {
    emergencyIds.push('involuntaryVoid');
  }

  const dyspnea = finiteOr(intero?.dyspneaMm, 0);
  const heat = finiteOr(intero?.heatMm, 0);
  const cold = finiteOr(intero?.coldMm, 0);
  const hypoglycemia = finiteOr(intero?.hypoglycemiaMm, 0);
  const systolic = blood?.systolicMmHg;
  const severeHypotension = typeof systolic === 'number'
    && Number.isFinite(systolic)
    && systolic < SEVERE_HYPOTENSION_SBP_MMHG;

  if (dyspnea >= DYSPNEA_CRISIS_MM) emergencyIds.push('dyspnea');
  if (severeHypotension) emergencyIds.push('palpitation');
  if (hypoglycemia >= defaultStrong) emergencyIds.push('hypoglycemia');
  if (heat >= defaultStrong) emergencyIds.push('heat');
  if (cold >= defaultStrong) emergencyIds.push('cold');

  const candidateValues: Array<[string, number]> = [
    ['urinary', suppressUrinary ? 0 : finiteOr(intero?.urinaryUrgency, 0)],
    ['thirst', finiteOr(intero?.thirst, 50)],
    ['fullness', finiteOr(intero?.fullness, 0)],
    ['hunger', finiteOr(intero?.hunger, 50)],
    ['bowelUrgency', suppressBowel ? 0 : finiteOr(intero?.bowelUrgencyMm, 0)],
    ['dryMouth', finiteOr(intero?.dryMouthMm, 0)],
    ['dyspnea', dyspnea],
    ['palpitation', finiteOr(intero?.palpitationMm, 0)],
    ['hypoglycemia', hypoglycemia],
    ['heat', heat],
    ['cold', cold],
    ['uterineCramp', finiteOr(intero?.uterineCrampMm ?? uterus?.crampMm, 0)],
    ['muscleFatigue', finiteOr(intero?.muscleFatigueMm, 0)],
    ['sweatDamp', finiteOr(intero?.sweatDampMm, 0)],
    ['stress', finiteOr(intero?.stressMm, 0)],
    ...(nsfwEnabled
      ? ([
        ['mammaryFullness', finiteOr(intero?.mammaryFullnessMm ?? mammary?.fullnessMm, 0)],
        ['sexualArousal', finiteOr(intero?.sexualArousalMm, 0)],
        ['libido', finiteOr(intero?.libidoMm, 0)],
      ] as Array<[string, number]>)
      : []),
  ];

  for (const [key, value] of candidateValues) {
    if (value >= threshold) {
      importantIds.push(key);
    }
  }

  const rawSensations = intero?.sensations;
  if (rawSensations && typeof rawSensations === 'object' && !Array.isArray(rawSensations)) {
    for (const key of Object.keys(rawSensations).sort()) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const entry = rawSensations[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const rec = entry as { intensityMm?: unknown; urgent?: unknown; nsfw?: unknown };
      if (rec.nsfw === true && !nsfwEnabled) continue;
      if (typeof rec.intensityMm !== 'number' || !Number.isFinite(rec.intensityMm)) continue;
      if (rec.urgent === true && rec.intensityMm >= defaultMarked) {
        emergencyIds.push(`sensation:${key}`);
      } else if (rec.intensityMm >= threshold) {
        importantIds.push(`sensation:${key}`);
      }
    }
  }

  return {
    emergencyTriggered: emergencyIds.length > 0,
    importantSleepTriggered: importantIds.length > 0,
    emergencyIds,
    importantIds,
    sleepImportantThresholdMm: threshold,
    hasActiveWakingAction,
    hasSleepAction,
    hasWakeUpAction,
    endsWithSleepAction: finalIntent === 'sleep',
    endsWithWakeAction: finalIntent === 'wake',
    explicitStartleRequested,
    wakeUpReason,
  };
}
