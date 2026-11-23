# 肾（kidney）：产尿请求与肾糖排泄

**功能标签：** 泌尿（水排泄、肾糖质量排泄代理）。

肾脏目录包含两个相互独立的部位：`kidney` 只写产尿请求，`kidneyGlucose` 只持有肾糖请求与实际质量通量。`kidney` 目前有一个正常脚本和两个可选的尿崩样（DI-like）变体入口：根据下丘脑 ADH 的相对水平计算下一轮产尿请求，或在 DI 样情景中固定请求。它们都不持有水、不调用 `transfer`，也不写体液或膀胱；真正的排尿转移由 `bodyFluid` 的所有者结算。`kidneyGlucose` 不产生尿水，也不改变 `kidney`、`bodyFluid` 或 `bladder`；它的质量由 `glucose` 结算，见 §6。

实现状态：正常脚本、参数与定向测试已在 `organs/human-organs/kidney/`，并已加入根清单（当前 19 个部位、21 份参数文件，含 3 份 DI 变体）。DI 样变体只在独立清单/独立存档中显式加载，根清单与正常参数不含变体。单独加载正常脚本时不需要 `transfer` 配对，但没有 `hypothalamusAdh` 时请求会回落到基线。M19 真实 DSH 会话已补验正常与两组 DI 清单（2026-11-22，33/33 verdicts）：sim 300 正常请求 0.9998 mL、中枢 ADH 0 请求 4 mL、肾性 ADH 1.0022 但请求固定 4 mL，通知 0；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`（仓库外未入库）。M19 只覆盖 2–5 轮短会话；4 mL/min 仍是 `design` 代理，不是诊断或治疗依据。肾糖排泄是独立部位，契约见 §6；`glucose-excretion.ts`、参数、模块契约测试和根清单注册均已落地，`glucose` 侧的请求—结算已接入。尚未做真实 DSH 会话或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `urine-production.ts`（正常） | `kidney` | `urineProductionRequestMl` | `hypothalamusAdh.relativeConcentration`；`io.dt` | `urine-production.parameters.json` |
| `urine-production-di-central.ts`（中枢 DI 样，可选） | `kidney` | 同上 | 同上 | `urine-production-di-central.parameters.json` |
| `urine-production-di-nephrogenic.ts`（肾性 DI 样，可选） | `kidney` | 同上 | 只读 `io.dt`；**不读** `hypothalamusAdh` | `urine-production-di-nephrogenic.parameters.json` |
| `glucose-excretion.ts`（独立部位） | `kidneyGlucose` | `excretionRequestG`、`excretedGlucoseG` | 轮初 `glucose.concentrationMgDl`；`io.dt` | `glucose-excretion.parameters.json` |

方程在 `urine-production-core.ts`：正常入口与中枢变体共用 ADH 驱动公式；肾性变体用同一个核心的固定速率函数。变体与正常入口导出相同的 `id` / `fields` / `actionTypes`，同一清单只能出现一个 `kidney` 水入口脚本；替换是文件选择，不是运行中开关。参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

`glucose-excretion.ts` 是独立部位，不是 `kidney` 水入口的又一个变体，也不与三个水入口争同一个 `id`；正常水入口与它可以同时加载。肾糖链的字段、方程、时序和清单约束见 §6。


## 2. 字段与单位

本表只列 `kidney` 产尿请求字段；`kidneyGlucose` 的两个 g 字段见 §6.1。

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

以下边界只针对 `kidney` 水请求；`kidneyGlucose` 的字段、transfer 与时序见 §6。

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
- 肾糖的证据、单位换算与验证边界见 §6.8；同一 `SRC-DALLAMAN-2007` 笔记的肾糖内容不改变上述水链来源的适用范围。

**证据边界：**

- **Ota 1994（`SRC-OTA-1994`）**是急性水负荷研究，**主队列为 5 名原发性甲状腺功能减退患者**（T4 治疗前与治疗 ≥7 个月后各做一次），另有 **5 名正常对照**。不能把主队列简称“健康 n=5”。只有正常对照与治疗后甲功正常状态显示水负荷后 AVP 下降、尿量增加且尿变稀；甲减组反应迟钝。它只支撑方向，不支撑本脚本的斜率、增益或时程；30 min 尿段总量不是瞬时尿流率，尿渗透压不是血浆渗透压。
- **Andersen 1990（`SRC-ANDERSEN-1990`）**是健康志愿者的 AVP 静脉输注研究（摘要未报告例数），只支撑“AVP 升高后肾反应可以延迟”的定性方向；输注剂量轴不是血 AVP 浓度，10 min 时间常数不是原文拟合。
- **Flynn 2025 / Hui 2024 / Mutter 2021** 都是无受试者的综述，只支撑中枢/肾性机制方向与成人多尿 >3 L/day 的量级；它们没有本模型的 ADH 相对水平、4 mL/min 或方程参数。三篇都标 `exploratory` / `results_seen`。
- 以上来源都不是 `validated`，也不构成独立验证。

## 6. 肾糖排泄（`kidneyGlucose`，独立部位）

`kidneyGlucose` 是肾目录下独立的糖排泄状态与唯一写者，不复用 `kidney` 的字段，也不参与水账。整条链只传葡萄糖质量（g）：

```text
glucose.concentrationMgDl
  → kidneyGlucose.excretionRequestG
  → glucose 按轮初请求转出质量
  → kidneyGlucose.excretedGlucoseG
