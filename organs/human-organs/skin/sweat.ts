/*
 * 皮肤出汗脚本（skin）：只计算出汗请求；部位 `skin` 的唯一写者，不持有体液水，也不调用
 * transfer。消费者是 `bodyFluid`：其水账读取上一轮 `skin.sweatRequestMl` 作为向皮肤的转出
 * 上限，Gateway 在 transfer 阶段再把实际汗液加入 `skin.sweatVolumeMl`。本脚本每轮 write 先把
 * `sweatVolumeMl` 归 0，实际汗液只由 transferIn 增加。
 *
 * `climate.airTemperatureC` 改变轮初活动请求的温度因子（缺省 25°C）。热致请求先依据活动与
 * 原昼夜/睡眠设定点选阈值，再加本次运行已采用的发热增量。湿度与衣层限制的是体温脚本的
 * 蒸发量，不改本脚本的请求曲线。不建皮温、湿润度或蒸发残余。参数见 `sweat.parameters.json`
 * （design）；`SRC-WENGER-1976`（脑体温证据笔记）只作阈间带机制参考。
 */
import { loadParameters, requireParameter, scaleByBodyWeight } from '../../../lib/parameters.js';
import { defaultClimate } from '../../body-inputs/climate-state.js';
import { appliedFeverOffsetC, type PublishedThermalInput } from '../brain/thermoregulation-fever.ts';

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
  setpointC?: unknown;
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

type IO = PublishedThermalInput & {
  read(partId: 'skin'): Readonly<SkinState> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  read(partId: 'thermoregulation'): Readonly<ThermoregulationReading> | null | undefined;
  read(partId: 'climate'): Readonly<Partial<typeof defaultClimate>> | undefined;
  readonly dt: number;
  write(next: SkinState): void;
};

const parameters = loadParameters(new URL('./sweat.parameters.json', import.meta.url));
const referenceRateMlPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'skin.sweat.referenceRateMlPerMin'),
  'skin.sweat.referenceRateMlPerMin',
);
const ambientGainPerC = requireParameter(parameters, 'skin.sweat.ambientGainPerC');
const maxRateMlPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'skin.sweat.maxRateMlPerMin'),
  'skin.sweat.maxRateMlPerMin',
);
const heatGain = scaleByBodyWeight(
  requireParameter(parameters, 'skin.heatGain'),
  'skin.heatGain',
);
const interthresholdOffsetC = requireParameter(parameters, 'skin.interthresholdOffsetC');
const nocturnalDeadbandOffsetC = requireParameter(parameters, 'skin.nocturnalDeadbandOffsetC');

const referenceTemperatureC = 25;
const thermoregulationSetpointC = 37;

type SweatRequestInput = {
  remainingExerciseMin: number;
  intensity: number;
  dtMin: number;
  ambientTemperatureC: number;
  coreTemperatureC?: number;
  setpointC?: number;
  feverSetpointOffsetC?: number;
};

export function sweatRequestMl({
  remainingExerciseMin,
  intensity,
  dtMin,
  ambientTemperatureC: temperatureC,
  coreTemperatureC = thermoregulationSetpointC,
  setpointC = thermoregulationSetpointC,
  feverSetpointOffsetC = 0,
}: SweatRequestInput): number {
  const temperatureFactor = Math.max(0, 1 + ambientGainPerC * (temperatureC - referenceTemperatureC));
  const exercising = remainingExerciseMin > 0 && intensity > 0;
  const exerciseRateMlPerMin = exercising
    ? referenceRateMlPerMin * intensity * temperatureFactor
    : 0;
  // 非运动静息（含刚停运动压力反射卸载期）保留阈间带死区，避免轻度微热或夜间昼夜谷值时误出汗
  const deadbandC = exercising
    ? 0
    : (setpointC < thermoregulationSetpointC ? nocturnalDeadbandOffsetC : interthresholdOffsetC);
  const thermalThresholdC = (exercising
    ? Math.max(thermoregulationSetpointC, setpointC)
    : setpointC + deadbandC) + feverSetpointOffsetC;
  const thermalRateMlPerMin = heatGain * Math.max(0, coreTemperatureC - thermalThresholdC);
  const rateMlPerMin = Math.min(maxRateMlPerMin, exerciseRateMlPerMin + thermalRateMlPerMin);
  return dtMin > 0 ? rateMlPerMin * dtMin : 0;
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`physicalActivity.${name} must be a finite number`);
  }
  return value;
}

function readActivity(io: IO): { remainingExerciseMin: number; intensity: number } | undefined {
  const activity = io.read('physicalActivity');
  if (activity === undefined) return undefined;
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

function readThermoregulation(io: IO): { coreTemperatureC: number; setpointC: number } {
  const thermoregulation = io.read('thermoregulation');
  if (thermoregulation === undefined) {
    return {
      coreTemperatureC: thermoregulationSetpointC,
      setpointC: thermoregulationSetpointC,
    };
  }
  const coreTemperatureC = thermoregulation.coreTemperatureC;
  if (typeof coreTemperatureC !== 'number' || !Number.isFinite(coreTemperatureC)) {
    throw new Error('skin: thermoregulation.coreTemperatureC must be a finite number');
  }
  const setpointC = typeof thermoregulation.setpointC === 'number'
    && Number.isFinite(thermoregulation.setpointC)
    ? thermoregulation.setpointC
    : thermoregulationSetpointC;
  return { coreTemperatureC, setpointC };
}

export function heartbeat(io: IO): void {
  const activity = readActivity(io);
  const { coreTemperatureC, setpointC } = readThermoregulation(io);
  const requestMl = sweatRequestMl({
    remainingExerciseMin: activity?.remainingExerciseMin ?? 0,
    intensity: activity?.intensity ?? 0,
    dtMin: io.dt / 60,
    ambientTemperatureC: io.read('climate')?.airTemperatureC ?? defaultClimate.airTemperatureC,
    coreTemperatureC,
    setpointC,
    feverSetpointOffsetC: appliedFeverOffsetC(io),
  });

  io.write({ sweatRequestMl: requestMl, sweatVolumeMl: 0 });
}
