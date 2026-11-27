# 十二指肠（duodenum）

十二指肠只有一个脚本：把胃排出的能量流做成一阶滤波的“近期营养暴露”代理。它不负责水吸收；水链的小肠吸收在 `small-intestine/water-absorption.ts`，两者不是同一个部位。`nutrientExposure` 还会被血氧隔室的 `bloodOxygen` 软读，作为餐后消化氧耗的输入；这只是同一代理的消费者，不表示十二指肠建模了吸收或产热。对含碳水餐，本脚本还软读 `salivaryGlands.salivaRateMlPerMin`，按 `duodenum.salivaryAmylaseGain` 给到达速率一个小幅增益，表示唾液淀粉酶从口腔开始的消化贡献；这不是酶动力学或吸收模型。

实现状态：脚本与参数已在 `organs/human-organs/duodenum/`；根清单已挂载这个脚本；身体启用时，启动 Gateway 即加载。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "duodenum.exposure.timeConstantMin": 12 } }
```

### nutrient-exposure.parameters.json

参数文件：[`nutrient-exposure.parameters.json`](nutrient-exposure.parameters.json)。入口及清单：[`nutrient-exposure.ts`](nutrient-exposure.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json)）。读取脚本：[`nutrient-exposure.ts`](nutrient-exposure.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `duodenum.exposure.timeConstantMin` | `10` | `min` | `design` | 无 | — |
| `duodenum.salivaryAmylaseGain` | `0.05` | `1` | `design` | 无 | — |
| `duodenum.referenceSalivaRateMlPerMin` | `0.5` | `mL/min` | `design` | 无 | — |

<!-- organ-parameters:end -->

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `nutrient-exposure.ts` | `duodenum` | `nutrientExposure` | 自己的轮初状态 `duodenum`；`stomach.emptiedKcal`、`stomach.emptiedCarbohydrateG`；`salivaryGlands.salivaRateMlPerMin`（可选软读） | `nutrient-exposure.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `nutrientExposure` | `kcal/min` | 近期营养到达速率的滤波代理；不是吸收入血速率，不是肠内容量，也不是浓度 |

`fields` 声明为 `absolute` 写入，只有 `duodenum` 脚本写它。当前消费者：`brain/interoception.ts` 把该字段用于饥饿/饱满的线性项，`blood-oxygen/oxygen.ts` 把它用于餐后消化氧耗；两者都只软读这个代理。本脚本自己的上游软读是 `salivaryGlands.salivaRateMlPerMin`（见下）。肠激素、吸收与通知消费者仍未实现。

滤波逻辑：

- 本轮到达速率 `arrivalRate = stomach.emptiedKcal / dtMin × amylaseFactor`，单位 `kcal/min`；`amylaseFactor` 只在轮初 `stomach.emptiedCarbohydrateG` 为有限正数时生效。
- `amylaseFactor = 1 + duodenum.salivaryAmylaseGain × salivaRateMlPerMin / duodenum.referenceSalivaRateMlPerMin`。归一化用的参考静息唾液产率由本目录参数 `duodenum.referenceSalivaRateMlPerMin`（默认值 `0.5 mL/min`）提供，不再跨器官读取唾液腺参数文件；`salivaryGlands` 未加载时按增益 0（`amylaseFactor = 1`）。已加载但 `salivaRateMlPerMin` 缺失、非数、非有限或为负时抛错，本轮不写状态；不含碳水的餐不读取该字段，因此不受损坏的唾液状态影响。
- `nutrientExposure` 以时间常数 `duodenum.exposure.timeConstantMin` 一阶跟随：`next = exposure + (1 − e^(−dtMin/τ)) × (arrivalRate − exposure)`，结果截到非负。增益乘在到达速率上，不乘在滤波状态上，避免逐轮复利。
- 读的是轮初快照里的 `stomach.emptiedKcal` 与 `stomach.emptiedCarbohydrateG`，即胃上一轮结算后的排出量，所以胃→十二指肠在时间上有**一轮偏移**；`stomach` 缺失、非有限或负数时按 0 流入处理。`salivaryGlands` 也读轮初快照，因此唾液刺激最早在下一轮改变增益，而含碳水餐的暴露还要再等胃排入后才上升。