```

**实现与验证状态：** 脚本与参数见 [`glucose-excretion.ts`](glucose-excretion.ts) 和 [`glucose-excretion.parameters.json`](glucose-excretion.parameters.json)，模块契约测试见 [`test/organs.kidney-glucose.test.mjs`](../../../test/organs.kidney-glucose.test.mjs)；根清单已注册 `glucose-excretion.ts`，`glucose` 侧的请求—结算已接入。尚未做真实 DSH 会话、独立肾糖数据、尿量或临床验证。

### 6.1 脚本、部位与字段

| 项 | 契约 |
| --- | --- |
| 部位 ID | `kidneyGlucose` |
| 脚本 | [`glucose-excretion.ts`](glucose-excretion.ts) |
| 参数 | [`glucose-excretion.parameters.json`](glucose-excretion.parameters.json) |
| 动作 / 通知 | 均无 |

两个字段都是 `absolute`：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `excretionRequestG` | `g` | 按本轮轮初浓度和 `io.dt` 计算的**下一轮**请求；不是已排泄量，不进入质量账 |
| `excretedGlucoseG` | `g` | 本轮实际接收的葡萄糖通量；每轮 write 先归 0，只有 transfer 才加入；初值 0 |

transfer 配对：

```text
glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG  (g)
```

`kidneyGlucose.excretedGlucoseG` 声明 `transferIn: ["glucose.glucoseMassG"]`，`glucose.glucoseMassG` 声明对应的 `transferOut`。这个配对是硬依赖：完整清单不能只加载 `glucose` 而预留一个未加载的 `kidneyGlucose` 槽位。`glucose.glucoseMassG` 还向 `muscleGlucose.uptakeG` 转出请求份额 `U`；Gateway 按目标名排序（`gateway/operations.js:206`），肾糖先结算，肌肉按肾糖后余额封顶 `U_paid`，所以本节下面的请求—结算语义不变。

### 6.2 方程与参数

设 `C = glucose.concentrationMgDl` 的轮初读数，`dtMin = io.dt / 60`：

```text
Gp = C × 1.88                              // mg/kg
E  = max(0, Gp − 339) × 0.0005            // mg/kg/min
requestG = E × 75 × dtMin / 1000           // g/下一轮
write.excretionRequestG = requestG
write.excretedGlucoseG = 0                 // 等待本轮实际 transfer
```

阈值对应浓度 `339 / 1.88 ≈ 180.32 mg/dL`，只是 mg/kg 与 mg/dL 的单位换算，不是临床诊断界值。低于或等于阈值时请求为 0；正常基础浓度 90 mg/dL 时请求和排泄都为 0。`C = 360 mg/dL` 时 `Gp = 676.8 mg/kg`，60 s 请求为 `(676.8 − 339) × 0.0005 × 75 / 1000 = 0.0126675 g`。`dtMin` 只来自 `io.dt`，不用 `io.simulatedSeconds` 或现实时间。

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `kidneyGlucose.filtrationRatePerMin` | 0.0005 | `min^-1` | `prior` | `SRC-DALLAMAN-2007` p.1743 Table I 正常组 `k_e1`；未来由个体肾糖滤过/重吸收模型替换 |
| `kidneyGlucose.renalThresholdMgKg` | 339 | `mg/kg` | `prior` | 同上，正常组 `k_e2`；未来由个体肾阈替换 |
| `kidneyGlucose.distributionVolumeDlPerKg` | 1.88 | `dL/kg` | `design` | 沿用同一可及池定义（见 Dalla Man 2007 笔记）；未来由共享身体预设替换 |
| `kidneyGlucose.referenceBodyMassKg` | 75 | `kg` | `design` | 未建个体体重；未来由身体预设替换 |

`filtrationRatePerMin` 和 `renalThresholdMgKg` 的 `prior` 只表示已发表平均模型锚点，不是人体测量、拟合或验证。`distributionVolumeDlPerKg` 与 `referenceBodyMassKg` 暂时与 `glucose` 的参数重复配置，测试固定两者相等；不跨模块 import 参数文件，也不把重复配置本身当作独立证据。

### 6.3 请求—结算与跨阈后时序

所有读写都基于轮初快照；请求不是排泄，实际质量只在 transfer 后出现：

1. **第 N 轮轮末：** `glucose` 根据本轮轮初质量写出浓度代理读数 `C`。它从第 N+1 轮起才对其他部位可见。
2. **第 N+1 轮：** `kidneyGlucose` 读到 `C`，按 `C` 和 `io.dt` 写出 `excretionRequestG = R`；本轮 `excretedGlucoseG` 仍为 0。
3. **第 N+2 轮：** `glucose` 从轮初快照读到 `R`，先算超基线处置总量 `D_total`（有胰腺时受 `insulinRelative` 缩放），拆成请求份额 `U = D_total × muscleDisposalShare` 与残余 `D = D_total − U`；再取 `M_after = max(0, M_start − D_total)`。它 write 转移前质量 `W = M_after + U`、`disposedGlucoseG = D`；Gateway 按目标名排序（`gateway/operations.js:206`），先取 `X = min(max(0, R), M_after)`（旧表达式，逐位不变）并 transfer 到 `kidneyGlucose.excretedGlucoseG`，再按余额 transfer `U_paid = min(U, W − X)` 到 `muscleGlucose.uptakeG`。正常 `U_paid = U`，提交后葡萄糖质量与旧轨迹一致到 ≤ 1 ulp（< `1e-12 g`），因为 `W = M_after + U` 可能跨二进制 binade；仅当测试注入的肾请求抽干池子（`X = M_after`）时 `U_paid` 少 1 ulp（< `1e-18 g`），提交质量比旧轨迹多 1 ulp、`disposedGlucoseG + U_paid` 比 `D_total` 少 1 ulp，质量守恒仍精确。`kidneyGlucose` 本轮 write 仍先把 `excretedGlucoseG` 归 0，transfer 后才为 `X`。

因此，在上述时序中，请求为正且结算轮有可用质量时，从浓度 `C` 提交到首次实际排泄相隔两轮；从请求 `R` 提交到执行只隔一轮。一次自然餐的首次吸收默认发生在第 3 轮，但跨阈轮次由实际轨迹决定，不固定为第 5/6 轮，不能按固定轮次断言肾糖。

实际 transfer 不超过本轮处置后可用质量；请求本身可以更大，结算时被钳到 `M_after`，不会扣成负质量。同轮小肠或其他来源的新流入在 write 后加入，不能支付本轮排泄。结算轮不重新按浓度判断请求，只按 `R` 和可用质量执行。上限是处置后的全部可用质量，不是只排超基线部分；若因此降到基础质量 `B` 以下，下一轮不虚构补糖。请求本身不进入质量账；只有实际 transfer 的那一克数才从 `glucose.glucoseMassG` 转出并记入 `excretedGlucoseG`，不会把同一质量既算进 `disposedGlucoseG` 又算进肾糖。若某轮轮初同时存在高浓度和胰腺信号，葡萄糖在同一轮里先按胰岛素缩放处置总量、再先执行肾 transfer、后执行肌摄糖 transfer（Gateway 按目标名排序）；各项分列，互不替代。

### 6.4 九部位闭包与清单

`glucose.glucoseMassG` 同时接收 `smallIntestine.carbohydrateG`，并向 `kidneyGlucose.excretedGlucoseG` 与 `muscleGlucose.uptakeG` 转出；所以加入 `skin` 的汗液出口与 `lungs` 的运动相关呼吸失水出口后，包含 `glucose` 的完整水/碳水 transfer 闭包为九部位：

```text
stomach/hydration.ts
  → smallIntestine
      → bodyFluid → bladder
                  → lungs
                  → skin
      → glucose → kidneyGlucose
                → muscleGlucose
