# 性反应周期（sexual-response）：性别中立的唤醒代理与性行为入口

**功能标签：** 神经、生殖（性反应周期薄切片；性别中立）。

`sexual-response/response.ts` 维护 `sexualResponse` 部位，接收 `sex { durationMin, intensity }` 与无载荷 `orgasm`，按模型内唤醒代理走 `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution`。高潮有两条释放路径：`orgasm` 动作在轮初 `arousalMm >= orgasmAllowedMm = 70` 时主动触发；轮初 `arousalMm >= orgasmForcedMm = 95` 时无需动作强制释放。它不是解剖器官，也不是性别特异模型：状态里没有解剖、伴侣、行为细节或任何显性内容。

两个消费者：

- [`physicalActivity`](../skeletal-muscle/README.md) 把 `sex` 与 `exercise` 同样计入剩余活动；后续 `skin` 的汗液、`lungs` 的运动相关呼吸失水与 `muscleGlucose` 的肌糖原消耗沿用既有时序。
- [`interoception`](../brain/README.md) 软读 `arousalMm` 写 `sexualArousalMm`；该读数只进 `body_state` / `GET /state`，不进 `discomfort`，不发通知。

**状态口径。** 当前实现（2026-11-23）：脚本与参数在 `organs/human-organs/sexual-response/`，根清单 `body-modules.json` 与女性清单 `body-modules.female.json` 都注册同一脚本。加入本脚本后根清单为 20 部位、22 份参数文件，女性清单为 22 部位、24 份参数文件；女性清单仍必须使用独立 `statePath`。六个参数全部 `design`、`source: null`，没有登记来源；反应周期分期只作工程结构，数值不是人体测量、拟合或独立验证。尚未做真实 DSH 会话、独立人体性反应数据、临床验证或 20 部位性能基线。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `response.ts` | `sexualResponse` | `arousalMm`、`phase`、`remainingSexMin`、`sexIntensity`、`lastOrgasmAtSimMin` | 自己的轮初状态；`io.actions` 中的 `sex` / `orgasm`；`io.dt`；`io.simulatedSeconds` | `response.parameters.json` |

- `actionTypes = ['sex', 'orgasm']`；无通知、无 `transfer`，不写其他部位。
- `orgasm` 只由本部位处理，`physicalActivity` 只接受 `exercise` / `sex`，不把 `orgasm` 计入体力活动。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数不做运行中热切换。
- 本脚本不自动开始或停止性行为，也不从其他部位推断性行为；动作只来自 `body_act` 或 `POST /actions`。`sex` / `orgasm` 也不会由 `physicalActivity` 或 `interoception` 反向写入。

## 2. 字段与单位

五个字段都是 `absolute`。`initialState = { arousalMm: 0, phase: 'rest', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null }`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `arousalMm` | `mm` | 唤醒代理 0–100，沿用 100-mm VAS 刻度；不是生理测量、神经放电、血流或激素浓度 |
| `phase` | `-` | 模型相位：`rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution`；不是临床分期 |
| `remainingSexMin` | `min` | 本轮结束后剩余的性活动分钟；先按 `io.dt` 递减，再由本轮合法 `sex` 的 `durationMin` 替换，不累加 |
| `sexIntensity` | `1` | 模型内相对强度 0–1；不是 MET、心率、功率、耗氧量或能量消耗 |
| `lastOrgasmAtSimMin` | `min` | 最近一次主动或强制释放的仿真分钟（`io.simulatedSeconds / 60`）；从未发生为 `null`，不是 0 |

时间原点：`remainingSexMin`、`sexIntensity`、`arousalMm` 与 `phase` 都是本轮轮末状态；`lastOrgasmAtSimMin` 记录高潮事件发生的轮末仿真分钟。`sexIntensity` 在活动结束后仍保留最后一个值，但 `remainingSexMin = 0` 时 `active` 为假，不再产生唤醒目标；`phase` 每轮由当前状态重新派生，不读上一轮 `phase`。

## 3. 动作契约与校验

