/*
 * 肺通气部位 `lungsVentilation`：按轮初 `bloodOxygen.oxygenConsumptionMlMin` 自动调节
 * 每分通气量与呼吸频率，并输出肺泡氧供给量。呼吸是身体自动调节，不是 LLM 动作：
 * `actionTypes = []`，不读 `io.actions`，也没有任何通气动作；LLM 只能通过活动、进食等
 * 上游行为间接改变需氧，不能直接控制呼吸。
 *
 * 与同目录 `lungs`（`respiratory-water-loss.ts`）分工：`lungs` 是呼吸失水薄切片的部位，
 * 只处理运动相关失水请求与实际通量；本部位是独立的 `lungsVentilation`，只处理通气与
 * 肺泡供氧。两者不共享状态、不互相 transfer，也不互相写字段；同目录只是解剖归类，
 * 不表示同一个部位。
 *
 * 公式（demand 为轮初需氧，mL/min；coreTemperatureC 为轮初核心温度，未加载按缺失）：
 *   metabolicVentilation = demand × deadSpaceFactor / inspiredO2Fraction
 *   pantingMlMin = pantingGain × max(0, coreTemperatureC − 37)
 *   targetVentilation = max(restingVentilationMlMin, metabolicVentilation) + pantingMlMin
 *   ventilationMlMin = clamp(targetVentilation, restingVentilationMlMin, maxVentilationMlMin)
 *   respiratoryRatePerMin = clamp(ventilationMlMin / restingTidalVolumeMl,
 *                                 restingRatePerMin, maxRatePerMin)
 *   tidalVolumeMl = restingTidalVolumeMl（本切片固定，不做潮气量调节）
 *   alveolarO2MlMin = ventilationMlMin × inspiredO2Fraction / deadSpaceFactor
 *   alveolarO2CapacityMlMin = maxVentilationMlMin × inspiredO2Fraction / deadSpaceFactor
 * `metabolicVentilation` 是满足该需氧所需的通气量；低于静息通气时先回到静息基线，核心温度
 * 高于设定点时再在其上叠加喘息项，最后钳位到静息/上限区间；`thermoregulation` 未加载时喘息项为 0。
 * 37°C 与 `thermoregulation.setpointC` 的设计默认值一致，本部位只维护 `pantingGain` 一个参数。
 * `alveolarO2MlMin` 是本轮实际通气量对应的供氧读数，受轮初需氧与一轮滞后影响；
 * `alveolarO2CapacityMlMin` 是通气能力上限（默认约 2500 mL/min），
 * 由参数直接决定、与需氧无关。`bloodOxygen` 用能力上限判定 SpO2
 * （supply = min(demand, capacity)），避免活动首轮把上一轮通气量误当成供氧不足；
 * `alveolarO2MlMin` 只保留为滞后读数，不参与 SpO2。`respiratoryRatePerMin` 是由
 * 通气量除以固定潮气量得到的读数，再单独钳到 `maxRatePerMin`，所以频率触顶后它不再
 * 等于 `ventilationMlMin / tidalVolumeMl`；这是固定潮气量近似，不是呼吸力学。
 *
 * `bloodOxygen` 未加载时按基础需氧 250 mL/min 计算。250 是血氧池
 * `bloodOxygen.basalMlMin` 的工程默认值，这里作为回退常量，不另立第二个参数；两个默认
 * 值都由 `design` 参数维护，若日后调整需同步。`thermoregulation` 未加载时喘息项为 0。
 * `bloodOxygen` 已加载但字段缺失、非有限或为负时抛错，使本轮失败，不用固定值掩盖；
 * `thermoregulation` 已加载但 `coreTemperatureC` 缺失、非有限或非对象时同样抛错，不写
 * 状态。只读轮初快照，所以需氧、核心温度变化与通气反应之间有一轮滞后，与既有反馈链一致。
 *
 * 参数全部来自同目录 `ventilation.parameters.json`，状态 `design`、`source: null`；
 * 500 mL / 12 次/min / 40 次/min / 6000 mL/min / 60000 mL/min / 0.058333 / 1.4 与喘息增益
 * 1500 mL/(min·°C) 都是工程默认值，不是人体测量、不是实测最大通气量或体温—通气斜率，
 * 也没有独立数据验证，不能称 validated。本切片不建血气分压、氧合曲线、血红蛋白、
 * 心输出量、CO2/酸碱、呼吸力学、潮气量调节、高原或病理缺氧，也不产生气促通知
 * （气促读数由 `interoception` 从血氧池读取）。
 */
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'lungsVentilation';
export const actionTypes: string[] = [];

