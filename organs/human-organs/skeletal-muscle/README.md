# 骨骼肌（skeletal-muscle）：活动状态与肌糖原薄切片

**功能标签：** 活动、糖代谢（骨骼肌活动状态与肌糖原代理）。

骨骼肌目录有两个独立部位：`physicalActivity`（`activity.ts`）保存一次 `exercise` 或 `sex` 动作留下的活动剩余分钟和相对强度，供皮肤出汗、肺运动相关呼吸失水与肌糖原消耗按轮初快照读取；`sex` 按体力活动计入，走同一字段、同一校验与同一替换策略，不另建性活动状态。`muscleGlucose`（`glucose-uptake.ts`）接收 `glucose` 转来的肌摄糖，按轮初活动把上一轮 `uptakeG` 入账糖原并消耗。两者都不模拟肌肉收缩、运动类型、代谢产热、疲劳或能量代谢，也不消耗能量、产热、调节体温或自动运动；从未 `exercise` / `sex` 时活动为 0、糖原消耗为 0，进行中的活动在没有新动作时仍按 `io.dt` 递减并保留强度，既有水账与口渴轨迹不变。

实现状态：`activity.ts` 与 `glucose-uptake.ts` 均在 `organs/human-organs/skeletal-muscle/`；活动脚本无参数文件，模块定向测试见 [`test/organs.activity.test.mjs`](../../../test/organs.activity.test.mjs)；肌摄糖脚本新增 `glucose-uptake.parameters.json` 与 [`test/organs.muscle-glucose.test.mjs`](../../../test/organs.muscle-glucose.test.mjs)。`exercise` / `sex` 工具入口、皮肤/肺请求链、根清单、体液三出口和 `glucose → muscleGlucose` transfer 均已接入；当前根清单为 20 个部位、22 份参数文件（女性清单 22 部位、24 份参数文件）。加入肌摄糖与 `sex` 后的全量测试需重跑，本文不把历史计数当作当前结果。完整契约见本文、[`skin`](../skin/README.md)、[`lungs`](../lungs/README.md) 与 [`sexual-response`](../sexual-response/README.md)。尚未做真实 DSH 会话、独立运动生理数据或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `activity.ts` | `physicalActivity` | `remainingExerciseMin`、`intensity` | 自己的轮初状态；`io.actions` 中的 `exercise` / `sex`；`io.dt` | 无 |
| `glucose-uptake.ts` | `muscleGlucose` | `uptakeG`、`glycogenG`、`glycogenConsumedG` | 自己的轮初状态；轮初 `physicalActivity`；`io.dt` | `glucose-uptake.parameters.json` |

- `activity.ts` 导出 `actionTypes = ['exercise', 'sex']`；`glucose-uptake.ts` 的 `actionTypes = []`，没有动作、通知或主动 transfer。
- 消费者是 `skin`、`lungs` 与 `muscleGlucose` 的轮初读取；它们与 `physicalActivity` 之间都是普通 `io.read`，不构成 transfer 配对，也不要求同轮提交。
- `muscleGlucose` 只通过 `uptakeG.transferIn: ['glucose.glucoseMassG']` 接收肌摄糖；`glucose` 的 `transferOut` 必须同时声明该目标，缺部位在完整清单启动时因配对校验失败。
- 本目录两个脚本都不自动产生 `exercise` / `sex`，也不根据时间、活动量或环境自行开始/停止活动；动作只来自 `body_act`。

## 2. 字段与单位

两个字段都是 `absolute` 状态，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `remainingExerciseMin` | `min` | 轮末剩余活动时间；先按 `io.dt` 递减，再被本轮合法 `exercise` / `sex` 的 `durationMin` 替换。0 表示没有剩余活动 |
| `intensity` | `1` | 当前活动的模型内相对强度，范围 0…1；无活动时为 0。不是 MET、%VO₂max、心率、功率、RPE 或任何实测强度 |

`remainingExerciseMin` 是状态，不是累计运动时长、运动距离或历史总量；新动作替换而不是累加。`intensity` 是模型内相对量，1 只表示本模型的最大相对活动强度，不代表人群最大运动能力，也不能用 MET 表反推。时间原点：两个字段都是本轮轮末写出的状态，下一轮轮初才对 `skin`、`lungs` 与 `muscleGlucose` 可见；`io.simulatedSeconds` 不参与递减。

`muscleGlucose` 的三个字段也都是 `absolute`，初值均为 0：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `uptakeG` | `g` | 本轮实际肌摄糖（在途），每轮 write 先归 0，只由 `transferIn: ['glucose.glucoseMassG']` 增加；下一轮入账糖原 |
| `glycogenG` | `g` | 肌糖原储量；上一轮 `uptakeG` 在本轮入账，运动时扣除；钳到非负，没有容量上限 |
| `glycogenConsumedG` | `g` | 本轮运动消耗的糖原通量，无活动为 0；不是累计量 |

