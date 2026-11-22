# 脑：体感与上报（brain）

`brain/` 目前有四个脚本：`interoception.ts` 把胃壁机械感受、胃饥饿素、十二指肠营养暴露、下丘脑口渴驱动和膀胱充盈汇成 0–100 mm 的饥饿、饱满、口渴与尿意代理，再由这四者超出舒适区的强度取最大值得到不适代理；`notify.ts` 读取饥饿、饱满、口渴与尿意四类体感，在明显/强档位按会话决定是否提醒；`hypothalamus-adh.ts` 把体液亏缺映射成相对 ADH 水平；`hypothalamus-thirst.ts` 把同一亏缺映射成口渴驱动。四个脚本只写自己的部位，不写其他器官。

实现状态：脚本与参数已在 `organs/human-organs/brain/`，四个脚本都已加入根清单；`body_act` / `body_state` 与通知投递在 `index.js` / `tools.js` / `notifications.js`。`interoception` 是 `producer only` 的体感读出，会读取下丘脑口渴与膀胱体积；`brainNotify` 是提醒策略，负责频率和次数，读取饥饿、饱满、口渴与尿意四类体感，仍不读不适；口渴与尿意通道只有离线单元测试与真实 Gateway 集成测试，尚无真实 DSH 会话验收。M19 真实 DSH 会话已读出 `thirst`、`urinaryUrgency` 与 `discomfort` 的方向和 `interoception` 的一轮偏移（见 §2）；M19 只验证体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递或排尿闭环。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `interoception.ts` | `interoception` | `hunger`、`fullness`、`thirst`、`urinaryUrgency`、`discomfort` | `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration`、`duodenum.nutrientExposure`、`hypothalamusThirst.thirst`、`bladder.volumeMl` | `interoception.parameters.json` |
| `notify.ts` | `brainNotify` | `lastSessionId`、`sessions`（内部状态，含每会话 `levels`） | `interoception.hunger/fullness/thirst/urinaryUrgency`、轮初 `bladder.voidedMl`；本轮动作里的 `sessionId` 与 `urinate` | `notify.parameters.json` |
| `hypothalamus-adh.ts` | `hypothalamusAdh` | `relativeConcentration` | `bodyFluid.waterDeficit` | `hypothalamus-adh.parameters.json` |
| `hypothalamus-thirst.ts` | `hypothalamusThirst` | `thirst` | `bodyFluid.waterDeficit` | `hypothalamus-thirst.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `hunger` | `mm` | 饥饿的 0–100 mm VAS 代理 |
| `fullness` | `mm` | 饱满的 0–100 mm VAS 代理 |
| `thirst` | `mm` | 口渴的 0–100 mm 代理；把 `hypothalamusThirst.thirst` 原样钳位后读出 |
| `urinaryUrgency` | `mm` | 尿意的 0–100 mm 代理；由轮初 `bladder.volumeMl` 归一化 |
| `discomfort` | `mm` | 不适的 0–100 mm 代理；四个感受超过 70 mm 舒适区后的强度取最大值 |

`hunger` / `fullness` / `thirst` / `urinaryUrgency` / `discomfort` **不是物理长度、神经放电、激素浓度、膀胱压力或逼尿肌张力**，也不是胃容积或残余尿诊断值。`mm` 只沿用 100-mm 视觉模拟量表的刻度；把它们与胃内容量、血浆饥饿素、AVP pmol/L、膀胱 mL 或压力互换没有方法学依据。`discomfort` 是“当前最强的不适感受”代理，不是疼痛评分、情绪、疾病严重度或四感受总分。

`thirst`、`urinaryUrgency` 与 `discomfort` 的方程：

```text
thirst         = clamp(hypothalamusThirst.thirst, 0, 100)   // 缺失或非有限回落 50 mm
urinaryUrgency = clamp(100 mm × bladder.volumeMl / 410 mL, 0, 100)
excess(x)      = clamp(100 × (x − 70) / (100 − 70), 0, 100)
discomfort     = max(excess(hunger), excess(fullness), excess(thirst), excess(urinaryUrgency))
```

尿意读取轮初膀胱量，所以排尿后的低尿意和当轮新转入的尿都在下一轮读出；尿意在 410 mL 处已饱和到 100 mm，再多的膀胱体积不会让 `urinaryUrgency` 或由它贡献的 `discomfort` 继续升高。410 mL 的参考量是 `design`，只借 De Wachter 队列 SDV 的测压量级作归一化锚点，不是自然排尿阈值，也不是个体尿意标定。`discomfort` 的起始值 70 mm 同样是 `design`、`source: null`：感受 70 mm 仍为 0，85 mm 为 50，100 mm 为 100；它取最大值而不是相加，避免把多个感受叠成没有依据的总分。`discomfort` 已在 M19 真实 DSH 会话中读出（2026-11-22，33/33 verdicts）：预置 650 mL 膀胱的轮次在 sim 60 因轮初体积读出 `urinaryUrgency = 100`、`discomfort = 100`，下一轮随膀胱降到 1 mL 回落到 0.244 / 0（650 mL 预置与预置会话的稳态 1 mL 请求都是测试设定，不是模型输出）；高 ADH 预置则因 `thirst = 100` 读出 `discomfort = 100`。证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`（仓库外，未入库）。M19 只验证这些体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递或排尿闭环。`thirst`、`urinaryUrgency` 与 `discomfort` 目前由 `body_state` / `GET /state` 读取；`brainNotify` 把 `thirst` 用于口渴提醒、`urinaryUrgency` 用于尿意提醒，仍不读 `discomfort`，也没有不适提醒。

