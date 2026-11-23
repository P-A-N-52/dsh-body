# 脑：体感与上报（brain）

`brain/` 目前有七个脚本：`interoception.ts` 把胃壁机械感受、胃饥饿素、十二指肠营养暴露、下丘脑口渴驱动、膀胱充盈、子宫痉挛、乳腺胀奶、食管呛咳与结肠粪便量汇成 0–100 mm 的饥饿、饱满、口渴、尿意、不适、便意等代理，再由七路（含子宫痉挛、乳腺胀奶与食管呛咳）超出舒适区的强度取最大值得到不适代理，并软读性反应周期的 `sexualResponse.arousalMm` 写 `sexualArousalMm`，软读血氧池的 `bloodOxygen.oxygenDeficit` 写 `dyspneaMm`，软读肾上腺的 `adrenal.cortisolRelative` 与松果体的 `pineal.melatoninRelative` 写 `stressMm` 与 `sleepinessMm`，软读唾液腺的 `salivaryGlands.mouthMoistureMm` 写 `dryMouthMm`，软读核心温度写 `heatMm` / `coldMm`；这些独立软读都不进入不适，也不触发通知。`notify.ts` 读取饥饿、饱满、口渴与尿意四类体感，在明显/强档位按会话决定是否提醒；`hypothalamus-adh.ts` 把体液亏缺与血容量亏缺映射成相对 ADH 水平；`hypothalamus-thirst.ts` 把同一水量亏缺映射成口渴驱动；`hypothalamus-endocrine.ts` 与 `pituitary.ts` 构成 HPT/HPA 轴的中枢环节，分别产出 TRH/CRH 与 TSH/ACTH 相对信号，`pituitary` 另产出 `prolactinRelative` 驱动乳腺泌乳；`thermoregulation.ts` 由产热与散热积分核心温度，并驱动出汗、喘息与冷热读数。七个脚本只写自己的部位，不写其他器官。

实现状态：脚本与参数已在 `organs/human-organs/brain/`，七个脚本都已加入根清单；`body_act` / `body_state` 与通知投递在 `index.js` / `tools.js` / `notifications.js`。`interoception` 是 `producer only` 的体感读出，会读取下丘脑口渴、膀胱体积、可选的子宫痉挛、可选的乳腺胀奶、可选的食管呛咳、可选的结肠粪便量、性反应周期的 `arousalMm`、血氧池的 `oxygenDeficit`、肾上腺的 `cortisolRelative`、松果体的 `melatoninRelative` 与唾液腺的 `mouthMoistureMm`；子宫痉挛、乳腺胀奶与食管呛咳只进 `discomfort` 的第五、第六、第七路，便意与其余独立软读只进 `body_state` / `GET /state`，都不进入 `brainNotify`。加入循环、体温与食管/结肠切片后根清单为 38 部位、37 份参数文件，女性清单 41 部位、40 份，男性清单 40 部位、39 份；`uterus` 与 `mammaryGlands` 只随女性清单 `body-modules.female.json` 加载（独立存档）；无子宫时第五路按 0，无乳腺时第六路按 0，无食管时第七路按 0，无结肠时 `bowelUrgencyMm` 按 0。M19 真实 DSH 会话已读出 `thirst`、`urinaryUrgency` 与 `discomfort` 的方向和 `interoception` 的一轮偏移（见 §2），但不覆盖子宫第五路、乳腺第六路、性唤醒、气促、压力、困倦或口干读数；M19 只验证体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递或排尿闭环。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `interoception.ts` | `interoception` | `hunger`、`fullness`、`thirst`、`urinaryUrgency`、`discomfort`、`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`libidoMm`、`bowelUrgencyMm`、`heatMm`、`coldMm`、`hypocalcemiaMm`、`hypercalcemiaMm` | `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration`、`duodenum.nutrientExposure`、`hypothalamusThirst.thirst`、`bladder.volumeMl`、`uterus.crampMm`（可选，第五路）、`mammaryGlands.fullnessMm`（可选，第六路）、`esophagus.chokingMm`（可选，第七路）、`colon.stoolG`（可选软读）、`sexualResponse.arousalMm`（可选软读）、`bloodOxygen.oxygenDeficit`（可选软读）、`adrenal.cortisolRelative`（可选软读）、`pineal.melatoninRelative`（可选软读）、`salivaryGlands.mouthMoistureMm`（可选软读）、`testes.testosteroneRelative`（可选软读）、`thermoregulation.coreTemperatureC`（可选软读）、`bloodCalcium.mgDl`（可选软读） | `interoception.parameters.json` |
| `notify.ts` | `brainNotify` | `lastSessionId`、`sessions`（内部状态，含每会话 `levels`） | `interoception.hunger/fullness/thirst/urinaryUrgency`、轮初 `bladder.voidedMl`；本轮动作里的 `sessionId` 与 `urinate` | `notify.parameters.json` |
| `hypothalamus-adh.ts` | `hypothalamusAdh` | `relativeConcentration` | `bodyFluid.waterDeficit`；轮初 `blood.bloodVolumeMl`（可选） | `hypothalamus-adh.parameters.json` |
| `hypothalamus-thirst.ts` | `hypothalamusThirst` | `thirst` | `bodyFluid.waterDeficit` | `hypothalamus-thirst.parameters.json` |
| `thermoregulation.ts` | `thermoregulation` | `coreTemperatureC` | 自己的轮初温度；轮初 `bloodOxygen.oxygenConsumptionMlMin`（可选）、`skin.sweatVolumeMl`（可选）；`io.dt` | `thermoregulation.parameters.json` |
| `hypothalamus-endocrine.ts` | `hypothalamusEndocrine` | `trhRelative`、`crhRelative` | 自己的轮初状态；`thyroid.thyroxineRelative`（可选，未加载按 1）、`adrenal.cortisolRelative`（可选，未加载按 1） | `hypothalamus-endocrine.parameters.json` |
| `pituitary.ts` | `pituitary` | `tshRelative`、`acthRelative`、`prolactinRelative` | 自己的轮初状态；`hypothalamusEndocrine.trhRelative` / `crhRelative`（可选，未加载按 1）、`thyroid.thyroxineRelative`（可选，未加载按 1）、`adrenal.cortisolRelative`（可选，未加载按 1）、`mammaryGlands.milkMl`（可选，未加载按无泌乳） | `pituitary.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `hunger` | `mm` | 饥饿的 0–100 mm VAS 代理 |
| `fullness` | `mm` | 饱满的 0–100 mm VAS 代理 |
| `thirst` | `mm` | 口渴的 0–100 mm 代理；把 `hypothalamusThirst.thirst` 原样钳位后读出 |
| `urinaryUrgency` | `mm` | 尿意的 0–100 mm 代理；由轮初 `bladder.volumeMl` 归一化 |
| `discomfort` | `mm` | 不适的 0–100 mm 代理；七个感受（饥饿、饱满、口渴、尿意、子宫痉挛、乳腺胀奶、食管呛咳）超过 70 mm 舒适区后的强度取最大值 |
| `sexualArousalMm` | `mm` | 性反应周期的唤醒读数 0–100 mm；把 `sexualResponse.arousalMm` 原样钳位后读出，不是性欲、情绪或生殖器测量 |
| `libidoMm` | `mm` | 性欲的 0–100 mm 代理；`clamp(100 × (testes.testosteroneRelative − 0.5), 0, 100)`，不是睾酮浓度或临床性欲评估 |
| `bowelUrgencyMm` | `mm` | 便意的 0–100 mm 代理；`clamp(100 × colon.stoolG / 200, 0, 100)`，不是直肠压力、肛门直肠测压值或临床便意评分 |
| `dyspneaMm` | `mm` | 气促的 0–100 mm 代理；`clamp(100 × bloodOxygen.oxygenDeficit, 0, 100)`，不是呼吸困难量表、呼吸功或血气指标 |
| `stressMm` | `mm` | 压力的 0–100 mm 代理；`clamp(100 × (adrenal.cortisolRelative − 1) / 2, 0, 100)`，不是应激量表、皮质醇浓度或临床压力评估 |
| `sleepinessMm` | `mm` | 困倦的 0–100 mm 代理；`clamp(100 × (pineal.melatoninRelative − 0.2) / 1.6, 0, 100)`，不是睡眠压力量表、褪黑素浓度或睡眠分期 |
| `dryMouthMm` | `mm` | 口干的 0–100 mm 代理；`clamp(100 − salivaryGlands.mouthMoistureMm, 0, 100)`，不是口干量表、口腔黏膜湿度、唾液渗透压或临床干燥症指标 |
| `heatMm` | `mm` | 热不适的 0–100 mm 代理；`clamp(50 × (coreTemperatureC − 37), 0, 100)`，不是体温测量、热感觉量表或临床热应激分级 |
| `coldMm` | `mm` | 冷不适的 0–100 mm 代理；`clamp(50 × (37 − coreTemperatureC), 0, 100)`，不是体温测量、冷感觉量表或临床低体温分级 |

