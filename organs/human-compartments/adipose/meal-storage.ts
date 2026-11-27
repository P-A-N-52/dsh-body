// 有限的短程可动用脂肪库（design），不代表全身体脂。胰岛素参照只是工程静息点，不是人体阈值。
import { loadParameters } from '../../../lib/parameters.js';
import { nonNegative, outflow, parameter, saturate, type LipidIO } from '../lipid-circulation/kinetics.ts';

export const id = 'adipose';
const params = loadParameters(new URL('./meal-storage.parameters.json', import.meta.url));
const capacityG = parameter(params, 'adipose.capacityG');
const initialStoredTgG = parameter(params, 'adipose.initialStoredTgG', { max: capacityG });
const tau = parameter(params, 'adipose.insulinTimeConstantMin', { positive: true });
const halfEffect = parameter(params, 'adipose.insulinHalfEffectRelative', { positive: true });
const maxStorageFraction = parameter(params, 'adipose.maxStorageFraction', { max: 1 });
const maxMobilization = parameter(params, 'adipose.mobilizationMaxPerMin', { max: 5 });
const insulinReference = parameter(params, 'adipose.insulinReferencePmolL', { positive: true });

export const initialState = {
  storedTgG: initialStoredTgG,
  capacityG,
  insulinRelative: 1,
  storageFraction: maxStorageFraction * saturate(1, halfEffect),
  mobilizedG: 0,
};
export const fields = {
  storedTgG: { unit: 'g', mode: 'absolute', transferIn: ['lipidCirculation.mealTgG'], transferOut: ['lipidCirculation.nefaEquivalentG'] },
  capacityG: { unit: 'g', mode: 'absolute' },
  insulinRelative: { unit: '1', mode: 'absolute' },
  storageFraction: { unit: '1', mode: 'absolute' },
  mobilizedG: { unit: 'g', mode: 'absolute' },
};

export function heartbeat(io: LipidIO<typeof initialState>): void {
  const prev = io.read(id) ?? initialState;
  const storedTgG = nonNegative(prev.storedTgG, 'adipose.storedTgG');
  const oldRelative = nonNegative(prev.insulinRelative, 'adipose.insulinRelative');
  const endocrine = io.read('pancreasEndocrine');
  const target = endocrine ? nonNegative(endocrine.insulinPmolL, 'pancreasEndocrine.insulinPmolL') / insulinReference : 1;
  const dtMin = io.dt / 60;
  const effect = saturate(oldRelative, halfEffect);
  const mobilizedG = outflow(storedTgG, maxMobilization * (1 - effect), dtMin);
  const response = -Math.expm1(-dtMin / tau);
  const insulinRelative = oldRelative * (1 - response) + target * response;

  io.write({
    storedTgG,
    capacityG,
    insulinRelative,
    storageFraction: maxStorageFraction * saturate(insulinRelative, halfEffect),
    mobilizedG,
  });
  if (mobilizedG > 0) io.transfer(id, 'storedTgG', 'lipidCirculation', 'nefaEquivalentG', mobilizedG);
}
