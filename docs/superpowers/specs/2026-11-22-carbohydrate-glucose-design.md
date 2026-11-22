# 碳水摄入、胃排空、小肠吸收与血糖薄切片设计

**状态：** 已实现并完成离线验收（2026-11-22）。用户已授权直接继续器官/功能，并明确同一 JSON 存档中的状态交互即可分阶段交付，不要求本轮形成提醒或动作闭环；具体拆分与工程参数是本轮设计决策。最终实现、测试、审查修正与验证结果见 [`2026-11-22-carbohydrate-glucose.md`](../plans/2026-11-22-carbohydrate-glucose.md)；真实 DSH 会话、独立生理数据验证和完整 M2 仍未验收/未实现。

**后续（2026-11-23）：** 胰腺相对信号与肾糖质量排泄两个薄切片已接入，根清单当前 15 部位、18 份参数文件；本设计保留当时的 13 部位与离线验收记录。

## 1. 目标与边界

建立可逐轮检查的最小碳水链：

```text
eat / drink.carbohydrateG
  → stomach 碳水记账与既有胃排空
  → smallIntestine 碳水吸收
  → glucose 表观分布池质量与浓度读数
```

当前交付是各部位在同一存档中的可复用状态和 `body_state` 读数。后续肾脏等器官可以按轮初快照读取浓度，但本轮不声称这些下游关系已经接入。

**后续更新（2026-11-23）：** `pancreasEndocrine` 与 `kidneyGlucose` 已接入：胰腺按轮初浓度写相对信号，葡萄糖按该信号缩放非肾表观清除；肾糖按轮初请求把 `glucoseMassG` 转成 `excretedGlucoseG`（g，不换尿水）。完整水/碳水闭包为 `hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose` 六部位。通知策略另行扩展为饥饿、饱满、口渴与尿意四类，`lastKind` 可为 `thirst`，逐信号 `levels` 独立门控，与糖链无读写耦合。

- `carbohydrateG` 是可消化吸收碳水的克数，模型统一按葡萄糖当量处理；不是总碳水、膳食纤维或糖醇的完整营养模型。
- 碳水质量与既有体积、能量并列记账，不能从 `volumeMl` 或 `energyKcal` 反推，也不校验 `4 kcal/g`，因为动作能量是独立输入且未建营养成分模型。
- 保持同一部位单写者、轮初快照、整轮 write+transfer 原子提交。小肠碳水逻辑并入现有唯一写者，不新增第二个小肠脚本。
- 固定参考值只代替尚未建立的体重、分布体积、基础血糖与表观清除边界；参数写明单位、状态、来源和未来替换点。

### 非目标

本轮不建胰岛素、胰高血糖素、肝糖输出、糖原、组织摄取分区、蛋白质/脂肪、消化酶、碳水类型差异、粪便损失、肾糖排泄、渗透性利尿、口渴或饥饿反馈。不自动进食、饮水或排尿，不把离线方向一致称为人体验证。

**后续更新：** “肾糖排泄”已作为 g 质量汇接入；仍不建尿糖/尿水换算或渗透性利尿。口渴提醒是独立通知策略，不改变本设计的糖链边界。

## 2. 方案取舍

### 选择：有真实状态推进的碳水—血糖薄切片

扩展现有胃和小肠写者，新增一个葡萄糖表观分布隔室。胃复用既有固/非固餐排空，小肠复用一阶吸收形式，葡萄糖池采用固定分布体积与高于基线时的一阶表观清除。改动可独立测试，也给后续器官留下明确读取契约。

### 不采用：只插入固定血糖值

只能得到一个静态读数，不能描述进食后的变化，也不能检查胃—肠—体液之间的质量转移，不符合本轮推进器官关系的意图。

### 暂缓：同时加入激素、肝糖与肾糖利尿

这些机制需要额外状态、证据和守恒边界。尤其葡萄糖排泄量到尿水量的换算缺乏可靠依据；本轮不为了形成行为闭环而加入该假设。

**后续更新：** 肾糖已按独立 g 质量汇接入，未建立葡萄糖到尿水量的换算；激素与肝糖仍暂缓。

## 3. 输入与兼容

`drink` 与 `eat` 都新增可选 `carbohydrateG`：缺省为 `0 g`；提供时必须是有限数且 `>= 0`。无效碳水值使整条摄入动作无效，与现有体积、能量和时长规则一致，不能只丢掉碳水而保留其余摄入。

