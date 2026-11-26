/*
 * 卵巢周期脚本（ovaries）：女性身体的周期钟与血清 E2/P4/LH/FSH 参考轨迹。
 * 部位 `ovaries` 的唯一写者；无动作、无 transfer。
 *
 * 证据：
 * - SRC-BULL-2019 (`bull-2019.md`): 周期长度 29.3 d、卵泡期 16.9 d、黄体期 12.4 d (`prior`)；
 * - SRC-STRICKER-2006 (`stricker-2006.md`): 健康女性排卵周期按 LH 峰日（Day 0）对齐的
 *   day `-15..+14` 每日血清 LH (`IU/L`), FSH (`IU/L`), E2 (`pmol/L`), P4 (`nmol/L`) 中位数轨迹；
 * - SRC-PAGEWILSON-2007 & SRC-HOSKOVA-2022: 短期高 PRL 不立刻抑周期，慢性持续高 PRL 与
 *   哺乳刺激通过 `cycleSuppression` 慢时间常数（半衰期 5 d）压低激素高峰并延缓周期推进。
 */
import {
  getNsfwSetting,
  getProfileLactating,
  loadParameters,
  requireParameter,
} from '../../../lib/parameters.js';

export const id = 'ovaries';
export const actionTypes: string[] = [];

type Phase = 'follicular' | 'ovulatory' | 'luteal';

type OvariesState = {
  cycleDay: number;
  cycleLengthDays: number;
  phase: Phase;
  estradiolPmolL: number;
  progesteroneNmolL: number;
  lhIuL: number;
  fshIuL: number;
  cycleSuppression: number;
};

type SavedOvariesState = Partial<OvariesState>;

