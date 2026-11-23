# 葡萄糖隔室（glucose）：可及池质量、浓度代理与肌摄糖份额

**功能标签：** 葡萄糖表观分布隔室（不是解剖器官）。

`glucose` 接收小肠吸收的可消化葡萄糖当量碳水，维护一个“血浆 + 快速平衡组织”的可及池质量，并把轮初质量换算为血浆葡萄糖浓度代理。超基线处置总量的一部分按固定份额经 transfer 交给骨骼肌部位 `muscleGlucose`，其余写残余 `disposedGlucoseG`。它位于 `organs/human-compartments/glucose/`，不是独立解剖器官，也不是完整糖代谢或胰岛素模型。

实现状态：脚本、参数、证据笔记、单元测试和真实根清单 Gateway 测试已落地，根清单当前为 19 个部位、21 份参数文件（含 3 份 DI 变体）。胰腺相对信号、肾糖请求与肌摄糖份额已接入葡萄糖处置和转移；`muscleGlucose` 的肌糖原入账与运动消耗见[骨骼肌 README](../../human-organs/skeletal-muscle/README.md)。尚未做真实 DSH 会话验收或独立生理数据验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `glucose.ts` | `glucose` | `glucoseMassG`、`concentrationMgDl`、`disposedGlucoseG` | 自己的轮初状态；轮初 `pancreasEndocrine.insulinRelative`（缺省 1）、`kidneyGlucose.excretionRequestG`（缺省 0） | `glucose.parameters.json` |

