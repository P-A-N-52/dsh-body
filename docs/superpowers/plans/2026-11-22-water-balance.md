# 饮水吸收与主动排尿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本次由用户启用 Swarm；任务 1–7 可按独占文件范围并行，任务 8 等接口全部落地后集成，主代理统一验收。

**状态：** Tasks 1–9 已落地（代码、离线/真实 Gateway 测试与现状文档）；Task 10 已完成（2026-11-22：`npm test` 230/0；独立临时 HOME/DSH_HOME + 本地 OpenAI SSE 测试模型 + 真实 `body_act`；相同初态 30 轮 A/B 对照与排尿重试/409 均通过，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）；Task 11 已完成（多轮水账本补测 `test/organs.water-gateway.test.mjs` 8/8，以及当前 12 部位逐轮性能基线，见 Task 11 结果记录与 spec §8）；Task 12 的论文可比数据对照已记录（spec §7；240/300/1400 mL 真实 Gateway 对照，只支持 `development` / `exploratory`，未拟合、未验证），Task 12 已勾选，但大负荷利尿（Ota 20 mL/kg、Andersen AVP 输注）仍不匹配、口咽解渴（Figaro）支路未建，不能写成整体符合论文。复选框仍只在对应代码、测试、证据或文档实际存在时勾选。

**Goal:** 在不重做固餐排空的前提下，接通饮水→胃→小肠→体液→肾请求→膀胱→主动排尿，并经现有 DSH 工具读出口渴和尿意。

**Architecture:** 三个 `io.transfer` 配对搬水，各源部位先 write 转出前基准，再由 Gateway 在轮末统一扣账。胃新入口复用原动力核心且保留同 id；肾只写下一轮需求，下丘脑 ADH/口渴分脚本，膀胱只储尿和主动排尿。

**Tech Stack:** Node ≥ 22.18、ESM、可擦除 TypeScript、`node:test`；无第三方依赖。

**Spec:** [`2026-11-22-water-balance-design.md`](../specs/2026-11-22-water-balance-design.md)

## Global Constraints

- 一轮 60 仿真秒；用 `io.dt`，所有模块读同一轮初快照，整轮原子提交。
- 每个量只有一个写入者；`io.write` 写完整部位。先 write、后 transfer，源水量不得预先扣除本轮 transfer。
- 所有 `drink.volumeMl` 记为水，`eat` 不反推水；胃总排空体积不等于水量。
- 小肠吸收和体液转膀胱只使用轮初池；排尿不再次扣体液，当轮新尿不在同轮排出。
- 不改 Gateway 操作层，不增加工具、通知、自动排尿、口咽解渴、渗透压、RAAS、睡眠或排便。
- 所有新数值参数 `status: "design"`；论文只支持注明的方向/时间尺度，不称独立验证。
- 性能按实测：真实根清单至少当前 12 个部位逐轮运行，记录耗时与状态尺寸增长；不凭感觉优化，不声称未测的更多模块性能。
- 论文对照先于调参：先列可比性（人群、刺激、测量、单位、时间原点、统计量、定位）；`design` 不因方向一致升级为 `fitted_dev`/`validated`。
- 旧 `motility.ts` 必须可独立加载；根清单不能同时加载两个 `stomach`。
- 按用户要求，实施 worker 不提交、不推送、不改 DSH 配置/凭据/真实存档；测试只用临时目录。派工沿用子代理默认模型，不切换模型或改模型配置。

## Review Focus

1. 旧胃及旧 `mealQueue` 缺水字段：应补 0、保留原总量和固餐轨迹，由任务 1 与 8 的旧档测试 pinning。
2. write 后又 transfer：不得双扣胃/肠/体液，由任务 1–3 的逐轮水量断言及任务 8 的真实 Gateway 守恒测试 pinning。
3. 同轮新流入：不得支付本轮吸收、产尿或排尿，由任务 2、3、5 的“新流入留下”测试 pinning。
4. 同轮多个及重试 `urinate`：每轮最多按轮初量排一次，同 callId 不产生新动作，由任务 5、8、10 pinning。
5. 代理与量纲：不得出现血浆渗透压、尿渗换算或 AVP pmol/L 输出，由任务 4、6、7、9 的字段/文档核对 pinning。
6. 性能：Task 11 用真实根清单 12 个部位逐轮实测，记录耗时与状态尺寸增长；不得把 12 个部位的结果外推到未测规模。
7. 论文对照：Task 12 先列可比性表，再谈方向或差异；`design` 不得写成 `fitted_dev`/`validated`。

---

### Task 1: 胃动力核心与水链入口

