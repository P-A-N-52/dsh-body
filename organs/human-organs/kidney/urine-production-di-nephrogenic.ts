/*
 * 肾性尿崩（nephrogenic DI）样肾变体：部位同 `kidney` 的变体入口。只用于独立清单/独立
 * 存档，不进入根清单。肾脏对 ADH 不响应，因此不读取 `hypothalamusAdh`，每轮写固定请求
 * `urineRateMlPerMin × dtMin`，默认 4 mL/min = 5.76 L/day。这是 DI 样多尿代理，不是
 * 实测尿流、GFR 或自由水清除率。
 *
 * 来源（只支撑方向与量级，不支撑 4 mL/min）
 * - SRC-FLYNN-2025、SRC-HUI-2024、SRC-MUTTER-2021：笔记见
 *   `organs/human-organs/kidney/references/notes/`。三篇综述只支撑“肾性 DI = 肾脏对 ADH
 *   不响应、尿量 >3 L/day”的方向与量级；4 mL/min 是设计值，不是任何一篇的观测或拟合。
 *
 * 边界：不建 AQP2/V2 受体、尿渗透压、溶质利尿、GFR 或部分性抵抗；不区分先天/获得性；
 * 不调用 transfer，不写其他部位，不处理动作。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';
import { fixedUrineRequestMl } from './urine-production-core.ts';

export const id = 'kidney';
export const actionTypes: string[] = [];

type KidneyState = {
  urineProductionRequestMl: number;
};

const parameters = loadParameters(new URL('./urine-production-di-nephrogenic.parameters.json', import.meta.url));
const urineRateMlPerMin = requireParameter(parameters, 'kidney.diNephrogenic.urineRateMlPerMin');

export const initialState: KidneyState = {
  urineProductionRequestMl: 0,
};

export const fields = {
  urineProductionRequestMl: { unit: 'mL', mode: 'absolute' },
};

type IO = {
  readonly dt: number;
  write(next: KidneyState): void;
};

export function heartbeat(io: IO): void {
  io.write({ urineProductionRequestMl: fixedUrineRequestMl(urineRateMlPerMin, io.dt / 60) });
}
