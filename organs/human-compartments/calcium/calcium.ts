/*
 * 血钙隔室（bloodCalcium）：血钙浓度与骨钙库；部位 `bloodCalcium` 的唯一写者。
 * 骨钙库只作钙缓冲，不是骨密度、骨折或骨代谢模型。
 *
 * 消费者：`parathyroid` 读 `mgDl` 调整 PTH，`interoception` 读 `mgDl` 产出低钙/高钙
 * 症状读数；`boneStoreG` 只在本脚本内维护。公式（design，`dtMin = io.dt / 60`）：
 *
 *   release = pthRelative > 1
 *     ? min(boneReleaseRateGPerMin × (pthRelative − 1) × dtMin, boneStoreG)
 *     : 0
 *   rawDeposit = pthRelative < 1
 *     ? boneDepositRateGPerMin × (1 − pthRelative) × dtMin
 *     : 0
 *   deposit = min(rawDeposit, max(0, boneCapacityG − prevBoneStoreG))
 *   excretion = blood.gfrMlMin × calciumExcretionPerMlG
 *               × max(0, 1 − pthRelative) × dtMin
 *   boneStoreG = clamp(prevBoneStoreG − release + deposit, 0, boneCapacityG)
 *   mgDl = clamp(prevMgDl + (release − deposit − excretion) × 1000 / distributionVolumeDl,
 *                0, 20)
 *
 * `release` 以骨钙库当前量为上限，骨钙库不会为负；`deposit` 在扣除血钙前先按骨容量上限
 * `boneCapacityG − prevBoneStoreG` 钳位以保证钙质量守恒。排泄只在 PTH 低于 1 时出现：
 * PTH = 1 时为 0，因此 9.5 mg/dL 是稳定设定点；PTH < 1 时随 (1 − pthRelative) 线性增加，
 * PTH ≥ 1 时视为完全重吸收。这是 PTH 调节肾小管钙重吸收的 `design` 代理，不是实测肾钙
 * 排泄或转运体动力学。`× 1000 / distributionVolumeDl` 把 g 换算为 mg 并除以 dL 得到 mg/dL。
 *
 * 参数从同目录 `calcium.parameters.json` 只读加载，全部 `design`、`source: null`：
 * `referenceMgDl = 9.5`、`boneStoreInitialG = 100`、`boneCapacityG = 200`、
 * `boneReleaseRateGPerMin = 0.0004`、`boneDepositRateGPerMin = 0.0004`、
 * `calciumExcretionPerMlG = 0.000001`、`distributionVolumeDl = 140`。这些不是实测
 * 骨钙流率、肾钙排泄、分布体积或人群参考值。
 *
 * 边界：`parathyroid` 未加载时 PTH 按 1；`blood` 未加载时 GFR 按 100 mL/min。已加载
 * 但字段缺失、非数值、非有限或为负时抛错使本轮失败且不写状态。自身缺状态或缺字段时
 * 回退到 9.5 mg/dL 与 100 g。只读轮初快照；同轮其他脚本的写入下一轮才反映。不处理
 * 动作、不调用 transfer/notify。
 *
 * 未建模：维生素 D、肠道钙吸收、肾小管钙重吸收的分子机制、分段与转运体、降钙素、
 * 钙磷乘积、骨密度/骨折/骨代谢病、血浆蛋白结合、酸碱与个体差异。没有直接人体来源，
 * 不能称 validated。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'bloodCalcium';
export const actionTypes: string[] = [];

type BloodCalciumState = {
  mgDl: number;
  boneStoreG: number;
};

type ParathyroidReading = {
  pthRelative?: unknown;
};

type BloodReading = {
  gfrMlMin?: unknown;
};

const parameters = loadParameters(new URL('./calcium.parameters.json', import.meta.url));
const referenceMgDl = requireParameter(parameters, 'calcium.referenceMgDl');
const boneStoreInitialG = requireParameter(parameters, 'calcium.boneStoreInitialG');
const boneCapacityG = requireParameter(parameters, 'calcium.boneCapacityG');
const boneReleaseRateGPerMin = requireParameter(
  parameters,
  'calcium.boneReleaseRateGPerMin',
);
const boneDepositRateGPerMin = requireParameter(
  parameters,
  'calcium.boneDepositRateGPerMin',
);
const calciumExcretionPerMlG = requireParameter(
  parameters,
  'calcium.calciumExcretionPerMlG',
);
const distributionVolumeDl = requireParameter(parameters, 'calcium.distributionVolumeDl');

const fallbackPthRelative = 1;
const fallbackGfrMlMin = 100;
const mgDlRange = { min: 0, max: 20 };

export const initialState: BloodCalciumState = {
  mgDl: referenceMgDl,
  boneStoreG: boneStoreInitialG,
};

export const fields = {
  mgDl: { unit: 'mg/dL', mode: 'absolute' },
  boneStoreG: { unit: 'g', mode: 'absolute' },
};

type IO = {
  read(id: 'bloodCalcium'): Readonly<BloodCalciumState> | undefined;
  read(id: 'parathyroid'): Readonly<ParathyroidReading> | undefined;
  read(id: 'blood'): Readonly<BloodReading> | undefined;
  readonly dt: number;
  write(next: BloodCalciumState): void;
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPthRelative(io: IO): number {
  const parathyroid = io.read('parathyroid');
  if (parathyroid === undefined) return fallbackPthRelative;
  if (typeof parathyroid !== 'object' || parathyroid === null) {
    throw new Error('bloodCalcium: parathyroid must be an object');
  }
  const pthRelative = parathyroid.pthRelative;
  if (
    typeof pthRelative !== 'number'
    || !Number.isFinite(pthRelative)
    || pthRelative < 0
  ) {
    throw new Error(
      'bloodCalcium: parathyroid.pthRelative must be a finite non-negative number',
    );
  }
  return pthRelative;
}

function readGfrMlMin(io: IO): number {
  const blood = io.read('blood');
  if (blood === undefined) return fallbackGfrMlMin;
  if (typeof blood !== 'object' || blood === null) {
    throw new Error('bloodCalcium: blood must be an object');
  }
  const gfrMlMin = blood.gfrMlMin;
  if (typeof gfrMlMin !== 'number' || !Number.isFinite(gfrMlMin) || gfrMlMin < 0) {
    throw new Error('bloodCalcium: blood.gfrMlMin must be a finite non-negative number');
  }
  return gfrMlMin;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const prevMgDl = finiteOr(prev.mgDl, initialState.mgDl);
  const prevBoneStoreG = finiteOr(prev.boneStoreG, initialState.boneStoreG);
  const pthRelative = readPthRelative(io);
  const gfrMlMin = readGfrMlMin(io);

  const dtMin = io.dt / 60;
  const releaseG = pthRelative > fallbackPthRelative
    ? Math.min(boneReleaseRateGPerMin * (pthRelative - fallbackPthRelative) * dtMin, prevBoneStoreG)
    : 0;
  const rawDepositG = pthRelative < fallbackPthRelative
    ? boneDepositRateGPerMin * (fallbackPthRelative - pthRelative) * dtMin
    : 0;
  const depositG = Math.min(rawDepositG, Math.max(0, boneCapacityG - prevBoneStoreG));
  const excretionG = gfrMlMin
    * calciumExcretionPerMlG
    * Math.max(0, fallbackPthRelative - pthRelative)
    * dtMin;

  io.write({
    mgDl: clamp(
      prevMgDl + ((releaseG - depositG - excretionG) * 1000) / distributionVolumeDl,
      mgDlRange.min,
      mgDlRange.max,
    ),
    boneStoreG: clamp(prevBoneStoreG - releaseG + depositG, 0, boneCapacityG),
  });
}
