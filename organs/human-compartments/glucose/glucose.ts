/*
 * 葡萄糖表观分布隔室（glucose）正常入口；固定“肾 → 肝 → 肌”三汇，不声明乳腺乳糖汇。
 * 方程、证据边界与质量账在共享核心 `glucose-core.ts`；女性变体 `glucose.female.ts` 在末位
 * 追加 `mammaryGlands.lactoseG`，只用于独立清单 `body-modules.female.json`。同一清单不能
 * 同时加载 `glucose.ts` 与 `glucose.female.ts`。
 *
 * `glucoseMassG.transferOut` 只声明 `kidneyGlucose.excretedGlucoseG`、`liver.storageG` 与
 * `muscleGlucose.uptakeG`，因此任何包含本入口的清单都不需要 `mammaryGlands`；根清单只加载
 * 本入口。缺任一已声明出口目标的清单仍会在 `createFieldRegistry` 启动校验时报字段配对错误。
 * 轮初肾糖请求缺失（未加载 `kidneyGlucose`）按 0；`liver` 与 `muscleGlucose` 是必需汇，
 * 缺部位时 `heartbeat` 抛错。本入口复用 `glucose.parameters.json`，不新增参数文件。
 */
import { createGlucose } from './glucose-core.ts';

export const id = 'glucose';
export const actionTypes: string[] = [];

const glucose = createGlucose([
  {
    requestPart: 'kidneyGlucose',
    requestField: 'excretionRequestG',
    toPart: 'kidneyGlucose',
    toField: 'excretedGlucoseG',
    required: false,
  },
  {
    requestPart: 'liver',
    requestField: 'storageRequestG',
    toPart: 'liver',
    toField: 'storageG',
    required: true,
  },
  {
    requestPart: 'muscleGlucose',
    requestField: 'uptakeRequestG',
    toPart: 'muscleGlucose',
    toField: 'uptakeG',
    required: true,
  },
]);

export const initialState = glucose.initialState;
export const fields = glucose.fields;
export const heartbeat = glucose.heartbeat;
