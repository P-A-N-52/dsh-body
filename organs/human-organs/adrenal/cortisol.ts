/*
 * 肾上腺皮质总皮质醇动力学脚本；部位 `adrenal` 的唯一写者。
 *
 * 物理浓度与实证动力学（nmol/L）：
 * - 清除半衰期 `49 min`（SRC-KEENAN-2004，`prior`），k = ln(2) / 49 min^-1。
 * - ACTH (`pituitary.acthPgMl`, pg/mL) 通过 Hill/Sigmoid 响应驱动皮质醇分泌，
 *   `EC50 = 26 pg/mL`、`maxSecretionNmolLPerMin = 10 nmol/(L·min)`（SRC-KEENAN-2004，`prior`）。
 * - 静息参考点 `acthPgMl = 12 pg/mL` 时，分泌与清除精确平衡于 `180 nmol/L`（`design`）。
 * - 未建模：游离皮质醇双快时间尺度（1.8 / 4.1 min）、CBG 动态饱和、肾上腺髓质/醛固酮。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'adrenal';
export const actionTypes: string[] = [];

type AdrenalState = {
  cortisolNmolL: number;
};

type PituitaryReading = {
  acthPgMl?: unknown;
};

const parameters = loadParameters(new URL('./cortisol.parameters.json', import.meta.url));
const referenceCortisolNmolL = requireParameter(parameters, 'adrenal.referenceCortisolNmolL');
const referenceActhPgMl = requireParameter(parameters, 'adrenal.referenceActhPgMl');
const acthEc50PgMl = requireParameter(parameters, 'adrenal.acthEc50PgMl');
const maxSecretionNmolLPerMin = requireParameter(parameters, 'adrenal.maxSecretionNmolLPerMin');
const hillExponent = requireParameter(parameters, 'adrenal.hillExponent');
const eliminationHalfTimeMin = requireParameter(parameters, 'adrenal.eliminationHalfTimeMin');

const MIN_CORTISOL_NMOL_L = 0;
const MAX_CORTISOL_NMOL_L = 800;

export const initialState: AdrenalState = {
  cortisolNmolL: referenceCortisolNmolL,
};

export const fields = {
  cortisolNmolL: { unit: 'nmol/L', mode: 'absolute' },
};

type IO = {
  read(id: 'adrenal'): Readonly<Partial<AdrenalState>> | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | undefined;
  readonly dt: number;
  write(next: AdrenalState): void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hillResponse(acthPgMl: number): number {
  if (acthPgMl <= 0) return 0;
  const powered = acthPgMl ** hillExponent;
  return powered / (acthEc50PgMl ** hillExponent + powered);
}

const kElim = Math.LN2 / eliminationHalfTimeMin;
const refHill = hillResponse(referenceActhPgMl);
const basalSecretionNmolLPerMin = Math.max(
  0,
  (referenceCortisolNmolL * kElim - maxSecretionNmolLPerMin * refHill) / Math.max(1e-6, 1 - refHill),
);

function resolvePrevCortisol(saved: Readonly<Partial<AdrenalState>> | undefined): number {
  if (!saved) return initialState.cortisolNmolL;
  if (typeof saved.cortisolNmolL === 'number' && Number.isFinite(saved.cortisolNmolL)) {
    return saved.cortisolNmolL;
  }
  return initialState.cortisolNmolL;
}

export function heartbeat(io: IO): void {
  const prevCortisol = resolvePrevCortisol(io.read(id));
  const pituitary = io.read('pituitary');

  let acthPgMl = referenceActhPgMl;
  if (pituitary !== undefined) {
    const reading = pituitary.acthPgMl;
    if (typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0) {
      throw new Error(`adrenal: invalid pituitary.acthPgMl: ${String(reading)}`);
    }
    acthPgMl = reading;
  }

  const h = hillResponse(acthPgMl);
  const secretionNmolLPerMin = basalSecretionNmolLPerMin + (maxSecretionNmolLPerMin - basalSecretionNmolLPerMin) * h;
  const steadyTargetNmolL = secretionNmolLPerMin / kElim;

  const dtMin = Math.max(0, io.dt / 60);
  const retention = 2 ** (-dtMin / eliminationHalfTimeMin);
  const cortisolNmolL = clamp(
    steadyTargetNmolL + (prevCortisol - steadyTargetNmolL) * retention,
    MIN_CORTISOL_NMOL_L,
    MAX_CORTISOL_NMOL_L,
  );

  io.write({ cortisolNmolL });
}