**Files:**
- Create: `organs/human-organs/stomach/motility-core.ts`
- Create: `organs/human-organs/stomach/hydration.ts`
- Modify: `organs/human-organs/stomach/motility.ts`
- Modify: `test/organs.motility.test.mjs`
- Test: `test/organs.hydration.test.mjs`

**Interfaces:**
- Produces: `advanceStomach(prev, actions, dt, simulatedSeconds, { trackWater = false } = {})`，返回 `{ state, emptiedNonSolidMl, deliveredWaterMl }`。
- Produces: `hydration.ts` 导出 `id = "stomach"`、原动作类型、原初值加 `waterVolumeMl: 0` / `emptiedWaterMl: 0`。
- Produces: `stomach.waterVolumeMl.transferOut = ["smallIntestine.waterVolumeMl"]`；小肠任务声明反向配对。

- [x] **Step 1: 写胃水失败测试。** 固定 240 mL 无能量 `drink` 第一轮 `waterVolumeMl=240`、`emptiedWaterMl=0`；第二轮 `emptiedWaterMl = 240 × (1-2^(-1/13))`，write 的水量仍是转出前的 240。预置非固餐 300 mL 中水 150 mL，另有不参与水账本的固餐，断言水排出恰为非固餐排出的一半。多轮 240 mL/3 min 饮水每轮只加 80 mL 水；`eat` 的 `liquid` / `mixed` 加水 0。
- [x] **Step 2: 写兼容失败测试。** 旧胃 `waterVolumeMl` 缺失按 0；旧队列缺 `remainingWaterMl` / `rateWaterMl` 不产水。原 `motility.ts` 的 fields 不含 transfer，且 `trackWater:false` 时新队列不增加水元数据；现有固/液、体积/能量断言保持原值。
- [x] **Step 3: 运行 RED。** `node --test test/organs.motility.test.mjs test/organs.hydration.test.mjs`，预期找不到 `hydration.ts` 或水字段为 undefined。
- [x] **Step 4: 抽核心并实现新入口。** 原 `motility.ts` 仅保留模块契约和调用核心；核心完整保留当前 parse、队列、固/液排空算法。水跟踪开启时才给新队列写 `remainingWaterMl` / `rateWaterMl`，并返回 `deliveredWaterMl`。`hydration.ts` 按 Spec §3.1 写转出前水基准、记录 `emptiedWaterMl` 并请求 transfer；不得再扣总 `volumeMl`。
- [x] **Step 5: 运行 GREEN。** 同 Step 3 命令全部通过，尤其原 200 轮体积/能量守恒与固餐交错测试不调整物理预期。

### Task 2: 小肠水吸收

**Files:**
- Create: `organs/human-organs/small-intestine/water-absorption.ts`
- Create: `organs/human-organs/small-intestine/water-absorption.parameters.json`
- Test: `test/organs.small-intestine.test.mjs`

**Interfaces:**
- Consumes: `stomach.waterVolumeMl` 的同轮 transfer。
- Produces: `smallIntestine.waterVolumeMl`，同时声明来自胃的 `transferIn` 与到 `bodyFluid.waterVolumeMl` 的 `transferOut`。
- Produces: `absorbedWaterMl` 每轮读数；参数 `smallIntestine.absorption.halfTimeMin = 20 min`。

- [x] **Step 1: 写失败测试。** 轮初肠水 100 mL、dt 60 s 时 `A=100×(1-2^(-1/20))`；write 的肠水仍为 100，transfer 请求为 A，`absorbedWaterMl=A`。模拟同轮胃再转入 20 mL 后，最终肠水为 `100-A+20`，且 A 不因这 20 mL 增大。
- [x] **Step 2: 运行 RED。** `node --test test/organs.small-intestine.test.mjs`，预期模块不存在。
- [x] **Step 3: 实现。** 按 Spec §3.2 一阶吸收，只从轮初水计算 A；参数文件写 `design` / `SRC-PERONNET-2012` / `[1,120]`，注释明确 20 min 不是论文报告值。脚本头部写 PMC3351614 的采血时点、人群与表观动力学边界。
- [x] **Step 4: 运行 GREEN。** 同 Step 2 命令通过，并检查 200 轮无新流入时 `现存+累计吸收` 守恒到 `1e-6 mL`。

### Task 3: 体液隔室与肾产尿请求

**Files:**
- Create: `organs/human-compartments/body-water/water.ts`
- Create: `organs/human-compartments/body-water/water.parameters.json`
- Create: `organs/human-organs/kidney/urine-production.ts`
- Create: `organs/human-organs/kidney/urine-production.parameters.json`
- Test: `test/organs.body-water.test.mjs`
- Test: `test/organs.kidney.test.mjs`

