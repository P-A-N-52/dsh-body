/*
 * 血氧池（bloodOxygen）：供—需平衡代理，不是可耗空的氧气账本；部位 `bloodOxygen` 的唯一写者。
 * 本脚本每轮按轮初快照合成需氧，并读取轮初通气能力上限：
 *
 *   basalDemand = basalMlMin × max(0.2, 0.6 + 0.4 × thyroxineRelative)
 *               （thyroid 未加载时 basalDemand = basalMlMin）
 *   demand = basalDemand
 *          + activityGainMlMin × intensity（轮初 remainingExerciseMin > 0 时）
 *          + digestionGain × nutrientExposure × basalMlMin
 *   capacity = min(lungsVentilation.alveolarO2CapacityMlMin（通气能力上限）,
 *                  blood.maxOxygenDeliveryMlPerMin（循环最大氧输送能力）)
 *              未加载的选项不参与 min；两者都未加载时按 demand 全额供给
 *   supply = min(demand, capacity)
 *   deficit = demand > 0 ? clamp((demand − supply) / demand, 0, 1) : 0
 *   spo2Percent = baselineSpo2Percent × (1 − deficit)
 *
 * SpO2 由需求与能力上限决定，不由上一轮实际通气量决定：自动调节假定在一轮之内跟上
 * 需求，只有需求超过能力才去饱和。若用上一轮实际供氧算 SpO2，活动首轮会出现假性缺口。
 * `lungsVentilation.alveolarO2MlMin` 只是实际供氧读数，本脚本不读。
 * `blood.maxOxygenDeliveryMlPerMin` 是 `blood` 按最大驱动与轮初 SpO2 算出的循环能力
 * 上限，与当前心输出无关；`blood.oxygenDeliveryMlMin` 是含一轮滞后的实际氧输送读数，
 * 本脚本不读，避免活动首轮用上一轮静息心输出判定去饱和。`blood` 未加载时退回只用通气
 * 能力上限，与接入前行为一致；已加载但能力字段缺失、非有限或为负时抛错使本轮失败。
 *
 * 输出只反映本轮供需，不累计历史氧债，也不做质量守恒账；不调用 transfer。
 * 消费者：`lungsVentilation` 读 `oxygenConsumptionMlMin` 自动调通气（身体调节，不是 LLM 呼吸
 * 动作），`interoception` 读 `oxygenDeficit` 产出气促读数。两者都只读本轮快照，存在一轮滞后。
 * `thyroid.thyroxineRelative` 只缩放基础氧耗项：`1` 是相对基线，不代表 T4 浓度；0.6 + 0.4 × T4
 * （下限 0.2）的系数是 `design`，`thyroid` 未加载时基础项保持 `basalMlMin` 不变。活动附加氧耗与
 * 消化项仍按原公式，不随 T4 缩放。
 * 可选部位未加载时按缺失处理；已加载但字段缺失、非有限或为负时抛错使本轮失败。
 *
 * 证据：无直接人体来源。250 mL/min 静息氧耗量级、intensity=1 时 1000 mL/min 的附加氧耗、
 * 0.1 的餐后产热占基础氧耗比例、0.6 + 0.4 × T4 的缩放曲线与 97% 基线 SpO2 全部是 `design`、
 * `source: null`（同目录 `oxygen.parameters.json`），不是人体测量、血气、血红蛋白或心肺功能
 * 模型。不建 PaO2/PaCO2、氧合曲线、CO2、高原/病理缺氧、通气动作或气促通知；心输出与氧
 * 输送由 `blood` 以 `design` 常数给出，本脚本不据此声明循环生理。不能称 validated。
 */
