# 骨骼肌（skeletal-muscle）：活动状态、肌糖原与活动氧耗

**功能标签：** 活动、糖代谢（骨骼肌活动状态与肌糖原代理）。

骨骼肌目录是一组独立部位：`physicalActivity`（`activity.ts`）保存一次 `exercise` 或 `sex` 动作留下的活动剩余分钟和相对强度，供皮肤出汗、肺运动相关呼吸失水、区域糖原消耗与血氧需氧按轮初快照读取；其中 `sex` 现支持可选 `exertion`（`0 <= exertion <= 1`，缺省向后兼容沿用 `intensity`）以解耦“感官/局部性刺激强度”与“全身骨骼肌体力负荷”（`SRC-BOHLEN-1984`, `SRC-FRAPPIER-2013`），并在达成释放型 `orgasm`（非 `continueStimulation: true`）时同步终止配对性活动计时。`muscleGlucose`（`glucose-uptake.ts`）是摄糖聚合器：按轮初 `glucose.excessMassG` 与 `pancreasEndocrine.insulinPmolL` 计算摄糖请求，写 `uptakeRequestG`；下一轮 `glucose` 按请求结算，实际支付经 transfer 进入 `uptakeG`；再下一轮聚合器按区域份额转给已加载的区域。`muscleHead` / `muscleTrunk` / `muscleLimbs`（`regions/head.ts`、`trunk.ts`、`limbs.ts`，共享 `regions/region-core.ts`）各自持有区域糖原并按轮初活动消耗。这些脚本都不模拟肌肉收缩、运动类型、代谢产热、疲劳或能量代谢，也不消耗能量、产热、调节体温或自动运动；血氧隔室只把活动强度按 `design` 系数折算成需氧，不由肌糖原或能量代谢推导。从未 `exercise` / `sex` 时活动为 0、糖原消耗为 0，进行中的活动在没有新动作时仍按 `io.dt` 递减并保留强度，既有水账与口渴轨迹不变。

实现状态：`activity.ts`、`glucose-uptake.ts`（正常聚合器入口）、`glucose-uptake.no-limbs.ts`（缺四肢变体）与 `regions/{head,trunk,limbs}.ts` 均在 `organs/human-organs/skeletal-muscle/`；活动脚本无参数文件，模块定向测试见 [`test/organs.activity.test.mjs`](../../../test/organs.activity.test.mjs)；摄糖与区域脚本使用 `glucose-uptake.parameters.json`，测试见 [`test/organs.muscle-glucose.test.mjs`](../../../test/organs.muscle-glucose.test.mjs)、[`test/organs.muscle-regions.test.mjs`](../../../test/organs.muscle-regions.test.mjs) 与 [`test/organs.muscle-regions-gateway.test.mjs`](../../../test/organs.muscle-regions-gateway.test.mjs)。`exercise` / `sex` / `stop_exercise` 工具入口、皮肤/肺请求链、血氧需氧、根清单、体液出口、`glucose → muscleGlucose` 的实际支付 transfer 与 `muscleGlucose → 区域` 的分配 transfer 均已接入；当前根清单为 43 个部位、39 份唯一参数文件（女性清单 46 部位、42 份；男性清单 45 部位、41 份）。区域份额与消耗速率仍是 `design`，本文不把历史计数当作当前结果。完整契约见本文、[`regions/README.md`](regions/README.md)、[`skin`](../skin/README.md)、[`lungs`](../lungs/README.md) 与 [`sexual-response`](../sexual-response/README.md)。尚未做真实 DSH 会话、独立运动生理数据或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `activity.ts` | `physicalActivity` | `remainingExerciseMin`、`intensity` | 自己的轮初状态；轮初 `sexualResponse` / `ovaries` / `testes` / `pituitary`（经 `evaluateSexualRelease`）；`io.actions` 中的 `exercise` / `sex` / `stop_exercise` / `sleep` / `orgasm`；`io.dt`、`io.simulatedSeconds` | 无 |
| `glucose-uptake.ts` / `glucose-uptake.no-limbs.ts` | `muscleGlucose` | `uptakeRequestG`、`uptakeG` | 自己的轮初状态；轮初 `glucose.excessMassG` / `concentrationMgDl`（未加载 glucose 时按 0）、`pancreasEndocrine.insulinPmolL / 60`（未加载胰腺时归一化因子按 1）、`physicalActivity.remainingExerciseMin` / `intensity`（可选）；各区域是否存在；`io.dt` | `glucose-uptake.parameters.json` |
| `regions/head.ts` | `muscleHead` | `uptakeG`、`glycogenG`、`glycogenConsumedG` | 自己的轮初状态；`muscleGlucose.glycogenG`（仅旧档迁移）、`physicalActivity`；`io.dt` | `glucose-uptake.parameters.json` |
| `regions/trunk.ts` | `muscleTrunk` | 同上 | 同上 | 同上 |
| `regions/limbs.ts` | `muscleLimbs` | 同上 | 同上 | 同上 |

