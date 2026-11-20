# M1 资料台账字段字典与证据卡模板

**状态：** 2026-11-20 建立。Task 1 产物。Mudie/Tougas/Camps/Cummings 仍只有摘要级登记；Leone/Levine/Sebaratnam/Schamberg 已读全文并登记。

**依据：** [M1 计划](../../../docs/superpowers/plans/2026-11-20-tissue-fidelity-m1.md) Task 1–2；[虚拟身体设计草案](../../../docs/virtual-body.md) 第 6–7 节；[Gateway 开发指南](../../../docs/gateway-and-scripts.md)。

## 0. 用途与边界

- 目标只有一个：任意一行观测都能回到原文的图、表、面板或摘要句子，并说清测的是什么、分母或量表是什么、从哪个时刻起算。
- 本文件不是 M1 验收结论，也不是脚本参数表。提醒策略、工程阈值和模型假设标为 `policy` 或 `derived`，不进入生理观测行。
- 只登记健康成人的正常生理，不给临床诊断或“个人正常值”。每个结论都限定人群、刺激、可观测量、方法和时间窗。
- **当前全部来源都已在检索页或摘要中看到结果（`results_seen`）。** 因此本台账里没有任何一项可以称为盲法留出。要独立验收，须由未读结果的第二人先按纳入标准选定来源并保管，判据在看到结果前冻结；已看过的来源只能登记为开发或探索。
- 只保存可使用的数据与本项目自己的摘记。开放获取不等于可以再发布原图、整表或 PDF。

## 1. 先写的可证伪问题

| 编号 | 问题：谁、什么初始状态、什么刺激、测什么、看多久、与谁比 | 主终点 | 归属 |
| --- | --- | --- | --- |
| Q-WATER | 空腹健康成人一次喝下 240 mL 水后，胃内水体积是否在约 13 min 减半、约 45 min 回到饮前基线？与同一次饮前值比。 | 胃水 T50、回到基线时间 | 消化 |
| Q-SOLID | 健康成人吃完低脂标记餐后，餐毕 120 min 的胃内标记餐残留中位数是否约为初始标记量的 24%？与同研究 60、240 min 比。 | 标记餐残留百分比 | 消化 |
| Q-SHAKE-TEXTURE | 同为 500 mL、100 kcal，稠奶昔的胃排空 t50 是否大于稀奶昔？同一批人、同一条件、同一时间窗。 | MRI 胃内容量 t50 | 消化 |
| Q-SHAKE-ENERGY | 同为 500 mL、稀，500 kcal 奶昔的 t50 是否大于 100 kcal 奶昔？同一批人、同一条件。 | MRI 胃内容量 t50 | 消化 |
| Q-FULLNESS | 同一批人、餐后 40 min，稠 100 kcal 的饱感评分是否高于稀 500 kcal？ | 100 分饱感评分 | 感觉器 |
| Q-GHRELIN | 固定餐时的健康成人，血浆饥饿素是否在每餐前上升、餐后 1 h 内降到谷值？与同一天餐间和夜间曲线比。 | 血浆饥饿素时间曲线 | 内分泌 |

这些问题不是“模拟胃功能”式的总目标。每个都能被一笔方向相反或时间窗不符的观测推翻。

## 2. 文件分工

| 路径 | 内容 | 谁维护 |
| --- | --- | --- |
| [`source-index.csv`](./source-index.csv) | 一行一个来源：标识、队列、设计、总体、刺激、测量、取数权限、定位、用途。只登记来源，不复制结果表。 | 一人维护，取数者共用同一版本 |
| [`notes/`](./notes/) | 一篇论文一份：实验条件、明确报告的值、不能推出的量、原文定位、许可。 | 取数者 |
| [`notes/_template.md`](./notes/_template.md) | 逐篇笔记模板。 | 维护人 |
| 本文件 | 字段字典、规则、证据卡模板、试录、检索记录。 | 维护人 |

其他系统的笔记只放链接和来源 ID，不复制数据。跨系统共用的研究（如 Camps 2016 同时有胃排空与饱感）归消化。

## 3. `source-index.csv` 字段

