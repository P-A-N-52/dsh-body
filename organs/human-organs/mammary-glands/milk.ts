/*
 * 乳腺泌乳与排乳双环路脚本（`mammaryGlands`，仅女性清单）。
 * 本部位唯一写者；动作 `express_milk` 与 `breastfeed`（均受 `nsfw` 门控）。
 *
 * 科学框架（对照 SRC-KENT-2006 / SRC-PRIME-2012 / SRC-PAGEWILSON-2007 / SRC-UVNASMOBERG-2020）：
 * 1. **非妊娠诱导状态机**：纯高 PRL（>=45 ng/mL）数天内跨越 `galactorrheaThreshold = 0.25` 出现
 *    微量溢乳（无吸吮刺激时 `inductionProgress` 封顶 0.35，不进入规整产奶）；必须叠加多日
 *    高频机械排空刺激方跨过 1.0 进入规整 `lactating`；同时支持 `profile.lactating = true` 稳态启动。
 * 2. **局部充盈度自抑制**：`DF = storedMilkMl / storageCapacityMl`，产奶速率受 `(1 - DF²)` 强自抑制，
 *    不再与单次血浆 PRL 线性放大；不排空时高充盈自动刹停产奶并形成显著胀痛 `fullnessMm`。
 * 3. **催产素排乳反射（Let-down）与单次水账**：水与乳糖在合成入乳腺时（`milkMl` / `lactoseG`）已
 *    从 `bodyFluid` / `glucose` 转入 `storedMilkMl`；执行 `express_milk` / `breastfeed` 时待
 *    `pituitary.oxytocinPgMl >= 4 pg/mL` 按 `PAMR`（伴过胀惩罚）从 `storedMilkMl` 向外排出 `ejectedMilkMl`，
 *    绝不重复向 `bodyFluid` 扣水。
 */
import {
  getNsfwSetting,
  getProfileLactating,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'mammaryGlands';
export const actionTypes = ['express_milk', 'breastfeed'];

type MammaryGlandsState = {
  lactating: boolean;
  galactorrhea: boolean;
  inductionProgress: number;
  storedMilkMl: number;
  ejectedMilkMl: number;
  stimulationMin: number;
  milkRequestMl: number;
  milkMl: number;
  lactoseRequestG: number;
  lactoseG: number;
  fullnessMm: number;
};

type SavedMammaryGlandsState = Partial<{
  readonly lactating: unknown;
  readonly galactorrhea: unknown;
  readonly inductionProgress: unknown;
  readonly storedMilkMl: unknown;
  readonly ejectedMilkMl: unknown;
  readonly stimulationMin: unknown;
  readonly milkRequestMl: unknown;
  readonly milkMl: unknown;
  readonly lactoseRequestG: unknown;
  readonly lactoseG: unknown;
  readonly fullnessMm: unknown;
}>;

type PituitaryReading = {
  prolactinNgMl?: unknown;
  oxytocinPgMl?: unknown;
};

type Action = {
  readonly type?: unknown;
  readonly durationMin?: unknown;
  readonly bilateral?: unknown;
};

type IO = {
  read(id: 'mammaryGlands'): Readonly<SavedMammaryGlandsState> | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | undefined;
  read(id: 'ovaries'): Readonly<{ progesteroneNmolL?: unknown }> | undefined;
  readonly actions?: readonly Action[];
  readonly dt: number;
  write(next: MammaryGlandsState): void;
};

const parameters = loadParameters(new URL('./milk.parameters.json', import.meta.url));
const basalMilkRateMlPerMin = requireParameter(parameters, 'mammaryGlands.basalMilkRateMlPerMin');
const storageCapacityMl = scaleByBodyWeight(
  requireParameter(parameters, 'mammaryGlands.storageCapacityMl'),
  'mammaryGlands.storageCapacityMl',
);
const lactoseGPerMl = requireParameter(parameters, 'mammaryGlands.lactoseGPerMl');
const galactorrheaRateMlPerMin = requireParameter(parameters, 'mammaryGlands.galactorrheaRateMlPerMin');
const inductionPrlThresholdNgMl = requireParameter(parameters, 'mammaryGlands.inductionPrlThresholdNgMl');
const galactorrheaThreshold = requireParameter(parameters, 'mammaryGlands.galactorrheaThreshold');
const hormonalInductionPerDay = requireParameter(parameters, 'mammaryGlands.hormonalInductionPerDay');
const stimulatedInductionPerDay = requireParameter(parameters, 'mammaryGlands.stimulatedInductionPerDay');
const involutionHalfTimeDays = requireParameter(parameters, 'mammaryGlands.involutionHalfTimeDays');
const breastfeedPamr = requireParameter(parameters, 'mammaryGlands.breastfeedPamr');
const expressPamr = requireParameter(parameters, 'mammaryGlands.expressPamr');
const engorgementPamrPenaltyPer100Ml = requireParameter(
  parameters,
  'mammaryGlands.engorgementPamrPenaltyPer100Ml',
);
const letdownOxytocinThresholdPgMl = requireParameter(
  parameters,
  'mammaryGlands.letdownOxytocinThresholdPgMl',
);
const fullnessHalfTimeMin = requireParameter(parameters, 'mammaryGlands.fullnessHalfTimeMin');

const FALLBACK_PROLACTIN_NG_ML = 25;
const FALLBACK_OXYTOCIN_PG_ML = 10;
const DEFAULT_SESSION_MIN = 12;

const presetLactating = getNsfwSetting() !== false && getProfileLactating();

export const initialState: MammaryGlandsState = {
  lactating: presetLactating,
  galactorrhea: false,
  inductionProgress: presetLactating ? 1 : 0,
  storedMilkMl: presetLactating ? 120 : 0,
  ejectedMilkMl: 0,
  stimulationMin: 0,
  milkRequestMl: 0,
  milkMl: 0,
  lactoseRequestG: 0,
  lactoseG: 0,
  fullnessMm: presetLactating ? 28 : 0,
};

export const fields = {
  lactating: { unit: '1', mode: 'absolute' },
  galactorrhea: { unit: '1', mode: 'absolute' },
  inductionProgress: { unit: '1', mode: 'absolute' },
  storedMilkMl: { unit: 'mL', mode: 'absolute' },
  ejectedMilkMl: { unit: 'mL', mode: 'absolute' },
  stimulationMin: { unit: 'min', mode: 'absolute' },
  milkRequestMl: { unit: 'mL', mode: 'absolute' },
  milkMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['bodyFluid.waterVolumeMl'],
  },
  lactoseRequestG: { unit: 'g', mode: 'absolute' },
  lactoseG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['glucose.glucoseMassG'],
  },
  fullnessMm: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readPituitary(io: IO): { prolactinNgMl: number; oxytocinPgMl: number; present: boolean } {
  const pituitary = io.read('pituitary');
  if (pituitary === undefined) {
    return {
      prolactinNgMl: FALLBACK_PROLACTIN_NG_ML,
      oxytocinPgMl: FALLBACK_OXYTOCIN_PG_ML,
      present: false,
    };
  }
  if (pituitary === null || typeof pituitary !== 'object') {
    throw new Error('mammaryGlands: invalid pituitary reading');
  }
  const prl = pituitary.prolactinNgMl;
  if (typeof prl !== 'number' || !Number.isFinite(prl) || prl < 0) {
    throw new Error(`mammaryGlands: invalid pituitary.prolactinNgMl: ${String(prl)}`);
  }
  const ot = pituitary.oxytocinPgMl === undefined ? FALLBACK_OXYTOCIN_PG_ML : pituitary.oxytocinPgMl;
  if (typeof ot !== 'number' || !Number.isFinite(ot) || ot < 0) {
    throw new Error(`mammaryGlands: invalid pituitary.oxytocinPgMl: ${String(ot)}`);
  }
  return { prolactinNgMl: prl, oxytocinPgMl: ot, present: true };
}

