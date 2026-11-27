# 皮肤（skin）：出汗请求与实际汗液

**功能标签：** 皮肤（出汗请求与汗液通量薄切片）。

`skin` 位于 `organs/human-organs/skin/sweat.ts`，只持有两个 mL 字段：按轮初活动、`climate.airTemperatureC` 和核心温度算出下一轮出汗请求，以及记录本轮由 `bodyFluid` 实际转入的汗液。它不持有体液水、不调用 `transfer`，也不模拟皮肤分区、皮肤温度、湿润度、蒸发残余或汗液电解质。汗液只以 mL 表示，不换算成 METs、热量、心率或代谢率。

实现状态：脚本与参数文件在 `organs/human-organs/skin/`，模块定向测试见 [`test/organs.skin.test.mjs`](../../../test/organs.skin.test.mjs)。根清单与 `bodyFluid` 三出口已接入；当前根清单为 45 个部位、40 份唯一参数文件，女性清单 48 个部位、43 份，男性清单 47 个部位、42 份。端到端水账测试见 [`test/organs.sweat-gateway.test.mjs`](../../../test/organs.sweat-gateway.test.mjs)，体温—出汗集成测试见 [`test/organs.thermoregulation-gateway.test.mjs`](../../../test/organs.thermoregulation-gateway.test.mjs)。完整 `npm test` 结果以当前 HEAD 为准。尚未做真实 DSH 会话、独立人体出汗数据或临床验证。

**清单依赖（transfer 配对校验）。** `sweatVolumeMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`；`bodyFluid.waterVolumeMl` 同时声明 `transferOut: ["bladder.volumeMl", "lungs.respiratoryWaterLossMl", "skin.sweatVolumeMl"]`。完整硬 transfer 闭包为根与男性清单 15 个部位（`stomach/hydration.ts`、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGlucose`、`kidneyGluconeogenesis`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs`），女性清单另加 `uterus` 与 `mammaryGlands` 共 17 个部位。缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；不能用一个未加载的槽位或“先欠着”的请求绕过。`physicalActivity` 只是 `skin`、`lungs`、`muscleGlucose` 等的普通轮初读取，不是 transfer 配对依赖；根清单仍包含它，以提供 `exercise` 能力。

当前三份清单中 `kidney`、`hypothalamusAdh`、`hypothalamusThirst`、`interoception`、`thermoregulation` 都是软读取，缺省时各脚本按自己的默认值处理。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `sweat.ts` | `skin` | `sweatRequestMl`、`sweatVolumeMl` | 轮初活动、温湿输入中的 `climate.airTemperatureC`（缺省 25°C）、核心温度/基线与本次运行已采用的发热增量；`io.dt` | `sweat.parameters.json` |

- `actionTypes = []`；无动作、无通知、无直接 `transfer`。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是工程默认值，不做运行中热切换。
- `bodyFluid` 读请求、支付实汗；`thermoregulation` 下一轮只用已支付的汗液，按当轮轮初湿度和衣层限定蒸发。`skin` 不读写体液量；未蒸发的那部分水不补回、不追加冷却、不留待下一轮。

## 2. 字段与单位

两个字段都是 `absolute`，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `sweatRequestMl` | `mL` | 按轮初活动和环境参数计算的**下一轮**出汗请求量；不是已出汗量、累计汗量或出汗率，也不直接进入水账 |
| `sweatVolumeMl` | `mL` | 本轮实际接收的汗液通量；每轮写出的完整下一状态先把它置 0，只有 transfer 才加入；不是请求量、皮肤含水量或皮肤湿度 |

时间原点：`sweatRequestMl` 在本轮轮末写出，表示下一轮请求；`bodyFluid` 下一轮才读取它。`sweatVolumeMl` 表示本轮 transfer 结算后的实际通量，下一轮会被重新归 0。`sweatVolumeMl` 是离开体液、经皮肤到外部环境的通量，不是留在皮肤里的水量。请求与实际可以不同：体液不足时实际会被 `bodyFluid` 钳到可用水量，但请求字段仍保留原计算值。

## 3. 方程、纯函数与参数

设轮初活动剩余分钟 `R`、相对强度 `I`、环境温度 `T`、核心温度 `C` 与设定点 `setpointC`（`thermoregulation` 未加载时均按 `37 °C`）、`dtMin = io.dt / 60`：