`bloodOxygen` 的消化项为 `digestionGain × nutrientExposure × basalMlMin`（`digestionGain = 0.1`、`basalMlMin = 250 mL/min`，均 `design`）：`nutrientExposure = 0.5 kcal/min` 时约增加 12.5 mL/min 需氧。血氧读的是轮初快照，所以十二指肠本轮写出的新暴露最早下一轮才进入需氧；血氧不读胃排空或吸收，也不写回十二指肠。该系数不是食物热效应测量，也不把 kcal 换算成耗氧量。

这条链只处理能量，不处理水。胃水经 `hydration.ts` 的 `emptiedWaterMl` 直接转给 `smallIntestine`，不经过 `duodenum`；`stomach.emptiedMl` 也不当水量使用。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `duodenum.exposure.timeConstantMin` | 10 | `min` | `design` | — |
| `duodenum.salivaryAmylaseGain` | 0.05 | `1` | `design` | — |
| `duodenum.referenceSalivaRateMlPerMin` | 0.5 | `mL/min` | `design` | — |

`duodenum.salivaryAmylaseGain` 是相对增益：唾液产率等于参考基线 `duodenum.referenceSalivaRateMlPerMin`（`0.5 mL/min`）时含碳水餐的到达速率乘 1.05，等于 3 倍基线时乘 1.15。0.05、`0.5 mL/min`、线性缩放和“只看碳水”的判定都是 `design`，没有淀粉酶浓度、餐食成分或人体测量支撑。脚本仅从本目录 `nutrient-exposure.parameters.json` 读取上述三项参数，不再读取 `saliva.parameters.json`。

## 3. 调节方式

当前接胃流出能量与唾液产率两条输入：前者决定到达速率，后者只在含碳水餐时缩放到达速率；自身状态仍只做一阶滤波。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- 唾液淀粉酶浓度、活性、pH 与餐食成分；当前只按唾液产率比例缩放到达速率，不建酶动力学；
- CCK、GLP-1、促胰液素等肠激素反馈；
- 胆囊收缩、胰酶与胆汁分泌；
- 肠道渗透压、肠内容量与吸收；
- 食物热效应（TEF）、消化氧耗与能量代谢；`bloodOxygen` 只按固定 `design` 比例使用本字段，不表示吸收、产热或氧耗已被测量；
- 肠神经系统与迷走反馈。

## 4. 证据入口

- 脚本头部的块注释逐条列出来源、原文定位、支撑的方程/参数与不能推出的边界；本节只做入口摘要。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 字段字典与证据卡模板：[`../references/m1-data-dictionary.md`](../references/m1-data-dictionary.md)
- 逐篇笔记：[`../stomach/references/notes/`](../stomach/references/notes/)：没有十二指肠专属来源，现有证据是胃排空、饥饿素与饱感/胃饱满的笔记。
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)

## 5. 当前限制

- **十二指肠不建肠内容量/吸收模型**：本部位没有 `contentMl`、没有营养吸收或血糖，也没有与肠内容量或吸收相关的状态；水吸收与肠腔水量在小肠脚本里，不在这里。
- **十二指肠自身仍未用 `transfer`**：它的输入仍是 `stomach.emptiedKcal` 的读出与一轮偏移；胃→小肠的水转移由 `stomach/hydration.ts` 负责，与本脚本无关。
- **`nutrientExposure` 是代理**：单位 `kcal/min` 只表示滤波后的到达速率，不等于吸收速率、门静脉葡萄糖或激素分泌；时间常数是 `design`，来自工程可运行性，不是人体测量。
- **唾液淀粉酶增益不是酶模型**：`amylaseFactor` 只按 `salivaRateMlPerMin` 与基线之比线性缩放含碳水餐的到达速率，不建淀粉酶浓度、活性、pH、食物结构或口腔消化时长；`duodenum.salivaryAmylaseGain = 0.05` 是 `design`、`source: null`，没有直接人体证据或独立验证。
- **消化氧耗不是产热模型**：`nutrientExposure` 只按固定 `design` 比例进入 `bloodOxygen` 的需氧；不建食物热效应、氧耗—能量换算、餐后体温或代谢率，也不能把血氧缺口当作吸收不良或胃肠疾病。
- **没有专属来源**：`source-index.csv` 里没有十二指肠特异的登记行，当前模型参数不能声称有该器官的直接证据。
- 不建黏膜、刷状缘酶、转运体、渗透压与肠腔 pH。
