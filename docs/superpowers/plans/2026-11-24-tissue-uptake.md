# 各部位自主摄糖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把血糖清除从中央摊派改为各部位自主响应：肌肉/肝按各自参数（最大速率、半饱和、胰岛素敏感度、容量）计算摄糖请求，`glucose` 只持池、算自身残余清除并按序结算；总轨迹由组织响应涌现，质量守恒逐轮成立。

**Architecture:** `glucose` 新增 `excessMassG` 只读字段；`muscleGlucose.uptakeRequestG`、`liver.storageRequestG` 由各自模块按自身参数写出，`glucose` 按"肾 → 肝 → 肌"支付并钳位。释放仍只由 `liver` 当轮发起。Task 1–3 与 Task 5 文件不重叠可并行，Task 4 依赖其落地。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-tissue-uptake-design.md`

## Global Constraints

- 代码、测试、配置和参数通过 AgentSwarm 分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；别的分片尚未落地导致的红测试只报告、不绕过；不改 plan/spec。
- **废止** `muscleDisposalShare` / `liverDisposalShare` 份额参数与 `D_total` 总清除量概念；总轨迹由组织响应涌现，不再承诺与旧模型逐位一致。
- `glucose.apparentDisposalHalfTimeMin` 改名 `residualDisposalHalfTimeMin`（值仍 60），仅用于 `glucose` 自身残余清除，不再按 `insulinRelative` 缩放。
- 结算顺序为 `policy`：肾 → 肝 → 肌；`W = M_after`，三笔转出按序从中扣减，提交质量 = `M_after − X − L_paid − U_paid`，余额不足时后结算者被钳位；Gateway 排序键为 `fromPart.fromField->target`。
- 质量账恒等式：`M_start = M_final + X + (D + L_paid + U_paid)`；外源碳水质量账各项不变。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，已加载但字段缺失/非有限/为负抛错使本轮失败。
- 所有新参数 `design`、`source: null`；状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`，仓库根不留新文件。

## Review Focus

- `excessMassG` 只由 `glucose` 写出，各组织只读不写（Task 3）。
- 请求与到账分离：`uptakeRequestG` / `storageRequestG` 每轮重写，`uptakeG` / `storageG` 每轮归 0 后由 transferIn 加入（Task 1/2）。
- 肝容量仍生效：请求先按自身速率算，再钳到 `glycogenCapacityG − (glycogenG + storageG)`（Task 2）。
- 余额不足时后结算者被钳位，守恒仍精确（Task 3）。
- 旧档补 `excessMassG` 由轮初质量现算、请求字段补 0（Task 3/4）。

---

### Task 1: muscleGlucose 自主摄糖请求

**Files:**
- Modify: `organs/human-organs/skeletal-muscle/glucose-uptake.ts`、`organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json`
- Test: `test/organs.muscle-glucose.test.mjs`

**Interfaces:**
- Produces: 新字段 `uptakeRequestG`（`g`、`absolute`）；`uptakeG` 仍为 `transferIn: ['glucose.glucoseMassG']` 每轮归 0；读轮初 `glucose.excessMassG` 与 `pancreasEndocrine.insulinRelative`（Task 3 提供 excess 字段）。
- 新参数：`muscleGlucose.maxUptakeRateGPerMin = 0.5`、`halfMaxExcessG = 20`、`insulinSensitivity = 1.0`（design/null）。

- [x] **Step 1: 改测试为失败**：`excess = 20`、`I = 1` → request = `0.5 × (20/40) × 1 × dtMin`；`I = 2` → 翻倍；`excess = 0` → 0；请求每轮重写、`uptakeG` 仍归 0 后接 transferIn；糖原入账与运动消耗行为不变；非法 `excessMassG` / `insulinRelative` 抛错且零写入。
- [x] **Step 2: 运行 `node --test test/organs.muscle-glucose.test.mjs`**，预期失败。
- [x] **Step 3: 实现**：按 spec 公式计算 `uptakeRequestG`，不再读取任何"份额"参数；头注释写明自主响应（最大速率/半饱和/敏感度）与两个消费者（糖原、运动消耗）。
- [x] **Step 4: 参数文件替换为三项新参数**（`muscleDisposalShare` 不再存在于任何文件）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 2: liver 自主摄糖请求

