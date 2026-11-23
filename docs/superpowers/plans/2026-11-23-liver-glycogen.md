# 肝糖原与胰高血糖素 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 血糖自调节双向闭环：高血糖 → 胰岛素 ↑ → 肌肉/肝/残余/肾糖处置；低血糖 → 胰高血糖素 ↑ → `liver` 当轮释放肝糖原 → 血糖回升。根清单 23 部位 / 25 参数、女性 25 / 27，硬闭包 10（根）/ 11（女性）。

**Architecture:** `pancreasEndocrine` 新增 `glucagonRelative`；`liver` 持有 `glycogenG`，储存经 `glucose → liver.storageG`、释放由 `liver` 自己发起 `liver.glycogenG → glucose.glucoseMassG`（当轮、钳到存量）；`glucose` 把 `D_total` 按 0.75/0.15/0.10 拆分。Task 1–3 与 Task 5 文件不重叠可并行，Task 4 依赖其落地。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-liver-glycogen-design.md`

## Global Constraints

- 代码、测试、配置和参数通过 AgentSwarm 分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；别的分片尚未落地导致的红测试只报告、不绕过；不改 plan/spec。
- 低于基线"保持原质量、不虚构肝糖补充"的旧决定**由 owner 推翻**：改为由 `liver` 真实转移补回，且恒受存量限制，耗尽不虚构。
- 份额在肝未满时合计 1（肌肉 0.75 / 肝 0.15 / 残余 0.10），超基线 `glucoseMassG` 与旧轨迹一致到 ≤ 1 ulp；肾糖 `X = min(R, M_after)` 逐位不变。**肝糖原容量 `liver.glycogenCapacityG = 100`：`L = min(D_total × 0.15, max(0, capacity − (liver.glycogenG + liver.storageG)))`，`D = 0.10 × D_total` 固定，`disposedTotal = U + L + D`（肝满时 < D_total），存不下的肝份额留在血里、血糖下降变慢；`glucose` 读轮初 `liver` 三个字段计算剩余容量。**
- Gateway 先应用 write，再按目标名排序逐笔 transfer（`gateway/operations.js:206`）：`liver.glycogenG → glucose.glucoseMassG`（释放）目标最前，随后肾糖、`liver.storageG`、`muscleGlucose.uptakeG`；write `W = M_after + U + L` 保证余额。
- 质量账新增 `(liver.glycogenG − initialGlycogenG) + liver.storageG`；`liver.outputG` 是内部转移记录，不进账。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，已加载但字段缺失/非有限/为负抛错使本轮失败。
- 所有新参数 `design`、`source: null`；状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`，仓库根不留新文件。

## Review Focus

- 释放钳到 `prev.glycogenG + prev.storageG`，存量耗尽 `release = 0`（Task 2）。
- 低于基线由释放补回而非保持原质量；缺 `liver` 的含 `glucose` 清单启动报 `transferIn source "liver.glycogenG" is not declared` 或对应 transferOut 未声明（Task 3/4）。
- 份额合计 1，超基线轨迹 ≤ 1 ulp（Task 3）。
- 质量账含肝糖原存量差与在途储存，`outputG` 不重复计（Task 4）。
- 无胰腺时 `glucagonRelative = 1`，`insulinRelative` 行为不变（Task 1）。

---

### Task 1: 胰腺 glucagonRelative

**Files:**
- Modify: `organs/human-organs/pancreas/insulin.ts`、`organs/human-organs/pancreas/insulin.parameters.json`
- Test: 现有胰腺测试文件（`grep -l pancreasEndocrine test/` 找）

- [x] **Step 1: 加失败测试**：`G = 70` 时 `glucagonRelative > 1` 并随低血糖加深而升高，`G = 110` 时 < 1，`G = 90` 保持 1；上限 5、下限 0、10 min 半时；既有 `insulinRelative` 断言不变。
- [x] **Step 2: 运行该测试文件**，预期新用例失败。
- [x] **Step 3: 实现**：目标 `clamp(1 + 0.02 × (90 − G), 0, 5)`，按 10 min 半时一阶趋近；`fields` 与 `initialState` 加 `glucagonRelative = 1`（`1`、`absolute`）；头注释写明消费者是 `liver`、无量纲不是浓度。
- [x] **Step 4: 参数文件加 `pancreasEndocrine.glucagon.*` 三项**（design/null）。
- [x] **Step 5: 运行**，预期全绿。

### Task 2: liver 模块（TDD）

**Files:**
- Create: `organs/human-organs/liver/glycogen.ts`、`organs/human-organs/liver/glycogen.parameters.json`
- Test: `test/organs.liver.test.mjs`（新建）

