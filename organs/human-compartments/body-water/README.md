# 体液隔室（bodyFluid）：体液水与水分亏缺代理

**功能标签：** 体液隔室（不是解剖器官）。

`bodyFluid` 是一个工程隔室，不是解剖器官，因此放在 `organs/human-compartments/body-water/`。它维护“已吸收、尚未离开体液”的水量，并在同一轮向膀胱转出肾脏请求的尿量、向肺转出运动相关呼吸失水、向皮肤转出实际汗液；女性变体另向子宫转出月经失水。下丘脑的 ADH 与口渴脚本只读它的水分亏缺代理。

结算逻辑在共享核心 `water-core.ts`：正常入口 `water.ts` 固定“肾 → 肺 → 汗”三出口，女性变体 `water.female.ts` 在同一列表末位追加 `uterus.bleedingMl` 第四出口。两个入口导出相同的 `id` / `initialState` / `heartbeat`，`fields` 除 `waterVolumeMl.transferOut` 末位多一项外相同；同一清单不能同时加载；根清单只用 `water.ts`，女性清单 `body-modules.female.json` 才用 `water.female.ts`。两者复用同一份 `water.parameters.json`，不新增参数文件。

实现状态：脚本、参数与定向测试已在 `organs/human-compartments/body-water/`；根清单为 19 个部位、21 份参数文件；仓库共 23 份参数文件（含 3 份 DI 变体与 2 份生殖参数，这两类都不随根清单加载）；女性清单为 21 个部位、23 份参数文件，并使用独立 `statePath`。活动—出汗切片当时新增 `physicalActivity`、`skin` 两个部位与 `skin/sweat.parameters.json`，根清单为 17 部位、19 份参数；随后肺切片新增 `lungs` 与 `respiratory-water-loss.parameters.json`，并为体液增加第三出口；肌摄糖切片再新增 `muscleGlucose` 与 `glucose-uptake.parameters.json`。既有 M3 水链与 M19 验收记录保持原口径；肺切片没有重做真实 DSH 会话，也没有独立人体呼吸失水数据或临床验证。活动/肺切片当时完整 `npm test` 为 418/418 PASS（2026-11-23），那只是离线实现、时序与水账测试；生殖切片未用该数字当当前结果。

