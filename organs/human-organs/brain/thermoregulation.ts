/*
 * 核心温度的唯一写者。轮初的氧耗和低于有效设定点的寒战供热，带符号的干交换和实际蒸发分账。
 * 只读取上轮已支付的皮肤汗液，本轮不扣水；空气温湿度/衣层改变交换速率，不直接改温度。
 * SRC-CRAMER-2019 / cramer-2019（skin/references/notes，§§2–3）支持热量分账和压差上限；
 * SRC-ALBERWALLERSTROM-1985 / alber-wallerstrom-1985（同目录，§§2–3、原文摘要）支持湿热下
 * 汗液实际分泌量不等于蒸发量。这不是量热法复刻：参考面温度、传导系数与衣层倍率均为 design。
 *
 * `thermoregulation.setpointC` 配置静态正常基线，可经清单预设与个体参数覆盖；正常核心带与
 * 空气舒适带不进入热账。轮末写出的 `setpointC` 是含昼夜/睡眠调整的动态目标，不含发热；
 * `feverSetpointOffsetC` 是当轮从 `feverDrive` 一次采用的有效偏移，`effectiveSetpointC`
 * 为动态目标加该偏移；发热不写回参数配置。参数证据见同目录
 * `thermoregulation.parameters.json`；昼夜振幅与睡眠下调为工程假设，不建皮肤分区温度、
 * 寒战肌肉做功、临床发热或低温症；不能称 validated。
 */
import { resolveCircadianHour } from '../../../lib/circadian.js';
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';
import { defaultClimate } from '../../body-inputs/climate-state.js';
import { clothingMultipliers } from '../../body-inputs/clothing.ts';
import { nonnegativeFeverOffsetC, type PublishedThermalInput } from './thermoregulation-fever.ts';

export const id = 'thermoregulation';
export const actionTypes: string[] = [];

type HeatBalance = {
  dtMin: number;
  coreTemperatureStartC: number;
  effectiveSetpointC: number;
  heatCapacityKcalPerC: number;
  airTemperatureC: number;
  relativeHumidityPct: number;
  dryExchangeMultiplier: number;
  evaporationMultiplier: number;
  baseConductanceKcalMinPerC: number;
  vasodilationConductanceKcalMinPerC: number;
  vaporPressureDeficitKpa: number;
  paidSweatMl: number;
  evaporationLimitMl: number;
  evaporatedSweatMl: number;
  metabolicHeatKcal: number;
  shiveringHeatKcal: number;
  dryHeatLossKcal: number;
  evaporativeHeatLossKcal: number;
  netHeatKcal: number;
  clamped: boolean;
};

type ThermoregulationState = {
  coreTemperatureC: number;
  setpointC: number;
  feverSetpointOffsetC: number;
  effectiveSetpointC: number;
  heatBalance: HeatBalance | null;
};

type IO = PublishedThermalInput & {
  read(id: 'thermoregulation'): Readonly<ThermoregulationState> | undefined;
  read(id: 'bloodOxygen'): Readonly<{ oxygenConsumptionMlMin?: unknown }> | undefined;
  read(id: 'skin'): Readonly<{ sweatVolumeMl?: unknown }> | undefined;
  read(id: 'sleep'): Readonly<{ sleeping?: unknown }> | undefined;
  read(id: 'climate'): Readonly<Partial<typeof defaultClimate>> | undefined;
  read(id: 'clothing'): Readonly<{ wornLayerIds?: readonly string[] }> | undefined;
  readonly dt: number;
  readonly wallTimeMs?: number;
  write(next: ThermoregulationState): void;
};

const parameters = loadParameters(new URL('./thermoregulation.parameters.json', import.meta.url));
const setpointC = requireParameter(parameters, 'thermoregulation.setpointC');
const heatCapacityKcalPerC = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.heatCapacityKcalPerC'),
  'thermoregulation.heatCapacityKcalPerC',
);
const metabolicFactor = requireParameter(parameters, 'thermoregulation.metabolicFactor');
const shiveringGain = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.shiveringGain'),
  'thermoregulation.shiveringGain',
);
const baseConductanceKcalMinPerC = Math.max(0, scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.lossGain'),
  'thermoregulation.lossGain',
));
const evaporationKcalPerMl = requireParameter(parameters, 'thermoregulation.evaporationKcalPerMl');
const evaporationReferenceTemperatureC = requireParameter(parameters, 'thermoregulation.evaporationReferenceTemperatureC');
const evaporationConductanceMlMinPerKpa = Math.max(0, scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.evaporationConductanceMlMinPerKpa'),
  'thermoregulation.evaporationConductanceMlMinPerKpa',
));
const circadianAmplitudeC = requireParameter(parameters, 'thermoregulation.circadianAmplitudeC');
const circadianPeakHour = requireParameter(parameters, 'thermoregulation.circadianPeakHour');
const sleepSetpointOffsetC = requireParameter(parameters, 'thermoregulation.sleepSetpointOffsetC');
const vasodilationGain = scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.vasodilationGain'),
  'thermoregulation.vasodilationGain',
);
const maxVasodilationKcalMin = Math.max(0, scaleByBodyWeight(
  requireParameter(parameters, 'thermoregulation.maxVasodilationKcalMin'),
  'thermoregulation.maxVasodilationKcalMin',
));

const fallbackBasalOxygenConsumptionMlMin =
  getNumericParameterOverride('bloodOxygen.basalMlMin') ?? scaleByBodyWeight(250);
const vasodilationReferenceGradientC = 12;
const minCoreTemperatureC = 25;
const maxCoreTemperatureC = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const initialState: ThermoregulationState = {
  coreTemperatureC: setpointC,
  setpointC,
  feverSetpointOffsetC: 0,
  effectiveSetpointC: setpointC,
  heatBalance: null,
};

