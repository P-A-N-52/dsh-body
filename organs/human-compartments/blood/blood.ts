/*
 * 血液隔室薄切片（blood）：血容量、心输出读数、血压代理、氧输送读数、循环最大氧输送
 * 能力与肾滤过代理；部位 `blood` 的唯一写者。消费者：`body_state` / `GET /state` 读出
 * 七个字段；`kidney` 读 `gfrMlMin`、`hypothalamusAdh` 读 `bloodVolumeMl`、
 * `bloodOxygen` 把 `maxOxygenDeliveryMlPerMin` 当作组织供氧的能力上限。本脚本不调用
 * transfer，不写其他部位，也没有动作或通知。
 *
 * 公式（design）：
 *   dtMin 不使用；全部按轮初快照计算
 *   referenceCardiacOutputMlMin = 4900（脚本内 design 常量，与 heart 静息 70×70 一致）
 *   cardiacOutputMlMin = heart.cardiacOutputMlMin（heart 未加载时回退 4900）
 *   bloodVolumeMl = bodyFluid 存在时按 clamp(referenceBloodVolumeMl × bodyFluid.waterVolumeMl / 30000, 2500, 6000)
 *                   耦合；未加载时原样带出轮初自身状态（缺字段回退 referenceBloodVolumeMl）
 *   arterialContent = bloodOxygen.spo2Percent × oxygenContentPerPercentMlPerL
 *   oxygenDeliveryMlMin = cardiacOutputMlMin × arterialContent / 1000（读数）
 *   maxCardiacOutput = heart?.maxCardiacOutputMlMin ?? blood.referenceMaxCardiacOutputMlMin（未加载 heart 时回退）
 *   maxOxygenDeliveryMlPerMin = maxCardiacOutput × arterialContent / 1000
 *   systolicMmHg = clamp(baselineSystolicMmHg
 *                        × (cardiacOutputMlMin / referenceCardiacOutputMlMin) ^ 0.5
 *                        + sympatheticSystolicGain × sympatheticMm, 80, 200)
 *   diastolicMmHg = clamp(baselineDiastolicMmHg
 *                         × (cardiacOutputMlMin / referenceCardiacOutputMlMin) ^ 0.3
 *                         + sympatheticDiastolicGain × sympatheticMm, 40, 120)
 *   gfrMlMin = baselineGfrMlMin
 *              × clamp(bloodVolumeMl / referenceBloodVolumeMl, 0.5, 1.2)
 *
 * `oxygenDeliveryMlMin` 是轮初心输出与轮初 SpO2 的乘积，含一轮滞后，只是读数；
 * `bloodOxygen` 用 `maxOxygenDeliveryMlPerMin` 判定供氧是否受限。后者使用 `heart`
 * 输出的能力上限 `heart.maxCardiacOutputMlMin`，与当前心输出无关，所以健康人在活动首轮
 * 不会因上一轮静息心输出而假性去饱和；若 `heart` 未加载或未提供该字段（如孤立 mock），
 * 则回退到 `blood.referenceMaxCardiacOutputMlMin`。
 *
 * `bodyFluid` 存在时 `bloodVolumeMl` 随 `bodyFluid.waterVolumeMl / 30000` 比例缩放并钳到
 * `[2500, 6000] mL`（`design` 血管-体液耦合代理）；`bodyFluid` 未加载时原样带出轮初
 * 自身状态，旧档或缺字段回退到 `referenceBloodVolumeMl`。未加载 `heart` 时心输出按
 * 4900 回退，使静息态血压精确为 `120.0 / 80.0 mmHg`；未加载 `bloodOxygen` 时 SpO2 按
 * 97% 回退（与 `bloodOxygen.baselineSpo2Percent` 的 design 默认值同步，不另立参数）。已加载的
 * `heart` / `bloodOxygen` / `bodyFluid` 若缺字段、非数值、非有限或为负，抛错使本轮失败且不写状态。
 * 替换或简化 `heart` 脚本时只需保留 `cardiacOutputMlMin`（以及可选的 `maxCardiacOutputMlMin`），
 * `blood` 不再读取 `heart.parameters.json`。
 *
 * 血压与 GFR 都是代理读数：血压不是袖带或动脉压测量，GFR 不是菊粉/肌酐清除率、肾血浆
 * 流量或临床肾功能，氧输送也不是血气或氧耗实测。参数全部来自同目录
 * `blood.parameters.json`，状态 `design`、
 * `source: null`；4900 / 16380 / 30000 / 120 / 80 / 100 / 2、指数 0.5 与 0.3、钳位
 * 2500–6000 / 80–200 / 40–120 / 0.5–1.2 都是工程占位，不是人体测量或拟合结果，不能称 `validated`。
 * 不建模血管分区、微循环、血细胞/血红蛋白、CO2/酸碱、血压分级诊断或运动性高血压。
 * 输出只含七个有限数字段，JSON-safe。
 */
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'blood';
export const actionTypes: string[] = [];

