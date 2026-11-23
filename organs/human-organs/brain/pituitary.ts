/*
 * 部位 `pituitary`：垂体前叶脚本，把下丘脑 TRH/CRH 驱动转成相对 TSH/ACTH 信号，并把
 * 乳腺上一轮的实际泌乳量（`mammaryGlands.milkMl > 0`，本切片作吸吮/排空代理）转成相对
 * 催乳素信号 `prolactinRelative`。`tshRelative` 的消费者是 `thyroid`（驱动 T4），
 * `acthRelative` 的消费者是 `adrenal`（驱动皮质醇），`prolactinRelative` 的消费者是
 * `mammaryGlands`（驱动产奶）。三者都是无量纲相对信号，1 表示基线；不是血浆激素浓度、
 * 分泌率或临床单位。
 *
 * 负反馈（design，不是人体测量、拟合或独立验证）：
 *   tshTarget  = clamp(trhRelative × (1 + tshFeedbackGain  × (1 − T4)), 0, 3)
 *   acthTarget = clamp(crhRelative × (1 + acthFeedbackGain × (1 − 皮质醇)), 0, 3)
 *   prolactinTarget = milkMl > 0 ? LETDOWN_TARGET : 1
 *   next = target + (prev − target) × 2^(−dtMin / 30)，dtMin = io.dt / 60
 * 外周激素 T4/皮质醇高于 1 时压低目标、低于 1 时抬高目标，使 HPT/HPA 形成闭环；
 * TRH 缺失按 1 时 TSH 仍受 T4 抑制，CRH 缺失按 1 时 ACTH 仍受皮质醇抑制，不是单向放大。
 * 催乳素没有负反馈：有泌乳时目标为 `LETDOWN_TARGET_RELATIVE = 2`，无泌乳时回落到基线 1；
 * 2 与 30 min 半时都是本脚本常量（`design`，`source: null`），`LETDOWN_TARGET_RELATIVE`
 * 不是实测催乳素倍数，也不是吸吮剂量—反应。`pituitary.parameters.json` 只保留两个负反馈
 * 增益；不建模 T3、转运蛋白、脉冲分泌、昼夜节律、疾病或个体差异，也不产出动作、通知或转移。
 *
 * 只读轮初快照：`hypothalamusEndocrine.trhRelative` / `crhRelative`、`thyroid.thyroxineRelative`、
 * `adrenal.cortisolRelative`、`mammaryGlands.milkMl`。部位未加载时：下丘脑/甲状腺/肾上腺
 * 按参考值 1，乳腺按无泌乳（目标 1）；部位已加载但字段缺失、非数字、非有限或为负则抛错，
 * 校验在 io.write 之前完成，本轮不写状态。下丘脑与乳腺部位由其他脚本实现，本脚本只按字段名
 * 读取，不导入其代码，保持分片可替换。输出只含三个有限相对量，JSON-safe；旧档缺字段由
 * `initialState` 补 1。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'pituitary';
export const actionTypes: string[] = [];

type PituitaryState = {
  tshRelative: number;
  acthRelative: number;
  prolactinRelative: number;
};

type HypothalamusEndocrineReading = {
  trhRelative: unknown;
  crhRelative: unknown;
};

type ThyroidReading = {
  thyroxineRelative: unknown;
};

type AdrenalReading = {
  cortisolRelative: unknown;
};

type MammaryGlandsReading = {
  milkMl?: unknown;
};

type IO = {
  read(id: 'pituitary'): Readonly<PituitaryState> | undefined;
  read(id: 'hypothalamusEndocrine'): Readonly<HypothalamusEndocrineReading> | undefined;
  read(id: 'thyroid'): Readonly<ThyroidReading> | undefined;
  read(id: 'adrenal'): Readonly<AdrenalReading> | undefined;
  read(id: 'mammaryGlands'): Readonly<MammaryGlandsReading> | undefined;
  readonly dt: number;
  write(next: PituitaryState): void;
};

const parameters = loadParameters(new URL('./pituitary.parameters.json', import.meta.url));
const tshFeedbackGain = requireParameter(parameters, 'pituitary.tshFeedbackGain');
const acthFeedbackGain = requireParameter(parameters, 'pituitary.acthFeedbackGain');

const RESPONSE_HALF_TIME_MIN = 30;
const MIN_RELATIVE = 0;
const MAX_RELATIVE = 3;
const PROLACTIN_BASELINE_RELATIVE = 1;
const LETDOWN_TARGET_RELATIVE = 2;

export const initialState: PituitaryState = {
  tshRelative: 1,
  acthRelative: 1,
  prolactinRelative: PROLACTIN_BASELINE_RELATIVE,
};

export const fields = {
  tshRelative: { unit: '1', mode: 'absolute' },
  acthRelative: { unit: '1', mode: 'absolute' },
  prolactinRelative: { unit: '1', mode: 'absolute' },
};

function relativeOrOne(
  part: Readonly<{ [field: string]: unknown }> | null | undefined,
  partId: string,
  field: string,
): number {
  if (part === undefined) return 1;
  const value = part === null || typeof part !== 'object' ? undefined : part[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`pituitary: invalid ${partId}.${field}: ${String(value)}`);
  }
  return value;
}

function milkMlOrZero(part: Readonly<MammaryGlandsReading> | null | undefined): number {
  if (part === undefined) return 0;
  const value = part === null || typeof part !== 'object' ? undefined : part.milkMl;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`pituitary: invalid mammaryGlands.milkMl: ${String(value)}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const trh = relativeOrOne(
    io.read('hypothalamusEndocrine'),
    'hypothalamusEndocrine',
    'trhRelative',
  );
  const crh = relativeOrOne(
    io.read('hypothalamusEndocrine'),
    'hypothalamusEndocrine',
    'crhRelative',
  );
  const thyroxine = relativeOrOne(io.read('thyroid'), 'thyroid', 'thyroxineRelative');
  const cortisol = relativeOrOne(io.read('adrenal'), 'adrenal', 'cortisolRelative');
  const milkMl = milkMlOrZero(io.read('mammaryGlands'));

  const tshTarget = clamp(
    trh * (1 + tshFeedbackGain * (1 - thyroxine)),
    MIN_RELATIVE,
    MAX_RELATIVE,
  );
  const acthTarget = clamp(
    crh * (1 + acthFeedbackGain * (1 - cortisol)),
    MIN_RELATIVE,
    MAX_RELATIVE,
  );
  const prolactinTarget = milkMl > 0
    ? LETDOWN_TARGET_RELATIVE
    : PROLACTIN_BASELINE_RELATIVE;

  const prev = io.read(id) ?? initialState;
  const prevProlactin = typeof prev.prolactinRelative === 'number'
    && Number.isFinite(prev.prolactinRelative)
    ? prev.prolactinRelative
    : PROLACTIN_BASELINE_RELATIVE;
  const retention = 2 ** (-(io.dt / 60) / RESPONSE_HALF_TIME_MIN);
  io.write({
    tshRelative: tshTarget + (prev.tshRelative - tshTarget) * retention,
    acthRelative: acthTarget + (prev.acthRelative - acthTarget) * retention,
    prolactinRelative: prolactinTarget + (prevProlactin - prolactinTarget) * retention,
  });
}
