# 骨骼肌摄糖与肌糖原 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增部位 `muscleGlucose`，把 `glucose` 胰岛素缩放超基线清除的 75% 份额真实转移到骨骼肌并以肌糖原储存、运动时消耗；`glucoseMassG` 与 `concentrationMgDl` 轨迹不变（≤ 1 ulp）。

**Architecture:** `glucose.ts` 把现有清除拆成 `U = share × D_total`（transfer 到 `muscleGlucose.uptakeG`）与残余 `disposedGlucoseG`；新脚本 `glucose-uptake.ts` 把上一轮 `uptakeG` 入账糖原、按轮初 `physicalActivity` 消耗并钳到可用量。Task 1 与 Task 2 文件不重叠可并行；Task 3/4 依赖二者落地；Task 5 文档随时可做。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md`

## Global Constraints

- 代码、测试、配置和参数通过 AgentSwarm 分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；因别的分片尚未落地而红的测试只报告、不绕过、不改别人的文件。
- `share = 0.75`、`I = 1` 时 `glucoseMassG`、`concentrationMgDl` 与现有轨迹一致到 ≤ 1 ulp（`W = M_after + U` 跨 binade 时 `W − U` 可差 1 ulp，< 1e-12 g）；肾糖 `X` 与旧模型逐位相同；`disposedGlucoseG` 变为原值 0.25 倍；每轮 `disposed + uptake = D_total`。
- `glucose.glucoseMassG.transferOut` 声明顺序固定为 `['kidneyGlucose.excretedGlucoseG', 'muscleGlucose.uptakeG']`（肾在前，缺目标报错优先提 kidneyGlucose）。Gateway 按目标名排序应用 transfer（`gateway/operations.js:206`），肾糖先于肌肉：肾糖按 `min(R, M_after)` 钳位，肌肉按肾糖后余额封顶 `U_paid = min(U, W − X)`（正常全额；仅测试注入的抽干用例少 1 ulp，守恒精确）。
- 参数 `glucose.muscleDisposalShare = 0.75`（单位 `1`，range `[0, 1]`）、`muscleGlucose.glycogenUseRateGPerMin = 0.5`（`g/min`，range `[0, 5]`）均 `status: design`、`source: null`。
- 每轮只读轮初快照，`dtMin = io.dt / 60`；`physicalActivity` 未加载 → 消耗 0；已加载但字段缺失/非有限/负/强度越界 → 抛错且不写状态。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；不用 `undefined`。
- 根清单 19 部位、21 份参数文件、硬 transfer 闭包 9 部位；文档中文，区分"当前实现 / 未建模 / 未验证"。

## Review Focus

- 在途 `uptakeG` 非零时重启：下一轮只入账一次，质量账不重复计（Task 4 重启用例）。
- 活动刚好归零那轮：轮初 `remainingExerciseMin = 0.5 > 0` 仍按整 dt 消耗，不按比例截断（Task 1）。
- 缺 `muscleGlucose` 的含 `glucose` 清单：启动报 `transferOut target "muscleGlucose.uptakeG" is not declared`（Task 3）。
- 糖原钳位：可用量小于消耗请求时 `glycogenConsumedG` 等于实际消耗、糖原不为负（Task 1）。
- 大 dt（补算）：`dt = 120` 时消耗 1.0 g、`U` 仍 ≤ `D_total`（Task 1 / Task 2）。
- 肾请求抽干池子：肾糖钳到 `M_after`，肌肉按余额封顶（少 1 ulp），提交后质量 ≈ 0，不被 operations 层拒绝，守恒精确（Task 2 两个肾糖用例）。

---

### Task 1: 肌肉模块（新文件，TDD）

**Files:**
- Create: `organs/human-organs/skeletal-muscle/glucose-uptake.ts`
- Create: `organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json`
- Test: `test/organs.muscle-glucose.test.mjs`（新建，仿 `test/organs.lungs.test.mjs`）

**Interfaces:**
- Produces: `id = 'muscleGlucose'`、`actionTypes = []`、`initialState = { uptakeG: 0, glycogenG: 0, glycogenConsumedG: 0 }`、`fields = { uptakeG: { unit: 'g', mode: 'absolute', transferIn: ['glucose.glucoseMassG'] }, glycogenG: { unit: 'g', mode: 'absolute' }, glycogenConsumedG: { unit: 'g', mode: 'absolute' } }`、`heartbeat(io)`；`io.read('muscleGlucose' | 'physicalActivity')`、`io.dt`、`io.write`。

- [x] **Step 1: 写失败测试**（直接调 `heartbeat`，仿 lungs 的假 io）。用例与断言：
  - contract：`id` / `actionTypes` / `initialState` / `fields` deepEqual 如上。
  - parameter：`value 0.5`、`unit 'g/min'`、`status 'design'`、`source null`、`range [0, 5]`。
  - 入账与归零：prev `{ uptakeG: 1.2, glycogenG: 10 }`、无活动 → `{ uptakeG: 0, glycogenG: 11.2, glycogenConsumedG: 0 }`。
  - 运动消耗：prev `glycogenG 10`、活动 `{ remainingExerciseMin: 30, intensity: 1 }`、dt 60 → `consumed 0.5`、`glycogenG 9.5`；dt 120 → `consumed 1.0`；`remainingExerciseMin 0.5`、dt 60 → 仍 `0.5`。
  - 钳位：prev `glycogenG 0.2, uptakeG 0`、intensity 1、dt 60 → `consumed 0.2`、`glycogenG 0`。
  - 活动缺失：`read('physicalActivity')` 返回 undefined → `consumed 0`。
  - 非法活动：`{}`、缺字段、`NaN`、负剩余、`intensity 1.5` → 抛错，`writes.length === 0`。
  - JSON-safe：输出 `Number.isFinite`、`assertJsonValue`、`JSON.parse(JSON.stringify())` 往返。
- [x] **Step 2: 运行 `node --test test/organs.muscle-glucose.test.mjs`**，预期因模块不存在而失败。
- [x] **Step 3: 实现 `glucose-uptake.ts`**：头注释写明无登记来源、全部 `design`、消费者是 `glucose` 质量账与 `physicalActivity`；`activityOf(io)` 沿用 lungs `:87-102` 的校验模式；`heartbeat` 按 spec：`uptake = prev.uptakeG`，`consumed = active ? min(rate × intensity × dtMin, max(0, glycogen) + uptake) : 0`，`write { uptakeG: 0, glycogenG, glycogenConsumedG: consumed }`。自身字段缺失按 0。
- [x] **Step 4: 写 `glucose-uptake.parameters.json`**（`schemaVersion 1`、`owner muscleGlucose`、一个参数，字段齐全仿 `glucose.parameters.json`）。
- [x] **Step 5: 运行 Step 2 命令**，预期全部通过。`test/parameters.test.mjs` 归 Task 3，此时会红，不要改。

### Task 2: glucose 份额拆分（TDD）

**Files:**
- Modify: `organs/human-compartments/glucose/glucose.ts`
- Modify: `organs/human-compartments/glucose/glucose.parameters.json`
- Test: `test/organs.glucose.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `muscleGlucose.uptakeG` 字段契约（本任务用 stub，不 import 真模块）。
- Produces: `fields.glucoseMassG.transferOut = ['kidneyGlucose.excretedGlucoseG', 'muscleGlucose.uptakeG']`；`heartbeat` 新增 `io.transfer(id, 'glucoseMassG', 'muscleGlucose', 'uptakeG', muscleUptakeG)`（肾糖 transfer 之后）；参数 `glucose.muscleDisposalShare`。

