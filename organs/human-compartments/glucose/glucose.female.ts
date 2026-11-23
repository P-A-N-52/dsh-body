/*
 * 葡萄糖隔室（glucose）女性变体入口：正常入口 `glucose.ts` 的“肾 → 肝 → 肌”之后追加
 * 第四汇 `mammaryGlands.lactoseG`（乳汁乳糖，结算排在最后）。只用于独立清单
 * `body-modules.female.json`，不进入根清单；同一清单不能同时加载两个入口。
 *
 * 方程、证据边界与质量账在共享核心 `glucose-core.ts`；本入口只多一个汇：
 *   G_paid = min(max(0, mammaryGlands.lactoseRequestG), M_after − X − L_paid − U_paid)
 * 请求缺失（未加载 `mammaryGlands`）按 0；部位已加载但字段缺失、非有限或为负时抛错使本轮
 * 失败，不写状态、不发起 transfer。`glucoseMassG.transferOut` 末位声明
 * `mammaryGlands.lactoseG`；女性清单缺 `mammaryGlands` 时启动报
 * `transferOut target "mammaryGlands.lactoseG" is not declared`。乳糖的证据边界归
 * `mammaryGlands`；本入口复用 `glucose.parameters.json`，不新增参数文件。
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
  {
    requestPart: 'mammaryGlands',
    requestField: 'lactoseRequestG',
    toPart: 'mammaryGlands',
    toField: 'lactoseG',
    required: false,
  },
]);

export const initialState = glucose.initialState;
export const fields = glucose.fields;
export const heartbeat = glucose.heartbeat;
