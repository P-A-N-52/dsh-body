/**
 * 自主神经系统（`autonomic`）：维护交感神经张力（`sympatheticMm`）、副交感张力（`parasympatheticMm`）
 * 与惊醒余波标记（`startleActive`）。
 *
 * 科学方向（均标 design，无独立人体微神经标定）：
 * - `SRC-SOMERS-1993` (somers-1993.md, N Engl J Med 1993;328:303–307)：NREM 深睡期交感活性
 *   显著降至清醒态约 41%（副交感主导），REM 睡眠期出现交感升高与波动，Stage 2 唤醒刺激伴
 *   短暂交感暴发。
 * - 时机门控：
 *   1. 惊醒爆发仅在**睡眠中**（`prevSleeping === true`）受紧急危机或 `wake_up { startle: true }`
 *      唤醒时触发；已经清醒或正常醒来不会平白触发惊醒交感爆发；
 *   2. 正常过夜空腹稳态（~74 mg/dL）与睡期体温昼夜下调（~36.55°C）不触发交感兴奋；
 *   3. 入睡当轮即抑除运动驱动并加速平复残余交感、转入副交感主导；自然醒当轮立即释放副交感；
 *   4. 清醒期强烈疼痛/不适与性高潮推动一过性交感升高，但高潮不置 `startleActive`。
 */
import {
  getDefaultCoreBaselineC, getNsfwSetting, getThermalProfile, hasParameterOverride,
  loadParameters, requireParameter,
} from '../../../lib/parameters.js';
import { evaluateSexualRelease } from '../sexual-response/response.ts';
import {
  evaluateSleepTransition,
  evaluateSleepWakeSignals,
  type SleepStage,
} from './wake-evaluation.ts';

export const id = 'autonomic';
export const actionTypes: string[] = [];

export interface AutonomicState {
  sympatheticMm: number;
  parasympatheticMm: number;
  startleActive: boolean;
}

interface AutonomicIo {
  getThermalProfile?: typeof getThermalProfile;
  read(id: 'autonomic'): Readonly<AutonomicState> | undefined;
  read(id: 'sleep'): Readonly<{
    sleeping?: unknown;
    sleepStage?: unknown;
    sleepPressureMm?: unknown;
    sleepDurationMin?: unknown;
  }> | undefined;
  read(id: 'pineal'): Readonly<{ melatoninRelative?: unknown }> | undefined;
  read(id: 'physicalActivity'): Readonly<{ remainingExerciseMin?: unknown; intensity?: unknown }> | undefined;
  read(id: 'glucose'): Readonly<{ concentrationMgDl?: unknown }> | undefined;
  read(id: 'bloodOxygen'): Readonly<{ oxygenDeficit?: unknown }> | undefined;
  read(id: 'blood'): Readonly<{ systolicMmHg?: unknown }> | undefined;
  read(id: 'thermoregulation'): Readonly<{ coreTemperatureC?: unknown; setpointC?: unknown }> | undefined;
  read(id: 'interoception'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'bladder'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'colon'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'uterus'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'mammaryGlands'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'sexualResponse'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'ovaries'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'testes'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'pituitary'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'reward'): Readonly<Record<string, unknown>> | undefined;
  readonly actions: readonly Readonly<{
    type?: unknown;
    reason?: unknown;
    startle?: unknown;
    intensity?: unknown;
    durationMin?: unknown;
  }>[];
  readonly dt: number;
  readonly simulatedSeconds?: number;
  write(next: AutonomicState): void;
}

const PARAMS = loadParameters(new URL('./autonomic.parameters.json', import.meta.url));
const basalParasympatheticMm = requireParameter(PARAMS, 'autonomic.basalParasympatheticMm');
const sleepParasympatheticMm = requireParameter(PARAMS, 'autonomic.sleepParasympatheticMm');
const startleBurstMm = requireParameter(PARAMS, 'autonomic.startleBurstMm');
const riseHalfTimeMin = requireParameter(PARAMS, 'autonomic.riseHalfTimeMin');
const decayHalfTimeMin = requireParameter(PARAMS, 'autonomic.decayHalfTimeMin');
const startleClearThresholdMm = requireParameter(PARAMS, 'autonomic.startleClearThresholdMm');
const exerciseSympatheticGain = requireParameter(PARAMS, 'autonomic.exerciseSympatheticGain');
const hypoglycemiaThresholdMgDl = requireParameter(PARAMS, 'autonomic.hypoglycemiaThresholdMgDl');
const hypoglycemiaGainPerMgDl = requireParameter(PARAMS, 'autonomic.hypoglycemiaGainPerMgDl');
const hypoxiaGain = requireParameter(PARAMS, 'autonomic.hypoxiaGain');
const hypotensionThresholdMmHg = requireParameter(PARAMS, 'autonomic.hypotensionThresholdMmHg');
const hypotensionGainPerMmHg = requireParameter(PARAMS, 'autonomic.hypotensionGainPerMmHg');
const coldThresholdC = requireParameter(PARAMS, 'autonomic.coldThresholdC');
const coldGainPerC = requireParameter(PARAMS, 'autonomic.coldGainPerC');
const sleepColdThresholdOffsetC = requireParameter(PARAMS, 'autonomic.sleepColdThresholdOffsetC');
const nremSympatheticFactor = requireParameter(PARAMS, 'autonomic.nremSympatheticFactor');
const remSympatheticToneMm = requireParameter(PARAMS, 'autonomic.remSympatheticToneMm');
const sleepParaRemMultiplier = requireParameter(PARAMS, 'autonomic.sleepParaRemMultiplier');
const painDiscomfortThresholdMm = requireParameter(PARAMS, 'autonomic.painDiscomfortThresholdMm');
const painSympatheticGain = requireParameter(PARAMS, 'autonomic.painSympatheticGain');
const orgasmSympatheticBurstMm = requireParameter(PARAMS, 'autonomic.orgasmSympatheticBurstMm');
const sleepEntryDecayHalfTimeMin = requireParameter(PARAMS, 'autonomic.sleepEntryDecayHalfTimeMin');

