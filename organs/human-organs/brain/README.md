# 脑：体感、睡眠节律与上报（brain）

`brain/` 目前有十一个脚本：`interoception.ts` 把胃壁机械感受、胃饥饿素、十二指肠营养暴露、下丘脑口渴驱动、膀胱充盈、子宫痉挛、乳腺胀奶、食管呛咳与结肠便意/粪便量汇成 0–100 mm 的饥饿、饱满、口渴、尿意、不适、痛经、胀奶、便意等代理，再由七路（含子宫痉挛、乳腺胀奶与食管呛咳，外加非标扩展 `discomfortMm` / `discomfort: true`）超出舒适区的强度取最大值得到不适代理；同时软读性反应周期 `sexualResponse.arousalMm` 写 `sexualArousalMm`，结合性激素（男性 `testes.testosteroneRelative`；女性 `ovaries.estradiolPmolL` / `progesteroneNmolL`）、中枢奖赏 `reward`、`pituitary.prolactinNgMl`、躯体不适、低血糖与压力写 `libidoMm`，软读 `reward.hedonicMm`、`sexualResponse.afterglowMm` 与原始压力写 `hedonicCalmMm`（并提供轻度压力缓冲与静息安静困倦轻推），软读血氧池 `bloodOxygen.oxygenDeficit` 写 `dyspneaMm`，软读肾上腺 `adrenal.cortisolNmolL`（除以 180 归一化）与 `autonomic.sympatheticMm` 写 `stressMm`，联合松果体 `pineal.melatoninRelative` 与睡眠节律 `sleep` 写 `sleepinessMm`，软读唾液腺 `salivaryGlands.mouthMoistureMm` 写 `dryMouthMm`，软读核心温度与动态设定点写 `heatMm` / `coldMm`，软读血钙 `bloodCalcium.mgDl` 写 `hypocalcemiaMm` / `hypercalcemiaMm`，软读血糖 `glucose.concentrationMgDl` 写 `hypoglycemiaMm`，软读心率/收缩压写 `palpitationMm`，并按自身上一轮状态指数衰减叠加汗率写 `sweatDampMm`、叠加运动与三分区肌糖原亏空写 `muscleFatigueMm`。其中 `sexualArousalMm`、`libidoMm`、`mammaryFullnessMm`、`afterglowMm`（用于 `hedonicCalmMm`）与 `discomfort` 内的 `mammaryGlands.fullnessMm` 受 `getNsfwSetting()` 门控（`false` 时置 0）；`esophagus.chokingMm` 只留在 `discomfort` 内，不单独输出也不触发通知。`sleep.ts` 维护清醒/睡眠双稳态、睡眠分期、`sleepInertiaMm` 与 `wakeEvent`（`sleep` / `wake_up` 动作及主动/重要/惊醒唤醒）。`autonomic.ts` 维护交感/副交感/惊醒状态（含性释放后副交感余韵回升）。`reward.ts` 维护中枢欲望（`wantingMm`）、享乐（`hedonicMm`）与享乐饱足抑制（`satietyMm`）。`notify.ts` 读取除食管呛咳、`discomfort`、`hedonicCalmMm` 与钙读数外的主观体感（4 类核心 + 15 类扩展体感 + `bladder.involuntaryVoidedMl` 漏尿边沿 + `sexualResponse.lastOrgasmAtSimMin` 5 min 防陈旧高潮边沿 + 可扩展 `sensations`），按三档双轨指数退避、缓解重置（含泌乳挤奶/哺乳缓解）、睡眠门控、NSFW 门控与多感受零数字聚合策略调用 `io.notify`。`hypothalamus-adh.ts` 把体液亏缺与血容量亏缺映射成相对 ADH 水平；`hypothalamus-thirst.ts` 把同一水量亏缺映射成口渴驱动；`hypothalamus-endocrine.ts` 与 `pituitary.ts` 构成 HPT/HPA 轴与催乳素/催产素中枢环节；`thermoregulation.ts` 由产热与散热积分核心温度，并驱动出汗、喘息与冷热读数。十一个脚本只写自己的部位，不写其他器官。