`hunger` / `fullness` / `thirst` / `urinaryUrgency` / `discomfort` / `sexualArousalMm` / `libidoMm` / `bowelUrgencyMm` / `dyspneaMm` / `stressMm` / `sleepinessMm` / `dryMouthMm` / `heatMm` / `coldMm` **不是物理长度、神经放电、激素浓度、膀胱压力或逼尿肌张力**，也不是胃容积、直肠压力或残余尿诊断值。`mm` 只沿用 100-mm 视觉模拟量表的刻度；把它们与胃内容量、血浆饥饿素、AVP pmol/L、膀胱 mL、粪便 g、压力、血气分压、皮质醇浓度、褪黑素浓度或口腔湿润度互换没有方法学依据。`discomfort` 是“当前最强的不适感受”代理，不是疼痛评分、情绪、疾病严重度或七感受总分；子宫痉挛只是 0–100 mm 的痛经代理，乳腺胀奶只是 0–100 mm 的胀奶代理，食管呛咳只是 0–100 mm 的风险代理，都不是痛觉、乳腺压力或临床呛咳测量。`bowelUrgencyMm` 只是由粪便量线性映射的便意代理，不是直肠压力或肛门直肠测压结果。`sexualArousalMm` 只是性反应周期代理的软读，不参与不适的最大值，也不表示性欲、性唤起的主观评分或任何临床性功能诊断。`dyspneaMm` 只是未满足氧需比例的换算读数，不是呼吸困难 VAS、呼吸做功、血氧测量或临床气促分级。`stressMm` 与 `sleepinessMm` 只是 HPA/松果体相对信号的线性换算，不是压力或困倦量表、不是激素浓度，也不触发睡眠或应激行为。

`thirst`、`urinaryUrgency`、子宫痉挛、`sexualArousalMm`、`libidoMm`、`bowelUrgencyMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`heatMm`、`coldMm` 与 `discomfort` 的方程：

```text
thirst         = clamp(hypothalamusThirst.thirst, 0, 100)   // 缺失或非有限回落 50 mm
urinaryUrgency = clamp(100 mm × bladder.volumeMl / 410 mL, 0, 100)
uterineCramp   = clamp(finiteOr(uterus.crampMm, 0), 0, 100)  // 无子宫或缺失按 0
mammaryFullness = clamp(finiteOr(mammaryGlands.fullnessMm, 0), 0, 100)  // 无乳腺或缺失按 0
esophagealChoking = clamp(finiteOr(esophagus.chokingMm, 0), 0, 100)  // 无食管或缺失按 0
bowelUrgencyMm = clamp(100 × finiteOr(colon.stoolG, 0) / 200, 0, 100)  // 无结肠或缺失按 0
sexualArousalMm = clamp(finiteOr(sexualResponse.arousalMm, 0), 0, 100)
dyspneaMm      = clamp(100 × finiteOr(bloodOxygen.oxygenDeficit, 0), 0, 100)
stressMm       = clamp(100 × (finiteOr(adrenal.cortisolRelative, 0) − 1) / 2, 0, 100)
sleepinessMm   = clamp(100 × (finiteOr(pineal.melatoninRelative, 0) − 0.2) / 1.6, 0, 100)
dryMouthMm     = clamp(100 − finiteOr(salivaryGlands.mouthMoistureMm, 0), 0, 100)
heatMm         = clamp(50 × (finiteOr(thermoregulation.coreTemperatureC, 37) − 37), 0, 100)
coldMm         = clamp(50 × (37 − finiteOr(thermoregulation.coreTemperatureC, 37)), 0, 100)
excess(x)      = clamp(100 × (x − 70) / (100 − 70), 0, 100)
discomfort     = max(excess(hunger), excess(fullness), excess(thirst),
                     excess(urinaryUrgency), excess(uterineCramp), excess(mammaryFullness),
                     excess(esophagealChoking))
```

尿意读取轮初膀胱量，所以排尿后的低尿意和当轮新转入的尿都在下一轮读出；尿意在 410 mL 处已饱和到 100 mm，再多的膀胱体积不会让 `urinaryUrgency` 或由它贡献的 `discomfort` 继续升高。410 mL 的参考量是 `design`，只借 De Wachter 队列 SDV 的测压量级作归一化锚点，不是自然排尿阈值，也不是个体尿意标定。`discomfort` 的起始值 70 mm 同样是 `design`、`source: null`：感受 70 mm 仍为 0，85 mm 为 50，100 mm 为 100；它取最大值而不是相加，避免把多个感受叠成没有依据的总分。子宫痉挛只读 `uterus.crampMm`，`uterus` 是可选部位：未加载、字段缺失、NaN 或非有限时按 0（沿用 `finiteOr` 惯例），根清单行为逐点不变。乳腺胀奶只读 `mammaryGlands.fullnessMm`，`mammaryGlands` 同样是可选部位：未加载、字段缺失、NaN 或非有限时按 0；它是 `discomfort` 的第六路，根清单没有乳腺时该路恒 0，行为逐点不变。食管呛咳只读 `esophagus.chokingMm`，`esophagus` 是可选部位，未加载或无效时按 0，它是 `discomfort` 的第七路。`bowelUrgencyMm` 只软读 `colon.stoolG`，`colon` 是可选部位：未加载、字段缺失、NaN 或非有限时按 0，负值也按 0；它不进入 `discomfort` 的七路最大值，也不进入 `brainNotify`，因此便意不会触发不适或提醒。`sexualArousalMm` 只软读 `sexualResponse.arousalMm`，`sexualResponse` 是可选部位：未加载、字段缺失、NaN 或非有限时按 0；它不进入 `discomfort` 的七路最大值，也不进入 `brainNotify`，因此性唤醒不会触发不适或提醒。`dyspneaMm` 只软读 `bloodOxygen.oxygenDeficit`，`bloodOxygen` 是可选部位：未加载、字段缺失、NaN 或非有限时按 0；它同样不进入 `discomfort` 的七路最大值，也不进入 `brainNotify`，因此气促不会触发不适或通知。根清单加载 `sexualResponse` 后，该读数只随性活动变化；无性活动时仍为 0；加载 `bloodOxygen` 后，气促读数只随供需缺口变化，供 ≥ 需时仍为 0。`stressMm` 只软读 `adrenal.cortisolRelative`，`sleepinessMm` 只软读 `pineal.melatoninRelative`；两者未加载、字段缺失、NaN 或非有限时按 0，都不进入 `discomfort`，也不进入 `brainNotify`。根清单加载 `adrenal` 后，皮质醇等于 1 时 `stressMm = 0`；加载 `pineal` 后，困倦随仿真昼夜曲线变化（02:00 附近 100、08:00 为 50、14:00 为 0）。`dryMouthMm` 只软读 `salivaryGlands.mouthMoistureMm`；未加载、字段缺失、NaN 或非有限时按 0（不按最大口干），它不进入 `discomfort` 的七路最大值，也不进入 `brainNotify`。根清单加载 `salivaryGlands` 后，基础湿润度约 33.33 mm 对应口干约 66.67 mm，进食刺激时湿润度到 100 mm、口干降到 0 mm；这是公式读出的设计行为，不是人体口干量表。M19 真实 DSH 会话已读出 `discomfort`（2026-11-22，33/33 verdicts）：预置 650 mL 膀胱的轮次在 sim 60 因轮初体积读出 `urinaryUrgency = 100`、`discomfort = 100`，下一轮随膀胱降到 1 mL 回落到 0.244 / 0（650 mL 预置与预置会话的稳态 1 mL 请求都是测试设定，不是模型输出）；高 ADH 预置则因 `thirst = 100` 读出 `discomfort = 100`。证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`（仓库外，未入库）。M19 只验证这些体感读数和 `interoception` 的一轮偏移，不覆盖子宫第五路、乳腺第六路、性唤醒、气促或口干读数，也不验证 `brainNotify` 提醒投递或排尿闭环。`thirst`、`urinaryUrgency`、`discomfort`、`sexualArousalMm`、`bowelUrgencyMm`、`dyspneaMm`、`stressMm`、`sleepinessMm` 与 `dryMouthMm` 目前由 `body_state` / `GET /state` 读取；`brainNotify` 把 `thirst` 用于口渴提醒、`urinaryUrgency` 用于尿意提醒，仍不读 `discomfort`、`sexualArousalMm`、`bowelUrgencyMm`、`dyspneaMm`、`stressMm`、`sleepinessMm` 或 `dryMouthMm`，也没有不适、痛经、便意、性唤醒、气促、压力、困倦或口干提醒。