`body_act` 的 `sex` 载荷为 `{ type: "sex", intensity, durationMin }`，与 `exercise` 使用同一组字段和同一套校验：

- `intensity` 必填、有限且 `0 < intensity <= 1`；
- `durationMin` 必填、有限且 `> 0`；
- 不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`；
- 不接收伴侣、行为类型、体位、性别、避孕或任何内容字段。

非法 `sex`（强度为 0 或超过 1、时长为 0 或负数、NaN、非有限数、字段缺失）被忽略，不改变 `sexualResponse` 的任何字段。模块对已经到达的原始动作再按同一规则校验；工具层拒绝非法载荷，不进入动作队列。

`orgasm` 是**无载荷**动作，只写 `{ type: "orgasm" }`，没有 `intensity`、`durationMin`、`phase` 或 `lastOrgasmAtSimMin` 参数。它只在轮初 `arousalMm >= orgasmAllowedMm = 70` 时生效；轮初唤醒低于 70 时动作被忽略，不因该动作改变状态。它不要求 `active`，也不要求同轮存在 `sex`，只看轮初唤醒。

**高潮由模型判定，LLM 只能提交请求。** LLM 只控制输入（`drink` / `eat` / `urinate` / `exercise` / `sex` / `orgasm` 等动作），不直接写 `arousalMm`、`phase` 或 `lastOrgasmAtSimMin`。只有少数输出允许主动触发：`urinate` 与 `orgasm`；两者都有非自主兜底——膀胱 >600 mL 时非自主排空，唤醒 ≥95 mm 时强制释放。`orgasm` 动作低于 70 mm 被忽略，≥95 mm 时即使没有动作也会释放；这是模型判定，不是调用方宣布。

同一轮有多条合法 `sex` 时，按到达顺序处理，后一条用自身的 `durationMin` / `intensity` 替换前一条；后面的非法动作不会覆盖此前的合法值。同一轮存在多条 `orgasm` 动作时也只释放一次。`sex` 与 `exercise` 同轮时，`physicalActivity` 也按“最后一条合法动作替换”处理，两类动作互相替换，不累加时长；`orgasm` 不参与这条替换。

## 4. 状态机与方程

设轮初自身状态为 `prev`，`dtMin = io.dt / 60`，`simMin = io.simulatedSeconds / 60`：

```text
remainingSexMin = max(0, prev.remainingSexMin − dtMin)
本轮合法 sex 动作：remainingSexMin = durationMin，sexIntensity = intensity

active = remainingSexMin > 0 && sexIntensity > 0
sinceOrgasmBefore = lastOrgasmAtSimMin === null ? Infinity : simMin − lastOrgasmAtSimMin
refractory = sinceOrgasmBefore < refractoryMin
target = active && !refractory ? 100 × sexIntensity : 0
halfTime = target > prev.arousalMm ? arousalHalfTimeMin : resolutionHalfTimeMin
arousalMm = target + (prev.arousalMm − target) × 2^(−dtMin / halfTime)

release = (本轮存在 orgasm 动作 && prev.arousalMm >= orgasmAllowedMm)
          || prev.arousalMm >= orgasmForcedMm

若 release：
  lastOrgasmAtSimMin = simMin
  sinceOrgasm = 0
否则：
  sinceOrgasm = sinceOrgasmBefore

phase = sinceOrgasm < orgasmDurationMin ? 'orgasm'
      : refractory ? 'refractory'
      : active ? (arousalMm < 60 ? 'excitement' : 'plateau')
      : arousalMm >= 10 ? 'resolution' : 'rest'
