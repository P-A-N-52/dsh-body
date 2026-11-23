/*
 * 体液隔室（bodyFluid）女性变体入口：正常入口 `water.ts` 的“肾 → 肺 → 汗”之后追加第四出口
 * `uterus.bleedingMl`（月经失水）。只用于独立清单 `body-modules.female.json`，不进入根清单；
 * 同一清单不能同时加载 `water.ts` 与 `water.female.ts`。
 *
 * 方程、证据边界与基础水账在共享核心 `water-core.ts`；本入口只多给一条出口：
 *   U_uterus = clamp(uterus.bleedingRequestMl, 0, max(0, W_start - U_kidney - U_lung - U_sweat))
 * 出口顺序是 `policy`，不是人体失水优先级证据：月经失水只能用尿、肺失水与汗之后的轮初余量，
 * 请求超出余量时钳到余量，不与前三路重复支付。
 *
 * 配对：`uterus.bleedingMl` 声明 `transferIn: ['bodyFluid.waterVolumeMl']`，本入口的
 * `waterVolumeMl.transferOut` 末位声明 `uterus.bleedingMl`；女性清单缺 `uterus` 时
 * `createFieldRegistry` 会报 `transferOut target "uterus.bleedingMl" is not declared`。直接调用
 * 本模块时 `uterus` 缺失或请求字段缺失、为负、非有限时按 0，第三出口仍与正常入口逐点一致。
 *
 * 水账：在正常入口的水账上再加“累计 `uterus.bleedingMl`”一项；只有实际转移量进入水账，
 * `bleedingRequestMl` 不计入。月经量、经期与子宫内膜的证据边界归 `uterus` 模块，本入口只做
 * 水量结算，不新增来源，复用 `water.parameters.json`，不新增参数文件。
 *
 * 不能推出：经血不是纯水，本变体只记水量；不建经血成分、铁丢失、凝血、子宫内膜厚度、激素
 * 浓度、阴道/外阴解剖或大出血模型；`U_uterus` 是请求量而不是瞬时经血流率。
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
  {
    requestPart: 'uterus',
    requestField: 'bleedingRequestMl',
    toPart: 'uterus',
    toField: 'bleedingMl',
  },
]);

export const initialState = bodyWater.initialState;
export const fields = bodyWater.fields;
export const heartbeat = bodyWater.heartbeat;
