# 胃（stomach）

胃目录包含四个模块入口和一个共享核心：动力与排空的共享核心 `motility-core.ts`、水链入口 `hydration.ts`、旧独立入口 `motility.ts`、胃内分泌（饥饿素）与胃壁机械感受。各入口写同一个 `stomach` 部位或各自的独立部位，互不写对方状态；机械感受只读 `stomach.volumeMl`，体感脚本再读机械感受与饥饿素。

实现状态：脚本与参数已在 `organs/human-organs/stomach/`，并已加入根清单；根清单挂载水链入口 `hydration.ts`，旧入口 `motility.ts` 仍可单独加载。同一清单绝不能同时加载两个 `stomach` 入口；也不要把水链清单切到旧清单再切回来保存待释放水或碳水，往返会丢失队列的水/碳水身份（见 §2）。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `hydration.ts` | `stomach` | 原胃字段加水与碳水存量/每轮排空量；声明到 `smallIntestine.waterVolumeMl` 和 `smallIntestine.carbohydrateG` 的转移 | 自己的轮初状态 `stomach`；`io.actions` 里的 `drink` / `eat` | `motility.parameters.json` |
| `motility.ts` | `stomach` | 原胃字段（`volumeMl`、`energyKcal`、`solidVolumeMl`、`solidEnergyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt`、`mealQueue`）；不记水/碳水、不声明 transfer | 自己的轮初状态 `stomach`；`io.actions` 里的 `drink` / `eat` | `motility.parameters.json` |
| `ghrelin.ts` | `stomachGhrelin` | `relativeConcentration`、`minutesSinceEnergyIntake` | 自己的轮初状态 `stomachGhrelin`；`io.actions` 里含能量的 `eat` / `drink` | `ghrelin.parameters.json` |
| `gastric-sensory.ts` | `stomachSensory` | `mechanical` | `stomach.volumeMl` | `gastric-sensory.parameters.json` |

`motility-core.ts` 不是模块，不导出 `id`；它是两个入口共用的解析、队列与排空方程。`motility.ts` 用 `trackWater: false`、`trackCarbohydrate: false` 调用核心，输出形状与历史一致，可单独加载且不需要小肠或膀胱；`hydration.ts` 同时开启水与碳水跟踪，必须与 `smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose` 及 [`skin`](../skin/README.md) 同时加载；这七个部位构成完整硬 transfer 闭包，缺任一个都会因 transfer 字段配对校验拒绝启动。

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
| `mealQueue` | `1` | 内部队列，不是读数：多轮摄入在胃内待释放的余量，保留各自的 `mealKind` 与可选的水余量 |
| `waterVolumeMl` | `mL` | `volumeMl` 中非固餐水分的那一份（状态）；`hydration.ts` 声明到 `smallIntestine.waterVolumeMl` 的 `transferOut`，初值 0 |
| `emptiedWaterMl` | `mL` | 本轮随非固餐排出转入小肠的水量（每轮通量，不是累计）；只由 `hydration.ts` 写 |
| `carbohydrateG` | `g` | 轮末胃内可消化葡萄糖当量碳水总量（状态），含固体小计；`hydration.ts` 声明到 `smallIntestine.carbohydrateG` 的 `transferOut`，初值 0 |
| `solidCarbohydrateG` | `g` | `carbohydrateG` 中按固餐组排空的小计（状态），不是总量之外的第二份碳水 |
| `emptiedCarbohydrateG` | `g` | 本轮胃向小肠转出的碳水（每轮通量，不是累计） |

`volumeMl` / `energyKcal` 是轮末总量；`solidVolumeMl` / `solidEnergyKcal` 是总量中固餐那一份的小计，不是加在总量之外的第二份账本，读取总量时不要再把小计加一遍。`emptiedMl` / `emptiedKcal` 每轮按两组排空之和重新计算，不累加；`emptiedMl` 只作观察与重放读数，`emptiedKcal` 由十二指肠的 `nutrient-exposure.ts` 读取。需要累计排出量时由读者按轮求和。小计只在查询完整 `stomach` 原始状态时可见；`brain/interoception.ts` 不直接读这两个通量字段，它经 `stomachSensory.mechanical`（总量体积）与 `duodenum.nutrientExposure`（由 `emptiedKcal` 滤波的代理）间接取得信号，所以体感读数会随分组后的总量与排出量变化，而不是保持不变。`mealQueue` 只用来保留并发摄入的时间分布，不对应任何生理测量；`lastIntakeAt` 的单位是仿真秒，不是现实时间戳。