**Files:**
- Modify: `organs/human-organs/liver/glycogen.ts`、`organs/human-organs/liver/glycogen.parameters.json`
- Test: `test/organs.liver.test.mjs`

**Interfaces:**
- Produces: 新字段 `storageRequestG`（`g`、`absolute`）；`storageG` 仍为 `transferIn` 每轮归 0；读轮初 `glucose.excessMassG`、`pancreasEndocrine.insulinRelative`；保留 `glycogenCapacityG` 与当轮释放。
- 新参数：`liver.maxUptakeRateGPerMin = 0.2`、`halfMaxExcessG = 15`、`insulinSensitivity = 0.5`（design/null）。

- [x] **Step 1: 改测试为失败**：`excess = 15`、`I = 1` → request = `0.2 × (15/30) × 1 × dtMin`；`I = 3` → response = 2；请求再钳到剩余容量（`capacity − (glycogenG + storageG)`）；容量为 0 时 request 0；释放逻辑不变；非法上游抛错且零写入。
- [x] **Step 2: 运行 `node --test test/organs.liver.test.mjs`**，预期失败。
- [x] **Step 3: 实现**：按 spec 公式；头注释写明自主摄糖 + 自行释放，只有肝向血液放糖。
- [x] **Step 4: 参数文件加三项新参数**（保留 `maxOutputRateGPerMin`、`initialGlycogenG`、`glycogenCapacityG`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 3: glucose 结算改造

**Files:**
- Modify: `organs/human-compartments/glucose/glucose.ts`、`organs/human-compartments/glucose/glucose.parameters.json`
- Test: `test/organs.glucose.test.mjs`

**Interfaces:**
- Produces: 新字段 `excessMassG`（`g`、`absolute`）；`D = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))`；`W = M_after`；`L_paid = min(liver.storageRequestG, M_after − X)`、`U_paid = min(muscleGlucose.uptakeRequestG, M_after − X − L_paid)`；`IO` 读 `liver` 与 `muscleGlucose` 请求字段。

- [x] **Step 1: 改测试为失败**：`excessMassG` 写出且只由本部位写；残余清除不再按 I 缩放；按"肾 → 肝 → 肌"结算并钳位（余额不足时后者被钳）；`W = M_after`，提交质量 = `M_after − X − L_paid − U_paid`；`D + L_paid + U_paid` 与 `M_start − M_final − X` 相等；缺 `liver` 或 `muscleGlucose` 启动报错；旧档 `excessMassG` 由轮初质量现算。
- [x] **Step 2: 运行 `node --test test/organs.glucose.test.mjs`**，预期失败。
- [x] **Step 3: 改 `glucose.ts`**：按 spec 公式；删除份额拆分与 `D_total`；头注释写明"只持池 + 自身残余清除 + 按序结算请求"。
- [x] **Step 4: 参数文件**：`apparentDisposalHalfTimeMin` 改名 `residualDisposalHalfTimeMin`，删除 `muscleDisposalShare`、`liverDisposalShare`。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。`test/parameters.test.mjs` 与 Gateway 测试归 Task 4，不要改。

### Task 4: 清单、参数计数与真实 Gateway

**Files:**
- Modify: `test/organs.gateway.test.mjs`、`test/organs.modules.test.mjs`、`test/parameters.test.mjs`、`test/dsh.tools.test.mjs`、`test/organs.di.test.mjs`、`test/organs.reproductive-gateway.test.mjs`、`test/organs.water-gateway.test.mjs`、`test/organs.glucose-gateway.test.mjs`、`test/organs.liver-gateway.test.mjs`、`test/organs.sexual-response-gateway.test.mjs`、`test/organs.blood-oxygen-gateway.test.mjs`（凡含部位/参数列表者）
- Test: `test/organs.tissue-uptake-gateway.test.mjs`（新建）

