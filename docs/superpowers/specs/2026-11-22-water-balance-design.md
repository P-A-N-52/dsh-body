# M3 首段：饮水吸收、体液、肾脏与主动排尿设计

> **历史提示：** 本设计形成时 `brainNotify` 只读饥饿/饱满；尿意提醒的当前实现见 [`2026-11-22-urinary-notification-design.md`](./2026-11-22-urinary-notification-design.md)。后续碳水—血糖薄切片新增 `glucose`，胰腺与肾糖又相继接入，该阶段根清单为 15 部位，见 [`2026-11-22-carbohydrate-glucose-design.md`](./2026-11-22-carbohydrate-glucose-design.md)、[`2026-11-22-pancreas-insulin-design.md`](./2026-11-22-pancreas-insulin-design.md) 与 [`2026-11-23-renal-glucose-design.md`](./2026-11-23-renal-glucose-design.md)。活动—皮肤出汗薄切片随后接入 `physicalActivity` 与 `skin`，`bodyFluid` 增加 `skin.sweatVolumeMl` 第二出口，当时为 17 部位、19 份参数文件、7 部位硬 transfer 闭包；运动相关呼吸失水薄切片又接入 `lungs`，`bodyFluid` 增加 `lungs.respiratoryWaterLossMl` 第三出口，当时根清单为 18 部位、20 份参数文件、8 部位硬 transfer 闭包，分别见 [`2026-11-23-activity-sweat-design.md`](./2026-11-23-activity-sweat-design.md) 与 [`2026-11-23-respiratory-water-loss-design.md`](./2026-11-23-respiratory-water-loss-design.md)；骨骼肌摄糖薄切片又接入 `muscleGlucose`，当前根清单为 19 部位、21 份参数文件、9 部位闭包，见 [`2026-11-23-muscle-glucose-uptake-design.md`](./2026-11-23-muscle-glucose-uptake-design.md)。本文件的 12 部位正文、单出口方程与验收记录保持当时口径，不按后续薄切片改写。

**状态：** 设计已确认。Tasks 1–9 的脚本、参数、证据笔记、定向测试、根清单接入与现状文档已落地；Task 10 的真实 DSH 会话验收已完成（2026-11-22，见 §9）；Task 11 的多轮水账本补测与当时 12 部位的逐轮性能基线已完成（2026-11-22，见 §8）；Task 12 的论文可比数据对照已记录（见 §7，2026-11-22），但只支持探索性判断，所有新参数仍为 `design`，没有拟合或独立验证，且大负荷利尿仍不匹配、口咽解渴支路未建，不能写成整体符合论文。实施计划见 [`2026-11-22-water-balance.md`](../plans/2026-11-22-water-balance.md)。本设计最初只覆盖饮水到主动排尿；2026-11-22 后续合并了膀胱过度充盈非自主排空与 `interoception.discomfort`（默认根清单，见 [`2026-11-22-overflow-discomfort-design.md`](./2026-11-22-overflow-discomfort-design.md)），以及可选的 DI 样多尿变体（独立清单/存档，默认身体不变，见 [`2026-11-22-di-insipidus-proxy-design.md`](./2026-11-22-di-insipidus-proxy-design.md)）。§3.5 已按非自主排空扩写；§8 的 Task 11 性能与 §9 的 Task 10 会话都是这些功能加入前的历史记录，不代表当前 HEAD。本设计不覆盖 M3 的睡眠部分（该部分调研后暂缓，未实现）。

## 1. 目标与取舍

打通一条每一毫升都可对账的链：

```text
drink → 胃内水 → 小肠水 → 体液水 → 膀胱尿 → 主动 urinate 排出
                         ↓
                水分亏缺代理 → 下丘脑 ADH / 口渴
                                      ↓
                              肾脏下一轮产尿请求
```

- 所有 `drink.volumeMl` 都进入水账本，`energyKcal` 仍另记；这是把饮料总体积近似为可吸收水的 `design`，不是实测纯水含量。所有 `eat`（包括 `liquid` / `mixed`）都不反推水，不增加 `waterMl` 动作参数。
- 复用 `body_act` / `body_state`；`body_act` 增加无份量参数的 `urinate`。不加工具、不逐轮注入上下文、不自动喝水或排尿、不新增口渴/尿意提醒。
- 器官目录只按解剖器官或明确隔室组织，系统名仅是 README 标签。下丘脑 ADH 与口渴是 `brain/` 下两个独立脚本；膀胱不产出激素。
- 体液是隔室而不是器官，放在 `organs/human-compartments/body-water/`；其余脚本仍在 `organs/human-organs/<organ>/`。不恢复 `systems/` 运行层。
- 首段不建血浆/尿渗透压、电解质、血容量/血压、RAAS、汗液与不感蒸发、口咽短暂解渴、排便、睡眠或疾病。尤其不把水量 mL 换算成渗透压。
- 脚本按每轮热路径设计，面向两位数以上模块逐轮运行：参数在 import 时加载，`heartbeat` 内不做全量重解析、无界历史复制或跨模块全表扫描。Task 11 曾实测当时 12 个部位的逐轮基线（2026-11-22，空载与 240 mL 饮水各 A/B 两进程，单轮 p50 0.447–0.471 ms、p95 0.537–0.584 ms，详见 §8）；那是在非自主排尿、`discomfort` 与 DI 样变体合并前的历史基线，当前 HEAD 尚未重测，不能把它写成当前版本性能。没有实测的更多规模也不能声称性能。

## 2. 模块、字段与读写方

所有字段均为 `absolute`。每轮通量字段只表示本轮，不累加；所有模块只读轮初快照。

