# 肝（liver）：肝糖原储存与低血糖释放

**功能标签：** 代谢（肝糖原代理）。

`liver` 是肝目录下唯一的部位，脚本为 `glycogen.ts`，没有动作、通知，也不写其他部位。它维护五个以克为单位的量：本轮储存请求 `storageRequestG`、本轮实际储存 `storageG`、肝糖原存量 `glycogenG`、常量容量 `glycogenCapacityG` 与本轮实际释放记录 `outputG`。高血糖时 `liver` 自己按轮初 `glucose.excessMassG`、`insulinRelative` 与本节参数计算储存请求，并先钳到 `glycogenCapacityG − (glycogenG + storageG)` 的剩余容量；下一轮 `glucose` 按请求结算，实际支付经 transfer 进入 `liver.storageG`，再下一轮并入存量。肝满时请求为 0，未接收部分自然留在血糖池，血糖下降相应变慢。糖原输出采用**平滑比例内源产糖（EGP）**：空腹基线（90 mg/dL、`glucagonRelative = 1`、`cortisolRelative = 1`）时输出基础速率 `0.096 g/min`（与肾糖异生 `0.024 g/min` 合计 `0.12 g/min` 平衡血糖基础消耗），高血糖时按 `1 / (1 + excessMgDl / 30)` 平滑抑制，低血糖或胰高血糖素升高时按比例增加并乘以轮初 `adrenal.cortisolRelative`，当轮经 transfer 把 `glycogenG` 转回 `glucose.glucoseMassG`；释放量恒受存量限制。只有肝（以及肾糖异生）向血液放糖，肌肉不参与。它不模拟胆汁生成与排泄、解毒、蛋白合成、脂肪代谢、尿素循环、肝血流或肝糖异生，也不是完整肝功能或糖代谢模型。

实现状态：脚本、参数与模块契约测试已落地，当前根清单为 39 个部位、35 份唯一参数文件（另含 3 份 DI 变体与 1 份缺区域变体），女性清单为 42 个部位、38 份参数文件，男性清单为 41 个部位、37 份参数文件；硬 transfer 闭包为根与男性 15 部位、女性 17 部位。九个参数全部是 `design`、`source: null`，没有登记人体来源。本文只描述离线模型与契约，未做真实 DSH 会话、肝糖原实测、独立血糖曲线或临床验证。

## 1. 脚本、部位与 transfer

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `glycogen.ts` | `liver` | `storageRequestG`、`glycogenG`、`storageG`、`glycogenCapacityG`、`outputG` | 自己的轮初状态；轮初 `glucose.excessMassG`（未加载 glucose 时按 0）；轮初 `pancreasEndocrine.insulinRelative`（未加载胰腺时按 1）；轮初 `glucose.concentrationMgDl`（未加载 glucose 时按 90）；轮初 `pancreasEndocrine.glucagonRelative`（未加载胰腺时按 1）；轮初 `adrenal.cortisolRelative`（未加载肾上腺时按 1）；`io.dt` | `glycogen.parameters.json` |

字段声明：

```text
liver.glycogenG.transferOut = ['glucose.glucoseMassG']
liver.storageG.transferIn   = ['glucose.glucoseMassG']
liver.storageRequestG       无 transfer 声明
liver.glycogenCapacityG     无 transfer 声明
liver.outputG               无 transfer 声明
```

对应地，`glucose.glucoseMassG.transferOut` 必须声明 `liver.storageG`，`transferIn` 必须声明 `liver.glycogenG`。`glucose.glucoseMassG → liver.storageG` 由 `glucose` 发起，`liver.glycogenG → glucose.glucoseMassG` 由 `liver` 发起；只有源字段的所有者可以转出。`storageRequestG` 是本轮请求、不参与 transfer；`glycogenCapacityG` 是每轮从参数写出的常量容量字段，不参与 transfer；`outputG` 只是本轮实际释放的记录字段，也不进入质量账。

硬依赖：任何包含 `glucose` 的完整 Gateway 清单必须同时加载 `liver`，否则启动时 transfer 配对校验失败（缺 `liver` 时通常报 `transferIn source "liver.glycogenG"` 或 `transferOut target "liver.storageG"` 未声明；以实际注册表报错为准）。`glucose` 还会读取 `liver.storageRequestG`；请求字段缺失、非数值、非有限或为负时本轮失败。不能靠省略字段、运行中兜底或“先欠着”的请求绕过。

