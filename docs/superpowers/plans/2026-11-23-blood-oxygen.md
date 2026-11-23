# 血氧池与肺通气 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 行为与消化产生氧耗、肺自动通气、供不足出血氧下降与气促读数：新增 `bloodOxygen` 隔室、`lungsVentilation` 部位与 `interoception.dyspneaMm`；根清单 22 部位 / 24 参数、女性清单 24 / 26。

**Architecture:** `bloodOxygen` 合成需氧（基础 + 活动 + 消化）并读轮初肺泡供氧算 SpO2；`lungsVentilation` 读轮初需氧自动调通气（潮气量 × 频率）并触顶；两者软读、一轮滞后，无 transfer、闭包不变。Task 1–3 与 Task 5 文件不重叠可并行，Task 4 依赖其落地。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-blood-oxygen-design.md`

## Global Constraints

- 代码、测试、配置和参数通过 AgentSwarm 分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；别的分片尚未落地导致的红测试只报告、不绕过；不改 plan/spec。
- 血氧池是供—需平衡，不做质量守恒账；需氧上升自动驱动通气，LLM 不控制呼吸。
- 所有新参数 `design`、`source: null`；不做血气分压、血红蛋白、心输出量、CO2、高原/病理缺氧、通气动作、气促通知。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，已加载但字段缺失/非有限/为负抛错使本轮失败。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`，仓库根不留新文件。

## Review Focus

- 供需相等时 `oxygenDeficit = 0`、`spo2Percent = 97`；需求为 0 的边界不产生 NaN（Task 1）。
- 通气触顶：`maxVentilationMlMin` 限制后供给不足，SpO2 下降且 `dyspneaMm > 0`（Task 2/4）。
- 无活动时只有基础 + 消化需氧，通气回到静息（Task 1/2）。
- 旧清单无 `bloodOxygen`：`interoception` 其余读数与 `discomfort` 逐点不变（Task 3）。
- `lungsVentilation` 与 `bloodOxygen` 互为轮初读取，缺失回退不成环报错（Task 1/2）。

---

### Task 1: bloodOxygen 隔室（TDD）

**Files:**
- Create: `organs/human-compartments/blood-oxygen/oxygen.ts`、`organs/human-compartments/blood-oxygen/oxygen.parameters.json`
- Test: `test/organs.blood-oxygen.test.mjs`（新建）

**Interfaces:**
- Produces: `id = 'bloodOxygen'`、`actionTypes = []`、字段 `oxygenConsumptionMlMin(mL/min)` / `oxygenSupplyMlMin(mL/min)` / `spo2Percent(%)` / `oxygenDeficit(1)` 均 `absolute`；读轮初 `physicalActivity`、`duodenum.nutrientExposure`、`lungsVentilation.alveolarO2CapacityMlMin`（Task 2 提供，默认 9000）。

- [x] **Step 1: 写失败测试**：contract；参数（250 / 1000 / 0.1 / 97，design/null）；无活动时 demand = 250 + 消化项；活动 intensity 1 → +1000；`nutrientExposure = 0.5` → +12.5；`supply = min(demand, capacity)`，`capacity` 读 `lungsVentilation.alveolarO2CapacityMlMin`（Task 2 提供，默认 9000）；capacity 9000、demand 1250（含活动首轮）→ deficit 0、SpO2 97；capacity 900 → deficit 0.28、SpO2 = 97 × 0.72；demand 为 0 边界不 NaN；`lungsVentilation` 未加载时 supply = demand、SpO2 保持 97；非法上游抛错且零写入；JSON-safe。
- [x] **Step 2: 运行 `node --test test/organs.blood-oxygen.test.mjs`**，预期模块不存在而失败。
- [x] **Step 3: 实现模块**：按 spec 公式；头注释写明"供—需平衡、不是耗空账本"、全部 design、消费者是 `lungsVentilation` 与 `interoception`。
- [x] **Step 4: 写参数文件**（`owner bloodOxygen`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 2: lungsVentilation 部位（TDD）

**Files:**
- Create: `organs/human-organs/lungs/ventilation.ts`、`organs/human-organs/lungs/ventilation.parameters.json`
- Test: `test/organs.lungs-ventilation.test.mjs`（新建）

**Interfaces:**
- Consumes: Task 1 的 `bloodOxygen.oxygenConsumptionMlMin`。
- Produces: `id = 'lungsVentilation'`、`actionTypes = []`、字段 `tidalVolumeMl` / `respiratoryRatePerMin` / `ventilationMlMin` / `alveolarO2MlMin`（实际供氧读数）/ `alveolarO2CapacityMlMin`（能力上限 = `maxVentilationMlMin × inspiredO2Fraction / deadSpaceFactor`，默认 9000）；未加载 `bloodOxygen` 时按 250 mL/min 基础需氧。

- [x] **Step 1: 写失败测试**：contract；参数（500 / 12 / 40 / 6000 / 60000 / 0.21 / 1.4，design/null）；demand 250 时通气回到静息 6000、频率 12、潮气量 500；demand 上升时通气与频率上升；`maxVentilationMlMin` 触顶后 `alveolarO2MlMin` 封顶；`bloodOxygen` 未加载按基础需氧；非法上游抛错；JSON-safe。
- [x] **Step 2: 运行 `node --test test/organs.lungs-ventilation.test.mjs`**，预期失败。
- [x] **Step 3: 实现模块**：按 spec 公式；头注释写明自动调节（LLM 不控制呼吸）、与 `lungs` 失水部位分工、全部 design。
- [x] **Step 4: 写参数文件**（`owner lungsVentilation`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 3: interoception 气促读数

**Files:**
- Modify: `organs/human-organs/brain/interoception.ts`
- Test: `test/organs.interoception.test.mjs`

