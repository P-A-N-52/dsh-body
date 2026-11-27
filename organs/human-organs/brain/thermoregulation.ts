/*
 * 部位 `thermoregulation`：核心温度由产热与散热的平衡决定，部位 `thermoregulation` 的唯一
 * 写者。消费者：`skin` 按核心温度放大出汗请求，`lungsVentilation` 按核心温度抬高通气目标，
 * `interoception` 写热/冷不适读数。本脚本只算温度，不直接写出汗、通气或通知，也不调用
 * `transfer`。
 *
 * 公式（dtMin = io.dt / 60，D = 轮初 bloodOxygen.oxygenConsumptionMlMin，
 * W = 轮初 skin.sweatVolumeMl）：
 *   effectiveSetpointC = setpointC
 *     + (wallTimeMs 存在 ? circadianAmplitudeC × cos(2π × (hour − circadianPeakHour) / 24) : 0)
 *     - (sleep.sleeping === true ? sleepSetpointOffsetC : 0)
 *   heatProductionKcalMin = metabolicFactor × D
 *                         + shiveringGain × max(0, effectiveSetpointC − coreTemperatureC)
 *   lossKcalMin = evaporationKcalPerMl × (dtMin > 0 ? W / dtMin : 0)
 *               + lossGain × (coreTemperatureC − ambientTemperatureC)
 *   coreTemperatureC = clamp(
 *     prev.coreTemperatureC + dtMin × (heatProductionKcalMin − lossKcalMin) / heatCapacityKcalPerC,
 *     25, 45
 *   )
 * 产热用轮初氧耗（`bloodOxygen` 已含基础代谢、睡眠下调、T4 缩放、活动与消化附加氧耗）；寒战只在
 * 低于动态设定点时加入。
 *
 * 证据：无直接人体来源。所有参数见同目录 `thermoregulation.parameters.json`，
 * 全部 `status: design`、`source: null`；昼夜调定点振幅（±0.25°C）与睡眠下调（0.2°C）均为
 * 工程假设。不建皮肤分区温度、血管扩张/收缩、寒战肌肉做功细节、发热与疾病、低温症、
 * 湿度、风速或个体差异；不能称 validated。
 */
import { resolveCircadianHour } from '../../../lib/circadian.js';
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'thermoregulation';
export const actionTypes: string[] = [];

type ThermoregulationState = {
  coreTemperatureC: number;
  setpointC: number;
};

type BloodOxygenReading = {
  oxygenConsumptionMlMin?: unknown;
};

type SkinReading = {
  sweatVolumeMl?: unknown;
};

type SleepReading = {
  sleeping?: unknown;
};

type IO = {
  read(id: 'thermoregulation'): Readonly<ThermoregulationState> | undefined;
  read(id: 'bloodOxygen'): Readonly<BloodOxygenReading> | null | undefined;
  read(id: 'skin'): Readonly<SkinReading> | null | undefined;
  read(id: 'sleep'): Readonly<SleepReading> | null | undefined;
  readonly dt: number;
  readonly wallTimeMs?: number;
  write(next: ThermoregulationState): void;
};

const parameters = loadParameters(
  new URL('./thermoregulation.parameters.json', import.meta.url),
);
const setpointC = requireParameter(parameters, 'thermoregulation.setpointC');
const ambientTemperatureC = requireParameter(
  parameters,
  'thermoregulation.ambientTemperatureC',
);
const heatCapacityKcalPerC = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.heatCapacityKcalPerC'),
  'thermoregulation.heatCapacityKcalPerC',
);
const metabolicFactor = requireParameter(parameters, 'thermoregulation.metabolicFactor');
const shiveringGain = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.shiveringGain'),
  'thermoregulation.shiveringGain',
);
const lossGain = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.lossGain'),
  'thermoregulation.lossGain',
);
const evaporationKcalPerMl = requireParameter(
  parameters,
  'thermoregulation.evaporationKcalPerMl',
);
const circadianAmplitudeC = requireParameter(
  parameters,
  'thermoregulation.circadianAmplitudeC',
);
const circadianPeakHour = requireParameter(
  parameters,
  'thermoregulation.circadianPeakHour',
);
const sleepSetpointOffsetC = requireParameter(
  parameters,
  'thermoregulation.sleepSetpointOffsetC',
);
const vasodilationGain = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.vasodilationGain'),
  'thermoregulation.vasodilationGain',
);
const maxVasodilationKcalMin = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.maxVasodilationKcalMin'),
  'thermoregulation.maxVasodilationKcalMin',
);

