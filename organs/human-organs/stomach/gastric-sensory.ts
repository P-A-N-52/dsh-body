/**
 * 部位 `stomachSensory`：胃壁机械感受的归一化代理（P0），只写 `mechanical`，P0 没有消费者。
 *
 * 直接证据：无。`source-index.csv` 没有胃壁张力或机械感受末梢的人体测量；
 * `stomachSensory.referenceVolumeMl`（1000 mL）与 `stomachSensory.response.exponent`（1）
 * 都是 `design`，不是人体拟合。
 *
 * 相关但不能替代：`SRC-LEVINE-2015` / `levine-2015`
 * （`organs/human-organs/stomach/references/notes/levine-2015.md`；原文定位 Table 1 与 Methods 第 3 节，
 * 笔记获取状态为全文）。该研究报告 237 mL、355 kcal 高脂液餐后 0–60 min 的胃饱满 VAS
 * （0–100，n=16，mean±SEM）；VAS 是症状强度，不是胃壁张力或迷走传入放电，该研究也没有测胃容积或胃内压力，
 * 不能用来标定本代理。`SRC-CAMPS-2016`
 * （`organs/human-organs/stomach/references/notes/camps-2016.md`，摘要 Results）的 40 min 饱感点值
 * 同样只是相关参考：它测的是胃内容量与主观食欲评分，没有测胃壁机械感受。
 *
 * `mechanical = min(1, volumeMl / referenceVolumeMl) ^ exponent` 是归一化充盈代理，
 * 不是张力，也不是神经放电；读的是轮初快照，同一轮摄入要下一轮才反映。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'stomachSensory';
export const actionTypes = [];

type SensoryState = {
  mechanical: number;
};

type StomachState = {
  volumeMl: number;
};

type IO = {
  read(id: 'stomach'): Readonly<StomachState> | undefined;
  write(next: SensoryState): void;
};

const parameters = loadParameters(new URL('./gastric-sensory.parameters.json', import.meta.url));
const referenceVolumeMl = requireParameter(parameters, 'stomachSensory.referenceVolumeMl');
const exponent = requireParameter(parameters, 'stomachSensory.response.exponent');

export const initialState: SensoryState = {
  mechanical: 0,
};

export const fields = {
  mechanical: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: IO): void {
  const volumeMl = io.read('stomach')?.volumeMl;
  const volume = typeof volumeMl === 'number' && Number.isFinite(volumeMl) ? Math.max(0, volumeMl) : 0;
  const ratio = Math.min(1, volume / referenceVolumeMl);
  io.write({ mechanical: ratio ** exponent });
}
