# keenan-2004 — 健康成人 24 小时 ACTH–皮质醇脉冲反卷积与双尺度清除动力学

| 项 | 值 |
| --- | --- |
| source_id | `SRC-KEENAN-2004` |
| PMID / DOI | `15186998` / `10.1152/ajpendo.00167.2004` |
| 原文链接 | <https://pubmed.ncbi.nlm.nih.gov/15186998/> |
| 归属系统 | 内分泌（HPA 轴：ACTH / 肾上腺皮质醇） |
| 取数 / 核对 | 调研报告摘要与动力学参数摘录 / 待补全原文 PDF 页码 |
| 获取状态 | 摘要与动力学参数摘录（`Am J Physiol Endocrinol Metab` 2004） |
| 取数日期 | `2026-11-26` |
| 许可 | 仅登记本报告核对的健康成人去卷积拟合参数与方向 |

## 1. 能回答的问题

健康成人在 24 小时高频采血下，ACTH 与总皮质醇、游离皮质醇的清除半衰期、非线性 ACTH→皮质醇剂量—反应以及 CBG/白蛋白分配结构如何定量刻画？

## 2. 设计与受试者

- 设计：24 小时每 10 分钟高频采血，联合去卷积反演 ACTH 与皮质醇分泌脉冲、双指数消除、游离–CBG–白蛋白交换与非线性剂量反应。
- 人群：健康成人 $n = 32$（具体性别比例与年龄范围未在摘要摘录中列明）。

## 3. 刺激与测量

- 无外源药理干预（自发 24 h 节律与脉冲监测）。
- 测量：血浆 ACTH、总皮质醇与估算游离皮质醇（`ng/L`、`nmol/L`、`μmol·L⁻¹·day⁻¹`）。

## 4. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ACTH 清除半衰期 | 健康成人 | 24h 序列拟合 | 全程 | `20` min | mean | `± 1.3` SE | 32 | Keenan 2004 |
| 总皮质醇清除半衰期 | 健康成人 | 24h 序列拟合 | 全程 | `49` min | mean | `± 2.4` SE | 32 | Keenan 2004 |
| 游离皮质醇扩散/分布时间尺度 | 健康成人 | 24h 序列拟合 | 全程 | `1.8` min | mean | `± 0.20` SE | 32 | Keenan 2004 |
| 游离皮质醇消除时间尺度 | 健康成人 | 24h 序列拟合 | 全程 | `4.1` min | mean | `± 0.30` SE | 32 | Keenan 2004 |
| ACTH→皮质醇 EC50 | 健康成人 | 剂量-反应拟合 | 全程 | `26` ng/L (`26 pg/mL`) | mean | `± 2.4` SE | 32 | Keenan 2004 |
| ACTH→皮质醇效能 | 健康成人 | 剂量-反应拟合 | 全程 | `10` nmol·L⁻¹·min⁻¹ | mean | `± 1.8` SE | 32 | Keenan 2004 |
| 游离皮质醇均值（约 6% 游离） | 健康成人 | 24h 均值 | 全程 | `11.5` nmol/L | mean | `± 0.54` SE | 32 | Keenan 2004 |

## 5. 可用于本项目

- 可支持：`pituitary.acthHalfTimeMin = 20 min`、`adrenal.eliminationHalfTimeMin = 49 min`、`adrenal.acthEc50PgMl = 26 pg/mL`、`adrenal.maxSecretionNmolLPerMin = 10 nmol/(L·min)` 的 `prior` 标定，以及采用 Hill/Sigmoid 响应替代线性靶值。
- 不可用于：不能把总皮质醇 `49 min` 机械等同于游离皮质醇单室半衰期，也不能把敏感度 `0.65 slope units` 直接按未经原方程定义的 Hill 指数套用。

## 6. 不能推出 / 未报告

- 本摘录未报告原始完整标题与逐人离散度 SD；CBG 结合比例（~80% CBG、~14% 白蛋白、~6% 游离）随浓度非线性变化，不可当作固定换算系数。