实现状态：脚本与参数已在 `organs/human-organs/brain/`，十一个大脑脚本（含中枢奖赏 `reward.ts`）均已加入三份清单；`body_bind` / `body_state`（纯定性零数值）/ `body_act` 工具（含进食/饮水翻译官顺手返回的零数字纯文本 `tasteFeedback`）、DSH `systemPrompt` 挂载与通知投递在 `index.js` / `tools.js` / `notifications.js`。当前根清单 43 部位、39 份唯一参数文件，女性清单 46 部位、42 份，男性清单 45 部位、41 份，全库共 47 份唯一参数文件；`uterus`、`ovaries` 与 `mammaryGlands` 只随女性清单 `body-modules.female.json` 加载，`testes` / `epididymis` 只随男性清单 `body-modules.male.json` 加载，`parathyroid` 与 `bloodCalcium` 已挂载进三份清单。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `interoception.ts` | `interoception` | `hunger`、`fullness`、`thirst`、`urinaryUrgency`、`discomfort`、`sexualArousalMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`libidoMm`、`bowelUrgencyMm`、`heatMm`、`coldMm`、`hypocalcemiaMm`、`hypercalcemiaMm`、`hypoglycemiaMm`、`palpitationMm`、`sweatDampMm`、`muscleFatigueMm`、`uterineCrampMm`、`mammaryFullnessMm`、`hedonicCalmMm`；持久化 `muscleFatigueAcuteMm` / `oralThirstReliefFraction`，随口渴提交 `thirstProjectionAtSimulatedSeconds`；可选 `sensations` | 自身上一轮 `sweatDampMm` / `muscleFatigueAcuteMm` / `oralThirstReliefFraction`；轮初 `stomach.deliveredWaterMl` / `lastIntakeAt`、`stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration`、`duodenum.nutrientExposure`、`hypothalamusThirst.thirst`、`bladder.volumeMl`、`uterus.crampMm`、`mammaryGlands.fullnessMm`、`esophagus.chokingMm`、`colon`、`sexualResponse.arousalMm`/`afterglowMm`、`bloodOxygen.oxygenDeficit`、`adrenal.cortisolNmolL`、`autonomic.sympatheticMm`、`pineal.melatoninRelative`、`sleep`、`salivaryGlands.mouthMoistureMm`、`testes.testosteroneRelative`、`ovaries.estradiolPmolL`/`progesteroneNmolL`、`pituitary.prolactinNgMl`、`reward.wantingMm`/`hedonicMm`/`satietyMm`、`thermoregulation.coreTemperatureC`/`setpointC`、`bloodCalcium.mgDl`、`glucose.concentrationMgDl`、`heart.heartRatePerMin`、`blood.systolicMmHg`、`physicalActivity`、`skin.sweatVolumeMl`、`muscleHead`/`muscleTrunk`/`muscleLimbs.glycogenG`、他部位 `discomfortMm` / `sensations`；`getNsfwSetting()`、`io.dt` | `interoception.parameters.json` |
| `notify.ts` | `brainNotify` | `lastSessionId`、`sessions`（含双轨时间戳/退避步数、`lastInvoluntaryVoidedMl`、`lastOrgasmAtSimMin`、`levels`、`sensations`、`sensationLevels`、`wasSleeping`、`sleepBacklog`） | `interoception`（4 核 + 15 扩展 + 可选 `sensations`）、轮初 `bladder.voidedMl`/`involuntaryVoidedMl`、`colon.defecatedG`、`sleep.sleeping`、`blood.systolicMmHg`、`uterus.crampMm`、`mammaryGlands.fullnessMm`/`ejectedMilkMl`/`lactating`、`sexualResponse.phase`/`lastOrgasmAtSimMin`；`io.actions`（`sessionId` 与缓解动作，含 `express_milk` / `breastfeed`）、`io.boundSessionId`、`io.suppressNotifications`、`io.simulatedSeconds`、`getNsfwSetting()` | `notify.parameters.json` |
| `sleep.ts` | `sleep` | `sleeping`、`sleepPressureMm`、`sleepDurationMin`、`sleepStage`、`sleepInertiaMm`、`wakeEvent` | 自己的轮初状态；轮初 `pineal.melatoninRelative`、`autonomic.sympatheticMm` 及危机/不适相关部位；`io.actions` 中的 `sleep` / `wake_up` / 主动唤醒动作；`io.dt` | `sleep.parameters.json` |
| `autonomic.ts` | `autonomic` | `sympatheticMm`、`parasympatheticMm`、`startleActive` | 自己的轮初状态；`sleep`、`pineal`、`physicalActivity`、`glucose`、`bloodOxygen`、`blood`、`thermoregulation`、`interoception`、`uterus`、`sexualResponse`（含 `afterglowMm` 与经 `evaluateSexualRelease` 判定的释放）、`reward.hedonicMm`、`pituitary.oxytocinPgMl`、`ovaries`、`testes`、`io.actions`、`io.dt`、`io.simulatedSeconds`、`getNsfwSetting()` | `autonomic.parameters.json` |
| `hypothalamus-adh.ts` | `hypothalamusAdh` | `relativeConcentration` | `bodyFluid.waterDeficit`；轮初 `blood.bloodVolumeMl`（可选） | `hypothalamus-adh.parameters.json` |
| `hypothalamus-thirst.ts` | `hypothalamusThirst` | 慢驱动 `thirst` | `bodyFluid.waterVolumeMl`（缺失时读 `waterDeficit`） | `hypothalamus-thirst.parameters.json` |
| `thermoregulation.ts` | `thermoregulation` | `coreTemperatureC`、`setpointC` | 自己的轮初温度；`sleep.sleeping`；轮初 `bloodOxygen.oxygenConsumptionMlMin`（可选）、`skin.sweatVolumeMl`（可选）；`io.wallTimeMs`、`io.dt` | `thermoregulation.parameters.json` |
| `hypothalamus-endocrine.ts` | `hypothalamusEndocrine` | `trhRelative`、`crhRelative`、`carElapsedMin` | 自己的轮初状态；`thyroid`、`adrenal.cortisolNmolL`（除以 180 归一化）、`thermoregulation`、`glucose`、`physicalActivity`、`autonomic.sympatheticMm`、`sleep`（含 `carLatentMin` 10 min 潜伏起坡）、`reward.hedonicMm` 与 `pituitary.oxytocinPgMl`（非低血糖应激温和缓冲）；`io.wallTimeMs`、`io.dt` | `hypothalamus-endocrine.parameters.json` |
| `pituitary.ts` | `pituitary` | `tshRelative`、`acthPgMl`、`prolactinNgMl`、`oxytocinPgMl` | 自己的轮初状态；`hypothalamusEndocrine`、`thyroid`、`adrenal.cortisolNmolL`、`mammaryGlands.lactating` / `stimulationMin`（与 `milkMl` 解耦）、`sleep`、`sexualResponse`、`io.actions`、`io.dt`、`io.wallTimeMs`、`io.simulatedSeconds` | `pituitary.parameters.json` |
| `reward.ts` | `reward` | `wantingMm`、`hedonicMm`、`satietyMm` | 自己的轮初状态；`sexualResponse`（经 `evaluateSexualRelease`）、`ovaries`、`testes`、`pituitary`、`physicalActivity`、`duodenum`、`stomachGhrelin`、`adrenal.cortisolNmolL`、`interoception.discomfort`、`uterus.crampMm`、`sleep`、`io.actions`、`io.dt`、`io.simulatedSeconds` | `reward.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `hunger` | `mm` | 饥饿的 0–100 mm VAS 代理 |
| `fullness` | `mm` | 饱满的 0–100 mm VAS 代理 |
| `thirst` | `mm` | 主观口渴的 0–100 mm 代理；用快速缓解比例减弱轮初 `hypothalamusThirst.thirst` 的慢驱动 |
| `oralThirstReliefFraction` | `1` | 持久化快缓解状态，范围 [0,1]；`null` 表示尚未初始化，不是缺水观测 |
| `thirstProjectionAtSimulatedSeconds` | `s` | 与主观口渴同轮写入的轮末仿真秒（`io.simulatedSeconds`）；初值 `null`，用于补算已知快缓解状态的时间缺口，以及 `body_state` 核对读数是否属于当前提交 |
| `urinaryUrgency` | `mm` | 尿意的 0–100 mm 代理；由轮初 `bladder.volumeMl` 归一化 |
| `discomfort` | `mm` | 不适的 0–100 mm 代理；七个感受（饥饿、饱满、口渴、尿意、子宫痉挛、乳腺胀奶、食管呛咳）超过 70 mm 舒适区后的强度取最大值 |
| `sexualArousalMm` | `mm` | 性反应周期的唤醒读数 0–100 mm；把 `sexualResponse.arousalMm` 原样钳位后读出，不是性欲、情绪或生殖器测量 |
| `libidoMm` | `mm` | 性欲的 0–100 mm 代理；男性由 `testes.testosteroneRelative`、女性由 `ovaries` E2/P4 驱动并叠加 `reward.wantingMm` 增强与 `reward.satietyMm` / `pituitary.prolactinNgMl` / `discomfort` / `hypoglycemiaMm` / `stressMm` 抑制（受 `nsfw` 门控），不是性激素浓度或临床性欲评估 |
| `bowelUrgencyMm` | `mm` | 便意的 0–100 mm 代理；优先读 `colon.bowelUrgencyMm`，缺失或非有限时回落 `clamp(100 × colon.stoolG / 200, 0, 100)`，不是直肠压力、肛门直肠测压值或临床便意评分 |
| `dyspneaMm` | `mm` | 气促的 0–100 mm 代理；`clamp(100 × bloodOxygen.oxygenDeficit, 0, 100)`，不是呼吸困难量表、呼吸功或血气指标 |
| `stressMm` | `mm` | 压力的 0–100 mm 代理；结合 `adrenal.cortisolNmolL / 180` 归一化皮质醇与 `autonomic.sympatheticMm`，并受 `hedonicCalmMm × 0.2` 轻度缓冲，不是应激量表、皮质醇浓度或临床压力评估 |
| `sleepinessMm` | `mm` | 困倦的 0–100 mm 代理；未加载 `sleep` 时保留松果体公式；加载 `sleep` 时结合 `pineal.melatoninRelative`（Process C）、`sleep.sleepPressureMm`（Process S）、`sleepInertiaMm` 与清醒期交感/上行唤醒拮抗（`sympatheticMm` / 运动 / 性唤起 / 高皮质醇），非实测睡眠量表 |
| `dryMouthMm` | `mm` | 口干的 0–100 mm 代理；`salivaryGlands.mouthMoistureMm` 有限时为 `clamp(100 − mouthMoistureMm, 0, 100)`，未加载、缺失或非有限时按 `0`；不是口干量表、口腔黏膜湿度、唾液渗透压或临床干燥症指标 |
| `heatMm` | `mm` | 热不适的 0–100 mm 代理；`clamp(50 × (coreTemperatureC − 37), 0, 100)`，不是体温测量、热感觉量表或临床热应激分级 |
| `coldMm` | `mm` | 冷不适的 0–100 mm 代理；`clamp(50 × (37 − coreTemperatureC), 0, 100)`，不是体温测量、冷感觉量表或临床低体温分级 |
| `hypocalcemiaMm` | `mm` | 低钙症状代理 0–100 mm；`clamp(50 × (9.5 − bloodCalcium.mgDl), 0, 100)`（未加载或非有限按 `9.5`，即 `0`），不是麻木/抽搐或临床低钙评分 |
| `hypercalcemiaMm` | `mm` | 高钙症状代理 0–100 mm；`clamp(50 × (bloodCalcium.mgDl − 9.5), 0, 100)`（未加载或非有限按 `9.5`，即 `0`），不是临床高钙评估 |
| `hypoglycemiaMm` | `mm` | 低血糖乏力心慌代理 0–100 mm；`glucose.concentrationMgDl` 有限时为 `clamp((75 − concentrationMgDl) × 4, 0, 100)`，未加载或非有限按 `0`；不是血糖测量或临床低血糖分级 |
| `palpitationMm` | `mm` | 心悸/低血压循环不适代理 0–100 mm；非中高强度运动时取静止心动过速与低收缩压最大值，中高强度运动中只取低血压项；不是心电监护或休克评分 |
| `sweatDampMm` | `mm` | 出汗潮湿黏腻代理 0–100 mm；将轮初 `skin.sweatVolumeMl` 折算汗率按体重缩放后的有效蒸发饱和参考 `referenceEvapRateMlMin`（4.5 mL/min）映射为 Gagge 皮肤湿润度稳态平衡目标，并与自身上一轮按 5 min 半衰期平滑趋近（无累积过冲） |
| `muscleFatigueMm` | `mm` | 肌肉疲乏代理 0–100 mm；急性负担加轮初肌糖原亏空贡献，钳位后不回灌 |
| `muscleFatigueAcuteMm` | `mm` | 持久化独立急性负担；运动加荷、按 30 min 半时恢复。仅首次初始化或迁移尚未完成时为 `null` |
| `uterineCrampMm` | `mm` | 子宫痉挛/痛经暴露读数 0–100 mm；将轮初 `uterus.crampMm` 钳位暴露到 `interoception` 状态（同步仍进入 `discomfort` 第五路），未加载或非有限按 `0` |
| `mammaryFullnessMm` | `mm` | 乳腺胀满暴露读数 0–100 mm；受 `nsfw` 开关门控，开启时将轮初 `mammaryGlands.fullnessMm` 钳位暴露并进入 `discomfort` 第六路，未加载或关闭 `nsfw` 按 `0` |
| `hedonicCalmMm` | `mm` | 享乐松弛余韵代理 0–100 mm；结合 `reward.hedonicMm`（高出基线 15 mm 部分）、受 `nsfw` 门控的 `sexualResponse.afterglowMm` 与原始压力扣减得到，并作用于 `stressMm` 轻度缓冲及清醒期轻度放松困倦微调；不进 `discomfort` 也不独立触发通知 |

`interoception` 的 23 个 `mm` 体感读数及同刻度的急性负担状态**不是物理长度、神经放电、激素浓度、膀胱压力或逼尿肌张力**，也不是胃容积、直肠压力、残余尿诊断值、汗液测量、肌肉乳酸或离子钙测量。`mm` 只沿用 100-mm 视觉模拟量表的刻度；把它们与胃内容量、血浆饥饿素、AVP pmol/L、膀胱 mL、粪便 g、压力、血气分压、皮质醇浓度、褪黑素浓度、血钙浓度、血糖浓度、心率/血压、汗量或口腔湿润度互换没有方法学依据。`discomfort` 是“当前最强的不适感受”代理，不是疼痛评分、情绪、疾病严重度或各感受总分；子宫痉挛只是 0–100 mm 的痛经代理，乳腺胀奶只是 0–100 mm 的胀奶代理，食管呛咳只是 0–100 mm 的风险代理，都不是痛觉、乳腺压力或临床呛咳测量。其中 `sexualArousalMm`、`libidoMm`、`mammaryFullnessMm` 与 `discomfort` 内的乳腺胀奶贡献受 `getNsfwSetting()` 门控（`false` 时置 0）；`esophagus.chokingMm` 只留在 `discomfort` 内，不单独输出字段，也不触发通知。

以下方程只用轮初快照；`oralThirstReliefFraction`、`sweatDampMm` 与 `muscleFatigueAcuteMm` 从上一轮自身状态接续。`dtMin = io.dt / 60`：