- [x] **Step 1: 改测试为失败**：
  - `:130-139` fields deepEqual 的 `transferOut` 加 `'muscleGlucose.uptakeG'`。
  - `:70-86` 注册表 stub 加 `muscleGlucoseStub`（`fields.uptakeG.transferIn: ['glucose.glucoseMassG']`、`initialState` 三字段 0）；加 `muscleTransferG(transfers)` 助手。
  - `:209-210`（I=1）：`disposedGlucoseG = 0.25 × D_total`、提交后 `next.glucose.glucoseMassG = massG − D_total`（≤ 1 ulp；`written.glucoseMassG` 是转移前的 `massG − D_total + U`）、`muscleTransferG = 0.75 × D_total`；`:269-270` 同理。
  - 新增回归：`M = 32.06819103443802` 与 `M = 22.30529217920229`（dt 60、I=1、R=0，审查实测跨 binade 的两个点），提交质量与旧轨迹 `M − D_total` 之差 ≤ 1 ulp / < 1e-12。
  - `:289-302` 恒等式加 `+ next.muscleGlucose.uptakeG`；`:410-419` 累计 disposed 改为累计 `disposed + uptake`。
  - 新增：只移除 `muscleGlucoseStub` → `createFieldRegistry` 抛错且消息匹配 `/muscleGlucose\.uptakeG/`（原 `:173-187` 用例不动，肾在前仍先报 kidneyGlucose）。
  - 新增：dt 120 时 `U = 0.75 × D_total` 且 `U ≤ D_total`（`round()` 助手若无 dt 参数就加一个）。
