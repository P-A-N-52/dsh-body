/*
 * 四肢骨骼肌区域部位（`muscleLimbs`）；行为、公式与证据边界见 `region-core.ts`。
 * 区域份额为 0.50（初始糖原 150 g，运动糖原消耗速率按 0.50 缩放）。
 */
import { createMuscleRegion } from './region-core.ts';

export const { id, actionTypes, initialState, fields, heartbeat } =
  createMuscleRegion('muscleLimbs');
