// 胰外分泌有效脂肪酶信号（design）。不写胰岛素，不把活性代理当 U/mL 实测值或营养质量。
import { loadParameters } from '../../../lib/parameters.js';
import { nonNegative, parameter, saturate, type LipidIO } from '../../human-compartments/lipid-circulation/kinetics.ts';

export const id = 'pancreasExocrine';
const params = loadParameters(new URL('./exocrine.parameters.json', import.meta.url));
const maxActivity = parameter(params, 'pancreasExocrine.maxLipaseActivityU');
const loadHalf = parameter(params, 'pancreasExocrine.mealHalfG', { positive: true });

export const initialState = { lipaseActivityU: 0, activityAtSimSeconds: null as number | null };
export const fields = {
  lipaseActivityU: { unit: 'LAU', mode: 'absolute' },
  activityAtSimSeconds: { unit: 's', mode: 'absolute' },
};

export function heartbeat(io: LipidIO<typeof initialState>): void {
  const load = nonNegative(io.read('intestinalLipid')?.lumenTgG ?? 0, 'intestinalLipid.lumenTgG');
  io.write({ lipaseActivityU: maxActivity * saturate(load, loadHalf), activityAtSimSeconds: io.simulatedSeconds });
}
