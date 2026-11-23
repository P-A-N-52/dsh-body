/*
 * 体液隔室（bodyFluid）结算核心；正常入口 `water.ts`（肾 → 肺 → 汗三出口）与女性变体
 * `water.female.ts`（末位追加子宫月经血、乳腺乳汁两个出口）共用。部位 `bodyFluid` 的唯一
 * 结算逻辑在这里，两个入口只提供自己的出口列表与模块契约。
 *
 * 直接证据：无。`bodyFluid.referenceVolumeMl = 30000 mL` 与 `bodyFluid.deficitScaleMl = 500 mL`
 * 都是 `design`（同目录 `water.parameters.json`），不是实测总体水、血浆容量、体重比例或渗透压。
 * 设计依据是 `docs/superpowers/specs/2026-11-22-water-balance-design.md` §3.3；女性变体的第四、
 * 第五出口见 `docs/superpowers/specs/2026-11-23-reproductive-cycle-design.md` 与
 * `docs/superpowers/specs/2026-11-24-mammary-glands-design.md`。两个入口复用同一份参数文件，
 * 不新增参数。
 *
 * 工程假设（design）：
 * - `waterDeficit = clamp((referenceVolumeMl - W_start) / deficitScaleMl, -1, 1)`，
 *   其中 `W_start` 是本轮轮初的 `waterVolumeMl`；正值表示低于参考量，负值表示高于参考量。
 * - 出口按调用方给出的顺序分配轮初水（顺序是 `policy`，不是人体优先级证据）。正常入口为
 *   “肾 → 肺 → 汗”：
 *   `U_kidney = clamp(kidney.urineProductionRequestMl, 0, W_start)`；
 *   `U_lung = clamp(lungs.respiratoryWaterLossRequestMl, 0, max(0, W_start - U_kidney))`；
 *   `U_sweat = clamp(skin.sweatRequestMl, 0, max(0, W_start - U_kidney - U_lung))`。
 *   女性变体在前三路之后追加
 *   `U_uterus = clamp(uterus.bleedingRequestMl, 0, max(0, W_start - U_kidney - U_lung - U_sweat))`
 *   与 `U_mammary = clamp(mammaryGlands.milkRequestMl, 0,
 *   max(0, W_start - U_kidney - U_lung - U_sweat - U_uterus))`，
 *   所以月经失水与乳汁水只能用其他出口支付后的轮初余量，不会与尿、肺失水或汗重复支付。
 *   肺请求只表示上一轮快照计算的**运动相关**呼吸失水，不是总呼吸失水，也不含静息呼吸。
 *   子宫请求只表示上一轮快照的月经失水请求，不是瞬时经血流率；乳腺请求只表示上一轮快照的
 *   乳汁水请求，不是实测泌乳率或婴儿需求。
 * - `io.write` 交回的是**转出前**的 `W_start`；Gateway 在 transfer 阶段才扣各出口并加入小肠
 *   同轮转入。因此本轮请求只能由轮初水支付，当轮肠流入不能支付本轮转出。
 * - 直接模块调用缺少出口来源部位或请求字段非有限、为负时按 0；Gateway 中每个 `transferOut`
 *   目标都必须由对应部位声明，缺任一出口目标的清单会在启动时失败。
 * - 旧行为：新出口请求为 0 时只发 0 额 transfer，既有出口的水量与其他轨迹保持不变。
 *
 * 水账：胃水 + 队列水 + 小肠水 + (体液水 − 初始体液水) + 膀胱尿 + 累计 voidedMl
 *   + 累计 `skin.sweatVolumeMl` + 累计 `lungs.respiratoryWaterLossMl` = 累计饮水；
 *   女性变体再加累计 `uterus.bleedingMl` 与累计 `mammaryGlands.milkMl` 两项。请求字段不计入
 *   实际失水，只有逐轮转移量进入水账。
 *
 * 不能推出：`waterDeficit` 是归一化代理，不是血浆渗透压、血容量、口渴或尿意评分；各出口是
 * 请求量而不是瞬时尿流率、呼吸失水率、出汗率、经血流率或泌乳率。不建血浆/尿渗、电解质、
 * 血容量/血压、RAAS、体温调节、蒸发、肺通气、月经血成分、乳汁成分或乳房解剖；上游胃水、
 * 小肠吸收、肺、皮肤、子宫与乳腺的证据边界见对应器官 README，本文件不引用具体论文。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export type BodyFluidState = {
  waterVolumeMl: number;
  waterDeficit: number;
};

export type WaterOutlet = {
  requestPart: string;
  requestField: string;
  toPart: string;
  toField: string;
};

export type BodyWaterIO = {
  read(partId: string): Readonly<Record<string, unknown>> | undefined;
  write(next: BodyFluidState): void;
  transfer(
    fromPart: 'bodyFluid',
    fromField: 'waterVolumeMl',
    toPart: string,
    toField: string,
    amount: number,
  ): void;
};

export type BodyWaterFields = {
  waterVolumeMl: {
    unit: string;
    mode: string;
    transferIn: string[];
    transferOut: string[];
  };
  waterDeficit: { unit: string; mode: string };
};

export type BodyWaterModule = {
  initialState: BodyFluidState;
  fields: BodyWaterFields;
  heartbeat(io: BodyWaterIO): void;
};

const parameters = loadParameters(new URL('./water.parameters.json', import.meta.url));
const referenceVolumeMl = requireParameter(parameters, 'bodyFluid.referenceVolumeMl');
const deficitScaleMl = requireParameter(parameters, 'bodyFluid.deficitScaleMl');

const bodyFluidInitialState: BodyFluidState = {
  waterVolumeMl: referenceVolumeMl,
  waterDeficit: 0,
};

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createBodyWater(outlets: readonly WaterOutlet[]): BodyWaterModule {
  const fields: BodyWaterFields = {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['smallIntestine.waterVolumeMl'],
      transferOut: outlets.map((outlet) => `${outlet.toPart}.${outlet.toField}`),
    },
    waterDeficit: { unit: '1', mode: 'absolute' },
  };

  function heartbeat(io: BodyWaterIO): void {
    const prev = io.read('bodyFluid') ?? bodyFluidInitialState;
    const startVolumeMl = Math.max(0, finiteOrZero(prev.waterVolumeMl));
    let remainingMl = startVolumeMl;
    const amountsMl = outlets.map((outlet) => {
      const requestMl = Math.max(0, finiteOrZero(io.read(outlet.requestPart)?.[outlet.requestField]));
      const amountMl = Math.min(requestMl, remainingMl);
      remainingMl = Math.max(0, remainingMl - amountMl);
      return amountMl;
    });
    const waterDeficit = clamp((referenceVolumeMl - startVolumeMl) / deficitScaleMl, -1, 1);

    io.write({ waterVolumeMl: startVolumeMl, waterDeficit });
    for (let index = 0; index < outlets.length; index++) {
      const outlet = outlets[index];
      io.transfer('bodyFluid', 'waterVolumeMl', outlet.toPart, outlet.toField, amountsMl[index]);
    }
  }

  return { initialState: bodyFluidInitialState, fields, heartbeat };
}