```

- `active` 只要求剩余分钟和强度都大于 0；`sexIntensity = 0` 或剩余分钟为 0 时目标为 0，唤醒按消退半时回落。两条释放路径不要求 `active`，也不要求同轮有 `sex`，都只按轮初 `prev.arousalMm` 判定。
- 主动路径：本轮存在 `orgasm` 动作，且轮初 `prev.arousalMm >= orgasmAllowedMm = 70`。低于 70 时动作被忽略，`lastOrgasmAtSimMin`、`phase`、`remainingSexMin` 与 `sexIntensity` 都不因该动作改变；同轮合法 `sex` 仍按自身规则更新剩余分钟与强度。
- 强制路径：轮初 `prev.arousalMm >= orgasmForcedMm = 95`，无需任何动作。两条路径每轮最多记录一次 `lastOrgasmAtSimMin = simMin`。
- 释放判定用**轮初**唤醒：本轮 `sex` 写入的 `arousalMm` 不会在同一轮触发释放。例如轮初 69 mm、同轮 `sex` 把它推到 75 mm，主动 `orgasm` 仍被忽略；若升到 95 mm 以上，也要等到下一轮轮初才强制释放。
- 事件轮 `sinceOrgasm = 0`，相位为 `orgasm`；下一轮 `sinceOrgasm = dtMin`（60 s 轮下为 1 min），不再满足 `sinceOrgasm < orgasmDurationMin = 1`，进入 `refractory`，目标变为 0，唤醒按 15 min 半时下降。文档不要写成“下一轮 `sinceOrgasm = 0`”。
- `target = 100 × sexIntensity`。强度 0.8 的目标是 80 mm：第 15 轮写出的唤醒约 70 mm，下一轮轮初才达到 70 mm，可提交主动 `orgasm`；目标不到 95 mm，不会强制释放。强度 1 的目标是 100 mm：第 9 轮写出约 71 mm，下一轮轮初 ≥70 可主动释放；第 22 轮写出约 95 mm，下一轮轮初由强制路径释放。具体轮次由 `dt` 与轮初状态决定。
- 上升与下降使用不同半时：目标高于当前唤醒时用 `arousalHalfTimeMin = 5`；目标低于或等于当前唤醒时用 `resolutionHalfTimeMin = 15`。这是工程反应速度，不是人体性反应潜伏期或消退时间。
- 不应期内（`sinceOrgasmBefore < 20` min）新到的合法 `sex` 仍更新 `remainingSexMin` 与 `sexIntensity`，但 `target = 0`，唤醒不上升；不应期结束后若仍有剩余活动，目标恢复为 `100 × sexIntensity`。
- 相位优先级固定为：`orgasm`（事件轮，`sinceOrgasm = 0`）→ `refractory`（`sinceOrgasm < 20` min）→ `excitement` / `plateau`（`active`，以 60 mm 分界）→ `resolution`（无活动且 `arousalMm >= 10`）→ `rest`（无活动且 `arousalMm < 10`）。不应期内即使 `active` 仍为真，相位也显示 `refractory`。
- 60 s 轮下，`phase = 'orgasm'` 只在释放事件轮出现；下一轮 `sinceOrgasm = 1 min`，进入 20 min 不应期。`sinceOrgasm` 到 20 min 时 `refractory` 为假，若仍有活动则回到 `excitement` / `plateau`，否则按唤醒水平进入 `resolution` 或 `rest`。
- 没有活动时，唤醒只按消退半时下降；降到 10 mm 以下时相位为 `rest`。相位的 60 mm 与 10 mm 分界、`orgasmDurationMin = 1` 与不应期 20 min 都是 `design` 策略，不是诊断标准。

## 5. 参数（全部 `design`）

同目录 `response.parameters.json`，`owner` 为 `sexualResponse`：

| 参数 ID | 默认值 | 单位 | 状态 | 来源 | 用途 |
| --- | ---: | --- | --- | --- | --- |
| `sexualResponse.arousalHalfTimeMin` | 5 | `min` | `design` | `null` | 唤醒上升半时 |
| `sexualResponse.resolutionHalfTimeMin` | 15 | `min` | `design` | `null` | 唤醒下降/消退半时 |
| `sexualResponse.orgasmAllowedMm` | 70 | `mm` | `design` | `null` | 主动 `orgasm` 动作的最低轮初唤醒 |
| `sexualResponse.orgasmForcedMm` | 95 | `mm` | `design` | `null` | 无动作强制释放的轮初唤醒 |
| `sexualResponse.orgasmDurationMin` | 1 | `min` | `design` | `null` | `orgasm` 相位持续分钟 |
| `sexualResponse.refractoryMin` | 20 | `min` | `design` | `null` | 高潮后不应期 |

分期结构参照一般性反应周期（兴奋 / 平台 / 高潮 / 消退 / 不应期），但本切片没有登记来源，`source-index.csv` 不新增行；六个数值不是人体测量、论文拟合、临床界值或独立验证结果。`range`（若参数文件声明）只是工程调参范围，不是人群范围。两个高潮阈值都是模型内代理，不是生理测量；不应期也不是诊断或治疗概念。

## 6. 消费者与时序

```text
sex 动作
  → sexualResponse：本轮写 arousalMm / phase / remainingSexMin / sexIntensity /
                    lastOrgasmAtSimMin
  → interoception：下一轮轮初软读 arousalMm，写 sexualArousalMm

