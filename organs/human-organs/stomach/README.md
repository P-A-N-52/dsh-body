# 胃（stomach）

胃目录包含四个模块入口和一个共享核心：动力与排空的共享核心 `motility-core.ts`、水链入口 `hydration.ts`、旧独立入口 `motility.ts`、胃内分泌（饥饿素）与胃壁机械感受。各入口写同一个 `stomach` 部位或各自的独立部位，互不写对方状态；机械感受只读 `stomach.volumeMl`，体感脚本再读机械感受与饥饿素。

实现状态：脚本与参数已在 `organs/human-organs/stomach/`，并已加入根清单；根清单挂载水链入口 `hydration.ts`，旧入口 `motility.ts` 仍可单独加载。同一清单绝不能同时加载两个 `stomach` 入口；也不要把水链清单切到旧清单再切回来保存待释放水或碳水，往返会丢失队列的水/碳水身份（见 §2）。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "stomach.emptying.halfTimeMin": 15 } }
```

### gastric-sensory.parameters.json

参数文件：[`gastric-sensory.parameters.json`](gastric-sensory.parameters.json)。入口及清单：[`gastric-sensory.ts`](gastric-sensory.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json) / [可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。读取脚本：[`gastric-sensory.ts`](gastric-sensory.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `stomachSensory.referenceVolumeMl` | `1000` | `mL` | `design` | 无 | — |
| `stomachSensory.response.exponent` | `1` | `1` | `design` | 无 | — |

### ghrelin.parameters.json

参数文件：[`ghrelin.parameters.json`](ghrelin.parameters.json)。入口及清单：[`ghrelin.ts`](ghrelin.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json) / [可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。读取脚本：[`ghrelin.ts`](ghrelin.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `stomachGhrelin.fasting.baseline` | `1` | `1` | `design` | 无 | — |
| `stomachGhrelin.fasting.peak` | `1.8` | `1` | `design` | 无 | — |
| `stomachGhrelin.fasting.rise.onsetMin` | `180` | `min` | `design` | 无 | — |
| `stomachGhrelin.fasting.rise.apparentHalfTimeMin` | `120` | `min` | `design` | 无 | — |
| `stomachGhrelin.postmeal.nadir` | `0.5` | `1` | `design` | 无 | — |
| `stomachGhrelin.recovery.apparentHalfTimeMin` | `90` | `min` | `design` | 无 | — |
| `stomachGhrelin.distensionGain` | `0.3` | `1` | `design` | 无 | — |
| `stomachGhrelin.nutrientGain` | `0.3` | `min/kcal` | `design` | 无 | — |
| `stomachGhrelin.intakeGain` | `0.4` | `1` | `design` | 无 | — |
| `stomachGhrelin.referenceIntakeKcal` | `250` | `kcal` | `design` | 无 | — |

### motility.parameters.json

参数文件：[`motility.parameters.json`](motility.parameters.json)。入口及清单：[`hydration.ts`](hydration.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json)）；[`hydration-lipid.ts`](hydration-lipid.ts)（[可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）；[`motility.ts`](motility.ts)（可选旧入口，替换水链胃，不跟踪水或碳水转移）。读取脚本：[`motility-core.ts`](motility-core.ts)。

胃动力入口共用核心；`ghrelin.ts` 在导入核心时加载此文件，但只借用摄入解析，排空参数不直接调饥饿素。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `stomach.emptying.halfTimeMin` | `13` | `min` | `design` | 无 | — |
| `stomach.emptying.baselineMl` | `0` | `mL` | `design` | 无 | — |
| `stomach.emptying.energyDensityGainMinPerKcalPerMl` | `53.75` | `min/(kcal/mL)` | `fitted_dev` | 无 | — |
| `stomach.emptying.solidHalfTimeMin` | `68.7` | `min` | `design` | 无 | — |
| `stomach.gastricInhibitionGain` | `0.5` | `1` | `design` | 无 | — |

<!-- organ-parameters:end -->

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `hydration.ts` | `stomach` | 原胃字段加水与碳水存量/每轮排空量，以及实际入胃饮水观测 `deliveredWaterMl`；声明到 `smallIntestine.waterVolumeMl` 和 `smallIntestine.carbohydrateG` 的转移 | 自己的轮初状态 `stomach`；`io.actions` 里的 `drink` / `eat` | `motility.parameters.json` |
| `motility.ts` | `stomach` | 原胃字段（`volumeMl`、`energyKcal`、`solidVolumeMl`、`solidEnergyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt`、`mealQueue`）；不记水/碳水、不声明 transfer | 自己的轮初状态 `stomach`；`io.actions` 里的 `drink` / `eat` | `motility.parameters.json` |
| `ghrelin.ts` | `stomachGhrelin` | `relativeConcentration`、`minutesSinceEnergyIntake` | 自己的轮初状态 `stomachGhrelin`；`io.actions` 中经 `motility-core.parseIntake` 校验合法的 `eat` / `drink` | `ghrelin.parameters.json`；import `motility-core.ts` 时同时只读加载 `motility.parameters.json` |
| `gastric-sensory.ts` | `stomachSensory` | `mechanical` | `stomach.volumeMl` | `gastric-sensory.parameters.json` |

`motility-core.ts` 不是模块，不导出 `id`；它是两个入口共用的解析、队列与排空方程，`parseIntake` 也是 `ghrelin.ts` 复用的同一摄入解析。`motility.ts` 用 `trackWater: false`、`trackCarbohydrate: false` 调用核心，输出形状与历史一致，可单独加载且不需要小肠或膀胱；`hydration.ts` 同时开启水与碳水跟踪，必须与 `smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、[`skin`](../skin/README.md) 及 [`lungs`](../lungs/README.md)（运动相关呼吸失水出口）同时加载；这十五个部位构成完整硬 transfer 闭包，缺任一个都会因 transfer 字段配对校验拒绝启动。

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
| `deliveredWaterMl` | `mL` | `hydration.ts` 在本轮实际交付到胃的饮水量（每轮观测，不是库存、转移或累计）；内感受下轮读 |
| `carbohydrateG` | `g` | 轮末胃内可消化葡萄糖当量碳水总量（状态），含固体小计；`hydration.ts` 声明到 `smallIntestine.carbohydrateG` 的 `transferOut`，初值 0 |
| `solidCarbohydrateG` | `g` | `carbohydrateG` 中按固餐组排空的小计（状态），不是总量之外的第二份碳水 |
| `emptiedCarbohydrateG` | `g` | 本轮胃向小肠转出的碳水（每轮通量，不是累计） |