`initialState` 为 `{ hunger: 50, fullness: 0, thirst: 50, urinaryUrgency: 0, discomfort: 0, sexualArousalMm: 0, dyspneaMm: 0, stressMm: 0, sleepinessMm: 0, dryMouthMm: 0, libidoMm: 0, bowelUrgencyMm: 0, heatMm: 0, coldMm: 0, hypocalcemiaMm: 0, hypercalcemiaMm: 0 }`；`hunger` / `fullness` 来自两个 `design` 基线参数，`thirst` 的 50 mm 是缺失回落，其余读数初值 0。子宫第五路、乳腺第六路与食管第七路都不新增字段，`uterus` / `mammaryGlands` / `esophagus` 未加载时 `uterineCramp` / `mammaryFullness` / `esophagealChoking` 恒 0；`sexualResponse` 未加载时 `sexualArousalMm` 恒 0；`colon` 未加载时 `bowelUrgencyMm` 恒 0；`bloodOxygen` 未加载时 `dyspneaMm` 恒 0；`adrenal` 未加载时 `stressMm` 恒 0；`pineal` 未加载时 `sleepinessMm` 恒 0；`salivaryGlands` 未加载时 `dryMouthMm` 恒 0；`testes` 未加载时 `libidoMm` 恒 0；`thermoregulation` 未加载时 `heatMm` / `coldMm` 恒 0；`bloodCalcium` 未加载时按参考值 9.5 mg/dL，两个钙读数恒 0。脚本每轮从上游输入重算，输出钳到 `[0, 100]`，不读自己的上一轮状态。

### `hypothalamusAdh`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `relativeConcentration` | `1` | 相对 ADH 水平，初值 1；不是血浆 AVP 浓度（`pmol/L`）、分泌速率或渗透压 |

```text
target = clamp(1 + deficitGain × waterDeficit
                 + volumeGain × (1 − bloodVolumeMl / 5000),
               relativeMinimum, relativeMaximum)
next   = current + (1 − exp(−dtMin / timeConstantMin)) × (target − current)
```

一阶滞后只提供工程反应延迟；`timeConstantMin` 是 `design`，不是 Andersen 的拟合值。只读轮初 `bodyFluid.waterDeficit` 与轮初 `blood.bloodVolumeMl`，缺失或非有限时 `waterDeficit` 按 0、血容量按 5000 mL；已加载但字段非法时抛错。5000 mL 是 `blood.referenceBloodVolumeMl` 的 `design` 基线，不是实测血容量或血浆容量；`blood` 未加载时血容量项为 0。低血容量抬高 ADH，与低水量亏缺同向。

### `thermoregulation`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `coreTemperatureC` | `°C` | 核心温度代理，初值 37°C；不是实测核心体温、皮肤温度或临床分级 |

```text
heatProductionKcalMin = metabolicFactor × oxygenConsumptionMlMin
                      + shiveringGain × max(0, setpointC − coreTemperatureC)
heatLossKcalMin = evaporationKcalPerMl × sweatVolumeMl
                + lossGain × (coreTemperatureC − ambientTemperatureC)
coreTemperatureC = prev.coreTemperatureC
                 + dtMin × (production − loss) / heatCapacityKcalPerC
```

产热读轮初 `bloodOxygen.oxygenConsumptionMlMin`（未加载按 250 mL/min）；散热读轮初 `skin.sweatVolumeMl`（未加载按 0）。`setpointC = 37`、`ambientTemperatureC = 25`、`heatCapacityKcalPerC = 60`、`metabolicFactor = 0.02`、`shiveringGain = 2`、`lossGain = 0.05`、`evaporationKcalPerMl = 0.58` 全部 `design`、`source: null`。消费者是 `skin`（热时放大出汗请求）、`lungsVentilation`（热时叠加喘息项）与 `interoception`（`heatMm` / `coldMm`）。本切片不建皮肤分区温度、血管舒缩、寒战肌肉做功细节、发热/低温症、湿度或风速；当前系数下静息产热高于 37°C 的梯度散热，核心温度会缓慢上升，这是 `design` 占位的已知边界，不是人体体温曲线。

### `hypothalamusThirst`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `thirst` | `mm` | 口渴驱动，0–100 mm 代理，初值 50 mm；不是实测 VAS、渗透压或饮水动机 |

```text
thirst = clamp(baselineMm + deficitGainMm × waterDeficit, 0, 100)
```

无自身动态；饮水只能经胃→小肠→体液改变 `waterDeficit` 后降低口渴。首段不建 Figaro & Mack 所述吸收前口咽缓解。

`brainNotify` 的字段：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `lastSessionId` | `1` | 最近一次带 `sessionId` 的动作所属会话；没有则为 `null` |
| `sessions` | `1` | 每个会话的提醒状态：上次提醒时间、`lastKind`（最近提醒信号）、`lastLevel`（下降闩锁）、逐信号水位 `levels`、小时/天计数、最近出现时间 |

`sessions` 是内部策略状态，不是生理读数；按 `maxTrackedSessions` 保留最近 32 个会话。每个会话各自保存 `levels: { hunger, fullness, thirst, urinary }` 门控水位（只存 0/2/3）；每轮只对当前目标会话（本轮最后带 `sessionId` 的动作，否则持久化的 `lastSessionId`）按当轮观测调和，其他会话不被当轮观测改写。`lastKind` 记录最近一次提醒的信号，`lastLevel` 保留下降闩锁（提醒时置为发送档位，未提醒时只降不升），并作为旧档迁移来源，不是纯最近提醒摘要。旧会话缺少 `levels` 时按 `lastKind/lastLevel` 惰性补出对应信号的水位（只认明显/强档，其余按 0；`lastKind` 可为 `thirst`）；已有 `levels` 对象缺少 `thirst` 时只补 `thirst: 0`，其他信号水位不变；不反推历史，不升存档 `schemaVersion`，顶层 `initialState/fields` 不变。

## 3. 输入与方程

以上只读输入都取自同一轮的轮初快照；缺失或非有限时按默认值处理：

