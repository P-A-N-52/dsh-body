# 葡萄糖隔室（glucose）：可及池质量、浓度代理与各部位自主摄糖结算

**功能标签：** 葡萄糖表观分布隔室（不是解剖器官）。

`glucose` 接收小肠吸收的可消化葡萄糖当量碳水，维护一个“血浆 + 快速平衡组织”的可及池质量，并把轮初质量换算为血浆葡萄糖浓度代理。它只做三件事：持有血池、计算自身残余清除、按“肾 → 肝 → 肌”的顺序结算各部位上一轮写出的摄糖请求。超基线部分 `excessMassG = max(0, glucoseMassG − baselineMassG)` 由本隔室每轮写出，供骨骼肌与肝各自按自己的参数（最大速率、半饱和量、胰岛素敏感度；肝另有容量）计算请求；实际到账量分别写入 `muscleGlucose.uptakeG` 与 `liver.storageG`。总清除量是各部位响应的涌现结果，不由单一清除半时决定。低于基线时，`liver` 可把肝糖原经 transfer 转回 `glucoseMassG`，由真实存量补回而非保持原质量。它位于 `organs/human-compartments/glucose/`，不是独立解剖器官，也不是完整糖代谢、胰岛素浓度或胰高血糖素模型。

实现状态：脚本、参数、证据笔记、单元测试和真实根清单 Gateway 测试已落地，根清单当前为 23 个部位、25 份参数文件（女性清单 25 个部位、27 份参数文件，含 3 份 DI 变体）。胰腺相对的胰岛素/胰高血糖素信号、肾糖请求、肌摄糖与肝糖原储存/释放已接入；`muscleGlucose` 的自主摄糖请求、肌糖原入账与运动消耗见[骨骼肌 README](../../human-organs/skeletal-muscle/README.md)，肝的自主储存请求、糖原存量与释放见[肝 README](../../human-organs/liver/README.md)。尚未做真实 DSH 会话验收或独立生理数据验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `glucose.ts` | `glucose` | `glucoseMassG`、`concentrationMgDl`、`disposedGlucoseG`、`excessMassG` | 自己的轮初状态；轮初 `kidneyGlucose.excretionRequestG`、`liver.storageRequestG`、`muscleGlucose.uptakeRequestG` | `glucose.parameters.json` |

`glucoseMassG` 声明 `transferIn: ["smallIntestine.carbohydrateG", "liver.glycogenG"]` 与 `transferOut: ["kidneyGlucose.excretedGlucoseG", "liver.storageG", "muscleGlucose.uptakeG"]`；三个出口目标与两个入口来源都必须声明。`liver.glycogenG → glucose.glucoseMassG` 的释放由 `liver` 发起，其余三笔由本隔室发起。Gateway 先应用 write，再把本轮 transfer 按 transfer 对键排序后逐笔应用（`gateway/operations.js:206`）；`glucose` 的三个出口等价于目标名顺序 `kidneyGlucose.excretedGlucoseG` → `liver.storageG` → `muscleGlucose.uptakeG`，与脚本调用顺序无关。

完整清单中加载 glucose 时必须同时加载小肠、`liver`、`kidneyGlucose` 与 `muscleGlucose`；小肠的水与碳水 transfer 又要求胃水链入口、`bodyFluid`、`bladder`、[`skin`](../../human-organs/skin/README.md) 与 [`lungs`](../../human-organs/lungs/README.md) 都在清单中（`bodyFluid.waterVolumeMl` 按肾→肺→汗的顺序向膀胱、肺与皮肤三个出口分配轮初水），因此完整硬 transfer 闭包为十部位：`hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGlucose`、`muscleGlucose`、`skin`、`lungs`；女性清单再加 `uterus`，为 11 部位。不能只取本隔室单独运行。[`physicalActivity`](../../human-organs/skeletal-muscle/README.md) 只是 `muscleGlucose`、`skin` 与 `lungs` 的普通轮初读取，不在闭包内。

