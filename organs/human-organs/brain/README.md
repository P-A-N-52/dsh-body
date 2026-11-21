# 脑：体感与上报（brain）

P1 的 `brain/` 目前只有一个脚本 `interoception.ts`：把胃壁机械感受、胃饥饿素和十二指肠营养暴露汇成 0–100 mm 的饥饿与饱满代理。它只读三个上游信号、只写自己的部位，不发送通知，也没有会话工具。

实现状态：脚本与参数已在 `organs/human-organs/brain/`；根清单是否挂载以 `body-modules.json` 为准。P1 只产出体感，`interoception` 是 `producer only` 部位。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `interoception.ts` | `interoception` | `hunger`、`fullness` | `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration`、`duodenum.nutrientExposure` | `interoception.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `hunger` | `mm` | 饥饿的 0–100 mm VAS 代理 |
| `fullness` | `mm` | 饱满的 0–100 mm VAS 代理 |

`hunger` / `fullness` **不是物理长度、神经放电或激素浓度**，也不是胃容积或胃壁张力。`mm` 只沿用 100-mm 视觉模拟量表的刻度；把它们与胃内容量、血浆饥饿素或迷走传入放电互换没有方法学依据。

`initialState` 为 `{ hunger: 50, fullness: 0 }`，取自两个 `design` 基线参数。脚本每轮从上游输入重算，输出钳到 `[0, 100]`，不读自己的上一轮状态。

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
- 通知投递、会话工具与提醒历史。

## 6. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程 / 参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`../stomach/references/notes/`](../stomach/references/notes/)：
  - `cummings-2001.md`（`SRC-CUMMINGS-2001`，摘要 Results）：餐前饥饿素升、餐后 1 h 内降的方向。
  - `leone-2022.md`（`SRC-LEONE-2022`，Table 2、Table 4 与 Results）：混合餐后相对饥饿素与饥饿 / 饱满评分的同批变化方向。
  - `levine-2015.md`（`SRC-LEVINE-2015`，Table 1 与 Methods 第 3 节）：237 mL、355 kcal 高脂液餐后 0–60 min 的胃饱满 VAS 时序与量表口径。
  - `camps-2016.md`（`SRC-CAMPS-2016`，摘要 Results）：饱感排序可以与胃排空 t50 排序不一致。
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)

**证据边界：** 这些来源只支撑方向——餐后饥饿素下降、饥饿下降与饱满上升，胃充盈与营养到达参与饱感，饱感不只看排空。它们**没有**把机械感受、营养暴露或相对饥饿素校准到 0–100 mm VAS；线性叠加、基线、八个增益与缺失默认值全是 `design`。方程不是论文原方程，也没有独立验证或盲法留出。

## 7. 当前限制

- **只产出体感**：`interoception` 是 `producer only`；P1 没有 `body_act` / `body_state` 会话工具，没有通知投递，也没有 DSH 提醒消费者，脚本不调用 `io.notify`。
- **不是生理测量**：`hunger` / `fullness` 是主观评分的代理，不能当作物理长度、神经放电、激素浓度或胃容积。
- **线性叠加是设计**：没有交互项、阈值、饱和或餐型差异；三路输入各自独立相加。
- **未建模过度饱满**：`fullness` 封顶 100，但疼痛、恶心、腹胀与“撑得难受”没有独立读出。
- **没有餐时表**：不能产生餐前饥饿上升；饥饿素只由胃脚本的餐后抑制与恢复驱动。
- **没有个体化**：年龄、性别、BMI、胃排空与激素差异都不进入方程；八个参数是证据默认值，不是某具身体的最终值。
