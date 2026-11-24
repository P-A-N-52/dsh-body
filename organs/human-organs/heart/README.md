# 心脏（heart）：心率、搏出量与心输出代理

**功能标签：** 循环（心泵薄切片）。

`heart/` 目前只有一个部位 `heart`，脚本为 [`heart.ts`](heart.ts)，没有动作、通知或 `transfer`，也不写其他部位。它把轮初活动强度与肾上腺皮质醇相对信号合成驱动，并读取轮初 `blood.bloodVolumeMl` 算前负荷因子 `preloadFactor`，写出心率、搏出量（钳位 `[30, 140]` mL）与心输出。唯一消费者是 `blood`：下一轮读取 `heart.cardiacOutputMlMin`，计算氧输送、循环能力上限与血压代理。本切片只建三个有限数字段和一条瞬时映射，不建心电、瓣膜、心律、后负荷、心肌收缩力或心衰。

实现状态：脚本、参数 [`heart.parameters.json`](heart.parameters.json) 与模块测试 [`test/organs.heart.test.mjs`](../../../test/organs.heart.test.mjs) 已落地；当前根清单为 38 部位、34 份唯一参数文件，女性清单 41 部位、37 份，男性清单 40 部位、36 份。硬闭包为根与男性 15 部位、女性 17 部位，本切片不新增 `transfer`。真实 Gateway 集成测试见 [`test/organs.circulation-gateway.test.mjs`](../../../test/organs.circulation-gateway.test.mjs)。全部参数是 `design`、`source: null`，未做实测心率/搏出量/心输出、独立人体数据、真实 DSH 会话或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`heart.ts`](heart.ts) | `heart` | `heartRatePerMin`、`strokeVolumeMl`、`cardiacOutputMlMin` | 轮初 `physicalActivity.remainingExerciseMin` / `intensity`；轮初 `adrenal.cortisolRelative`；轮初 `blood.bloodVolumeMl`（可选）；同目录参数 | [`heart.parameters.json`](heart.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`，不读自己的轮初状态，也不使用 `io.dt`。
- 只读轮初快照：本轮新入队的活动、本轮新写出的皮质醇或血容量变化最早下一轮才改变心输出；`blood` 再晚一轮读到，形成两轮链路延迟。
- `physicalActivity` 未加载时按无活动（`intensity = 0`）；`adrenal` 未加载时按 `cortisolRelative = 1`；`blood` 未加载时按 `preloadFactor = 1`。已加载但字段缺失、非数值、非有限、为负，或 `intensity > 1` 时抛错，本轮不写状态，由 Gateway 整轮作废。
- 合法的 `remainingExerciseMin = 0`、`intensity = 0`、`cortisolRelative = 0` 与 `bloodVolumeMl = 0` 都是有效输入，不是缺失。

## 2. 字段与单位

三个字段都是 `absolute`，初值为静息 `70 / 70 / 4900`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `heartRatePerMin` | `1/min` | 心率代理；不是实测心率、心电或心率变异性 |
| `strokeVolumeMl` | `mL` | 每搏量代理；不是超声、热稀释或运动血流动力学测量 |
| `cardiacOutputMlMin` | `mL/min` | 心输出代理 = 心率 × 每搏量；不是实测心输出、心指数或 Fick 法结果 |

输出只含三个有限数字段，JSON-safe。合法 0 心率或 0 心输出在本模型中不会由默认参数产生，但字段本身没有额外状态语义。

## 3. 方程与参数

设轮初活动剩余分钟 `R`、强度 `I`、皮质醇相对量 `C`、血容量 `V`（`blood` 存在时）：

```text
drive = 1
      + activityGain × I          （仅 R > 0）
      + catecholamineGain × (C − 1)
heartRatePerMin = clamp(restingHeartRatePerMin × drive,
                        restingHeartRatePerMin, maxHeartRatePerMin)
preloadFactor = blood 存在 ? clamp(V / 5000, 0.5, 1.15) : 1
strokeVolumeMl = clamp(restingStrokeVolumeMl × (1 + 0.2 × (drive − 1)) × preloadFactor,
                       30, 140)
cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl
```

- `I = 1` 时活动项为 `+1.5`；`C = 2` 时皮质醇项为 `+0.5`；两者同时满档且正常血容量（`preloadFactor = 1`）时 `drive = 3.5`，心率钳到 180、搏出量 105 mL、心输出 18900 mL/min。
- `drive < 1` 时心率停在静息下限 70，而搏出量仍按公式低于 70 mL 并受 `[30, 140]` mL 钳位；高血容量（最大 `preloadFactor = 1.15`）或低血容量（最低 `0.5`）同样受 `[30, 140]` mL 安全钳位限制。
- `R = 0` 时即使 `I` 保留旧值，活动项也为 0。
- `0.2` 的搏出量增益、`5000 mL` 参考血容量、`preloadFactor` `[0.5, 1.15]` 钳位与 `[30, 140]` mL 搏出量钳位是脚本内 `design` 常量，不在参数文件中；它们只表示模型内相对变化，不是 Frank–Starling 实测曲线或每搏量—交感张力斜率。

同目录参数（`owner: heart`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `heart.restingHeartRatePerMin` | 70 | `1/min` | `design` | `source: null`；静息心率工程占位，也是 drive 下限。不是实测心率、个体基线或运动生理测量 |
| `heart.maxHeartRatePerMin` | 180 | `1/min` | `design` | `source: null`；模型内钳位上限，不是实测最大心率、年龄预测最大心率或运动试验结果 |
| `heart.restingStrokeVolumeMl` | 70 | `mL` | `design` | `source: null`；静息每搏量工程占位，初始心输出 4900 mL/min；不区分性别、体型或训练状态 |
| `heart.activityGain` | 1.5 | `1` | `design` | `source: null`；`intensity = 1` 时对 drive 的增益；不是 MET、%VO₂max 或心率储备剂量反应 |
| `heart.catecholamineGain` | 0.5 | `1` | `design` | `source: null`；皮质醇相对基线偏离对 drive 的增益；只借用皮质醇作交感/应激代理，不是肾上腺素浓度或受体剂量反应 |

参数文件中的 `range` 只是工程调参范围；五个参数全部 `design`、`source: null`，不能称拟合、实测或 `validated`。

## 4. 消费者与链路

```text
physicalActivity.remainingExerciseMin / intensity ─┐
adrenal.cortisolRelative ──────────────────────────┼─► heart
blood.bloodVolumeMl（前负荷因子） ─────────────────┘    │
                                                       ▼
heart.cardiacOutputMlMin ────────────────────────────► blood.cardiacOutputMlMin
                                                         │
                                                         ├─► blood.oxygenDeliveryMlMin（读数）
                                                         ├─► blood.maxOxygenDeliveryMlPerMin（能力上限）
                                                         ├─► blood.systolicMmHg / diastolicMmHg
                                                         └─► bloodOxygen / kidney / hypothalamusAdh
```

- `blood` 读轮初心输出，写血压代理、氧输送读数与循环能力上限；`bloodOxygen` 再把能力上限当作组织供氧的第三道上限之一。
- 本部位不直接写 `bloodOxygen`、`kidney` 或 `hypothalamusAdh`，也不产生气促、血压或运动通知。
- 本部位没有负反馈：氧输送不足不会自动降低活动或心率；活动停止后心输出下一轮直接回到静息映射，不建恢复动力学。

## 5. 旧档、重启与异常

- **旧档缺 `heart`：** 启动时补 `{ heartRatePerMin: 70, strokeVolumeMl: 70, cardiacOutputMlMin: 4900 }`，不反推历史活动或心率；已有活动、皮质醇与 `blood` 状态不重置。
- **重启：** 本部位不读自己的上一轮状态，下一次 heartbeat 只按当时的轮初活动、皮质醇与血容量重算；没有累计量、相位或恢复时间需要接续。`blood` 的保存值保留，重启第一轮可能先读到旧心输出快照，属于正常的轮初读取。
- **缺 `physicalActivity` / `adrenal` / `blood`：** 分别按无活动 / 皮质醇 1 / `preloadFactor = 1` 回退；完整根清单同时加载三者，不依赖回退。
- **已加载但异常：** `physicalActivity.remainingExerciseMin` 缺失、非有限或为负，`intensity` 缺失、非有限、为负或大于 1，`cortisolRelative` 或 `blood.bloodVolumeMl` 缺失、非有限或为负时抛错，本轮不写；不用默认值掩盖损坏状态。

## 6. 未建模与未验证

**未建模：**

- 心电、起搏点、传导系统、瓣膜、心律与心律失常。
- 后负荷、Frank–Starling 精细机制、收缩力、心室重构；本切片仅通过 `blood.bloodVolumeMl` 提供简单的 `preloadFactor` 代理。
- 血压反射、压力感受器、交感/副交感平衡、RAAS 与心房利钠肽；本部位只用皮质醇作交感代理。
- 运动性高血压、心衰、冠心病、瓣膜病等病理状态与药物。
- 体温、环境温度、贫血、血红蛋白与血气对心率的直接影响；这些量由其他薄切片或参数代理。
- 实测心率、每搏量、心输出、MET、%VO₂max、心率储备、年龄/性别/训练状态与个体差异。

**未验证：** 五个参数、0.2 搏出量增益与 `preloadFactor` / `[30, 140]` mL 钳位全部是 `design`、`source: null`，没有登记人体来源；70、180、70、1.5、0.5 都不是实测值或拟合值。模块与真实 Gateway 离线测试只核对公式、钳位、回退、异常、旧档与 JSON-safe，不等于独立人体数据、临床验证或真实 DSH 会话验收。不能把本部位的心率、搏出量或心输出外推为人体测量、运动处方或疾病判断。本切片未做 38 / 41 部位性能实测。

## 7. 证据入口

- 设计：[`2026-11-24-circulation-design.md`](../../../docs/superpowers/specs/2026-11-24-circulation-design.md)
- 实现计划：[`2026-11-24-circulation.md`](../../../docs/superpowers/plans/2026-11-24-circulation.md)
- 模块测试：[`test/organs.heart.test.mjs`](../../../test/organs.heart.test.mjs)
- 下游：[`blood`](../../human-compartments/blood/README.md)、[`bloodOxygen`](../../human-compartments/blood-oxygen/README.md)
- 上游：[`physicalActivity`](../skeletal-muscle/README.md)、[`adrenal`](../adrenal/README.md)
