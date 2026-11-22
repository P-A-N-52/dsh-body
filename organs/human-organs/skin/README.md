# 皮肤（skin）：出汗请求与实际汗液

**功能标签：** 皮肤（出汗请求与汗液通量薄切片）。

`skin` 位于 `organs/human-organs/skin/sweat.ts`，只持有两个 mL 字段：按轮初 `physicalActivity` 和固定环境参数算出下一轮出汗请求，以及记录本轮由 `bodyFluid` 实际转入的汗液。它不持有体液水、不调用 `transfer`，也不模拟皮肤分区、皮肤温度、湿润度、蒸发残余或汗液电解质。汗液只以 mL 表示，不换算成 METs、热量、心率或代谢率。

实现状态：脚本与参数文件在 `organs/human-organs/skin/`，模块定向测试 10/10 PASS（2026-11-23，[`test/organs.skin.test.mjs`](../../../test/organs.skin.test.mjs)）。根清单与 `bodyFluid` 双出口已接入；完整切片为 17 个部位、19 份参数文件。端到端水账测试见 [`test/organs.sweat-gateway.test.mjs`](../../../test/organs.sweat-gateway.test.mjs)。尚未做真实 DSH 会话、独立人体出汗数据或临床验证。

**清单依赖（transfer 配对校验）。** `sweatVolumeMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`；`bodyFluid.waterVolumeMl` 同时声明 `transferOut: ["bladder.volumeMl", "skin.sweatVolumeMl"]`。因此完整硬 transfer 闭包是 `stomach/hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`skin` 共七个部位：`hydration.ts` 向 `smallIntestine` 转水，`smallIntestine` 向 `bodyFluid` 转水并向 `glucose` 转碳水，`bodyFluid` 向 `bladder` 和 `skin` 转水，`glucose` 向 `kidneyGlucose` 转糖。缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；不能用一个未加载的槽位或“先欠着”的请求绕过。`physicalActivity` 只是 `skin` 的普通轮初读取，不是 transfer 配对依赖；本切片根清单仍包含它，以提供 `exercise` 能力。

本切片的完整根清单为 17 个部位、19 份参数文件；本切片新增 `physicalActivity`、`skin` 两个部位和 `sweat.parameters.json` 一份参数。`kidney`、`hypothalamusAdh`、`hypothalamusThirst`、`interoception` 仍是软读取，缺省时各脚本按自己的默认值处理。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `sweat.ts` | `skin` | `sweatRequestMl`、`sweatVolumeMl` | 轮初 `physicalActivity.remainingExerciseMin` / `intensity`；`io.dt`；同目录参数 | `sweat.parameters.json` |

- `actionTypes = []`；无动作、无通知、无直接 `transfer`。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是工程默认值，不做运行中热切换。
- 唯一消费者是 `bodyFluid`；`skin` 不读也不写 `bodyFluid` 的水量，实际汗液只由 `bodyFluid` 发起的 transfer 进入 `sweatVolumeMl`。

## 2. 字段与单位

两个字段都是 `absolute`，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `sweatRequestMl` | `mL` | 按轮初活动和环境参数计算的**下一轮**出汗请求量；不是已出汗量、累计汗量或出汗率，也不直接进入水账 |
| `sweatVolumeMl` | `mL` | 本轮实际接收的汗液通量；每轮写出的完整下一状态先把它置 0，只有 transfer 才加入；不是请求量、皮肤含水量或皮肤湿度 |

时间原点：`sweatRequestMl` 在本轮轮末写出，表示下一轮请求；`bodyFluid` 下一轮才读取它。`sweatVolumeMl` 表示本轮 transfer 结算后的实际通量，下一轮会被重新归 0。`sweatVolumeMl` 是离开体液、经皮肤到外部环境的通量，不是留在皮肤里的水量。请求与实际可以不同：体液不足时实际会被 `bodyFluid` 钳到可用水量，但请求字段仍保留原计算值。

## 3. 方程、纯函数与参数

设轮初活动剩余分钟 `R`、相对强度 `I`、环境温度 `T`、`dtMin = io.dt / 60`：

```text
temperatureFactor = max(0, 1 + 0.04 × (T − 25))
rate = R > 0 ? min(2, 0.6 × I × temperatureFactor) : 0
sweatRequestMl = rate × dtMin
write.sweatVolumeMl = 0
```

`R = 0` 或 `physicalActivity` 部位缺失时请求为 0；`I = 0` 的合法活动请求也为 0。温度因子在 0 处截断；上限只作用于速率（2 mL/min），请求量仍按 `dtMin` 缩放，所以 `dtMin = 2` 且速率已达上限时为 4 mL，而不是 2 mL。25°C、`I = 1`、60 s 轮请求 0.6 mL；35°C 时温度因子为 1.4，请求 0.84 mL；温度升到使速率超过 2 mL/min 后，60 s 请求封顶 2 mL。

同目录参数：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `skin.sweat.ambientTemperatureC` | 25 | `°C` | `design` | `source: null`；默认环境温度，不是实测环境；25°C 同时是温度因子的参考温度。未来由环境状态替换 |
| `skin.sweat.referenceRateMlPerMin` | 0.6 | `mL/min` | `design` | `source: null`；25°C、`intensity=1` 的工程参考出汗率，不是人体出汗测量、METs、热量或最大出汗能力。未来由活动/体温模型替换 |
| `skin.sweat.ambientGainPerC` | 0.04 | `1/°C` | `design` | `source: null`；环境温度每偏离 25°C 1°C 的工程线性斜率，不是体温调节或环境—出汗证据。未来由环境—出汗证据替换 |
| `skin.sweat.maxRateMlPerMin` | 2 | `mL/min` | `design` | `source: null`；工程速率上限，不是人体最大出汗率或任何实测上限。未来由活动/体温模型替换 |

四个参数全部是 `design`、`source: null`；参数文件中的 `range` 只是工程调参范围，不是人体耐受范围或百分位。

模块导出纯函数 `sweatRequestMl({ remainingExerciseMin, intensity, dtMin, ambientTemperatureC })`：它不读状态、不写状态、不调用 `transfer`，只按上式计算请求；参数默认值在模块 import 时只读加载。`heartbeat` 把同目录默认环境温度 25°C 传入该函数，便于独立覆盖温度、强度和上限。纯函数本身不校验活动字段；异常校验在 `heartbeat` 读取 `physicalActivity` 时完成。

## 4. 默认时序：第 1 轮活动、第 2 轮请求、第 3 轮实际

以 60 s 一轮、默认 25°C、`intensity=1`、`durationMin=30` 为例，一次 `exercise` 在第 1 轮入队并提交：

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

## 5. 体液双出口与水账

`bodyFluid` 是唯一从体液水转出尿与汗的部位。设轮初体液水 `W_start`、肾脏请求 `R_kidney`、皮肤请求 `R_sweat`：

```text
U_kidney = clamp(R_kidney, 0, W_start)
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → skin: U_sweat
```

- 肾脏请求先支付，汗液只能使用剩余轮初水；两路合计不超过 `W_start`，不会因为分别钳位而重复支付。
- 小肠同轮新流入在 write 之后才加入体液，不能支付本轮尿或汗；先 write 后 transfer，结算顺序固定。
- `skin.sweatVolumeMl` 只由 transfer 增加；实际汗液不会反过来改写 `sweatRequestMl`，请求仍保持本轮计算值。
- 直接调用 `bodyFluid` 模块时，缺失、负数、非有限或非数值的汗液请求按 0 处理；完整清单仍要求 `skin` 在场，不能用 0 掩盖缺部位。

水账在既有恒等式上增加实际汗液项：

```text
胃水 + 队列水 + 小肠水 + (体液水 − 30000)
+ 膀胱尿 + 累计 voidedMl + 累计 skin.sweatVolumeMl
= 累计饮水
```

其中“胃水”是 `stomach.waterVolumeMl`，“队列水”是 `stomach.mealQueue` 中剩余水量之和，“小肠水”是 `smallIntestine.waterVolumeMl`，“膀胱尿”是当前 `bladder.volumeMl`；`voidedMl` 已包含主动与非自主排出，只累计一次。`sweatRequestMl` 不进入水账，只有实际 `sweatVolumeMl` 逐轮累加；无活动时汗液为 0，既有水账恒等式不变。测试容差为 `1e-6 mL`。

体液下降后，口渴仍由既有 `waterDeficit → hypothalamusThirst → interoception` 按各自轮初快照逐轮读出；本切片不新增通知、不改变阈值，也不自动饮水。

## 6. 旧档、缺失与异常

- **旧档：** 启动时只补 `physicalActivity = { remainingExerciseMin: 0, intensity: 0 }` 与 `skin = { sweatRequestMl: 0, sweatVolumeMl: 0 }`，不反推历史活动或历史出汗；既有 `bodyFluid`、`bladder` 等状态不被重置。
- **重启：** 保留活动剩余时间/强度和皮肤已提交状态；`sweatRequestMl` 每轮按轮初活动重算，`sweatVolumeMl` 每轮先归 0，不按历史轮数补算。已发生的汗液已在体液中扣除，重启不会重复扣水。
- **没有 `physicalActivity`：** `skin` 按“无活动”请求 0；本切片根清单包含该部位，以提供 `exercise` 能力。自定义清单缺少它时不会因 transfer 配对失败，但也不会有活动状态。
- **已加载 `physicalActivity` 但字段异常：** 缺失、非有限、`remainingExerciseMin < 0`、`intensity < 0` 或 `intensity > 1` 时，`skin` 抛错且本轮不 write，不用固定值掩盖。合法的 `remainingExerciseMin = 0` 与 `intensity = 0` 是有效状态，不是异常；`R = 0` 的合法活动请求 0。
- **缺 `skin` 或 `bodyFluid`：** `bodyFluid` 的 `transferOut` 目标缺 `skin`，或 `skin` 的 `transferIn` 来源缺 `bodyFluid`，`createFieldRegistry` 都会在启动时报错；完整清单必须包含七部位闭包。
- **请求不等于结算：** `sweatRequestMl` 只表示意图；只有 `bodyFluid` 成功 transfer 后 `sweatVolumeMl` 才非 0。请求大于轮初可用水时实际被钳低，不产生负水或额外补液。

## 7. 证据与未建模边界

- 四个参数全部没有人体来源，均为 `design`、`source: null`；脚本头注释与设计文档同样标注。`0.6 mL/min` 是 25°C、`intensity=1` 的工程参考，不是实测人体出汗率；`0.04/°C` 是工程温度斜率；`2 mL/min` 是工程上限；25°C 是默认环境参数，不是实测环境。
- 不建 METs、热量/kcal、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、核心/皮肤温度、体温调节、皮肤分区、皮肤湿润度、蒸发残余、汗液电解质、环境热应激、疾病或个体差异。
- 不声称真实 DSH 会话验收、独立人体出汗数据、汗液电解质测量、临床验证或个体预测；模型内的 18 mL 是水账/时序核对，不是实测汗量，也不能外推为运动或体温模型。
- 设计背景见 [`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §4–§8；活动侧见 [`physicalActivity`](../skeletal-muscle/README.md)；共享来源登记簿见 [`source-index.csv`](../references/source-index.csv)（本切片未新增来源行）。