取舍说明：`mealKind` 只在 `eat` 的 `solid` 上改变排空路径；`drink`、`liquid` 与 `mixed` 仍走原算法，`mixed` 不拆分固液。`lastIntakeAt` 目前没有消费者（`producer only / not consumed`）；`emptiedMl` 只作观察与重放读数，`emptiedKcal` 由十二指肠读取并滤波成营养暴露代理；`brain/interoception.ts` 经胃充盈与十二指肠营养暴露间接取得信号，不直接读通量字段。设计见 [固／液餐小改设计](../../../docs/superpowers/specs/2026-11-21-solid-meal-emptying-design.md)。

### 水子集（`hydration.ts`，`design`）

`waterVolumeMl` 是 `volumeMl` 中的水子集，不是加在总量之外的第二份体积。设轮初非固餐体积 `N = max(0, volumeMl − solidVolumeMl)`、水 `W = clamp(waterVolumeMl ?? 0, 0, N)`；核心返回非固餐排出量 `E_nonSolid` 与本轮新入胃饮水量 `D`：

```text
emptiedWaterMl = E_nonSolid × (N > 0 ? W / N : 0)
write.waterVolumeMl = W + D
transfer stomach → smallIntestine: emptiedWaterMl
```

- `drink` 的全部 `volumeMl` 记为水；`eat`（含 `liquid` / `mixed`）不反推水，也不增加 `waterMl` 动作参数。把饮料总体积近似为可吸收水是 `design`，不是实测纯水含量。
- 只有非固餐排出带水；固餐排出不带水。胃总 `volumeMl` 仍由核心只扣一次原排空量，`waterVolumeMl` 不能加回总量。
- 先 write、后 transfer：write 的是转出前基准 `W + D`，Gateway 在轮末扣 `emptiedWaterMl`；`D` 本轮不再排出。
- 多轮 `drink` 在 `mealQueue` 里保留水余量与每轮水切片；旧切片缺 `remainingWaterMl` / `rateWaterMl` 时按 0，不猜历史饮品。
- **legacy 往返不保留待释放水**：旧 `motility.ts` 以 `trackWater: false` 推进既有 `mealQueue` 时会剥离切片的 `remainingWaterMl` / `rateWaterMl`，并按历史形状写回不含水字段的胃状态。因此“水链清单 → legacy 清单 → 水链清单”不是待释放水的无损迁移：切回 `hydration.ts` 时队列水按 0 计，不反推。正常旧档（从未运行过水链）升级到水链只补 0，不受这条往返边界影响。
- 旧存档缺 `waterVolumeMl` 时按 0；旧胃总量、能量与固餐小计不重置。
- `emptiedWaterMl` 只作胃→小肠的转移量，不是十二指肠或体感的直接输入；`emptiedMl` 仍只作观察与重放读数。

### 碳水记账（`hydration.ts`，`design`）

`carbohydrateG` 是与体积、能量并列的独立质量账，表示可消化葡萄糖当量碳水；不从 `volumeMl`、`energyKcal` 或固定 `4 kcal/g` 反推。设轮初总碳水 `C`、固体小计 `Cs`、非固餐碳水 `Cn = C − Cs`，核心给出非固餐体积排出量 `E_nonSolid`、非固餐体积 `N` 与固餐排出比例 `f_solid`：

```text
Ecn = N > 0 ? E_nonSolid × Cn / N : 0
Ecs = Cs × f_solid
Ec  = Ecn + Ecs
write.carbohydrateG = C + D
write.solidCarbohydrateG = Cs − Ecs + Ds
write.emptiedCarbohydrateG = Ec
transfer stomach → smallIntestine: Ec
```

`D` 是本轮队列与新动作释放的碳水，`Ds` 是其中固餐部分。总碳水只由 Gateway 在 transfer 阶段扣一次；固体小计必须由胃脚本预先写成扣除 `Ecs` 后的值，否则小计会滞留。`mixed` 仍归非固餐组，不拆混合餐内部成分。

