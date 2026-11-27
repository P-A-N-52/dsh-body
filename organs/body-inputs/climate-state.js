// Compatibility defaults, not measurements or a weather service.
export const defaultClimate = Object.freeze({ airTemperatureC: 25, relativeHumidityPct: 50 });

export function legacyAirTemperature(parameters) {
  const skin = parameters?.['skin.sweat.ambientTemperatureC'];
  const thermo = parameters?.['thermoregulation.ambientTemperatureC'];
  const airTemperatureC = Number.isFinite(thermo) ? thermo
    : Number.isFinite(skin) ? skin : defaultClimate.airTemperatureC;
  const conflict = Number.isFinite(skin) && Number.isFinite(thermo) && skin !== thermo
    ? { skinAirTemperatureC: skin, thermoregulationAirTemperatureC: thermo, selectedAirTemperatureC: airTemperatureC }
    : null;
  return { airTemperatureC, conflict };
}