**清单依赖（transfer 配对校验）。** 正常入口的 `waterVolumeMl` 同时声明 `transferIn: ["smallIntestine.waterVolumeMl"]` 与 `transferOut: ["bladder.volumeMl", "lungs.respiratoryWaterLossMl", "skin.sweatVolumeMl"]`；女性变体在 `transferOut` 末位再加 `uterus.bleedingMl`。所以自定义清单加载正常 `bodyFluid` 时必须同时加载 `smallIntestine`、`bladder`、`lungs` 与 `skin`；加载女性变体还必须加载 `uterus`，否则启动报 `transferOut target "uterus.bleedingMl" is not declared`。女性清单的硬 transfer 闭包是在根清单 9 部位之上再加 `uterus`，共 10 部位；`ovaries` 只是子宫的普通轮初读取，不在配对校验内。以下闭包描述按根清单的正常入口：`smallIntestine` 还接收胃水链入口 `stomach/hydration.ts` 的水，并向 `glucose.glucoseMassG` 转出碳水；`glucose` 又向 `kidneyGlucose.excretedGlucoseG` 转出肾糖，并向 `muscleGlucose.uptakeG` 转出肌摄糖。因此完整硬 transfer 闭包是 `hydration.ts`（胃）、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`muscleGlucose`、`skin`、`lungs` 九个部位，缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；旧入口 `motility.ts` 不声明这些 transfer，不能替代水链胃入口。反过来，加载 `smallIntestine` 也必须带齐上述目标与来源。`physicalActivity` 只是 `skin`、`lungs` 与 `muscleGlucose` 的普通轮初读取，不是 transfer 配对依赖；根清单包含它以提供 `exercise` 能力。`kidney`、`hypothalamusAdh`、`hypothalamusThirst` 与 `interoception` 之间只有普通 `io.read`，没有 transfer 字段对，所以不在配对校验内；缺这些部位时启动不报错，相关脚本按各自的缺失默认值处理。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water.ts`（正常入口，三出口） | `bodyFluid` | `waterVolumeMl`、`waterDeficit` | 自己的轮初状态 `bodyFluid`；`kidney.urineProductionRequestMl`；轮初 `lungs.respiratoryWaterLossRequestMl`；轮初 `skin.sweatRequestMl` | `water.parameters.json` |
| `water.female.ts`（女性变体，四出口） | `bodyFluid` | 同上 | 同上，另读轮初 `uterus.bleedingRequestMl` | `water.parameters.json`（复用） |

`water-core.ts` 不是入口，不导出 `id` / `fields` / `heartbeat`；它只提供 `createBodyWater(outlets)`，由两个入口分别给出出口列表。参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

`bodyFluid` 不声明动作（`actionTypes = []`）。`exercise` 由 [`physicalActivity`](../../human-organs/skeletal-muscle/README.md) 接收；皮肤出汗请求由 [`skin`](../../human-organs/skin/README.md) 计算，运动相关呼吸失水请求由 [`lungs`](../../human-organs/lungs/README.md) 计算；尿、肺失水与汗液的转移都由本脚本发起，不经过 `bodyFluid` 的动作入口。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 体液水总量（状态）；`transferIn` 来自 `smallIntestine.waterVolumeMl`，正常入口 `transferOut` 到 `bladder.volumeMl`、`lungs.respiratoryWaterLossMl` 与 `skin.sweatVolumeMl`，女性变体再加 `uterus.bleedingMl` |
| `waterDeficit` | `1` | 相对参考量的归一化亏缺代理，范围 −1…1；正为低于参考量，负为高于参考量 |

`waterVolumeMl` 是工程体液水隔室，不是血浆容量、细胞外液、总体水或体重比例。`skin.sweatVolumeMl` 是离开体液、经皮肤到外部环境的实际汗液通量；`lungs.respiratoryWaterLossMl` 是离开体液、经呼吸到外部环境的运动相关失水通量，不是总呼吸失水、肺内水量或通气量；`uterus.bleedingMl` 是离开体液、经子宫到外部环境的月经失水通量，只记水量，不含经血成分。`bodyFluid` 不读这三个实际通量字段，只通过 transfer 写入。`waterDeficit` 不是血浆渗透压、血容量、口渴评分或尿意评分；它只给下丘脑两个脚本读。

时间原点：`waterVolumeMl` 是轮末状态，初值等于 `referenceVolumeMl`；`waterDeficit` 按轮初水量计算。本轮小肠流入、肾尿、肺失水和汗液都在 transfer 阶段结算，下一轮轮初才反映到体液水。

## 3. 方程与参数

设轮初体液水 `W_start`、肾脏请求 `R_kidney = kidney.urineProductionRequestMl`、肺请求 `R_lung = lungs.respiratoryWaterLossRequestMl`、皮肤出汗请求 `R_sweat = skin.sweatRequestMl`、子宫月经请求 `R_uterus = uterus.bleedingRequestMl`。正常入口 `water.ts`：

```text
waterDeficit = clamp((referenceVolumeMl − W_start) / deficitScaleMl, −1, 1)
U_kidney = clamp(R_kidney, 0, W_start)
U_lung = clamp(R_lung, 0, max(0, W_start − U_kidney))
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney − U_lung))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → lungs: U_lung
transfer bodyFluid → skin: U_sweat
```

女性变体 `water.female.ts` 在前三路之后追加第四路，顺序是 `policy`：

```text
U_uterus = clamp(R_uterus, 0, max(0, W_start − U_kidney − U_lung − U_sweat))
write.waterVolumeMl = W_start
transfer bodyFluid → uterus: U_uterus
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `bodyFluid.referenceVolumeMl` | 30000 | `mL` | `design` | —（无直接证据） |
| `bodyFluid.deficitScaleMl` | 500 | `mL` | `design` | —（无直接证据） |

