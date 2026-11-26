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

export const id = 'hypothalamusEndocrine';
export const actionTypes: string[] = [];

type HypothalamusEndocrineState = {
  trhRelative: number;
  crhRelative: number;
};

type IO = {
  read(id: 'hypothalamusEndocrine'): Readonly<HypothalamusEndocrineState> | undefined;
  read(id: 'thyroid'): Readonly<{ thyroxineRelative?: unknown }> | undefined;
  read(id: 'adrenal'): Readonly<{ cortisolNmolL?: unknown }> | undefined;
  read(id: 'thermoregulation'): Readonly<{ coreTemperatureC?: unknown; setpointC?: unknown }> | undefined;
  read(id: 'glucose'): Readonly<{ concentrationMgDl?: unknown }> | undefined;
  read(id: 'physicalActivity'): Readonly<{ remainingExerciseMin?: unknown; intensity?: unknown }> | undefined;
  read(id: 'autonomic'): Readonly<{ sympatheticMm?: unknown }> | undefined;
  read(id: 'sleep'): Readonly<{ sleeping?: unknown; sleepInertiaMm?: unknown; wakeEvent?: unknown }> | undefined;
  read(id: 'reward'): Readonly<{ hedonicMm?: unknown }> | undefined;
  read(id: 'pituitary'): Readonly<{ oxytocinPgMl?: unknown }> | undefined;
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
};

export const fields = {
  trhRelative: { unit: '1', mode: 'absolute' },
  crhRelative: { unit: '1', mode: 'absolute' },
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

  const sleep = io.read('sleep');
  const sleeping = sleep?.sleeping === true;
  const sleepInertiaMm = clamp(finiteOr(sleep?.sleepInertiaMm, 0), 0, 100);
  const sleepSuppression = sleeping ? sleepCrhSuppression : 0;

  // SRC-CLOW-2004 & Smyth 2015: 醒后约 10 min 潜伏窗内温和起坡，随后进入 30–45 min CAR 峰值
  let carDrive = 0;
  if (sleep !== undefined && !sleeping) {
    const wokeThisRound = sleep.wakeEvent !== 'none' && sleep.wakeEvent !== undefined;
    if (wokeThisRound && sleepInertiaMm > 0) {
      carDrive = carAmplitude * (carLatentMin > 0 ? 0.4 : 1);
    } else if (sleepInertiaMm > 0) {
      carDrive = carAmplitude * clamp(sleepInertiaMm / 20, 0, 1);
    } else if (wokeThisRound) {
      carDrive = carAmplitude * 0.7;
    }
  }

  const hedonicMm = clamp(finiteOr(io.read('reward')?.hedonicMm, 0), 0, 100);
  const oxytocinPgMl = Math.max(0, finiteOr(io.read('pituitary')?.oxytocinPgMl, 2));
  const otRelaxFraction = clamp((oxytocinPgMl - 2) / 25, 0, 1);
  const buffering = clamp(
    rewardBufferingGain * Math.max(hedonicMm / 100, otRelaxFraction),
    0,
    0.5,
  );

  const dtMin = io.dt / 60;
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

  io.write({ trhRelative, crhRelative });
}
