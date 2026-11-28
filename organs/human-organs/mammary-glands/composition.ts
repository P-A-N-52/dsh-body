/* 双侧乳房脂肪/纤维腺体体积读数：design 二分近似，见同目录 README 的定义与分母边界。 */
import { isPercent, loadParameters } from '../../../lib/parameters.js';

export const id = 'breastComposition';
export const actionTypes = [];

const volumeId = 'breastComposition.bilateralTissueVolumeMl';
const percentId = 'breastComposition.fibroglandularVolumePct';
const parameters = loadParameters(new URL('./composition.parameters.json', import.meta.url));
const bilateralTissueVolumeMl = parameters[volumeId];
const fibroglandularVolumePct = parameters[percentId];

if (bilateralTissueVolumeMl !== null && (!Number.isFinite(bilateralTissueVolumeMl) || bilateralTissueVolumeMl <= 0)) {
  throw new Error(`Parameter ${volumeId} must be null or a positive finite number`);
}
if (fibroglandularVolumePct !== null && !isPercent(fibroglandularVolumePct)) {
  throw new Error(`Parameter ${percentId} must be null or a number in [0, 100]`);
}

const fibroglandularVolumeMl = bilateralTissueVolumeMl === null || fibroglandularVolumePct === null
  ? null
  : bilateralTissueVolumeMl * (fibroglandularVolumePct / 100);

export const initialState = Object.freeze({
  bilateralTissueVolumeMl,
  fibroglandularVolumePct,
  fibroglandularVolumeMl,
  fatVolumeMl: fibroglandularVolumeMl === null ? null : bilateralTissueVolumeMl - fibroglandularVolumeMl,
});
export const resetOnStart = Object.keys(initialState);

export const fields = {
  bilateralTissueVolumeMl: { unit: 'mL', mode: 'absolute' },
  fibroglandularVolumePct: { unit: '%', mode: 'absolute' },
  fibroglandularVolumeMl: { unit: 'mL', mode: 'absolute' },
  fatVolumeMl: { unit: 'mL', mode: 'absolute' },
};

export function heartbeat(io: { write(next: typeof initialState): void }) {
  io.write(initialState);
}