- `body_act` schema 暴露该字段，说明单位是克、表示可消化葡萄糖当量碳水；原动作 ID、会话幂等与异步回执不变。
- 旧动作、旧胃状态和旧队列切片没有碳水字段时按 `0 g`，不猜历史成分。
- 旧 `stomach/motility.ts` 独立入口保持原输出形状且不产生碳水 transfer；根清单使用的水链入口同时跟踪水与碳水。legacy 轮次可以剥离队列的碳水元数据，不支持借 legacy 清单往返保存待释放碳水。
- 新部位旧档补齐时从固定基础质量开始，不反推升级前饮食。重启后保留已提交质量，不重新初始化。
- 本轮不猜既有场景的食物成分；需要碳水时由动作显式提供。

## 4. 状态、字段与唯一写者

以下字段均为 `absolute`。每轮通量不是累计量；固体碳水是胃总碳水的子集，不能再与总量相加。

| 部位 / 写者 | 字段 | 单位与含义 | 读取方 |
| --- | --- | --- | --- |
| `stomach` / `stomach/hydration.ts` 与共享 `motility-core.ts` | `carbohydrateG` | g；轮末胃内可消化碳水，transfer 源 | `smallIntestine.carbohydrateG` |
| 同上 | `solidCarbohydrateG` | g；其中按固餐组排空的子集 | 仅胃自身 |
| 同上 | `emptiedCarbohydrateG` | g/轮；本轮胃向小肠的碳水通量读数 | 验收/状态读取 |
| 同上 | `mealQueue[].remainingCarbohydrateG`、`rateCarbohydrateGPerRound` | g、g/轮；尚未释放和每轮释放的碳水 | 仅胃自身 |
| `smallIntestine` / 现有 `water-absorption.ts` | `carbohydrateG` | g；轮末肠腔碳水，接收胃并转向葡萄糖池 | `glucose.glucoseMassG` |
| 同上 | `absorbedCarbohydrateG` | g/轮；本轮吸收通量读数 | 验收/状态读取 |
| `glucose` / `human-compartments/glucose/glucose.ts` | `glucoseMassG` | g；表观分布池总质量，含基础量，不是直接测得的全身葡萄糖 | 小肠 transfer 目标；后续器官可读取 |
| 同上 | `concentrationMgDl` | mg/dL；轮初质量换算的血浆葡萄糖浓度代理读数 | `body_state`；未来调节模块 |
| 同上 | `disposedGlucoseG` | g/轮；本轮表观清除汇，不区分组织去向 | 质量账/状态读取 |

**后续更新：** 肾糖接入后，`disposedGlucoseG` 只表示非肾表观清除；肾糖实际通量单独记在 `kidneyGlucose.excretedGlucoseG`。`concentrationMgDl` 的读取方已包括 `pancreasEndocrine` 与 `kidneyGlucose`。

`glucose` 是隔室而不是新解剖器官，放在 `organs/human-compartments/glucose/`。这里借 Dalla Man 2007 的定义，把质量解释为“血浆 + 快速平衡组织”的可及池葡萄糖，把体积解释为按体重归一化的表观分布体积；不是血浆体积、瘦体重归一化、总体水或实测全身葡萄糖。根清单新增该部位，部位总数由 12 变为 13；不改变现有部位 ID。后续加入胰腺与肾糖后当前为 15 部位；13 是本设计交付时的数字。

transfer 配对：

```text
stomach.carbohydrateG       → smallIntestine.carbohydrateG  (g)
smallIntestine.carbohydrateG → glucose.glucoseMassG          (g)
```

**后续更新：** 肾糖接入后增加第三条配对 `glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG`（g）；完整清单必须同时加载 `kidneyGlucose`，缺部位在启动时报 transfer 配对错误。

## 5. 离散更新与轮次语义

Gateway 每轮先应用 write，再应用 transfer。下游不能使用同轮上游新流入支付本轮需求。

### 5.1 胃

设轮初胃总碳水为 `C`，固餐碳水小计为 `Cs`，非固餐碳水为 `Cn = C - Cs`。沿用核心本轮非固餐体积排出量 `E_nonSolid`、非固餐体积 `N` 和固餐排出比例 `f_solid`：

```text
Ecn = N > 0 ? E_nonSolid × Cn / N : 0
Ecs = Cs × f_solid
Ec  = Ecn + Ecs
```