| 部位 id / 脚本 | 状态字段（单位） | 读取 | 消费者 |
| --- | --- | --- | --- |
| `stomach` / `stomach/hydration.ts` | 原有胃字段，加 `waterVolumeMl` (mL)、`emptiedWaterMl` (mL/轮) | 原胃状态、`drink` / `eat` | 水转出到小肠；原 `volumeMl` 仍供胃机械感受，`emptiedKcal` 仍供十二指肠 |
| `smallIntestine` / `small-intestine/water-absorption.ts` | `waterVolumeMl` (mL)、`absorbedWaterMl` (mL/轮) | 自己的轮初水 | 水转出到体液；吸收读数供验收 |
| `bodyFluid` / `human-compartments/body-water/water.ts` | `waterVolumeMl` (mL)、`waterDeficit` (1) | 自己、`kidney.urineProductionRequestMl` | 接收肠水、向膀胱转尿；ADH 与口渴读 `waterDeficit` |
| `hypothalamusAdh` / `brain/hypothalamus-adh.ts` | `relativeConcentration` (1) | `bodyFluid.waterDeficit` | 肾脏读取；相对水平，不是 pmol/L |
| `hypothalamusThirst` / `brain/hypothalamus-thirst.ts` | `thirst` (mm) | `bodyFluid.waterDeficit` | `interoception`；0–100 mm VAS 代理，不自动喝水 |
| `kidney` / `kidney/urine-production.ts` | `urineProductionRequestMl` (mL/下一轮) | `hypothalamusAdh.relativeConcentration`、`io.dt` | 仅体液所有者读取；不是已完成的尿转移 |
| `bladder` / `bladder/storage.ts` | `volumeMl` (mL)、`voidedMl` (mL/轮)、`voluntaryVoidedMl` (mL/轮)、`involuntaryVoidedMl` (mL/轮) | 自己、本轮 `urinate` | 接收体液水；体积供尿意读出与过度充盈判断；`voidedMl = voluntaryVoidedMl + involuntaryVoidedMl` |
| `interoception` / `brain/interoception.ts` | 原 `hunger`、`fullness`，加 `thirst`、`urinaryUrgency`、`discomfort` (均 mm) | 原三路输入、`hypothalamusThirst.thirst`、`bladder.volumeMl` | `body_state`；`brainNotify` 仍只读饥饿/饱满，不读口渴、尿意或不适 |

`waterVolumeMl` 都是状态，`emptiedWaterMl` / `absorbedWaterMl` / `voidedMl` / `voluntaryVoidedMl` / `involuntaryVoidedMl` 是每轮通量，`waterDeficit`、ADH 相对水平、口渴、尿意和不适都是代理。`bodyFluid.waterVolumeMl` 是工程体液水隔室，不是血浆容量；`kidney.urineProductionRequestMl` 是下一轮需求，不是瞬时速率或已排尿量。

### transfer 配对

```text
stomach.waterVolumeMl       → smallIntestine.waterVolumeMl
smallIntestine.waterVolumeMl → bodyFluid.waterVolumeMl
bodyFluid.waterVolumeMl     → bladder.volumeMl
```

源字段声明 `transferOut`，目标字段声明对应的 `transferIn`，单位全部为 `mL`。只有源 owner 调用 `io.transfer`。`urinate` 不触发 transfer：水进入膀胱时已经离开体液，排尿不能再扣体液。

## 3. 离散更新顺序

Gateway 固定先应用所有 `write`，再按字段对应用 `transfer`。因此每个源部位写入的是**本轮转出前基准**，不是自行扣除后的水量。下游需求一律按轮初可用量结算；当轮上游新流入不能支付本轮下游需求。

### 3.1 胃：总量与水子集

抽出 `motility-core.ts`，让原 `motility.ts` 与新 `hydration.ts` 复用同一个 `advanceStomach` 计算，固／液餐原方程和“先排空、后入胃”不变。新入口仍导出 `id: "stomach"`；根清单用它替换原入口，同一清单绝不同时加载两个 `stomach`。

设轮初非固餐体积 `N = max(0, volumeMl - solidVolumeMl)`，其中水量 `W = clamp(waterVolumeMl ?? 0, 0, N)`。核心返回原状态推进结果、非固餐排出量 `E_nonSolid` 和本轮新入胃饮水量 `D`：

```text
emptiedWaterMl = E_nonSolid × (N > 0 ? W / N : 0)
write.waterVolumeMl = W + D
transfer stomach → smallIntestine: emptiedWaterMl
```

transfer 后胃水为 `W + D - emptiedWaterMl`。`emptiedWaterMl` 只取非固餐排出中的水比例，不用总 `emptiedMl`，固餐排出不带水；`D` 在排空后才入胃，本轮不再排出。胃总 `volumeMl` 仍由原核心只扣一次原排空量，`waterVolumeMl` 是其中子集，不能加回总量。

多轮 `drink` 在 `mealQueue` 中增加水余量/每轮水切片；`eat` 的水切片恒为 0。旧队列没有水字段按 0 处理，不猜历史饮品。原 `motility.ts` 以 `trackWater: false` 调核心，保持旧自定义清单的输出形状和无 transfer 的独立加载行为；新入口用 `trackWater: true`。因此旧入口单独加载仍兼容，但“水链清单 → legacy 清单 → 水链清单”不是待释放水的无损迁移：legacy 推进既有 `mealQueue` 时会剥离切片的 `remainingWaterMl` / `rateWaterMl`，写回的历史形状也不含水字段；再切回 `hydration.ts` 时队列水按 0 计，不反推。正常旧档（从未运行过水链）升级到水链只补 0，不受影响。

### 3.2 小肠：只吸收轮初池

参数 `smallIntestine.absorption.halfTimeMin = 20 min`（`design`）：

```text
A = W_intestine,start × (1 - 2^(-dtMin / 20))
write.waterVolumeMl = W_intestine,start
write.absorbedWaterMl = A
transfer smallIntestine → bodyFluid: A
```

胃同轮转入的水在 transfer 阶段加入肠池，下一轮才参与吸收。20 min 是工程时间尺度；Péronnet 的 75–120 min 是表观完全吸收时间，不能当成小肠半时。

### 3.3 体液与肾请求

体液参数：`referenceVolumeMl = 30000 mL`、`deficitScaleMl = 500 mL`，均 `design`。初值水量等于参考量。

```text
waterDeficit = clamp((referenceVolumeMl - W_body,start) / deficitScaleMl, -1, 1)
U = clamp(kidney.urineProductionRequestMl, 0, W_body,start)
write.waterVolumeMl = W_body,start
transfer bodyFluid → bladder: U
```

肠吸收水在同一 transfer 阶段加入，不能用来支付本轮 `U`。`waterDeficit` 是本轮轮初水量的读出，下一轮才反映本轮吸收/产尿。

> **后续提示：** 活动—皮肤出汗薄切片在 `bodyFluid` 增加 `skin.sweatVolumeMl` 第二出口；运动相关呼吸失水薄切片再加入 `lungs.respiratoryWaterLossMl` 第三出口，当前按肾→肺→汗的工程顺序分配轮初水，三路合计不超过轮初水。本段保留当时的单出口设计口径，当前实现见 [`2026-11-23-activity-sweat-design.md`](./2026-11-23-activity-sweat-design.md) §5 与 [`2026-11-23-respiratory-water-loss-design.md`](./2026-11-23-respiratory-water-loss-design.md)「水转移与时序」。

肾脏不持有或转移水，只计算下一轮请求：

```text
A = max(0, hypothalamusAdh.relativeConcentration)
relativeRate = clamp(1 - adhGain × (A - 1), minRelativeRate, maxRelativeRate)
urineProductionRequestMl = baselineRateMlPerMin × dtMin × relativeRate
```

