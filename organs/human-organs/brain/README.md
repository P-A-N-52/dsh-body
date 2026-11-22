# 脑：体感与上报（brain）

`brain/` 目前有四个脚本：`interoception.ts` 把胃壁机械感受、胃饥饿素、十二指肠营养暴露、下丘脑口渴驱动和膀胱充盈汇成 0–100 mm 的饥饿、饱满、口渴与尿意代理，再由这四者超出舒适区的强度取最大值得到不适代理；`notify.ts` 在明显/强档位按会话决定是否提醒；`hypothalamus-adh.ts` 把体液亏缺映射成相对 ADH 水平；`hypothalamus-thirst.ts` 把同一亏缺映射成口渴驱动。四个脚本只写自己的部位，不写其他器官。

实现状态：脚本与参数已在 `organs/human-organs/brain/`，四个脚本都已加入根清单；`body_act` / `body_state` 与通知投递在 `index.js` / `tools.js` / `notifications.js`。`interoception` 是 `producer only` 的体感读出，会读取下丘脑口渴与膀胱体积；`brainNotify` 是提醒策略，负责频率和次数，仍只读饥饿/饱满。M19 真实 DSH 会话已读出 `thirst`、`urinaryUrgency` 与 `discomfort` 的方向和一轮偏移（见 §2）。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `interoception.ts` | `interoception` | `hunger`、`fullness`、`thirst`、`urinaryUrgency`、`discomfort` | `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration`、`duodenum.nutrientExposure`、`hypothalamusThirst.thirst`、`bladder.volumeMl` | `interoception.parameters.json` |
| `notify.ts` | `brainNotify` | `lastSessionId`、`sessions`（内部状态） | `interoception.hunger/fullness`；本轮动作里的 `sessionId` | `notify.parameters.json` |
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