**Interfaces:**
- Consumes: `smallIntestine.waterVolumeMl`、`hypothalamusAdh.relativeConcentration`。
- Produces: `bodyFluid.waterVolumeMl` 接收肠水并声明到 `bladder.volumeMl` 的 transfer；`bodyFluid.waterDeficit`。
- Produces: `kidney.urineProductionRequestMl`，初值 0；膀胱任务声明体液→膀胱反向配对。

- [x] **Step 1: 写体液失败测试。** 轮初体液 30000 mL、请求 100 mL、同轮肠转入 200 mL：write 体液仍为 30000，转出 100，最终 30100；本轮 request 不因肠流入改变。请求大于轮初可用量时钳到可用量，不制造 fatal。`waterDeficit` 按轮初量计算。
- [x] **Step 2: 写肾请求失败测试。** dt 60 s 时 ADH 0.5 / 1 / 2 分别产生 1.5 / 1 / 0.25 mL 请求；初值请求为 0。肾脚本没有 transfer 调用，也不写体液或膀胱。
- [x] **Step 3: 运行 RED。** `node --test test/organs.body-water.test.mjs test/organs.kidney.test.mjs`，预期模块不存在。
- [x] **Step 4: 实现。** 按 Spec §3.3 写字段、transfer 和参数：`bodyFluid.referenceVolumeMl=30000`、`deficitScaleMl=500`；`kidney.urine.baselineRateMlPerMin=1`、`adhGain=1`、`minRelativeRate=0.25`、`maxRelativeRate=2`。全部 `design`；肾脚本头引用 Ota Methods p.100/Figs.1/3/4 只支撑方向，写明主队列为 5 名甲减患者 + 5 名正常对照，不把 30 min 尿段当瞬时速率。
- [x] **Step 5: 运行 GREEN。** 同 Step 3 命令通过；断言体液+膀胱+累计排出在没有主动排尿时守恒。

### Task 4: 下丘脑 ADH 与口渴双脚本

**Files:**
- Create: `organs/human-organs/brain/hypothalamus-adh.ts`
- Create: `organs/human-organs/brain/hypothalamus-adh.parameters.json`
- Create: `organs/human-organs/brain/hypothalamus-thirst.ts`
- Create: `organs/human-organs/brain/hypothalamus-thirst.parameters.json`
- Test: `test/organs.hypothalamus.test.mjs`

**Interfaces:**
- Consumes: `bodyFluid.waterDeficit`（正为缺水，负为水过多，范围 -1…1）。
- Produces: `hypothalamusAdh.relativeConcentration`，初值 1。
- Produces: `hypothalamusThirst.thirst`，初值 50 mm。

- [x] **Step 1: 写失败测试。** `waterDeficit=-0.6` 时 ADH target 0.4，dt 60 s、τ10 min 后 `next=1+(1-exp(-0.1))×(0.4-1)`；口渴为 20 mm。`waterDeficit=1` 时 ADH target 2、口渴 100 mm。缺失输入按 0，口渴基线 50；两脚本互不写对方部位。
- [x] **Step 2: 运行 RED。** `node --test test/organs.hypothalamus.test.mjs`，预期模块不存在。
- [x] **Step 3: 实现。** ADH 参数 `timeConstantMin=10`、`deficitGain=1`、`relativeMinimum=0`、`relativeMaximum=3`；口渴参数 `baselineMm=50`、`deficitGainMm=50`，全部 `design`。脚本头写 Ota（主队列 5 名甲减患者 + 5 名正常对照）/Andersen 只支撑方向和延迟；口渴脚本写 Figaro & Mack 的 5 min 口咽缓解未纳入，不把输出当实测 VAS。
- [x] **Step 4: 运行 GREEN。** 同 Step 2 命令通过，并断言水分增加只降低 ADH/口渴，不直接产生动作或通知。

### Task 5: 膀胱主动排尿与工具动作

**Files:**
- Create: `organs/human-organs/bladder/storage.ts`
- Create: `organs/human-organs/bladder/storage.parameters.json`
- Modify: `tools.js`
- Test: `test/organs.bladder.test.mjs`
- Test: `test/tools.urinate.test.mjs`

**Interfaces:**
- Consumes: `bodyFluid.waterVolumeMl` transfer；动作 `{ type: "urinate" }`。
- Produces: `bladder.volumeMl`（含 transferIn）、`voidedMl`；`actionTypes=["urinate"]`。
- Produces: `body_act` 的 type 枚举含 `urinate`，其余两个工具及 ID 生成方式不变。

