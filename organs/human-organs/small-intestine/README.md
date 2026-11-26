# 小肠（smallIntestine）：水与碳水吸收

**功能标签：** 消化（小肠水吸收、可消化碳水吸收）。

小肠目前只有一个部位写者 `water-absorption.ts`。它把轮初肠腔水和可消化碳水分别按一阶指数吸收：水转入 `bodyFluid`，碳水转入 `glucose`。文件名保留为水链时代的兼容路径，状态已经不只包含水。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/small-intestine/`，并已加入根清单（当前根清单 39 部位、35 份唯一参数文件，另含 3 份不随根清单加载的 DI 变体与 1 份缺区域变体；女性清单 42 / 38，男性清单 41 / 37）。

**清单依赖。** 水通道要求同时加载 `stomach/hydration.ts`、`bodyFluid`、`bladder`、`colon`、[`skin`](../skin/README.md) 与 [`lungs`](../lungs/README.md)：`bodyFluid.waterVolumeMl` 按肾→肺→汗的顺序向膀胱、肺和皮肤三个出口分配轮初水，`skin.sweatVolumeMl` 与 `lungs.respiratoryWaterLossMl` 分别声明来自体液的 `transferIn`；`colon.residueWaterMl` 接收本脚本按离开通量比例分流出的未吸收残渣水，并把回收水转回 `bodyFluid`。碳水通道要求加载 `organs/human-compartments/glucose/glucose.ts`，而葡萄糖的入口与出口又要求 `liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose` 以及三个骨骼肌区域部位（`muscleHead`、`muscleTrunk`、`muscleLimbs`）。因此完整硬 transfer 闭包是根与男性清单共 15 个部位（`hydration.ts`、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGlucose`、`kidneyGluconeogenesis`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs`），女性清单再加 `uterus` 与 `mammaryGlands` 共 17 个部位；沿用旧自定义清单、缺少任一配对部位时，启动会因 transfer 配对缺失而拒绝继续。旧 `stomach/motility.ts` 不含小肠，仍可独立加载。[`physicalActivity`](../skeletal-muscle/README.md) 只是 [`skin`](../skin/README.md)、[`lungs`](../lungs/README.md) 与 [`muscleGlucose`](../skeletal-muscle/README.md) 的普通轮初读取，不是 transfer 配对依赖，也不在小肠的读写链上。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water-absorption.ts` | `smallIntestine` | `waterVolumeMl`、`absorbedWaterMl`、`carbohydrateG`、`absorbedCarbohydrateG` | 自己的轮初状态 `smallIntestine`；可选轮初 `bodyFluid.waterDeficit`、`glucose.concentrationMgDl`、`pancreasEndocrine.insulinRelative`；`io.dt` | `water-absorption.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 轮末肠腔水量（状态）；`transferIn` 来自 `stomach.waterVolumeMl`，`transferOut` 到 `bodyFluid.waterVolumeMl` 与 `colon.residueWaterMl` |
| `absorbedWaterMl` | `mL` | 本轮水吸收量（每轮通量，不是累计） |
| `carbohydrateG` | `g` | 轮末肠腔可消化葡萄糖当量碳水（状态）；`transferIn` 来自 `stomach.carbohydrateG`，`transferOut` 到 `glucose.glucoseMassG` |
| `absorbedCarbohydrateG` | `g` | 本轮碳水吸收量（每轮通量，不是累计） |

两个池不是肠内容物总量的完整分解，也不区分十二指肠、空肠、回肠。碳水不从体积或能量反推；`duodenum.nutrientExposure` 仍是由胃排空能量滤波的到达速率代理，不等于这里的碳水质量吸收。

时间原点：两个存量字段是轮末状态，初值均为 0；两个吸收字段只表示本轮，原点为该轮开始。

## 3. 方程与参数

设轮初肠水 `W_start = max(0, prev.waterVolumeMl)`、轮初碳水 `C_start = max(0, prev.carbohydrateG)`，`dtMin = io.dt / 60`，`deficit = clamp(bodyFluid.waterDeficit, 0, 1)`（未加载按 0），`I = pancreasEndocrine.insulinRelative`（未加载按 1），`G = glucose.concentrationMgDl`（未加载按 90）：

```text
waterFactor = max(0, 1 + waterAbsorptionDehydrationFactor × deficit)
carbFactor  = max(0, 1 + carbAbsorptionInsulinGain × (I − 1)
                       − carbAbsorptionGradientGain × (G / 90 − 1))

A_water = clamp(W_start × (1 − 2^(−dtMin / 20)) × waterFactor, 0, W_start)
A_carb  = clamp(C_start × (1 − 2^(−dtMin / 20)) × carbFactor,  0, C_start)

f = clamp(residueFraction, 0, 1)
remainingWater = max(0, W_start − A_water)
residue = f <= 0 ? 0
        : f >= 1 ? remainingWater
        : min(remainingWater, A_water × f / (1 − f))