- [x] **Step 1: 加失败测试**：`bloodOxygen.oxygenDeficit = 0.2` → `dyspneaMm = 20`；未加载/缺失/NaN → 0；其余读数与 `discomfort` 逐点不变。
- [x] **Step 2: 运行 `node --test test/organs.interoception.test.mjs`**，预期新用例失败。
- [x] **Step 3: 实现**：`fields` 与 `initialState` 加 `dyspneaMm: 0`（`mm`、`absolute`），`IO` 加 `read('bloodOxygen')`，写 `clamp(100 × deficit, 0, 100)`；头注释补口径（不进 discomfort、无通知）。
- [x] **Step 4: 运行**，预期全绿。

### Task 4: 清单与 Gateway

**Files:**
- Modify: `body-modules.json`、`body-modules.female.json`
- Modify: `test/organs.gateway.test.mjs`、`test/organs.modules.test.mjs`、`test/parameters.test.mjs`、`test/dsh.tools.test.mjs`、`test/organs.di.test.mjs`、`test/organs.reproductive-gateway.test.mjs`（计数）、`test/organs.water-gateway.test.mjs`（若列表需要）
- Test: `test/organs.blood-oxygen-gateway.test.mjs`（新建）

- [x] **Step 1:** 两份清单各加 `blood-oxygen/oxygen.ts` 与 `lungs/ventilation.ts`；根 22 部位 / 24 参数、女性 24 / 26。
- [x] **Step 2:** 同步计数与列表（含 `bloodOxygen`、`lungsVentilation` 初值与参数键），用 `grep -l sexualResponse test/` 找齐部位列表。
- [x] **Step 3:** 新建 Gateway 用例：`exercise` 与 `sex` 使需氧与通气上升，正常参数下 SpO2 全程保持基线（含活动首轮）；餐后 `nutrientExposure` 上升带来消化氧耗；低通气能力变体（临时目录复制 `ventilation.ts` + 改参数 `maxVentilationMlMin = 6000` → 能力 900，仿 DI 变体清单写法）下需求超过能力，SpO2 下降、`dyspneaMm > 0`；重启后供需接续。
- [x] **Step 4: 运行** 新增与所改测试文件，再 `npm test`，预期全绿。

### Task 5: 文档

**Files:**
- Create: `organs/human-compartments/blood-oxygen/README.md`
- Modify: `organs/human-organs/lungs/README.md`、`organs/human-organs/brain/README.md`、`organs/human-organs/duodenum/README.md`、`organs/human-organs/skeletal-muscle/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`

- [x] **Step 1:** 新 README：供—需平衡（不是耗空账本）、字段、参数（全 design）、消费者链、时序、旧档/重启、未建模（血气分压/血红蛋白/心输出量/CO2/高原病理/通气动作/气促通知）。
- [x] **Step 2:** `lungs/README.md` 补 `lungsVentilation` 自动通气；`brain/README.md` 补 `dyspneaMm`；`duodenum/README.md` 补消化氧耗消费者；`skeletal-muscle/README.md` 补活动氧耗。
- [x] **Step 3:** `docs/gateway-and-scripts.md`：根 22/24、女性 24/26 与新部位读写关系；`docs/virtual-body.md`：血氧小节（当前实现 / 未建模 / 未验证）。
- [x] **Step 4:** 不改根 `README.md`（其格式由主代理维护，计数由主代理统一）。

### Task 6: 全量验证

- [x] **Step 1:** `npm test` 与 `git diff --check` 全部通过。
- [x] **Step 2:** 在本文末尾追加交付记录（已实现 / 已验证 / 仍未实现 / 工作区）。

## 交付记录（2026-11-23）

- **已实现：** 新隔室 `bloodOxygen`（供—需平衡，不是耗空账本）：需氧 = 基础 250 + 活动 1000 × intensity + 消化 0.1 × nutrientExposure × 250；`supply = min(demand, capacity)`，SpO2 = 97 × (1 − deficit)。新部位 `lungsVentilation`：按轮初需氧自动调通气（潮气量 500 × 频率 12–40、静息 6000、上限 60000 mL/min），`alveolarO2CapacityMlMin = 9000` 供 SpO2 判定。`interoception` 新增 `dyspneaMm`（软读，不进 discomfort、无通知）。根清单 22 部位 / 24 参数、女性 24 / 26；无新 transfer，闭包不变。参数全 design/null。
- **已验证：** bloodOxygen 10/10、lungsVentilation 9/9、interoception 30/30（原有用例不变 + 气促读数）；真实 Gateway 4/4：`exercise`/`sex` 需氧峰值 1250、通气上升、SpO2 全程 97（含活动首轮）；固体餐消化氧耗随 `nutrientExposure` 上升；低能力变体（maxVentilation 6000 → capacity 900）SpO2 = 69.84、`dyspneaMm ≈ 28`；重启供需接续。最终 `npm test` 531/531、0 fail；`git diff --check` 通过。
- **实施中修正：** 评审发现"用上一轮通气量算 SpO2"会在活动首轮产生 ~30% 假性去饱和，改为按需求 vs 通气能力上限判定；`alveolarO2MlMin` 保留为滞后读数。触顶无法由行为触发（上限 9000 远超需氧），去饱和改用低通气能力变体验证。
- **仍未实现/未验证：** 血气分压、血红蛋白与氧合曲线、心输出量、CO2 与酸碱、高原/病理缺氧、通气动作（LLM 不控制呼吸）、气促通知、真实 DSH 会话、独立生理数据、临床验证、22 部位性能。
- **工作区：** 本批未 commit、未 push；前四批已提交 `134d1ff` 并推送 GitHub；根目录传输归档未跟踪保留。
