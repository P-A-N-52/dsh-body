# 唾液腺（salivary glands）：唾液产率与口腔湿润度代理

**功能标签：** 消化（口腔起点）与体感（口干读数）。

`organs/human-organs/salivary-glands/` 目前只有一个部位 `salivaryGlands`，脚本为 `saliva.ts`。它按基础分泌、进食刺激和脱水状态计算本轮唾液产率 `salivaRateMlPerMin`，并换算出 0–100 mm 的口腔湿润度代理 `mouthMoistureMm`。当前有两个消费者：`duodenum` 读取产率，对含碳水餐的营养暴露给淀粉酶增益；`interoception` 读取湿润度，写出口干读数 `dryMouthMm`。本脚本不写其他部位、不调用 `transfer` 或 `notify`，也不建唾液水账。

实现状态：脚本、参数、模块契约测试与真实 Gateway 测试已落地；当前根清单为 43 部位、39 份唯一参数文件，女性清单为 46 部位、42 份，男性清单为 45 部位、41 份；本切片不新增 `transfer`，硬闭包为根与男性 15 个部位、女性 17 个。四个 `salivaryGlands.*` 参数与消费者参数 `duodenum.salivaryAmylaseGain`、`duodenum.referenceSalivaRateMlPerMin` 全部是 `design`、`source: null`（`duodenum` 已通过本地参考产率参数与 `saliva.parameters.json` 解耦）。本文只描述离线模型与契约，未做真实 DSH 会话、唾液流率实测或临床验证。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "salivaryGlands.basalRateMlPerMin": 0.6 } }
```

### saliva.parameters.json

参数文件：[`saliva.parameters.json`](saliva.parameters.json)。入口及清单：[`saliva.ts`](saliva.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json)）。读取脚本：[`saliva.ts`](saliva.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `salivaryGlands.basalRateMlPerMin` | `0.5` | `mL/min` | `design` | 无 | — |
| `salivaryGlands.mealGain` | `3` | `1` | `design` | 无 | — |
| `salivaryGlands.mealWindowMin` | `5` | `min` | `design` | 无 | — |
| `salivaryGlands.dehydrationFactor` | `0.5` | `1` | `design` | 无 | — |

本文件额外登记的 `duodenum.salivaryAmylaseGain` 不在 `parameters` 数组内，不由本器官读取；实际默认见 [`nutrient-exposure.parameters.json`](../duodenum/nutrient-exposure.parameters.json)。

<!-- organ-parameters:end -->

## 1. 脚本与部位

| 脚本 | 部位 id | 动作 | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- | --- |
| `saliva.ts` | `salivaryGlands` | `eat`、`drink` | `salivaRateMlPerMin`、`mealStimulusMin`、`mouthMoistureMm` | 自己的轮初状态；轮初 `bodyFluid.waterDeficit`（未加载时按 0）；本轮动作里的 `eat` / `drink`；`io.dt` | `saliva.parameters.json` |

- 只读轮初快照与本轮原始动作；同轮多条合法 `eat` / `drink` 只把刺激窗口重置一次，不叠加、不延长。
- 饮食刺激校验与 `stomach` / `esophagus` 的摄入输入契约对齐：`drink` 需正有限 `volumeMl` 与可选非负有限 `durationMin` / `carbohydrateG` / `energyKcal`；`eat` 除了上述体积/可选字段外，还必须具备合法 `mealKind`（`liquid` / `solid` / `mixed`）与非负有限 `energyKcal`，避免畸形 `eat` 触发唾液刺激。
- `bodyFluid` 是可选部位：未加载时缺乏量按 0。已加载但 `waterDeficit` 缺失、非数值或非有限时抛错，本轮不写状态，由 Gateway 整轮作废。缺乏量超出 `[0, 1]` 时由公式钳位，不报错。
- 不调用 `transfer` / `notify`，`actionTypes = ['eat', 'drink']`。`GET /capabilities` 会把 `salivaryGlands` 追加到 `eat` / `drink` 的模块列表。

## 2. 字段、单位与方程

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `salivaRateMlPerMin` | `mL/min` | 本轮唾液产率；是产率代理，不是实测唾液流率、腺体分泌量或口腔液体总量 |
| `mealStimulusMin` | `min` | 进食刺激剩余分钟；`eat` / `drink` 触发后从 `mealWindowMin` 起逐轮递减 |
| `mouthMoistureMm` | `mm` | 口腔湿润度代理 0–100；不是口腔黏膜湿度、唾液渗透压或口干量表 |

初值 `{ salivaRateMlPerMin: 0.5, mealStimulusMin: 0, mouthMoistureMm: 100 }`；三个字段都是 `absolute`。口腔湿润度按静息基础流率 `basalRateMlPerMin` 归一化：水合静息时产率为基线 0.5 mL/min、`mouthMoistureMm = 100 mm`（对应 `interoception.dryMouthMm = 0`），最大脱水（`waterDeficit = 1`）时降到 `50 mm`（口干 `50 mm`），进食刺激时钳在 `100 mm`。这是按基础流率归一化的工程设计，不是人体口腔湿度校准。

设 `prev` 为轮初自身状态，`deficit = clamp(bodyFluid.waterDeficit, 0, 1)`（`bodyFluid` 未加载时按 0），`dtMin = io.dt / 60`：

```text
mealStimulusMin = max(0, prev.mealStimulusMin − dtMin)
                  本轮有合法 eat / drink 时置为 mealWindowMin
