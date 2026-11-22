# 肾（kidney）：产尿请求

**功能标签：** 泌尿（水排泄）。

肾脏目前只有一个脚本：根据下丘脑 ADH 的相对水平计算下一轮产尿请求。它不持有水、不调用 `transfer`，也不写体液或膀胱；真正的排尿转移由 `bodyFluid` 的所有者结算。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/kidney/`，并已加入根清单（12 个部位）。单独加载时不需要 `transfer` 配对，但没有 `hypothalamusAdh` 时请求会回落到基线。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `urine-production.ts` | `kidney` | `urineProductionRequestMl` | `hypothalamusAdh.relativeConcentration`；`io.dt` | `urine-production.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

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

## 4. 读写边界

- 本脚本是 `kidney` 的唯一写者，只读 `hypothalamusAdh` 与 `io.dt`。
- 不调用 `transfer`，不写 `bodyFluid`、`bladder` 或任何其他部位。
- 与 `bodyFluid` 有一轮偏移：本轮写出的请求下一轮才被 `bodyFluid` 读取。
- 不建 GFR、肾血流量、肾小管分段、重吸收分数、尿渗透压或自由水清除率。

## 5. 证据入口

- 脚本头部的块注释列出两条来源的定位与边界。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`references/notes/ota-1994.md`](references/notes/ota-1994.md)、[`references/notes/andersen-1990.md`](references/notes/andersen-1990.md)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.3

**证据边界：**

- **Ota 1994（`SRC-OTA-1994`）**是急性水负荷研究，**主队列为 5 名原发性甲状腺功能减退患者**（T4 治疗前与治疗 ≥7 个月后各做一次），另有 **5 名正常对照**。不能把主队列简称“健康 n=5”。只有正常对照与治疗后甲功正常状态显示水负荷后 AVP 下降、尿量增加且尿变稀；甲减组反应迟钝。它只支撑方向，不支撑本脚本的斜率、增益或时程；30 min 尿段总量不是瞬时尿流率，尿渗透压不是血浆渗透压。
- **Andersen 1990（`SRC-ANDERSEN-1990`）**是健康志愿者的 AVP 静脉输注研究（摘要未报告例数），只支撑“AVP 升高后肾反应可以延迟”的定性方向；输注剂量轴不是血 AVP 浓度，10 min 时间常数不是原文拟合。
- 两者都是 `results_seen` 的探索性背景，不是 `validated`，也不是独立验证。

## 6. 当前限制

- **不是 GFR 或清除率模型**：没有滤过、分泌、重吸收或肾小管分段。
- **不是尿浓缩模型**：不建尿渗透压、电解质或自由水清除率；`urineProductionRequestMl` 只是体积请求。
- **没有压力/容量反馈**：不建血容量、血压、RAAS、心房利钠肽或交感神经。
- **没有昼夜节律与个体化**：基线速率、增益与上下钳都是证据默认值，不是某具身体的最终值。
- **没有疾病**：不建甲减、尿崩症、慢性肾病等病况；Ota 的甲减臂只作证据边界，不是模型分支。
