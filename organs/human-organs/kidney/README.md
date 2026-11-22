# 肾（kidney）：产尿请求

**功能标签：** 泌尿（水排泄）。

肾脏目前有一个正常脚本和两个可选的尿崩样（DI-like）变体入口：根据下丘脑 ADH 的相对水平计算下一轮产尿请求，或在 DI 样情景中固定请求。它们都不持有水、不调用 `transfer`，也不写体液或膀胱；真正的排尿转移由 `bodyFluid` 的所有者结算。

实现状态：正常脚本、参数与定向测试已在 `organs/human-organs/kidney/`，并已加入根清单（12 个部位）。DI 样变体只在独立清单/独立存档中显式加载，根清单与正常参数不含变体。单独加载正常脚本时不需要 `transfer` 配对，但没有 `hypothalamusAdh` 时请求会回落到基线。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `urine-production.ts`（正常） | `kidney` | `urineProductionRequestMl` | `hypothalamusAdh.relativeConcentration`；`io.dt` | `urine-production.parameters.json` |
| `urine-production-di-central.ts`（中枢 DI 样，可选） | `kidney` | 同上 | 同上 | `urine-production-di-central.parameters.json` |
| `urine-production-di-nephrogenic.ts`（肾性 DI 样，可选） | `kidney` | 同上 | 只读 `io.dt`；**不读** `hypothalamusAdh` | `urine-production-di-nephrogenic.parameters.json` |

方程在 `urine-production-core.ts`：正常入口与中枢变体共用 ADH 驱动公式；肾性变体用同一个核心的固定速率函数。变体与正常入口导出相同的 `id` / `fields` / `actionTypes`，同一清单只能出现一个肾脚本；替换是文件选择，不是运行中开关。参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。


## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `urineProductionRequestMl` | `mL` | **下一轮**的产尿请求量（状态，每轮重算）；不是瞬时 mL/min、GFR、尿流率或已排尿量 |

初值为 0，第一轮后才有基线请求。唯一的消费者是 `bodyFluid`；它把请求钳到轮初可用水量后转给膀胱。时间原点：请求在轮末写入，表示下一轮，不是过去一轮的排尿量或瞬时速率。

## 3. 方程与参数

设 `A = max(0, hypothalamusAdh.relativeConcentration)`，`dtMin = io.dt / 60`：

