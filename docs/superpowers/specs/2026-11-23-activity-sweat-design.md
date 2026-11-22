# 活动、皮肤出汗与体液消耗薄切片设计

**状态：** 已实现并完成离线验收（2026-11-23）。用户授权自主推进有明确消费者的后续薄切片；具体动作、参数和边界为本轮设计决策。最终验证与未验收边界见 [`2026-11-23-activity-sweat.md`](../plans/2026-11-23-activity-sweat.md)。

## 1. 目标与取舍

建立：

```text
exercise { intensity, durationMin }
  → physicalActivity 活动剩余时间与强度
  → skin.sweatRequestMl
  → bodyFluid 按轮初请求转出水量
  → skin.sweatVolumeMl
  → waterDeficit / hypothalamusThirst 的后续变化
```

真实消费者是体液水账和既有口渴读出，不是新增展示字段。汗液只以 mL 表示，不把活动强度换算为 METs、热量、心率或代谢率。

- `physicalActivity` 是骨骼肌活动状态，不模拟具体动作、姿势或运动类型。
- `skin` 只计算出汗请求和本轮实际汗液，不模拟皮肤分区、温度、湿润度或蒸发残余。
- 默认无活动不出汗，既有水账轨迹不变。
- 不自动运动、不自动饮水，不建立疲劳、睡眠、体温调节或运动生理完整模型。

## 2. 方案取舍

### 选择：活动状态 → 皮肤请求 → 体液转移

复用肾产尿“请求—结算”形式，活动动作先改变活动状态，皮肤下一轮写请求，体液再下一轮实际转水。它与现有轮初快照一致，且每毫升都可对账。

### 不采用

- **按动作当轮立即扣水：** 会绕过轮初快照和同轮新请求语义。
- **皮肤直接扣体液：** 体液必须仍由 `body-water/water.ts` 唯一写入和发起 transfer。
- **固定每日出汗 sink：** 与活动无关，容易成为无消费者的名词器官。
- **一次加入肝糖、结肠、心肺、疲劳或体温：** 上游和证据边界过大，不属于本切片。

## 3. 动作与活动状态

`body_act` 新增 `exercise`：

| 字段 | 规则 |
| --- | --- |
| `intensity` | 必填，有限数，`0 < intensity <= 1`；1 是模型内最大相对活动强度，不是 MET 或百分比实测 |
| `durationMin` | 必填，有限数且 `> 0` |

非法值使整条动作 400/忽略，不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。动作 ID、会话和重试幂等不变；`capabilities` 增加 `exercise: ['physicalActivity']`。

`physicalActivity` 位于 `organs/human-organs/skeletal-muscle/activity.ts`：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `remainingExerciseMin` | `min` | 轮初活动剩余时间；先按 `io.dt` 递减，再处理本轮新动作 |
| `intensity` | `1` | 当前相对活动强度；无活动时 0 |

初值均为 0。无新动作时 `remainingExerciseMin = max(0, previous − dtMin)`，归零时 intensity 归 0。多个 exercise 同轮只取最后一个有效动作，以新活动的 duration/intensity 替换剩余活动，不累加时长；这是明确的动作策略，不是运动生理规律。模块自身同样校验字段，非法动作不改变活动状态。

## 4. 皮肤请求与实际汗液

`skin` 位于 `organs/human-organs/skin/sweat.ts`，无动作：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `sweatRequestMl` | `mL` | 按轮初活动和环境参数计算的下一轮请求，不是已出汗量 |
| `sweatVolumeMl` | `mL` | 本轮实际接收的汗液通量；每轮 write 先归 0，再由 transfer 加入 |

参数均 `design`、`source: null`：

| 参数 ID | 默认值 | 单位 | 替换点 |
| --- | ---: | --- | --- |
| `skin.sweat.ambientTemperatureC` | 25 | `°C` | 未来由环境状态替换 |
| `skin.sweat.referenceRateMlPerMin` | 0.6 | `mL/min` | 25°C、intensity=1 的工程参考；未来由活动/体温模型替换 |
| `skin.sweat.ambientGainPerC` | 0.04 | `1/°C` | 工程温度斜率；未来由环境—出汗证据替换 |
| `skin.sweat.maxRateMlPerMin` | 2 | `mL/min` | 工程上限，不是人体最大出汗率 |

