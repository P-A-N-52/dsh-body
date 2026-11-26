/*
 * 心脏泵血薄切片（heart）：按轮初活动、自主神经交感张力（`autonomic.sympatheticMm`）与
 * 睡眠副交感下调合成驱动，写心率、搏出量与心输出；部位 `heart` 的唯一写者。消费者是 `blood`：
 * 下一轮读轮初 `cardiacOutputMlMin` 算氧输送与血压代理。
 *
 * 公式（design）：
 *   sleepBase = sleep.sleeping === true && !startleThisRound
 *     ? (sleepStage === 'deep' ? 0.78 : 0.86)
 *     : 1
 *   effectiveSympatheticMm = startleThisRound
 *     ? Math.max(autonomic.sympatheticMm, 85)
 *     : autonomic.sympatheticMm
 *   drive = sleepBase
 *         + activityGain × intensity（轮初 remainingExerciseMin > 0 时；否则 0）
 *         + sympatheticDriveGain × effectiveSympatheticMm
 *   minHeartRate = (sleep.sleeping === true && !startleThisRound) ? 42 : restingHeartRatePerMin
 *   heartRatePerMin = clamp(restingHeartRatePerMin × drive, minHeartRate, maxHeartRatePerMin)
 *   preloadFactor = blood 存在时 clamp(blood.bloodVolumeMl / 5000, 0.5, 1.15)；否则 1
 *   strokeVolumeMl = clamp(restingStrokeVolumeMl × (1 + 0.2 × (drive − 1)) × preloadFactor,
 *                          30, 140)
 *   cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl
 *
 * 清醒静息且无应激时 `sleepBase = 1`、`effectiveSympatheticMm = 0`，保持 70 bpm / 70 mL 静息基线；
 * 睡眠期间心率生理性下调至 ~55–60 bpm；遭遇紧急惊醒时同轮感知危机并拉高心率与心输出。
 * 不再借用 `adrenal.cortisolRelative` 充当交感代理。
 *
 * 证据与未验证：无直接人体来源。全部参数与增益均标 `design`、`source: null`；不建模心电、
 * 瓣膜、心律、后负荷、运动性高血压或心衰。输出只含三个有限数字段，JSON-safe；无 transfer、动作或通知。
 */
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

