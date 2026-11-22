# 碳水摄入到血糖薄切片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `eat` / `drink` 的可消化碳水经过胃排空和小肠吸收，进入可检查、可供后续器官读取的葡萄糖表观分布池。

**Architecture:** 扩展胃现有共享核心与水链入口，在小肠唯一写者中增加碳水 transfer，新增 `glucose` 隔室和根清单项。动作输入、模块状态与 Gateway 集成分别测试；所有跨部位变化遵守轮初快照和 write 后 transfer。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test`、无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md`

## Global Constraints

- 工作区已有未提交的尿意与 fasting/ghrelin 改动，全部保留；不修改、回滚或提交它们。
- 代码、测试、清单和参数文件按仓库要求通过 AgentSwarm 分片修改；纯 Markdown 可由主代理维护。独立任务最多 6 路并发，后台运行不是硬性要求；每个分片只写自己拥有的文件，依赖结果的阶段串行。
- 不执行 `git commit` / `git push`，不 stage 未跟踪的大型 tar.gz。
- 一个部位一个写者；先 write 后 transfer；碳水只以 g 转移，不从体积或能量反推。
- `carbohydrateG` 表示可消化葡萄糖当量碳水；缺省 0，提供时必须有限且 >=0，非法值使整条摄入无效。
- `solidCarbohydrateG` 是 `carbohydrateG` 的子集；每轮通量不是累计量。
- 固定参数是 `design` 边界；Dalla Man 2007 只支撑 `V_G` 的定义与量级，不能声称 fitted/validated。
- 临时存档放系统临时目录，Gateway 测试使用真实根清单、端口 0、`autoTick:false` 和固定 `now`。
- 本轮不接胰岛素、肝糖、肾糖利尿、体感反馈或自动行为，不猜既有场景营养成分。

## Review Focus

- 固餐碳水的小计不会被 Gateway 的总量 transfer 自动扣除：Task 1 用小计/总量联合断言固定，Task 4 实现。
- 多轮摄入尾量和 legacy 队列可能丢失碳水身份：Task 1 覆盖三轮队列与缺水/碳字段旧队列，Task 4 实现。
- 非有限/负数碳水不能留下“体积已入胃但碳水无效”的半截动作：Task 2 和 Task 3 分别覆盖工具与模块契约，Task 6 实现工具校验。
- 同轮吸收不能立即抬高浓度，低于基线也不能被虚构肝糖拉回：Task 1 的隔室单测与 Task 2 的真实 Gateway 逐轮断言固定，Task 5 实现。
- 同体积/能量的无碳水对照不能凭能量升糖，原水账也不能被碳水转移破坏：Task 2 加 A/B 和水账兼容断言，Task 7 整体验证。

---

### Task 1: 胃、小肠与葡萄糖模块的失败测试

**Files:**
- Modify: `test/organs.motility.test.mjs`
- Modify: `test/organs.hydration.test.mjs`
- Modify: `test/organs.small-intestine.test.mjs`
- Create: `test/organs.glucose.test.mjs`
- Modify: `test/organs.modules.test.mjs`
- Modify: `test/parameters.test.mjs`

**Interfaces:**
- Consumes: 设计 §4–§6 的字段名、公式、参数值和 transfer 配对。
- Produces: 后续实现必须满足的模块契约；不修改产品代码。

- [x] **Step 1: 写胃碳水失败测试**

在现有测试风格中固定：合法 `eat` / `drink.carbohydrateG` 进入胃；缺省为 0；负数、`NaN`、字符串使整条摄入无效；非固餐碳水按 `emptiedNonSolidMl / nonSolidVolumeMl` 排出，固餐按既有 `solidFraction` 排出。

在 hydration/operations 联合测试中使用既有胃体积/能量参数计算 `Ec`，断言 write 后、transfer 后满足：

```text
write.carbohydrateG = C + D
write.solidCarbohydrateG = Cs - Ecs + Ds
final.carbohydrateG = C + D - Ec
final.solidCarbohydrateG = Cs - Ecs + Ds
emptiedCarbohydrateG = Ec
```

再加 `durationMin:3` 的固体餐，逐轮检查 `remainingCarbohydrateG` 尾量释放、队列结束不丢碳水和质量账 <=`1e-6 g`。legacy `motility.ts` 仍无碳水字段/transfer，旧队列缺碳水元数据按 0。

- [x] **Step 2: 写小肠与葡萄糖隔室失败测试**

小肠在既有水测试之外固定：