write.waterVolumeMl = W_start
write.carbohydrateG = C_start
write.absorbedWaterMl = A_water
write.absorbedCarbohydrateG = A_carb
transfer smallIntestine → bodyFluid: A_water
transfer smallIntestine → colon: residue
transfer smallIntestine → glucose: A_carb
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | ---: | --- | --- | --- |
| `smallIntestine.absorption.halfTimeMin` | 20 | `min` | `design` | `SRC-PERONNET-2012`（只作水吸收时间尺度背景） |
| `smallIntestine.residueFraction` | 0.05 | `1` | `design` | —（无直接证据） |
| `smallIntestine.carbohydrateAbsorption.halfTimeMin` | 20 | `min` | `design` | 无直接来源；未来由人体肠腔碳水消失或餐后葡萄糖观测替换 |
| `smallIntestine.waterAbsorptionDehydrationFactor` | 0.1 | `1` | `design` | —（无直接证据；脱水时 `+0.1 × deficit` 温和维持/略促进吸水） |
| `smallIntestine.carbAbsorptionInsulinGain` | 0 | `1` | `design` | —（无直接证据；肠腔 SGLT1 吸收不依赖胰岛素，保留参数兼容） |
| `smallIntestine.carbAbsorptionGradientGain` | 0.2 | `1` | `design` | —（无直接证据；高血糖时负反馈减缓吸收，`90 mg/dL` 为脚本内硬编码参考浓度） |

两个 20 min 是独立参数，恰好取相同默认值，不表示水和碳水在人体内有相同吸收机制。碳水半时不能借 Péronnet 的水研究或 Dalla Man 2007 的 `k_abs` 冒充实测值。`residueFraction = 0.05` 采用**按离开通量比例的 95/5 分流**（`A_water × f / (1 − f)` 并钳到 `remainingWater`），使离开小肠的总水通量中约 95% 吸收进 `bodyFluid`、约 5% 进入 `colon.residueWaterMl`，并自然随 `dtMin` 缩放；吸收量与残渣均按 `[0, 轮初池]` 非负且不透支钳位，确保同轮两笔 `transfer` 之和不超过 `W_start`。`bodyFluid`、`glucose`、`pancreasEndocrine` 为可选上游，已加载但字段缺失、非有限或 `glucose.concentrationMgDl` / `insulinRelative` 为负时抛错，本轮不写状态也不发 transfer。结肠下一轮才回收其中一部分回流 `bodyFluid`，本轮回收量不参与本轮小肠吸收。

只吸收轮初池：胃同轮转入的水和碳水在 Gateway 的 transfer 阶段才加入肠池，下一轮才参与吸收。旧存档缺少碳水字段时按 0，不猜历史摄入。

## 4. 读写边界

- 本脚本是 `smallIntestine` 的唯一写者，只读自己的轮初状态与可选上游 `bodyFluid.waterDeficit`、`glucose.concentrationMgDl`、`pancreasEndocrine.insulinRelative`。
- 先 `write` 转出前基准，再请求 `transfer`；同轮新流入不能用于本轮吸收。
- 不读胃的总体积、总能量或排空通量来计算吸收；胃到小肠的质量只经声明的 transfer 配对进入。
- 不写 `bodyFluid`、`colon`、`glucose`、`bladder` 或其他部位。
- 结肠残渣出口由本脚本发起 transfer；`colon` 必须加载，否则启动校验因 `transferOut` 目标未声明而失败。胃同轮转入的水在 transfer 阶段才加入肠池，不参与本轮残渣计算。

## 5. 证据入口

- 水证据笔记：[`references/notes/peronnet-2012.md`](references/notes/peronnet-2012.md)
- 葡萄糖隔室与分布体积：[`../../human-compartments/glucose/README.md`](../../human-compartments/glucose/README.md)
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.2；[`docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md`](../../../docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)；结肠残渣出口见 [`2026-11-24-bowel-design.md`](../../../docs/superpowers/specs/2026-11-24-bowel-design.md)

**证据边界：** Péronnet 2012 是 36 名健康年轻男性一次 300 mL D₂O 的口服标记水研究，只支撑水吸收的探索时间尺度；75–120 min 是表观完全吸收时间，不是小肠半时。碳水一阶吸收和 20 min 都是 `design`，没有独立验证。

## 6. 当前限制

- 不区分肠段、转运体、刷状缘酶、消化速度、渗透压、肠腔 pH、血流或神经调节。
- 可消化碳水统一按葡萄糖当量处理；不区分单糖、双糖、淀粉、糖醇和纤维，不建脂肪或蛋白吸收。
- 两个吸收字段是模型通量读数，不是门静脉实测通量、血浆容量变化或吸收分数。
- 残渣比例 0.05 是工程假设，不建结肠转运时间、粪便水、纤维或菌群；它会让相当一部分未吸收水进入结肠，而不是全部回流体液。
- 没有个体化吸收半时，也没有独立生理数据验证。
