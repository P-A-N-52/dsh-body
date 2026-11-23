/*
 * 部位 `thermoregulation`：核心温度由产热与散热的平衡决定，部位 `thermoregulation` 的唯一
 * 写者。消费者：`skin` 按核心温度放大出汗请求，`lungsVentilation` 按核心温度抬高通气目标，
 * `interoception` 写热/冷不适读数。本脚本只算温度，不直接写出汗、通气或通知，也不调用
 * `transfer`。
 *
 * 公式（dtMin = io.dt / 60，D = 轮初 bloodOxygen.oxygenConsumptionMlMin，
 * W = 轮初 skin.sweatVolumeMl）：
 *   heatProductionKcalMin = metabolicFactor × D
 *                         + shiveringGain × max(0, setpointC − coreTemperatureC)
 *   lossKcalMin = evaporationKcalPerMl × W
 *               + lossGain × (coreTemperatureC − ambientTemperatureC)
 *   coreTemperatureC = prev.coreTemperatureC
 *                    + dtMin × (heatProductionKcalMin − lossKcalMin) / heatCapacityKcalPerC
 * 产热用轮初氧耗（`bloodOxygen` 已含基础代谢、T4 缩放、活动与消化附加氧耗）；寒战只在
 * 低于设定点时加入。散热含轮初实际汗液蒸发与核心—环境温差；温差项在环境更冷时按负损失
 * 处理，即环境向身体传热，没有单独的环境得热公式。
 *
 * 可选回退与异常（design）：
 * - `bloodOxygen` 未加载时按基础氧耗 250 mL/min 回退，与 `lungsVentilation` 的回退常量
 *   一致；`bloodOxygen.basalMlMin` 也以 `design` 参数维护。
 * - `skin` 未加载时按汗液 0 mL 回退；完整清单中 `skin` 仍是实际汗液的写入者。
 * - 部位自身状态缺失或 `coreTemperatureC` 非有限时按设定点重新起步。
 * - 已加载的 `bloodOxygen` / `skin` 字段缺失、非有限或为负时抛错，使本轮整体作废，不写
 *   状态，不用回退值掩盖异常。只读轮初快照，所以活动、出汗与温度之间有一轮滞后。
 *
 * 证据：无直接人体来源。所有参数见同目录 `thermoregulation.parameters.json`，
 * 全部 `status: design`、`source: null`；37°C、25°C、60 kcal/°C、0.02 kcal/mL、2 与 0.05
 * kcal/(min·°C)、0.58 kcal/mL 都是工程假设，不是体温调定点、量热、寒战产热或蒸发散热
 * 的人体测量。不建皮肤分区温度、血管扩张/收缩、寒战肌肉做功细节、发热与疾病、低温症、
 * 绝对核心温度测量、湿度、风速、辐射面积或个体差异；不能称 validated。设计来源：
 * docs/superpowers/specs/2026-11-24-thermoregulation-design.md。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'thermoregulation';
export const actionTypes: string[] = [];

type ThermoregulationState = {
  coreTemperatureC: number;
};

type BloodOxygenReading = {
  oxygenConsumptionMlMin?: unknown;
};

type SkinReading = {
  sweatVolumeMl?: unknown;
};

type IO = {
  read(id: 'thermoregulation'): Readonly<ThermoregulationState> | undefined;
  read(id: 'bloodOxygen'): Readonly<BloodOxygenReading> | null | undefined;
  read(id: 'skin'): Readonly<SkinReading> | null | undefined;
  readonly dt: number;
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
const heatCapacityKcalPerC = requireParameter(
  parameters,
  'thermoregulation.heatCapacityKcalPerC',
);
const metabolicFactor = requireParameter(parameters, 'thermoregulation.metabolicFactor');
const shiveringGain = requireParameter(parameters, 'thermoregulation.shiveringGain');
const lossGain = requireParameter(parameters, 'thermoregulation.lossGain');
const evaporationKcalPerMl = requireParameter(
  parameters,
  'thermoregulation.evaporationKcalPerMl',
);

const fallbackBasalOxygenConsumptionMlMin = 250;

export const initialState: ThermoregulationState = {
  coreTemperatureC: setpointC,
};

export const fields = {
  coreTemperatureC: { unit: '°C', mode: 'absolute' },
};

export function heatProductionKcalMin(
  oxygenConsumptionMlMin: number,
  coreTemperatureC: number,
): number {
  const shiveringKcalMin = shiveringGain * Math.max(0, setpointC - coreTemperatureC);
  return metabolicFactor * oxygenConsumptionMlMin + shiveringKcalMin;
}

export function heatLossKcalMin(
  sweatVolumeMl: number,
  coreTemperatureC: number,
): number {
  return evaporationKcalPerMl * sweatVolumeMl
    + lossGain * (coreTemperatureC - ambientTemperatureC);
}

function readOxygenConsumptionMlMin(io: IO): number {
  const bloodOxygen = io.read('bloodOxygen');
  if (bloodOxygen === undefined || bloodOxygen === null) {
    return fallbackBasalOxygenConsumptionMlMin;
  }
  if (typeof bloodOxygen !== 'object') {
    throw new Error('thermoregulation: bloodOxygen must be an object');
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
  if (skin === undefined || skin === null) return 0;
  if (typeof skin !== 'object') {
    throw new Error('thermoregulation: skin must be an object');
  }
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

  const productionKcalMin = heatProductionKcalMin(
    oxygenConsumptionMlMin,
    previousTemperatureC,
  );
  const lossKcalMin = heatLossKcalMin(sweatVolumeMl, previousTemperatureC);
  const dtMin = io.dt / 60;
  const coreTemperatureC = previousTemperatureC
    + (dtMin * (productionKcalMin - lossKcalMin)) / heatCapacityKcalPerC;

  io.write({ coreTemperatureC });
}