`glucoseMassG` 声明 `transferIn: ["smallIntestine.carbohydrateG"]` 与 `transferOut: ["kidneyGlucose.excretedGlucoseG", "muscleGlucose.uptakeG"]`；两个目标都必须声明。Gateway 应用 transfer 时按目标名排序（`gateway/operations.js:206`），`kidneyGlucose.excretedGlucoseG` 先于 `muscleGlucose.uptakeG` 结算，所以肾糖先扣、肌肉按余额封顶 `U_paid`，与脚本调用顺序无关。完整清单中加载 glucose 时必须同时加载小肠、`kidneyGlucose` 与 `muscleGlucose`；小肠的水与碳水 transfer 又要求胃水链入口、`bodyFluid`、`bladder`、[`skin`](../../human-organs/skin/README.md) 与 [`lungs`](../../human-organs/lungs/README.md) 都在清单中（`bodyFluid.waterVolumeMl` 按肾→肺→汗的顺序向膀胱、肺与皮肤三个出口分配轮初水），因此完整硬 transfer 闭包为九部位：`hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`muscleGlucose`、`skin`、`lungs`；不能只取本隔室单独运行。[`physicalActivity`](../../human-organs/skeletal-muscle/README.md) 只是 `muscleGlucose`、`skin` 与 `lungs` 的普通轮初读取，不在闭包内。`pancreasEndocrine` 是软读取：缺失时按 `I = 1` 使用固定清除。`muscleGlucose` 与 `glucose-uptake.ts` 的字段、参数和时序见[骨骼肌 README](../../human-organs/skeletal-muscle/README.md)；它只作为 `glucoseMassG` 的 transfer 目标，不读本隔室字段。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `glucoseMassG` | `g` | 轮末可及池总质量，含基础量；不是血浆内实际质量或直接测得的全身葡萄糖 |
| `concentrationMgDl` | `mg/dL` | 用**轮初**质量计算的血浆葡萄糖浓度代理读数 |
| `disposedGlucoseG` | `g` | 本轮**非肌、非肾**残余表观清除汇，每轮通量，不是累计量；不区分具体组织去向，不含肾糖排泄或肌摄糖 |

`kidneyGlucose.excretedGlucoseG` 由 transfer 单独记录实际肾糖排泄，不并入 `disposedGlucoseG`。`muscleGlucose` 的三个字段不属于本隔室：`uptakeG` 是 `glucoseMassG` 的 transfer 目标，接收实际支付的 `U_paid`（正常等于请求份额 `U`），下一轮入账；`glycogenG` 是肌糖原存量，`glycogenConsumedG` 是每轮运动消耗通量。`glucose` 不写、不读这些字段；质量账把它们与 `kidneyGlucose.excretedGlucoseG` 分列。当前消费者：`pancreasEndocrine` 与 `kidneyGlucose` 读取 `concentrationMgDl`；本隔室读取 `insulinRelative` 和 `excretionRequestG`；`muscleGlucose` 只作为 transfer 目标，不读浓度或胰岛素信号。体感或其他调节模块尚未读取血糖，不能声称这些反馈已经生效。

## 3. 固定边界与方程

| 参数 ID | 值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `glucose.referenceBodyMassKg` | 75 | `kg` | `design` | 未建个体体重；未来由身体预设/个体输入替换 |
| `glucose.distributionVolumeDlPerKg` | 1.88 | `dL/kg` | `design` | `SRC-DALLAMAN-2007`；未来由更完整分布模型替换 |
| `glucose.baselineConcentrationMgDl` | 90 | `mg/dL` | `design` | 工程基线；未来由个体基线替换 |
| `glucose.apparentDisposalHalfTimeMin` | 60 | `min` | `design` | `I = 1` 时的基线表观清除半时；未建胰岛素浓度、肝糖原与完整组织分区；未来由更完整的胰岛素—组织利用模型替换 |
| `glucose.muscleDisposalShare` | 0.75 | `1` | `design` | `source: null`；超基线处置总量 `D_total` 中改道到骨骼肌的固定份额，工程占位；`SRC-DALLAMAN-2007` §III.C.3 只支撑组织利用可分的结构方向，不支撑该数值，未来由完整组织分区模型替换 |

```text
V = 75 × 1.88 = 141 dL
B = 90 × 141 / 1000 = 12.69 g
M = max(0, glucoseMassG,start)
I = 轮初 pancreasEndocrine.insulinRelative（缺省 1）
R = 轮初 kidneyGlucose.excretionRequestG（缺省 0）
S = glucose.muscleDisposalShare（固定 0.75）
concentrationMgDl = M × 1000 / V
E = max(0, M − B)
D_total = E × (1 − 2^(−dtMin × I / 60))
U = D_total × S
D = D_total − U
M_after = M − D_total
W = M_after + U                （write 值 = M − D，转移前质量）
X = min(max(0, R), M_after)     （旧表达式，逐位不变）
U_paid = min(U, W − X)          （正常 = U；肾请求抽干池子时少 1 ulp）
write.glucoseMassG = W
write.concentrationMgDl = M × 1000 / V
write.disposedGlucoseG = D
transfer（Gateway 按目标名排序，肾先肌后）：
  glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG: X
  glucose.glucoseMassG → muscleGlucose.uptakeG: U_paid
