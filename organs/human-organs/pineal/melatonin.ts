/*
 * 部位 `pineal`：松果体薄切片，按本地时钟（太阳光周期 + SCN 生物夜相位）与当前睡眠/自主状态
 * 联合计算褪黑素相对量 `melatoninRelative`（`1` 为工程基线，0–2 的无量纲相对尺度）。
 *
 * 科学方向（notes: organs/human-organs/pineal/references/notes/zeitzer-2000.md）：
 * - `SRC-ZEITZER-2000` (Zeitzer et al., 2000, J Physiol 526 Pt 3:695–702, 摘要 Results)：
 *   夜间光照对血浆褪黑素的急性抑制呈 logistic 剂量-反应关系，仅约 ~100 lx 昏暗室内光即可
 *   产生 ~9000 lx 强光约一半的最大抑制效应。
 * - `SRC-DIJK-1995` (Dijk et al., 1995) 与 `responseHalfTimeMin = 39.4 min`（`design`）：未加载
 *   `sleep` 时以纯时钟 SCN 余弦曲线为目标；加载 `sleep` 时结合清醒/入睡状态推导环境入眼照度
 *   （夜间清醒维持室内光 `120 lx` 部分抑制褪黑素，闭眼入睡撤除室内人工光照），并受
 *   `autonomic.sympatheticMm` 高交感轻微抑控；上一轮 `melatoninRelative` 存在时始终按 `39.4 min`
 *   半衰期一阶平滑趋近目标（首次无历史直接落到目标）。
 *
 * design / 未建模（不是人体血浆 pg/mL 实测、光史拟合或独立验证）
 * - 曲线形状、照度代理与半衰期均为工程 design 参数，具体见同目录 `melatonin.parameters.json`。
 */
import { resolveCircadianHour } from '../../../lib/circadian.js';
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'pineal';
export const actionTypes: string[] = [];

type PinealState = {
  melatoninRelative: number;
};

type IO = {
  read(partId: 'pineal'): Readonly<Partial<PinealState>> | undefined;
  read(partId: 'sleep'): Readonly<{ sleeping?: unknown }> | undefined;
  read(partId: 'autonomic'): Readonly<{ sympatheticMm?: unknown }> | undefined;
  readonly dt?: number;
  readonly simulatedSeconds: number;
  readonly wallTimeMs?: number;
  write(next: PinealState): void;
};

const parameters = loadParameters(new URL('./melatonin.parameters.json', import.meta.url));
const baseRelative = requireParameter(parameters, 'pineal.melatoninBaseRelative');
const amplitudeRelative = requireParameter(parameters, 'pineal.melatoninAmplitudeRelative');
const peakHour = requireParameter(parameters, 'pineal.melatoninPeakHour');
const periodHours = requireParameter(parameters, 'pineal.melatoninPeriodHours');
const phaseShiftHours = requireParameter(parameters, 'pineal.phaseShiftHours');
const photicHalfMaxLux = requireParameter(parameters, 'pineal.photicHalfMaxLux');
const awakeNightRoomLux = requireParameter(parameters, 'pineal.awakeNightRoomLux');
const daylightPeakLux = requireParameter(parameters, 'pineal.daylightPeakLux');
const eyelidTransmittance = requireParameter(parameters, 'pineal.eyelidTransmittance');
const responseHalfTimeMin = requireParameter(parameters, 'pineal.responseHalfTimeMin');

const MIN_RELATIVE = 0;
const MAX_RELATIVE = 2;
const DAWN_HOUR = 6.5;
const DUSK_HOUR = 18.5;

export const initialState: PinealState = {
  melatoninRelative: 1,
};

export const fields = {
  melatoninRelative: { unit: '1', mode: 'absolute' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function solarAmbientLux(hour: number): number {
  const dayHour = ((hour % 24) + 24) % 24;
  if (dayHour <= DAWN_HOUR || dayHour >= DUSK_HOUR) return 0;
  const fraction = (dayHour - DAWN_HOUR) / (DUSK_HOUR - DAWN_HOUR);
  return daylightPeakLux * Math.sin(Math.PI * fraction);
}

export function heartbeat(io: IO): void {
  const hour = typeof io.wallTimeMs === 'number' && Number.isFinite(io.wallTimeMs)
    ? resolveCircadianHour(io.wallTimeMs, { periodHours, phaseShiftHours })
    : resolveCircadianHour((io.simulatedSeconds ?? 0) * 1000, {
      periodHours,
      phaseShiftHours,
      timezoneOffsetMin: 0,
    });
  const circadianCurve = clamp(
    baseRelative
      + amplitudeRelative * Math.cos((2 * Math.PI * (hour - peakHour)) / periodHours),
    MIN_RELATIVE,
    MAX_RELATIVE,
  );

  const sleep = io.read('sleep');
  let target = circadianCurve;
  if (sleep !== undefined) {
    const sleeping = sleep.sleeping === true;
    const solarLux = solarAmbientLux(hour);
    const retinalLux = sleeping
      ? solarLux * eyelidTransmittance
      : Math.max(solarLux, awakeNightRoomLux);
    const photicSuppression = retinalLux > 0 && photicHalfMaxLux > 0
      ? retinalLux / (retinalLux + photicHalfMaxLux)
      : 0;
    const rawSympathetic = io.read('autonomic')?.sympatheticMm;
    const sympatheticMm = typeof rawSympathetic === 'number' && Number.isFinite(rawSympathetic)
      ? clamp(rawSympathetic, 0, 100)
      : 0;
    const sympatheticFactor = 1 - 0.35 * (sympatheticMm / 100);

    const minFloor = Math.max(MIN_RELATIVE, baseRelative - amplitudeRelative);
    const nightDrive = Math.max(0, circadianCurve - minFloor);
    target = clamp(
      minFloor + nightDrive * (1 - photicSuppression) * sympatheticFactor,
      MIN_RELATIVE,
      MAX_RELATIVE,
    );
  }

  const prev = io.read(id);
  const prevValue = prev?.melatoninRelative;
  const dtMin = typeof io.dt === 'number' && Number.isFinite(io.dt) ? Math.max(0, io.dt / 60) : 0;
  const melatoninRelative = typeof prevValue === 'number' && Number.isFinite(prevValue)
    ? (dtMin <= 0
      ? clamp(prevValue, MIN_RELATIVE, MAX_RELATIVE)
      : clamp(
        target + (prevValue - target) * 2 ** (-dtMin / responseHalfTimeMin),
        MIN_RELATIVE,
        MAX_RELATIVE,
      ))
    : target;

  io.write({ melatoninRelative });
}
