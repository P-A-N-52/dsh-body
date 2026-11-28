# 循环餐源 TG 与 NEFA（lipidCirculation）

仅[膳食脂质预设](../../presets/human-lipid/README.md)加载 `meal-lipids.ts`。`mealTgG` 来自肠淋巴，是已知餐源 TG 库存；`nefaEquivalentG` 来自脂肪库净动员，是非酯化脂肪酸（NEFA）的同单位 TG/酰基当量库存，**不是 NEFA 的物理质量或血清浓度**。两者都不影响现有葡萄糖质量。

餐源 TG 从轮初库存出清，以脂肪库的轮初 `storageFraction` 分给 `storedThisRoundG` 和 `mealTgUptakeG`。通过 `io.call('adipose', 'storageCapacityG')` 取脂肪库所有者本次启动的生效容量（自定义清单也应保留 `meal-lipids.ts` 的字符串脚本条目，以提供 `io.call`）。用它和轮初库存算可存余量，拒收份额仍在 `mealTgG`，不改付其他摄取，也不能用上本轮脂肪库释放腾出的空间。`nefaUptakeG` 只从轮初独立 NEFA 当量池支付。`tissueUptakeTotalG` 累计组织摄取/未追踪残粒离账，非库存，**不表示氧化、热量释放或任何能量结算**。临时三条本轮实付量不应再计入守恒总和。

**可自定义参数：** 存档顶层 `parameters` 按 ID 覆盖，默认来自 [`meal-lipids.parameters.json`](meal-lipids.parameters.json)。以下均 `design`、`source: null`。

| ID | 默认 | 单位 | 适用条件 |
| --- | ---: | --- | --- |
| `lipidCirculation.mealTgClearancePerMin` | 0.06 | 1/min | [0, 5]；轮初餐源 TG 出清的合计一阶率 |
| `lipidCirculation.nefaClearancePerMin` | 0.12 | 1/min | [0, 5]；轮初 NEFA 当量摄取率 |

[OpenStax A&P 2e §23.7 Lipid Absorption](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-7-chemical-digestion-and-absorption-a-closer-look) 支持餐源脂质循环分流的方向。尚不计算血浆分布容积、总血清 TG/NEFA、组织摄取定量、内源 VLDL、重酯化、完整脂蛋白或供能。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

### meal-lipids.parameters.json

参数文件：[`meal-lipids.parameters.json`](meal-lipids.parameters.json)。入口及清单：[`meal-lipids.ts`](meal-lipids.ts)（[可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。读取脚本：[`meal-lipids.ts`](meal-lipids.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `lipidCirculation.mealTgClearancePerMin` | `0.06` | `1/min` | `design` | 无 | — |
| `lipidCirculation.nefaClearancePerMin` | `0.12` | `1/min` | `design` | 无 | — |

<!-- organ-parameters:end -->