```

transfer 图按 Gateway 的目标名排序列出；Gateway 实际也按目标名排序结算（`gateway/operations.js:206`），肾糖先于肌肉。

即 `hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`muscleGlucose`、`skin`、`lungs` 必须同在清单中。`bodyFluid.waterVolumeMl` 按肾→肺→汗的顺序向 `bladder.volumeMl`、[`lungs`](../lungs/README.md) 的 `respiratoryWaterLossMl` 与 [`skin`](../skin/README.md) 的 `sweatVolumeMl` 分配轮初水：肾尿请求先支付，肺请求其次，汗液只取扣除肾尿与肺失水后的轮初余量；肾糖请求不参与这一水出口排序。缺任一部位，`createFieldRegistry` 会在启动时报 transfer 配对错误；不能用未加载的槽位、运行中兜底或“先欠着”的请求替代。反过来，加载 `kidneyGlucose` 也必须加载 `glucose`；加载 `glucose` 必须同时加载 `kidneyGlucose` 与 `muscleGlucose`。

`kidney` 水请求不在这个 transfer 配对内；[`physicalActivity`](../skeletal-muscle/README.md) 只是 `skin`、`lungs` 与 `muscleGlucose` 的普通轮初读取，也不在闭包内；`hypothalamusAdh`、`hypothalamusThirst`、`interoception` 仍是软读取，缺省由各脚本按自己的默认值处理。旧 `stomach/motility.ts` 不声明水/碳水 transfer，不能替代 `hydration.ts`，也不加载这条肾糖链。