```

`I = 1` 时 `D_total` 与旧的 60 min 表观清除逐位一致；`I > 1` 加快、`0 ≤ I < 1` 减慢、`I = 0` 停止超基线处置。`D_total` 始终不超过 `E`，不会把质量压到基线以下；正常范围 `disposedGlucoseG + U_paid = D_total` 逐位成立，`U_paid` 是实际支付、`U` 是请求份额，二者相等；`U` 是同一处置总量的固定份额，不是额外 sink。`share = 0.75` 时 `U = 0.75 × D_total`、`D = 0.25 × D_total`，提交后的 `glucoseMassG` 与旧轨迹一致到 ≤ 1 ulp（< `1e-12 g`），因为 `W = M_after + U` 可能跨二进制 binade；`concentrationMgDl` 仍由轮初质量计算；肾糖 `X` 仍按旧表达式 `min(max(0, R), M_after)` 钳位、逐位不变，`disposedGlucoseG` 变为原值的 0.25 倍。Gateway 先应用 write，再把本轮 transfer 按目标名排序后逐笔应用（`gateway/operations.js:206`）：`kidneyGlucose.excretedGlucoseG` 先于 `muscleGlucose.uptakeG`，肾糖 `X = min(max(0, R), M_after)`，肌肉再按肾糖结算后的余额封顶 `U_paid = min(U, W − X)`。正常范围 `W − X = M_after + U − X > U`，全额支付；仅当测试注入的肾请求抽干池子（`X = M_after`）时，`W − X` 因浮点误差比 `U` 少 1 ulp，`U_paid` 少 1 ulp（< `1e-18 g`），提交质量比旧轨迹多 1 ulp、`disposedGlucoseG + U_paid` 比 `D_total` 少 1 ulp，但质量守恒仍精确成立；真实肾请求每轮远小于 `M_after`（约需 23 万 mg/dL 才抽干），不会触发。同轮小肠新流入在 write 后加入，不能支付本轮任一出口。`disposedGlucoseG` 只记非肌、非肾残余，肾糖实际转移另记在 `kidneyGlucose.excretedGlucoseG`，肌摄糖实际支付另记在 `muscleGlucose.uptakeG`，三者不双计。

份额拆分是 `design` 工程假设：它只把同一胰岛素缩放的处置总量分成固定两份，不表示肌肉利用是胰岛素非依赖项，也不表示 `disposedGlucoseG` 是某个具体组织。Dalla Man 2007 §III.C.3 只支撑“组织利用可分为不同部分”的结构方向；0.75 不是原文值或拟合结果。

初始状态为 `12.69 g / 90 mg/dL / 0 g`。清除只作用于高于基础质量的部分；低于基线时保持原质量，不虚构肝糖原补充。因此基线是初始量与清除下限，不是主动维持的稳态。

小肠 transfer 在 write 后加入，所以接收新吸收的当轮仍显示旧浓度，下一轮才反映新质量。一次摄入在默认逐轮链中表现为：第 1 轮入胃，第 2 轮胃排入小肠，第 3 轮首次吸收，第 4 轮首次看到浓度上升。

胰腺在第 4 轮仍读到旧 90 mg/dL、写 1；第 5 轮读到高浓度、写 `I > 1`，但葡萄糖本轮仍使用轮初 `I = 1`；第 6 轮葡萄糖第一次使用高信号加快处置。肾糖不固定轮次：某轮提交的浓度高于阈值后，下一轮 `kidneyGlucose` 写请求，再下一轮葡萄糖才实际转移；自然餐的跨阈时刻由轨迹决定。

`muscleGlucose` 的时序：第 N 轮 `glucose` 转出 `U(N)`；第 N+1 轮 `muscleGlucose` 把 `U(N)` 入账 `glycogenG` 并写 `uptakeG = 0`，随后 `U(N+1)` 到账。`exercise` 第 1 轮进入 `physicalActivity`，第 2 轮肌肉开始消耗糖原；糖原不足时消耗钳到可用量，`glycogenG` 不为负。

### 缺失、异常与旧档

必须区分“上游按设计未接入”和“已接入但异常”：

- **自定义清单没有 `pancreasEndocrine`：** 本隔室按 `I = 1` 使用基线清除。
- **直接调用模块、没有 `kidneyGlucose` / `muscleGlucose`：** 纯模块测试可自行提供 transfer 目标或记录调用；任何包含 glucose 的 Gateway 清单都必须同时加载两者，缺部位在启动时报错，不存在“跳过未加载目标继续运行”的 Gateway 行为。
- **已加载但异常：** `insulinRelative` 或 `excretionRequestG` 缺失、非数值、非有限或为负数时抛错，让本轮失败，不用健康常量掩盖。合法 0 是有效信号或请求，不是缺失。
- **自身 `glucoseMassG`：** 保留碳水薄切片的旧行为：缺失由 `initialState` 补默认值，负值或非有限的历史自身质量按 0 读取；这是唯一钳位例外，不适用于新接入的胰腺/肾糖上游字段。
- **旧档：** 启动时只补 `pancreasEndocrine.insulinRelative = 1`、`kidneyGlucose.excretionRequestG = 0` 与 `excretedGlucoseG = 0`，并为缺失的 `muscleGlucose` 补 `uptakeG = 0`、`glycogenG = 0`、`glycogenConsumedG = 0`；不反推历史信号、排泄或肌摄糖，也不重置已有葡萄糖和水状态。`muscleDisposalShare` 只影响加载后的轮次；第一轮仍用 `I = 1`，即使轮初已有高糖，也只写新请求，下一轮才实际转移。
- **重启：** 保留已提交的胰岛素信号、肾糖请求/实际通量与在途 `muscleGlucose.uptakeG`；下一轮只入账一次，不从当前血糖或历史反推。

## 4. 外源碳水质量账

从默认基础质量 `B` 和不变参数开始时：

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

`stomach.solidCarbohydrateG` 是胃总碳水子集，不另加；各轮排空/吸收通量也不重复加。`disposedGlucoseG` 只累计非肌、非肾残余清除；`kidneyGlucose.excretionRequestG` 不进入质量账，只有实际 `excretedGlucoseG` 才累计。`muscleGlucose.glycogenG` 是已入账糖原存量，`uptakeG` 是实际支付的 `U_paid`（正常等于请求份额 `U`），`glycogenConsumedG` 是每轮消耗通量、需累计；三者不能重复加总。真实 Gateway 测试按 `1e-6 g` 容差逐轮核对单次、多轮固体餐与吸收后重启；肌摄糖与运动消耗纳入同一账本验收。该恒等式是模型外源碳水的工程账，不是完整人体碳平衡。

## 5. 证据入口

- [`SRC-DALLAMAN-2007` 笔记](references/notes/dalla-man-2007.md)
- [共享来源登记簿](../../human-organs/references/source-index.csv)
- [碳水—血糖薄切片设计](../../../docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)
- [胰腺相对信号 README](../../human-organs/pancreas/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md)
- [肾糖排泄 README](../../human-organs/kidney/README.md) §6 与[设计](../../../docs/superpowers/specs/2026-11-23-renal-glucose-design.md)
- [骨骼肌摄糖设计](../../../docs/superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md) 与[骨骼肌 README](../../human-organs/skeletal-muscle/README.md)

Dalla Man 2007 的 p.1741 §III.A / 式 (1) 定义可及池和 `V_G`，p.1743 Table I 给出正常组平均模型常数 `1.88 dL/kg`。它不是血浆体积、瘦体重归一化、总体水或 204 人直接实测均值；原文没有报告该常数单独的估计/固定方法、精度或个体间离散度。75 kg、90 mg/dL、60 min 清除和小肠 20 min 都不是该文报告值，本隔室的这些参数保持 `design`。

## 6. 未建模与未验证

- 不建胰岛素浓度、分泌率、C-peptide、两室动力学、胰高血糖素、肝糖输出/肝糖原、脂肪组织分区、肌糖原容量上限、静息糖原周转或慢速组织隔室；`pancreasEndocrine` 只提供无量纲相对信号，并整体缩放本隔室的超基线处置总量。M2 薄切片已含骨骼肌摄糖与肌糖原：固定份额 `U` 在肾糖结算后按余额封顶为 `U_paid`，再经 transfer 进入 `muscleGlucose.uptakeG`，下一轮入账 `glycogenG`，运动时按强度消耗；`glucose.muscleDisposalShare = 0.75` 与 `muscleGlucose.glycogenUseRateGPerMin = 0.5` 都是 `design`、`source: null`，不是 Dalla Man 或 Rizza 的拟合值，也不代表胰岛素依赖/非依赖分区已建。
- 不建乳酸/Cori 循环、运动类型、MET、能量消耗、肌糖原容量反馈或运动对胰岛素敏感度的调节。
- 不区分葡萄糖以外的可消化碳水来源，不建消化酶、纤维、脂肪或蛋白质。
- 肾糖只作为终端质量汇接入；不建尿糖浓度、尿量、尿渗透压、SGLT、渗透性利尿或 GFR mL/min，也不建饥饿、口渴、胰岛素抵抗或任何自动行为。
- 离线守恒、方向测试和真实根清单 Gateway 测试不等于临床验证、个体预测、正常餐后曲线复现或真实 DSH 实机验收。