type IO = {
  read(partId: 'ovaries'): Readonly<SavedOvariesState> | undefined;
  read(partId: 'pituitary'): Readonly<{ prolactinNgMl?: unknown }> | undefined;
  read(partId: 'mammaryGlands'): Readonly<{ lactating?: unknown; stimulationMin?: unknown }> | undefined;
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
const hyperprolactinemiaThresholdNgMl = requireParameter(
  parameters,
  'ovaries.hyperprolactinemiaThresholdNgMl',
);
const suppressionHalfTimeDays = requireParameter(parameters, 'ovaries.suppressionHalfTimeDays');

// SRC-STRICKER-2006: dayOffset = -15..+14 每日中位数；末尾 +15 连续衔接回 -15。
const STRICKER_POINTS = [
  { lh: 2.28, fsh: 4.59, e2: 139.46, p4: 1.27 }, // -15
  { lh: 3.39, fsh: 6.45, e2: 149.00, p4: 1.27 }, // -14
  { lh: 3.47, fsh: 6.34, e2: 137.63, p4: 0.95 }, // -13
  { lh: 3.59, fsh: 6.26, e2: 128.45, p4: 0.64 }, // -12
  { lh: 3.82, fsh: 6.61, e2: 130.29, p4: 0.64 }, // -11
  { lh: 3.82, fsh: 6.88, e2: 145.15, p4: 0.64 }, // -10
  { lh: 4.26, fsh: 6.65, e2: 154.14, p4: 0.64 }, // -9
  { lh: 4.96, fsh: 6.46, e2: 162.76, p4: 0.48 }, // -8
  { lh: 4.54, fsh: 6.63, e2: 196.16, p4: 0.64 }, // -7
  { lh: 4.47, fsh: 5.65, e2: 215.06, p4: 0.32 }, // -6
  { lh: 4.18, fsh: 5.45, e2: 262.22, p4: 0.48 }, // -5
  { lh: 4.58, fsh: 4.59, e2: 363.15, p4: 0.64 }, // -4
  { lh: 5.12, fsh: 4.35, e2: 485.72, p4: 0.32 }, // -3
  { lh: 7.02, fsh: 4.32, e2: 651.06, p4: 0.64 }, // -2
  { lh: 12.36, fsh: 5.15, e2: 939.34, p4: 0.95 }, // -1
  { lh: 41.19, fsh: 12.82, e2: 671.06, p4: 2.54 }, // 0
  { lh: 14.92, fsh: 8.01, e2: 312.87, p4: 4.93 }, // +1
  { lh: 7.75, fsh: 5.19, e2: 260.57, p4: 12.72 }, // +2
  { lh: 6.26, fsh: 4.73, e2: 322.96, p4: 20.51 }, // +3
  { lh: 6.46, fsh: 4.36, e2: 403.52, p4: 30.85 }, // +4
  { lh: 4.32, fsh: 3.88, e2: 450.68, p4: 34.03 }, // +5
  { lh: 4.50, fsh: 3.34, e2: 486.64, p4: 35.30 }, // +6
  { lh: 4.29, fsh: 3.31, e2: 551.78, p4: 42.45 }, // +7
  { lh: 3.89, fsh: 2.97, e2: 491.23, p4: 37.05 }, // +8
  { lh: 3.07, fsh: 2.73, e2: 503.52, p4: 32.44 }, // +9
  { lh: 1.75, fsh: 2.55, e2: 495.45, p4: 32.75 }, // +10
  { lh: 2.52, fsh: 2.54, e2: 340.41, p4: 14.47 }, // +11
  { lh: 3.42, fsh: 3.08, e2: 314.52, p4: 13.04 }, // +12
  { lh: 2.55, fsh: 3.73, e2: 170.10, p4: 5.25 }, // +13
  { lh: 3.23, fsh: 3.81, e2: 151.20, p4: 4.13 }, // +14
  { lh: 2.28, fsh: 4.59, e2: 139.46, p4: 1.27 }, // +15 wrap
] as const;

const SUPPRESSED_BASAL = {
  e2: 140,
  p4: 0.8,
  lh: 3.3,
  fsh: 5.5,
};

const ovulatoryLengthDays = 1;
const dayAfterOvulation = follicularLengthDays + ovulatoryLengthDays;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function wrapCycleDay(cycleDay: number): number {
  const mod = cycleDay % cycleLengthDays;
  return mod < 0 ? mod + cycleLengthDays : mod;
}

function phaseAt(cycleDay: number): Phase {
  if (cycleDay < follicularLengthDays) return 'follicular';
  if (cycleDay < dayAfterOvulation) return 'ovulatory';
  return 'luteal';
}

function sampleStricker(cycleDay: number): { lh: number; fsh: number; e2: number; p4: number } {
  const d = wrapCycleDay(cycleDay);
  const offset = d <= follicularLengthDays
    ? -15 + 15 * (d / follicularLengthDays)
    : 15 * ((d - follicularLengthDays) / Math.max(1e-6, cycleLengthDays - follicularLengthDays));
  const indexFloat = clamp(offset + 15, 0, 30);
  const lo = Math.floor(indexFloat);
  const hi = Math.min(30, lo + 1);
  const frac = indexFloat - lo;
  const a = STRICKER_POINTS[lo];
  const b = STRICKER_POINTS[hi];
  return {
    lh: a.lh + (b.lh - a.lh) * frac,
    fsh: a.fsh + (b.fsh - a.fsh) * frac,
    e2: a.e2 + (b.e2 - a.e2) * frac,
    p4: a.p4 + (b.p4 - a.p4) * frac,
  };
}

function computeHormones(cycleDay: number, suppression: number) {
  const raw = sampleStricker(cycleDay);
  const s = clamp(suppression, 0, 0.95);
  return {
    estradiolPmolL: SUPPRESSED_BASAL.e2 + (raw.e2 - SUPPRESSED_BASAL.e2) * (1 - s),
    progesteroneNmolL: SUPPRESSED_BASAL.p4 + (raw.p4 - SUPPRESSED_BASAL.p4) * (1 - s),
    lhIuL: SUPPRESSED_BASAL.lh + (raw.lh - SUPPRESSED_BASAL.lh) * (1 - s),
    fshIuL: SUPPRESSED_BASAL.fsh + (raw.fsh - SUPPRESSED_BASAL.fsh) * (1 - s),
  };
}

const presetLactating = getNsfwSetting() !== false && getProfileLactating();
const initialCycleDay = wrapCycleDay(startCycleDay);
const initialSuppression = presetLactating ? 0.75 : 0;
const initialHormones = computeHormones(initialCycleDay, initialSuppression);

export const initialState: OvariesState = {
  cycleDay: initialCycleDay,
  cycleLengthDays,
  phase: phaseAt(initialCycleDay),
  estradiolPmolL: initialHormones.estradiolPmolL,
  progesteroneNmolL: initialHormones.progesteroneNmolL,
  lhIuL: initialHormones.lhIuL,
  fshIuL: initialHormones.fshIuL,
  cycleSuppression: initialSuppression,
};

export const fields = {
  cycleDay: { unit: 'd', mode: 'absolute' },
  cycleLengthDays: { unit: 'd', mode: 'absolute' },
  phase: { unit: '-', mode: 'absolute' },
  estradiolPmolL: { unit: 'pmol/L', mode: 'absolute' },
  progesteroneNmolL: { unit: 'nmol/L', mode: 'absolute' },
  lhIuL: { unit: 'IU/L', mode: 'absolute' },
  fshIuL: { unit: 'IU/L', mode: 'absolute' },
  cycleSuppression: { unit: '1', mode: 'absolute' },
};

export function heartbeat(io: IO): void {
  const prev = io.read(id);
  const prevDay = clamp(finiteOr(prev?.cycleDay, initialState.cycleDay), 0, cycleLengthDays);
  const prevSuppression = clamp(
    finiteOr(prev?.cycleSuppression, initialState.cycleSuppression),
    0,
    0.95,
  );
  const dtDays = Math.max(0, finiteOr(io.dt, 0) / 60 / 1440);

  const prolactinNgMl = Math.max(0, finiteOr(io.read('pituitary')?.prolactinNgMl, 8));
  const mammary = io.read('mammaryGlands');
  const nsfwEnabled = getNsfwSetting() !== false;
  const mammaryLactating = nsfwEnabled && mammary?.lactating === true;
  const stimulationMin = Math.max(0, finiteOr(mammary?.stimulationMin, 0));

  const prlExcess = Math.max(0, (prolactinNgMl - hyperprolactinemiaThresholdNgMl) / 65);
  const lactationDrive = mammaryLactating ? (stimulationMin > 0 ? 0.85 : 0.65) : 0;
  const suppressionTarget = clamp(Math.max(prlExcess, lactationDrive), 0, 0.95);
  const cycleSuppression = dtDays <= 0
    ? prevSuppression
    : clamp(
      suppressionTarget + (prevSuppression - suppressionTarget) * 2 ** (-dtDays / suppressionHalfTimeDays),
      0,
      0.95,
    );

  const cycleDay = wrapCycleDay(prevDay + dtDays * (1 - 0.85 * cycleSuppression));
  const hormones = computeHormones(cycleDay, cycleSuppression);

  io.write({
    cycleDay,
    cycleLengthDays,
    phase: phaseAt(cycleDay),
    estradiolPmolL: hormones.estradiolPmolL,
    progesteroneNmolL: hormones.progesteroneNmolL,
    lhIuL: hormones.lhIuL,
    fshIuL: hormones.fshIuL,
    cycleSuppression,
  });
}