`initialState` 为 `{ hunger: 50, fullness: 0, thirst: 50, urinaryUrgency: 0, discomfort: 0 }`；`hunger` / `fullness` 来自两个 `design` 基线参数，`thirst` 的 50 mm 是缺失回落，`urinaryUrgency` 与 `discomfort` 初值 0。脚本每轮从上游输入重算，输出钳到 `[0, 100]`，不读自己的上一轮状态。

### `hypothalamusAdh`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `relativeConcentration` | `1` | 相对 ADH 水平，初值 1；不是血浆 AVP 浓度（`pmol/L`）、分泌速率或渗透压 |

```text
target = clamp(1 + deficitGain × waterDeficit, relativeMinimum, relativeMaximum)
next   = current + (1 − exp(−dtMin / timeConstantMin)) × (target − current)
```

一阶滞后只提供工程反应延迟；`timeConstantMin` 是 `design`，不是 Andersen 的拟合值。只读轮初 `bodyFluid.waterDeficit`，缺失或非有限按 0。

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

五类输入都取自同一轮的轮初快照；缺失或非有限时按默认值处理：

| 输入 | 含义 | 缺失 / 非有限默认值 |
| --- | --- | --- |
| `stomachSensory.mechanical` | 胃壁机械感受代理，0–1；不是张力或神经放电 | 0 |
| `stomachGhrelin.relativeConcentration` | 相对饥饿素浓度；餐间基准 1、餐后谷值 0.5，空腹时可高于 1（工程上升，目标约 1.8）；不是 `ng/mL` | 1 |
| `duodenum.nutrientExposure` | 十二指肠近期营养暴露代理，`kcal/min`；不是吸收速率或血糖 | 0 |
| `hypothalamusThirst.thirst` | 下丘脑口渴驱动，0–100 mm 代理 | 50 |
| `bladder.volumeMl` | 轮初膀胱体积，mL；不是压力 | 0 |

先钳输入：`M = clamp(mechanical, 0, 1)`、`G = max(0, relativeConcentration)`、`N = max(0, nutrientExposure)`；`thirst` 与 `urinaryUrgency` 见 §2。然后：

```text
hunger   = clamp(hungerBaseline   + hungerGhrelinGain   × (G − 1)
                                  + hungerMechanicalGain × M
                                  + hungerNutrientGain   × N, 0, 100)
fullness = clamp(fullnessBaseline + fullnessGhrelinGain × (G − 1)
                                  + fullnessMechanicalGain × M
                                  + fullnessNutrientGain   × N, 0, 100)
```