参数为 `baselineRateMlPerMin = 1`、`adhGain = 1`、`minRelativeRate = 0.25`、`maxRelativeRate = 2`，全为 `design`。初值请求为 0，第一轮后才有基线请求。该线性关系只固定“ADH 高则尿请求低”的方向，不是 Ota 或 Andersen 的拟合方程。Ota 的主队列是 5 名原发性甲减患者（另有 5 名正常对照），不能把正常对照的方向当成甲减组的反应，也不能把 30 min 尿段总量当瞬时尿流率。

### 3.4 下丘脑：ADH 与口渴分开

ADH 相对水平初值 1，参数 `timeConstantMin = 10`、`deficitGain = 1`、`relativeMinimum = 0`、`relativeMaximum = 3`，均 `design`：

```text
target = clamp(1 + deficitGain × waterDeficit, relativeMinimum, relativeMaximum)
nextADH = ADH + (1 - exp(-dtMin / timeConstantMin)) × (target - ADH)
```

一阶滞后提供工程反应延迟，不另建多轮队列；它不是血浆 AVP 浓度或分泌速率。口渴脚本无自身动态：

```text
thirst = clamp(50 mm + 50 mm × waterDeficit, 0, 100)
```

两个 50 都是 `design`。饮水只能在吸收改变体液后持续降低口渴；首段不建 Figaro & Mack 所述吸收前口咽缓解。

### 3.5 膀胱、尿意、排尿与不适代理

`postVoidResidualMl = 0 mL` 与 `involuntaryThresholdMl = 600 mL` 都是 `design`；0 mL 不是 ICS 给出的正常残余量，600 mL 也不是正常膀胱容量、临床诊断界值或失禁建模。每轮先读轮初体积 `V`，结算顺序如下：

```text
available = max(0, V - postVoidResidualMl)
若本轮至少一个 urinate：
  voluntaryVoidedMl = available
  involuntaryVoidedMl = 0
否则若 V > involuntaryThresholdMl：
  voluntaryVoidedMl = 0
  involuntaryVoidedMl = available
否则：
  voluntaryVoidedMl = involuntaryVoidedMl = 0

voidedMl = voluntaryVoidedMl + involuntaryVoidedMl
write.volumeMl = V - voidedMl
```

- 主动 `urinate` 优先；无论主动还是非自主，同轮只结算一次。多个不同 `urinate` 同轮也只排一次。
- 非自主排空只在**轮初体积严格大于** 600 mL 时触发，排到既有 `postVoidResidualMl`；600 mL 恰好不触发，低于或等于阈值且无 `urinate` 时 `voidedMl = 0`。它不是持续漏尿、不是夹紧到阈值，也不模拟逼尿肌/括约肌、正常排尿反射或临床尿失禁。
- 当轮体液新转入的尿在 write 后加入膀胱，不在本轮排出；下一轮才按新轮初量判断。主动排尿与非自主排空都不触发 `transfer`。
- 水账只累计 `voidedMl` 一次，不能把 `voluntaryVoidedMl` 与 `involuntaryVoidedMl` 再加一遍；两个分项只是本轮总排出量的拆分。

`interoception` 计算：

```text
urinaryUrgency = clamp(100 mm × bladder.volumeMl / 410 mL, 0, 100)
thirst = clamp(hypothalamusThirst.thirst, 0, 100)
excess(x) = clamp(100 × (x - 70) / (100 - 70), 0, 100)
discomfort = max(excess(hunger), excess(fullness), excess(thirst), excess(urinaryUrgency))
```

410 mL 参数为 `design`，只借 De Wachter & Wyndaele 交接的 SDV 测压量级作归一化参考；该数值是设计文档/主会话交接值，摘要未给出，原文表/图未复核，不能写成摘要已报告值。它不是自然排尿阈值，也不是人群正常值或个体标定。尿意读取轮初膀胱量，所以排尿后的低尿意和当轮新尿都在下一轮读出。70 mm 起始值同样是 `design`、`source: null`：感受 70 mm 仍为 0，85 mm 为 50，100 mm 为 100；`discomfort` 是“当前最强的不适感受”代理，不是疼痛评分、情绪、疾病严重度或四感受总分，也不触发通知。非自主排空与不适的完整设计与测试证据见 [`2026-11-22-overflow-discomfort-design.md`](./2026-11-22-overflow-discomfort-design.md)。

## 4. 存档、清单与幂等

- 根清单已加载 12 个部位脚本：原六个部位保留，但胃入口换成 `hydration.ts`；新增 `smallIntestine`、`bodyFluid`、`hypothalamusAdh`、`hypothalamusThirst`、`kidney`、`bladder`。三个 DI 样变体入口不在根清单，只通过复制清单并替换同 id 路径、配合独立 `statePath` 显式加载；默认清单与正常参数文件保持零变化。
- 旧存档由原初值合并补字段：旧胃水和旧队列水均为 0，不重置原胃总量/能量/固餐小计；新体液从参考量、新膀胱从 0 开始。已有 pending `drink` 按新动作语义入账，但不反推其入队前历史。
- 只加载旧 `stomach/motility.ts` 的自定义清单不需要小肠或膀胱，启动不应因 transfer 目标缺失而失败；其原体积、能量与固餐轨迹不变。该清单可独立运行，但不能作为水链存档的往返过渡：legacy 推进会剥离队列水身份，切回水链按 0 计（§3.1）。
- `body_act` 对 `urinate` 只要求 `type`，不要求体积、能量、餐型或时长。动作 ID 仍由 `sessionId + callId` 稳定生成；在动作记录仍被保留期间，同 callId 同载荷重试返回原回执，不产生第二个动作，同 callId 不同载荷返回 `409`。这份幂等只覆盖动作记录的保留期：Gateway 默认最多保留最近 2000 条已结束记录（`maxActionRecords`）且不超过 30 天（`actionRetentionMs`），排队与在途动作不裁剪；记录被裁剪后，同一 ID 会被当作新动作，不保留永久墓碑。Gateway 的整轮原子提交同时覆盖 write 与 transfer。

## 5. 证据边界与参数登记

以下来源都是 `results_seen`，只用于 `development` / `exploratory`，不得写成独立验证或 `validated`。完整人群、刺激、单位、采样时刻和原文定位已写入对应器官笔记与共享 `source-index.csv`；本表只摘边界。

