# 性行为与性反应周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新动作 `sex { durationMin, intensity }` + 性别中立部位 `sexualResponse`（唤醒与反应周期），计入 `physicalActivity` 体力消耗并给 `interoception` 一路新体感读数；根清单 20 部位 / 22 参数、女性清单 22 / 24。

**Architecture:** `sexualResponse` 只写自身状态、无 transfer；`physicalActivity` 把 `sex` 与 `exercise` 同样计入剩余活动；`interoception` 软读 `arousalMm` 写 `sexualArousalMm`。Task 1–3 与 Task 5 文件不重叠可并行，Task 4 依赖其落地。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-sexual-response-design.md`

## Global Constraints

- 代码、测试、配置和参数通过 AgentSwarm 分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；别的分片尚未落地导致的红测试只报告、不绕过；不改 plan/spec。
- 所有新参数 `design`、`source: null`；不做激素、受孕/妊娠、性欲/情绪、伴侣/性病/避孕、显性内容。
- **LLM 只控制输入（动作），不直接写身体状态**；`orgasm` 是继 `urinate` 之后第二个允许主动触发的输出，仅在轮初 `arousalMm >= 70` 时生效，≥95 时无需动作强制释放（与膀胱 >600 mL 非自主排空同一路子）。
- 每轮只读轮初快照与本轮原始动作；`dtMin = io.dt / 60`、`simMin = io.simulatedSeconds / 60`；`lastOrgasmAtSimMin` 未发生为 `null`（JSON-safe）。
- 无 `sex` 动作时 `physicalActivity` 与 `interoception` 既有行为逐点不变；`sexualResponse` 未加载时 `sexualArousalMm` 恒 0。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`，仓库根不留新文件。

## Review Focus

- 主动 `orgasm` 只在轮初 `arousalMm >= 70` 时生效，< 70 被忽略；≥ 95 无动作也强制释放，每轮最多记一次 `lastOrgasmAtSimMin`（Task 1 / Task 4）。
- 不应期内新 `sex` 动作仍更新剩余分钟，但 `target = 0`、唤醒不升（Task 1）。
- `sex` 与 `exercise` 同轮时按"最后一条合法动作替换"策略，与现行语义一致（Task 2）。
- 无 `sexualResponse` 的根旧档：`sexualArousalMm` 恒 0，其余体感逐点不变（Task 3）。
- `lastOrgasmAtSimMin = null` 的存档/重启与 JSON 往返不变成 0 或 `undefined`（Task 1/4）。

---

### Task 1: sexualResponse 模块（TDD）

**Files:**
- Create: `organs/human-organs/sexual-response/response.ts`、`organs/human-organs/sexual-response/response.parameters.json`
- Test: `test/organs.sexual-response.test.mjs`（新建）

**Interfaces:**
- Produces: `id = 'sexualResponse'`、`actionTypes = ['sex', 'orgasm']`、`fields = { arousalMm(mm), phase(string), remainingSexMin(min), sexIntensity(1), lastOrgasmAtSimMin(min) }` 均 `absolute`；`initialState = { arousalMm: 0, phase: 'rest', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null }`；`heartbeat(io)` 只读自身 prev 与 `io.actions` / `io.dt` / `io.simulatedSeconds`。

- [x] **Step 1: 写失败测试**：contract；参数（5 / 15 / 70 / 95 / 1 / 20，design/null）；`sex { durationMin: 30, intensity: 0.8 }` 后剩余 30 min、强度 0.8、唤醒上升且 phase = `excitement`；轮初 `arousalMm = 80` 且有 `orgasm` 动作 → 记 `lastOrgasmAtSimMin = simMin`、phase = `orgasm`（1 min 内）；轮初 `arousalMm = 60` 时 `orgasm` 动作被忽略、不改状态；轮初 `arousalMm = 95` 无动作也强制记录；高潮后进入 `refractory`、唤醒下降；不应期内新 `sex` 动作更新剩余分钟但 target = 0；20 min 后离开不应期；无活动时 phase 由 `resolution` 归 `rest`；非法 `sex`（强度 0 / 1.5、负时长、NaN）被忽略且不改状态；`lastOrgasmAtSimMin` 的 `null` JSON 往返与重启保留。
- [x] **Step 2: 运行 `node --test test/organs.sexual-response.test.mjs`**，预期模块不存在而失败。
- [x] **Step 3: 实现模块**：按 spec 公式；动作校验沿用 `skeletal-muscle/activity.ts` 的 `exerciseReplacement` 思路；头注释写明无登记来源、全 `design`、两个消费者（`physicalActivity`、`interoception`）与未建模项。
- [x] **Step 4: 写参数文件**（`owner sexualResponse`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 2: physicalActivity 接受 sex

