# 葡萄糖隔室（glucose）：可及池质量、浓度代理与各部位自主摄糖结算

**功能标签：** 葡萄糖表观分布隔室（不是解剖器官）。

`glucose` 接收小肠吸收的可消化葡萄糖当量碳水，维护一个“血浆 + 快速平衡组织”的可及池质量，并把轮初质量换算为血浆葡萄糖浓度代理。它只做三件事：持有血池、计算自身残余清除、按入口给出的顺序结算各部位上一轮写出的摄糖请求。正常入口 `glucose.ts` 固定“肾 → 肝 → 肌”三汇；女性变体 `glucose.female.ts` 在末位追加 `mammaryGlands.lactoseG`（乳汁乳糖），只用于 `body-modules.female.json`。超基线部分 `excessMassG = max(0, glucoseMassG − baselineMassG)` 由本隔室每轮写出，供骨骼肌与肝各自按自己的参数（最大速率、半饱和量、胰岛素敏感度；肝另有容量）计算请求；实际到账量分别写入 `muscleGlucose.uptakeG` 与 `liver.storageG`。总清除量是各部位响应的涌现结果，不由单一清除半时决定。低于基线时，`liver` 可把肝糖原经 transfer 转回 `glucoseMassG`，由真实存量补回而非保持原质量；`kidneyGluconeogenesis` 也可按自身速率上限转入产糖，两者并行、各自独立受各自阈值驱动。它位于 `organs/human-compartments/glucose/`，不是独立解剖器官，也不是完整糖代谢、胰岛素浓度或胰高血糖素模型。

