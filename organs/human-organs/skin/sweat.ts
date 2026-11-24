/*
 * 皮肤出汗脚本（skin）：只计算出汗请求；部位 `skin` 的唯一写者，不持有体液水，也不调用
 * transfer。消费者是 `bodyFluid`：其水账读取上一轮 `skin.sweatRequestMl` 作为向皮肤的转出
 * 上限，Gateway 在 transfer 阶段再把实际汗液加入 `skin.sweatVolumeMl`。本脚本每轮 write 先把
 * `sweatVolumeMl` 归 0，实际汗液只由 transferIn 增加。
 *
 * 设计来源：docs/superpowers/specs/2026-11-23-activity-sweat-design.md §4。无直接人体证据，
 * 也没有实测代谢、体温调节或最大出汗率模型。同目录 `sweat.parameters.json` 的参数全部为
 * `design`、`source: null`：25°C、intensity=1 的 0.6 mL/min 是工程参考，0.04/°C 是工程温度
 * 斜率，15 mL/min 是工程上限，5 mL/(min·°C) 是热致出汗率增益，25°C 是默认环境参数。它们不是 METs、热量、心率、核心/皮肤温度
 * 或人体最大出汗率，不能称 validated。
 *
 * 请求公式（静息高热也可触发出汗）：
 *   temperatureFactor = max(0, 1 + ambientGainPerC × (T − 25))
 *   exerciseRate = R > 0 ? referenceRateMlPerMin × I × temperatureFactor : 0
 *   thermalRate = heatGain × max(0, coreTemperatureC − 37)
 *   rate = min(maxRateMlPerMin, max(0, exerciseRate + thermalRate))
 *   sweatRequestMl = rate × dtMin
 * 只读取轮初 `physicalActivity` 与轮初 `thermoregulation`；本轮新入队的活动下一轮才影响请求。
 * `thermoregulation` 未加载时 `coreTemperatureC = 37`（thermalRate = 0）；已加载但 `coreTemperatureC` 缺失、非有限或
 * 非对象时抛错，不写状态。37°C 与 `thermoregulation.setpointC` 的设计默认值一致，皮肤侧
 * 只用 `heatGain` 一个参数，不复制设定点参数。活动部位存在但字段缺失、非有限、为负，或
 * intensity > 1 时抛错，不写状态。不建皮肤分区、温度、湿润度或蒸发残余。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'skin';
export const actionTypes: string[] = [];

type SkinState = {
  sweatRequestMl: number;
  sweatVolumeMl: number;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type ThermoregulationReading = {
  coreTemperatureC?: unknown;
};

export const initialState: SkinState = {
  sweatRequestMl: 0,
  sweatVolumeMl: 0,
};

export const fields = {
  sweatRequestMl: { unit: 'mL', mode: 'absolute' },
  sweatVolumeMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['bodyFluid.waterVolumeMl'],
  },
};

type IO = {
  read(partId: 'skin'): Readonly<SkinState> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  read(partId: 'thermoregulation'): Readonly<ThermoregulationReading> | null | undefined;
  readonly dt: number;
  write(next: SkinState): void;
};

const parameters = loadParameters(new URL('./sweat.parameters.json', import.meta.url));
const referenceRateMlPerMin = requireParameter(parameters, 'skin.sweat.referenceRateMlPerMin');
const ambientGainPerC = requireParameter(parameters, 'skin.sweat.ambientGainPerC');
const maxRateMlPerMin = requireParameter(parameters, 'skin.sweat.maxRateMlPerMin');
const ambientTemperatureC = requireParameter(parameters, 'skin.sweat.ambientTemperatureC');
const heatGain = requireParameter(parameters, 'skin.heatGain');

const referenceTemperatureC = 25;
const thermoregulationSetpointC = 37;

type SweatRequestInput = {
  remainingExerciseMin: number;
  intensity: number;
  dtMin: number;
  ambientTemperatureC: number;
  coreTemperatureC?: number;
};

export function sweatRequestMl({
  remainingExerciseMin,
  intensity,
  dtMin,
  ambientTemperatureC: temperatureC,
  coreTemperatureC = thermoregulationSetpointC,
}: SweatRequestInput): number {
  const temperatureFactor = Math.max(0, 1 + ambientGainPerC * (temperatureC - referenceTemperatureC));
  const exerciseRateMlPerMin = remainingExerciseMin > 0
    ? referenceRateMlPerMin * intensity * temperatureFactor
    : 0;
  const thermalRateMlPerMin = heatGain * Math.max(0, coreTemperatureC - thermoregulationSetpointC);
  const rateMlPerMin = Math.min(
    maxRateMlPerMin,
    Math.max(0, exerciseRateMlPerMin + thermalRateMlPerMin),
  );
  return dtMin > 0 ? rateMlPerMin * dtMin : 0;
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

function readCoreTemperatureC(io: IO): number {
  const thermoregulation = io.read('thermoregulation');
  if (thermoregulation === undefined || thermoregulation === null) {
    return thermoregulationSetpointC;
  }
  if (typeof thermoregulation !== 'object') {
    throw new Error('skin: thermoregulation must be an object');
  }
  const coreTemperatureC = thermoregulation.coreTemperatureC;
  if (typeof coreTemperatureC !== 'number' || !Number.isFinite(coreTemperatureC)) {
    throw new Error('skin: thermoregulation.coreTemperatureC must be a finite number');
  }
  return coreTemperatureC;
}

export function heartbeat(io: IO): void {
  const activity = readActivity(io);
  const coreTemperatureC = readCoreTemperatureC(io);
  const requestMl = sweatRequestMl({
    remainingExerciseMin: activity?.remainingExerciseMin ?? 0,
    intensity: activity?.intensity ?? 0,
    dtMin: io.dt / 60,
    ambientTemperatureC,
    coreTemperatureC,
  });

  io.write({ sweatRequestMl: requestMl, sweatVolumeMl: 0 });
}