```text
relativeRate = clamp(1 − adhGain × (A − 1), minRelativeRate, maxRelativeRate)
urineProductionRequestMl = baselineRateMlPerMin × dtMin × relativeRate
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `kidney.urine.baselineRateMlPerMin` | 1 | `mL/min` | `design` | — |
| `kidney.urine.adhGain` | 1 | `1` | `design` | — |
| `kidney.urine.minRelativeRate` | 0.25 | `1` | `design` | — |
| `kidney.urine.maxRelativeRate` | 2 | `1` | `design` | — |

全部是工程假设。60 s 一轮时，ADH 相对水平 0.5 / 1 / 2 分别给出 1.5 / 1 / 0.25 mL 请求。缺失或非有限 ADH 输入按 1（基线）处理，避免未加载下丘脑时把缺失当成最大水利尿。

这个线性关系只固定“ADH 相对水平高则尿请求低”的方向；它不是 Ota 或 Andersen 的拟合方程，也没有使用原文的 AVP 浓度、尿段总量或输注剂量。

## 3a. DI 样代理变体（可选，默认不加载）

三个变体用于独立清单/独立存档的演示，不是临床诊断，也不改默认身体：

| 情景 | ADH 入口 | 肾入口 | 方程与量级 |
| --- | --- | --- | --- |
| 中枢性 DI 样 | `brain/hypothalamus-adh-di-central.ts`（ADH 恒 0） | `urine-production-di-central.ts` | 同一 ADH 公式，`adhGain = 3` + `maxRelativeRate = 4`；A=0 时 4 mL/min（5.76 L/day），A=1 时 1 mL/min |
| 肾性 DI 样 | 正常 `brain/hypothalamus-adh.ts` | `urine-production-di-nephrogenic.ts` | 不读 ADH，每轮 `4 mL/min × dtMin` |

中枢情景必须同时换 ADH 与肾入口：只换 ADH 时正常肾在 A=0 只到 2 倍基线（2 mL/min ≈ 2.88 L/day），够不到综述的成人多尿 >3 L/day 量级。中枢肾变体的参数为 `baselineRateMlPerMin = 1`、`adhGain = 3`、`minRelativeRate = 0.25`、`maxRelativeRate = 4`，A=0 时为 4 倍基线；肾性变体只有一个参数 `urineRateMlPerMin = 4`。它们都在自己的参数文件里，全部 `design`、`source: null`；正常参数文件未改。

选择方式是复制 `body-modules.json` 并把对应脚本路径替换为变体，**同时使用独立 `statePath`**。`initialState` 只补缺失部位，不支持在同一份正常存档上来回切换清单，也没有热切换、预设目录或 `condition` 字段。变体导出相同的 `id` / `fields` / `actionTypes: []`，同一清单不能同时加载正常入口与变体。

4 mL/min（5.76 L/day）只借三篇综述的成人多尿 >3 L/day 量级；它不是任何一篇的实测均值、拟合值或诊断阈值。Mutter 的最大抗利尿约 0.5 mL/min（700–800 mL/day）只用于量级对照。完整设计见 [`docs/superpowers/specs/2026-11-22-di-insipidus-proxy-design.md`](../../../docs/superpowers/specs/2026-11-22-di-insipidus-proxy-design.md)。

## 4. 读写边界

- 每个入口在自己的清单里是 `kidney` 的唯一写者；正常脚本与中枢变体读 `hypothalamusAdh` 与 `io.dt`，肾性变体只读 `io.dt`。
- 不调用 `transfer`，不写 `bodyFluid`、`bladder` 或任何其他部位。
- 与 `bodyFluid` 有一轮偏移：本轮写出的请求下一轮才被 `bodyFluid` 读取。
- 不建 GFR、肾血流量、肾小管分段、重吸收分数、尿渗透压或自由水清除率。

## 5. 证据入口

- 正常脚本的方程、来源定位与边界在 `urine-production-core.ts` 头部；DI 变体的来源与边界在各自脚本头部。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 正常水链的逐篇笔记：[`references/notes/ota-1994.md`](references/notes/ota-1994.md)、[`references/notes/andersen-1990.md`](references/notes/andersen-1990.md)
- DI 样代理的综述笔记：[`references/notes/flynn-2025.md`](references/notes/flynn-2025.md)、[`references/notes/hui-2024.md`](references/notes/hui-2024.md)、[`references/notes/mutter-2021.md`](references/notes/mutter-2021.md)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.3；DI 样代理设计见上文链接

**证据边界：**

- **Ota 1994（`SRC-OTA-1994`）**是急性水负荷研究，**主队列为 5 名原发性甲状腺功能减退患者**（T4 治疗前与治疗 ≥7 个月后各做一次），另有 **5 名正常对照**。不能把主队列简称“健康 n=5”。只有正常对照与治疗后甲功正常状态显示水负荷后 AVP 下降、尿量增加且尿变稀；甲减组反应迟钝。它只支撑方向，不支撑本脚本的斜率、增益或时程；30 min 尿段总量不是瞬时尿流率，尿渗透压不是血浆渗透压。
- **Andersen 1990（`SRC-ANDERSEN-1990`）**是健康志愿者的 AVP 静脉输注研究（摘要未报告例数），只支撑“AVP 升高后肾反应可以延迟”的定性方向；输注剂量轴不是血 AVP 浓度，10 min 时间常数不是原文拟合。
- **Flynn 2025 / Hui 2024 / Mutter 2021** 都是无受试者的综述，只支撑中枢/肾性机制方向与成人多尿 >3 L/day 的量级；它们没有本模型的 ADH 相对水平、4 mL/min 或方程参数。三篇都标 `exploratory` / `results_seen`。
- 以上来源都不是 `validated`，也不构成独立验证。

## 6. 当前限制

- **不是 GFR 或清除率模型**：没有滤过、分泌、重吸收或肾小管分段。
- **不是尿浓缩模型**：不建尿渗透压、电解质或自由水清除率；`urineProductionRequestMl` 只是体积请求。
- **没有压力/容量反馈**：不建血容量、血压、RAAS、心房利钠肽或交感神经。
- **没有昼夜节律与个体化**：基线速率、增益与上下钳都是证据默认值，不是某具身体的最终值。
- **没有临床诊断或疾病状态字段**：不建甲减、慢性肾病、部分性 DI、渴感缺失或病因分类。DI 样代理只是独立清单/存档里的可选多尿演示，默认身体不加载；4 mL/min 是 `design` 代理，不是诊断或治疗依据。
