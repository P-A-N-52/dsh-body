/*
 * 中枢性尿崩（central DI）样肾变体：部位同 `kidney` 的变体入口，与
 * `hypothalamus-adh-di-central.ts` 配套。只用于独立清单/独立存档，不进入根清单。
 *
 * 机制：沿用正常肾的 ADH 驱动公式，但把低 ADH 端的量程拉宽（`adhGain = 3`、
 * `maxRelativeRate = 4`）。中枢变体把 ADH 相对水平固定为 0，于是请求约为
 * 4 mL/min = 5.76 L/day，只作 DI 样多尿代理。ADH 相对水平为 1 时仍是 1 mL/min 基线；
 * 缺失 ADH 输入按 1 处理。参数文件 `urine-production-di-central.parameters.json` 的值
 * 全部是 `design`、`source: null`。
 *
 * 来源（只支撑方向与量级，不支撑 4 mL/min）
 * - SRC-FLYNN-2025、SRC-HUI-2024、SRC-MUTTER-2021：笔记见
 *   `organs/human-organs/kidney/references/notes/`。三篇综述都只给出成人多尿 >3 L/day
 *   的方向与量级；Mutter 的最大抗利尿尿流约 0.5 mL/min、700–800 mL/day 只用于对照说明。
 *   4 mL/min 不是任何一篇报告的实测值、均值或拟合结果，不能写成论文参数。
 *
 * 边界：不建 AQP2/V2 受体、尿渗透压、自由水清除率或 GFR；不区分部分/完全性缺乏；
 * 不调用 transfer，不写其他部位，不处理动作。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';
import { adhDrivenUrineRequestMl } from './urine-production-core.ts';

export const id = 'kidney';
export const actionTypes: string[] = [];

type KidneyState = {
  urineProductionRequestMl: number;
};

type AdhReading = {
  relativeConcentration?: number;
};

const parameters = loadParameters(new URL('./urine-production-di-central.parameters.json', import.meta.url));
const baselineRateMlPerMin = requireParameter(parameters, 'kidney.diCentral.baselineRateMlPerMin');
const adhGain = requireParameter(parameters, 'kidney.diCentral.adhGain');
const minRelativeRate = requireParameter(parameters, 'kidney.diCentral.minRelativeRate');
const maxRelativeRate = requireParameter(parameters, 'kidney.diCentral.maxRelativeRate');

export const initialState: KidneyState = {
  urineProductionRequestMl: 0,
};

export const fields = {
  urineProductionRequestMl: { unit: 'mL', mode: 'absolute' },
};

type IO = {
  read(id: 'hypothalamusAdh'): Readonly<AdhReading> | undefined;
  readonly dt: number;
  write(next: KidneyState): void;
};

export function heartbeat(io: IO): void {
  const raw = io.read('hypothalamusAdh')?.relativeConcentration;
  io.write({
    urineProductionRequestMl: adhDrivenUrineRequestMl(raw, io.dt / 60, {
      baselineRateMlPerMin,
      adhGain,
      minRelativeRate,
      maxRelativeRate,
    }),
  });
}
