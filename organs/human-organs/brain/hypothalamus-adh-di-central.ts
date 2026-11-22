/*
 * 中枢性尿崩（central DI）样代理：部位同 `hypothalamusAdh` 的变体入口。
 * 只用于独立清单/独立存档的 DI 样情景，不进入根清单；默认身体绝不加载本文件。
 *
 * 机制：ADH 分泌缺失用“相对水平恒 0”代理，每轮直接写
 * `relativeConcentration = fixedRelativeConcentration = 0`，不读 `bodyFluid`、不做一阶滞后。
 * 分泌缺失不是从某个水平衰减，因此不复用正常入口的水平动力学；这也不是血浆 AVP 测量。
 *
 * 来源（只支撑机制方向与多尿量级，不支撑任何数值）
 * - SRC-FLYNN-2025 / flynn-2025：`organs/human-organs/kidney/references/notes/flynn-2025.md`。
 *   综述把 DI 分为中枢（ADH 分泌不足）与肾性（肾脏对 ADH 不响应）；成人多尿定义为
 *   尿量 >3 L/day（另有 2 L/m²、50 mL/kg/24 h）。只支撑“中枢 ADH 缺失 → 低渗性多尿”
 *   的方向与 >3 L/day 的量级；没有可移植的 ADH 相对水平、时程或增益。
 * - SRC-HUI-2024 / hui-2024：`organs/human-organs/kidney/references/notes/hui-2024.md`。
 *   StatPearls 综述：多尿 >3 L/day（成人）或 2 L/m²（儿童），低渗尿 <300 mOsm/kg；
 *   同样只支撑方向与量级。不能把 0 相对水平写成实测 AVP 或诊断阈值。
 * - SRC-MUTTER-2021 / mutter-2021：`organs/human-organs/kidney/references/notes/mutter-2021.md`。
 *   综述：成人 DI 常定义为 24 h 尿量 >3–3.5 L、尿渗 <300 mOsm/kg；最大抗利尿时尿流约
 *   0.5 mL/min、700–800 mL/day。只用于说明 DI 样代理的量级与正常抗利尿的差距。
 *
 * 工程假设（design）：0 是“无可检测 ADH”的简化代理；参数文件
 * `hypothalamus-adh-di-central.parameters.json` 的值是 `design`、`source: null`。
 * 中枢 DI 需要配合低 ADH 量程的肾变体（`urine-production-di-central.ts`）才能达到
 * 约 4 mL/min（5.76 L/day）；单独替换本文件时正常肾在 A=0 只到 2 mL/min。
 * 本变体不处理动作、不调用 io.notify，也不写其他部位。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'hypothalamusAdh';
export const actionTypes: string[] = [];

type AdhState = {
  relativeConcentration: number;
};

type IO = {
  write(next: AdhState): void;
};

const parameters = loadParameters(new URL('./hypothalamus-adh-di-central.parameters.json', import.meta.url));
const fixedRelativeConcentration = requireParameter(parameters, 'hypothalamusAdh.central.fixedRelativeConcentration');

export const initialState: AdhState = {
  relativeConcentration: fixedRelativeConcentration,
};

export const fields = {
  relativeConcentration: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: IO): void {
  io.write({ relativeConcentration: fixedRelativeConcentration });
}