实现状态：`glucose-core.ts`、正常入口 `glucose.ts`、女性变体 `glucose.female.ts`、参数、证据笔记、单元测试和真实 Gateway 测试已落地。根清单当前为 43 个部位、39 份唯一参数文件，女性清单为 46 个部位、42 份参数文件，男性清单为 45 个部位、41 份参数文件。胰腺胰岛素绝对浓度、胰高血糖素相对信号、肾糖请求、肌摄糖、肝糖原储存/释放、肾糖异生产糖与女性乳糖汇已接入；`muscleGlucose` 的自主摄糖请求、按区域份额分配与三个区域的糖原入账/运动消耗见[骨骼肌 README](../../human-organs/skeletal-muscle/README.md)与[区域 README](../../human-organs/skeletal-muscle/regions/README.md)，肝的自主储存请求、糖原存量与释放见[肝 README](../../human-organs/liver/README.md)，乳腺请求见[乳腺 README](../../human-organs/mammary-glands/README.md)。尚未做真实 DSH 会话验收或独立生理数据验证。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "glucose.residualDisposalHalfTimeMin": 65 } }
```

### glucose.parameters.json

参数文件：[`glucose.parameters.json`](glucose.parameters.json)。入口及清单：[`glucose.ts`](glucose.ts)（[默认](../../../body-modules.json) / [男性](../../../body-modules.male.json)）；[`glucose.female.ts`](glucose.female.ts)（[女性](../../../body-modules.female.json)）。读取脚本：[`glucose-core.ts`](glucose-core.ts)。

普通与女性的入口使用同一 core 和同一份参数；女性清单追加乳糖结算，不独立覆盖葡萄糖参数。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `glucose.referenceBodyMassKg` | `75` | `kg` | `design` | `weightKg / 75` | — |
| `glucose.distributionVolumeDlPerKg` | `1.88` | `dL/kg` | `design` | 无 | 是每 kg 的系数；与模型参考质量相乘，形成分布容积。 |
| `glucose.baselineConcentrationMgDl` | `90` | `mg/dL` | `design` | 无 | — |
| `glucose.residualDisposalHalfTimeMin` | `60` | `min` | `design` | 无 | — |
| `glucose.basalConsumptionGPerMin` | `0.12` | `g/min` | `design` | `weightKg / 75` | — |

<!-- organ-parameters:end -->

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `glucose-core.ts`（共享核心，不是入口） | — | — | — | — |
| `glucose.ts`（正常入口，三汇） | `glucose` | `glucoseMassG`、`concentrationMgDl`、`concentrationBasis`、`disposedGlucoseG`、`excessMassG` | 自己的轮初状态；轮初 `kidneyGlucose.excretionRequestG`、`liver.storageRequestG`、`muscleGlucose.uptakeRequestG` | `glucose.parameters.json` |
| `glucose.female.ts`（女性变体，四汇） | `glucose` | 同上 | 同上，另读轮初 `mammaryGlands.lactoseRequestG` | `glucose.parameters.json`（复用） |

`glucoseMassG` 声明 `transferIn: ["smallIntestine.carbohydrateG", "liver.glycogenG", "kidneyGluconeogenesis.glucoseOutputG"]`；正常入口的 `transferOut` 为 `["kidneyGlucose.excretedGlucoseG", "liver.storageG", "muscleGlucose.uptakeG"]`，女性变体末位再加 `mammaryGlands.lactoseG`。出口目标与入口来源都必须声明。`liver.glycogenG → glucose.glucoseMassG` 的释放由 `liver` 发起，`kidneyGluconeogenesis.glucoseOutputG → glucose.glucoseMassG` 由肾糖异生部位发起，其余三笔（女性变体为四笔）由本隔室发起。Gateway 先应用 write，再把本轮 transfer 按 transfer 对键排序后逐笔应用（`gateway/operations.js:206`）；正常入口的三个出口等价于目标名顺序 `kidneyGlucose.excretedGlucoseG` → `liver.storageG` → `muscleGlucose.uptakeG`，女性变体的金额按“肾 → 肝 → 肌 → 乳腺”钳位，Gateway 的键排序只改变扣减顺序，不改变金额。同一清单不能同时加载 `glucose.ts` 与 `glucose.female.ts`。

完整清单中加载 glucose 时必须同时加载小肠、`liver`、`kidneyGluconeogenesis` 与 `muscleGlucose`；`kidneyGlucose` 是可选汇，但完整清单会加载它。小肠的水与碳水 transfer 又要求胃水链入口、`colon`、`bodyFluid`、`bladder`、[`skin`](../../human-organs/skin/README.md) 与 [`lungs`](../../human-organs/lungs/README.md) 都在清单中（`bodyFluid.waterVolumeMl` 按肾→肺→汗的顺序向膀胱、肺与皮肤三个出口分配轮初水），同时 `muscleGlucose` 声明三个骨骼肌区域，因此根与男性清单完整硬 transfer 闭包为 15 部位：`hydration.ts`、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGlucose`、`kidneyGluconeogenesis`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs`；女性清单再加 `uterus` 与 `mammaryGlands`，为 17 部位。不能只取本隔室单独运行。[`physicalActivity`](../../human-organs/skeletal-muscle/README.md) 只是 `muscleGlucose`、`skin` 与 `lungs` 的普通轮初读取，不在闭包内。

正常入口只读三个请求字段，女性变体另读第四个 `mammaryGlands.lactoseRequestG`；两者都不读 `pancreasEndocrine`，也不读肝容量或存量：残余清除与胰岛素信号无关，肝容量钳位由 `liver` 自己完成。`pancreasEndocrine` 是 `liver` 与 `muscleGlucose` 的软读取：缺失时两部位按归一化因子 `I = 1` 计算请求，加载后读取 `insulinPmolL` 并计算 `I = insulinPmolL / 60`；`glucagonRelative` 由 `liver` 与 `kidneyGluconeogenesis` 读取。`muscleGlucose` 与 `liver` 读轮初 `excessMassG` 和 `insulinPmolL`，写出本轮请求，本隔室下一轮结算；`mammaryGlands` 读轮初 `prolactinNgMl` 写 `lactoseRequestG`。已加载的请求部位在旧档补齐后仍缺字段、非数值、非有限或为负时抛错，不用 0 或参考值掩盖。缺 `liver` 或 `muscleGlucose` 部位时启动报错（transfer 配对不完整），不做“无请求”回退；`kidneyGlucose` 与 `mammaryGlands` 是可选汇，未加载时按 0。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `glucoseMassG` | `g` | 轮末可及池总质量，已扣本轮清除并计入 transfer 净结算；不是血浆内实际质量或直接测得的全身葡萄糖 |
| `concentrationMgDl` | `mg/dL` | 用**轮初**质量计算的血浆葡萄糖浓度代理读数 |
| `concentrationBasis` | `[dL/kg, kg]` | 计算同一浓度时使用的 `[有效分布体积/体重, 有效参考体重]`；按此顺序成对写出，供 `kidneyGlucose` 反算。是换算配置，不是池质量或人体实测值 |
| `disposedGlucoseG` | `g` | 本轮 `glucose` 自身基础消耗与超基线残余清除之和（脑/红细胞等非器官组织的表观利用，按 `basalConsumptionGPerMin` 与 `residualDisposalHalfTimeMin` 计算）；不是累计量，不包含肾糖、肝储存或肌摄糖 |
| `excessMassG` | `g` | `max(0, 轮初 glucoseMassG − baselineMassG)`，供各摄糖部位计算请求的只读信号；不是质量通量，不进入质量账，只有本隔室写 |

`kidneyGlucose.excretedGlucoseG` 由 transfer 单独记录实际肾糖排泄，不并入 `disposedGlucoseG`。`muscleGlucose` 的四个字段不属于本隔室：`uptakeRequestG` 是本轮请求（不是实际通量），`uptakeG` 是 `glucoseMassG` 的 transfer 目标、接收实际支付的 `U_paid` 并在下一轮入账，`glycogenG` 是肌糖原存量，`glycogenConsumedG` 是每轮运动消耗通量。`liver` 的五个字段也不属于本隔室：`storageRequestG` 是本轮储存请求（不是实际通量），`storageG` 是 `glucoseMassG` 的 transfer 目标、接收实际支付的 `L_paid` 并在下一轮并入存量，`glycogenG` 是肝糖原存量，也是 `glucoseMassG.transferIn` 的来源，`glycogenCapacityG` 是容量字段（由 `liver` 自己用于钳制请求），`outputG` 是肝本轮实际释放记录、不进质量账。`kidneyGluconeogenesis.glucoseOutputG` 是 `glucoseMassG` 的另一 transfer 来源，记录本轮肾糖异生产糖并在结算时全部转入血糖；它是通量，不是请求或累计量。`mammaryGlands.lactoseG` 是女性变体的 `glucoseMassG` transfer 目标，接收实际支付的 `G_paid`；`lactoseRequestG` 是请求字段，不进入质量账。请求字段不进入质量账；只有实际到账的 `uptakeG`、`storageG`、`excretedGlucoseG` 与（女性变体）`mammaryGlands.lactoseG` 才代表质量转移。

当前消费者：`pancreasEndocrine`、`kidneyGlucose`、`liver`、`kidneyGluconeogenesis` 与 `interoception`（软读计算低血糖不适 `hypoglycemiaMm`）读取 `concentrationMgDl`；`liver` 与 `muscleGlucose` 读取 `excessMassG`；正常入口读取三个请求字段与肾糖请求，女性变体另读 `mammaryGlands.lactoseRequestG`。本隔室不写其他部位的字段。`hypoglycemiaMm` 现已接入纯定性 `body_state` 与 `brainNotify`（≥ 85 mm 触发高危紧急 `wake`），但不会自动触发进食或补糖动作；原始数值由 `GET /state` / `gateway.getState()` 返回。

## 3. 边界、参数与结算方程

| 参数 ID | 值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `glucose.referenceBodyMassKg` | 75 | `kg` | `design` | 参考体重默认值；无显式覆盖时按 `profile.weightKg / 75` 缩放 |
| `glucose.distributionVolumeDlPerKg` | 1.88 | `dL/kg` | `design` | `SRC-DALLAMAN-2007`；未来由更完整分布模型替换 |
| `glucose.baselineConcentrationMgDl` | 90 | `mg/dL` | `design` | 工程基线；未来由个体基线替换 |
| `glucose.residualDisposalHalfTimeMin` | 60 | `min` | `design` | `source: null`；仅用于本隔室自身超基线残余清除（与胰岛素无关），不随胰岛素信号缩放；不是组织利用总清除半时，未来由更完整的非器官组织清除模型替换 |
| `glucose.basalConsumptionGPerMin` | 0.12 | `g/min` | `design` | `source: null`；非胰岛素依赖的基础葡萄糖消耗速率（约 172.8 g/d，对应脑与红细胞等利用），在 `< 50 mg/dL` 时按比例平滑衰减以防变负，空腹 90 mg/dL 下与肝 `0.096` + 肾 `0.024 g/min` 精确平衡 |

原 `glucose.apparentDisposalHalfTimeMin` 已更名为 `residualDisposalHalfTimeMin`，值仍为 60；语义从“全体表观清除”收窄为“本隔室自身超基线残余清除”，并与 `basalConsumptionGPerMin = 0.12 g/min` 共同构成 `disposedGlucoseG`。本隔室没有摄糖速率参数；肌肉与肝的摄糖效率由各自参数文件里的 `maxUptakeRateGPerMin`、`halfMaxExcessG` 与 `insulinSensitivity` 决定（肝另有 `glycogenCapacityG`），`glucose` 只按它们的请求结算。

```text
[Vd, K] = [有效 dL/kg, 有效参考体重 kg]                       （写 concentrationBasis）
V = Vd × K                                                  （默认 1.88 × 75 = 141 dL）
B = baselineConcentrationMgDl × V / 1000                    （默认 12.69 g）
M = max(0, 轮初 glucoseMassG)
C = M × 1000 / V                                            （写 concentrationMgDl）
E = max(0, M − B)                                          （写 excessMassG）
basalDisposed = min(M, basalConsumptionGPerMin × dtMin × clamp(C / 50, 0, 1))
excessDisposed = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))
D = min(M, basalDisposed + excessDisposed)                 （写 disposedGlucoseG）
M_after = M − D
R = 轮初 kidneyGlucose.excretionRequestG（未加载按 0）
X = min(max(0, R), M_after)                              （肾糖）
L_req = 轮初 liver.storageRequestG
L_paid = min(max(0, L_req), M_after − X)                 （肝摄糖）
U_req = 轮初 muscleGlucose.uptakeRequestG
U_paid = min(max(0, U_req), M_after − X − L_paid)        （肌摄糖）
[女性变体] G_req = 轮初 mammaryGlands.lactoseRequestG（未加载按 0）
[女性变体] G_paid = min(max(0, G_req), M_after − X − L_paid − U_paid) （乳汁乳糖）
W = M_after                                              （write 值，转移前质量）
write { glucoseMassG: W, concentrationMgDl: C, concentrationBasis: [Vd, K], disposedGlucoseG: D, excessMassG: E }
transfer（write 后逐笔结算）：
  glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG: X
  glucose.glucoseMassG → liver.storageG: L_paid
  glucose.glucoseMassG → muscleGlucose.uptakeG: U_paid
  [女性变体] glucose.glucoseMassG → mammaryGlands.lactoseG: G_paid
  liver.glycogenG → glucose.glucoseMassG: release（由 liver 发起）
  kidneyGluconeogenesis.glucoseOutputG → glucose.glucoseMassG: output（由 kidneyGluconeogenesis 发起）
