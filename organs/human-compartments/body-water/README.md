# 体液隔室（bodyFluid）：体液水与水分亏缺代理

**功能标签：** 体液隔室（不是解剖器官）。

`bodyFluid` 是一个工程隔室，不是解剖器官，因此放在 `organs/human-compartments/body-water/`。它维护“已吸收、尚未离开体液”的水量，并在同一轮向膀胱转出肾脏请求的尿量、向皮肤转出实际汗液；下丘脑的 ADH 与口渴脚本只读它的水分亏缺代理。

实现状态：脚本、参数与定向测试已在 `organs/human-compartments/body-water/`；当前根清单为 17 个部位，仓库共 19 份参数文件（其中 3 份 DI 变体不随根清单加载）。本切片新增 `physicalActivity`、`skin` 两个部位与 `skin/sweat.parameters.json`。既有 M3 水链与 M19 验收记录保持原口径；本切片没有重做真实 DSH 会话，也没有独立人体出汗数据或临床验证。

**清单依赖（transfer 配对校验）。** `waterVolumeMl` 同时声明 `transferIn: ["smallIntestine.waterVolumeMl"]` 与 `transferOut: ["bladder.volumeMl", "skin.sweatVolumeMl"]`，所以自定义清单加载 `bodyFluid` 时必须同时加载 `smallIntestine`、`bladder` 与 `skin`；`smallIntestine` 还接收胃水链入口 `stomach/hydration.ts` 的水，并向 `glucose.glucoseMassG` 转出碳水；`glucose` 又向 `kidneyGlucose.excretedGlucoseG` 转出肾糖。因此完整硬 transfer 闭包是 `hydration.ts`（胃）、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`skin` 七个部位，缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；旧入口 `motility.ts` 不声明这些 transfer，不能替代水链胃入口。反过来，加载 `smallIntestine` 也必须带齐上述目标与来源。`physicalActivity` 只是 `skin` 的普通轮初读取，不是 transfer 配对依赖；根清单包含它以提供 `exercise` 能力。`kidney`、`hypothalamusAdh`、`hypothalamusThirst` 与 `interoception` 之间只有普通 `io.read`，没有 transfer 字段对，所以不在配对校验内；缺这些部位时启动不报错，相关脚本按各自的缺失默认值处理。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water.ts` | `bodyFluid` | `waterVolumeMl`、`waterDeficit` | 自己的轮初状态 `bodyFluid`；`kidney.urineProductionRequestMl`；轮初 `skin.sweatRequestMl` | `water.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

`bodyFluid` 不声明动作（`actionTypes = []`）。`exercise` 由 [`physicalActivity`](../../human-organs/skeletal-muscle/README.md) 接收；皮肤请求由 [`skin`](../../human-organs/skin/README.md) 计算，尿与汗液的转移都由本脚本发起，不经过 `bodyFluid` 的动作入口。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 体液水总量（状态）；`transferIn` 来自 `smallIntestine.waterVolumeMl`，`transferOut` 到 `bladder.volumeMl` 与 `skin.sweatVolumeMl` |
| `waterDeficit` | `1` | 相对参考量的归一化亏缺代理，范围 −1…1；正为低于参考量，负为高于参考量 |

`waterVolumeMl` 是工程体液水隔室，不是血浆容量、细胞外液、总体水或体重比例。`skin.sweatVolumeMl` 是离开体液、经皮肤到外部环境的实际汗液通量；它不是留在皮肤里的水量或皮肤湿度。`bodyFluid` 不读该字段，只通过 transfer 写入。`waterDeficit` 不是血浆渗透压、血容量、口渴评分或尿意评分；它只给下丘脑两个脚本读。

时间原点：`waterVolumeMl` 是轮末状态，初值等于 `referenceVolumeMl`；`waterDeficit` 按轮初水量计算。本轮小肠流入、肾尿和汗液都在 transfer 阶段结算，下一轮轮初才反映到体液水。

## 3. 方程与参数

设轮初体液水 `W_start`、肾脏请求 `R_kidney = kidney.urineProductionRequestMl`、皮肤出汗请求 `R_sweat = skin.sweatRequestMl`：