stimulated      = mealStimulusMin > 0 ? mealGain : 1
dehydration     = 1 − dehydrationFactor × deficit
salivaRateMlPerMin = basalRateMlPerMin × stimulated × dehydration
mouthMoistureMm    = clamp(100 × salivaRateMlPerMin / basalRateMlPerMin, 0, 100)
```

- 刺激窗口按 `io.dt / 60` 递减，不用现实时间或 `io.simulatedSeconds` 猜进度；一次摄入后产率在接下来 5 个 60 s 轮次保持 `×3`，第 6 轮回到基线（若同时脱水则按脱水系数缩放）。
- 产率与湿润度每轮从自身窗口和轮初 `bodyFluid` 重算，不保留上一轮产率作为状态；旧档缺 `mealStimulusMin` 时按 0 处理，缺整个部位时由 `initialState` 补齐。
- 三个输出都是有限数字，状态 JSON-safe；不写 `undefined`、`NaN` 或 `Infinity`。

## 3. 参数

同目录参数文件（`owner: salivaryGlands`）：

| 参数 ID | 值 | 单位 | 状态 | 来源与说明 |
| --- | ---: | --- | --- | --- |
| `salivaryGlands.basalRateMlPerMin` | 0.5 | `mL/min` | `design` | `source: null`；静息产率工程基线，不是实测静息流率 |
| `salivaryGlands.mealGain` | 3 | `1` | `design` | `source: null`；进食刺激相对基线的倍数，不是实测唾液流率倍数 |
| `salivaryGlands.mealWindowMin` | 5 | `min` | `design` | `source: null`；一次合法 `eat` / `drink` 后保持刺激的仿真分钟数，不是口腔消化时长 |
| `salivaryGlands.dehydrationFactor` | 0.5 | `1` | `design` | `source: null`；`waterDeficit = 1` 时产率的缩减比例，线性关系和系数均为工程假设 |

`duodenum.salivaryAmylaseGain = 0.05` 属于 `duodenum` 消费者，实际由 `duodenum/nutrient-exposure.ts` 从同目录 `nutrient-exposure.parameters.json` 读取；本文件的 `consumerParameters` 数组保留一份同值声明，id 带 `duodenum.` 前缀，`salivaryGlands` 脚本不读取。四个 `salivaryGlands.*` 参数的 `range` 只是工程调参范围，不是人体范围；`source-index.csv` 没有唾液流率、刺激窗口或淀粉酶增益的登记来源。

## 4. 消费者与时序

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| `duodenum` | 轮初 `salivaryGlands.salivaRateMlPerMin` | 对含碳水餐的营养暴露乘 `1 + salivaryAmylaseGain × salivaRateMlPerMin / duodenum.referenceSalivaRateMlPerMin`；不含碳水时不变 |
| `interoception` | 轮初 `salivaryGlands.mouthMoistureMm` | `dryMouthMm = clamp(100 − mouthMoistureMm, 0, 100)`；不进入 `discomfort`，现已接入 `brainNotify` 与纯定性 `body_state` |

- **duodenum。** 只有轮初 `stomach.emptiedCarbohydrateG` 为有限正数时才应用增益；缺失、0、非数或非有限按不含碳水处理，输出与旧行为逐点一致。`salivaryGlands` 未加载时增益按 0；已加载但产率缺失、非数、非有限或为负时抛错，本轮不写。增益乘在到达速率上，不乘在滤波状态上，避免逐轮复利。
- **interoception。** `salivaryGlands` 是可选部位：未加载、字段缺失、非数或非有限时 `dryMouthMm = 0`（不按最大口干）；湿润度超出 0–100 时钳位。水合静息时 `mouthMoistureMm = 100 mm`，对应 `dryMouthMm = 0 mm`；最大脱水时 `mouthMoistureMm = 50 mm`，对应 `dryMouthMm = 50 mm`。口干读数不参与不适的多路最大值，但现已接入 `brainNotify` 与纯定性 `body_state`（无数字），原始数值由 `GET /state` / `gateway.getState()` 返回。
- **一轮偏移。** 两个消费者都只读轮初快照。第 N 轮摄入后，本脚本当轮写出刺激状态；第 N+1 轮 `interoception` 才读到新的湿润度。`duodenum` 还要等胃把该餐排入下一轮快照，最早第 N+2 轮才把淀粉酶增益计入暴露。
- **旧档与重启。** 旧档缺 `salivaryGlands` 时由 `initialState` 补基础产率、`mealStimulusMin = 0` 与基础湿润度，不反推历史进食；重启保留已提交的刺激窗口与产率，下一轮继续按 `io.dt` 递减。本部位没有 `resetOnStart` 字段。

## 5. 未建模

- **唾液水账：** 唾液量不进入 `bodyFluid`，不扣水、不补水，也不参与水链恒等式；产率只是 `mL/min` 读数。
- **淀粉酶浓度与活性：** 不建唾液淀粉酶浓度、pH、黏蛋白、电解质或酶活性；`duodenum` 的增益只按产率比例缩放，不是酶动力学。
- **吞咽与食管：** 不建吞咽动作、食管蠕动、胃食管反流或误吸；唾液不进入胃或小肠。
- **口腔疾病与腺体病理：** 不建唾液腺结石、炎症、干燥综合征、放疗损伤、药物性口干或口腔感染。
- **味觉与食欲：** 不建味觉、嗅觉、食物口感、咀嚼或餐前唾液条件反射；`eat` / `drink` 只看动作类型与体积。
- **口咽解渴：** 不建吸收前口咽刺激对 thirst 的短暂抑制；`interoception.dryMouthMm` 不改变口渴或自动饮水，现已作为独立通道接入 `brainNotify` 与纯定性 `body_state`。
- **个体差异与节律：** 年龄、性别、体重、腺体体积、昼夜节律、睡眠、运动、环境湿度和温度都不进入方程；四个参数是证据默认值，不是个体标定。
- **其他唾液功能：** 不建免疫（IgA）、缓冲、牙釉质保护、消化脂肪的舌脂酶或口腔微生物组。

## 6. 未验证

没有唾液流率、刺激持续时间、脱水缩减比例或淀粉酶增益的直接人体测量、独立数据或临床验证；0.5 mL/min、×3、5 min、0.5 与 0.05 全是 `design`、`source: null` 的工程假设，不能称拟合、实测或 `validated`。真实 Gateway 测试只验证清单加载、动作触发、消费者读数、脱水预置与重启接续，不是实机生理验收；本切片未做全清单性能实测。`dryMouthMm` 不能当作口干量表、唾液渗透压或临床干燥症指标。

## 7. 证据入口

- 设计：[`docs/superpowers/specs/2026-11-24-salivary-glands-design.md`](../../../docs/superpowers/specs/2026-11-24-salivary-glands-design.md)
- 模块契约测试：[`test/organs.salivary.test.mjs`](../../../test/organs.salivary.test.mjs)
- 真实 Gateway 测试：[`test/organs.salivary-gateway.test.mjs`](../../../test/organs.salivary-gateway.test.mjs)
- 消费者：[`duodenum`](../duodenum/README.md) 与 [`brain`](../brain/README.md) 的 README
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片没有登记行）