```

结算顺序“肾 → 肝 → 肌 → [乳腺]”是 `policy`。正常入口与 Gateway 的 transfer 对键排序一致；女性变体的金额按 `G_paid` 最后钳位，Gateway 的键排序只改变扣减顺序，不改变金额。每个请求都由对应部位在上一轮按自身输入计算：肌肉请求受最大速率、半饱和、胰岛素敏感度与运动摄糖约束，肝请求先按同一胰岛素依赖形式计算、再由 `liver` 自己钳到剩余容量，乳腺请求由 `mammaryGlands` 按轮初催乳素与乳汁水请求计算。`glucose` 不重新计算组织请求，也不读取肝容量；余额不足时按上述顺序依次钳位，后结算者拿到较少或 0，不会产生负质量。

`D` 只表示本隔室自身基础利用与残余清除之和，始终 `0 ≤ D ≤ M`；它不是组织摄糖总量，也不随胰岛素信号变化。空腹基线（90 mg/dL）时 `basalDisposed = 0.12 × dtMin`，与肝基础释放（`0.096 g/min`）和肾糖异生基础输出（`0.024 g/min`）合计 `0.120 g/min` 精确平衡，使空腹血糖稳态维持在约 90 mg/dL；低于 50 mg/dL 时基础消耗按 `C / 50` 线性软化以防止池质量变负。`X`、`L_paid`、`U_paid`、`G_paid` 都是实际支付量，各自被轮初请求和可用余额钳制。write 的 `W = M_after` 是只扣自身清除后的转移前质量，不含各笔支付；Gateway 在 write 之后才按 transfer 逐笔扣减，因此提交后的池质量（同轮肝/肾产出之前）为 `W − X − L_paid − U_paid − G_paid = M_after − X − L_paid − U_paid − G_paid`。

质量账（不含同轮肝释放）：`M_start = M_final + X + (D + L_paid + U_paid + G_paid)`，其中 `M_final` 是全部出口结算后的池质量。若本轮 `liver` 发起释放，释放量从 `liver.glycogenG` 转入 `glucoseMassG`，池质量在 `M_final` 之上再加 `release`；这部分已由外源碳水质量账的肝糖原项体现，不在本隔室的“自身清除”里重复计算。外源碳水质量账各项（肌肉糖原、在途摄取、累计消耗、肝糖原差值、在途储存）保持不变，女性变体另加累计乳汁乳糖，见 §5。

`excessMassG` 只由本隔室写出，其他部位只读不写；它按轮初质量每轮重算，不是累计量。旧档缺该字段时由轮初质量现算。`residualDisposalHalfTimeMin` 与基线质量共同决定残余清除下限：低于基线时 `E = 0`、`D = 0`，本隔室不产生超基线清除，是否回升取决于 `liver` 的真实释放与 `kidneyGluconeogenesis` 的速率受限产糖。

轨迹是涌现的：总清除量由各组织请求与自身残余清除共同决定，**不再承诺与旧的中央分配模型逐位一致**。肝满时 `liver` 自己把 `storageRequestG` 钳到 0，未接收部分自然留在血糖池，血糖下降相应变慢；总清除量不再由单一总量给出。

## 4. 时序、异常与旧档

请求与到账分离是核心时序。`concentrationMgDl` 和 `concentrationBasis` 在同一轮写出，描述轮初质量及其换算配置；当轮 transfer 只更新 `glucoseMassG`，不会重算已写出的读数。

1. 第 N 轮：`glucose` 写出 `excessMassG = E_N`、浓度和换算基准；`pancreasEndocrine` 按轮初浓度写出下一轮 `insulinPmolL` 与 `glucagonRelative`。
2. 第 N+1 轮：`muscleGlucose` 与 `liver` 读轮初 `excessMassG`、`insulinPmolL`，以 `I = insulinPmolL / 60` 归一化后各自写出本轮 `uptakeRequestG` / `storageRequestG`；本轮不转移质量。
3. 第 N+2 轮：`glucose` 读轮初请求，按“肾 → 肝 → 肌 → [乳腺]”结算，实际支付写入 `muscleGlucose.uptakeG`、`liver.storageG` 与（女性变体）`mammaryGlands.lactoseG`；两部位再下一轮入账糖原，乳腺的 `lactoseG` 下一轮再被自身读作实际到账。

因此一次自然餐的默认链仍是第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收、第 4 轮首次看到浓度上升；第 5 轮两部位写出首批摄糖请求，第 6 轮才首次实际到账。`kidneyGlucose` 在第 N+1 轮读第 N 轮发布的浓度与配对基准，按 `io.dt` 计算请求，不经过 `excessMassG`；`glucose` 在第 N+2 轮才结算实际肾糖。女性变体的乳糖请求由 `mammaryGlands` 上一轮写出，`glucose` 下一轮才支付，同样是一轮快照滞后；它不参与组织摄糖请求的计算。胰腺信号与组织请求各有一轮快照滞后，`glucose` 结算再隔一轮；不存在同轮“血糖升 → 胰岛素升 → 组织摄糖升”的代数环。

低血糖方向：`glucose` 写出低浓度后，`liver` 下一轮读到低浓度或升高的 `glucagonRelative`，当轮释放 `min(maxOutputRateGPerMin × H × dtMin, 存量)` 并自己发起 transfer；`kidneyGluconeogenesis` 同样在下一轮按低浓度或高胰高血糖素产糖 `min(maxOutputRateGPerMin × H × dtMin, maxOutputPerRoundG)`，没有存量上限。肌肉没有释放路径（无 G6Pase），不向血液放糖。释放/产糖轮的 `glucose` 仍按轮初质量算浓度，提交后 `glucoseMassG` 已回升，再下一轮浓度才上升。

必须区分“上游按设计未接入”和“已接入但异常”：

- **自定义清单没有 `pancreasEndocrine`：** 不影响本隔室；`liver` 与 `muscleGlucose` 按归一化因子 `I = 1` 计算请求，`liver` 按 `glucagonRelative = 1` 处理释放。
- **直接调用模块、没有 `liver` / `muscleGlucose` / `kidneyGluconeogenesis` / `kidneyGlucose`：** 纯模块测试可自行注入请求或按 0 处理；任何包含 glucose 的 Gateway 清单都必须同时加载 `liver`、`muscleGlucose` 与 `kidneyGluconeogenesis`，缺部位在启动时报错（缺肾糖异生时报未声明来源 `kidneyGluconeogenesis.glucoseOutputG`）。`kidneyGlucose` 是可选汇，未加载时肾糖请求按 0；女性变体另把 `mammaryGlands` 当可选汇，未加载时乳糖请求按 0。
- **根清单不要求乳腺：** `glucose.ts` 的 `transferOut` 不声明 `mammaryGlands.lactoseG`，根清单加载它不需要乳腺；女性清单使用 `glucose.female.ts`，缺 `mammaryGlands` 时启动报 `transferOut target "mammaryGlands.lactoseG" is not declared`。同一清单不能同时加载两个入口。
- **已加载但异常：** 正常入口的三个请求字段（女性变体加 `mammaryGlands.lactoseRequestG`）缺失、非数值、非有限或为负数时抛错，让本轮失败，不用 0 或健康常量掩盖；合法 0 是有效请求（例如肝满、低血糖或未泌乳），不是缺失。
- **自身 `glucoseMassG`：** 保留碳水薄切片的旧行为：缺失由 `initialState` 补默认值，负值或非有限的历史自身质量按 0 读取；这是唯一钳位例外，不适用于新接入的请求字段。
- **旧档：** `excessMassG` 每轮由轮初质量现算（不读旧值）；启动时补 `liver.storageRequestG = 0`、`muscleGlucose.uptakeRequestG = 0`，女性变体另补 `mammaryGlands.lactoseRequestG = 0`（由乳腺模块 `initialState` 补齐）；其余字段沿用既有初值（`glucoseMassG = 12.69`、`concentrationMgDl = 90`、`disposedGlucoseG = 0`、`kidneyGluconeogenesis.glucoseOutputG = 0`、`liver.glycogenG = 80`、`liver.storageG = 0`、`liver.glycogenCapacityG = 100`、`muscleGlucose.uptakeG = 0`、`glycogenG = 0`、`glycogenConsumedG = 0`、`mammaryGlands.milkMl = 0`、`lactoseG = 0`、`fullnessMm = 0`）。不反推历史请求、释放、泌乳或激素。
- **重启：** 保留已提交的请求、在途 `uptakeG` / `storageG` 与各部位存量；下一轮只入账一次。请求字段每轮由各部位重写，不从当前血糖反推历史；`liver.glycogenCapacityG` 由 `liver` 每轮按参数重写为 100。

默认初始状态为 `glucoseMassG = 12.69 g / concentrationMgDl = 90 / concentrationBasis = [1.88, 75] / disposedGlucoseG = 0 / excessMassG = 0`。内置 `glucose` 的旧档如果只缺基准，会用已加载的有效 `[Vd, K]` 补这一整对，不覆盖已有浓度和质量；已有基准则和该浓度一起保留，直到下一轮发布新读数。兼容边界见[肾 README §6.7](../../human-organs/kidney/README.md#67-旧档缺失与错误)。

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
+ [女性变体] 累计 mammaryGlands.lactoseG
```

