/*
 * 部位 `pituitary`：垂体前叶与后叶（催产素）分泌–清除脚本。
 *
 * 物理浓度与实证半衰期：
 * - `tshRelative` (`1`): TRH × (1 + gain × (1 - T4)) 驱动，t½ = 53.9 min（SRC-ODELL-1967，prior）。
 * - `acthPgMl` (`pg/mL`): 基线 12 pg/mL（参考 SRC-HORROCKS-1990 mesor 9.2–18.6 ng/L），
 *   受 CRH 与皮质醇比值负反馈驱动，t½ = 20 min（SRC-KEENAN-2004，prior）。
 * - `prolactinNgMl` (`ng/mL`): 昼夜谐波 2.1 ng/mL（SRC-VELDHUIS-1988，prior）+ 睡眠抬升 +
 *   乳头机械吸吮/泵乳刺激时长驱动（与排乳体积解耦，SRC-UVNASMOBERG-2020）+ 性高潮急性脉冲
 *   （SRC-KRUGER-2003），慢相清除 t½ = 34.6 min。移除旧版用 `milkMl > 0` 充当吸吮代理的自激环。
 * - `oxytocinPgMl` (`pg/mL`): 提取 RIA 口径基线 2 pg/mL（SRC-UVNASMOBERG-2020），响应
 *   吸吮/泵乳、性唤起与高潮突增（SRC-BLAICHER-1999），清除 t½ = 3.8 min（参考 SRC-FABIAN-1969）。
 */
import { resolveCircadianHour } from '../../../lib/circadian.js';
import {
  getNsfwSetting,
  getProfileLactating,
  loadParameters,
  requireParameter,
} from '../../../lib/parameters.js';

export const id = 'pituitary';
export const actionTypes: string[] = [];

type PituitaryState = {
  tshRelative: number;
  acthPgMl: number;
  prolactinNgMl: number;
  oxytocinPgMl: number;
};

type MammaryGlandsReading = {
  lactating?: unknown;
  stimulationMin?: unknown;
};

type SexualResponseReading = {
  arousalMm?: unknown;
  phase?: unknown;
  lastOrgasmAtSimMin?: unknown;
};

type IO = {
  read(id: 'pituitary'): Readonly<Partial<PituitaryState>> | undefined;
  read(id: 'hypothalamusEndocrine'): Readonly<{ trhRelative?: unknown; crhRelative?: unknown }> | undefined;
  read(id: 'thyroid'): Readonly<{ thyroxineRelative?: unknown }> | undefined;
  read(id: 'adrenal'): Readonly<{ cortisolNmolL?: unknown }> | undefined;
  read(id: 'mammaryGlands'): Readonly<MammaryGlandsReading> | undefined;
  read(id: 'sleep'): Readonly<{ sleeping?: unknown }> | undefined;
  read(id: 'sexualResponse'): Readonly<SexualResponseReading> | undefined;
  readonly actions?: readonly Readonly<{ type?: unknown }>[];
  readonly dt: number;
  readonly simulatedSeconds?: number;
  readonly wallTimeMs?: number;
  write(next: PituitaryState): void;
};

const parameters = loadParameters(new URL('./pituitary.parameters.json', import.meta.url));
const tshFeedbackGain = requireParameter(parameters, 'pituitary.tshFeedbackGain');
const tshHalfTimeMin = requireParameter(parameters, 'pituitary.tshHalfTimeMin');
const acthBasalPgMl = requireParameter(parameters, 'pituitary.acthBasalPgMl');
const acthFeedbackGain = requireParameter(parameters, 'pituitary.acthFeedbackGain');
const acthHalfTimeMin = requireParameter(parameters, 'pituitary.acthHalfTimeMin');
const prolactinBasalNgMl = requireParameter(parameters, 'pituitary.prolactinBasalNgMl');
const prolactinCircadianAmplitudeNgMl = requireParameter(
  parameters,
  'pituitary.prolactinCircadianAmplitudeNgMl',
);
const prolactinSleepBoostNgMl = requireParameter(parameters, 'pituitary.prolactinSleepBoostNgMl');
const prolactinSucklingGainNgMl = requireParameter(parameters, 'pituitary.prolactinSucklingGainNgMl');
const prolactinOrgasmBoostNgMl = requireParameter(parameters, 'pituitary.prolactinOrgasmBoostNgMl');
const prolactinHalfTimeMin = requireParameter(parameters, 'pituitary.prolactinHalfTimeMin');
const oxytocinBasalPgMl = requireParameter(parameters, 'pituitary.oxytocinBasalPgMl');
const oxytocinSucklingBoostPgMl = requireParameter(parameters, 'pituitary.oxytocinSucklingBoostPgMl');
const oxytocinArousalGainPgMl = requireParameter(parameters, 'pituitary.oxytocinArousalGainPgMl');
const oxytocinOrgasmBoostPgMl = requireParameter(parameters, 'pituitary.oxytocinOrgasmBoostPgMl');
const oxytocinHalfTimeMin = requireParameter(parameters, 'pituitary.oxytocinHalfTimeMin');