本隔室只读三个请求字段，不读 `pancreasEndocrine`，也不读肝容量或存量：残余清除与胰岛素信号无关，肝容量钳位由 `liver` 自己完成。`pancreasEndocrine` 是 `liver` 与 `muscleGlucose` 的软读取：缺失时两部位按 `insulinRelative = 1` 计算请求；`glucagonRelative` 只由 `liver` 读取。`muscleGlucose` 与 `liver` 读轮初 `excessMassG` 和 `insulinRelative`，写出本轮请求，本隔室下一轮结算；已加载部位在旧档补齐后仍缺请求字段、非数值、非有限或为负时抛错，不用 0 或参考值掩盖。缺 `liver` 或 `muscleGlucose` 部位时启动报错（transfer 配对不完整），不做“无请求”回退。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `glucoseMassG` | `g` | 轮末可及池总质量，含基础量；不是血浆内实际质量或直接测得的全身葡萄糖 |
| `concentrationMgDl` | `mg/dL` | 用**轮初**质量计算的血浆葡萄糖浓度代理读数 |
| `disposedGlucoseG` | `g` | 本轮 `glucose` 自身残余清除（脑/红细胞等非器官组织的表观清除），按 `residualDisposalHalfTimeMin` 计算；不是累计量，不包含肾糖、肝储存或肌摄糖 |
| `excessMassG` | `g` | `max(0, 轮初 glucoseMassG − baselineMassG)`，供各摄糖部位计算请求的只读信号；不是质量通量，不进入质量账，只有本隔室写 |

`kidneyGlucose.excretedGlucoseG` 由 transfer 单独记录实际肾糖排泄，不并入 `disposedGlucoseG`。`muscleGlucose` 的四个字段不属于本隔室：`uptakeRequestG` 是本轮请求（不是实际通量），`uptakeG` 是 `glucoseMassG` 的 transfer 目标、接收实际支付的 `U_paid` 并在下一轮入账，`glycogenG` 是肌糖原存量，`glycogenConsumedG` 是每轮运动消耗通量。`liver` 的五个字段也不属于本隔室：`storageRequestG` 是本轮储存请求（不是实际通量），`storageG` 是 `glucoseMassG` 的 transfer 目标、接收实际支付的 `L_paid` 并在下一轮并入存量，`glycogenG` 是肝糖原存量，也是 `glucoseMassG.transferIn` 的来源，`glycogenCapacityG` 是容量字段（由 `liver` 自己用于钳制请求），`outputG` 是肝本轮实际释放记录、不进质量账。请求字段不进入质量账；只有实际到账的 `uptakeG`、`storageG` 与 `excretedGlucoseG` 才代表质量转移。

当前消费者：`pancreasEndocrine`、`kidneyGlucose` 与 `liver` 读取 `concentrationMgDl`；`liver` 与 `muscleGlucose` 读取 `excessMassG`；本隔室读取三个请求字段与肾糖请求，不写其他部位的字段。体感或其他调节模块尚未读取血糖，不能声称这些反馈已经生效。

## 3. 边界、参数与结算方程

| 参数 ID | 值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `glucose.referenceBodyMassKg` | 75 | `kg` | `design` | 未建个体体重；未来由身体预设/个体输入替换 |
| `glucose.distributionVolumeDlPerKg` | 1.88 | `dL/kg` | `design` | `SRC-DALLAMAN-2007`；未来由更完整分布模型替换 |
| `glucose.baselineConcentrationMgDl` | 90 | `mg/dL` | `design` | 工程基线；未来由个体基线替换 |
| `glucose.residualDisposalHalfTimeMin` | 60 | `min` | `design` | `source: null`；仅用于本隔室自身残余清除（脑/红细胞等，与胰岛素无关），不随 `insulinRelative` 缩放；不是组织利用总清除半时，未来由更完整的非器官组织清除模型替换 |

原 `glucose.apparentDisposalHalfTimeMin` 已更名为 `residualDisposalHalfTimeMin`，值仍为 60；语义从“全体表观清除”收窄为“本隔室自身残余清除”。本隔室没有摄糖速率参数；肌肉与肝的摄糖效率由各自参数文件里的 `maxUptakeRateGPerMin`、`halfMaxExcessG` 与 `insulinSensitivity` 决定（肝另有 `glycogenCapacityG`），`glucose` 只按它们的请求结算。