本轮队列和新动作释放的碳水为 `D`，其中固餐为 `Ds`。write 与 transfer 的顺序要求：

```text
write.carbohydrateG       = C + D
write.solidCarbohydrateG  = Cs - Ecs + Ds
write.emptiedCarbohydrateG = Ec
transfer stomach → smallIntestine: Ec
```

总碳水由 Gateway 在 transfer 时扣除；固体小计只能由胃脚本预先写成扣除后的值，否则小计不会随 transfer 下降。最终满足 `0 <= solidCarbohydrateG <= carbohydrateG`，非固餐小计由两者之差隐含表示。

多轮摄入的碳水按既有轮数均分，最后一轮释放全部余量；队列结束判断也必须考虑碳水余量。`mixed` 继续属于既有“非固餐小计”组，本轮不拆混合餐内的固体成分。无对应非固餐体积时不凭碳水质量虚构排空体积。

### 5.2 小肠

参数 `smallIntestine.carbohydrateAbsorption.halfTimeMin = 20 min` 为 `design`：

```text
A = C_intestine,start × (1 - 2^(-dtMin / 20))
write.carbohydrateG = C_intestine,start
write.absorbedCarbohydrateG = A
transfer smallIntestine → glucose: A
```

本轮胃新转入的碳水下一轮才吸收。水吸收字段、参数与 transfer 保持原样；`20 min` 碳水半时不能借水吸收论文冒充实测值。

### 5.3 葡萄糖表观分布池

固定参数：

| 参数 | 默认值 | 状态与替换点 |
| --- | ---: | --- |
| `glucose.referenceBodyMassKg` | 75 kg | `design`；未建个体体重，未来由身体预设/个体输入替换 |
| `glucose.distributionVolumeDlPerKg` | 1.88 dL/kg | `design`，来源 `SRC-DALLAMAN-2007`；未来由更完整葡萄糖分布模型替换 |
| `glucose.baselineConcentrationMgDl` | 90 mg/dL | `design`；工程基线，不是个体空腹测量 |
| `glucose.apparentDisposalHalfTimeMin` | 60 min | `design`；未来由胰岛素、葡萄糖效能和组织利用模型替换 |

```text
V = referenceBodyMassKg × distributionVolumeDlPerKg       // dL
B = baselineConcentrationMgDl × V / 1000                  // g
M = max(0, glucoseMassG,start)
concentrationMgDl = M × 1000 / V
D = max(0, M - B) × (1 - 2^(-dtMin / apparentDisposalHalfTimeMin))
write.glucoseMassG = M - D
write.disposedGlucoseG = D
```

小肠 transfer 随后把 `A` 加入 `glucoseMassG`。浓度是**轮初质量读数**，所以在接收新吸收的当轮仍显示旧浓度，下一轮才上升；它与轮末含新 transfer 的质量不要求当轮恒等。后续肾等读取方还会再晚一轮看到该读数。

**后续更新（2026-11-23）：** `apparentDisposalHalfTimeMin = 60 min` 的语义是 `I = 1` 的基线；胰腺接入后清除指数按轮初 `I = pancreasEndocrine.insulinRelative`（缺省 1）缩放：

```text
D = max(0, M − B) × (1 - 2^(-dtMin × I / 60))
M_after = M − D
X = min(max(0, R), M_after)
```

`R` 是轮初 `kidneyGlucose.excretionRequestG`（缺省 0）。肾糖在非肾清除之后结算；write 出 `M_after` 后再 transfer `X` 到 `kidneyGlucose.excretedGlucoseG`。同轮小肠新流入不能支付本轮请求。

清除只作用于高于固定基础质量的部分。低于基线时保持原质量，不虚构肝糖补充；因此基础值是初始量与清除下限，不是主动维持的血糖稳态。初始 `glucoseMassG = B`，`concentrationMgDl = baselineConcentrationMgDl`，`disposedGlucoseG = 0`。

## 6. 质量账

在外源碳水进入前处于默认基础质量 `B`、参数不变的运行中，每次 committed 快照满足：

```text
累计摄入碳水
= stomach.carbohydrateG
+ Σ mealQueue.remainingCarbohydrateG
+ smallIntestine.carbohydrateG
+ (glucose.glucoseMassG - B)
+ 累计 disposedGlucoseG
```

