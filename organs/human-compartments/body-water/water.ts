/*
 * 体液隔室（bodyFluid）正常入口；部位 `bodyFluid` 的唯一写者，固定“肾 → 肺 → 汗”三出口。
 * 方程、证据边界与水账都在共享核心 `water-core.ts`；同一清单不能同时加载 `water.ts` 与
 * `water.female.ts`。
 *
 * 本入口只读轮初 `kidney.urineProductionRequestMl`、`lungs.respiratoryWaterLossRequestMl` 与
 * `skin.sweatRequestMl`，按给定顺序从轮初 `waterVolumeMl` 支付，请求超出余量时钳到余量。
 * `waterVolumeMl` 的 `transferOut` 固定为膀胱、肺与皮肤三路；缺失任一目标部位的清单会在
 * `createFieldRegistry` 启动校验时报字段配对错误。三路请求都缺失、为负或非有限时按 0，与
 * 历史直接调用行为一致。
 *
 * 女性变体 `water.female.ts` 在本入口之后追加第四出口 `uterus.bleedingMl`；根清单不加载它。
 */
import { createBodyWater } from './water-core.ts';

export const id = 'bodyFluid';
export const actionTypes: string[] = [];

const bodyWater = createBodyWater([
  {
    requestPart: 'kidney',
    requestField: 'urineProductionRequestMl',
    toPart: 'bladder',
    toField: 'volumeMl',
  },
  {
    requestPart: 'lungs',
    requestField: 'respiratoryWaterLossRequestMl',
    toPart: 'lungs',
    toField: 'respiratoryWaterLossMl',
  },
  {
    requestPart: 'skin',
    requestField: 'sweatRequestMl',
    toPart: 'skin',
    toField: 'sweatVolumeMl',
  },
]);

export const initialState = bodyWater.initialState;
export const fields = bodyWater.fields;
export const heartbeat = bodyWater.heartbeat;
