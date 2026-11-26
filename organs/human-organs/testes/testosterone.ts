/*
 * 部位 `testes`：睾酮相对信号与多日睡眠债追踪脚本；本部位唯一写者。
 *
 * 动力学（design，对齐 SRC-LEPROULT-2011 与 SRC-KEENAN-2004）：
 * - 引入跨日睡眠债 `sleepDebtDays`（d）：清醒期间当睡眠压力 > 60 mm 时缓慢累积，
 *   充分睡眠期间按 36 h 半衰期恢复；单日偶发晚睡不会骤降，连续多日限睡压低 10%–15%；
 * - 软读 `adrenal.cortisolNmolL`（> 1.5×180 nmol/L 应激抑制）与 `pituitary.prolactinNgMl`
 *   （> 25 ng/mL 高催乳素抑制），合并作用于 08:00 峰 / 20:00 谷昼夜目标。
 */
import { resolveCircadianHour } from '../../../lib/circadian.js';
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'testes';
export const actionTypes: string[] = [];

type TestesState = {
  testosteroneRelative: number;
  sleepDebtDays: number;
};

type SavedTestesState = Partial<TestesState>;

type IO = {
  read(id: 'testes'): Readonly<SavedTestesState> | undefined;
  read(id: 'sleep'): Readonly<{ sleeping?: unknown; sleepPressureMm?: unknown }> | undefined;
  read(id: 'adrenal'): Readonly<{ cortisolNmolL?: unknown }> | undefined;
  read(id: 'pituitary'): Readonly<{ prolactinNgMl?: unknown }> | undefined;
  readonly dt: number;
  readonly simulatedSeconds: number;
  readonly wallTimeMs?: number;
  write(next: TestesState): void;
};

const parameters = loadParameters(new URL('./testosterone.parameters.json', import.meta.url));
const baselineRelative = requireParameter(parameters, 'testes.baselineRelative');
const circadianAmplitude = requireParameter(parameters, 'testes.circadianAmplitude');
const responseHalfTimeMin = requireParameter(parameters, 'testes.responseHalfTimeMin');
const phaseShiftHours = requireParameter(parameters, 'testes.phaseShiftHours');
const sleepDebtThresholdMm = requireParameter(parameters, 'testes.sleepDebtSuppressionThresholdMm');
const sleepDebtMaxSuppression = requireParameter(parameters, 'testes.sleepDebtMaxSuppressionFraction');
const sleepDebtRecoveryHalfTimeHours = requireParameter(
  parameters,
  'testes.sleepDebtRecoveryHalfTimeHours',
);
const stressCortisolSuppressionGain = requireParameter(parameters, 'testes.stressCortisolSuppressionGain');
const prolactinSuppressionGain = requireParameter(parameters, 'testes.prolactinSuppressionGain');

const REFERENCE_CORTISOL_NMOL_L = 180;
const periodHours = 24;
const peakHour = 8;

export const initialState: TestesState = {
  testosteroneRelative: 1,
  sleepDebtDays: 0,
};

export const fields = {
  testosteroneRelative: { unit: '1', mode: 'absolute' },
  sleepDebtDays: { unit: 'd', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id);
  const prevTestosterone = Math.max(0, finiteOr(prev?.testosteroneRelative, initialState.testosteroneRelative));
  const prevDebtDays = clamp(finiteOr(prev?.sleepDebtDays, 0), 0, 7);
  const dtMin = Math.max(0, io.dt / 60);

  const hour = typeof io.wallTimeMs === 'number' && Number.isFinite(io.wallTimeMs)
    ? resolveCircadianHour(io.wallTimeMs, { periodHours, phaseShiftHours })
    : resolveCircadianHour((io.simulatedSeconds ?? 0) * 1000, {
      periodHours,
      phaseShiftHours,
      timezoneOffsetMin: 0,
    });
  const circadianTarget = baselineRelative
    + circadianAmplitude * Math.cos((2 * Math.PI * (hour - peakHour)) / periodHours);

  const sleep = io.read('sleep');
  const sleeping = sleep?.sleeping === true;
  const sleepPressureMm = clamp(finiteOr(sleep?.sleepPressureMm, 0), 0, 100);
  const sleepDebtSpan = Math.max(1, 100 - sleepDebtThresholdMm);

  let sleepDebtDays = prevDebtDays;
  if (sleep !== undefined && dtMin > 0) {
    if (sleeping) {
      sleepDebtDays = clamp(
        prevDebtDays * 2 ** (-(dtMin / 60) / sleepDebtRecoveryHalfTimeHours),
        0,
        7,
      );
    } else if (sleepPressureMm > sleepDebtThresholdMm) {
      const excessFrac = (sleepPressureMm - sleepDebtThresholdMm) / sleepDebtSpan;
      sleepDebtDays = clamp(prevDebtDays + (dtMin / 1440) * excessFrac * 3, 0, 7);
    }
  }
  const sleepDebtSuppression = sleepDebtMaxSuppression * clamp(sleepDebtDays / 3, 0, 1);

  const cortisolNmolL = Math.max(0, finiteOr(io.read('adrenal')?.cortisolNmolL, REFERENCE_CORTISOL_NMOL_L));
  const cortisolRatio = cortisolNmolL / REFERENCE_CORTISOL_NMOL_L;
  const stressSuppression = cortisolRatio > 1.5
    ? stressCortisolSuppressionGain * (cortisolRatio - 1.5)
    : 0;

  const prolactinNgMl = Math.max(0, finiteOr(io.read('pituitary')?.prolactinNgMl, 8));
  const prolactinSuppression = prolactinNgMl > 25
    ? prolactinSuppressionGain * (prolactinNgMl - 25)
    : 0;

  const totalSuppression = clamp(
    sleepDebtSuppression + stressSuppression + prolactinSuppression,
    0,
    0.55,
  );
  const target = Math.max(0, circadianTarget * (1 - totalSuppression));
  const retention = 2 ** (-dtMin / responseHalfTimeMin);
  const testosteroneRelative = target + (prevTestosterone - target) * retention;

  io.write({ testosteroneRelative, sleepDebtDays });
}
