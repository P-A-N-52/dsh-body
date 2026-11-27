// 循环餐源 TG 和由脂肪库释放的 NEFA 当量分账（design）。组织摄取/残粒离账不是已证实氧化。
import { loadParameters } from '../../../lib/parameters.js';
import { nonNegative, outflow, parameter, type LipidIO } from './kinetics.ts';

export const id = 'lipidCirculation';
const params = loadParameters(new URL('./meal-lipids.parameters.json', import.meta.url));
const tgClearance = parameter(params, 'lipidCirculation.mealTgClearancePerMin', { max: 5 });
const nefaClearance = parameter(params, 'lipidCirculation.nefaClearancePerMin', { max: 5 });

export const initialState = {
  mealTgG: 0,
  nefaEquivalentG: 0,
  storedThisRoundG: 0,
  mealTgUptakeG: 0,
  nefaUptakeG: 0,
  tissueUptakeTotalG: 0,
};
const mass = { unit: 'g', mode: 'absolute' };
export const fields = {
  mealTgG: { ...mass, transferIn: ['intestinalLymph.tgInTransitG'], transferOut: ['adipose.storedTgG'] },
  nefaEquivalentG: { ...mass, transferIn: ['adipose.storedTgG'] },
  storedThisRoundG: mass,
  mealTgUptakeG: mass,
  nefaUptakeG: mass,
  tissueUptakeTotalG: mass,
};

type IO = LipidIO<typeof initialState> & {
  call(partId: 'adipose', name: 'storageCapacityG'): unknown;
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const adipose = io.read('adipose');
  const mealTgG = nonNegative(prev.mealTgG, 'lipidCirculation.mealTgG');
  const nefaEquivalentG = nonNegative(prev.nefaEquivalentG, 'lipidCirculation.nefaEquivalentG');
  const storageFraction = nonNegative(adipose?.storageFraction, 'adipose.storageFraction');
  if (storageFraction > 1) throw new Error('adipose.storageFraction must be at most 1');
  const capacityG = nonNegative(io.call('adipose', 'storageCapacityG'), 'adipose.storageCapacityG');
  const room = Math.max(0, capacityG - nonNegative(adipose?.storedTgG, 'adipose.storedTgG'));
  const dtMin = io.dt / 60;
  const cleared = outflow(mealTgG, tgClearance, dtMin);
  const mealTgUptakeG = cleared * (1 - storageFraction);
  // 余下部分请求储存，容量拒付仍在循环。先扣其他出口，再 transfer 同一笔实付。
  const storedThisRoundG = Math.min(cleared - mealTgUptakeG, room);
  const nefaUptakeG = outflow(nefaEquivalentG, nefaClearance, dtMin);

  io.write({
    mealTgG: mealTgG - mealTgUptakeG,
    nefaEquivalentG: nefaEquivalentG - nefaUptakeG,
    storedThisRoundG,
    mealTgUptakeG,
    nefaUptakeG,
    tissueUptakeTotalG: nonNegative(prev.tissueUptakeTotalG, 'lipidCirculation.tissueUptakeTotalG') + mealTgUptakeG + nefaUptakeG,
  });
  if (storedThisRoundG > 0) io.transfer(id, 'mealTgG', 'adipose', 'storedTgG', storedThisRoundG);
}