尿意读取轮初膀胱量，所以排尿后的低尿意和当轮新转入的尿都在下一轮读出；尿意在 410 mL 处已饱和到 100 mm，再多的膀胱体积不会让 `urinaryUrgency` 或由它贡献的 `discomfort` 继续升高。410 mL 的参考量是 `design`，只借 De Wachter 队列 SDV 的测压量级作归一化锚点，不是自然排尿阈值，也不是个体尿意标定。`discomfort` 的起始值 70 mm 同样是 `design`、`source: null`：感受 70 mm 仍为 0，85 mm 为 50，100 mm 为 100；它取最大值而不是相加，避免把多个感受叠成没有依据的总分。`discomfort` 已在 M19 真实 DSH 会话中读出（2026-11-22，33/33 verdicts）：预置 650 mL 膀胱的轮次在 sim 60 因轮初体积读出 `urinaryUrgency = 100`、`discomfort = 100`，下一轮随膀胱降到 1 mL 回落到 0.244 / 0；高 ADH 预置则因 `thirst = 100` 读出 `discomfort = 100`。证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`（仓库外，未入库）。`thirst`、`urinaryUrgency` 与 `discomfort` 目前由 `body_state` / `GET /state` 读取；`brainNotify` 不读，也没有口渴、尿意或不适提醒。

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
| `sessions` | `1` | 每个会话的提醒状态：上次提醒时间、上次档位、小时/天计数、最近出现时间 |

`sessions` 是内部策略状态，不是生理读数；按 `maxTrackedSessions` 保留最近 32 个会话。

## 3. 输入与方程

五类输入都取自同一轮的轮初快照；缺失或非有限时按默认值处理：

| 输入 | 含义 | 缺失 / 非有限默认值 |
| --- | --- | --- |
| `stomachSensory.mechanical` | 胃壁机械感受代理，0–1；不是张力或神经放电 | 0 |
| `stomachGhrelin.relativeConcentration` | 相对饥饿素浓度，空腹基线 1、餐后谷值 0.5；不是 `ng/mL` | 1 |
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

四个感受输出互不串写：`thirst` 不参与饥饿/饱满方程，`urinaryUrgency` 也不参与；`discomfort` 只读本轮已算出的四个感受，不回写它们，也不进入它们的方程。输入到输出有**一轮偏移**：同一轮的摄入先由胃脚本记账，下一轮的轮初快照里才出现新的 `mechanical`、`relativeConcentration` 与 `nutrientExposure`；`bodyFluid` 的变化也要下一轮才改变两个下丘脑脚本的输出。

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
| `brainNotify.resetBelow` | 40 | `mm` | `design` |
| `brainNotify.minIntervalMin` | 45 | `min` | `design` |
| `brainNotify.maxPerHour` | 2 | `1` | `design` |
| `brainNotify.maxPerDay` | 6 | `1` | `design` |
| `brainNotify.wakeAtLevel` | 3 | `1` | `design` |
| `brainNotify.maxTrackedSessions` | 32 | `1` | `design` |

这些是 `policy`：明显/强档位阈值、复位阈值、冷却和次数上限都不是人体测量。设计灵感只到定性层面——显著性、习惯化/滞回、不应期；没有搬用论文参数。

### 迁移时删掉的参数

参数文件从 `systems/nervous/interoception.parameters.json` 迁入时裁掉了四项：

- `interoception.hunger.ghrelinGainAbsolute` 与 `interoception.fullness.ghrelinGainAbsolute`（原 `fitted_dev`，单位 `mm/(ng/mL)`）没有迁入。当前 `stomachGhrelin` 只产出相对浓度（单位 `1`，空腹基线 1），没有绝对 `ng/mL` 的写入者；保留它们只会得到没有消费者的字段，还会让人误以为模型接受绝对浓度。
- `interoception.discomfort.threshold` 与 `interoception.discomfort.slope`（原 `unset`）没有迁入。当前的不适读出改用新的 `interoception.discomfort.onsetMm`（`design`）：只把四个已有感受超过舒适区后的强度取最大值，不恢复这两个没有消费者的旧参数，也不建恶心、腹胀、疼痛或撑感的独立症状读出。

## 5. 调节方式

`interoception` 接五类只读输入：胃机械感受、相对饥饿素、十二指肠营养暴露、下丘脑口渴驱动与膀胱体积；前三类进入同一条线性叠加，后两类分别直通 `thirst` 与 `urinaryUrgency`，`discomfort` 再由本轮四个感受超出 70 mm 的强度取最大值。两个下丘脑脚本只读 `bodyFluid.waterDeficit`，彼此不读对方部位，也不产生动作。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 恶心、腹胀、疼痛、过度饱满（撑感）等独立症状；`discomfort` 只是四个已有感受超出舒适区后的最大强度代理，不是其中任何一项的独立测量或评分；
- 餐食成分（脂肪 / 蛋白 / 碳水比例）、黏度、能量密度、温度、碳酸与甜味剂；
- 餐时表、昼夜节律、睡眠、运动与疾病；
- 个体差异：年龄、性别、BMI、胃排空、激素水平与膀胱容量的个体化参数；
- CCK、GLP-1 等肠激素，以及迷走与中枢反馈；
- 血浆/尿渗透压、电解质、血容量、血压与 RAAS；
- 吸收前口咽解渴、习惯化、饮水动机与自动喝水；
- 尿意阈值、排尿反射、失禁、夜尿与逼尿肌压力；`urinaryUrgency` 只是按膀胱体积归一化的读出，脑内不建这些机制；
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
- 水链设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md)

**证据边界：** 这些来源只支撑方向——餐后饥饿素下降、饥饿下降与饱满上升，胃充盈与营养到达参与饱感，饱感不只看排空；水负荷后 AVP 下降、尿量增加且尿变稀；吸收前口咽刺激可短暂抑制口渴。它们**没有**把机械感受、营养暴露、相对饥饿素、体液亏缺或膀胱体积校准到 0–100 mm VAS，也没有把 `relativeConcentration` 校准到 pmol/L。线性叠加、一阶滞后、基线、增益、参考量、不适起始值与缺失默认值全是 `design`；`discomfort` 的 70 mm 起始值和取最大值规则没有来源标定，不代表疼痛阈值、情绪或疾病严重度。方程不是论文原方程，也没有独立验证或盲法留出。`brainNotify` 的阈值、冷却和次数上限没有登记人体来源，是 `policy`，不能当成生理常数。

## 7. 当前限制

- **体感已接入提醒**：`interoception` 仍是 `producer only` 的读出；`brainNotify` 会调用 `io.notify`，`notifications.js` 再投递到对应会话。通知历史文件、模型已读确认与多会话路由尚未实现。
- **不是生理测量**：五个输出都是主观评分或驱动代理，不能当作物理长度、神经放电、激素浓度、胃容积、膀胱压力或残余尿诊断。
- **口渴不产生动作**：`hypothalamusThirst.thirst` 与 `interoception.thirst` 只作读出，不自动喝水；首段不建口咽解渴。
- **尿意不是阈值**：`urinaryUrgency` 只按膀胱体积归一化，并在 410 mL 处饱和；没有尿意阈值、排尿反射、失禁或夜尿；`urinate` 是会话主动动作。
- **线性叠加是设计**：没有交互项、阈值、饱和或餐型差异；三路输入各自独立相加，口渴与尿意单独直通。
- **不适不是症状评分**：`discomfort` 只把四个感受超出 70 mm 的强度取最大值，不是疼痛、情绪、疾病严重度或四感受总分；疼痛、恶心、腹胀与“撑得难受”仍没有独立读出。
- **没有餐时表**：不能产生餐前饥饿上升；饥饿素只由胃脚本的餐后抑制与恢复驱动。
- **没有渗透压与血容量**：两个下丘脑脚本只读水量亏缺代理，不读血浆/尿渗透压、电解质、血压或 RAAS。
- **没有个体化**：年龄、性别、BMI、胃排空、激素与膀胱容量差异都不进入方程；参数是证据默认值，不是某具身体的最终值。

## 8. 体感提醒（`brainNotify`）

`notify.ts` 只做三件事：判断当前饥饿/饱满是否达到“值得说”的档位、检查这个会话的冷却和配额、把固定文本交给 `io.notify`。它不生成新感受，也不改 `interoception`。

**档位**：`hunger` 和 `fullness` 各自按 `marked=65`、`strong=85` 分档；取两者中更高的档位，同档优先 `fullness`。只有 `marked` / `strong` 才可能提醒。

**防重复**：同一档位不重复；档位降到 `resetBelow=40` 以下后，下一次升到 `marked` 才重新有资格。冷却 `45` 仿真分钟；同一会话每小时最多 `2` 次、每天最多 `6` 次。小时/天窗口从会话首次出现或上次重置起算，跨过 3600/86400 仿真秒清零。被冷却或配额挡住的上升不会更新 `lastLevel`，条件满足后仍可提醒。

**投递方式**：`marked` 用 `context`（`agent.inject`，不唤醒空闲会话）；`strong` 用 `wake`（`agent.followup`，唤醒会话）。`wakeAtLevel=3`；改成 4 可关闭唤醒。两种模式共用同一套冷却和配额。

**会话**：从本轮 `io.actions` 里找最后一个带 `sessionId` 的动作；没有就用持久化的 `lastSessionId`。`body_act` 会把当前会话 ID 放进动作载荷；HTTP 直接提交的动作没有会话 ID，不产生提醒。当前只有最近动作的会话收到提醒，不是完整的多会话路由。

**文本**：固定四句，以“身体感受：”开头，不带数值；例如“身体感受：胃里有些空，饥饿感开始明显。”文本是 `policy`，不是 LLM 生成。

**未实现**：通知历史文件、`agent/inbox/inserted` 已读确认、按会话绑定不同身体、恶心/腹胀/疼痛/撑感提醒。Gateway 的 `GET /notifications` 仍是待确认队列；投递泵在 `inject`/`followup` 入队后 ACK，不表示模型已经读取。
