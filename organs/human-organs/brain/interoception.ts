/*
 * 部位 `interoception`：把胃壁机械感受、胃饥饿素和十二指肠营养暴露汇成
 * 0–100 mm VAS 代理的饥饿（hunger）与饱满（fullness），并转出下丘脑口渴驱动
 * （thirst）、膀胱充盈的尿意代理（urinaryUrgency）、子宫痉挛的痛经代理
 * （uterineCrampMm，同步进入不适）、性反应兴奋体感（sexualArousalMm）、血氧气促代理（dyspneaMm）、
 * 口腔干燥代理（dryMouthMm）、性欲代理（libidoMm）、便意代理（bowelUrgencyMm）、低血糖乏力心慌
 * （hypoglycemiaMm）、心悸/低血压不适（palpitationMm）、出汗潮湿黏腻（sweatDampMm）与肌肉疲乏
 * （muscleFatigueMm），再由七路超出舒适区的强度取最大值得到不适代理（discomfort，第五路是
 * `uterus.crampMm`，第六路是受 `nsfw` 门控的乳腺胀奶 `mammaryGlands.fullnessMm`，第七路是食管
 * 呛咳风险 `esophagus.chokingMm`）；另把轮初
 * HPA 皮质醇与松果体褪黑素/睡眠压力转成压力（stressMm）和困倦（sleepinessMm）两个
 * 0–100 mm 读数，把轮初核心温度转成热不适（heatMm）与冷不适（coldMm）两个读数，
 * 把轮初血钙转成低钙（hypocalcemiaMm）与高钙（hypercalcemiaMm）两个读数。
 * `uterus`、`mammaryGlands`、`sexualResponse`、`bloodOxygen`、`adrenal`、`pineal`、
 * `sleep`、`salivaryGlands`、`testes`、`thermoregulation`、`bloodCalcium`、`esophagus`、
 * `colon`、`glucose`、`heart`、`blood`、`physicalActivity`、`skin` 与
 * `muscleHead`/`muscleTrunk`/`muscleLimbs` 都是可选部位的软读：
 * 未加载时按基线/0；其中 `sexualArousalMm`、`libidoMm` 与 `mammaryFullness` 受全局
 * `nsfw` 开关门控（`getNsfwSetting() === false` 时置 0）；`esophagus.chokingMm` 只留在
 * `discomfort` 内，不单独输出或发通知。本脚本只产出体感，不发送通知；除 `sweatDampMm` 与
 * `muscleFatigueMm` 读取自己的上一轮衰减状态外，其余读数不读自身历史。
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
 * - `discomfort` 是本轮七路感受超过 `interoception.discomfort.onsetMm`（`design`，默认
 *   70 mm）后的超出强度取最大值：
 *   `excess(x) = clamp(100 × (x − onsetMm) / (100 − onsetMm), 0, 100)`，
 *   `discomfort = max(excess(hunger), excess(fullness), excess(thirst),
 *   excess(urinaryUrgency), excess(uterineCramp), excess(mammaryFullness),
 *   excess(esophagealChoking))`，其中
 *   `uterineCramp = clamp(finiteOr(uterus.crampMm, 0), 0, 100)`，
 *   `mammaryFullness = clamp(finiteOr(mammaryGlands.fullnessMm, 0), 0, 100)`，
 *   `esophagealChoking = clamp(finiteOr(esophagus.chokingMm, 0), 0, 100)`。`uterus`、
 *   `mammaryGlands` 与 `esophagus` 都是可选部位：未加载或字段缺失、NaN、非有限时按 0
 *   （沿用 `finiteOr` 惯例），根清单行为不变；`crampMm` 由子宫脚本、`fullnessMm` 由乳腺
 *   脚本、`chokingMm` 由食管脚本按 `design` 参数产出，本脚本不核对来源，也不把它们当作
 *   疼痛、乳腺压力或临床呛咳风险测量。
 *   它是“当前最强的不适感受”代理，不是疼痛评分、情绪、疾病严重度或七感受总分；没有
 *   来源把 70 mm 或该斜率标定到主观不适，取最大值也只是为了避免没有依据的相加。不读
 *   自身历史，不产生动作或通知，也没有新增历史状态。
 * - `sexualArousalMm = clamp(finiteOr(sexualResponse.arousalMm, 0), 0, 100)` 是性反应
 *   部位的软读，只作为 0–100 mm 体感读数写入状态：`sexualResponse` 未加载、字段缺失、
 *   NaN 或非有限时按 0；它不参与 `discomfort`，也不产生动作或通知。
 * - `dyspneaMm = clamp(100 × finiteOr(bloodOxygen.oxygenDeficit, 0), 0, 100)` 是血氧池
 *   未满足需求比例的软读（`design` 口径，不是临床气促量表）：`bloodOxygen` 未加载、
 *   字段缺失、NaN 或非有限时按 0；它只是 0–100 mm 气促读数，不参与 `discomfort`，
 *   也不产生动作或通知。
 * - `stressMm = clamp(100 × (cortisolRelative − 1) / 2, 0, 100)` 与
 *   `sleepinessMm = clamp(100 × (melatoninRelative − 0.2) / 1.6, 0, 100)` 是 HPA 与
 *   松果体部位的软读（`design` 口径，不是压力或困倦量表）：只读轮初
 *   `adrenal.cortisolRelative` 与 `pineal.melatoninRelative`；部位未加载、字段缺失、
 *   NaN 或非有限时按 0。它们只是 0–100 mm 读数，不参与 `discomfort`，也不产生动作
 *   或通知。褪黑素曲线由 `pineal` 按仿真时刻计算，不用现实时间。
 * - `dryMouthMm = clamp(100 − salivaryGlands.mouthMoistureMm, 0, 100)` 是口腔湿润度的
 *   反向软读（`design` 口径，不是口干量表）：只读轮初 `salivaryGlands.mouthMoistureMm`；
 *   部位未加载、字段缺失、NaN 或非有限时按 0（不按最大口干），与其余可选读数一致。
 *   湿润度超出 0–100 时由钳位截断；它不参与 `discomfort`，也不产生动作或通知。
 * - `libidoMm = clamp(100 × (testosteroneRelative − 0.5), 0, 100)` 是睾丸部位的软读
 *   （`design` 口径，不是性欲量表、睾酮浓度或临床评估）：只读轮初
 *   `testes.testosteroneRelative`，相对值 0.5 及以下为 0、1 为 50、1.5 及以上为 100；
 *   `testes` 未加载、字段缺失、NaN 或非有限时按 0.5（即读数 0）。它只是 0–100 mm
 *   读数，不参与 `discomfort`，也不产生动作或通知；相对值 1 的工程基线对应 50 mm，
 *   没有来源把该斜率标定到主观性欲。
 * - `bowelUrgencyMm` 优先直接软读轮初 `colon.bowelUrgencyMm`（有限时钳到 [0, 100]）；
 *   若该字段缺失或非有限，再回落到 `clamp(100 × colon.stoolG / 200, 0, 100)`（`design` 口径，
 *   200 g 是与 `colon.referenceStoolG` 一致的工程参考量）；`colon` 未加载、字段全缺失或非有限时
 *   按 0，负值也按 0。它只是 0–100 mm 读数，不参与 `discomfort`，也不产生动作或通知；
 *   `defecate` 由会话显式触发，没有自动排便反射。
 * - `heatMm = clamp(50 × (coreTemperatureC − 37), 0, 100)` 与
 *   `coldMm = clamp(50 × (37 − coreTemperatureC), 0, 100)` 是 `thermoregulation` 的软读
 *   （`design` 口径，不是体温测量或冷热感觉量表）：只读轮初 `coreTemperatureC`；部位未
 *   加载、字段缺失、NaN 或非有限时按 0。50 mm/°C 与 37°C 设定点是工程常量，与
 *   `thermoregulation.setpointC` 的默认值一致；两个读数不参与 `discomfort`，也不产生动作
 *   或通知。不建皮肤温度、血管舒缩、发热/低温症或体温感觉分级。
 * - `hypocalcemiaMm = clamp(50 × (9.5 − bloodCalcium.mgDl), 0, 100)` 与
 *   `hypercalcemiaMm = clamp(50 × (bloodCalcium.mgDl − 9.5), 0, 100)` 是 `bloodCalcium`
 *   的软读（`design` 口径，不是麻木/痉挛/临床高钙症状量表）：只读轮初 `mgDl`；部位未
 *   加载、字段缺失、NaN 或非有限时按参考值 9.5 处理，两个读数都为 0。50 mm/(mg/dL) 与
 *   9.5 mg/dL 是工程常量，与 `parathyroid.referenceCalciumMgDl` 和
 *   `calcium.referenceMgDl` 的默认值一致；两个读数不参与 `discomfort`，也不产生动作或
 *   通知。不建真实钙感受、神经肌肉兴奋性或心电图改变。
 * - `hypoglycemiaMm = clamp(4 × (75 − glucose.concentrationMgDl), 0, 100)`（`design` 口径）：
 *   `glucose` 未加载或字段非有限时为 0。
 * - `palpitationMm = max(hrPart, bpPart)`（`design` 口径）：仅在未加载 `physicalActivity`、
 *   `remainingExerciseMin <= 0` 或 `intensity < 0.2` 时按 `clamp((HR − 115) × 1.5, 0, 100)`
 *   计入静止心率过快，`bpPart = clamp((95 − blood.systolicMmHg) × 5, 0, 100)`；`heart` /
 *   `blood` 未加载或字段非有限时对应项为 0。
 * - `sweatDampMm`（`design` 口径）：读取上一轮 `interoception.sweatDampMm`（缺省 0）按 20 min
 *   半时衰减，再叠加 `skin.sweatVolumeMl` 折算的瞬时汗率（`sweatRateMlMin × 4 × dtMin`）。
 * - `muscleFatigueMm`（`design` 口径）：读取上一轮 `interoception.muscleFatigueMm`（缺省 0）
 *   按 30 min 半时恢复并叠加运动强度增量（`2.1 × intensity × dtMin`），再叠加已加载骨骼肌区域
 *   （`muscleHead`/`muscleTrunk`/`muscleLimbs`，按体重缩放的 15/135/150 g 基线）糖原亏空比例的
 *   0.5 倍。
 * - `uterineCrampMm = clamp(finiteOr(uterus.crampMm, 0), 0, 100)` 将轮初子宫痉挛读数暴露到状态。
 * - `sleepinessMm`：未加载 `sleep` 时保留原松果体褪黑素公式逐点不变；加载 `sleep` 时结合
 *   `sleep.sleepPressureMm`（若同时存在 `pineal` 则取 `clamp(0.4 × melatoninMm + 0.8 × sleepPressureMm, 0, 100)`，
 *   否则直接取 `sleepPressureMm`）。
 * - `nsfw` 门控：`getNsfwSetting() === false` 时将 `sexualArousalMm`、`libidoMm` 与
 *   `discomfort` 内的乳腺胀奶贡献置 0；`null`（未配置的单测上下文）与 `true` 保持可读。
 * - 只读轮初快照，同一轮摄入下一轮才反映；不建模恶心、腹胀、疼痛本身（只把
 *   `uterus.crampMm` 痉挛代理并入 `discomfort` 与 `uterineCrampMm`）、过度饱满、餐食成分与
 *   个体差异；不调用 io.notify。
 */