- 多轮摄入在 `mealQueue` 保存 `remainingCarbohydrateG` / `rateCarbohydrateGPerRound`，最后一轮释放全部余量；即使体积和能量余量为 0，剩余碳水也要释放并移除队列。
- 旧胃状态和旧队列缺碳水字段时按 0，不猜历史成分。legacy `motility.ts` 不暴露碳水字段，推进会剥离队列碳水元数据，不能用于完整清单往返保存待释放碳水。
- `emptiedCarbohydrateG` 是胃到小肠的转移读数，不是十二指肠营养暴露或体感的直接输入；碳水经 `smallIntestine` 到 `glucose` 的路径见[葡萄糖隔室](../../human-compartments/glucose/README.md)。
- 固/非固餐按比例携带碳水是工程假设，不是选择性排空或消化速度的实测模型。设计与质量账见[碳水—血糖薄切片设计](../../../docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)。

动力方程（一阶指数排空，先排空后入胃；固餐小计与非固餐内容物分组结算后汇总）：

- 非固餐组（原算法组）：`baseVolumeMl = max(0, volumeMl − solidVolumeMl)`、`baseEnergyKcal = max(0, energyKcal − solidEnergyKcal)`；`energyDensity = baseVolumeMl > 0 ? baseEnergyKcal / baseVolumeMl : 0`（`kcal/mL`）；`h = halfTimeMin + energyDensityGain × energyDensity`（`min`）；`emptiedMlFromBase = max(0, baseVolumeMl − baselineMl) × (1 − 2^(−dtMin/h))`，`emptiedKcalFromBase = emptiedMlFromBase × energyDensity`。
- 固餐组：`solidFraction = 1 − 2^(−dtMin/solidHalfTimeMin)`；`emptiedMlFromSolid = solidVolumeMl × solidFraction`，`emptiedKcalFromSolid = solidEnergyKcal × solidFraction`；不设另一个残余偏置。
- `emptiedMl = emptiedMlFromBase + emptiedMlFromSolid`，`emptiedKcal = emptiedKcalFromBase + emptiedKcalFromSolid`；两组在模型内互不改变对方的速率。
- 摄入切片在本轮排空之后进入总量；只有 `eat` 的 `mealKind: "solid"` 进入固餐小计，`drink`、`liquid`、`mixed` 进入非固餐组。`mealQueue` 只保留待释放量，并保留每份切片的 `mealKind`；同一个动作只登记一次。
- 旧存档缺少 `solidVolumeMl` / `solidEnergyKcal` 时按 0 加载；已经入胃的存量（`volumeMl` / `energyKcal`）全部按原算法推进，不猜历史餐型。`mealQueue` 里尚未释放的切片保留原来的 `mealKind`，以后逐轮释放时照常入账：`solid` 进固餐小计，其余进非固餐组。

摄入动作：`drink` 需要 `volumeMl > 0`，可选 `energyKcal`（有限数、`>= 0`，缺省 0）、`carbohydrateG`（有限数、`>= 0`，缺省 0）与 `durationMin`，固定按 `liquid` 处理；白水省略能量/碳水或填 0，可乐、果汁、牛奶等含能饮料填实际已知成分。`eat` 需要 `volumeMl`、`energyKcal ≥ 0`、`mealKind`（`liquid` / `solid` / `mixed`），碳水与时长可选。两者都按轮切片进入，避免一次大餐整体落在同一轮；仅有 `mealKind: "solid"` 的 `eat` 计入固餐小计。字段缺失、单位或取值非法的动作被忽略；`body_act` 新增可选 `carbohydrateG`，`body_state` 结构不变。体积/能量之外的成分、黏度、碳酸、甜味剂不进入方程。

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
| `relativeConcentration` | `1` | 相对浓度；餐间基准为 1，餐后谷值为 0.5，空腹上升目标约 1.8，不是 `pg/mL` 或任何绝对浓度 |
| `minutesSinceEnergyIntake` | `min` | 距上次含能摄入的仿真分钟数（状态，初值 0）；只由本脚本用 `io.dt` 累加，不读墙钟，也不读 `stomach.lastIntakeAt` |

设 `dtMin = io.dt / 60`，`t` 为轮初空腹分钟数，`c` 为轮初相对浓度：