export const initialState: AutonomicState = {
  sympatheticMm: 0,
  parasympatheticMm: basalParasympatheticMm,
  startleActive: false,
};

export const fields = {
  sympatheticMm: { unit: 'mm', mode: 'absolute' },
  parasympatheticMm: { unit: 'mm', mode: 'absolute' },
  startleActive: { unit: '1', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readSleepStage(value: unknown, sleeping: boolean): SleepStage {
  if (!sleeping) return 'awake';
  if (value === 'light' || value === 'deep' || value === 'rem') return value;
  return 'light';
}

export function heartbeat(io: AutonomicIo): void {
  const prev = io.read('autonomic');
  const prevSympathetic = clamp(finiteOr(prev?.sympatheticMm, 0), 0, 100);
  const prevParasympathetic = clamp(
    finiteOr(prev?.parasympatheticMm, basalParasympatheticMm),
    0,
    100,
  );
  const prevStartleActive = prev?.startleActive === true;

  const sleep = io.read('sleep');
  const prevSleeping = sleep?.sleeping === true;
  const sleepStage = readSleepStage(sleep?.sleepStage, prevSleeping);
  const nsfwEnabled = getNsfwSetting() !== false;
  const evalResult = evaluateSleepWakeSignals(io, { sleepStage, nsfwEnabled });
  const dtMin = Math.max(0, finiteOr(io.dt, 60) / 60);

  const startleTriggered = prevSleeping
    && (evalResult.emergencyTriggered || evalResult.explicitStartleRequested);
  const pineal = io.read('pineal');
  const endingSleepingLikely = sleep === undefined
    ? evalResult.endsWithSleepAction
    : evaluateSleepTransition(io, {
      prevSleeping,
      sleepStage,
      sleepPressureMm: sleep.sleepPressureMm,
      sleepDurationMin: sleep.sleepDurationMin,
      pinealMelatoninRelative: pineal?.melatoninRelative,
      hasPineal: pineal !== undefined,
      dtMin,
      nsfwEnabled,
      signals: evalResult,
    }).sleeping;

  const activity = io.read('physicalActivity');
  const remainingExerciseMin = Math.max(0, finiteOr(activity?.remainingExerciseMin, 0));
  const intensity = clamp(finiteOr(activity?.intensity, 0), 0, 1);
  const exerciseDrive = remainingExerciseMin > 0 && !endingSleepingLikely
    ? exerciseSympatheticGain * intensity
    : 0;

  const glucoseMgDl = Math.max(0, finiteOr(io.read('glucose')?.concentrationMgDl, 90));
  const rawHypoglycemiaDrive = hypoglycemiaGainPerMgDl
    * Math.max(0, hypoglycemiaThresholdMgDl - glucoseMgDl);

  const oxygenDeficit = clamp(finiteOr(io.read('bloodOxygen')?.oxygenDeficit, 0), 0, 1);
  const hypoxiaDrive = hypoxiaGain * oxygenDeficit;

  const systolicMmHg = finiteOr(io.read('blood')?.systolicMmHg, 120);
  const hypotensionDrive = hypotensionGainPerMmHg
    * Math.max(0, hypotensionThresholdMmHg - systolicMmHg);

  const thermoregulation = io.read('thermoregulation');
  const { baselineCoreC, coreBandRelative } = io.getThermalProfile?.() ?? getThermalProfile();
  // 相对模式以本体基线为清醒冷阈参照（显式绝对覆盖优先）；legacy 模式保持绝对阈旧轨迹。
  const awakeColdThresholdC = coreBandRelative && !hasParameterOverride('autonomic.coldThresholdC')
    ? baselineCoreC + (coldThresholdC - getDefaultCoreBaselineC())
    : coldThresholdC;
  const coreTempC = finiteOr(thermoregulation?.coreTemperatureC, coreBandRelative ? baselineCoreC : getDefaultCoreBaselineC());
  const sleepColdBaseC = coreBandRelative ? awakeColdThresholdC : coldThresholdC;
  const effectiveColdThresholdC = endingSleepingLikely
    ? finiteOr(thermoregulation?.setpointC, sleepColdBaseC) - sleepColdThresholdOffsetC
    : awakeColdThresholdC;
  const rawColdDrive = coldGainPerC * Math.max(0, effectiveColdThresholdC - coreTempC);

  const nremDamping = endingSleepingLikely && sleepStage !== 'rem'
    ? nremSympatheticFactor
    : 1;
  const hypoglycemiaDrive = rawHypoglycemiaDrive * nremDamping;
  const coldDrive = rawColdDrive * nremDamping;

  const intero = io.read('interoception');
  const uterus = io.read('uterus');
  const painLevelMm = Math.max(
    finiteOr(intero?.discomfort, 0),
    finiteOr(uterus?.crampMm, 0),
  );
  const painDrive = !endingSleepingLikely
    ? painSympatheticGain * Math.max(0, painLevelMm - painDiscomfortThresholdMm)
    : 0;

  const sexualResponse = io.read('sexualResponse');
  const ovaries = io.read('ovaries');
  const testes = io.read('testes');
  const pituitary = io.read('pituitary');
  const reward = io.read('reward');

  const orgasmThisRound = !endingSleepingLikely
    && nsfwEnabled
    && evaluateSexualRelease({
      prevSexual: sexualResponse as Parameters<typeof evaluateSexualRelease>[0]['prevSexual'],
      ovaries,
      testes,
      pituitary: pituitary as Parameters<typeof evaluateSexualRelease>[0]['pituitary'],
      actions: (io.actions ?? []) as Parameters<typeof evaluateSexualRelease>[0]['actions'],
      simulatedSeconds: finiteOr(io.simulatedSeconds, 0),
    }).released;
  const orgasmDrive = orgasmThisRound ? orgasmSympatheticBurstMm : 0;
  const remToneMm = endingSleepingLikely && sleepStage === 'rem'
    ? remSympatheticToneMm
    : 0;

  const targetSympathetic = clamp(
    Math.max(
      remToneMm,
      exerciseDrive + hypoglycemiaDrive + hypoxiaDrive + hypotensionDrive + coldDrive + painDrive,
      orgasmDrive,
    ),
    0,
    100,
  );

  let sympatheticMm: number;
  let startleActive: boolean;

  if (startleTriggered) {
    sympatheticMm = clamp(Math.max(prevSympathetic, startleBurstMm, targetSympathetic), 0, 100);
    startleActive = true;
  } else if (orgasmThisRound) {
    sympatheticMm = clamp(Math.max(prevSympathetic, targetSympathetic), 0, 100);
    startleActive = prevStartleActive && sympatheticMm >= startleClearThresholdMm;
  } else {
    const fallingAsleepWithResidual = evalResult.endsWithSleepAction && targetSympathetic < prevSympathetic;
    const halfTime = targetSympathetic >= prevSympathetic
      ? riseHalfTimeMin
      : (fallingAsleepWithResidual
        ? Math.min(decayHalfTimeMin, sleepEntryDecayHalfTimeMin)
        : decayHalfTimeMin);
    const retention = halfTime > 0 ? Math.pow(0.5, dtMin / halfTime) : 0;
    sympatheticMm = clamp(
      targetSympathetic + (prevSympathetic - targetSympathetic) * retention,
      0,
      100,
    );
    startleActive = prevStartleActive && sympatheticMm >= startleClearThresholdMm;
  }

  const effectiveStage = endingSleepingLikely
    ? (prevSleeping ? sleepStage : 'light')
    : 'awake';
  const baseParasympathetic = endingSleepingLikely
    ? (effectiveStage === 'deep'
      ? sleepParasympatheticMm
      : effectiveStage === 'rem'
        ? sleepParasympatheticMm * sleepParaRemMultiplier
        : sleepParasympatheticMm * 0.8)
    : basalParasympatheticMm;
  const afterglowNorm = nsfwEnabled
    ? clamp(finiteOr(sexualResponse?.afterglowMm, 0) / 100, 0, 1)
    : 0;
  const hedonicCalmNorm = clamp((finiteOr(reward?.hedonicMm, 0) - 35) / 65, 0, 1);
  const oxytocinCalmNorm = clamp((finiteOr(pituitary?.oxytocinPgMl, 1.5) - 2) / 15, 0, 1);
  const parasympatheticReboundMm = Math.min(
    20,
    12 * afterglowNorm + 8 * hedonicCalmNorm + 6 * oxytocinCalmNorm,
  );
  const parasympatheticTarget = clamp(
    (baseParasympathetic + parasympatheticReboundMm) * (1 - 0.8 * (sympatheticMm / 100)),
    0,
    100,
  );
  const paraRetention = riseHalfTimeMin > 0 ? Math.pow(0.5, dtMin / riseHalfTimeMin) : 0;
  const parasympatheticMm = clamp(
    parasympatheticTarget + (prevParasympathetic - parasympatheticTarget) * paraRetention,
    0,
    100,
  );

  io.write({
    sympatheticMm,
    parasympatheticMm,
    startleActive,
  });
}
