/*
 * 胃（stomach）动力与排空脚本；部位 `stomach` 的唯一写者。
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
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'stomach';
export const actionTypes = ['drink', 'eat'];

type MealKind = 'liquid' | 'solid' | 'mixed';

type Meal = {
  remainingMl: number;
  remainingKcal: number;
  rateMlPerRound: number;
  rateKcalPerRound: number;
  remainingRounds: number;
  mealKind: MealKind;
};

type StomachState = {
  volumeMl: number;
  energyKcal: number;
  solidVolumeMl: number;
  solidEnergyKcal: number;
  emptiedMl: number;
  emptiedKcal: number;
  lastIntakeAt: number | null;
  mealQueue: Meal[];
};

export const initialState: StomachState = {
  volumeMl: 0,
  energyKcal: 0,
  solidVolumeMl: 0,
  solidEnergyKcal: 0,
  emptiedMl: 0,
  emptiedKcal: 0,
  lastIntakeAt: null,
  mealQueue: [],
};

export const fields = {
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

type IO = {
  read(id: 'stomach'): Readonly<StomachState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: StomachState): void;
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

type Intake = {
  volumeMl: number;
  energyKcal: number;
  rounds: number;
  mealKind: MealKind;
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
    return { volumeMl: action.volumeMl, energyKcal, rounds, mealKind: 'liquid' };
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
  };
}

type Slice = { ml: number; kcal: number };

function takeSlice(meal: Meal): Slice {
  const lastRound = meal.remainingRounds <= 1;
  return {
    ml: lastRound ? meal.remainingMl : Math.min(meal.rateMlPerRound, meal.remainingMl),
    kcal: lastRound ? meal.remainingKcal : Math.min(meal.rateKcalPerRound, meal.remainingKcal),
  };
}

function advanceMeal(meal: Meal, slice: Slice): Meal | null {
  const remainingMl = meal.remainingMl - slice.ml;
  const remainingKcal = meal.remainingKcal - slice.kcal;
  const remainingRounds = meal.remainingRounds - 1;
  if (remainingRounds <= 0 || (remainingMl <= 0 && remainingKcal <= 0)) return null;
  return { ...meal, remainingMl, remainingKcal, remainingRounds };
}

function startIntake(intake: Intake): { slice: Slice; meal: Meal | null } {
  const slice = {
    ml: intake.volumeMl / intake.rounds,
    kcal: intake.energyKcal / intake.rounds,
  };
  if (intake.rounds <= 1) return { slice, meal: null };
  return {
    slice,
    meal: {
      remainingMl: intake.volumeMl - slice.ml,
      remainingKcal: intake.energyKcal - slice.kcal,
      rateMlPerRound: slice.ml,
      rateKcalPerRound: slice.kcal,
      remainingRounds: intake.rounds - 1,
      mealKind: intake.mealKind,
    },
  };
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = io.dt / 60;
  const volumeMl = Math.max(0, finiteOrZero(prev.volumeMl));
  const energyKcal = Math.max(0, finiteOrZero(prev.energyKcal));
  const solidVolumeMl = Math.min(volumeMl, Math.max(0, finiteOrZero(prev.solidVolumeMl)));
  const solidEnergyKcal = Math.min(energyKcal, Math.max(0, finiteOrZero(prev.solidEnergyKcal)));
  const nonSolidVolumeMl = volumeMl - solidVolumeMl;
  const nonSolidEnergyKcal = energyKcal - solidEnergyKcal;
  const nonSolidEnergyDensity = nonSolidVolumeMl > 0 ? nonSolidEnergyKcal / nonSolidVolumeMl : 0;
  const halfTimeThisRound = halfTimeMin + energyDensityGain * nonSolidEnergyDensity;
  const emptiedNonSolidMl = nonSolidVolumeMl > 0
    ? Math.max(0, nonSolidVolumeMl - baselineMl) * (1 - 2 ** (-dtMin / halfTimeThisRound))
    : 0;
  const emptiedNonSolidKcal = emptiedNonSolidMl * nonSolidEnergyDensity;

  const solidFraction = 1 - 2 ** (-dtMin / solidHalfTimeMin);
  const emptiedSolidMl = solidVolumeMl * solidFraction;
  const emptiedSolidKcal = solidEnergyKcal * solidFraction;

  const emptiedMl = emptiedNonSolidMl + emptiedSolidMl;
  const emptiedKcal = emptiedNonSolidKcal + emptiedSolidKcal;

  let nextNonSolidVolumeMl = Math.max(0, nonSolidVolumeMl - emptiedNonSolidMl);
  let nextNonSolidEnergyKcal = Math.max(0, nonSolidEnergyKcal - emptiedNonSolidKcal);
  let nextSolidVolumeMl = Math.max(0, solidVolumeMl - emptiedSolidMl);
  let nextSolidEnergyKcal = Math.max(0, solidEnergyKcal - emptiedSolidKcal);
  let lastIntakeAt = prev.lastIntakeAt ?? null;

  function deliver(slice: Slice, mealKind: MealKind): void {
    if (slice.ml <= 0 && slice.kcal <= 0) return;
    if (mealKind === 'solid') {
      nextSolidVolumeMl += slice.ml;
      nextSolidEnergyKcal += slice.kcal;
    } else {
      nextNonSolidVolumeMl += slice.ml;
      nextNonSolidEnergyKcal += slice.kcal;
    }
    lastIntakeAt = io.simulatedSeconds;
  }

  const mealQueue: Meal[] = [];
  for (const meal of prev.mealQueue.map((entry) => ({ ...entry }))) {
    const slice = takeSlice(meal);
    deliver(slice, meal.mealKind);
    const advanced = advanceMeal(meal, slice);
    if (advanced) mealQueue.push(advanced);
  }

  for (const action of io.actions) {
    const intake = parseIntake(action, io.dt);
    if (intake === null) continue;
    const started = startIntake(intake);
    deliver(started.slice, intake.mealKind);
    if (started.meal) mealQueue.push(started.meal);
  }

  io.write({
    volumeMl: Math.max(0, nextNonSolidVolumeMl + nextSolidVolumeMl),
    energyKcal: Math.max(0, nextNonSolidEnergyKcal + nextSolidEnergyKcal),
    solidVolumeMl: Math.max(0, nextSolidVolumeMl),
    solidEnergyKcal: Math.max(0, nextSolidEnergyKcal),
    emptiedMl: Math.max(0, emptiedMl),
    emptiedKcal: Math.max(0, emptiedKcal),
    lastIntakeAt,
    mealQueue,
  });
}
