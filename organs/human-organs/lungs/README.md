# 肺（lungs）：运动相关呼吸失水与自动通气代理

**功能标签：** 呼吸（运动相关失水与自动通气薄切片）。

`lungs` 目录有两个独立部位。`lungs`（`respiratory-water-loss.ts`）持有两个 mL 字段：按轮初 `physicalActivity` 计算下一轮的运动相关呼吸失水请求，以及本轮由 `bodyFluid` 实际转入的通量。`lungsVentilation`（`ventilation.ts`）按轮初 `bloodOxygen.oxygenConsumptionMlMin` 自动调节每分通气量与呼吸频率，并写出肺泡氧供给。两个部位不共享状态、不互相 `transfer`，也不写其他部位；同目录只是解剖归类。`lungs` 仍只覆盖运动相关呼吸失水，不建静息呼吸失水；`lungsVentilation` 是供—需平衡的通气代理，不是血气、呼吸力学或完整通气控制模型。LLM 不控制呼吸，没有通气动作。

**状态口径。** 当前实现（2026-11-23）：两个脚本与参数都在 `organs/human-organs/lungs/`，均已加入根清单；加入血氧切片后根清单为 22 个部位、24 份参数文件（含 3 份不随根清单加载的 DI 变体），女性清单为 24 部位、26 份，硬 transfer 闭包仍为 9 个部位（女性 10 个）。肺失水模块的 8/8 与完整 `npm test` 418/418 是加入血氧切片前的历史结果，不代表当前 HEAD；加入 `lungsVentilation` 后的模块与真实 Gateway 离线测试需在合并后统一重跑。历史验收：活动—出汗切片当时为 17 部位、19 份参数，M3/M19 的真实 DSH 验收不覆盖肺；本切片未做真实 DSH 会话。设计目标：失水速率未来由具备环境条件与活动通气证据的通气/环境模型替换；`lungsVentilation` 目前只有固定 `design` 参数的自动调节，没有静息/环境驱动的呼吸失水、血气、呼吸力学或气促通知。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `respiratory-water-loss.ts` | `lungs` | `respiratoryWaterLossRequestMl`、`respiratoryWaterLossMl` | 轮初 `physicalActivity.remainingExerciseMin` / `intensity`；`io.dt`；同目录参数 | `respiratory-water-loss.parameters.json` |
| `ventilation.ts` | `lungsVentilation` | `tidalVolumeMl`、`respiratoryRatePerMin`、`ventilationMlMin`、`alveolarO2MlMin` | 轮初 `bloodOxygen.oxygenConsumptionMlMin`；同目录参数 | `ventilation.parameters.json` |

- 两个脚本的 `actionTypes = []`；无动作、无通知、无直接 `transfer`，不写其他部位。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是工程默认值，不做运行中热切换。
- `lungs` 的唯一真实消费者是 `bodyFluid`：它下一轮读取请求字段并把水转入 `respiratoryWaterLossMl`。`physicalActivity` 只是普通轮初读取，不是 transfer 配对依赖。
- `lungsVentilation` 的消费者是 `bloodOxygen`：下一轮读取 `alveolarO2MlMin` 作为肺泡氧供给；本部位不读血氧的 SpO2 或缺口。气促读数由 `interoception` 读 `bloodOxygen.oxygenDeficit`，不直接读通气。

## 2. 字段与单位

两个字段都是 `absolute`，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `respiratoryWaterLossRequestMl` | `mL` | 按轮初活动计算的**下一轮**运动相关呼吸失水请求；不是实际失水、累计失水或 mL/min 速率，也不直接进入水账 |
| `respiratoryWaterLossMl` | `mL` | 本轮由 `bodyFluid.waterVolumeMl` 转入的实际通量；每轮写出的完整下一状态先把它置 0，只有 transfer 才加入；不是请求量、累计量或肺内水量 |

`respiratoryWaterLossMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`，表示这是离开体液、经呼吸到外部环境的逐轮通量，不是留在肺里的水或肺水容量。时间原点：`respiratoryWaterLossRequestMl` 在本轮轮末写出，表示下一轮请求；`respiratoryWaterLossMl` 表示本轮 transfer 结算后的实际通量，下一轮轮初会被重新归 0。请求与实际可以不同：体液不足时 `bodyFluid` 会把实际转移钳到可用水量，请求字段仍保留本轮计算值。