```text
V = 75 × 1.88 = 141 dL
B = 90 × 141 / 1000 = 12.69 g
M = max(0, 轮初 glucoseMassG)
E = max(0, M − B)                                        （写 excessMassG）
D = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))   （自身残余清除，不按 I 缩放）
M_after = M − D
R = 轮初 kidneyGlucose.excretionRequestG（旧档/未加载按 0）
X = min(max(0, R), M_after)                              （肾糖，旧表达式）
L_req = 轮初 liver.storageRequestG（旧档按 0）
L_paid = min(max(0, L_req), M_after − X)                 （肝摄糖）
U_req = 轮初 muscleGlucose.uptakeRequestG（旧档按 0）
U_paid = min(max(0, U_req), M_after − X − L_paid)        （肌摄糖）
W = M_after + L_paid + U_paid                            （write 值，转移前质量）
concentrationMgDl = M × 1000 / V
write { glucoseMassG: W, concentrationMgDl, disposedGlucoseG: D, excessMassG: E }
transfer（write 后逐笔结算）：
  glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG: X
  glucose.glucoseMassG → liver.storageG: L_paid
  glucose.glucoseMassG → muscleGlucose.uptakeG: U_paid
  liver.glycogenG → glucose.glucoseMassG: release（由 liver 发起）
```

结算顺序“肾 → 肝 → 肌”是 `policy`，与 Gateway 的 transfer 对键排序一致。每个请求都由对应部位在上一轮按轮初 `excessMassG`、`insulinRelative` 与自身参数计算：肌肉请求受最大速率、半饱和与敏感度约束，肝请求先按同一形式计算、再由 `liver` 自己钳到剩余容量。`glucose` 不重新计算组织请求，也不读取肝容量；余额不足时按上述顺序依次钳位，后结算者拿到较少或 0，不会产生负质量。

`D` 只表示本隔室自身残余清除，始终 `0 ≤ D ≤ E`；它不是组织摄糖总量，也不随 `insulinRelative` 变化。`X`、`L_paid`、`U_paid` 都是实际支付量，各自被轮初请求和可用余额钳制。write 的 `W` 覆盖三笔转出，正常时 `W = M_after + L_req + U_req`；余额不足或请求为 0 时相应变小。提交后的池质量（同轮肝释放之前）为 `W − X − L_paid − U_paid = M_after − X − L_paid − U_paid`。

质量账（不含同轮肝释放）：`M_start = M_final + X + (D + L_paid + U_paid)`，其中 `M_final` 是三笔出口结算后的池质量。若本轮 `liver` 发起释放，释放量从 `liver.glycogenG` 转入 `glucoseMassG`，池质量在 `M_final` 之上再加 `release`；这部分已由外源碳水质量账的肝糖原项体现，不在本隔室的“自身清除”里重复计算。外源碳水质量账各项（肌肉糖原、在途摄取、累计消耗、肝糖原差值、在途储存）保持不变，见 §4。

`excessMassG` 只由本隔室写出，其他部位只读不写；它按轮初质量每轮重算，不是累计量。旧档缺该字段时由轮初质量现算。`residualDisposalHalfTimeMin` 与基线质量共同决定残余清除下限：低于基线时 `E = 0`、`D = 0`，本隔室不产生超基线清除，是否回升取决于 `liver` 的真实释放。

轨迹是涌现的：总清除量由各组织请求与自身残余清除共同决定，**不再承诺与旧的中央分配模型逐位一致**。肝满时 `liver` 自己把 `storageRequestG` 钳到 0，未接收部分自然留在血糖池，血糖下降相应变慢；总清除量不再由单一总量给出。

## 4. 时序、异常与旧档

请求与到账分离是核心时序：