| 输入 | 含义 | 缺失 / 非有限默认值 |
| --- | --- | --- |
| `stomachSensory.mechanical` | 胃壁机械感受代理，0–1；不是张力或神经放电 | 0 |
| `stomachGhrelin.relativeConcentration` | 相对饥饿素浓度；餐间基准 1、餐后谷值 0.5，空腹时可高于 1（工程上升，目标约 1.8）；不是 `ng/mL` | 1 |
| `duodenum.nutrientExposure` | 十二指肠近期营养暴露代理，`kcal/min`；不是吸收速率或血糖 | 0 |
| `hypothalamusThirst.thirst` | 下丘脑口渴驱动，0–100 mm 代理 | 50 |
| `bladder.volumeMl` | 轮初膀胱体积，mL；不是压力 | 0 |
| `uterus.crampMm` | 子宫痉挛代理，0–100 mm；不是疼痛测量、VAS 实测或临床痛经分级。仅女性清单加载 | 0 |
| `mammaryGlands.fullnessMm` | 乳腺胀奶代理，0–100 mm；不是乳腺压力、容量、胀痛或临床测量。仅女性清单加载 | 0 |
| `sexualResponse.arousalMm` | 性反应周期唤醒代理，0–100 mm；不是性欲、情绪、激素浓度或生殖器测量。根清单与女性清单均可加载 | 0 |
| `bloodOxygen.oxygenDeficit` | 血氧池未满足氧需比例，0–1；不是血气分压、血氧饱和度或组织缺氧量。根清单加载 | 0 |
| `adrenal.cortisolRelative` | 皮质醇相对量，1 为工程基线；不是血浆皮质醇浓度、分泌率或 HPA 轴临床指标。根清单加载 | 0 |
| `pineal.melatoninRelative` | 褪黑素相对量，0–2，1 为工程基线；不是褪黑素浓度、光照剂量或睡眠测量。根清单加载 | 0 |
| `salivaryGlands.mouthMoistureMm` | 口腔湿润度代理，0–100 mm；不是口腔黏膜湿度、唾液流率或口干量表。根清单加载 | 0 |
| `thermoregulation.coreTemperatureC` | 核心温度代理，°C；不是实测核心体温、皮肤温度或临床分级。根清单加载 | 37 |

先钳输入：`M = clamp(mechanical, 0, 1)`、`G = max(0, relativeConcentration)`、`N = max(0, nutrientExposure)`；`thirst`、`urinaryUrgency`、`uterineCramp`、`mammaryFullness`、`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm` 与 `dryMouthMm` 见 §2。然后：

```text
hunger   = clamp(hungerBaseline   + hungerGhrelinGain   × (G − 1)
                                  + hungerMechanicalGain × M
                                  + hungerNutrientGain   × N, 0, 100)
fullness = clamp(fullnessBaseline + fullnessGhrelinGain × (G − 1)
                                  + fullnessMechanicalGain × M
                                  + fullnessNutrientGain   × N, 0, 100)
```

各感受输出互不串写：`thirst` 不参与饥饿/饱满方程，`urinaryUrgency`、`sexualArousalMm`、`libidoMm`、`bowelUrgencyMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`heatMm` 与 `coldMm` 也不参与；`discomfort` 只读本轮已算出的七个感受（含子宫痉挛、乳腺胀奶与食管呛咳），不回写它们，也不进入它们的方程；独立软读只作读数，不进入 `discomfort`。输入到输出有**一轮偏移**（这是 `interoception` 自身的偏移；`notify` 在它之上再晚一轮，见 §8）：同一轮的摄入先由胃脚本记账，下一轮的轮初快照里才出现新的 `mechanical`、`relativeConcentration` 与 `nutrientExposure`；`bodyFluid` 的变化也要下一轮才改变两个下丘脑脚本的输出；`uterus` 本轮写出的 `crampMm`、`mammaryGlands` 本轮写出的 `fullnessMm`、`esophagus` 本轮写出的 `chokingMm`、`colon` 本轮写出的 `stoolG` 与 `testes` 本轮写出的 `testosteroneRelative` 最早下一轮才被体感读到，不会同轮；`sexualResponse` 本轮写出的 `arousalMm`、`bloodOxygen` 本轮写出的 `oxygenDeficit`、`adrenal` 本轮写出的 `cortisolRelative`、`pineal` 本轮写出的 `melatoninRelative`、`salivaryGlands` 本轮写出的 `mouthMoistureMm` 与 `thermoregulation` 本轮写出的 `coreTemperatureC` 同样最早下一轮才被对应软读读到。

`G = 1` 只是餐间基准，不是上限：`stomachGhrelin` 按距上次含能摄入的分钟数做工程上升，长期无含能摄入时 `G` 可从 1 升到约 1.8。在机械与营养输入为 0 时，按现有权重，`hunger = 50 + 50 × (G − 1)` 会随之进入 65 mm 明显档和 85 mm 强档；`interoception` 的方程、权重与 `brainNotify` 的 65/85/40 mm 阈值、45 min 冷却和配额都不变。空腹曲线本身是 `design`，不是人体标定。

## 4. 参数

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `interoception.hunger.baselineMm` | 50 | `mm` | `design` | — |
| `interoception.fullness.baselineMm` | 0 | `mm` | `design` | — |
| `interoception.hunger.ghrelinGain` | 50 | `mm/1` | `design` | — |
| `interoception.fullness.ghrelinGain` | -50 | `mm/1` | `design` | — |
| `interoception.hunger.mechanicalGain` | -20 | `mm/1` | `design` | — |
| `interoception.fullness.mechanicalGain` | 100 | `mm/1` | `design` | — |
| `interoception.hunger.nutrientGain` | -5 | `mm/(kcal/min)` | `design` | — |
| `interoception.fullness.nutrientGain` | 10 | `mm/(kcal/min)` | `design` | — |
| `interoception.urinaryUrgency.referenceVolumeMl` | 410 | `mL` | `design` | `SRC-DEWACHTER-2003` |
| `interoception.discomfort.onsetMm` | 70 | `mm` | `design` | — |

前八个参数与不适起始值 `status: "design"`、`source: null`；尿意参考量也标 `design`，只挂测压队列量级的登记，不是人体测量、自然阈值或独立验证。十项全是工程假设。独立软读都不新增参数：`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`heatMm` 与 `coldMm` 分别只做 `clamp(finiteOr(arousalMm, 0), 0, 100)`、`clamp(100 × finiteOr(oxygenDeficit, 0), 0, 100)`、`clamp(100 × (finiteOr(cortisolRelative, 0) − 1) / 2, 0, 100)`、`clamp(100 × (finiteOr(melatoninRelative, 0) − 0.2) / 1.6, 0, 100)` 与 `clamp(100 − finiteOr(mouthMoistureMm, 0), 0, 100)`、`clamp(50 × (finiteOr(coreTemperatureC, 37) − 37), 0, 100)` 与 `clamp(50 × (37 − finiteOr(coreTemperatureC, 37)), 0, 100)`；`libidoMm = clamp(100 × (finiteOr(testosteroneRelative, 0.5) − 0.5), 0, 100)`，`bowelUrgencyMm = clamp(100 × finiteOr(colon.stoolG, 0) / 200, 0, 100)`，200 g 与结肠 `colon.referenceStoolG` 一致，是工程参考量而非实测阈值。性反应周期的六个参数归 [`sexual-response`](../sexual-response/README.md)，血氧参数归 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md)，皮质醇、褪黑素、唾液、睾丸与结肠参数分别归 [`adrenal`](../adrenal/README.md)、[`pineal`](../pineal/README.md)、[`salivary-glands`](../salivary-glands/README.md)、[`testes`](../testes/README.md) 与 [`colon`](../colon/README.md)，`interoception.parameters.json` 不新增条目。

### `hypothalamus-adh.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusAdh.timeConstantMin` | 10 | `min` | `design` | — |
| `hypothalamusAdh.deficitGain` | 1 | `1/1` | `design` | — |
| `hypothalamusAdh.volumeGain` | 0.5 | `1/1` | `design` | — |
| `hypothalamusAdh.relativeMinimum` | 0 | `1` | `design` | — |
| `hypothalamusAdh.relativeMaximum` | 3 | `1` | `design` | — |

### `hypothalamus-thirst.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusThirst.baselineMm` | 50 | `mm` | `design` | — |
| `hypothalamusThirst.deficitGainMm` | 50 | `mm/1` | `design` | — |

两个下丘脑参数文件全部 `design`、`source: null`；`relativeConcentration` 以 1 为无量纲参考，`thirst` 的 `mm` 只沿用 VAS 刻度。`volumeGain = 0.5` 只表示血容量每低于参考值一个相对单位追加 0.5 的目标相对水平，不是 AVP 剂量反应或人体测量。

