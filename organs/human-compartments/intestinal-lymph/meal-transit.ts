// 仅肠源乳糜微粒 TG 当量在途池（design），不计算淋巴水流、淋巴结或免疫。
import { loadParameters } from '../../../lib/parameters.js';
import { nonNegative, outflow, parameter, type LipidIO } from '../lipid-circulation/kinetics.ts';

export const id = 'intestinalLymph';
const params = loadParameters(new URL('./meal-transit.parameters.json', import.meta.url));
const returnRate = parameter(params, 'intestinalLymph.returnPerMin', { max: 5 });

export const initialState = { tgInTransitG: 0, returnedTgG: 0 };
export const fields = {
  tgInTransitG: {
    unit: 'g', mode: 'absolute',
    transferIn: ['intestinalLipid.hydrolyzedG'], transferOut: ['lipidCirculation.mealTgG'],
  },
  returnedTgG: { unit: 'g', mode: 'absolute' },
};

export function heartbeat(io: LipidIO<typeof initialState>): void {
  const stock = nonNegative(io.read(id)?.tgInTransitG ?? 0, 'intestinalLymph.tgInTransitG');
  const returnedTgG = outflow(stock, returnRate, io.dt / 60);
  io.write({ tgInTransitG: stock, returnedTgG });
  if (returnedTgG > 0) io.transfer(id, 'tgInTransitG', 'lipidCirculation', 'mealTgG', returnedTgG);
}