type LungsVentilationState = {
  tidalVolumeMl: number;
  respiratoryRatePerMin: number;
  ventilationMlMin: number;
  alveolarO2MlMin: number;
  alveolarO2CapacityMlMin: number;
};

type BloodOxygenReading = {
  oxygenConsumptionMlMin?: unknown;
};

type ThermoregulationReading = {
  coreTemperatureC?: unknown;
  setpointC?: unknown;
};

type IO = {
  read(partId: 'bloodOxygen'): Readonly<BloodOxygenReading> | null | undefined;
  read(partId: 'thermoregulation'): Readonly<ThermoregulationReading> | null | undefined;
  write(next: LungsVentilationState): void;
};

const parameters = loadParameters(new URL('./ventilation.parameters.json', import.meta.url));
const restingTidalVolumeMl = scaleByBodyWeight(
  requireParameter(parameters, 'lungsVentilation.restingTidalVolumeMl'),
  'lungsVentilation.restingTidalVolumeMl',
);
const restingRatePerMin = requireParameter(parameters, 'lungsVentilation.restingRatePerMin');
const maxRatePerMin = requireParameter(parameters, 'lungsVentilation.maxRatePerMin');
const restingVentilationMlMin = scaleByBodyWeight(
  requireParameter(parameters, 'lungsVentilation.restingVentilationMlMin'),
  'lungsVentilation.restingVentilationMlMin',
);
const maxVentilationMlMin = scaleByBodyWeight(
  requireParameter(parameters, 'lungsVentilation.maxVentilationMlMin'),
  'lungsVentilation.maxVentilationMlMin',
);
const inspiredO2Fraction = requireParameter(parameters, 'lungsVentilation.inspiredO2Fraction');
const deadSpaceFactor = requireParameter(parameters, 'lungsVentilation.deadSpaceFactor');
const pantingGain = scaleByBodyWeight(
  requireParameter(parameters, 'lungsVentilation.pantingGain'),
  'lungsVentilation.pantingGain',
);
const deepSleepFloorFactor = requireParameter(parameters, 'lungsVentilation.deepSleepFloorFactor');
const lightSleepFloorFactor = requireParameter(parameters, 'lungsVentilation.lightSleepFloorFactor');
const sleepSympatheticBypassThresholdMm = requireParameter(
  parameters,
  'lungsVentilation.sleepSympatheticBypassThresholdMm',
);
const sympatheticVentilationGainMlPerMinPerMm = scaleByBodyWeight(
  requireParameter(parameters, 'lungsVentilation.sympatheticVentilationGainMlPerMinPerMm'),
  'lungsVentilation.sympatheticVentilationGainMlPerMinPerMm',
);

const fallbackBasalDemandMlMin =
  getNumericParameterOverride('bloodOxygen.basalMlMin') ?? scaleByBodyWeight(250);
const thermoregulationSetpointC = 37;
const alveolarO2CapacityMlMin = maxVentilationMlMin * (inspiredO2Fraction / deadSpaceFactor);

export const initialState: LungsVentilationState = {
  tidalVolumeMl: restingTidalVolumeMl,
  respiratoryRatePerMin: restingRatePerMin,
  ventilationMlMin: restingVentilationMlMin,
  alveolarO2MlMin: restingVentilationMlMin * (inspiredO2Fraction / deadSpaceFactor),
  alveolarO2CapacityMlMin,
};

