# 肝供胆汁功能量（liverBile）

`bile.ts` 仅在[膳食脂质预设](../../presets/human-lipid/README.md)启用，不改肝糖原。本轮 `supplyActivityU = 供应率 × Δmin`（BAU，胆盐作用的无标定功能单位）；`activityAtSimSeconds` 标记提交时刻。下一轮由 `gallbladder` 分到储库或胆道，超过一轮的旧交付不再使用。没有动作或脂质 g transfer。

**可自定义参数：** 存档顶层 `parameters` 可覆盖 `liverBile.supplyActivityUPerMin`，未覆盖读取 [`bile.parameters.json`](bile.parameters.json) 的 **0.08 BAU/min**（非负；0 停止新增供给，不清空胆囊）。它是 `design`、`source: null`。[OpenStax A&P 2e §23.6 的 Liver/Bile](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder) 仅支撑肝供胆方向；不计算胆汁体积、组成、盐浓度、分子合成、肠肝循环及胆固醇排泄。