`liver` 与 `glucose` 的读写关系：`liver` 读轮初 `glucose.excessMassG`（用于计算储存请求）、`glucose.concentrationMgDl`（用于判断释放）、胰腺两个相对信号与 `adrenal.cortisolRelative`（用于缩放释放）；`glucose` 只读轮初 `liver.storageRequestG` 并按其结算，不读肝容量、存量或 `outputG`，也不写肝的任一字段。容量钳位在 `liver` 内部完成，`glucose` 没有“缺肝按无限容量”的回退。`pancreasEndocrine`、`glucose` 与 `adrenal` 的存在都有脚本内回退：缺 `glucose` 按 `G = 90`、缺胰腺按两个信号 1、缺肾上腺按皮质醇 1，这是纯模块行为；完整清单仍由 transfer 配对强制 `glucose` 与 `liver` 同时存在。`liver` 无动作、无通知、无 `inject`。

## 2. 字段与单位

五个字段都是 `absolute`，初值写在含义列：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `storageRequestG` | `g` | 本轮按 `excessMassG`、`insulinRelative` 与剩余容量计算的储存请求；不是实际通量，不进入质量账，下一轮由 `glucose` 结算。初值 0 |
| `glycogenG` | `g` | 肝糖原存量；上一轮 `storageG` 本轮并入，当轮释放经 transfer 扣出。初值 80 |
| `storageG` | `g` | 上一轮请求结算后实际到账的储存，仅由 `transferIn: ['glucose.glucoseMassG']` 增加；每轮 write 先归 0。初值 0 |
| `glycogenCapacityG` | `g` | 每轮从参数写出的常量容量字段，供本脚本自己计算剩余容量并钳制 `storageRequestG`；不是 transfer 目标，不是累计量，不参与质量账。初值 100 |
| `outputG` | `g` | 本轮实际释放量的记录，由本脚本写出；不是 transfer 目标，不是累计量，不参与质量账。初值 0 |

初始状态为 `{ storageRequestG: 0, glycogenG: 80, storageG: 0, glycogenCapacityG: 100, outputG: 0 }`。时间原点：`storageRequestG` 是本轮轮末写出的请求，`storageG` 是上一轮 `glucose` 结算后到账的在途量，`glycogenG` 是脚本 write 时的存量基准，`glycogenCapacityG` 是本轮写出的固定容量，`outputG` 是本轮释放量。五者都是轮末状态。Gateway 先应用 write 再结算 transfer，所以提交后的 `glycogenG` 已扣除本轮释放；`outputG` 仍保留本轮释放量，供核对与下一轮覆盖。`glycogenG` 不是肝活检、影像或示踪测量的肝糖原浓度，80 g 是工程初始禀赋，不是人体平均值；`glycogenCapacityG = 100 g` 同样是工程容量，不是实测上限。

## 3. 方程与参数

设 `prev` 为轮初自身状态，`E = max(0, 轮初 glucose.excessMassG)`（未加载 glucose 时按 0）、`I = 轮初 pancreasEndocrine.insulinRelative`（未加载胰腺时按 1）、`G = 轮初 glucose.concentrationMgDl`（未加载 glucose 时按 90）、`H = 轮初 pancreasEndocrine.glucagonRelative`（未加载胰腺时按 1）、`C = 轮初 adrenal.cortisolRelative`（未加载肾上腺时按 1），`dtMin = io.dt / 60`：

```text
stored = max(0, prev.glycogenG + prev.storageG)   （缺失/非数值/非有限字段按 0 代入）
freeCapacity = max(0, glycogenCapacityG − stored)
response = max(0, 1 + insulinSensitivity × (I − 1))
storageRequestG = min(
  maxUptakeRateGPerMin × (E / (E + halfMaxExcessG)) × response × dtMin,
  freeCapacity
)
deficitMgDl = max(0, 90 − G)
excessMgDl  = max(0, G − 90)
suppression = 1 / (1 + excessMgDl / 30)
rawRate     = (basalOutputRateGPerMin × suppression
              + hypoglycemiaOutputGainGPerMinPerMgDl × deficitMgDl
              + glucagonOutputGainGPerMin × max(0, H − 1))
              × max(0, C)
rate        = clamp(rawRate, 0, maxOutputRateGPerMin)
release     = min(rate × dtMin, stored)
write.storageRequestG = storageRequestG
write.glycogenG = stored
write.storageG = 0
write.glycogenCapacityG = glycogenCapacityG
write.outputG = release
transfer liver.glycogenG → glucose.glucoseMassG: release（release > 0 时）
```

