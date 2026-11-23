/*
 * 部位 `hypothalamusEndocrine`：下丘脑内分泌轴脚本，产出相对 TRH / CRH 信号。
 * 消费者是 `pituitary`：TRH 驱动 TSH、CRH 驱动 ACTH；外周激素
 * `thyroid.thyroxineRelative` 与 `adrenal.cortisolRelative` 升高时反向抑制本部位
 * 输出，降低时解除抑制，构成负反馈，不是单向放大。
 *
 * design（不是人体测量、拟合或独立验证）
 * - `trhRelative` / `crhRelative` 是无量纲相对信号，1 表示基线，钳在 0–3；
 *   不是 TRH/CRH 的实测浓度、分泌率、脉冲频率或临床指标。
 * - 目标 `clamp(1 + gain × (1 − 外周激素相对值), 0, 3)`，再按 30 min 半时
 *   一阶趋近：`next = target + (prev − target) × 2^(−dtMin / 30)`，
 *   `dtMin = io.dt / 60`。公式、增益与半时全是工程假设，参数见同目录
 *   `hypothalamus-endocrine.parameters.json`（`status: design`、`source: null`）。
 * - 只读轮初快照；未加载的 `thyroid` / `adrenal` 部位按 1 回退。部位已加载但字段
 *   缺失、非有限或为负时抛错，让本轮整体作废，不用基线掩盖异常。
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

type IO = {
  read(id: 'hypothalamusEndocrine'): Readonly<HypothalamusEndocrineState> | undefined;
  read(id: 'thyroid'): Readonly<ThyroidReading> | undefined;
  read(id: 'adrenal'): Readonly<AdrenalReading> | undefined;
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

  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / RESPONSE_HALF_TIME_MIN);

  const trhTarget = clamp(
    1 + trhFeedbackGain * (1 - thyroxineRelative),
    MIN_RELATIVE,
    MAX_RELATIVE,
  );
  const crhTarget = clamp(
    1 + crhFeedbackGain * (1 - cortisolRelative),
    MIN_RELATIVE,
    MAX_RELATIVE,
  );

  const trhRelative = trhTarget + (prev.trhRelative - trhTarget) * retention;
  const crhRelative = crhTarget + (prev.crhRelative - crhTarget) * retention;

  io.write({ trhRelative, crhRelative });
}