1. 第 N 轮：`glucose` 写出 `excessMassG = E_N`；`pancreasEndocrine` 按轮初浓度写出下一轮相对信号。
2. 第 N+1 轮：`muscleGlucose` 与 `liver` 读轮初 `excessMassG`、`insulinRelative`，各自写出本轮 `uptakeRequestG` / `storageRequestG`；本轮不转移质量。
3. 第 N+2 轮：`glucose` 读轮初请求，按“肾 → 肝 → 肌”结算，实际支付写入 `muscleGlucose.uptakeG` 与 `liver.storageG`；两部位再下一轮入账糖原。

因此一次自然餐的默认链仍是第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收、第 4 轮首次看到浓度上升；第 5 轮两部位写出首批摄糖请求，第 6 轮才首次实际到账。肾糖请求独立按浓度与 `io.dt` 计算，不经过 `excessMassG`。胰腺信号与组织请求各有一轮快照滞后，`glucose` 结算再隔一轮；不存在同轮“血糖升 → 胰岛素升 → 组织摄糖升”的代数环。

低血糖方向：`glucose` 写出低浓度后，`liver` 下一轮读到低浓度或升高的 `glucagonRelative`，当轮释放 `min(maxOutputRateGPerMin × H × dtMin, 存量)` 并自己发起 transfer；肌肉没有释放路径（无 G6Pase），不向血液放糖。释放轮的 `glucose` 仍按轮初质量算浓度，提交后 `glucoseMassG` 已回升，再下一轮浓度才上升。

必须区分“上游按设计未接入”和“已接入但异常”：

- **自定义清单没有 `pancreasEndocrine`：** 不影响本隔室；`liver` 与 `muscleGlucose` 按 `insulinRelative = 1` 计算请求，`liver` 按 `glucagonRelative = 1` 处理释放。
- **直接调用模块、没有 `liver` / `muscleGlucose` / `kidneyGlucose`：** 纯模块测试可自行注入请求或按 0 处理；任何包含 glucose 的 Gateway 清单都必须同时加载三者，缺部位在启动时报错。
- **已加载但异常：** 三个请求字段缺失、非数值、非有限或为负数时抛错，让本轮失败，不用 0 或健康常量掩盖；合法 0 是有效请求（例如肝满或低血糖），不是缺失。
- **自身 `glucoseMassG`：** 保留碳水薄切片的旧行为：缺失由 `initialState` 补默认值，负值或非有限的历史自身质量按 0 读取；这是唯一钳位例外，不适用于新接入的请求字段。
- **旧档：** `excessMassG` 每轮由轮初质量现算（不读旧值）；启动时补 `liver.storageRequestG = 0`、`muscleGlucose.uptakeRequestG = 0`；其余字段沿用既有初值（`glucoseMassG = 12.69`、`concentrationMgDl = 90`、`disposedGlucoseG = 0`、`liver.glycogenG = 80`、`liver.storageG = 0`、`liver.glycogenCapacityG = 100`、`muscleGlucose.uptakeG = 0`、`glycogenG = 0`、`glycogenConsumedG = 0`）。不反推历史请求、释放或激素。
- **重启：** 保留已提交的请求、在途 `uptakeG` / `storageG` 与各部位存量；下一轮只入账一次。请求字段每轮由各部位重写，不从当前血糖反推历史；`liver.glycogenCapacityG` 由 `liver` 每轮按参数重写为 100。

初始状态为 `glucoseMassG = 12.69 g / concentrationMgDl = 90 / disposedGlucoseG = 0 / excessMassG = 0`。

