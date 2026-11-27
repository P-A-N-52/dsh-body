# 肠淋巴在途隔室（intestinalLymph）

仅[膳食脂质预设](../../presets/human-lipid/README.md)加载 `meal-transit.ts`。`tgInTransitG` 是已吸收、已包装的餐源长链 TG 当量（g），不是淋巴液 mL；`returnedTgG` 是本轮实际到静脉循环的量（g，不是另一个存量）。以 `−tgInTransitG × expm1(−kΔmin)` 从轮初池支付 `lipidCirculation.mealTgG`，同轮从肠腔新到者留到下一轮。是一个在途平均时间代理，不是恒定路程或固定延迟。

**可自定义参数：** `intestinalLymph.returnPerMin`，不覆盖取 [`meal-transit.parameters.json`](meal-transit.parameters.json) 的 **0.10 1/min**（[0, 5]，0 表示保留在途池不转入循环），标 `design`、`source: null`。覆盖位置为该身体存档顶层 `parameters`。

[OpenStax A&P 2e §23.7 Lipid Absorption](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-7-chemical-digestion-and-absorption-a-closer-look) 支撑乳糜微粒由淋巴到静脉的方向，不给这个速率。未建全身组织液回流、淋巴水量、泵、淋巴结、免疫或短/中链脂质入门静脉。