**Interfaces:**
- Produces: `id = 'liver'`、`actionTypes = []`、`initialState = { glycogenG: 80, storageG: 0, outputG: 0 }`、`fields.glycogenG = { unit: 'g', mode: 'absolute', transferOut: ['glucose.glucoseMassG'] }`、`fields.storageG = { unit: 'g', mode: 'absolute', transferIn: ['glucose.glucoseMassG'] }`、`fields.outputG = { unit: 'g', mode: 'absolute' }`；读轮初 `glucose.concentrationMgDl`、`pancreasEndocrine.glucagonRelative`（Task 1 提供）。

- [x] **Step 1: 写失败测试**：contract；参数（`liver.maxOutputRateGPerMin = 1`、`liver.initialGlycogenG = 80`、`liver.glycogenCapacityG = 100`，均 design/null）；`prev.storageG = 5` 时存量并入；`G = 70` 且 glucagon 2 → `release = min(2 × dtMin, stored)` 并 transfer 到 `glucose.glucoseMassG`；`G = 110` 且 glucagon 0.5 → 不释放；存量 0.5 时释放钳到 0.5、耗尽后下轮 release 0；`outputG` 等于实际释放；无胰腺按 glucagon 1；非法上游抛错且零写入；JSON-safe。
- [x] **Step 2: 运行 `node --test test/organs.liver.test.mjs`**，预期模块不存在而失败。
- [x] **Step 3: 实现模块**：按 spec 公式（`stored = prev.glycogenG + prev.storageG`，write `glycogenG = max(0, stored)`、`storageG = 0`、`outputG = release`，随后 transfer release）；头注释写明消费者（`glucose`）、自调节方向、全部 design。
- [x] **Step 4: 写参数文件**（`owner liver`，含 `liver.maxOutputRateGPerMin`、`liver.initialGlycogenG`、`liver.glycogenCapacityG` 三项；`glucose.liverDisposalShare` 归 Task 3 的 `glucose.parameters.json`）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。

### Task 3: glucose 肝储存份额与释放接入（TDD）