设轮初活动强度 `I`、剩余分钟 `R`、环境温度 `T`。计算可拆为纯函数 `sweatRequestMl({ remainingExerciseMin: R, intensity: I, dtMin, ambientTemperatureC: T })`，由 `heartbeat` 传入默认 25°C 参数；该函数不写状态，便于独立覆盖温度与上限：

```text
temperatureFactor = max(0, 1 + 0.04 × (T − 25))
rate = R > 0 ? min(2, 0.6 × I × temperatureFactor) : 0
sweatRequestMl = rate × dtMin
write.sweatVolumeMl = 0
```

活动缺失时请求为 0；活动部位存在但字段缺失、非有限、负数或 intensity >1 时抛错，不用固定值掩盖。环境是固定参数，不是实测环境。

## 5. 体液双出口与水账

`bodyFluid.waterVolumeMl` 增加 `transferOut: ['skin.sweatVolumeMl']`，保留膀胱出口。体液读取轮初 `kidney.urineProductionRequestMl` 与 `skin.sweatRequestMl`：

```text
U_kidney = clamp(kidneyRequest, 0, W_start)
U_sweat = clamp(sweatRequest, 0, max(0, W_start − U_kidney))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → skin: U_sweat
```

两路合计不超过轮初体液，不能因分别钳位而重复支付。小肠同轮新流入不能支付两路出口。`skin.sweatVolumeMl` 是外部环境汗液通量，不是留在皮肤里的水量或皮肤湿度。

现有水账增加实际汗液项：

```text
胃水 + 队列水 + 小肠水 + (体液水 − 初始体液水)
+ 膀胱尿 + 累计 voidedMl + 累计 skin.sweatVolumeMl
= 累计饮水
```

无活动时汗液为 0，旧恒等式不变。口渴仍由既有 `waterDeficit → hypothalamusThirst → interoception` 逐轮读出，本切片不新增通知或改变阈值。

## 6. 默认时序与旧档

一次 exercise 在第 1 轮入队并提交：

1. 第 1 轮活动状态更新，皮肤仍读旧活动，请求 0。
2. 第 2 轮皮肤写出汗请求，体液仍读旧请求，无汗液转移。
3. 第 3 轮体液按请求转水，皮肤记录实际汗液。
4. 后续体液亏缺、下丘脑口渴、体感和既有通知依次按各自轮初快照更新。

活动结束时，皮肤下一轮请求归 0，体液再下一轮停止转移。旧档只补活动 0、皮肤请求/实际 0，不反推历史出汗。重启保留活动剩余时间与强度。

根清单由 15 增至 17 部位，参数文件由 18 增至 19 份。完整硬 transfer 闭包在原六部位上增加 `skin`，为 7 个部位；`physicalActivity` 只是普通轮初读取，不构成 transfer 配对依赖。

## 7. 验收

1. **动作与活动：** 合法 exercise 入队和能力声明；非法强度/时长拒绝；活动递减、结束归零、多个动作最后一个有效者生效、重启保留。
2. **皮肤模块：** 无活动 0；强度/环境温度/上限与 dt 正确；请求下一轮、实际每轮先归 0；缺失和异常区分；JSON-safe。
3. **体液双出口：** 肾请求与汗液请求合计不超额；小肠同轮流入不支付；实际汗液只由 transfer 增加；旧水账不变。
4. **真实 Gateway：** 默认 25°C、intensity=1、durationMin=30，在请求—结算生效后累计 18 mL 汗液，结束后停止；水账每轮 ≤`1e-6 mL`，体液下降且口渴按既有轮次上升。
5. **兼容与最终：** 根清单 17 部位、19 份参数，DI/尿意/口渴/碳账不回归；完整 `npm test` 和 `git diff --check`。
6. **边界：** 无真实 DSH、独立出汗数据或临床验证；不把工程出汗率称为人体测量。

## 8. 未建模

不建运动类型、METs/能量消耗、肌糖原、疲劳、心率/血压、血气、核心/皮肤温度、体温调节、汗液电解质、蒸发与皮肤分区、环境热应激或疾病。后续需要这些状态时再分别立项，不把本切片外推为运动或体温模型。