| 字段 | 含义与取值 |
| --- | --- |
| `source_id` | `SRC-<第一作者大写>-<年份>`，一经分配不改。 |
| `citekey` | 小写 `<第一作者><年份>`，与 `notes/<citekey>.md` 文件名一致。 |
| `status` | `registered` 已登记并取数；`candidate` 只初筛；`excluded` 明确排除并写理由。 |
| `pmid`、`doi`、`url` | 原始入口。DOI 未确认时写 `NA`，不猜。 |
| `title`、`year`、`journal` | 原文题名与出处。 |
| `cohort_id` | `C-<citekey>-<总人数>`。同一批受试者被多篇论文报告时共用一个 `cohort_id`，并在 `screening_note` 说明。 |
| `design` | 交叉、平行、单臂、方法比较等。 |
| `population` | 年龄、性别、健康状态、招募条件。摘要没写就写“摘要未报告”。 |
| `n_total`、`n_per_arm`、`n_per_timepoint` | 总数、每臂人数、每个时点的人数。交叉设计每臂是同一批人，不能写成四批独立样本。 |
| `premeal_state` | 空腹时长、前一餐、是否吸烟/饮酒等。未报告写 `未报告`。 |
| `stimulus` | 餐型、体积、能量、稠度、固液形态、进食时长。 |
| `measurement` | 测什么、用什么仪器或量表、单位、分母。 |
| `data_access` | `abstract_only`、`free_fulltext`、`subscription`、`unknown`。 |
| `retrieval_status` | `abstract_read`、`fulltext_read`、`snippet_only`、`pdf_archived`。 |
| `locator` | 当前取数位置，如 `摘要 Results`、`正文 p.7 图 3`。 |
| `note_path` | 逐篇笔记路径；只有片段时写 `NA`。 |
| `use_status` | `development`、`independent`、`exploratory`、`unassigned`。已见结果的不写 `independent`。 |
| `blinding` | `results_seen`、`methods_seen`、`unopened`。 |
| `screened_on` | 初筛日期，ISO 格式。 |
| `screening_note` | 纳入/排除理由，一句话。 |

## 4. 观测行字段

Task 2 起写入 `gastric-emptying.csv`、`ghrelin.csv`、`fullness.csv`、`hunger-ratings.csv`。本轮只做试录，不建正式数据文件。

| 字段 | 含义与取值 |
| --- | --- |
| `source_id`、`cohort_id`、`arm_id` | 来源、队列、实验臂。`arm_id` 用短横线小写，如 `thin-100`、`thick-500`、`low-fat-egg-meal`。 |
| `subject_key` | 有个体数据时用匿名受试者键；只有组级汇总写 `NA`。 |
| `quantity` | 可识别的量，如 `gastric_water_volume`、`gastric_retention_pct`、`gastric_emptying_t50`、`plasma_ghrelin`、`fullness`、`hunger`。汇总终点把单位带进名字，如 `gastric_emptying_t50`。 |
| `unit` | 原始单位：`mL`、`%`、`min`、`points`、`pg/mL`、`fold`。不要在原列里换算。 |
| `denominator_or_scale` | 百分比的分母、量表的两端和方向、fold 的参照。说不清就写“未报告”，不许猜。 |
| `time_origin` | `meal_start`、`meal_end`、`drink_start`、`drink_end`、`ingestion_unspecified`、`clock_time`、`wake`、`unknown`。餐毕 60 min 不是开餐 60 min。 |
| `time`、`time_unit` | 相对 `time_origin` 的时间。汇总终点（如 t50）的 `time` 写 `NA`，值放在 `value`，因为 t50 不是一个时刻的测量。 |
| `value` | 数值。未报告写 `NA`，并在 `na_reason` 写原因，不用 `0`。 |
| `statistic` | `mean`、`median`、`individual`、`reported_approximate`、`unreported`、`NA`。摘要只说“约两倍”就写 `reported_approximate`。 |
| `uncertainty_type` | `SD`、`SEM`、`P95`、`range`、`CI95`、`reported_unlabelled`、`none_reported`、`NA`。**P95 是样本分位，不是误差条。**`reported_unlabelled` 表示原文印了 ± 数值但没有逐项注明是 SD 还是 SEM。 |
| `uncertainty_value` | 与上一列配套的值；没有就写 `NA`。 |
| `n` | 该行的有效人数。组级汇总不能伪装成个体数据。 |
| `locator` | 精确到图/表/面板/摘要句子。 |
| `provenance` | `reported` 论文直接写出；`digitized` 读图；`derived` 本项目推算；`policy` 工程或提醒策略。 |
| `use_status` | `development`、`independent`、`exploratory`。 |
| `na_reason` | 任何 `NA` 的原因。 |
| 可选列 | `volume_ml`、`energy_kcal`、`texture`、`meal_duration`、`clock_time`。换算值另列，不覆盖原值。 |