- `activity.ts` 导出 `actionTypes = ['exercise', 'sex', 'stop_exercise']`；聚合器与区域脚本的 `actionTypes = []`，区域没有动作、通知或主动 transfer。
- 消费者是 `skin`、`lungs`、三个区域、`bloodOxygen` 与 `interoception`（结合三区糖原亏空输出 `muscleFatigueMm`，并在 `palpitationMm` 中区分运动心率与静止心动过速）的轮初读取；它们与 `physicalActivity` 之间都是普通 `io.read`，不构成 transfer 配对，也不要求同轮提交。
- `muscleGlucose` 每轮写出 `uptakeRequestG`，供 `glucose` 下一轮结算；实际到账只通过 `uptakeG.transferIn: ['glucose.glucoseMassG']`，并在同一轮按份额 `transferOut` 到已加载区域的 `uptakeG`。正常入口声明三个区域；缺区域变体只声明存在的区域，份额按剩余区域归一。`glucose` 的 `transferOut` 必须声明 `muscleGlucose.uptakeG`，区域必须声明 `muscleGlucose.uptakeG` 为来源，缺任一端在完整清单启动时因配对校验失败。请求字段不是 transfer，不搬质量。
- 区域可被清单单独启停，但不是子字段：每个区域有自己的状态、字段声明和入口文件。缺区域变体只按现有区域归一，不推断缺失肢体的质量；用法见 [`regions/README.md`](regions/README.md) §5。
- 本目录脚本都不自动产生 `exercise` / `sex`，也不根据时间、活动量或环境自行开始/停止活动；动作只来自 `body_act`（或通过 `stop_exercise` / `sleep` 中止进行中的活动）。

## 2. 字段与单位

两个字段都是 `absolute` 状态，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `remainingExerciseMin` | `min` | 轮末剩余活动时间；先按 `io.dt` 递减，再被本轮合法 `exercise` / `sex` 的 `durationMin` 替换。0 表示没有剩余活动 |
| `intensity` | `1` | 当前活动的模型内相对强度，范围 0…1；无活动时为 0。不是 MET、%VO₂max、心率、功率、RPE 或任何实测强度 |

`remainingExerciseMin` 是状态，不是累计运动时长、运动距离或历史总量；新动作替换而不是累加。`intensity` 是模型内相对量，1 只表示本模型的最大相对活动强度，不代表人群最大运动能力，也不能用 MET 表反推。时间原点：两个字段都是本轮轮末写出的状态，下一轮轮初才对 `skin`、`lungs`、`muscleGlucose` 与 `bloodOxygen` 可见；`io.simulatedSeconds` 不参与递减。

`muscleGlucose` 的两个字段也都是 `absolute`，初值均为 0：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `uptakeRequestG` | `g` | 本轮按轮初 `excessMassG` 与 `insulinPmolL` 计算的摄糖请求；不是实际通量，不进入质量账，下一轮由 `glucose` 结算 |
| `uptakeG` | `g` | 上一轮请求结算后实际到账的肌摄糖（在途），每轮 write 先归 0，只由 `transferIn: ['glucose.glucoseMassG']` 增加；本轮按区域份额转出 |