`volumeMl` / `energyKcal` 是轮末总量；`solidVolumeMl` / `solidEnergyKcal` 是总量中固餐那一份的小计，不是加在总量之外的第二份账本，读取总量时不要再把小计加一遍。`emptiedMl` / `emptiedKcal` 每轮按两组排空之和重新计算，不累加；`emptiedMl` 只作观察与重放读数，`emptiedKcal` 由十二指肠的 `nutrient-exposure.ts` 读取。需要累计排出量时由读者按轮求和。小计只在查询完整 `stomach` 原始状态时可见；`brain/interoception.ts` 不直接读这两个通量字段，它经 `stomachSensory.mechanical`（总量体积）与 `duodenum.nutrientExposure`（由 `emptiedKcal` 滤波的代理）间接取得信号，所以体感读数会随分组后的总量与排出量变化，而不是保持不变。`mealQueue` 只用来保留并发摄入的时间分布，不对应任何生理测量；`lastIntakeAt` 的单位是仿真秒，不是现实时间戳。

取舍说明：`mealKind` 只在 `eat` 的 `solid` 上改变排空路径；`drink`、`liquid` 与 `mixed` 仍走原算法，`mixed` 不拆分固液。`lastIntakeAt` 供内感受核对饮水观测的轮次；`emptiedMl` 只作观察与重放读数，`emptiedKcal` 由十二指肠读取并滤波成营养暴露代理；`brain/interoception.ts` 间接读取胃充盈与营养暴露，同时直接读取已提交的入胃饮水观测。设计见 [固／液餐小改设计](../../../docs/superpowers/specs/2026-11-21-solid-meal-emptying-design.md)。

### 水子集（`hydration.ts`，`design`）

`waterVolumeMl` 是 `volumeMl` 中的水子集，不是加在总量之外的第二份体积。设轮初非固餐体积 `N = max(0, volumeMl − solidVolumeMl)`、水 `W = clamp(waterVolumeMl ?? 0, 0, N)`；核心返回非固餐排出量 `E_nonSolid` 与本轮新入胃饮水量 `D`：

```text
emptiedWaterMl = E_nonSolid × (N > 0 ? W / N : 0)
write.waterVolumeMl = W + D
write.deliveredWaterMl = D
transfer stomach → smallIntestine: emptiedWaterMl
```