export function heartbeat(io: IO): void {
  const pituitary = readPituitary(io);
  const prev = io.read(id) ?? initialState;
  const dtMin = Math.max(0, finiteOr(io.dt, 60) / 60);
  const dtDays = dtMin / 1440;
  const nsfwEnabled = getNsfwSetting() !== false;

  const prevFullnessMm = clamp(finiteOr(prev.fullnessMm, 0), 0, 100);
  const decayFullness = 2 ** (-dtMin / fullnessHalfTimeMin);

  if (!nsfwEnabled) {
    io.write({
      lactating: false,
      galactorrhea: false,
      inductionProgress: 0,
      storedMilkMl: 0,
      ejectedMilkMl: 0,
      stimulationMin: 0,
      milkRequestMl: 0,
      milkMl: 0,
      lactoseRequestG: 0,
      lactoseG: 0,
      fullnessMm: clamp(prevFullnessMm * decayFullness, 0, 100),
    });
    return;
  }

  // 1. 结转上一轮转入的合成水账到储奶池（不重复扣体液）
  const arrivedMilkMl = Math.max(0, finiteOr(prev.milkMl, 0));
  const poolBeforeEjection = Math.min(
    storageCapacityMl * 1.25,
    Math.max(0, finiteOr(prev.storedMilkMl, 0)) + arrivedMilkMl,
  );

  // 2. 解析本轮排乳动作（express_milk / breastfeed）
  let stimulationMin = Math.max(0, finiteOr(prev.stimulationMin, 0) - dtMin);
  let pamrMode: 'express' | 'express_unilateral' | 'breastfeed' = 'breastfeed';
  for (const action of io.actions ?? []) {
    if (action?.type !== 'express_milk' && action?.type !== 'breastfeed') continue;
    const dur = typeof action.durationMin === 'number'
      && Number.isFinite(action.durationMin)
      && action.durationMin > 0
      ? clamp(action.durationMin, 0.5, 120)
      : DEFAULT_SESSION_MIN;
    stimulationMin = dur;
    pamrMode = action.type === 'express_milk'
      ? (action.bilateral === false ? 'express_unilateral' : 'express')
      : 'breastfeed';
  }

  const basePamr = pamrMode === 'express'
    ? expressPamr
    : pamrMode === 'express_unilateral'
      ? 0.66
      : breastfeedPamr;

  // 3. 催产素排乳反射（Let-down）
  const letdownReady = !pituitary.present || pituitary.oxytocinPgMl >= letdownOxytocinThresholdPgMl;
  let ejectedMilkMl = 0;
  let storedMilkMl = poolBeforeEjection;
  if (stimulationMin > 0 && letdownReady && poolBeforeEjection > 0 && dtMin > 0) {
    const engorgementPenalty = engorgementPamrPenaltyPer100Ml
      * (Math.max(0, poolBeforeEjection - 200) / 100);
    const effectivePamr = clamp(basePamr - engorgementPenalty, 0.25, 0.85);
    const fraction = dtMin >= 10
      ? effectivePamr
      : 1 - Math.exp(-0.22 * effectivePamr * dtMin);
    ejectedMilkMl = Math.min(poolBeforeEjection, poolBeforeEjection * fraction);
    storedMilkMl = Math.max(0, poolBeforeEjection - ejectedMilkMl);
  }

  // 4. 非妊娠高催乳素 + 刺激诱导状态机
  const prevLactating = prev.lactating === true;
  // 若旧档或测试仅种子化了 `lactating: true` 而未指定进度，基线视为已建立稳态（1.0）。
  let inductionProgress = prevLactating && finiteOr(prev.inductionProgress, 0) < 0.5
    ? 1
    : clamp(finiteOr(prev.inductionProgress, 0), 0, 1);

  const progesteroneNmolL = Math.max(0, finiteOr(io.read('ovaries')?.progesteroneNmolL, 1.5));
  const p4Brake = progesteroneNmolL > 15 ? 0.3 : 1;
  const highPrl = pituitary.prolactinNgMl >= inductionPrlThresholdNgMl;
  const dfBeforeSync = clamp(storedMilkMl / Math.max(1, storageCapacityMl), 0, 1);

  if (dtDays > 0) {
    if (!prevLactating) {
      if (highPrl || stimulationMin > 0) {
        const hormoneDelta = highPrl
          ? hormonalInductionPerDay
            * clamp(pituitary.prolactinNgMl / 120, 0.5, 1.8)
            * p4Brake
            * dtDays
          : 0;
        const stimDelta = stimulationMin > 0
          ? stimulatedInductionPerDay * 4 * (highPrl ? 1 : 0.45) * p4Brake * dtDays
          : 0;
        const nextProgress = inductionProgress + hormoneDelta + stimDelta;
        // 无吸吮刺激时只允许到达溢乳平台（0.35），不可越过 1.0 进入规整泌乳（SRC-PAGEWILSON-2007）。
        inductionProgress = stimulationMin > 0
          ? clamp(nextProgress, 0, 1)
          : clamp(nextProgress, 0, Math.max(inductionProgress, 0.35));
      } else {
        inductionProgress = clamp(
          inductionProgress * 2 ** (-dtDays / involutionHalfTimeDays),
          0,
          1,
        );
      }
    } else if (dfBeforeSync >= 0.95 && stimulationMin <= 0 && !highPrl) {
      inductionProgress = clamp(
        inductionProgress * 2 ** (-dtDays / involutionHalfTimeDays),
        0,
        1,
      );
    }
  }

  const lactating = prevLactating ? inductionProgress >= 0.5 : inductionProgress >= 1;
  const galactorrhea = !lactating && inductionProgress >= galactorrheaThreshold;

  // 5. 乳腺局部充盈度 DF 自抑制产奶请求（仅由 bodyFluid/glucose 合成入池，不双扣）
  const df = clamp(storedMilkMl / Math.max(1, storageCapacityMl), 0, 1);
  let milkRequestMl = 0;
  if (lactating) {
    const prlPermissive = clamp(pituitary.prolactinNgMl / 25, 0.3, 1.4);
    const localInhibition = Math.max(0, 1 - df * df);
    milkRequestMl = basalMilkRateMlPerMin * prlPermissive * localInhibition * dtMin;
  } else if (galactorrhea && df < 0.05) {
    milkRequestMl = galactorrheaRateMlPerMin * dtMin;
  }
  const lactoseRequestG = milkRequestMl * lactoseGPerMl;

  const targetFullnessMm = lactating || galactorrhea
    ? clamp(100 * (df ** 1.15), 0, 100)
    : 0;
  const fullnessMm = dtMin <= 0
    ? prevFullnessMm
    : clamp(
      targetFullnessMm + (prevFullnessMm - targetFullnessMm) * decayFullness,
      0,
      100,
    );

  io.write({
    lactating,
    galactorrhea,
    inductionProgress,
    storedMilkMl,
    ejectedMilkMl,
    stimulationMin,
    milkRequestMl,
    milkMl: 0,
    lactoseRequestG,
    lactoseG: 0,
    fullnessMm,
  });
}
