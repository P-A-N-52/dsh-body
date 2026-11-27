/*
 * 部位 `hypothalamusThirst`：下丘脑口渴脚本，把 `bodyFluid` 纯水池的累计失水量转换为等效
 * 高渗（`Posm`）代理并映射到 0–100 mm VAS 的慢口渴驱动 `thirst`。
 * 只读轮初水账，不读自身历史、快速口咽信号或 ADH。主观减渴在 `interoception` 独立合成，
 * 不影响此读数或水账。本部位不产出动作、通知或饮水行为。
 *
 * 来源（笔记路径、原文定位、支撑什么、不能推出什么）
 * - SRC-HUGHES-2018 / hughes-2018：`organs/human-organs/brain/references/notes/hughes-2018.md`，
 *   12 项高渗盐水试验荟萃（n=167）：口渴血浆渗透压阈值 285.23 ± 1.29 mOsm/kg，
 *   越阈后 0–100 mm 等效 VAS 斜率 5.4 ± 0.7 mm/(mOsm/kg)，正常水合下限接近 0 mm。
 * - SRC-CHEUVRONT-2013 / cheuvront-2013：`organs/human-organs/brain/references/notes/cheuvront-2013.md`，
 *   轻中度热汗失水期（0.5%–2.0% 体重下降）主要通过高渗升高激活口渴。
 * - SRC-FIGARO-1997 / figaro-1997：`organs/human-organs/brain/references/notes/figaro-1997.md`，
 *   摘要 Results 的前 5 min 抑制只支持吸收前渴感下降的方向；快路在 `interoception`，不参与本脚本。
 *
 * 简化边界与未建模（design）：
 * - `bodyFluid` 为纯水账本，未单独追踪细胞内外钠离子与溶质；因此将
 *   `lossMl = referenceFluidVolumeMl - waterVolumeMl`（随体重同步 `bodyFluid.referenceVolumeMl`，
 *   缺 `waterVolumeMl` 时按 `waterDeficit × fluidDeficitScaleMl` 回退）经体重缩放的等效渗透容积
 *   `osmoticPoolReferenceMl` 折算为等效 `Posm = Posm0 × V_osm / max(1000, V_osm − lossMl)`。
 *   此代理不建模等渗失水、高渗盐摄入，也不会用口咽缓解修正慢驱动。
 */
import {
  getNumericParameterOverride,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'hypothalamusThirst';
export const actionTypes: string[] = [];

type ThirstState = {
  thirst: number;
};

type BodyFluidReading = {
  waterDeficit?: number;
  waterVolumeMl?: number;
};

type IO = {
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | undefined;
  write(next: ThirstState): void;
};

const parameters = loadParameters(new URL('./hypothalamus-thirst.parameters.json', import.meta.url));
const baselineMm = requireParameter(parameters, 'hypothalamusThirst.baselineMm');
const referenceOsmolalityMOsmKg = requireParameter(
  parameters,
  'hypothalamusThirst.referenceOsmolalityMOsmKg',
);
const osmolalityThresholdMOsmKg = requireParameter(
  parameters,
  'hypothalamusThirst.osmolalityThresholdMOsmKg',
);
const osmolalitySlopeMmPerMOsmKg = requireParameter(
  parameters,
  'hypothalamusThirst.osmolalitySlopeMmPerMOsmKg',
);
const osmoticPoolReferenceMl = scaleByBodyWeight(
  requireParameter(parameters, 'hypothalamusThirst.osmoticPoolReferenceMl'),
  'hypothalamusThirst.osmoticPoolReferenceMl',
);

const BODY_FLUID_REFERENCE_VOLUME_ML = 30000;
const BODY_FLUID_DEFICIT_SCALE_ML = 500;
const referenceFluidVolumeMl = getNumericParameterOverride('bodyFluid.referenceVolumeMl')
  ?? scaleByBodyWeight(BODY_FLUID_REFERENCE_VOLUME_ML, 'bodyFluid.referenceVolumeMl');
const fluidDeficitScaleMl = getNumericParameterOverride('bodyFluid.deficitScaleMl')
  ?? scaleByBodyWeight(BODY_FLUID_DEFICIT_SCALE_ML, 'bodyFluid.deficitScaleMl');
const MIN_MM = 0;
const MAX_MM = 100;

export const initialState: ThirstState = {
  thirst: baselineMm,
};

export const fields = {
  thirst: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const bodyFluid = io.read('bodyFluid');
  const rawVolume = bodyFluid?.waterVolumeMl;
  const waterLossMl = typeof rawVolume === 'number' && Number.isFinite(rawVolume)
    ? referenceFluidVolumeMl - rawVolume
    : finiteOr(bodyFluid?.waterDeficit, 0) * fluidDeficitScaleMl;

  if (waterLossMl <= 0) {
    io.write({ thirst: clamp(baselineMm, MIN_MM, MAX_MM) });
    return;
  }

  const remainingEffectivePoolMl = Math.max(1000, osmoticPoolReferenceMl - waterLossMl);
  const equivalentOsmolality = referenceOsmolalityMOsmKg * (osmoticPoolReferenceMl / remainingEffectivePoolMl);
  const excessMOsmKg = Math.max(0, equivalentOsmolality - osmolalityThresholdMOsmKg);
  io.write({
    thirst: clamp(baselineMm + osmolalitySlopeMmPerMOsmKg * excessMOsmKg, MIN_MM, MAX_MM),
  });
}