### `thermoregulation.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `thermoregulation.setpointC` | 37 | `°C` | `design` | — |
| `thermoregulation.ambientTemperatureC` | 25 | `°C` | `design` | — |
| `thermoregulation.heatCapacityKcalPerC` | 60 | `kcal/°C` | `design` | — |
| `thermoregulation.metabolicFactor` | 0.02 | `kcal/mL` | `design` | — |
| `thermoregulation.shiveringGain` | 2 | `kcal/(min·°C)` | `design` | — |
| `thermoregulation.lossGain` | 0.05 | `kcal/(min·°C)` | `design` | — |
| `thermoregulation.evaporationKcalPerMl` | 0.58 | `kcal/mL` | `design` | — |

七项全部 `design`、`source: null`，没有量热、寒战产热、蒸发散热或调定点的人体测量。

### `hypothalamus-endocrine.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusEndocrine.trhFeedbackGain` | 1 | `1/1` | `design` | — |
| `hypothalamusEndocrine.crhFeedbackGain` | 1 | `1/1` | `design` | — |

```text
trhTarget = clamp(1 + trhFeedbackGain × (1 − T4), 0, 3)
crhTarget = clamp(1 + crhFeedbackGain × (1 − 皮质醇), 0, 3)
trhRelative = trhTarget + (prevTRH − trhTarget) × 2^(−dtMin / 30)
crhRelative = crhTarget + (prevCRH − crhTarget) × 2^(−dtMin / 30)
```

T4/皮质醇高于 1 时目标低于 1，低于 1 时目标高于 1；30 min 半时是本脚本常量。两个增益都是 `design`、`source: null`，不是 HPT/HPA 轴剂量反应。

### `pituitary.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `pituitary.tshFeedbackGain` | 1 | `1` | `design` | — |
| `pituitary.acthFeedbackGain` | 1 | `1` | `design` | — |

```text
tshTarget = clamp(TRH × (1 + tshFeedbackGain × (1 − T4)), 0, 3)
acthTarget = clamp(CRH × (1 + acthFeedbackGain × (1 − 皮质醇)), 0, 3)
prolactinTarget = mammaryGlands.milkMl > 0 ? 2 : 1
tshRelative = tshTarget + (prevTSH − tshTarget) × 2^(−dtMin / 30)
acthRelative = acthTarget + (prevACTH − acthTarget) × 2^(−dtMin / 30)
prolactinRelative = prolactinTarget + (prevProlactin − prolactinTarget) × 2^(−dtMin / 30)
```

`TRH`/`CRH` 与 T4/皮质醇缺失时按 1 回退；已加载但字段缺失、非有限或为负时抛错，本轮失败。`mammaryGlands` 未加载时按无泌乳（目标 1）；已加载但 `milkMl` 缺失、非有限或为负时抛错。30 min 半时是本脚本常量，两个增益是 `design`、`source: null`。`prolactinRelative` 的 `LETDOWN_TARGET_RELATIVE = 2` 与 30 min 半时也是脚本常量（`design`、`source: null`），不是实测催乳素倍数或吸吮剂量—反应；它只表示“上一轮有乳汁到账”时催乳素向 2 趋近，无泌乳时回落到基线 1。下游消费者与负反馈边界见 [`thyroid`](../thyroid/README.md)、[`adrenal`](../adrenal/README.md) 与 [`mammaryGlands`](../mammary-glands/README.md)。

### `notify.parameters.json`（提醒策略）

| 参数 ID | 值 | 单位 | 状态 |
| --- | --- | --- | --- |
| `brainNotify.hunger.marked` | 65 | `mm` | `design` |
| `brainNotify.hunger.strong` | 85 | `mm` | `design` |
| `brainNotify.fullness.marked` | 65 | `mm` | `design` |
| `brainNotify.fullness.strong` | 85 | `mm` | `design` |
| `brainNotify.urinary.marked` | 65 | `mm` | `design` |
| `brainNotify.urinary.strong` | 85 | `mm` | `design` |
| `brainNotify.thirst.marked` | 65 | `mm` | `design` |
| `brainNotify.thirst.strong` | 85 | `mm` | `design` |
| `brainNotify.resetBelow` | 40 | `mm` | `design` |
| `brainNotify.minIntervalMin` | 45 | `min` | `design` |
| `brainNotify.maxPerHour` | 2 | `1` | `design` |
| `brainNotify.maxPerDay` | 6 | `1` | `design` |
| `brainNotify.wakeAtLevel` | 3 | `1` | `design` |
| `brainNotify.maxTrackedSessions` | 32 | `1` | `design` |

这些是 `policy`：明显/强档位阈值、复位阈值、冷却和次数上限都不是人体测量。`resetBelow=40` 只把观测分成 0/1 两档，不直接充当重新武装门槛；门控水位只存 0/明显/强，40–64 mm 的中间档按 0。同档重复要先把观测降到已提醒档以下，升到更高档则可在冷却允许时直接提醒。尿意的 65/85 mm 同样只是提醒 policy，比较的是 `interoception.urinaryUrgency` 的 0–100 mm 代理，不是人体排尿阈值、临床尿急界值或某个膀胱毫升数。口渴的 65/85 mm 也是提醒 policy，比较的是 `interoception.thirst` 的 0–100 mm 代理，不是血浆渗透压、实测 VAS 或人体口渴阈值；口渴缺失或非有限读数在通知门控按 50 mm 处理，因此不提醒，该缺省不参与水账或生理计算。设计灵感只到定性层面——显著性、习惯化/滞回、不应期；没有搬用论文参数。

### 迁移时删掉的参数

参数文件从 `systems/nervous/interoception.parameters.json` 迁入时裁掉了四项：

- `interoception.hunger.ghrelinGainAbsolute` 与 `interoception.fullness.ghrelinGainAbsolute`（原 `fitted_dev`，单位 `mm/(ng/mL)`）没有迁入。当前 `stomachGhrelin` 只产出相对浓度（单位 `1`，餐间基准 1，另有 `minutesSinceEnergyIntake` 空腹计时字段），没有绝对 `ng/mL` 的写入者；保留它们只会得到没有消费者的字段，还会让人误以为模型接受绝对浓度。
- `interoception.discomfort.threshold` 与 `interoception.discomfort.slope`（原 `unset`）没有迁入。当前的不适读出改用新的 `interoception.discomfort.onsetMm`（`design`）：只把五个已有感受（含子宫痉挛）超过舒适区后的强度取最大值，不恢复这两个没有消费者的旧参数，也不建恶心、腹胀、疼痛或撑感的独立症状读出。

## 5. 调节方式