export const fields = {
  coreTemperatureC: { unit: '°C', mode: 'absolute' },
  setpointC: { unit: '°C', mode: 'absolute' },
  feverSetpointOffsetC: { unit: '°C', mode: 'absolute' },
  effectiveSetpointC: { unit: '°C', mode: 'absolute' },
  heatBalance: { unit: 'record', mode: 'absolute' },
};

function baselineSetpointC(wallTimeMs: number | undefined, sleeping: boolean): number {
  const circadianDelta = typeof wallTimeMs === 'number' && Number.isFinite(wallTimeMs)
    ? circadianAmplitudeC
      * Math.cos((2 * Math.PI * (resolveCircadianHour(wallTimeMs) - circadianPeakHour)) / 24)
    : 0;
  return setpointC + circadianDelta - (sleeping ? sleepSetpointOffsetC : 0);
}

function shiveringKcalMin(coreTemperatureC: number, targetSetpointC: number): number {
  return shiveringGain * Math.max(0, targetSetpointC - coreTemperatureC);
}

// Magnus approximation for ordinary air temperatures. Below the extrapolated singularity use zero.
function saturationPressureKpa(temperatureC: number): number {
  if (temperatureC <= -243.04) return 0;
  return 0.61094 * Math.exp(17.625 * (temperatureC / (243.04 + temperatureC)));
}

function requireNonnegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`thermoregulation: ${field} must be a finite non-negative number`);
  }
  return value;
}

export function heartbeat(io: IO): void {
  const bloodOxygen = io.read('bloodOxygen');
  const oxygenConsumptionMlMin = bloodOxygen === undefined
    ? fallbackBasalOxygenConsumptionMlMin
    : requireNonnegative(bloodOxygen?.oxygenConsumptionMlMin, 'bloodOxygen.oxygenConsumptionMlMin');
  const skin = io.read('skin');
  const paidSweatMl = skin === undefined ? 0 : requireNonnegative(skin?.sweatVolumeMl, 'skin.sweatVolumeMl');
  const previousTemperatureC = io.read(id)?.coreTemperatureC;
  const coreTemperatureStartC = typeof previousTemperatureC === 'number' && Number.isFinite(previousTemperatureC)
    ? previousTemperatureC : setpointC;
  const baseline = baselineSetpointC(io.wallTimeMs, io.read('sleep')?.sleeping === true);
  const feverSetpointOffsetC = nonnegativeFeverOffsetC(io.readPublished?.('feverDrive')?.setpointOffsetC);
  const effectiveSetpointC = baseline + feverSetpointOffsetC;

  const climate = io.read('climate');
  const airTemperatureC = climate?.airTemperatureC ?? defaultClimate.airTemperatureC;
  const relativeHumidityPct = climate?.relativeHumidityPct ?? defaultClimate.relativeHumidityPct;
  const { dryExchangeMultiplier, evaporationMultiplier } = clothingMultipliers(io.read('clothing')?.wornLayerIds);
  const dtMin = Math.max(0, io.dt / 60);
  const vaporPressureDeficitKpa = Math.max(0,
    saturationPressureKpa(evaporationReferenceTemperatureC)
      - relativeHumidityPct / 100 * saturationPressureKpa(airTemperatureC),
  );
  const evaporationLimitMl = vaporPressureDeficitKpa * evaporationConductanceMlMinPerKpa * evaporationMultiplier * dtMin;
  const evaporatedSweatMl = Math.min(paidSweatMl, evaporationLimitMl);
  const evaporativeHeatLossKcal = evaporatedSweatMl * evaporationKcalPerMl;
  const vasodilationConductanceKcalMinPerC = clamp(
    vasodilationGain * Math.max(0, coreTemperatureStartC - effectiveSetpointC), 0, maxVasodilationKcalMin,
  ) / vasodilationReferenceGradientC;
  const dryHeatLossKcal = dryExchangeMultiplier * (baseConductanceKcalMinPerC + vasodilationConductanceKcalMinPerC)
    * (coreTemperatureStartC - airTemperatureC) * dtMin;
  const shiveringHeatKcal = shiveringKcalMin(coreTemperatureStartC, effectiveSetpointC) * dtMin;
  const metabolicHeatKcal = metabolicFactor * oxygenConsumptionMlMin * dtMin;
  const netHeatKcal = metabolicHeatKcal + shiveringHeatKcal - dryHeatLossKcal - evaporativeHeatLossKcal;
  const unboundedCoreC = coreTemperatureStartC + netHeatKcal / heatCapacityKcalPerC;
  const coreTemperatureC = clamp(unboundedCoreC, minCoreTemperatureC, maxCoreTemperatureC);

  io.write({
    coreTemperatureC,
    setpointC: baseline,
    feverSetpointOffsetC,
    effectiveSetpointC,
    heatBalance: {
      dtMin,
      coreTemperatureStartC,
      effectiveSetpointC,
      heatCapacityKcalPerC,
      airTemperatureC,
      relativeHumidityPct,
      dryExchangeMultiplier,
      evaporationMultiplier,
      baseConductanceKcalMinPerC,
      vasodilationConductanceKcalMinPerC,
      vaporPressureDeficitKpa,
      paidSweatMl,
      evaporationLimitMl,
      evaporatedSweatMl,
      metabolicHeatKcal,
      shiveringHeatKcal,
      dryHeatLossKcal,
      evaporativeHeatLossKcal,
      netHeatKcal,
      clamped: coreTemperatureC !== unboundedCoreC,
    },
  });
}