储存请求与释放是两条独立路径，均按轮初快照计算：`response` 通过 `max(0, ...)` 确保非负（因此高 `insulinSensitivity` 且 `I < 1` 时不会出现负请求）；释放速率不再使用阶跃开关，而是在 `90 mg/dL` 基础输出 `0.096 g/min` 上，随高血糖按 `1 / (1 + excessMgDl / 30)` 平滑抑制，随低血糖按 `0.015 g/(min·mg/dL)`、随高胰高血糖素按 `0.15 g/min` 平滑增加，整体乘以 `max(0, C)` 并钳到 `[0, maxOutputRateGPerMin]` 与 `stored`。因此，基线静息态（`G = 90`、`H = 1`、`C = 1`）下肝仍维持 `0.096 g/min` 基础内源输出；高血糖（如 180 mg/dL）时基础输出抑制到 `0.096 / 4 = 0.024 g/min`；`C` 只是释放速率乘数，`C = 0` 时输出归 0。`E = 0` 或 `freeCapacity = 0`（肝满）时储存请求为 0，未接收部分留在血糖池。

- `I = 1` 时 `response = 1`；`I = 3` 时肝（敏感度 0.5）`response = 2`；`I = 0` 时 `response = 0.5`（若调大敏感度使括号内为负，则由 `max(0, ...)` 钳到 0）。
- 示例：`E = 15`、`I = 1`、`dt = 60` → `0.2 × 0.5 × 1 × 1 = 0.1 g`；`I = 3` → `0.2 g`；`E = 45`、`I = 1` → `0.2 × 0.75 = 0.15 g`。
- 请求先按速率公式算，再钳到剩余容量；容量是 `design` 工程占位，不随年龄、体重、进食状态或激素变化。预置存量高于容量时 `freeCapacity = 0`，但不截断已有存量或释放。

Thresholds：`90 mg/dL`（`baselineMgDl`）与 `30 mg/dL`（`suppressionScaleMgDl`）是脚本内工程常量；缺失 `glucose` 时 `G` 按 90、`E` 按 0，缺失 `pancreasEndocrine` 时 `I` 与 `H` 按 1，缺失 `adrenal` 时 `C` 按 1。释放由本脚本钳到 `stored`，所以 transfer 不会被源余额拒绝；存量耗尽后 `release = 0`，不虚构供给。两个自身存量字段先求和、再整体钳到 0；缺失、非数值或非有限字段按 0 代入，有限负值原样参与求和，不逐字段钳位，`stored` 不会为负；释放和写出的存量也都不为负。容量字段每轮重写为参数值 100，不保留旧档中的其他容量值。

| 参数 ID | 值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `liver.maxUptakeRateGPerMin` | 0.2 | `g/min` | `design` | `source: null`；半饱和与敏感度修正前的最大储存速率，纯工程占位；不是实测肝糖原合成速率 |
| `liver.halfMaxExcessG` | 15 | `g` | `design` | `source: null`；超基线质量达到该值时响应为半最大，纯工程占位；不是实测半饱和量 |
| `liver.insulinSensitivity` | 0.5 | `1` | `design` | `source: null`；相对胰岛素信号每偏离基线 1 个单位时的线性敏感度，肝取 0.5；不是受体亲和力或实测敏感度 |
| `liver.maxOutputRateGPerMin` | 1 | `g/min` | `design` | `source: null`；肝糖释放速率上限；纯工程占位，不是肝糖输出实测或拟合值 |
| `liver.basalOutputRateGPerMin` | 0.096 | `g/min` | `design` | `source: null`；空腹基线（90 mg/dL、`H = 1`、`C = 1`）基础肝糖输出速率（约占静息总内源产糖 `0.12 g/min` 的 80%）；不是实测肝糖输出率 |
| `liver.hypoglycemiaOutputGainGPerMinPerMgDl` | 0.015 | `g/(min·mg/dL)` | `design` | `source: null`；低于 90 mg/dL 时每 mg/dL 缺口的平滑比例释放增量；不是实测剂量反应 |
| `liver.glucagonOutputGainGPerMin` | 0.15 | `g/min` | `design` | `source: null`；`H > 1` 时每单位超额胰高血糖素信号的平滑释放增量；不是实测剂量反应 |
| `liver.initialGlycogenG` | 80 | `g` | `design` | `source: null`；新身体初始肝糖原存量，是初始禀赋，不是人体测量或正常范围 |
| `liver.glycogenCapacityG` | 100 | `g` | `design` | `source: null`；肝糖原储存容量的工程占位，由本脚本自己读取并钳制 `storageRequestG`；不是实测容量、人群均值或临床上限 |