const fallbackBasalOxygenConsumptionMlMin =
  getNumericParameterOverride('bloodOxygen.basalMlMin') ?? scaleByBodyWeight(250);
const minCoreTemperatureC = 25;
const maxCoreTemperatureC = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const initialState: ThermoregulationState = {
  coreTemperatureC: setpointC,
  setpointC,
};

export const fields = {
  coreTemperatureC: { unit: '°C', mode: 'absolute' },
  setpointC: { unit: '°C', mode: 'absolute' },
};

export function effectiveSetpointC(
  wallTimeMs?: number,
  sleeping = false,
): number {
  const circadianDelta = typeof wallTimeMs === 'number' && Number.isFinite(wallTimeMs)
    ? circadianAmplitudeC
      * Math.cos((2 * Math.PI * (resolveCircadianHour(wallTimeMs) - circadianPeakHour)) / 24)
    : 0;
  const sleepDelta = sleeping ? sleepSetpointOffsetC : 0;
  return setpointC + circadianDelta - sleepDelta;
}

export function heatProductionKcalMin(
  oxygenConsumptionMlMin: number,
  coreTemperatureC: number,
  targetSetpointC = setpointC,
): number {
  const shiveringKcalMin = shiveringGain * Math.max(0, targetSetpointC - coreTemperatureC);
  return metabolicFactor * oxygenConsumptionMlMin + shiveringKcalMin;
}

export function heatLossKcalMin(
  sweatVolumeMl: number,
  coreTemperatureC: number,
  dtMin = 1,
  targetSetpointC = coreTemperatureC,
): number {
  const sweatRateMlMin = dtMin > 0 ? sweatVolumeMl / dtMin : 0;
  const vasodilationKcalMin = clamp(
    vasodilationGain * Math.max(0, coreTemperatureC - targetSetpointC),
    0,
    maxVasodilationKcalMin,
  );
  return evaporationKcalPerMl * sweatRateMlMin
    + lossGain * (coreTemperatureC - ambientTemperatureC)
    + vasodilationKcalMin;
}

function readOxygenConsumptionMlMin(io: IO): number {
  const bloodOxygen = io.read('bloodOxygen');
  if (bloodOxygen === undefined) {
    return fallbackBasalOxygenConsumptionMlMin;
  }
  const oxygenConsumptionMlMin = bloodOxygen.oxygenConsumptionMlMin;
  if (
    typeof oxygenConsumptionMlMin !== 'number'
    || !Number.isFinite(oxygenConsumptionMlMin)
    || oxygenConsumptionMlMin < 0
  ) {
    throw new Error(
      'thermoregulation: bloodOxygen.oxygenConsumptionMlMin must be a finite non-negative number',
    );
  }
  return oxygenConsumptionMlMin;
}

function readSweatVolumeMl(io: IO): number {
  const skin = io.read('skin');
  if (skin === undefined) return 0;
  const sweatVolumeMl = skin.sweatVolumeMl;
  if (
    typeof sweatVolumeMl !== 'number'
    || !Number.isFinite(sweatVolumeMl)
    || sweatVolumeMl < 0
  ) {
    throw new Error(
      'thermoregulation: skin.sweatVolumeMl must be a finite non-negative number',
    );
  }
  return sweatVolumeMl;
}

function readPreviousTemperatureC(io: IO): number {
  const prev = io.read(id) ?? initialState;
  return typeof prev.coreTemperatureC === 'number' && Number.isFinite(prev.coreTemperatureC)
    ? prev.coreTemperatureC
    : setpointC;
}

export function heartbeat(io: IO): void {
  const oxygenConsumptionMlMin = readOxygenConsumptionMlMin(io);
  const sweatVolumeMl = readSweatVolumeMl(io);
  const previousTemperatureC = readPreviousTemperatureC(io);
  const sleeping = io.read('sleep')?.sleeping === true;
  const targetSetpointC = effectiveSetpointC(io.wallTimeMs, sleeping);

  const dtMin = io.dt / 60;
  const productionKcalMin = heatProductionKcalMin(
    oxygenConsumptionMlMin,
    previousTemperatureC,
    targetSetpointC,
  );
  const lossKcalMin = heatLossKcalMin(
    sweatVolumeMl,
    previousTemperatureC,
    dtMin,
    targetSetpointC,
  );
  const coreTemperatureC = clamp(
    previousTemperatureC + (dtMin * (productionKcalMin - lossKcalMin)) / heatCapacityKcalPerC,
    minCoreTemperatureC,
    maxCoreTemperatureC,
  );

  io.write({ coreTemperatureC, setpointC: targetSetpointC });
}