`stomach.solidCarbohydrateG` 是胃总碳水子集，不另加；各轮排空/吸收通量也不重复加。`disposedGlucoseG` 只累计本隔室自身残余清除；`kidneyGlucose.excretionRequestG`、`liver.storageRequestG`、`muscleGlucose.uptakeRequestG` 与 `mammaryGlands.lactoseRequestG` 都不进入质量账，只有实际 `excretedGlucoseG`、`muscleGlucose.uptakeG`、`liver.storageG` 与（女性变体）`mammaryGlands.lactoseG` 才累计。乳汁乳糖被视作葡萄糖当量离开可及池，因此女性变体的账本多这一项；它不是外源摄入，也不表示乳汁成分或乳糖合成路径。`muscleGlucose.glycogenG` 是已入账糖原存量，`uptakeG` 是实际支付的在途量，`glycogenConsumedG` 是每轮消耗通量、需累计；三者不能重复加总。`liver.glycogenG − 80` 是肝糖原相对初始禀赋的净变化，`liver.storageG` 是已从葡萄糖转出、尚未并入存量的在途量；`80` 即 `liver.initialGlycogenG`，与 `B` 一样是初始禀赋。`liver.outputG` 是肝→葡萄糖的内部转移记录，不进入质量账；释放已同时反映在 `glucoseMassG` 与 `liver.glycogenG` 两侧，再加一次会双计。真实 Gateway 测试按 `1e-6 g` 容差逐轮核对单次、多轮固体餐与吸收后重启；肌摄糖、运动消耗与肝糖原储存/释放纳入同一账本验收。该恒等式是模型外源碳水的工程账，不是完整人体碳平衡。