- `drink` 的全部 `volumeMl` 记为水；`eat`（含 `liquid` / `mixed`）不反推水，也不增加 `waterMl` 动作参数。把饮料总体积近似为可吸收水是 `design`，不是实测纯水含量。
- 只有非固餐排出带水；固餐排出不带水。胃总 `volumeMl` 仍由核心只扣一次原排空量，`waterVolumeMl` 不能加回总量。
- 先 write、后 transfer：write 的是转出前基准 `W + D`，Gateway 在轮末扣 `emptiedWaterMl`；`D` 本轮不再排出。
- 多轮 `drink` 在 `mealQueue` 里保留水余量与每轮水切片；旧切片缺 `remainingWaterMl` / `rateWaterMl` 时按 0，不猜历史饮品。
- **legacy 往返不保留待释放水**：旧 `motility.ts` 以 `trackWater: false` 推进既有 `mealQueue` 时会剥离切片的 `remainingWaterMl` / `rateWaterMl`，并按历史形状写回不含水字段的胃状态。因此“水链清单 → legacy 清单 → 水链清单”不是待释放水的无损迁移：切回 `hydration.ts` 时队列水按 0 计，不反推。正常旧档（从未运行过水链）升级到水链只补 0，不受这条往返边界影响。
- 旧存档缺 `waterVolumeMl` 时按 0；旧胃总量、能量与固餐小计不重置。
- `deliveredWaterMl` 是 `advanceStomach` 已结算的 D，包含当轮实际释放的队列切片及新动作首片；没有新水写 0，旧档缺字段初始为 0，不从胃总量、动作总量或旧队列推测。它不进入水守恒求和，不另做 transfer。`brain/interoception.ts` 在下一轮把它当作吞水的快速解渴代理，只用原有 `lastIntakeAt` 与轮初仿真秒核对新鲜度，避免换清单后重复读取已冻结的观察值。
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

摄入动作：`drink` 需要 `volumeMl > 0`，可选 `energyKcal`（有限数、`>= 0`，缺省 0）、`carbohydrateG`（有限数、`>= 0`，缺省 0）与 `durationMin`，固定按 `liquid` 处理；白水省略能量/碳水或填 0，可乐、果汁、牛奶等含能饮料填实际已知成分。`eat` 需要 `volumeMl`、`energyKcal ≥ 0`、`mealKind`（`liquid` / `solid` / `mixed`），碳水与时长可选。两者都按轮切片进入，避免一次大餐整体落在同一轮；仅有 `mealKind: "solid"` 的 `eat` 计入固餐小计。字段缺失、单位或取值非法的动作被忽略；`body_act` 支持可选 `carbohydrateG`，`body_state` 仅返回纯定性感受摘要（无数字），原始数值由 `GET /state` / `gateway.getState()` 返回。体积/能量之外的成分、黏度、碳酸、甜味剂不进入方程。

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
本轮摄入能量 = Σ 每条经 parseIntake 校验合法且 energyKcal > 0 的 eat / drink
含能摄入（本轮摄入能量 > 0）：
  t_next = 0
  c_next = clamp(min(c, postmeal.nadir) − suppression, 0, fasting.peak)

无含能摄入：
  t_next = t + dtMin
  target = clamp(
    fasting.baseline
    + (fasting.peak - fasting.baseline)
      × (1 - 2^(-max(0, t_next - fasting.rise.onsetMin)
                      / fasting.rise.apparentHalfTimeMin))
    - suppression, 0, fasting.peak)
  c_next = c + (target - c)
         × (1 - 2^(-dtMin / recovery.apparentHalfTimeMin))
