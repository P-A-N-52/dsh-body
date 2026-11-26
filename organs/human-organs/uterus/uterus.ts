/*
 * 子宫脚本（uterus）：子宫内膜周期、经期失液、痛经代理与性高潮/催产素相关宫缩与盆腔充血。
 * 部位 `uterus` 的唯一写者；保留 `water.female.ts` 的 `bodyFluid.waterVolumeMl -> uterus.bleedingMl`
 * 转移闭包，但将周期总失液代理从 50 mL 调至 30 mL（对齐 SRC-HALLBERG-1966 总体中位数 30.0 mL；
 * 注：经液仅约 36% 为全血而非纯水，此处仍为单口径水账代理）。
 *
 * 内膜轨迹（design，参考 SRC-BAKOS-1994）：
 * - 经期（`cycleDay < mensesDays`）内膜向 `0.15` 脱落；
 * - 卵泡期与排卵期随 `ovaries.estradiolPmolL` 线性上升；
 * - 黄体期维持 `lutealEndometriumPlateau = 0.9` 分泌期平台，不再随 E2 下降而被 `0.7/0.3` 提前腰斩。
 * 宫缩与盆腔充血（design，受 `nsfw` 门控）：
 * - `contractionMm`：性高潮（同轮或余波）跃升至 `orgasmContractionPeakMm = 68 mm`（SRC-BLAICHER-1999），
 *   哺乳期高催产素脉冲（`oxytocinPgMl > 6`）驱动温和 ~30 mm 宫缩，按 4 min 半衰期消退；
 * - `pelvicCongestionMm`：随性唤起 `0.85 * arousalMm` 上升（4 min），停止后按 12 min 消退。
 */
import { getNsfwSetting, loadParameters, requireParameter } from '../../../lib/parameters.js';
import { evaluateSexualRelease } from '../sexual-response/response.ts';

export const id = 'uterus';
export const actionTypes: string[] = [];

type UterusState = {
  endometriumRelative: number;
  crampMm: number;
  bleedingRequestMl: number;
  bleedingMl: number;
  contractionMm: number;
  pelvicCongestionMm: number;
};

type SavedUterusState = Partial<UterusState>;

type OvariesReading = {
  cycleDay?: unknown;
  phase?: unknown;
  estradiolPmolL?: unknown;
  progesteroneNmolL?: unknown;
};

type IO = {
  read(id: 'uterus'): Readonly<SavedUterusState> | undefined;
  read(id: 'ovaries'): Readonly<OvariesReading> | undefined;
  read(id: 'sexualResponse'): Readonly<{ arousalMm?: unknown; lastOrgasmAtSimMin?: unknown; phase?: unknown }> | undefined;
  read(id: 'testes'): unknown;
  read(id: 'pituitary'): Readonly<{ prolactinNgMl?: unknown; oxytocinPgMl?: unknown }> | undefined;
  readonly actions?: readonly Readonly<{ type?: unknown }>[];
  readonly dt: number;
  readonly simulatedSeconds?: number;
  write(next: UterusState): void;
};

const parameters = loadParameters(new URL('./uterus.parameters.json', import.meta.url));
const mensesDays = requireParameter(parameters, 'uterus.mensesDays');
const flowMlPerCycle = requireParameter(parameters, 'uterus.flowMlPerCycle');
const crampPeakMm = requireParameter(parameters, 'uterus.crampPeakMm');
const crampDurationDays = requireParameter(parameters, 'uterus.crampDurationDays');
const endometriumHalfTimeDays = requireParameter(parameters, 'uterus.endometriumHalfTimeDays');
const lutealEndometriumPlateau = requireParameter(parameters, 'uterus.lutealEndometriumPlateau');
const orgasmContractionPeakMm = requireParameter(parameters, 'uterus.orgasmContractionPeakMm');
const contractionHalfTimeMin = requireParameter(parameters, 'uterus.contractionHalfTimeMin');
const congestionHalfTimeMin = requireParameter(parameters, 'uterus.congestionHalfTimeMin');

export const initialState: UterusState = {
  endometriumRelative: 0.1,
  crampMm: 0,
  bleedingRequestMl: 0,
  bleedingMl: 0,
  contractionMm: 0,
  pelvicCongestionMm: 0,
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
  contractionMm: { unit: 'mm', mode: 'absolute' },
  pelvicCongestionMm: { unit: 'mm', mode: 'absolute' },
};

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

