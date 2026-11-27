// 胆囊存储与胆道转送：以有效胆汁量作工程代理（design），不是胆汁 mL、盐质量或全肠肝循环。
import { loadParameters } from '../../../lib/parameters.js';
import { committedActivity, nonNegative, outflow, parameter, saturate, type LipidIO } from '../../human-compartments/lipid-circulation/kinetics.ts';

export const id = 'gallbladder';
const params = loadParameters(new URL('./bile-reserve.parameters.json', import.meta.url));
const capacity = parameter(params, 'gallbladder.capacityActivityU');
const directFraction = parameter(params, 'gallbladder.directFraction', { max: 1 });
const releaseRate = parameter(params, 'gallbladder.releaseMaxPerMin', { max: 5 });
const loadHalf = parameter(params, 'gallbladder.mealHalfG', { positive: true });

export const initialState = {
  stockActivityU: capacity,
  storedActivityU: 0,
  releasedActivityU: 0,
  ductDeliveredActivityU: 0,
  activityAtSimSeconds: null as number | null,
};
const activity = { unit: 'BAU', mode: 'absolute' };
export const fields = {
  stockActivityU: activity,
  storedActivityU: activity,
  releasedActivityU: activity,
  ductDeliveredActivityU: activity,
  activityAtSimSeconds: { unit: 's', mode: 'absolute' },
};

export function heartbeat(io: LipidIO<typeof initialState>): void {
  const stock = nonNegative(io.read(id)?.stockActivityU ?? capacity, 'gallbladder.stockActivityU');
  const input = committedActivity(io.read('liverBile'), 'supplyActivityU', io.simulatedSeconds - io.dt);
  const intestine = io.read('intestinalLipid');
  const load = intestine ? nonNegative(intestine.lumenTgG, 'intestinalLipid.lumenTgG')
    + nonNegative(intestine.hydrolyzedG, 'intestinalLipid.hydrolyzedG') : 0;
  const released = outflow(stock, releaseRate * saturate(load, loadHalf), io.dt / 60);
  const stored = Math.min(input * (1 - directFraction), Math.max(0, capacity - stock));

  io.write({
    stockActivityU: stock - released + stored,
    storedActivityU: stored,
    releasedActivityU: released,
    ductDeliveredActivityU: (input - stored) + released,
    activityAtSimSeconds: io.simulatedSeconds,
  });
}
