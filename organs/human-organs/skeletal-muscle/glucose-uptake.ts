/*
 * 骨骼肌摄糖与肌糖原脚本（部位 `muscleGlucose`）；部位 `muscleGlucose` 的唯一写者。
 *
 * 自主响应（design）：本脚本不再接受 `glucose` 摊派的固定份额，而是每轮读轮初
 * `glucose.excessMassG` 与 `pancreasEndocrine.insulinRelative`，按自己的最大速率、半饱和
 * 过剩量与胰岛素敏感度计算本轮摄糖请求 `uptakeRequestG`，由 `glucose` 下一轮按序结算并
 * 经 transfer 把实际到账量转入 `uptakeG`。到账量有两个消费者：上一轮 `uptakeG` 在本轮入账
 * `glycogenG`，轮初 `physicalActivity` 再按强度消耗糖原。本脚本不调用 transfer，只写自己的
 * 字段。
 *
 * 请求公式（design，`dtMin = io.dt / 60`）：
 *   response = 1 + insulinSensitivity × (insulinRelative − 1)
 *   request  = maxUptakeRateGPerMin
 *            × excessMassG / (excessMassG + halfMaxExcessG)
 *            × response
 *            × dtMin
 * `excessMassG` 是 `glucose` 轮初高于基线的质量（g），`insulinRelative` 是无量纲相对信号，
 * 1 为基线。`insulinSensitivity = 1` 时请求与相对信号同比例，`0` 时对信号不敏感；
 * `excessMassG = 0` 时请求为 0，半饱和过剩量越小，同一过剩量越快接近最大速率。请求只是
 * 请求，本脚本不支付：余额不足由 `glucose` 钳位，实际到账量才写进 `uptakeG`。请求每轮按
 * 轮初快照重算，不沿用上一轮值。
 *
 * 入账与消耗（`dtMin = io.dt / 60`，不足一分钟的活动不按 dt 比例截断，与汗液/呼吸失水语义
 * 一致）：
 *   uptake   = 上一轮 uptakeG（自身字段缺失按 0）
 *   active   = physicalActivity 已加载且 remainingExerciseMin > 0
 *   consumed = active
 *     ? min(glycogenUseRateGPerMin × intensity × dtMin, max(0, glycogenG) + uptake)
 *     : 0
 *   glycogenG = max(0, glycogenG) + uptake − consumed
 *   write { uptakeG: 0, uptakeRequestG: request, glycogenG, glycogenConsumedG: consumed }
 *
 * 时序（design）：第 N 轮本脚本写请求；第 N+1 轮 `glucose` 读该请求并转出；第 N+2 轮本
 * 脚本把到账量入账糖原。运动动作第 1 轮进入 `physicalActivity`，第 2 轮本脚本才开始消耗
 * 糖原。轮初快照语义与现有器官一致；方括号内单位：uptakeG/g、uptakeRequestG/g、
 * glycogenG/g、glycogenConsumedG/g、remainingExerciseMin/min、intensity/1。
 *
 * 证据：本切片没有骨骼肌摄糖速率、半饱和过剩量、胰岛素敏感度、肌糖原储量、运动底物利用
 * 或糖原分解速率的实测数据。同目录 `glucose-uptake.parameters.json` 的
 * `muscleGlucose.maxUptakeRateGPerMin = 0.5`、`halfMaxExcessG = 20`、
 * `insulinSensitivity = 1.0` 与 `glycogenUseRateGPerMin = 0.5` 都是 `status: design`、
 * `source: null` 的工程占位，不是引用值、实测值或拟合结果，不能称 validated。
 * `SRC-DALLAMAN-2007` 只支撑“组织利用可分为胰岛素依赖与非依赖项”的结构方向，不支撑本
 * 脚本的速率、半饱和或敏感度；本脚本自身无登记来源。
 *
 * 未建模（design）：肌糖原容量上限、静息糖原周转、运动类型/MET/强度非线性、乳酸与
 * Cori 循环、脂肪组织分区、个体差异、胰岛素绝对浓度与受体动力学。糖原耗尽后不虚构补充；
 * 消耗按局部利用出账，不回流血糖或肝。肌肉无葡萄糖-6-磷酸酶，不向血液释放葡萄糖。
 *
 * 边界：`glucose` 未加载时按 `excessMassG = 0` 回退（无过剩信号，请求 0）；`pancreasEndocrine`
 * 未加载时按 `insulinRelative = 1` 回退；`physicalActivity` 未加载时消耗 0。上游部位已加载
 * 但字段缺失、非有限或为负时抛错使本轮失败且不写状态，不用健康常量掩盖异常；合法 0 过剩、
 * 0 胰岛素信号和 0 活动消耗都是有效值。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'muscleGlucose';
export const actionTypes: string[] = [];

type MuscleGlucoseState = {
  uptakeG: number;
  uptakeRequestG: number;
  glycogenG: number;
  glycogenConsumedG: number;
};

type SavedMuscleGlucoseState = {
  readonly uptakeG?: unknown;
  readonly uptakeRequestG?: unknown;
  readonly glycogenG?: unknown;
  readonly glycogenConsumedG?: unknown;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type GlucoseReading = {
  excessMassG?: unknown;
};

type PancreasReading = {
  insulinRelative?: unknown;
};

export const initialState: MuscleGlucoseState = {
  uptakeG: 0,
  uptakeRequestG: 0,
  glycogenG: 0,
  glycogenConsumedG: 0,
};

export const fields = {
  uptakeG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['glucose.glucoseMassG'],
  },
  uptakeRequestG: { unit: 'g', mode: 'absolute' },
  glycogenG: { unit: 'g', mode: 'absolute' },
  glycogenConsumedG: { unit: 'g', mode: 'absolute' },
};

type IO = {
  read(partId: 'muscleGlucose'): Readonly<SavedMuscleGlucoseState> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  read(partId: 'glucose'): Readonly<GlucoseReading> | undefined;
  read(partId: 'pancreasEndocrine'): Readonly<PancreasReading> | undefined;
  readonly dt: number;
  write(next: MuscleGlucoseState): void;
};

const parameters = loadParameters(
  new URL('./glucose-uptake.parameters.json', import.meta.url),
);
const glycogenUseRateGPerMin = requireParameter(
  parameters,
  'muscleGlucose.glycogenUseRateGPerMin',
);
const maxUptakeRateGPerMin = requireParameter(
  parameters,
  'muscleGlucose.maxUptakeRateGPerMin',
);
const halfMaxExcessG = requireParameter(parameters, 'muscleGlucose.halfMaxExcessG');
const insulinSensitivity = requireParameter(
  parameters,
  'muscleGlucose.insulinSensitivity',
);

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`physicalActivity.${name} must be a finite number`);
  }
  return value;
}

function readActivity(
  io: IO,
): { remainingExerciseMin: number; intensity: number } | undefined {
  const activity = io.read('physicalActivity') as ActivityReading | null | undefined;
  if (activity === undefined || activity === null) return undefined;
  if (typeof activity !== 'object') {
    throw new Error('physicalActivity must be an object');
  }
  const remainingExerciseMin = requireFinite(
    activity.remainingExerciseMin,
    'remainingExerciseMin',
  );
  const intensity = requireFinite(activity.intensity, 'intensity');
  if (remainingExerciseMin < 0) {
    throw new Error('physicalActivity.remainingExerciseMin must not be negative');
  }
  if (intensity < 0 || intensity > 1) {
    throw new Error('physicalActivity.intensity must be between 0 and 1');
  }
  return { remainingExerciseMin, intensity };
}

function requireReading(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return value;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const uptakeG = finiteOrZero(prev.uptakeG);
  const availableG = Math.max(0, finiteOrZero(prev.glycogenG)) + uptakeG;
  const activity = readActivity(io);

  const glucose = io.read('glucose');
  const excessMassG = glucose === undefined
    ? 0
    : requireReading(glucose.excessMassG, 'glucose.excessMassG');
  const pancreas = io.read('pancreasEndocrine');
  const insulinRelative = pancreas === undefined
    ? 1
    : requireReading(pancreas.insulinRelative, 'pancreasEndocrine.insulinRelative');

  const insulinResponse = 1 + insulinSensitivity * (insulinRelative - 1);
  const uptakeRequestG = maxUptakeRateGPerMin
    * (excessMassG / (excessMassG + halfMaxExcessG))
    * insulinResponse
    * (io.dt / 60);

  const consumedG = activity !== undefined && activity.remainingExerciseMin > 0
    ? Math.min(
        glycogenUseRateGPerMin * activity.intensity * (io.dt / 60),
        availableG,
      )
    : 0;

  io.write({
    uptakeG: 0,
    uptakeRequestG,
    glycogenG: availableG - consumedG,
    glycogenConsumedG: consumedG,
  });
}
