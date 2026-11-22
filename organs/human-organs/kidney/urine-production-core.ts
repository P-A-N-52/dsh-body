/*
 * 肾脏产尿请求核心；正常入口 `urine-production.ts`、中枢性尿崩样肾变体
 * `urine-production-di-central.ts` 与肾性尿崩样肾变体
 * `urine-production-di-nephrogenic.ts` 共用。核心只做速率映射与请求量计算，不读写状态、
 * 不调用 transfer。
 *
 * 来源（只支撑方向与延迟，不支撑本文件的方程或参数）
 * - SRC-OTA-1994 / ota-1994：`organs/human-organs/kidney/references/notes/ota-1994.md`
 *   （DOI 10.1507/endocrj.41.99），Methods p.100 与 Figs. 1/3/4。主队列是 5 名原发性甲减
 *   患者（T4 治疗前/后各一轮），另有 5 名正常对照；正常对照与治疗后甲功正常状态下，水负荷后
 *   AVP 下降、尿量增加与尿变稀。边界：甲减组反应迟钝，不能当正常生理；尿渗透压不是血浆渗透压，
 *   30 min 尿段总量不是瞬时尿流率；不能由它拼出通用曲线、增益或本核心的线性相对速率。
 * - SRC-ANDERSEN-1990 / andersen-1990：`organs/human-organs/kidney/references/notes/andersen-1990.md`
 *   （DOI 10.1152/ajpregu.1990.259.1.R53）。AVP 输注后肾反应可延迟。边界：输注剂量轴不是血
 *   AVP 浓度；下丘脑脚本的 10 min 一阶滞后不是原文拟合，本核心也不复现延迟。
 *
 * 工程假设（design）：`A = max(0, relativeConcentration)`；
 * `relativeRate = clamp(1 - adhGain × (A - 1), minRelativeRate, maxRelativeRate)`；
 * `urineProductionRequestMl = baselineRateMlPerMin × dtMin × relativeRate`。
 * 参数都由各入口从自己的 `*.parameters.json` 传入，全部是 `design`。该线性关系只固定
 * “ADH 相对水平高则尿请求低”的方向，不是 Ota 或 Andersen 的拟合方程；`dtMin = io.dt / 60`。
 *
 * 缺失或非有限 ADH 输入按相对水平 1（基线）处理，避免未加载下丘脑时把缺失当成最大水利尿。
 * 请求是“下一轮”的待转出量，不是瞬时 mL/min 或已排尿量。
 */
export type AdhDrivenUrineParameters = {
  baselineRateMlPerMin: number;
  adhGain: number;
  minRelativeRate: number;
  maxRelativeRate: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function adhRelativeRate(
  relativeConcentration: number | undefined,
  { adhGain, minRelativeRate, maxRelativeRate }: AdhDrivenUrineParameters,
): number {
  const level = typeof relativeConcentration === 'number' && Number.isFinite(relativeConcentration)
    ? Math.max(0, relativeConcentration)
    : 1;
  return clamp(1 - adhGain * (level - 1), minRelativeRate, maxRelativeRate);
}

export function adhDrivenUrineRequestMl(
  relativeConcentration: number | undefined,
  dtMin: number,
  parameters: AdhDrivenUrineParameters,
): number {
  return parameters.baselineRateMlPerMin
    * dtMin
    * adhRelativeRate(relativeConcentration, parameters);
}

export function fixedUrineRequestMl(rateMlPerMin: number, dtMin: number): number {
  return rateMlPerMin * dtMin;
}