```text
S              = clamp(finiteOr(hypothalamusThirst.thirst, 0), 0, 100)  // 轮初慢驱动
U              = 本轮初所见上一轮实际交付的 stomach.deliveredWaterMl（mL；无新鲜记录为 0）
R_saved        = 已提交的 oralThirstReliefFraction（未初始化为 0）
gapMin         = (轮初仿真秒 − 合法且更早的提交戳) / 60；否则 0
R              = R_saved × 2^(−gapMin / 2)                        // 衰减到轮初才接收 U
R_next         = 2^(−dtMin / 2) × [1 − (1 − R) × 2^(−U / 20)]
thirst         = (1 − R_next) × S
urinaryUrgency = clamp(100 mm × bladder.volumeMl / 410 mL, 0, 100)
uterineCrampMm = clamp(finiteOr(uterus.crampMm, 0), 0, 100) // 无子宫或缺失按 0
mammaryFullness = nsfwEnabled ? clamp(finiteOr(mammaryGlands.fullnessMm, 0), 0, 100) : 0
esophagealChoking = clamp(finiteOr(esophagus.chokingMm, 0), 0, 100)  // 仅入 discomfort
bowelUrgencyMm = colon.bowelUrgencyMm 有限
  ? clamp(colon.bowelUrgencyMm, 0, 100)
  : clamp(100 × finiteOr(colon.stoolG, 0) / 200, 0, 100)    // 无结肠或均缺失按 0
sexualArousalMm = nsfwEnabled ? clamp(finiteOr(sexualResponse.arousalMm, 0), 0, 100) : 0
afterglowMm     = nsfwEnabled ? clamp(finiteOr(sexualResponse.afterglowMm, 0), 0, 100) : 0
endocrineLibidoMm = testes 已加载 ? clamp(100 × (testes.testosteroneRelative − 0.5), 0, 100)
                  : ovaries 已加载 ? clamp(20 + 48 × (max(0, estradiolPmolL − 120) / 700)^0.75 − 1.15 × max(0, progesteroneNmolL − 4), 0, 100)
                  : 0
libidoMm        = nsfwEnabled ? clamp(endocrineLibidoMm + 0.25 × max(0, reward.wantingMm − 25) − 0.45 × reward.satietyMm − 0.7 × max(0, prolactinNgMl − 15) − (0.5 × discomfort + 0.5 × hypoglycemiaMm + 0.35 × max(0, stressMm − 25)), 0, 100) : 0
dyspneaMm       = clamp(100 × finiteOr(bloodOxygen.oxygenDeficit, 0), 0, 100)
cortisolRel     = finiteOr(adrenal.cortisolNmolL / 180, 0)
rawStressMm     = clamp(max(100 × (cortisolRel − 1) / 2, 0.75 × autonomic.sympatheticMm), 0, 100)
hedonicCalmMm   = clamp(0.85 × max(0, reward.hedonicMm − 15) + 0.55 × afterglowMm − 0.5 × rawStressMm, 0, 100)
stressMm        = clamp(rawStressMm − 0.2 × hedonicCalmMm, 0, 100)
mammaryFullnessMm = mammaryFullness
melatoninMm     = clamp(100 × (finiteOr(pineal.melatoninRelative, 0) − 0.2) / 1.6, 0, 100)
sleepinessMm    = sleep 未加载 ? melatoninMm
                : clamp((pineal 已加载 ? 0.4 × melatoninMm + 0.8 × sleepPressureMm : sleepPressureMm) + sleepInertiaMm + (sleeping ? 0 : 0.12 × hedonicCalmMm − arousalAntagonismMm), 0, 100)
dryMouthMm     = salivaryGlands.mouthMoistureMm 有限
  ? clamp(100 − salivaryGlands.mouthMoistureMm, 0, 100)
  : 0                                                       // 未加载、缺失或非有限按 0
heatMm         = clamp(50 × (finiteOr(thermoregulation.coreTemperatureC, 37) − 37), 0, 100)
coldMm         = clamp(50 × (37 − finiteOr(thermoregulation.coreTemperatureC, 37)), 0, 100)
hypocalcemiaMm = clamp(50 × (9.5 − finiteOr(bloodCalcium.mgDl, 9.5)), 0, 100)
hypercalcemiaMm = clamp(50 × (finiteOr(bloodCalcium.mgDl, 9.5) − 9.5), 0, 100)
hypoglycemiaMm = glucose.concentrationMgDl 有限
  ? clamp((75 − glucose.concentrationMgDl) × 4, 0, 100) : 0
moderateOrHigherExercise = physicalActivity.remainingExerciseMin > 0 && physicalActivity.intensity >= 0.2
hrPart         = !moderateOrHigherExercise && heart.heartRatePerMin 有限
  ? clamp((heart.heartRatePerMin − 115) × 1.5, 0, 100) : 0
bpPart         = blood.systolicMmHg 有限
  ? clamp((95 − blood.systolicMmHg) × 5, 0, 100) : 0
palpitationMm  = max(hrPart, bpPart)
sweatRateMlMin  = skin 已加载 && dtMin > 0 ? max(0, finiteOr(skin.sweatVolumeMl, 0)) / dtMin : 0
targetSweatDamp = clamp(100 × sweatRateMlMin / max(0.1, scaleByBodyWeight(4.5)), 0, 100)
sweatDampMm     = clamp(targetSweatDamp + (prev.sweatDampMm − targetSweatDamp) × 2^(−dtMin / 5), 0, 100)
D              = 轮初有效肌区相对总基线的亏空比例 × 100（百分点，范围 0–100）
I              = clamp(physicalActivity.intensity, 0, 1)
activeMin      = clamp(physicalActivity.remainingExerciseMin, 0, dtMin)
λ              = ln(2) / 30
A_next         = A × exp(−λ × dtMin)
               + (2.1 × I / λ) × (1 − exp(−λ × activeMin)) × exp(−λ × (dtMin − activeMin))
muscleFatigueMm = clamp(A_next + 0.5 × D, 0, 100)
excess(x)      = clamp(100 × (x − 70) / (100 − 70), 0, 100)
discomfort     = max(excess(hunger), excess(fullness), excess(thirst),
                     excess(urinaryUrgency), excess(uterineCrampMm), excess(mammaryFullness),
                     excess(esophagealChoking), excess(extensible.discomfortMm))
```

说明：
- `nsfwEnabled = getNsfwSetting() !== false`：在 BodyWorker 中未配置或显式为 `false` 时，`sexualArousalMm`、`libidoMm`、`mammaryFullnessMm` 与 `discomfort` 内的 `mammaryFullness` 置 `0`；脱离 Worker 的独立单元测试中 `getNsfwSetting()` 为 `null`（`!== false`），保持可读。
- `sweatDampMm` 的平衡半衰期 5 min 属 `design`；`referenceEvapRateMlMin = 4.5 mL/min` 按体重缩放，机制对标 `SRC-GAGGE-1967` / `SRC-CRAMER-2019` / `SRC-FUKAZAWA-2009`，替代旧版 117 倍累积过冲。
- **疲劳恢复（`design`）：** 急性负担 `A` 与读数 `F`（`muscleFatigueMm`）分离。活动的前 `activeMin` 分钟一边加荷一边恢复，剩余时间只恢复。满强度、未亏糖的首个活动分钟约 2.076 mm（旧版 2.1 mm）；长轮不再把整轮负荷加在末尾。糖原亏空按有效肌区的总存量与总基线计算，基线 `muscleHead` 15 g、`muscleTrunk` 135 g、`muscleLimbs` 150 g 按体重缩放；无有效肌区时 `D=0`，运动仍可产生 `A`。固定 `D`、无活动时 `F` 趋向 `clamp(0.5 × D, 0, 100)`，不逐轮累加亏空。缺 `A` 的旧档首轮用 `max(0, clamp(F_old, 0, 100) − 0.5 × D)` 有界估计；若 `F_old=100`，不能反推出唯一急性负担，也无法剥离旧规则曾重复累加的亏空。新档 `F=0` 推得 `A=0`，首次提交后继续持久化 `A`，重启不再从 `F` 估计。例：旧 `F=45`、`D=10`，估 `A=40`，休息 20 min 得 `F≈30.1984`。
- **快速解渴（`design`）：** 入胃水提交后下一轮才产生缓解。`U` 只取实际交付量，复用原胃 `lastIntakeAt` 核对轮初仿真秒；缺失或旧读数不补剂量。相同轮内水量先合计；跨轮分片之间会衰减，不能把同剂量瞬饮与分片当成同一时间曲线。20 mL 从 `R=0` 开始，首次可见 `R≈0.35355`（已含 1 min 衰减）；供水不足时 `R` 变小，口渴可以回来。保存/重启接续已提交的 `R` 与仍待读的一轮胃观察；新档或旧档没有 `R` 时按 0 开始。若脚本缺席时仿真仍推进，重新启用只按非负有限提交戳与轮初仿真秒之差衰减已知残余，不回放缺席期间的饮水；随后只接收仍新鲜的 `U`，按本轮 `dtMin` 衰减一次。同一快照重启、暂停或失败重试不计入额外时间；无戳、未来戳也不补算，不看墙钟。快信号只影响主观口渴及其既有消费者，不写慢驱动、体液、ADH、尿请求或口干；口干仍由轮初唾液湿润度计算。`body_state` 只在 `thirstProjectionAtSimulatedSeconds` 等于已提交快照的 `simulatedSeconds` 且 `R` 有效（包括 0）时优先用有限的 `interoception.thirst`；不看墙钟。无时间戳的旧档、尚未提交或时间戳过期时照旧优先慢驱动，慢驱动缺失时才回退内感受。换清单移除生产者后，原读数只在同一快照上有效；第一轮新提交后便不会再遮住慢驱动。动作、提醒政策与阈值不变，没有新增工具或自动饮水。
- `sleepinessMm` 在未加载 `sleep` 时逐点保持原 `pineal` 公式；同时加载 `sleep` 时融合 `pineal`、`sleepPressureMm`、`sleepInertiaMm` 与清醒期交感/性唤起/高皮质醇拮抗及轻度 `0.12 × hedonicCalmMm` 放松助眠偏置（以上权重均为脚本内 `design` 常数）。
- M19 真实 DSH 会话（2026-11-22，33/33 verdicts，证据 `/tmp/dsh-body/m19-real-dsh.syuWHR/`）早于本次更新，仅验证过当时 `thirst` / `urinaryUrgency` / `discomfort` 读数与 `interoception` 一轮偏移。

默认 `initialState` 中 `hunger` 为 50 mm，`oralThirstReliefFraction`、`thirstProjectionAtSimulatedSeconds` 与 `muscleFatigueAcuteMm` 为 `null`（未初始化或尚无本版本的提交标记），其余固定字段为 0；无扩展感受时不写 `sensations` 键。

### `sleep`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `sleeping` | `1` | 布尔睡眠状态，初值 `false` |
| `sleepPressureMm` | `mm` | Process S 睡眠压力代理 0–100 mm，初值 `0`；不是 EEG 慢波活动或实测困倦 |
| `sleepDurationMin` | `min` | 本次连续睡眠分钟数，初值 `0`；清醒时归 `0` |

动作与稳态逻辑（全部为 `design`、`source: null`）：