- [x] **Step 1: 写膀胱失败测试。** 轮初膀胱 250 mL，一个 `urinate` 后 write 体积 0、`voidedMl=250`；模拟同轮转入 40 mL 后最终膀胱 40，而非 0。空动作轮 `voidedMl=0`。同轮两个不同 urinate 也只排 250，不排两次，不调用 transfer。
- [x] **Step 2: 写工具失败测试。** 用 fake gateway 调 `body_act.execute({type:"urinate"})`，不需要体积/能量/餐型/时长；载荷 ID 与 drink/eat 一样由 sessionId+callId 生成，fake 回执原样返回。同参数同 callId 的 digest 相同。
- [x] **Step 3: 运行 RED。** `node --test test/organs.bladder.test.mjs test/tools.urinate.test.mjs`，预期模块不存在或工具返回 type 校验错误。
- [x] **Step 4: 实现。** `postVoidResidualMl=0 mL`（`design`，source null）；用 `io.actions.some` 使每轮最多排一次。工具在 drink/eat 的体积校验前接受 urinate，更新描述，但不改 `buildActionPayload`、工具数量或输出 schema。
- [x] **Step 5: 运行 GREEN。** 同 Step 3 命令通过。

### Task 6: 体感增加口渴与尿意

**Files:**
- Modify: `organs/human-organs/brain/interoception.ts`
- Modify: `organs/human-organs/brain/interoception.parameters.json`
- Modify: `test/organs.interoception.test.mjs`

**Interfaces:**
- Consumes: `hypothalamusThirst.thirst`、`bladder.volumeMl`。
- Produces: `interoception.thirst`、`interoception.urinaryUrgency`（均 0–100 mm 代理）；原 hunger/fullness 公式不变。
- Parameter: `interoception.urinaryUrgency.referenceVolumeMl=410 mL`，`design` / `SRC-DEWACHTER-2003`。

- [x] **Step 1: 写失败测试。** 无输入时四字段为 hunger 50、fullness 0、thirst 50、urinaryUrgency 0；thirst 输入 20 原样读出；膀胱 205 mL 时尿意 50，410 mL 时 100，过度充盈钳 100。原机械/饥饿素/营养用例的 hunger/fullness 数值全部不变。
- [x] **Step 2: 运行 RED。** `node --test test/organs.interoception.test.mjs`，预期新字段缺失。
- [x] **Step 3: 实现。** 按 Spec §3.5 增加读取、钳位、字段声明与参数；不改 `brainNotify`，不把 mm 当物理长度或膀胱压力。脚本头写 190/268/410 mL 是特定测压队列的交接锚点、原文表图待核，410 不是自然阈值。
- [x] **Step 4: 运行 GREEN。** 同 Step 2 命令通过。

### Task 7: 证据笔记与共享登记

**Files:**
- Modify: `organs/human-organs/references/source-index.csv`
- Modify: `organs/human-organs/stomach/references/notes/mudie-2014.md`（只按已有全文交接补正，不重新猜值）
- Create: `organs/human-organs/small-intestine/references/notes/peronnet-2012.md`
- Create: `organs/human-organs/brain/references/notes/figaro-1997.md`
- Create: `organs/human-organs/kidney/references/notes/ota-1994.md`
- Create: `organs/human-organs/kidney/references/notes/andersen-1990.md`
- Create: `organs/human-organs/bladder/references/notes/de-wachter-2003.md`
- Create: `organs/human-organs/bladder/references/notes/abrams-2002.md`

**Interfaces:**
- Produces: `SRC-PERONNET-2012`、`SRC-FIGARO-1997`、`SRC-OTA-1994`、`SRC-ANDERSEN-1990`、`SRC-DEWACHTER-2003`、`SRC-ABRAMS-2002`，供参数和脚本注释引用。

- [x] **Step 1: 读取既有三组调研交接。** 只核对主会话 agent-86/87/88 已取得的原文链接和定位，不大范围重搜；不能把未见全文升格为 fulltext_read。
- [x] **Step 2: 写逐篇笔记。** 每篇列人群、样本量、刺激、测量、单位、时间原点、采样时刻、统计量、图表/Methods 定位、能与不能支持的内容。特别保留 D₂O 表观吸收、AVP 剂量轴、30 min 尿段、测压尿意和 ICS 残余量边界。
- [x] **Step 3: 登记来源。** ID/citekey 与上述文件一致，全部 `results_seen` 和 `development` 或 `exploratory`；缺失字段写 NA 及原因，不猜 PMID、单位或统计量。Mudie 的 ± 类型若全文交接确认 SEM，写明定位；否则保留原未标注口径。
- [x] **Step 4: 自查。** 对照 Spec §5，每个代码引用 ID 恰好有登记和笔记，没有把 design 写成 reported/validated。

