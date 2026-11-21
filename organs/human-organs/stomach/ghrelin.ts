/*
 * 胃内分泌（饥饿素）P0 脚本：部位 `stomachGhrelin`，字段 `relativeConcentration`（单位 `1`）。
 * 含能量的 `eat` 或 `drink` 在本轮把相对浓度压到不高于 `postmeal.nadir`，其余时间按一阶指数向
 * `fasting.baseline` 恢复。P0 没有消费者；P1 由 `brain/interoception.ts` 读取，但仍没有通知或
 * 会话消费者；不写其他部位。
 *
 * 来源（笔记路径、原文定位、支撑什么）
 * - SRC-CUMMINGS-2001 / cummings-2001：`organs/human-organs/stomach/references/notes/cummings-2001.md`，
 *   摘要 Results（PMID 11473029；摘要已读，未读全文）。固定餐时健康成人 n=10，餐前血浆饥饿素升约 2 倍、
 *   餐后 1 h 内降至谷值；只支撑“餐后下降、餐间向基线恢复”的方向。摘要未说明总饥饿素还是酰化饥饿素，
 *   未给绝对浓度、采样间隔、餐型与餐次钟点；不能用于幅度标定、恢复速率或餐前上升时间。
 * - SRC-LEONE-2022 / leone-2022：`organs/human-organs/stomach/references/notes/leone-2022.md`，
 *   Table 4 与 Results（Ghrelin）；全文已读。混合餐后 60/120/180 min，女性参考组血清未酰化饥饿素
 *   相对空腹 ΔG −0.56/−0.70/−0.58 ng/mL（n=24 模型，混合模型系数，CI95 见笔记）；支撑餐后下降方向。
 *   测的是未酰化饥饿素，混合模型系数不是个体曲线；餐量按个体日耗能 40% 定，绝对能量与体积未报告；
 *   不能推出能量-抑制幅度关系，也不能把女性参考组系数直接给男性或个体。
 *
 * design（不是人体测量或拟合）
 * - `stomachGhrelin.fasting.baseline=1`、`postmeal.nadir=0.5`、`recovery.apparentHalfTimeMin=90` 全为 design。
 * - `relativeConcentration` 是相对值，不是 ng/mL；指数恢复（表观半时，不是清除率）与“任意
 *   `energyKcal>0` 都一步压到 nadir”都是工程选择；白水不抑制同样来自设计，两条来源都未报告零能量对照。
 * - P0 不建模餐前上升（没有餐时表），也不建模餐型、能量剂量、性别或昼夜节律。
 *
 * P1 输入契约（design，不是 validated）：`actionTypes` 增加 `drink`，含能饮料（`energyKcal > 0`）
 * 与含能 `eat` 一样在本轮抑制；白水与 0 kcal 饮料不抑制。饮料专属证据尚未登记，这条方向是从
 * Cummings 2001 与 Leone 2022 的含能餐证据外推的 design 假设，不能称为 validated，也不能推出
 * 饮料成分、能量剂量与抑制幅度的关系。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'stomachGhrelin';
export const actionTypes = ['eat', 'drink'];

type GhrelinState = {
  relativeConcentration: number;
};

type Action = {
  readonly type?: unknown;
  readonly energyKcal?: unknown;
};

type IO = {
  read(id: 'stomachGhrelin'): Readonly<GhrelinState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  write(next: GhrelinState): void;
};

const parameters = loadParameters(new URL('./ghrelin.parameters.json', import.meta.url));
const baseline = requireParameter(parameters, 'stomachGhrelin.fasting.baseline');
const nadir = requireParameter(parameters, 'stomachGhrelin.postmeal.nadir');
const halfTimeMin = requireParameter(parameters, 'stomachGhrelin.recovery.apparentHalfTimeMin');

export const initialState: GhrelinState = {
  relativeConcentration: baseline,
};

export const fields = {
  relativeConcentration: { unit: '1', mode: 'absolute' },
};

function hasEnergyIntake(actions: readonly Action[]): boolean {
  return actions.some((action) => (action.type === 'eat' || action.type === 'drink')
    && typeof action.energyKcal === 'number'
    && Number.isFinite(action.energyKcal)
    && action.energyKcal > 0);
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const current = typeof prev.relativeConcentration === 'number' && Number.isFinite(prev.relativeConcentration)
    ? prev.relativeConcentration
    : baseline;
  const next = hasEnergyIntake(io.actions)
    ? Math.min(current, nadir)
    : current + (baseline - current) * (1 - 2 ** (-(io.dt / 60) / halfTimeMin));
  io.write({ relativeConcentration: Math.max(0, next) });
}