初值水量等于参考量。肾脏请求先支付，肺请求其次，汗液只能使用扣除前两路后的轮初余量；女性变体的月经失水再排在汗之后，只能使用前三路之后的余量。`U_kidney + U_lung + U_sweat + U_uterus ≤ W_start`，各路分别钳位不会造成重复支付。顺序只是 `policy`，不是人体排泄优先级证据。transfer 都在 `write` 之后发出，小肠同轮新流入在 transfer 阶段才加入体液，不能支付本轮尿、肺失水、汗或月经失水。`write.waterVolumeMl = W_start` 是转出前基准；Gateway 再扣各路 transfer，实际肺失水只通过 transfer 加入 `lungs.respiratoryWaterLossMl`，实际汗液只通过 transfer 加入 `skin.sweatVolumeMl`，实际月经失水只通过 transfer 加入 `uterus.bleedingMl`。

肾脏请求、肺请求、皮肤请求和子宫请求都有一轮延迟：`kidney` 每轮按轮初 ADH 计算下一轮请求，`lungs` 每轮按轮初活动计算下一轮请求，`skin` 每轮按轮初活动计算下一轮请求，`uterus` 每轮按轮初卵巢周期日、激素和自身内膜计算下一轮请求；`bodyFluid` 在下一轮轮初读取它们。请求大于轮初可用量时按上述顺序钳到可用量，不制造 fatal。**直接调用本模块**时，`kidney`、`lungs`、`skin` 或女性变体的 `uterus` 缺失，或对应请求字段缺失、负数、非有限、非数值，都按 0 处理。完整 Gateway 清单不能缺 `skin`、`lungs` 等 `transferOut` 目标：目标未声明会让 `createFieldRegistry` 启动失败，不能靠这个 0 回退绕过；女性清单缺 `uterus` 时同样启动失败。

水账在既有恒等式上增加累计实际肺失水、汗液和（仅女性变体）月经失水项：

```text
胃水 + 队列水 + 小肠水 + (体液水 − 初始体液水)
+ 膀胱尿 + 累计 voidedMl + 累计 lungs.respiratoryWaterLossMl
+ 累计 skin.sweatVolumeMl
+ 累计 uterus.bleedingMl
= 累计饮水
```

最后一项只在加载 `water.female.ts` 时存在；根清单没有子宫，水账保持原恒等式。“胃水”是 `stomach.waterVolumeMl`，“队列水”是 `stomach.mealQueue` 中剩余水量之和，“小肠水”是 `smallIntestine.waterVolumeMl`，“膀胱尿”是当前 `bladder.volumeMl`；`voidedMl` 已包含主动与非自主排出，只累计一次。`respiratoryWaterLossRequestMl`、`sweatRequestMl` 与 `bleedingRequestMl` 不进入水账，只有实际 `respiratoryWaterLossMl`、`sweatVolumeMl` 和 `bleedingMl` 逐轮累加；无活动时肺与汗两项为 0，非经期子宫项为 0，既有恒等式不变。逐轮核对容差为 `1e-6 mL`。

## 4. 读写边界

