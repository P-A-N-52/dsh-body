# 心脏（heart）：心率、搏出量与心输出代理

**功能标签：** 循环（心泵薄切片）。

`heart/` 目前只有一个部位 `heart`，脚本为 [`heart.ts`](heart.ts)，没有动作、通知或 `transfer`，也不写其他部位。它把轮初活动强度、`autonomic.sympatheticMm` 交感张力、`sleep` 睡眠副交感下调与 `blood.bloodVolumeMl` 前负荷因子 `preloadFactor` 合成驱动，写出心率、搏出量（钳位 `[30, 140]` mL）与心输出（已不再借用 `adrenal.cortisolRelative` 充当交感代理）。唯一消费者是 `blood`：下一轮读取 `heart.cardiacOutputMlMin`，计算氧输送、循环能力上限与血压代理。

实现状态：脚本、参数 [`heart.parameters.json`](heart.parameters.json) 与模块测试 [`test/organs.heart.test.mjs`](../../../test/organs.heart.test.mjs) 已落地；当前根清单为 40 部位、36 份唯一参数文件，女性清单 43 部位、39 份，男性清单 42 部位、38 份。硬闭包为根与男性 15 部位、女性 17 部位，本切片不新增 `transfer`。真实 Gateway 集成测试见 [`test/organs.circulation-gateway.test.mjs`](../../../test/organs.circulation-gateway.test.mjs)。参数均标 `design`（睡眠分期底盘借 `SRC-SOMERS-1993` 方向），未做实测心率/搏出量/心输出或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`heart.ts`](heart.ts) | `heart` | `heartRatePerMin`、`strokeVolumeMl`、`cardiacOutputMlMin` | 轮初 `physicalActivity`、`autonomic.sympatheticMm`、`sleep` 分期、`blood.bloodVolumeMl`、`interoception`/`bladder` 危机标记与 `io.actions`；同目录参数 | [`heart.parameters.json`](heart.parameters.json) |

- `actionTypes = []`；仅观察同轮睡眠切换与危机惊醒动作以便即时响应，不写其他部位或调用 `transfer`/`notify`。
- 睡眠期仅在轮初处于睡眠（`sleep.sleeping === true`）且发生危机或显式 `wake_up { startle: true }` 时当轮立即触发惊醒下限（`85 mm` 交感等价驱动），避免清醒时误触发。

## 2. 字段与单位

三个字段都是 `absolute`，初值为静息 `70 / 70 / 4900`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `heartRatePerMin` | `1/min` | 心率代理；不是实测心率、心电或心率变异性 |
| `strokeVolumeMl` | `mL` | 每搏量代理；不是超声、热稀释或运动血流动力学测量 |
| `cardiacOutputMlMin` | `mL/min` | 心输出代理 = 心率 × 每搏量；不是实测心输出、心指数或 Fick 法结果 |

输出只含三个有限数字段，JSON-safe。合法 0 心率或 0 心输出在本模型中不会由默认参数产生，但字段本身没有额外状态语义。

## 3. 方程与参数

设轮初活动强度 `I`（仅 `R > 0`）、有效交感张力 `S_eff`（睡眠惊醒同轮保底 `startleFloorSympatheticMm = 85`）、睡眠分期底盘 `sleepBase`（清醒 `1`、浅睡 `0.86`、深睡 `0.78`、REM `0.94`）、血容量 `V`：

```text
extraDrive = max(activityGain × I, sympatheticDriveGain × S_eff)
drive = sleepBase + extraDrive
minHr = effectiveSleep ? min(restingHeartRatePerMin, minSleepHeartRatePerMin) : restingHeartRatePerMin
heartRatePerMin = clamp(restingHeartRatePerMin × drive, minHr, maxHeartRatePerMin)
preloadFactor = blood 存在 ? clamp(V / referenceBloodVolumeMl, 0.5, 1.15) : 1
strokeVolumeMl = clamp(restingStrokeVolumeMl × (1 + strokeVolumeGain × (drive − 1)) × preloadFactor,
                       30, 140)（随体重缩放）
cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl
```

- 同目录参数（`owner: heart`）已完整外置到 [`heart.parameters.json`](heart.parameters.json)：含基础心率/搏出量/上限、`activityGain`、`sympatheticDriveGain = 0.012`、`startleFloorSympatheticMm = 85`、三项分期底盘（`lightSleepDriveBase = 0.86`、`deepSleepDriveBase = 0.78`、`remSleepDriveBase = 0.94`，方向引自 `SRC-SOMERS-1993`）、`minSleepHeartRatePerMin = 42`、`strokeVolumeGain = 0.2`，以及历史兼容保留项 `catecholamineGain`。

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
- 本部位自身不直接写 `bloodOxygen`、`kidney` 或 `hypothalamusAdh`，也不直接发送通知；但 `interoception.palpitationMm` 现已软读 `heartRatePerMin`（非中高强运动且心率 > 115 /min 时计入，协同收缩压），接入纯定性 `body_state` 与 `brainNotify`（高强运动下只按低血压计入）。
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
