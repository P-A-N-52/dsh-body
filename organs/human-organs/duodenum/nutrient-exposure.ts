/*
 * 十二指肠 P0：对 `stomach.emptiedKcal` 做一阶滤波，输出“近期营养暴露”代理。
 *
 * 直接证据：无。`organs/human-organs/references/source-index.csv` 没有十二指肠
 * 营养暴露、吸收或肠激素的人体测量；`duodenum.exposure.timeConstantMin = 10 min`
 * 是 `design`（同目录 `nutrient-exposure.parameters.json`），不是人体测量值。
 *
 * 上游证据只支撑胃排空，不支撑本滤波：
 * - `SRC-MUDIE-2014` / `mudie-2014`：笔记
 *   `organs/human-organs/stomach/references/notes/mudie-2014.md`，原文定位摘要
 *   Results（PMID 25115349；abstract_read，未读全文）。240 mL 白水后胃水 T50
 *   13 min、45 min 回到饮前基线；只用于上游 `stomach/motility.ts` 的
 *   `stomach.emptying.halfTimeMin` 时间尺度（该参数仍标 `design`）。
 * - `SRC-CAMPS-2016` / `camps-2016`：笔记
 *   `organs/human-organs/stomach/references/notes/camps-2016.md`，原文定位摘要
 *   Results（PMID 27281305；abstract_read，未读全文）。能量密度改变胃排空
 *   t50（thin-100 26.5 min、thin-500 69.5 min）；只用于上游
 *   `stomach.emptying.energyDensityGainMinPerKcalPerMl` 的方向与量级。
 *
 * 不能推出：两项来源都没有测十二指肠营养暴露、吸收、门静脉葡萄糖或肠激素，
 * 与本文件的 10 min 时间常数没有推导关系；`kcal/min` 只是滤波后的到达速率
 * 代理，不能当吸收入血速率、血糖或激素水平。胃→十二指肠有一轮偏移：读的是
 * 轮初快照 `stomach.emptiedKcal`。P0 没有消费者；P1 由 `brain/interoception.ts`
 * 读取，但仍没有通知或会话消费者。
 *
 * 唾液淀粉酶增益（2026-11-24 唾液腺切片，design）：
 * - `salivaryGlands` 是可选软读：未加载时增益按 0，输出与旧行为逐点一致。
 * - 只有轮初 `stomach.emptiedCarbohydrateG` 为有限正数时才认为本轮排出的内容含碳水；
 *   缺失、0、非数或非有限按不含碳水处理，输出不变。旧 `motility.ts` 清单没有该字段，
 *   因此仍走无增益路径。
 * - 有效到达速率 = `stomach.emptiedKcal / dtMin × (1 + salivaryAmylaseGain ×
 *   salivaRateMlPerMin / basalRateMlPerMin)`，再进入一阶滤波。增益乘在到达速率上，
 *   不乘在滤波状态上，避免逐轮复利；稳态暴露是未加增益时的同一倍数。
 * - `salivaryGlands` 已加载但 `salivaRateMlPerMin` 缺失、非数、非有限或为负时抛错，
 *   本轮不写状态；不含碳水的餐不读取该字段，因此不受损坏的唾液状态影响。
 * - `duodenum.salivaryAmylaseGain = 0.05` 与归一化用的
 *   `duodenum.referenceSalivaRateMlPerMin = 0.5` 均放在本目录参数文件，不再直接导入唾液腺参数文件。
 *   没有淀粉酶浓度或餐食成分的人体测量，增益和碳水判定都是工程假设。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'duodenum';
export const actionTypes: string[] = [];

type DuodenumState = {
  nutrientExposure: number;
};

type StomachReading = {
  emptiedKcal?: number;
  emptiedCarbohydrateG?: number;
};

type SalivaryGlandsReading = {
  salivaRateMlPerMin?: number;
};

export const initialState: DuodenumState = {
  nutrientExposure: 0,
};

export const fields = {
  nutrientExposure: { unit: 'kcal/min', mode: 'absolute' },
};

type IO = {
  read(id: 'duodenum'): Readonly<DuodenumState> | undefined;
  read(id: 'stomach'): Readonly<StomachReading> | undefined;
  read(id: 'salivaryGlands'): Readonly<SalivaryGlandsReading> | undefined;
  readonly dt: number;
  write(next: DuodenumState): void;
};

const parameters = loadParameters(new URL('./nutrient-exposure.parameters.json', import.meta.url));
const timeConstantMin = requireParameter(parameters, 'duodenum.exposure.timeConstantMin');
const salivaryAmylaseGain = requireParameter(parameters, 'duodenum.salivaryAmylaseGain');
const referenceSalivaRateMlPerMin = requireParameter(
  parameters,
  'duodenum.referenceSalivaRateMlPerMin',
);

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function amylaseFactor(io: IO, emptiedCarbohydrateG: number): number {
  if (emptiedCarbohydrateG <= 0) return 1;
  const part = io.read('salivaryGlands');
  if (part === undefined || part === null) return 1;
  if (typeof part !== 'object') throw new Error('salivaryGlands must be an object');
  const salivaRate = part.salivaRateMlPerMin;
  if (typeof salivaRate !== 'number' || !Number.isFinite(salivaRate) || salivaRate < 0) {
    throw new Error('salivaryGlands.salivaRateMlPerMin must be a non-negative finite number');
  }
  return 1 + (salivaryAmylaseGain * salivaRate) / referenceSalivaRateMlPerMin;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const stomach = io.read('stomach');
  const emptiedKcal = finiteOrZero(stomach?.emptiedKcal);
  const emptiedCarbohydrateG = finiteOrZero(stomach?.emptiedCarbohydrateG);
  const dtMin = io.dt / 60;
  const arrivalRate = (emptiedKcal / dtMin) * amylaseFactor(io, emptiedCarbohydrateG);
  const exposure = Number.isFinite(prev.nutrientExposure) ? Math.max(0, prev.nutrientExposure) : 0;
  const next = exposure + (1 - Math.exp(-dtMin / timeConstantMin)) * (arrivalRate - exposure);

  io.write({ nutrientExposure: Math.max(0, next) });
}
