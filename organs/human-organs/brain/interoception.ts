/*
 * 部位 `interoception`：把胃壁机械感受、胃饥饿素和十二指肠营养暴露汇成
 * 0–100 mm VAS 代理的饥饿（hunger）与饱满（fullness）。P1 只产出体感，
 * 不发送通知，也不读自己的上一轮状态。
 *
 * 来源（笔记路径、原文定位、支撑什么、不能推出什么）
 * - SRC-CUMMINGS-2001 / cummings-2001：`organs/human-organs/stomach/references/notes/cummings-2001.md`，
 *   摘要 Results（PMID 11473029；abstract_read，未读全文）。固定餐时健康成人 n=10，餐前血浆饥饿素
 *   升约 2 倍、餐后 1 h 内降至谷值；只支撑“餐后饥饿素下降”的方向，以及饥饿随饥饿素同向变化的方向性假设。
 *   摘要未说明总饥饿素还是酰化饥饿素，未给绝对浓度、餐型与采样间隔，也没有报告主观饥饿评分；
 *   不能把“约 2 倍”换算成相对浓度幅度，也不能用它标定 ghrelinGain。
 * - SRC-LEONE-2022 / leone-2022：`organs/human-organs/stomach/references/notes/leone-2022.md`，
 *   Table 2、Table 4 与 Results（Ghrelin）；全文已读。混合餐后 60/120/180 min，女性参考组血清
 *   未酰化饥饿素 ΔG −0.56/−0.70/−0.58 ng/mL，同批 H/F 评分变化见 Table 2；支撑“餐后相对饥饿素
 *   下降时饥饿下降、饱满上升”的方向。系数是混合模型估计、女性参考组，不是个体曲线；餐量按个体
 *   日耗能 40% 定，绝对能量与体积未报告；不能推出能量-抑制幅度关系，也不能把 ΔG 与 ΔH/ΔF 的
 *   配对试算当成论文原方程或独立验证。
 * - SRC-LEVINE-2015 / levine-2015：`organs/human-organs/stomach/references/notes/levine-2015.md`，
 *   Table 1 与 Methods 第 3 节 Procedure；全文已读。237 mL、355 kcal 高脂液餐后 0–60 min 的
 *   胃饱满 VAS（0–100，n=16，mean±SEM）；支撑 fullness 对胃充盈的方向和 0–100 mm 量表口径。
 *   它测的是症状强度，不是胃容积、张力或迷走传入，也没有测饥饿素；只到 60 min，且样本经 EGG
 *   水负荷筛选；不能用于幅度标定或个体正常值。
 * - SRC-CAMPS-2016 / camps-2016：`organs/human-organs/stomach/references/notes/camps-2016.md`，
 *   摘要 Results（PMID 27281305；abstract_read，未读全文）。500 mL 奶昔 40 min 时 thick-100 饱感
 *   58、thin-500 48，而胃排空 t50 分别为 41 与 69.5 min；支撑“饱感排序不必与排空速率一致”，
 *   即 fullness 不能只由 nutrientExposure 或 mechanical 解释。摘要未注明统计量类型、量表锚点与
 *   时间原点；只有两个组级点值，不能用于幅度标定。
 *
 * design（不是人体测量或拟合）
 * - 线性叠加、两个基线、八个增益、输入钳位与缺失默认值（mechanical 0、相对饥饿素 1、
 *   nutrientExposure 0）全部是工程假设。没有来源把机械感受、营养暴露或相对饥饿素校准到
 *   0–100 mm VAS；上述研究只支撑方向、时间窗或定性排序。
 * - 输出钳到 [0, 100]；三路输入的线性叠加不是论文方程，也没有交互项、阈值或饱和。
 *   极端输入相乘后若出现非有限中间值，回落到对应基线，不写出 NaN。
 * - 只读轮初快照，同一轮摄入下一轮才反映；不建模恶心、腹胀、疼痛、过度饱满、餐食成分
 *   与个体差异；P1 不调用 io.notify。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'interoception';
export const actionTypes: string[] = [];

type InteroceptionState = {
  hunger: number;
  fullness: number;
};

type SensoryReading = {
  mechanical?: number;
};

type GhrelinReading = {
  relativeConcentration?: number;
};

type DuodenumReading = {
  nutrientExposure?: number;
};

type IO = {
  read(id: 'stomachSensory'): Readonly<SensoryReading> | undefined;
  read(id: 'stomachGhrelin'): Readonly<GhrelinReading> | undefined;
  read(id: 'duodenum'): Readonly<DuodenumReading> | undefined;
  write(next: InteroceptionState): void;
};

const parameters = loadParameters(new URL('./interoception.parameters.json', import.meta.url));
const hungerBaseline = requireParameter(parameters, 'interoception.hunger.baselineMm');
const fullnessBaseline = requireParameter(parameters, 'interoception.fullness.baselineMm');
const hungerGhrelinGain = requireParameter(parameters, 'interoception.hunger.ghrelinGain');
const fullnessGhrelinGain = requireParameter(parameters, 'interoception.fullness.ghrelinGain');
const hungerMechanicalGain = requireParameter(parameters, 'interoception.hunger.mechanicalGain');
const fullnessMechanicalGain = requireParameter(parameters, 'interoception.fullness.mechanicalGain');
const hungerNutrientGain = requireParameter(parameters, 'interoception.hunger.nutrientGain');
const fullnessNutrientGain = requireParameter(parameters, 'interoception.fullness.nutrientGain');

export const initialState: InteroceptionState = {
  hunger: hungerBaseline,
  fullness: fullnessBaseline,
};

export const fields = {
  hunger: { unit: 'mm', mode: 'absolute' },
  fullness: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampOrFallback(value: number, fallback: number): number {
  return Number.isNaN(value) ? fallback : clamp(value, 0, 100);
}

export function heartbeat(io: IO): void {
  const mechanical = clamp(finiteOr(io.read('stomachSensory')?.mechanical, 0), 0, 1);
  const ghrelin = Math.max(0, finiteOr(io.read('stomachGhrelin')?.relativeConcentration, 1));
  const nutrient = Math.max(0, finiteOr(io.read('duodenum')?.nutrientExposure, 0));
  const hunger = clampOrFallback(
    hungerBaseline
      + hungerGhrelinGain * (ghrelin - 1)
      + hungerMechanicalGain * mechanical
      + hungerNutrientGain * nutrient,
    hungerBaseline,
  );
  const fullness = clampOrFallback(
    fullnessBaseline
      + fullnessGhrelinGain * (ghrelin - 1)
      + fullnessMechanicalGain * mechanical
      + fullnessNutrientGain * nutrient,
    fullnessBaseline,
  );

  io.write({ hunger, fullness });
}
