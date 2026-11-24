/*
 * 心脏泵血薄切片（heart）：按轮初活动与肾上腺皮质醇相对信号合成驱动，写心率、搏出量与
 * 心输出；部位 `heart` 的唯一写者。消费者是 `blood`：下一轮读轮初 `cardiacOutputMlMin`
 * 算氧输送与血压代理。
 *
 * 公式（design）：
 *   drive = 1
 *         + activityGain × intensity（轮初 remainingExerciseMin > 0 时；否则 0）
 *         + catecholamineGain × (adrenal.cortisolRelative − 1)
 *   heartRatePerMin = clamp(restingHeartRatePerMin × drive,
 *                           restingHeartRatePerMin, maxHeartRatePerMin)
 *   preloadFactor = blood 存在时 clamp(blood.bloodVolumeMl / 5000, 0.5, 1.15)；否则 1
 *   strokeVolumeMl = clamp(restingStrokeVolumeMl × (1 + 0.2 × (drive − 1)) × preloadFactor,
 *                          30, 140)
 *   cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl
 *
 * 读轮初 `physicalActivity.remainingExerciseMin` / `intensity`、`adrenal.cortisolRelative`
 * 与 `blood.bloodVolumeMl`。`physicalActivity` 未加载时按无活动（intensity 0）回退；
 * `adrenal` 未加载时按 cortisolRelative = 1 回退；`blood` 未加载时按 preloadFactor = 1 回退。
 * 已加载但字段缺失、非有限、为负或 intensity 超出 [0, 1] 时抛错使本轮失败，不写状态。
 * 皮质醇合法 0 是有效相对信号。本脚本不读 `io.dt`：驱动是轮初快照的瞬时映射，不建心率趋近或恢复动力学。
 *
 * 0.2 的搏出量随 drive 的增益、30–140 mL 搏出量安全钳位及 `preloadFactor`（0.5–1.15）
 * 是本脚本的 design 常量，未列入参数文件；它们只表示模型内相对变化，不是每搏量—交感张力
 * 斜率、Frank-Starling 实测曲线、超声或血流动力学测量。心率钳位只到
 * restingHeartRatePerMin 下限与 maxHeartRatePerMin 上限；drive < 1 时心率停在静息值，
 * 而搏出量仍按公式低于静息值并受 30–140 mL 钳位。不建模心电、瓣膜、心律、后负荷、
 * 运动性高血压或心衰。
 *
 * 证据与未验证：无直接人体来源。静息 70 次/min、最大 180 次/min、搏出 70 mL、1.5 与 0.5
 * 两个增益及 0.2 都是 `design`、`source: null` 的工程占位（参数见同目录
 * `heart.parameters.json`），不是实测心率、每搏量、心输出、MET 或剂量反应；不能称拟合、
 * 实测或 `validated`。输出只含三个有限数字段，JSON-safe；无 transfer、动作或通知。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'heart';
export const actionTypes: string[] = [];

type HeartState = {
  heartRatePerMin: number;
  strokeVolumeMl: number;
  cardiacOutputMlMin: number;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type AdrenalReading = {
  cortisolRelative?: unknown;
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
const restingStrokeVolumeMl = requireParameter(
  parameters,
  'heart.restingStrokeVolumeMl',
);
const activityGain = requireParameter(parameters, 'heart.activityGain');
const catecholamineGain = requireParameter(parameters, 'heart.catecholamineGain');

const strokeVolumeGain = 0.2;
const referenceBloodVolumeMl = 5000;
const strokeVolumeRange = { min: 30, max: 140 };
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
  read(id: 'adrenal'): Readonly<AdrenalReading> | undefined;
  read(id: 'blood'): Readonly<BloodReading> | undefined;
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

function readCortisolRelative(adrenal: Readonly<AdrenalReading> | undefined): number {
  if (adrenal === undefined) return 1;
  const cortisolRelative = requireFinite(
    adrenal.cortisolRelative,
    'adrenal.cortisolRelative',
  );
  if (cortisolRelative < 0) {
    throw new Error('heart: adrenal.cortisolRelative must not be negative');
  }
  return cortisolRelative;
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

export function heartbeat(io: IO): void {
  const intensity = readIntensity(io.read('physicalActivity'));
  const cortisolRelative = readCortisolRelative(io.read('adrenal'));
  const preloadFactor = readPreloadFactor(io.read('blood'));

  const drive = 1
    + activityGain * intensity
    + catecholamineGain * (cortisolRelative - 1);
  const heartRatePerMin = clamp(
    restingHeartRatePerMin * drive,
    restingHeartRatePerMin,
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