九个数值都没有直接证据；`SRC-DALLAMAN-2007` 只作为糖代谢结构背景，不支撑肝糖原存量、容量、释放速率或任何摄取参数。参数文件里的 `range` 只是工程调参范围，不是人体百分位。

## 4. 双向自调节链与时序

血糖自调节由两半组成，`liver` 同时参与：

- **高血糖侧（储存）。** 第 N 轮 `glucose` 写出 `excessMassG`；第 N+1 轮 `liver` 按轮初 `excessMassG`、`insulinRelative` 与本节参数计算 `storageRequestG`，并自己钳到剩余容量；第 N+2 轮 `glucose` 按请求结算，实际支付经 transfer 进入 `storageG`；第 N+3 轮 `liver` 把 `storageG` 并入 `glycogenG`。肝满时请求为 0，未接收部分留在血糖池，使血糖下降变慢。储存请求受本部位参数、容量与 `glucose` 余额钳制，不额外生成质量。
- **低血糖侧（释放）。** `pancreasEndocrine` 在轮末按轮初血糖写 `glucagonRelative`（血糖低于 90 时目标 `1 + 0.02 × (90 − G)`，钳位上限 5；当前增益下 `G = 0` 只到 2.8，按 10 min 半时一阶趋近）；`liver` 按平滑比例公式计算释放速率 `clamp((0.096 / (1 + excessMgDl / 30) + 0.015 × deficitMgDl + 0.15 × max(0, H − 1)) × max(0, C), 0, 1)` 并钳到存量。释放当轮提交后 `glucoseMassG` 回升，浓度在再下一轮体现，因为 `glucose` 的 `concentrationMgDl` 始终按轮初质量计算。

默认 60 s 一轮的时序：

1. 第 N 轮：`glucose` 写出 `excessMassG > 0`；`pancreasEndocrine` 下一轮读到高浓度，写出 `insulinRelative > 1`。
2. 第 N+1 轮：`liver` 与 `muscleGlucose` 读轮初 `excessMassG`、`insulinRelative`，各自写出摄糖请求；本轮不转移质量。
3. 第 N+2 轮：`glucose` 按“肾 → 肝 → 肌”结算请求，肝储存实际支付进入 `storageG`；第 N+3 轮 `liver` 把它并入 `glycogenG`，同时写出下一轮请求。
4. 低血糖方向：`glucose` 写出低浓度后，`liver` 下一轮读到低浓度即按缺口增益抬高释放（无胰腺时）；有胰腺时，`pancreasEndocrine` 也按该低浓度写出高于 1 的 `glucagonRelative`，`liver` 再下一轮读到高信号后叠加胰高血糖素释放增益。释放轮的 `glucose` 仍按轮初质量算浓度，提交后 `glucoseMassG` 已回升，再下一轮浓度才上升。
5. 存量耗尽后 `release = 0`，血糖继续按既有残余清除与组织请求变化，不会出现无限供给，也不会保持原质量或凭空补糖。

释放和储存都是内部转移，不是摄入或排出。`outputG` 只记录本轮释放，不参与 `glucose` 的质量账；质量账用 `(liver.glycogenG − initialGlycogenG) + liver.storageG` 两项表示肝内与在途的糖原质量，详见[葡萄糖 README](../../human-compartments/glucose/README.md) §4。

## 5. 旧档、重启与异常

必须区分“可选部位未加载”和“已加载但异常”：

- **旧档缺 `liver`：** 启动时只补 `storageRequestG = 0`、`glycogenG = 80`、`storageG = 0`、`glycogenCapacityG = 100`、`outputG = 0`，不反推升级前的肝糖原、容量、释放或储存历史；已有葡萄糖、胰岛素、肾糖和肌肉状态不重置。
- **旧档 `pancreasEndocrine` 缺相对信号：** 只补 `insulinRelative = 1`、`glucagonRelative = 1`，不按历史血糖反推；第一轮肝仍按轮初 1 处理，随后再响应新信号。
- **旧自定义清单含 `glucose` 但没有 `liver`：** 本切片起启动失败（transfer 配对不完整）；必须把 `liver/glycogen.ts` 加进清单，不能靠旧档字段或运行中回退绕过。
- **重启：** 保留已提交的 `storageRequestG`、`glycogenG`、`storageG` 与 `outputG`；`glycogenCapacityG` 每轮由参数重写为 100，不依赖旧档值。上一轮结算的 `storageG` 在下一轮只并入一次，不会重复计；`storageRequestG` 每轮由本脚本重写，`outputG` 不参与释放计算、下一轮被新值覆盖。不按当前血糖或历史轮数重建存量。
- **未加载上游：** 直接调用模块时，缺 `glucose` 按 `E = 0`、`G = 90`，缺 `pancreasEndocrine` 按 `I = H = 1`，缺 `adrenal` 按 `C = 1`；这是纯模块回退，不改变完整清单的硬配对要求。
- **已加载但异常：** `glucose.excessMassG`、`glucose.concentrationMgDl`、`pancreasEndocrine.insulinRelative`、`pancreasEndocrine.glucagonRelative` 或 `adrenal.cortisolRelative` 缺失、非数值、非有限或为负时抛错，让本轮失败，不写入、不 transfer；合法 0 是有效信号或低血糖读数，不是缺失。自身部位缺失时按 `initialState` 补；已有部位里的 `glycogenG`/`storageG` 缺失、非数值或非有限按 0 读取，有限负值原样参与求和、最终整体钳到 0（不逐字段钳位），`outputG` 不参与计算并被本轮重写。

