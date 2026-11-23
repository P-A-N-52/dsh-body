/*
 * 乳腺泌乳脚本（mammaryGlands，仅女性清单）：按轮初垂体相对催乳素生成乳汁水与乳糖请求，
 * 并把未排空的累积写成 0–100 mm 的胀奶代理。部位 `mammaryGlands` 的唯一写者；无动作、
 * 不调用 transfer、不读取自己的旧请求字段。消费者有三处：
 * - `bodyFluid` 女性变体 `water.female.ts` 在第五出口（最后一出口）读 `milkRequestMl`，
 *   本轮 write 之后把 `bodyFluid.waterVolumeMl` 转入 `milkMl`；
 * - `glucose` 在最后一个汇读 `lactoseRequestG`，本轮 write 之后把 `glucose.glucoseMassG`
 *   转入 `lactoseG`；
 * - `interoception.discomfort` 第六路软读 `fullnessMm`，不发送通知。
 * 实际乳汁水与乳糖只由 transferIn 增加，本脚本每轮 write 先把 `milkMl`、`lactoseG` 归 0；
 * 因此下一轮轮初的 `milkMl` 就是上一轮实际到账量。
 *
 * 全部数值都是 `design`、`source: null`（同目录 `milk.parameters.json`），没有实测泌乳率、
 * 乳汁乳糖浓度或胀奶量表。公式（dtMin = io.dt / 60，prolactinRelative 为轮初相对量，
 * prev 为本部位轮初状态）：
 *   rateMlPerMin = basalMilkRateMlPerMin × prolactinRelative
 *   milkRequestMl = rateMlPerMin × dtMin
 *   lactoseRequestG = milkRequestMl × lactoseGPerMl
 *   fullnessMm = clamp(prev.fullnessMm + fullnessGainPerMl × (milkRequestMl − prev.milkMl), 0, 100)
 * 胀奶只在“本轮产奶请求 > 上一轮实际泌乳量”时累积，实际泌乳量更大时回落；它不是乳腺压力、
 * 容量或疼痛测量，也不反馈到产奶速率。`milkMl > 0` 同时被 `pituitary` 用作吸吮/排空代理。
 *
 * 缺失与非法：`pituitary` 未加载按 `prolactinRelative = 1`（基础产奶）；已加载但
 * `prolactinRelative` 缺失、非数字、非有限或为负时抛错，校验在 io.write 之前完成，本轮
 * 不写状态。`bodyFluid` 与 `glucose` 不是本脚本的读取对象，缺它们不影响请求；实际不足由
 * 两个消费者按各自出口顺序钳位。旧档缺字段时由 initialState 补 0；自身历史字段非有限时
 * 按 0 读取，输出保持有限与 JSON-safe。
 *
 * 不能推出：不建婴儿、吸吮动作、哺乳行为、排空事件、孕期/产后阶段、乳腺病变、乳汁脂肪/
 * 蛋白/免疫成分、受体动力学或个体差异；单位 `mL` 与 `g` 只是本仿真的请求/到账量。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'mammaryGlands';
export const actionTypes: string[] = [];

type MammaryGlandsState = {
  milkRequestMl: number;
  milkMl: number;
  lactoseRequestG: number;
  lactoseG: number;
  fullnessMm: number;
};

type PituitaryReading = {
  prolactinRelative?: unknown;
};

type IO = {
  read(id: 'mammaryGlands'): Readonly<MammaryGlandsState> | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | undefined;
  readonly dt: number;
  write(next: MammaryGlandsState): void;
};

const parameters = loadParameters(new URL('./milk.parameters.json', import.meta.url));
const basalMilkRateMlPerMin = requireParameter(
  parameters,
  'mammaryGlands.basalMilkRateMlPerMin',
);
const lactoseGPerMl = requireParameter(parameters, 'mammaryGlands.lactoseGPerMl');
const fullnessGainPerMl = requireParameter(parameters, 'mammaryGlands.fullnessGainPerMl');

const PROLACTIN_BASELINE_RELATIVE = 1;
const MIN_FULLNESS_MM = 0;
const MAX_FULLNESS_MM = 100;

export const initialState: MammaryGlandsState = {
  milkRequestMl: 0,
  milkMl: 0,
  lactoseRequestG: 0,
  lactoseG: 0,
  fullnessMm: 0,
};

export const fields = {
  milkRequestMl: { unit: 'mL', mode: 'absolute' },
  milkMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['bodyFluid.waterVolumeMl'],
  },
  lactoseRequestG: { unit: 'g', mode: 'absolute' },
  lactoseG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['glucose.glucoseMassG'],
  },
  fullnessMm: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readProlactin(io: IO): number {
  const pituitary = io.read('pituitary');
  if (pituitary === undefined) return PROLACTIN_BASELINE_RELATIVE;
  const value = pituitary === null || typeof pituitary !== 'object'
    ? undefined
    : pituitary.prolactinRelative;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `mammaryGlands: invalid pituitary.prolactinRelative: ${String(value)}`,
    );
  }
  return value;
}

export function heartbeat(io: IO): void {
  const prolactinRelative = readProlactin(io);
  const prev = io.read(id) ?? initialState;
  const dtMin = io.dt / 60;

  const milkRequestMl = basalMilkRateMlPerMin * prolactinRelative * dtMin;
  const lactoseRequestG = milkRequestMl * lactoseGPerMl;
  const fullnessMm = clamp(
    finiteOr(prev.fullnessMm, 0)
      + fullnessGainPerMl * (milkRequestMl - finiteOr(prev.milkMl, 0)),
    MIN_FULLNESS_MM,
    MAX_FULLNESS_MM,
  );

  io.write({
    milkRequestMl,
    milkMl: 0,
    lactoseRequestG,
    lactoseG: 0,
    fullnessMm,
  });
}