- [x] **Step 2: 运行 `node --test test/organs.glucose.test.mjs`**，预期失败。
- [x] **Step 3: 改 `glucose.ts`**：加载 `glucose.muscleDisposalShare`；`disposalTotalG = excessG × (1 − 2^(−dtMin × I / halfTime))`；`muscleUptakeG = disposalTotalG × share`；`disposedGlucoseG = disposalTotalG − muscleUptakeG`；`afterDisposalG = startMassG − disposalTotalG`；write `W = afterDisposalG + muscleUptakeG`（用加法构造，避免 `start − disposed` 再扣 `U` 的 1 ulp 轨迹偏差）；`renalExcretionG = min(max(0, R), afterDisposalG)`（与旧模型同一表达式，肾糖逐位不变）；`muscleTransferG = min(U, W − renalExcretionG)`；transfer 肌肉 `muscleTransferG`（`> 0` 时）与肾糖 `renalExcretionG`（Gateway 按目标名排序，肾先肌后）；`IO` 类型补 muscle 目标签名；头注释把"非肾表观清除"改为"非肌、非肾残余清除"，写明肾先肌后、余额封顶、Dalla Man §III.C.3 只支撑分区结构。
- [x] **Step 4: `glucose.parameters.json` 加参数**（仿现有条目；note 写明工程占位、不是引用值）。
- [x] **Step 5: 运行 Step 2 命令**，预期通过。`test/parameters.test.mjs` 与所有 Gateway 测试归 Task 3/4，此时会红，不要改。

### Task 3: 清单、计数与闭包

**Files:**
- Modify: `body-modules.json`
- Modify: `test/organs.modules.test.mjs`、`test/organs.gateway.test.mjs`、`test/parameters.test.mjs`、`test/dsh.tools.test.mjs`、`test/organs.di.test.mjs`

**Interfaces:**
- Consumes: Task 1 模块文件、Task 2 的 `transferOut`。
- Produces: 根清单含 `muscleGlucose`，19 部位 / 21 参数 / 9 闭包的断言。

- [x] **Step 1:** `body-modules.json` 在 `glucose-excretion.ts` 之后插入 `"./organs/human-organs/skeletal-muscle/glucose-uptake.ts"`。
- [x] **Step 2:** `organs.modules.test.mjs`：import 新模块加入 `:5-28` 数组；测试名与 `:43` 断言改为 19。
- [x] **Step 3:** `organs.gateway.test.mjs`：`:12` 名称 nineteen；`:47-66` 排序列表加 `'muscleGlucose'`；`:84-89` 加 `assert.deepEqual(first.parts.muscleGlucose, { uptakeG: 0, glycogenG: 0, glycogenConsumedG: 0 })`；仿 `:108-140` 新增"去掉 muscle 脚本 → `rejects(/transferOut target "muscleGlucose\.uptakeG" is not declared/)`"。
- [x] **Step 4:** `parameters.test.mjs`：`:6-27` 数组加新文件；`:105` 与测试名 20→21；`:82-87` glucose 键表加 `'glucose.muscleDisposalShare'`（排序位在 `distributionVolumeDlPerKg` 之后）；新增该参数断言（0.75 / `'1'` / design / null / `[0, 1]`）。
- [x] **Step 5:** `dsh.tools.test.mjs`：`:244` 18→19；`:245-265` 加 `'muscleGlucose'`；`:270-274` glucose 初值不变。
- [x] **Step 6:** `organs.di.test.mjs`：`:21-40` partIds 加 `'muscleGlucose'`；`:141` 18→19；`:189-191` 加 muscleGlucose 三字段 0 的 deepEqual。DI 清单复制根清单，无需改脚本数组。
- [x] **Step 7: 运行** `node --test test/organs.modules.test.mjs test/organs.gateway.test.mjs test/parameters.test.mjs test/dsh.tools.test.mjs test/organs.di.test.mjs`，预期全部通过。

### Task 4: 真实 Gateway 碳水账本

**Files:**
- Modify: `test/organs.glucose-gateway.test.mjs`

**Interfaces:**
- Consumes: Task 3 的根清单。
- Produces: 含肌肉三项的质量账与运动消耗用例。

- [x] **Step 1:** `:67-74` 账本函数加 `+ parts.muscleGlucose.glycogenG + parts.muscleGlucose.uptakeG + cumulativeMuscleConsumedG`；`:194/:203` 的 60 g 容差断言不变；`:260-296`、`:537/:580/:617/:703` 逐轮账加肌肉项，精确 `disposedGlucoseG` 期望改为 0.25 倍。
- [x] **Step 2:** 新增用例：餐后若干轮糖原上升且每轮账本成立；`submitAction({ type: 'exercise', intensity: 1, durationMin: 30 })` 后每轮 `glycogenConsumedG = 0.5`、糖原下降；运动结束消耗归 0。
- [x] **Step 3:** 新增用例：在途 `uptakeG > 0` 时在同一 `statePath` 重启，下一轮只入账一次，重启前后账本均成立。
- [x] **Step 4: 运行 `node --test test/organs.glucose-gateway.test.mjs`**，预期通过。

### Task 5: 文档同步

