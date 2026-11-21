# 胃（stomach）

胃由三个脚本组成：动力与排空、胃内分泌（饥饿素）、胃壁机械感受。三个脚本各写一个部位，互不写对方状态；机械感受只读 `stomach.volumeMl`，体感脚本再读机械感受与饥饿素。

实现状态：脚本与参数已在 `organs/human-organs/stomach/`；根清单已挂载这些脚本；身体启用时，启动 Gateway 即加载。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `motility.ts` | `stomach` | `volumeMl`、`energyKcal`、`solidVolumeMl`、`solidEnergyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt`、`mealQueue` | 自己的轮初状态 `stomach`；`io.actions` 里的 `drink` / `eat` | `motility.parameters.json` |
| `ghrelin.ts` | `stomachGhrelin` | `relativeConcentration` | 自己的轮初状态 `stomachGhrelin`；`io.actions` 里含能量的 `eat` | `ghrelin.parameters.json` |
| `gastric-sensory.ts` | `stomachSensory` | `mechanical` | `stomach.volumeMl` | `gastric-sensory.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

所有字段都是 `fields` 里声明的 `absolute` 写入，只有对应部位自己的脚本写它。

### `stomach`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `volumeMl` | `mL` | 轮末胃内容物体积总量（状态），包含 `solidVolumeMl` |
| `energyKcal` | `kcal` | 轮末胃内剩余能量总量（状态），包含 `solidEnergyKcal` |
| `solidVolumeMl` | `mL` | `volumeMl` 中已入胃固餐的体积小计（状态）；固定大小的记账字段，不是新的动作参数，初值 0 |
| `solidEnergyKcal` | `kcal` | `energyKcal` 中已入胃固餐的能量小计（状态），初值 0 |
| `emptiedMl` | `mL` | 本轮排出的体积合计（每轮通量，不是累计），含固餐与非固餐两组 |
| `emptiedKcal` | `kcal` | 本轮排出的能量合计（每轮通量，不是累计），含固餐与非固餐两组；十二指肠读这个字段 |
| `lastIntakeAt` | `s` | 最近一次有摄入进入胃的轮末仿真秒（`io.simulatedSeconds`）；`null` 表示还没有摄入 |
| `mealQueue` | `1` | 内部队列，不是读数：多轮摄入在胃内待释放的余量，保留各自的 `mealKind` |

`volumeMl` / `energyKcal` 是轮末总量；`solidVolumeMl` / `solidEnergyKcal` 是总量中固餐那一份的小计，不是加在总量之外的第二份账本，读取总量时不要再把小计加一遍。`emptiedMl` / `emptiedKcal` 每轮按两组排空之和重新计算，不累加；`emptiedMl` 只作观察与重放读数，`emptiedKcal` 由十二指肠的 `nutrient-exposure.ts` 读取。需要累计排出量时由读者按轮求和。小计只在查询完整 `stomach` 原始状态时可见；`brain/interoception.ts` 不直接读这两个通量字段，它经 `stomachSensory.mechanical`（总量体积）与 `duodenum.nutrientExposure`（由 `emptiedKcal` 滤波的代理）间接取得信号，所以体感读数会随分组后的总量与排出量变化，而不是保持不变。`mealQueue` 只用来保留并发摄入的时间分布，不对应任何生理测量；`lastIntakeAt` 的单位是仿真秒，不是现实时间戳。

取舍说明：`mealKind` 只在 `eat` 的 `solid` 上改变排空路径；`drink`、`liquid` 与 `mixed` 仍走原算法，`mixed` 不拆分固液。`lastIntakeAt` 目前没有消费者（`producer only / not consumed`）；`emptiedMl` 只作观察与重放读数，`emptiedKcal` 由十二指肠读取并滤波成营养暴露代理；`brain/interoception.ts` 经胃充盈与十二指肠营养暴露间接取得信号，不直接读通量字段。设计见 [固／液餐小改设计](../../../docs/superpowers/specs/2026-11-21-solid-meal-emptying-design.md)。

动力方程（一阶指数排空，先排空后入胃；固餐小计与非固餐内容物分组结算后汇总）：

- 非固餐组（原算法组）：`baseVolumeMl = max(0, volumeMl − solidVolumeMl)`、`baseEnergyKcal = max(0, energyKcal − solidEnergyKcal)`；`energyDensity = baseVolumeMl > 0 ? baseEnergyKcal / baseVolumeMl : 0`（`kcal/mL`）；`h = halfTimeMin + energyDensityGain × energyDensity`（`min`）；`emptiedMlFromBase = max(0, baseVolumeMl − baselineMl) × (1 − 2^(−dtMin/h))`，`emptiedKcalFromBase = emptiedMlFromBase × energyDensity`。
- 固餐组：`solidFraction = 1 − 2^(−dtMin/solidHalfTimeMin)`；`emptiedMlFromSolid = solidVolumeMl × solidFraction`，`emptiedKcalFromSolid = solidEnergyKcal × solidFraction`；不设另一个残余偏置。
- `emptiedMl = emptiedMlFromBase + emptiedMlFromSolid`，`emptiedKcal = emptiedKcalFromBase + emptiedKcalFromSolid`；两组在模型内互不改变对方的速率。
- 摄入切片在本轮排空之后进入总量；只有 `eat` 的 `mealKind: "solid"` 进入固餐小计，`drink`、`liquid`、`mixed` 进入非固餐组。`mealQueue` 只保留待释放量，并保留每份切片的 `mealKind`；同一个动作只登记一次。
- 旧存档缺少 `solidVolumeMl` / `solidEnergyKcal` 时按 0 加载；已经入胃的存量（`volumeMl` / `energyKcal`）全部按原算法推进，不猜历史餐型。`mealQueue` 里尚未释放的切片保留原来的 `mealKind`，以后逐轮释放时照常入账：`solid` 进固餐小计，其余进非固餐组。

摄入动作：`drink` 需要 `volumeMl > 0`，可选 `energyKcal`（有限数、`>= 0`，缺省 0）与 `durationMin`，固定按 `liquid` 处理；白水省略能量或填 0，可乐、果汁、牛奶等含能饮料填实际能量。`eat` 需要 `volumeMl`、`energyKcal ≥ 0`、`mealKind`（`liquid` / `solid` / `mixed`）与可选的 `durationMin`。两者都按轮切片进入，避免一次大餐整体落在同一轮；仅有 `mealKind: "solid"` 的 `eat` 计入固餐小计。字段缺失、单位或取值非法的动作被忽略；`body_act` / `body_state` 的参数不变，饮料的成分、黏度、碳酸、甜味剂不进入方程。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `stomach.emptying.halfTimeMin` | 13 | `min` | `design` | `SRC-MUDIE-2014` |
| `stomach.emptying.baselineMl` | 0 | `mL` | `design` | `SRC-MUDIE-2014` |
| `stomach.emptying.energyDensityGainMinPerKcalPerMl` | 53.75 | `min/(kcal/mL)` | `fitted_dev` | `SRC-CAMPS-2016` |
| `stomach.emptying.solidHalfTimeMin` | 68.7 | `min` | `design` | `SRC-VASAVID-2014` |

`solidHalfTimeMin` 的 68.7 min 是 Vasavid 2014 健康成人米饭鸡蛋标准餐的标记固相半排空时间中位数（`reported`）；把它当作一阶排空的固定半时是工程简化（`design`），参数文件的 `[1, 240]` 只是工程调参范围，不是人体百分位。模型不按固餐体积或能量密度再加权，也不复现论文的早期滞后与完整曲线。

### `stomachGhrelin`

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `relativeConcentration` | `1` | 相对浓度（空腹基线为 1，餐后谷值为 0.5），不是 `pg/mL` 或任何绝对浓度 |

只有含能量的 `eat` 或 `drink`（`energyKcal > 0`）会在本轮把相对浓度压到不高于谷值（`min(current, nadir)`），白水与 0 kcal 饮料不抑制；随后按表观半时向基线指数恢复。`actionTypes = ['eat', 'drink']` 只是声明，脚本自己再检查能量。P1 的 `brain/interoception.ts` 读取这个字段，`brainNotify` 再决定是否提醒；通知历史与模型已读确认仍未实现。含能饮料的抑制方向是从含能餐证据外推的 `design` 假设，没有登记饮料专属来源。

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

`mechanical` 读的是轮初快照里的 `stomach.volumeMl`，同一轮摄入要到下一轮才反映。P1 的 `brain/interoception.ts` 读取这个字段，`brainNotify` 再决定是否提醒；通知历史与模型已读确认仍未实现。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `stomachSensory.referenceVolumeMl` | 1000 | `mL` | `design` | — |
| `stomachSensory.response.exponent` | 1 | `1` | `design` | — |

### 与其他器官的接口

十二指肠的 `nutrient-exposure.ts` 读本部位的 `emptiedKcal`，滤波成 `nutrientExposure`（单位 `kcal/min` 的代理）；`brain/interoception.ts` 再读 `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration` 与 `duodenum.nutrientExposure`。胃不写这些字段。

## 3. 调节方式

当前只接两类输入：

1. **摄入**：`drink` 与 `eat` 动作；体积、能量、餐型和进食时长都来自动作载荷。`eat` 的 `mealKind: "solid"` 进入固餐小计，`drink`、`liquid` 与 `mixed` 进入非固餐组。
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
- 逐篇笔记：[`references/notes/`](references/notes/)（Mudie 2014、Tougas 2000、Vasavid 2014、Camps 2016、Levine 2015、Cummings 2001、Leone 2022，以及模板）
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)

## 5. 当前限制

- **饥饿素不建模餐前上升**：没有餐时表，当前无法触发餐前升；只做“含能量摄入抑制 → 表观半时恢复”。
- **机械感受是代理**：`mechanical` 是归一化充盈代理，不是张力或神经放电；参考量与指数都是 `design`，不是人体拟合。
- **固餐半时是参考值的工程借用**：`stomach.emptying.solidHalfTimeMin = 68.7 min` 来自 Vasavid 2014 健康成人米饭鸡蛋标准餐的标记固相半排空时间中位数，参数状态是 `design`。论文报告的是标记保留比例，不是胃总内容量 mL 或 kcal，也没有同能量同体积的液餐对照；模型不复现 18.6 min 的滞后和完整曲线，不能据此说“任何固餐都比任何液餐慢”，也不把 68.7 min 当已验证的人体参数。
- **`mixed` 不拆分固液**：`mixed` 仍走非固餐组，不推断固液占比；没有研磨、分层或显式滞后。
- **非固餐组的 13 min 截距仍是白水工程假设**：`stomach.emptying.halfTimeMin` 用于扣除固餐小计后的原算法组（`drink`、`liquid`、`mixed` 与旧存档已入胃存量），13 min 来自 Mudie 2014 白水摘要，摘要未写 T50 定义与起算点。
- **旧存档不猜已入胃存量餐型**：缺少 `solidVolumeMl` / `solidEnergyKcal` 时按 0 加载，已经入胃的 `volumeMl` / `energyKcal` 按原算法推进，不重置也不推定为固体；`mealQueue` 中尚未释放的切片仍按各自的 `mealKind` 入账。
- **能量密度增益是开发集拟合**：53.75 只用 Camps 2016 同一批 15 人的 thin-100 与 thin-500 两臂，标为 `fitted_dev`，不是独立验证。
- 没有不可排空残余：`baselineMl` 只是可调偏置，模型允许胃排到 0。
- 不做胃内混合、分层、胃酸、温度和黏膜状态；`mechanical` 与 `relativeConcentration` 由 `brain/interoception.ts` 读取，`brainNotify` 决定提醒，但通知历史与模型已读确认仍未实现。