**Files:**
- Modify: `organs/human-organs/skeletal-muscle/activity.ts`
- Test: `test/organs.activity.test.mjs`（若不存在则找到现有活动测试文件）

- [x] **Step 1: 加失败测试**：`sex { durationMin, intensity }` 与 `exercise` 一样替换剩余活动；`sex` 与 `exercise` 同轮时最后一条合法者生效；非法 `sex` 被忽略；无 `sex` 时既有断言逐点不变。
- [x] **Step 2: 运行该测试文件**，预期新用例失败。
- [x] **Step 3: 实现**：`actionTypes = ['exercise', 'sex']`；把 `exerciseReplacement` 泛化为两类都接受（同一 `intensity` / `durationMin` 校验）；头注释补"性活动按体力活动计入"及替换策略。
- [x] **Step 4: 运行**，预期全绿。

### Task 3: interoception 新读数

**Files:**
- Modify: `organs/human-organs/brain/interoception.ts`
- Test: `test/organs.interoception.test.mjs`

- [x] **Step 1: 加失败测试**：`sexualResponse.arousalMm = 72` → `sexualArousalMm = 72`；未加载 / 缺失 / NaN → 0；既有五路与 `discomfort` 不变。
- [x] **Step 2: 运行 `node --test test/organs.interoception.test.mjs`**，预期新用例失败。
- [x] **Step 3: 实现**：`fields` 与 `initialState` 加 `sexualArousalMm: 0`（`mm`、`absolute`），`IO` 类型加 `read('sexualResponse')`，写入该字段；头注释补读数口径（不进 discomfort、不发通知）。
- [x] **Step 4: 运行**，预期全绿。

### Task 4: 动作工具、清单与 Gateway

**Files:**
- Modify: `tools.js`、`body-modules.json`、`body-modules.female.json`
- Modify: `test/dsh.tools.test.mjs`、`test/organs.gateway.test.mjs`、`test/organs.modules.test.mjs`、`test/parameters.test.mjs`、`test/organs.di.test.mjs`、`test/organs.reproductive-gateway.test.mjs`（计数）、`test/organs.water-gateway.test.mjs`（若其 partIds 列表需要）
- Test: `test/organs.sexual-response-gateway.test.mjs`（新建）

- [x] **Step 1:** `tools.js` 增加 `sex`（校验与 `exercise` 相同）与 `orgasm`（无载荷），不放宽既有 `drink/eat/urinate/exercise` 校验。
- [x] **Step 2:** 两份清单各加 `"./organs/human-organs/sexual-response/response.ts"`；根 20 部位 / 22 参数、女性 22 / 24。
- [x] **Step 3:** 同步计数与列表：`organs.gateway.test.mjs`（20、排序列表、`sexualResponse` 初值含 `lastOrgasmAtSimMin: null`）、`organs.modules.test.mjs`（20）、`dsh.tools.test.mjs`（20 + `sex` schema 用例）、`parameters.test.mjs`（24 + 新参数文件）、`organs.di.test.mjs`（20）、`organs.reproductive-gateway.test.mjs`（22）、`organs.water-gateway.test.mjs`（若列表需要）。用 `grep -l muscleGlucose test/` 找齐所有部位列表。
- [x] **Step 4:** 新建 Gateway 用例：`sex` 动作后唤醒上升、`sexualArousalMm` 读出，汗液 / 呼吸失水 / 肌糖原出现对应通量，非法 `sex` 不改变状态；预置高唤醒存档（`arousalMm = 80`）提交 `orgasm` → 记录释放并进入 `refractory`，低唤醒时 `orgasm` 被忽略；预置 `arousalMm = 95` 无动作也强制释放；女性清单同样可用。
- [x] **Step 5: 运行** 新增与所改测试文件，再 `npm test`，预期全绿。