| 来源 | 本设计只借什么 | 不能推出什么 |
| --- | --- | --- |
| Mudie 2014，DOI `10.1021/mp500210c`；健康 n=12，240 mL 白水，MRI mL，摘要 Results（全文 Methods Data Analysis、Results、Figs. 2–3 仅为交接定位，本仓库笔记仍按摘要级记录） | 胃排空时间尺度与小肠出现游离水的方向 | 13±1 min 不是吸收半时；摘要只写 T50%，未定义是相对饮前基线的增量减半还是峰值总量减半，起算点也未写；不能推出精确尾段 |
| Péronnet 2012，PMC3351614；健康男 n=36，300 mL D₂O，0/5/10/15/20/30/60 min 采血 | 吸收可在 5 min 检出、完整过程跨数十分钟的探索时间尺度 | 75–120 min 是表观完全吸收，不是肠段参数；20 min 半时仍属 design |
| Figaro & Mack 1997，DOI `10.1152/ajpregu.1997.272.6.R1740`；热运动脱水 n=6，cm VAS | 吸收前短暂解渴与持续补液可分开 | 不给通用增益/半衰期；首段不建该支路 |
| Ota 1994，DOI `10.1507/endocrj.41.99`；主队列 5 名原发性甲减患者（35–57 岁；T4 治疗前与治疗 ≥7 个月后各一轮）+ 5 名正常对照（20–30 岁）；20 mL/kg 自来水 45 min 内饮完；血浆 AVP pmol/L、尿流 mL/min（30 min 尿段）、2 h 水排泄率；Methods p.100、Results pp.101–103、Figs. 1/3/4 | 正常对照与治疗后甲功正常状态下，水负荷后 AVP 下降、尿量增加且尿变稀的方向 | 不能把主队列简称“健康 n=5”；甲减组 AVP 无下降、2 h 水排泄率 61.1% vs 正常对照 98.2%，不能当正常生理；没有可移植的时程或增益；AVP pmol/L ≠ `relativeConcentration`；尿渗 ≠ 血渗；30 min 尿段总量 ≠ 瞬时尿流率；不能拼通用曲线 |
| Andersen 1990，DOI `10.1152/ajpregu.1990.259.1.R53`；AVP 输注 | 肾反应可延迟 | 输注剂量轴不是血浓度；10 min 时间常数不是原文拟合 |
| De Wachter & Wyndaele 2003，DOI `10.1002/nau.10160`；摘要仅确认 15 名健康女学生，年龄、是否未产、FSF/FDV/SDV 数值与误差类型均未报告；同队列 ICS #32 未登记、未核对，不作为来源 | 410 mL 只作尿意归一化的 `design` 量级锚点（设计文档/主会话交接值，非摘要报告值） | 190/268/410 mL 原文表/图待核；不是摘要已报告值、不是人群正常值、不是自然排尿阈值；不把“无显著差异”当等效；不标定个体尿意；不能从摘要推出 410 的统计量或误差 |
| ICS 术语，DOI `10.1002/nau.10052`，§3.2.4 | 排前量 = 排出量 + 排后余量 | 没有规定正常残余；模型 0 mL 是 design |

两条口径按此固定：Ota 的研究对象是 5 名原发性甲减患者，5 名正常对照只是对照臂；De Wachter 的 410 mL 是交接的测压锚点，不是摘要事实，ICS #32 未登记、不能引用。任何 README、参数 note 或计划不得反过来写。阅读深度也不同：Ota 已核对全文的方法与结果页，De Wachter 只核对摘要；两者都是 `results_seen`，都不构成独立验证。

本轮新增方程的线性/一阶形式、初值和增益都是工程假设。参数文件必须保留 `unit`、`status`、`source`、`range`；`design` 不因引用论文而变成人体测量。对照前先按人群、刺激、测量、单位、时间原点和统计量判断可比性；不可比的数据只能作背景，不能放进同一张对照表或同一结论。即使模型方向与论文一致，`design` 仍是 `design`；没有拟合记录不得写 `fitted_dev`，没有独立验证不得写 `validated`。

## 6. 验收

1. **模块与守恒：** 同轮 write+transfer 不双扣；水只从非固餐胃内容物排出；小肠和体液只用轮初池支付；排尿不扣体液。对从同一存档累计提交、被胃动作接受的 `drink.volumeMl`（含仍在 `mealQueue` 的切片）逐轮核对：

   ```text
胃水 + 肠水 + (体液水 − 初始体液水) + 膀胱尿 + 累计排尿 + Σ stomach.mealQueue[i].remainingWaterMl = 累计饮水
   ```

   `Σ stomach.mealQueue[i].remainingWaterMl` 是尚未释放入胃的饮水切片（旧切片缺字段按 0，`eat` 切片为 0），必须计入；否则多轮 `durationMin` 饮水会把“已提交但未入胃”的水误判为丢失。`累计排尿` 是逐轮 `bladder.voidedMl` 之和，`膀胱尿` 是当前 `bladder.volumeMl`，其余为轮末快照值。允许浮点误差 `1e-6 mL`。`test/organs.water-gateway.test.mjs` 已覆盖单次 240 mL 与多轮 `durationMin: 3` 的队列余量（Task 11 Step 1，8/8 通过）。
2. **对照：** 从相同存档分别运行饮水 240 mL 与不饮水 120 轮；饮水组体液水更高、ADH 和口渴更低、肾请求更高，最终膀胱充盈与尿意更高。两组膀胱体积都远低于 600 mL 非自主阈值，因此该对照里没有自动排空；模型现在存在过度充盈非自主排空路径，见 §3.5。
3. **排尿：** 预置膀胱 250 mL，下一轮另有尿转入时提交 `urinate`；`voidedMl` 只含轮初 250 mL，当轮新尿留下。多个不同动作同轮也只排一次。下一仿真轮 `urinaryUrgency` 下降。非自主排空（轮初 >600 mL、无 `urinate`）与 `discomfort` 不在本项，由 overflow-discomfort spec §4 的测试覆盖。
4. **兼容：** 原 `motility.ts` 独立清单启动且原回归不变；旧根存档不猜历史水、不重置固餐；原白水/可乐体积能量轨迹不变。
5. **工具与实机：** `body_act` 接收 `urinate`（根清单已加载 `bladder`），`body_state` 可读 `interoception.thirst` / `urinaryUrgency` / `discomfort` 与膀胱的 `volumeMl` / `voidedMl` / `voluntaryVoidedMl` / `involuntaryVoidedMl`。用独立临时 `DSH_HOME` 的真实 DSH 会话执行结构化饮水和排尿，不能用 HTTP 冒烟替代。排尿生效且有同轮新尿后，在动作记录仍被保留时，重试同一 callId 应返回原 `applied` 回执，后续无第二次排出；体液只按正常肾转移变化。Task 10 已按本项完成主动排尿路径；该验收早于非自主排空与 `discomfort` 合并，非自主排空没有动作或回执，不在 Task 10 内。
6. **逐轮性能（实测）：** 用真实根清单当前 12 个部位（`stomach`、`stomachGhrelin`、`stomachSensory`、`duodenum`、`smallIntestine`、`bodyFluid`、`hypothalamusAdh`、`hypothalamusThirst`、`kidney`、`bladder`、`interoception`、`brainNotify`），在临时存档、固定 `now`、`autoTick:false` 下连续逐轮运行。记录轮数、总耗时、单轮 p50/p95（预热单列）、`parts` 与完整存档的 JSON 字节数在起点/中点/终点的值及增长来源；空载与饮水负载分列。尺寸稳定就写稳定值与观察窗口，不要编造增长趋势。优化前必须有基线，优化后同环境同轮数复测。不得用 12 个部位的结果声称几十个模块的性能；两位数以上模块是设计目标，要写更多规模就另建清单实测。Task 11 曾在非自主排尿、`discomfort` 与 DI 变体合并前按上述口径实测（2026-11-22），这些数字是历史基线，当前 HEAD 尚未重测；基线与证据见 §8。
7. **论文对照（先对照后调参）：** 每个有论文来源的参数或方程先列可比性表：来源、人群/n、刺激、测量、单位、时间原点、统计量、原文定位、模型对应量。只有同口径数据才能对照；模型输出与论文值的方向、量级、差异要记录，不能只挑一致项。`design` 保持 `design`；没有拟合记录不得写 `fitted_dev`，没有独立验证不得写 `validated`；`results_seen` 不得称独立验证。本轮对照记录见 §7；当前没有新参数完成拟合或独立验证，所有新参数仍是 `design`，拟合或独立验证若需要另开任务。
8. 最终运行一次 `npm test`，并核对 `git status` 无测试临时文件。离线自洽不等于临床验证；真实会话验收完成前，文档只写“代码/离线验收已实现”。

