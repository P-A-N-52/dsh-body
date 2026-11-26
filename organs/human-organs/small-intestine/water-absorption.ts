/*
 * 小肠（smallIntestine）水与碳水吸收脚本；部位 `smallIntestine` 的唯一写者。
 * 每轮只吸收轮初肠腔内容物：水按一阶指数转入 `bodyFluid.waterVolumeMl`，可消化碳水按
 * 一阶指数转入 `glucose.glucoseMassG`。
 *
 * 水来源（登记见 organs/human-organs/references/source-index.csv）：
 * - SRC-PERONNET-2012 / peronnet-2012：PMC3351614。健康年轻男性 n=36，一次 300 mL 低矿化度水
 *   加 D₂O 示踪（D₂O 0.10 g/kg 瘦体重），0/5/10/15/20/30/60 min 采血。
 *   * 支撑：口服水吸收在 5 min 即可检出、完整吸收与分布跨数十分钟的探索性时间尺度，
 *     以及“小肠从肠腔向体液方向搬水”的方向性假设。
 *   * 不能推出：原文的 75–120 min 是表观完全吸收与分布时间（按 7×ta½ 的文字概括），不是任何
 *     小肠段或半时参数；ta½ 10.9/12.9 min 是血浆示踪出现半时，不是肠腔水消失半时；D₂O 是
 *     示踪水，不等于肠腔水体积或纯水体积。本脚本的
 *     `smallIntestine.absorption.halfTimeMin = 20 min`（同目录
 *     `water-absorption.parameters.json`，`design`）不是论文报告值，也不是对
 *     Péronnet 曲线的拟合，不能称 validated。笔记由
 *     organs/human-organs/small-intestine/references/notes/peronnet-2012.md 记录原文定位。
 *
 * 碳水来源：无直接证据。`smallIntestine.carbohydrateAbsorption.halfTimeMin = 20 min`（同目录
 * `water-absorption.parameters.json`）是 `design`、`source: null`，不是论文报告值，也不是
 * Dalla Man 2007 的 `k_abs`（该文标为 fixed following [17]，换算出的约 12.2 min 只是速率常数
 * 算术）。未来若有肠腔碳水消失或餐后葡萄糖出现的人体测量，用同目录参数文件替换。20 min 不能
 * 称 validated，也没有对任何曲线拟合。
 *
 * 工程假设（design）：一阶指数吸收的离散形式
 * A = pool_start × (1 − 2^(−dtMin / halfTimeMin))；水与碳水各用自己的半时。它只固定“池越大、
 * 吸收越快”和工程时间尺度，不区分肠段、转运体、渗透压或血流限制，也不把吸收量当门静脉
 * 水通量或血浆容量变化。`absorbedWaterMl` / `absorbedCarbohydrateG` 是本轮吸收读数，不是累计量。
 * `carbohydrateG` 是肠腔可消化碳水的葡萄糖当量，不是总碳水、膳食纤维或糖醇，也不从水、体积
 * 或能量反推。
 *
 * 网关的 write 在 transfer 之前应用：本脚本写回的是本轮转出前的轮初池，随后由 `io.transfer`
 * 扣除吸收量。胃同轮转入的水和碳水在 transfer 阶段才加入肠池，下一轮才参与吸收，因此不会
 * 放大本轮的吸收量。旧存档没有 `waterVolumeMl` / `carbohydrateG` 时按 0 读取。
 *
 * 结肠残渣出口（design，见 docs/superpowers/specs/2026-11-24-bowel-design.md）：水字段的
 * `transferOut` 同时声明 `bodyFluid.waterVolumeMl` 与 `colon.residueWaterMl`，分别与体液的
 * `transferIn` 和结肠的 `transferIn` 配对；`colon` 必须加载，否则启动校验失败。按离开通量
 * 的比例分流，使累计约 `smallIntestine.residueFraction = 0.05`（同目录参数文件，`design`、
 * `source: null`）进入结肠、约 `95%` 经小肠吸收并自然随 `dtMin` 缩放：
 *   absorbedWaterMl = clamp(waterVolumeMl × (1 − 2^(−dtMin / halfTimeMin)) × waterFactor, 0, waterVolumeMl)
 *   f = clamp(residueFraction, 0, 1)
 *   f <= 0 时 residueWaterMl = 0；f >= 1 时 residueWaterMl = max(0, waterVolumeMl − absorbedWaterMl)
 *   否则 residueWaterMl = min(max(0, waterVolumeMl − absorbedWaterMl), absorbedWaterMl × f / (1 − f))
 * 残渣与吸收量之和不超过轮初肠水且均非负，因此同轮两个 transfer 不会透支源字段。结肠在下一轮才
 * 回收其中一部分回流 `bodyFluid`；本轮回收量按结肠轮初残渣计算，不参与本轮小肠吸收。`colon`
 * 未加载时直接调用本模块不报错，但完整清单启动会因 `transferOut` 目标未声明而失败。
 *
 * 吸收反馈（design，修正自 docs/superpowers/specs/2026-11-24-digestive-feedback-design.md）：
 *   waterFactor = max(0, 1 + waterAbsorptionDehydrationFactor × clamp(bodyFluid.waterDeficit, 0, 1))
 *   carbFactor  = max(0, 1 + carbAbsorptionInsulinGain × (pancreasEndocrine.insulinPmolL / 60 − 1)
 *                 − carbAbsorptionGradientGain × (glucose.concentrationMgDl / 90 − 1))
 * 吸收量均按 [0, 轮初池] 严格钳位，防止负值或透支。90 mg/dL 是硬编码的工程参考浓度（与
 * `glucose.baselineConcentrationMgDl = 90` 对齐），不跨模块读取参数。脱水时不抑制水吸收（默认
 * `waterAbsorptionDehydrationFactor = 0.1`）；肠腔 SGLT1 吸收不依赖胰岛素（默认
 * `carbAbsorptionInsulinGain = 0`）；高血糖降低肠腔-血液浓度梯度（负反馈，默认
 * `carbAbsorptionGradientGain = 0.2`）。三个增益参数全部为 design、`source: null`，不是人体实测
 * 斜率；转运体、渗透压、血流与肠段差异不建模。
 *
 * 上游契约：`bodyFluid` / `glucose` / `pancreasEndocrine` 未加载（undefined/null）时对应 factor
 * 按 1（原速率）；部位已加载但字段缺失、非有限或为负时抛错，本轮不写状态也不发 transfer。
 * 水亏缺按 [0, 1] 钳位，超出不报错；读数来自轮初快照，滞后一轮。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'smallIntestine';
export const actionTypes: string[] = [];

type SmallIntestineState = {
  waterVolumeMl: number;
  absorbedWaterMl: number;
  carbohydrateG: number;
  absorbedCarbohydrateG: number;
};

export const initialState: SmallIntestineState = {
  waterVolumeMl: 0,
  absorbedWaterMl: 0,
  carbohydrateG: 0,
  absorbedCarbohydrateG: 0,
};

export const fields = {
  waterVolumeMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['stomach.waterVolumeMl'],
    transferOut: ['bodyFluid.waterVolumeMl', 'colon.residueWaterMl'],
  },
  absorbedWaterMl: { unit: 'mL', mode: 'absolute' },
  carbohydrateG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['stomach.carbohydrateG'],
    transferOut: ['glucose.glucoseMassG'],
  },
  absorbedCarbohydrateG: { unit: 'g', mode: 'absolute' },
};

type BodyFluidReading = {
  readonly waterDeficit?: unknown;
};

type GlucoseReading = {
  readonly concentrationMgDl?: unknown;
};

type PancreasReading = {
  readonly insulinPmolL?: unknown;
};

type IO = {
  read(id: 'smallIntestine'): Readonly<SmallIntestineState> | undefined;
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | undefined;
  read(id: 'glucose'): Readonly<GlucoseReading> | undefined;
  read(id: 'pancreasEndocrine'): Readonly<PancreasReading> | undefined;
  readonly dt: number;
  write(next: SmallIntestineState): void;
  transfer(
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: number,
  ): void;
  transfer(
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'colon',
    toField: 'residueWaterMl',
    amount: number,
  ): void;
  transfer(
    fromPart: 'smallIntestine',
    fromField: 'carbohydrateG',
    toPart: 'glucose',
    toField: 'glucoseMassG',
    amount: number,
  ): void;
};

const parameters = loadParameters(new URL('./water-absorption.parameters.json', import.meta.url));
const halfTimeMin = requireParameter(parameters, 'smallIntestine.absorption.halfTimeMin');
const residueFraction = requireParameter(parameters, 'smallIntestine.residueFraction');
const carbohydrateHalfTimeMin = requireParameter(
  parameters,
  'smallIntestine.carbohydrateAbsorption.halfTimeMin',
);
const waterAbsorptionDehydrationFactor = requireParameter(
  parameters,
  'smallIntestine.waterAbsorptionDehydrationFactor',
);
const carbAbsorptionInsulinGain = requireParameter(
  parameters,
  'smallIntestine.carbAbsorptionInsulinGain',
);
const carbAbsorptionGradientGain = requireParameter(
  parameters,
  'smallIntestine.carbAbsorptionGradientGain',
);

const CARBOHYDRATE_BASELINE_MG_DL = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function absorbedFrom(pool: number, dtMin: number, halfTime: number): number {
  return pool * (1 - 2 ** (-dtMin / halfTime));
}

function readWaterDeficit(bodyFluid: Readonly<BodyFluidReading> | undefined): number {
  if (bodyFluid === undefined || bodyFluid === null) return 0;
  if (typeof bodyFluid !== 'object') throw new Error('bodyFluid must be an object');
  const deficit = bodyFluid.waterDeficit;
  if (typeof deficit !== 'number' || !Number.isFinite(deficit)) {
    throw new Error('bodyFluid.waterDeficit must be a finite number');
  }
  return clamp(deficit, 0, 1);
}

const BASAL_INSULIN_PMOL_L = 60;

function readInsulinRelative(pancreas: Readonly<{ insulinPmolL?: unknown }> | undefined): number {
  if (pancreas === undefined || pancreas === null) return 1;
  if (typeof pancreas !== 'object') throw new Error('pancreasEndocrine must be an object');
  const insulinPmolL = pancreas.insulinPmolL;
  if (typeof insulinPmolL !== 'number' || !Number.isFinite(insulinPmolL) || insulinPmolL < 0) {
    throw new Error('pancreasEndocrine.insulinPmolL must be a finite non-negative number');
  }
  return insulinPmolL / BASAL_INSULIN_PMOL_L;
}

function readConcentrationMgDl(glucose: Readonly<GlucoseReading> | undefined): number {
  if (glucose === undefined || glucose === null) return CARBOHYDRATE_BASELINE_MG_DL;
  if (typeof glucose !== 'object') throw new Error('glucose must be an object');
  const concentrationMgDl = glucose.concentrationMgDl;
  if (typeof concentrationMgDl !== 'number' || !Number.isFinite(concentrationMgDl) || concentrationMgDl < 0) {
    throw new Error('glucose.concentrationMgDl must be a finite non-negative number');
  }
  return concentrationMgDl;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const waterVolumeMl = Math.max(0, finiteOrZero(prev.waterVolumeMl));
  const carbohydrateG = Math.max(0, finiteOrZero(prev.carbohydrateG));
  const dtMin = io.dt / 60;

  const waterFactor = Math.max(
    0,
    1 + waterAbsorptionDehydrationFactor * readWaterDeficit(io.read('bodyFluid')),
  );
  const carbFactor = Math.max(
    0,
    1
      + carbAbsorptionInsulinGain * (readInsulinRelative(io.read('pancreasEndocrine')) - 1)
      - carbAbsorptionGradientGain
        * (readConcentrationMgDl(io.read('glucose')) / CARBOHYDRATE_BASELINE_MG_DL - 1),
  );

  const absorbedWaterMl = clamp(
    absorbedFrom(waterVolumeMl, dtMin, halfTimeMin) * waterFactor,
    0,
    waterVolumeMl,
  );
  const absorbedCarbohydrateG = clamp(
    absorbedFrom(carbohydrateG, dtMin, carbohydrateHalfTimeMin) * carbFactor,
    0,
    carbohydrateG,
  );

  const remainingWaterMl = waterVolumeMl - absorbedWaterMl;
  const clampedResidueFraction = clamp(residueFraction, 0, 1);
  const residueWaterMl = clampedResidueFraction <= 0
    ? 0
    : clampedResidueFraction >= 1
      ? Math.max(0, remainingWaterMl)
      : Math.min(
        Math.max(0, remainingWaterMl),
        absorbedWaterMl * (clampedResidueFraction / (1 - clampedResidueFraction)),
      );

  io.write({
    waterVolumeMl,
    absorbedWaterMl,
    carbohydrateG,
    absorbedCarbohydrateG,
  });
  io.transfer(id, 'waterVolumeMl', 'bodyFluid', 'waterVolumeMl', absorbedWaterMl);
  io.transfer(id, 'waterVolumeMl', 'colon', 'residueWaterMl', residueWaterMl);
  io.transfer(id, 'carbohydrateG', 'glucose', 'glucoseMassG', absorbedCarbohydrateG);
}
