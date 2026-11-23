/*
 * 骨骼肌摄糖聚合器缺四肢变体（部位 `muscleGlucose`）；用于没有 `muscleLimbs` 的独臂类
 * 清单。机制、公式、证据与边界见 `glucose-uptake-core.ts`。
 *
 * 本入口只声明 `muscleHead` / `muscleTrunk`，`transferOut` 不含 `muscleLimbs`，因此清单
 * 里删掉 `regions/limbs.ts` 也不会因未声明的目标拒绝启动。份额按剩余区域归一：
 *   head = 0.05 / (0.05 + 0.45) = 0.1
 *   trunk = 0.45 / (0.05 + 0.45) = 0.9
 * 这是 `design` / `policy`，只表示“现有区域重新归一”，不推断缺失肢体的肌肉质量。用法：
 * 复制根清单，去掉 `regions/limbs.ts`，把 `glucose-uptake.ts` 换成本文件；同一清单不能同时
 * 加载正常入口与本变体（`id` 相同）。
 */
import { createMuscleGlucose, type MuscleRegionShare } from './glucose-uptake-core.ts';

const regionShares: readonly MuscleRegionShare[] = [
  { id: 'muscleHead', share: 0.05 },
  { id: 'muscleTrunk', share: 0.45 },
];

export const { id, actionTypes, initialState, fields, heartbeat } =
  createMuscleGlucose(regionShares);