## 6. 证据入口

- [`SRC-DALLAMAN-2007` 笔记](references/notes/dalla-man-2007.md)
- [共享来源登记簿](../../human-organs/references/source-index.csv)
- [碳水—血糖薄切片设计](../../../docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)
- [各部位自主摄糖设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- [胰腺相对信号 README](../../human-organs/pancreas/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md)
- [肾糖排泄 README](../../human-organs/kidney/README.md) §6 与[设计](../../../docs/superpowers/specs/2026-11-23-renal-glucose-design.md)
- [骨骼肌摄糖 README](../../human-organs/skeletal-muscle/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- [肝糖原 README](../../human-organs/liver/README.md) 与[设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- [乳腺 README](../../human-organs/mammary-glands/README.md) 与[乳腺设计](../../../docs/superpowers/specs/2026-11-24-mammary-glands-design.md)

Dalla Man 2007 的 p.1741 §III.A / 式 (1) 定义可及池和 `V_G`，p.1743 Table I 给出正常组平均模型常数 `1.88 dL/kg`。它不是血浆体积、瘦体重归一化、总体水或 204 人直接实测均值；原文没有报告该常数单独的估计/固定方法、精度或个体间离散度。75 kg、90 mg/dL、60 min 残余清除、小肠 20 min、肌肉与肝的摄取参数、肝糖原 80 g、100 g 容量与 1 g/min 释放速率都不是该文报告值，本隔室的这些参数保持 `design`、`source: null`。肝糖原与胰高血糖素曲线另见[肝 README](../../human-organs/liver/README.md)与[胰腺 README](../../human-organs/pancreas/README.md)；两者都没有新增登记来源。

## 7. 未建模与未验证

- 不建胰岛素/胰高血糖素的绝对浓度、分泌率、C-peptide、两室动力学、受体或酶促糖原动力学、肝糖异生、脂肪组织、静息糖原周转或慢速组织隔室；`pancreasEndocrine` 只提供两个无量纲相对信号。脂肪组织按同一接口接入是后续项，当前不建模。
- 各部位自主摄糖：`muscleGlucose` 按最大速率、半饱和与胰岛素敏感度写请求，实际到账经 transfer 进入 `uptakeG`，下一轮入账 `glycogenG`，运动时消耗；`liver` 按同一形式写储存请求并自行钳到 `glycogenCapacityG` 剩余容量，低血糖/胰高血糖素升高时自行释放。总清除轨迹由这些响应与 `glucose` 自身残余清除共同涌现，不由单一清除半时决定。
- 不建脂肪组织、肾糖异生的底物池（乳酸/氨基酸/甘油）、乳酸/Cori 循环、运动类型、MET、能量消耗或运动对胰岛素敏感度的调节；肾糖只作为终端质量汇接入，不建尿糖浓度、尿量、尿渗透压、SGLT、渗透性利尿或 GFR mL/min。
- 不建乳汁乳糖合成路径、乳糖浓度、乳汁脂肪/蛋白/免疫成分、乳腺解剖、婴儿吸吮或哺乳行为；女性变体只把 `mammaryGlands.lactoseRequestG` 当葡萄糖当量请求，实际不足时按出口顺序钳位。乳腺与乳糖的证据边界归 [`mammaryGlands` README](../../human-organs/mammary-glands/README.md)。
- 不区分葡萄糖以外的可消化碳水来源，不建消化酶、纤维、脂肪或蛋白质。
- 离线守恒、方向测试和真实 Gateway 测试不等于临床验证、个体预测、正常餐后曲线复现或真实 DSH 实机验收。所有新参数都是 `design`、`source: null`，不能称为拟合、已验证或个体预测；女性 32 部位性能未实测。
- **后续项（计划，不是当前实现）：** 脂肪组织按同接口接入；肾糖异生的底物池与胰高血糖素剂量反应（当前只有速率受限产糖代理）；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。