import {
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'bloodOxygen';
export const actionTypes: string[] = [];

type BloodOxygenState = {
  oxygenConsumptionMlMin: number;
  oxygenSupplyMlMin: number;
  spo2Percent: number;
  oxygenDeficit: number;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type DuodenumReading = {
  nutrientExposure?: unknown;
};

type LungsVentilationReading = {
  alveolarO2CapacityMlMin?: unknown;
};

type ThyroidReading = {
  thyroxineRelative?: unknown;
};

type BloodReading = {
  maxOxygenDeliveryMlPerMin?: unknown;
};

const parameters = loadParameters(new URL('./oxygen.parameters.json', import.meta.url));
const basalMlMin = scaleByBodyWeight(
  requireParameter(parameters, 'bloodOxygen.basalMlMin'),
  'bloodOxygen.basalMlMin',
);
const activityGainMlMin = scaleByBodyWeight(
  requireParameter(parameters, 'bloodOxygen.activityGainMlMin'),
  'bloodOxygen.activityGainMlMin',
);
const digestionGain = requireParameter(parameters, 'bloodOxygen.digestionGain');
const baselineSpo2Percent = requireParameter(parameters, 'bloodOxygen.baselineSpo2Percent');

export const initialState: BloodOxygenState = {
  oxygenConsumptionMlMin: basalMlMin,
  oxygenSupplyMlMin: basalMlMin,
  spo2Percent: baselineSpo2Percent,
  oxygenDeficit: 0,
};

export const fields = {
  oxygenConsumptionMlMin: { unit: 'mL/min', mode: 'absolute' },
  oxygenSupplyMlMin: { unit: 'mL/min', mode: 'absolute' },
  spo2Percent: { unit: '%', mode: 'absolute' },
  oxygenDeficit: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  read(id: 'duodenum'): Readonly<DuodenumReading> | undefined;
  read(id: 'lungsVentilation'): Readonly<LungsVentilationReading> | undefined;
  read(id: 'thyroid'): Readonly<ThyroidReading> | undefined;
  read(id: 'blood'): Readonly<BloodReading> | undefined;
  write(next: BloodOxygenState): void;
};

export function balanceOxygen(
  demandMlMin: number,
  supplyMlMin: number,
): { oxygenDeficit: number; spo2Percent: number } {
  const oxygenDeficit = demandMlMin > 0
    ? Math.min(1, Math.max(0, (demandMlMin - supplyMlMin) / demandMlMin))
    : 0;
  return {
    oxygenDeficit,
    spo2Percent: baselineSpo2Percent * (1 - oxygenDeficit),
  };
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`bloodOxygen: ${name} must be a finite number`);
  }
  return value;
}

function readActivity(
  activity: Readonly<ActivityReading> | undefined,
): { remainingExerciseMin: number; intensity: number } | undefined {
  if (activity === undefined) return undefined;
  if (typeof activity !== 'object' || activity === null) {
    throw new Error('bloodOxygen: physicalActivity must be an object');
  }
  const remainingExerciseMin = requireFinite(
    activity.remainingExerciseMin,
    'physicalActivity.remainingExerciseMin',
  );
  const intensity = requireFinite(activity.intensity, 'physicalActivity.intensity');
  if (remainingExerciseMin < 0) {
    throw new Error('bloodOxygen: physicalActivity.remainingExerciseMin must not be negative');
  }
  if (intensity < 0 || intensity > 1) {
    throw new Error('bloodOxygen: physicalActivity.intensity must be between 0 and 1');
  }
  return { remainingExerciseMin, intensity };
}

function readNutrientExposure(duodenum: Readonly<DuodenumReading> | undefined): number {
  if (duodenum === undefined) return 0;
  if (typeof duodenum !== 'object' || duodenum === null) {
    throw new Error('bloodOxygen: duodenum must be an object');
  }
  const nutrientExposure = duodenum.nutrientExposure;
  if (
    typeof nutrientExposure !== 'number'
    || !Number.isFinite(nutrientExposure)
    || nutrientExposure < 0
  ) {
    throw new Error('bloodOxygen: duodenum.nutrientExposure must be a finite non-negative number');
  }
  return nutrientExposure;
}

