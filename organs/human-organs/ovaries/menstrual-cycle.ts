/*
 * 卵巢周期脚本（ovaries）：女性身体的周期钟与雌二醇（E2）/孕酮（P4）相对量。
 * 部位 `ovaries` 的唯一写者；无动作、无 transfer，也不读其他部位。消费者是 `uterus`：
 * 其内膜目标读取本部位上一轮提交的 `estradiolRelative` / `progesteroneRelative`。
 *
 * 证据：
 * - SRC-BULL-2019 / bull-2019（Bull JR et al., npj Digit Med 2019;2:83，PMID 31482137，
 *   DOI 10.1038/s41746-019-0152-7）：只支撑周期长度与卵泡期/黄体期长度的量级，不支撑激素
 *   曲线形状、激素水平或个体预测。证据笔记见
 *   `organs/human-organs/ovaries/references/notes/bull-2019.md`；29.3 / 16.9 / 12.4 d 已按该
 *   笔记核对，本文件与同目录参数文件使用核对值。队列为 Natural Cycles 用户且有厂商资助。
 *
 * 全部激素曲线为 design 分段线性形状，峰值归一为 1；不是 pg/mL、ng/mL、实测浓度曲线，也不是
 * 排卵或受孕模型：
 * - E2：周期首日 `nadir` → 卵泡期末（`follicularLengthDays`）1 → 1 天后回到 `nadir` →
 *   黄体中期（`follicularLengthDays + lutealLengthDays / 2`）`lutealBump` → 周期末 `nadir`。
 * - P4：卵泡期与排卵日保持 `baseline`；排卵次日起到黄体中期升至 1，随后降至周期末 `baseline`。
 * - 相位：`cycleDay < follicularLengthDays` 为 follicular；`< follicularLengthDays + 1` 为
 *   ovulatory；其余 luteal。排卵日固定 1 天（design），月经期不单设相位。
 *   Bull 的卵泡期 + 黄体期 = 16.9 + 12.4 = 29.3 d；1 天 ovulatory 带（design）嵌在两者之间，
 *   因此本实现的 `luteal` 相位实际跨 11.4 d，而 `lutealLengthDays = 12.4` 只作激素曲线形状
 *   参数（黄体中期 = `follicularLengthDays + lutealLengthDays / 2`），不是相位边界；两者口径
 *   不同，不能互相替代。
 *
 * 每轮 `cycleDay` 增加 `dtMin / 1440`（`dtMin = io.dt / 60`），到 `cycleLengthDays` 回卷；
 * 只读轮初自身状态。曲线在回卷点两侧连续：E2/P4 的周期末值等于周期首日值。参数在同目录
 * `menstrual-cycle.parameters.json`，Bull 三项为 `prior`，其余为 `design`、`source: null`。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'ovaries';
export const actionTypes: string[] = [];

type Phase = 'follicular' | 'ovulatory' | 'luteal';

type OvariesState = {
  cycleDay: number;
  cycleLengthDays: number;
  phase: Phase;
  estradiolRelative: number;
  progesteroneRelative: number;
};

export const fields = {
  cycleDay: { unit: 'd', mode: 'absolute' },
  cycleLengthDays: { unit: 'd', mode: 'absolute' },
  phase: { unit: '-', mode: 'absolute' },
  estradiolRelative: { unit: '1', mode: 'absolute' },
  progesteroneRelative: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(partId: 'ovaries'): Readonly<OvariesState> | undefined;
  readonly dt: number;
  write(next: OvariesState): void;
};

const parameters = loadParameters(
  new URL('./menstrual-cycle.parameters.json', import.meta.url),
);
const cycleLengthDays = requireParameter(parameters, 'ovaries.cycleLengthDays');
const follicularLengthDays = requireParameter(parameters, 'ovaries.follicularLengthDays');
const lutealLengthDays = requireParameter(parameters, 'ovaries.lutealLengthDays');
const startCycleDay = requireParameter(parameters, 'ovaries.startCycleDay');
const estradiolNadirRelative = requireParameter(
  parameters,
  'ovaries.estradiolNadirRelative',
);
const estradiolLutealBumpRelative = requireParameter(
  parameters,
  'ovaries.estradiolLutealBumpRelative',
);
const progesteroneBaselineRelative = requireParameter(
  parameters,
  'ovaries.progesteroneBaselineRelative',
);

const ovulatoryLengthDays = 1;
const dayAfterOvulation = follicularLengthDays + ovulatoryLengthDays;
const midLutealCycleDay = follicularLengthDays + lutealLengthDays / 2;

function wrapCycleDay(cycleDay: number): number {
  return cycleDay % cycleLengthDays;
}

function phaseAt(cycleDay: number): Phase {
  if (cycleDay < follicularLengthDays) return 'follicular';
  if (cycleDay < dayAfterOvulation) return 'ovulatory';
  return 'luteal';
}

function estradiolRelativeAt(cycleDay: number): number {
  if (cycleDay <= follicularLengthDays) {
    return estradiolNadirRelative
      + (1 - estradiolNadirRelative) * (cycleDay / follicularLengthDays);
  }
  if (cycleDay <= dayAfterOvulation) {
    return 1 + (estradiolNadirRelative - 1)
      * (cycleDay - follicularLengthDays) / ovulatoryLengthDays;
  }
  if (cycleDay <= midLutealCycleDay) {
    return estradiolNadirRelative
      + (estradiolLutealBumpRelative - estradiolNadirRelative)
        * (cycleDay - dayAfterOvulation) / (midLutealCycleDay - dayAfterOvulation);
  }
  return estradiolLutealBumpRelative
    + (estradiolNadirRelative - estradiolLutealBumpRelative)
      * (cycleDay - midLutealCycleDay) / (cycleLengthDays - midLutealCycleDay);
}

function progesteroneRelativeAt(cycleDay: number): number {
  if (cycleDay <= dayAfterOvulation) return progesteroneBaselineRelative;
  if (cycleDay <= midLutealCycleDay) {
    return progesteroneBaselineRelative
      + (1 - progesteroneBaselineRelative)
        * (cycleDay - dayAfterOvulation) / (midLutealCycleDay - dayAfterOvulation);
  }
  return 1 + (progesteroneBaselineRelative - 1)
    * (cycleDay - midLutealCycleDay) / (cycleLengthDays - midLutealCycleDay);
}

const initialCycleDay = wrapCycleDay(startCycleDay);

export const initialState: OvariesState = {
  cycleDay: initialCycleDay,
  cycleLengthDays,
  phase: phaseAt(initialCycleDay),
  estradiolRelative: estradiolRelativeAt(initialCycleDay),
  progesteroneRelative: progesteroneRelativeAt(initialCycleDay),
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtDays = io.dt / 60 / 1440;
  const cycleDay = wrapCycleDay(prev.cycleDay + dtDays);

  io.write({
    cycleDay,
    cycleLengthDays,
    phase: phaseAt(cycleDay),
    estradiolRelative: estradiolRelativeAt(cycleDay),
    progesteroneRelative: progesteroneRelativeAt(cycleDay),
  });
}