```text
// 1. 动作处理（按 io.actions 顺序）
//    'sleep'：仅当当前 !sleeping 时置 sleeping = true, sleepDurationMin = 0（已在睡不重置时长）
//    'wake_up'：置 sleeping = false, sleepDurationMin = 0
// 2. 步进更新（dtMin = max(0, io.dt / 60)）
若 sleeping === true：
  sleepDurationMin += dtMin
  sleepPressureMm   = clamp(sleepPressureMm × 0.5^(dtMin / sleepRecoveryHalfTimeMin), 0, 100)
  melatoninClear    = (pineal 未加载) || (pineal.melatoninRelative <= naturalWakeMelatoninCeilingRelative)
  若 sleepPressureMm < naturalWakePressureThresholdMm
     && sleepDurationMin >= naturalWakeMinDurationMin
     && melatoninClear：
    sleeping = false
    sleepDurationMin = 0
否则（sleeping === false）：
  sleepDurationMin = 0
  sleepPressureMm  = clamp(sleepPressureMm + wakePressureRateMmMin × dtMin, 0, 100)
```

`sleep.ts` 不建 EEG 睡眠分期（REM / NREM）、睡眠惯性（sleep inertia）或外源唤醒反射；它自身也不读 `brainNotify`——睡眠期间若出现 3 档或高危紧急体感，由 `brainNotify` 发出 `mode: 'wake'` 通知唤醒模型，由模型或用户显式提交 `wake_up`（或满足上述自然转醒条件时自动转醒）。`sleep` 动作同时也会被 `skeletal-muscle/activity.ts` 读取并清空进行中的运动。

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
| `coreTemperatureC` | `°C` | 核心温度代理，初值 37°C，安全钳位 `[25, 45]` °C；不是实测核心体温、皮肤温度或临床分级 |
| `setpointC` | `°C` | 结合本地时钟与睡眠状态调整后的动态调定点 °C |

```text
effectiveSetpointC    = setpointC
                      + circadianAmplitudeC × cos(2π × (localHour − circadianPeakHour) / 24)
                      − (sleeping ? sleepSetpointOffsetC : 0)
heatProductionKcalMin = metabolicFactor × oxygenConsumptionMlMin
                      + shiveringGain × max(0, effectiveSetpointC − coreTemperatureC)
sweatRateMlMin        = dtMin > 0 ? sweatVolumeMl / dtMin : 0
vasodilationKcalMin   = clamp(vasodilationGain × max(0, coreTemperatureC − effectiveSetpointC), 0, maxVasodilationKcalMin)
heatLossKcalMin       = evaporationKcalPerMl × sweatRateMlMin
                      + lossGain × (coreTemperatureC − ambientTemperatureC)
                      + vasodilationKcalMin
coreTemperatureC      = clamp(
  prev.coreTemperatureC + dtMin × (heatProductionKcalMin − heatLossKcalMin) / heatCapacityKcalPerC,
  25, 45
)
```

产热读轮初 `bloodOxygen.oxygenConsumptionMlMin`（未加载按体重缩放 `250 mL/min`）；散热按 `dtMin` 将轮初 `skin.sweatVolumeMl`（未加载按 0）换算为汗液蒸发速率 `sweatRateMlMin`，叠加基础对流辐射散热与**高于动态设定点时开放的外周血管舒张额外干散热（`vasodilationGain = 0.50 kcal/(min·°C)`，物理上封顶 `maxVasodilationKcalMin = 0.55 kcal/min` ≈ +38 W，机制与上限对标 `SRC-KRAUCHI-1994` / `SRC-CRAMER-2019`）**，消除了旧版 38 °C 降至 37 °C 耗时长达近 10 小时的失真拖延。热容与热量斜率按体重缩放，共 12 项参数全部标 `design`。

### `hypothalamusThirst`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `thirst` | `mm` | 口渴驱动，0–100 mm 代理，正常水合初值 `0 mm`；高渗升高映射自 [`hypothalamus-thirst.ts`](hypothalamus-thirst.ts)，仍非直接血液化验 |

```text
lossMl = referenceFluidVolumeMl − bodyFluid.waterVolumeMl   // 按体重同步缩放 30000 mL（缺失水容积时用 waterDeficit × fluidDeficitScaleMl）
若 lossMl <= 0：
  thirst = baselineMm (= 0)
否则：
  equivalentOsm = referenceOsmolalityMOsmKg × osmoticPoolReferenceMl / max(1000, osmoticPoolReferenceMl − lossMl)
  thirst = clamp(baselineMm + osmolalitySlopeMmPerMOsmKg × max(0, equivalentOsm − osmolalityThresholdMOsmKg), 0, 100)
```

水合稳态基线归 `0 mm`（替代旧版常驻 `50 mm` 虚渴），纯水亏损按体液有效渗透池容积折算等效血浆渗透压，并与 `SRC-HUGHES-2018`（12 项高渗试验荟萃 `n=167`：`285.23 mOsm/kg` 阈值与 `5.4 mm/(mOsm/kg)` 线性斜率，标 `prior`）及 `SRC-CHEUVRONT-2013` 温和脱水期渗透压机制对齐。此字段只表示慢驱动；吸收前快速缓解由 `interoception` 另算，绝不改此驱动或渗透压代理。

`brainNotify` 的字段：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `lastSessionId` | `1` | 优先取 `io.boundSessionId`，无绑定时取最近一次带 `sessionId` 的动作所属会话；没有则为 `null` |
| `sessions` | `1` | 每个会话的提醒状态：`lastSentAt`、`backoffStep`、`lastUrgentSentAt`、`urgentBackoffStep`、`lastInvoluntaryVoidedMl`、`lastOrgasmAtSimMin`、`lastAttemptedOrgasmAtSimMin`、`lastSeenAt`、`levels`、`sensations`、`sensationLevels`、`wasSleeping`、`sleepBacklog` |

`sessions` 是内部策略状态，不是生理读数；按 `maxTrackedSessions` 保留最近 32 个会话。每个会话各自保存 `levels`（`{ hunger, fullness, urinary, thirst }`）、`sensations`（17 项扩展体感水位字典）与可选 `sensationLevels`（非标扩展感受水位字典，均存 0/2/3）；每轮只对当前目标会话（优先 `io.boundSessionId`，否则本轮最后带 `sessionId` 的动作，再否则持久化的 `lastSessionId`）按当轮观测调和，其他会话不被当轮观测改写。`lastKind` / `lastLevel` 保留兼容旧档迁移。旧会话缺少 `levels` 时按 `lastKind/lastLevel` 惰性补出对应信号的水位；顶层 `initialState` 为 `{ lastSessionId: null, sessions: {} }`。

## 3. 输入与方程

输入均来自同一轮的轮初快照；缺失或非有限时按默认值处理：

| 输入 | 含义 | 缺失 / 非有限默认值 |
| --- | --- | --- |
| `stomachSensory.mechanical` | 胃壁机械感受代理，0–1；不是张力或神经放电 | 0 |
| `stomachGhrelin.relativeConcentration` | 相对饥饿素浓度；餐间基准 1、餐后谷值 0.5，空腹时可高于 1（工程上升，目标约 1.8）；不是 `ng/mL` | 1 |
| `duodenum.nutrientExposure` | 十二指肠近期营养暴露代理，`kcal/min`；不是吸收速率或血糖 | 0 |
| `hypothalamusThirst.thirst` | 轮初下丘脑慢口渴驱动，0–100 mm 代理 | 0 |
| `stomach.deliveredWaterMl` / `lastIntakeAt` | 上一轮已提交的实际入胃水量（mL）；原时间戳仅核对轮次 | 无新鲜入胃水观测时不加剂量 |
| `bladder.volumeMl` | 轮初膀胱体积，mL；不是压力 | 0 |
| `uterus.crampMm` | 子宫痉挛代理，0–100 mm；不是疼痛测量、VAS 实测或临床痛经分级。仅女性清单加载 | 0 |
| `mammaryGlands.fullnessMm` | 乳腺胀奶代理，0–100 mm；受 `nsfw` 开关门控。仅女性清单加载 | 0 |
| `sexualResponse.arousalMm` / `afterglowMm` | 性反应周期唤醒与余韵代理，0–100 mm；受 `nsfw` 开关门控。三份清单均可加载 | 0 |
| `bloodOxygen.oxygenDeficit` | 血氧池未满足氧需比例，0–1；不是血气分压、血氧饱和度或组织缺氧量。根清单加载 | 0 |
| `adrenal.cortisolNmolL` | 皮质醇浓度的物理标度代理（`nmol/L`，基线 `180 nmol/L`）；本脚本除以 180 转为相对量，仍非实测皮质醇 | 0 |
| `pineal.melatoninRelative` | 褪黑素相对量，0–2，1 为工程基线；不是褪黑素浓度、光照剂量或睡眠测量。根清单加载 | 0 |
| `sleep.sleepPressureMm` | Process S 睡眠压力代理，0–100 mm；加载时与 `pineal`、`sleepInertiaMm` 及清醒拮抗/松弛助眠偏置共同决定 `sleepinessMm` | 未加载时回退纯 `pineal` 公式；已加载但缺字段按 0 |
| `salivaryGlands.mouthMoistureMm` | 口腔湿润度代理，0–100 mm；不是口腔黏膜湿度、唾液流率或口干量表。根清单加载 | 缺失时 `dryMouthMm = 0`（不按最大口干） |
| `testes.testosteroneRelative` / `ovaries.estradiolPmolL` / `ovaries.progesteroneNmolL` | 男性睾酮相对量 / 女性卵巢 E2(`pmol/L`) 与 P4(`nmol/L`)；与 `reward`、`pituitary.prolactinNgMl` 共同决定受 `nsfw` 门控的 `libidoMm` | 未加载或关闭 `nsfw` 时对应性驱动为 0 |
| `reward.wantingMm` / `hedonicMm` / `satietyMm` | 中枢奖赏欲望、享乐与饱足抑制 0–100 mm 代理 | 25 / 15 / 0（无叠加偏置） |
| `esophagus.chokingMm` | 食管呛咳风险代理，0–100 mm；只留在 `discomfort` 第七路，不单独输出或通知。根清单加载 | 0 |
| `colon.bowelUrgencyMm` / `colon.stoolG` | 结肠便意代理 0–100 mm 与粪便量 g；优先读 `bowelUrgencyMm` | 0 |
| `thermoregulation.coreTemperatureC` | 核心温度代理，°C；不是实测核心体温、皮肤温度或临床分级。根清单加载 | 37 |
| `bloodCalcium.mgDl` | 血钙浓度代理，mg/dL；不是实验室参考区间。三份清单均已挂载 | 9.5 |
| `glucose.concentrationMgDl` | 血糖浓度代理，mg/dL；用于计算 `hypoglycemiaMm`。根清单加载 | 缺失/非有限时 `hypoglycemiaMm = 0` |
| `heart.heartRatePerMin` / `blood.systolicMmHg` / `physicalActivity` | 心率、收缩压与活动状态；用于计算 `palpitationMm`（中高强度运动中屏蔽静止心动过速项） | 缺失/非有限对应分量为 0 |
| `skin.sweatVolumeMl` | 本轮前出汗到账体积，mL；用于换算瞬时汗率并叠加到 `sweatDampMm` | 0 |
| `muscleHead` / `muscleTrunk` / `muscleLimbs.glycogenG` | 三分区肌糖原储量，g（按 `scaleByBodyWeight` 缩放 15 / 135 / 150 g 基线）；用于计算 `muscleFatigueMm` | 未加载区域跳过（无已加载区域则亏空为 0） |

