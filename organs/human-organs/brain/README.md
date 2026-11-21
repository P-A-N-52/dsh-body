# 脑：体感与上报（brain）

P1 的 `brain/` 有两个脚本：`interoception.ts` 把胃壁机械感受、胃饥饿素和十二指肠营养暴露汇成 0–100 mm 的饥饿与饱满代理；`notify.ts` 在明显/强档位按会话决定是否提醒。两者只写自己的部位，不写其他器官。

实现状态：脚本与参数已在 `organs/human-organs/brain/`；根清单已挂载两个脚本；`body_act` / `body_state` 与通知投递在 `index.js` / `tools.js` / `notifications.js`。`interoception` 是 `producer only` 的体感读出；`brainNotify` 是提醒策略，负责频率和次数。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `interoception.ts` | `interoception` | `hunger`、`fullness` | `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration`、`duodenum.nutrientExposure` | `interoception.parameters.json` |
| `notify.ts` | `brainNotify` | `lastSessionId`、`sessions`（内部状态） | `interoception.hunger/fullness`；本轮动作里的 `sessionId` | `notify.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `hunger` | `mm` | 饥饿的 0–100 mm VAS 代理 |
| `fullness` | `mm` | 饱满的 0–100 mm VAS 代理 |

`hunger` / `fullness` **不是物理长度、神经放电或激素浓度**，也不是胃容积或胃壁张力。`mm` 只沿用 100-mm 视觉模拟量表的刻度；把它们与胃内容量、血浆饥饿素或迷走传入放电互换没有方法学依据。

`initialState` 为 `{ hunger: 50, fullness: 0 }`，取自两个 `design` 基线参数。脚本每轮从上游输入重算，输出钳到 `[0, 100]`，不读自己的上一轮状态。

`brainNotify` 的字段：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `lastSessionId` | `1` | 最近一次带 `sessionId` 的动作所属会话；没有则为 `null` |
| `sessions` | `1` | 每个会话的提醒状态：上次提醒时间、上次档位、小时/天计数、最近出现时间 |

`sessions` 是内部策略状态，不是生理读数；按 `maxTrackedSessions` 保留最近 32 个会话。

## 3. 输入与方程

三个输入都取自同一轮的轮初快照；缺失或非有限时按默认值处理：

| 输入 | 含义 | 缺失 / 非有限默认值 |
| --- | --- | --- |
| `stomachSensory.mechanical` | 胃壁机械感受代理，0–1；不是张力或神经放电 | 0 |
| `stomachGhrelin.relativeConcentration` | 相对饥饿素浓度，空腹基线 1、餐后谷值 0.5；不是 `ng/mL` | 1 |
| `duodenum.nutrientExposure` | 十二指肠近期营养暴露代理，`kcal/min`；不是吸收速率或血糖 | 0 |

先钳输入：`M = clamp(mechanical, 0, 1)`、`G = max(0, relativeConcentration)`、`N = max(0, nutrientExposure)`。然后：

```text
hunger   = clamp(hungerBaseline   + hungerGhrelinGain   × (G − 1)
                                  + hungerMechanicalGain × M
                                  + hungerNutrientGain   × N, 0, 100)
fullness = clamp(fullnessBaseline + fullnessGhrelinGain × (G − 1)
                                  + fullnessMechanicalGain × M
                                  + fullnessNutrientGain   × N, 0, 100)