sex 动作
  → physicalActivity：本轮写 remainingExerciseMin / intensity（与 exercise 同一字段）
      → skin / lungs / muscleGlucose：下一轮轮初读取，写汗液请求、呼吸失水请求、糖原消耗

orgasm 动作（轮初 arousalMm >= 70）或轮初 arousalMm >= 95（无需动作）
  → sexualResponse：本轮记录 lastOrgasmAtSimMin = simMin，phase = orgasm
```

- `sexualResponse` 与 `physicalActivity` 都读同一轮原始动作，但互不读取对方状态；`sex` 计入体力活动不依赖 `sexualResponse` 是否加载，`sexualArousalMm` 也不依赖 `physicalActivity`。`orgasm` 只由 `sexualResponse` 读取，不改变 `physicalActivity` 的剩余活动或强度。
- `interoception` 在下一轮轮初读取 `sexualResponse.arousalMm`，钳到 `[0, 100]` 后写 `sexualArousalMm`；因此动作轮提交后，`sexualArousalMm` 最早在下一轮可见。它只作读出，不进入 `discomfort` 的五路最大值，也不进入 `brainNotify` 的四类提醒。
- `skin`、`lungs` 与 `muscleGlucose` 的时序沿用活动链：`exercise` / `sex` 第 1 轮进入 `physicalActivity`，第 2 轮皮肤与肺写请求、肌肉开始消耗，第 3 轮体液首次结算汗液与运动相关呼吸失水。性活动不额外产生失水或糖原消耗，只通过 `physicalActivity` 的同一字段进入既有链路。
- 60 s 一轮、`intensity = 1`、`durationMin = 30` 时，`sexualResponse` 在动作轮开始上升；第 9 轮写出约 71 mm，下一轮轮初 ≥70，可提交 `orgasm` 主动释放；若一直未提交，第 22 轮写出约 95 mm，下一轮轮初由强制路径释放。释放轮为 `orgasm`，下一轮 `sinceOrgasm = 1 min`，进入约 20 min 不应期。这个示例是模型内时序，不是人体反应周期。

## 7. 旧档、重启与未加载

- **新身体：** `initialState` 给出 `arousalMm = 0`、`phase = 'rest'`、`remainingSexMin = 0`、`sexIntensity = 0`、`lastOrgasmAtSimMin = null`。
- **根旧档缺 `sexualResponse`：** 启动时只补上述初值，不反推历史性行为、高潮或不应期；`interoception` 的旧档也只补 `sexualArousalMm = 0`，其余体感逐点不变。
- **重启：** `remainingSexMin`、`sexIntensity`、`arousalMm` 与 `lastOrgasmAtSimMin` 随存档保留；下一次 heartbeat 从保存值继续，不重复记录已发生的高潮，也不重置在途活动。重启后若轮初 `arousalMm >= 95`，强制路径仍会生效；若低于 70，`orgasm` 动作仍被忽略。
- **`lastOrgasmAtSimMin = null`：** 存档、`body_state` 与 JSON 往返都保持 `null`，不会变成 0、`undefined` 或 `NaN`。已有高潮时间只表示仿真分钟，不随现实时间或重启变化。
- **未加载 `sexualResponse`：** `physicalActivity` 仍可接收 `sex` 并计入活动（只要清单加载了它）；`interoception` 的 `sexualArousalMm` 恒 0，其余五路与 `discomfort` 不变。若清单既没有 `sexualResponse` 也没有其他模块声明 `sex`，Gateway 对 `sex` 返回 `422`；没有模块声明 `orgasm` 时对 `orgasm` 同样返回 `422`。
- 状态只含有限数字、字符串与 `null`，JSON-safe；没有 `undefined`、`NaN`、`Infinity`、数组或循环引用。

## 8. 清单、计数与 transfer 边界

- 根清单 `body-modules.json` 加入 `./organs/human-organs/sexual-response/response.ts` 后为 20 部位、22 份参数文件；女性清单 `body-modules.female.json` 也加入同一脚本后为 22 部位、24 份参数文件。
- 本部位不声明 `transferOut` / `transferIn`，不参与硬 transfer 闭包；根清单的 9 部位硬闭包、女性清单的 10 部位硬闭包都不因本切片改变。
- `package.json` 的 `files` 已收录 `organs/`，脚本与同目录参数文件随包发布；不需要新增入口或依赖。
- `body_act` 的 `type` 枚举增加 `sex` 与无载荷 `orgasm`；`sex` 复用已有的 `intensity` / `durationMin` 字段，`orgasm` 不接收载荷。`body_state` 返回 `sexualResponse` 的五个字段与 `interoception.sexualArousalMm`。

## 9. 未建模

- **激素与自主反应：** 不建催产素、催乳素、内啡肽、睾酮/雌激素等激素，也不建心率、血压、呼吸频率、通气量、血流、肌张力或出汗的独立性反应通路；汗液与呼吸失水只复用 `physicalActivity` 的体力活动链。
- **受孕、妊娠与生育力：** 不建排卵、受孕、着床、妊娠、生育力窗或避孕；这些需要另一套生殖模型，本切片不推断。
- **性欲、情绪与关系：** 不建性欲、动机、愉悦、情绪、亲密关系、伴侣状态或同意建模；`arousalMm` 只是反应周期代理，不是欲望或情绪评分。
- **伴侣、性病与避孕：** 不建伴侣、暴露、性传播感染、避孕或安全性行为；动作载荷没有这些字段，模型也不输出相关建议。
- **显性内容：** 不描述、生成或要求任何显性内容、行为细节、解剖细节或媒体；本模块只处理 `durationMin`、`intensity` 与内部状态。
- **其他：** 不建性别差异、个体差异、年龄/BMI/疾病影响、运动类型、体位、能量消耗/MET、临床性功能障碍、性反应周期测量、通知或不适通道；`sexualArousalMm` 不进 `discomfort`，`brainNotify` 不读它。高潮由模型按轮初唤醒判定；LLM 只能提交无载荷 `orgasm` 请求，低于 70 mm 被忽略，≥95 mm 时无需动作也会强制释放；调用方不能直接写 `phase` 或 `lastOrgasmAtSimMin`。

## 10. 证据与验证边界

- 本切片没有登记来源：六个参数全部 `design`、`source: null`，`source-index.csv` 不新增行；脚本头注释也不声称论文支撑。
- 兴奋 / 平台 / 高潮 / 消退 / 不应期的分期只是一般性结构参照，不是本模型已获验证的生理曲线；60 mm、10 mm 分界、5/15 min 半时、70 / 95 mm 阈值、1 min 高潮相位与 20 min 不应期都是工程假设。
- 只有离线模块测试、`physicalActivity` / `interoception` 集成测试和真实 Gateway 测试会覆盖动作校验、时序、JSON-safe 与读数；没有真实 DSH 会话、独立人体性反应数据、临床验证或 20 部位性能基线。离线测试通过不等于人体验证，也不能称 `validated`。

设计见 [`2026-11-23-sexual-response-design.md`](../../../docs/superpowers/specs/2026-11-23-sexual-response-design.md)；活动侧见 [`skeletal-muscle`](../skeletal-muscle/README.md)，体感侧见 [`brain`](../brain/README.md)。
