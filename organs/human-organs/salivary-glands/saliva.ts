/*
 * 唾液腺薄切片（salivaryGlands）：按基础分泌、进食刺激与脱水计算唾液产率，
 * 并输出 0–100 mm 的口腔湿润度代理。当前实现只写本部位；设计消费者（尚未在本切片接入）
 * 是 `duodenum`（读 `salivaRateMlPerMin`，按 `duodenum.salivaryAmylaseGain` 给含碳水餐的
 * 营养暴露小幅增益）与 `interoception`（读 `mouthMoistureMm`，换算成 `dryMouthMm`）。
 * 本脚本不写其他部位、不调用 transfer 或 notify，也不建唾液水账：唾液量不进 `bodyFluid`。
 *
 * 公式（dtMin = io.dt / 60）：
 *   mealStimulusMin = max(0, prev.mealStimulusMin − dtMin)；本轮有合法 eat/drink 时置为
 *     mealWindowMin
 *   stimulated = mealStimulusMin > 0 ? mealGain : 1
 *   dehydration = 1 − dehydrationFactor × clamp(bodyFluid.waterDeficit, 0, 1)
 *   salivaRateMlPerMin = basalRateMlPerMin × stimulated × dehydration
 *   mouthMoistureMm = clamp(100 × salivaRateMlPerMin / (basalRateMlPerMin × mealGain), 0, 100)
 * 因此无刺激、无脱水时产率为基线，湿润度是 100 / mealGain；满刺激且无脱水时湿润度为 100。
 *
 * design（不是人体测量、拟合或独立验证；参数全部 `source: null`）
 * - `salivaryGlands.basalRateMlPerMin = 0.5 mL/min`、`mealGain = 3`、`mealWindowMin = 5 min`、
 *   `dehydrationFactor = 0.5` 都是工程假设，没有实测唾液流率或刺激持续时间支撑。
 * - 饮食刺激只看动作类型与正有限 `volumeMl`；餐型、能量、碳水的合法性仍由 `stomach` 判定，
 *   本脚本不重复校验。同轮多条合法动作只把窗口重置一次，不叠加或延长。
 * - `bodyFluid` 缺失（undefined/null）时 deficit 按 0；部位存在但 `waterDeficit` 缺失、非数或
 *   非有限时抛错，且本轮不写任何状态。deficit 超出 [0, 1] 由公式钳位，不报错。
 * - 只读轮初快照与本轮原始动作，刺激窗口用 `io.dt` 递减，不用现实时间；当轮新到的动作
 *   立即生效，但下游消费者读到的是本轮提交后的快照。
 * - 不建模唾液淀粉酶浓度、吞咽/食管、味觉、口腔疾病、唾液腺结石、口咽解渴支路或唾液水账。
 *
 * 参数文件 `saliva.parameters.json` 的 `parameters` 数组只放四个 `salivaryGlands.*` 参数，
 * 由 `lib/parameters.js` 在 import 时按 owner 前缀校验并只读加载。
 * `duodenum.salivaryAmylaseGain = 0.05` 属于 `duodenum` 消费者；因为共享加载器要求参数 id 以
 * 文件 owner 开头，它保留原 id 放在同文件的 `consumerParameters` 数组，本脚本不读取。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'salivaryGlands';
export const actionTypes: string[] = ['eat', 'drink'];

type SalivaryState = {
  salivaRateMlPerMin: number;
  mealStimulusMin: number;
  mouthMoistureMm: number;
};

type Action = {
  readonly type?: unknown;
  readonly volumeMl?: unknown;
};

type BodyFluidReading = {
  readonly waterDeficit?: unknown;
};

type SavedSalivaryState = {
  readonly mealStimulusMin?: unknown;
};

type IO = {
  read(id: 'salivaryGlands'): Readonly<SavedSalivaryState> | undefined;
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | undefined;
  readonly actions: readonly (Action | null | undefined)[];
  readonly dt: number;
  write(next: SalivaryState): void;
};

const parameters = loadParameters(new URL('./saliva.parameters.json', import.meta.url));
const basalRateMlPerMin = requireParameter(parameters, 'salivaryGlands.basalRateMlPerMin');
const mealGain = requireParameter(parameters, 'salivaryGlands.mealGain');
const mealWindowMin = requireParameter(parameters, 'salivaryGlands.mealWindowMin');
const dehydrationFactor = requireParameter(parameters, 'salivaryGlands.dehydrationFactor');

const MIN_MM = 0;
const MAX_MM = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mouthMoistureMm(salivaRateMlPerMin: number): number {
  return clamp((100 * salivaRateMlPerMin) / (basalRateMlPerMin * mealGain), MIN_MM, MAX_MM);
}

export const initialState: SalivaryState = {
  salivaRateMlPerMin: basalRateMlPerMin,
  mealStimulusMin: 0,
  mouthMoistureMm: mouthMoistureMm(basalRateMlPerMin),
};

export const fields = {
  salivaRateMlPerMin: { unit: 'mL/min', mode: 'absolute' },
  mealStimulusMin: { unit: 'min', mode: 'absolute' },
  mouthMoistureMm: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isIntake(action: Action | null | undefined): boolean {
  if (action === null || action === undefined || typeof action !== 'object') return false;
  if (action.type !== 'eat' && action.type !== 'drink') return false;
  return typeof action.volumeMl === 'number'
    && Number.isFinite(action.volumeMl)
    && action.volumeMl > 0;
}

function readDeficit(io: IO): number {
  const bodyFluid = io.read('bodyFluid');
  if (bodyFluid === undefined || bodyFluid === null) return 0;
  if (typeof bodyFluid !== 'object') {
    throw new Error('bodyFluid must be an object');
  }
  const deficit = bodyFluid.waterDeficit;
  if (typeof deficit !== 'number' || !Number.isFinite(deficit)) {
    throw new Error('bodyFluid.waterDeficit must be a finite number');
  }
  return clamp(deficit, 0, 1);
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const savedStimulusMin = Math.max(0, finiteOr(prev.mealStimulusMin, 0));
  const dtMin = io.dt / 60;

  let mealStimulusMin = Math.max(0, savedStimulusMin - dtMin);
  if (io.actions.some(isIntake)) mealStimulusMin = mealWindowMin;

  const deficit = readDeficit(io);
  const stimulated = mealStimulusMin > 0 ? mealGain : 1;
  const dehydration = 1 - dehydrationFactor * deficit;
  const salivaRateMlPerMin = basalRateMlPerMin * stimulated * dehydration;

  io.write({
    salivaRateMlPerMin,
    mealStimulusMin,
    mouthMoistureMm: mouthMoistureMm(salivaRateMlPerMin),
  });
}
