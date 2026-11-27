// 肝源胆汁功能量。产率、有效单位与一轮交付均为 design，不是实测胆盐合成或胆汁体积。
import { loadParameters } from '../../../lib/parameters.js';
import { parameter, type LipidIO } from '../../human-compartments/lipid-circulation/kinetics.ts';

export const id = 'liverBile';
const params = loadParameters(new URL('./bile.parameters.json', import.meta.url));
const supplyRate = parameter(params, 'liverBile.supplyActivityUPerMin');

export const initialState = { supplyActivityU: 0, activityAtSimSeconds: null as number | null };
export const fields = {
  supplyActivityU: { unit: 'BAU', mode: 'absolute' },
  activityAtSimSeconds: { unit: 's', mode: 'absolute' },
};

export function heartbeat(io: LipidIO<typeof initialState>): void {
  io.write({ supplyActivityU: supplyRate * (io.dt / 60), activityAtSimSeconds: io.simulatedSeconds });
}
