/*
 * 胃（stomach）动力与排空脚本的旧独立入口；部位 `stomach` 的写者。
 *
 * 方程、固／液分组、来源注释和证据边界都在 `motility-core.ts`；这里只保留模块契约，并以
 * `trackWater: false, trackCarbohydrate: false` 调用核心。因此状态形状、体积／能量／固餐轨迹与
 * 历史清单一致：不声明 transfer，`mealQueue` 切片没有水或碳水元数据，推进既有队列时剥离
 * `remainingWaterMl` / `rateWaterMl` 与 `remainingCarbohydrateG` / `rateCarbohydrateGPerRound`，
 * 也不需要小肠或膀胱同时加载。
 *
 * 来源入口（详细边界与原文定位见 `motility-core.ts` 头部；登记见
 * organs/human-organs/references/source-index.csv）：
 * - SRC-MUDIE-2014 / mudie-2014：笔记 organs/human-organs/stomach/references/notes/mudie-2014.md
 * - SRC-CAMPS-2016 / camps-2016：笔记 organs/human-organs/stomach/references/notes/camps-2016.md
 * - SRC-VASAVID-2014 / vasavid-2014：笔记 organs/human-organs/stomach/references/notes/vasavid-2014.md
 * - SRC-TOUGAS-2000 / tougas-2000：笔记 organs/human-organs/stomach/references/notes/tougas-2000.md
 *   本入口不新增来源，参数仍读同目录 motility.parameters.json；`design` 参数不因引用而升级。
 *
 * 水元数据边界（design）：legacy 清单没有下游水链，因此推进既有队列时会剥离切片上的
 * `remainingWaterMl` / `rateWaterMl`；留下的水余量会与已释放体积脱节，变成陈旧读数。这意味着
 * 不支持“水链清单 → legacy 清单 → 水链清单”借道保存待释放水：切到 legacy 后用掉的轮次会丢弃
 * 切片的水身份，再切回 `hydration.ts` 时队列水按 0 计，不猜历史饮品。
 *
 * 根清单的饮水链入口是 `hydration.ts`；同一清单不能同时加载两个 `stomach`。
 */
import {
  advanceStomach,
  stomachActionTypes,
  stomachFields,
  stomachInitialState,
} from './motility-core.ts';

export const id = 'stomach';
export const actionTypes = stomachActionTypes;
export const initialState = stomachInitialState;
export const fields = stomachFields;

type Action = {
  readonly type?: unknown;
  readonly volumeMl?: unknown;
  readonly energyKcal?: unknown;
  readonly mealKind?: unknown;
  readonly durationMin?: unknown;
};

type IO = {
  read(id: 'stomach'): Readonly<typeof initialState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: typeof initialState): void;
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const { state } = advanceStomach(prev, io.actions, io.dt, io.simulatedSeconds);
  io.write(state);
}