根清单已同时注册胰腺、肾糖与肌摄糖，当前为 19 个部位。DI 变体复制根清单，自动包含新部位；原 ADH/水 golden 不变。

### 6.5 外源碳质量账

在既有外源碳水账上增加实际肾糖、肌摄糖与肌糖原分项。设 `B = 12.69 g` 为 `glucose` 的基础质量：

```text
累计摄入碳水
= stomach.carbohydrateG
+ Σ stomach.mealQueue.remainingCarbohydrateG
+ smallIntestine.carbohydrateG
+ (glucose.glucoseMassG − B)
+ 累计 disposedGlucoseG
+ 累计 kidneyGlucose.excretedGlucoseG
+ muscleGlucose.glycogenG
+ muscleGlucose.uptakeG
+ 累计 muscleGlucose.glycogenConsumedG
```

`excretionRequestG` 不累计；`excretedGlucoseG` 是每轮实际通量，由读取方逐轮求和。正常范围 `disposedGlucoseG + U_paid = D_total` 逐位成立，`U_paid` 是实际支付、正常等于请求 `U`；仅当测试注入的肾请求抽干池子时 `U_paid` 少 1 ulp（< `1e-18 g`），质量守恒仍精确。`disposedGlucoseG` 只表示非肌、非肾残余清除，不包含肾糖或肌摄糖；肾糖只计实际 transfer。`muscleGlucose.glycogenG` 是已入账糖原存量，`uptakeG` 是实际支付的 `U_paid`（正常等于请求 `U`），`glycogenConsumedG` 是每轮消耗通量、需累计；三者不能重复加总。`stomach.solidCarbohydrateG` 仍是胃总碳水的子集，不另加。容差为 `1e-6 g`。水账不含糖项，原 `1e-6 mL` 恒等式不变。

### 6.6 无尿水与不双计

- **不产生尿水：** 不计算尿量 mL，不写 `bodyFluid`、`bladder`、`hypothalamusAdh`、`hypothalamusThirst`、`interoception` 或任何排尿通知；不建尿糖浓度、尿渗透压、SGLT、肾小管转运、渗透性利尿或 GFR mL/min。
- **不改水请求：** `kidney.urineProductionRequestMl` 与 `kidneyGlucose` 没有读写关系；肾糖请求不是产尿请求，不能相加、互换或用来推断水利尿。
- **不双计：** 胰腺缩放的是超基线处置总量 `D_total`；其中请求份额 `U` 在肾糖结算后按余额封顶为 `U_paid` 转给 `muscleGlucose`，残余 `D` 写 `disposedGlucoseG`，肾糖只记实际 transfer。三项分列，不互相替代，也不把同一克数同时计入两个汇。
- **终端质量汇：** 肾糖转出后不再回到 `glucose` 或其他部位；当前没有尿液组成、再吸收或后续消费者。