## 7. 论文可比数据对照记录（Task 12）

**证据来源与边界。** 本节记录 2026-11-22 由 agent-122 在真实 Gateway 上完成的 240 mL、300 mL、1400 mL 三组对照结论，以及本任务对七类来源、参数状态和未解决边界的核对。这里的“真实 Gateway”是进程内/HTTP 的真实 Gateway 运行，不是 Task 10 要求的真实 DSH 会话；本仓库未保存原始运行日志，本节只转录结论。三组对照都只能算 `results_seen` / `development`，不构成独立验证，也不支持“整体符合论文”的结论。

### 7.1 可比性表

| 来源 | 人群 / n | 刺激 | 测量与单位 | 时间原点 / 采样 | 统计量 / 定位 | 模型对应量 | 可比性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mudie 2014 `SRC-MUDIE-2014` | 健康成人 12；年龄、性别未报告 | 240 mL 白水一次饮下，隔夜空腹 | MRI 胃水、小肠水与 >0.5 mL 水袋，mL | 饮前基线 + 饮后 2 h 间隔扫描；摘要报告饮后 12 min 小肠峰值与 45 min | mean；只有 35 ± 7 明确 SEM，其余 ± 类型未逐项标注；摘要 Results | `stomach.waterVolumeMl`、`smallIntestine.waterVolumeMl` | 部分可比：同 240 mL 白水、空腹；但模型没有 35 mL 静息胃水、43 mL 空腹小肠池，T50 定义未核 |
| Péronnet 2012 `SRC-PERONNET-2012` | 健康年轻男性 36；25.4 ± 4.0 岁 | 300 mL 含 D₂O 水，约 1 min 喝完，隔夜空腹 | 血浆/血细胞 D/H（ppm）与原文拟合的 ta½、Tmax；mL/min | 饮下开始；0/5/10/15/20/30/60 min 采血 + 9 天尿 | mean ± SD；Table 2、Fig. 1、Discussion | `smallIntestine.absorbedWaterMl`、累计吸收与峰值时刻 | 不可直接比：D₂O 血浆示踪 ≠ 肠腔水；ta½ 10.9/12.9 min 不是模型 20 min；只有时间尺度与平均吸收率可作量级对照 |
| Ota 1994 `SRC-OTA-1994` | 主队列 5 名原发甲减（T4 治疗前后各一轮）+ 5 名正常对照 | 20 mL/kg 自来水，45 min 内喝完 | 血浆 AVP pmol/L、尿流 mL/min（30 min 尿段）、2 h 水排泄率 | 09:00 起 45 min 负荷；血 10:00/10:30/11:30；尿每 30 min × 5 | mean ± SEM；Methods p.100、Results pp.101–103、Figs. 1/3/4 | `bodyFluid.waterDeficit`、`hypothalamusAdh.relativeConcentration`、`kidney.urineProductionRequestMl` | 不可比：模型无 AVP pmol/L、无尿渗、无 30 min 段；负荷远大于 240/300 mL；主队列是甲减患者 |
| Andersen 1990 `SRC-ANDERSEN-1990` | 健康志愿者；n 摘要未报告 | 20 mL/kg 水负荷 + AVP 1/5/25 pg·min⁻¹·kg⁻¹ 输注 120 min | 尿流 mL/min、CH₂O mL/min、Uosm mosmol/kgH₂O | 输注开始；尿样收集间隔未报告 | mean；± 类型未逐项标注；摘要 Results | `kidney.urineProductionRequestMl` 的基线与相对速率 | 不可比：输注剂量轴 ≠ 血浆 AVP 浓度；模型无 Uosm/CH₂O；基线 1 mL/min 与水利尿 12.2 mL/min 不同量级 |
| De Wachter & Wyndaele 2003 `SRC-DEWACHTER-2003` | 15 名健康女学生；年龄、是否未产未报告 | 排尿日记 + 充盈性膀胱测压 | FSF/FDV/SDV 时膀胱体积 mL | 测压充盈开始；具体充盈速率、介质温度、体位未报告 | 摘要未给数值与误差类型；摘要 + 主会话交接锚点 190/268/410 mL | `bladder.volumeMl` → `interoception.urinaryUrgency` | 仅锚点：410 mL 是 `design` 归一化参考，不是摘要报告值、人群正常值或自然排尿阈值 |
| Figaro & Mack 1997 `SRC-FIGARO-1997` | 热运动脱水健康成人 6；年龄、性别未报告 | 三种复水方式（自由饮水 / 鼻胃管注水 / 饮水同时抽出） | 口渴 cm VAS、血浆 AVP pg/mL、Posm mosmol/kgH₂O | 复水 75 min；采样间隔未报告 | 摘要 Results；± 类型未标注 | `hypothalamusThirst.thirst` | 不可比且未建：cm VAS ≠ 0–100 mm；首段不建口咽解渴支路 |
| ICS 2002 `SRC-ABRAMS-2002` | 术语共识；无受试者 | 不适用 | 定义与术语 | 不适用 | §3.2.4 | `bladder.postVoidResidualMl = 0` | 仅术语可比：排前量 = 排出量 + 排后余量；ICS 没有规定正常残余 |