## 5. 外源碳水质量账

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
+ (liver.glycogenG − liver.initialGlycogenG)
+ liver.storageG
```

`stomach.solidCarbohydrateG` 是胃总碳水子集，不另加；各轮排空/吸收通量也不重复加。`disposedGlucoseG` 只累计本隔室自身残余清除；`kidneyGlucose.excretionRequestG`、`liver.storageRequestG` 与 `muscleGlucose.uptakeRequestG` 都不进入质量账，只有实际 `excretedGlucoseG`、`muscleGlucose.uptakeG`、`liver.storageG` 才累计。`muscleGlucose.glycogenG` 是已入账糖原存量，`uptakeG` 是实际支付的在途量，`glycogenConsumedG` 是每轮消耗通量、需累计；三者不能重复加总。`liver.glycogenG − 80` 是肝糖原相对初始禀赋的净变化，`liver.storageG` 是已从葡萄糖转出、尚未并入存量的在途量；`80` 即 `liver.initialGlycogenG`，与 `B` 一样是初始禀赋。`liver.outputG` 是肝→葡萄糖的内部转移记录，不进入质量账；释放已同时反映在 `glucoseMassG` 与 `liver.glycogenG` 两侧，再加一次会双计。真实 Gateway 测试按 `1e-6 g` 容差逐轮核对单次、多轮固体餐与吸收后重启；肌摄糖、运动消耗与肝糖原储存/释放纳入同一账本验收。该恒等式是模型外源碳水的工程账，不是完整人体碳平衡。

## 6. 证据入口

- [`SRC-DALLAMAN-2007` 笔记](references/notes/dalla-man-2007.md)
- [共享来源登记簿](../../human-organs/references/source-index.csv)
- [碳水—血糖薄切片设计](../../../docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)
- [各部位自主摄糖设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- [胰腺相对信号 README](../../human-organs/pancreas/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md)
- [肾糖排泄 README](../../human-organs/kidney/README.md) §6 与[设计](../../../docs/superpowers/specs/2026-11-23-renal-glucose-design.md)
- [骨骼肌摄糖 README](../../human-organs/skeletal-muscle/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- [肝糖原 README](../../human-organs/liver/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)

Dalla Man 2007 的 p.1741 §III.A / 式 (1) 定义可及池和 `V_G`，p.1743 Table I 给出正常组平均模型常数 `1.88 dL/kg`。它不是血浆体积、瘦体重归一化、总体水或 204 人直接实测均值；原文没有报告该常数单独的估计/固定方法、精度或个体间离散度。75 kg、90 mg/dL、60 min 残余清除、小肠 20 min、肌肉与肝的摄取参数、肝糖原 80 g、100 g 容量与 1 g/min 释放速率都不是该文报告值，本隔室的这些参数保持 `design`、`source: null`。肝糖原与胰高血糖素曲线另见[肝 README](../../human-organs/liver/README.md)与[胰腺 README](../../human-organs/pancreas/README.md)；两者都没有新增登记来源。

## 7. 未建模与未验证

- 不建胰岛素/胰高血糖素的绝对浓度、分泌率、C-peptide、两室动力学、受体或酶促糖原动力学、肝糖异生、脂肪组织、静息糖原周转或慢速组织隔室；`pancreasEndocrine` 只提供两个无量纲相对信号。脂肪组织按同一接口接入是后续项，当前不建模。
- 各部位自主摄糖：`muscleGlucose` 按最大速率、半饱和与胰岛素敏感度写请求，实际到账经 transfer 进入 `uptakeG`，下一轮入账 `glycogenG`，运动时消耗；`liver` 按同一形式写储存请求并自行钳到 `glycogenCapacityG` 剩余容量，低血糖/胰高血糖素升高时自行释放。总清除轨迹由这些响应与 `glucose` 自身残余清除共同涌现，不由单一清除半时决定。
- 不建脂肪组织、肾糖异生、乳酸/Cori 循环、运动类型、MET、能量消耗或运动对胰岛素敏感度的调节；肾糖只作为终端质量汇接入，不建尿糖浓度、尿量、尿渗透压、SGLT、渗透性利尿或 GFR mL/min。
- 不区分葡萄糖以外的可消化碳水来源，不建消化酶、纤维、脂肪或蛋白质。
- 离线守恒、方向测试和真实根清单 Gateway 测试不等于临床验证、个体预测、正常餐后曲线复现或真实 DSH 实机验收。所有新参数都是 `design`、`source: null`，不能称为拟合、已验证或个体预测。
- **后续项（计划，不是当前实现）：** 脂肪组织按同接口接入；肾糖异生（长期空腹约占内源葡萄糖 20–25%，低血糖时也能由肾释放）；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。
