/*
 * 部位 `sexualResponse`：支持两性差异、睾酮/卵巢周期调制与性后余韵的性反应周期模块。
 * 本部位唯一写者；导出共享纯函数 `evaluateSexualRelease` 与 `resolveEffectiveRefractoryMin`
 * 供 `brain/autonomic.ts`、`brain/reward.ts` 与 `uterus/uterus.ts` 在同轮基于轮初快照同步判别高潮。
 *
 * 差异与余韵（design）：
 * - 男性（`testes` 加载）与中性身体保留 `refractoryMin`（20 min）基础不应期，高 PRL（>14 ng/mL）
 *   温和延长不应期（最多 +15 min），不再男女共用死板 20 min；
 * - 女性（加载 `ovaries` 且无 `testes`）取消固定 20 min 绝对不应期，仅保留 2 min 防连跳短停顿
 *   （`femalePostOrgasmPauseMin`），持续刺激可连续唤起与多次高潮，刺激停止后平滑进入
 *   `resolution` 与温热余韵 `afterglowMm`（高潮跃升至 80 mm，半衰期 22 min）。
 */
import { getNsfwSetting, loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'sexualResponse';
export const actionTypes = ['sex', 'orgasm'];

type Phase = 'rest' | 'excitement' | 'plateau' | 'orgasm' | 'refractory' | 'resolution';
type OrgasmBlockReason = 'none' | 'below_threshold' | 'refractory';

type SexualResponseState = {
  arousalMm: number;
  phase: Phase;
  remainingSexMin: number;
  sexIntensity: number;
  lastOrgasmAtSimMin: number | null;
  afterglowMm: number;
  lastAttemptedOrgasmAtSimMin: number | null;
  lastOrgasmBlockReason: OrgasmBlockReason;
};

type SavedSexualResponseState = {
  readonly arousalMm?: unknown;
  readonly remainingSexMin?: unknown;
  readonly sexIntensity?: unknown;
  readonly lastOrgasmAtSimMin?: unknown;
  readonly afterglowMm?: unknown;
  readonly lastAttemptedOrgasmAtSimMin?: unknown;
  readonly lastOrgasmBlockReason?: unknown;
};

type Action = {
  readonly type?: unknown;
  readonly durationMin?: unknown;
  readonly intensity?: unknown;
  readonly continueStimulation?: unknown;
};

type OvariesReading = {
  readonly estradiolPmolL?: unknown;
  readonly progesteroneNmolL?: unknown;
};

type PituitaryReading = {
  readonly prolactinNgMl?: unknown;
};

type IO = {
  read(id: 'sexualResponse'): Readonly<SavedSexualResponseState> | undefined;
  read(id: 'testes'): Readonly<{ testosteroneRelative?: unknown }> | undefined;
  read(id: 'ovaries'): Readonly<OvariesReading> | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | undefined;
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
const femalePostOrgasmPauseMin = requireParameter(
  parameters,
  'sexualResponse.femalePostOrgasmPauseMin',
);
const afterglowHalfTimeMin = requireParameter(parameters, 'sexualResponse.afterglowHalfTimeMin');
const stimulusHalfSaturation = requireParameter(
  parameters,
  'sexualResponse.stimulusHalfSaturation',
);
const stimulusFloorWeight = requireParameter(parameters, 'sexualResponse.stimulusFloorWeight');

const AFTERGLOW_PEAK_MM = 80;

export const initialState: SexualResponseState = {
  arousalMm: 0,
  phase: 'rest',
  remainingSexMin: 0,
  sexIntensity: 0,
  lastOrgasmAtSimMin: null,
  afterglowMm: 0,
  lastAttemptedOrgasmAtSimMin: null,
  lastOrgasmBlockReason: 'none',
};

export const fields = {
  arousalMm: { unit: 'mm', mode: 'absolute' },
  phase: { unit: '-', mode: 'absolute' },
  remainingSexMin: { unit: 'min', mode: 'absolute' },
  sexIntensity: { unit: '1', mode: 'absolute' },
  lastOrgasmAtSimMin: { unit: 'min', mode: 'absolute' },
  afterglowMm: { unit: 'mm', mode: 'absolute' },
  lastAttemptedOrgasmAtSimMin: { unit: 'min', mode: 'absolute' },
  lastOrgasmBlockReason: { unit: '-', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function savedOrgasmMinute(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function savedBlockReason(value: unknown): OrgasmBlockReason {
  return value === 'below_threshold' || value === 'refractory' ? value : 'none';
}

function hasOrgasmAction(actions: readonly Action[]): boolean {
  return actions.some((action) => action?.type === 'orgasm');
}

function sexReplacement(
  action: Action,
): { remainingSexMin: number; sexIntensity: number } | undefined {
  if (action?.type !== 'sex') return undefined;

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

export function resolveEffectiveRefractoryMin({
  ovaries,
  testes,
  pituitary,
}: {
  ovaries?: unknown;
  testes?: unknown;
  pituitary?: Readonly<PituitaryReading> | undefined;
}): number {
  const isFemaleProfile = ovaries !== undefined && ovaries !== null && (testes === undefined || testes === null);
  if (isFemaleProfile) {
    return femalePostOrgasmPauseMin;
  }
  const prolactinNgMl = Math.max(0, finiteOr(pituitary?.prolactinNgMl, 8));
  const prlProlongationMin = clamp((prolactinNgMl - 14) * 0.5, 0, 15);
  return refractoryMin + prlProlongationMin;
}

export function evaluateSexualRelease({
  prevSexual,
  ovaries,
  testes,
  pituitary,
  actions,
  simulatedSeconds,
}: {
  prevSexual: Readonly<SavedSexualResponseState> | undefined;
  ovaries?: unknown;
  testes?: unknown;
  pituitary?: Readonly<PituitaryReading> | undefined;
  actions: readonly Action[];
  simulatedSeconds: number;
}): {
  voluntaryRelease: boolean;
  forcedRelease: boolean;
  released: boolean;
  refractory: boolean;
  effectiveRefractoryMin: number;
} {
  const simMin = finiteOr(simulatedSeconds, 0) / 60;
  const prevArousal = clamp(finiteOr(prevSexual?.arousalMm, 0), 0, 100);
  const lastOrgasmAtSimMin = savedOrgasmMinute(prevSexual?.lastOrgasmAtSimMin);
  const sincePreviousOrgasm = lastOrgasmAtSimMin === null
    ? Number.POSITIVE_INFINITY
    : simMin - lastOrgasmAtSimMin;
  const effectiveRefractoryMin = resolveEffectiveRefractoryMin({ ovaries, testes, pituitary });
  const refractory = sincePreviousOrgasm < effectiveRefractoryMin;
  const nsfwEnabled = getNsfwSetting() !== false;

  const voluntaryRelease = nsfwEnabled
    && !refractory
    && hasOrgasmAction(actions)
    && prevArousal >= orgasmAllowedMm;
  const forcedRelease = nsfwEnabled && !refractory && prevArousal >= orgasmForcedMm;
  return {
    voluntaryRelease,
    forcedRelease,
    released: voluntaryRelease || forcedRelease,
    refractory,
    effectiveRefractoryMin,
  };
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = Math.max(0, finiteOr(io.dt, 0) / 60);
  const simMin = finiteOr(io.simulatedSeconds, 0) / 60;
  const prevArousal = clamp(finiteOr(prev.arousalMm, 0), 0, 100);
  const prevAfterglow = clamp(finiteOr(prev.afterglowMm, 0), 0, 100);
  let lastOrgasmAtSimMin = savedOrgasmMinute(prev.lastOrgasmAtSimMin);
  let lastAttemptedOrgasmAtSimMin = savedOrgasmMinute(prev.lastAttemptedOrgasmAtSimMin);
  let lastOrgasmBlockReason: OrgasmBlockReason = savedBlockReason(prev.lastOrgasmBlockReason);

  const ovaries = io.read('ovaries');
  const testes = io.read('testes');
  const pituitary = io.read('pituitary');
  const releaseInfo = evaluateSexualRelease({
    prevSexual: prev,
    ovaries,
    testes,
    pituitary,
    actions: io.actions,
    simulatedSeconds: io.simulatedSeconds,
  });

  let remainingSexMin = Math.max(0, finiteOr(prev.remainingSexMin, 0) - dtMin);
  let sexIntensity = remainingSexMin > 0 ? clamp(finiteOr(prev.sexIntensity, 0), 0, 1) : 0;

  for (const action of io.actions) {
    if (action?.type === 'orgasm') {
      if (releaseInfo.released && action.continueStimulation !== true) {
        remainingSexMin = 0;
        sexIntensity = 0;
      }
      continue;
    }
    const replacement = sexReplacement(action);
    if (replacement !== undefined) {
      remainingSexMin = replacement.remainingSexMin;
      sexIntensity = replacement.sexIntensity;
    }
  }

  const nsfwEnabled = getNsfwSetting() !== false;
  const attemptedOrgasm = hasOrgasmAction(io.actions);
  if (releaseInfo.released) {
    lastOrgasmAtSimMin = simMin;
    lastOrgasmBlockReason = 'none';
    if (attemptedOrgasm) lastAttemptedOrgasmAtSimMin = simMin;
  } else if (attemptedOrgasm) {
    lastAttemptedOrgasmAtSimMin = simMin;
    lastOrgasmBlockReason = !nsfwEnabled
      ? 'none'
      : releaseInfo.refractory
        ? 'refractory'
        : 'below_threshold';
  } else if (prevArousal >= orgasmAllowedMm && !releaseInfo.refractory) {
    lastOrgasmBlockReason = 'none';
  }

  const active = remainingSexMin > 0 && sexIntensity > 0;
  let hormoneFactor = 1;
  let riseSpeedFactor = 1;
  if (testes !== undefined && testes !== null) {
    const testosteroneRelative = Math.max(0, finiteOr(testes.testosteroneRelative, 1));
    hormoneFactor = 0.5 + 0.5 * testosteroneRelative;
    riseSpeedFactor = testosteroneRelative > 1 ? hormoneFactor : 1;
  } else if (ovaries !== undefined && ovaries !== null) {
    const e2 = finiteOr(ovaries.estradiolPmolL, 140);
    const p4 = finiteOr(ovaries.progesteroneNmolL, 1.3);
    hormoneFactor = clamp(1 + 0.12 * ((e2 - 140) / 800) - 0.08 * (p4 / 42), 0.9, 1.15);
    riseSpeedFactor = hormoneFactor > 1 ? hormoneFactor : 1;
  }

  // 工程假定/占位（design，无文献强度分档斜率；潜伏期量级参照 SRC-LEVIN-1985）：持续低中强度刺激经饱和曲线可越过 70 mm，微弱试探性接触则受限
  const stimulusTargetFraction = sexIntensity > 0
    ? (stimulusFloorWeight + (1 - stimulusFloorWeight) * sexIntensity)
      * (((1 + stimulusHalfSaturation) * sexIntensity) / (sexIntensity + stimulusHalfSaturation))
    : 0;
  const target = active && !releaseInfo.refractory && !releaseInfo.released
    ? clamp(100 * stimulusTargetFraction * hormoneFactor, 0, 100)
    : 0;
  const stimulusSpeedFactor = 0.95 + 0.05 * sexIntensity;
  const riseHalfTimeMin = arousalHalfTimeMin / Math.max(0.5, riseSpeedFactor * stimulusSpeedFactor);
  const halfTimeMin = target > prevArousal ? riseHalfTimeMin : resolutionHalfTimeMin;
  const arousalMm = clamp(
    target + (prevArousal - target) * 2 ** (-dtMin / halfTimeMin),
    0,
    100,
  );

  const afterglowMm = releaseInfo.released
    ? AFTERGLOW_PEAK_MM
    : clamp(prevAfterglow * 2 ** (-dtMin / afterglowHalfTimeMin), 0, 100);

  const sinceOrgasm = lastOrgasmAtSimMin === null
    ? Number.POSITIVE_INFINITY
    : simMin - lastOrgasmAtSimMin;
  const phase: Phase = sinceOrgasm < orgasmDurationMin
    ? 'orgasm'
    : sinceOrgasm < releaseInfo.effectiveRefractoryMin
      ? 'refractory'
      : active
        ? (arousalMm < 60 ? 'excitement' : 'plateau')
        : arousalMm >= 10 ? 'resolution' : 'rest';
  if (phase === 'rest' && !attemptedOrgasm) {
    lastOrgasmBlockReason = 'none';
  }

  io.write({
    arousalMm,
    phase,
    remainingSexMin,
    sexIntensity,
    lastOrgasmAtSimMin,
    afterglowMm,
    lastAttemptedOrgasmAtSimMin,
    lastOrgasmBlockReason,
  });
}
