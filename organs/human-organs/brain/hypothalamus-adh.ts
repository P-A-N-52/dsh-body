/*
 * 部位 `hypothalamusAdh`：下丘脑神经内分泌脚本，把体液水量亏缺代理
 * `bodyFluid.waterDeficit` 映射成相对 ADH 水平 `relativeConcentration`。
 * 只写自己的部位，不读口渴部位，也不产出动作、通知或饮水行为；口渴由
 * `hypothalamus-thirst.ts` 独立写 `hypothalamusThirst`。
 *
 * 来源：`SRC-OTA-1994`（`organs/human-organs/kidney/references/notes/ota-1994.md`）与
 * `SRC-ANDERSEN-1990`（`organs/human-organs/kidney/references/notes/andersen-1990.md`）；
 * 原文定位、支撑的方向与不能推出什么见 `hypothalamus-adh-core.ts` 头部。本入口不新增来源。
 * 参数在 `hypothalamus-adh.parameters.json`，全部是 `design`，不是 Ota 或 Andersen 的拟合值。
 * 相对水平不是血浆 AVP 浓度、分泌速率或渗透压。
 *
 * 工程假设（design）：一阶滞后提供工程反应延迟；初值为参考水平 1；只读轮初快照，
 * 同一轮里 `bodyFluid` 的吸收/产尿下一轮才反映；缺失或非有限 `waterDeficit` 按 0。
 * 不建模渗透压、血容量/血压、RAAS、昼夜节律、运动、疾病或个体差异；不调用 io.notify，
 * 也不处理动作。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';
import {
  REFERENCE_RELATIVE_CONCENTRATION,
  stepRelativeConcentration,
} from './hypothalamus-adh-core.ts';

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

export const initialState: AdhState = {
  relativeConcentration: REFERENCE_RELATIVE_CONCENTRATION,
};

export const fields = {
  relativeConcentration: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const next = stepRelativeConcentration({
    current: prev.relativeConcentration,
    waterDeficit: io.read('bodyFluid')?.waterDeficit,
    dtMin: io.dt / 60,
    timeConstantMin,
    deficitGain,
    relativeMinimum,
    relativeMaximum,
  });
  io.write({ relativeConcentration: next });
}