先钳输入：`M = clamp(mechanical, 0, 1)`、`G = max(0, relativeConcentration)`、`N = max(0, nutrientExposure)`；其余 19 项与 `discomfort` 见 §2。然后：

```text
hunger   = clamp(hungerBaseline   + hungerGhrelinGain   × (G − 1)
                                  + hungerMechanicalGain × M
                                  + hungerNutrientGain   × N, 0, 100)
fullness = clamp(fullnessBaseline + fullnessGhrelinGain × (G − 1)
                                  + fullnessMechanicalGain × M
                                  + fullnessNutrientGain   × N, 0, 100)
```

各感受输出互不串写：`thirst` 不参与饥饿/饱满方程，其余读数也不参与；`discomfort` 只读本轮已算出的七路感受及非标扩展贡献取最大值，不回写它们；独立读数（除已写入 `discomfort` 的 `uterineCrampMm` / 乳腺 / 食管外）不进入 `discomfort`。输入到输出有**一轮偏移**（这是 `interoception` 自身的偏移；`notify` 在它之上再晚一轮，见 §8）：同一轮的摄入先由胃脚本记账，下一轮的轮初快照里才出现新的 `mechanical`、`relativeConcentration` 与 `nutrientExposure`；其余上游部位本轮写出的状态同样最早下一轮才被体感读到，不会同轮。

`G = 1` 只是餐间基准，不是上限：`stomachGhrelin` 按距上次含能摄入的分钟数做工程上升，长期无含能摄入时 `G` 可从 1 升到约 1.8。在机械与营养输入为 0 时，按现有权重，`hunger = 50 + 50 × (G − 1)` 会随之进入 65 mm 明显档和 85 mm 强档；空腹曲线本身是 `design`，不是人体标定。

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
| `interoception.thirst.fallbackMm` | 0 | `mm` | `design` | `SRC-HUGHES-2018` |
| `interoception.thirst.oralReliefHalfTimeMin` | 2（范围 [0.5, 10]） | `min` | `design` | — |
| `interoception.thirst.oralReliefHalfDoseMl` | 20（范围 [5, 250]） | `mL` | `design` | — |
| `interoception.muscleFatigue.halfTimeMin` | 30 | `min` | `design` | — |
| `interoception.muscleFatigue.exerciseGainMmPerMin` | 2.1 | `mm/min` | `design` | — |
| `interoception.muscleFatigue.depletionWeight` | 0.5 | `1`（以百分刻度换算为 mm） | `design` | — |
| `interoception.urinaryUrgency.referenceVolumeMl` | 410 | `mL` | `design` | `SRC-DEWACHTER-2003` |
| `interoception.discomfort.onsetMm` | 70 | `mm` | `design` | — |
| `interoception.sweatDamp.halfTimeMin` | 5 | `min` | `design` | `SRC-KENNY-2008` |
| `interoception.sweatDamp.referenceEvapRateMlMin` | 4.5 | `mL/min` | `design` | `SRC-CRAMER-2019` |

`interoception.thirst.oralReliefHalfTimeMin`、`interoception.thirst.oralReliefHalfDoseMl` 与 `interoception.muscleFatigue.halfTimeMin` 是方程分母，必须为正有限数。覆盖不满足时由 `interoception.ts` 在装载时报出具体参数 ID，Gateway 不会就绪；修正该覆盖后再启动，不会静默代用默认值或留到心跳反复重试。原疲劳半时范围为 `[1, 240] min`，没有约定 `0` 的特殊语义。这是这三个分母的局部校验，不改变通用参数系统。

前八个参数与不适起始值 `status: "design"`、`source: null`；尿意参考量也标 `design`，只挂测压队列量级的登记，不是人体测量、自然阈值或独立验证。十项全是工程假设。`sexualArousalMm`、`mammaryFullnessMm`、`hedonicCalmMm`、`dyspneaMm`、`stressMm`、`sleepinessMm`、`dryMouthMm`、`heatMm`、`coldMm`、`hypocalcemiaMm`、`hypercalcemiaMm` 与 `libidoMm` 均不往 `interoception.parameters.json` 新增参数（各自读取上游参数产出的状态；性反应参数归 [`sexual-response`](../sexual-response/README.md)，奖赏参数归 `reward.parameters.json`，血氧参数归 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md)，皮质醇、褪黑素、唾液、睾丸、卵巢、结肠与血钙参数分别归 [`adrenal`](../adrenal/README.md)、[`pineal`](../pineal/README.md)、[`salivary-glands`](../salivary-glands/README.md)、[`testes`](../testes/README.md)、[`ovaries`](../ovaries/README.md)、[`colon`](../colon/README.md) 与 [`calcium`](../../human-compartments/calcium/README.md)）。

### `hypothalamus-adh.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusAdh.timeConstantMin` | 10 | `min` | `design` | — |
| `hypothalamusAdh.deficitGain` | 1 | `1/1` | `design` | — |
| `hypothalamusAdh.volumeGain` | 0.5 | `1/1` | `design` | — |
| `hypothalamusAdh.relativeMinimum` | 0 | `1` | `design` | — |
| `hypothalamusAdh.relativeMaximum` | 3 | `1` | `design` | — |

### `hypothalamus-thirst.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源与说明 |
| --- | --- | --- | --- | --- |
| `hypothalamusThirst.baselineMm` | 0 | `mm` | `design` | `SRC-HUGHES-2018`（正常水合基线归零） |
| `hypothalamusThirst.referenceOsmolalityMOsmKg` | 285.23 | `mOsm/kg` | `design` | `SRC-HUGHES-2018`（工程参考渗透压起点） |
| `hypothalamusThirst.osmolalityThresholdMOsmKg` | 285.23 | `mOsm/kg` | `prior` | `SRC-HUGHES-2018`（12 项试验荟萃 `n=167` 口渴起始渗透压阈值） |
| `hypothalamusThirst.osmolalitySlopeMmPerMOsmKg` | 5.4 | `mm/(mOsm/kg)` | `prior` | `SRC-HUGHES-2018`（越阈后线性 VAS 斜率 `0.54 ± 0.07 cm/(mOsm/kg)`） |
| `hypothalamusThirst.osmoticPoolReferenceMl` | 30000 | `mL` | `design` | `SRC-CHEUVRONT-2013`（按体重缩放，锚定 `bodyFluid.referenceVolumeMl` 等效渗透容积） |

两项高渗口渴曲线实测统计量（`osmolalityThresholdMOsmKg` 与 `osmolalitySlopeMmPerMOsmKg`）标 `prior`，其余折算容积与 ADH 参数标 `design`、`source: null`（无独立实机验收前仍不称 `validated`）。

### `thermoregulation.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源与说明 |
| --- | --- | --- | --- | --- |
| `thermoregulation.setpointC` | 37 | `°C` | `design` | — |
| `thermoregulation.ambientTemperatureC` | 25 | `°C` | `design` | — |
| `thermoregulation.heatCapacityKcalPerC` | 60 | `kcal/°C` | `design` | —（按体重缩放） |
| `thermoregulation.metabolicFactor` | 0.005 | `kcal/mL` | `design` | — |
| `thermoregulation.shiveringGain` | 2 | `kcal/(min·°C)` | `design` | —（按体重缩放） |
| `thermoregulation.lossGain` | 0.104167 | `kcal/(min·°C)` | `design` | —（按体重缩放） |
| `thermoregulation.evaporationKcalPerMl` | 0.58 | `kcal/mL` | `design` | — |
| `thermoregulation.circadianAmplitudeC` | 0.25 | `°C` | `design` | —（昼夜余弦调定点振幅） |
| `thermoregulation.circadianPeakHour` | 17 | `h` | `design` | —（傍晚调定点峰值钟点） |
| `thermoregulation.sleepSetpointOffsetC` | 0.2 | `°C` | `design` | —（睡期调定点下调） |
| `thermoregulation.vasodilationGain` | 0.5 | `kcal/(min·°C)` | `design` | `SRC-KRAUCHI-1994`（工程占位，按体重缩放） |
| `thermoregulation.maxVasodilationKcalMin` | 0.55 | `kcal/min` | `design` | `SRC-CRAMER-2019`（工程占位，按体重缩放；物理封顶约 +38 W 干散热） |

十二项均标 `design`，无实测间接测热或实机热量验证。

### `hypothalamus-endocrine.parameters.json`

共 9 项 `design` 参数：`trhFeedbackGain (1)`、`crhFeedbackGain (1)`、`crhCircadianAmplitude (0.35)`、`crhPeakHour (7 h)`、`sympatheticCrhGain (0.01 /mm)`、`carAmplitude (0.45, SRC-CLOW-2004)`、`carLatentMin (10 min)`、`sleepCrhSuppression (0.15)`、`rewardBufferingGain (0.25)`。自身另保存 `carElapsedMin`（初值 `null`）：与 `sleep` 共用本轮睡醒转态判定，实际醒来当轮为 0，随后按 `io.dt` 累计，0–10 min 平滑起坡、10–30 min 保持、45 min 结束 CAR；再次入睡清除计时。`reward` 也使用同一转态：高潮唤醒当轮可发放奖励，高潮后若最终动作仍为入睡则不发放。非低血糖应激另受 `reward.hedonicMm` 与 `pituitary.oxytocinPgMl` 的温和缓冲，皮质醇负反馈按 `adrenal.cortisolNmolL / 180` 归一化。