时间原点：`uptakeG` 表示上一轮 `glucose` 结算后到账的在途量，`glycogenG` 是轮末储量，`glycogenConsumedG` 是轮末写出的本轮通量。三者都不是测量值，也不换算能量或 MET。

## 3. 动作、递减与“最后有效动作”

设轮初状态为 `prev`，`dtMin = io.dt / 60`：

```text
remainingExerciseMin = max(0, prev.remainingExerciseMin − dtMin)
intensity = remainingExerciseMin > 0 ? prev.intensity : 0

for action in 本轮 io.actions（按到达顺序）:
  若 action 是合法 exercise 或 sex:
    remainingExerciseMin = action.durationMin
    intensity = action.intensity
write({ remainingExerciseMin, intensity })
```

合法 `exercise` 或 `sex` 必须同时满足：

- `type === 'exercise'` 或 `type === 'sex'`；
- `intensity` 是有限数且 `0 < intensity <= 1`；
- `durationMin` 是有限数且 `> 0`。

同一轮只有**最后一个合法** `exercise` / `sex` 生效；它用新的 `durationMin`/`intensity` 整体替换剩余活动，不与旧剩余时间相加。两类动作共用这两个字段，也可以互相替换：同轮先 `exercise` 后 `sex` 时按 `sex` 的时长与强度，反向亦然。后面的非法 `exercise` / `sex` 被跳过，不会把此前合法动作替换掉；`drink`、`eat`、`urinate` 等其他动作对活动无影响。非法动作不改变活动状态，也不产生错误写入。

“先按 `io.dt` 递减，再处理本轮动作”是轮初快照策略：本轮新动作从自己的完整 `durationMin` 开始，不从被本轮 `dt` 扣过的余量开始。这是动作策略（`design`/`policy`），不是运动生理规律。

`body_act` 的载荷是 `{ type: "exercise", intensity, durationMin }` 或 `{ type: "sex", intensity, durationMin }`，不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。两类动作使用同一校验；工具层对非法强度/时长直接拒绝，不进入动作队列，模块层对已到达的原始动作再按同一规则校验，非法值不改变状态。`sex` 计入体力活动是 `design`：不区分行为类型、姿势、伴侣或性别差异，也不表示已测能量消耗。动作 ID、会话和重试幂等沿用既有 `body_act`，本模块不改变它们。

## 4. 活动模块的读写边界与旧档

- `activity.ts` 是 `physicalActivity` 的唯一写者，只读自己的轮初状态、本轮 `io.actions` 与 `io.dt`。
- 不调用 `transfer`，不写 `skin`、`lungs`、`bodyFluid`、`bladder`、`muscleGlucose` 或任何其他部位；活动本身不直接扣水或扣糖原。
- `skin`、`lungs` 与 `muscleGlucose` 在下一轮读取本轮提交的活动状态，因此一次 `exercise` / `sex` 对出汗请求、肺失水请求和糖原消耗都有一轮延迟；活动结束后同理，三者先读到剩余时间为 0，再在后续轮次停止请求/消耗。
- 旧存档缺 `remainingExerciseMin` / `intensity` 时按 0 补齐，不反推历史活动；已有剩余时间和强度随存档保留，重启后可继续递减。
- 旧自定义清单若没有 `physicalActivity`，`skin`、`lungs` 与 `muscleGlucose` 都按“无活动”处理（请求/消耗 0），但本切片根清单包含该部位以提供 `exercise` / `sex` 能力；这不是运动模型的替代入口。

## 5. 活动模块的证据与未建模边界

