# odell-1967 — 正常甲状腺功能成人外源 TSH 清除半衰期

| 项 | 值 |
| --- | --- |
| source_id | `SRC-ODELL-1967` |
| PMID / DOI | `6026100` / `10.1172/JCI105601` |
| 原文链接 | <https://pubmed.ncbi.nlm.nih.gov/6026100/> |
| 归属系统 | 脑部（垂体前叶 TSH） |
| 取数 / 核对 | 调研报告摘要摘录 / 待全文核对离散度 |
| 获取状态 | 摘要摘录（`J Clin Invest` 1967） |
| 取数日期 | `2026-11-26` |
| 许可 | 仅登记正常成人放射示踪 TSH 平均半衰期 |

## 1. 能回答的问题

甲状腺功能正常的成人在静脉注射示踪 TSH 后，其血浆清除半衰期和分布容积均值是多少？

## 2. 设计与受试者

- 受试者：甲状腺功能正常成人 $n = 12$。
- 干预：$t = 0$ 静脉注射 `0.5` 或 `5 μg` TSH-¹³¹I。

## 3. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TSH 清除半衰期 | 正常对照 | IV 注射 | 消失相 | `53.9` min | mean | 未报告 SD/IQR | 12 | Odell 1967 |
| TSH 分布容积 | 正常对照 | IV 注射 | 稳态 | `5.8%` body weight | mean | 未报告 SD/IQR | 12 | Odell 1967 |

## 4. 可用于本项目

- 可支持：替换 `pituitary` TSH 原 `30 min` 占位半衰期，改用 `pituitary.tshHalfTimeMin = 53.9 min`（`prior`）。
- 不可用于：老式放射标记 TSH 法，未报告 SD/IQR，不作绝对浓度转换或病理外推。