**Files:**
- Modify: `organs/human-compartments/glucose/glucose.ts`、`organs/human-compartments/glucose/glucose.parameters.json`
- Test: `test/organs.glucose.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `liver.storageG` / `liver.glycogenG` 字段名（用 stub，不 import 真模块）。
- Produces: `fields.glucoseMassG.transferOut = ['kidneyGlucose.excretedGlucoseG', 'liver.storageG', 'muscleGlucose.uptakeG']`、`transferIn = ['smallIntestine.carbohydrateG', 'liver.glycogenG']`；`L = min(D_total × 0.15, max(0, liver.glycogenCapacityG − (liver.glycogenG + liver.storageG)))`；`D = 0.10 × D_total`（固定，不承接存不下的肝份额）；`disposedTotal = U + L + D`；`M_after = M − disposedTotal`；`W = M_after + U + L`；`L_paid = min(L, W − X − U_paid)`；`IO` 增加 `read('liver')`；参数 `glucose.liverDisposalShare = 0.15`。

- [x] **Step 1: 改测试为失败**：fields deepEqual 双向声明；注册表 stub 加 `liver`（`glycogenG.transferOut`、`storageG.transferIn`）；份额断言（`U = 0.75 D_total`、`L = 0.15 D_total`、`D = 0.10 D_total`、超基线提交质量 ≤ 1 ulp）；`L_paid = min(L, W − X − U_paid)`；缺 `liver` 的注册表启动报错；`disposed + U_paid + L_paid = D_total`；低于基线时 `liver` 释放经 transferIn 入账（`transferIn` 声明测试）。
- [x] **Step 2: 运行 `node --test test/organs.glucose.test.mjs`**，预期失败。
- [x] **Step 3: 改 `glucose.ts`**：加载 `glucose.liverDisposalShare`，按 spec 公式拆分与 transfer；`IO` 类型补 `liver` 目标签名与 `read('liver')`；头注释写明双向自调节与份额。
- [x] **Step 4: `glucose.parameters.json` 加 `glucose.liverDisposalShare`**（0.75 肌肉 / 0.15 肝 / 0.10 残余的说明，design/null）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。`test/parameters.test.mjs` 与 Gateway 测试归 Task 4，不要改。

### Task 4: 清单、计数与真实 Gateway

**Files:**
- Modify: `body-modules.json`、`body-modules.female.json`
- Modify: `test/organs.gateway.test.mjs`、`test/organs.modules.test.mjs`、`test/parameters.test.mjs`、`test/dsh.tools.test.mjs`、`test/organs.di.test.mjs`、`test/organs.reproductive-gateway.test.mjs`、`test/organs.water-gateway.test.mjs`、`test/organs.glucose-gateway.test.mjs`、`test/organs.sexual-response-gateway.test.mjs`、`test/organs.blood-oxygen-gateway.test.mjs`（凡含部位列表者）
- Test: `test/organs.liver-gateway.test.mjs`（新建）

- [x] **Step 1:** 两份清单各加 `liver/glycogen.ts`；根 23 部位 / 25 参数、女性 25 / 27；闭包 10（根）/ 11（女性）。
- [x] **Step 2:** 同步计数、部位列表与初值（`liver` 初值 80/0/0、`pancreasEndocrine` 含 `glucagonRelative = 1`），用 `grep -l bloodOxygen test/` 找齐。
- [x] **Step 3:** `organs.glucose-gateway.test.mjs` 质量账加 `(liver.glycogenG − 80) + liver.storageG`，`disposedGlucoseG` 期望改 0.10 倍；`liver-gateway` 新用例：餐后血糖先升后降且 `liver.storageG > 0`；预置低血糖 + 肝糖原 → 血糖回升、存量下降、`glucagonRelative` 升高；存量耗尽后血糖不回升；逐轮质量账（含肝糖原两项）成立；缺 `liver` 清单启动报错；重启接续。
- [x] **Step 4: 运行** 新增与所改测试文件，再 `npm test`，预期全绿。

### Task 5: 文档

**Files:**
- Create: `organs/human-organs/liver/README.md`
- Modify: `organs/human-compartments/glucose/README.md`、`organs/human-organs/pancreas/README.md`、`organs/human-organs/kidney/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`

- [x] **Step 1:** 新 README：部位、字段、参数（全 design）、自调节双向链（胰岛素处置 / 胰高血糖素释放）、时序、旧档/重启、未建模（胆汁/解毒/蛋白合成/脂肪代谢/激素绝对浓度）。
- [x] **Step 2:** `glucose/README.md`：份额拆分 0.75/0.15/0.10、释放 transferIn、质量账新增两项、低于基线改为真实补回；`pancreas/README.md` 补 `glucagonRelative`；`kidney/README.md` 闭包 10/11。
- [x] **Step 3:** `docs/gateway-and-scripts.md` 与 `docs/virtual-body.md`：根 23/25、女性 25/27，双向自调节小节（当前实现 / 未建模 / 未验证）。
- [x] **Step 4:** 不改根 `README.md`（主代理统一）。

### Task 6: 全量验证

- [x] **Step 1:** `npm test` 与 `git diff --check` 全部通过。
- [x] **Step 2:** 在本文末尾追加交付记录（已实现 / 已验证 / 仍未实现 / 工作区）。

## 交付记录（2026-11-23）

- **已实现：** 血糖双向自调节。`pancreasEndocrine` 新增 `glucagonRelative`（低血糖驱动，无量纲）；`liver` 持有 `glycogenG`（初始 80、容量 100），储存经 `glucose → liver.storageG`，低血糖/高胰高血糖素时当轮自行释放 `liver.glycogenG → glucose.glucoseMassG`（钳到存量，耗尽不虚构）。`glucose` 超基线处置拆分为肌肉 0.75 / 肝 0.15 / 残余 0.10；储存受容量限制，`disposedTotal = U + L + D`，肝满时未储存份额留在血里、血糖下降变慢。根清单 23 部位 / 25 参数、女性 25 / 27，硬闭包 10（根）/ 11（女性）。
- **已验证：** 胰腺 15/15、肝单元 13/13、glucose 24/24（份额拆分、容量钳制、满肝轨迹差 = 0.15 × D_total、守恒）；真实 Gateway：餐后血糖先升后降且 `liver.storageG > 0`，低血糖 + 肝糖原 → 血糖回升、存量下降、胰高血糖素升高，存量耗尽不回升，满肝比自由容量下降慢，缺 `liver` 清单启动报错，重启接续；逐轮质量账含 `(liver.glycogenG − 80) + liver.storageG` 成立。最终 `npm test` 566/566、0 fail；`git diff --check` 通过。
- **实施中修正：** ① 肝释放由 `liver` 当轮自行发起（不走请求—结算滞后）；② Gateway 排序键为 `fromPart.fromField->target`，转出先于释放入账，`W = M_after + U + L` 覆盖转出；③ owner 追加容量上限后，初版容量只改账本分项（`D = D_total − U − L`），改为 `D = 0.10 × D_total` 固定 + `disposedTotal = U + L + D`，使容量真正影响轨迹。
- **仍未实现/未验证：** 肾糖异生（后续项）、胰岛素/胰高血糖素绝对浓度、肝糖原实测、独立血糖曲线、真实 DSH 会话、临床验证、23 部位性能；骨髓造血与免疫搁置、胆囊不做。
- **工作区：** 本批未 commit、未 push；前四批已推送 `134d1ff`，血氧与肝两批在工作区未提交；根目录传输归档未跟踪保留。