```text
carbohydrateG: transferIn stomach.carbohydrateG, transferOut glucose.glucoseMassG
absorbedCarbohydrateG = roundStartCarbohydrateG × (1 - 2^(-dtMin / 20))
```

同轮胃入碳水在 transfer 后才加入，原水公式与字段不变。新增葡萄糖模块测试：`id = glucose`，默认 `V=141 dL`、`B=12.69 g`、浓度 90 mg/dL；轮初质量读浓度；仅高于 B 的部分按 60 min 半时清除；低于 B 保持；小肠 transfer 在 write 后加入；输出有限且 JSON-safe。

模块清单测试期望根清单 13 项并包含 `./organs/human-compartments/glucose/glucose.ts`；参数清单测试加入小肠既有参数文件中的碳水项和新 `glucose.parameters.json`。

- [x] **Step 3: 运行测试并记录预期失败**

Run:

```bash
node --test test/organs.motility.test.mjs test/organs.hydration.test.mjs test/organs.small-intestine.test.mjs test/organs.glucose.test.mjs test/organs.modules.test.mjs test/parameters.test.mjs
```

Expected: 新断言因碳水字段/transfer、葡萄糖模块或 13 项清单尚不存在而 FAIL；既有无关断言不应被改成通过。

### Task 2: 工具与真实 Gateway 的失败测试

**Files:**
- Modify: `test/dsh.tools.test.mjs`
- Create: `test/organs.glucose-gateway.test.mjs`
- Modify: `test/organs.water-gateway.test.mjs`
- Modify: `test/organs.di.test.mjs`（仅在当前根清单部位断言需要时）
- Modify: `test/organs.gateway.test.mjs`（根清单 13 部位与标题）

**Interfaces:**
- Consumes: Task 1 的字段契约、`body_act` 现有 `fakeExec` 和 `test-support/harness.mjs` 的真实 Gateway 方式。
- Produces: 端到端时序、守恒和旧档兼容契约；不修改产品代码。

- [x] **Step 1: 写 `body_act` 输入失败测试**

合法 drink/eat 的 `carbohydrateG` 原样进入 queued action；缺省不强制补字段；`-1`、`NaN`、`Infinity`、字符串均返回 400 且 `pendingActionIds` 为空；`urinate` 不需要碳水。schema 的 `properties.carbohydrateG` 描述克数与可消化葡萄糖当量含义。`body_state` 部位列表加入 `glucose`。

- [x] **Step 2: 写真实根清单 A/B 与逐轮失败测试**

从同一空 checkpoint 启动两个独立临时存档，提交同体积、同能量、同液餐、同时长的动作，仅 A 含 60 g 碳水。通过 `body_act` 提交，不用模块函数代替 Gateway：

```text
第 1 轮：A 胃碳水 60；小肠吸收 0；浓度 90
第 2 轮：胃有排空，小肠有轮末碳水；小肠本轮吸收 0；浓度仍 90
第 3 轮：小肠本轮吸收 >0，葡萄糖轮末质量 >B；浓度仍 90
第 4 轮：浓度 >90
B：全程外源碳水 0，浓度从基线开始且不凭能量上升
```

每轮还要断言 A/B 的 `stomach.volumeMl`、`energyKcal`、`waterVolumeMl`、`smallIntestine.waterVolumeMl`、`bodyFluid.waterVolumeMl`、`bladder.volumeMl` 完全一致，证明碳水没有泄漏到体积、能量或水通道。之后连续运行并逐轮核对设计 §6 的 `1e-6 g` 账本和浓度回落；A/B 原水账分别满足既有恒等式，不能跨身体比较绝对水增量而不扣除各自初值。

- [x] **Step 3: 写队列、固体子集、重启和旧档失败测试**

用三轮固体餐逐轮核对队列、胃固体小计和总账；至少运行到第 3 轮发生首次吸收、`glucoseMassG > B` 后停止并在同一 statePath 重启，确认非基线葡萄糖质量、浓度读数、清除通量和队列延续且账本仍守恒。旧根 checkpoint 只补 0 碳水和默认葡萄糖隔室，不反推历史摄入。更新现有根部位 ID 列表（包括 `organs.gateway.test.mjs` 的标题和排序列表）与深度初值断言以包含新字段/部位，legacy 独立胃测试保持原形状。

- [x] **Step 4: 运行测试并记录预期失败**

Run:

```bash
node --test test/dsh.tools.test.mjs test/organs.glucose-gateway.test.mjs test/organs.water-gateway.test.mjs test/organs.di.test.mjs
```

Expected: 新输入校验、13 部位和碳水链断言 FAIL；失败原因应是未实现，不是测试使用了错误单位/不存在的辅助函数。