- 活动脚本没有参数文件，也没有登记来源；递减、归零清强度、“最后有效动作”和 `sex` 按体力活动计入都是 `design` / `policy`，不是人体测量、拟合或独立验证。
- 不建 METs、能量消耗/kcal、摄氧量、心率、血压、血气、乳酸、疲劳、睡眠、运动类型、姿势、核心/皮肤温度、体温调节、汗液电解质、环境热应激、疾病或个体差异；肌糖原只按 §6 的固定速率代理消耗，不由 `intensity` 换算 MET 或能量。
- `sex` 只是与 `exercise` 共用活动入口，不建性反应周期、激素、受孕/妊娠、性欲/情绪、伴侣或任何显性内容；性反应周期另见 [`sexual-response`](../sexual-response/README.md)。
- 不声称真实的 DSH 会话验收、独立人体活动数据、运动生理验证或临床验证；`intensity=1` 只是模型内上限，不能写成任何实测强度或最大能力。
- 设计背景见 [`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §3、[`2026-11-23-muscle-glucose-uptake-design.md`](../../../docs/superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md) 与 [`2026-11-23-sexual-response-design.md`](../../../docs/superpowers/specs/2026-11-23-sexual-response-design.md)；出汗侧见 [`skin`](../skin/README.md)，运动相关呼吸失水侧见 [`lungs`](../lungs/README.md) 与 [`2026-11-23-respiratory-water-loss-design.md`](../../../docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md)。

## 6. 肌摄糖与肌糖原（`muscleGlucose`）

`muscleGlucose` 是 `glucose-uptake.ts` 维护的独立部位，位于同一骨骼肌目录，只读自己的轮初状态与轮初 `physicalActivity`，不读 `glucose` 或 `insulinRelative`，也不发起 transfer。它只做三件事：接收上一轮 `glucose` 转出的 `U`、把在途 `uptakeG` 入账 `glycogenG`、按轮初活动消耗糖原。

### 6.1 脚本、字段与参数

| 项 | 契约 |
| --- | --- |
| 部位 ID | `muscleGlucose` |
| 脚本 | `glucose-uptake.ts` |
| 参数 | `glucose-uptake.parameters.json` |
| 动作 / 通知 | 均无 |
| transfer | `uptakeG` 声明 `transferIn: ['glucose.glucoseMassG']`；本部位不声明 `transferOut` |

字段见 §2；三个字段都是 `g` / `absolute`，初值 0。`uptakeG` 是上一轮在途量，`glycogenG` 是储量，`glycogenConsumedG` 是本轮通量。

| 参数 ID | 默认值 | 单位 | 状态 | 范围 | 来源与替换点 |
| --- | ---: | --- | --- | --- | --- |
| `muscleGlucose.glycogenUseRateGPerMin` | 0.5 | `g/min` | `design` | `[0, 5]` | `source: null`；`intensity = 1` 时每分钟糖原消耗，纯工程占位；未来由运动强度—糖原利用证据替换 |

### 6.2 方程与时序

设 `prev` 为轮初自身状态，`dtMin = io.dt / 60`：

```text
uptake = prev.uptakeG
active = physicalActivity 已加载且 prev.remainingExerciseMin > 0
consumed = active
  ? min(glycogenUseRateGPerMin × prev.intensity × dtMin, max(0, prev.glycogenG) + uptake)
  : 0
glycogenG = max(0, prev.glycogenG) + uptake − consumed
write.uptakeG = 0
write.glycogenG = glycogenG
write.glycogenConsumedG = consumed
```

- `active` 只要求活动部位存在且轮初剩余时间 > 0；`intensity = 0` 时消耗为 0，但剩余时间仍由 `activity.ts` 递减。
- 不足一分钟的活动不按比例截断：轮初 `remainingExerciseMin = 0.5` 且 `dt = 60` 时仍按整 dt 消耗。
- 钳位：`consumed` 不超过 `max(0, prev.glycogenG) + uptake`，所以糖原不会为负；`glycogenConsumedG` 是实际消耗，不是请求。
- `physicalActivity` 未加载 → 消耗 0；已加载但 `remainingExerciseMin` / `intensity` 缺失、非数值、非有限、剩余时间为负或 `intensity ∉ [0, 1]` 时抛错，本轮不写状态。自身字段缺失按 0。
- 时序：第 N 轮 `glucose` 转出 `U(N)`；第 N+1 轮本脚本把 `U(N)` 入账并写 `uptakeG = 0`，随后 `U(N+1)` 到账。`exercise` / `sex` 第 1 轮进入 `physicalActivity`，第 2 轮开始消耗。
- 示例：轮初 `glycogenG = 10`、无在途、`intensity = 1`、`dt = 60` → 消耗 0.5 g；`dt = 120` → 1.0 g。轮初 `glycogenG = 0.2`、`uptakeG = 0`、`dt = 60` → 实际消耗 0.2 g，糖原为 0。

### 6.3 消费者与质量账

- `glucose` 是唯一 transfer 发起者；`muscleGlucose.uptakeG` 只是目标字段，不读 `glucose` 或 `insulinRelative`。
- `physicalActivity` 是唯一上游读取，`exercise` 与 `sex` 都经同一字段驱动消耗；当前没有其他调节模块读取糖原。
- 外源碳水质量账把 `glycogenG`、在途 `uptakeG` 与累计 `glycogenConsumedG` 作为三项加入；`disposedGlucoseG` 只表示非肌非肾残余，不能把同一克数再算进糖原。
- `glycogenConsumedG` 不回流 `glucose`，也不进肝（无肝）；它是局部利用出账。

### 6.4 旧档、重启与未建模

- 旧档缺 `muscleGlucose` 时补三个 0，不反推历史摄取；重启保留在途 `uptakeG`，下一轮只入账一次。
- 不建肌糖原容量上限、静息周转、运动类型/MET、能量消耗、乳酸/Cori 循环、局部糖原耗竭对活动或疲劳的反馈、肝糖原、胰岛素浓度或脂肪组织分区。
- 参数与份额全部 `design`、`source: null`；`SRC-DALLAMAN-2007` §III.C.3 只支撑组织利用可分的结构方向，不支撑 0.75 份额或 0.5 g/min。未做真实 DSH 会话、独立肌糖原/血糖数据或临床验证。
