/*
 * 头颈骨骼肌区域部位（`muscleHead`）；行为、公式与证据边界见 `region-core.ts`。
 * 区域份额为 0.05（初始糖原 15 g，运动糖原消耗速率按 0.05 缩放）。
 */
import { createMuscleRegion } from './region-core.ts';

export const { id, actionTypes, initialState, fields, heartbeat } =
  createMuscleRegion('muscleHead');
