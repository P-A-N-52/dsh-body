# sebaratnam-2022 — 胃十二指肠症状 App 的题项、量程与验证

| 项 | 值 |
| --- | --- |
| source_id | `SRC-SEBARATNAM-2022` |
| PMID / DOI | `35156270` / `10.1111/nmo.14331` |
| 原文链接 | <https://pmc.ncbi.nlm.nih.gov/articles/PMC9541247/> |
| 归属系统 | 神经（D 的题项与量表来源） |
| 取数 / 核对 | 待指定 / 待指定 |
| 获取状态 | 全文（PMC 开放获取） |
| 取数日期 | `2026-11-20` |
| 许可 | 仅登记原文明确写出的事实与链接；未复制原图或整表 |

## 1. 能回答的问题

在慢性胃十二指肠症状患者中，“餐后过度饱满”（excessive post-prandial fullness）作为独立题项怎样问、用什么量程、多久问一次、与已验证的 PAGI-SYM 对应项相关多强？它能不能给健康人提供正常值或逐时曲线？

## 2. 设计与受试者

- 设计：多中心、观察性队列；两项验证研究（收敛/同时效度；图表符号的面效/内容效度）。D 相关的是研究 1。
- 人群与纳入条件：因慢性胃十二指肠症状就诊或转诊的患者 79 人；中位年龄 41 岁（IQR 27–52）；女 65 人（82%）；白人 71%。诊断构成：功能性消化不良 10 人、慢性恶心呕吐综合征或胃轻瘫 42 人、闪烁显像转诊未分化 27 人；16.5% 合并肠易激，26.6% 有焦虑/抑郁/PTSD。排除 <18 岁、妊娠、有明确器质性病因者。**不是健康对照研究。**
- 样本量与分组：79 人，无分组；另 8 人参加图表符号访谈，其中 2 人数据被排除，分析 6 人。
- 餐前状态：至少 6 h 禁食；到院后先有 30 min 空腹期。
- 随机、盲法、交叉顺序：无随机、无盲法、无交叉；所有受试者都做一次标准餐测试。

## 3. 刺激

- 餐型：因转诊路径不同有两种。诊所转诊者：230 mL Ensure（Abbott）加一根燕麦能量棒（250 kcal，5 g 脂肪、45 g 碳水、10 g 蛋白、7 g 纤维），合计 482 kcal；闪烁显像转诊者：标准鸡蛋餐 255 kcal（72% 碳水、24% 蛋白、2% 脂肪、2% 纤维），鸡蛋过敏者用豆腐替代。
- 体积、能量、组成：如上；Ensure 体积 230 mL，能量棒与鸡蛋餐的克数未报告。
- 进食时长与方式：10 min 内吃完。
- 与哪一臂配对比较：无餐臂比较；只与 PAGI-SYM/PAGI-QOL 问卷做相关。

## 4. 测量

- 仪器或量表：iOS App（iPad mini），图文符号加文字描述；连续症状用 0–10 Likert 严重度，0＝无，10＝可想象的最严重程度。腹胀、恶心、上腹痛、烧心、胃灼烧等分别记录；excessive post-prandial fullness（餐后过度饱满）只在餐后问；早饱（early satiation）只在餐毕问一次。
- 测的量与单位：症状严重度评分，0–10；不是体积、压力或激素。
- 分母或量表两端：0“none”到 10“most severe imaginable”；每个症状单独一题，不合计成单一“撑感”。
- 时间原点与采样网格：餐毕后 4 h 连续记录；至少每 15 min 一次，症状变化时可更频繁；App 每 15 min 提醒。实际中位交互间隔 8.5 min（IQR 6.5–10.2），所有患者记录间隔不超过 13.6 min。
- 统计量与离散度：每个连续症状取 4 h 的均值与 AUC；与 PAGI-SYM 对应项做 Spearman 相关；报告 r_s、p、n=79。PAGI-SYM 是 20 题、6 点 Likert、回忆过去 2 周的问卷；PAGI-QOL 为 30 题、5 个维度。