```

输入到输出有**一轮偏移**：同一轮的摄入先由胃脚本记账，下一轮的轮初快照里才出现新的 `mechanical`、`relativeConcentration` 与 `nutrientExposure`。

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

八个参数全部 `status: "design"`、`source: null`：它们是工程假设，不是人体测量，也不是开发集拟合或独立验证结果。

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
- `interoception.discomfort.threshold` 与 `interoception.discomfort.slope`（原 `unset`）没有迁入。P1 不建模恶心、腹胀、疼痛或过度饱满，也没有脚本或会话工具读它们；留两个 `unset` 参数只会假装这些量已被建模。

## 5. 调节方式

P1 只接三类只读输入：胃机械感受、相对饥饿素、十二指肠营养暴露；三者进入同一条线性叠加。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 恶心、腹胀、疼痛、过度饱满（撑感）等独立症状；
- 餐食成分（脂肪 / 蛋白 / 碳水比例）、黏度、能量密度、温度、碳酸与甜味剂；
- 餐时表、昼夜节律、睡眠、运动与疾病；
- 个体差异：年龄、性别、BMI、胃排空与激素水平的个体化参数；
- CCK、GLP-1 等肠激素，以及迷走与中枢反馈；
- 通知历史文件、模型已读确认与按会话绑定不同身体（当前只有最近动作的会话收到提醒）。

## 6. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程 / 参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`../stomach/references/notes/`](../stomach/references/notes/)：
  - `cummings-2001.md`（`SRC-CUMMINGS-2001`，摘要 Results）：餐前饥饿素升、餐后 1 h 内降的方向。
  - `leone-2022.md`（`SRC-LEONE-2022`，Table 2、Table 4 与 Results）：混合餐后相对饥饿素与饥饿 / 饱满评分的同批变化方向。
  - `levine-2015.md`（`SRC-LEVINE-2015`，Table 1 与 Methods 第 3 节）：237 mL、355 kcal 高脂液餐后 0–60 min 的胃饱满 VAS 时序与量表口径。
  - `camps-2016.md`（`SRC-CAMPS-2016`，摘要 Results）：饱感排序可以与胃排空 t50 排序不一致。
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)

**证据边界：** 这些来源只支撑方向——餐后饥饿素下降、饥饿下降与饱满上升，胃充盈与营养到达参与饱感，饱感不只看排空。它们**没有**把机械感受、营养暴露或相对饥饿素校准到 0–100 mm VAS；线性叠加、基线、八个增益与缺失默认值全是 `design`。方程不是论文原方程，也没有独立验证或盲法留出。`brainNotify` 的阈值、冷却和次数上限没有登记人体来源，是 `policy`，不能当成生理常数。

## 7. 当前限制

- **体感已接入提醒**：`interoception` 仍是 `producer only` 的读出；`brainNotify` 会调用 `io.notify`，`notifications.js` 再投递到对应会话。通知历史文件、模型已读确认与多会话路由尚未实现。
- **不是生理测量**：`hunger` / `fullness` 是主观评分的代理，不能当作物理长度、神经放电、激素浓度或胃容积。
- **线性叠加是设计**：没有交互项、阈值、饱和或餐型差异；三路输入各自独立相加。
- **未建模过度饱满**：`fullness` 封顶 100，但疼痛、恶心、腹胀与“撑得难受”没有独立读出。
- **没有餐时表**：不能产生餐前饥饿上升；饥饿素只由胃脚本的餐后抑制与恢复驱动。
- **没有个体化**：年龄、性别、BMI、胃排空与激素差异都不进入方程；八个参数是证据默认值，不是某具身体的最终值。

## 8. 体感提醒（`brainNotify`）

`notify.ts` 只做三件事：判断当前饥饿/饱满是否达到“值得说”的档位、检查这个会话的冷却和配额、把固定文本交给 `io.notify`。它不生成新感受，也不改 `interoception`。

**档位**：`hunger` 和 `fullness` 各自按 `marked=65`、`strong=85` 分档；取两者中更高的档位，同档优先 `fullness`。只有 `marked` / `strong` 才可能提醒。

**防重复**：同一档位不重复；档位降到 `resetBelow=40` 以下后，下一次升到 `marked` 才重新有资格。冷却 `45` 仿真分钟；同一会话每小时最多 `2` 次、每天最多 `6` 次。小时/天窗口从会话首次出现或上次重置起算，跨过 3600/86400 仿真秒清零。被冷却或配额挡住的上升不会更新 `lastLevel`，条件满足后仍可提醒。

**投递方式**：`marked` 用 `context`（`agent.inject`，不唤醒空闲会话）；`strong` 用 `wake`（`agent.followup`，唤醒会话）。`wakeAtLevel=3`；改成 4 可关闭唤醒。两种模式共用同一套冷却和配额。

**会话**：从本轮 `io.actions` 里找最后一个带 `sessionId` 的动作；没有就用持久化的 `lastSessionId`。`body_act` 会把当前会话 ID 放进动作载荷；HTTP 直接提交的动作没有会话 ID，不产生提醒。当前只有最近动作的会话收到提醒，不是完整的多会话路由。

**文本**：固定四句，以“身体感受：”开头，不带数值；例如“身体感受：胃里有些空，饥饿感开始明显。”文本是 `policy`，不是 LLM 生成。

**未实现**：通知历史文件、`agent/inbox/inserted` 已读确认、按会话绑定不同身体、恶心/腹胀/疼痛/撑感提醒。Gateway 的 `GET /notifications` 仍是待确认队列；投递泵在 `inject`/`followup` 入队后 ACK，不表示模型已经读取。
