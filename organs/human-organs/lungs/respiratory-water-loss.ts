/*
 * 肺呼吸失水脚本（lungs）：只计算与运动相关的呼吸失水请求；部位 `lungs` 的唯一写者，
 * 不持有体液水，也不调用 transfer。消费者是 `bodyFluid`：其水账读取上一轮
 * `lungs.respiratoryWaterLossRequestMl` 作为向肺水槽的转出上限，Gateway 在 transfer 阶段
 * 再把实际失水加入 `lungs.respiratoryWaterLossMl`。本脚本每轮 write 先把实际量归 0，
 * 实际量只由 transferIn 增加。
 *
 * 设计来源：docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md。
 * 同目录 `respiratory-water-loss.parameters.json` 只有一个参数
 * `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3 mL/min`，状态 `design`、
 * `source: null`。它是 intensity=1 时的临时工程速率，不是实测人体呼吸失水率，也不是总呼吸
 * 失水；不能称 validated。未来由具备环境条件与活动通气证据的通气/环境模型替换；本步不建
 * 通气量、呼吸频率或潮气量等没有消费者的通气状态，避免用固定值掩盖已接入活动状态的异常。
 *
 * 请求公式（R > 0；R = 0 或活动缺失时请求 0）：
 *   respiratoryWaterLossRequestMl = 0.3 × I × dtMin
 * 只读取轮初 `physicalActivity`；本轮新入队的活动下一轮才影响请求。活动部位存在但字段缺失、
 * 非有限、剩余时间为负或 intensity 超出 [0, 1] 时抛错，不写状态。本轮不足一分钟的活动不另做
 * 按比例截断，与现有汗液语义一致。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'lungs';
export const actionTypes: string[] = [];

type LungsState = {
  respiratoryWaterLossRequestMl: number;
  respiratoryWaterLossMl: number;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

export const initialState: LungsState = {
  respiratoryWaterLossRequestMl: 0,
  respiratoryWaterLossMl: 0,
};

export const fields = {
  respiratoryWaterLossRequestMl: { unit: 'mL', mode: 'absolute' },
  respiratoryWaterLossMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['bodyFluid.waterVolumeMl'],
  },
};

type IO = {
  read(partId: 'lungs'): Readonly<LungsState> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  readonly dt: number;
  write(next: LungsState): void;
};

const parameters = loadParameters(
  new URL('./respiratory-water-loss.parameters.json', import.meta.url),
);
const exerciseReferenceRateMlPerMin = requireParameter(
  parameters,
  'lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin',
);

type RespiratoryWaterLossRequestInput = {
  remainingExerciseMin: number;
  intensity: number;
  dtMin: number;
};

export function respiratoryWaterLossRequestMl({
  remainingExerciseMin,
  intensity,
  dtMin,
}: RespiratoryWaterLossRequestInput): number {
  if (!(remainingExerciseMin > 0)) return 0;
  return exerciseReferenceRateMlPerMin * intensity * dtMin;
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`physicalActivity.${name} must be a finite number`);
  }
  return value;
}

function readActivity(io: IO): { remainingExerciseMin: number; intensity: number } | undefined {
  const activity = io.read('physicalActivity') as ActivityReading | null | undefined;
  if (activity === undefined || activity === null) return undefined;
  if (typeof activity !== 'object') {
    throw new Error('physicalActivity must be an object');
  }
  const remainingExerciseMin = requireFinite(activity.remainingExerciseMin, 'remainingExerciseMin');
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
  const activity = readActivity(io);
  const requestMl = activity
    ? respiratoryWaterLossRequestMl({
        remainingExerciseMin: activity.remainingExerciseMin,
        intensity: activity.intensity,
        dtMin: io.dt / 60,
      })
    : 0;

  io.write({ respiratoryWaterLossRequestMl: requestMl, respiratoryWaterLossMl: 0 });
}