import {
  getNsfwSetting,
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'interoception';
export const actionTypes: string[] = [];

export type ExtensibleSensation = {
  intensityMm: number;
  urgent?: boolean;
  nsfw?: boolean;
  contextText?: string;
  wakeText?: string;
};

type InteroceptionState = {
  hunger: number;
  fullness: number;
  thirst: number;
  urinaryUrgency: number;
  discomfort: number;
  sexualArousalMm: number;
  dyspneaMm: number;
  stressMm: number;
  sleepinessMm: number;
  dryMouthMm: number;
  libidoMm: number;
  bowelUrgencyMm: number;
  heatMm: number;
  coldMm: number;
  hypocalcemiaMm: number;
  hypercalcemiaMm: number;
  hypoglycemiaMm: number;
  palpitationMm: number;
  sweatDampMm: number;
  muscleFatigueMm: number;
  uterineCrampMm: number;
  mammaryFullnessMm: number;
  hedonicCalmMm: number;
  sensations?: Record<string, ExtensibleSensation>;
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

type MammaryGlandsReading = {
  fullnessMm?: number;
};

type SexualResponseReading = {
  arousalMm?: number;
  afterglowMm?: number;
};

type BloodOxygenReading = {
  oxygenDeficit?: number;
};

type AdrenalReading = {
  cortisolNmolL?: number;
  cortisolRelative?: number;
};

type OvariesReading = {
  estradiolPmolL?: number;
  progesteroneNmolL?: number;
};

type PituitaryReading = {
  prolactinNgMl?: number;
};

type RewardReading = {
  wantingMm?: number;
  hedonicMm?: number;
  satietyMm?: number;
};

type PinealReading = {
  melatoninRelative?: number;
};

type SleepReading = {
  sleepPressureMm?: unknown;
  sleeping?: unknown;
};

type SalivaryGlandsReading = {
  mouthMoistureMm?: number;
};

type TestesReading = {
  testosteroneRelative?: number;
};

type ThermoregulationReading = {
  coreTemperatureC?: number;
};

type BloodCalciumReading = {
  mgDl?: number;
};

type EsophagusReading = {
  chokingMm?: number;
};

type ColonReading = {
  stoolG?: number;
  bowelUrgencyMm?: number;
};

type GlucoseReading = {
  concentrationMgDl?: unknown;
};

type HeartReading = {
  heartRatePerMin?: unknown;
};

type BloodReading = {
  systolicMmHg?: unknown;
};

type PhysicalActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type SkinReading = {
  sweatVolumeMl?: unknown;
};

type MuscleRegionReading = {
  glycogenG?: unknown;
};

type SnapshotReading = {
  simulatedSeconds?: number;
  parts?: Readonly<Record<string, unknown>>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampMm(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function collectExtensibleInputs(
  io: IO,
  nsfwEnabled: boolean,
): { discomfortMm: number; sensations: Record<string, ExtensibleSensation> } {
  const snapshot = io.read();
  const parts = isPlainRecord(snapshot?.parts) ? snapshot.parts : undefined;
  if (parts === undefined) return { discomfortMm: 0, sensations: {} };

  let discomfortMm = 0;
  const sensations: Record<string, ExtensibleSensation> = {};
  for (const [partId, rawPart] of Object.entries(parts)) {
    if (partId === id || !isPlainRecord(rawPart)) continue;
    if (typeof rawPart.discomfortMm === 'number' && Number.isFinite(rawPart.discomfortMm)) {
      discomfortMm = Math.max(discomfortMm, clampMm(rawPart.discomfortMm));
    }
    if (!isPlainRecord(rawPart.sensations)) continue;
    for (const [sensationKey, rawEntry] of Object.entries(rawPart.sensations)) {
      if (!sensationKey || !isPlainRecord(rawEntry)) continue;
      if (rawEntry.nsfw === true && !nsfwEnabled) continue;
      if (typeof rawEntry.intensityMm !== 'number' || !Number.isFinite(rawEntry.intensityMm)) {
        continue;
      }
      const intensityMm = clampMm(rawEntry.intensityMm);
      if (rawEntry.discomfort === true) {
        discomfortMm = Math.max(discomfortMm, intensityMm);
      }
      const entry: ExtensibleSensation = { intensityMm };
      if (rawEntry.urgent === true) {
        entry.urgent = true;
      }
      if (rawEntry.nsfw === true) {
        entry.nsfw = true;
      }
      if (typeof rawEntry.contextText === 'string' && rawEntry.contextText.trim() !== '') {
        entry.contextText = rawEntry.contextText.trim();
      }
      if (typeof rawEntry.wakeText === 'string' && rawEntry.wakeText.trim() !== '') {
        entry.wakeText = rawEntry.wakeText.trim();
      }
      sensations[`${partId}.${sensationKey}`] = entry;
    }
  }
  return { discomfortMm, sensations };
}

type IO = {
  readonly dt?: number;
  read(): Readonly<SnapshotReading> | undefined;
  read(id: 'interoception'): Readonly<Partial<InteroceptionState>> | null | undefined;
  read(id: 'stomachSensory'): Readonly<SensoryReading> | undefined;
  read(id: 'stomachGhrelin'): Readonly<GhrelinReading> | undefined;
  read(id: 'duodenum'): Readonly<DuodenumReading> | undefined;
  read(id: 'hypothalamusThirst'): Readonly<ThirstReading> | undefined;
  read(id: 'bladder'): Readonly<BladderReading> | undefined;
  read(id: 'uterus'): Readonly<UterusReading> | undefined;
  read(id: 'mammaryGlands'): Readonly<MammaryGlandsReading> | undefined;
  read(id: 'sexualResponse'): Readonly<SexualResponseReading> | undefined;
  read(id: 'bloodOxygen'): Readonly<BloodOxygenReading> | undefined;
  read(id: 'adrenal'): Readonly<AdrenalReading> | undefined;
  read(id: 'ovaries'): Readonly<OvariesReading> | null | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | null | undefined;
  read(id: 'reward'): Readonly<RewardReading> | null | undefined;
  read(id: 'pineal'): Readonly<PinealReading> | null | undefined;
  read(id: 'sleep'): Readonly<SleepReading> | null | undefined;
  read(id: 'salivaryGlands'): Readonly<SalivaryGlandsReading> | undefined;
  read(id: 'testes'): Readonly<TestesReading> | undefined;
  read(id: 'thermoregulation'): Readonly<ThermoregulationReading> | null | undefined;
  read(id: 'bloodCalcium'): Readonly<BloodCalciumReading> | null | undefined;
  read(id: 'esophagus'): Readonly<EsophagusReading> | null | undefined;
  read(id: 'colon'): Readonly<ColonReading> | null | undefined;
  read(id: 'glucose'): Readonly<GlucoseReading> | null | undefined;
  read(id: 'heart'): Readonly<HeartReading> | null | undefined;
  read(id: 'blood'): Readonly<BloodReading> | null | undefined;
  read(id: 'physicalActivity'): Readonly<PhysicalActivityReading> | null | undefined;
  read(id: 'skin'): Readonly<SkinReading> | null | undefined;
  read(id: 'muscleHead'): Readonly<MuscleRegionReading> | null | undefined;
  read(id: 'muscleTrunk'): Readonly<MuscleRegionReading> | null | undefined;
  read(id: 'muscleLimbs'): Readonly<MuscleRegionReading> | null | undefined;
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

const thermoregulationSetpointC = requireParameter(
  parameters,
  'interoception.thermoregulation.setpointC',
);
const temperatureReadoutGainMmPerC = requireParameter(
  parameters,
  'interoception.temperatureReadoutGainMmPerC',
);
const calciumReferenceMgDl = requireParameter(parameters, 'interoception.calcium.referenceMgDl');
const calciumReadoutGainMmPerMgDl = requireParameter(
  parameters,
  'interoception.calcium.readoutGainMmPerMgDl',
);
const bowelUrgencyReferenceStoolG = requireParameter(
  parameters,
  'interoception.bowelUrgency.referenceStoolG',
);
const hypoglycemiaThresholdMgDl = requireParameter(
  parameters,
  'interoception.hypoglycemia.thresholdMgDl',
);
const hypoglycemiaGainMmPerMgDl = requireParameter(
  parameters,
  'interoception.hypoglycemia.gainMmPerMgDl',
);
const palpitationRestHrThresholdPerMin = requireParameter(
  parameters,
  'interoception.palpitation.restHrThresholdPerMin',
);
const palpitationHrGainMmPerBpm = requireParameter(
  parameters,
  'interoception.palpitation.hrGainMmPerBpm',
);
const palpitationMinExerciseIntensity = requireParameter(
  parameters,
  'interoception.palpitation.minExerciseIntensity',
);
const palpitationSbpThresholdMmHg = requireParameter(
  parameters,
  'interoception.palpitation.sbpThresholdMmHg',
);
const palpitationSbpGainMmPerMmHg = requireParameter(
  parameters,
  'interoception.palpitation.sbpGainMmPerMmHg',
);
const palpitationSympatheticThresholdMm = requireParameter(
  parameters,
  'interoception.palpitation.sympatheticThresholdMm',
);
const palpitationSympatheticGain = requireParameter(
  parameters,
  'interoception.palpitation.sympatheticGain',
);
const stressSympatheticWeight = requireParameter(
  parameters,
  'interoception.stress.sympatheticWeight',
);
const sweatDampHalfTimeMin = requireParameter(parameters, 'interoception.sweatDamp.halfTimeMin');
const sweatDampRateGainMmPerMl = requireParameter(
  parameters,
  'interoception.sweatDamp.rateGainMmPerMl',
);
const muscleFatigueHalfTimeMin = requireParameter(
  parameters,
  'interoception.muscleFatigue.halfTimeMin',
);
const muscleFatigueExerciseGainMmPerMin = requireParameter(
  parameters,
  'interoception.muscleFatigue.exerciseGainMmPerMin',
);
const muscleFatigueDepletionWeight = requireParameter(
  parameters,
  'interoception.muscleFatigue.depletionWeight',
);
const sleepinessMelatoninWeight = requireParameter(
  parameters,
  'interoception.sleepiness.melatoninWeight',
);
const sleepinessPressureWeight = requireParameter(
  parameters,
  'interoception.sleepiness.pressureWeight',
);
const sleepinessInertiaWeight = requireParameter(
  parameters,
  'interoception.sleepiness.inertiaWeight',
);
const sleepinessSympatheticSuppressionWeight = requireParameter(
  parameters,
  'interoception.sleepiness.sympatheticSuppressionWeight',
);
const sleepinessExerciseSuppressionGain = requireParameter(
  parameters,
  'interoception.sleepiness.exerciseSuppressionGain',
);
const sleepinessArousalSuppressionWeight = requireParameter(
  parameters,
  'interoception.sleepiness.arousalSuppressionWeight',
);
const sleepinessCortisolSuppressionGain = requireParameter(
  parameters,
  'interoception.sleepiness.cortisolSuppressionGain',
);
const muscleRegionBaselines: ReadonlyArray<
  readonly ['muscleHead' | 'muscleTrunk' | 'muscleLimbs', number]
> = [
  ['muscleHead', 15],
  ['muscleTrunk', 135],
  ['muscleLimbs', 150],
];

export const initialState: InteroceptionState = {
  hunger: hungerBaseline,
  fullness: fullnessBaseline,
  thirst: thirstFallbackMm,
  urinaryUrgency: 0,
  discomfort: 0,
  sexualArousalMm: 0,
  dyspneaMm: 0,
  stressMm: 0,
  sleepinessMm: 0,
  dryMouthMm: 0,
  libidoMm: 0,
  bowelUrgencyMm: 0,
  heatMm: 0,
  coldMm: 0,
  hypocalcemiaMm: 0,
  hypercalcemiaMm: 0,
  hypoglycemiaMm: 0,
  palpitationMm: 0,
  sweatDampMm: 0,
  muscleFatigueMm: 0,
  uterineCrampMm: 0,
  mammaryFullnessMm: 0,
  hedonicCalmMm: 0,
};

export const fields = {
  hunger: { unit: 'mm', mode: 'absolute' },
  fullness: { unit: 'mm', mode: 'absolute' },
  thirst: { unit: 'mm', mode: 'absolute' },
  urinaryUrgency: { unit: 'mm', mode: 'absolute' },
  discomfort: { unit: 'mm', mode: 'absolute' },
  sexualArousalMm: { unit: 'mm', mode: 'absolute' },
  dyspneaMm: { unit: 'mm', mode: 'absolute' },
  stressMm: { unit: 'mm', mode: 'absolute' },
  sleepinessMm: { unit: 'mm', mode: 'absolute' },
  dryMouthMm: { unit: 'mm', mode: 'absolute' },
  libidoMm: { unit: 'mm', mode: 'absolute' },
  bowelUrgencyMm: { unit: 'mm', mode: 'absolute' },
  heatMm: { unit: 'mm', mode: 'absolute' },
  coldMm: { unit: 'mm', mode: 'absolute' },
  hypocalcemiaMm: { unit: 'mm', mode: 'absolute' },
  hypercalcemiaMm: { unit: 'mm', mode: 'absolute' },
  hypoglycemiaMm: { unit: 'mm', mode: 'absolute' },
  palpitationMm: { unit: 'mm', mode: 'absolute' },
  sweatDampMm: { unit: 'mm', mode: 'absolute' },
  muscleFatigueMm: { unit: 'mm', mode: 'absolute' },
  uterineCrampMm: { unit: 'mm', mode: 'absolute' },
  mammaryFullnessMm: { unit: 'mm', mode: 'absolute' },
  hedonicCalmMm: { unit: 'mm', mode: 'absolute' },
};

function finiteOr(value: unknown, fallback: number): number {
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

function computeMuscleGlycogenDepletion(io: IO): number {
  let totalGlycogen = 0;
  let loadedBaselineTotal = 0;
  for (const [regionId, baselineG] of muscleRegionBaselines) {
    const region = io.read(regionId);
    const glycogenG = region?.glycogenG;
    if (!isFiniteNumber(glycogenG)) continue;
    totalGlycogen += Math.max(0, glycogenG);
    loadedBaselineTotal += scaleByBodyWeight(baselineG);
  }
  if (loadedBaselineTotal <= 0 || totalGlycogen >= loadedBaselineTotal) return 0;
  return clamp((1 - totalGlycogen / loadedBaselineTotal) * 100, 0, 100);
}

export function heartbeat(io: IO): void {
  const nsfwEnabled = getNsfwSetting() !== false;
  const dtMin = Math.max(0, finiteOr(io.dt, 60) / 60);
  const prevInteroception = io.read(id);

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
  const uterineCrampMm = clamp(finiteOr(io.read('uterus')?.crampMm, 0), 0, 100);
  const mammaryFullness = nsfwEnabled
    ? clamp(finiteOr(io.read('mammaryGlands')?.fullnessMm, 0), 0, 100)
    : 0;
  const esophagealChoking = clamp(finiteOr(io.read('esophagus')?.chokingMm, 0), 0, 100);
  const sexualResponse = io.read('sexualResponse');
  const sexualArousalMm = nsfwEnabled
    ? clamp(finiteOr(sexualResponse?.arousalMm, 0), 0, 100)
    : 0;
  const afterglowMm = nsfwEnabled
    ? clamp(finiteOr(sexualResponse?.afterglowMm, 0), 0, 100)
    : 0;

  const extensible = collectExtensibleInputs(io, nsfwEnabled);
  const discomfort = Math.max(
    excessOverOnset(hunger, discomfortOnsetMm),
    excessOverOnset(fullness, discomfortOnsetMm),
    excessOverOnset(thirst, discomfortOnsetMm),
    excessOverOnset(urinaryUrgency, discomfortOnsetMm),
    excessOverOnset(uterineCrampMm, discomfortOnsetMm),
    excessOverOnset(mammaryFullness, discomfortOnsetMm),
    excessOverOnset(esophagealChoking, discomfortOnsetMm),
    excessOverOnset(extensible.discomfortMm, discomfortOnsetMm),
  );
  const hasExtensibleSensations = Object.keys(extensible.sensations).length > 0;

  const oxygenDeficit = finiteOr(io.read('bloodOxygen')?.oxygenDeficit, 0);
  const dyspneaMm = clamp(100 * oxygenDeficit, 0, 100);
  const rawAdrenal = io.read('adrenal');
  const cortisolRelative = isFiniteNumber(rawAdrenal?.cortisolNmolL)
    ? Math.max(0, rawAdrenal.cortisolNmolL) / 180
    : finiteOr(rawAdrenal?.cortisolRelative, 0);
  const rawSympatheticMm = (io as { read(id: string): Readonly<{ sympatheticMm?: unknown }> | undefined }).read('autonomic')?.sympatheticMm;
  const sympatheticMm = isFiniteNumber(rawSympatheticMm) ? clamp(rawSympatheticMm, 0, 100) : 0;
  const rawStressMm = Math.max(
    clamp((100 * (cortisolRelative - 1)) / 2, 0, 100),
    clamp(sympatheticMm * stressSympatheticWeight, 0, 100),
  );
  const reward = io.read('reward');
  const hasReward = isPlainRecord(reward);
  const wantingMm = hasReward ? clamp(finiteOr(reward.wantingMm, 0), 0, 100) : 0;
  const hedonicMm = hasReward ? clamp(finiteOr(reward.hedonicMm, 0), 0, 100) : 0;
  const satietyMm = hasReward ? clamp(finiteOr(reward.satietyMm, 0), 0, 100) : 0;
  const hedonicCalmMm = clamp(
    0.85 * Math.max(0, hedonicMm - 15) + 0.55 * afterglowMm - 0.5 * rawStressMm,
    0,
    100,
  );
  const stressMm = clamp(rawStressMm - 0.2 * hedonicCalmMm, 0, 100);

  const activity = io.read('physicalActivity');
  const remainingExerciseMin = Math.max(0, finiteOr(activity?.remainingExerciseMin, 0));
  const activityIntensity = clamp(finiteOr(activity?.intensity, 0), 0, 1);
  const exercising = remainingExerciseMin > 0 && activityIntensity > 0;
  const moderateOrHigherExercise = remainingExerciseMin > 0
    && activityIntensity >= palpitationMinExerciseIntensity;

  const pineal = io.read('pineal');
  const melatoninRelative = finiteOr(pineal?.melatoninRelative, 0);
  const melatoninMm = clamp((100 * (melatoninRelative - 0.2)) / 1.6, 0, 100);
  const sleep = io.read('sleep') as Readonly<{
    sleeping?: unknown;
    sleepPressureMm?: unknown;
    sleepInertiaMm?: unknown;
  }> | undefined;
  const arousalAntagonismMm = (!isPlainRecord(sleep) || sleep.sleeping === true)
    ? 0
    : (
      sleepinessSympatheticSuppressionWeight * sympatheticMm
      + (exercising ? sleepinessExerciseSuppressionGain * activityIntensity : 0)
      + sleepinessArousalSuppressionWeight * sexualArousalMm
      + sleepinessCortisolSuppressionGain * Math.max(0, cortisolRelative - 1.3)
    );
  let sleepinessMm: number;
  if (!isPlainRecord(sleep)) {
    sleepinessMm = melatoninMm;
  } else {
    const sleepPressureMm = clamp(finiteOr(sleep.sleepPressureMm, 0), 0, 100);
    const rawInertiaMm = sleep.sleeping === true ? 0 : clamp(finiteOr(sleep.sleepInertiaMm, 0), 0, 100);
    const effectiveInertiaMm = rawInertiaMm
      * clamp(1 - sympatheticMm / 100, 0, 1)
      * (exercising ? 0.4 : 1);
    const baseSleepiness = isPlainRecord(pineal)
      ? clamp(
        sleepinessMelatoninWeight * melatoninMm + sleepinessPressureWeight * sleepPressureMm,
        0,
        100,
      )
      : sleepPressureMm;
    const calmSleepinessNudgeMm = sleep.sleeping === true ? 0 : 0.12 * hedonicCalmMm;
    sleepinessMm = clamp(
      baseSleepiness - arousalAntagonismMm + sleepinessInertiaWeight * effectiveInertiaMm + calmSleepinessNudgeMm,
      0,
      100,
    );
  }

  const mouthMoistureMm = io.read('salivaryGlands')?.mouthMoistureMm;
  const dryMouthMm = isFiniteNumber(mouthMoistureMm)
    ? clamp(100 - mouthMoistureMm, 0, 100)
    : 0;
  const rawTestosterone = io.read('testes')?.testosteroneRelative;
  const hasTestes = isFiniteNumber(rawTestosterone);
  const ovaries = io.read('ovaries');
  const hasOvaries = !hasTestes && isPlainRecord(ovaries);
  const rawGlucoseConcentrationMgDl = io.read('glucose')?.concentrationMgDl;
  const hypoglycemiaMm = isFiniteNumber(rawGlucoseConcentrationMgDl)
    ? clamp(
      (hypoglycemiaThresholdMgDl - rawGlucoseConcentrationMgDl) * hypoglycemiaGainMmPerMgDl,
      0,
      100,
    )
    : 0;
  let endocrineLibidoMm = 0;
  if (hasTestes) {
    endocrineLibidoMm = clamp(100 * (rawTestosterone - 0.5), 0, 100);
  } else if (hasOvaries) {
    const estradiolPmolL = Math.max(0, finiteOr(ovaries.estradiolPmolL, 140));
    const progesteroneNmolL = Math.max(0, finiteOr(ovaries.progesteroneNmolL, 1));
    const estradiolDrive = 20 + 48 * Math.pow(Math.max(0, estradiolPmolL - 120) / 700, 0.75);
    const progesteroneSuppression = 1.15 * Math.max(0, progesteroneNmolL - 4);
    endocrineLibidoMm = clamp(estradiolDrive - progesteroneSuppression, 0, 100);
  }
  const prolactinNgMl = Math.max(0, finiteOr(io.read('pituitary')?.prolactinNgMl, 8));
  const wantingBoostMm = hasReward ? 0.25 * Math.max(0, wantingMm - 25) : 0;
  const satietyPenaltyMm = hasReward ? 0.45 * satietyMm : 0;
  const prolactinPenaltyMm = 0.7 * Math.max(0, prolactinNgMl - 15);
  const physioLibidoPenaltyMm = 0.5 * discomfort + 0.5 * hypoglycemiaMm + 0.35 * Math.max(0, stressMm - 25);
  const libidoMm = nsfwEnabled
    ? clamp(
      endocrineLibidoMm + wantingBoostMm - satietyPenaltyMm - prolactinPenaltyMm - physioLibidoPenaltyMm,
      0,
      100,
    )
    : 0;
  const colon = io.read('colon');
  const rawBowelUrgencyMm = colon?.bowelUrgencyMm;
  const stoolG = Math.max(0, finiteOr(colon?.stoolG, 0));
  const bowelUrgencyMm = isFiniteNumber(rawBowelUrgencyMm)
    ? clamp(rawBowelUrgencyMm, 0, 100)
    : clamp(
      (100 * stoolG) / bowelUrgencyReferenceStoolG,
      0,
      100,
    );
  const thermoregulation = io.read('thermoregulation') as Readonly<{
    coreTemperatureC?: unknown;
    setpointC?: unknown;
  }> | undefined;
  const thermoSetpointC = finiteOr(
    thermoregulation?.setpointC,
    thermoregulationSetpointC,
  );
  const coreTemperatureC = finiteOr(
    thermoregulation?.coreTemperatureC,
    thermoSetpointC,
  );
  const heatThresholdC = Math.max(thermoregulationSetpointC, thermoSetpointC);
  const coldThresholdC = sleep?.sleeping === true
    ? Math.min(thermoregulationSetpointC, thermoSetpointC)
    : thermoregulationSetpointC;
  const heatMm = clamp(
    temperatureReadoutGainMmPerC * (coreTemperatureC - heatThresholdC),
    0,
    100,
  );
  const coldMm = clamp(
    temperatureReadoutGainMmPerC * (coldThresholdC - coreTemperatureC),
    0,
    100,
  );
  const bloodCalciumMgDl = finiteOr(
    io.read('bloodCalcium')?.mgDl,
    calciumReferenceMgDl,
  );
  const hypocalcemiaMm = clamp(
    calciumReadoutGainMmPerMgDl * (calciumReferenceMgDl - bloodCalciumMgDl),
    0,
    100,
  );
  const hypercalcemiaMm = clamp(
    calciumReadoutGainMmPerMgDl * (bloodCalciumMgDl - calciumReferenceMgDl),
    0,
    100,
  );

  const rawHeartRatePerMin = io.read('heart')?.heartRatePerMin;
  const hrPart = !moderateOrHigherExercise && isFiniteNumber(rawHeartRatePerMin)
    ? clamp(
      (rawHeartRatePerMin - palpitationRestHrThresholdPerMin) * palpitationHrGainMmPerBpm,
      0,
      100,
    )
    : 0;
  const rawSystolicMmHg = io.read('blood')?.systolicMmHg;
  const bpPart = isFiniteNumber(rawSystolicMmHg)
    ? clamp(
      (palpitationSbpThresholdMmHg - rawSystolicMmHg) * palpitationSbpGainMmPerMmHg,
      0,
      100,
    )
    : 0;
  const sympPart = !moderateOrHigherExercise
    ? clamp(
      (sympatheticMm - palpitationSympatheticThresholdMm) * palpitationSympatheticGain,
      0,
      100,
    )
    : 0;
  const palpitationMm = Math.max(hrPart, bpPart, sympPart);

  const prevSweatDamp = clamp(finiteOr(prevInteroception?.sweatDampMm, 0), 0, 100);
  const skin = io.read('skin');
  const sweatVolumeMl = Math.max(0, finiteOr(skin?.sweatVolumeMl, 0));
  const sweatRateMlMin = skin !== undefined && dtMin > 0 ? sweatVolumeMl / dtMin : 0;
  const sweatDampMm = clamp(
    prevSweatDamp * Math.pow(0.5, dtMin / sweatDampHalfTimeMin)
      + sweatRateMlMin * sweatDampRateGainMmPerMl * dtMin,
    0,
    100,
  );

  const prevMuscleFatigue = clamp(finiteOr(prevInteroception?.muscleFatigueMm, 0), 0, 100);
  const acuteFatigue = prevMuscleFatigue * Math.pow(0.5, dtMin / muscleFatigueHalfTimeMin)
    + (exercising ? muscleFatigueExerciseGainMmPerMin * activityIntensity * dtMin : 0);
  const depletion = computeMuscleGlycogenDepletion(io);
  const muscleFatigueMm = clamp(
    acuteFatigue + muscleFatigueDepletionWeight * depletion,
    0,
    100,
  );

  io.write({
    hunger,
    fullness,
    thirst,
    urinaryUrgency,
    discomfort,
    sexualArousalMm,
    dyspneaMm,
    stressMm,
    sleepinessMm,
    dryMouthMm,
    libidoMm,
    bowelUrgencyMm,
    heatMm,
    coldMm,
    hypocalcemiaMm,
    hypercalcemiaMm,
    hypoglycemiaMm,
    palpitationMm,
    sweatDampMm,
    muscleFatigueMm,
    uterineCrampMm,
    mammaryFullnessMm: mammaryFullness,
    hedonicCalmMm,
    ...(hasExtensibleSensations ? { sensations: extensible.sensations } : {}),
  });
}
