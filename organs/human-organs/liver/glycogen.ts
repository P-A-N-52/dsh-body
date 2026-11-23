/*
 * 肝糖原自主摄取与释放脚本（部位 `liver`）；部位 `liver` 的唯一写者。
 *
 * 消费者：`glucose`。本脚本每轮按自己的参数（最大摄糖速率、半饱和超基线量、胰岛素敏感度）
 * 与轮初 `glucose.excessMassG`、`pancreasEndocrine.insulinRelative` 自主计算
 * `storageRequestG`，再按轮初存量把请求钳到剩余容量；`glucose` 下一轮按结算顺序支付，经
 * transfer 转入 `storageG`。请求与到账分离：`storageRequestG` 是本轮请求，`storageG` 是
 * 已到账、尚未并入存量的实际量（`transferIn`，每轮 write 归 0）。
 *
 * 释放由本脚本当轮发起：低血糖或胰高血糖素高于基线时发起
 * `liver.glycogenG → glucose.glucoseMassG` 的 transfer，把糖原真实补回血糖；释放速率再乘
 * 轮初 `adrenal.cortisolRelative`，皮质醇高于基线时肝糖输出增加。只有肝向血液放糖；肌肉与
 * 脂肪不释放葡萄糖。释放量恒受 `prev.glycogenG + prev.storageG` 钳制，存量耗尽后
 * `release = 0`。释放与摄糖请求各自计算、互不挪用：请求由轮初 `excessMassG` 决定，
 * 释放由轮初血糖浓度、胰高血糖素与皮质醇决定。
 *
 * 储量上限：`glycogenCapacityG` 是本脚本每轮从参数写出的常量字段，不是 transfer 目标。
 * 请求先按自身速率算，再钳到轮初剩余容量：
 *   remainingCapacityG = max(0, glycogenCapacityG − (prev.glycogenG + prev.storageG))
 * 肝已满时请求为 0，超出部分留在血糖池，由 `glucose` 按其自身残余清除处理。
 *
 * 公式（design，`dtMin = io.dt / 60`）：
 *   baselineMgDl = 90
 *   response = 1 + insulinSensitivity × (insulinRelative − 1)
 *   storageRequestG = min(
 *     maxUptakeRateGPerMin × (excessMassG / (excessMassG + halfMaxExcessG)) × response × dtMin,
 *     remainingCapacityG,
 *   )
 *   stored   = prev.glycogenG + prev.storageG
 *   releasing = G < baselineMgDl || glucagonRelative > 1
 *   release  = releasing
 *     ? min(
 *         maxOutputRateGPerMin × glucagonRelative × cortisolRelative × dtMin,
 *         max(0, stored),
 *       )
 *     : 0
 *   write {
 *     glycogenG: max(0, stored),
 *     storageG: 0,
 *     glycogenCapacityG,
 *     storageRequestG,
 *     outputG: release,
 *   }
 *   transfer liver.glycogenG → glucose.glucoseMassG: release（release > 0 时）
 * `excessMassG`、`concentrationMgDl`、`insulinRelative`、`glucagonRelative` 与
 * `cortisolRelative` 都是轮初快照；90 mg/dL 参考值与 `glucose.baselineConcentrationMgDl`、
 * `pancreasEndocrine.referenceGlucoseMgDl` 的工程基线一致，只是释放触发参考，不是实测低血糖
 * 阈值。
 *
 * 时序（design）：第 N 轮本脚本写出 `storageRequestG`；`glucose` 在同轮读到的仍是轮初
 * （第 N−1 轮）请求，本轮结算后把实际到账写入 `storageG`；第 N+1 轮本脚本把 `storageG`
 * 并入 `glycogenG` 并归零 `storageG`。`release` 经随后的 transfer 从刚写入的 `glycogenG`
 * 扣除；Gateway 先应用 write 再按目标名结算 transfer，因此不会透支。`outputG` 只是本轮
 * 实际释放记录，不参与外源碳水质量账（释放是内部转移）。
 *
 * 证据与未验证：本切片没有肝糖原储量、容量、摄糖速率、半饱和量、胰岛素敏感度或胰高血糖素—
 * 肝糖输出剂量反应的实测数据。同目录 `glycogen.parameters.json` 的六个参数都是
 * `status: design`、`source: null` 的工程占位，不是拟合值、实测值或临床阈值，不能称
 * validated。未建模：容量随个体/年龄/进食状态变化、餐后糖原再合成细节、胰岛素对肝糖输出的
 * 抑制（本切片只按敏感度放大摄糖请求，释放只看血糖、胰高血糖素与皮质醇）、糖异生、胆汁/解毒/
 * 蛋白合成/脂肪代谢、激素绝对浓度与个体差异。
 *
 * 边界：`glucose` 未加载时释放按参考 90 mg/dL、`excessMassG` 按 0 回退；
 * `pancreasEndocrine` 未加载时按 `glucagonRelative = 1`、`insulinRelative = 1` 回退；
 * `adrenal` 未加载时按 `cortisolRelative = 1` 回退。上游已加载但字段缺失、非有限或为负时
 * 抛错使本轮失败，且不写状态、不发起 transfer，不用健康常量掩盖异常；合法 0 浓度、0 超基线量、
 * 0 胰高血糖素与 0 皮质醇相对信号都是有效读数。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'liver';
export const actionTypes: string[] = [];

type LiverState = {
  glycogenG: number;
  storageG: number;
  glycogenCapacityG: number;
  storageRequestG: number;
  outputG: number;
};

type SavedLiverState = {
  readonly glycogenG?: unknown;
  readonly storageG?: unknown;
};

type GlucoseReading = {
  concentrationMgDl?: unknown;
  excessMassG?: unknown;
};

type PancreasReading = {
  glucagonRelative?: unknown;
  insulinRelative?: unknown;
};

type AdrenalReading = {
  cortisolRelative?: unknown;
};

const parameters = loadParameters(new URL('./glycogen.parameters.json', import.meta.url));
const maxOutputRateGPerMin = requireParameter(parameters, 'liver.maxOutputRateGPerMin');
const initialGlycogenG = requireParameter(parameters, 'liver.initialGlycogenG');
const glycogenCapacityG = requireParameter(parameters, 'liver.glycogenCapacityG');
const maxUptakeRateGPerMin = requireParameter(parameters, 'liver.maxUptakeRateGPerMin');
const halfMaxExcessG = requireParameter(parameters, 'liver.halfMaxExcessG');
const insulinSensitivity = requireParameter(parameters, 'liver.insulinSensitivity');

const baselineMgDl = 90;

export const initialState: LiverState = {
  glycogenG: initialGlycogenG,
  storageG: 0,
  glycogenCapacityG,
  storageRequestG: 0,
  outputG: 0,
};

export const fields = {
  glycogenG: {
    unit: 'g',
    mode: 'absolute',
    transferOut: ['glucose.glucoseMassG'],
  },
  storageG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['glucose.glucoseMassG'],
  },
  glycogenCapacityG: { unit: 'g', mode: 'absolute' },
  storageRequestG: { unit: 'g', mode: 'absolute' },
  outputG: { unit: 'g', mode: 'absolute' },
};

type IO = {
  read(id: 'liver'): Readonly<SavedLiverState> | undefined;
  read(id: 'glucose'): Readonly<GlucoseReading> | undefined;
  read(id: 'pancreasEndocrine'): Readonly<PancreasReading> | undefined;
  read(id: 'adrenal'): Readonly<AdrenalReading> | undefined;
  readonly dt: number;
  write(next: LiverState): void;
  transfer(
    fromPart: 'liver',
    fromField: 'glycogenG',
    toPart: 'glucose',
    toField: 'glucoseMassG',
    amount: number,
  ): void;
};

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function concentrationOf(glucose: Readonly<GlucoseReading>): number {
  const concentrationMgDl = glucose.concentrationMgDl;
  if (
    typeof concentrationMgDl !== 'number'
    || !Number.isFinite(concentrationMgDl)
    || concentrationMgDl < 0
  ) {
    throw new Error(
      'liver: glucose.concentrationMgDl must be a finite non-negative number',
    );
  }
  return concentrationMgDl;
}

function excessOf(glucose: Readonly<GlucoseReading>): number {
  const excessMassG = glucose.excessMassG;
  if (
    typeof excessMassG !== 'number'
    || !Number.isFinite(excessMassG)
    || excessMassG < 0
  ) {
    throw new Error(
      'liver: glucose.excessMassG must be a finite non-negative number',
    );
  }
  return excessMassG;
}

function glucagonRelativeOf(pancreas: Readonly<PancreasReading>): number {
  const glucagonRelative = pancreas.glucagonRelative;
  if (
    typeof glucagonRelative !== 'number'
    || !Number.isFinite(glucagonRelative)
    || glucagonRelative < 0
  ) {
    throw new Error(
      'liver: pancreasEndocrine.glucagonRelative must be a finite non-negative number',
    );
  }
  return glucagonRelative;
}

function insulinRelativeOf(pancreas: Readonly<PancreasReading>): number {
  const insulinRelative = pancreas.insulinRelative;
  if (
    typeof insulinRelative !== 'number'
    || !Number.isFinite(insulinRelative)
    || insulinRelative < 0
  ) {
    throw new Error(
      'liver: pancreasEndocrine.insulinRelative must be a finite non-negative number',
    );
  }
  return insulinRelative;
}

function cortisolRelativeOf(adrenal: Readonly<AdrenalReading>): number {
  const cortisolRelative = adrenal.cortisolRelative;
  if (
    typeof cortisolRelative !== 'number'
    || !Number.isFinite(cortisolRelative)
    || cortisolRelative < 0
  ) {
    throw new Error(
      'liver: adrenal.cortisolRelative must be a finite non-negative number',
    );
  }
  return cortisolRelative;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const storedG = finiteOrZero(prev.glycogenG) + finiteOrZero(prev.storageG);
  const availableG = Math.max(0, storedG);

  const glucose = io.read('glucose');
  const glucoseMgDl = glucose === undefined ? baselineMgDl : concentrationOf(glucose);
  const excessMassG = glucose === undefined ? 0 : excessOf(glucose);
  const pancreas = io.read('pancreasEndocrine');
  const glucagonRelative = pancreas === undefined ? 1 : glucagonRelativeOf(pancreas);
  const insulinRelative = pancreas === undefined ? 1 : insulinRelativeOf(pancreas);
  const adrenal = io.read('adrenal');
  const cortisolRelative = adrenal === undefined ? 1 : cortisolRelativeOf(adrenal);

  const dtMin = io.dt / 60;

  const releasing = glucoseMgDl < baselineMgDl || glucagonRelative > 1;
  const releaseG = releasing
    ? Math.min(
        maxOutputRateGPerMin * glucagonRelative * cortisolRelative * dtMin,
        availableG,
      )
    : 0;

  const remainingCapacityG = Math.max(0, glycogenCapacityG - availableG);
  const insulinResponse = 1 + insulinSensitivity * (insulinRelative - 1);
  const storageRequestG = Math.min(
    maxUptakeRateGPerMin
      * (excessMassG / (excessMassG + halfMaxExcessG))
      * insulinResponse
      * dtMin,
    remainingCapacityG,
  );

  io.write({
    glycogenG: availableG,
    storageG: 0,
    glycogenCapacityG,
    storageRequestG,
    outputG: releaseG,
  });
  if (releaseG > 0) {
    io.transfer(id, 'glycogenG', 'glucose', 'glucoseMassG', releaseG);
  }
}