### Task 8: 根清单与真实 Gateway 集成

**Files:**
- Modify: `body-modules.json`
- Modify: `test/organs.gateway.test.mjs`
- Modify: `test/organs.modules.test.mjs`
- Modify: `test/parameters.test.mjs`
- Modify: `test/dsh.tools.test.mjs`
- Test: `test/organs.water-gateway.test.mjs`

**Interfaces:**
- Consumes: 任务 1–6 的全部字段与 transfer 配对。
- Produces: 根清单 12 个部位；capabilities 中 `urinate: ["bladder"]`。

- [x] **Step 1: 写集成失败测试。** 根清单启动后所有 12 个部位存在；旧 `motility.ts` 单独临时清单仍可启动。旧根存档的胃总量/能量/固餐小计保持，水字段补 0；新隔室/膀胱只补初值。
- [x] **Step 2: 写同起点对照与守恒测试。** 两份相同 checkpoint 分别提交 240 mL drink 和无动作，跑 120 轮。逐轮对饮水组核对 Spec §6.1 的水量恒等式（误差 1e-6）；本步只覆盖单次 240 mL，多轮 `durationMin` 饮水的 `mealQueue` 余量由 Task 11 补测。终点断言饮水组体液更高、ADH/口渴更低、肾请求/膀胱/尿意更高，且两组累计排尿均为 0。另验证总胃体积仍包含非水内容，不能把 `emptiedMl` 累成饮水量。
- [x] **Step 3: 写排尿集成测试。** 预置膀胱 250 mL、肾请求 40 mL，提交 urinate 后 `voidedMl=250`、膀胱 40；重放同一动作 ID 不新增 pending，下一轮无第二次排尿。两个不同 urinate 同轮也只排一次。用真实工具读 `interoception` 和 `bladder`。
- [x] **Step 4: 运行 RED。** `node --test test/organs.gateway.test.mjs test/organs.water-gateway.test.mjs test/dsh.tools.test.mjs`，预期根清单缺新部位、urinate 无 handler 或字段断言失败。
- [x] **Step 5: 集成。** 根清单用 `stomach/hydration.ts` 替换 `motility.ts`，加入小肠、体液、下丘脑双脚本、肾和膀胱；保持十二指肠营养暴露及原通知脚本。参数测试列表加入六份新参数文件；模块测试同时覆盖旧胃入口和新入口。
- [x] **Step 6: 运行 GREEN。** 同 Step 4 命令通过；随后 `node --test test/organs.motility.test.mjs test/organs.hydration.test.mjs test/organs.small-intestine.test.mjs test/organs.body-water.test.mjs test/organs.kidney.test.mjs test/organs.hypothalamus.test.mjs test/organs.bladder.test.mjs test/organs.interoception.test.mjs` 全通过。

### Task 9: 当前行为文档

**Files:**
- Create: `organs/human-organs/small-intestine/README.md`
- Create: `organs/human-compartments/body-water/README.md`
- Create: `organs/human-organs/kidney/README.md`
- Create: `organs/human-organs/bladder/README.md`
- Modify: `organs/human-organs/stomach/README.md`
- Modify: `organs/human-organs/duodenum/README.md`
- Modify: `organs/human-organs/brain/README.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`

- [x] **Step 1: 写器官/隔室文档。** 每个脚本列 id、功能标签、读入、产出、单位、时间原点、参数与未建模项。明确三个 transfer 的 write 顺序、旧档水=0、饮料体积近似、ADH/口渴分工、尿意非膀胱激素、残余 0 是 design。
- [x] **Step 2: 扫旧文案。** 十二指肠不再被描述为整个水吸收实现；脑 README 加两个下丘脑脚本和体感新字段，但通知仍只有饥饿/饱满。工具文档把 body_act 改为 drink/eat/urinate，queued/applied 语义不变。
- [x] **Step 3: 更新现状。** 根 README、AGENTS 和 virtual-body 把 M1 实机验收写为已有证据的完成项；M3 水链写代码、离线/真实 Gateway 测试与根清单接入状态，实机结果已由 Task 10 完成并补记（30 轮 A/B + 排尿重试/409）。AGENTS 更新 12 个部位/参数文件与体液隔室例外，保留固餐契约，不重写历史 P0/P1 计划。
- [x] **Step 4: 对照 Spec 自查。** 不把设计目标写成已实机验收，不把任何新参数写成 validated；无消费者字段、未建口咽解渴和渗透压必须明示。

### Task 10: 全量回归与真实 DSH 验收

**Files:**
- Evidence only: 独立临时目录下的日志、模型请求、会话事件与 checkpoint；不提交测试产物。

