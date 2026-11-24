/*
 * 肾脏产尿请求（kidney）：只计算下一轮请求量，不持有或转移水；部位 `kidney` 的唯一写者。
 * 正常入口；来源：`SRC-OTA-1994`（`organs/human-organs/kidney/references/notes/ota-1994.md`）
 * 与 `SRC-ANDERSEN-1990`（`organs/human-organs/kidney/references/notes/andersen-1990.md`）。
 * 原文定位、支撑的方向与不能推出什么见 `urine-production-core.ts` 头部；本入口不新增来源。
 *
 * 参数在 `urine-production.parameters.json`，全部是 `design`。初值请求为 0，第一轮后才有基线
 * 请求。缺失下丘脑输入按相对水平 1（基线）处理，避免未加载下丘脑时把缺失当成最大水利尿。
 * 请求是“下一轮”的待转出量，不是瞬时 mL/min 或已排尿量；肾脏不调用 transfer，也不写体液
 * 或膀胱。
 *
 * 循环耦合：请求乘以 `blood.gfrMlMin / 100`，其中 100 mL/min 是 `blood.baselineGfrMlMin`
 * 的 `design` 基线。`blood` 未加载时因子为 1，与接入前行为一致；已加载但 `gfrMlMin` 缺失、
 * 非有限或为负时抛错使本轮失败，不写状态。低血容量经 `blood` 的 GFR 代理降低尿请求，
 * 本脚本不自己算血容量或 GFR，也不建肾血流量、肾小管分段、重吸收分数、尿渗透压或自由水
 * 清除率。
 */
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';
import { adhDrivenUrineRequestMl } from './urine-production-core.ts';

export const id = 'kidney';
export const actionTypes: string[] = [];

type KidneyState = {
  urineProductionRequestMl: number;
};

type AdhReading = {
  relativeConcentration?: number;
};

type BloodReading = {
  gfrMlMin?: unknown;
};

const parameters = loadParameters(new URL('./urine-production.parameters.json', import.meta.url));
const baselineRateMlPerMin = requireParameter(parameters, 'kidney.urine.baselineRateMlPerMin');
const adhGain = requireParameter(parameters, 'kidney.urine.adhGain');
const minRelativeRate = requireParameter(parameters, 'kidney.urine.minRelativeRate');
const maxRelativeRate = requireParameter(parameters, 'kidney.urine.maxRelativeRate');

const BASELINE_GFR_ML_MIN =
  getNumericParameterOverride('blood.baselineGfrMlMin') ?? scaleByBodyWeight(100);

export const initialState: KidneyState = {
  urineProductionRequestMl: 0,
};

export const fields = {
  urineProductionRequestMl: { unit: 'mL', mode: 'absolute' },
};

type IO = {
  read(id: 'hypothalamusAdh'): Readonly<AdhReading> | undefined;
  read(id: 'blood'): Readonly<BloodReading> | undefined;
  readonly dt: number;
  write(next: KidneyState): void;
};

function readGfrFactor(blood: Readonly<BloodReading> | undefined): number {
  if (blood === undefined) return 1;
  if (typeof blood !== 'object' || blood === null) {
    throw new Error('kidney: blood must be an object');
  }
  const gfrMlMin = blood.gfrMlMin;
  if (typeof gfrMlMin !== 'number' || !Number.isFinite(gfrMlMin) || gfrMlMin < 0) {
    throw new Error('kidney: blood.gfrMlMin must be a finite non-negative number');
  }
  return gfrMlMin / BASELINE_GFR_ML_MIN;
}

export function heartbeat(io: IO): void {
  const raw = io.read('hypothalamusAdh')?.relativeConcentration;
  const gfrFactor = readGfrFactor(io.read('blood'));
  io.write({
    urineProductionRequestMl: adhDrivenUrineRequestMl(raw, io.dt / 60, {
      baselineRateMlPerMin,
      adhGain,
      minRelativeRate,
      maxRelativeRate,
    }) * gfrFactor,
  });
}
