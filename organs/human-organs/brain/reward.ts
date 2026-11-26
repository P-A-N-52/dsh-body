/*
 * 部位 `brain/reward`（id: `'reward'`）：大脑中枢奖赏、愉悦余韵与饱足综合模块。
 * 本部位唯一写者；三清单均挂载；无动作、无 transfer、不发通知。
 *
 * 科学方向（全部参数标 `design`，无脑内微透析人体绝对递质标定）：
 * - `wantingMm`：趋近动机代理（受性唤起 `SRC-OEI-2012` 与空腹饥饿素驱动，受餐后/性后饱足及
 *   高皮质醇/剧痛抑制，睡眠期回落）；
 * - `hedonicMm`：中枢愉悦与性后/运动后弛豫缓冲（响应性高潮与催产素 `SRC-BLAICHER-1999`/
 *   `SRC-UVNASMOBERG-2020`、进食营养暴露、中等强度运动，温和缓冲 `hypothalamusEndocrine` 应激与
 *   `interoception.stressMm`，增强 `autonomic` 副交感放松）；
 * - `satietyMm`：享乐饱足抑制（响应高潮与高催乳素 `SRC-KRUGER-2003` 及十二指肠餐后营养暴露）。
 */
import { getNsfwSetting, loadParameters, requireParameter } from '../../../lib/parameters.js';
import { evaluateSexualRelease } from '../sexual-response/response.ts';
import { evaluateSleepTransition } from './wake-evaluation.ts';

export const id = 'reward';
export const actionTypes: string[] = [];

export type RewardState = {
  wantingMm: number;
  hedonicMm: number;
  satietyMm: number;
};

type IO = {
  read(id: 'reward'): Readonly<Partial<RewardState>> | undefined;
  read(id: 'sexualResponse'): Readonly<{
    arousalMm?: unknown;
    lastOrgasmAtSimMin?: unknown;
  }> | undefined;
  read(id: 'ovaries'): unknown;
  read(id: 'testes'): unknown;
  read(id: 'pituitary'): Readonly<{ prolactinNgMl?: unknown; oxytocinPgMl?: unknown }> | undefined;
  read(id: 'physicalActivity'): Readonly<{ remainingExerciseMin?: unknown; intensity?: unknown }> | undefined;
  read(id: 'duodenum'): Readonly<{ nutrientExposure?: unknown }> | undefined;
  read(id: 'stomachGhrelin'): Readonly<{ relativeConcentration?: unknown }> | undefined;
  read(id: 'adrenal'): Readonly<{ cortisolNmolL?: unknown }> | undefined;
  read(id: 'interoception'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'bladder' | 'colon' | 'blood' | 'mammaryGlands'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'uterus'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'pineal'): Readonly<{ melatoninRelative?: unknown }> | undefined;
  read(id: 'sleep'): Readonly<{
    sleeping?: unknown;
    sleepStage?: unknown;
    sleepPressureMm?: unknown;
    sleepDurationMin?: unknown;
  }> | undefined;
  readonly actions: readonly Readonly<{
    type?: unknown;
    reason?: unknown;
    startle?: unknown;
    intensity?: unknown;
    durationMin?: unknown;
  }>[];
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: RewardState): void;
};

const PARAMS = loadParameters(new URL('./reward.parameters.json', import.meta.url));
const basalWantingMm = requireParameter(PARAMS, 'reward.basalWantingMm');
const basalHedonicMm = requireParameter(PARAMS, 'reward.basalHedonicMm');
const sexWantingGain = requireParameter(PARAMS, 'reward.sexWantingGain');
const ghrelinWantingGainMm = requireParameter(PARAMS, 'reward.ghrelinWantingGainMm');
const orgasmHedonicBoostMm = requireParameter(PARAMS, 'reward.orgasmHedonicBoostMm');
const orgasmSatietyBoostMm = requireParameter(PARAMS, 'reward.orgasmSatietyBoostMm');
const exerciseHedonicGainMm = requireParameter(PARAMS, 'reward.exerciseHedonicGainMm');
const mealHedonicGainMm = requireParameter(PARAMS, 'reward.mealHedonicGainMm');
const mealSatietyGainMm = requireParameter(PARAMS, 'reward.mealSatietyGainMm');
const oxytocinHedonicGainMmPerPgMl = requireParameter(PARAMS, 'reward.oxytocinHedonicGainMmPerPgMl');
const stressSuppressionGain = requireParameter(PARAMS, 'reward.stressSuppressionGain');
const wantingHalfTimeMin = requireParameter(PARAMS, 'reward.wantingHalfTimeMin');
const hedonicHalfTimeMin = requireParameter(PARAMS, 'reward.hedonicHalfTimeMin');
const satietyHalfTimeMin = requireParameter(PARAMS, 'reward.satietyHalfTimeMin');

const REFERENCE_CORTISOL_NMOL_L = 180;

export const initialState: RewardState = {
  wantingMm: basalWantingMm,
  hedonicMm: basalHedonicMm,
  satietyMm: 0,
};

