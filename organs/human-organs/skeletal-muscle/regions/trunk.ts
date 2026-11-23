/*
 * 躯干骨骼肌区域部位（`muscleTrunk`）；行为、公式与证据边界见 `region-core.ts`。
 * 区域份额由聚合器 `muscleGlucose` 按 0.45 分配；本部位只持有自己的糖原。
 */
import { createMuscleRegion } from './region-core.ts';

export const { id, actionTypes, initialState, fields, heartbeat } =
  createMuscleRegion('muscleTrunk');
