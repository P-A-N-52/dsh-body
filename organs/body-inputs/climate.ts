import { defaultClimate } from './climate-state.js';

export const id = 'climate';
export const actionTypes = ['set_environment'];
export const initialState = defaultClimate;
export const fields = {
  airTemperatureC: { unit: '°C', mode: 'absolute' },
  relativeHumidityPct: { unit: '%', mode: 'absolute' },
};

type ClimateState = typeof defaultClimate;
type IO = {
  readonly actions: readonly Readonly<Record<string, unknown>>[];
  write(next: ClimateState): void;
};

export function heartbeat(io: IO): void {
  for (let index = io.actions.length - 1; index >= 0; index--) {
    const { type, airTemperatureC, relativeHumidityPct } = io.actions[index];
    if (type === 'set_environment'
      && typeof airTemperatureC === 'number' && Number.isFinite(airTemperatureC)
      && typeof relativeHumidityPct === 'number' && Number.isFinite(relativeHumidityPct)
      && relativeHumidityPct >= 0 && relativeHumidityPct <= 100) {
      io.write({ airTemperatureC, relativeHumidityPct });
      return;
    }
  }
}
