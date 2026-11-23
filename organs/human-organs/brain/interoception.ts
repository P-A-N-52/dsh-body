/*
 * 部位 `interoception`：把胃壁机械感受、胃饥饿素和十二指肠营养暴露汇成
 * 0–100 mm VAS 代理的饥饿（hunger）与饱满（fullness），并转出下丘脑口渴驱动
 * （thirst）、膀胱充盈的尿意代理（urinaryUrgency）与子宫痉挛的痛经代理
 * （uterus.crampMm），再由五路超出舒适区的强度取最大值得到不适代理（discomfort）。
 * `uterus` 与 `sexualResponse` 是可选部位的软读：未加载时按 0，根清单行为逐点不变；
 * 其中 `sexualResponse.arousalMm` 只转成体感读数 `sexualArousalMm`，不参与 `discomfort`，
 * 也不触发通知。本脚本只产出体感，不发送通知，也不读自己的上一轮状态。
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
 * - SRC-DEWACHTER-2003 / de-wachter-2003：`organs/human-organs/bladder/references/notes/de-wachter-2003.md`，
 *   摘要只确认 15 名健康女学生，是否未产摘要未说明；190/268/410 mL 是设计文档/主会话全文交接的
 *   FSF/FDV/SDV 量级，摘要未报告，原文表/图与误差类型待核。只借 410 mL 作为尿意归一化的量级
 *   锚点；它不是摘要已报告值，不是自然排尿阈值，也不是个体尿意标定，不能从膀胱体积换算压力。
 *
 * design（不是人体测量或拟合）
 * - 线性叠加、两个基线、六个增益（hunger / fullness 各对相对饥饿素、mechanical 与
 *   nutrientExposure 一条）、输入钳位与缺失默认值（mechanical 0、相对饥饿素 1、
 *   nutrientExposure 0）全部是工程假设。没有来源把机械感受、营养暴露或相对饥饿素校准到
 *   0–100 mm VAS；上述研究只支撑方向、时间窗或定性排序。
 * - `thirst` 不是本脚本计算的感觉强度，而是把 `hypothalamusThirst.thirst` 原样钳到
 *   0–100 mm；缺失或非有限输入回落 `interoception.thirst.fallbackMm`（`design`，默认 50 mm），
 *   与口渴脚本的 `design` 基线一致。不建模血浆渗透压、口咽暂缓解渴或饮水动机；`thirst` 不
 *   自动产生喝水动作。
 * - `urinaryUrgency = clamp(100 mm × 轮初 bladder.volumeMl / 410 mL, 0, 100)`。410 mL 只是
 *   De Wachter 队列 SDV 的交接量级锚点（`design`，原文表/图待核），不是摘要已报告值，
 *   不是自然排尿阈值，也不是膀胱压力；它读取轮初膀胱量，所以排尿后的低尿意和当轮新转入的
 *   尿都在下一轮读出。
 * - 输出钳到 [0, 100]；三路输入的线性叠加不是论文方程，也没有交互项、阈值或饱和。
 *   非有限读数先在输入侧回落到缺失默认值；合成结果只对 NaN 回落对应基线，±Infinity 由
 *   [0, 100] 钳位截到边界，状态不写出 NaN 或 Infinity。
 * - `discomfort` 是本轮五路感受超过 `interoception.discomfort.onsetMm`（`design`，默认
 *   70 mm）后的超出强度取最大值：
 *   `excess(x) = clamp(100 × (x − onsetMm) / (100 − onsetMm), 0, 100)`，
 *   `discomfort = max(excess(hunger), excess(fullness), excess(thirst),
 *   excess(urinaryUrgency), excess(uterineCramp))`，其中
 *   `uterineCramp = clamp(finiteOr(uterus.crampMm, 0), 0, 100)`。`uterus` 是可选部位：
 *   未加载或 `crampMm` 缺失、NaN、非有限时按 0（沿用 `finiteOr` 惯例），根清单行为不变；
 *   `crampMm` 由子宫脚本按 `design` 参数产出，本脚本不核对来源，也不把它当作疼痛测量。
 *   它是“当前最强的不适感受”代理，不是疼痛评分、情绪、疾病严重度或五感受总分；没有
 *   来源把 70 mm 或该斜率标定到主观不适，取最大值也只是为了避免没有依据的相加。不读
 *   自身历史，不产生动作或通知，也没有新增历史状态。
 * - `sexualArousalMm = clamp(finiteOr(sexualResponse.arousalMm, 0), 0, 100)` 是性反应
 *   部位的软读，只作为 0–100 mm 体感读数写入状态：`sexualResponse` 未加载、字段缺失、
 *   NaN 或非有限时按 0；它不参与 `discomfort`，也不产生动作或通知。
 * - 只读轮初快照，同一轮摄入下一轮才反映；不建模恶心、腹胀、疼痛本身（只把
 *   `uterus.crampMm` 痉挛代理并入 discomfort）、过度饱满、餐食成分与个体差异；
 *   不调用 io.notify。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'interoception';
export const actionTypes: string[] = [];

type InteroceptionState = {
  hunger: number;
  fullness: number;
  thirst: number;
  urinaryUrgency: number;
  discomfort: number;
  sexualArousalMm: number;
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

type ThirstReading = {
  thirst?: number;
};

type BladderReading = {
  volumeMl?: number;
};

type UterusReading = {
  crampMm?: number;
};

type SexualResponseReading = {
  arousalMm?: number;
};

type IO = {
  read(id: 'stomachSensory'): Readonly<SensoryReading> | undefined;
  read(id: 'stomachGhrelin'): Readonly<GhrelinReading> | undefined;
  read(id: 'duodenum'): Readonly<DuodenumReading> | undefined;
  read(id: 'hypothalamusThirst'): Readonly<ThirstReading> | undefined;
  read(id: 'bladder'): Readonly<BladderReading> | undefined;
  read(id: 'uterus'): Readonly<UterusReading> | undefined;
  read(id: 'sexualResponse'): Readonly<SexualResponseReading> | undefined;
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
const thirstFallbackMm = requireParameter(parameters, 'interoception.thirst.fallbackMm');
const urinaryUrgencyReferenceVolumeMl = requireParameter(
  parameters,
  'interoception.urinaryUrgency.referenceVolumeMl',
);
const discomfortOnsetMm = requireParameter(parameters, 'interoception.discomfort.onsetMm');

export const initialState: InteroceptionState = {
  hunger: hungerBaseline,
  fullness: fullnessBaseline,
  thirst: thirstFallbackMm,
  urinaryUrgency: 0,
  discomfort: 0,
  sexualArousalMm: 0,
};

export const fields = {
  hunger: { unit: 'mm', mode: 'absolute' },
  fullness: { unit: 'mm', mode: 'absolute' },
  thirst: { unit: 'mm', mode: 'absolute' },
  urinaryUrgency: { unit: 'mm', mode: 'absolute' },
  discomfort: { unit: 'mm', mode: 'absolute' },
  sexualArousalMm: { unit: 'mm', mode: 'absolute' },
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

function excessOverOnset(value: number, onsetMm: number): number {
  return clamp((100 * (value - onsetMm)) / (100 - onsetMm), 0, 100);
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
  const thirst = clampOrFallback(
    finiteOr(io.read('hypothalamusThirst')?.thirst, thirstFallbackMm),
    thirstFallbackMm,
  );
  const bladderVolume = Math.max(0, finiteOr(io.read('bladder')?.volumeMl, 0));
  const urinaryUrgency = clampOrFallback(
    (100 * bladderVolume) / urinaryUrgencyReferenceVolumeMl,
    0,
  );
  const uterineCramp = clamp(finiteOr(io.read('uterus')?.crampMm, 0), 0, 100);
  const sexualArousalMm = clamp(finiteOr(io.read('sexualResponse')?.arousalMm, 0), 0, 100);
  const discomfort = Math.max(
    excessOverOnset(hunger, discomfortOnsetMm),
    excessOverOnset(fullness, discomfortOnsetMm),
    excessOverOnset(thirst, discomfortOnsetMm),
    excessOverOnset(urinaryUrgency, discomfortOnsetMm),
    excessOverOnset(uterineCramp, discomfortOnsetMm),
  );

  io.write({ hunger, fullness, thirst, urinaryUrgency, discomfort, sexualArousalMm });
}
