/*
 * 骨骼肌摄糖聚合器正常入口（部位 `muscleGlucose`）；机制、公式、证据与边界见
 * `glucose-uptake-core.ts`。本入口声明全部三个区域：`muscleHead` / `muscleTrunk` /
 * `muscleLimbs`，份额 0.05 / 0.45 / 0.50。
 *
 * 缺区域变体（例如独臂类角色没有 `muscleLimbs`）不能直接删本入口的区域脚本：本入口的
 * `transferOut` 固定声明三个目标，删目标会让配对校验拒绝启动。用法是复制清单、去掉缺失
 * 区域脚本，并把聚合器路径换成对应变体入口（如 `glucose-uptake.no-limbs.ts`）；变体只声明
 * 存在的区域，份额按剩余区域归一。同一清单不能同时加载两个聚合器入口（`id` 相同）。
 *
 * 旧档迁移：旧档只有 `muscleGlucose.glycogenG`（总量）时，各区域在自己的第一轮按存在区域
 * 归一后的份额迁移；默认种子状态（`uptakeG = 0`、`glycogenG = 300 g × 份额`、
 * `glycogenConsumedG = 0`）用迁移份额取代种子，已有真实存档状态则并入存量。本聚合器第一次
 * write 只保留 `uptakeG` / `uptakeRequestG`，不再保留旧总量。在途 `uptakeG` 不改写，重启后
 * 的第一轮按份额转给区域，区域下一轮入账。
 */
import { createMuscleGlucose, type MuscleRegionShare } from './glucose-uptake-core.ts';

const regionShares: readonly MuscleRegionShare[] = [
  { id: 'muscleHead', share: 0.05 },
  { id: 'muscleTrunk', share: 0.45 },
  { id: 'muscleLimbs', share: 0.5 },
];

export const { id, actionTypes, initialState, fields, heartbeat } =
  createMuscleGlucose(regionShares);