每个区域另有三个 `absolute` 字段，其中 `uptakeG` 与 `glycogenConsumedG` 初值为 `0`，`glycogenG` 初值按 `300 g × regionShare` 分配（头颈 `15 g`、躯干 `135 g`、四肢 `150 g`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `uptakeG` | `g` | 本轮区域摄糖到账，仅由 `transferIn: ['muscleGlucose.uptakeG']` 增加，每轮 write 归 0 |
| `glycogenG` | `g` | 区域糖原储量（初值：头颈 `15 g` / 躯干 `135 g` / 四肢 `150 g`）；上一轮 `uptakeG` 在本轮并入；旧档迁移份额在默认种子状态取代初值、在已有真实状态时并入；运动时扣除；钳到非负，没有容量上限 |
| `glycogenConsumedG` | `g` | 本轮实际运动消耗，无活动为 0；不是累计量 |

时间原点：`uptakeRequestG` 是本轮轮末写出的请求，`muscleGlucose.uptakeG` 是上一轮 `glucose` 结算后到账、等待分配的在途量；区域 `uptakeG` 是本轮轮末分配后的到账量，`glycogenG` 是轮末储量，`glycogenConsumedG` 是轮末写出的本轮通量。五者都不是测量值，也不换算能量或 MET。

## 3. 动作、递减与“最后有效动作”

设轮初状态为 `prev`，`dtMin = io.dt / 60`：

```text
remainingExerciseMin = max(0, prev.remainingExerciseMin − dtMin)
intensity = remainingExerciseMin > 0 ? prev.intensity : 0

for action in 本轮 io.actions（按到达顺序）:
  若 action.type === 'stop_exercise' 或 action.type === 'sleep':
    remainingExerciseMin = 0, intensity = 0
  否则若 action.type === 'orgasm' && releaseInfo.released && action.continueStimulation !== true && hasSexContext:
    remainingExerciseMin = 0, intensity = 0
  否则若 action 是合法 exercise:
    remainingExerciseMin = action.durationMin, intensity = action.intensity
  否则若 action 是合法 sex:
    effIntensity = action.exertion ?? action.intensity
    remainingExerciseMin = effIntensity === 0 ? 0 : action.durationMin
    intensity = effIntensity
write({ remainingExerciseMin, intensity })
```

合法 `exercise` 或 `sex` 必须同时满足：

- `type === 'exercise'` 或 `type === 'sex'`；
- `intensity` 是有限数且 `0 < intensity <= 1`；
- `durationMin` 是有限数且 `> 0`；
- 若为 `sex` 且提供可选 `exertion`，则 `exertion` 须有限且 `0 <= exertion <= 1`（`action-translator.js` 提示单人躺卧轻抚设为 `0–0.08`，伴侣爱抚 `0.08–0.20`，主动插入伴侣性交 `0.30–0.65`）。

此外，`stop_exercise` 与 `sleep`（均无载荷）会在动作处理顺序中立即把 `remainingExerciseMin` 与 `intensity` 归零，用于提前中止当前运动或入睡停动；当 `orgasm` 达成释放（且未显式传入 `continueStimulation: true`、配对性活动仍活跃）时，也会同步清零配对的性活动体力负荷，防止高潮结束后仍虚挂“四肢发力”。若同轮其后又出现新的合法 `exercise` / `sex`，则按到达顺序继续替换；`sex.exertion = 0` 会使体力活动保持归零而不覆盖已有性反应刺激。

“先按 `io.dt` 递减，再处理本轮动作”是轮初快照策略：本轮新动作从自己的完整 `durationMin` 开始，不从被本轮 `dt` 扣过的余量开始。这是动作策略（`design`/`policy`），不是运动生理规律。

`body_act` 的载荷是 `{ type: "exercise", intensity, durationMin }` 或 `{ type: "sex", intensity, durationMin, exertion? }`，不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。两类动作共用核心范围校验；文献参考 `SRC-BOHLEN-1984`（实验室性行为代谢负荷约 1.7–3.3 MET）与 `SRC-FRAPPIER-2013`（年轻成人约 3.2–4.2 kcal/min ≈ 中低等步行），但具体 `exertion` 映射区间仍属 `design` 近似，不按姿势或心率实时反推能耗。

## 4. 活动模块的读写边界与旧档