```text
temperatureFactor  = max(0, 1 + 0.04 × (T − 25))
exercising         = R > 0 && I > 0
exerciseRate       = exercising ? referenceRateMlPerMin × I × temperatureFactor : 0
deadbandC          = exercising ? 0 : (setpointC < 37 ? nocturnalDeadbandOffsetC : interthresholdOffsetC)
thermalThresholdC  = (exercising ? max(37, setpointC) : setpointC + deadbandC) + feverSetpointOffsetC
thermalRate        = heatGain × max(0, C − thermalThresholdC)
rate               = min(maxRateMlPerMin, max(0, exerciseRate + thermalRate))
sweatRequestMl     = rate × dtMin
write.sweatVolumeMl = 0
```

核心温度采用**运动与静息（含阈间死区）区分的热致出汗**：非运动静息与运动停止后的压力反射卸荷期（参考 `SRC-KENNY-2008` 与 `SRC-WENGER-1976` / 夜间阈间带展宽机制），热汗阈值相对动态 `setpointC` 增加 `interthresholdOffsetC = 0.25 °C`（昼夜低谷 `setpointC < 37 °C` 时进一步展宽为 `nocturnalDeadbandOffsetC = 0.45 °C`），消除轻度余温或清晨零汗液噪声引起的持续渗汗死循环；运动期间则保留 `max(37, setpointC)` 及时散热并按 `scaleByBodyWeight` 缩放速率与上限。`thermoregulation` 已加载但 `coreTemperatureC` 缺失或非有限时抛错，本轮不写状态。

`R = 0` 且未越过 `thermalThresholdC`（或未加载 `thermoregulation`）时请求为 0；`I = 0` 的合法活动且未越阈时请求也为 0。温度因子在 0 处截断；上限只作用于总速率（默认 75 kg 为 15 mL/min，随体重缩放），请求量仍按 `dtMin` 缩放。

同目录参数（共 6 项 `design`；参考速率、上限和热汗增益按体重缩放）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与说明 |
| --- | ---: | --- | --- | --- |
| `skin.sweat.referenceRateMlPerMin` | 0.6 | `mL/min` | `design` | `source: null`；75 kg 基准、25°C、`intensity=1` 的工程参考出汗率（按体重缩放） |
| `skin.sweat.ambientGainPerC` | 0.04 | `1/°C` | `design` | `source: null`；环境温度每偏离 25°C 1°C 的工程线性斜率 |
| `skin.sweat.maxRateMlPerMin` | 15 | `mL/min` | `design` | `source: null`；75 kg 基准工程速率上限（按体重缩放） |
| `skin.heatGain` | 5 | `mL/(min·°C)` | `design` | `source: null`；越过热汗阈值后每升高 1°C 叠加的热致出汗率增益（按体重缩放） |
| `skin.interthresholdOffsetC` | 0.25 | `°C` | `design` | `SRC-WENGER-1976`（工程占位，参考日间阈间带 ~0.2 °C 与停运后非热抑汗）：非运动静息态相对动态设定点的热汗死区偏置 |
| `skin.nocturnalDeadbandOffsetC` | 0.45 | `°C` | `design` | `SRC-WENGER-1976`（工程占位，参考夜间 03:00–05:00 阈间带加宽）：`setpointC < 37 °C` 时静息死区展宽 |

参数全部标为 `design`，没有独立人体验证；`range` 只是工程调参范围。25 °C 仍是出汗温度因子的参考温度，原 `skin.sweat.ambientTemperatureC` 仅供旧档缺气温时迁移，不再是运行参数。