### `lungsVentilation` 字段

四个字段都是 `absolute`，初值为静息值 `500 / 12 / 6000 / 900`；900 由 `6000 × 0.21 / 1.4` 得到。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `tidalVolumeMl` | `mL` | 潮气量；本切片固定为 `restingTidalVolumeMl`，不做潮气量调节 |
| `respiratoryRatePerMin` | `1/min` | 呼吸频率读数；由通气量除以固定潮气量得到，再单独钳到 `maxRatePerMin` |
| `ventilationMlMin` | `mL/min` | 每分通气量；按目标通气量钳在静息下限与上限之间 |
| `alveolarO2MlMin` | `mL/min` | 肺泡氧供给代理；`ventilationMlMin × inspiredO2Fraction / deadSpaceFactor`，不是氧耗测量 |

这些是通气与供氧的模型读数，不是 spirometry、肺泡气体方程、血气分压或氧合测量。`alveolarO2MlMin` 与 `bloodOxygen.oxygenSupplyMlMin` 使用同一量纲和同一换算，便于供需相减。

## 3. 方程与参数

设轮初活动剩余分钟 `R`、相对强度 `I`、`dtMin = io.dt / 60`：

```text
respiratoryWaterLossRequestMl = R > 0 ? 0.3 × I × dtMin : 0
write.respiratoryWaterLossMl = 0
```

`R = 0` 或 `physicalActivity` 部位缺失时请求为 0；`I = 0` 的合法活动请求也为 0。公式只使用 `io.dt`，不使用 `io.simulatedSeconds`、现实时间或累计运动时长。本轮剩余时间不足一个 `dt` 时，请求仍按整个 `dtMin` 计算，不另做按比例截断，与现有汗液语义一致。60 s 一轮、`I = 1` 时请求 0.3 mL；30 min 活动对应 30 次请求，共 9 mL。请求没有额外速率上限；`dt` 很大或体液不足时，实际转移由 `bodyFluid` 钳到轮初可用水量。

同目录参数（`owner: lungs`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin` | 0.3 | `mL/min` | `design` | `source: null`；`intensity=1` 时的临时工程速率，不是实测人体呼吸失水率、总呼吸失水或通气量。未来由具备环境条件与活动通气证据的通气/环境模型替换 |

参数文件中的 `range: [0, 2]` 只是工程调参范围，不是人体呼吸失水率范围。该值未被独立数据验证，不能称 `validated`。

### 自动通气方程

设轮初需氧为 `D`（`mL/min`）：

```text
targetVentilation = D × deadSpaceFactor / inspiredO2Fraction
ventilationMlMin = clamp(targetVentilation, restingVentilationMlMin, maxVentilationMlMin)
respiratoryRatePerMin = clamp(ventilationMlMin / restingTidalVolumeMl,
                              restingRatePerMin, maxRatePerMin)