- 每个入口在自己的清单里是 `bodyFluid` 的唯一写者，只读自己的轮初状态、`kidney` 的请求字段、轮初 `lungs.respiratoryWaterLossRequestMl` 和轮初 `skin.sweatRequestMl`；女性变体另读轮初 `uterus.bleedingRequestMl`。
- 先 `write` 转出前基准，再分别向膀胱、肺和皮肤（女性变体再加子宫）请求 `transfer`；即使某路请求为 0 也发 transfer，Gateway 以 write → transfer 的顺序结算。
- 不写 `smallIntestine`、`bladder`、`lungs`、`skin`、`uterus`、`kidney` 或下丘脑部位；也不读胃或肠的原始状态。实际肺失水只由 transfer 进入 `lungs.respiratoryWaterLossMl`，实际汗液只由 transfer 进入 `skin.sweatVolumeMl`，实际月经失水只由 transfer 进入 `uterus.bleedingMl`；本脚本不直接写这三个字段，也不改写 `lungs.respiratoryWaterLossRequestMl`、`skin.sweatRequestMl` 或 `uterus.bleedingRequestMl`。
- 不建器官间“转移账本”之外的任何状态；`waterDeficit` 是唯一对外信号。月经量、经期与内膜的证据边界归 [`uterus`](../../human-organs/uterus/README.md)，本脚本只做水量结算。

## 5. 时序、旧档与无活动轨迹

活动、请求和体液转移各隔一轮：一次 `exercise` 在第 1 轮提交活动状态，`skin` 与 `lungs` 第 2 轮按轮初活动分别写出汗和运动相关呼吸失水请求，`bodyFluid` 第 3 轮才按这两个请求转出实际汗液与肺失水。活动结束后皮肤和肺下一轮请求归 0，体液再下一轮停止转移；轮次示例见 [`skin` README](../../human-organs/skin/README.md) 与 [`lungs` README](../../human-organs/lungs/README.md)。

月经失水同理再隔两轮：`ovaries` 在第 N 轮写周期日与激素，`uterus` 第 N+1 轮按轮初卵巢值写 `bleedingRequestMl`，`bodyFluid` 女性变体第 N+2 轮才按该请求把水转入 `uterus.bleedingMl`。经期结束后子宫下一轮请求归 0，体液再下一轮停止转移；请求字段不是实际失水，只有 transfer 后的 `bleedingMl` 进入水账。

- **旧档：** 启动时只给缺失的 `physicalActivity` 补 `{ remainingExerciseMin: 0, intensity: 0 }`、给缺失的 `skin` 补 `{ sweatRequestMl: 0, sweatVolumeMl: 0 }`、给缺失的 `lungs` 部位或字段补 `{ respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 }`；女性清单还只给缺失的 `ovaries` / `uterus` 补各自 `initialState`，不反推历史活动、历史出汗、历史呼吸失水、历史周期或历史经量。既有 `bodyFluid` 水量不被重置。
- **重启：** 保留活动剩余时间/强度、皮肤请求/实际汗液、肺请求/实际失水，以及女性清单的周期日、内膜和上一轮子宫请求；已发生的汗液、呼吸失水和月经失水已在体液中扣除，不会按历史轮数重复扣水。`skin`、`lungs` 与 `uterus` 每轮 `write` 先把各自的实际量归 0，存档最后一轮的实际量不会被下一轮重复累计。
- **无活动：** 默认没有 `exercise` 时 `skin` 请求、`lungs` 请求和两路实际通量都是 0，`bodyFluid` 的肺与汗出口为 0；水账、`waterDeficit` 与口渴轨迹与既有 M3 行为一致。肺切片不自动运动、不自动饮水，也不因时间流逝产生汗液或呼吸失水。
- **无子宫或非经期：** 根清单没有子宫，女性变体也不会被加载，月经出口不存在；女性清单在经期结束后子宫请求归 0，体液再下一轮停止转移，之后 `bleedingRequestMl` 与 `bleedingMl` 都为 0，水账最后一项不再增加。子宫未加载而直接调用女性变体时，该路按 0 处理；完整女性清单缺 `uterus` 则在启动时因 transfer 配对失败。

## 6. 证据入口

