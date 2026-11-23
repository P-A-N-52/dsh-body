/*
 * 部位 `pineal`：松果体薄切片，按仿真时刻产生褪黑素相对量
 * `melatoninRelative`（`1` 为工程基线，0–2 的无量纲相对尺度）。消费者是
 * `interoception.sleepinessMm`；本脚本不读其他部位、不产生动作或通知，也不读自身上一轮状态。
 *
 * 昼夜曲线（`design`，不是人体测量或拟合）：
 *   hour = (io.simulatedSeconds / 3600) % periodHours
 *   melatoninRelative = clamp(
 *     baseRelative + amplitudeRelative × cos(2π × (hour − peakHour) / periodHours),
 *     0,
 *     2,
 *   )
 * 默认 baseRelative=1、amplitudeRelative=0.8、peakHour=2、periodHours=24，即
 * 02:00 峰值 1.8、14:00 谷值 0.2。`hour` 以仿真起点为 0 时，不是本地钟点；只读
 * `io.simulatedSeconds`，绝不读现实时间，所以同一仿真时刻在任意真实时间运行结果相同。
 *
 * design / 未建模（不是人体测量、拟合或独立验证）
 * - 曲线形状、相位与振幅全是工程假设，只用来驱动 `sleepinessMm` 的昼夜变化；不表示
 *   真实褪黑素浓度、光照抑制、时差、睡眠行为或个体差异，也不做绝对浓度换算。
 * - 同目录 `melatonin.parameters.json` 的 4 个参数全部 `status: design`、`source: null`；
 *   `initialState.melatoninRelative = 1` 是旧存档/首轮的工程中性基线，加载后每轮按仿真
 *   时刻重算。未建模光照、松果体体积、年龄与药物影响。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'pineal';
export const actionTypes: string[] = [];

type PinealState = {
  melatoninRelative: number;
};

type IO = {
  readonly simulatedSeconds: number;
  write(next: PinealState): void;
};

const parameters = loadParameters(new URL('./melatonin.parameters.json', import.meta.url));
const baseRelative = requireParameter(parameters, 'pineal.melatoninBaseRelative');
const amplitudeRelative = requireParameter(parameters, 'pineal.melatoninAmplitudeRelative');
const peakHour = requireParameter(parameters, 'pineal.melatoninPeakHour');
const periodHours = requireParameter(parameters, 'pineal.melatoninPeriodHours');

const MIN_RELATIVE = 0;
const MAX_RELATIVE = 2;

export const initialState: PinealState = {
  melatoninRelative: 1,
};

export const fields = {
  melatoninRelative: { unit: '1', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const hour = (io.simulatedSeconds / 3600) % periodHours;
  const melatoninRelative = clamp(
    baseRelative
      + amplitudeRelative * Math.cos((2 * Math.PI * (hour - peakHour)) / periodHours),
    MIN_RELATIVE,
    MAX_RELATIVE,
  );
  io.write({ melatoninRelative });
}
