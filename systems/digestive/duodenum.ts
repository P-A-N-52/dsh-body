import { loadParameters, requireParameter } from '../lib/parameters.js';

export const id = 'duodenum';
export const actionTypes: string[] = [];

type DuodenumState = {
  nutrientExposure: number;
};

type StomachReading = {
  emptiedKcal?: number;
};

export const initialState: DuodenumState = {
  nutrientExposure: 0,
};

type IO = {
  read(id: 'duodenum'): Readonly<DuodenumState> | undefined;
  read(id: 'stomach'): Readonly<StomachReading> | undefined;
  readonly dt: number;
  write(next: DuodenumState): void;
};

const parameters = loadParameters(new URL('./duodenum.parameters.json', import.meta.url));
const timeConstantMin = requireParameter(parameters, 'duodenum.exposure.timeConstantMin');

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const stomach = io.read('stomach');
  const emptiedKcal = typeof stomach?.emptiedKcal === 'number'
    && Number.isFinite(stomach.emptiedKcal)
    && stomach.emptiedKcal > 0
    ? stomach.emptiedKcal
    : 0;
  const dtMin = io.dt / 60;
  const arrivalRate = emptiedKcal / dtMin;
  const exposure = Number.isFinite(prev.nutrientExposure) ? Math.max(0, prev.nutrientExposure) : 0;
  const next = exposure + (1 - Math.exp(-dtMin / timeConstantMin)) * (arrivalRate - exposure);

  io.write({ nutrientExposure: Math.max(0, next) });
}
