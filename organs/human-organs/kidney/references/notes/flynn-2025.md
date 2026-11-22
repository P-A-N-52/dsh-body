# flynn-2025 — 中枢性与肾性尿崩的诊断与管理更新（综述）

| 项 | 值 |
| --- | --- |
| source_id | `SRC-FLYNN-2025` |
| PMID / PMCID / DOI | `39845881` / `PMC11750692` / `10.3389/fendo.2024.1479764` |
| 原文链接 | <https://pmc.ncbi.nlm.nih.gov/articles/PMC11750692/> |
| 归属系统 | 肾（水排泄）与神经（ADH 释放）；DI 样代理的机制方向 |
| 取数 / 核对 | 本 mission 读 PMC 全文主文本；图与表未逐项复核 |
| 获取状态 | 全文（PMC HTML，图未读） |
| 取数日期 | `2026-11-22` |
| 许可 | 只登记结论与原句定位；不复制原图或整表 |

## 1. 能回答的问题

中枢性与肾性尿崩的机制区别是什么？成人“多尿”的常用定义量级是多少？本仓库能否用它支撑 DI 样代理的方向与量级？

## 2. 设计与受试者

- 设计：叙述性综述（narrative review），**无受试者**。
- 人群、样本量、刺激、采样：不适用；文中引用的原始研究数值未在本仓库逐项复核。
- 结论口径：作者综述，不是原始数据；不能当作独立验证或人体测量。

## 3. 文中与本项目相关的报告

| 内容 | 原文定位 | 值 / 原句要点 |
| --- | --- | --- |
| DI 分型 | Abstract；§1 Introduction | 中枢性（CDI）= 垂体后叶 ADH 分泌不足；肾性（NDI）= 肾脏 V2/AQP2 对 ADH 响应不足，ADH 水平可以正常 |
| 患病率 | §1 Introduction | 约 1/25,000；男女相同，任何年龄均可发生 |
| 成人多尿定义 | §3 Clinical Presentation | urine output that exceeds **3 L/day** in adults；儿童 2 L/m²；或 50 mL/kg 体重/24 h |
| 多饮定义 | §3 Clinical Presentation | fluid intake that exceeds 3 liters in 24 hours |
| 低渗尿 | §4 Diagnosis | urine osmolality < **300 mOsm/kg** |
| 诊断 | Abstract；§4 | 限水试验 + 去氨加压素是金标准；copeptin 是候选替代标志物 |
| 治疗 | §5 | 中枢性用去氨加压素；肾性以补水为主，去氨加压素无效 |

## 4. 可用于本项目

- 可支持：中枢 DI = ADH 缺失、肾性 DI = 肾脏对 ADH 不响应 的机制方向；成人 DI 样多尿的 **>3 L/day** 量级。
- 只可用于探索：DI 变体的方向性背景；三篇综述都只能标 `development` / `exploratory`。
- 不可用于：本仓库的 `relativeConcentration = 0`、4 mL/min、5.76 L/day 都不是本文报告值；不能把 3 L/day 写成模型阈值或诊断标准；没有可移植的 ADH 浓度、时程、增益或尿流曲线。

## 5. 不能推出 / 未报告

- 没有原始受试者数据、逐例尿量、尿流 mL/min、ADH/AVP 浓度或时间序列。
- 3 L/day 是成人多尿的常用定义，不是 DI 严重度分级，也不是本模型的参数标定值。
- 不能由本文推出 4 mL/min；不能把去氨加压素反应率或 copeptin 阈值搬进模型。
- 综述可能引用其他研究；本仓库未逐篇追踪其原始来源。

## 6. 原文定位

- Abstract（分型与诊断概述）。
- §1 Introduction（患病率、CDI/NDI 定义）。
- §3 Clinical Presentation（多尿/多饮定义段落）。
- §4 Diagnosis（低渗尿、限水试验）。
- §5 Treatment（中枢/肾性治疗差别）。

## 7. 复核记录

- 复核人 / 日期：实施 worker / `2026-11-22`
- 抽读内容：PMC 全文主文本的 Abstract、Introduction、Clinical Presentation、Diagnosis；未读图片与补充材料。
- 与登记行的差异：登记按全文主文本记录，未把任何数值升级为参数或 `validated`。
