/*
 * 部位 `hypothalamusEndocrine`：下丘脑内分泌轴脚本，产出相对 TRH / CRH 信号。
 * 消费者是 `pituitary`：TRH 驱动 TSH、CRH 驱动 ACTH；外周激素
 * `thyroid.thyroxineRelative` 与 `adrenal.cortisolNmolL`（归一化为 `cortisolNmolL / 180`）
 * 升高时反向抑制本部位输出，构成闭环负反馈。
 *
 * 本次校准（design）：
 * - 醒后 CAR（`SRC-CLOW-2004`）：醒来后引入 `carLatentMin = 10 min` 潜伏平滑，起坡温和、
 *   惯性回落中段达到全幅，避免瞬时全幅阶跃；
 * - 愉悦/催产素缓冲：软读 `reward.hedonicMm` 与 `pituitary.oxytocinPgMl`，对非低血糖应激
 *   `stressDrive` 施加最多 `rewardBufferingGain` 比例的温和缓冲。
 */
import { resolveCircadianHour } from '../../../lib/circadian.js';
import { loadParameters, requireParameter } from '../../../lib/parameters.js';
import { evaluateSleepTransition } from './wake-evaluation.ts';

export const id = 'hypothalamusEndocrine';
export const actionTypes: string[] = [];

type HypothalamusEndocrineState = {
  trhRelative: number;
  crhRelative: number;
  carElapsedMin: number | null;
};

type IO = {
  read(id: 'hypothalamusEndocrine'): Readonly<HypothalamusEndocrineState> | undefined;
  read(id: 'thyroid'): Readonly<{ thyroxineRelative?: unknown }> | undefined;
  read(id: 'adrenal'): Readonly<{ cortisolNmolL?: unknown }> | undefined;
  read(id: 'thermoregulation'): Readonly<{ coreTemperatureC?: unknown; setpointC?: unknown }> | undefined;
  read(id: 'glucose'): Readonly<{ concentrationMgDl?: unknown }> | undefined;
  read(id: 'physicalActivity'): Readonly<{ remainingExerciseMin?: unknown; intensity?: unknown }> | undefined;
  read(id: 'autonomic'): Readonly<{ sympatheticMm?: unknown }> | undefined;
  read(id: 'interoception' | 'bladder' | 'colon' | 'blood' | 'uterus' | 'mammaryGlands'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'pineal'): Readonly<{ melatoninRelative?: unknown }> | undefined;
  read(id: 'sleep'): Readonly<{
    sleeping?: unknown;
    sleepStage?: unknown;
    sleepPressureMm?: unknown;
    sleepDurationMin?: unknown;
    wakeEvent?: unknown;
  }> | undefined;
  read(id: 'reward'): Readonly<{ hedonicMm?: unknown }> | undefined;
  read(id: 'pituitary'): Readonly<{ oxytocinPgMl?: unknown }> | undefined;
  readonly actions: readonly Readonly<{ type?: unknown; reason?: unknown; startle?: unknown }>[];
  readonly dt: number;
  readonly wallTimeMs?: number;
  write(next: HypothalamusEndocrineState): void;
};

const parameters = loadParameters(
  new URL('./hypothalamus-endocrine.parameters.json', import.meta.url),
);
const trhFeedbackGain = requireParameter(parameters, 'hypothalamusEndocrine.trhFeedbackGain');
const crhFeedbackGain = requireParameter(parameters, 'hypothalamusEndocrine.crhFeedbackGain');
const crhCircadianAmplitude = requireParameter(parameters, 'hypothalamusEndocrine.crhCircadianAmplitude');
const crhPeakHour = requireParameter(parameters, 'hypothalamusEndocrine.crhPeakHour');
const sympatheticCrhGain = requireParameter(parameters, 'hypothalamusEndocrine.sympatheticCrhGain');
const carAmplitude = requireParameter(parameters, 'hypothalamusEndocrine.carAmplitude');
const carLatentMin = requireParameter(parameters, 'hypothalamusEndocrine.carLatentMin');
const sleepCrhSuppression = requireParameter(parameters, 'hypothalamusEndocrine.sleepCrhSuppression');
const rewardBufferingGain = requireParameter(parameters, 'hypothalamusEndocrine.rewardBufferingGain');

const RESPONSE_HALF_TIME_MIN = 30;
const REFERENCE_CORTISOL_NMOL_L = 180;
const MIN_RELATIVE = 0;
const MAX_RELATIVE = 3;
const REFERENCE_CORE_TEMP_C = 37;
const COLD_STRESS_THRESHOLD_C = 36.8;
const COLD_TRH_GAIN_PER_C = 0.3;
const REFERENCE_GLUCOSE_MG_DL = 90;
const HYPOGLYCEMIA_THRESHOLD_MG_DL = 80;
const HYPOGLYCEMIA_CRH_GAIN_PER_MG_DL = 0.02;
const HARD_EXERCISE_INTENSITY_THRESHOLD = 0.5;
const EXERCISE_CRH_GAIN = 0.4;

export const initialState: HypothalamusEndocrineState = {
  trhRelative: 1,
  crhRelative: 1,
  carElapsedMin: null,
};