const ACTIVE_WAKING_ACTIONS = new Set([
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

function readPos(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function readNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasEmergencyCrisis(io: IO): boolean {
  const bladder = io.read('bladder');
  if (readPos(bladder?.involuntaryVoidedMl) > 0) return true;
  const blood = io.read('blood');
  if (typeof blood?.systolicMmHg === 'number' && Number.isFinite(blood.systolicMmHg) && blood.systolicMmHg < 78) {
    return true;
  }
  const intero = io.read('interoception');
  if (!intero) return false;
  if (readNum(intero.dyspneaMm, 0) >= 90) return true;
  if (readNum(intero.hypoglycemiaMm, 0) >= 85) return true;
  if (readNum(intero.heatMm, 0) >= 85) return true;
  if (readNum(intero.coldMm, 0) >= 85) return true;
  const rawSensations = intero.sensations;
  if (rawSensations && typeof rawSensations === 'object' && !Array.isArray(rawSensations)) {
    for (const entry of Object.values(rawSensations as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const rec = entry as { urgent?: unknown; intensityMm?: unknown };
      if (rec.urgent === true && typeof rec.intensityMm === 'number' && rec.intensityMm >= 65) {
        return true;
      }
    }
  }
  return false;
}

export const id = 'heart';
export const actionTypes: string[] = [];

type SleepStage = 'awake' | 'light' | 'deep' | 'rem';

type HeartState = {
  heartRatePerMin: number;
  strokeVolumeMl: number;
  cardiacOutputMlMin: number;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type AutonomicReading = {
  sympatheticMm?: unknown;
};

type SleepReading = {
  sleeping?: unknown;
  sleepStage?: unknown;
};

type BloodReading = {
  bloodVolumeMl?: unknown;
};

const parameters = loadParameters(new URL('./heart.parameters.json', import.meta.url));
const restingHeartRatePerMin = requireParameter(
  parameters,
  'heart.restingHeartRatePerMin',
);
const maxHeartRatePerMin = requireParameter(parameters, 'heart.maxHeartRatePerMin');
const restingStrokeVolumeMl = scaleByBodyWeight(
  requireParameter(parameters, 'heart.restingStrokeVolumeMl'),
  'heart.restingStrokeVolumeMl',
);
const activityGain = requireParameter(parameters, 'heart.activityGain');
void requireParameter(parameters, 'heart.catecholamineGain');

const sympatheticDriveGain = requireParameter(parameters, 'heart.sympatheticDriveGain');
const startleFloorSympatheticMm = requireParameter(parameters, 'heart.startleFloorSympatheticMm');
const lightSleepDriveBase = requireParameter(parameters, 'heart.lightSleepDriveBase');
const deepSleepDriveBase = requireParameter(parameters, 'heart.deepSleepDriveBase');
const remSleepDriveBase = requireParameter(parameters, 'heart.remSleepDriveBase');
const minSleepHeartRatePerMin = requireParameter(parameters, 'heart.minSleepHeartRatePerMin');
const strokeVolumeGain = requireParameter(parameters, 'heart.strokeVolumeGain');
const referenceBloodVolumeMl = getNumericParameterOverride('blood.referenceBloodVolumeMl')
  ?? scaleByBodyWeight(5000);
const strokeVolumeRange = { min: scaleByBodyWeight(30), max: scaleByBodyWeight(140) };
const preloadFactorRange = { min: 0.5, max: 1.15 };

export const initialState: HeartState = {
  heartRatePerMin: restingHeartRatePerMin,
  strokeVolumeMl: restingStrokeVolumeMl,
  cardiacOutputMlMin: restingHeartRatePerMin * restingStrokeVolumeMl,
};

export const fields = {
  heartRatePerMin: { unit: '1/min', mode: 'absolute' },
  strokeVolumeMl: { unit: 'mL', mode: 'absolute' },
  cardiacOutputMlMin: { unit: 'mL/min', mode: 'absolute' },
};

type IO = {
  read(id: 'heart'): Readonly<HeartState> | undefined;
  read(id: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  read(id: 'autonomic'): Readonly<AutonomicReading> | undefined;
  read(id: 'sleep'): Readonly<SleepReading & { sleepPressureMm?: unknown; sleepDurationMin?: unknown }> | undefined;
  read(id: 'blood'): Readonly<BloodReading & { systolicMmHg?: unknown }> | undefined;
  read(id: 'pineal'): Readonly<{ melatoninRelative?: unknown }> | undefined;
  read(id: 'interoception'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'bladder'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'colon'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'uterus'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'mammaryGlands'): Readonly<Record<string, unknown>> | undefined;
  readonly dt?: number;
  readonly actions?: readonly Readonly<{ type?: unknown; reason?: unknown; startle?: unknown }>[];
  write(next: HeartState): void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`heart: ${name} must be a finite number`);
  }
  return value;
}

function readIntensity(activity: Readonly<ActivityReading> | undefined): number {
  if (activity === undefined) return 0;
  const remainingExerciseMin = requireFinite(
    activity.remainingExerciseMin,
    'physicalActivity.remainingExerciseMin',
  );
  const intensity = requireFinite(activity.intensity, 'physicalActivity.intensity');
  if (remainingExerciseMin < 0) {
    throw new Error('heart: physicalActivity.remainingExerciseMin must not be negative');
  }
  if (intensity < 0 || intensity > 1) {
    throw new Error('heart: physicalActivity.intensity must be between 0 and 1');
  }
  return remainingExerciseMin > 0 ? intensity : 0;
}

function readSympatheticMm(autonomic: Readonly<AutonomicReading> | undefined): number {
  if (autonomic === undefined) return 0;
  const sympatheticMm = requireFinite(
    autonomic.sympatheticMm,
    'autonomic.sympatheticMm',
  );
  if (sympatheticMm < 0) {
    throw new Error('heart: autonomic.sympatheticMm must not be negative');
  }
  return clamp(sympatheticMm, 0, 100);
}

function readPreloadFactor(blood: Readonly<BloodReading> | undefined): number {
  if (blood === undefined) return 1;
  const bloodVolumeMl = requireFinite(blood.bloodVolumeMl, 'blood.bloodVolumeMl');
  if (bloodVolumeMl < 0) {
    throw new Error('heart: blood.bloodVolumeMl must not be negative');
  }
  return clamp(
    bloodVolumeMl / referenceBloodVolumeMl,
    preloadFactorRange.min,
    preloadFactorRange.max,
  );
}

function readSleepStage(sleep: Readonly<SleepReading> | undefined): SleepStage {
  if (sleep?.sleeping !== true) return 'awake';
  if (sleep.sleepStage === 'light' || sleep.sleepStage === 'deep' || sleep.sleepStage === 'rem') {
    return sleep.sleepStage;
  }
  return 'light';
}

export function heartbeat(io: IO): void {
  const intensity = readIntensity(io.read('physicalActivity'));
  const sympatheticMm = readSympatheticMm(io.read('autonomic'));
  const preloadFactor = readPreloadFactor(io.read('blood'));
  const sleep = io.read('sleep');
  const sleeping = sleep?.sleeping === true;
  const sleepStage = readSleepStage(sleep);

  const actions = io.actions ?? [];
  let finalIntent: 'sleep' | 'wake' | null = null;
  let explicitStartleRequested = false;
  for (const action of actions) {
    const type = action?.type;
    if (type === 'sleep') {
      finalIntent = 'sleep';
    } else if (type === 'wake_up') {
      finalIntent = 'wake';
      if (action?.startle === true) explicitStartleRequested = true;
    } else if (typeof type === 'string' && ACTIVE_WAKING_ACTIONS.has(type)) {
      finalIntent = 'wake';
    }
  }
  const startleThisRound = sleeping && (explicitStartleRequested || hasEmergencyCrisis(io));
  const wakingThisRound = startleThisRound || (sleeping && finalIntent === 'wake');

  const effectiveSleep = sleeping
    ? !wakingThisRound
    : finalIntent === 'sleep';
  const effectiveSleepStage = effectiveSleep
    ? (sleeping ? sleepStage : 'light')
    : 'awake';
  const sleepBase = !effectiveSleep
    ? 1
    : effectiveSleepStage === 'deep'
      ? deepSleepDriveBase
      : effectiveSleepStage === 'rem'
        ? remSleepDriveBase
        : lightSleepDriveBase;
  const effectiveSympatheticMm = startleThisRound
    ? Math.max(sympatheticMm, startleFloorSympatheticMm)
    : sympatheticMm;

  const extraDrive = Math.max(
    activityGain * intensity,
    sympatheticDriveGain * effectiveSympatheticMm,
  );
  const drive = sleepBase + extraDrive;
  const minHr = effectiveSleep
    ? Math.min(restingHeartRatePerMin, minSleepHeartRatePerMin)
    : restingHeartRatePerMin;
  const heartRatePerMin = clamp(
    restingHeartRatePerMin * drive,
    minHr,
    maxHeartRatePerMin,
  );
  const strokeVolumeMl = clamp(
    restingStrokeVolumeMl * (1 + strokeVolumeGain * (drive - 1)) * preloadFactor,
    strokeVolumeRange.min,
    strokeVolumeRange.max,
  );
  const cardiacOutputMlMin = heartRatePerMin * strokeVolumeMl;

  io.write({ heartRatePerMin, strokeVolumeMl, cardiacOutputMlMin });
}
