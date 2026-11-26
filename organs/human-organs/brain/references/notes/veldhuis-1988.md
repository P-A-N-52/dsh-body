# veldhuis-1988 — 健康男性 24 小时催乳素昼夜波幅与脉冲分泌

| 项 | 值 |
| --- | --- |
| source_id | `SRC-VELDHUIS-1988` |
| PMID / DOI | `3379128` / `10.1210/jcem-67-1-116` |
| 原文链接 | <https://pubmed.ncbi.nlm.nih.gov/3379128/> |
| 归属系统 | 脑部（垂体前叶催乳素） |
| 取数 / 核对 | 调研报告摘要摘录 / 待全文核对 |
| 获取状态 | 摘要摘录（`J Clin Endocrinol Metab` 1988） |
| 取数日期 | `2026-11-26` |
| 许可 | 登记 24h PRL 谐波振幅 `2.1 ± 0.3 ng/mL` 与相对均值占比 |

## 1. 能回答的问题

健康年轻成人每 10 分钟采血 24 小时下的催乳素（PRL）昼夜谐波振幅与脉冲增量是多少？

## 2. 设计与受试者

- 人群：健康年轻男性 $n = 12$，每 10 min 采血 24 h，采用 Fourier 谐波与 Cluster 脉冲分析。

## 3. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRL Fourier 昼夜振幅 | 健康男性 | 24h 节律 | 全程 | `2.1` ng/mL (`30%` of 24h mean) | mean | `± 0.3` ng/mL (`± 4%`) SEM | 12 | Veldhuis 1988 |
| PRL 脉冲增量振幅 | 健康男性 | 24h 脉冲 | 全程 | `4.0` ng/mL (`+58%` over nadir) | mean | `± 0.3` ng/mL (`± 6%`) SEM | 12 | Veldhuis 1988 |
| PRL 脉冲频率 / 间隔 | 健康男性 | 24h 脉冲 | 全程 | `14` /24h / `95` min | mean | `± 1` / `± 6` SEM | 12 | Veldhuis 1988 |

## 4. 可用于本项目

- 可支持：设定 `pituitary.prolactinCircadianAmplitudeNgMl = 2.1 ng/mL`（`prior`），以及将非哺乳清醒 PRL 基线落在约 `8 ng/mL` 真实生理区间（`design`）。
- 不可用于：仅针对健康男性，不直接代表哺乳期女性或高潮脉冲峰值。
