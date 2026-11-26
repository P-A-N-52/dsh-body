# uvnas-moberg-2020 — 哺乳期女性血浆催产素吸吮时程、脉冲模式与测定方法学系统综述

| 项 | 值 |
| --- | --- |
| source_id | `SRC-UVNASMOBERG-2020` |
| PMID / DOI | `32756565` / `10.1371/journal.pone.0235806` |
| 原文链接 | <https://pubmed.ncbi.nlm.nih.gov/32756565/> |
| 归属系统 | 乳腺与垂体后叶（`mammaryGlands` & `pituitary.oxytocinPgMl`） |
| 取数 / 核对 | 调研报告系统综述摘录 |
| 获取状态 | 全文/系统综述报告摘录（`PLoS One` 2020） |
| 取数日期 | `2026-11-26` |
| 许可 | 登记传统/提取 RIA 量级、潜伏期与脉冲时间窗；严禁混用未提取 EIA |

## 1. 能回答的问题

哺乳期女性开始吸吮后，血浆催产素什么时候升起、什么时候达峰、维持多久、脉冲几次、相对基线升高多少倍？为何必须区分 RIA 与 ELISA？

## 2. 设计与受试者

- 纳入 29 项人体哺乳研究，总样本 $n = 601$ 名哺乳期女性。

## 3. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OT 上升起始 / 峰窗 | 汇总 RIA 研究 | 吸吮开始 | `1.5` min / `1.5–10` min | 显著高于基线 / 达峰，总窗 `~20` min | median / range | — | 601 | Uvnäs-Moberg 2020 |
| 早产后脉冲频次 | 高频采样 | 吸吮开始 | `0–10` min / `0–20` min | 最多 `5` 次/10min；均值 `2.5` 次/20min | max / mean | `± 0.19` | 汇总 | Uvnäs-Moberg 2020 |
| 传统 RIA 基线与增幅 | RIA 队列 | 吸吮前后 | 峰值 | 基线 `0–20` pg/mL，平均升 `5` 倍（`2–10` 倍） | range / mean | — | 汇总 | Uvnäs-Moberg 2020 |
| 未提取 EIA 方法断层 | ELISA 队列 | 基线 | 静息 | `132–1,642` pg/mL（高 100 倍以上） | range | — | 汇总 | Uvnäs-Moberg 2020 |

## 4. 可用于本项目

- 可支持：将 `pituitary.oxytocinPgMl` 标定在传统/提取 RIA 基线量级（`2 pg/mL` 起步、吸吮刺激目标约 `16 pg/mL`）、潜伏期 `1–2 min` 门槛，并支持“单次排乳量与 PRL 升幅无相关”的解耦设计。
- 不可用于：不能混入未提取商业 EIA 的百倍级读数，也不提供哺乳期女性专属体外/体内清除半衰期直接测定。
