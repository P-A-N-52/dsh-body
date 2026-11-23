# 卵巢周期与子宫（女性身体）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次做全女性生殖系统薄切片：`ovaries`（周期钟 + E2/P4 相对量）→ `uterus`（内膜 → 月经出血 + 痛经）→ `bodyFluid` 女性变体第四出口与 `interoception.discomfort` 第五路；女性身体用独立清单/存档。

**Architecture:** 根清单 `body-modules.json` 不动（19 部位 / 21 参数）；新清单 `body-modules.female.json` = 根 + 卵巢 + 子宫 + `water.female.ts` 变体（21 部位 / 23 参数）。Task 1–5 文件互不重叠可并行，Task 6/7 依赖其落地。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-reproductive-cycle-design.md`

## Global Constraints

- 代码、测试、配置和参数通过 AgentSwarm 分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；别的分片尚未落地导致的红测试只报告、不绕过。
- `dtMin = io.dt / 60`，`dtDays = dtMin / 1440`；只读轮初快照；Gateway 按目标名排序应用 transfer（`gateway/operations.js:206`），write 先应用、逐笔校验源余额。
- 可选部位一律软读：部位未加载 → 惰性/0；已加载但字段缺失、非有限、为负 → 抛错使本轮失败。transfer 配对双向声明。
- 除 Bull 2019 支撑的周期/相位长度（`source: SRC-BULL-2019`）外，所有新参数 `design`、`source: null`；数值以 Task 5 笔记核对为准，若与 spec 草案值不同，以笔记为准并同步 spec/plan。
- 根清单全部测试保持绿色、语义不变：`interoception` 无子宫时第五路为 0，`water.ts` 公开导出不变。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`，仓库根不留新文件。

## Review Focus

- 周期回卷：`cycleDay` 跨过 `cycleLengthDays` 时回卷，E2/P4 在回卷点两侧按曲线定义连续（Task 1）。
- 女性清单缺 `uterus`：启动报 `transferOut target "uterus.bleedingMl" is not declared`（Task 6）。
- 根清单无子宫：`interoception.discomfort` 与既有断言逐点一致（Task 4）。
- 出血只由轮初水支付且排在汗后，水量不足时钳到剩余（Task 3）。
- 起始日在经期：`startCycleDay` 默认 5（非经期）；自定义起始日在经期的首轮痉挛/出血按公式走（Task 1/2）。

---

### Task 1: 卵巢模块（TDD）

**Files:**
- Create: `organs/human-organs/ovaries/menstrual-cycle.ts`、`organs/human-organs/ovaries/menstrual-cycle.parameters.json`
- Test: `test/organs.ovaries.test.mjs`（新建，仿 `test/organs.lungs.test.mjs` 的假 io）

**Interfaces:**
- Produces: `id = 'ovaries'`、`actionTypes = []`、字段 `cycleDay(d)` / `cycleLengthDays(d)` / `phase(string)` / `estradiolRelative(1)` / `progesteroneRelative(1)` 均 `absolute`；`initialState` 由 `startCycleDay` 计算；`heartbeat(io)` 只读自身 prev 与 `io.dt`。

- [x] **Step 1: 写失败测试**：contract；参数（29.3 / 16.9 / 12.4 / startCycleDay 5 / nadir 0.1 / bump 0.5 / baseline 0.05，Bull 三项 `source: SRC-BULL-2019`，其余 design/null）；推进与回卷（`cycleDay = 29.2`、dt 86400 s → 约 0.9）；相位边界（`follicular` < 16.9 ≤ `ovulatory` < 17.9 ≤ `luteal`）；E2/P4 锚点（day 0、16.9、17.9、黄体中期、29.3）；`startCycleDay = 0` 时首日 E2 = nadir、P4 = baseline；JSON-safe。
- [x] **Step 2: 运行 `node --test test/organs.ovaries.test.mjs`**，预期模块不存在而失败。
- [x] **Step 3: 实现模块**：头注释写明 Bull 只支撑周期/相位长度、激素曲线为 `design` 分段线性、消费者是 `uterus`；无 transfer；不读其他部位。
- [x] **Step 4: 写参数文件**（`schemaVersion 1`、`owner ovaries`，字段仿 `glucose.parameters.json`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。`test/parameters.test.mjs` 归 Task 6，不要改。

### Task 2: 子宫模块（TDD）

