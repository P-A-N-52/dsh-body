# schamberg-2023 — 标准餐 4 h 症状记录与胃电频谱的横断面比较

| 项 | 值 |
| --- | --- |
| source_id | `SRC-SCHAMBERG-2023` |
| PMID / DOI | `37696955` / `10.1038/s41598-023-41645-w` |
| 原文链接 | <https://pmc.ncbi.nlm.nih.gov/articles/PMC10495352/> |
| 归属系统 | 神经（D 的时间分辨率与数据可得性边界） |
| 取数 / 核对 | 待指定 / 待指定 |
| 获取状态 | 全文（Scientific Reports 开放获取） |
| 取数日期 | `2026-11-20` |
| 许可 | 仅登记原文明确写出的事实与链接；未复制原图或整表 |

## 1. 能回答的问题

在一套标准化 4 h 胃功能测试里，“餐后过度饱满”是否作为独立症状被记录？这篇论文有没有给出健康对照的逐时 D 曲线、分布或阈值？症状与胃电频谱指标的相关有多强、能支持什么？

## 2. 设计与受试者

- 设计：对既有数据库的回顾性、协议化方法比较；同一批记录分别用 BSGM（Gastric Alimetry）与 EGG 两条管线分析。
- 人群与纳入条件：178 人；健康志愿者 110、1 型糖尿病 32、慢性恶心呕吐综合征 43（7 人兼有两病）。对照中位年龄 32 岁（IQR 24–50），男 49、女 61。数据来自 Auckland、Calgary、Louisville、Western Sydney 四个中心。
- 样本量与分组：178 人；对照 110、T1D 32、NVS 43；分类分析中 NVS 43 对对照 110。
- 餐前状态：禁食 >6 h；测试前避免咖啡因与尼古丁；影响胃肠动力的药物停 72 h。
- 随机、盲法、交叉顺序：无随机、无交叉；回顾性分析。专家共识面板对患者/对照状态设盲，用于分类参考标准，不用于症状评分。

## 3. 刺激

- 餐型：482 kcal 标准餐；一根燕麦能量棒（250 kcal，5 g 脂肪、45 g 碳水、10 g 蛋白、7 g 纤维；Clif Bar）加 Ensure（232 kcal/250 mL；Abbott），或等热量的糖尿病餐替代。
- 体积、能量、组成：如上；Ensure 250 mL，能量棒克数未报告；合计 482 kcal。
- 进食时长与方式：10 min 内吃完。
- 与哪一臂配对比较：无餐臂比较；比较的是同一批记录的两条分析管线与三个受试者组。

## 4. 测量

- 仪器或量表：症状用已验证的 App（引文 15，即 Sebaratnam 2022）记录；胃电用 BSGM 与 EGG。
- 测的量与单位：症状严重度 0–10；BSGM/EGG 的频谱指标（主频、节律稳定性、振幅、振幅比等）。
- 分母或量表两端：症状量表同 Sebaratnam：0＝无，10＝可想象的最严重；每个症状单独记录。excessive fullness 是六个连续症状之一（上腹痛、恶心、腹胀、烧心、胃灼烧、excessive fullness），早饱在餐毕单点记录。
- 时间原点与采样网格：30 min 空腹期 + 10 min 进餐 + 4 h 餐后记录；症状在 4 h 内连续记录，但分析用**全程平均分**，不是逐时点值。
- 统计量与离散度：每个症状取全程平均；总症状负担＝各症状餐后平均之和加早饱。症状与 8 个频谱指标做 Pearson 相关（95% bootstrap CI），Benjamini–Hochberg 控制 10% FDR；56 个相关。症状分析在全部 178 人上进行。