### Task 5: 文档

**Files:**
- Create: `organs/human-organs/sexual-response/README.md`
- Modify: `organs/human-organs/skeletal-muscle/README.md`、`organs/human-organs/brain/README.md`、`README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`

- [x] **Step 1:** 新 README：动作契约、字段、状态机与参数（全 design）、两个消费者、时序、旧档/重启、未建模（激素、受孕/妊娠、性欲/情绪、伴侣/性病/避孕、显性内容）。
- [x] **Step 2:** `skeletal-muscle/README.md` 补 `sex` 计入活动；`brain/README.md` 补 `sexualArousalMm` 读数（软读、不进 discomfort、无通知）。
- [x] **Step 3:** 根 `README.md` 与 `docs/gateway-and-scripts.md`：根 20/22、女性 22/24，`sex` 动作与用法。
- [x] **Step 4:** `docs/virtual-body.md`：性行为小节（当前实现 / 未建模 / 未验证）；不声称真实 DSH 或独立数据验证。

### Task 6: 全量验证

- [x] **Step 1:** `npm test` 与 `git diff --check` 全部通过。
- [x] **Step 2:** 在本文末尾追加交付记录（已实现 / 已验证 / 仍未实现 / 工作区）。

## 交付记录（2026-11-23）

- **已实现：** 新动作 `sex { intensity, durationMin }`（与 `exercise` 同校验）与无载荷 `orgasm`；新部位 `sexualResponse`（唤醒 `arousalMm`、`phase`、剩余活动、`lastOrgasmAtSimMin`）。高潮两条路径：轮初 `arousalMm >= 70` 时 `orgasm` 主动释放（低于 70 被忽略），`>= 95` 无动作强制释放；释放轮 `orgasm`（1 min），下一轮 `refractory`（20 min），不应期内新 `sex` 动作更新剩余分钟但不提升唤醒。`physicalActivity` 把 `sex` 与 `exercise` 同样计入剩余活动；`interoception` 新增 `sexualArousalMm` 读数（软读，不进 discomfort、无通知）。根清单 20 部位 / 22 参数、女性清单 22 / 24；六个参数全部 design/null。LLM 只控制输入，`urinate` 与 `orgasm` 是少数允许主动触发的输出且都有非自主兜底。
- **已验证：** sexualResponse 单元 16/16（含 70 边界、60 忽略、95 强制、不应期）；`activity` 10/10；`interoception` 27/27（原有用例不变 + 新读数）；真实 Gateway 6/6（唤醒上升 + 汗/呼吸失水/肌糖原通量、80 主动释放、60 忽略、95 强制、女性清单）；`dsh.tools` 等计数/schema 112/112。最终 `npm test` 500/500、0 fail；`git diff --check` 通过。
- **实施中修正：** owner 要求"尽量少模型介入"，高潮由"跨 90 自动记录"改为"≥70 可主动 + ≥95 强制"两段阈值，spec/plan/模块/文档同步；README 按 owner 要求改为器官清单 + agent 行为，不列性行为。
- **仍未实现/未验证：** 激素（催产素/催乳素/内啡肽）、心率/血压/通气、受孕/妊娠/生育力窗、性欲/情绪、伴侣/性病/避孕、显性内容、真实 DSH 会话、独立生理数据、临床验证、20 部位性能。
- **工作区：** 本批未 commit、未 push；肺、肌肉、生殖、性反应四批均未提交；根目录传输归档未跟踪保留。