`interoception` 接多类只读输入：胃机械感受、相对饥饿素、十二指肠营养暴露、下丘脑口渴驱动、膀胱体积、可选的子宫痉挛、可选的乳腺胀奶、可选的食管呛咳、可选的结肠粪便量、可选的性反应周期 `sexualResponse.arousalMm`、可选的血氧缺口 `bloodOxygen.oxygenDeficit`、可选的皮质醇 `adrenal.cortisolRelative`、可选的褪黑素 `pineal.melatoninRelative`、可选的口腔湿润度 `salivaryGlands.mouthMoistureMm`、可选的睾酮相对量 `testes.testosteroneRelative`、可选的核心温度 `thermoregulation.coreTemperatureC` 与可选的血钙 `bloodCalcium.mgDl`；前三类进入同一条线性叠加，口渴、尿意、子宫痉挛、乳腺胀奶与食管呛咳分别直通 `thirst`、`urinaryUrgency` 与 `discomfort` 的第五、第六、第七路，`bowelUrgencyMm`、`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`libidoMm`、`heatMm` 与 `coldMm` 独立钳位后读出，`discomfort` 再由本轮七个感受超出 70 mm 的强度取最大值。`hypothalamusThirst` 只读 `bodyFluid.waterDeficit`；`hypothalamusAdh` 读同一水量亏缺与轮初 `blood.bloodVolumeMl`；两者彼此不读对方部位。`thermoregulation` 只读轮初氧耗与汗液，写核心温度；它不直接写出汗、通气或体感，也不产生动作或通知。内分泌下丘脑与垂体脚本只读各自的轮初快照和外周激素，不产生动作。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 恶心、腹胀、疼痛、过度饱满（撑感）等独立症状；`discomfort` 只是六个已有感受超出舒适区后的最大强度代理，不是其中任何一项的独立测量或评分；痛经只以 `uterus.crampMm` 痉挛代理并入 `discomfort`，乳腺胀奶只以 `mammaryGlands.fullnessMm` 并入，都不是疼痛或乳腺压力测量；
- 餐食成分（脂肪 / 蛋白 / 碳水比例）、黏度、能量密度、温度、碳酸与甜味剂；
- 餐时表、餐前预期、昼夜节律、睡眠、运动与疾病；
- 个体差异：年龄、性别、BMI、胃排空、激素水平与膀胱容量的个体化参数；
- CCK、GLP-1 等肠激素，以及迷走与中枢反馈；
- 血浆/尿渗透压、电解质、血容量、血压与 RAAS；
- 吸收前口咽解渴、习惯化、饮水动机与自动喝水；
- 生理性尿意阈值、排尿反射、失禁、夜尿与逼尿肌压力；`urinaryUrgency` 只是按膀胱体积归一化的读出，脑内不建这些机制；`brainNotify` 的 65/85 mm 只是提醒 policy，不是排尿阈值；乳腺解剖、乳房体积/压力、乳汁成分与婴儿吸吮也不建，脑只把 `mammaryGlands.fullnessMm` 软读成不适第六路；
- 性反应周期的高潮、不应期、激素、性欲、情绪、伴侣与受孕/妊娠；脑只把 `sexualResponse.arousalMm` 软读成 `sexualArousalMm`，不参与 `discomfort`，不进入 `brainNotify`，也不据此产生动作或通知；
- 呼吸控制与血气：脑不建呼吸节律、呼吸功、PaO2 / PaCO2、血红蛋白 / 氧合曲线或 CO2 / 酸碱调节；只把 `bloodOxygen.oxygenDeficit` 软读成 `dyspneaMm`，不产生通气动作、不进入 `discomfort`、不发通知，也不自动改变呼吸、活动或就医行为；
- 内分泌轴的绝对激素浓度、分泌脉冲、结合蛋白、受体与疾病：脑只建 TRH/CRH、TSH/ACTH 相对信号与负反馈，只把皮质醇/褪黑素相对量软读成 `stressMm` / `sleepinessMm`，不建压力或睡眠行为，也不据读数产生动作、通知或睡眠；
- 通知历史文件、模型已读确认与按会话绑定不同身体（当前只有最近动作的会话收到提醒）。

## 6. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程 / 参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`../stomach/references/notes/`](../stomach/references/notes/)：
  - `cummings-2001.md`（`SRC-CUMMINGS-2001`，摘要 Results）：餐前饥饿素升、餐后 1 h 内降的方向。
  - `leone-2022.md`（`SRC-LEONE-2022`，Table 2、Table 4 与 Results）：混合餐后相对饥饿素与饥饿 / 饱满评分的同批变化方向。
  - `levine-2015.md`（`SRC-LEVINE-2015`，Table 1 与 Methods 第 3 节）：237 mL、355 kcal 高脂液餐后 0–60 min 的胃饱满 VAS 时序与量表口径。
  - `camps-2016.md`（`SRC-CAMPS-2016`，摘要 Results）：饱感排序可以与胃排空 t50 排序不一致。
- 水链逐篇笔记：
  - `references/notes/figaro-1997.md`（`SRC-FIGARO-1997`，摘要 Results）：热运动脱水 n=6、cm VAS；只支撑口咽解渴与持续补液可分开，首段不建该支路。
  - [`../kidney/references/notes/ota-1994.md`](../kidney/references/notes/ota-1994.md)（`SRC-OTA-1994`，Methods p.100、Figs. 1/3/4）：主队列 5 名甲减患者 + 5 名正常对照；只支撑水负荷后 AVP 降、尿变稀的方向。
  - [`../kidney/references/notes/andersen-1990.md`](../kidney/references/notes/andersen-1990.md)（`SRC-ANDERSEN-1990`，摘要 Results）：AVP 输注后肾反应可延迟；剂量轴不是血浓度。
  - [`../bladder/references/notes/de-wachter-2003.md`](../bladder/references/notes/de-wachter-2003.md)（`SRC-DEWACHTER-2003`，摘要）：健康女学生 n=15；190/268/410 mL 是交接数值、原文表/图待核，410 只作尿意归一化锚点。
  - [`../bladder/references/notes/abrams-2002.md`](../bladder/references/notes/abrams-2002.md)（`SRC-ABRAMS-2002`，§3.2.4）：排前量 = 排出量 + 残余量的记账恒等式。
- 子宫痉挛（第五路）：`uterus.crampMm` 由 [`uterus`](../uterus/README.md) 按 `design` 参数产出，本脚本不核对来源，也不把它当作疼痛测量；Bull 2019 只支撑周期/相位/出血天数（队列为 Natural Cycles 用户、厂商资助、仅排卵周期），不支撑痛经。证据边界归 [`uterus` README](../uterus/README.md) 与 [`bull-2019.md`](../ovaries/references/notes/bull-2019.md)。
- 乳腺胀奶（第六路）：`mammaryGlands.fullnessMm` 由 [`mammaryGlands`](../mammary-glands/README.md) 按三个 `design` 参数产出，本脚本不核对来源，也不把它当作乳腺压力、容量或胀痛测量；三个参数全部 `design`、`source: null`，没有实测泌乳率、乳汁乳糖浓度或胀奶量表。证据边界归 [`mammary-glands` README](../mammary-glands/README.md) 与 [`2026-11-24-mammary-glands-design.md`](../../../docs/superpowers/specs/2026-11-24-mammary-glands-design.md)。
- 性唤醒软读：`sexualResponse.arousalMm` 由 [`sexual-response`](../sexual-response/README.md) 按六个 `design` 参数产出，没有登记来源；本脚本只钳位读出，不把它当作性欲、情绪、激素或临床性功能测量，也不并入 `discomfort`。
- 气促软读：`bloodOxygen.oxygenDeficit` 由 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md) 按四个 `design` 参数产出，没有登记来源；本脚本只把缺口乘 100 后钳位，不把它当作呼吸困难量表、呼吸功或血气测量，也不并入 `discomfort`。
- 口干软读：`salivaryGlands.mouthMoistureMm` 由 [`salivary-glands`](../salivary-glands/README.md) 按四个 `design` 参数产出，没有登记来源；本脚本只做 `100 − 湿润度` 后钳位，不把它当作口干量表、口腔黏膜湿度、唾液渗透压或临床干燥症指标，也不并入 `discomfort` 或 `brainNotify`。
- 内分泌轴：TRH/CRH、TSH/ACTH 与负反馈公式见 [`2026-11-24-endocrine-axes-design.md`](../../../docs/superpowers/specs/2026-11-24-endocrine-axes-design.md)；T4 与皮质醇下游分别见 [`thyroid`](../thyroid/README.md) 与 [`adrenal`](../adrenal/README.md)，褪黑素节律见 [`pineal`](../pineal/README.md)。四个参数文件全部 `design`、`source: null`，本脚本只读相对量，不把 `stressMm` / `sleepinessMm` 当作压力、睡眠或激素测量。
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)
- 空腹饥饿素设计：[`docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md`](../../../docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md)
- 水链设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md)
- 尿意提醒设计：[`docs/superpowers/specs/2026-11-22-urinary-notification-design.md`](../../../docs/superpowers/specs/2026-11-22-urinary-notification-design.md)
- 口渴提醒设计：[`docs/superpowers/specs/2026-11-23-thirst-notification-design.md`](../../../docs/superpowers/specs/2026-11-23-thirst-notification-design.md)
- 生殖薄切片设计：[`docs/superpowers/specs/2026-11-23-reproductive-cycle-design.md`](../../../docs/superpowers/specs/2026-11-23-reproductive-cycle-design.md)
- 性行为与性反应周期设计：[`docs/superpowers/specs/2026-11-23-sexual-response-design.md`](../../../docs/superpowers/specs/2026-11-23-sexual-response-design.md)
- 血氧池与气促读数设计：[`docs/superpowers/specs/2026-11-23-blood-oxygen-design.md`](../../../docs/superpowers/specs/2026-11-23-blood-oxygen-design.md)
- 循环与血压设计：[`docs/superpowers/specs/2026-11-24-circulation-design.md`](../../../docs/superpowers/specs/2026-11-24-circulation-design.md)
- 体温调节设计：[`docs/superpowers/specs/2026-11-24-thermoregulation-design.md`](../../../docs/superpowers/specs/2026-11-24-thermoregulation-design.md)
- 体温集成测试：[`test/organs.thermoregulation-gateway.test.mjs`](../../../test/organs.thermoregulation-gateway.test.mjs)

**证据边界：** 这些来源只支撑方向——餐后饥饿素下降、饥饿下降与饱满上升，胃充盈与营养到达参与饱感，饱感不只看排空；水负荷后 AVP 下降、尿量增加且尿变稀；吸收前口咽刺激可短暂抑制口渴。它们**没有**把机械感受、营养暴露、相对饥饿素、体液亏缺、膀胱体积、子宫痉挛或乳腺胀奶校准到 0–100 mm VAS，也没有把 `relativeConcentration` 或 `prolactinRelative` 校准到 pmol/L 或任何激素浓度。线性叠加、一阶滞后、基线、增益、参考量、不适起始值与缺失默认值全是 `design`；`discomfort` 的 70 mm 起始值和取最大值规则没有来源标定，不代表疼痛阈值、情绪或疾病严重度；子宫痉挛的 85 mm 峰值、2.5 天窗口同样是 `design`，不是痛经测量；乳腺胀奶的 0–100 mm 代理与 4 mm/mL 增益同样没有实测标定，不是乳腺压力或胀痛测量；性唤醒的六个参数同样全部 `design`、`source: null`，没有人体性反应数据或临床验证；血氧缺口到 `dyspneaMm` 的 100 倍换算也是 `design`，没有气促量表或血气标定；HPT/HPA 轴的四个反馈增益、30 min 半时与外周激素的一阶时滞同样全是 `design`、`source: null`，没有激素浓度、剂量反应或临床验证；皮质醇到 `stressMm`、褪黑素到 `sleepinessMm` 的线性换算也是 `design`，没有压力量表、睡眠量表或激素实测标定；口腔湿润度到 `dryMouthMm` 的反向换算同样没有口干量表、口腔黏膜湿度或唾液流率标定。`stomachGhrelin` 的空腹计时、起始延迟、峰值与上升时间常数同样没有来源标定，全是 `design`；Cummings 2001 只支撑餐前上升、餐后下降的方向，Leone 2022 只支撑餐后下降方向，两者都不支撑空腹时长曲线，也没有把 `G = 1.8` 校准到任何激素浓度。方程不是论文原方程，也没有独立验证或盲法留出。`brainNotify` 的阈值、冷却和次数上限没有登记人体来源，是 `policy`，不能当成生理常数。

## 7. 当前限制

- **体感提醒已接入四类信号**：`interoception` 仍是 `producer only` 的读出；`brainNotify` 读饥饿、饱满、口渴与尿意并调用 `io.notify`，`notifications.js` 再投递到对应会话。口渴与尿意通道只有离线单元测试与真实 Gateway 集成测试；M19 只验证体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递或排尿闭环，尚无真实 DSH 会话验收；通知历史文件、模型已读确认与多会话路由仍未实现。
- **不是生理测量**：十个输出都是主观评分、驱动代理或反应周期/血氧/内分泌/唾液读数，不能当作物理长度、神经放电、激素浓度、胃容积、膀胱压力、血气或残余尿诊断；`discomfort` 的子宫痉挛分量不是痛经测量，`sexualArousalMm` 不是性欲、性唤起主观评分或临床性功能诊断，`dyspneaMm` 不是呼吸困难评分、呼吸功、血气或临床气促分级，`stressMm` 与 `sleepinessMm` 不是压力量表、困倦量表、皮质醇/褪黑素浓度或睡眠分期，`dryMouthMm` 不是口干量表、口腔黏膜湿度、唾液渗透压或临床干燥症指标。
- **口渴提醒不产生动作**：`hypothalamusThirst.thirst` 与 `interoception.thirst` 只作读出和提醒输入，`brainNotify` 只发固定文本，不自动喝水；首段不建口咽解渴。
- **尿意没有生理阈值**：`urinaryUrgency` 只按膀胱体积归一化，并在 410 mL 处饱和；65/85 mm 只是提醒 policy，不是排尿阈值；没有排尿反射、失禁或夜尿；提醒不自动排尿，`urinate` 仍是会话主动动作。
- **线性叠加是设计**：没有交互项、阈值、饱和或餐型差异；三路输入各自独立相加，口渴、尿意与子宫痉挛分别直通或只进 `discomfort`；`sexualArousalMm` 是独立软读，不参与这条线性叠加。
- **不适不是症状评分**：`discomfort` 只把七个感受超出 70 mm 的强度取最大值，不是疼痛、情绪、疾病严重度或七感受总分；疼痛本身、恶心、腹胀与“撑得难受”仍没有独立读出，痛经只以 `uterus.crampMm` 痉挛代理并入，乳腺胀奶只以 `mammaryGlands.fullnessMm` 并入，食管呛咳只以 `esophagus.chokingMm` 并入，都不发通知；`bowelUrgencyMm`、`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`libidoMm`、`heatMm` 与 `coldMm` 都不是不适分量，也都不发通知。
- **压力与困倦只是读数**：`stressMm` / `sleepinessMm` 不进入 `brainNotify`，不产生压力提醒、睡眠提醒或入睡动作，也不改变活动、进食、饮水或排尿。
- **口干只是读数**：`dryMouthMm` 只把唾液腺湿润度反向钳位，不产生口干提醒，不改变口渴、饮水、`brainNotify` 或不适；不建口咽解渴、口腔黏膜湿度或干燥症。
- **没有餐时表与餐前预期**：不能按钟点预测下一餐；饥饿素现由胃脚本按空腹时长做工程上升，`G` 可高于餐间基准 1，但起始延迟、峰值和时间常数都是 `design`，不是人体曲线。
- **没有渗透压与血压**：两个下丘脑脚本不读血浆/尿渗透压、电解质、血压或 RAAS；`hypothalamusAdh` 只额外读 `blood.bloodVolumeMl` 这一个 `design` 代理，`bloodVolumeMl` 本身不会随体液自动更新。
- **体温调节只有薄切片**：`thermoregulation` 由氧耗、汗液蒸发、寒战与核心—环境温差积分核心温度，并驱动出汗、喘息与冷热读数；不建皮肤分区温度、血管舒缩、寒战做功、发热/低温症、湿度、风速或实测体温曲线。当前 `design` 系数下静息产热高于 37°C 的梯度散热，核心温度会缓慢上升。
- **没有个体化**：年龄、性别、BMI、胃排空、激素与膀胱容量差异都不进入方程；参数是证据默认值，不是某具身体的最终值。