### Task 3: 审查测试契约

**Files:**
- Review: Tasks 1–2 的所有测试与上述 spec。
- Fix only when a test-contract defect is found: 对应 Task 1–2 的测试文件，由原测试分片所有者修正。

**Interfaces:**
- Consumes: 两组预期失败结果。
- Produces: 可执行的测试基线；reviewer 保持只读，只有测试所有者才修正测试本身错误。

- [x] **Step 1: 独立审查公式、时序和所有权**

后台 reviewer 核对：固体子集是否被重复计数；write/transfer 方向与单位是否匹配；Gateway 轮次是否多算/少算一轮；A/B 是否只改变碳水；账本是否漏队列或重复通量；旧测试是否被不当削弱。

- [x] **Step 2: 由测试所有者修正测试自身的错误并重跑预期失败**

若有审查修正，resume 对应测试分片所有者修改；reviewer 不直接写文件。重跑 Task 1 Step 3 与 Task 2 Step 4，确认失败仍指向缺失产品实现，再进入三个并行实现分片。

### Task 4: 实现胃碳水记账

**Files:**
- Modify: `organs/human-organs/stomach/motility-core.ts`
- Modify: `organs/human-organs/stomach/hydration.ts`
- Modify only if another current stomach entry shares the core contract: `organs/human-organs/stomach/motility.ts`
- Tests: Task 1 的胃测试。

**Interfaces:**
- Consumes: 既有 `advanceStomach`、水链 write/transfer 契约。
- Produces: `stomach.carbohydrateG`、`solidCarbohydrateG`、`emptiedCarbohydrateG`、队列碳水字段和 `stomach → smallIntestine` 的 g transfer。

- [x] **Step 1: 最小实现**

给共享核心增加默认关闭的碳水跟踪选项；根水链入口开启，legacy 入口保持原形状。碳水解析与现有整条摄入验证一致；队列最后一轮释放余量且结束判断包含碳水。按 spec §5.1 让固体小计写出为扣除本轮排出后的值，总碳水由 Gateway transfer 扣一次。

更新头注释，区分既有排空证据与新的 `design` 碳水比例假设；不新增无消费者的胃参数。

- [x] **Step 2: 运行胃定向测试**

Run: `node --test test/organs.motility.test.mjs test/organs.hydration.test.mjs`
Expected: PASS；若失败，先检查是否双扣固体小计或丢队列尾量，不改弱断言。

### Task 5: 实现小肠碳水、葡萄糖隔室与根清单

**Files:**
- Modify: `organs/human-organs/small-intestine/water-absorption.ts`
- Modify: `organs/human-organs/small-intestine/water-absorption.parameters.json`
- Create: `organs/human-compartments/glucose/glucose.ts`
- Create: `organs/human-compartments/glucose/glucose.parameters.json`
- Modify: `body-modules.json`
- Modify: `organs/human-organs/references/source-index.csv`
- Tests: Task 1 的小肠、葡萄糖、模块和参数测试。

**Interfaces:**
- Consumes: `stomach.carbohydrateG` transfer（Task 4）；`SRC-DALLAMAN-2007` 证据笔记已存在于 `organs/human-compartments/glucose/references/notes/dalla-man-2007.md`。
- Produces: `smallIntestine.carbohydrateG` → `glucose.glucoseMassG` transfer、90 mg/dL 初始读数、13 部位根清单。

- [x] **Step 1: 实现小肠碳水**

保留现有文件路径和全部水行为，在同一写者中新增 `carbohydrateG` / `absorbedCarbohydrateG` 与 g transfer。`smallIntestine.carbohydrateAbsorption.halfTimeMin = 20 min` 为 `design`、`source:null`，写明未来替换点；水参数不变。

- [x] **Step 2: 实现葡萄糖隔室**

导出 `id:'glucose'`、`actionTypes:[]`、`initialState`、`fields`、`heartbeat(io)`。参数严格采用 spec 的 75 kg、1.88 dL/kg、90 mg/dL、60 min；分布体积参数为 `design`、`source:'SRC-DALLAMAN-2007'`，其余工程值 `source:null`。按 spec 实现轮初浓度、单向高于基线清除和小肠 transfer 目标。

在 `source-index.csv` 登记已核准论文，链接现有笔记；在脚本头注释写明可及池定义和原文 p.1741/p.1743 边界。根清单追加新脚本；`package.json` 已发布整个 `organs/` 与 `lib/`，无需为此新增发布项。

- [x] **Step 3: 运行模块与参数定向测试**