**Files:**
- Create: `organs/human-organs/uterus/uterus.ts`、`organs/human-organs/uterus/uterus.parameters.json`
- Test: `test/organs.uterus.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1 的 `ovaries.cycleDay / estradiolRelative / progesteroneRelative` 字段名。
- Produces: `id = 'uterus'`、`actionTypes = []`、字段 `endometriumRelative(1)` / `crampMm(mm)` / `bleedingRequestMl(mL)` / `bleedingMl(mL)`，`bleedingMl.transferIn: ['bodyFluid.waterVolumeMl']`；`initialState = { endometriumRelative: 0.1, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 }`。

- [x] **Step 1: 写失败测试**：contract；参数（mensesDays 4.0（`prior`、`source: SRC-BULL-2019`，自报出血天数）/ flow 50 / crampPeak 85 / crampDays 2.5 / halfTime 2 / weights 0.7,0.3，其余 design/null）；内膜一阶趋近（prev 0.1、E2=1、P4=0.05 → target 0.715，dt 1 天 → `target + (0.1 − target) × 2^(−1/2)`）；经期请求（cycleDay 1、prevEndo 0.8、dt 60 → `50 × 0.8 / (4.0 × 1440)` mL）；非经期请求 0；痉挛（day 0 → 85、day 1.25 → 42.5、day 3 → 0）；卵巢缺失 → 痉挛 0、请求 0；卵巢字段非法 → 抛错且零写入；`bleedingMl` 每轮归 0；JSON-safe。
- [x] **Step 2: 运行 `node --test test/organs.uterus.test.mjs`**，预期失败。
- [x] **Step 3: 实现模块**：按 spec 公式；头注释写明消费者（`interoception.discomfort`、`bodyFluid` 女性变体）、经量正比内膜、全部 design。
- [x] **Step 4: 写参数文件**（`owner uterus`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 3: 体液核心抽取与女性变体

**Files:**
- Create: `organs/human-compartments/body-water/water-core.ts`、`organs/human-compartments/body-water/water.female.ts`
- Modify: `organs/human-compartments/body-water/water.ts`（改为薄入口，公开导出不变）
- Test: `test/organs.body-water-female.test.mjs`（新建）；`test/organs.body-water.test.mjs`（仅当导入路径需要时）

**Interfaces:**
- 仿 `organs/human-organs/kidney/urine-production-core.ts` 的核心+入口模式。
- Produces: `water.ts` 仍导出 `id = 'bodyFluid'` / `fields`（三出口）/ `initialState` / `heartbeat`；`water.female.ts` 导出同 id、四出口 `transferOut = ['bladder.volumeMl', 'lungs.respiratoryWaterLossMl', 'skin.sweatVolumeMl', 'uterus.bleedingMl']`。

- [x] **Step 1: 写女性变体失败测试**：第四出口按"肾 → 肺 → 汗 → 子宫"分配轮初水，子宫请求钳到前三路后的剩余；子宫请求 0 时三路水量与 `water.ts` 逐点一致；`uterus.bleedingMl` 由 transferIn 加入；水账含累计 `uterus.bleedingMl`。
- [x] **Step 2: 运行 `node --test test/organs.body-water-female.test.mjs`**，预期失败。
- [x] **Step 3: 抽核心**：把 `water.ts` 的结算逻辑搬进 `water-core.ts`（出口列表参数化），`water.ts` 变薄入口；运行 `node --test test/organs.body-water.test.mjs` 确认原有用例全绿。
- [x] **Step 4: 实现 `water.female.ts`**（复用 `water.parameters.json`，不新增参数文件），跑通 Step 2 命令。

### Task 4: interoception 第五路

**Files:**
- Modify: `organs/human-organs/brain/interoception.ts`
- Test: `test/organs.interoception.test.mjs`

- [x] **Step 1: 加失败测试**：`uterus.crampMm = 85` 时 `discomfort = 50`（onset 70）；无 `uterus` 时与既有逐点一致；`crampMm` NaN/缺失按 0。
- [x] **Step 2: 运行 `node --test test/organs.interoception.test.mjs`**，预期新用例失败。
- [x] **Step 3: 实现**：`IO` 类型加 `read('uterus')`，`discomfort` 的 max 加 `excessOverOnset(uterineCramp, discomfortOnsetMm)`；头注释补第五路；不加字段、不动 `brainNotify`。
- [x] **Step 4: 运行 Step 2 命令**，预期全绿。

### Task 5: Bull 2019 证据笔记与登记

**Files:**
- Create: `organs/human-organs/ovaries/references/notes/bull-2019.md`
- Modify: `organs/human-organs/references/source-index.csv`

- [x] **Step 1:** 取开放全文（PMC6710244 / https://pubmed.ncbi.nlm.nih.gov/31482137/），核对周期长度、卵泡期/黄体期长度、经期天数（若有）的**原值、单位、统计量、队列边界与页码/表号**；不猜 DOI、不猜分母。
- [x] **Step 2:** 按 `organs/human-compartments/glucose/references/notes/dalla-man-2007.md` 的格式写笔记：来源标识、人群与选择偏倚（Natural Cycles 用户、厂商资助）、本切片只借什么（周期/相位长度）、不能推出什么（激素曲线、经量、痛经、个体预测）。
- [x] **Step 3:** `source-index.csv` 增加 `SRC-BULL-2019` 行（仿 `SRC-DALLAMAN-2007` 行字段），`validation_status = development`，`results_seen = fulltext_read`（以实际为准）。
- [x] **Step 4:** 若笔记值与 spec 草案（29.3 / 16.9 / 12.4 / 4.5）不符，把准确值写进笔记并更新 spec/plan 对应行，通知主代理。

### Task 6: 女性清单、Gateway 测试与计数

**Files:**
- Create: `body-modules.female.json`、`test/organs.reproductive-gateway.test.mjs`
- Modify: `package.json`（`files` 加 `body-modules.female.json`）、`test/parameters.test.mjs`

- [x] **Step 1:** `body-modules.female.json`：根清单 19 脚本 + 卵巢 + 子宫，`body-water/water.ts` 换 `water.female.ts`，顶层键与根一致。
- [x] **Step 2:** 写 Gateway 测试：启动得 21 部位；预置存档把 `ovaries.cycleDay` 设在经期（如 1），推进数轮核对 `uterus.bleedingMl > 0`、`interoception.discomfort > 0`、水账含累计出血且逐轮成立；预置非经期则出血/痉挛为 0；缺 `uterus` 的清单启动报 `transferOut target "uterus.bleedingMl" is not declared`；同 `statePath` 重启周期与在途量接续。
- [x] **Step 3:** `test/parameters.test.mjs`：清单加卵巢与子宫参数文件、计数 21→23、补 Bull 来源断言。
- [x] **Step 4:** `package.json` 的 `files` 加 `body-modules.female.json`。
- [x] **Step 5: 运行** `node --test test/organs.reproductive-gateway.test.mjs test/parameters.test.mjs`，再 `npm test`，预期全绿。

### Task 7: 文档

**Files:**
- Create: `organs/human-organs/ovaries/README.md`、`organs/human-organs/uterus/README.md`
- Modify: `organs/human-compartments/body-water/README.md`、`organs/human-organs/brain/README.md`、`README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`

- [x] **Step 1:** 两份新 README：部位、字段、单位、参数与来源（Bull 只支撑周期长度）、消费者链、时序、旧档/重启、未建模（激素绝对浓度、排卵受孕、男性生殖、痛经通知等）。
- [x] **Step 2:** `body-water/README.md` 写核心+变体、第四出口与水账；`brain/README.md` 写 `discomfort` 第五路（软读、无通知）。
- [x] **Step 3:** 根 `README.md` 与 `docs/gateway-and-scripts.md`：女性清单用法（21 部位 / 23 参数、独立存档）、根清单仍 19/21、`package.json` `files` 同步说明。
- [x] **Step 4:** `docs/virtual-body.md`：新增生殖系统小节（当前实现 / 未建模 / 未验证），说明根清单计数不变、女性清单独立；不声称真实 DSH 或独立数据验证。

### Task 8: 全量验证

- [x] **Step 1:** `npm test` 与 `git diff --check` 全部通过。
- [x] **Step 2:** 在本文末尾追加交付记录（已实现 / 已验证 / 仍未实现 / 工作区）。

## 交付记录（2026-11-23）

- **已实现：** 新部位 `ovaries`（周期钟 + E2/P4 相对量）与 `uterus`（内膜 → 月经出血 + 痛经）；`body-water` 抽核心出 `water.female.ts` 第四出口；`interoception.discomfort` 第五路 `uterus.crampMm`（软读，无通知）。女性身体用独立清单 `body-modules.female.json`（21 部位、23 份参数、硬闭包 10 部位、独立存档）；根清单仍 19/21 不变。`package.json` `files` 收录女性清单。Bull 2019 笔记登记（`SRC-BULL-2019`：周期 29.3 / 卵泡 16.9 / 黄体 12.4 / 出血 4.0 天，prior），其余参数 design/null。
- **已验证：** 卵巢 8/8、子宫 9/9、体液女性变体 6/6（含缺 `uterus` 启动报错）、`interoception` 22/22（原 19 用例不变 + 第五路 3 用例）、女性清单真实 Gateway 3/3（21 部位、经期出血 + discomfort + 逐轮水账、非经期全 0、重启接续）。最终 `npm test` 466/466、0 fail；`git diff --check` 通过。
- **实施中修正：** Bull 核对经期天数为 4.0 而非草案 4.5，已同步参数/测试/spec/plan/文档；plan 回卷用例的 dt 单位笔误（dt 86400 s → 0.9）；排卵带嵌在 F+L 内使 `luteal` 相位实际跨 11.4 天，`lutealLengthDays` 仅作曲线形状参数，spec 已写明。
- **仍未实现/未验证：** 激素绝对浓度、排卵/受孕、子宫内膜毫米厚度、经血成分、阴道/乳腺、男性生殖与睾酮、性欲/情绪行为、痛经通知、性行为（下一刀）、真实 DSH 会话、独立周期/经量/痛经数据、临床验证、21 部位性能。
- **工作区：** 本批未 commit、未 push；肺、肌肉、生殖三批均未提交；根目录传输归档未跟踪保留。
