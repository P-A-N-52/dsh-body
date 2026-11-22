/*
 * 部位 `hypothalamusThirst`：下丘脑口渴脚本，把体液水量亏缺代理
 * `bodyFluid.waterDeficit` 映射成 0–100 mm 的口渴代理 `thirst`。
 * 无自身动态，只写自己的部位，不读 ADH 部位，也不产出动作、通知或饮水行为。
 *
 * 来源（笔记路径、原文定位、支撑什么、不能推出什么）
 * - SRC-FIGARO-1997 / figaro-1997：`organs/human-organs/brain/references/notes/figaro-1997.md`，
 *   热运动脱水 6 名健康成人、cm VAS（摘要；全文未读）。只支撑“吸收前口咽解渴与吸收后持续
 *   补液可以分开”的定性方向；首段不建吸收前口咽缓解支路，饮水只能经胃→小肠→体液改变
 *   `waterDeficit` 后降低口渴。摘要未给通用基线、增益或半衰期，也没有把 VAS 校准到水量亏缺；
 *   输出不是其实测 VAS。
 *
 * design（不是人体测量、拟合或独立验证）
 * - `baselineMm=50`、`deficitGainMm=50`、线性形式、缺失默认 0 与输出钳 [0,100]
 *   全是工程假设；`mm` 只沿用 100-mm 视觉模拟量表刻度，不是物理长度、渗透压或
 *   神经放电。不建模口咽解渴、习惯化、昼夜节律、运动、疾病或个体差异。
 * - 只读轮初快照，不读自己的上一轮状态；同一轮饮水先改胃，吸收改变体液后下一轮
 *   才改变口渴。本脚本不调用 io.notify，也不处理动作。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'hypothalamusThirst';
export const actionTypes: string[] = [];

type ThirstState = {
  thirst: number;
};

type BodyFluidReading = {
  waterDeficit?: number;
};

type IO = {
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | undefined;
  write(next: ThirstState): void;
};

const parameters = loadParameters(new URL('./hypothalamus-thirst.parameters.json', import.meta.url));
const baselineMm = requireParameter(parameters, 'hypothalamusThirst.baselineMm');
const deficitGainMm = requireParameter(parameters, 'hypothalamusThirst.deficitGainMm');

const MIN_MM = 0;
const MAX_MM = 100;

export const initialState: ThirstState = {
  thirst: baselineMm,
};

export const fields = {
  thirst: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const deficit = finiteOr(io.read('bodyFluid')?.waterDeficit, 0);
  io.write({ thirst: clamp(baselineMm + deficitGainMm * deficit, MIN_MM, MAX_MM) });
}
