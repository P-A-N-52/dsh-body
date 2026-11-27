# 胆囊与胆道交付

仅[膳食脂质预设](../../presets/human-lipid/README.md)加载 `bile-reserve.ts`，部位 `gallbladder`。肝提供功能量；胆囊从有限库存释放并收存肝供给的一部分，**胆道只把直通、溢流和实付释放加在一起交付**，无独立产胆或空壳部位。`intestinalLipid` 在下一轮读取交付，约束水解和吸收。

轮初库存 `stockActivityU`（BAU，胆盐作用的无标定工程单位）按轮初肠腔未水解和已水解 TG 当量求释放率，`k = releaseMaxPerMin × load/(mealHalfG+load)`；释放 `Q = stock × (1−exp(−kΔ))`。`storedActivityU ≤ capacity−轮初库存`，不能用本轮排出腾出的容量；`releasedActivityU = Q`。`ductDeliveredActivityU = 上轮肝供给 − 本轮入库 + Q`。新档库存为容量，保存后保留实存；若下调容量，超出的已有库存不删，暂停存入直到低于新容量。`activityAtSimSeconds` 是交付提交秒数，过了下一轮不重播。各量都不计入脂质 g 账。

## 可自定义参数

通过[存档顶层 `parameters`](../../presets/human-lipid/README.md#自定义参数)按完整 ID 覆盖。没有覆盖时读取 [`bile-reserve.parameters.json`](bile-reserve.parameters.json)。全部为 `design`、`source: null`，不是测得的胆汁容量、排空或胆盐浓度。

| ID | 默认 | 单位 | 适用条件 |
| --- | ---: | --- | --- |
| `gallbladder.capacityActivityU` | 3 | BAU | 非负；补入上限和新档初值；0 表示不新存肝供给 |
| `gallbladder.directFraction` | 0.25 | 1 | [0, 1]；至少这部分肝供给直接经胆道，其余只存得下多少就存多少 |
| `gallbladder.releaseMaxPerMin` | 0.16 | 1/min | [0, 5]；刺激充足时的一阶释放率，0 禁用库存释放 |
| `gallbladder.mealHalfG` | 1 | g TG 当量 | 正数；半刺激所需的肠腔负荷 |

[OpenStax A&P 2e §23.6，Bile/Gallbladder](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder) 支撑肝供胆、胆囊储放的方向。没有拟合胆汁体积、胆汁浓缩、CCK 时程、胆道阻塞或肠肝再循环。