- [x] **Step 1:** 同步参数键与新字段初值（`excessMassG`、`uptakeRequestG`、`storageRequestG`），用 `grep -l muscleDisposalShare test/ organs/` 找齐废止参数引用。
- [x] **Step 2:** `organs.glucose-gateway.test.mjs` 与 `liver-gateway.test.mjs` 改为涌现轨迹与守恒断言（不再断言旧固定轨迹）。
- [x] **Step 3:** 新 Gateway 用例：餐后血糖先升后降；高胰岛素时肌肉摄糖增加而肝增加较少；低血糖时只有肝释放、肌肉无释放；肝满后 `storageRequestG = 0`；重启接续；逐轮质量账。
- [x] **Step 4: 运行** 新增与所改测试文件，再 `npm test`，预期全绿。

### Task 5: 文档

**Files:**
- Modify: `organs/human-compartments/glucose/README.md`、`organs/human-organs/skeletal-muscle/README.md`、`organs/human-organs/liver/README.md`、`organs/human-organs/pancreas/README.md`、`organs/human-organs/kidney/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`

- [x] **Step 1:** 三份部位 README 改为"自主响应"口径：各自参数（最大速率/半饱和/敏感度/容量）、请求与到账分离、消费者；废止份额表述。
- [x] **Step 2:** `pancreas/README.md` 写明胰岛素被各组织各自使用（肌肉 1.0、肝 0.5），不再统一缩放总清除。
- [x] **Step 3:** `docs/gateway-and-scripts.md` 与 `docs/virtual-body.md`：请求—结算链、`excessMassG`、涌现轨迹、参数更名与废止、质量账。
- [x] **Step 4:** 不改根 `README.md`（主代理统一）。

### Task 6: 全量验证

- [x] **Step 1:** `npm test` 与 `git diff --check` 全部通过。
- [x] **Step 2:** 在本文末尾追加交付记录（已实现 / 已验证 / 仍未实现 / 工作区）。

## 交付记录（2026-11-24）

- **已实现：** 血糖清除从中央摊派改为各部位自主响应。`glucose` 新增 `excessMassG` 只读字段，自身只做残余清除（`residualDisposalHalfTimeMin = 60`，不再按胰岛素缩放）并按"肾 → 肝 → 肌"结算请求；`muscleGlucose.uptakeRequestG`（最大速率 0.5、半饱和 20、胰岛素敏感度 1.0）与 `liver.storageRequestG`（0.2 / 15 / 0.5，另受 `glycogenCapacityG` 容量钳位）由各模块独立计算，`W = M_after`，提交质量 = `M_after − X − L_paid − U_paid`。释放仍只由 `liver` 当轮发起。份额参数 `muscleDisposalShare` / `liverDisposalShare` 与 `D_total` 概念废止，`apparentDisposalHalfTimeMin` 更名 `residualDisposalHalfTimeMin`。根清单 23 部位 / 25 参数、女性 25 / 27。
- **已验证：** 肌肉 13/13、肝 17/17、glucose 21/21；真实 Gateway 5/5：餐后血糖先升后降（涌现轨迹）、高胰岛素时肌肉摄糖增量大于肝（敏感度 1.0 vs 0.5）、低血糖只由肝释放且肌肉无释放、肝满 `storageRequestG = 0`、重启在途请求只入账一次；`organs.glucose-gateway` 等改为涌现轨迹与守恒断言，`W = M_after` 下逐轮质量账成立。最终 `npm test` 577/577、0 fail；`git diff --check` 通过。
- **实施中修正：** spec 初稿 `W = M_after + L_paid + U_paid` 与守恒式矛盾（会凭空多出 L+U），改为 `W = M_after`；肝脏容量自上一刀保留并继续生效。
- **仍未实现/未验证：** 各组织实测摄糖速率与半饱和、胰岛素浓度、脂肪组织、独立血糖曲线、真实 DSH 会话、临床验证、23 部位性能。
- **工作区：** 本批未 commit、未 push；血氧与肝两批同在工作区未提交；前四批已推送 `134d1ff`；根目录传输归档未跟踪保留。