```text
含能摄入（eat / drink，energyKcal 有限且 > 0）：
  t_next = 0
  c_next = min(c, postmeal.nadir)

无含能摄入：
  t_next = t + dtMin
  target = fasting.baseline
         + (fasting.peak - fasting.baseline)
         × (1 - 2^(-max(0, t_next - fasting.rise.onsetMin)
                         / fasting.rise.apparentHalfTimeMin))
  c_next = c + (target - c)
         × (1 - 2^(-dtMin / recovery.apparentHalfTimeMin))
```

摄入轮只抑制相对浓度并清零计时，不同时执行上升；纯水、0 kcal 饮料与非法能量值既不抑制也不重置计时。轮初计时缺失、负值或非有限时按 0，相对浓度缺失或非有限时按基线 1。`actionTypes = ['eat', 'drink']` 只是声明，脚本自己再检查能量。

上升是空腹时长驱动的工程曲线：`onsetMin` 之前保持原有的向基线恢复，之后目标值按表观半时逼近 `peak`，浓度随之饱和，不会无界增长。在胃机械与营养输入为 0、沿用当前 `interoception` 参数试算时，约 6.3 h 达到 `hunger = 65 mm` 明显档、约 12.1 h 达到 85 mm 强档，20 h 时约 `G = 1.80`、`hunger = 90 mm`。这些是设计试算，不是临床阈值或论文曲线；实际通知还受会话、档位、冷却与配额约束，没有会话时不保证提醒。

旧存档缺少 `minutesSinceEnergyIntake` 时由 `initialState` 补 0；保留原 `relativeConcentration`，从升级时刻重新累计，不根据 `lastIntakeAt`、存档 `simulatedSeconds` 或当前浓度反推过去空腹时长。升级第一轮不会凭空出现高饥饿；后续重启保留该字段，不反复清零。

P1 的 `brain/interoception.ts` 读取 `relativeConcentration`，`brainNotify` 再决定是否提醒；通知历史与模型已读确认仍未实现。含能饮料的抑制方向是从含能餐证据外推的 `design` 假设，没有登记饮料专属来源。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `stomachGhrelin.fasting.baseline` | 1 | `1` | `design` | — |
| `stomachGhrelin.fasting.peak` | 1.8 | `1` | `design` | — |
| `stomachGhrelin.fasting.rise.onsetMin` | 180 | `min` | `design` | — |
| `stomachGhrelin.fasting.rise.apparentHalfTimeMin` | 120 | `min` | `design` | — |
| `stomachGhrelin.postmeal.nadir` | 0.5 | `1` | `design` | — |
| `stomachGhrelin.recovery.apparentHalfTimeMin` | 90 | `min` | `design` | — |

`peak`、`onsetMin`、上升表观半时与整条时间驱动曲线全部是 `design`、`source: null`。Cummings 2001 只支持餐前上升、餐后下降的方向，Leone 2022 只支持餐后下降方向；两者都不能分离空腹时长、餐前预期与昼夜节律，也没有给出起始延迟、峰值或时间常数。`peak = 1.8` 不是论文“约 2 倍”的换算，20 h 曲线也没有经过实机或独立验证。

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

十二指肠的 `nutrient-exposure.ts` 读本部位的 `emptiedKcal`，滤波成 `nutrientExposure`（单位 `kcal/min` 的代理）；`brain/interoception.ts` 再读 `stomachSensory.mechanical`、`stomachGhrelin.relativeConcentration` 与 `duodenum.nutrientExposure`。完整水/碳水入口还把 `emptiedWaterMl` 和 `emptiedCarbohydrateG` 分别经 transfer 交给 `smallIntestine.waterVolumeMl` 与 `smallIntestine.carbohydrateG`；胃不写下游部位，也不读下游状态。

## 3. 调节方式

当前只接两类输入：

1. **摄入**：`drink` 与 `eat` 动作；体积、能量、餐型和进食时长都来自动作载荷。`eat` 的 `mealKind: "solid"` 进入固餐小计，`drink`、`liquid` 与 `mixed` 进入非固餐组；水链入口把 `drink` 的全部体积记为水，`eat` 不产水。
2. **自身状态**：胃内容量与剩余能量按上一轮状态自洽推进；机械感受只读 `volumeMl`；饥饿素按距上次含能摄入的计时与自身浓度推进。