### 7.2 已完成的同口径输出与差异

下表只记录 agent-122 交接的模型输出与论文值的差异；没有重跑，也没有把未记录的量补猜成输出。“模型输出”列的口径由该对照定义，不能把不同量强行画在同一轴上。

| 对照 | 模型同口径输出 | 论文值 | 判断 |
| --- | --- | --- | --- |
| Mudie 240 mL | 胃水 T50 约 13 min，由 `stomach.emptying.halfTimeMin = 13` 直接复现；45 min 尾部与小肠空腹池未拟合 | T50 13 ± 1 min、空腹小肠水 43 ± 14 mL（两处 ± 类型均未逐项标注）；饮后 45 min 胃水回到 35 mL 基线 | T50 是参数复现，不是拟合或验证；摘要未定义 T50 基准，不能保证与模型同义；模型没有 35 mL 静息胃水与 43 mL 空腹小肠池，45 min 尾部不复现 |
| Péronnet 300 mL | 平均吸收率 3.53 mL/min；Tmax 25 min | 平均吸收率 3.3–4 mL/min；血浆 D/H 平均峰值 20 min、个体峰值 15–60 min | 两个数都落在原文范围内，但只是量级/时间窗对照：模型 Tmax 不是血浆 D₂O 的 Tmax，3.53 也不是对 D₂O 曲线的拟合；20 min 半时不能改称 ta½ |
| Ota 20 mL/kg（按 70 kg 约 1400 mL） | 大负荷下尿量与尿流时程明显不匹配 | 2 h 水排泄率 98.2 ± 2.2%（正常对照）、61.1 ± 5.1%（甲减）；尿流按 30 min 尿段 | 不可比且不匹配：模型没有 AVP pmol/L、尿渗、30 min 尿段或 45 min 分次饮入；不能据此调参或声称复现 |
| Andersen AVP 输注 | 尿流明显不匹配 | 水利尿基线 12.2 ± 1.7 mL/min；5 pg·min⁻¹·kg⁻¹ 降至 0.9 ± 0.3 mL/min | 不可比且不匹配：模型基线 1 mL/min、相对速率上限 2，既到不了水利尿基线，也没有输注剂量轴或尿渗输出 |
| Figaro 口咽支路 | 未建 | 复水最初 5 min 内口渴与 AVP 已下降 | 未建，不能对照；模型口渴只随吸收后的 `waterDeficit` 变化 |
| De Wachter / ICS | 410 mL 只作尿意归一化锚点；残余 0 mL | 摘要未给 190/268/410；ICS 只给“排前量 = 排出量 + 排后余量” | 仅锚点/术语，不是人群正常值、自然排尿阈值或已验证残余量 |

按当前参数上界做一次量级核对（`derived`，不是 agent-122 运行输出）：`baselineRateMlPerMin = 1`、`maxRelativeRate = 2`，饮后 2 h 经肾请求转入膀胱的水量最多约 240 mL；Ota 正常对照 2 h 水排泄率为 98.2%，按 1400 mL 负荷约 1375 mL。两者相差约 5.7 倍，且时间原点还有“负荷结束后 2 h”与“饮后 2 h”的差别；这足以说明 1400 mL 情景不能写成与 Ota 相符，但不足以反推任何增益。

### 7.3 范围决策与参数状态

论文差异用于划定模型边界，不自动生成实现待办。是否补机制仍按“谁读它、证据是否足够、是否值得增加状态和逐轮复杂度”判断；当前首段只保留日常饮水到主动排尿的水量账本与方向性调节。

- **Mudie：** T50 是摘要所称的 half emptying time（T50%），但摘要没有定义是“高于饮前基线的增量减半”还是“峰值总量减半”，也没有写起算点。模型的 13 min 只是参数复现；45 min 回到 35 mL 基线、空腹小肠 43 mL 池与小肠 12/45 min 曲线都没有拟合。当前没有读取这些精确曲线的消费者，不为此增加胃慢相或小肠双隔室；将来若有 MRI 曲线级验收需求再单独立项。
- **Péronnet：** 模型没有血浆 D₂O 示踪、分布容积或 ta½ 拟合；20 min 是小肠吸收的 `design` 半时，不能因为 3.53 落在 3.3–4 mL/min 内就改称 ta½ 或 `fitted_dev`。平均吸收率与 Tmax 的对照只支持时间尺度/量级的探索性判断，不追加示踪隔室。
- **Ota 与 Andersen：** 大负荷（20 mL/kg，约 1400 mL）和 AVP 输注下的尿流明显不匹配，当前模型不能用于这些场景。只调肾增益或上限会掩盖渗透压、电解质、尿渗和输注剂量轴的缺失，因此本轮不拟合；未来确有这些场景需求时，应先补相应体液状态与证据，再设计肾模型。
- **Figaro & Mack：** 吸收前口咽解渴是明确非目标，不列入后续实现。它只有短暂体感消费者，现有摘要证据不足以给出通用增益和衰减；新增状态与参数会增加复杂度，却不改善首段水量守恒、吸收后口渴或主动排尿。
- **De Wachter 与 ICS：** 410 mL 只是交接的 `design` 归一化锚点，摘要未报告 190/268/410，原文表/图未复核；0 mL 残余是 `design`，ICS 只给恒等式，没有规定正常残余。当前只作代理，不继续追逐个体阈值拟合。
- **参数状态：** 所有新参数仍是 `design`；本节没有把任何参数升级为 `fitted_dev` 或 `validated`。三组对照都是 `results_seen`，只能标 `development` / `exploratory`；不能写成“整体符合论文”，也不能替代 Task 10 的真实 DSH 会话验收。Task 11 曾单独完成当时的 12 部位性能基线（见 §8；那是历史基线，早于非自主排尿/不适/DI），与本节的论文对照无关。

## 8. 逐轮性能历史基线（Task 11，早于非自主排尿、不适与 DI 变体）

**这是历史基线，不是当前版本性能。** Task 11 测量时的仓库 HEAD 是 `dd1f66b`，早于膀胱过度充盈非自主排空、`interoception.discomfort` 与 DI 样变体的合并；下面所有数字只描述那次测量，当前 HEAD 尚未按同一口径重测。写入当前实现状态、README 或 AGENTS 时必须保留这个时间边界，不能把这些数字冒充当前版本性能。