### `pituitary.parameters.json`

共 16 项参数（`tshHalfTimeMin = 53.9` `SRC-ODELL-1967`、`acthHalfTimeMin = 20` `SRC-KEENAN-2004` 与 `prolactinCircadianAmplitudeNgMl = 2.1` `SRC-VELDHUIS-1988` 标 `prior`，`prolactinHalfTimeMin = 34.6 min` 标 `design` 并引用 `SRC-ROELFSEMA-2012` [慢相消除中位数参考；单室近似保留 `design`]，其余标 `design`；详见 `pituitary.parameters.json` 与 [`source-index.csv`](../references/source-index.csv)）。写出 `tshRelative`（`1`）、`acthPgMl`（基线 `12 pg/mL`）、`prolactinNgMl`（基线 `8 ng/mL` + 昼夜正弦/睡眠抬升 + 吸吮刺激 `express_milk` / `breastfeed` / `stimulationMin` + 高潮冲击）与 `oxytocinPgMl`（基线 `2 pg/mL` + 吸吮/唤醒/高潮峰值，半衰期 `3.8 min`），与 `mammaryGlands.milkMl` 完全解耦。`TRH`/`CRH` 与 `T4`/皮质醇缺失时按基线回退，已加载 `mammaryGlands` 时要求 `stimulationMin` 有限非负（非法则抛错本轮不写）。

### `reward.parameters.json`

共 14 项 `design` 参数（基线 `basalWantingMm = 25`、`basalHedonicMm = 15`，性刺激/饥饿素驱动 `wantingMm`，高潮/运动/进食/催产素驱动 `hedonicMm`，高潮 `78 mm` / 营养 `28 mm` 驱动 `satietyMm`，半衰期分别为 `8 / 25 / 40 min`；关联参考 `SRC-OEI-2012`、`SRC-BLAICHER-1999`、`SRC-KRUGER-2003`、`SRC-UVNASMOBERG-2020`），输出 `wantingMm`、`hedonicMm`、`satietyMm`（`0–100 mm`）。

### `sleep.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `sleep.wakePressureRateMmMin` | 0.08 | `mm/min` | `design` | — |
| `sleep.sleepRecoveryHalfTimeMin` | 150 | `min` | `design` | — |
| `sleep.naturalWakePressureThresholdMm` | 10 | `mm` | `design` | — |
| `sleep.naturalWakeMinDurationMin` | 360 | `min` | `design` | — |
| `sleep.naturalWakeMelatoninCeilingRelative` | 0.9 | `1` | `design` | — |

五项全部 `status: "design"`、`source: null`：0.08 mm/min 约对应清醒 16 小时升至 76.8 mm，150 min 半衰期对应入睡 8 小时降至原值的约 10.9%；均属工程稳态睡眠代理，不是人类 PSG / EEG 实测值。

### `notify.parameters.json`（提醒策略）

| 参数 ID | 值 | 单位 | 状态 |
| --- | --- | --- | --- |
| `brainNotify.hunger.marked` | 65 | `mm` | `policy` |
| `brainNotify.hunger.strong` | 85 | `mm` | `policy` |
| `brainNotify.fullness.marked` | 65 | `mm` | `policy` |
| `brainNotify.fullness.strong` | 85 | `mm` | `policy` |
| `brainNotify.urinary.marked` | 65 | `mm` | `policy` |
| `brainNotify.urinary.strong` | 85 | `mm` | `policy` |
| `brainNotify.thirst.marked` | 65 | `mm` | `policy` |
| `brainNotify.thirst.strong` | 85 | `mm` | `policy` |
| `brainNotify.default.marked` | 65 | `mm` | `policy` |
| `brainNotify.default.strong` | 85 | `mm` | `policy` |
| `brainNotify.resetBelow` | 40 | `mm` | `policy` |
| `brainNotify.baseIntervalMin` | 20 | `min` | `policy` |
| `brainNotify.maxIntervalMin` | 240 | `min` | `policy` |
| `brainNotify.urgentBaseIntervalMin` | 5 | `min` | `policy` |
| `brainNotify.urgentMaxIntervalMin` | 60 | `min` | `policy` |
| `brainNotify.wakeAtLevel` | 3 | `1` | `policy` |
| `brainNotify.sleepImportantThresholdMm` | 92 | `mm` | `policy` |
| `brainNotify.deepSleepImportantThresholdMm` | 95 | `mm` | `policy` |
| `brainNotify.maxTrackedSessions` | 32 | `1` | `policy` |

这十九项参数在参数文件中全部标为 `status: "policy"`、`source: null`：原旧版 `minIntervalMin`、`maxPerHour`、`maxPerDay` 三项已废除并从参数文件移除，改为普通通道（`20 → 40 → 80 → 160 → 240` min）与紧急高危通道（`5 → 10 → 20 → 40 → 60` min）双轨指数退避。`resetBelow = 40` 实现滞回复位门闩：观测 `< 40 mm`（0 档）才把门控水位清零并复位退避；处于 `40–64 mm`（1 档）时保持既有水位锁定不复位，防止在 65 mm 阈值附近抖动重发同档提醒；若已锁定在 2 档而观测升到 3 档（`≥ 85 mm`），仍可在对应通道间隔允许时直接提醒；若水位为 3 档而观测降至 2 档（`65–84 mm`），水位步降至 2 档（同时复位紧急退避）。睡眠期间普通 `context` 与未达 `sleepImportantThresholdMm`（92/95 mm）的信号转入 `sleepBacklog` 并在醒来时集中发出，而紧急危机直接同轮惊醒并压制普通与重要两级。尿意与口渴等阈值的 `65 / 85 / 92 / 95 mm` 同样只是提醒 policy，不是人体排尿阈值、渗透压或临床界值；口渴缺失或非有限读数在通知门控按 0 mm 处理，不参与水账或生理计算。设计灵感只到定性层面——显著性、习惯化/滞回、退避不应期；没有搬用论文参数。

### 迁移时删掉的参数

参数文件从 `systems/nervous/interoception.parameters.json` 迁入时裁掉了四项：

- `interoception.hunger.ghrelinGainAbsolute` 与 `interoception.fullness.ghrelinGainAbsolute`（原 `fitted_dev`，单位 `mm/(ng/mL)`）没有迁入。当前 `stomachGhrelin` 只产出相对浓度（单位 `1`，餐间基准 1，另有 `minutesSinceEnergyIntake` 空腹计时字段），没有绝对 `ng/mL` 的写入者；保留它们只会得到没有消费者的字段，还会让人误以为模型接受绝对浓度。
- `interoception.discomfort.threshold` 与 `interoception.discomfort.slope`（原 `unset`）没有迁入。当前的不适读出改用新的 `interoception.discomfort.onsetMm`（`design`）：只把五个已有感受（含子宫痉挛）超过舒适区后的强度取最大值，不恢复这两个没有消费者的旧参数，也不建恶心、腹胀、疼痛或撑感的独立症状读出。

## 5. 调节方式

`interoception` 汇聚来自胃、十二指肠、下丘脑、膀胱、子宫、乳腺、食管、结肠、性反应、血氧、肾上腺、松果体、睡眠节律、唾液腺、睾丸、体温调节、血钙、血糖、心率/血压、体力活动、皮肤与三分区肌糖原及非标扩展 `sensations` 的读数（`sweatDampMm`、`muscleFatigueAcuteMm` 与 `oralThirstReliefFraction` 从自身轮初状态接续）；`sleep` 维护清醒/睡眠双稳态与 Process S 睡眠压力，`sleep` 动作同时清零 `physicalActivity`；`hypothalamusThirst` 只读轮初体液缺水；`hypothalamusAdh` 读同一水量亏缺与轮初 `blood.bloodVolumeMl`；`thermoregulation` 只读轮初氧耗与汗液写核心温度；内分泌下丘脑与垂体脚本只读轮初快照和外周激素。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 恶心、腹胀、疼痛、过度饱满（撑感）等独立症状；`discomfort` 只是七个内置感受（含子宫痉挛、乳腺胀奶、食管呛咳）及非标扩展贡献超出 70 mm 舒适区后的最大强度代理，不是其中任何一项的独立测量或评分；`esophagus.chokingMm` 只留在 `discomfort` 内，不单独输出字段也不触发 `brainNotify`；
- 餐食成分（脂肪 / 蛋白 / 碳水比例）、黏度、能量密度、温度、碳酸与甜味剂；
- 餐时表、餐前预期、主动外部传感器级环境光照或独立手动光照动作、REM 梦境内容生成与疾病（当前 `pineal` 仅通过本地日光时段与清醒/闭眼入睡推导光照抑制代理）；
- 节律/睡眠/自主神经/HPA/睾酮参考笔记见：[`references/notes/borbely-2016.md`](references/notes/borbely-2016.md)（`SRC-BORBELY-2016`）、[`references/notes/phillips-2007.md`](references/notes/phillips-2007.md)（`SRC-PHILLIPS-2007`）、[`references/notes/dijk-1995.md`](references/notes/dijk-1995.md)（`SRC-DIJK-1995`）、[`references/notes/somers-1993.md`](references/notes/somers-1993.md)（`SRC-SOMERS-1993`）、[`../pineal/references/notes/zeitzer-2000.md`](../pineal/references/notes/zeitzer-2000.md)（`SRC-ZEITZER-2000`）、[`../adrenal/references/notes/clow-2004.md`](../adrenal/references/notes/clow-2004.md)（`SRC-CLOW-2004`）、[`../testes/references/notes/leproult-2011.md`](../testes/references/notes/leproult-2011.md)（`SRC-LEPROULT-2011`）。
- 昼夜、自主神经与防梦游设计见：[`docs/superpowers/specs/2026-11-25-circadian-sleep-autonomic-design.md`](../../../docs/superpowers/specs/2026-11-25-circadian-sleep-autonomic-design.md)。
- 个体差异（指脑部脚本内部的年龄/性别/BMI/胃排空/膀胱容量参数；顶层个体差异 `profile` 与稀疏 `parameters` 覆盖由 `lib/parameters.js` 注入，其中 `profile.timezoneOffsetMin` 控制生物钟时区偏移）；
- CCK、GLP-1 等肠激素，以及迷走与中枢反馈；
- 血浆/尿渗透压、电解质、RAAS；
- 口咽感受器与口咽反馈到 ADH 的生理机制、习惯化、饮水动机与自动喝水；当前只用实际入胃饮水量构造快缓解代理；
- 乳腺解剖、乳房体积/压力与乳汁详细成分（当前 `milk.ts` 仅含基于参考产奶率 `0.54 mL/min`、`360 mL` 存储容量与 PAMR 排乳效率的工程状态机）；
- 性反应周期、性欲、情绪、伴侣与受孕/妊娠：受 `nsfw` 门控（默认 `false`），开启时仍只作无数字体感与信号调制，不模拟伴侣关系或生殖结局；
- 呼吸控制与血气：脑不建呼吸节律、呼吸功、PaO2 / PaCO2、血红蛋白 / 氧合曲线或 CO2 / 酸碱调节；
- 内分泌轴的结合蛋白、受体与临床疾病诊断（`acthPgMl`、`prolactinNgMl`、`oxytocinPgMl` 与外周 `cortisolNmolL` 虽采用了物理浓度单位与文献动力学参考值，仍属于模型工程代理，非实验室化验读数）；
- 一具身体同时绑定多会话（当前为显式单会话绑定 `boundSessionId`，未绑定时在 `requireBinding: true` 下休眠）；以及本次新增状态/通知滚动历史、`agent/inbox/inserted` 阅读回执与血钙通知逻辑的真实 DSH 会话验收。

