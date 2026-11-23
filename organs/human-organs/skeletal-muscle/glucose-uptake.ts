/*
 * 骨骼肌摄糖与肌糖原脚本（部位 `muscleGlucose`）；部位 `muscleGlucose` 的唯一写者。
 *
 * 消费者：`glucose` 的质量账每轮把 `glucoseMassG` 的一部分经 transfer 转入本部位
 * `uptakeG`；轮初 `physicalActivity` 提供 `remainingExerciseMin` 与 `intensity`。本脚本
 * 不读葡萄糖或胰岛素、不调用 transfer；`uptakeG` 只经 `transferIn` 增加，每轮 write 先归 0，
 * 再把上一轮在途量入账糖原并按轮初活动消耗。
 *
 * 时序（design）：第 N 轮 `glucose` 转出 U(N)；第 N+1 轮本脚本把 U(N) 计入 `glycogenG`
 * 并写 `uptakeG = 0`，随后 U(N+1) 到账。运动动作第 1 轮进入 `physicalActivity`，第 2 轮本
 * 脚本才开始消耗糖原。轮初快照语义与现有器官一致；方括号内单位：uptakeG/g、
 * glycogenG/g、glycogenConsumedG/g、remainingExerciseMin/min、intensity/1。
 *
 * 证据：本切片没有肌糖原储量、运动底物利用或糖原分解速率的实测数据；同目录
 * `glucose-uptake.parameters.json` 的 `muscleGlucose.glycogenUseRateGPerMin = 0.5 g/min`
 * 是 `status: design`、`source: null` 的工程占位，不是引用值，不能称 validated。
 * `SRC-DALLAMAN-2007` 只支撑 `glucose` 侧“处置可分区”的结构方向，不支撑本脚本速率；本脚本
 * 自身无登记来源。
 *
 * 未建模（design）：肌糖原容量上限、静息糖原周转、运动类型/MET/强度非线性、乳酸与
 * Cori 循环、肝糖原、脂肪组织分区、个体差异。糖原耗尽后不虚构补充；消耗按局部利用出账，
 * 不回流肝（模型无肝）。
 *
 * 公式（dtMin = io.dt / 60，不足一分钟的活动不按 dt 比例截断，与汗液/呼吸失水语义一致）：
 *   uptake   = 上一轮 uptakeG（自身字段缺失按 0）
 *   active   = physicalActivity 已加载且 remainingExerciseMin > 0
 *   consumed = active
 *     ? min(glycogenUseRateGPerMin × intensity × dtMin, max(0, glycogenG) + uptake)
 *     : 0
 *   glycogenG = max(0, glycogenG) + uptake − consumed
 *   write { uptakeG: 0, glycogenG, glycogenConsumedG: consumed }
 *
 * `physicalActivity` 未加载时消耗 0；已加载但字段缺失、非有限、剩余时间为负或 intensity
 * 超出 [0, 1] 时抛错使本轮失败且不写状态，不用健康常量掩盖异常。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'muscleGlucose';
export const actionTypes: string[] = [];

type MuscleGlucoseState = {
  uptakeG: number;
  glycogenG: number;
  glycogenConsumedG: number;
};

type SavedMuscleGlucoseState = {
  readonly uptakeG?: unknown;
  readonly glycogenG?: unknown;
  readonly glycogenConsumedG?: unknown;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

export const initialState: MuscleGlucoseState = {
  uptakeG: 0,
  glycogenG: 0,
  glycogenConsumedG: 0,
};

export const fields = {
  uptakeG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['glucose.glucoseMassG'],
  },
  glycogenG: { unit: 'g', mode: 'absolute' },
  glycogenConsumedG: { unit: 'g', mode: 'absolute' },
};

type IO = {
  read(partId: 'muscleGlucose'): Readonly<SavedMuscleGlucoseState> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
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

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const uptakeG = finiteOrZero(prev.uptakeG);
  const availableG = Math.max(0, finiteOrZero(prev.glycogenG)) + uptakeG;
  const activity = readActivity(io);
  const consumedG = activity !== undefined && activity.remainingExerciseMin > 0
    ? Math.min(
        glycogenUseRateGPerMin * activity.intensity * (io.dt / 60),
        availableG,
      )
    : 0;

  io.write({
    uptakeG: 0,
    glycogenG: availableG - consumedG,
    glycogenConsumedG: consumedG,
  });
}