四个感受输出互不串写：`thirst` 不参与饥饿/饱满方程，`urinaryUrgency` 也不参与；`discomfort` 只读本轮已算出的四个感受，不回写它们，也不进入它们的方程。输入到输出有**一轮偏移**（这是 `interoception` 自身的偏移；`notify` 在它之上再晚一轮，见 §8）：同一轮的摄入先由胃脚本记账，下一轮的轮初快照里才出现新的 `mechanical`、`relativeConcentration` 与 `nutrientExposure`；`bodyFluid` 的变化也要下一轮才改变两个下丘脑脚本的输出。

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

前八个参数与不适起始值 `status: "design"`、`source: null`；尿意参考量也标 `design`，只挂测压队列量级的登记，不是人体测量、自然阈值或独立验证。十项全是工程假设。

### `hypothalamus-adh.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusAdh.timeConstantMin` | 10 | `min` | `design` | — |
| `hypothalamusAdh.deficitGain` | 1 | `1/1` | `design` | — |
| `hypothalamusAdh.relativeMinimum` | 0 | `1` | `design` | — |
| `hypothalamusAdh.relativeMaximum` | 3 | `1` | `design` | — |

### `hypothalamus-thirst.parameters.json`

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusThirst.baselineMm` | 50 | `mm` | `design` | — |
| `hypothalamusThirst.deficitGainMm` | 50 | `mm/1` | `design` | — |

两个下丘脑参数文件全部 `design`、`source: null`；`relativeConcentration` 以 1 为无量纲参考，`thirst` 的 `mm` 只沿用 VAS 刻度。

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
- `interoception.discomfort.threshold` 与 `interoception.discomfort.slope`（原 `unset`）没有迁入。当前的不适读出改用新的 `interoception.discomfort.onsetMm`（`design`）：只把四个已有感受超过舒适区后的强度取最大值，不恢复这两个没有消费者的旧参数，也不建恶心、腹胀、疼痛或撑感的独立症状读出。

## 5. 调节方式

`interoception` 接五类只读输入：胃机械感受、相对饥饿素、十二指肠营养暴露、下丘脑口渴驱动与膀胱体积；前三类进入同一条线性叠加，后两类分别直通 `thirst` 与 `urinaryUrgency`，`discomfort` 再由本轮四个感受超出 70 mm 的强度取最大值。两个下丘脑脚本只读 `bodyFluid.waterDeficit`，彼此不读对方部位，也不产生动作。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 恶心、腹胀、疼痛、过度饱满（撑感）等独立症状；`discomfort` 只是四个已有感受超出舒适区后的最大强度代理，不是其中任何一项的独立测量或评分；
- 餐食成分（脂肪 / 蛋白 / 碳水比例）、黏度、能量密度、温度、碳酸与甜味剂；
- 餐时表、餐前预期、昼夜节律、睡眠、运动与疾病；
- 个体差异：年龄、性别、BMI、胃排空、激素水平与膀胱容量的个体化参数；
- CCK、GLP-1 等肠激素，以及迷走与中枢反馈；
- 血浆/尿渗透压、电解质、血容量、血压与 RAAS；
- 吸收前口咽解渴、习惯化、饮水动机与自动喝水；
- 生理性尿意阈值、排尿反射、失禁、夜尿与逼尿肌压力；`urinaryUrgency` 只是按膀胱体积归一化的读出，脑内不建这些机制；`brainNotify` 的 65/85 mm 只是提醒 policy，不是排尿阈值；
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
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)
- 空腹饥饿素设计：[`docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md`](../../../docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md)
- 水链设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md)
- 尿意提醒设计：[`docs/superpowers/specs/2026-11-22-urinary-notification-design.md`](../../../docs/superpowers/specs/2026-11-22-urinary-notification-design.md)
- 口渴提醒设计：[`docs/superpowers/specs/2026-11-23-thirst-notification-design.md`](../../../docs/superpowers/specs/2026-11-23-thirst-notification-design.md)

**证据边界：** 这些来源只支撑方向——餐后饥饿素下降、饥饿下降与饱满上升，胃充盈与营养到达参与饱感，饱感不只看排空；水负荷后 AVP 下降、尿量增加且尿变稀；吸收前口咽刺激可短暂抑制口渴。它们**没有**把机械感受、营养暴露、相对饥饿素、体液亏缺或膀胱体积校准到 0–100 mm VAS，也没有把 `relativeConcentration` 校准到 pmol/L。线性叠加、一阶滞后、基线、增益、参考量、不适起始值与缺失默认值全是 `design`；`discomfort` 的 70 mm 起始值和取最大值规则没有来源标定，不代表疼痛阈值、情绪或疾病严重度。`stomachGhrelin` 的空腹计时、起始延迟、峰值与上升时间常数同样没有来源标定，全是 `design`；Cummings 2001 只支撑餐前上升、餐后下降的方向，Leone 2022 只支撑餐后下降方向，两者都不支撑空腹时长曲线，也没有把 `G = 1.8` 校准到任何激素浓度。方程不是论文原方程，也没有独立验证或盲法留出。`brainNotify` 的阈值、冷却和次数上限没有登记人体来源，是 `policy`，不能当成生理常数。

## 7. 当前限制

- **体感提醒已接入四类信号**：`interoception` 仍是 `producer only` 的读出；`brainNotify` 读饥饿、饱满、口渴与尿意并调用 `io.notify`，`notifications.js` 再投递到对应会话。口渴与尿意通道只有离线单元测试与真实 Gateway 集成测试；M19 只验证体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递或排尿闭环，尚无真实 DSH 会话验收；通知历史文件、模型已读确认与多会话路由仍未实现。
- **不是生理测量**：五个输出都是主观评分或驱动代理，不能当作物理长度、神经放电、激素浓度、胃容积、膀胱压力或残余尿诊断。
- **口渴提醒不产生动作**：`hypothalamusThirst.thirst` 与 `interoception.thirst` 只作读出和提醒输入，`brainNotify` 只发固定文本，不自动喝水；首段不建口咽解渴。
- **尿意没有生理阈值**：`urinaryUrgency` 只按膀胱体积归一化，并在 410 mL 处饱和；65/85 mm 只是提醒 policy，不是排尿阈值；没有排尿反射、失禁或夜尿；提醒不自动排尿，`urinate` 仍是会话主动动作。
- **线性叠加是设计**：没有交互项、阈值、饱和或餐型差异；三路输入各自独立相加，口渴与尿意单独直通。
- **不适不是症状评分**：`discomfort` 只把四个感受超出 70 mm 的强度取最大值，不是疼痛、情绪、疾病严重度或四感受总分；疼痛、恶心、腹胀与“撑得难受”仍没有独立读出。
- **没有餐时表与餐前预期**：不能按钟点预测下一餐；饥饿素现由胃脚本按空腹时长做工程上升，`G` 可高于餐间基准 1，但起始延迟、峰值和时间常数都是 `design`，不是人体曲线。
- **没有渗透压与血容量**：两个下丘脑脚本只读水量亏缺代理，不读血浆/尿渗透压、电解质、血压或 RAAS。
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

**边界**：`discomfort` 没有提醒通道，不接入疼痛、疾病或临床预警；口渴提醒不等于自动饮水，`drink` 仍由会话显式调用；提醒不自动排尿，`urinate` 仍由会话显式调用；膀胱 600 mL 非自主排空、主动排尿优先级、水链、根清单和工具 schema 都不变；通知载荷仍是 `mode/sessionId/text`，没有 `kind` 字段。离线单元测试覆盖四类信号的阈值、跨信号独立、候选优先级、共享冷却/配额、滞回（含 70→50→70 mm）、缺读、迁移、排后卫士（含本轮 `urinate`）与口渴 JSON-safe；真实 Gateway 测试覆盖尿意“提醒 → 显式排尿 → 尿意回落”和口渴“第 3 轮提醒 → 显式饮水 → 吸收后回落且不自动饮水”；M19 只验证体感读数和 `interoception` 的一轮偏移，不验证 `brainNotify` 提醒投递、排尿闭环或口渴投递；尚未做真实 DSH 会话验收。

**未实现**：通知历史文件、`agent/inbox/inserted` 已读确认、按会话绑定不同身体、不适/恶心/腹胀/疼痛/撑感提醒；真实 DSH 投递/ACK 与口渴、尿意提醒的会话级验收仍不在本轮。Gateway 的 `GET /notifications` 仍是待确认队列；投递泵在 `inject`/`followup` 入队后 ACK，不表示模型已经读取。