export const fields = {
  wantingMm: { unit: 'mm', mode: 'absolute' },
  hedonicMm: { unit: 'mm', mode: 'absolute' },
  satietyMm: { unit: 'mm', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function approach(current: number, target: number, dtMin: number, halfTimeMin: number): number {
  if (dtMin <= 0 || halfTimeMin <= 0) return dtMin <= 0 ? current : target;
  return target + (current - target) * 2 ** (-dtMin / halfTimeMin);
}

export function heartbeat(io: IO): void {
  const prev = io.read(id);
  const prevWanting = clamp(finiteOr(prev?.wantingMm, basalWantingMm), 0, 100);
  const prevHedonic = clamp(finiteOr(prev?.hedonicMm, basalHedonicMm), 0, 100);
  const prevSatiety = clamp(finiteOr(prev?.satietyMm, 0), 0, 100);
  const dtMin = Math.max(0, finiteOr(io.dt, 60) / 60);
  const nsfwEnabled = getNsfwSetting() !== false;

  const sleep = io.read('sleep');
  const prevSleeping = sleep?.sleeping === true;
  const sleepStage = !prevSleeping
    ? 'awake'
    : sleep?.sleepStage === 'deep' || sleep?.sleepStage === 'rem'
      ? sleep.sleepStage
      : 'light';
  const pineal = sleep === undefined ? undefined : io.read('pineal');
  const transition = sleep === undefined
    ? { sleeping: false, wakeEvent: 'none' as const }
    : evaluateSleepTransition(io, {
      prevSleeping,
      sleepStage,
      sleepPressureMm: sleep.sleepPressureMm,
      sleepDurationMin: sleep.sleepDurationMin,
      pinealMelatoninRelative: pineal?.melatoninRelative,
      hasPineal: pineal !== undefined,
      dtMin,
      nsfwEnabled,
    });
  const sleeping = transition.sleeping;
  const sexual = io.read('sexualResponse');
  const ovaries = io.read('ovaries');
  const testes = io.read('testes');
  const pituitary = io.read('pituitary');

  const releaseInfo = evaluateSexualRelease({
    prevSexual: sexual,
    ovaries,
    testes,
    pituitary,
    actions: io.actions ?? [],
    simulatedSeconds: io.simulatedSeconds,
  });
  const releasedThisRound = nsfwEnabled && !sleeping && releaseInfo.released;

  const arousalMm = nsfwEnabled ? clamp(finiteOr(sexual?.arousalMm, 0), 0, 100) : 0;
  const prolactinNgMl = Math.max(0, finiteOr(pituitary?.prolactinNgMl, 8));
  const oxytocinPgMl = Math.max(0, finiteOr(pituitary?.oxytocinPgMl, 2));

  const activity = io.read('physicalActivity');
  const remainingExerciseMin = Math.max(0, finiteOr(activity?.remainingExerciseMin, 0));
  const intensity = clamp(finiteOr(activity?.intensity, 0), 0, 1);
  const moderateExerciseDrive = !sleeping
    && remainingExerciseMin > 0
    && intensity >= 0.4
    && intensity <= 0.88
    ? 1
    : 0;

  const duodenumExposure = Math.max(0, finiteOr(io.read('duodenum')?.nutrientExposure, 0));
  const mealDrive = clamp(duodenumExposure / 8, 0, 1);
  const ghrelinRel = Math.max(0, finiteOr(io.read('stomachGhrelin')?.relativeConcentration, 1));

  const cortisolNmolL = Math.max(0, finiteOr(io.read('adrenal')?.cortisolNmolL, REFERENCE_CORTISOL_NMOL_L));
  const cortisolStressMm = clamp((cortisolNmolL / REFERENCE_CORTISOL_NMOL_L - 1.3) * 50, 0, 100);
  const painMm = Math.max(
    clamp(finiteOr(io.read('interoception')?.discomfort, 0), 0, 100),
    clamp(finiteOr(io.read('uterus')?.crampMm, 0), 0, 100),
  );
  const stressPenalty = stressSuppressionGain * Math.max(cortisolStressMm, painMm);

  const oxytocinBonus = nsfwEnabled ? oxytocinHedonicGainMmPerPgMl * Math.max(0, oxytocinPgMl - 2) : 0;
  const prlSatietyHold = nsfwEnabled ? clamp((prolactinNgMl - 12) * 1.5, 0, 45) : 0;

  const hedonicTarget = sleeping
    ? basalHedonicMm
    : clamp(
      basalHedonicMm
        + mealHedonicGainMm * mealDrive
        + exerciseHedonicGainMm * moderateExerciseDrive
        + oxytocinBonus
        - 0.5 * stressPenalty,
      0,
      100,
    );
  const satietyTarget = clamp(mealSatietyGainMm * mealDrive + prlSatietyHold, 0, 100);

  const hedonicMm = releasedThisRound
    ? clamp(Math.max(prevHedonic, basalHedonicMm + orgasmHedonicBoostMm), 0, 100)
    : clamp(approach(prevHedonic, hedonicTarget, dtMin, hedonicHalfTimeMin), 0, 100);

  const satietyMm = releasedThisRound
    ? clamp(Math.max(prevSatiety, orgasmSatietyBoostMm), 0, 100)
    : clamp(approach(prevSatiety, satietyTarget, dtMin, satietyHalfTimeMin), 0, 100);

  const wantingTarget = sleeping
    ? 0
    : clamp(
      basalWantingMm
        + (nsfwEnabled ? sexWantingGain * arousalMm : 0)
        + ghrelinWantingGainMm * Math.max(0, ghrelinRel - 1)
        - 0.55 * satietyMm
        - 0.6 * stressPenalty,
      0,
      100,
    );
  const wantingMm = clamp(approach(prevWanting, wantingTarget, dtMin, wantingHalfTimeMin), 0, 100);

  io.write({ wantingMm, hedonicMm, satietyMm });
}