**结论。** 当时根清单 12 个部位在 Apple M1 / Node v26.9.0 上单轮 p50 为 0.447–0.471 ms、p95 为 0.537–0.584 ms，只占 60 秒轮预算的约 0.0008%（约 13 万分之一）。空载与 240 mL 饮水两种负载的差异在 A/B 噪声范围内，没有随轮数增长的可复现变慢；预热后状态尺寸没有随轮数净增长，饮水组的固定增量来自 1 条保留的已应用动作记录和 1 个通知会话。没有可复现瓶颈，按计划 Task 11 Step 5 不提出优化、不改代码。这只是当时 12 个部位的实测，不能外推到几十个模块，也不能外推到当前 HEAD。

**证据路径。** `/tmp/dsh-body/task11-perf.XUzopi/`（仓库外，未入库）：`baseline.md` 为人读基线表；`summary.json` 为四个运行的完整聚合；`runs/{idle-a,drink-a,idle-b,drink-b}/result.json` 为单次原始结果，同名目录下的 `body-state.json` 为该运行终点提交存档；`bench.mjs`、`summarize.mjs` 为基准与汇总脚本；`water-gateway-test.log` 为 Task 11 Step 1 的测试输出；`repo-status-after.txt` 为当轮结束时 `git status --short`（41 条，与开始一致）。临时证据目录可能被清理，长期引用时以本节的数字为准。

### 8.1 环境与方法

| 项 | 值 |
| --- | --- |
| 机器 | Apple M1，8 逻辑 CPU，8 GiB 内存 |
| 系统 / Node | darwin 24.6.0 / arm64；Node v26.9.0，V8 14.6.202.34-node.32 |
| 仓库 | HEAD `dd1f66b`，41 条未提交条目（测量轮未改动仓库）；该 HEAD 早于非自主排尿、`discomfort` 与 DI 变体合并 |
| 根清单 | `body-modules.json`，12 条部位脚本 + 1 个启动脚本，sha256 `3497d3e7e40c3a8629be7fcf2855d562befd1c87006facf90382589010feb1d3` |
| 启动 | 真实 `startGateway()`；`port: 0`；`autoTick: false`；`now: () => 0`；`heartbeatIntervalMs: 60000` |
| 存档 | 每个运行独立临时 `statePath`，初始为 `emptyCheckpoint(0)` |
| 轮次 | 每组 120 轮预热（单列）+ 1200 轮正式测量；每组两个独立进程 A/B |
| 计时 | `process.hrtime.bigint()` 包住 `await gateway.tick()`；含 Worker heartbeat、write/transfer、整轮存档校验与 `writeFileSync`+`rename` 提交 |
| 分位 | 排序后线性插值；max 为实测单轮最大值 |
| 负载 | 空载：无动作。饮水：真实 `body_act` 提交 `{ type: "drink", volumeMl: 240, energyKcal: 0 }`（带 sessionId），在测量窗口第 1 轮（7200→7260 s）应用 |

### 8.2 正式测量（1200 轮/运行）

| 运行 | 负载 | 总耗时 wall ms | tick 累计 ms | mean ms | p50 ms | p95 ms | p99 ms | max ms | 失败 | 已提交轮 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| idle-a | 空载 | 545.4 | 544.7 | 0.454 | 0.447 | 0.537 | 0.619 | 0.785 | 0 | 1200 |
| drink-a | 240 mL | 578.8 | 578.2 | 0.482 | 0.471 | 0.584 | 0.688 | 0.950 | 0 | 1200 |
| idle-b | 空载 | 593.3 | 592.6 | 0.494 | 0.461 | 0.582 | 0.807 | 10.552 | 0 | 1200 |
| drink-b | 240 mL | 566.3 | 565.6 | 0.471 | 0.457 | 0.559 | 0.719 | 4.405 | 0 | 1200 |

A/B 合并（只对 mean 做加权平均；p50/p95 给区间，不伪造合并分位）：

- **空载**：2400 轮，tick 累计 1137.3 ms，mean 0.474 ms；p50 0.447–0.461 ms，p95 0.537–0.582 ms。
- **240 mL 饮水**：2400 轮，tick 累计 1143.8 ms，mean 0.477 ms；p50 0.457–0.471 ms，p95 0.559–0.584 ms。

四个运行合计 4800 正式轮、0 失败，终点 `simulatedSeconds = 79200 = 60 × 1320`（含 120 轮预热）。预热（120 轮，单列）p50 为 0.477–0.512 ms、p95 为 0.690–0.733 ms、max 为 1.899–2.090 ms，均高于正式段，说明预热确有必要。

### 8.3 状态尺寸与增长来源

| 负载 | 阶段 | simulatedSeconds | `parts` B | 存档 JSON B | 存档文件 B | actions | pending | notifications | mealQueue | notify sessions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 空载 | fresh | 0 | 688 | 1077 | 1078 | 0 | 0 | 0 | 0 | 0 |
| 空载 | start | 7200 | 814 | 1206 | 1207 | 0 | 0 | 0 | 0 | 0 |
| 空载 | mid | 43200 | 800 | 1193 | 1194 | 0 | 0 | 0 | 0 | 0 |
| 空载 | end | 79200 | 740 | 1133 | 1134 | 0 | 0 | 0 | 0 | 0 |
| 240 mL | fresh | 0 | 688 | 1077 | 1078 | 0 | 0 | 0 | 0 | 0 |
| 240 mL | start | 7200 | 814 | 1793 | 1794 | 1 | 1 | 0 | 0 | 0 |
| 240 mL | mid | 43200 | 1154 | 2093 | 2094 | 1 | 0 | 0 | 0 | 1 |
| 240 mL | end | 79200 | 1126 | 2065 | 2066 | 1 | 0 | 0 | 0 | 1 |

`存档文件 B = 存档 JSON B + 1`（提交文件末尾换行）。两个 A/B 运行的尺寸逐字节相同，说明状态轨迹确定。`fresh` 是 Gateway 启动并补齐 12 个部位后、预热前的存档；`start` 是预热后（饮水组已入队但尚未应用）。

- **固定增量（一次性，不随轮数增长）**：饮水组从 start 到 end 的逐部位字节变化为 `brainNotify` +176 B、`stomach` +82 B、`smallIntestine` +41 B、`stomachSensory` +21 B、`kidney` −14 B、`interoception` +5 B、`bodyFluid` +1 B。`brainNotify.sessions` 从 0 个会话变为 1 个（+176 B），因为 `body_act` 带 sessionId；`actions` 保留 1 条已应用 drink 记录，之后保持 1 条。
- **浮点位数效应**：胃水、小肠水、`stomachSensory.mechanical`、`interoception.thirst` 等在 0 与非零小数之间切换，JSON 文本长度变化几十到一百多字节，不是累积增长；空载组从 start 到 end 反而减少 74 B。
- **没有增长**：`mealQueue` 在单次饮水后为 0；`pendingActionIds` 在动作应用后为 0；`notifications` 两组均为 0（没有触发提醒，也没有 ACK 泵运行）；`actions` 始终 1 条（饮水组）/ 0 条（空载组）。