## 5. 取数规则

1. **先看定义，再看数值。** 百分比要写分母；量表要写两端问的是什么；fold 要写参照；t50 要写是哪条曲线、相对什么基线减半。
2. **时间原点单列。** 餐毕、饮毕、开餐、开始饮、固定钟点不能混用。没有进食时长就不换算到另一个零点。
3. **不把汇总终点塞成测点。** t50 = 13 min 不是“第 13 分钟测到 13 mL”。它是一行以 min 为单位的汇总终点，`time` 为 `NA`。
4. **统计量分开。** 均值、中位数、个体值、近似描述各占一列；SD、SEM、P95、极差不得互换。组均值不能给一具身体画“个人正常范围”。
5. **单位不混。** 标记餐残留百分比不等于胃内总 mL；血浆浓度不等于分泌速率；饱胀不等于“不饿”。没有方法学依据就不换算。
6. **未报告写 `NA` 并给原因。** 不补一个看起来合理的常数，不用 `0` 代替缺失。
7. **来源与验证状态分开。** `reported` / `digitized` / `derived` / `policy` 是取数方式；`development` / `independent` / `exploratory` 是用途。探索不改变原数据是实测还是推算。
8. **一批受试者只算一个队列。** 交叉设计的四个臂、重复发表、同一批人的不同时点放在同一侧；不能把同一批人拆到标定和验证两边。
9. **读图要记轴。** 线性/对数、单位、面板、取点方法和读图不确定度都要写。两人独立抽读峰值附近和尾段；超过图可辨精度就只保留区间。
10. **一篇笔记只放一个系统。** 其他系统用 `source_id` 和路径引用，不复制数据。

## 6. 证据卡模板

一份证据卡只回答一个终点在一个来源里能支持什么。

```text
### <source_id> · <arm_id> · <quantity>

- 能回答的问题：
- 刺激（体积、能量、稠度、固液、进食时长）：
- 测量与分母/量表：
- 时点与时间原点：
- 报告的统计量（均值/中位数/个体；SD/SEM/P95）：
- 适用的人群与条件：
- 不能推出或不能换算成：
- 原文定位：
- 取数方式：
```

## 7. 试录行（不进入正式数据文件）

以下五行只用来校验字段和口径，分别覆盖 mL、汇总时间、残留百分比、fold 与量表分。

```csv
source_id,cohort_id,arm_id,subject_key,quantity,unit,denominator_or_scale,time_origin,time,time_unit,value,statistic,uncertainty_type,uncertainty_value,n,locator,provenance,use_status,na_reason
SRC-MUDIE-2014,C-MUDIE-2014-12,240ml-water,NA,gastric_water_volume,mL,饮前空腹胃水为基线；此行为饮后胃水总量,drink_end,NA,min,242,mean,reported_unlabelled,9,12,摘要 Results,reported,development,摘要只写 upon drinking，未给饮毕后的具体分钟；± 类型未逐项标注
SRC-MUDIE-2014,C-MUDIE-2014-12,240ml-water,NA,gastric_emptying_t50,min,胃水体积相对其自身基线的半排空定义待全文确认,drink_end,NA,min,13,mean,reported_unlabelled,1,12,摘要 Results,reported,development,汇总终点；不得当成第 13 分钟的测点；± 类型未逐项标注
SRC-TOUGAS-2000,C-TOUGAS-2000-123,low-fat-egg-meal,NA,gastric_retention_pct,%,初始标记餐量的百分比；餐毕为零点,meal_end,120,min,24,median,P95,60,123,摘要 Results,reported,development,P95 是样本分位不是误差；该行不能换成 mL
SRC-CUMMINGS-2001,C-CUMMINGS-2001-10,fixed-meal-schedule,NA,plasma_ghrelin_preprandial_rise,fold,摘要只说 nearly twofold；基线定义未报告,meal_start,NA,min,2,reported_approximate,none_reported,NA,10,摘要 Results,reported,development,提前量未报告；不能当绝对浓度
SRC-CAMPS-2016,C-CAMPS-2016-15,thick-100,NA,fullness,points,100 分量表；两端标签摘要未写,ingestion_unspecified,40,min,58,unreported,none_reported,NA,15,摘要 Results,reported,development,摘要未说是均值还是中位数；起算点为 after ingestion
```

字段之外还有三件事必须能从行里读出来：这行测的是什么、分母或量表是什么、从哪个时刻起算。读不出来就回原文，不补。

