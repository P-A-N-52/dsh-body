/*
 * 体液隔室（bodyFluid）女性变体入口：正常入口 `water.ts` 的“肾 → 肺 → 汗”之后依次追加
 * 第四出口 `uterus.bleedingMl`（月经失水）与第五出口 `mammaryGlands.milkMl`（乳汁水）。
 * 只用于独立清单 `body-modules.female.json`，不进入根清单；同一清单不能同时加载
 * `water.ts` 与 `water.female.ts`。
 *
 * 方程、证据边界与基础水账在共享核心 `water-core.ts`；本入口只多给两条出口：
 *   U_uterus  = clamp(uterus.bleedingRequestMl, 0, max(0, W_start - U_kidney - U_lung - U_sweat))
 *   U_mammary = clamp(mammaryGlands.milkRequestMl, 0,
 *                     max(0, W_start - U_kidney - U_lung - U_sweat - U_uterus))
 * 出口顺序是 `policy`，不是人体失水优先级证据：月经失水排在汗之后，乳汁水排在最后
 * （水量小，且是乳腺脚本的请求）；请求超出余量时逐级钳到余量，不与前序出口重复支付。
 *
 * 配对：`uterus.bleedingMl` 与 `mammaryGlands.milkMl` 分别声明
 * `transferIn: ['bodyFluid.waterVolumeMl']`，本入口的 `waterVolumeMl.transferOut` 末两位
 * 依次声明 `uterus.bleedingMl`、`mammaryGlands.milkMl`；女性清单缺 `uterus` 或
 * `mammaryGlands` 时 `createFieldRegistry` 会报 `transferOut target "... is not declared"`。
 * 直接调用本模块时对应部位缺失或请求字段缺失、为负、非有限时按 0，前三出口仍与正常入口
 * 逐点一致。
 *
 * 水账：在正常入口的水账上再加“累计 `uterus.bleedingMl`”与“累计 `mammaryGlands.milkMl`”
 * 两项；只有实际转移量进入水账，`bleedingRequestMl` / `milkRequestMl` 不计入。月经量的
 * 证据边界归 `uterus`，乳汁水与乳糖的证据边界归 `mammaryGlands`；本入口只做水量结算，
 * 不新增来源，复用 `water.parameters.json`，不新增参数文件。
 *
 * 不能推出：经血不是纯水、乳汁也不是纯水；本变体只记水量，不建经血或乳汁成分、铁丢失、
 * 乳腺解剖或泌乳生理；各出口量是请求量而不是瞬时流率。
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
  {
    requestPart: 'mammaryGlands',
    requestField: 'milkRequestMl',
    toPart: 'mammaryGlands',
    toField: 'milkMl',
  },
]);

export const initialState = bodyWater.initialState;
export const fields = bodyWater.fields;
export const heartbeat = bodyWater.heartbeat;
