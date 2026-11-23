/*
 * 血液隔室薄切片（blood）：血容量、心输出读数、血压代理、氧输送读数、循环最大氧输送
 * 能力与肾滤过代理；部位 `blood` 的唯一写者。消费者：`body_state` / `GET /state` 读出
 * 七个字段；`kidney` 读 `gfrMlMin`、`hypothalamusAdh` 读 `bloodVolumeMl`、
 * `bloodOxygen` 把 `maxOxygenDeliveryMlPerMin` 当作组织供氧的能力上限。本脚本不调用
 * transfer，不写其他部位，也没有动作或通知。
 *
 * 公式（design）：
 *   dtMin 不使用；全部按轮初快照计算
 *   referenceCardiacOutputMlMin = 5000（脚本内 design 常量）
 *   cardiacOutputMlMin = heart.cardiacOutputMlMin（heart 未加载时回退 5000）
 *   arterialContent = bloodOxygen.spo2Percent × oxygenContentPerPercentMlPerL
 *   oxygenDeliveryMlMin = cardiacOutputMlMin × arterialContent / 1000（读数）
 *   maxDrive = 1 + heart.activityGain + heart.catecholamineGain × (maxCortisolRelative − 1)
 *   maxOxygenDeliveryMlPerMin = heart.maxHeartRatePerMin × heart.restingStrokeVolumeMl
 *                              × (1 + 0.2 × (maxDrive − 1)) × arterialContent / 1000
 *   systolicMmHg = clamp(baselineSystolicMmHg
 *                        × (cardiacOutputMlMin / referenceCardiacOutputMlMin) ^ 0.5, 80, 200)
 *   diastolicMmHg = clamp(baselineDiastolicMmHg
 *                         × (cardiacOutputMlMin / referenceCardiacOutputMlMin) ^ 0.3, 40, 120)
 *   gfrMlMin = baselineGfrMlMin
 *              × clamp(bloodVolumeMl / referenceBloodVolumeMl, 0.5, 1.2)
 *
 * `oxygenDeliveryMlMin` 是轮初心输出与轮初 SpO2 的乘积，含一轮滞后，只是读数；
 * `bloodOxygen` 用 `maxOxygenDeliveryMlPerMin` 判定供氧是否受限。后者是按最大驱动
 * （活动 1 + 皮质醇到上限）算出的循环能力上限，与当前心输出无关，所以健康人在活动首轮
 * 不会因上一轮静息心输出而假性去饱和。`maxDrive` 用 `maxCortisolRelative = 3`
 * （与 `interoception` 把皮质醇映射到应激读数的 100% 点一致）和与 `heart.ts` 相同的
 * 0.2 搏出量增益；这两个是脚本内 design 常量，不是人体测量。心率直接用
 * `heart.maxHeartRatePerMin`，与 heart 自身 `clamp(restingHeartRatePerMin × drive, …)`
 * 在默认参数下等价（70 × 3.5 > 180）。
 *
 * `bloodVolumeMl` 从轮初自身状态原样带出，本切片不建体液—血管搬水、毛细血管滤过/重吸收
 * 或失血/输血动力学；旧档或缺字段时回退到 `referenceBloodVolumeMl`。未加载 `heart` 时
 * 心输出按 5000 回退；未加载 `bloodOxygen` 时 SpO2 按 97% 回退（与
 * `bloodOxygen.baselineSpo2Percent` 的 design 默认值同步，不另立参数）。已加载的
 * `heart` / `bloodOxygen` 若缺字段、非数值、非有限或为负，抛错使本轮失败且不写状态。
 * `heart` 的四个参数从 `heart.parameters.json` 只读加载；替换 heart 脚本时需保持这些
 * 参数 id。`heart` 静息态自身算出 70 × 70 = 4900，而血压代理的参考心输出是 5000，所以
 * 装了 heart 的静息血压略低于初始 120/80；这是两个 design 占位的口径差，不是生理证据。
 *
 * 血压与 GFR 都是代理读数：血压不是袖带或动脉压测量，GFR 不是菊粉/肌酐清除率、肾血浆
 * 流量或临床肾功能，氧输送也不是血气或氧耗实测。参数来自同目录
 * `blood.parameters.json` 与只读的 `heart.parameters.json`，状态 `design`、
 * `source: null`；5000 / 120 / 80 / 100 / 2、指数 0.5 与 0.3、钳位
 * 80–200 / 40–120 / 0.5–1.2 都是工程占位，不是人体测量或拟合结果，不能称 `validated`。
 * 不建模血管分区、微循环、血细胞/血红蛋白、CO2/酸碱、血压分级诊断或运动性高血压。
 * 输出只含七个有限数字段，JSON-safe。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

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
};

type BloodOxygenReading = {
  spo2Percent?: unknown;
};

const parameters = loadParameters(new URL('./blood.parameters.json', import.meta.url));
const referenceBloodVolumeMl = requireParameter(
  parameters,
  'blood.referenceBloodVolumeMl',
);
const baselineSystolicMmHg = requireParameter(parameters, 'blood.baselineSystolicMmHg');
const baselineDiastolicMmHg = requireParameter(parameters, 'blood.baselineDiastolicMmHg');
const baselineGfrMlMin = requireParameter(parameters, 'blood.baselineGfrMlMin');
const oxygenContentPerPercentMlPerL = requireParameter(
  parameters,
  'blood.oxygenContentPerPercentMlPerL',
);

const referenceCardiacOutputMlMin = 5000;
const fallbackSpo2Percent = 97;
const strokeVolumeGain = 0.2;
const maxCortisolRelative = 3;
const systolicRange = { min: 80, max: 200 };
const diastolicRange = { min: 40, max: 120 };
const gfrVolumeRatioRange = { min: 0.5, max: 1.2 };

const heartParameters = loadParameters(
  new URL('../../human-organs/heart/heart.parameters.json', import.meta.url),
);
const maxHeartRatePerMin = requireParameter(heartParameters, 'heart.maxHeartRatePerMin');
const restingStrokeVolumeMl = requireParameter(
  heartParameters,
  'heart.restingStrokeVolumeMl',
);
const activityGain = requireParameter(heartParameters, 'heart.activityGain');
const catecholamineGain = requireParameter(heartParameters, 'heart.catecholamineGain');

const maxDrive = 1 + activityGain + catecholamineGain * (maxCortisolRelative - 1);
const maxStrokeVolumeMl = restingStrokeVolumeMl * (1 + strokeVolumeGain * (maxDrive - 1));

function maxOxygenDeliveryAt(spo2Percent: number): number {
  return maxHeartRatePerMin * maxStrokeVolumeMl
    * (spo2Percent * oxygenContentPerPercentMlPerL) / 1000;
}

export const initialState: BloodState = {
  bloodVolumeMl: referenceBloodVolumeMl,
  cardiacOutputMlMin: referenceCardiacOutputMlMin,
  systolicMmHg: baselineSystolicMmHg,
  diastolicMmHg: baselineDiastolicMmHg,
  oxygenDeliveryMlMin:
    referenceCardiacOutputMlMin * (fallbackSpo2Percent * oxygenContentPerPercentMlPerL) / 1000,
  maxOxygenDeliveryMlPerMin: maxOxygenDeliveryAt(fallbackSpo2Percent),
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

function readBloodVolume(prev: Readonly<BloodState>): number {
  const value = prev.bloodVolumeMl;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return referenceBloodVolumeMl;
}

function readCardiacOutput(heart: Readonly<HeartReading> | undefined): number {
  if (heart === undefined) return referenceCardiacOutputMlMin;
  if (typeof heart !== 'object' || heart === null) {
    throw new Error('blood: heart must be an object');
  }
  const cardiacOutputMlMin = requireFinite(
    heart.cardiacOutputMlMin,
    'heart.cardiacOutputMlMin',
  );
  if (cardiacOutputMlMin < 0) {
    throw new Error('blood: heart.cardiacOutputMlMin must not be negative');
  }
  return cardiacOutputMlMin;
}

function readSpo2Percent(bloodOxygen: Readonly<BloodOxygenReading> | undefined): number {
  if (bloodOxygen === undefined) return fallbackSpo2Percent;
  if (typeof bloodOxygen !== 'object' || bloodOxygen === null) {
    throw new Error('blood: bloodOxygen must be an object');
  }
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
  const bloodVolumeMl = readBloodVolume(io.read(id) ?? initialState);
  const cardiacOutputMlMin = readCardiacOutput(io.read('heart'));
  const spo2Percent = readSpo2Percent(io.read('bloodOxygen'));

  const cardiacOutputRatio = cardiacOutputMlMin / referenceCardiacOutputMlMin;
  const systolicMmHg = clamp(
    baselineSystolicMmHg * cardiacOutputRatio ** 0.5,
    systolicRange.min,
    systolicRange.max,
  );
  const diastolicMmHg = clamp(
    baselineDiastolicMmHg * cardiacOutputRatio ** 0.3,
    diastolicRange.min,
    diastolicRange.max,
  );
  const oxygenDeliveryMlMin =
    cardiacOutputMlMin * (spo2Percent * oxygenContentPerPercentMlPerL) / 1000;
  const maxOxygenDeliveryMlPerMin = maxOxygenDeliveryAt(spo2Percent);
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
