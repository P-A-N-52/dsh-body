/*
 * 下丘脑 ADH 相对水平核心；正常入口 `hypothalamus-adh.ts` 的方程核心。
 * 中枢性尿崩样变体 `hypothalamus-adh-di-central.ts` 是硬固定 0，不复用这里的一阶滞后，
 * 因为“分泌缺失”没有从某个水平衰减的动力学。核心只做“目标值 + 一阶滞后”两步计算，
 * 不读写状态、不解析动作、不发通知。
 *
 * 来源（只支撑方向，不支撑本文件的方程或参数）
 * - SRC-OTA-1994 / ota-1994：`organs/human-organs/kidney/references/notes/ota-1994.md`，
 *   Methods p.100 与 Figs. 1/3/4（主队列 5 名原发性甲减患者，T4 治疗前/后各一轮；另 5 名正常
 *   对照。AVP pmol/L、尿流 mL/min、30 min 尿段）。正常对照与治疗后甲功正常状态下，水负荷后
 *   AVP 下降、尿变稀；只支撑“体液水增加后 ADH 相对水平下降”的方向。甲减组反应迟钝，不能当
 *   正常生理；尿渗不是血渗，30 min 尿段总量不是瞬时尿流率；不能把本核心输出标成 pmol/L，
 *   也不能称其为 Ota 的拟合方程。
 * - SRC-ANDERSEN-1990 / andersen-1990：`organs/human-organs/kidney/references/notes/andersen-1990.md`，
 *   AVP 输注实验；只支撑“ADH 变化后下游肾反应可以延迟”的定性方向，不支撑具体时间常数。
 *   输注剂量轴不是血浓度；`timeConstantMin=10` 不是原文拟合值。
 *
 * design（不是人体测量、拟合或独立验证）
 * - 相对水平以 1 为无量纲参考，不是血浆 AVP 浓度、分泌速率或渗透压；
 *   `target = clamp(reference + deficitGain × waterDeficit, relativeMinimum, relativeMaximum)`；
 *   `next = current + (1 − exp(−dtMin / timeConstantMin)) × (target − current)`。
 * - 缺失或非有限输入按“无亏缺 / 参考水平”处理；不建模渗透压、血容量/血压、RAAS、
 *   昼夜节律、运动、疾病或个体差异。
 */
export const REFERENCE_RELATIVE_CONCENTRATION = 1;

type AdhTargetParameters = {
  deficitGain: number;
  relativeMinimum: number;
  relativeMaximum: number;
};

export type AdhStepInput = AdhTargetParameters & {
  current?: number;
  waterDeficit?: number;
  dtMin: number;
  timeConstantMin: number;
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function adhTarget(
  waterDeficit: number | undefined,
  { deficitGain, relativeMinimum, relativeMaximum }: AdhTargetParameters,
): number {
  const deficit = finiteOr(waterDeficit, 0);
  return clamp(
    REFERENCE_RELATIVE_CONCENTRATION + deficitGain * deficit,
    relativeMinimum,
    relativeMaximum,
  );
}

export function advanceRelativeConcentration(
  current: number,
  target: number,
  dtMin: number,
  timeConstantMin: number,
): number {
  const approach = 1 - Math.exp(-(dtMin / timeConstantMin));
  return current + approach * (target - current);
}

export function stepRelativeConcentration({
  current,
  waterDeficit,
  dtMin,
  timeConstantMin,
  deficitGain,
  relativeMinimum,
  relativeMaximum,
}: AdhStepInput): number {
  const from = finiteOr(current, REFERENCE_RELATIVE_CONCENTRATION);
  const target = adhTarget(waterDeficit, { deficitGain, relativeMinimum, relativeMaximum });
  return advanceRelativeConcentration(from, target, dtMin, timeConstantMin);
}