- [x] **Step 1: 全量回归。** 在仓库根目录运行 `npm test`，预期 0 fail；随后 `git status --short`，删除本轮测试生成且不需要的文件，不触碰用户存档。
- [x] **Step 2: 建立隔离实机。** 使用独立临时 HOME、DSH_HOME、cwd、port 0/临时 HTTP 端口、显式 statePath 和复制清单；连 help/schema 命令也不使用默认 DSH_HOME。用受支持的本地 OpenAI SSE 测试模型建立真实会话，不通过 HTTP 提交动作代替 `body_act`。
- [x] **Step 3: 饮水/不饮水实机对照。** 两个相同初态分别用结构化 `{type:"drink",volumeMl:240,energyKcal:0}` 与无摄入运行同一仿真时长；经 `body_state` 核对水链、口渴、ADH、肾请求和尿意方向及质量守恒，不用自然语言估算份量。
- [x] **Step 4: 排尿重试实机。** 在膀胱有轮初存量且下一轮有新尿转入时，用真实 `body_act` 提交 `{type:"urinate"}`；记录 queued→applied、voidedMl、排后新尿。用同 sessionId+callId 同载荷重试，应返回原 applied ID；后续轮次不出现第二次 voidedMl，体液不因重试额外下降。对照同 callId 不同载荷仍 409。
- [x] **Step 5: 收尾核对。** 停止本次启动的临时进程，确认相关测试端口无监听；保留日志路径供交接。只在证据齐全后勾选本任务并更新文档实机状态；不提交、不推送，最终回报测试数、会话/动作 ID、守恒误差和未验边界。

