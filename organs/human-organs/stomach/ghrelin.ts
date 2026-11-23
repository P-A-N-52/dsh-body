/*
 * 胃内分泌（饥饿素）P0 脚本：部位 `stomachGhrelin`，字段 `relativeConcentration`（单位 `1`）与
 * `minutesSinceEnergyIntake`（单位 `min`）。正在进行的摄入与上游扩张/营养信号从既有目标中减去
 * 抑制量，再按恢复半时一阶逼近并钳到 [0, fasting.peak]；含能量摄入同时把空腹计时清零，其余时间
 * 空腹目标随时长上升。P0 没有消费者；P1 由 `brain/interoception.ts` 读取，`brainNotify` 再按提醒
 * 策略决定是否通知；本脚本不发送通知，也不写其他部位。
 *
 * 来源（笔记路径、原文定位、支撑什么）
 * - SRC-CUMMINGS-2001 / cummings-2001：`organs/human-organs/stomach/references/notes/cummings-2001.md`，
 *   摘要 Results（PMID 11473029；摘要已读，未读全文）。固定餐时健康成人 n=10，餐前血浆饥饿素升约 2 倍、
 *   餐后 1 h 内降至谷值；只支撑“餐前上升、餐后下降”的方向。摘要未说明总饥饿素还是酰化饥饿素，
 *   未给绝对浓度、采样间隔、餐型与餐次钟点；不能用于幅度标定、空腹时长曲线、上升或恢复速率、峰值。
 * - SRC-LEONE-2022 / leone-2022：`organs/human-organs/stomach/references/notes/leone-2022.md`，
 *   Table 4 与 Results（Ghrelin）；全文已读。混合餐后 60/120/180 min，女性参考组血清未酰化饥饿素
 *   相对空腹 ΔG −0.56/−0.70/−0.58 ng/mL（n=24 模型，混合模型系数，CI95 见笔记）；支撑餐后下降方向。
 *   测的是未酰化饥饿素，混合模型系数不是个体曲线；餐量按个体日耗能 40% 定，绝对能量与体积未报告；
 *   不能推出能量-抑制幅度关系，也不能把女性参考组系数直接给男性或个体。
 *
 * 抑制反馈（design，见 docs/superpowers/specs/2026-11-24-digestive-feedback-design.md）：
 *   suppression = distensionGain × stomachSensory.mechanical
 *               + nutrientGain × duodenum.nutrientExposure
 *               + intakeGain × 本轮摄入能量 / referenceIntakeKcal
 * 有正能量摄入当轮：`relativeConcentration = clamp(min(当前值, postmeal.nadir) − suppression,
 * 0, fasting.peak)`，仍当轮抑制但不再固定落到谷值，剂量越大降得越多；空腹计时清零。
 * 无摄入当轮：`target = clamp(空腹上升目标 − suppression, 0, fasting.peak)`，再按
 * `recovery.apparentHalfTimeMin` 一阶恢复/上升。`distensionGain=0.3`、`nutrientGain=0.3`、
 * `intakeGain=0.4`、`referenceIntakeKcal=250` 全部为 design、`source: null`，不是人体剂量曲线；
 * 两条来源只支撑方向。无摄入且扩张/暴露为 0 时 suppression = 0，轨迹与旧版逐点一致。
 *
 * design（不是人体测量或拟合）
 * - `stomachGhrelin.fasting.baseline=1`、`postmeal.nadir=0.5`、`recovery.apparentHalfTimeMin=90` 全为 design。
 * - `stomachGhrelin.fasting.peak=1.8`、`stomachGhrelin.fasting.rise.onsetMin=180`、
 *   `stomachGhrelin.fasting.rise.apparentHalfTimeMin=120` 与整条空腹上升曲线同为 design、`source: null`。
 *   两条来源都只支撑方向，不能分离空腹时长、餐前预期与昼夜节律；`peak=1.8` 不是 Cummings 2001
 *   “约 2 倍”的换算，曲线也没有经过实机或独立验证。
 * - `relativeConcentration` 是相对值，不是 ng/mL；指数恢复（表观半时，不是清除率）与餐后抑制
 *   都是工程选择。旧版“任意 `energyKcal>0` 都一步压到 nadir”已改为按剂量从 `min(当前值, nadir)`
 *   继续下调，仍当轮生效；白水不抑制同样来自设计，两条来源都未报告零能量对照。
 * - `minutesSinceEnergyIntake` 只由本脚本用 `io.dt` 累加；不读墙钟，也不读 `stomach.lastIntakeAt`。
 *   缺失、负值或非有限计时按 0；旧存档从升级时刻重新累计，不反推过去空腹时长。
 * - 不建模餐时表、餐前预期、昼夜节律、餐型、能量剂量响应、多日饥饿适应或能量不足病理；
 *   真实 CCK/GLP-1 等激素通路不建模，扩张与营养暴露只作工程代理。
 *
 * P1 输入契约（design，不是 validated）：`actionTypes` 增加 `drink`，含能饮料（`energyKcal > 0`）
 * 与含能 `eat` 一样在本轮产生摄入抑制并清零计时；白水与 0 kcal 饮料既不抑制也不重置计时。饮料
 * 专属证据尚未登记，这条方向是从
 * Cummings 2001 与 Leone 2022 的含能餐证据外推的 design 假设，不能称为 validated，也不能推出
 * 饮料成分、能量剂量与抑制幅度的关系。
 *
 * 上游契约：`stomachSensory` / `duodenum` 未加载按 0；部位已加载但字段缺失、非有限或为负时抛错，
 * 本轮不写任何状态。读数来自轮初快照，滞后一轮。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'stomachGhrelin';
export const actionTypes = ['eat', 'drink'];

type GhrelinState = {
  relativeConcentration: number;
  minutesSinceEnergyIntake: number;
};

type Action = {
  readonly type?: unknown;
  readonly energyKcal?: unknown;
};

type StomachSensoryReading = {
  readonly mechanical?: unknown;
};

type DuodenumReading = {
  readonly nutrientExposure?: unknown;
};

type IO = {
  read(id: 'stomachGhrelin'): Readonly<GhrelinState> | undefined;
  read(id: 'stomachSensory'): Readonly<StomachSensoryReading> | undefined;
  read(id: 'duodenum'): Readonly<DuodenumReading> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  write(next: GhrelinState): void;
};

const parameters = loadParameters(new URL('./ghrelin.parameters.json', import.meta.url));
const baseline = requireParameter(parameters, 'stomachGhrelin.fasting.baseline');
const peak = requireParameter(parameters, 'stomachGhrelin.fasting.peak');
const onsetMin = requireParameter(parameters, 'stomachGhrelin.fasting.rise.onsetMin');
const riseHalfTimeMin = requireParameter(parameters, 'stomachGhrelin.fasting.rise.apparentHalfTimeMin');
const nadir = requireParameter(parameters, 'stomachGhrelin.postmeal.nadir');
const halfTimeMin = requireParameter(parameters, 'stomachGhrelin.recovery.apparentHalfTimeMin');
const distensionGain = requireParameter(parameters, 'stomachGhrelin.distensionGain');
const nutrientGain = requireParameter(parameters, 'stomachGhrelin.nutrientGain');
const intakeGain = requireParameter(parameters, 'stomachGhrelin.intakeGain');
const referenceIntakeKcal = requireParameter(parameters, 'stomachGhrelin.referenceIntakeKcal');

export const initialState: GhrelinState = {
  relativeConcentration: baseline,
  minutesSinceEnergyIntake: 0,
};

export const fields = {
  relativeConcentration: { unit: '1', mode: 'absolute' },
  minutesSinceEnergyIntake: { unit: 'min', mode: 'absolute' },
};

function intakeEnergyKcal(actions: readonly Action[]): number {
  let total = 0;
  for (const action of actions) {
    if ((action.type === 'eat' || action.type === 'drink')
      && typeof action.energyKcal === 'number'
      && Number.isFinite(action.energyKcal)
      && action.energyKcal > 0) {
      total += action.energyKcal;
    }
  }
  return total;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readSignal(
  partId: 'stomachSensory' | 'duodenum',
  reading: Readonly<StomachSensoryReading | DuodenumReading> | undefined,
): number {
  if (reading === undefined || reading === null) return 0;
  if (typeof reading !== 'object') throw new Error(`${partId} must be an object`);
  const field = partId === 'stomachSensory' ? 'mechanical' : 'nutrientExposure';
  const value = partId === 'stomachSensory'
    ? (reading as StomachSensoryReading).mechanical
    : (reading as DuodenumReading).nutrientExposure;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${partId}.${field} must be a finite non-negative number`);
  }
  return value;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const current = clamp(finiteOr(prev.relativeConcentration, baseline), 0, peak);
  const elapsedMin = Math.max(0, finiteOr(prev.minutesSinceEnergyIntake, 0));

  const mechanical = readSignal('stomachSensory', io.read('stomachSensory'));
  const nutrientExposure = readSignal('duodenum', io.read('duodenum'));
  const energyKcal = intakeEnergyKcal(io.actions);
  const suppression = distensionGain * mechanical
    + nutrientGain * nutrientExposure
    + (intakeGain * energyKcal) / referenceIntakeKcal;

  const dtMin = io.dt / 60;
  if (energyKcal > 0) {
    const relativeConcentration = clamp(Math.min(current, nadir) - suppression, 0, peak);
    io.write({ relativeConcentration, minutesSinceEnergyIntake: 0 });
    return;
  }

  const minutesSinceEnergyIntake = elapsedMin + dtMin;
  const fastingTarget = baseline
    + (peak - baseline)
      * (1 - 2 ** (-Math.max(0, minutesSinceEnergyIntake - onsetMin) / riseHalfTimeMin));
  const target = clamp(fastingTarget - suppression, 0, peak);
  const relativeConcentration = clamp(
    current + (target - current) * (1 - 2 ** (-dtMin / halfTimeMin)),
    0,
    peak,
  );

  io.write({ relativeConcentration, minutesSinceEnergyIntake });
}
