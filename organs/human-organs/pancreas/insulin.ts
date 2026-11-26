/*
 * 胰腺内分泌胰岛素（`insulinPmolL`, pmol/L）与相对胰高血糖素（`glucagonRelative`, 1）脚本；
 * 部位 `pancreasEndocrine` 的唯一写者。
 *
 * 动力学（design，吸收 Thorsteinsson 1985 可饱和清除与 Cryer 68 mg/dL 阈值方向）：
 * - `insulinPmolL`：Michaelis-Menten 饱和清除 ODE
 *   `dC/dt = secretion(G) - Vmax * C / (Km + C)`，在 `G = 90 mg/dL` 精确维持静息 `60 pmol/L`；
 *   下游消费者（`liver` / `muscleGlucose` / `smallIntestine`）以 `insulinPmolL / 60` 归一化。
 * - `glucagonRelative`：90 mg/dL 以下按温和斜率升高，跌破 `68 mg/dL` 阈值后叠加陡增反调节增益。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'pancreasEndocrine';
export const actionTypes: string[] = [];

type PancreasState = {
  insulinPmolL: number;
  glucagonRelative: number;
};

type GlucoseState = {
  concentrationMgDl: unknown;
};

const parameters = loadParameters(new URL('./insulin.parameters.json', import.meta.url));
const referenceGlucoseMgDl = requireParameter(parameters, 'pancreasEndocrine.referenceGlucoseMgDl');
const basalInsulinPmolL = requireParameter(parameters, 'pancreasEndocrine.insulin.basalPmolL');
const insulinGlucoseGain = requireParameter(
  parameters,
  'pancreasEndocrine.insulin.glucoseGainPmolLPerMinPerMgDl',
);
const clearanceKmPmolL = requireParameter(parameters, 'pancreasEndocrine.insulin.clearanceKmPmolL');
const clearanceVmaxPmolLPerMin = requireParameter(
  parameters,
  'pancreasEndocrine.insulin.clearanceVmaxPmolLPerMin',
);
const maxInsulinPmolL = requireParameter(parameters, 'pancreasEndocrine.insulin.maxPmolL');
const glucagonHypoThresholdMgDl = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.hypoglycemiaThresholdMgDl',
);
const glucagonGainPerMgDl = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.glucoseGainPerMgDl',
);
const glucagonCounterregGainPerMgDl = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.counterregGainPerMgDl',
);
const glucagonHalfTimeMin = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.responseHalfTimeMin',
);
const glucagonMaxRelative = requireParameter(parameters, 'pancreasEndocrine.glucagon.maxRelative');

export const initialState: PancreasState = {
  insulinPmolL: basalInsulinPmolL,
  glucagonRelative: 1,
};

export const fields = {
  insulinPmolL: { unit: 'pmol/L', mode: 'absolute' },
  glucagonRelative: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'pancreasEndocrine'): Readonly<Partial<PancreasState>> | undefined;
  read(id: 'glucose'): Readonly<GlucoseState> | undefined;
  readonly dt: number;
  write(next: PancreasState): void;
};

const basalInsulinSecretion = (clearanceVmaxPmolLPerMin * basalInsulinPmolL)
  / (clearanceKmPmolL + basalInsulinPmolL);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolvePrevState(saved: Readonly<Partial<PancreasState>> | undefined): PancreasState {
  if (!saved) return initialState;
  const insulinPmolL = typeof saved.insulinPmolL === 'number' && Number.isFinite(saved.insulinPmolL)
    ? saved.insulinPmolL
    : basalInsulinPmolL;
  const glucagonRelative = typeof saved.glucagonRelative === 'number' && Number.isFinite(saved.glucagonRelative)
    ? saved.glucagonRelative
    : 1;
  return { insulinPmolL, glucagonRelative };
}

function integrateInsulin(startPmolL: number, secretion: number, dtMin: number): number {
  if (dtMin <= 0) return clamp(startPmolL, 0, maxInsulinPmolL);
  const steps = Math.max(1, Math.min(480, Math.ceil(dtMin / 0.5)));
  const h = dtMin / steps;
  let c = clamp(startPmolL, 0, maxInsulinPmolL);
  const dCdt = (val: number) => secretion - (clearanceVmaxPmolLPerMin * val) / (clearanceKmPmolL + val);
  for (let i = 0; i < steps; i++) {
    const k1 = dCdt(c);
    const mid = clamp(c + h * k1, 0, maxInsulinPmolL);
    const k2 = dCdt(mid);
    c = clamp(c + 0.5 * h * (k1 + k2), 0, maxInsulinPmolL);
  }
  return c;
}

export function heartbeat(io: IO): void {
  const prev = resolvePrevState(io.read(id));
  const glucose = io.read('glucose');

  let glucoseMgDl = referenceGlucoseMgDl;
  if (glucose !== undefined) {
    const reading = glucose.concentrationMgDl;
    if (typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0) {
      throw new Error(`pancreasEndocrine: invalid glucose.concentrationMgDl: ${String(reading)}`);
    }
    glucoseMgDl = reading;
  }

  const dtMin = Math.max(0, io.dt / 60);
  const secretion = glucoseMgDl >= referenceGlucoseMgDl
    ? basalInsulinSecretion + insulinGlucoseGain * (glucoseMgDl - referenceGlucoseMgDl)
    : Math.max(
      0,
      basalInsulinSecretion * Math.max(0, (glucoseMgDl - 45) / Math.max(1, referenceGlucoseMgDl - 45)),
    );
  const insulinPmolL = integrateInsulin(prev.insulinPmolL, secretion, dtMin);

  const deepDrop = Math.max(0, glucagonHypoThresholdMgDl - glucoseMgDl);
  const glucagonTarget = clamp(
    1
      + glucagonGainPerMgDl * (referenceGlucoseMgDl - glucoseMgDl)
      + glucagonCounterregGainPerMgDl * deepDrop,
    0,
    glucagonMaxRelative,
  );
  const glucagonRetention = 2 ** (-dtMin / glucagonHalfTimeMin);
  const glucagonRelative = glucagonTarget + (prev.glucagonRelative - glucagonTarget) * glucagonRetention;

  io.write({ insulinPmolL, glucagonRelative });
}
