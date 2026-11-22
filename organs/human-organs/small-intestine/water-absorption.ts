/*
 * 小肠（smallIntestine）水吸收脚本；部位 `smallIntestine` 的唯一写者。
 * 每轮只吸收轮初肠水，按一阶指数把水转出到 `bodyFluid.waterVolumeMl`。
 *
 * 来源（登记见 organs/human-organs/references/source-index.csv）：
 * - SRC-PERONNET-2012 / peronnet-2012：PMC3351614。健康年轻男性 n=36，一次 300 mL 低矿化度水
 *   加 D₂O 示踪（D₂O 0.10 g/kg 瘦体重），0/5/10/15/20/30/60 min 采血。
 *   * 支撑：口服水吸收在 5 min 即可检出、完整吸收与分布跨数十分钟的探索性时间尺度，
 *     以及“小肠从肠腔向体液方向搬水”的方向性假设。
 *   * 不能推出：原文的 75–120 min 是表观完全吸收与分布时间（按 7×ta½ 的文字概括），不是任何
 *     小肠段或半时参数；ta½ 10.9/12.9 min 是血浆示踪出现半时，不是肠腔水消失半时；D₂O 是
 *     示踪水，不等于肠腔水体积或纯水体积。本脚本的
 *     `smallIntestine.absorption.halfTimeMin = 20 min`（同目录
 *     `water-absorption.parameters.json`，`design`）不是论文报告值，也不是对
 *     Péronnet 曲线的拟合，不能称 validated。笔记由
 *     organs/human-organs/small-intestine/references/notes/peronnet-2012.md 记录原文定位。
 *
 * 工程假设（design）：一阶指数吸收的离散形式
 * A = W_start × (1 − 2^(−dtMin / halfTimeMin))；它只固定“肠腔水越多、吸收越快”和
 * 20 min 的工程时间尺度，不区分肠段、转运体、渗透压或血流限制，也不把吸收量当门静脉
 * 水通量或血浆容量变化。`absorbedWaterMl` 是本轮吸收读数（mL/轮），不是累计量。
 *
 * 网关的 write 在 transfer 之前应用：本脚本写回的是本轮转出前的轮初肠水，随后
 * 由 `io.transfer` 扣除 A。胃同轮转入的水在 transfer 阶段才加入肠池，下一轮才参与
 * 吸收，因此不会放大本轮的 A。旧存档没有 `waterVolumeMl` 时按 0 读取。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'smallIntestine';
export const actionTypes: string[] = [];

type SmallIntestineState = {
  waterVolumeMl: number;
  absorbedWaterMl: number;
};

export const initialState: SmallIntestineState = {
  waterVolumeMl: 0,
  absorbedWaterMl: 0,
};

export const fields = {
  waterVolumeMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['stomach.waterVolumeMl'],
    transferOut: ['bodyFluid.waterVolumeMl'],
  },
  absorbedWaterMl: { unit: 'mL', mode: 'absolute' },
};

type IO = {
  read(id: 'smallIntestine'): Readonly<SmallIntestineState> | undefined;
  readonly dt: number;
  write(next: SmallIntestineState): void;
  transfer(
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: number,
  ): void;
};

const parameters = loadParameters(new URL('./water-absorption.parameters.json', import.meta.url));
const halfTimeMin = requireParameter(parameters, 'smallIntestine.absorption.halfTimeMin');

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const waterVolumeMl = typeof prev.waterVolumeMl === 'number' && Number.isFinite(prev.waterVolumeMl)
    ? Math.max(0, prev.waterVolumeMl)
    : 0;
  const dtMin = io.dt / 60;
  const absorbedWaterMl = waterVolumeMl * (1 - 2 ** (-dtMin / halfTimeMin));

  io.write({ waterVolumeMl, absorbedWaterMl });
  io.transfer(id, 'waterVolumeMl', 'bodyFluid', 'waterVolumeMl', absorbedWaterMl);
}
