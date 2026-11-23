/*
 * 部位 `testes`：睾酮相对信号薄切片；本部位唯一写者，无动作、无 transfer，也不写其他部位。
 *
 * 消费者（本切片设计）：`sexualResponse` 的唤醒目标按 `testosteroneRelative` 缩放，
 * `interoception` 用它派生 `libidoMm`。本脚本只提供无量纲相对信号，1 表示工程基线；
 * 它不是血清睾酮浓度、游离激素、分泌率或脉冲幅度，不能与 nmol/L、ng/dL 等实测值换算。
 *
 * 公式（design，dtMin = io.dt / 60，hour = (io.simulatedSeconds / 3600) % 24）：
 *   target = baselineRelative + circadianAmplitude × cos(2π × (hour − 8) / 24)
 *   testosteroneRelative = target + (prev − target) × 2^(−dtMin / responseHalfTimeMin)
 * 即相对信号以 60 min 半时向当前昼夜目标一阶趋近；本切片没有刻意外源驱动，半时只作用于
 * 旧存档或预置值的回落，稳态跟随基线 ±0.1 的余弦曲线（08:00 峰值 1.1、20:00 谷值 0.9）。
 * `hour` 以仿真起点为 0 时，只读 `io.simulatedSeconds`，绝不读现实时间或本地钟点，所以
 * 同一仿真时刻在任意真实时间运行结果相同。
 *
 * 参数在同目录 `testosterone.parameters.json`，三项全部 `status: design`、`source: null`；
 * 基线、振幅、相位与半时都是工程假设，不是人体测量、拟合或独立验证。
 *
 * 未建模（design）：HPG 轴（GnRH/LH/FSH）、负反馈、脉冲分泌、昼夜相位个体差异、性腺功能
 * 减退/亢进、年龄/BMI/疾病/药物影响、结合蛋白与绝对浓度、睾酮对肌肉/骨骼/情绪的效应；
 * 这些效应由各自脚本或后续切片决定。输出只含一个有限数字段，JSON-safe。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'testes';
export const actionTypes: string[] = [];

type TestesState = {
  testosteroneRelative: number;
};

type IO = {
  read(id: 'testes'): Readonly<TestesState> | undefined;
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: TestesState): void;
};

const parameters = loadParameters(new URL('./testosterone.parameters.json', import.meta.url));
const baselineRelative = requireParameter(parameters, 'testes.baselineRelative');
const circadianAmplitude = requireParameter(parameters, 'testes.circadianAmplitude');
const responseHalfTimeMin = requireParameter(parameters, 'testes.responseHalfTimeMin');

const periodHours = 24;
const peakHour = 8;

export const initialState: TestesState = {
  testosteroneRelative: 1,
};

export const fields = {
  testosteroneRelative: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = io.dt / 60;
  const hour = (io.simulatedSeconds / 3600) % periodHours;
  const target = baselineRelative
    + circadianAmplitude * Math.cos((2 * Math.PI * (hour - peakHour)) / periodHours);
  const retention = 2 ** (-dtMin / responseHalfTimeMin);
  const testosteroneRelative = target + (prev.testosteroneRelative - target) * retention;

  io.write({ testosteroneRelative });
}
