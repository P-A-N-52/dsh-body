/*
 * 子宫脚本（uterus）：把轮初卵巢激素相对量映射为内膜相对量，并按周期日产生月经失水请求
 * 与痛经代理。部位 `uterus` 的唯一写者；无动作、不调用 transfer、不读自身上一轮
 * `bleedingMl`。消费者有两处：
 * - `interoception.discomfort` 第五路读本轮 `crampMm`（0–100 mm 代理，软读）；
 * - `bodyFluid` 女性变体 `water.female.ts` 读 `bleedingRequestMl`，在本轮 write 之后把
 *   `bodyFluid.waterVolumeMl` 转入 `uterus.bleedingMl`。实际失水只由 transferIn 增加，
 *   本脚本每轮 write 先把 `bleedingMl` 归 0。
 *
 * 证据与 design：`mensesDays = 4.0` 取 Bull 2019 自报连续出血天数（bleeding，不含 spotting；
 * Table 1–3 All cycles，612,613 个排卵周期均值 4.0 ± 1.5 d），`status: prior`、
 * `source: SRC-BULL-2019`，笔记见
 * `organs/human-organs/ovaries/references/notes/bull-2019.md`。其余 6 个参数全部
 * `status: design`、`source: null`（同目录 `uterus.parameters.json`）；50 mL/周期、85 mm
 * 峰值、2.5 天痉挛窗、2 天内膜半时与 0.7/0.3 权重都是工程假设，不是人体测量或拟合，不能称
 * validated。Bull 2019 只支撑周期/相位长度与自报出血天数，不支撑经量、痛经、内膜厚度或激素
 * 曲线；本脚本也不把经量换算成血液成分。
 *
 * 公式（dtMin = io.dt / 60，dtDays = dtMin / 1440；E2/P4 为轮初相对量，prevEndo 为轮初
 * 自身内膜相对量，target 是激素目标值）：
 *   target = clamp(0.7 × E2 + 0.3 × P4, 0, 1)
 *   endometriumRelative = target + (prevEndo − target) × 2^(−dtDays / 2)
 *   crampMm = cycleDay < 2.5 ? clamp(85 × (1 − cycleDay / 2.5), 0, 100) : 0
 *   bleedingRequestMl = cycleDay < 4.0
 *     ? 50 × prevEndo / (4.0 × 1440) × dtMin : 0
 * 经量正比于轮初内膜，所以内膜越厚请求越大；请求只是写进下一轮供 `bodyFluid` 读取的量，
 * 不是本轮已失水。痉挛与经期都按轮初 `cycleDay` 判定，月经期与早卵泡期重叠是常态。
 *
 * 边界：`ovaries` 未加载时子宫惰性：crampMm = 0、bleedingRequestMl = 0，内膜继续按
 * target 0 一阶衰减。`ovaries` 已加载但 cycleDay / estradiolRelative / progesteroneRelative
 * 缺失、非有限或为负时抛错，使本轮失败且不写状态，不用常量掩盖。只读轮初快照；同轮新入队
 * 动作不影响本轮。旧存档缺字段时由 initialState 补 `endometriumRelative = 0.1`、其余 0。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'uterus';
export const actionTypes: string[] = [];

type UterusState = {
  endometriumRelative: number;
  crampMm: number;
  bleedingRequestMl: number;
  bleedingMl: number;
};

type OvariesReading = {
  cycleDay?: unknown;
  estradiolRelative?: unknown;
  progesteroneRelative?: unknown;
};

export const initialState: UterusState = {
  endometriumRelative: 0.1,
  crampMm: 0,
  bleedingRequestMl: 0,
  bleedingMl: 0,
};

export const fields = {
  endometriumRelative: { unit: '1', mode: 'absolute' },
  crampMm: { unit: 'mm', mode: 'absolute' },
  bleedingRequestMl: { unit: 'mL', mode: 'absolute' },
  bleedingMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['bodyFluid.waterVolumeMl'],
  },
};

type IO = {
  read(id: 'uterus'): Readonly<UterusState> | undefined;
  read(id: 'ovaries'): Readonly<OvariesReading> | undefined;
  readonly dt: number;
  write(next: UterusState): void;
};

const parameters = loadParameters(new URL('./uterus.parameters.json', import.meta.url));
const mensesDays = requireParameter(parameters, 'uterus.mensesDays');
const flowMlPerCycle = requireParameter(parameters, 'uterus.flowMlPerCycle');
const crampPeakMm = requireParameter(parameters, 'uterus.crampPeakMm');
const crampDurationDays = requireParameter(parameters, 'uterus.crampDurationDays');
const endometriumHalfTimeDays = requireParameter(parameters, 'uterus.endometriumHalfTimeDays');
const endometriumEstradiolWeight = requireParameter(
  parameters,
  'uterus.endometriumEstradiolWeight',
);
const endometriumProgesteroneWeight = requireParameter(
  parameters,
  'uterus.endometriumProgesteroneWeight',
);

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireNonNegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`uterus: ovaries.${name} must be a finite non-negative number`);
  }
  return value;
}

function readOvaries(io: IO):
  | { cycleDay: number; estradiolRelative: number; progesteroneRelative: number }
  | undefined {
  const ovaries = io.read('ovaries') as OvariesReading | null | undefined;
  if (ovaries === undefined || ovaries === null) return undefined;
  if (typeof ovaries !== 'object') {
    throw new Error('uterus: ovaries must be an object');
  }
  return {
    cycleDay: requireNonNegative(ovaries.cycleDay, 'cycleDay'),
    estradiolRelative: requireNonNegative(ovaries.estradiolRelative, 'estradiolRelative'),
    progesteroneRelative: requireNonNegative(
      ovaries.progesteroneRelative,
      'progesteroneRelative',
    ),
  };
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const prevEndometrium = finiteOr(prev.endometriumRelative, initialState.endometriumRelative);
  const dtMin = io.dt / 60;
  const dtDays = dtMin / 1440;

  const ovaries = readOvaries(io);
  let target = 0;
  let crampMm = 0;
  let bleedingRequestMl = 0;

  if (ovaries !== undefined) {
    target = clamp(
      endometriumEstradiolWeight * ovaries.estradiolRelative
        + endometriumProgesteroneWeight * ovaries.progesteroneRelative,
      0,
      1,
    );
    if (ovaries.cycleDay < crampDurationDays) {
      crampMm = clamp(crampPeakMm * (1 - ovaries.cycleDay / crampDurationDays), 0, 100);
    }
    if (ovaries.cycleDay < mensesDays) {
      bleedingRequestMl = flowMlPerCycle
        * prevEndometrium
        / (mensesDays * 1440)
        * dtMin;
    }
  }

  const endometriumRelative = target
    + (prevEndometrium - target) * 2 ** (-dtDays / endometriumHalfTimeDays);

  io.write({
    endometriumRelative,
    crampMm,
    bleedingRequestMl,
    bleedingMl: 0,
  });
}