export const fields = {
  tidalVolumeMl: { unit: 'mL', mode: 'absolute' },
  respiratoryRatePerMin: { unit: '1/min', mode: 'absolute' },
  ventilationMlMin: { unit: 'mL/min', mode: 'absolute' },
  alveolarO2MlMin: { unit: 'mL/min', mode: 'absolute' },
  alveolarO2CapacityMlMin: { unit: 'mL/min', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readDemandMlMin(io: IO): number {
  const bloodOxygen = io.read('bloodOxygen');
  if (bloodOxygen === undefined) return fallbackBasalDemandMlMin;
  const demand = bloodOxygen.oxygenConsumptionMlMin;
  if (typeof demand !== 'number' || !Number.isFinite(demand)) {
    throw new Error('bloodOxygen.oxygenConsumptionMlMin must be a finite number');
  }
  if (demand < 0) {
    throw new Error('bloodOxygen.oxygenConsumptionMlMin must not be negative');
  }
  return demand;
}

function readThermoregulation(io: IO): { coreTemperatureC: number; setpointC: number } | undefined {
  const thermoregulation = io.read('thermoregulation');
  if (thermoregulation === undefined) return undefined;
  const coreTemperatureC = thermoregulation.coreTemperatureC;
  if (typeof coreTemperatureC !== 'number' || !Number.isFinite(coreTemperatureC)) {
    throw new Error(
      'lungsVentilation: thermoregulation.coreTemperatureC must be a finite number',
    );
  }
  const setpointC = typeof thermoregulation.setpointC === 'number'
    && Number.isFinite(thermoregulation.setpointC)
    ? thermoregulation.setpointC
    : thermoregulationSetpointC;
  return { coreTemperatureC, setpointC };
}

export function heartbeat(io: IO): void {
  const demandMlMin = readDemandMlMin(io);
  const thermoregulation = readThermoregulation(io);
  const readAny = (partId: string) => (io as { read(id: string): Readonly<Record<string, unknown>> | undefined }).read(partId);
  const sleep = readAny('sleep');
  const sleeping = sleep?.sleeping === true;
  const sleepStage = sleep?.sleepStage;
  const activity = readAny('physicalActivity');
  const exercising = typeof activity?.remainingExerciseMin === 'number'
    && activity.remainingExerciseMin > 0
    && typeof activity?.intensity === 'number'
    && activity.intensity > 0;
  const rawSympathetic = readAny('autonomic')?.sympatheticMm;
  const sympatheticMm = typeof rawSympathetic === 'number' && Number.isFinite(rawSympathetic)
    ? clamp(rawSympathetic, 0, 100)
    : 0;
  const sleepFloorFactor = sleeping && sympatheticMm < sleepSympatheticBypassThresholdMm
    ? (sleepStage === 'deep' ? deepSleepFloorFactor : lightSleepFloorFactor)
    : 1;
  const minVentilationMlMin = restingVentilationMlMin * sleepFloorFactor;
  const minRatePerMin = restingRatePerMin * sleepFloorFactor;

  const thermalThresholdC = thermoregulation === undefined
    ? thermoregulationSetpointC
    : Math.max(thermoregulationSetpointC, thermoregulation.setpointC);
  const pantingMlMin = thermoregulation === undefined
    ? 0
    : pantingGain * Math.max(0, thermoregulation.coreTemperatureC - thermalThresholdC);
  const sympatheticVentilationMlMin = exercising
    ? 0
    : sympatheticVentilationGainMlPerMinPerMm * sympatheticMm;
  const metabolicVentilationMlMin = (demandMlMin * deadSpaceFactor) / inspiredO2Fraction;
  const targetVentilationMlMin = Math.max(minVentilationMlMin, metabolicVentilationMlMin)
    + pantingMlMin
    + sympatheticVentilationMlMin;
  const ventilationMlMin = clamp(
    targetVentilationMlMin,
    minVentilationMlMin,
    maxVentilationMlMin,
  );
  const respiratoryRatePerMin = clamp(
    ventilationMlMin / restingTidalVolumeMl,
    minRatePerMin,
    maxRatePerMin,
  );
  const alveolarO2MlMin = ventilationMlMin * (inspiredO2Fraction / deadSpaceFactor);

  io.write({
    tidalVolumeMl: restingTidalVolumeMl,
    respiratoryRatePerMin,
    ventilationMlMin,
    alveolarO2MlMin,
    alveolarO2CapacityMlMin,
  });
}