function readAlveolarCapacity(
  lungsVentilation: Readonly<LungsVentilationReading> | undefined,
): number | undefined {
  if (lungsVentilation === undefined) return undefined;
  if (typeof lungsVentilation !== 'object' || lungsVentilation === null) {
    throw new Error('bloodOxygen: lungsVentilation must be an object');
  }
  const alveolarO2CapacityMlMin = lungsVentilation.alveolarO2CapacityMlMin;
  if (
    typeof alveolarO2CapacityMlMin !== 'number'
    || !Number.isFinite(alveolarO2CapacityMlMin)
    || alveolarO2CapacityMlMin < 0
  ) {
    throw new Error(
      'bloodOxygen: lungsVentilation.alveolarO2CapacityMlMin must be a finite non-negative number',
    );
  }
  return alveolarO2CapacityMlMin;
}

function readThyroxineRelative(
  thyroid: Readonly<ThyroidReading> | undefined,
): number | undefined {
  if (thyroid === undefined) return undefined;
  if (typeof thyroid !== 'object' || thyroid === null) {
    throw new Error('bloodOxygen: thyroid must be an object');
  }
  const thyroxineRelative = thyroid.thyroxineRelative;
  if (
    typeof thyroxineRelative !== 'number'
    || !Number.isFinite(thyroxineRelative)
    || thyroxineRelative < 0
  ) {
    throw new Error(
      'bloodOxygen: thyroid.thyroxineRelative must be a finite non-negative number',
    );
  }
  return thyroxineRelative;
}

function readMaxOxygenDelivery(
  blood: Readonly<BloodReading> | undefined,
): number | undefined {
  if (blood === undefined) return undefined;
  if (typeof blood !== 'object' || blood === null) {
    throw new Error('bloodOxygen: blood must be an object');
  }
  const maxOxygenDeliveryMlPerMin = blood.maxOxygenDeliveryMlPerMin;
  if (
    typeof maxOxygenDeliveryMlPerMin !== 'number'
    || !Number.isFinite(maxOxygenDeliveryMlPerMin)
    || maxOxygenDeliveryMlPerMin < 0
  ) {
    throw new Error(
      'bloodOxygen: blood.maxOxygenDeliveryMlPerMin must be a finite non-negative number',
    );
  }
  return maxOxygenDeliveryMlPerMin;
}

export function heartbeat(io: IO): void {
  const activity = readActivity(io.read('physicalActivity'));
  const nutrientExposure = readNutrientExposure(io.read('duodenum'));
  const thyroxineRelative = readThyroxineRelative(io.read('thyroid'));
  const sleep = (io as { read(id: 'sleep'): Readonly<{ sleeping?: unknown; sleepStage?: unknown }> | undefined }).read('sleep');
  const sleeping = sleep?.sleeping === true;
  const sleepMetabolicFactor = !sleeping
    ? 1
    : sleep?.sleepStage === 'deep'
      ? 0.85
      : 0.9;

  const basalDemandMlMin = (thyroxineRelative === undefined
    ? basalMlMin
    : basalMlMin * Math.max(0.2, 0.6 + 0.4 * thyroxineRelative)) * sleepMetabolicFactor;
  const activityDemandMlMin = activity !== undefined && activity.remainingExerciseMin > 0
    ? activityGainMlMin * activity.intensity
    : 0;
  const demandMlMin = basalDemandMlMin
    + activityDemandMlMin
    + digestionGain * nutrientExposure * basalMlMin;

  const alveolarCapacityMlMin = readAlveolarCapacity(io.read('lungsVentilation'));
  const maxOxygenDeliveryMlPerMin = readMaxOxygenDelivery(io.read('blood'));
  const capacityMlMin = Math.min(
    alveolarCapacityMlMin ?? demandMlMin,
    maxOxygenDeliveryMlPerMin ?? demandMlMin,
  );
  const supplyMlMin = Math.min(demandMlMin, capacityMlMin);
  const { oxygenDeficit, spo2Percent } = balanceOxygen(demandMlMin, supplyMlMin);

  io.write({
    oxygenConsumptionMlMin: demandMlMin,
    oxygenSupplyMlMin: supplyMlMin,
    spo2Percent,
    oxygenDeficit,
  });
}
