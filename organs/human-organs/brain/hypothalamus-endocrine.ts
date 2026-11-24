/*
 * 部位 `hypothalamusEndocrine`：下丘脑内分泌轴脚本，产出相对 TRH / CRH 信号。
 * 消费者是 `pituitary`：TRH 驱动 TSH、CRH 驱动 ACTH；外周激素
 * `thyroid.thyroxineRelative` 与 `adrenal.cortisolRelative` 升高时反向抑制本部位
 * 输出，降低时解除抑制，构成负反馈，不是单向放大。
 *
 * design（不是人体测量、拟合或独立验证）
 * - `trhRelative` / `crhRelative` 是无量纲相对信号，1 表示基线，钳在 0–3；
 *   不是 TRH/CRH 的实测浓度、分泌率、脉冲频率或临床指标。
 * - 目标：
 *   coldDrive = 0.3 × max(0, 36.8 − thermoregulation.coreTemperatureC)（未加载或非有限按 37）
 *   hypoglycemiaDrive = 0.02 × max(0, 80 − max(0, glucose.concentrationMgDl))（未加载或非有限按 90）
 *   exerciseDrive = physicalActivity.remainingExerciseMin > 0
 *     ? 0.4 × max(0, physicalActivity.intensity − 0.5) : 0（未加载或非有限按 0）
 *   trhTarget = clamp(1 + gain × (1 − T4) + coldDrive, 0, 3)
 *   crhTarget = clamp(1 + gain × (1 − 皮质醇) + hypoglycemiaDrive + exerciseDrive, 0, 3)
 *   再按 30 min 半时一阶趋近：`next = target + (prev − target) × 2^(−dtMin / 30)`，
 *   `dtMin = io.dt / 60`。在正常 37°C（≥ 36.8°C 冷应激死区）、90 mg/dL、静息基线下三项上游驱动均为 0，
 *   静息 HPT/HPA 保持精确 1.0。公式、增益与半时全是工程假设，参数见同目录
 *   `hypothalamus-endocrine.parameters.json`（`status: design`、`source: null`）。
 * - 只读轮初快照；未加载的 `thyroid` / `adrenal` 部位按 1 回退，已加载但字段缺失、非有限或
 *   为负时抛错，让本轮整体作废，不用基线掩盖异常。`thermoregulation` / `glucose` / `physicalActivity`
 *   缺字段或非有限时回落基线常量，目标值钳在 [0, 3]。
 * - 无动作、transfer 或通知；不建模脉冲式分泌、昼夜节律、T3、绝对浓度、结合蛋白、
 *   疾病或个体差异。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'hypothalamusEndocrine';
export const actionTypes: string[] = [];

type HypothalamusEndocrineState = {
  trhRelative: number;
  crhRelative: number;
};

type ThyroidReading = {
  thyroxineRelative?: number;
};

type AdrenalReading = {
  cortisolRelative?: number;
};

type ThermoregulationReading = {
  coreTemperatureC?: unknown;
};

type GlucoseReading = {
  concentrationMgDl?: unknown;
};

type PhysicalActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type IO = {
  read(id: 'hypothalamusEndocrine'): Readonly<HypothalamusEndocrineState> | undefined;
  read(id: 'thyroid'): Readonly<ThyroidReading> | undefined;
  read(id: 'adrenal'): Readonly<AdrenalReading> | undefined;
  read(id: 'thermoregulation'): Readonly<ThermoregulationReading> | undefined;
  read(id: 'glucose'): Readonly<GlucoseReading> | undefined;
  read(id: 'physicalActivity'): Readonly<PhysicalActivityReading> | undefined;
  readonly dt: number;
  write(next: HypothalamusEndocrineState): void;
};

const parameters = loadParameters(
  new URL('./hypothalamus-endocrine.parameters.json', import.meta.url),
);
const trhFeedbackGain = requireParameter(
  parameters,
  'hypothalamusEndocrine.trhFeedbackGain',
);
const crhFeedbackGain = requireParameter(
  parameters,
  'hypothalamusEndocrine.crhFeedbackGain',
);

const RESPONSE_HALF_TIME_MIN = 30;
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

function readPeripheral(
  partId: string,
  field: string,
  value: number | undefined,
): number {
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
  const cortisolRelative = adrenal === undefined
    ? 1
    : readPeripheral('adrenal', 'cortisolRelative', adrenal.cortisolRelative);

  const coreTemperatureC = finiteOr(
    io.read('thermoregulation')?.coreTemperatureC,
    REFERENCE_CORE_TEMP_C,
  );
  const concentrationMgDl = Math.max(
    0,
    finiteOr(io.read('glucose')?.concentrationMgDl, REFERENCE_GLUCOSE_MG_DL),
  );
  const activity = io.read('physicalActivity');
  const remainingExerciseMin = Math.max(0, finiteOr(activity?.remainingExerciseMin, 0));
  const intensity = clamp(finiteOr(activity?.intensity, 0), 0, 1);

  const coldDrive = COLD_TRH_GAIN_PER_C * Math.max(0, COLD_STRESS_THRESHOLD_C - coreTemperatureC);
  const hypoglycemiaDrive = HYPOGLYCEMIA_CRH_GAIN_PER_MG_DL
    * Math.max(0, HYPOGLYCEMIA_THRESHOLD_MG_DL - concentrationMgDl);
  const exerciseDrive = remainingExerciseMin > 0
    ? EXERCISE_CRH_GAIN * Math.max(0, intensity - HARD_EXERCISE_INTENSITY_THRESHOLD)
    : 0;

  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / RESPONSE_HALF_TIME_MIN);

  const trhTarget = clamp(
    1 + trhFeedbackGain * (1 - thyroxineRelative) + coldDrive,
    MIN_RELATIVE,
    MAX_RELATIVE,
  );
  const crhTarget = clamp(
    1 + crhFeedbackGain * (1 - cortisolRelative) + hypoglycemiaDrive + exerciseDrive,
    MIN_RELATIVE,
    MAX_RELATIVE,
  );

  const trhRelative = trhTarget + (prev.trhRelative - trhTarget) * retention;
  const crhRelative = crhTarget + (prev.crhRelative - crhTarget) * retention;

  io.write({ trhRelative, crhRelative });
}