- 脚本头部的块注释明确写“无直接证据”，两个体液参数都是工程假设。
- 皮肤出汗的四个参数（25°C、0.6 mL/min、0.04/°C、2 mL/min）全部为 `design`、`source: null`，位于 `skin/sweat.parameters.json`；详见 [`skin` README](../../human-organs/skin/README.md)。它们不是人体出汗测量、METs、热量或最大出汗率。
- 肺失水参数 `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3 mL/min` 为 `design`、`source: null`，位于 `lungs/respiratory-water-loss.parameters.json`；只表示运动相关呼吸失水的临时工程速率，不是实测呼吸失水率或总呼吸失水。详见 [`lungs` README](../../human-organs/lungs/README.md)。
- 月经失水的证据边界归 [`uterus` README](../../human-organs/uterus/README.md)：`mensesDays = 4.0` 是 Bull 2019 的自报出血天数（`prior`；队列为 Natural Cycles 用户、厂商资助、仅排卵周期），50 mL/周期等其余参数为 `design`、`source: null`。本变体不新增参数、不新增来源，只复用 `water.parameters.json`。
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.3；活动—出汗切片：[`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §5–§8；肺切片：[`2026-11-23-respiratory-water-loss-design.md`](../../../docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md)；女性变体与第四出口：[`2026-11-23-reproductive-cycle-design.md`](../../../docs/superpowers/specs/2026-11-23-reproductive-cycle-design.md)。
- 共享登记簿：[`../../human-organs/references/source-index.csv`](../../human-organs/references/source-index.csv)（本切片未新增来源行；`SRC-BULL-2019` 的笔记在卵巢目录，登记行在共享登记簿）。

**证据边界：** 30 L 与 500 mL 都没有人体来源，不能称为实测总体水、血浆容量、体重比例或渗透压阈值；参数文件里的 `range` 只是工程调参范围，不是人体百分位。`0.3 mL/min` 同样没有人体来源，只覆盖运动相关呼吸失水的工程近似，不包含静息或总呼吸失水。月经失水只记水量，不建经血成分、铁丢失、血红蛋白、凝血或大出血；`uterus` 的 50 mL/周期、85 mm 痛经代理等都不是实测值。既有 M3/M19 验收记录只覆盖各自历史范围，本切片不重写它们，也不把它们当作活动—肺—汗链或生殖链的验收；肺切片与生殖切片都未做真实 DSH 会话、独立人体数据或临床验证，工程参数不能称为已测量或 `validated`。

## 7. 当前限制

- **不是渗透压模型**：不建血浆/尿渗透压、电解质、钠钾平衡或口渴阈值；水量 mL 不换算成 mOsm。
- **不是血容量/血压模型**：不建循环、RAAS、心房利钠肽或压力感受器。
- **只建模显式运动出汗与运动相关呼吸失水**：不建静息呼吸失水、不感蒸发、通气量、潮气量、呼吸频率、血气或粪便失水；汗液只以 mL 表示，不建汗液电解质、皮肤分区、皮肤温度、湿润度、蒸发残余、环境热应激或体温调节。无活动时不出汗、不产生肺失水。
- **只建模月经失水的水量**：女性变体只把 `uterus.bleedingRequestMl` 当体积请求，不建经血成分、血块、组织液、血红蛋白/铁丢失、凝血、纤溶、前列腺素、子宫内膜厚度、痛经机制或大出血；请求不是瞬时经血流率。根清单不加载该出口，`water.ts` 的三出口语义不变。
- **不是运动生理模型**：不建 METs、热量/能量消耗、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、姿势或个体差异；`intensity` 只是模型内相对强度。
- **不是总体水**：30 L 只是一个工程参考量，不随年龄、性别、体重或体脂调整。
- **单隔室**：不区分细胞内、细胞外、血浆与间质。
- **未做真实 DSH 会话、独立人体出汗/呼吸失水数据或临床验证**：模型内的出汗量与肺失水量只是水账/时序核对，不是实测汗量或呼吸失水量，也不能外推为运动、通气或体温模型。
