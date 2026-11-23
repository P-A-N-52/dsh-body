# 唾液腺（salivary glands）：唾液产率与口腔湿润度代理

**功能标签：** 消化（口腔起点）与体感（口干读数）。

`organs/human-organs/salivary-glands/` 目前只有一个部位 `salivaryGlands`，脚本为 `saliva.ts`。它按基础分泌、进食刺激和脱水状态计算本轮唾液产率 `salivaRateMlPerMin`，并换算出 0–100 mm 的口腔湿润度代理 `mouthMoistureMm`。当前有两个消费者：`duodenum` 读取产率，对含碳水餐的营养暴露给淀粉酶增益；`interoception` 读取湿润度，写出口干读数 `dryMouthMm`。本脚本不写其他部位、不调用 `transfer` 或 `notify`，也不建唾液水账。

实现状态：脚本、参数、模块契约测试与真实 Gateway 测试已落地；根清单为 32 部位、31 份参数文件，女性清单为 35 部位、34 份（分区骨骼肌接入后）；本切片不新增 `transfer`，根硬闭包为 13 个部位、女性 15 个。四个 `salivaryGlands.*` 参数与消费者参数 `duodenum.salivaryAmylaseGain` 全部是 `design`、`source: null`。本文只描述离线模型与契约，未做真实 DSH 会话、唾液流率实测或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 动作 | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- | --- |
| `saliva.ts` | `salivaryGlands` | `eat`、`drink` | `salivaRateMlPerMin`、`mealStimulusMin`、`mouthMoistureMm` | 自己的轮初状态；轮初 `bodyFluid.waterDeficit`（未加载时按 0）；本轮动作里的 `eat` / `drink`；`io.dt` | `saliva.parameters.json` |

- 只读轮初快照与本轮原始动作；同轮多条合法 `eat` / `drink` 只把刺激窗口重置一次，不叠加、不延长。
- 合法摄入只看动作类型与正有限 `volumeMl`；餐型、能量和碳水的合法性仍由 `stomach` 判定，本脚本不重复校验。
- `bodyFluid` 是可选部位：未加载时缺乏量按 0。已加载但 `waterDeficit` 缺失、非数值或非有限时抛错，本轮不写状态，由 Gateway 整轮作废。缺乏量超出 `[0, 1]` 时由公式钳位，不报错。
- 不调用 `transfer` / `notify`，`actionTypes = ['eat', 'drink']`。`GET /capabilities` 会把 `salivaryGlands` 追加到 `eat` / `drink` 的模块列表。

## 2. 字段、单位与方程

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `salivaRateMlPerMin` | `mL/min` | 本轮唾液产率；是产率代理，不是实测唾液流率、腺体分泌量或口腔液体总量 |
| `mealStimulusMin` | `min` | 进食刺激剩余分钟；`eat` / `drink` 触发后从 `mealWindowMin` 起逐轮递减 |
| `mouthMoistureMm` | `mm` | 口腔湿润度代理 0–100；不是口腔黏膜湿度、唾液渗透压或口干量表 |

初值 `{ salivaRateMlPerMin: 0.5, mealStimulusMin: 0, mouthMoistureMm: 100 / 3 }`；三个字段都是 `absolute`。无刺激、无脱水时产率为基线，湿润度是 `100 / mealGain`（约 33.33 mm），因此“完全湿润”的 100 mm 只在进食刺激且未脱水时达到；这是公式的设计含义，不是人体口腔湿度校准。

设 `prev` 为轮初自身状态，`deficit = clamp(bodyFluid.waterDeficit, 0, 1)`（`bodyFluid` 未加载时按 0），`dtMin = io.dt / 60`：