纯函数 `sweatRequestMl` 只按上式计算请求，不读写状态。心跳从轮初快照传入气温、核心温和基础设定点；先按**基础**设定点选档再加轮初 `feverSetpointOffsetC`（仅本次运行已采用的发布，缺省 0）。空气湿度与衣层不直接改出汗曲线，详见[实汗与蒸发分账](../brain/README.md#thermoregulation)。

## 4. 默认时序：第 1 轮活动、第 2 轮请求、第 3 轮实际

以 60 s 一轮、默认 25°C、`intensity=1`、`durationMin=30`、未加载 `thermoregulation`（`heatFactor = 1`）为例，一次 `exercise` 在第 1 轮入队并提交：

| 轮次 | 轮初活动（皮肤所见） | `sweatRequestMl` | `sweatVolumeMl` | `bodyFluid` 动作 |
| ---: | --- | ---: | ---: | --- |
| 1 | 无活动（0） | 0 | 0 | 读到旧请求 0，不转汗液 |
| 2 | 30 min / 1 | 0.6 | 0 | 仍读旧请求 0，不转汗液 |
| 3 | 29 min / 1 | 0.6 | 0.6 | 读第 2 轮请求 0.6，转 0.6 mL |
| … | … | … | … | … |
| 32 | 0 / 0 | 0 | 0.6 | 读第 31 轮请求 0.6，完成最后一次转移 |
| 33 | 0 / 0 | 0 | 0 | 读第 32 轮请求 0，停止 |

- 第 1 轮活动状态更新，但皮肤读的是轮初旧活动，所以请求仍为 0；这是“活动先提交、皮肤下一轮读取”。
- 第 2 轮皮肤写出 0.6 mL 请求，`bodyFluid` 仍读上一轮请求 0，因此没有实际汗液；这是“请求先写出、体液下一轮结算”。
- 第 3 轮 `bodyFluid` 才按请求转水，`skin` 本轮写出的完整状态先把实际量置 0，transfer 后得到 0.6 mL；这是“实际再晚一轮”。
- 30 个活动分钟对应第 2–31 轮共 30 次 0.6 mL 请求，第 3–32 轮共 30 次实际转移，累计 18 mL；不是 30.6 mL，也不在第 1 轮预扣。
- 活动结束后，皮肤下一轮请求归 0，体液再下一轮停止转移；第 32 轮的实际汗液来自第 31 轮请求，不是活动结束后新产生的请求。

以上是模型内的轮次示例，不是人体出汗时程或实测汗量。

## 5. 体液三出口与水账

`bodyFluid` 是唯一从体液水转出尿、肺失水与汗的部位。设轮初体液水 `W_start`、肾脏请求 `R_kidney`、肺请求 `R_lung`、皮肤请求 `R_sweat`：

```text
U_kidney = clamp(R_kidney, 0, W_start)
U_lung = clamp(R_lung, 0, max(0, W_start − U_kidney))
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney − U_lung))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → lungs: U_lung
transfer bodyFluid → skin: U_sweat
```

- 肾脏请求先支付，肺请求其次，汗液只能使用扣除前两路后的剩余轮初水；三路合计不超过 `W_start`，不会因为分别钳位而重复支付。顺序只是 `policy`，不是人体排泄优先级证据。
- 小肠同轮新流入在 write 之后才加入体液，不能支付本轮尿、肺失水或汗；先 write 后 transfer，结算顺序固定。
- `skin.sweatVolumeMl` 只由 transfer 增加；实际汗液不会反过来改写 `sweatRequestMl`，请求仍保持本轮计算值。肺失水同理，只进入 `lungs.respiratoryWaterLossMl`，不改写肺请求。
- 直接调用 `bodyFluid` 模块时，缺失、负数、非有限或非数值的汗液请求按 0 处理；肺请求异常同样按 0 处理。完整清单仍要求 `skin` 与 `lungs` 在场，不能用 0 掩盖缺部位。

水账在既有恒等式上增加结肠残渣水、实际肺失水和汗液项：

```text
胃水 + 队列水 + 小肠水 + 结肠残渣水 + (体液水 − 30000)
+ 膀胱尿 + 累计 voidedMl + 累计 lungs.respiratoryWaterLossMl
+ 累计 skin.sweatVolumeMl
= 累计饮水
```

其中“胃水”是 `stomach.waterVolumeMl`，“队列水”是 `stomach.mealQueue` 中剩余水量之和，“小肠水”是 `smallIntestine.waterVolumeMl`，“结肠残渣水”是 `colon.residueWaterMl`，“膀胱尿”是当前 `bladder.volumeMl`；结肠回收是残渣水池到体液的内部回流，只体现在残渣水项，不另加外部流入。`voidedMl` 已包含主动与非自主排出，只累计一次。`sweatRequestMl` 与肺请求不进入水账，只有实际 `sweatVolumeMl` 和 `respiratoryWaterLossMl` 逐轮累加；静息且未触发热致出汗时两项为 0。测试容差为 `1e-6 mL`。

未加载 `thermoregulation` 时，30 min、`intensity=1` 的同一次活动产生 18 mL 汗液和 9 mL 运动相关呼吸失水，二者分别记账；加载 `thermoregulation` 后核心温度升高，`thermalRate > 0`，汗量会高于 18 mL，具体取决于温度轨迹。18 mL 只是未计热致出汗的时序算例。18 mL 仍是皮肤汗量，不是 27 mL；9 mL 肺失水不属于皮肤字段，也不能合并成皮肤读数。

体液下降后，口渴仍由既有 `bodyFluid → hypothalamusThirst → interoception` 按各自轮初快照逐轮读出；本模块自身不发通知，也不自动饮水。此外，`interoception.sweatDampMm` 现已改为读取轮初 `skin.sweatVolumeMl` 后映射至 Gagge 皮肤湿润度稳态平衡目标并按 5 min 半衰期弛豫（替代旧版 117 倍累积过冲），并区分活跃出汗与停止后的残余退潮文本。

## 6. 旧档、缺失与异常

- **旧档：** 启动时只补 `physicalActivity = { remainingExerciseMin: 0, intensity: 0 }`、`skin = { sweatRequestMl: 0, sweatVolumeMl: 0 }` 与 `lungs = { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 }`，不反推历史活动、历史出汗或历史呼吸失水；既有 `bodyFluid`、`bladder` 等状态不被重置。
- **重启：** 保留活动剩余时间/强度、皮肤已提交状态和肺已提交状态；`sweatRequestMl` 每轮按轮初活动重算，`sweatVolumeMl` 每轮先归 0，不按历史轮数补算。已发生的汗液已在体液中扣除，重启不会重复扣水；肺的实际失水同样每轮归 0，不会重复累计。
- **没有 `physicalActivity`：** `skin` 与 `lungs` 都按“无活动”请求 0；根清单包含该部位，以提供 `exercise` 能力。自定义清单缺少它时不会因 transfer 配对失败，但也不会有活动状态。
- **已加载 `physicalActivity` 但字段异常：** 缺失、非有限、`remainingExerciseMin < 0`、`intensity < 0` 或 `intensity > 1` 时，`skin` 抛错且本轮不 write，不用固定值掩盖；同一异常也会使 `lungs` 失败。合法的 `remainingExerciseMin = 0` 与 `intensity = 0` 是有效状态，不是异常；`R = 0` 的合法活动请求 0。
- **缺 `skin`、`lungs`、`muscleGlucose` 或 `bodyFluid`：** `bodyFluid` 的 `transferOut` 目标缺 `skin` 或 `lungs`，`glucose` 的 `transferOut` 目标缺 `muscleGlucose`，或 `skin` 的 `transferIn` 来源缺 `bodyFluid`，`createFieldRegistry` 都会在启动时报错；完整清单必须包含十五部位闭包。
- **请求不等于结算：** `sweatRequestMl` 只表示意图；只有 `bodyFluid` 成功 transfer 后 `sweatVolumeMl` 才非 0。请求大于轮初可用水时实际被钳低，不产生负水或额外补液。肺请求与肺实际量同理，且汗液优先级低于肺请求。

## 7. 证据与未建模边界

- 六项参数全部标为 `design`（死区偏置以 `SRC-WENGER-1976` 与 `SRC-KENNY-2008` 为机制参考、具体数值为工程占位），没有独立人体验证；参数含义详见 §3。文献笔记见 [`references/notes/gagnon-2011.md`](references/notes/gagnon-2011.md)、[`references/notes/kenny-2008.md`](references/notes/kenny-2008.md)、[`references/notes/cramer-2019.md`](references/notes/cramer-2019.md)、[`references/notes/candas-1979.md`](references/notes/candas-1979.md) 与 [`references/notes/alber-wallerstrom-1985.md`](references/notes/alber-wallerstrom-1985.md)；[`references/notes/gagge-1967.md`](references/notes/gagge-1967.md) 与 [`references/notes/fukazawa-2009.md`](references/notes/fukazawa-2009.md) 供 `interoception.sweatDampMm` 对标。
- `skin.sweatVolumeMl` 只计主动与热致出汗；体温模块已限定可蒸发量，但没有模拟静息不感失水（`SRC-MITCHELL-1972`）、汗滴/衣物残留动态或按实测皮肤湿润度拟合的效率（`SRC-CANDAS-1979`）；不建 METs、热量/kcal、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、皮肤分区、汗液电解质或疾病。
- 不声称真实 DSH 会话验收或临床验证；离线算例不能外推为人体出汗测量或临床结论。
- 设计背景见 [`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §4–§8；活动侧见 [`physicalActivity`](../skeletal-muscle/README.md)；肺侧见 [`lungs`](../lungs/README.md)；共享来源登记簿见 [`source-index.csv`](../references/source-index.csv)（本切片未新增来源行）。