## 5. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| excessive fullness 与 PAGI-SYM 对应项相关 | 全队列 | `meal_end` | 4 h 均值 | 0.40 | Spearman r_s | 未报告 | 79 | Results 3.1、Figure 4 |
| early satiation 与 PAGI-SYM 对应项相关 | 全队列 | `meal_end` | 餐毕单点 | 0.55 | Spearman r_s | 未报告 | 79 | Results 3.1、Figure 4 |
| nausea 与 PAGI-SYM 对应项相关 | 全队列 | `meal_end` | 4 h 均值 | 0.67 | Spearman r_s | 未报告 | 79 | Results 3.1（摘要写 0.68） |
| bloating 与 PAGI-SYM 对应项相关 | 全队列 | `meal_end` | 4 h 均值 | 0.42 | Spearman r_s | 未报告 | 79 | Results 3.1（摘要写 0.48） |
| heartburn 与 PAGI-SYM 对应项相关 | 全队列 | `meal_end` | 4 h 均值 | 0.47 | Spearman r_s | 未报告 | 79 | Results 3.1、Figure 4 |
| upper gut pain 与 PAGI-SYM 对应项相关 | 全队列 | `meal_end` | 4 h 均值 | 0.40 | Spearman r_s | 未报告 | 79 | Results 3.1、Figure 4 |
| 总症状负担与 PAGI-SYM 总分相关 | 全队列 | `meal_end` | 4 h 均值 | 0.56 | Spearman r_s | 未报告 | 79 | Results 3.1、Figure 5A |
| 总症状负担与 PAGI-QOL 总分相关 | 全队列 | `meal_end` | 4 h 均值 | −0.34 | Spearman r_s | 未报告 | 79 | Results 3.1、Figure 5B |
| excessive fullness 图表符号自由识别率 | 访谈组 | 不适用 | 不适用 | 16 | 百分比一致 | 未报告 | 6 | Results 3.2 |
| excessive fullness 给标签列表后的识别率 | 访谈组 | 不适用 | 不适用 | 80 | 百分比一致 | 未报告 | 6 | Results 3.2 |

原文明确：所有相关 p<0.001（PAGI-QOL 为 p=0.002）；excessive fullness 与 early satiation 的图表符号识别率最低，作者在讨论中承认这两个符号需要改进。摘要与结果段的 nausea（0.68 对 0.67）、bloating（0.48 对 0.42）数值略有出入，引用时以结果段与 Figure 4 为准，并注明摘要值。

## 6. 可用于本项目

- 可支持：D 的题项定义——0–10、只问餐后、至少每 15 min 记录、与腹胀/恶心/疼痛分开问；这为 `interoception.discomfortFullness` 的 `scale` 与 `time: postprandialOnly`、`missing: not_asked` 提供了出处。
- 只可用于探索：把患者中的相关强度当作“D 是一个可独立报告的症状”的支持；不能把 r_s 当效应量或阈值。
- 不可用于：健康人的 D 正常值、逐时曲线、阈值或斜率；患者量表验证不等于健康人标定。

## 7. 不能推出 / 未报告

- 没有健康对照组；全部是慢性胃十二指肠症状患者，且 82% 为女性，不能给健康人设正常范围。
- 只报告 4 h 均值与 AUC 用于相关分析；没有按时间点报告 D 的分布或曲线，不能重建健康人或患者的逐时 D。
- 没有报告 D 的均值、中位数、四分位或各等级人数；正文只给相关系数。
- 0–10 是严重度，不是“不适”或“疼痛”的量表；题项文字是 “excessive post-prandial fullness”，与 `discomfortFullness` 的“撑得不舒服”只有部分重叠，映射必须标为设计假设。
- 图表符号对 excessive fullness 的自由识别率只有 16%，给标签列表后才到 80%；说明该题项的构念在患者沟通中本身较弱，不能把评分当客观测量。
- 两种测试餐不同（482 kcal 混合餐对 255 kcal 鸡蛋餐），且按转诊路径分配；不能把餐型差异与症状评分分开。
- 相关分析是横断面、全队列，不能推断因果；PAGI-SYM 回忆 2 周，App 记录 4 h，两者时间窗不同。
- 未报告检查者间信度、重测信度或最小临床重要差异；不能据此设“改善多少分算有效”。

## 8. 原文定位

- 摘要：Methods 与 Key Results（数值与结果段略有出入）。
- 正文：Methods 2.1（症状系统与 15 min 间隔）、2.2（App 与 0–10 量表、excessive fullness 仅餐后）、2.3.1（研究 1 设计与统计）；Results 3.1（相关与 Figure 4）、3.2（图表符号识别率）；Figure 1、Figure 2、Figure 4、Figure 5。
- 补充材料：Table S1（访谈引语）、Fig. S1（图表符号）。
- 数据可用性：未单列；个体数据未公开。

## 9. 复核记录

- 复核人 / 日期：待指定；本次由本 mission 对照全文 Methods 2.1–2.3.1 与 Results 3.1–3.2。
- 抽读的图与点：Figure 4 的 excessive fullness 相关；Results 3.2 的 16%/80% 识别率；摘要与结果段的数值对照。
- 与取数行的差异：计划所述“0＝无、10＝可想象的最严重、至少每 15 min、早饱只在餐毕问一次”与原文一致；未做独立复核。