tidalVolumeMl = restingTidalVolumeMl
alveolarO2MlMin = ventilationMlMin × inspiredO2Fraction / deadSpaceFactor
```

- 需氧 `D = 250` 时目标通气约 1667 mL/min，低于静息下限，因此回到 6000 mL/min、频率 12 次/min、肺泡供给 900 mL/min。
- 需氧上升时目标通气与频率上升；`D = 2000` 时通气约 13333 mL/min、频率约 26.7 次/min、供给 2000 mL/min。
- **触顶：** `maxVentilationMlMin = 60000` 后通气与肺泡供给封顶，默认参数下肺泡供给上限为 `60000 × 0.21 / 1.4 = 9000 mL/min`；需氧继续升高时由 `bloodOxygen` 计算缺口，通气本身不会突破上限。
- **频率读数：** `respiratoryRatePerMin` 是通气量除以固定潮气量后再单独钳位的读数。触顶时通气量已是 60000 mL/min，而频率上限 40 次/min 只限制读数，因此 `ventilationMlMin` 与 `tidalVolumeMl × respiratoryRatePerMin` 不再相等；这是固定潮气量近似，不是呼吸力学。
- `bloodOxygen` 未加载时按基础需氧 250 mL/min 回退；已加载但字段缺失、非有限或为负时抛错，本轮不写状态。合法的 `oxygenConsumptionMlMin = 0` 按 0 处理，不产生 `NaN`。

同目录参数（`owner: lungsVentilation`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `lungsVentilation.restingTidalVolumeMl` | 500 | `mL` | `design` | `source: null`；静息潮气量工程默认值，本切片固定不调节，不是人体测量 |
| `lungsVentilation.restingRatePerMin` | 12 | `1/min` | `design` | `source: null`；静息呼吸频率工程默认值，不是人体测量 |
| `lungsVentilation.maxRatePerMin` | 40 | `1/min` | `design` | `source: null`；呼吸频率读数上限，工程假设，不是实测最大呼吸频率 |
| `lungsVentilation.restingVentilationMlMin` | 6000 | `mL/min` | `design` | `source: null`；静息每分通气量下限，工程默认值，不是人体测量 |
| `lungsVentilation.maxVentilationMlMin` | 60000 | `mL/min` | `design` | `source: null`；每分通气量上限，触顶后肺泡氧供给封顶，不是实测最大通气量 |
| `lungsVentilation.inspiredO2Fraction` | 0.21 | `1` | `design` | `source: null`；吸入氧分数，室内空气量级，不是环境测量，也不建模高原或吸氧 |
| `lungsVentilation.deadSpaceFactor` | 1.4 | `1` | `design` | `source: null`；需氧到通气量的死腔与氧提取折算系数，不是解剖死腔或氧提取测量 |

七个参数的 `range` 都是工程调参范围，全部 `design`、`source: null`，没有独立数据验证，不能称 `validated`。

## 4. 读写边界与真实消费者

- 本脚本是 `lungs` 的唯一写者，只读轮初 `physicalActivity` 与 `io.dt`；不读自己的轮初状态，不写活动部位。
- 不调用 `transfer`，不写 `bodyFluid`、`skin`、`bladder` 或任何其他部位；实际通量只由 `bodyFluid` 发起的 transfer 进入。
- 真实消费者是 [`bodyFluid`](../../human-compartments/body-water/README.md)：其水账按肾 → 肺 → 汗的工程顺序分配轮初水，读取上一轮 `respiratoryWaterLossRequestMl`，把实际转移加入 `lungs.respiratoryWaterLossMl`。
- 只有实际通量进入水账；请求字段不扣水、不进入水账。实际失水降低 `bodyFluid.waterVolumeMl`，随后由既有 `waterDeficit → hypothalamusThirst → interoception` 链按各自轮初快照读出，但本切片不新增通知、不改变阈值，也不自动饮水。
- 没有其他器官读取 `lungs` 的两个水量字段，`lungs` 也不产生动作或回执。

### `lungsVentilation` 的读写边界

- 唯一上游是轮初 `bloodOxygen.oxygenConsumptionMlMin`；不读自己的上一轮状态，也不读 `lungs` 的水量字段。
- 唯一消费者是下一轮的 `bloodOxygen`：它读取 `alveolarO2MlMin` 作为供给。`interoception` 不直接读通气，而是读 `bloodOxygen.oxygenDeficit`。
- 不调用 `transfer`、不发通知、不接受动作；呼吸是身体自动调节，LLM 只能通过活动、进食等上游行为间接改变需氧。
- `bloodOxygen` 未加载或为 `null` 时按基础需氧 250 mL/min 回退；已加载但字段缺失、非有限或为负时抛错，本轮不写状态。合法的 `oxygenConsumptionMlMin = 0` 按 0 处理。
- 与 `lungs` 只是同目录的两个部位：`lungs` 管运动相关失水，`lungsVentilation` 管通气与肺泡供氧，互不写字段。

## 5. 请求与实际时序

以 60 s 一轮、默认参数、`intensity=1`、`durationMin=30` 为例，一次 `exercise` 在第 1 轮入队并提交：

| 轮次 | 轮初活动（肺所见） | `respiratoryWaterLossRequestMl` | `respiratoryWaterLossMl` | `bodyFluid` 动作 |
| ---: | --- | ---: | ---: | --- |
| 1 | 无活动（0） | 0 | 0 | 读到旧请求 0，不转水 |
| 2 | 30 min / 1 | 0.3 | 0 | 仍读旧请求 0，不转水 |
| 3 | 29 min / 1 | 0.3 | 0.3 | 读第 2 轮请求 0.3，转 0.3 mL |
| … | … | … | … | … |
| 31 | 1 min / 1 | 0.3 | 0.3 | 读第 30 轮请求 0.3 |
| 32 | 0 / 0 | 0 | 0.3 | 读第 31 轮请求 0.3，完成最后一次转移 |
| 33 | 0 / 0 | 0 | 0 | 读第 32 轮请求 0，停止 |

- 第 1 轮活动状态更新，但肺读的是轮初旧活动，所以请求仍为 0；这是“活动先提交、肺下一轮读取”。
- 第 2 轮肺写出 0.3 mL 请求，`bodyFluid` 仍读上一轮请求 0，因此没有实际失水；这是“请求先写出、体液下一轮结算”。
- 第 3 轮 `bodyFluid` 才按请求转水，肺本轮写出的完整状态先把实际量置 0，transfer 后得到 0.3 mL；这是“实际再晚一轮”。
- 30 个活动分钟对应第 2–31 轮共 30 次 0.3 mL 请求，第 3–32 轮共 30 次实际转移，累计 9 mL；不是 0.3 mL 总量，也不在第 1 轮预扣。
- 同一活动的皮肤汗液为 18 mL，肺失水为 9 mL，两者分别记账；18 mL 仍是皮肤汗量，不能改写成包含肺的 27 mL，也不能把 9 mL 算作汗液。
- 以上是模型内的轮次示例，不是人体呼吸失水时程或实测失水量。

### 自动通气时序

以 60 s 一轮、默认参数、一次 `exercise`（`intensity = 1`、`durationMin = 30`）为例：

| 轮次 | `bloodOxygen` 需氧 / 供给（SpO2） | `lungsVentilation` 轮初需氧 → 通气 / 频率 / 肺泡供给 |
| ---: | --- | --- |
| 1 | 250 / 900（97%） | 250 → 6000 / 12 / 900 |
| 2 | 1250 / 900（约 69.8%） | 250 → 6000 / 12 / 900 |
| 3 | 1250 / 900（约 69.8%） | 1250 → 约 8333 / 16.7 / 1250 |
| 4 | 1250 / 1250（97%） | 1250 → 约 8333 / 16.7 / 1250 |

- 第 1 轮动作在轮末进入 `physicalActivity`；第 2 轮血氧先读到活动，通气仍读第 1 轮的基础需氧。
- 通气在第 3 轮才按新需氧上调，血氧再晚一轮读到新供给；第 2–3 轮的短时缺口是双重一轮滞后，不是人体去饱和时程，也不代表通气触顶。
- 活动结束后需氧先回落，通气再晚一轮回到静息；血氧会短暂读到上一轮的高供给，不产生缺口。
- 只有需氧持续超过通气上限（默认约 9000 mL/min 肺泡供给）时，缺口才持续存在；本表是模型内算例。

## 6. 异常、旧档与重启

- **没有 `physicalActivity`：** 肺按“无活动”请求 0，写出两个 0；根清单包含该部位以提供 `exercise` 能力。
- **已加载 `physicalActivity` 但字段异常：** 部位不是对象、字段缺失、非有限、`remainingExerciseMin < 0`、`intensity < 0` 或 `intensity > 1` 时，肺抛错且本轮不 write；Gateway 整轮原子提交作废，不用固定值掩盖。合法的 `remainingExerciseMin = 0` 与 `intensity = 0` 是有效状态。
- **请求大于可用水：** 肺本身不钳请求；`bodyFluid` 在下一轮把实际转移钳到扣除肾请求后的轮初余量，实际量可以小于请求，不制造负水或额外补液。
- **旧档：** 启动时只给缺失的 `lungs` 部位或字段补 `{ respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 }`，给缺失的 `lungsVentilation` 补静息初值 `500 / 12 / 6000 / 900`，不反推历史呼吸失水或通气；既有 `bodyFluid` 水量不被重置。
- **重启：** 保留活动剩余时间/强度、上一轮请求、上一轮实际量与上一轮通气；下一次 heartbeat 按当前活动重算 `lungs` 请求，并把实际量归 0，`bodyFluid` 再结算存档中的上一轮请求；`lungsVentilation` 按存档中的血氧需氧重算，不累计通气量或供氧。上一轮请求只结算一次，存档中的实际量不会被重复累计。
- **没有 `bloodOxygen`：** `lungsVentilation` 按基础需氧 250 mL/min 回退；这是可选部位回退，完整根清单同时加载血氧池。
- **已加载 `bloodOxygen` 但字段异常：** 字段缺失、非有限或为负时 `lungsVentilation` 抛错且本轮不 write，不用 250 掩盖损坏状态；合法的 `oxygenConsumptionMlMin = 0` 按 0 处理。
- **旧档补键不反推：** `bloodOxygen` 缺失时补 `250 / 250 / 97 / 0`，`lungsVentilation` 缺失时补静息值；两者的第一轮都按当时轮初活动与消化重算，不恢复停机前的历史缺口。

## 7. 硬 transfer 配对与清单闭包

- `lungs.respiratoryWaterLossMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`；`bodyFluid.waterVolumeMl` 声明 `transferOut: ["bladder.volumeMl", "lungs.respiratoryWaterLossMl", "skin.sweatVolumeMl"]`。两个字段都是 `mL` / `absolute`，单位必须一致。
- 缺 `lungs` 时，`bodyFluid` 的 `transferOut` 目标未声明，`createFieldRegistry` 启动失败；缺 `bodyFluid` 时，肺的 `transferIn` 来源未声明，同样启动失败。不能用一个未加载的槽位或“先欠着”的请求绕过。
- 完整硬 transfer 闭包为 9 个部位：`stomach/hydration.ts`（胃）、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`muscleGlucose`、`skin`、`lungs`。`hydration.ts` 向小肠转水，小肠向体液转水并向葡萄糖转碳水，体液向膀胱、肺和皮肤转水，葡萄糖向肾糖与肌肉转糖；缺任一个都会在启动校验时报字段配对错误。
- `lungsVentilation` 不声明 `transferIn` / `transferOut`，不在硬闭包内；它只通过轮初软读 `bloodOxygen` 参与血氧链，缺它时血氧池按供给等于需氧回退。
- `physicalActivity` 只是 `skin`、`lungs`、`muscleGlucose` 与 `bloodOxygen` 的普通轮初读取，不构成 transfer 配对；缺它时这些脚本按无活动处理，但根清单包含它以提供 `exercise` 能力。`kidney`、`hypothalamusAdh`、`hypothalamusThirst`、`interoception` 也只是软读取，不在配对校验内。

## 8. 证据与未建模边界

- `lungs` 的唯一参数 `0.3 mL/min` 与 `lungsVentilation` 的七个参数全部是 `design`、`source: null`，没有人体来源；0.3 不是实测呼吸失水率、总呼吸失水或通气量，500 / 12 / 40 / 6000 / 60000 / 0.21 / 1.4 也不是实测潮气量、呼吸频率、最大通气量或环境测量。参数文件的 `range` 只是工程调参范围。
- `lungs` 只建模**运动相关**呼吸失水：不建静息呼吸失水、不感蒸发、环境温湿度、运动类型、METs、耗氧量、核心体温、体温调节、个体差异或疾病。
- `lungsVentilation` 只建模**自动通气与肺泡供氧代理**：不建血气分压（PaO2 / PaCO2）、血红蛋白、氧合曲线、心输出量、CO2/酸碱、呼吸力学、潮气量调节、高原或病理缺氧、通气动作、气促通知或完整肺模型。`bloodOxygen` 的供需平衡与 `dyspneaMm` 见 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md) 与 [`brain`](../brain/README.md)。
- 不建结肠水回收与粪便失水；这些没有上游或真实消费者，仍暂缓。
- 离线测试只验证公式、时序、异常、旧档/重启、水质量守恒与通气读数；没有真实 DSH 会话、独立人体呼吸失水/通气数据或临床验证，不能把 0.3 mL/min、9 mL、6000 mL/min 或 9000 mL/min 上限外推为人体测量、通气模型或临床结论。
- 设计：[`2026-11-23-respiratory-water-loss-design.md`](../../../docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md) 与 [`2026-11-23-blood-oxygen-design.md`](../../../docs/superpowers/specs/2026-11-23-blood-oxygen-design.md)；体液侧见 [`bodyFluid`](../../human-compartments/body-water/README.md)；活动侧见 [`physicalActivity`](../skeletal-muscle/README.md)；血氧侧见 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md)；共享登记簿 [`source-index.csv`](../references/source-index.csv)（本切片未新增来源行）。
