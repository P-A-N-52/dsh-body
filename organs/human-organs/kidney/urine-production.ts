/*
 * 肾脏产尿请求（kidney）：只计算下一轮请求量，不持有或转移水；部位 `kidney` 的唯一写者。
 * 正常入口；来源：`SRC-OTA-1994`（`organs/human-organs/kidney/references/notes/ota-1994.md`）
 * 与 `SRC-ANDERSEN-1990`（`organs/human-organs/kidney/references/notes/andersen-1990.md`）。
 * 原文定位、支撑的方向与不能推出什么见 `urine-production-core.ts` 头部；本入口不新增来源。
 *
 * 参数在 `urine-production.parameters.json`，全部是 `design`。初值请求为 0，第一轮后才有基线
 * 请求。缺失下丘脑输入按相对水平 1（基线）处理，避免未加载下丘脑时把缺失当成最大水利尿。
 * 请求是“下一轮”的待转出量，不是瞬时 mL/min 或已排尿量；肾脏不调用 transfer，也不写体液
 * 或膀胱。不建 GFR、肾血流量、肾小管分段、重吸收分数、尿渗透压或自由水清除率。
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

const parameters = loadParameters(new URL('./urine-production.parameters.json', import.meta.url));
const baselineRateMlPerMin = requireParameter(parameters, 'kidney.urine.baselineRateMlPerMin');
const adhGain = requireParameter(parameters, 'kidney.urine.adhGain');
const minRelativeRate = requireParameter(parameters, 'kidney.urine.minRelativeRate');
const maxRelativeRate = requireParameter(parameters, 'kidney.urine.maxRelativeRate');

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
