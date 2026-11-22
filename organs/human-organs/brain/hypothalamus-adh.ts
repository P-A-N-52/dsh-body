/*
 * 部位 `hypothalamusAdh`：下丘脑神经内分泌脚本，把体液水量亏缺代理
 * `bodyFluid.waterDeficit` 映射成相对 ADH 水平 `relativeConcentration`。
 * 只写自己的部位，不读口渴部位，也不产出动作、通知或饮水行为；口渴由
 * `hypothalamus-thirst.ts` 独立写 `hypothalamusThirst`。
 *
 * 来源（笔记路径、原文定位、支撑什么、不能推出什么）
 * - SRC-OTA-1994 / ota-1994：`organs/human-organs/kidney/references/notes/ota-1994.md`，
 *   Methods p.100 与 Figs. 1/3/4（主队列 5 名原发性甲减患者，T4 治疗前/后各一轮；另 5 名正常
 *   对照。AVP pmol/L、尿流 mL/min、30 min 尿段）。正常对照与治疗后甲功正常状态下，水负荷后
 *   AVP 下降、尿变稀；只支撑“体液水增加后 ADH 相对水平下降、尿量增加”的方向。甲减组反应
 *   迟钝，不能当正常生理；尿渗不是血渗，30 min 尿段总量不是瞬时尿流率，原文也没有给出可拼成
 *   通用曲线的时程或增益；不能把本脚本输出标成 pmol/L，也不能称其为 Ota 的拟合方程。
 * - SRC-ANDERSEN-1990 / andersen-1990：`organs/human-organs/kidney/references/notes/andersen-1990.md`，
 *   AVP 输注实验；只支撑“ADH 变化后下游肾反应可以延迟”的定性方向，不支撑具体时间常数。
 *   输注剂量轴不是血浓度；`timeConstantMin=10` 不是原文拟合值。
 *
 * design（不是人体测量、拟合或独立验证）
 * - 一阶滞后 `next = ADH + (1 - exp(-dt/τ)) × (target - ADH)`、线性 target、
 *   `deficitGain=1`、`relativeMinimum=0`、`relativeMaximum=3`、`timeConstantMin=10`
 *   和初值 1 全是工程假设。没有来源把 `waterDeficit` 校准到相对 ADH 水平；
 *   `relativeConcentration` 以 1 为无量纲参考，不是血浆 AVP 浓度、分泌速率或渗透压。
 * - 只读轮初快照，同一轮里 `bodyFluid` 的吸收/产尿下一轮才反映；缺失或非有限
 *   `waterDeficit` 按 0。不建模渗透压、血容量/血压、RAAS、昼夜节律、运动、疾病或
 *   个体差异；首段不调用 io.notify，也不处理动作。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'hypothalamusAdh';
export const actionTypes: string[] = [];

type AdhState = {
  relativeConcentration: number;
};

type BodyFluidReading = {
  waterDeficit?: number;
};

type IO = {
  read(id: 'hypothalamusAdh'): Readonly<AdhState> | undefined;
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | undefined;
  readonly dt: number;
  write(next: AdhState): void;
};

const parameters = loadParameters(new URL('./hypothalamus-adh.parameters.json', import.meta.url));
const timeConstantMin = requireParameter(parameters, 'hypothalamusAdh.timeConstantMin');
const deficitGain = requireParameter(parameters, 'hypothalamusAdh.deficitGain');
const relativeMinimum = requireParameter(parameters, 'hypothalamusAdh.relativeMinimum');
const relativeMaximum = requireParameter(parameters, 'hypothalamusAdh.relativeMaximum');

const REFERENCE_RELATIVE_CONCENTRATION = 1;

export const initialState: AdhState = {
  relativeConcentration: REFERENCE_RELATIVE_CONCENTRATION,
};

export const fields = {
  relativeConcentration: { unit: '1', mode: 'absolute' },
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const current = finiteOr(prev.relativeConcentration, REFERENCE_RELATIVE_CONCENTRATION);
  const deficit = finiteOr(io.read('bodyFluid')?.waterDeficit, 0);
  const target = clamp(
    REFERENCE_RELATIVE_CONCENTRATION + deficitGain * deficit,
    relativeMinimum,
    relativeMaximum,
  );
  const approach = 1 - Math.exp(-(io.dt / 60) / timeConstantMin);
  io.write({ relativeConcentration: current + approach * (target - current) });
}
