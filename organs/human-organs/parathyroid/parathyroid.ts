/*
 * 甲状旁腺（parathyroid）：血浆 PTH 物理浓度代理（`pthPgMl`, pg/mL）；部位 `parathyroid` 的唯一写者。
 *
 * 消费者：`bloodCalcium` 读 `pthPgMl`（按静态参考 `30 pg/mL` 归一化）决定骨钙释放或沉积与肾钙重吸收。
 * 公式（design，`dtMin = io.dt / 60`）：
 *
 *   pthTarget = clamp(baselinePthPgMl + pthGainPgMlPerMgDl × (referenceCalciumMgDl − bloodCalcium.mgDl),
 *                     0, maxPthPgMl)
 *   pthPgMl = pthTarget + (prevPth − pthTarget) × 2^(−dtMin / halfTimeMin)
 *
 * 轮初 `bloodCalcium.mgDl` 低于 9.5 时目标高于 30 pg/mL，PTH 上升；高于参考值时目标低于 30 pg/mL，
 * PTH 下降。`baselinePthPgMl = 30 pg/mL`、`pthGainPgMlPerMgDl = 15 pg/mL/(mg/dL)`、`maxPthPgMl = 90 pg/mL`
 * 与 `halfTimeMin = 15 min` 全部从同目录 `parathyroid.parameters.json` 只读加载，状态均为 `design`、
 * `source: null`，不是人体 iPTH 实验室参考区间、分泌速率或钙敏感受体动力学拟合。
 *
 * 已全面统一为纯物理浓度单位 `pthPgMl`（pg/mL），不保留旧无量纲相对字段 `pthRelative` 回退；
 * 旧档缺少 `pthPgMl` 时按 `initialState`（`30 pg/mL`）起步。
 *
 * 边界：`bloodCalcium` 未加载时按参考值 9.5 回退，因此 PTH 向 30 pg/mL 衰减；已加载但
 * `mgDl` 缺失、非数值、非有限或为负时抛错使本轮失败且不写状态，不用参考值掩盖异常。
 * 只读轮初快照；同轮其他脚本的写入下一轮才反映。不处理动作、不调用 transfer/notify。
 *
 * 未建模：维生素 D、肠道钙吸收、降钙素、肾小管钙重吸收、骨密度/骨折/骨代谢病、
 * 钙磷乘积、昼夜节律与个体差异。没有直接人体来源，不能称 validated。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'parathyroid';
export const actionTypes: string[] = [];

type ParathyroidState = {
  pthPgMl: number;
};

type BloodCalciumReading = {
  mgDl?: unknown;
};

const parameters = loadParameters(new URL('./parathyroid.parameters.json', import.meta.url));
const referenceCalciumMgDl = requireParameter(
  parameters,
  'parathyroid.referenceCalciumMgDl',
);
const baselinePthPgMl = requireParameter(parameters, 'parathyroid.baselinePthPgMl');
const pthGainPgMlPerMgDl = requireParameter(parameters, 'parathyroid.pthGainPgMlPerMgDl');
const maxPthPgMl = requireParameter(parameters, 'parathyroid.maxPthPgMl');
const halfTimeMin = requireParameter(parameters, 'parathyroid.halfTimeMin');

export const initialState: ParathyroidState = {
  pthPgMl: baselinePthPgMl,
};

export const fields = {
  pthPgMl: { unit: 'pg/mL', mode: 'absolute' },
};

type IO = {
  read(id: 'parathyroid'): Readonly<ParathyroidState> | undefined;
  read(id: 'bloodCalcium'): Readonly<BloodCalciumReading> | null | undefined;
  readonly dt: number;
  write(next: ParathyroidState): void;
};

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
  const prevPth = finiteOr(prev.pthPgMl, initialState.pthPgMl);
  const bloodCalciumMgDl = readBloodCalciumMgDl(io);

  const pthTarget = clamp(
    baselinePthPgMl + pthGainPgMlPerMgDl * (referenceCalciumMgDl - bloodCalciumMgDl),
    0,
    maxPthPgMl,
  );
  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / halfTimeMin);

  io.write({
    pthPgMl: pthTarget + (prevPth - pthTarget) * retention,
  });
}
