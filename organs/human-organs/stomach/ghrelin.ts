import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'stomachGhrelin';
export const actionTypes = ['eat'];

type GhrelinState = {
  relativeConcentration: number;
};

type Action = {
  readonly type?: unknown;
  readonly energyKcal?: unknown;
};

type IO = {
  read(id: 'stomachGhrelin'): Readonly<GhrelinState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  write(next: GhrelinState): void;
};

const parameters = loadParameters(new URL('./ghrelin.parameters.json', import.meta.url));
const baseline = requireParameter(parameters, 'stomachGhrelin.fasting.baseline');
const nadir = requireParameter(parameters, 'stomachGhrelin.postmeal.nadir');
const halfTimeMin = requireParameter(parameters, 'stomachGhrelin.recovery.apparentHalfTimeMin');

export const initialState: GhrelinState = {
  relativeConcentration: baseline,
};

export const fields = {
  relativeConcentration: { unit: '1', mode: 'absolute' },
};

function hasEnergyIntake(actions: readonly Action[]): boolean {
  return actions.some((action) => action.type === 'eat'
    && typeof action.energyKcal === 'number'
    && Number.isFinite(action.energyKcal)
    && action.energyKcal > 0);
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const current = typeof prev.relativeConcentration === 'number' && Number.isFinite(prev.relativeConcentration)
    ? prev.relativeConcentration
    : baseline;
  const next = hasEnergyIntake(io.actions)
    ? Math.min(current, nadir)
    : current + (baseline - current) * (1 - 2 ** (-(io.dt / 60) / halfTimeMin));
  io.write({ relativeConcentration: Math.max(0, next) });
}
