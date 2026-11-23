/*
 * 食管（esophagus）薄切片：记录本轮吞下的食团、剩余转运时间与呛咳风险代理；
 * 部位 `esophagus` 的唯一写者。不写胃、不调用 transfer 或 notify。
 *
 * 证据：无直接人体测量。`esophagus.bolusTransitMin = 0.2 min`、`esophagus.chokeGain = 50 mm`、
 * `esophagus.referenceBolusMl = 250 mL`（同目录 `esophagus.parameters.json`）全部是 `design`、
 * `source: null` 的工程假设，不是食管转运时间、食团体积或呛咳阈值的人体测量，也不是对任何
 * 吞咽研究的拟合。数据来源见 docs/superpowers/specs/2026-11-24-bowel-design.md；本切片不新增
 * 论文证据，不把 0.2 min 或 250 mL 称为生理正常值。
 *
 * 公式（dtMin = io.dt / 60；只读轮初快照与本轮原始动作）：
 *   prevTransitMin = max(0, prev.transitMin)
 *   transitMin = max(0, prevTransitMin − dtMin)
 *   本轮递减后仍有转运（transitMin > 0）时保留 prev.bolusVolumeMl，否则视为已到胃、按 0 起算
 *   每条合法 eat/drink：bolusVolumeMl += 动作体积；transitMin = bolusTransitMin
 *   chokingMm = clamp(chokeGain × max(0, bolusVolumeMl / referenceBolusMl − 1), 0, 100)
 *
 * 工程假设（design）：
 * - “合法 eat/drink”沿用胃 `motility-core.parseIntake` 的输入契约：type 为 eat/drink、volumeMl
 *   为有限正数；durationMin / carbohydrateG 若提供必须有限且非负；drink 的 energyKcal 可缺省、
 *   提供时必须有限非负；eat 的 energyKcal 必须有限非负且 mealKind 为 liquid/solid/mixed。
 *   非法动作整条忽略，不报错。`durationMin` 只影响胃的按轮分摊；食管仍把该动作的完整体积
 *   记入吞下轮，不按轮拆分，也不反推食团含水率或固液组成。
 * - 转运计时从轮初值递减；食团在 `transitMin` 到达 0 时视为已进入胃并清零。胃的接收由既有
 *   动作队列时序表达（胃在动作结算轮收到摄入），本脚本不新增 transfer，也不重复写入胃；
 *   因此 `transitMin` 只是读数，不改变胃的摄入时刻。60 s 轮长大于 0.2 min，正常一轮后
 *   `transitMin` 即为 0，下一轮食团清零；短于 0.2 min 的轮次仍能读出剩余转运时间。
 * - 同轮多条合法动作把体积相加成一个食团，后一条动作重置转运计时，不叠加时延。
 * - `chokingMm` 只是“超过 250 mL 参考食团后的线性风险代理”，不是气道梗阻概率、误吸诊断、
 *   吞咽造影或临床呛咳评分；250 mL 以下为 0，750 mL 及以上封顶 100。它只由本轮结束时仍在
 *   转运的食团体积计算，不由累计摄入、饮水速度或现实时间计算。
 * - 输出钳到 [0, 100]；食团体积累加后封顶 `Number.MAX_VALUE`，保证状态 JSON-safe。非有限
 *   自身历史字段按 0 读取，不抛错；不建模食管蠕动、上下括约肌、会厌/气道保护、吞咽分期、
 *   分段转运、固液差异、重力或体位。
 *
 * 消费者：`interoception.discomfort` 通过 `excessOverOnset(esophagus.chokingMm, onsetMm)`
 * 软读呛咳风险；`esophagus` 未加载时该路按 0，既有清单行为不变。本脚本不读
 * `interoception`，因此没有反馈环。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'esophagus';
export const actionTypes: string[] = ['eat', 'drink'];

type EsophagusState = {
  bolusVolumeMl: number;
  transitMin: number;
  chokingMm: number;
};

export const initialState: EsophagusState = {
  bolusVolumeMl: 0,
  transitMin: 0,
  chokingMm: 0,
};

export const fields = {
  bolusVolumeMl: { unit: 'mL', mode: 'absolute' },
  transitMin: { unit: 'min', mode: 'absolute' },
  chokingMm: { unit: 'mm', mode: 'absolute' },
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
  read(id: 'esophagus'): Readonly<EsophagusState> | undefined;
  readonly actions: readonly (Action | null | undefined)[];
  readonly dt: number;
  write(next: EsophagusState): void;
};

const parameters = loadParameters(new URL('./esophagus.parameters.json', import.meta.url));
const bolusTransitMin = requireParameter(parameters, 'esophagus.bolusTransitMin');
const chokeGain = requireParameter(parameters, 'esophagus.chokeGain');
const referenceBolusMl = requireParameter(parameters, 'esophagus.referenceBolusMl');

const MIN_MM = 0;
const MAX_MM = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isMealKind(value: unknown): value is 'liquid' | 'solid' | 'mixed' {
  return value === 'liquid' || value === 'solid' || value === 'mixed';
}

function intakeVolume(action: Action | null | undefined): number | null {
  if (action === null || action === undefined || typeof action !== 'object') return null;
  if (action.type !== 'eat' && action.type !== 'drink') return null;
  if (typeof action.volumeMl !== 'number' || !Number.isFinite(action.volumeMl) || action.volumeMl <= 0) {
    return null;
  }
  if (action.durationMin !== undefined
    && (typeof action.durationMin !== 'number'
      || !Number.isFinite(action.durationMin)
      || action.durationMin < 0)) {
    return null;
  }
  if (action.carbohydrateG !== undefined
    && (typeof action.carbohydrateG !== 'number'
      || !Number.isFinite(action.carbohydrateG)
      || action.carbohydrateG < 0)) {
    return null;
  }
  if (action.type === 'drink') {
    if (action.energyKcal !== undefined
      && (typeof action.energyKcal !== 'number'
        || !Number.isFinite(action.energyKcal)
        || action.energyKcal < 0)) {
      return null;
    }
    return action.volumeMl;
  }
  if (typeof action.energyKcal !== 'number' || !Number.isFinite(action.energyKcal) || action.energyKcal < 0) {
    return null;
  }
  if (!isMealKind(action.mealKind)) return null;
  return action.volumeMl;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = io.dt / 60;
  const prevTransitMin = Math.max(0, finiteOrZero(prev.transitMin));
  let transitMin = Math.max(0, prevTransitMin - dtMin);
  let bolusVolumeMl = transitMin > 0 ? Math.max(0, finiteOrZero(prev.bolusVolumeMl)) : 0;

  for (const action of io.actions) {
    const volumeMl = intakeVolume(action);
    if (volumeMl === null) continue;
    bolusVolumeMl = Math.min(Number.MAX_VALUE, bolusVolumeMl + volumeMl);
    transitMin = bolusTransitMin;
  }

  const chokingMm = clamp(
    chokeGain * Math.max(0, bolusVolumeMl / referenceBolusMl - 1),
    MIN_MM,
    MAX_MM,
  );

  io.write({ bolusVolumeMl, transitMin, chokingMm });
}
