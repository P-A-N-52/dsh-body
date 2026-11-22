/*
 * 肾脏产尿请求（kidney）：只计算下一轮请求量，不持有或转移水；部位 `kidney` 的唯一写者。
 *
 * 来源（只支撑方向与延迟，不支撑本文件的方程或参数）：
 * - `SRC-OTA-1994` / `ota-1994`：证据笔记见
 *   `organs/human-organs/kidney/references/notes/ota-1994.md`（DOI 10.1507/endocrj.41.99），
 *   原文定位 Methods p.100 与 Figs. 1/3/4。主队列是 5 名原发性甲减患者（T4 治疗前/后各一轮），
 *   另有 5 名正常对照；正常对照与治疗后甲功正常状态下，水负荷后 AVP 下降、尿量增加与尿变稀。
 *   边界：甲减组反应迟钝，不能当正常生理；尿渗透压不是血浆渗透压，30 min 尿段总量不是瞬时
 *   尿流率；不能由它拼出通用曲线、增益或本文件的线性相对速率。
 * - `SRC-ANDERSEN-1990` / `andersen-1990`：证据笔记见
 *   `organs/human-organs/kidney/references/notes/andersen-1990.md`
 *   （DOI 10.1152/ajpregu.1990.259.1.R53）。AVP 输注后肾反应可延迟。边界：输注剂量轴不是血 AVP
 *   浓度；下丘脑脚本的 10 min 一阶滞后不是原文拟合，本文件也不复现延迟。
 *
 * 工程假设（design）：`A = max(0, relativeConcentration)`；
 * `relativeRate = clamp(1 - adhGain × (A - 1), minRelativeRate, maxRelativeRate)`；
 * `urineProductionRequestMl = baselineRateMlPerMin × dtMin × relativeRate`。
 * 四个参数都在同目录 `urine-production.parameters.json`，全部是 `design`。该线性关系只固定
 * “ADH 相对水平高则尿请求低”的方向，不是 Ota 或 Andersen 的拟合方程；`dtMin = io.dt / 60`。
 *
 * 初值请求为 0，第一轮后才有基线请求。缺失下丘脑输入按相对水平 1（基线）处理，避免未加载
 * 下丘脑时把缺失当成最大水利尿。请求是“下一轮”的待转出量，不是瞬时 mL/min 或已排尿量；
 * 肾脏不调用 transfer，也不写体液或膀胱。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const raw = io.read('hypothalamusAdh')?.relativeConcentration;
  const relativeConcentration = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 1;
  const relativeRate = clamp(
    1 - adhGain * (relativeConcentration - 1),
    minRelativeRate,
    maxRelativeRate,
  );
  const dtMin = io.dt / 60;

  io.write({ urineProductionRequestMl: baselineRateMlPerMin * dtMin * relativeRate });
}
