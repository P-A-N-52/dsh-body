/*
 * 胃（stomach）水链入口；部位 `stomach` 的写者。根清单用它替换旧 `motility.ts`，同一清单不能
 * 同时加载两个 `stomach`。动力、队列与固／液排空方程都在 `motility-core.ts`；这里接入水子集与
 * 碳水记账，并完成跨部位转移：水按 docs/superpowers/specs/2026-11-22-water-balance-design.md
 * §3.1，碳水按 docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md §5.1。
 *
 * 来源与边界：
 * - SRC-MUDIE-2014 / mudie-2014：笔记 organs/human-organs/stomach/references/notes/mudie-2014.md，
 *   摘要 Results（PMID 25115349）。空腹一次 240 mL 白水的胃排空 T50 13 min（n=12，± 类型未逐项
 *   标注）只支撑非固餐排空的时间尺度，参数复用 motility.parameters.json。边界：原文测的是胃内容量，
 *   没有把胃内水拆成“水子集”，本脚本的水比例公式不来自该文，也不能外推到固餐或含能液餐。
 * - 其余排空参数与固餐分组证据见 motility-core.ts 头部；本脚本不新增参数、不新增来源。
 *
 * 工程假设（design）：
 * - `drink` 的全部 volumeMl 记为水（饮料体积是可吸收水的代理，不反推纯水含量）；`eat`（含
 *   liquid / mixed）不产水，也不增加 waterMl 动作参数。
 * - 轮初非固餐体积 N = max(0, volumeMl - solidVolumeMl)，水 W = clamp(waterVolumeMl, 0, N)；
 *   emptiedWaterMl = E_nonSolid × W / N（N = 0 时为 0）。固餐排空不带水，胃总 volumeMl 仍由
 *   核心只扣一次原排空量，waterVolumeMl 是其子集，不能加回总量。
 * - 先 write 后 transfer：write 的是转出前基准 W + D（D 为本轮入胃水），transfer 只转
 *   emptiedWaterMl；Gateway 在轮末一起提交，水不会双扣，D 本轮不再排出。
 * - 旧存档缺 waterVolumeMl 按 0，旧 mealQueue 切片缺 remainingWaterMl / rateWaterMl 按 0，
 *   不猜历史饮品；旧胃总量、能量与固餐小计不重置。
 * - 13 min 只是白水排空的工程截距（含能非固餐的半时更长），不是小肠吸收半时；本脚本按水量
 *   比例拆分非固餐排出，是工程近似。
 *
 * 碳水记账（design，见 docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md §5.1）：
 * 核心以 `trackCarbohydrate: true` 交回 transfer 前的总量 C + D、固体小计 Cs − Ecs + Ds 与本轮
 * Ec；本脚本把三者原样写入，并按 Ec 向 `smallIntestine.carbohydrateG` transfer 一次。Gateway 在
 * write 之后才扣 transfer，因此总碳水只扣一次，固体小计只预扣 Ecs，不随 transfer 再变。碳水是
 * 可消化碳水的葡萄糖当量，不从体积、能量或 4 kcal/g 反推；非固餐按体积同比例、固餐按固餐排出
 * 比例拆分碳水，`mixed` 归入非固餐组，都是 design 比例假设，糖组成、纤维、胃内混合与选择性排空
 * 不建模。没有非固餐体积时不虚构碳水排空，但零体积仍有余碳的队列末轮会释放余量。旧档缺碳水
 * 字段按 0；legacy 入口剥离队列碳水元数据，不支持借 legacy 清单往返保存待释放碳水。
 */
import {
  advanceStomach,
  readStomachBase,
  stomachActionTypes,
  stomachFields,
  stomachInitialState,
} from './motility-core.ts';

export const id = 'stomach';
export const actionTypes = stomachActionTypes;

export const initialState = {
  ...stomachInitialState,
  waterVolumeMl: 0,
  emptiedWaterMl: 0,
  carbohydrateG: 0,
  solidCarbohydrateG: 0,
  emptiedCarbohydrateG: 0,
};

export const fields = {
  ...stomachFields,
  waterVolumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['smallIntestine.waterVolumeMl'] },
  emptiedWaterMl: { unit: 'mL', mode: 'absolute' },
  carbohydrateG: { unit: 'g', mode: 'absolute', transferOut: ['smallIntestine.carbohydrateG'] },
  solidCarbohydrateG: { unit: 'g', mode: 'absolute' },
  emptiedCarbohydrateG: { unit: 'g', mode: 'absolute' },
};

type Action = {
  readonly type?: unknown;
  readonly volumeMl?: unknown;
  readonly energyKcal?: unknown;
  readonly mealKind?: unknown;
  readonly durationMin?: unknown;
  readonly carbohydrateG?: unknown;
};

type IO = {
  read(id: 'stomach'): Readonly<typeof initialState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: typeof initialState): void;
  transfer(
    fromPart: 'stomach',
    fromField: 'waterVolumeMl' | 'carbohydrateG',
    toPart: 'smallIntestine',
    toField: 'waterVolumeMl' | 'carbohydrateG',
    amount: number,
  ): void;
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const { state, emptiedNonSolidMl, deliveredWaterMl, carbohydrate } = advanceStomach(
    prev,
    io.actions,
    io.dt,
    io.simulatedSeconds,
    { trackWater: true, trackCarbohydrate: true },
  );
  const { nonSolidVolumeMl, waterVolumeMl } = readStomachBase(prev);
  const emptiedWaterMl = nonSolidVolumeMl > 0
    ? emptiedNonSolidMl * (waterVolumeMl / nonSolidVolumeMl)
    : 0;

  io.write({
    ...state,
    waterVolumeMl: waterVolumeMl + deliveredWaterMl,
    emptiedWaterMl,
    ...carbohydrate,
  });
  if (emptiedWaterMl > 0) {
    io.transfer(id, 'waterVolumeMl', 'smallIntestine', 'waterVolumeMl', emptiedWaterMl);
  }
  if (carbohydrate.emptiedCarbohydrateG > 0) {
    io.transfer(id, 'carbohydrateG', 'smallIntestine', 'carbohydrateG', carbohydrate.emptiedCarbohydrateG);
  }
}