Run: `node --test test/organs.small-intestine.test.mjs test/organs.glucose.test.mjs test/organs.modules.test.mjs test/parameters.test.mjs`
Expected: PASS。

### Task 6: 实现动作碳水输入

**Files:**
- Modify: `tools.js`
- Tests: `test/dsh.tools.test.mjs`

**Interfaces:**
- Consumes: Task 2 的工具测试。
- Produces: `body_act` 的可选 `carbohydrateG` 校验和 schema；原动作 ID/回执不变。

- [x] **Step 1: 最小实现**

在 drink/eat 共用校验路径中检查可选碳水；非法返回包含 `carbohydrateG` 的 400 错误，合法原样由现有 `buildActionPayload` 保留。`urinate` 继续提前通过。添加 schema 属性和简洁英文说明，不引入新动作或依赖。

- [x] **Step 2: 运行工具定向测试**

Run: `node --test test/dsh.tools.test.mjs`
Expected: PASS。若并行分片尚未提供根清单/葡萄糖部位，先用 `--test-name-pattern` 运行新增碳水输入用例并记录其余留待集成；Task 7 必须在所有分片合入后重跑整个文件并 PASS。

### Task 7: 集成、文档与全量验收

**Files:**
- Modify only for integration defects: Tasks 4–6 拥有的产品/测试文件。
- Modify: `organs/human-organs/stomach/README.md`
- Modify: `organs/human-organs/small-intestine/README.md`
- Create: `organs/human-compartments/glucose/README.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`
- Modify: `README.md`
- Update checkboxes: `docs/superpowers/plans/2026-11-22-carbohydrate-glucose.md`

**Interfaces:**
- Consumes: Tasks 4–6 已合入当前工作区的实现。
- Produces: 可运行交付与明确未实现边界。

- [x] **Step 1: 运行集成与全量测试**

Run:

```bash
node --test test/organs.glucose-gateway.test.mjs test/organs.water-gateway.test.mjs test/organs.di.test.mjs
npm test
git diff --check
```

Expected: 全部 PASS、diff check 退出 0。若有跨分片问题，按实际根因修复；不得为通过而删守恒、兼容或时序断言。

- [x] **Step 2: 同步当前实现与未建模边界**

中文文档写清动作字段、13 部位、状态/通量/代理、固定参数来源与替换点、三轮后出现浓度读数的时序、质量账、legacy/旧档行为。设计草案中的 M2 只能把本薄切片标为已实现，激素/肝糖/下游反馈仍为未实现。README 不宣称真实 DSH 或临床验证。

- [x] **Step 3: 独立实现审查与最终验证**

后台 reviewer 检查 spec 覆盖、单写者、守恒、旧测试保留、证据口径和无意改动。修正后重跑必要定向测试、完整 `npm test`、`git diff --check`，并检查 `git status --short --branch`；删除本轮测试产物，保留既有 tar.gz 和并行未提交工作。

- [x] **Step 4: 记录交付边界**

勾选已完成步骤；在计划中保留真实 DSH 会话、独立生理数据验证和下游器官反馈为未验收/未实现。最终回复分别列出已实现、已验证和仍是计划，不提交或推送。

## 交付记录（2026-11-22）

- **已实现：** `drink` / `eat.carbohydrateG` 输入与校验；胃碳水总量、固体子集、多轮队列和既有分组排空；小肠碳水吸收；`glucose` 可及池质量、轮初浓度与超基线表观清除；根清单 13 部位；Dalla Man 2007 证据登记；当前实现与清单闭包文档。
- **已验证：** 新测试均有 RED→GREEN 证据；真实根清单集成 38/38；最终 `npm test` 为 315/315、0 fail、0 skipped；`git diff --check` 通过。分任务审查、整体审查及文档修正复审均通过，最终 Ready=Yes。
- **已核对的边界：** 外源碳水质量账按 `1e-6 g` 容差覆盖单次、多轮固体餐和非基线吸收后重启；水账、legacy 胃形状、旧档默认值、DI 与既有通知保持通过。证据登记采用整篇研究 218 人（正常组 204 + T2D 扩展 14），`V_G` 只取正常组平均模型常数。
- **仍未验收/未实现：** 真实 DSH 会话、独立生理数据验证、13 部位性能实测、完整胰岛素/胰高血糖素/肝糖/组织摄糖、肾糖与体感反馈均未完成。固定参数仍为 `design`，不得称临床验证或个体预测。
- **工作区：** 所有改动未提交、未推送；任务前已有尿意/fasting 改动和大型 tar.gz 保留。临时 SDD 工作区在最终复审与状态核对后删除。