以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 迷走神经与肠神经系统的反馈；
- CCK、GLP-1、胃泌素、促胰液素等胃肠激素；
- 餐时表、餐前预期与昼夜节律（饥饿素只按空腹时长做工程上升，不知道下一餐何时到来）；
- 能量剂量响应、多日饥饿适应与能量不足病理；
- 体位、运动、胃酸分泌、黏膜与胃内混合。

## 4. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程/参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 字段字典与证据卡模板：[`../references/m1-data-dictionary.md`](../references/m1-data-dictionary.md)
- 逐篇笔记：[`references/notes/`](references/notes/)（Mudie 2014、Tougas 2000、Vasavid 2014、Camps 2016、Levine 2015、Cummings 2001、Leone 2022，以及模板）
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)
- 空腹饥饿素设计：[`docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md`](../../../docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md)
- 水链设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md)

## 5. 当前限制

- **饥饿素上升是工程曲线**：`stomachGhrelin` 按距上次含能摄入的分钟数驱动上升，180 min 后开始、`peak = 1.8` 饱和；时间驱动、起始延迟、峰值和时间常数均为 `design`、`source: null`，不是人体测量或论文曲线。约 6.3 h / 12.1 h 到 65 / 85 mm 与 20 h 约 1.80 / 90 mm 都是设计试算，不是临床阈值或已验证结果。
- **不建模餐时表与餐前预期**：不能按钟点预测下一餐；不建模昼夜节律、能量剂量响应（任何正能量摄入仍压到不高于谷值）、多日饥饿适应和能量不足病理。
- **机械感受是代理**：`mechanical` 是归一化充盈代理，不是张力或神经放电；参考量与指数都是 `design`，不是人体拟合。
- **固餐半时是参考值的工程借用**：`stomach.emptying.solidHalfTimeMin = 68.7 min` 来自 Vasavid 2014 健康成人米饭鸡蛋标准餐的标记固相半排空时间中位数，参数状态是 `design`。论文报告的是标记保留比例，不是胃总内容量 mL 或 kcal，也没有同能量同体积的液餐对照；模型不复现 18.6 min 的滞后和完整曲线，不能据此说“任何固餐都比任何液餐慢”，也不把 68.7 min 当已验证的人体参数。
- **`mixed` 不拆分固液**：`mixed` 仍走非固餐组，不推断固液占比；没有研磨、分层或显式滞后。
- **非固餐组的 13 min 截距仍是白水工程假设**：`stomach.emptying.halfTimeMin` 用于扣除固餐小计后的原算法组（`drink`、`liquid`、`mixed` 与旧存档已入胃存量），13 min 来自 Mudie 2014 白水摘要，摘要未写 T50 定义与起算点。
- **旧存档不猜已入胃存量餐型**：缺少 `solidVolumeMl` / `solidEnergyKcal` 时按 0 加载，已经入胃的 `volumeMl` / `energyKcal` 按原算法推进，不重置也不推定为固体；`mealQueue` 中尚未释放的切片仍按各自的 `mealKind` 入账。
- **能量密度增益是开发集拟合**：53.75 只用 Camps 2016 同一批 15 人的 thin-100 与 thin-500 两臂，标为 `fitted_dev`，不是独立验证。
- 没有不可排空残余：`baselineMl` 只是可调偏置，模型允许胃排到 0。
- **水是饮料体积的代理**：`drink` 的全部 `volumeMl` 记为水，不反推纯水含量；含糖、含奶、碳酸或含酒精饮料一律按总体积入水账本。`eat`（含 `liquid` / `mixed`）不产水。这是 `design`，不是实测。
- **水比例拆分是工程近似**：`emptiedWaterMl` 按非固餐排出量中的水占比计算，不区分饮品成分、胃内分层、研磨或胃酸分泌；固餐排出不带水。
- **13 min 不是吸收半时**：它只是白水胃排空的工程截距；真实小肠吸收时间尺度在 `small-intestine/water-absorption.ts`，20 min 也是 `design`。
- 不做胃内混合、分层、胃酸、温度和黏膜状态；`mechanical` 与 `relativeConcentration` 由 `brain/interoception.ts` 读取，`brainNotify` 决定提醒，但通知历史与模型已读确认仍未实现。
