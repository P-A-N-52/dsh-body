// 选配脂质入口：同一个 stomach、同一套证据与胃动力参数，只增加独立的长链 TG 当量账（design）。
import { actionTypes, fields as baseFields, heartbeat as advance, id, initialState as baseState } from './hydration.ts';
import { stomachLipidInitialState } from './motility-core.ts';

export { actionTypes, id };
export const initialState = { ...baseState, ...stomachLipidInitialState };
const fatStock = { unit: 'g', mode: 'absolute', transferOut: ['intestinalLipid.lumenTgG'] };
export const fields = {
  ...baseFields,
  solidFatG: fatStock,
  nonSolidFatG: fatStock,
  emptiedFatG: { unit: 'g', mode: 'absolute' },
  explicitFatIntakeG: { unit: 'g', mode: 'absolute' },
  estimatedFatIntakeG: { unit: 'g', mode: 'absolute' },
  unknownFatIntakeSlices: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: Parameters<typeof advance>[0]): void {
  advance(io, true);
}