```

摄入轮只抑制相对浓度并清零计时，不同时执行上升；经 `parseIntake` 判为非法的动作整条忽略，纯水与合法的 0 kcal 饮料不触发能量摄入项抑制、也不重置空腹计时，但仍可能受机械扩张与十二指肠营养暴露项的抑制。`parseIntake` 要求 `volumeMl` 为有限正数；`eat` 还要求有限非负 `energyKcal` 与 `mealKind ∈ {liquid, solid, mixed}`；`drink.energyKcal` 缺省为 0，给出时必须是有限非负数；可选 `durationMin` 与 `carbohydrateG` 给出时必须是有限非负数。轮初计时缺失、负值或非有限时按 0，相对浓度缺失或非有限时按基线 1。`actionTypes = ['eat', 'drink']` 只是声明，脚本复用 `motility-core.parseIntake` 做与胃完全相同的合法性校验，再检查能量是否大于 0。

上升是空腹时长驱动的工程曲线：`onsetMin` 之前保持原有的向基线恢复，之后目标值按表观半时逼近 `peak`，浓度随之饱和，不会无界增长。在胃机械与营养输入为 0、沿用当前 `interoception` 参数试算时，约 6.3 h 达到 `hunger = 65 mm` 明显档、约 12.1 h 达到 85 mm 强档，20 h 时约 `G = 1.80`、`hunger = 90 mm`。这些是设计试算，不是临床阈值或论文曲线；实际通知还受会话绑定、档位与逐级退避冷却约束（已取消小时/每日硬配额），没有绑定会话时不发提醒。

旧存档缺少 `minutesSinceEnergyIntake` 时由 `initialState` 补 0；保留原 `relativeConcentration`，从升级时刻重新累计，不根据 `lastIntakeAt`、存档 `simulatedSeconds` 或当前浓度反推过去空腹时长。升级第一轮不会凭空出现高饥饿；后续重启保留该字段，不反复清零。

P1 的 `brain/interoception.ts` 读取 `relativeConcentration`，`brainNotify` 按会话水位与退避冷却决定是否提醒；模型已读确认仍未实现。含能饮料的抑制方向是从含能餐证据外推的 `design` 假设，没有登记饮料专属来源。

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

`mechanical` 读的是轮初快照里的 `stomach.volumeMl`，同一轮摄入要到下一轮才反映。P1 的 `brain/interoception.ts` 读取这个字段，`brainNotify` 按会话水位与退避冷却决定是否提醒；模型已读确认仍未实现。

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
- **摄入校验与胃一致（自检）**：`stomachGhrelin` 与胃共用 `motility-core.parseIntake`；缺/非法 `volumeMl`、`eat` 的 `energyKcal` / `mealKind`，以及给出时非法的 `durationMin` / `carbohydrateG`，在两边同样被整条忽略，不会出现“胃拒绝、饥饿素接受”的分叉。`ghrelin.ts` import `motility-core.ts` 时会同时加载 `motility.parameters.json`；根清单已由 `hydration.ts` 加载同一文件，去重后不增加唯一参数文件数。
- **不建模餐时表与餐前预期**：不能按钟点预测下一餐；不建模昼夜节律、能量剂量响应（任何正能量摄入都从 `min(当前值, 谷值)` 按剂量向下抑制，不固定落在谷值）、多日饥饿适应和能量不足病理。
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
- 不做胃内混合、分层、胃酸、温度和黏膜状态；`mechanical` 与 `relativeConcentration` 由 `brain/interoception.ts` 读取，`brainNotify` 按会话水位与退避冷却决定提醒，模型已读确认仍未实现。

## 选配长链脂质

[膳食脂质预设](../../presets/human-lipid/README.md)用 `hydration-lipid.ts` 替换 `hydration.ts`，仍是**同一个** `stomach`，水/碳水原结算以及各只读观测沿用；不可同时挂载两个胃入口。`eat` / `drink` 额外接受可选有限非负 `fatG`（g 长链 TG 当量）。缺失为未知，不从 kcal、体积或配餐反推，也不在全餐能量上加算；零只有明确无脂才用。翻译估值随原切片保留 `fatGSource: "estimate"`。

- `mealQueue` 原分轮同时推进 `remainingFatG`、`rateFatGPerRound`，末轮支付余量；无已知数值时不写这两键。旧档缺这些键不推测历史脂肪。普通清单不保存脂肪切片元数据；同一存档不能借普通清单往返保留待释放脂肪。
- `solidFatG` / `nonSolidFatG` 是**分组实存**（g，二项相加才是胃脂质总量），跟各组既有轮初排空比例；`drink`、`liquid`、`mixed` 走非固餐组。两笔同单位 transfer 一起交给 `intestinalLipid.lumenTgG`。`emptiedFatG` 是本轮实付，不是第三个库存。
- `explicitFatIntakeG` / `estimatedFatIntakeG` 只观测本轮已切片送入胃的克数，各自无数据为 `null`、有明确/估得的零为 `0`。`unknownFatIntakeSlices` 单独计未知成分的切片数。首轮新到不提前排空，水、碳水和热量各自既有路径无变化。

脂质分组与原体积同比推进是 `design`，没有脂相排空实测校准。无新增胃参数，默认与覆盖仍来自同目录 [`motility.parameters.json`](motility.parameters.json)（见上面的原胃参数）；`fatG` 是餐的输入，不是个体参数。这里不建胃脂肪酶、分层、脂肪特异的额外胃抑制或脂解。