## 8. 复核问题

用这五个问题检查台账，不检查结论是否“像”。

1. Tougas 那行的 24% 是什么的 24%？能不能直接换成胃内液体的 mL？
   - 答：初始标记餐量的百分比，餐毕 120 min，闪烁显像；不能换成 mL，标记物残留与胃总内容量是两种量。
2. Tougas 的 P95 = 60 是什么？能不能当误差条？
   - 答：样本第 95 百分位；不是均值的置信限，也不是个体正常上限。
3. Mudie 的 T50 = 13 min 是哪条曲线的半排空？是不是第 13 分钟的测量值？
   - 答：胃水体积相对饮前基线的半排空时间（具体定义待全文确认）；它是汇总终点，不是第 13 分钟的测点。
4. Cummings 的“约两倍”是相对什么？能不能当浓度？
   - 答：摘要只说餐前较餐间水平 nearly twofold，基线定义和绝对单位都未报告；不能当 pg/mL，也不能据此拆出生产速率和清除系数。
5. Camps 的 58 分属于哪个臂、什么量表、40 min 从何时算？
   - 答：thick-100 arm，100 分饱感量表（端点未报告），从 after ingestion 起算；不是 thin-500 的值，也不是个体值。

五个都答得出，才开始 Task 2 的批量取数；答不出就先修口径。

## 9. 检索记录

| 日期 | 数据库 | 查询式 | 命中 | 初筛决定 |
| --- | --- | --- | --- | --- |
| 2026-11-20 | PubMed | `gastric emptying AND water AND MRI AND healthy` | 43 | 登记 `grimm-2023` 为 WATER 候选；排除 `heissam-2020`（胃窦动力，不是内容量排空）；另见 Grimm 2018 变异度、Sager 2018 示踪法，暂不登记 |
| 2026-11-20 | PubMed | `gastric emptying AND viscosity AND fullness AND crossover` | 4 | 登记 `zhu-2013` 为黏度方向候选；其余为体外或非同类餐型。**未找到与 Camps 同设计的独立 500 mL 2×2 复现** |
| 2026-11-20 | PubMed | `ghrelin AND meal AND hunger ratings AND healthy` | 71 | 登记 `leone-2022`、`monteleone-2003` 为饥饿素与评分候选；Broom 2017（酰化饥饿素 + 饥饿）暂不登记 |
| 2026-11-20 | PubMed | 按 PMID 直接核对 25115349、10894578、27281305、11473029 | 4 | 四篇起点来源均只读摘要；结果已在摘要中显示 |
| 2026-11-20 | Crossref | 按题名检索 Cummings 2001 的 DOI | 1 | 确认 DOI `10.2337/diabetes.50.8.1714` |

**盲法记录：** 上述检索的结果页 snippet 已显示部分结果数值。因此 `source-index.csv` 中所有来源的 `blinding` 均为 `results_seen`。这不是盲法留出集；后续独立验收须由第二人重新选源并保管，且不得把已见结果改称盲测。

## 10. 当前缺口与下一步

- Tougas 的餐食组成、能量、空腹时长、t50 数值只在全文/表格里，需读全文补齐。
- Mudie 的 T50 定义、饮后各时点、受试者年龄/性别需读全文；饮后实测 242 mL 小于 35 + 240 = 275 mL，不能假设完全回收或瞬时混匀。
- Camps 的 ± 是 SD 还是 SEM、t50 的定义、100 分量表端点需读全文；四臂是同一批人，不能拆成独立组。
- Cummings 的检测对象（总饥饿素或酰化饥饿素）、绝对浓度、餐次钟点、采样间隔需读全文；摘要只能支持方向和 1 h 内到谷的时间窗。
- 尚无独立固餐数据集、尚无与 Camps 同设计的独立饮品复现。没有就是缺口，不用相近餐型顶替。
- Levine/Leone/Sebaratnam/Schamberg 已读全文：Levine 给 60 min 的 F 时序，Leone 给同餐 H/F/相对 G 的逐时估计，Sebaratnam 给 D 的题项与量程，Schamberg 只有 D 的全程平均与相关；四篇都不能提供健康人逐时 D。
- **下一步（Task 2）：** 读三篇胃排空基准的全文与图表，建立 `gastric-emptying.csv` 和 `gastric-baselines.md`；先补 WATER、SOLID、SHAKE 各一张卡，再决定哪些行进入标定集。