**Files:**
- Modify: `README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`、`organs/human-compartments/glucose/README.md`、`organs/human-organs/skeletal-muscle/README.md`、`organs/human-organs/kidney/README.md`、`organs/human-organs/pancreas/README.md`

- [x] **Step 1: 计数与闭包**：`README.md:41,43`、`docs/gateway-and-scripts.md:22,111`、`docs/virtual-body.md:443,481,483`、`glucose/README.md:7,15`、`kidney/README.md:7,165-182`、`pancreas/README.md:7,88` 的 18→19、20→21、八→九，闭包列表加 `muscleGlucose`。
- [x] **Step 2: 转移与账本**：`docs/gateway-and-scripts.md:122,131`、`docs/virtual-body.md:453,460,478`、`glucose/README.md:27,52,55,85`、`kidney/README.md:195` 加 `glucose.glucoseMassG → muscleGlucose.uptakeG` 与账本的肌肉三项。
- [x] **Step 3: glucose README §1–§4、§6**：脚本表、字段、公式块（`D_total` / `U` / `D`）、参数表加 `muscleDisposalShare`，"未建模"改为"不建胰岛素浓度…肝糖原、脂肪组织分区、肌糖原容量/静息周转"。
- [x] **Step 4: skeletal-muscle README**：新增 `glucose-uptake.ts` 小节（部位、字段、参数、消费者、时序、未建模：无容量上限/静息周转/乳酸回流/分区）。
- [x] **Step 5: 现状表述**：`docs/virtual-body.md:30,354,485`、`glucose/README.md:102`、`pancreas/README.md:101` 把"组织摄糖分区、糖原"从"未实现"移到"M2 薄切片已含肌摄糖与肌糖原"，保留肝糖原/胰岛素浓度/脂肪分区未实现；不声称真实 DSH 或独立数据验证。

### Task 6: 全量验证与审查

- [x] **Step 1:** `npm test` 与 `git diff --check` 全部通过。
- [x] **Step 2:** 独立审查对照 spec：单写者、轮初快照、`disposed + uptake = D_total`、守恒、重启、清单配对、证据标签；非阻塞 Minor 不扩修。
- [x] **Step 3:** 清理临时产物；在本文末尾追加交付记录（已实现 / 已验证 / 仍未实现 / 工作区）。

## 交付记录（2026-11-23）

- **已实现：** 新部位 `muscleGlucose`（`organs/human-organs/skeletal-muscle/glucose-uptake.ts` + 参数）：上一轮 `uptakeG` 入账糖原，按轮初 `physicalActivity` 以 `0.5 g/min × intensity × dtMin` 消耗并钳到可用量。`glucose.ts` 把 `D_total` 按 `glucose.muscleDisposalShare = 0.75` 拆成肌肉 `U`（transfer → `muscleGlucose.uptakeG`）与残余 `disposedGlucoseG`；write `W = M_after + U`，肾糖 `X = min(R, M_after)`（旧表达式，逐位不变），肌肉按 Gateway（按目标名排序，肾先肌后）结算后的余额封顶 `U_paid = min(U, W − X)`。根清单 19 部位、21 份参数、9 部位硬 transfer 闭包；两个参数均 `design`、`source: null`。
- **已验证：** 肌单元 8/8；glucose 单元 16/16（含跨 binade 回归 32.068 g / 22.305 g：提交质量与旧轨迹差 < 1e-12 g，`disposed + uptake = D_total`）；真实 Gateway 碳水账本含 `glycogenG + uptakeG + 累计 glycogenConsumedG`，覆盖餐后累积、30 分钟运动每活跃轮 0.5 g、在途 `uptakeG` 重启只入账一次；缺 `muscleGlucose` 的含 `glucose` 清单启动报 `transferOut target "muscleGlucose.uptakeG" is not declared`。最终 `npm test` 434/434、0 fail；`git diff --check` 通过。独立审查九项核对通过，20 万组随机 `M/dt/I/R` 调用真实模块 + `applyOperations` 0 次余额拒绝；1 个 Important（"逐位一致"过度承诺）已修。
- **实施中修正的 spec 错误：** ① 原稿"肾糖先结算、`U` 不做钳位"在 write-then-transfer 语义下会被 operations 层以 1 ulp 之差拒绝；② 原稿"轨迹逐位一致"不成立（`W = M_after + U` 跨 binade）。两处已改并补测试。
- **仍未实现/未验证：** 胰岛素浓度、胰高血糖素、肝糖原、脂肪组织分区、肌糖原容量上限、静息糖原周转、乳酸/Cori 回流、区域分区（`muscle.head/trunk/limbs`，待预设层）、真实 DSH 会话、独立血糖/肌糖原数据、临床验证、19 部位性能基线。
- **工作区：** 本批未 commit、未 push；上一批肺切片同样未提交；根目录传输归档未跟踪保留。