export const fields = {
  trhRelative: { unit: '1', mode: 'absolute' },
  crhRelative: { unit: '1', mode: 'absolute' },
  carElapsedMin: { unit: 'min', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readPeripheral(partId: string, field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${id}: invalid ${partId}.${field}: ${String(value)}`);
  }
  return value;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const thyroid = io.read('thyroid');
  const adrenal = io.read('adrenal');

  const thyroxineRelative = thyroid === undefined
    ? 1
    : readPeripheral('thyroid', 'thyroxineRelative', thyroid.thyroxineRelative);
  const cortisolNmolL = adrenal === undefined
    ? REFERENCE_CORTISOL_NMOL_L
    : readPeripheral('adrenal', 'cortisolNmolL', adrenal.cortisolNmolL);
  const cortisolRatio = cortisolNmolL / REFERENCE_CORTISOL_NMOL_L;

  const thermoregulation = io.read('thermoregulation');
  const thermoSetpointC = finiteOr(thermoregulation?.setpointC, REFERENCE_CORE_TEMP_C);
  const coreTemperatureC = finiteOr(thermoregulation?.coreTemperatureC, thermoSetpointC);
  const coldThresholdC = thermoSetpointC - (REFERENCE_CORE_TEMP_C - COLD_STRESS_THRESHOLD_C);
  const concentrationMgDl = Math.max(
    0,
    finiteOr(io.read('glucose')?.concentrationMgDl, REFERENCE_GLUCOSE_MG_DL),
  );
  const activity = io.read('physicalActivity');
  const remainingExerciseMin = Math.max(0, finiteOr(activity?.remainingExerciseMin, 0));
  const intensity = clamp(finiteOr(activity?.intensity, 0), 0, 1);
  const sympatheticMm = clamp(finiteOr(io.read('autonomic')?.sympatheticMm, 0), 0, 100);

  const coldDrive = COLD_TRH_GAIN_PER_C * Math.max(0, coldThresholdC - coreTemperatureC);
  const hypoglycemiaDrive = HYPOGLYCEMIA_CRH_GAIN_PER_MG_DL
    * Math.max(0, HYPOGLYCEMIA_THRESHOLD_MG_DL - concentrationMgDl);
  const exerciseDrive = remainingExerciseMin > 0
    ? EXERCISE_CRH_GAIN * Math.max(0, intensity - HARD_EXERCISE_INTENSITY_THRESHOLD)
    : 0;
  const sympatheticDrive = sympatheticCrhGain * sympatheticMm;
  const crhCircadianDrive = typeof io.wallTimeMs === 'number' && Number.isFinite(io.wallTimeMs)
    ? crhCircadianAmplitude
      * Math.cos((2 * Math.PI * (resolveCircadianHour(io.wallTimeMs) - crhPeakHour)) / 24)
    : 0;

  const dtMin = Math.max(0, io.dt / 60);
  const sleep = io.read('sleep');
  const prevSleeping = sleep?.sleeping === true;
  const sleepStage = !prevSleeping
    ? 'awake'
    : sleep?.sleepStage === 'deep' || sleep?.sleepStage === 'rem'
      ? sleep.sleepStage
      : 'light';
  const pineal = sleep === undefined ? undefined : io.read('pineal');
  const transition = sleep === undefined ? null : evaluateSleepTransition(io, {
    prevSleeping,
    sleepStage,
    sleepPressureMm: sleep.sleepPressureMm,
    sleepDurationMin: sleep.sleepDurationMin,
    pinealMelatoninRelative: pineal?.melatoninRelative,
    hasPineal: pineal !== undefined,
    dtMin,
  });
  const sleeping = transition?.sleeping ?? false;
  const sleepSuppression = sleeping ? sleepCrhSuppression : 0;
  const wokeThisRound = transition !== null && transition.wakeEvent !== 'none';
  const prevCarElapsedMin = typeof prev.carElapsedMin === 'number' && Number.isFinite(prev.carElapsedMin)
    ? Math.max(0, prev.carElapsedMin)
    : null;
  const carElapsedMin = sleep !== undefined && !sleeping
    ? wokeThisRound
      ? 0
      : prevCarElapsedMin === null
        ? null
        : prevCarElapsedMin + dtMin
    : null;

  // SRC-CLOW-2004: 醒后 0–10 min 线性平滑起坡，10–30 min 保持，45 min 结束 CAR 窗口。
  let carDrive = 0;
  if (carElapsedMin !== null && carElapsedMin < 45) {
    const ramp = carLatentMin > 0 ? clamp(carElapsedMin / carLatentMin, 0, 1) : 1;
    const resolution = carElapsedMin > 30 ? clamp((45 - carElapsedMin) / 15, 0, 1) : 1;
    carDrive = carAmplitude * ramp * resolution;
  }

  const hedonicMm = clamp(finiteOr(io.read('reward')?.hedonicMm, 0), 0, 100);
  const oxytocinPgMl = Math.max(0, finiteOr(io.read('pituitary')?.oxytocinPgMl, 2));
  const otRelaxFraction = clamp((oxytocinPgMl - 2) / 25, 0, 1);
  const buffering = clamp(
    rewardBufferingGain * Math.max(hedonicMm / 100, otRelaxFraction),
    0,
    0.5,
  );

  const retention = 2 ** (-dtMin / RESPONSE_HALF_TIME_MIN);

  const trhTarget = clamp(
    1 + trhFeedbackGain * (1 - thyroxineRelative) + coldDrive,
    MIN_RELATIVE,
    MAX_RELATIVE,
  );
  const nonMetabolicStress = Math.max(exerciseDrive, sympatheticDrive) * (1 - buffering);
  const stressDrive = Math.max(hypoglycemiaDrive + exerciseDrive * (1 - buffering), nonMetabolicStress);
  const crhTarget = clamp(
    1
      + crhFeedbackGain * (1 - cortisolRatio)
      + crhCircadianDrive
      + carDrive
      - sleepSuppression
      + stressDrive,
    MIN_RELATIVE,
    MAX_RELATIVE,
  );

  const trhRelative = trhTarget + (prev.trhRelative - trhTarget) * retention;
  const crhRelative = crhTarget + (prev.crhRelative - crhTarget) * retention;

  io.write({ trhRelative, crhRelative, carElapsedMin });
}