## 6. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程 / 参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`../stomach/references/notes/`](../stomach/references/notes/)：
  - `cummings-2001.md`（`SRC-CUMMINGS-2001`，摘要 Results）：餐前饥饿素升、餐后 1 h 内降的方向。
  - `leone-2022.md`（`SRC-LEONE-2022`，Table 2、Table 4 与 Results）：混合餐后相对饥饿素与饥饿 / 饱满评分的同批变化方向。
  - `levine-2015.md`（`SRC-LEVINE-2015`，Table 1 与 Methods 第 3 节）：237 mL、355 kcal 高脂液餐后 0–60 min 的胃饱满 VAS 时序与量表口径。
  - `camps-2016.md`（`SRC-CAMPS-2016`，摘要 Results）：饱感排序可以与胃排空 t50 排序不一致。
- 水链逐篇笔记：
  - `references/notes/figaro-1997.md`（`SRC-FIGARO-1997`，摘要 Results）：热运动脱水 n=6、cm VAS；只支持吸收前渴感可快速下降的方向，不用于快路的剂量、半衰期或 ADH 标定。
  - [`../kidney/references/notes/ota-1994.md`](../kidney/references/notes/ota-1994.md)（`SRC-OTA-1994`，Methods p.100、Figs. 1/3/4）：主队列 5 名甲减患者 + 5 名正常对照；只支撑水负荷后 AVP 降、尿变稀的方向。
  - [`../kidney/references/notes/andersen-1990.md`](../kidney/references/notes/andersen-1990.md)（`SRC-ANDERSEN-1990`，摘要 Results）：AVP 输注后肾反应可延迟；剂量轴不是血浓度。
  - [`../bladder/references/notes/de-wachter-2003.md`](../bladder/references/notes/de-wachter-2003.md)（`SRC-DEWACHTER-2003`，摘要）：健康女学生 n=15；190/268/410 mL 是交接数值、原文表/图待核，410 只作尿意归一化锚点。
  - [`../bladder/references/notes/abrams-2002.md`](../bladder/references/notes/abrams-2002.md)（`SRC-ABRAMS-2002`，§3.2.4）：排前量 = 排出量 + 残余量的记账恒等式。
- 子宫痉挛（第五路）：`uterus.crampMm` 由 [`uterus`](../uterus/README.md) 产出，本脚本不核对来源，也不把它当作疼痛测量；证据边界归 [`uterus` README](../uterus/README.md)。
- 乳腺胀奶（第六路）：`mammaryGlands.fullnessMm` 由 [`mammaryGlands`](../mammary-glands/README.md) 按 14 项参数产出；本脚本在 `nsfw !== false` 时暴露至 `mammaryFullnessMm` 与 `discomfort`，不把它当作乳腺压力、容量或胀痛测量。证据边界归 [`mammary-glands` README](../mammary-glands/README.md)。
- 性唤醒与余韵软读：`sexualResponse.arousalMm` 与 `afterglowMm` 由 [`sexual-response`](../sexual-response/README.md) 按 10 项 `design` 参数产出；本脚本只钳位/组合读出，不把它当作情绪或临床性功能测量，也不并入 `discomfort`。
- 气促软读：`bloodOxygen.oxygenDeficit` 由 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md) 按四个 `design` 参数产出，没有登记来源；本脚本只把缺口乘 100 后钳位，不把它当作呼吸困难量表、呼吸功或血气测量，也不并入 `discomfort`。
- 口干软读：`salivaryGlands.mouthMoistureMm` 由 [`salivary-glands`](../salivary-glands/README.md) 按四个 `design` 参数产出，没有登记来源；本脚本只做 `100 − 湿润度` 后钳位，不把它当作口干量表、口腔黏膜湿度、唾液渗透压或临床干燥症指标，也不并入 `discomfort` 或 `brainNotify`。
- 内分泌轴与奖赏：物理浓度与负反馈/脉冲动力学见 [`thyroid`](../thyroid/README.md)、[`adrenal`](../adrenal/README.md)、[`pineal`](../pineal/README.md) 与 [`2026-11-26-reproductive-lactation-reward-endocrine-design.md`](../../../docs/superpowers/specs/2026-11-26-reproductive-lactation-reward-endocrine-design.md)。`stressMm` / `sleepinessMm` / `hedonicCalmMm` 仍属工程代理，不能当作临床压力、睡眠或激素测量。
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

**证据边界：** 这些来源只支撑方向或局部时标参考——餐后饥饿素下降、饥饿下降与饱满上升，胃充盈与营养到达参与饱感，饱感不只看排空；水负荷后 AVP 下降、尿量增加且尿变稀；吸收前口咽刺激可短暂抑制口渴。它们**没有**把机械感受、营养暴露、相对饥饿素、体液亏缺、膀胱体积、子宫痉挛、乳腺胀奶或中枢奖赏校准到 0–100 mm VAS。`interoception`、`reward`、`autonomic`、`sleep` 的线性权重与大部分半衰期属于 `design`；`brainNotify` 的阈值与双轨退避参数没有登记人体来源，是 `policy`，不能当成生理常数。所有脑部脚本都没有独立人体对照验证或盲法留出，不能宣称 `validated`。

## 7. 当前限制

- **体感提醒与无数字交互已接通，但仍属离线与 Gateway 测试口径**：`interoception` 只发布体感与内部恢复状态（不调用 `io.notify`）；`brainNotify` 覆盖 4 项核心 + 17 项扩展体感 + 漏尿边沿 + 高潮事件边沿 + 可扩展 `sensations` 并调用 `io.notify`，`notifications.js` 按 `mode` 投递到已绑定会话，`tools.js` (`body_state`) 转为纯定性零数值感受描述（含 `discomfort`、`wakeEvent`、`reward` 与排乳等待前兆）。M19 真实 DSH 会话早于本次更新；新的通知策略、`sleep` 闭环、休眠绑定、纯感觉交互、`logs/` 状态与通知滚动历史文件以及 `agent/inbox/inserted` 阅读回执链目前仅覆盖于离线单元与真实 Gateway / 模拟宿主集成测试，尚无新的真实 DSH 会话或独立人体验证；多会话并发绑定仍未实现。
- **不是生理测量**：23 个 `interoception` 输出、3 个 `reward` 输出与 6 个 `sleep` 字段都是主观评分或工程代理，不能当作物理长度、神经放电、激素浓度、胃容积、膀胱压力、血气、血糖、PSG/EEG 分期或残余尿诊断。
- **通知不自动产生进食/饮水/排泄/入睡动作**：提醒只发纯定性体感文本；`drink` / `eat` / `urinate` / `defecate` / `sleep` / `wake_up` / `stop_exercise` 仍由会话通过 `body_act` 显式触发。
- **尿意没有生理阈值**：`urinaryUrgency` 只按膀胱体积归一化，并在 410 mL 处饱和；65/85 mm 只是提醒 policy，不是排尿阈值；600 mL 非自主排空是工程兜底，发生时会发出一次漏尿 `wake` 感知文本。
- **不适、血钙提醒与食管呛咳边界**：`discomfort` 只取各分量超出 70 mm 的最大值；`esophagus.chokingMm` 只留在 `discomfort` 第七路，不单独输出字段也不发通知；`hypocalcemiaMm` 与 `hypercalcemiaMm` 现已同步接入 `interoception`、`brainNotify`（作为第 16/17 项标准扩展体感，`>= 65 / 85 mm`，达标时 `mode: 'wake'`）、`wake-evaluation`（睡眠期超重要阈值触发 `wakeReason: 'important'`）与 `body_state`（`>= 85 mm` 均标为 `urgent`）。
- **没有餐时表与餐前预期**：不能按钟点预测下一餐；饥饿素现由胃脚本按空腹时长做工程上升，是 `design`。
- **没有渗透压、EEG 实测或个体化**：两个下丘脑脚本不读血浆/尿渗透压或 RAAS；`sleep` 仅以 `light/deep/rem` 90 分钟工程周期与 20 min 睡眠惯性代理分期，不建真实脑电 PSG/EEG 波形；年龄、性别、BMI 与膀胱容量差异不自动进入脑内参数。

## 8. 体感提醒（`brainNotify`）

`notify.ts` 只做提醒策略：每轮读取 `interoception`（4 项核心 + 17 项扩展体感 + 可选 `sensations`，不读 `hedonicCalmMm`）、可选 `bladder` / `colon` / `sleep` / `blood` / `uterus` / `mammaryGlands` / `sexualResponse`、本轮动作与 `io.boundSessionId`，按双轨指数退避、缓解重置（含 `orgasm` 释放后复位 `sexualArousal` / `sweatDamp` / `palpitation` / `heat` 退避）、高潮受阻边沿反馈（`sexualOrgasmBlocked`，即使在常规普通冷却期内仍可发出 `context` 说明 `below_threshold` / `refractory` 原因）、睡眠门控、NSFW 门控与多感受零数字聚合决定是否调用 `io.notify`。口渴缺失 `THIRST_FALLBACK` 已随下丘脑基线同步调至 `0 mm`；它不生成新感受，不改 `interoception`，也不读 `esophagus.chokingMm` 或聚合 `discomfort`。