## 5. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 受试者总数 | 全队列 | 不适用 | 不适用 | 178 | 计数 | 不适用 | 178 | Methods（Data collection） |
| 健康对照 | 对照 | 不适用 | 不适用 | 110 | 计数 | 不适用 | 110 | Methods（Data collection） |
| 1 型糖尿病 | T1D | 不适用 | 不适用 | 32 | 计数 | 不适用 | 32 | Methods（Data collection） |
| 慢性恶心呕吐综合征 | NVS | 不适用 | 不适用 | 43 | 计数 | 不适用 | 43 | Methods（Data collection） |
| 标准餐能量 | 全队列 | 不适用 | 不适用 | 482 | kcal | 未报告 | 178 | Methods（Data collection） |
| 进餐时长 | 全队列 | 不适用 | 不适用 | 10 | min | 未报告 | 178 | Methods（Data collection） |
| 餐后记录时长 | 全队列 | `meal_end` | 4 h | 240 | min | 未报告 | 178 | Methods（Data collection） |
| excessive fullness 与主频偏离的相关 | 全队列 | `meal_end` | 4 h 平均 | 未报告具体 r | Pearson r | CI 见补充表 S4 | 178 | Results（Symptom correlations）、Figure 5 |
| 所有显著症状相关的范围 | 全队列 | `meal_end` | 4 h 平均 | −0.3 < r < 0.3 | Pearson r | 未报告 | 178 | Results（Symptom correlations） |

原文明确：BSGM 的显著症状相关数量是 EGG 的 8 倍；excessive fullness 与“主频偏离”（Principal Gastric Frequency deviation）相关（p<0.05）；所有显著相关的系数都在 −0.3 与 0.3 之间。具体 r、CI、BH 临界值在 Supplementary Table S4；本笔记没有抄录该表数值，不能补一个看起来合理的 r。

## 6. 可用于本项目

- 可支持：在标准化 4 h 测试中，D 可作为独立症状被连续记录；症状与胃电指标的相关即使显著也很弱（|r|<0.3），说明 D 不能由单一胃电指标解释。这支持“D 单独建模、不要用 F 或机械输入代替”的设计边界。
- 只可用于探索：把“excessive fullness 与主频偏离相关”当作 D 可能与胃节律异常有关的假设来源，不是因果或阈值依据。
- 不可用于：健康人 D 的逐时曲线、均值、分布、阈值或斜率；本文没有报告这些。

## 7. 不能推出 / 未报告

- 没有健康组的逐时 D 曲线：症状只取 4 h 全程平均，正文与补充表报告的是相关，不是时间序列。
- 没有报告 excessive fullness 的均值、中位数、各等级人数或按组分布；不能设撑感阈值或斜率。P1 的 `interoception` 参数文件已裁掉未使用的 `discomfort.*`，这篇笔记只保留为后续撑感读出的候选证据。
- 相关分析在全部 178 人（含患者与“多为轻症状”的对照）上做，不能把相关系数解释为健康人的 D 机制。
- 110 名对照是“健康志愿者”，但论文没有给出他们的 D 分数，也没有单独的健康组 D 分析；不能把“对照”当成 D=0。
- 两种测试餐（含等热量糖尿病餐替代）与四个中心，症状记录没有按餐型分层报告；不能把餐型差异与 D 分开。
- 这是胃电方法学比较，不是 D 的量表验证；D 的题项与量程出处仍是 Sebaratnam 2022。
- 个体数据需向通讯作者（Armen Gharibans）合理请求；本文未公开逐人症状日志。
- 回顾性、横断面；不能推断症状与胃电指标的先后或因果。

## 8. 原文定位

- 摘要：Abstract 与 Introduction。
- 正文：Methods（Data collection：标准餐、4 h 记录、症状 App；Symptom correlations：全程平均、Pearson、BH）；Results（Symptom correlations；Figure 5）；Discussion（症状相关弱的解释、限制）。
- 补充材料：Supplementary Table S2（各指标分组统计）、S3（逐小时指标）、S4（症状相关的 r、CI、BH 临界值）；Supplementary Fig. S1。
- 数据可用性：Data Availability Statement，向 Armen Gharibans 合理请求。

## 9. 复核记录

- 复核人 / 日期：待指定；本次由本 mission 对照全文 Methods 与 Results。
- 抽读的图与点：Methods 的 482 kcal/10 min/4 h/178 人；Results 的 8× 相关与 |r|<0.3；Data Availability。
- 与取数行的差异：原计划写“核补表 S1”来查症状分项，实际症状相关在 Figure 5 与 Supplementary Table S4，S1 是频谱图；本笔记按实际补充表编号记录，未抄未见的 r 值。