type BloodState = {
  bloodVolumeMl: number;
  cardiacOutputMlMin: number;
  systolicMmHg: number;
  diastolicMmHg: number;
  oxygenDeliveryMlMin: number;
  maxOxygenDeliveryMlPerMin: number;
  gfrMlMin: number;
};

type HeartReading = {
  cardiacOutputMlMin?: unknown;
  maxCardiacOutputMlMin?: unknown;
};

type BloodOxygenReading = {
  spo2Percent?: unknown;
};

type BodyFluidReading = {
  waterVolumeMl?: unknown;
};

type AutonomicReading = {
  sympatheticMm?: unknown;
};

const parameters = loadParameters(new URL('./blood.parameters.json', import.meta.url));
const referenceBloodVolumeMl = scaleByBodyWeight(
  requireParameter(parameters, 'blood.referenceBloodVolumeMl'),
  'blood.referenceBloodVolumeMl',
);
const baselineSystolicMmHg = requireParameter(parameters, 'blood.baselineSystolicMmHg');
const baselineDiastolicMmHg = requireParameter(parameters, 'blood.baselineDiastolicMmHg');
const baselineGfrMlMin = scaleByBodyWeight(
  requireParameter(parameters, 'blood.baselineGfrMlMin'),
  'blood.baselineGfrMlMin',
);
const oxygenContentPerPercentMlPerL = requireParameter(
  parameters,
  'blood.oxygenContentPerPercentMlPerL',
);
const sympatheticSystolicGain = requireParameter(parameters, 'blood.sympatheticSystolicGain');
const sympatheticDiastolicGain = requireParameter(parameters, 'blood.sympatheticDiastolicGain');
const referenceMaxCardiacOutputMlMin = scaleByBodyWeight(
  requireParameter(parameters, 'blood.referenceMaxCardiacOutputMlMin'),
  'blood.referenceMaxCardiacOutputMlMin',
);

const referenceCardiacOutputMlMin = scaleByBodyWeight(4900);
const referenceBodyWaterMl = getNumericParameterOverride('bodyFluid.referenceVolumeMl')
  ?? scaleByBodyWeight(30000);
const bloodVolumeRange = { min: scaleByBodyWeight(2500), max: scaleByBodyWeight(6000) };
const fallbackSpo2Percent = 97;
const systolicRange = { min: 80, max: 200 };
const diastolicRange = { min: 40, max: 120 };
const gfrVolumeRatioRange = { min: 0.5, max: 1.2 };

function maxOxygenDeliveryAt(maxCardiacOutputMlMin: number, spo2Percent: number): number {
  return maxCardiacOutputMlMin * (spo2Percent * oxygenContentPerPercentMlPerL) / 1000;
}

export const initialState: BloodState = {
  bloodVolumeMl: referenceBloodVolumeMl,
  cardiacOutputMlMin: referenceCardiacOutputMlMin,
  systolicMmHg: baselineSystolicMmHg,
  diastolicMmHg: baselineDiastolicMmHg,
  oxygenDeliveryMlMin:
    referenceCardiacOutputMlMin * (fallbackSpo2Percent * oxygenContentPerPercentMlPerL) / 1000,
  maxOxygenDeliveryMlPerMin: maxOxygenDeliveryAt(referenceMaxCardiacOutputMlMin, fallbackSpo2Percent),
  gfrMlMin: baselineGfrMlMin,
};

export const fields = {
  bloodVolumeMl: { unit: 'mL', mode: 'absolute' },
  cardiacOutputMlMin: { unit: 'mL/min', mode: 'absolute' },
  systolicMmHg: { unit: 'mmHg', mode: 'absolute' },
  diastolicMmHg: { unit: 'mmHg', mode: 'absolute' },
  oxygenDeliveryMlMin: { unit: 'mL/min', mode: 'absolute' },
  maxOxygenDeliveryMlPerMin: { unit: 'mL/min', mode: 'absolute' },
  gfrMlMin: { unit: 'mL/min', mode: 'absolute' },
};

type IO = {
  read(id: 'blood'): Readonly<BloodState> | undefined;
  read(id: 'heart'): Readonly<HeartReading> | undefined;
  read(id: 'bloodOxygen'): Readonly<BloodOxygenReading> | undefined;
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | undefined;
  read(id: 'autonomic'): Readonly<AutonomicReading> | undefined;
  write(next: BloodState): void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`blood: ${name} must be a finite number`);
  }
  return value;
}