测量窗口为 1200 轮 × 60 s = 20 小时仿真；连同预热终点为 79200 s。完整存档在该窗口内约 1.05–2.05 KiB。

### 8.4 水账本与负载完整性

- 空载两进程：相对测量起点的账本中点与终点均为 0.000000000 mL（误差 1.71e-11），期望 0 mL。
- 饮水两进程：相对测量起点的账本中点 240.000000000 mL（误差 1.38e-11）、终点 240.000000000 mL（误差 6.34e-11），期望 240 mL；终点 `voidedMl = 0`（未提交 urinate）。该次运行早于非自主排空合并；240 mL 远低于 600 mL 阈值，所以“无自动排尿”在当时和现在都应成立，但新代码未在该运行中执行，不能据此声称当前 HEAD 的水账已实测。
- 饮水回执 `body-aac9e4478f49c8da0ed77d2ebd1c5ede` 在 `appliedAtSimulatedSeconds = 7260` 变为 `applied`，证明测量窗口内确实执行了饮水负载，而不是只提交了动作。
- Task 11 Step 1 的多轮队列补测：`node --test test/organs.water-gateway.test.mjs` → 8 pass / 0 fail（两次单跑 789 ms / 774 ms）。其中 `a 3-round drink keeps its pending queue water in the ledger every round` 用 240 mL / `durationMin: 3` 验证前 3 轮队列水 `[160, 80, 0]`、120 轮逐轮账本误差 ≤ 1e-6 mL；旧队列缺水字段按 0，混合餐水与非水分账，`urinate` 单轮一次与同轮新尿留下均通过。

### 8.5 解释边界

- 这是共享机器，后台负载存在：四个运行首尾 1/5/15 分钟 loadavg 均为 4.31/4.91/6.46；A/B 的 p50 差异约 0.014 ms、p95 差异约 0.05 ms，因此结论按区间报告，不取单点。
- 单轮 max 受 OS 调度/GC 影响出现离群：idle-b 10.55 ms、drink-b 4.41 ms；p99 仍 ≤ 0.81 ms。**max 不代表稳态**，不要用单轮最大值描述常规轮耗时。
- 中点/终点读取并解析存档发生在 tick 计时之外，但可能给相邻轮次带来一次 I/O/GC 抖动；A/B 重复与 p50/p95 的稳定性表明该影响可忽略。
- `now` 固定为 0，`wallTimeMs` 不推进；这只影响存档里的墙钟字段与动作保留时间判定。测量窗口 20 小时仿真仍短于 30 天动作保留期，因此 1 条已应用动作记录保留与真实运行一致。
- 这是单进程直接调用 `gateway.tick()` 的成本，不是 HTTP 请求、DSH 会话、通知投递泵或真实 60 秒调度的端到端延迟；后者不在本基线内。
- 12 个部位是当前根清单的验收覆盖，不是性能上限。没有实测几十个模块，不能据此外推，也不能据此声称两位数模块的性能。

## 9. Task 10 真实 DSH 会话验收记录（2026-11-22）

**范围。** 用独立临时 `HOME`、`DSH_HOME`、cwd 与复制清单，在本地 OpenAI 兼容 SSE 测试模型上建立真实 DSH 会话；所有动作只经真实 `body_act`，HTTP 仅用于 GET 取证。A/B 由同一 seed 字节复制，各 30 轮（1800 仿真秒）；U 组用同一 seed 预置膀胱 250 mL（测试设定，不是模型输出）。证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`（仓库外，未入库），完整清单与逐步结果见计划 Task 10 结果记录。**这次验收早于非自主排尿、`discomfort` 与 DI 变体合并**：它只覆盖主动 `urinate` 路径；无动作且 >600 mL 的非自主排空、膀胱分项字段、`discomfort` 与任何 DI 清单都不在内。

| 项 | 结果 |
| --- | --- |
| 全量回归 | 仓库根 `npm test` 三次运行均 230 tests / 230 pass / 0 fail（duration 2199–2253 ms） |
| 会话 | A `session-08ce3cef-17f6-4a70-97cb-a58842347f2d`；B `session-1f85eb43-ae43-4897-ad94-c7742d9935d4`；U `session-b5ed8209-52b3-41c9-95f6-15a813f5bf16` |
| 饮水动作 | `body-dc4298509bf6e84f744208113a1419c1`，202 queued → sim 60 applied |
| A/B 同仿真时长 | 1800 / 1800 s；初始 `parts` 相同（sha256 `0e25f28258b6aa329937e242e7cb040dee5fdfcdfc9c4321f8a0374143d05a77`） |
| 终末方向 | 体液 30052.826 / 29971.339 mL；缺水代理 -0.100410 / 0.055386；ADH 0.946801 / 1.036011；口渴 45.245 / 52.672 mm；肾请求 1.048791 / 0.965823 mL；膀胱 29.300 / 28.661 mL；尿意 6.892 / 6.754 mm（A/B）；全部符合 §6.2 |
| 水账本误差 | A `-1.506e-12 mL`；B `+2.434e-12 mL`，均 ≤`1e-6 mL` |
| 排尿 | `body-4f16e12396cec6f32968b2d158d57019`，202 queued（effectiveAt 120）→ sim 120 applied；`voidedMl=250`、膀胱余 1.0 mL（同轮新尿）、尿意 60.976 mm；sim 180 `voidedMl=0`、膀胱 2.0 mL、尿意 0.2439 mm |
| 幂等/冲突 | 同 sessionId+callId 同载荷重试 → 200、原 applied ID、`attempts=0`，仍只有一条动作记录；同 callId 异载荷 → 409 |
| 排尿残差 | 逐轮 `(体液增量)+(膀胱增量)+voided` 最大 `0`（sim 0→300） |
| 收尾 | mock、watcher、三个 DSH 进程已停止；任务端口 65181–65184 无监听 |

**边界。** 这次真实会话只覆盖 30 轮 A/B 与水链/排尿链，并且发生在非自主排尿、`discomfort` 与 DI 变体合并之前；它不能验证这些后加功能。120 轮长时程仍由 `test/organs.water-gateway.test.mjs` 的离线/真实 Gateway 测试覆盖，未在真实 DSH 会话中重跑。通知投递、重启补算、睡眠、大负荷利尿（Ota/Andersen 仍不匹配）和口咽解渴（Figaro 未建）不在本次验收内，不能写成已验证。`logs/aborted-ab/` 与 `logs/aborted-u1/` 是流空闲超时和测试设定修正前的非验收尝试，未计入上表。所有新参数仍为 `design`；本记录不改变 §7 的论文对照边界，也不构成临床验证。