```text
mealStimulusMin = max(0, prev.mealStimulusMin − dtMin)
                  本轮有合法 eat / drink 时置为 mealWindowMin
stimulated      = mealStimulusMin > 0 ? mealGain : 1
dehydration     = 1 − dehydrationFactor × deficit
salivaRateMlPerMin = basalRateMlPerMin × stimulated × dehydration
mouthMoistureMm    = clamp(100 × salivaRateMlPerMin / (basalRateMlPerMin × mealGain), 0, 100)
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
| `duodenum` | 轮初 `salivaryGlands.salivaRateMlPerMin` | 对含碳水餐的营养暴露乘 `1 + salivaryAmylaseGain × salivaRateMlPerMin / basalRateMlPerMin`；不含碳水时不变 |
| `interoception` | 轮初 `salivaryGlands.mouthMoistureMm` | `dryMouthMm = clamp(100 − mouthMoistureMm, 0, 100)`；只作独立口干读数，不进入 `discomfort`，也不触发通知 |

- **duodenum。** 只有轮初 `stomach.emptiedCarbohydrateG` 为有限正数时才应用增益；缺失、0、非数或非有限按不含碳水处理，输出与旧行为逐点一致。`salivaryGlands` 未加载时增益按 0；已加载但产率缺失、非数、非有限或为负时抛错，本轮不写。增益乘在到达速率上，不乘在滤波状态上，避免逐轮复利。
- **interoception。** `salivaryGlands` 是可选部位：未加载、字段缺失、非数或非有限时 `dryMouthMm = 0`（不按最大口干）；湿润度超出 0–100 时钳位。口干读数不参与不适的五路最大值，也不进入 `brainNotify`。
- **一轮偏移。** 两个消费者都只读轮初快照。第 N 轮摄入后，本脚本当轮写出刺激状态；第 N+1 轮 `interoception` 才读到新的湿润度。`duodenum` 还要等胃把该餐排入下一轮快照，最早第 N+2 轮才把淀粉酶增益计入暴露。
- **旧档与重启。** 旧档缺 `salivaryGlands` 时由 `initialState` 补基础产率、`mealStimulusMin = 0` 与基础湿润度，不反推历史进食；重启保留已提交的刺激窗口与产率，下一轮继续按 `io.dt` 递减。本部位没有 `resetOnStart` 字段。

## 5. 未建模

- **唾液水账：** 唾液量不进入 `bodyFluid`，不扣水、不补水，也不参与水链恒等式；产率只是 `mL/min` 读数。
- **淀粉酶浓度与活性：** 不建唾液淀粉酶浓度、pH、黏蛋白、电解质或酶活性；`duodenum` 的增益只按产率比例缩放，不是酶动力学。
- **吞咽与食管：** 不建吞咽动作、食管蠕动、胃食管反流或误吸；唾液不进入胃或小肠。
- **口腔疾病与腺体病理：** 不建唾液腺结石、炎症、干燥综合征、放疗损伤、药物性口干或口腔感染。
- **味觉与食欲：** 不建味觉、嗅觉、食物口感、咀嚼或餐前唾液条件反射；`eat` / `drink` 只看动作类型与体积。
- **口咽解渴：** 不建吸收前口咽刺激对 thirst 的短暂抑制；`interoception.dryMouthMm` 只是读数，不改变口渴、饮水或 `brainNotify`。
- **个体差异与节律：** 年龄、性别、体重、腺体体积、昼夜节律、睡眠、运动、环境湿度和温度都不进入方程；四个参数是证据默认值，不是个体标定。
- **其他唾液功能：** 不建免疫（IgA）、缓冲、牙釉质保护、消化脂肪的舌脂酶或口腔微生物组。

## 6. 未验证

没有唾液流率、刺激持续时间、脱水缩减比例或淀粉酶增益的直接人体测量、独立数据或临床验证；0.5 mL/min、×3、5 min、0.5 与 0.05 全是 `design`、`source: null` 的工程假设，不能称拟合、实测或 `validated`。真实 Gateway 测试只验证清单加载、动作触发、消费者读数、脱水预置与重启接续，不是实机生理验收；本切片未做 29 部位性能实测。`dryMouthMm` 不能当作口干量表、唾液渗透压或临床干燥症指标。

## 7. 证据入口

- 设计：[`docs/superpowers/specs/2026-11-24-salivary-glands-design.md`](../../../docs/superpowers/specs/2026-11-24-salivary-glands-design.md)
- 模块契约测试：[`test/organs.salivary.test.mjs`](../../../test/organs.salivary.test.mjs)
- 真实 Gateway 测试：[`test/organs.salivary-gateway.test.mjs`](../../../test/organs.salivary-gateway.test.mjs)
- 消费者：[`duodenum`](../duodenum/README.md) 与 [`brain`](../brain/README.md) 的 README
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片没有登记行）
