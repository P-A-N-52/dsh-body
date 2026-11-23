# 血液隔室（blood）：血容量、血压、氧输送与滤过代理

**功能标签：** 循环（血液隔室薄切片，不是解剖器官）。

`blood/` 目前只有一个部位 `blood`，脚本为 [`blood.ts`](blood.ts)，没有动作、通知或 `transfer`，也不写其他部位。它从轮初 `heart.cardiacOutputMlMin` 与 `bloodOxygen.spo2Percent` 写出心输出读数、氧输送读数、循环最大氧输送能力、血压代理与肾滤过代理；`bloodVolumeMl` 从自身上一轮状态原样带出。消费者是 `bloodOxygen`（能力上限）、`kidney`（GFR 缩放尿量）与 `hypothalamusAdh`（血容量驱动）以及 `body_state` / `GET /state` 的七个读数。本切片不建血管分区、微循环、血细胞/血红蛋白、CO2/酸碱、出血/输血动力学或血压分级诊断。

实现状态：脚本、参数 [`blood.parameters.json`](blood.parameters.json) 与模块测试 [`test/organs.blood.test.mjs`](../../../test/organs.blood.test.mjs) 已落地；加入本切片后根清单为 36 部位、35 份参数文件，女性清单 39 部位、38 份，男性清单 38 部位、37 份。本切片不新增 `transfer`，硬闭包不变。真实 Gateway 集成测试见 [`test/organs.circulation-gateway.test.mjs`](../../../test/organs.circulation-gateway.test.mjs)。全部参数是 `design`、`source: null`，未做实测血容量/血压/心输出/氧输送/GFR、独立人体数据、真实 DSH 会话或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`blood.ts`](blood.ts) | `blood` | `bloodVolumeMl`、`cardiacOutputMlMin`、`systolicMmHg`、`diastolicMmHg`、`oxygenDeliveryMlMin`、`maxOxygenDeliveryMlPerMin`、`gfrMlMin` | 自己的轮初 `bloodVolumeMl`；轮初 `heart.cardiacOutputMlMin`；轮初 `bloodOxygen.spo2Percent`；同目录参数与只读的 [`heart.parameters.json`](../../human-organs/heart/heart.parameters.json) | [`blood.parameters.json`](blood.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`，不使用 `io.dt`。
- 只读轮初快照：`heart` 本轮写出的新心输出最早下一轮才进入 `blood`；`bloodOxygen` 本轮写出的新 SpO2 也最早下一轮才进入 `blood`。
- `heart` 未加载时心输出按参考值 5000 mL/min 回退；`bloodOxygen` 未加载时 SpO2 按 97% 回退。已加载但字段缺失、非数值、非有限或为负时抛错，本轮不写状态。
- 自身 `bloodVolumeMl` 缺失或非法时回退到参考血容量 5000 mL；本切片不把体液变化自动搬进血管，血容量只能由存档预置或未来的独立动力学改变。
- `blood` 无论 `heart` 是否加载都会只读加载 `heart.parameters.json` 来计算能力上限；替换 `heart` 脚本时必须保留这四个参数 id。

## 2. 字段与单位

七个字段都是 `absolute`。初值为参考状态：血容量 5000 mL、心输出 5000 mL/min、血压 120/80 mmHg、氧输送 970 mL/min、最大氧输送 3666.6 mL/min、GFR 100 mL/min。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `bloodVolumeMl` | `mL` | 血容量；本切片只带出轮初值，不是血浆容量、示踪稀释实测或失血模型 |
| `cardiacOutputMlMin` | `mL/min` | 轮初 `heart.cardiacOutputMlMin` 的读数；不是本隔室重算的心输出 |
| `systolicMmHg` | `mmHg` | 收缩压代理；由心输出比值幂函数缩放，不是袖带或动脉压测量 |
| `diastolicMmHg` | `mmHg` | 舒张压代理；同上，不是临床低血压/高血压界值 |
| `oxygenDeliveryMlMin` | `mL/min` | 轮初心输出 × 轮初动脉血氧含量的读数，含一轮滞后；不是血气或氧耗实测 |
| `maxOxygenDeliveryMlPerMin` | `mL/min` | 按最大驱动与轮初 SpO2 算出的循环能力上限，供 `bloodOxygen` 判断供氧是否受限 |
| `gfrMlMin` | `mL/min` | 肾滤过代理，供 `kidney` 缩放产尿；不是菊粉/肌酐清除率、eGFR 或临床肾功能分期 |

`maxOxygenDeliveryMlPerMin` 与 `oxygenDeliveryMlMin` 不同：前者用 `heart.maxHeartRatePerMin`、`heart.restingStrokeVolumeMl`、两个增益与轮初 SpO2 算“最大驱动下能送多少氧”，与当前心输出无关；后者是当前心输出对应的实际读数。`bloodOxygen` 只读前者作为供给能力上限，避免活动首轮拿上一轮静息心输出判定假性去饱和。输出只含七个有限数字段，JSON-safe。

## 3. 方程与参数

设轮初心输出 `CO`、SpO2 `S`、血容量 `V`：

```text
arterialContent = S × oxygenContentPerPercentMlPerL
oxygenDeliveryMlMin = CO × arterialContent / 1000
systolicMmHg = clamp(baselineSystolic × (CO / 5000) ^ 0.5, 80, 200)
diastolicMmHg = clamp(baselineDiastolic × (CO / 5000) ^ 0.3, 40, 120)
gfrMlMin = baselineGfr × clamp(V / referenceBloodVolumeMl, 0.5, 1.2)

maxDrive = 1 + heart.activityGain
             + heart.catecholamineGain × (maxCortisolRelative − 1)
maxStrokeVolumeMl = heart.restingStrokeVolumeMl × (1 + 0.2 × (maxDrive − 1))
maxOxygenDeliveryMlPerMin = heart.maxHeartRatePerMin × maxStrokeVolumeMl
                            × arterialContent / 1000
```

- 脚本内 `referenceCardiacOutputMlMin = 5000`、`strokeVolumeGain = 0.2`、`maxCortisolRelative = 3` 与血压/血容量钳位都是 `design` 常量；`maxCortisolRelative = 3` 与 `interoception` 的皮质醇 100% 应激点一致。
- `heart` 静息态自身算出 70 × 70 = 4900，而血压代理参考心输出是 5000，所以装了 `heart` 的静息血压略低于初始 120/80；这是两个 `design` 占位的口径差，不是生理证据。
- 血容量只在 0.5–1.2 倍参考值内线性缩放 GFR；低于 2500 mL 或高于 6000 mL 后 GFR 不再变化。
- `maxOxygenDeliveryMlPerMin` 随轮初 SpO2 缩放。它只用于“是否供氧受限”的能力判断；`bloodOxygen` 用它作为上限后，SpO2 下降会反过来降低下一轮上限。这是当前薄切片的工程近似，不是氧合曲线或负反馈模型。

同目录参数（`owner: blood`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `blood.referenceBloodVolumeMl` | 5000 | `mL` | `design` | `source: null`；参考血容量，用于 GFR 比值与旧档回退；不是体重换算、示踪稀释实测或个体血容量 |
| `blood.baselineSystolicMmHg` | 120 | `mmHg` | `design` | `source: null`；参考心输出下的收缩压代理基线；不是袖带、动脉压或临床高血压界值 |
| `blood.baselineDiastolicMmHg` | 80 | `mmHg` | `design` | `source: null`；参考心输出下的舒张压代理基线；不是袖带、动脉压或临床低血压界值 |
| `blood.baselineGfrMlMin` | 100 | `mL/min` | `design` | `source: null`；参考血容量下的滤过代理基线；不是菊粉/肌酐清除率、eGFR 或临床肾功能分期 |
| `blood.oxygenContentPerPercentMlPerL` | 2 | `mL/L/%` | `design` | `source: null`；每 1% SpO2 对应的动脉血氧含量代理；不建血红蛋白、结合曲线或溶解氧 |

参数文件中的 `range` 只是工程调参范围；五个参数全部 `design`、`source: null`，不能称拟合、实测或 `validated`。

## 4. 消费者与链路

```text
heart.cardiacOutputMlMin ─┐
bloodOxygen.spo2Percent ──┼─► blood
blood.bloodVolumeMl ──────┘    │
                               ├─► bloodOxygen.maxOxygenDeliveryMlPerMin（组织供氧能力上限）
                               ├─► kidney.gfrMlMin（产尿请求 × gfr/100）
                               ├─► hypothalamusAdh.bloodVolumeMl（目标 + volumeGain × (1 − V/5000)）
                               └─► body_state / GET /state 的七个读数
```

- `bloodOxygen` 的组织供氧上限取 `min(肺泡通气能力, blood.maxOxygenDeliveryMlPerMin)`；两者都未加载时按需氧全额供给。
- `kidney` 把原产尿请求乘以 `blood.gfrMlMin / 100`；`blood` 未加载时因子为 1。低血容量经 GFR 降低尿量。
- `hypothalamusAdh` 在水量亏缺目标上追加 `0.5 × (1 − bloodVolumeMl / 5000)`；低血容量抬高 ADH。`blood` 未加载时该项为 0。
- 本隔室没有反向消费者：血容量变化不会自动改变心输出（`heart` 不读血容量），也不会自动触发饮水、排尿或血压调节。

## 5. 旧档、重启与异常

- **旧档缺 `blood`：** 启动时补完整七字段初值，不反推历史血容量、血压、氧输送或 GFR；已有 `heart`、`bloodOxygen`、`kidney` 与 `hypothalamusAdh` 状态不重置。
- **旧档只有部分字段：** 缺失字段由 `initialState` 补；`bloodVolumeMl` 非法时回退参考值，其余字段每轮重算。
- **重启：** 只有 `bloodVolumeMl` 需要接续；其余六个字段下一轮按轮初 `heart` / `bloodOxygen` 与参数重算。重启后第一轮可能先读到旧的心输出或 SpO2 快照，属于正常的轮初读取。
- **缺 `heart` / `bloodOxygen`：** 分别按 5000 mL/min 与 97% 回退；完整根清单同时加载两者，不依赖回退。
- **已加载但异常：** `heart.cardiacOutputMlMin` 或 `bloodOxygen.spo2Percent` 缺失、非数值、非有限或为负时抛错，本轮不写；合法的 0 心输出与 0% SpO2 是有效状态，不是缺失。

## 6. 未建模与未验证

**未建模：**

- 血管分区、动脉/静脉/毛细血管、微循环、局部血流分布与组织灌注。
- 血细胞、血红蛋白浓度、氧合曲线、PaO2/PaCO2、CO2/酸碱、溶解氧与氧债。
- 失血、输血、输液、毛细血管滤过/重吸收与体液—血管搬水；`bloodVolumeMl` 不会随 `bodyFluid` 自动变化。
- 血压调节反射、压力感受器、RAAS、心房利钠肽、交感/副交感与运动性高血压。
- 血压分级诊断、低血压/高血压、休克、心衰、肾病与临床 GFR 分期。
- 年龄、性别、体型、训练状态与个体差异；5000 / 120 / 80 / 100 / 2 都是工程占位。

**未验证：** 五个参数与脚本内常量全部是 `design`、`source: null`，没有登记人体来源；5000、120、80、100、2、0.5/0.3 次幂与钳位范围都不是实测值或拟合值。模块与真实 Gateway 离线测试只核对公式、回退、异常、旧档与 JSON-safe，不等于独立人体数据、临床验证或真实 DSH 会话验收。不能把本隔室的血压、氧输送或 GFR 外推为人体测量、血气结论、肾功能或疾病判断。特别地，`maxOxygenDeliveryMlPerMin` 随 SpO2 缩放的反馈是工程近似，未被生理数据验证。本切片未做 36 部位性能实测。

## 7. 证据入口

- 设计：[`2026-11-24-circulation-design.md`](../../../docs/superpowers/specs/2026-11-24-circulation-design.md)
- 实现计划：[`2026-11-24-circulation.md`](../../../docs/superpowers/plans/2026-11-24-circulation.md)
- 模块测试：[`test/organs.blood.test.mjs`](../../../test/organs.blood.test.mjs)
- 上游：[`heart`](../../human-organs/heart/README.md)、[`bloodOxygen`](../blood-oxygen/README.md)
- 下游：[`bloodOxygen`](../blood-oxygen/README.md)、[`kidney`](../../human-organs/kidney/README.md)、[`brain`](../../human-organs/brain/README.md)