function readBloodVolume(
  prev: Readonly<BloodState>,
  bodyFluid: Readonly<BodyFluidReading> | undefined,
): number {
  if (bodyFluid !== undefined) {
    const waterVolumeMl = requireFinite(
      bodyFluid.waterVolumeMl,
      'bodyFluid.waterVolumeMl',
    );
    if (waterVolumeMl < 0) {
      throw new Error('blood: bodyFluid.waterVolumeMl must not be negative');
    }
    return clamp(
      referenceBloodVolumeMl * (waterVolumeMl / referenceBodyWaterMl),
      bloodVolumeRange.min,
      bloodVolumeRange.max,
    );
  }
  const value = prev.bloodVolumeMl;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return referenceBloodVolumeMl;
}

function readCardiacOutput(heart: Readonly<HeartReading> | undefined): number {
  if (heart === undefined) return referenceCardiacOutputMlMin;
  const cardiacOutputMlMin = requireFinite(
    heart.cardiacOutputMlMin,
    'heart.cardiacOutputMlMin',
  );
  if (cardiacOutputMlMin < 0) {
    throw new Error('blood: heart.cardiacOutputMlMin must not be negative');
  }
  return cardiacOutputMlMin;
}

function readMaxCardiacOutput(heart: Readonly<HeartReading> | undefined): number {
  if (heart === undefined || heart.maxCardiacOutputMlMin === undefined) {
    return referenceMaxCardiacOutputMlMin;
  }
  const maxCardiacOutputMlMin = requireFinite(
    heart.maxCardiacOutputMlMin,
    'heart.maxCardiacOutputMlMin',
  );
  if (maxCardiacOutputMlMin < 0) {
    throw new Error('blood: heart.maxCardiacOutputMlMin must not be negative');
  }
  return maxCardiacOutputMlMin;
}

function readSpo2Percent(bloodOxygen: Readonly<BloodOxygenReading> | undefined): number {
  if (bloodOxygen === undefined) return fallbackSpo2Percent;
  const spo2Percent = requireFinite(
    bloodOxygen.spo2Percent,
    'bloodOxygen.spo2Percent',
  );
  if (spo2Percent < 0) {
    throw new Error('blood: bloodOxygen.spo2Percent must not be negative');
  }
  return spo2Percent;
}

export function heartbeat(io: IO): void {
  const bloodVolumeMl = readBloodVolume(io.read(id) ?? initialState, io.read('bodyFluid'));
  const heart = io.read('heart');
  const cardiacOutputMlMin = readCardiacOutput(heart);
  const maxCardiacOutputMlMin = readMaxCardiacOutput(heart);
  const spo2Percent = readSpo2Percent(io.read('bloodOxygen'));
  const rawSympathetic = io.read('autonomic')?.sympatheticMm;
  const sympatheticMm = typeof rawSympathetic === 'number' && Number.isFinite(rawSympathetic)
    ? clamp(rawSympathetic, 0, 100)
    : 0;
  const sympatheticToneFactor = 1 + sympatheticSystolicGain * sympatheticMm;

  const cardiacOutputRatio = cardiacOutputMlMin / referenceCardiacOutputMlMin;
  const systolicMmHg = clamp(
    baselineSystolicMmHg * (cardiacOutputRatio ** 0.5) * sympatheticToneFactor,
    systolicRange.min,
    systolicRange.max,
  );
  const diastolicMmHg = clamp(
    baselineDiastolicMmHg * (cardiacOutputRatio ** 0.3) * (1 + sympatheticDiastolicGain * sympatheticMm),
    diastolicRange.min,
    diastolicRange.max,
  );
  const oxygenDeliveryMlMin =
    cardiacOutputMlMin * (spo2Percent * oxygenContentPerPercentMlPerL) / 1000;
  const maxOxygenDeliveryMlPerMin = maxOxygenDeliveryAt(maxCardiacOutputMlMin, spo2Percent);
  const gfrMlMin = baselineGfrMlMin * clamp(
    bloodVolumeMl / referenceBloodVolumeMl,
    gfrVolumeRatioRange.min,
    gfrVolumeRatioRange.max,
  );

  io.write({
    bloodVolumeMl,
    cardiacOutputMlMin,
    systolicMmHg,
    diastolicMmHg,
    oxygenDeliveryMlMin,
    maxOxygenDeliveryMlPerMin,
    gfrMlMin,
  });
}
