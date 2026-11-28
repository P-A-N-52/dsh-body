/* 全身脂肪/去脂质量读数：design 二分记法；只使用 profile 输入，不引入参考人群参数或库存。 */
import { getBodyProfile, getProfileBodyFatPercent } from '../../../lib/parameters.js';

export const id = 'bodyComposition';
export const actionTypes = [];

const { weightKg } = getBodyProfile();
const bodyFatPercent = getProfileBodyFatPercent();
const fatMassKg = bodyFatPercent === null ? null : weightKg * (bodyFatPercent / 100);

export const initialState = Object.freeze({
  weightKg,
  bodyFatPercent,
  fatMassKg,
  fatFreeMassKg: fatMassKg === null ? null : weightKg - fatMassKg,
});
export const resetOnStart = Object.keys(initialState);

export const fields = {
  weightKg: { unit: 'kg', mode: 'absolute' },
  bodyFatPercent: { unit: '%', mode: 'absolute' },
  fatMassKg: { unit: 'kg', mode: 'absolute' },
  fatFreeMassKg: { unit: 'kg', mode: 'absolute' },
};

export function heartbeat(io: { write(next: typeof initialState): void }) {
  io.write(initialState);
}
