/*
 * 甲状旁腺（parathyroid）：PTH 相对分泌信号；部位 `parathyroid` 的唯一写者。
 *
 * 消费者：`bloodCalcium` 读 `pthRelative` 决定骨钙释放或沉积。公式（design，
 * `dtMin = io.dt / 60`）：
 *
 *   pthTarget = clamp(1 + pthGain × (referenceCalciumMgDl − bloodCalcium.mgDl), 0, 3)
 *   pthRelative = pthTarget + (prevPth − pthTarget) × 2^(−dtMin / 15)
 *
 * 轮初 `bloodCalcium.mgDl` 低时目标高于 1，PTH 上升；高于参考值时目标低于 1，PTH
 * 下降。15 min 半时、目标斜率与 0–3 范围都是脚本内 `design` 常量/参数，不是 PTH
 * 分泌、清除或钙感受受体动力学的实测半时。参数从同目录 `parathyroid.parameters.json`
 * 只读加载：`referenceCalciumMgDl = 9.5`、`pthGain = 0.5`，状态 `design`、`source: null`。
 *
 * `pthRelative` 是 0–3 的无量纲相对量，`1` 表示基线；它不是 PTH 浓度（pg/mL）、
 * 分泌率或临床检验值，不能与实测 PTH 换算。初值 1 只是未受刺激的工程基线。
 *
 * 边界：`bloodCalcium` 未加载时按参考值 9.5 回退，因此 PTH 向 1 衰减；已加载但
 * `mgDl` 缺失、非数值、非有限或为负时抛错使本轮失败且不写状态，不用参考值掩盖异常。
 * 本部位自身缺状态或缺 `pthRelative` 时按 1 起步。只读轮初快照；同轮其他脚本的写入
 * 下一轮才反映。不处理动作、不调用 transfer/notify。
 *
 * 未建模：维生素 D、肠道钙吸收、降钙素、肾小管钙重吸收、骨密度/骨折/骨代谢病、
 * 钙磷乘积、昼夜节律与个体差异。没有直接人体来源，不能称 validated。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'parathyroid';
export const actionTypes: string[] = [];

type ParathyroidState = {
  pthRelative: number;
};

type BloodCalciumReading = {
  mgDl?: unknown;
};

export const initialState: ParathyroidState = {
  pthRelative: 1,
};

export const fields = {
  pthRelative: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'parathyroid'): Readonly<ParathyroidState> | undefined;
  read(id: 'bloodCalcium'): Readonly<BloodCalciumReading> | null | undefined;
  readonly dt: number;
  write(next: ParathyroidState): void;
};

const parameters = loadParameters(new URL('./parathyroid.parameters.json', import.meta.url));
const referenceCalciumMgDl = requireParameter(
  parameters,
  'parathyroid.referenceCalciumMgDl',
);
const pthGain = requireParameter(parameters, 'parathyroid.pthGain');

const pthHalfTimeMin = 15;
const pthTargetRange = { min: 0, max: 3 };

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readBloodCalciumMgDl(io: IO): number {
  const bloodCalcium = io.read('bloodCalcium');
  if (bloodCalcium === undefined) return referenceCalciumMgDl;
  if (typeof bloodCalcium !== 'object' || bloodCalcium === null) {
    throw new Error('parathyroid: bloodCalcium must be an object');
  }
  const mgDl = bloodCalcium.mgDl;
  if (typeof mgDl !== 'number' || !Number.isFinite(mgDl) || mgDl < 0) {
    throw new Error('parathyroid: bloodCalcium.mgDl must be a finite non-negative number');
  }
  return mgDl;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const prevPth = finiteOr(prev.pthRelative, initialState.pthRelative);
  const bloodCalciumMgDl = readBloodCalciumMgDl(io);

  const pthTarget = clamp(
    1 + pthGain * (referenceCalciumMgDl - bloodCalciumMgDl),
    pthTargetRange.min,
    pthTargetRange.max,
  );
  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / pthHalfTimeMin);

  io.write({
    pthRelative: pthTarget + (prevPth - pthTarget) * retention,
  });
}
