/**
 * 大脑睡眠节律脚本（sleep）：维护清醒/睡眠双稳态、睡眠周期分期（light/deep/rem）、
 * Process S 睡眠压力、睡眠惯性（sleepInertiaMm）与同轮醒因（wakeEvent）。
 *
 * 模型边界（design）：
 * - 清醒累积率（wakePressureRateMmMin = 0.08 mm/min）与按分期加权的睡眠半衰期恢复
 *   （sleepRecoveryHalfTimeMin = 150 min，深睡 1.3x、REM 0.9x）；
 * - 按 90 min 周期演进 `sleepStage`（前夜/高压力期深睡占比更高，后半程 REM 占比更高）；
 * - 醒后触发 `sleepInertiaMm`（深睡打断 65 > 浅睡/REM 打断 40 > 惊醒 25 > 自然醒 15），
 *   按 20 min 半衰期回落；
 * - 睡眠期间若命中 `wake-evaluation` 紧急惊醒（`startle`）、重要睡眠阈值（`important`）、
 *   主动行为（吃/喝/如厕/运动/性行为）或 `wake_up`（含 `reason: 'speech'`），同轮将
 *   `sleeping` 置为 `false` 并写出 `wakeEvent`；
 * - 未建模：真实脑电波形、REM 梦境内容、呼吸暂停与睡眠剥夺长期损伤。
 *
 * 科学方向（均标 design，无独立人体 PSG/EEG 标定）：
 * - `SRC-BORBELY-2016` (borbely-2016.md)：Process S（清醒积累 / 睡期回落）× Process C 联合门控自然醒；
 * - `SRC-DIJK-1995` (dijk-1995.md)：深睡优先受高睡眠压力与生物夜早期驱动，后期与低压力期向 REM 迁移；
 * - `SRC-PHILLIPS-2007` (phillips-2007.md)：高交感张力入睡期先驻留浅睡再平稳转深睡的开关滞回方向。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';
import {
  ACTIVE_WAKING_ACTION_TYPES,
  computeNextSleepStage,
  evaluateSleepWakeSignals,
  willNaturallyWakeThisRound,
  type SleepStage,
  type WakeEvent,
} from './wake-evaluation.ts';

export interface SleepState {
  sleeping: boolean;
  sleepPressureMm: number;
  sleepDurationMin: number;
  sleepStage: SleepStage;
  sleepInertiaMm: number;
  wakeEvent: WakeEvent;
}

interface PinealRead {
  readonly melatoninRelative?: unknown;
}

interface BodyAction {
  readonly type?: unknown;
  readonly reason?: unknown;
  readonly startle?: unknown;
}

interface SleepIo {
  read(id: 'sleep'): Readonly<Partial<SleepState>> | undefined;
  read(id: 'pineal'): PinealRead | undefined;
  read(id: 'autonomic'): Readonly<{ sympatheticMm?: unknown }> | undefined;
  read(id: 'interoception'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'bladder'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'colon'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'blood'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'uterus'): Readonly<Record<string, unknown>> | undefined;
  read(id: 'mammaryGlands'): Readonly<Record<string, unknown>> | undefined;
  readonly actions: readonly BodyAction[];
  readonly dt: number;
  write(next: SleepState): void;
}

const PARAMS = loadParameters(new URL('./sleep.parameters.json', import.meta.url));
const WAKE_PRESSURE_RATE_MM_MIN = requireParameter(PARAMS, 'sleep.wakePressureRateMmMin');
const SLEEP_RECOVERY_HALF_TIME_MIN = requireParameter(PARAMS, 'sleep.sleepRecoveryHalfTimeMin');
const DEEP_RECOVERY_MULTIPLIER = requireParameter(PARAMS, 'sleep.deepRecoveryMultiplier');
const REM_RECOVERY_MULTIPLIER = requireParameter(PARAMS, 'sleep.remRecoveryMultiplier');
const HIGH_SYMPATHETIC_LIGHT_ONLY_MM = requireParameter(PARAMS, 'sleep.highSympatheticLightOnlyThresholdMm');
const INERTIA_NATURAL_WAKE_MM = requireParameter(PARAMS, 'sleep.inertiaNaturalWakeMm');
const INERTIA_LIGHT_WAKE_MM = requireParameter(PARAMS, 'sleep.inertiaLightWakeMm');
const INERTIA_DEEP_WAKE_MM = requireParameter(PARAMS, 'sleep.inertiaDeepWakeMm');
const INERTIA_STARTLE_WAKE_MM = requireParameter(PARAMS, 'sleep.inertiaStartleWakeMm');
const INERTIA_HALF_TIME_MIN = requireParameter(PARAMS, 'sleep.inertiaHalfTimeMin');

export const id = 'sleep';

export const actionTypes = ['sleep', 'wake_up'];

export const initialState: SleepState = {
  sleeping: false,
  sleepPressureMm: 0,
  sleepDurationMin: 0,
  sleepStage: 'awake',
  sleepInertiaMm: 0,
  wakeEvent: 'none',
};

export const fields = {
  sleeping: { unit: '1', mode: 'absolute' },
  sleepPressureMm: { unit: 'mm', mode: 'absolute' },
  sleepDurationMin: { unit: 'min', mode: 'absolute' },
  sleepStage: { unit: '1', mode: 'absolute' },
  sleepInertiaMm: { unit: 'mm', mode: 'absolute' },
  wakeEvent: { unit: '1', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeStage(value: unknown, sleeping: boolean): SleepStage {
  if (!sleeping) return 'awake';
  if (value === 'light' || value === 'deep' || value === 'rem') return value;
  return 'light';
}

export function heartbeat(io: SleepIo): void {
  const prev = io.read('sleep');
  const prevSleeping = prev?.sleeping === true;
  const prevStage = normalizeStage(prev?.sleepStage, prevSleeping);
  let sleeping = prevSleeping;
  let sleepPressureMm = clamp(finiteOr(prev?.sleepPressureMm, 0), 0, 100);
  let sleepDurationMin = sleeping ? Math.max(0, finiteOr(prev?.sleepDurationMin, 0)) : 0;
  const prevInertia = clamp(finiteOr(prev?.sleepInertiaMm, 0), 0, 100);
  const sympatheticMm = clamp(finiteOr(io.read('autonomic')?.sympatheticMm, 0), 0, 100);

  const evalResult = evaluateSleepWakeSignals(io, { sleepStage: prevStage });
  let wakeEvent: WakeEvent = 'none';

  if (prevSleeping && (evalResult.emergencyTriggered || evalResult.explicitStartleRequested)) {
    sleeping = false;
    sleepDurationMin = 0;
    wakeEvent = 'startle';
  } else {
    for (const action of io.actions ?? []) {
      const type = action?.type;
      if (type === 'sleep') {
        if (!sleeping) {
          sleeping = true;
          sleepDurationMin = 0;
        }
        wakeEvent = 'none';
      } else if (type === 'wake_up') {
        if (sleeping) {
          wakeEvent = action?.reason === 'speech' ? 'speech' : 'action';
        }
        sleeping = false;
        sleepDurationMin = 0;
      } else if (sleeping && typeof type === 'string' && ACTIVE_WAKING_ACTION_TYPES.has(type)) {
        sleeping = false;
        sleepDurationMin = 0;
        wakeEvent = 'action';
      }
    }

    if (sleeping && !evalResult.endsWithSleepAction && evalResult.importantSleepTriggered) {
      sleeping = false;
      sleepDurationMin = 0;
      wakeEvent = 'important';
    }
  }

  const dtMin = Math.max(0, finiteOr(io.dt, 60) / 60);
  let sleepStage: SleepStage = 'awake';
  let sleepInertiaMm = 0;

  if (sleeping) {
    const startDurationMin = sleepDurationMin;
    const startPressureMm = sleepPressureMm;
    const pineal = io.read('pineal');
    const melatoninRelative = finiteOr(pineal?.melatoninRelative, 0);
    sleepDurationMin += dtMin;
    const rawStage = computeNextSleepStage(
      sleepDurationMin,
      sleepPressureMm,
      pineal === undefined ? undefined : melatoninRelative,
    );
    sleepStage = sympatheticMm >= HIGH_SYMPATHETIC_LIGHT_ONLY_MM && rawStage === 'deep'
      ? 'light'
      : rawStage;
    const recoveryMultiplier = sleepStage === 'deep'
      ? DEEP_RECOVERY_MULTIPLIER
      : sleepStage === 'rem'
        ? REM_RECOVERY_MULTIPLIER
        : 1;
    const effectiveHalfTime = SLEEP_RECOVERY_HALF_TIME_MIN / recoveryMultiplier;
    sleepPressureMm = clamp(
      sleepPressureMm * Math.pow(0.5, dtMin / effectiveHalfTime),
      0,
      100,
    );
    if (
      willNaturallyWakeThisRound({
        sleepPressureMm: startPressureMm,
        sleepDurationMin: startDurationMin,
        pinealMelatoninRelative: melatoninRelative,
        hasPineal: pineal !== undefined,
        dtMin,
      })
    ) {
      sleeping = false;
      sleepDurationMin = 0;
      sleepStage = 'awake';
      wakeEvent = 'natural';
      sleepInertiaMm = INERTIA_NATURAL_WAKE_MM;
    }
  } else {
    sleepDurationMin = 0;
    sleepStage = 'awake';
    sleepPressureMm = clamp(sleepPressureMm + WAKE_PRESSURE_RATE_MM_MIN * dtMin, 0, 100);
    if (prevSleeping) {
      if (wakeEvent === 'startle') {
        sleepInertiaMm = INERTIA_STARTLE_WAKE_MM;
      } else if (prevStage === 'deep') {
        sleepInertiaMm = INERTIA_DEEP_WAKE_MM;
      } else {
        sleepInertiaMm = INERTIA_LIGHT_WAKE_MM;
      }
    } else {
      const inertiaRetention = INERTIA_HALF_TIME_MIN > 0
        ? Math.pow(0.5, dtMin / INERTIA_HALF_TIME_MIN)
        : 0;
      sleepInertiaMm = clamp(prevInertia * inertiaRetention, 0, 100);
      wakeEvent = 'none';
    }
  }

  io.write({
    sleeping,
    sleepPressureMm,
    sleepDurationMin,
    sleepStage,
    sleepInertiaMm,
    wakeEvent,
  });
}
