/*
 * 部位 `sexualResponse`：性别中立的性反应周期与性活动强度代理。本部位唯一写者；
 * 无 transfer、无性别差异、不发通知，也不写其他部位；每轮只读轮初自身状态与本轮原始动作。
 *
 * 动作：
 * - `sex { durationMin, intensity }`：校验与 `skeletal-muscle/activity.ts` 的 `exercise`
 *   相同——intensity 有限且落在 (0, 1]，durationMin 有限且 > 0；非法动作忽略、不改变状态，
 *   同一轮多条合法动作只取最后一条，用其 durationMin/intensity 替换剩余分钟与强度，不累加。
 * - `orgasm`：无载荷。只在轮初 `arousalMm >= orgasmAllowedMm` 时释放；低于该值被忽略，
 *   不改变状态。高潮不再由唤醒跨阈值自动记录。
 *
 * 消费者（两条，均为轮初读取）
 * - `physicalActivity`：把 `sex` 与 `exercise` 一样按强度 × 时长计入剩余体力活动。
 * - `interoception`：软读 `arousalMm`，输出体感读数 `sexualArousalMm`（只进 body_state，
 *   不进 discomfort、不发通知）。
 *
 * 公式（dtMin = io.dt / 60，simMin = io.simulatedSeconds / 60）：
 *   remainingSexMin = max(0, prev.remainingSexMin − dtMin)，合法 sex 动作整体替换
 *   sexIntensity 只由 sex 动作替换，活动结束后保留最后一个值
 *   active = remainingSexMin > 0 && sexIntensity > 0
 *   sinceOrgasm = lastOrgasmAtSimMin === null ? Infinity : simMin − lastOrgasmAtSimMin
 *   refractory = sinceOrgasm < refractoryMin（释放判定用更新前的记录）
 *   target = active && !refractory ? 100 × sexIntensity : 0
 *   halfTime = target > prevArousal ? arousalHalfTimeMin : resolutionHalfTimeMin
 *   arousalMm = target + (prevArousal − target) × 2^(−dtMin / halfTime)
 *
 *   release（高潮，两条路径，都用轮初 arousalMm 判定）：
 *     主动：本轮含 orgasm 动作且 prevArousal >= orgasmAllowedMm
 *     强制：prevArousal >= orgasmForcedMm，无需动作
 *     任一成立 → lastOrgasmAtSimMin = simMin（每轮最多记一次）
 *     主动动作在 prevArousal < orgasmAllowedMm 时被忽略，不改变状态
 *
 *   phase 在记录释放之后求值（sinceOrgasm 用更新后的值）：
 *     sinceOrgasm < orgasmDurationMin → 'orgasm'
 *     sinceOrgasm < refractoryMin     → 'refractory'
 *     active                          → arousalMm < 60 ? 'excitement' : 'plateau'
 *     arousalMm >= 10                 → 'resolution'
 *     否则                            → 'rest'
 *
 * 证据：本切片无登记来源。兴奋/平台/高潮/消退/不应期只是通用反应周期的工程骨架；
 * 半时、阈值与时长都在同目录 `response.parameters.json`，全部 `status: design`、
 * `source: null`，不是人体测量、拟合或独立验证。`arousalMm` 是 0–100 代理，不是生理测量；
 * `sexIntensity` 是模型内相对强度，不是 MET、心率、耗氧量或能量消耗。
 *
 * 未建模（design）：催产素 / 催乳素 / 内啡肽等激素，心率 / 血压 / 通气量，受孕 / 妊娠 /
 * 生育力窗，性欲与情绪，伴侣，性传播感染，避孕，性活动类型、性别差异与个体差异，
 * 任何显性内容；也不反推历史。旧存档缺字段按 0 / null 补齐，重启保留剩余分钟与
 * `lastOrgasmAtSimMin`。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'sexualResponse';
export const actionTypes = ['sex', 'orgasm'];

type Phase = 'rest' | 'excitement' | 'plateau' | 'orgasm' | 'refractory' | 'resolution';

type SexualResponseState = {
  arousalMm: number;
  phase: Phase;
  remainingSexMin: number;
  sexIntensity: number;
  lastOrgasmAtSimMin: number | null;
};

type SavedSexualResponseState = {
  readonly arousalMm?: unknown;
  readonly remainingSexMin?: unknown;
  readonly sexIntensity?: unknown;
  readonly lastOrgasmAtSimMin?: unknown;
};

type Action = {
  readonly type?: unknown;
  readonly durationMin?: unknown;
  readonly intensity?: unknown;
};

type IO = {
  read(id: 'sexualResponse'): Readonly<SavedSexualResponseState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: SexualResponseState): void;
};

const parameters = loadParameters(
  new URL('./response.parameters.json', import.meta.url),
);
const arousalHalfTimeMin = requireParameter(parameters, 'sexualResponse.arousalHalfTimeMin');
const resolutionHalfTimeMin = requireParameter(
  parameters,
  'sexualResponse.resolutionHalfTimeMin',
);
const orgasmAllowedMm = requireParameter(parameters, 'sexualResponse.orgasmAllowedMm');
const orgasmForcedMm = requireParameter(parameters, 'sexualResponse.orgasmForcedMm');
const orgasmDurationMin = requireParameter(parameters, 'sexualResponse.orgasmDurationMin');
const refractoryMin = requireParameter(parameters, 'sexualResponse.refractoryMin');

export const initialState: SexualResponseState = {
  arousalMm: 0,
  phase: 'rest',
  remainingSexMin: 0,
  sexIntensity: 0,
  lastOrgasmAtSimMin: null,
};

export const fields = {
  arousalMm: { unit: 'mm', mode: 'absolute' },
  phase: { unit: '-', mode: 'absolute' },
  remainingSexMin: { unit: 'min', mode: 'absolute' },
  sexIntensity: { unit: '1', mode: 'absolute' },
  lastOrgasmAtSimMin: { unit: 'min', mode: 'absolute' },
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function savedOrgasmMinute(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasOrgasmAction(actions: readonly Action[]): boolean {
  return actions.some((action) => action.type === 'orgasm');
}

function sexReplacement(
  action: Action,
): { remainingSexMin: number; sexIntensity: number } | undefined {
  if (action.type !== 'sex') return undefined;

  const { intensity, durationMin } = action;
  if (typeof intensity !== 'number'
    || !Number.isFinite(intensity)
    || intensity <= 0
    || intensity > 1) {
    return undefined;
  }
  if (typeof durationMin !== 'number' || !Number.isFinite(durationMin) || durationMin <= 0) {
    return undefined;
  }

  return { remainingSexMin: durationMin, sexIntensity: intensity };
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = Math.max(0, finiteOr(io.dt, 0) / 60);
  const simMin = finiteOr(io.simulatedSeconds, 0) / 60;

  let remainingSexMin = Math.max(0, finiteOr(prev.remainingSexMin, 0) - dtMin);
  let sexIntensity = finiteOr(prev.sexIntensity, 0);

  for (const action of io.actions) {
    const replacement = sexReplacement(action);
    if (replacement !== undefined) {
      remainingSexMin = replacement.remainingSexMin;
      sexIntensity = replacement.sexIntensity;
    }
  }

  const prevArousal = finiteOr(prev.arousalMm, 0);
  let lastOrgasmAtSimMin = savedOrgasmMinute(prev.lastOrgasmAtSimMin);

  const active = remainingSexMin > 0 && sexIntensity > 0;
  const sincePreviousOrgasm = lastOrgasmAtSimMin === null
    ? Number.POSITIVE_INFINITY
    : simMin - lastOrgasmAtSimMin;
  const refractory = sincePreviousOrgasm < refractoryMin;
  const target = active && !refractory ? 100 * sexIntensity : 0;
  const halfTimeMin = target > prevArousal ? arousalHalfTimeMin : resolutionHalfTimeMin;
  const arousalMm = target + (prevArousal - target) * 2 ** (-dtMin / halfTimeMin);

  const voluntaryRelease = hasOrgasmAction(io.actions) && prevArousal >= orgasmAllowedMm;
  const forcedRelease = prevArousal >= orgasmForcedMm;
  if (voluntaryRelease || forcedRelease) {
    lastOrgasmAtSimMin = simMin;
  }

  const sinceOrgasm = lastOrgasmAtSimMin === null
    ? Number.POSITIVE_INFINITY
    : simMin - lastOrgasmAtSimMin;
  const phase: Phase = sinceOrgasm < orgasmDurationMin
    ? 'orgasm'
    : sinceOrgasm < refractoryMin
      ? 'refractory'
      : active
        ? (arousalMm < 60 ? 'excitement' : 'plateau')
        : arousalMm >= 10 ? 'resolution' : 'rest';

  io.write({
    arousalMm,
    phase,
    remainingSexMin,
    sexIntensity,
    lastOrgasmAtSimMin,
  });
}
