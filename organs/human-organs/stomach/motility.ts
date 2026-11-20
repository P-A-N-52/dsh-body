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
  emptiedMl: number;
  emptiedKcal: number;
  lastIntakeAt: number | null;
  meal: Meal | null;
};

export const initialState: StomachState = {
  volumeMl: 0,
  energyKcal: 0,
  emptiedMl: 0,
  emptiedKcal: 0,
  lastIntakeAt: null,
  meal: null,
};

export const fields = {
  volumeMl: { unit: 'mL', mode: 'absolute' },
  energyKcal: { unit: 'kcal', mode: 'absolute' },
  emptiedMl: { unit: 'mL', mode: 'absolute' },
  emptiedKcal: { unit: 'kcal', mode: 'absolute' },
  lastIntakeAt: { unit: 's', mode: 'absolute' },
  meal: { unit: '1', mode: 'absolute' },
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
    return { volumeMl: action.volumeMl, energyKcal: 0, rounds, mealKind: 'liquid' };
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

function mergeMeals(left: Meal, right: Meal): Meal {
  return {
    remainingMl: left.remainingMl + right.remainingMl,
    remainingKcal: left.remainingKcal + right.remainingKcal,
    rateMlPerRound: left.rateMlPerRound + right.rateMlPerRound,
    rateKcalPerRound: left.rateKcalPerRound + right.rateKcalPerRound,
    remainingRounds: Math.max(left.remainingRounds, right.remainingRounds),
    mealKind: left.mealKind === right.mealKind ? left.mealKind : 'mixed',
  };
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
  const energyDensity = volumeMl > 0 ? energyKcal / volumeMl : 0;
  const halfTimeThisRound = halfTimeMin + energyDensityGain * energyDensity;
  const emptiedMl = volumeMl > 0
    ? Math.max(0, volumeMl - baselineMl) * (1 - 2 ** (-dtMin / halfTimeThisRound))
    : 0;
  const emptiedKcal = emptiedMl * energyDensity;

  let nextVolumeMl = Math.max(0, volumeMl - emptiedMl);
  let nextEnergyKcal = Math.max(0, energyKcal - emptiedKcal);
  let lastIntakeAt = prev.lastIntakeAt ?? null;
  let meal = prev.meal ?? null;

  if (meal) {
    const slice = takeSlice(meal);
    if (slice.ml > 0 || slice.kcal > 0) {
      nextVolumeMl += slice.ml;
      nextEnergyKcal += slice.kcal;
      lastIntakeAt = io.simulatedSeconds;
    }
    meal = advanceMeal(meal, slice);
  }

  let queued: Meal | null = null;
  for (const action of io.actions) {
    const intake = parseIntake(action, io.dt);
    if (intake === null) continue;
    const started = startIntake(intake);
    if (started.slice.ml > 0 || started.slice.kcal > 0) {
      nextVolumeMl += started.slice.ml;
      nextEnergyKcal += started.slice.kcal;
      lastIntakeAt = io.simulatedSeconds;
    }
    if (started.meal) queued = queued === null ? started.meal : mergeMeals(queued, started.meal);
  }
  if (queued) meal = meal === null ? queued : mergeMeals(meal, queued);

  io.write({
    volumeMl: Math.max(0, nextVolumeMl),
    energyKcal: Math.max(0, nextEnergyKcal),
    emptiedMl: Math.max(0, emptiedMl),
    emptiedKcal: Math.max(0, emptiedKcal),
    lastIntakeAt,
    meal,
  });
}
