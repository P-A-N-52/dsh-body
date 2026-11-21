# 胃（stomach）

胃由三个脚本组成：动力与排空、胃内分泌（饥饿素）、胃壁机械感受。三个脚本各写一个部位，互不写对方状态；机械感受只读 `stomach.volumeMl`，体感脚本再读机械感受与饥饿素。

实现状态：脚本与参数已在 `organs/human-organs/stomach/`；根清单已挂载这些脚本；身体启用时，启动 Gateway 即加载。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `motility.ts` | `stomach` | `volumeMl`、`energyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt`、`mealQueue` | 自己的轮初状态 `stomach`；`io.actions` 里的 `drink` / `eat` | `motility.parameters.json` |
| `ghrelin.ts` | `stomachGhrelin` | `relativeConcentration` | 自己的轮初状态 `stomachGhrelin`；`io.actions` 里含能量的 `eat` | `ghrelin.parameters.json` |
| `gastric-sensory.ts` | `stomachSensory` | `mechanical` | `stomach.volumeMl` | `gastric-sensory.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

所有字段都是 `fields` 里声明的 `absolute` 写入，只有对应部位自己的脚本写它。

### `stomach`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `volumeMl` | `mL` | 轮末胃内容物体积（状态） |
| `energyKcal` | `kcal` | 轮末胃内剩余能量（状态） |
| `emptiedMl` | `mL` | 本轮排出的体积（每轮通量，不是累计） |
| `emptiedKcal` | `kcal` | 本轮排出的能量（每轮通量，不是累计）；十二指肠读这个字段 |
| `lastIntakeAt` | `s` | 最近一次有摄入进入胃的轮末仿真秒（`io.simulatedSeconds`）；`null` 表示还没有摄入 |
| `mealQueue` | `1` | 内部队列，不是读数：多轮摄入在胃内待释放的余量 |

`emptiedMl` / `emptiedKcal` 每轮按当轮状态重新计算，不累加；需要累计排出量时由读者按轮求和。`mealQueue` 只用来保留并发摄入的时间分布，不对应任何生理测量。`lastIntakeAt` 的单位是仿真秒，不是现实时间戳。

取舍说明：`mealKind` 目前是元数据，不参与任何方程；`lastIntakeAt` 目前没有消费者（`producer only / not consumed`）；`emptiedMl` / `emptiedKcal` 是观察与重放读数，不是其他器官的输入。详见设计文档 §2.1。

动力方程（一阶指数排空，先排空后入胃）：

- `energyDensity = volumeMl > 0 ? energyKcal / volumeMl : 0`，单位 `kcal/mL`；
- `h = halfTimeMin + energyDensityGain × energyDensity`，单位 `min`；
- `emptiedMl = max(0, volumeMl − baselineMl) × (1 − 2^(−dtMin/h))`，`emptiedKcal = emptiedMl × energyDensity`；
- 摄入切片在本轮排空之后进入 `volumeMl` / `energyKcal`。

摄入动作：`drink` 需要 `volumeMl > 0`，可选 `energyKcal`（有限数、`>= 0`，缺省 0）与 `durationMin`，固定按 `liquid` 处理；白水省略能量或填 0，可乐、果汁、牛奶等含能饮料填实际能量。`eat` 需要 `volumeMl`、`energyKcal ≥ 0`、`mealKind`（`liquid` / `solid` / `mixed`）与可选的 `durationMin`。两者都按轮切片进入，避免一次大餐整体落在同一轮。字段缺失、单位或取值非法的动作被忽略；饮料的成分、黏度、碳酸、甜味剂不进入方程。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `stomach.emptying.halfTimeMin` | 13 | `min` | `design` | `SRC-MUDIE-2014` |
| `stomach.emptying.baselineMl` | 0 | `mL` | `design` | `SRC-MUDIE-2014` |
| `stomach.emptying.energyDensityGainMinPerKcalPerMl` | 53.75 | `min/(kcal/mL)` | `fitted_dev` | `SRC-CAMPS-2016` |

### `stomachGhrelin`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `relativeConcentration` | `1` | 相对浓度（空腹基线为 1，餐后谷值为 0.5），不是 `pg/mL` 或任何绝对浓度 |

只有含能量的 `eat` 或 `drink`（`energyKcal > 0`）会在本轮把相对浓度压到不高于谷值（`min(current, nadir)`），白水与 0 kcal 饮料不抑制；随后按表观半时向基线指数恢复。`actionTypes = ['eat', 'drink']` 只是声明，脚本自己再检查能量。P1 的 `brain/interoception.ts` 读取这个字段；通知与会话消费者仍未实现。含能饮料的抑制方向是从含能餐证据外推的 `design` 假设，没有登记饮料专属来源。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `stomachGhrelin.fasting.baseline` | 1 | `1` | `design` | — |
| `stomachGhrelin.postmeal.nadir` | 0.5 | `1` | `design` | — |
| `stomachGhrelin.recovery.apparentHalfTimeMin` | 90 | `min` | `design` | — |

### `stomachSensory`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `mechanical` | `1` | 胃壁机械感受代理，取值 0–1；不是胃壁张力，也不是迷走传入放电 |

`mechanical = min(1, volumeMl / referenceVolumeMl) ^ exponent`。

`mechanical` 读的是轮初快照里的 `stomach.volumeMl`，同一轮摄入要到下一轮才反映。P1 的 `brain/interoception.ts` 读取这个字段；通知与会话消费者仍未实现。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `stomachSensory.referenceVolumeMl` | 1000 | `mL` | `design` | — |
| `stomachSensory.response.exponent` | 1 | `1` | `design` | — |

### 与其他器官的接口

十二指肠的 `nutrient-exposure.ts` 读本部位的 `emptiedKcal`，滤波成 `nutrientExposure`（单位 `kcal/min` 的代理）；`brain/interoception.ts` 再读 `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration` 与 `duodenum.nutrientExposure`。胃不写这些字段。

## 3. 调节方式

当前只接两类输入：

1. **摄入**：`drink` 与 `eat` 动作；体积、能量、餐型和进食时长都来自动作载荷。
2. **自身状态**：胃内容量与剩余能量按上一轮状态自洽推进；机械感受只读 `volumeMl`。

以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 迷走神经与肠神经系统的反馈；
- CCK、GLP-1、胃泌素、促胰液素等胃肠激素；
- 餐时表、昼夜节律与餐前饥饿素上升；
- 体位、运动、胃酸分泌、黏膜与胃内混合。

## 4. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程/参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 字段字典与证据卡模板：[`../references/m1-data-dictionary.md`](../references/m1-data-dictionary.md)
- 逐篇笔记：[`references/notes/`](references/notes/)（Mudie 2014、Tougas 2000、Camps 2016、Levine 2015、Cummings 2001、Leone 2022，以及模板）
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)

## 5. 当前限制

- **饥饿素不建模餐前上升**：没有餐时表，当前无法触发餐前升；只做“含能量摄入抑制 → 表观半时恢复”。
- **机械感受是代理**：`mechanical` 是归一化充盈代理，不是张力或神经放电；参考量与指数都是 `design`，不是人体拟合。
- **所有餐型共用 13 min 截距**：`stomach.emptying.halfTimeMin` 不区分 `liquid` / `solid` / `mixed`，`mealKind` 只被记录、未进入方程。13 min 来自 Mudie 2014 白水摘要，摘要未写 T50 定义与起算点，只作工程假设；这是已知简化，不是“餐型已被区分”的证据。
- **能量密度增益是开发集拟合**：53.75 只用 Camps 2016 同一批 15 人的 thin-100 与 thin-500 两臂，标为 `fitted_dev`，不是独立验证。
- 没有不可排空残余：`baselineMl` 只是可调偏置，模型允许胃排到 0。
- 不做胃内混合、分层、胃酸、温度和黏膜状态；`mechanical` 与 `relativeConcentration` 由 `brain/interoception.ts` 读取，但通知与会话投递仍未实现。
