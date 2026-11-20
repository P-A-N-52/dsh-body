# 十二指肠（duodenum）

P0 的十二指肠只有一个脚本：把胃排出的能量流做成一阶滤波的“近期营养暴露”代理。

实现状态：脚本与参数已在 `organs/human-organs/duodenum/`；根清单 `body-modules.json` 的 `scripts` 仍为 `[]`，这些脚本尚未挂进真实身体，启用是后续的单独提交。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `nutrient-exposure.ts` | `duodenum` | `nutrientExposure` | 自己的轮初状态 `duodenum`；`stomach.emptiedKcal` | `nutrient-exposure.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `nutrientExposure` | `kcal/min` | 近期营养到达速率的滤波代理；不是吸收入血速率，不是肠内容量，也不是浓度 |

`fields` 声明为 `absolute` 写入，只有 `duodenum` 脚本写它。

滤波逻辑：

- 本轮的到达速率 `arrivalRate = stomach.emptiedKcal / dtMin`，单位 `kcal/min`；
- `nutrientExposure` 以时间常数 `duodenum.exposure.timeConstantMin` 一阶跟随：`next = exposure + (1 − e^(−dtMin/τ)) × (arrivalRate − exposure)`，结果截到非负；
- 读的是轮初快照里的 `stomach.emptiedKcal`，即胃上一轮结算后的排出量，所以胃→十二指肠在时间上有**一轮偏移**；`stomach` 缺失或 `emptiedKcal` 非有限时按 0 流入处理。

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `duodenum.exposure.timeConstantMin` | 10 | `min` | `design` | — |

## 3. 调节方式

P0 只接胃流出能量这一条输入，自身状态只做一阶滤波。以下调节方式**尚未接入**，不能按当前脚本行为推断它们已建模：

- CCK、GLP-1、促胰液素等肠激素反馈；
- 胆囊收缩、胰酶与胆汁分泌；
- 肠道渗透压、肠内容量与吸收；
- 肠神经系统与迷走反馈。

## 4. 证据入口

- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 字段字典与证据卡模板：[`../references/m1-data-dictionary.md`](../references/m1-data-dictionary.md)
- 逐篇笔记：[`../stomach/references/notes/`](../stomach/references/notes/)：P0 没有十二指肠专属来源，现有证据是胃排空、饥饿素与饱感/胃饱满的笔记。
- 器官设计：[`docs/superpowers/specs/2026-11-20-organ-model-design.md`](../../../docs/superpowers/specs/2026-11-20-organ-model-design.md)

## 5. 当前限制

- **不建肠内容量/吸收模型**：P0 没有 `contentMl`、没有吸收或血糖，也没有与肠内容量或吸收相关的部位状态。
- **不用 `transfer`**：胃→肠只通过 `stomach.emptiedKcal` 的读出与一轮偏移传递；器官间转移留给 P1 有肠内容量时再引入。
- **`nutrientExposure` 是代理**：单位 `kcal/min` 只表示滤波后的到达速率，不等于吸收速率、门静脉葡萄糖或激素分泌；时间常数是 `design`，来自工程可运行性，不是人体测量。
- **没有专属来源**：`source-index.csv` 里没有十二指肠特异的登记行，当前模型参数不能声称有该器官的直接证据。
- 不建黏膜、刷状缘酶、转运体、渗透压与肠腔 pH。
