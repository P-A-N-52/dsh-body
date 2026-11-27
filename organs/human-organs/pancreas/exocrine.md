# 胰外分泌的有效脂肪酶（pancreasExocrine）

`exocrine.ts` 仅在[膳食脂质预设](../../presets/human-lipid/README.md)启用。轮初肠腔未水解 `lumenTgG` 为负荷 `T`，本轮输出 `lipaseActivityU = 最大活性 × T/(半效负荷+T)`。`activityAtSimSeconds` 是提交秒数，下轮 `intestinalLipid` 用它筛掉旧交付，并让有效活性约束水解速率。LAU 是无标定活性代理，不是测定的 U/mL、分泌液体积或营养克数；不会修改胰岛素或葡萄糖。

**可自定义参数：** 存档顶层 `parameters` 按 ID 覆盖时生效，未覆盖取 [`exocrine.parameters.json`](exocrine.parameters.json)。全部 `design`、`source: null`。

| ID | 默认 | 单位 | 适用条件 |
| --- | ---: | --- | --- |
| `pancreasExocrine.maxLipaseActivityU` | 3 | LAU | 非负；0 表示断供水解用脂肪酶 |
| `pancreasExocrine.mealHalfG` | 1 | g TG 当量 | 正数；半刺激的肠腔未水解负荷 |

[OpenStax A&P 2e §23.6 Pancreatic Juice、§23.7 Lipid Digestion](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder) 支撑胰酶参与脂质水解的方向，不支撑以上数值。不另建胰液体积、pH、碳酸氢盐、蛋白酶、淀粉酶、导管或临床胰外分泌不足。
