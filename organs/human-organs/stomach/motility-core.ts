/*
 * 胃（stomach）动力与排空核心；旧独立入口 `motility.ts` 与水链入口 `hydration.ts` 共用。
 * 每轮先按当前内容量排空，再让本轮摄入切片进入胃；多轮摄入的余量放在 `mealQueue` 跨轮释放。
 *
 * 来源（Mudie/Tougas/Camps 只读摘要，Vasavid 读了全文；登记见 organs/human-organs/references/source-index.csv）：
 * - SRC-MUDIE-2014 / mudie-2014：笔记 organs/human-organs/stomach/references/notes/mudie-2014.md，
 *   摘要 Results（PMID 25115349）。空腹一次 240 mL 白水的 T50 为 13 min（n=12，mean ± 1，± 类型未
 *   逐项标注）。支撑 stomach.emptying.halfTimeMin = 13 min（design），作为白水排空的工程截距。
 *   边界：摘要未定义 T50 的起算点与相对基线；只适用于空腹 240 mL 白水，不是固餐或含能液餐，
 *   不能当作餐型半衰期；胃水体积也不是胃总内容量的直接测量。
 * - SRC-CAMPS-2016 / camps-2016：笔记 organs/human-organs/stomach/references/notes/camps-2016.md，
 *   摘要 Results（PMID 27281305）。支撑 stomach.emptying.energyDensityGainMinPerKcalPerMl = 53.75
 *   （fitted_dev）：同一批 15 名男性、500 mL 奶昔的 thin-100 与 thin-500 两臂 t50 为 26.5 / 69.5 min，
 *   (69.5-26.5)/(1.0-0.2) = 53.75 min/(kcal/mL)；截距固定为白水 13 min 后，两臂预测 23.75 / 66.75，
 *   观测 26.5 / 69.5。边界：只用了这两臂，黏度与其他餐型未建模，不是独立验证；t50 的定义与 ± 类型
 *   摘要未注明。
 * - SRC-TOUGAS-2000 / tougas-2000：笔记 organs/human-organs/stomach/references/notes/tougas-2000.md，
 *   摘要 Results（PMID 10894578）。低脂标记餐 60/120/240 min 的胃内残留中位数 69/24/1.2%，只作固餐
 *   的组级参照，当前方程未使用。残留百分比是初始标记量的比例，不是胃总内容量 mL，不能换算出 t50
 *   （摘要也没给 T50 数值）。
 * - SRC-VASAVID-2014 / vasavid-2014：笔记 organs/human-organs/stomach/references/notes/vasavid-2014.md，
 *   Results 描述统计表 All volunteers 列（PMID 24948129）。健康成人在 10 min 内吃完 100 g 米饭、
 *   标记鸡蛋与 100 mL 水（全餐 267 kcal）后，标记固相半排空时间中位数 68.7 min（第 5–95 百分位
 *   45.1–107.8），滞后时间中位数 18.6 min。支撑 stomach.emptying.solidHalfTimeMin = 68.7 min
 *   （design），只作已入胃固餐小计的简化时间尺度。边界：原文是标记固相保留曲线的拟合值，不是胃内
 *   mL 或 kcal 的半时，不能把残留百分比换算成体积/能量，也不能推出任何固餐必定比任何液餐慢；
 *   本轮不复现早期滞后与完整曲线。
 *
 * 工程假设（design）：一阶指数排空的离散形式 emptiedMl = max(0, V − baselineMl)(1 − 2^(−dt/h))、
 * 半时随能量密度线性增加 h = halfTimeMin + gain × energyDensity、`mealQueue` 的轮切片，都不是
 * 论文原方程。baselineMl = 0 是设计选择（不设不可排空残余），不是 Mudie 的空腹胃水 35 mL。
 *
 * 固／液分组（design）：轮初总量拆成“固餐小计”（solidVolumeMl / solidEnergyKcal）和“其余内容物”
 * 两组，各自按自己的半时独立排空，再汇总回同一部位的 volumeMl / energyKcal / emptiedMl / emptiedKcal；
 * 两组互不改变对方的速率。其余内容物 = 总量 − 固餐小计，沿用上面的含能液体方程与 baselineMl。
 * 固餐小计用固定半时 emptiedSolidMl = solidVolumeMl × (1 − 2^(−dt/solidHalfTimeMin))，体积和能量
 * 同比例扣减，不设残余偏置。只有 `eat` 且 mealKind = 'solid' 进入固餐小计；`drink`、`liquid`、
 * `mixed` 都进入其余内容物。`mealQueue` 只保存待释放量，每个切片保留自己的 mealKind，释放时按
 * 同一规则入账。旧存档没有两个小计时按 0 读取，既有存量全部走其余内容物，不猜历史餐型。
 * 这些分组方程、把 Vasavid 的固相半排空时间直接当作一阶时间常数、以及能量与体积同比例扣减，
 * 都是工程简化；混合餐的固液组成、研磨与显式滞后不建模。
 *
 * P1 输入契约：`drink` 表示液体摄入，`mealKind` 固定为 `liquid`；`energyKcal` 可选，缺省 0，提供时
 * 必须是有限数且 >= 0，否则整条动作忽略。含能饮料按 `volumeMl` / `energyKcal` 记账，不再被当成
 * 0 kcal；其能量密度仍走 Camps 2016 的含能液体证据（thin-100 / thin-500 奶昔）。饮料成分、黏度、
 * 碳酸、甜味剂不建模；Mudie 的白水 T50 仍只作白水截距，不能外推到含能饮料。
 *
 * 水子集（design，见 docs/superpowers/specs/2026-11-22-water-balance-design.md §3.1）：`trackWater`
 * 开启时，核心只负责给新队列切片写水余量 `remainingWaterMl` / 每轮水切片 `rateWaterMl`、统计本轮
 * 入胃水量 D，并把非固餐排出量 E_nonSolid 交给调用方；水量的钳位、emptiedWaterMl 与 transfer 由
 * `hydration.ts` 完成。`drink` 的全部 volumeMl 记为水；`eat`（含 liquid / mixed）不反推水。这是
 * 把饮料总体积近似为可吸收水的工程设计，不是实测纯水含量。`trackWater: false` 时（旧
 * `motility.ts`）不写水元数据，输出状态形状与历史一致；推进既有队列时还会剥离切片上残留的
 * `remainingWaterMl` / `rateWaterMl`，避免体积已释放而水余量仍停在旧值的陈旧读数。因此不支持
 * “水链清单 → legacy 清单 → 水链清单”借道保存待释放水：legacy 轮次会丢弃切片的水身份，再切回
 * 水链时队列水按 0 计，不猜历史。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export type MealKind = 'liquid' | 'solid' | 'mixed';

export type StomachMeal = {
  remainingMl: number;
  remainingKcal: number;
  rateMlPerRound: number;
  rateKcalPerRound: number;
  remainingRounds: number;
  mealKind: MealKind;
  remainingWaterMl?: number;
  rateWaterMl?: number;
};

export type StomachState = {
  volumeMl: number;
  energyKcal: number;
  solidVolumeMl: number;
  solidEnergyKcal: number;
  emptiedMl: number;
  emptiedKcal: number;
  lastIntakeAt: number | null;
  mealQueue: StomachMeal[];
};

export type StomachStateInput = {
  readonly volumeMl?: unknown;
  readonly energyKcal?: unknown;
  readonly solidVolumeMl?: unknown;
  readonly solidEnergyKcal?: unknown;
  readonly lastIntakeAt?: number | null;
  readonly waterVolumeMl?: unknown;
  readonly mealQueue: readonly StomachMeal[];
};

export type StomachAdvance = {
  state: StomachState;
  emptiedNonSolidMl: number;
  deliveredWaterMl: number;
};

export const stomachActionTypes = ['drink', 'eat'];

export const stomachInitialState: StomachState = {
  volumeMl: 0,
  energyKcal: 0,
  solidVolumeMl: 0,
  solidEnergyKcal: 0,
  emptiedMl: 0,
  emptiedKcal: 0,
  lastIntakeAt: null,
  mealQueue: [],
};

export const stomachFields = {
  volumeMl: { unit: 'mL', mode: 'absolute' },
  energyKcal: { unit: 'kcal', mode: 'absolute' },
  solidVolumeMl: { unit: 'mL', mode: 'absolute' },
  solidEnergyKcal: { unit: 'kcal', mode: 'absolute' },
  emptiedMl: { unit: 'mL', mode: 'absolute' },
  emptiedKcal: { unit: 'kcal', mode: 'absolute' },
  lastIntakeAt: { unit: 's', mode: 'absolute' },
  mealQueue: { unit: '1', mode: 'absolute' },
};

type Action = {
  readonly type?: unknown;
  readonly volumeMl?: unknown;
  readonly energyKcal?: unknown;
  readonly mealKind?: unknown;
  readonly durationMin?: unknown;
};

const parameters = loadParameters(new URL('./motility.parameters.json', import.meta.url));
const halfTimeMin = requireParameter(parameters, 'stomach.emptying.halfTimeMin');
const baselineMl = requireParameter(parameters, 'stomach.emptying.baselineMl');
const energyDensityGain = requireParameter(parameters, 'stomach.emptying.energyDensityGainMinPerKcalPerMl');
const solidHalfTimeMin = requireParameter(parameters, 'stomach.emptying.solidHalfTimeMin');

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isMealKind(value: unknown): value is MealKind {
  return value === 'liquid' || value === 'solid' || value === 'mixed';
}

// 轮初总量与固餐小计的统一钳位；`hydration.ts` 也用它取非固餐体积与水子集，避免两处各写一份。
export function readStomachBase(prev: StomachStateInput) {
  const volumeMl = Math.max(0, finiteOrZero(prev.volumeMl));
  const energyKcal = Math.max(0, finiteOrZero(prev.energyKcal));
  const solidVolumeMl = Math.min(volumeMl, Math.max(0, finiteOrZero(prev.solidVolumeMl)));
  const solidEnergyKcal = Math.min(energyKcal, Math.max(0, finiteOrZero(prev.solidEnergyKcal)));
  const nonSolidVolumeMl = volumeMl - solidVolumeMl;
  return {
    volumeMl,
    energyKcal,
    solidVolumeMl,
    solidEnergyKcal,
    nonSolidVolumeMl,
    nonSolidEnergyKcal: energyKcal - solidEnergyKcal,
    waterVolumeMl: Math.min(nonSolidVolumeMl, Math.max(0, finiteOrZero(prev.waterVolumeMl))),
  };
}

type Intake = {
  volumeMl: number;
  energyKcal: number;
  rounds: number;
  mealKind: MealKind;
  isDrink: boolean;
};

function parseIntake(action: Action, dt: number): Intake | null {
  if (action.type !== 'drink' && action.type !== 'eat') return null;
  if (typeof action.volumeMl !== 'number' || !Number.isFinite(action.volumeMl) || action.volumeMl <= 0) return null;

  let durationMin = 0;
  if (action.durationMin !== undefined) {
    if (typeof action.durationMin !== 'number' || !Number.isFinite(action.durationMin) || action.durationMin < 0) {
      return null;
    }
    durationMin = action.durationMin;
  }
  const rounds = durationMin > 0 ? Math.ceil((durationMin * 60) / dt) : 1;

  if (action.type === 'drink') {
    let energyKcal = 0;
    if (action.energyKcal !== undefined) {
      if (typeof action.energyKcal !== 'number' || !Number.isFinite(action.energyKcal) || action.energyKcal < 0) {
        return null;
      }
      energyKcal = action.energyKcal;
    }
    return { volumeMl: action.volumeMl, energyKcal, rounds, mealKind: 'liquid', isDrink: true };
  }
  if (typeof action.energyKcal !== 'number' || !Number.isFinite(action.energyKcal) || action.energyKcal < 0) {
    return null;
  }
  if (!isMealKind(action.mealKind)) return null;
  return {
    volumeMl: action.volumeMl,
    energyKcal: action.energyKcal,
    rounds,
    mealKind: action.mealKind,
    isDrink: false,
  };
}

type Slice = { ml: number; kcal: number; waterMl: number };

function takeSlice(meal: StomachMeal, trackWater: boolean): Slice {
  const lastRound = meal.remainingRounds <= 1;
  const remainingWaterMl = trackWater ? (meal.remainingWaterMl ?? 0) : 0;
  const rateWaterMl = trackWater ? (meal.rateWaterMl ?? 0) : 0;
  return {
    ml: lastRound ? meal.remainingMl : Math.min(meal.rateMlPerRound, meal.remainingMl),
    kcal: lastRound ? meal.remainingKcal : Math.min(meal.rateKcalPerRound, meal.remainingKcal),
    waterMl: lastRound ? remainingWaterMl : Math.min(rateWaterMl, remainingWaterMl),
  };
}

function advanceMeal(meal: StomachMeal, slice: Slice, trackWater: boolean): StomachMeal | null {
  const remainingMl = meal.remainingMl - slice.ml;
  const remainingKcal = meal.remainingKcal - slice.kcal;
  const remainingRounds = meal.remainingRounds - 1;
  if (remainingRounds <= 0 || (remainingMl <= 0 && remainingKcal <= 0)) return null;
  const advanced: StomachMeal = {
    remainingMl,
    remainingKcal,
    rateMlPerRound: meal.rateMlPerRound,
    rateKcalPerRound: meal.rateKcalPerRound,
    remainingRounds,
    mealKind: meal.mealKind,
  };
  if (trackWater) {
    advanced.remainingWaterMl = (meal.remainingWaterMl ?? 0) - slice.waterMl;
    advanced.rateWaterMl = meal.rateWaterMl ?? 0;
  }
  return advanced;
}

function startIntake(intake: Intake, trackWater: boolean): { slice: Slice; meal: StomachMeal | null } {
  const ml = intake.volumeMl / intake.rounds;
  const kcal = intake.energyKcal / intake.rounds;
  const slice = { ml, kcal, waterMl: trackWater && intake.isDrink ? ml : 0 };
  if (intake.rounds <= 1) return { slice, meal: null };
  const meal: StomachMeal = {
    remainingMl: intake.volumeMl - ml,
    remainingKcal: intake.energyKcal - kcal,
    rateMlPerRound: ml,
    rateKcalPerRound: kcal,
    remainingRounds: intake.rounds - 1,
    mealKind: intake.mealKind,
  };
  if (trackWater) {
    meal.remainingWaterMl = (intake.isDrink ? intake.volumeMl : 0) - slice.waterMl;
    meal.rateWaterMl = slice.waterMl;
  }
  return { slice, meal };
}

export function advanceStomach(
  prev: StomachStateInput,
  actions: readonly Action[],
  dt: number,
  simulatedSeconds: number,
  { trackWater = false }: { trackWater?: boolean } = {},
): StomachAdvance {
  const base = readStomachBase(prev);
  const dtMin = dt / 60;
  const nonSolidEnergyDensity = base.nonSolidVolumeMl > 0
    ? base.nonSolidEnergyKcal / base.nonSolidVolumeMl
    : 0;
  const halfTimeThisRound = halfTimeMin + energyDensityGain * nonSolidEnergyDensity;
  const emptiedNonSolidMl = base.nonSolidVolumeMl > 0
    ? Math.max(0, base.nonSolidVolumeMl - baselineMl) * (1 - 2 ** (-dtMin / halfTimeThisRound))
    : 0;
  const emptiedNonSolidKcal = emptiedNonSolidMl * nonSolidEnergyDensity;

  const solidFraction = 1 - 2 ** (-dtMin / solidHalfTimeMin);
  const emptiedSolidMl = base.solidVolumeMl * solidFraction;
  const emptiedSolidKcal = base.solidEnergyKcal * solidFraction;

  const emptiedMl = emptiedNonSolidMl + emptiedSolidMl;
  const emptiedKcal = emptiedNonSolidKcal + emptiedSolidKcal;

  let nextNonSolidVolumeMl = Math.max(0, base.nonSolidVolumeMl - emptiedNonSolidMl);
  let nextNonSolidEnergyKcal = Math.max(0, base.nonSolidEnergyKcal - emptiedNonSolidKcal);
  let nextSolidVolumeMl = Math.max(0, base.solidVolumeMl - emptiedSolidMl);
  let nextSolidEnergyKcal = Math.max(0, base.solidEnergyKcal - emptiedSolidKcal);
  let lastIntakeAt = prev.lastIntakeAt ?? null;
  let deliveredWaterMl = 0;

  function deliver(slice: Slice, mealKind: MealKind): void {
    if (slice.ml <= 0 && slice.kcal <= 0) return;
    if (mealKind === 'solid') {
      nextSolidVolumeMl += slice.ml;
      nextSolidEnergyKcal += slice.kcal;
    } else {
      nextNonSolidVolumeMl += slice.ml;
      nextNonSolidEnergyKcal += slice.kcal;
    }
    lastIntakeAt = simulatedSeconds;
    deliveredWaterMl += slice.waterMl;
  }

  const mealQueue: StomachMeal[] = [];
  for (const meal of prev.mealQueue.map((entry) => ({ ...entry }))) {
    const slice = takeSlice(meal, trackWater);
    deliver(slice, meal.mealKind);
    const advanced = advanceMeal(meal, slice, trackWater);
    if (advanced) mealQueue.push(advanced);
  }

  for (const action of actions) {
    const intake = parseIntake(action, dt);
    if (intake === null) continue;
    const started = startIntake(intake, trackWater);
    deliver(started.slice, intake.mealKind);
    if (started.meal) mealQueue.push(started.meal);
  }

  const state: StomachState = {
    volumeMl: Math.max(0, nextNonSolidVolumeMl + nextSolidVolumeMl),
    energyKcal: Math.max(0, nextNonSolidEnergyKcal + nextSolidEnergyKcal),
    solidVolumeMl: Math.max(0, nextSolidVolumeMl),
    solidEnergyKcal: Math.max(0, nextSolidEnergyKcal),
    emptiedMl: Math.max(0, emptiedMl),
    emptiedKcal: Math.max(0, emptiedKcal),
    lastIntakeAt,
    mealQueue,
  };
  return { state, emptiedNonSolidMl, deliveredWaterMl };
}