`stomach.solidCarbohydrateG` 和每轮 `emptiedCarbohydrateG` / `absorbedCarbohydrateG` 不另加，避免重复。浮点误差容差为 `1e-6 g`。

这是模型外源碳水的工程守恒账，不是完整人体碳平衡。基础葡萄糖来自初始条件，表观清除是聚合汇；未记录分子转化、组织分区或内源葡萄糖生成。

**后续更新：** 肾糖接入后质量账增加 `+ 累计 kidneyGlucose.excretedGlucoseG`；`excretionRequestG` 不累计，`disposedGlucoseG` 仍只记非肾清除。容差仍为 `1e-6 g`。

## 7. 证据与参数纪律

Dalla Man 2007（`SRC-DALLAMAN-2007`，DOI `10.1109/TBME.2007.893506`）的 p.1741 §III.A 与式 (1) 将 `G_p` 定义为血浆和快速平衡组织中的质量，将 `V_G` 定义为按体重计的分布体积；p.1743 Table I 的正常组模型值为 `1.88 dL/kg`。这是 204 名正常人均值数据所建平均模型中的常数，原文没有报告该常数单独的估计/固定方法、精度或个体间离散度。因此它只作 `design` 锚点，不是 204 人直接实测均值，也不支撑个体预测或验证。

分布体积来源登记到 `organs/human-organs/references/source-index.csv`，在葡萄糖隔室目录保留一篇一份的笔记，记录上述人群、单位、统计量和模型定义。固定基线、75 kg、60 min 清除和 20 min 吸收都不是该文报告值；原文的 `k_abs` 也不能直接当作本模型肠腔碳水消失半时。

胃碳水随既有体积分组排出、小肠一阶吸收、固定基线/体重/清除半时均为工程假设。现有胃排空与水吸收证据只支撑各自原范围，不能自动变成葡萄糖吸收或清除证据。没有独立验证来源，不标 `validated`；没有拟合，不标 `fitted_dev`。

## 8. 验收

1. **模块契约：** 缺省碳水为 0；非法碳水使整条动作无效；固/非固餐排空比例正确；多轮队列不丢尾量；胃固体小计随 transfer 正确下降；小肠只吸收轮初池；葡萄糖清除只高于基线且输出 JSON-safe。
2. **真实 Gateway 逐轮链：** 从同一初始存档做有碳水/无碳水 A/B，保持体积、能量、餐型和时长相同。验证入胃、胃排空、肠吸收、浓度延迟上升与回落的轮次；无碳水组维持基线。
3. **守恒：** 单次和多轮摄入逐轮核对 §6，误差不超过 `1e-6 g`；固体子集不重复计数，重启后继续守恒。
4. **兼容：** 原水账、胃体积/能量轨迹、legacy 清单、旧档补字段、动作幂等与既有通知测试不回归。根清单 13 个部位和新增运行时文件均在发布范围内。
5. **工具：** `body_act` 接受合法 `carbohydrateG`，拒绝负数和非有限数；`body_state` 可读新字段。真实 Gateway 测试不等于真实 DSH 宿主验收。
6. **验证：** 先运行定向测试证明新测试在实现前失败，再运行完整 `npm test` 与 `git diff --check`。不沿用旧 12 部位性能数字；本轮若不另做性能实测，不声称当前 13 部位性能。

**后续更新（2026-11-23）：** 加入胰腺与肾糖后当前 15 部位；13 部位及原验收记录保留，新增部位已由后续集成测试覆盖。

## 9. 尚未实现与后续替换

- 血糖尚未驱动肾脏、饥饿、口渴或其他调节；新增读数不是已完成的下游生理反馈。
- 胰/肝与组织利用仍是固定边界，正常餐后曲线、疾病状态和个体差异常未验证。
- 真实 DSH 会话投递、长期运行、更多餐型和独立数据集对照不在本轮验收内。
- 未来若有明确下游需求，再分别设计血糖→肾糖/水交换或激素调节，不能直接用未登记的固定系数拼接。

**后续更新（2026-11-23）：** 血糖已驱动 `pancreasEndocrine` 相对信号与 `kidneyGlucose` 请求；仍不驱动体感、胃排空、口渴或自动行为。肾糖只作 g 质量汇，不产生尿水。完整胰岛素浓度/分泌、胰高血糖素、肝糖输出、糖原、组织摄糖分区与渗透性利尿仍未实现。真实 DSH、临床与独立数据验证仍未做。