const REFERENCE_CORTISOL_NMOL_L = 180;
const LACTATION_BASAL_PRL_NG_ML = 35;
const PRESET_LACTATION_PRL_NG_ML = 60;
const MIN_TSH = 0;
const MAX_TSH = 3;
const MIN_ACTH_PG_ML = 0;
const MAX_ACTH_PG_ML = 120;
const MIN_PRL_NG_ML = 0;
const MAX_PRL_NG_ML = 300;
const MIN_OT_PG_ML = 0;
const MAX_OT_PG_ML = 100;

const presetLactating = getNsfwSetting() !== false && getProfileLactating();

export const initialState: PituitaryState = {
  tshRelative: 1,
  acthPgMl: acthBasalPgMl,
  prolactinNgMl: presetLactating ? PRESET_LACTATION_PRL_NG_ML : prolactinBasalNgMl,
  oxytocinPgMl: oxytocinBasalPgMl,
};

export const fields = {
  tshRelative: { unit: '1', mode: 'absolute' },
  acthPgMl: { unit: 'pg/mL', mode: 'absolute' },
  prolactinNgMl: { unit: 'ng/mL', mode: 'absolute' },
  oxytocinPgMl: { unit: 'pg/mL', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function requireNonNegativeField(
  part: Readonly<{ [field: string]: unknown }> | undefined,
  partId: string,
  field: string,
  fallback: number,
): number {
  if (part === undefined) return fallback;
  if (part === null || typeof part !== 'object') {
    throw new Error(`pituitary: invalid ${partId}`);
  }
  const value = part[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`pituitary: invalid ${partId}.${field}: ${String(value)}`);
  }
  return value;
}

function readMammaryStimulation(part: Readonly<MammaryGlandsReading> | undefined): {
  present: boolean;
  lactating: boolean;
  stimulationMin: number;
} {
  if (part === undefined) return { present: false, lactating: false, stimulationMin: 0 };
  if (part === null || typeof part !== 'object') {
    throw new Error('pituitary: invalid mammaryGlands');
  }
  if (part.lactating !== undefined && typeof part.lactating !== 'boolean') {
    throw new Error(`pituitary: invalid mammaryGlands.lactating: ${String(part.lactating)}`);
  }
  const stim = part.stimulationMin;
  if (typeof stim !== 'number' || !Number.isFinite(stim) || stim < 0) {
    throw new Error(`pituitary: invalid mammaryGlands.stimulationMin: ${String(stim)}`);
  }
  return {
    present: true,
    lactating: part.lactating === true,
    stimulationMin: stim,
  };
}

function resolvePrevState(saved: Readonly<Partial<PituitaryState>> | undefined): PituitaryState {
  if (!saved) return initialState;
  const tshRelative = finiteOr(saved.tshRelative, initialState.tshRelative);
  const acthPgMl = finiteOr(saved.acthPgMl, initialState.acthPgMl);
  const prolactinNgMl = finiteOr(saved.prolactinNgMl, initialState.prolactinNgMl);
  const oxytocinPgMl = finiteOr(saved.oxytocinPgMl, initialState.oxytocinPgMl);
  return { tshRelative, acthPgMl, prolactinNgMl, oxytocinPgMl };
}

function approach(current: number, target: number, dtMin: number, halfTimeMin: number): number {
  if (dtMin <= 0 || halfTimeMin <= 0) return dtMin <= 0 ? current : target;
  return target + (current - target) * 2 ** (-dtMin / halfTimeMin);
}

export function heartbeat(io: IO): void {
  const hypothalamus = io.read('hypothalamusEndocrine');
  const trh = requireNonNegativeField(hypothalamus, 'hypothalamusEndocrine', 'trhRelative', 1);
  const crh = requireNonNegativeField(hypothalamus, 'hypothalamusEndocrine', 'crhRelative', 1);
  const thyroxine = requireNonNegativeField(io.read('thyroid'), 'thyroid', 'thyroxineRelative', 1);
  const cortisolNmolL = requireNonNegativeField(
    io.read('adrenal'),
    'adrenal',
    'cortisolNmolL',
    REFERENCE_CORTISOL_NMOL_L,
  );
  const cortisolRatio = cortisolNmolL / REFERENCE_CORTISOL_NMOL_L;
  const mammary = readMammaryStimulation(io.read('mammaryGlands'));

  const nsfwEnabled = getNsfwSetting() !== false;
  const actions = io.actions ?? [];
  const lactationActionThisRound = nsfwEnabled && mammary.present
    && actions.some((a) => a?.type === 'express_milk' || a?.type === 'breastfeed');
  const effectiveStimulationMin = nsfwEnabled
    ? Math.max(mammary.stimulationMin, lactationActionThisRound ? 8 : 0)
    : 0;

  const sleep = io.read('sleep');
  const sleeping = sleep?.sleeping === true;
  const hour = typeof io.wallTimeMs === 'number' && Number.isFinite(io.wallTimeMs)
    ? resolveCircadianHour(io.wallTimeMs)
    : resolveCircadianHour(finiteOr(io.simulatedSeconds, 0) * 1000, { timezoneOffsetMin: 0 });
  const circadianPrlDrive = sleep !== undefined
    ? prolactinCircadianAmplitudeNgMl * Math.cos((2 * Math.PI * (hour - 4)) / 24)
      + (sleeping ? prolactinSleepBoostNgMl : 0)
    : 0;

  const sexual = io.read('sexualResponse');
  const simMin = finiteOr(io.simulatedSeconds, 0) / 60;
  const lastOrgasmMin = typeof sexual?.lastOrgasmAtSimMin === 'number'
    && Number.isFinite(sexual.lastOrgasmAtSimMin)
    ? sexual.lastOrgasmAtSimMin
    : null;
  const sinceOrgasmMin = lastOrgasmMin === null ? Number.POSITIVE_INFINITY : simMin - lastOrgasmMin;
  const arousalMm = nsfwEnabled ? clamp(finiteOr(sexual?.arousalMm, 0), 0, 100) : 0;
  const inOrgasmPrlWindow = nsfwEnabled
    && (sexual?.phase === 'orgasm' || (sinceOrgasmMin >= 0 && sinceOrgasmMin < 8));
  const inOrgasmOtWindow = nsfwEnabled
    && (sexual?.phase === 'orgasm' || (sinceOrgasmMin >= 0 && sinceOrgasmMin < 3));

  const tshTarget = clamp(
    trh * (1 + tshFeedbackGain * (1 - thyroxine)),
    MIN_TSH,
    MAX_TSH,
  );
  const acthTarget = clamp(
    acthBasalPgMl * crh * (1 + acthFeedbackGain * (1 - cortisolRatio)),
    MIN_ACTH_PG_ML,
    MAX_ACTH_PG_ML,
  );

  const prlFloor = nsfwEnabled && mammary.lactating
    ? Math.max(prolactinBasalNgMl, LACTATION_BASAL_PRL_NG_ML)
    : prolactinBasalNgMl;
  const sucklingPrlDrive = effectiveStimulationMin > 0
    ? prolactinSucklingGainNgMl * clamp(effectiveStimulationMin / 8, 0.35, 1)
    : 0;
  const orgasmPrlDrive = inOrgasmPrlWindow ? prolactinOrgasmBoostNgMl : 0;
  const prolactinTarget = clamp(
    prlFloor + circadianPrlDrive + sucklingPrlDrive + orgasmPrlDrive,
    MIN_PRL_NG_ML,
    MAX_PRL_NG_ML,
  );

  const oxytocinTarget = clamp(
    oxytocinBasalPgMl
      + (effectiveStimulationMin > 0 ? oxytocinSucklingBoostPgMl : 0)
      + oxytocinArousalGainPgMl * (arousalMm / 100)
      + (inOrgasmOtWindow ? oxytocinOrgasmBoostPgMl : 0),
    MIN_OT_PG_ML,
    MAX_OT_PG_ML,
  );

  const prev = resolvePrevState(io.read(id));
  const dtMin = Math.max(0, finiteOr(io.dt, 0) / 60);

  io.write({
    tshRelative: clamp(approach(prev.tshRelative, tshTarget, dtMin, tshHalfTimeMin), MIN_TSH, MAX_TSH),
    acthPgMl: clamp(approach(prev.acthPgMl, acthTarget, dtMin, acthHalfTimeMin), MIN_ACTH_PG_ML, MAX_ACTH_PG_ML),
    prolactinNgMl: clamp(
      approach(prev.prolactinNgMl, prolactinTarget, dtMin, prolactinHalfTimeMin),
      MIN_PRL_NG_ML,
      MAX_PRL_NG_ML,
    ),
    oxytocinPgMl: clamp(
      approach(prev.oxytocinPgMl, oxytocinTarget, dtMin, oxytocinHalfTimeMin),
      MIN_OT_PG_ML,
      MAX_OT_PG_ML,
    ),
  });
}
