# 肠淋巴在途隔室（intestinalLymph）

仅[膳食脂质预设](../../presets/human-lipid/README.md)加载 `meal-transit.ts`。`tgInTransitG` 是已吸收、已包装的餐源长链 TG 当量（g），不是淋巴液 mL；`returnedTgG` 是本轮实际到静脉循环的量（g，不是另一个存量）。以 `−tgInTransitG × expm1(−kΔmin)` 从轮初池支付 `lipidCirculation.mealTgG`，同轮从肠腔新到者留到下一轮。是一个在途平均时间代理，不是恒定路程或固定延迟。

**可自定义参数：** `intestinalLymph.returnPerMin`，不覆盖取 [`meal-transit.parameters.json`](meal-transit.parameters.json) 的 **0.10 1/min**（[0, 5]，0 表示保留在途池不转入循环），标 `design`、`source: null`。覆盖位置为该身体存档顶层 `parameters`。

[OpenStax A&P 2e §23.7 Lipid Absorption](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-7-chemical-digestion-and-absorption-a-closer-look) 支撑乳糜微粒由淋巴到静脉的方向，不给这个速率。未建全身组织液回流、淋巴水量、泵、淋巴结、免疫或短/中链脂质入门静脉。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

### meal-transit.parameters.json

参数文件：[`meal-transit.parameters.json`](meal-transit.parameters.json)。入口及清单：[`meal-transit.ts`](meal-transit.ts)（[可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。读取脚本：[`meal-transit.ts`](meal-transit.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `intestinalLymph.returnPerMin` | `0.1` | `1/min` | `design` | 无 | — |

<!-- organ-parameters:end -->