**水链与新文献笔记入口（2026-11-27 增补）：** `references/notes/hughes-2018.md`（`SRC-HUGHES-2018`）、`cheuvront-2013.md`（`SRC-CHEUVRONT-2013`）、`roelfsema-2012.md`（`SRC-ROELFSEMA-2012`）、`krauchi-1994.md`（`SRC-KRAUCHI-1994`）、`wenger-1976.md`（`SRC-WENGER-1976`）、`perini-1989.md`（`SRC-PERINI-1989`）、`wang-2011.md`（`SRC-WANG-2011`）。

**覆盖信号与分级**：
- 4 项核心：`hunger`、`fullness`、`urinary`、`thirst`（各自读取 `brainNotify.<kind>.marked` / `strong`，默认 65 / 85 mm）。
- 17 项内置扩展：`dyspnea`、`palpitation`、`hypoglycemia`、`heat`、`cold`、`bowelUrgency`、`dryMouth`、`uterineCramp`、`muscleFatigue`、`sweatDamp`、`stress`、`sleepiness`、`mammaryFullness`、`sexualArousal`、`libido`、`hypocalcemia`、`hypercalcemia`（统一读取 `brainNotify.default.marked` / `strong`，默认 65 / 85 mm；`sexualArousal === 3` 且 `sexualResponse.phase === 'orgasm'` 时改用高潮余韵文案，并与 `sexualOrgasm` 边沿去重）。
- 高潮与受阻边沿：`sexualResponse.lastOrgasmAtSimMin` 与会话记录不同且距当前仿真分钟 ≤ 5 min（未睡着、`nsfwEnabled`）时触发 `sexualOrgasm` 边沿通知；若主动提交 `orgasm` 被拒（`lastOrgasmBlockReason` 为 `'below_threshold'` 或 `'refractory'`）且 `lastAttemptedOrgasmAtSimMin` 更新，则触发 `sexualOrgasmBlocked` `context` 说明并绕开无关普通冷却；超过 5 min 视为陈旧高潮事件仅静默同步水位不再补发。
- 漏尿边沿：`bladder.involuntaryVoidedMl` 由 `<= 0` 跃升至 `> 0` 时产生一次 `involuntaryVoid` 紧急 `wake` 候选，待归零后复位边沿标记 `lastInvoluntaryVoidedMl`。
- 非标扩展 `sensations`：支持 `intensityMm`、`urgent?: boolean`、`nsfw?: boolean`、`contextText?: string`、`wakeText?: string`，共用 65 / 85 / 40 mm 滞回（含 `3 -> 2` 步降）与跨 `nsfw` / 零数字清洗。
- 高危判据（直接视作 `isUrgent` 并强制 `mode: 'wake'`）：`involuntaryVoid`、`dyspnea >= 90` mm、`heat >= 85` mm、`cold >= 85` mm、`hypoglycemia >= 85` mm、`blood.systolicMmHg < 78` mmHg（同步将 `palpitation` 提升到 3 档），以及扩展感受声明 `urgent: true` 或任意达到 `wakeAtLevel`（默认 3 档 `>= 85` mm）的信号。

**滞回水位与步骤降**：每个会话保存核心 `levels`、内置扩展 `sensations` 与非标扩展 `sensationLevels`（均存 `0 / 2 / 3`）。观测 `< resetBelow (40 mm)` 时清零水位（并触发对应通道退避复位）；`40–64 mm`（1 档）保持原水位锁定不复位；升至更高档可直接触发；`3 -> 2` 允许步降并复位紧急退避。

**双轨指数退避（取消小时/每日硬封顶）**：已移除 `minIntervalMin`、`maxPerHour` 与 `maxPerDay`，改为按会话维护两条独立退避轨道：
- **普通通道（`context`）**：`baseIntervalMin = 20` min 起，每次发送后 `backoffStep + 1`，按 `min(maxIntervalMin, baseIntervalMin × 2^step)` 递增：`20 → 40 → 80 → 160 → 240` min（`maxIntervalMin = 240` 封顶）。
- **紧急唤醒通道（`wake`）**：`urgentBaseIntervalMin = 5` min 起，按 `5 → 10 → 20 → 40 → 60` min 递增（`urgentMaxIntervalMin = 60` 封顶）；紧急发送穿透普通冷却，但发送同时更新 `lastSentAt = now`，避免紧急唤醒后紧跟一条普通 `context` 打扰。

**缓解重置**：
- 当任一已锁定信号跌破 `resetBelow`（40 mm）时复位普通退避（若原水位 `>= wakeAtLevel` 则同步复位紧急退避）；由 3 档降到 2 档也复位紧急退避。
- 当本轮收到匹配的缓解动作（或排泄/排乳结果）时复位对应水位与退避：`urinate` / `bladder.voidedMl > 0`、`defecate` / `colon.defecatedG > 0`、`express_milk` / `breastfeed` / `mammaryGlands.ejectedMilkMl > 0`、`sleep` / `isSleeping`、`wake_up`、`eat`、`drink`、`stop_exercise`（复位 `muscleFatigue`/`sweatDamp`/`dyspnea`/`palpitation` 曾触发的退避）。

**睡眠抑制、堆积、NSFW 门控与跨动作抑卫**：
- **睡眠抑制与堆积**：`sleep.sleeping === true` 时屏蔽 `sleepiness` 与高潮事件候选，普通 `context` 与未达抬高睡眠门槛（浅睡/REM 92 mm、深睡 95 mm）的信号转入 `sleepBacklog`（同步记录睡眠期间出现后又平复的小插曲）；跨过睡眠门槛触发常规唤醒脱离睡眠，紧急危机直接惊醒并压制普通与重要两级暂不混发；非紧急脱离睡眠时强制以 `mode: 'wake'` 通知已醒来并集中注入 `sleepBacklog`。
- **NSFW 门控**：`getNsfwSetting() === false` 时将 `sexualArousal`、`libido`、`mammaryFullness`、`sexualOrgasm` 与标记 `nsfw: true` 的扩展感受全部屏蔽。
- **排尿/排便/排乳动作卫士**：本轮 `urinate` 或 `voidedMl > 0` / `involuntaryVoidedMl > 0` 时抑制 `urinary`；本轮 `defecate` 或 `defecatedG > 0` 时抑制 `bowelUrgency`；本轮 `ejectedMilkMl > 0` 或泌乳期执行 `express_milk` / `breastfeed` 时抑制 `mammaryFullness`。

**补充说明（2026-11-25 节律、睡眠细化与自主神经更新）**：现行清单（40 / 女性 43 / 男性 42 脚本）已新增 `brain/autonomic.ts`（`autonomic` 部位，14 项 `design` 参数）与共享 `wake-evaluation.ts`：`sleep.ts` 现维护 `sleepStage`、`sleepInertiaMm`、`wakeEvent` 并支持主动动作唤醒与同轮惊醒；`hypothalamusEndocrine`（CRH 昼夜节律 + 交感驱动）与 `thermoregulation`（昼夜体温设定点 ±0.25°C + 睡眠 -0.2°C）已接入本地时钟 `lib/circadian.js`。详见 [`2026-11-25-circadian-sleep-autonomic-design.md`](../../../docs/superpowers/specs/2026-11-25-circadian-sleep-autonomic-design.md)。

**补充说明（2026-11-26 内分泌动力学、中枢奖赏、性反应与泌乳更新）**：现行清单（41 / 女性 44 / 男性 43 脚本）新增 `brain/reward.ts`（`reward` 部位：`wantingMm`、`hedonicMm`、`satietyMm`），`pituitary` 改用绝对物理浓度单位（`prolactinNgMl`、`oxytocinPgMl`、`acthPgMl`）并与 `mammaryGlands` 吸吮/挤奶刺激联动；`autonomic` 接入共享性释放评估与 `sexualResponse.afterglowMm` + `reward.hedonicMm` 副交感回升；`interoception` 扩展至 23 个 `mm` 字段（新增 `mammaryFullnessMm`、`hedonicCalmMm`，并接入女性 E2/P4+奖赏+泌乳素性欲与轻度 `hedonicCalmMm` 压力缓冲）；`brainNotify` 追踪 `lastOrgasmAtSimMin`（5 分钟防陈旧边沿触发高潮通知，并与性兴奋通知去重）及泌乳挤奶/哺乳缓解提示。详见 [`2026-11-26-reproductive-lactation-reward-endocrine-design.md`](../../../docs/superpowers/specs/2026-11-26-reproductive-lactation-reward-endocrine-design.md)。

**多感受零数字聚合与补算保护**：
- 存在可发送候选时，紧急通道优先并合并同轮所有新跨档候选（`mode: 'wake'`），否则发送普通候选（`mode: 'context'`）。候选按“危机优先 → 档位降序 → 固定临床优先级 `SIGNAL_PRIORITY`”排序，去重后以 `身体感受：...；...。` 聚合在 280 字符内；所有单句与聚合文本均经 `hasDigits`（`/\d|\p{Nd}/u`）拦截，含数字即回退通用无数字提示。
- 目标会话优先取 `io.boundSessionId`，仅当其为空时依次回落到 `io.actions` 最后一条 `sessionId` → `prev.lastSessionId`。
- 启动补算轮带 `io.suppressNotifications = true`：`brainNotify` 只调和下降水位，不调用 `io.notify`，不消耗退避步数与时间戳。

**未实现/未实测**：多会话同时绑定、以及本次新增日志/回执与血钙通知逻辑的真实 DSH 会话验收（当前仅完成离线单测、模拟宿主与真实 Gateway 集成测试）。Gateway 的 `GET /notifications` 仍是待确认队列；投递泵在 `inject`/`followup` 入队后 ACK，同时向 `logs/notification-history.json` 写入投递记录并在收到 `agent/inbox/inserted` 后补写阅读回执时间（若宿主不触发该事件则保留 `insertedAtWallTimeMs: null`）。