function readOvaries(io: IO): {
  cycleDay: number;
  phase: unknown;
  estradiolPmolL: number;
  progesteroneNmolL: number;
} | undefined {
  const ovaries = io.read('ovaries') as OvariesReading | null | undefined;
  if (ovaries === undefined || ovaries === null) return undefined;
  if (typeof ovaries !== 'object') {
    throw new Error('uterus: ovaries must be an object');
  }
  return {
    cycleDay: requireNonNegative(ovaries.cycleDay, 'cycleDay'),
    phase: ovaries.phase,
    estradiolPmolL: requireNonNegative(ovaries.estradiolPmolL, 'estradiolPmolL'),
    progesteroneNmolL: requireNonNegative(ovaries.progesteroneNmolL, 'progesteroneNmolL'),
  };
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const prevEndometrium = finiteOr(prev.endometriumRelative, initialState.endometriumRelative);
  const prevContraction = clamp(finiteOr(prev.contractionMm, 0), 0, 100);
  const prevCongestion = clamp(finiteOr(prev.pelvicCongestionMm, 0), 0, 100);
  const dtMin = Math.max(0, io.dt / 60);
  const dtDays = dtMin / 1440;

  const ovaries = readOvaries(io);
  let target = 0;
  let crampMm = 0;
  let bleedingRequestMl = 0;

  if (ovaries !== undefined) {
    if (ovaries.cycleDay < mensesDays) {
      target = 0.15;
      bleedingRequestMl = (flowMlPerCycle * prevEndometrium) / (mensesDays * 1440) * dtMin;
    } else if (ovaries.phase === 'luteal' || ovaries.progesteroneNmolL >= 5) {
      target = lutealEndometriumPlateau;
    } else {
      target = clamp(0.15 + 0.85 * ((ovaries.estradiolPmolL - 125) / (940 - 125)), 0.15, 1);
    }

    if (ovaries.cycleDay < crampDurationDays) {
      crampMm = clamp(crampPeakMm * (1 - ovaries.cycleDay / crampDurationDays), 0, 100);
    }
  }

  const endometriumRelative = target
    + (prevEndometrium - target) * 2 ** (-dtDays / endometriumHalfTimeDays);

  const nsfwEnabled = getNsfwSetting() !== false;
  const sexual = io.read('sexualResponse');
  const pituitary = io.read('pituitary');
  const testes = io.read('testes');
  const oxytocinPgMl = Math.max(0, finiteOr(pituitary?.oxytocinPgMl, 2));

  let contractionMm = 0;
  let pelvicCongestionMm = 0;
  if (nsfwEnabled) {
    const releaseInfo = evaluateSexualRelease({
      prevSexual: sexual,
      ovaries,
      testes,
      pituitary,
      actions: io.actions ?? [],
      simulatedSeconds: finiteOr(io.simulatedSeconds, 0),
    });
    const inOrgasm = releaseInfo.released || sexual?.phase === 'orgasm';
    const otContractionTarget = oxytocinPgMl > 6 ? clamp((oxytocinPgMl - 6) * 2.5, 0, 38) : 0;
    const contractionTarget = inOrgasm ? orgasmContractionPeakMm : otContractionTarget;
    if (inOrgasm) {
      contractionMm = clamp(Math.max(prevContraction, orgasmContractionPeakMm), 0, 100);
    } else {
      contractionMm = clamp(
        contractionTarget + (prevContraction - contractionTarget) * 2 ** (-dtMin / contractionHalfTimeMin),
        0,
        100,
      );
    }

    const arousalMm = clamp(finiteOr(sexual?.arousalMm, 0), 0, 100);
    const congestionTarget = clamp(0.85 * arousalMm, 0, 100);
    const congestionHalfTime = congestionTarget > prevCongestion ? 4 : congestionHalfTimeMin;
    pelvicCongestionMm = clamp(
      congestionTarget + (prevCongestion - congestionTarget) * 2 ** (-dtMin / congestionHalfTime),
      0,
      100,
    );
  }

  io.write({
    endometriumRelative,
    crampMm,
    bleedingRequestMl,
    bleedingMl: 0,
    contractionMm,
    pelvicCongestionMm,
  });
}