- `activity.ts` 是 `physicalActivity` 的唯一写者，只读自己的轮初状态、本轮 `io.actions` 与 `io.dt`。
- 不调用 `transfer`，不写 `skin`、`lungs`、`bodyFluid`、`bladder`、`muscleGlucose`、任一区域或任何其他部位；活动本身不直接扣水或扣糖原。
- `skin`、`lungs`、三个区域与 `bloodOxygen` 在下一轮读取本轮提交的活动状态，因此一次 `exercise` / `sex` 对出汗请求、肺失水请求、区域糖原消耗和血氧需氧都有一轮延迟；活动结束后同理，它们先读到剩余时间为 0，再在后续轮次停止请求/消耗。
- 旧存档缺 `remainingExerciseMin` / `intensity` 时按 0 补齐，不反推历史活动；已有剩余时间和强度随存档保留，重启后可继续递减。
- 旧自定义清单若没有 `physicalActivity`，`skin`、`lungs`、三个区域与 `bloodOxygen` 都按“无活动”处理（请求/消耗/活动氧耗 0），但本切片根清单包含该部位以提供 `exercise` / `sex` 能力；这不是运动模型的替代入口。

## 5. 活动模块的证据与未建模边界

- 活动脚本没有参数文件，也没有登记来源；递减、归零清强度、“最后有效动作”和 `sex` 按体力活动计入都是 `design` / `policy`，不是人体测量、拟合或独立验证。
- 不建 METs、能量消耗/kcal、摄氧量、心率、血压、血气、乳酸、疲劳、睡眠、运动类型、姿势、核心/皮肤温度、体温调节、汗液电解质、环境热应激、疾病或个体差异；肌糖原只按 §6 的固定速率代理消耗，不由 `intensity` 换算 MET 或能量。
- `sex` 只是与 `exercise` 共用活动入口，不建性反应周期、激素、受孕/妊娠、性欲/情绪、伴侣或任何显性内容；性反应周期另见 [`sexual-response`](../sexual-response/README.md)。
- 不声称真实的 DSH 会话验收、独立人体活动数据、运动生理验证或临床验证；`intensity=1` 只是模型内上限，不能写成任何实测强度或最大能力。
- 设计背景见 [`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §3、[`2026-11-23-muscle-glucose-uptake-design.md`](../../../docs/superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md) 与 [`2026-11-23-sexual-response-design.md`](../../../docs/superpowers/specs/2026-11-23-sexual-response-design.md)；出汗侧见 [`skin`](../skin/README.md)，运动相关呼吸失水侧见 [`lungs`](../lungs/README.md) 与 [`2026-11-23-respiratory-water-loss-design.md`](../../../docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md)，活动氧耗侧见 [`blood-oxygen`](../../human-compartments/blood-oxygen/README.md) 与 [`2026-11-23-blood-oxygen-design.md`](../../../docs/superpowers/specs/2026-11-23-blood-oxygen-design.md)。

### 5.1 活动氧耗（`bloodOxygen` 的消费者）

[`bloodOxygen`](../../human-compartments/blood-oxygen/README.md) 下一轮软读本部位的 `remainingExerciseMin` 与 `intensity`：

```text
activityDemandMlMin = remainingExerciseMin > 0 ? activityGainMlMin × intensity : 0
```

- 该活动项加到基础与消化需氧上，得到 `bloodOxygen.oxygenConsumptionMlMin`；`activityGainMlMin = 1000 mL/min` 是 `design`、`source: null`，`intensity = 1` 时追加 1000 mL/min，不是 MET、%VO₂max、摄氧量或能量消耗。
- `exercise` 与 `sex` 都通过同一 `physicalActivity` 字段计入；活动结束（剩余分钟为 0）后活动项立即消失，即使 `intensity` 仍是旧值。
- 血氧下降不反馈到本部位：不改变活动剩余时间、强度、糖原消耗或疲劳，也不自动停止运动；活动仍只由 `body_act` 的 `exercise` / `sex` 设置。
- 时序：第 1 轮活动状态提交，第 2 轮血氧读到新活动并提高需氧；通气再晚一轮响应。该一轮滞后是既有轮初快照策略，不是运动生理时程。
- 这里的“活动氧耗”只是血氧隔室的线性需氧代理，不是肌肉能量代谢、摄氧量测量或运动能力评估；本目录仍不建 METs、能量消耗/kcal、摄氧量、心率、血压、血气、乳酸或疲劳。

## 6. 肌摄糖聚合器与区域糖原

`muscleGlucose` 是 `glucose-uptake.ts` 维护的摄糖聚合器，位于同一骨骼肌目录；它不再持有肌糖原。聚合器按轮初 `glucose.excessMassG` 与 `pancreasEndocrine.insulinPmolL`、用本部位自己的参数计算摄糖请求，写 `uptakeRequestG`；下一轮由 `glucose` 按请求结算，实际支付经 transfer 进入 `uptakeG`；同一轮再按区域份额经 transfer 转给已加载的区域。区域（`muscleHead` / `muscleTrunk` / `muscleLimbs`）各自持有糖原、按轮初活动消耗；旧档总量由区域在第一轮按份额迁移：默认种子状态用迁移份额取代 300 g 初值，已有真实状态则并入。聚合器和区域都不向血液释放葡萄糖（肌肉无 G6Pase）；释放只由肝发起。

### 6.1 脚本、字段与参数

| 项 | 契约 |
| --- | --- |
| 部位 ID | `muscleGlucose` |
| 正常入口 | `glucose-uptake.ts`，声明三个区域 |
| 缺区域变体 | `glucose-uptake.no-limbs.ts`，只声明头和躯干 |
| 参数 | `glucose-uptake.parameters.json` |
| 动作 / 通知 | 均无 |
| transfer | `uptakeG` 声明 `transferIn: ['glucose.glucoseMassG']`，并按入口声明 `transferOut: ['muscleHead.uptakeG', ...]` |

字段见 §2；聚合器只有两个 `g` / `absolute` 字段，初值 0。区域各有三个 `g` / `absolute` 字段，`glycogenG` 初值为头颈 `15 g` / 躯干 `135 g` / 四肢 `150 g`（合计 300 g）；详细契约见 [`regions/README.md`](regions/README.md)。

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `muscleGlucose.maxUptakeRateGPerMin` | 0.5 | `g/min` | `design` | `source: null`；半饱和与敏感度修正前的最大摄糖速率，纯工程占位；不是实测肌肉葡萄糖摄取率 |
| `muscleGlucose.halfMaxExcessG` | 20 | `g` | `design` | `source: null`；超基线质量达到该值时响应为半最大，纯工程占位；不是实测半饱和量 |
| `muscleGlucose.insulinSensitivity` | 1.0 | `1` | `design` | `source: null`；相对胰岛素信号每偏离基线 1 个单位时的线性敏感度，肌肉取 1.0；不是受体亲和力或实测敏感度 |
| `muscleGlucose.exerciseUptakeRateGPerMin` | 0.15 | `g/min` | `design` | `source: null`；运动收缩介导的非胰岛素依赖骨骼肌血糖摄取基准速率工程占位，活动期间按强度与血糖浓度比例加入摄糖请求 |
| `muscleGlucose.glycogenUseRateGPerMin` | 0.5 | `g/min` | `design` | `source: null`；`intensity = 1` 时全身骨骼肌总消耗速率工程占位，按区域份额（0.05 / 0.45 / 0.50）分配到各区域；未来由运动强度—糖原利用证据替换 |

五个参数都是工程假设，没有登记来源；参数文件中的 `range` 只是工程调参范围，不是人体百分位或测量范围。`SRC-DALLAMAN-2007` §III.C.3 只支撑“组织利用可分为不同部分”的结构方向，不支撑这些数值。`glycogenUseRateGPerMin = 0.5 g/min` 按区域份额 `0.05 / 0.45 / 0.50` 拆分为头颈 `0.025 g/min`、躯干 `0.225 g/min`、四肢 `0.25 g/min`，三区域全负荷合计恰好为 `0.5 g/min`，质量账按各区域实际消耗累计。

### 6.2 方程与时序

设 `prev` 为轮初聚合器状态，`excess = max(0, 轮初 glucose.excessMassG)`（未加载 `glucose` 时按 0），`C = 轮初 glucose.concentrationMgDl`（未加载 `glucose` 时按 0），`I = 轮初 pancreasEndocrine.insulinPmolL / 60`（未加载胰腺时按 1），`dtMin = io.dt / 60`：

```text
response = max(0, 1 + insulinSensitivity × (I − 1))
insulinUptakeG = maxUptakeRateGPerMin
               × (excess / (excess + halfMaxExcessG))
               × response
               × dtMin
exerciseUptakeG = physicalActivity.remainingExerciseMin > 0
                ? exerciseUptakeRateGPerMin × clamp(intensity, 0, 1) × dtMin
                  × clamp(C / 90, 0, 1.5)
                : 0
request = insulinUptakeG + exerciseUptakeG
uptake = prev.uptakeG
for region in 已加载区域:
  amount(region) = uptake × weight(region) / Σ(已加载区域 weight)
write.uptakeRequestG = request
write.uptakeG = 0
```

区域侧（`regions/region-core.ts`）：

```text
legacy   = 旧档迁移份额（仅旧档第一轮存在；无旧总量时 undefined）
uptake   = 轮初区域 uptakeG
seeded   = 区域状态逐字段等于 initialState 默认种子
base     = legacy === undefined ? max(0, glycogenG)
         : seeded ? legacy
         : max(0, glycogenG) + legacy
consumed = active
  ? min(glycogenUseRateGPerMin × regionShare × intensity × dtMin, base + uptake)
  : 0
region.glycogenG = base + uptake − consumed
write { uptakeG: 0, glycogenG, glycogenConsumedG: consumed }
```

- 静息空腹（`excess = 0` 且未运动）时请求为 0；**运动期间**即使 `excess = 0`，收缩介导的非胰岛素依赖摄糖 `exerciseUptakeG` 仍按 `0.15 × intensity × dtMin × clamp(C / 90, 0, 1.5)` 请求血糖。`excess` 越大，`excess / (excess + halfMaxExcessG)` 越接近 1。
- `I = 1` 时 `response = 1`；`I = 2` 时肌肉 `response = 2`、肝（敏感度 0.5）为 1.5；`I = 0` 时肌肉 `response = 0`。`I` 是低血糖/高血糖方向的相对信号，不是浓度。
- 请求每轮重写，不是累计量；请求可以大于血池可用量，结算时由 `glucose` 按余额钳位，实际到账记在 `muscleGlucose.uptakeG`。聚合器第一次 write 后不再保留旧 `glycogenG` / `glycogenConsumedG`，也不把请求写进质量账。
- 份额：正常入口为头 0.05 / 躯干 0.45 / 四肢 0.50；缺区域变体只声明存在的区域，按剩余份额归一（头和躯干为 0.1 / 0.9）。份额是 `design` / `source: null`，不随动作类型或肢体使用变化。
- 最后一笔区域分配取剩余量，保证各笔之和恰为轮初 `uptakeG`；没有区域时保留 `uptakeG` 作为在途余额。
- `active` 只要求活动部位存在且轮初剩余时间 > 0；`intensity = 0` 时消耗为 0，但剩余时间仍由 `activity.ts` 递减。
- 不足一分钟的活动不按比例截断：轮初 `remainingExerciseMin = 0.5` 且 `dt = 60` 时仍按整 dt 消耗。
- 钳位：区域 `consumed` 不超过 `base + uptake`，所以糖原不会为负；`glycogenConsumedG` 是实际消耗，不是请求。
- `physicalActivity` 未加载 → 运动摄糖与区域消耗均为 0；已加载但 `remainingExerciseMin` / `intensity` 缺失、非数值、非有限、剩余时间为负或 `intensity ∉ [0, 1]` 时抛错，本轮不写状态。区域自身字段缺失按 0。`glucose.excessMassG`、`glucose.concentrationMgDl`（运动时读取）或 `insulinPmolL` 已加载但缺失、非数值、非有限或为负时抛错；合法 0 是有效信号。
- 时序：第 N 轮 `glucose` 写出 `excessMassG(N)`；第 N+1 轮聚合器读到它并写 `uptakeRequestG`；第 N+2 轮 `glucose` 结算并写入 `muscleGlucose.uptakeG`；第 N+3 轮聚合器把到账量分给区域，区域再下一轮入账 `glycogenG`。`exercise` / `sex` 第 1 轮进入 `physicalActivity`，第 2 轮聚合器请求运动摄糖、区域开始消耗。
- 示例（区域消耗）：轮初三区 `glycogenG` 为 `15 / 135 / 150 g`、无在途、`intensity = 1`、`dt = 60` → 头颈消耗 `0.025 g`、躯干消耗 `0.225 g`、四肢消耗 `0.25 g`；三区域合计 `0.5 g`。轮初某区域 `glycogenG = 0.2`、`uptakeG = 0`、`dt = 60` 且按份额需耗 `0.25 g` → 该区域实际消耗 `0.2 g`，糖原为 0。

### 6.3 消费者与质量账

- `glucose` 是 `uptakeRequestG` 的唯一读取方和唯一 transfer 发起者；请求不是实际通量，只有 `muscleGlucose.uptakeG` 记录实际到账。
- 聚合器把在途 `uptakeG` 按份额转给区域；区域是各自糖原的唯一写者，不互相转移，也不向 `glucose` 或肝释放。
- `physicalActivity` 是区域运动消耗的唯一上游读取，`exercise` 与 `sex` 都经同一字段驱动消耗；当前没有其他调节模块读取区域糖原。
- 外源碳水质量账把各区域 `glycogenG`、各区域在途 `uptakeG`、聚合器在途 `muscleGlucose.uptakeG` 与累计区域 `glycogenConsumedG` 加入；`uptakeRequestG` 不进入质量账。`disposedGlucoseG` 只表示非肌非肝非肾残余，不能把同一克数再算进糖原。
- `glycogenConsumedG` 不回流 `glucose`，也没有转给肝的路径；它是局部利用出账。

### 6.4 旧档、重启、变体与未建模

- 旧档只有 `muscleGlucose.glycogenG`（总量）时，各区域在第一轮按已加载区域的份额迁移（头 0.05 / 躯干 0.45 / 四肢 0.50；缺区域按剩余份额归一）：若区域仍是 `initialState` 的默认种子（`uptakeG = 0`、`glycogenG = 300 g × 份额`、`glycogenConsumedG = 0`），迁移份额**取代**种子，迁移后三区合计等于旧总量；若区域已有真实存档状态，份额并入其存量。聚合器第一次 write 不再保留旧总量，后续轮次不会重复迁移。旧档在途 `uptakeG` 不改写，仍由聚合器在重启后的第一轮转给区域，区域下一轮入账。旧 `glycogenConsumedG` 丢弃，不反推历史消耗。
- 旧档缺 `muscleGlucose` 时补两个 0；已有部位缺 `uptakeRequestG` 时补 0；区域缺失时由 `regions` 的 `initialState` 补 `uptakeG = 0`、`glycogenConsumedG = 0` 及按份额分配的初始 `glycogenG`（头颈 `15 g` / 躯干 `135 g` / 四肢 `150 g`），不反推历史糖原。重启保留已提交的 `uptakeRequestG`、`muscleGlucose.uptakeG`、区域 `uptakeG` / `glycogenG` / `glycogenConsumedG`，下一轮各自只处理一次。
- 缺区域变体：复制清单，去掉 `regions/limbs.ts`，把聚合器换成 `glucose-uptake.no-limbs.ts`；只声明剩余区域，份额按剩余区域归一。不能只删区域脚本而保留正常入口，否则 `transferOut` 目标未声明会拒绝启动；同一清单不能同时加载两个聚合器入口。更细的左右臂/左右腿拆分、缺失肢体的质量推断与残肢局部代谢不在本切片内。
- 不建肌糖原容量上限、静息周转、运动类型/MET、能量消耗、乳酸/Cori 循环、区域耗竭对活动或疲劳的反馈、肝糖原释放、胰岛素浓度或脂肪组织分区；肌肉不向血液释放葡萄糖。
- 参数全部 `design`、`source: null`；`SRC-DALLAMAN-2007` §III.C.3 只支撑组织利用可分的结构方向，不支撑 0.5 g/min 最大速率、20 g 半饱和、1.0 敏感度、0.15 g/min 运动摄糖速率、0.5 g/min 总糖原消耗速率或 0.05/0.45/0.50 份额。未做真实 DSH 会话、独立肌糖原/血糖数据或临床验证；区域质量分布、按份额缩放的消耗速率和归一化都是工程假设。