### 6.7 旧档、缺失与错误

- **旧档：** 启动时只补 `excretionRequestG = 0`、`excretedGlucoseG = 0`；第一轮 `excretedGlucoseG` 为 0，不按历史轮数补算。若轮初已有高糖，第一轮只写新请求，下一轮才实际转移。已有 `glucose`、水、膀胱和 ADH 状态不被重置。
- **旧自定义清单：** 已包含 `glucose`（或完整水/碳水闭包）的旧清单升级到本切片时必须补上 `kidneyGlucose` 与 `muscleGlucose`，否则启动时报 transfer 配对错误；不能靠省略字段或运行中兜底绕过。
- **模块独立测试没有上游：** 未加载 `glucose` 时，`kidneyGlucose` 按 0 请求、0 实际通量处理；这是纯模块行为，不改变完整清单的硬配对要求。
- **完整清单缺部位：** 在包含水/碳水闭包的完整清单中，缺 `glucose`、`kidneyGlucose` 或 `muscleGlucose` 时启动失败，不用健康常量或 0 请求掩盖配对错误。
- **已加载但异常：** 上游已加载而浓度缺失、非有限或为负数时，本轮失败；合法 0 是有效读数，不是异常。请求侧同理：已加载 `kidneyGlucose` 但请求缺失、非有限或为负时，`glucose` 不让本轮通过，不用固定参考值替代。
- **请求不等于结算：** `excretionRequestG` 只表示意图；只有 transfer 成功结算后 `excretedGlucoseG` 才非 0。

### 6.8 证据与验证边界

- 来源为已登记的 `SRC-DALLAMAN-2007`（[笔记](../../human-compartments/glucose/references/notes/dalla-man-2007.md)、[登记簿](../references/source-index.csv)），不新增来源行。
- p.1742：正常基础状态肾糖排泄为 0。
- p.1745 §III.C.5 式 (27)：`E = k_e1 × (G_p − k_e2)`，仅在 `G_p > k_e2` 时成立；`E` 为 mg/kg/min，`G_p` 为 mg/kg。
- p.1743 Table I 正常组：`k_e1 = 0.0005 min^-1`、`k_e2 = 339 mg/kg`。正文把 `k_e1` 称为 glomerular filtration rate，但单位是 `min^-1`，不能写成 mL/min 的实测 GFR。
- 原文没有给这两个常数单独的精度、± 类型或个体间离散度；它们是平均模型锚点，不是本项目独立验证。T2D 的 `0.0007` / `269` 不用于本切片。
- `glucose.muscleDisposalShare = 0.75` 与 `muscleGlucose.glycogenUseRateGPerMin = 0.5` 不是肾糖证据；它们分别为 `glucose` 与 `muscleGlucose` 的 `design`、`source: null` 参数，见[骨骼肌 README](../skeletal-muscle/README.md)。
- 当前没有真实 DSH 会话、独立肾糖数据、尿量或临床验证；离线守恒与方向测试不等于个体预测或临床结论。

## 7. 当前限制

- **不是 GFR 或清除率模型**：没有滤过、分泌、重吸收或肾小管分段。
- **不是尿浓缩模型**：不建尿渗透压、电解质或自由水清除率；`urineProductionRequestMl` 只是体积请求。
- **没有压力/容量反馈**：不建血容量、血压、RAAS、心房利钠肽或交感神经。
- **没有昼夜节律与个体化**：基线速率、增益与上下钳都是证据默认值，不是某具身体的最终值。
- **没有临床诊断或疾病状态字段**：不建甲减、慢性肾病、部分性 DI、渴感缺失或病因分类。DI 样代理只是独立清单/存档里的可选多尿演示，默认身体不加载；4 mL/min 是 `design` 代理，不是诊断或治疗依据。
- **肾糖不是尿糖或渗透性利尿模型**：`kidneyGlucose` 只记 g 质量汇，不产生尿量、尿糖浓度或尿渗透压；`kidney` 水请求与它互不影响，不能把肾糖换算成额外尿水。