**结果记录（2026-11-22）：** 在独立临时 `HOME`/`DSH_HOME`/cwd 与本地 OpenAI 兼容 SSE 测试模型上完成；所有动作只经真实 `body_act`，HTTP 仅 GET 取证。证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`（仓库外，未入库）：`logs/{a-main,b-main,u1-urinate,u2-retry,u3-conflict}.jsonl`、`logs/state-watch-{ab,u}.jsonl`、`logs/receipts.jsonl`、`logs/capabilities.jsonl`、`logs/analysis.{md,json}`、`mock/mock-log.jsonl` 与 `mock/requests/`（U）、`logs/evidence-ab/mock-log.jsonl` 与 `logs/evidence-ab/requests/`（A/B）、`state/{a,b,u}/body-state.json`、`config.json`。

- **Step 1：** 仓库根 `npm test` 三次运行均 230 tests / 230 pass / 0 fail（duration 2199–2253 ms）；`git status --short` 保持 41 条，与开工一致，未新增仓库测试临时文件。
- **Step 2：** 独立临时 `HOME`、`DSH_HOME`、cwd；复制 `body-modules.json` 到任务目录并 symlink `organs/`、`startup/`、`lib/`；三个 profile（m3a/m3b/m3u）分别显式绑定 body 端口与 `statePath`；本地 SSE 模型监听任务端口 65181。`llm-pi-ai` 测试 provider 显式设 `streamIdleTimeoutMs: 2400000`（仅临时 profile，规避 5 min 流空闲超时）。真实会话：A `session-08ce3cef-17f6-4a70-97cb-a58842347f2d`、B `session-1f85eb43-ae43-4897-ad94-c7742d9935d4`、U `session-b5ed8209-52b3-41c9-95f6-15a813f5bf16`。
- **Step 3：** A/B 由同一 seed 字节复制（`parts` sha256 `0e25f28258b6aa329937e242e7cb040dee5fdfcdfc9c4321f8a0374143d05a77`，`wallTimeMs` 相同），各 30 轮、同一 `simulatedSeconds=1800`。A 的 drink 回执 202 queued → `body-dc4298509bf6e84f744208113a1419c1` 在 sim 60 applied；B 无动作。最终 A/B：胃水 51.131/0、肠水 106.743/0、体液 30052.826/29971.339、缺水代理 -0.10041/0.055386、ADH 0.94680/1.03601、口渴 45.245/52.672、肾请求 1.04879/0.96582、膀胱 29.300/28.661、尿意 6.892/6.754 mm；方向全部符合 spec §6.2。账本误差 A `-1.506e-12 mL`、B `+2.434e-12 mL`，均 ≤`1e-6 mL`。
- **Step 4：** U 组 seed 预置膀胱 250 mL（测试设定，不是模型输出）；等一轮正常尿流后提交真实 `body_act {type:"urinate"}`。回执 202 queued（`effectiveAt=120`）→ `body-4f16e12396cec6f32968b2d158d57019` applied at sim 120：`voidedMl=250`、膀胱余 `1.0 mL`（同轮新尿）、尿意 60.976 mm；下一轮 sim 180 `voidedMl=0`、膀胱 2.0 mL、尿意 0.2439 mm。同 sessionId+callId 同载荷重试返回 200 与原 applied ID（`appliedAtSimulatedSeconds=120`，`attempts=0`），checkpoint 仍只有一条动作记录，sim 120→300 无第二次 void；同 callId 异载荷（加 `volumeMl:999`）返回 409，现有动作不变。逐轮 `(体液增量)+(膀胱增量)+voided` 残差最大 `0`（sim 0→300）。
- **Step 5：** 已停止 mock、watcher 与三个 DSH 进程；端口 65181–65184 均无监听；未提交、未推送。边界：真实会话只覆盖 30 轮（1800 s）A/B 与水链/排尿链，不覆盖 120 轮真实会话、通知投递、重启补算、睡眠、大负荷利尿（Ota/Andersen 不匹配）或口咽解渴（Figaro 未建）；这些不能由本任务写成已验证。`logs/aborted-ab/` 与 `logs/aborted-u1/` 是超时/测试设定修正前的非验收尝试，未计入上述结论。

### Task 11: 多轮水账本补测与真实根清单逐轮性能基线

**Files:**
- Modify: `test/organs.water-gateway.test.mjs`
- Evidence only: 临时目录中的 benchmark 日志/JSON；不提交测试产物。
- 本任务只测量与补测，不改生理脚本；如基线显示可复现瓶颈，另开代码任务并保留基线。

**Interfaces:**
- Consumes: 根 `body-modules.json`（12 个部位）、`gateway.tick()`、`gateway.getState()` 或 `GET /state`。
- Produces: 多轮队列水恒等式测试；含耗时与状态尺寸的性能基线表。

- [x] **Step 1: 多轮队列水恒等式。** 提交 `drink` 240 mL 且 `durationMin: 3`（或分多轮提交），逐轮按 Spec §6.1 核对含 `Σ stomach.mealQueue[i].remainingWaterMl` 的恒等式；覆盖切片释放、`eat` 水切片为 0、旧队列缺字段按 0。预期当前实现应通过；若失败，先记录差异，不在本任务改生理脚本。
- [x] **Step 2: 固定性能环境。** 用真实 `body-modules.json`（12 个部位）、临时 `DSH_HOME`/`statePath`、固定 `now`、`autoTick:false`、端口 0；记录 Node 版本、机器、轮数（建议 720 轮，至少 120 轮）和负载（空载、单次 240 mL、多轮饮水）。
- [x] **Step 3: 测耗时与状态尺寸。** 对每轮 `gateway.tick()` 用单调时钟计时，记录总耗时、单轮 p50/p95/max（预热单列）；在起点/中点/终点记录 `parts` 与完整存档的 JSON 字节数，说明增长来源（`mealQueue`、`pendingActionIds`、通知等）；若无增长，写稳定值与观察窗口。
- [x] **Step 4: 写基线表。** 至少列出轮数、总耗时、单轮 p50/p95、`parts` 字节数、完整存档字节数、状态增长；空载与饮水负载分列。12 个部位是当前验收覆盖，不是性能上限；不得外推 30/50 个模块，要写更多规模就另建清单实测。
- [x] **Step 5: 只在基线显示可复现瓶颈时提出优化。** 优化后同命令、同机器、同轮数复测并记录前后差异。不凭感觉优化，不把未测规模写成已验证。

**Acceptance:** 多轮恒等式误差 ≤`1e-6 mL`；性能表可复现；文档引用基线时注明轮数、机器、负载和覆盖的 12 个部位。

**结果记录（2026-11-22）：** 两项交付均完成，详细表与解释边界见 spec §8，证据在 `/tmp/dsh-body/task11-perf.XUzopi/`（`baseline.md`、`summary.json`、`runs/*/result.json`、`runs/*/body-state.json`、`bench.mjs`、`summarize.mjs`、`water-gateway-test.log`；仓库外，未入库）。

- **Step 1：** `node --test test/organs.water-gateway.test.mjs` → 8 pass / 0 fail（两次单跑 789 ms / 774 ms）。3 轮 240 mL 饮水的队列水为 `[160, 80, 0]`，120 轮逐轮账本误差 ≤ `1e-6 mL`；旧队列缺水字段按 0、`eat` 水切片为 0、混合餐水与非水分账均通过。
- **Step 2：** Apple M1（8 逻辑 CPU / 8 GiB）、darwin 24.6.0 arm64、Node v26.9.0（V8 14.6.202.34-node.32）；真实根清单 12 部位 + 1 启动脚本（sha256 `3497d3e7…`）；`startGateway()`、`port: 0`、`autoTick: false`、`now: () => 0`、每运行独立临时 `statePath`。空载与单次 240 mL 饮水两种负载，各 A/B 两个独立进程；每次 120 预热 + 1200 正式轮。
- **Step 3：** 4800 正式轮、0 失败，终点 `simulatedSeconds = 79200 = 60 × 1320`。单轮 p50 0.447–0.471 ms、p95 0.537–0.584 ms、p99 ≤ 0.807 ms；预热 p50 0.477–0.512 ms、p95 0.690–0.733 ms 单列。`parts` 从 fresh 688 B 到终点 740 B（空载）/ 1126 B（饮水），完整存档 JSON 从 1077 B 到 1133 B（空载）/ 2065 B（饮水）；中点到终点不增反降，无随轮数净增长。饮水组固定增量来自 1 条已应用动作记录和 `brainNotify.sessions` 的 1 个会话；`mealQueue`、`pendingActionIds`、通知均无净增长。
- **Step 4：** 基线表、状态尺寸表、水账本与解释边界已写入 spec §8；AGENTS 的现状、常见错误 #23 与工程约定同步引用。max 出现 10.55 ms（idle-b）/ 4.41 ms（drink-b）的 OS 调度/GC 离群，p99 仍 ≤ 0.81 ms，不把 max 当稳态。
- **Step 5：** 没有可复现瓶颈，未提出优化、未改代码。该基线只覆盖当前 12 个部位，不外推到几十个模块。

### Task 12: 论文可比数据对照

**Files:**
- Evidence only: 对照表与差异记录；本轮写入 spec §7，未新建独立对照文件。需要长期保存时可另迁 `organs/human-organs/references/m3-comparison.md`，不覆盖现有笔记。
- Modify (only if comparison finds a documentation error): 相关器官 README 或 spec；代码/参数改动另开任务。

**Interfaces:**
- Consumes: `source-index.csv`、各器官 `references/notes/`、当前参数与模型输出。
- Produces: 每个论文来源的可比性判断、同口径差异记录、参数状态核对。

- [x] **Step 1: 列可比性表。** 对 Mudie、Péronnet、Ota、Andersen、De Wachter、Figaro & Mack、ICS 术语逐项写：`source_id`、人群/n、刺激、测量、单位、时间原点、采样时刻、统计量、原文定位、模型对应量/参数。记录见 spec §7.1。
- [x] **Step 2: 判可比性。** 只有同人群/同刺激/同测量/同单位/同时间原点的数据才能对照；不可比写原因。特别标注：Ota 主队列是甲减患者，正常对照仅 5 人；De Wachter 只有摘要与交接锚点；Péronnet 75–120 min 是表观完全吸收；Mudie 13 min 是胃排空 T50；Andersen 是输注剂量轴。判断见 spec §7.1 的“可比性”列。
- [x] **Step 3: 跑模型同口径输出。** 对可比数据记录方向、量级、差异和误差；不只挑方向一致的点。不能把 `relativeConcentration` 与 AVP pmol/L、`urinaryUrgency` 与测压体积/压力直接画在同一轴。240/300/1400 mL 三组真实 Gateway 对照由 agent-122 完成并转录到 spec §7.2；本任务未重跑。
- [x] **Step 4: 核参数状态。** `design` 保持 `design`；没有拟合记录不得写 `fitted_dev`；没有独立验证不得写 `validated`；`results_seen` 不得称独立验证。对照只支持 `development`/`exploratory`。核对结果见 spec §7.3。
- [x] **Step 5: 写对照结论与未解决差异。** 如果对照提示需要改参数，另开代码任务并保留基线，不在本任务直接调参。结论与未解决边界见 spec §7.3；本轮未改任何代码或参数。

**Acceptance:** 每个有论文来源的参数/方程都有可比性判断；文档中不出现把 `design` 写成 `fitted_dev`/`validated`；对照表能追溯到 `source-index.csv` 和笔记定位。

**结果记录（2026-11-22）：** 七类来源的可比性表、240/300/1400 mL 三组真实 Gateway 对照结论与边界已写入 spec §7；Mudie 笔记已修正 T50 定义与 SEM 列。该记录不等于真实 DSH 会话验收（Task 10）；性能基线已由 Task 11 单独完成。范围复核后，论文差异不自动生成待办：口咽解渴明确不做；胃慢相、小肠双隔室、示踪隔室和个体尿意阈值没有当前消费者，不追加；大负荷/AVP 输注超出当前模型范围，待有实际场景及渗透压、电解质状态后再设计。Ota/Andersen 仍不能写成复现，Figaro 不写成待建功能。