## 6. 质量账与未建模

外源碳水质量账在既有各项上增加肝糖原两项：

```text
+ (liver.glycogenG − initialGlycogenG) + liver.storageG
```

`initialGlycogenG = 80` 与葡萄糖基础质量 `B` 一样是初始禀赋，不是测量；`liver.storageG` 是已从 `glucose` 转出、尚未并入存量的在途量；`storageRequestG` 只是请求，不进入质量账。`liver.outputG` 也不进入质量账，因为它记录的是肝→葡萄糖的内部转移，质量已在两侧体现，再加一次会双计。`liver.glycogenCapacityG` 是常量容量字段，不是质量，也不进入质量账；它只限制新的储存请求，不限制已有存量或释放。未请求或未支付的部分留在血糖池，不写 `disposedGlucoseG`。释放不产生新质量，只把存量搬到 `glucose`；储存也不产生新质量，只把葡萄糖搬到肝。

未建模：

- **胆汁：** 不建胆汁生成、分泌、胆囊收缩、胆管排泄或脂肪乳化。
- **解毒与免疫：** 不建药物/毒物代谢、Kupffer 细胞、炎症或肝损伤。
- **蛋白合成：** 不建白蛋白、凝血因子、载脂蛋白或其他肝合成功能。
- **脂肪代谢：** 不建脂肪生成、脂解、酮体生成、VLDL 分泌或脂肪组织分区。
- **其他肝功能：** 不建尿素循环、氨代谢、糖异生、乳酸/Cori 循环、肝血流、门脉循环或肝体积。
- **容量与再合成：** 容量固定为 100 g，不随年龄、体重、进食状态、胰岛素/胰高血糖素或肝体积变化；不建餐后糖原再合成动力学、容量反馈或超容量存量对释放的抑制。
- **激素细节：** 不建胰岛素、胰高血糖素、皮质醇等绝对浓度、分泌率、受体、酶促糖原合成/分解动力学或三者相互作用的实测时程；本切片对释放采用血糖超基线平滑抑制而非直接的胰岛素抑制项，`glucagonRelative` 与 `cortisolRelative` 只是无量纲相对信号。
- **行为与病理：** 不建进食/饥饿行为、胰岛素抵抗、糖尿病、肝病、低血糖症状或任何自动进食/补糖动作。

**后续项（计划，不是当前实现）：** 肾糖异生已独立接入 [`kidneyGluconeogenesis`](../kidney/README.md)；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。

未验证：没有肝糖原实测、容量实测、独立血糖曲线、胰高血糖素/胰岛素/皮质醇浓度、正常餐后曲线复现、真实 DSH 会话或临床验证；80 g 初始存量、100 g 容量、1 g/min 释放上限、0.096 g/min 基础释放、0.015 / 0.15 反调节增益、0.2 g/min 最大储存速率、15 g 半饱和、0.5 敏感度与 10 min 半时都是 `design`、`source: null`，不能称为拟合、已验证或个体预测。38 / 41 部位性能也未在本切片实测。

## 7. 证据入口

本切片不新增来源行，也没有本器官的 `references/` 笔记；所有新参数保持 `design`、`source: null`，`SRC-DALLAMAN-2007` 只作既有糖代谢结构背景。

- 设计：[`2026-11-23-liver-glycogen-design.md`](../../../docs/superpowers/specs/2026-11-23-liver-glycogen-design.md) 与[各部位自主摄糖设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- 模块契约测试：[`test/organs.liver.test.mjs`](../../../test/organs.liver.test.mjs)
- 储存侧：[`glucose` README](../../human-compartments/glucose/README.md) §3–§4
- 信号侧：[`pancreas` README](../pancreas/README.md) §2–§3
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)