```text
waterDeficit = clamp((referenceVolumeMl − W_start) / deficitScaleMl, −1, 1)
U_kidney = clamp(R_kidney, 0, W_start)
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → skin: U_sweat
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `bodyFluid.referenceVolumeMl` | 30000 | `mL` | `design` | —（无直接证据） |
| `bodyFluid.deficitScaleMl` | 500 | `mL` | `design` | —（无直接证据） |

初值水量等于参考量。肾脏请求先支付，汗液只能使用扣除肾尿后的轮初余量；`U_kidney + U_sweat ≤ W_start`，两路分别钳位不会造成重复支付。两路 transfer 都在 `write` 之后发出，小肠同轮新流入在 transfer 阶段才加入体液，不能支付本轮尿或汗。`write.waterVolumeMl = W_start` 是转出前基准；Gateway 再扣两路 transfer，实际汗液只通过 transfer 加入 `skin.sweatVolumeMl`。

肾脏请求和皮肤请求都有一轮延迟：`kidney` 每轮按轮初 ADH 计算下一轮请求，`skin` 每轮按轮初活动计算下一轮请求；`bodyFluid` 在下一轮轮初读取它们。请求大于轮初可用量时钳到可用量，不制造 fatal。**直接调用本模块**时，`skin` 缺失或 `sweatRequestMl` 缺失、负数、非有限、非数值都按 0 处理；`kidney` 缺失或请求异常同样按 0 处理。完整 Gateway 清单不能缺 `skin` 部位：`transferOut` 目标未声明会让 `createFieldRegistry` 启动失败，不能靠这个 0 回退绕过。

水账在既有恒等式上增加累计实际汗液项：

```text
胃水 + 队列水 + 小肠水 + (体液水 − 初始体液水)
+ 膀胱尿 + 累计 voidedMl + 累计 skin.sweatVolumeMl
= 累计饮水
```

“胃水”是 `stomach.waterVolumeMl`，“队列水”是 `stomach.mealQueue` 中剩余水量之和，“小肠水”是 `smallIntestine.waterVolumeMl`，“膀胱尿”是当前 `bladder.volumeMl`；`voidedMl` 已包含主动与非自主排出，只累计一次。`sweatRequestMl` 不进入水账，只有实际 `sweatVolumeMl` 逐轮累加；无活动时该项为 0，既有恒等式不变。逐轮核对容差为 `1e-6 mL`。

## 4. 读写边界

- 本脚本是 `bodyFluid` 的唯一写者，只读自己的轮初状态、`kidney` 的请求字段和轮初 `skin.sweatRequestMl`。
- 先 `write` 转出前基准，再分别向膀胱和皮肤请求 `transfer`；即使某路请求为 0 也发 transfer，Gateway 以 write → transfer 的顺序结算。
- 不写 `smallIntestine`、`bladder`、`skin`、`kidney` 或下丘脑部位；也不读胃或肠的原始状态。实际汗液只由 transfer 进入 `skin.sweatVolumeMl`，本脚本不直接写该字段，也不改写 `skin.sweatRequestMl`。
- 不建器官间“转移账本”之外的任何状态；`waterDeficit` 是唯一对外信号。

## 5. 时序、旧档与无活动轨迹

活动、皮肤请求和体液转移各隔一轮：一次 `exercise` 在第 1 轮提交活动状态，`skin` 第 2 轮按轮初活动写出请求，`bodyFluid` 第 3 轮才按该请求转出实际汗液。活动结束后皮肤下一轮请求归 0，体液再下一轮停止转移；轮次示例见 [`skin` README](../../human-organs/skin/README.md)。

- **旧档：** 启动时只给缺失的 `physicalActivity` 补 `{ remainingExerciseMin: 0, intensity: 0 }`、给缺失的 `skin` 补 `{ sweatRequestMl: 0, sweatVolumeMl: 0 }`，不反推历史活动或历史出汗；既有 `bodyFluid` 水量不被重置。
- **重启：** 保留活动剩余时间/强度与皮肤已提交状态；已发生的汗液已在体液中扣除，不会按历史轮数重复扣水。
- **无活动：** 默认没有 `exercise` 时 `skin` 请求和实际汗液都是 0，`bodyFluid` 的汗液出口为 0；水账、`waterDeficit` 与口渴轨迹与既有 M3 行为一致。本切片不自动运动、不自动饮水，也不因时间流逝产生汗液。

## 6. 证据入口

- 脚本头部的块注释明确写“无直接证据”，两个体液参数都是工程假设。
- 皮肤出汗的四个参数（25°C、0.6 mL/min、0.04/°C、2 mL/min）全部为 `design`、`source: null`，位于 `skin/sweat.parameters.json`；详见 [`skin` README](../../human-organs/skin/README.md)。它们不是人体出汗测量、METs、热量或最大出汗率。
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.3；本切片：[`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §5–§8。
- 共享登记簿：[`../../human-organs/references/source-index.csv`](../../human-organs/references/source-index.csv)（本切片未新增来源行）。

**证据边界：** 30 L 与 500 mL 都没有人体来源，不能称为实测总体水、血浆容量、体重比例或渗透压阈值；参数文件里的 `range` 只是工程调参范围，不是人体百分位。既有 M3/M19 验收记录只覆盖各自历史范围，本切片不重写它们，也不把它们当作活动—出汗链的验收；本切片未做真实 DSH 会话、独立人体出汗数据或临床验证，`0.6 mL/min` 等工程参数不能称为已测量或 `validated`。

## 7. 当前限制

- **不是渗透压模型**：不建血浆/尿渗透压、电解质、钠钾平衡或口渴阈值；水量 mL 不换算成 mOsm。
- **不是血容量/血压模型**：不建循环、RAAS、心房利钠肽或压力感受器。
- **只建模显式运动出汗**：不建不感蒸发、呼吸或粪便失水；汗液只以 mL 表示，不建汗液电解质、皮肤分区、皮肤温度、湿润度、蒸发残余、环境热应激或体温调节。无活动时不出汗。
- **不是运动生理模型**：不建 METs、热量/能量消耗、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、姿势或个体差异；`intensity` 只是模型内相对强度。
- **不是总体水**：30 L 只是一个工程参考量，不随年龄、性别、体重或体脂调整。
- **单隔室**：不区分细胞内、细胞外、血浆与间质。
- **未做真实 DSH 会话、独立人体出汗数据或临床验证**：模型内的出汗量只是水账/时序核对，不是实测汗量，也不能外推为运动或体温模型。
