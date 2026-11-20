import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'stomachSensory';
export const actionTypes = [];

type SensoryState = {
  mechanical: number;
};

type StomachState = {
  volumeMl: number;
};

type IO = {
  read(id: 'stomach'): Readonly<StomachState> | undefined;
  write(next: SensoryState): void;
};

const parameters = loadParameters(new URL('./gastric-sensory.parameters.json', import.meta.url));
const referenceVolumeMl = requireParameter(parameters, 'stomachSensory.referenceVolumeMl');
const exponent = requireParameter(parameters, 'stomachSensory.response.exponent');

export const initialState: SensoryState = {
  mechanical: 0,
};

export const fields = {
  mechanical: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: IO): void {
  const volumeMl = io.read('stomach')?.volumeMl;
  const volume = typeof volumeMl === 'number' && Number.isFinite(volumeMl) ? Math.max(0, volumeMl) : 0;
  const ratio = Math.min(1, volume / referenceVolumeMl);
  io.write({ mechanical: ratio ** exponent });
}
