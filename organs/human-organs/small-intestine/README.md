# 小肠（smallIntestine）：水与碳水吸收

**功能标签：** 消化（小肠水吸收、可消化碳水吸收）。

小肠目前只有一个部位写者 `water-absorption.ts`。它把轮初肠腔水和可消化碳水分别按一阶指数吸收：水转入 `bodyFluid`，碳水转入 `glucose`。文件名保留为水链时代的兼容路径，状态已经不只包含水。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/small-intestine/`，并已加入根清单（当前 17 个部位）。

**清单依赖。** 水通道要求同时加载 `stomach/hydration.ts`、`bodyFluid`、`bladder` 与 [`skin`](../skin/README.md)：`bodyFluid.waterVolumeMl` 向膀胱和皮肤两个出口转水，`skin.sweatVolumeMl` 声明来自体液的 `transferIn`。碳水通道要求加载 `organs/human-compartments/glucose/glucose.ts`，而葡萄糖的肾糖输出又要求 `organs/human-organs/kidney/glucose-excretion.ts`。因此完整硬 transfer 闭包是 `hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`skin` 七个部位；沿用旧自定义清单、只加载小肠而缺少 `glucose`、`kidneyGlucose` 或 `skin` 时，启动会因 transfer 配对缺失而拒绝继续。旧 `stomach/motility.ts` 不含小肠，仍可独立加载。[`physicalActivity`](../skeletal-muscle/README.md) 只是 [`skin`](../skin/README.md) 的普通轮初读取，不是 transfer 配对依赖，也不在小肠的读写链上。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water-absorption.ts` | `smallIntestine` | `waterVolumeMl`、`absorbedWaterMl`、`carbohydrateG`、`absorbedCarbohydrateG` | 自己的轮初状态 `smallIntestine` | `water-absorption.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 轮末肠腔水量（状态）；`transferIn` 来自 `stomach.waterVolumeMl`，`transferOut` 到 `bodyFluid.waterVolumeMl` |
| `absorbedWaterMl` | `mL` | 本轮水吸收量（每轮通量，不是累计） |
| `carbohydrateG` | `g` | 轮末肠腔可消化葡萄糖当量碳水（状态）；`transferIn` 来自 `stomach.carbohydrateG`，`transferOut` 到 `glucose.glucoseMassG` |
| `absorbedCarbohydrateG` | `g` | 本轮碳水吸收量（每轮通量，不是累计） |

两个池不是肠内容物总量的完整分解，也不区分十二指肠、空肠、回肠。碳水不从体积或能量反推；`duodenum.nutrientExposure` 仍是由胃排空能量滤波的到达速率代理，不等于这里的碳水质量吸收。

时间原点：两个存量字段是轮末状态，初值均为 0；两个吸收字段只表示本轮，原点为该轮开始。

## 3. 方程与参数

设轮初肠水 `W_start`、轮初碳水 `C_start`，`dtMin = io.dt / 60`：

```text
A_water = W_start × (1 − 2^(−dtMin / 20))
A_carb  = C_start × (1 − 2^(−dtMin / 20))
write.waterVolumeMl = W_start
write.carbohydrateG = C_start
write.absorbedWaterMl = A_water
write.absorbedCarbohydrateG = A_carb
transfer smallIntestine → bodyFluid: A_water
transfer smallIntestine → glucose: A_carb
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | ---: | --- | --- | --- |
| `smallIntestine.absorption.halfTimeMin` | 20 | `min` | `design` | `SRC-PERONNET-2012`（只作水吸收时间尺度背景） |
| `smallIntestine.carbohydrateAbsorption.halfTimeMin` | 20 | `min` | `design` | 无直接来源；未来由人体肠腔碳水消失或餐后葡萄糖观测替换 |

两个 20 min 是独立参数，恰好取相同默认值，不表示水和碳水在人体内有相同吸收机制。碳水半时不能借 Péronnet 的水研究或 Dalla Man 2007 的 `k_abs` 冒充实测值。

只吸收轮初池：胃同轮转入的水和碳水在 Gateway 的 transfer 阶段才加入肠池，下一轮才参与吸收。旧存档缺少碳水字段时按 0，不猜历史摄入。

## 4. 读写边界

- 本脚本是 `smallIntestine` 的唯一写者，只读自己的轮初状态。
- 先 `write` 转出前基准，再请求 `transfer`；同轮新流入不能用于本轮吸收。
- 不读胃的总体积、总能量或排空通量来计算吸收；胃到小肠的质量只经声明的 transfer 配对进入。
- 不写 `bodyFluid`、`glucose`、`bladder` 或其他部位。

## 5. 证据入口

- 水证据笔记：[`references/notes/peronnet-2012.md`](references/notes/peronnet-2012.md)
- 葡萄糖隔室与分布体积：[`../../human-compartments/glucose/README.md`](../../human-compartments/glucose/README.md)
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.2；[`docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md`](../../../docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)

**证据边界：** Péronnet 2012 是 36 名健康年轻男性一次 300 mL D₂O 的口服标记水研究，只支撑水吸收的探索时间尺度；75–120 min 是表观完全吸收时间，不是小肠半时。碳水一阶吸收和 20 min 都是 `design`，没有独立验证。

## 6. 当前限制

- 不区分肠段、转运体、刷状缘酶、消化速度、渗透压、肠腔 pH、血流或神经调节。
- 可消化碳水统一按葡萄糖当量处理；不区分单糖、双糖、淀粉、糖醇和纤维，不建脂肪或蛋白吸收。
- 两个吸收字段是模型通量读数，不是门静脉实测通量、血浆容量变化或吸收分数。
- 没有个体化吸收半时，也没有独立生理数据验证。