## 8. 体感提醒（`brainNotify`）

`notify.ts` 只做提醒策略：每轮从轮初快照读 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`，按会话判断档位、冷却和配额，把固定文本交给 `io.notify`。它不生成新感受，不改 `interoception`，也不调用 `urinate`、`drink` 或任何动作。

**档位**：饥饿、饱满、口渴与尿意各自分档。四类信号都用 `marked=65`、`strong=85`（`mm`），其中口渴的阈值来自 `brainNotify.thirst.marked` / `brainNotify.thirst.strong`，尿意来自 `brainNotify.urinary.*`。只有明显/强档才可能提醒。`resetBelow=40` 只区分观测 0/1 档，不是必须跌到 40 mm 以下才能再次提醒；门控水位只存 0/2/3（0/明显/强），40–64 mm 的中间档按 0。尿意缺失或非有限按 0 mm；饥饿缺失按 50 mm、饱满按 0 mm；口渴缺失或非有限按 50 mm，因此不提醒，该缺省只用于通知门控，不参与水账或生理计算。

**选择**：只有观测档位高于自身水位的信号才是候选；已提醒到当前档位的信号不参与本轮选择，直到观测先低于该档。候选中最高档优先；同档优先级 `urinary > thirst > fullness > hunger`；每轮最多一条。未被选中的信号不消耗自己的水位，之后仍可按自己的档位提醒。

**逐信号滞回**：每个会话的 `levels = { hunger, fullness, thirst, urinary }` 保存自己的逐信号门控水位；每轮只对当前目标会话按当轮观测调和，其他会话保留原水位。投递只抬高被选中信号的水位，观测档位低于自身水位时回落，低于 `marked`（含 40–64 mm 的中间档）按 0 计。同档重复要先把观测降到已提醒档以下；升到更高档不必先复位，冷却和配额允许时即可提醒。`thirst` 水位独立：`drink` 不触发尿意式的动作后卫士，也不会在动作轮把水位清零，只有观测档位先下降才回落。`lastKind` 记录最近一次提醒的信号，`lastLevel` 是保留的下降闩锁并供旧档迁移，不是纯最近提醒摘要；是否可再次提醒由各信号自己的 `levels` 水位决定。

**共享冷却与配额**：`lastSentAt`、小时计数和天计数按会话共享，不按信号拆分。冷却 45 仿真分钟；同一会话每小时最多 2 次、每天最多 6 次。窗口从会话首次出现或上次重置起算，跨过 3600/86400 仿真秒清零。被冷却或配额挡住的候选不抬高水位，条件满足后仍可提醒。

**旧档迁移**：会话缺少 `levels` 时，用 `lastKind/lastLevel` 惰性补出对应信号的水位（只认明显/强档，其余按 0；`lastKind` 可为 `thirst`）；已有 `levels` 对象缺少 `thirst` 时只补 `thirst: 0`，其他信号水位不变；不反推历史，不升存档 `schemaVersion`。

**排尿后卫士**：轮初快照中 `bladder.voidedMl > 0`，或本轮 `io.actions` 已包含 `urinate` 时，尿意候选按不可用处理：该轮不产生尿意提醒，`levels.urinary` 按 0 回落；其他信号的水位和候选不受影响。原因是排尿后的下一轮 `urinaryUrgency` 仍来自排尿前的轮初体积，而本轮已决定排尿时也不该再补发旧尿意。缺失、非有限 `voidedMl` 按 0；`voidedMl === 0` 且无 `urinate` 动作时不触发。

**轮次偏移**：所有输入都取轮初快照；`notify` 在 `interoception` 之上再晚一轮，因此尿意提醒相对轮初膀胱变化为两轮。真实 Gateway 用例中，预置 410 mL 后第 1 轮只更新 `interoception.urinaryUrgency`（提醒当轮仍读到 0），第 2 轮才发出尿意 `wake`；显式提交 `urinate` 的当轮由动作守卫、结算后的下一轮由 `voidedMl` 守卫抑制过期候选，再下一轮尿意已回落。该偏移不为提醒单独补偿。

**口渴轮次**：口渴链路多一级下丘脑→体感：`hypothalamusThirst.thirst` 在轮初 `waterDeficit` 上重算，`interoception.thirst` 下一轮才读它，`brainNotify` 再下一轮才读体感。真实 Gateway 用例预置一致的 `bodyFluid.waterVolumeMl = 29650`、`waterDeficit = 0.7` 并绑定会话：第 1 轮下丘脑写 85 mm、体感仍读 50 mm；第 2 轮体感写 85 mm、通知仍读 50 mm；第 3 轮通知读到 85 mm，发出一条强口渴 `wake`。两个字段一起预置是为了把验收焦点放在下丘脑→体感→通知；若只预置水量并让 `waterDeficit` 从默认值 0 开始，提醒还会再晚一轮。会话未绑定时不产生通知。口渴提醒相对轮初体液变化为三轮，不能照搬尿意的两轮断言。

**显式饮水后回落**：`drink` 仍由会话显式提交，提醒不会自动调用；收到口渴提醒也不代表已经喝水。水依次进入胃、小肠和体液，口渴只随轮初 `waterDeficit` 下降，不在动作轮清零、不立即消失，也不补发同档提醒。真实 Gateway 用例提交 1000 mL `drink` 后，当轮水仍在胃、`levels.thirst` 保持 3；随后口渴随吸收先维持强档、再经过明显档，观测降到明显档以下后 `levels.thirst` 回 0（40–64 mm 的中间档也按 0），再升到明显/强档才会重新提醒。冷却与配额始终与其他信号共享，其他信号仍可被选中；水账仍满足 `1e-6 mL` 恒等式。

**补算限制**：普通停机后的启动补算仍逐轮执行 `brainNotify` 并提交状态；Gateway 只丢弃补算轮产生的通知。若补算中 `brainNotify` 决定提醒，它仍会更新 `levels`、`lastSentAt` 和小时/天计数，即照常消耗冷却与配额，因此恢复后同一档位可能不补发。该行为属于既有 Gateway 通知架构限制，本设计不修改补算或通知泵；若需补发或延后计数，应另立独立设计。

**投递方式**：`marked` 用 `context`（`agent.inject`，不唤醒空闲会话）；`strong` 用 `wake`（`agent.followup`，唤醒会话）。`wakeAtLevel=3`；改成 4 可关闭唤醒。两种模式共用同一套冷却和配额。

**会话**：从本轮 `io.actions` 里找最后一个带 `sessionId` 的动作；没有就用持久化的 `lastSessionId`。`body_act` 会把当前会话 ID 放进动作载荷；HTTP 直接提交的动作没有会话 ID，不产生提醒。当前只有最近动作的会话收到提醒，不是完整的多会话路由。

**文本**：固定八句，每个信号明显/强各一句，以“身体感受：”开头，不带水量、膀胱数值、诊断结论或饮水/排尿指令：

| 信号 | 明显档（`context`） | 强档（`wake`） |
| --- | --- | --- |
| 饥饿 | 身体感受：胃里有些空，饥饿感开始明显。 | 身体感受：胃里很空，饥饿感很明显。 |
| 饱满 | 身体感受：胃里有些满，饱足感开始明显。 | 身体感受：胃里很满，饱足感很明显，可能不太想再吃。 |
| 尿意 | 身体感受：膀胱有些满，尿意开始明显。 | 身体感受：膀胱很满，尿意很明显。 |
| 口渴 | 身体感受：有些口渴。 | 身体感受：很口渴。 |

文本是 `policy`，不是 LLM 生成。

**边界**：`discomfort` 没有提醒通道，不接入疼痛、疾病或临床预警；子宫痉挛、乳腺胀奶与食管呛咳只进 `discomfort` 第五、第六、第七路，不进入 `brainNotify` 的四类信号；`bowelUrgencyMm`、`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm` 与 `libidoMm` 也只是 `interoception` 的软读，都不进入 `brainNotify`，提醒参数、文本和信号集都不变；`bowelUrgencyMm` 没有便意通知，也不自动排便；`dyspneaMm` 没有气促通知，也不自动改变呼吸或活动；口渴提醒不等于自动饮水，`drink` 仍由会话显式调用；提醒不自动排尿，`urinate` 仍由会话显式调用；提醒不自动排便，`defecate` 仍由会话显式调用；膀胱 600 mL 非自主排空、主动排尿优先级、水链、根清单和工具 schema 都不变；通知载荷仍是 `mode/sessionId/text`，没有 `kind` 字段。离线单元测试覆盖四类信号的阈值、跨信号独立、候选优先级、共享冷却/配额、滞回（含 70→50→70 mm）、缺读、迁移、排后卫士（含本轮 `urinate`）与口渴 JSON-safe；真实 Gateway 测试覆盖尿意“提醒 → 显式排尿 → 尿意回落”和口渴“第 3 轮提醒 → 显式饮水 → 吸收后回落且不自动饮水”；M19 只验证体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递、排尿闭环或口渴投递；尚未做真实 DSH 会话验收。

**未实现**：通知历史文件、`agent/inbox/inserted` 已读确认、按会话绑定不同身体、不适/痛经/恶心/腹胀/疼痛/撑感提醒；真实 DSH 投递/ACK 与口渴、尿意提醒的会话级验收仍不在本轮。Gateway 的 `GET /notifications` 仍是待确认队列；投递泵在 `inject`/`followup` 入队后 ACK，不表示模型已经读取。
