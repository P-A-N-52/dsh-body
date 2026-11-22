# 小肠（smallIntestine）：水吸收

**功能标签：** 消化（小肠水吸收）。

小肠目前只有一个脚本：把轮初肠腔里的水按一阶指数吸收，转入体液隔室。它不处理营养吸收、肠激素或肠内容物的其他成分。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/small-intestine/`，并已加入根清单（12 个部位）。单独把它加进自定义清单时，必须同时加载 `stomach` 水链入口、`bodyFluid` 与 `bladder`，否则 `transfer` 字段配对校验会拒绝启动。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water-absorption.ts` | `smallIntestine` | `waterVolumeMl`、`absorbedWaterMl` | 自己的轮初状态 `smallIntestine` | `water-absorption.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 轮初肠腔水量（状态）；`transferIn` 来自 `stomach.waterVolumeMl`，`transferOut` 到 `bodyFluid.waterVolumeMl` |
| `absorbedWaterMl` | `mL` | 本轮吸收量（每轮通量，不是累计）；只作读数与验收 |

`waterVolumeMl` 是工程“肠腔水”池，不是肠内容物总量，也不分十二指肠、空肠、回肠。`absorbedWaterMl` 不是门静脉水通量、血浆容量变化或吸收分数。

时间原点：`waterVolumeMl` 是轮末状态，初值 0，从身体仿真起点累计；`absorbedWaterMl` 只表示本轮，原点为该轮开始。

## 3. 方程与参数

设轮初肠水 `W_start`，`dtMin = io.dt / 60`：

```text
A = W_start × (1 − 2^(−dtMin / halfTimeMin))
write.waterVolumeMl = W_start
write.absorbedWaterMl = A
transfer smallIntestine → bodyFluid: A
```

`halfTimeMin = 20 min`（`design`，来源标 `SRC-PERONNET-2012`，范围 `[1, 120]`）。它不是论文报告值，也不是对 Péronnet 曲线的拟合。

只吸收轮初池：胃同轮转入的水在 Gateway 的 transfer 阶段才加入肠池，下一轮才参与吸收。因此本轮 `A` 不因同轮新流入而增大。旧存档没有 `waterVolumeMl` 时按 0 读取。

## 4. 读写边界

- 本脚本是 `smallIntestine` 的唯一写者，只读自己的轮初状态。
- 先 `write` 转出前基准，再请求 `transfer`；Gateway 按 write → add → transfer 结算，不会双扣。
- 不读胃的总 `volumeMl`、`emptiedMl` 或 `emptiedKcal`；胃→小肠的水量由 `stomach/hydration.ts` 的 `emptiedWaterMl` 决定。
- 不写 `bodyFluid`、`bladder` 或其他部位。

## 5. 证据入口

- 脚本头部的块注释列出 `SRC-PERONNET-2012` 的人群、刺激、采血时点与边界。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`references/notes/peronnet-2012.md`](references/notes/peronnet-2012.md)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.2

**证据边界：** Péronnet 2012 是 36 名健康年轻男性一次 300 mL D₂O 的口服标记水研究，0/5/10/15/20/30/60 min 采血；它只支撑“吸收可在 5 min 检出、完整过程跨数十分钟”的探索时间尺度。原文 75–120 min 是表观完全吸收时间，不是小肠半时；20 min 半时是 `design`，没有独立验证。

## 6. 当前限制

- **不区分肠段**：十二指肠、空肠、回肠共用一个池和一个半时。
- **不建转运机制**：没有转运体、刷状缘酶、渗透压、肠腔 pH、血流或神经调节。
- **不建营养吸收**：糖、脂肪、蛋白的吸收仍由 `duodenum/nutrient-exposure.ts` 的到达速率代理代表，不是真实吸收；本脚本只搬水。
- **不是实测通量**：`absorbedWaterMl` 不能当门静脉水通量、血浆容量或尿液来源的直接测量。
- **没有个体化**：半时是证据默认值，不是某具身体的最终值。
