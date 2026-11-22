# 胰腺、肾糖与口渴并行薄切片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 并行交付胰腺相对胰岛素调节、肾糖质量排泄和口渴提醒三个薄切片，同时保持既有碳水/水账与旧档兼容。

**Architecture:** 胰腺和肾糖分别拥有独立新部位；`glucose.ts`、其测试和根清单由一个集成任务统一修改。口渴只扩展现有 `brainNotify`，不改部位清单。所有计算读轮初快照，write 后才 transfer。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test`、无第三方依赖。

**Spec:**
- `docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md`
- `docs/superpowers/specs/2026-11-23-renal-glucose-design.md`
- `docs/superpowers/specs/2026-11-23-thirst-notification-design.md`

## Global Constraints

- 当前 main 工作区已有尿意/fasting 与碳水—血糖未提交改动，全部保留；不 commit、不 push、不 stage 大型 tar.gz。
- 代码、测试、配置和参数必须走 AgentSwarm；主线程不绕过流程直接改产品代码。独立任务最多 6 路并发，依赖阶段串行。
- `pancreasEndocrine.insulinRelative` 单位 1、初值 1，不是浓度或 transfer；`I=1` 必须精确复现旧清除公式。
- 上游未加载与异常不同：未加载按设计回退；已加载但字段缺失、非有限/负读数不得用健康常量掩盖。
- `kidneyGlucose` 只处理 g：`requestG = max(0,C×1.88−339)×0.0005×75×dtMin/1000`，不得换算尿水 mL。
- `disposedGlucoseG` 是非肾表观清除，实际肾糖只累计 `kidneyGlucose.excretedGlucoseG`，请求不累计。
- 根清单最终 15 部位、18 份参数文件；包含 glucose 的完整水/碳水闭包必须含 `kidneyGlucose`。
- 口渴阈值 65/85 mm 是 `design`/`policy`，默认第 3 轮提醒，不照搬尿意两轮；不自动 drink，不接 discomfort。
- 新证据只扩充 Dalla Man 2007 同一篇笔记；T2D `V_G=1.49`，不复制来源行，不声称 fitted/validated。

## Review Focus

- 胰岛素为 0、负值、NaN 或部位缺失时的行为不同：Task 1/3 固定，Task 6/8 实现。
- 肾糖 mg/kg 与 mg/dL 混用会造成 1.88 倍或 1000 倍错误：Task 2/3 固定单位换算，Task 7/8 实现。
- 请求与实际 transfer 双计、超可用量或同轮新吸收被支付：Task 2/3 固定，Task 8 实现。
- 多模块同时修改 glucose/清单/质量账会产生契约冲突：Task 3 由同一集成测试所有者覆盖，Task 8 唯一实现所有者。
- 口渴/尿意轮次混淆、饮水后立即清零、旧 `levels` 被重置：Task 4 固定，Task 9 实现。

---

### Task 1: 胰腺模块失败测试

**Files:**
- Create: `test/organs.pancreas.test.mjs`

**Interfaces:**
- Consumes: 胰腺设计 §3–§5 的 ID、字段和参数。
- Produces: `pancreasEndocrine` 模块契约测试，不改产品代码。

- [x] **Step 1: 写失败测试**

固定 `id='pancreasEndocrine'`、无动作、无 transfer、`initialState.insulinRelative=1`、字段单位 1/absolute。基线 `G=90,I=1` 精确保持 1；`G=140` 目标 2；`G=70` 目标 0.6；`G=0` 目标 0；`I` 以 10 min 半时趋近目标，增益 0.02、上限 5。缺失 glucose 按 90；字段缺失、非有限/负 glucose 抛错；输出 JSON-safe。

- [x] **Step 2: 验证预期失败**

Run: `node --test test/organs.pancreas.test.mjs`
Expected: 因 `organs/human-organs/pancreas/insulin.ts` 尚不存在而 FAIL；不是测试语法或单位错误。

### Task 2: 肾糖模块失败测试

**Files:**
- Create: `test/organs.kidney-glucose.test.mjs`

**Interfaces:**
- Consumes: 肾糖设计 §3–§6 的字段和方程。
- Produces: `kidneyGlucose` 请求/实际通量契约测试，不改产品代码。

- [x] **Step 1: 写失败测试**

固定 `id='kidneyGlucose'`、无动作、两个 g/absolute 字段，`excretedGlucoseG.transferIn=['glucose.glucoseMassG']`，初值均 0。`C=339/1.88` 请求恰为 0；低于阈值无请求；`C=360` 时 `Gp=676.8`，`requestG=(676.8−339)×0.0005×75×dtMin/1000`。60 s 与 120 s 检查 dt；缺失上游请求为 0，字段缺失、非有限/负浓度抛错；每轮 write 的 `excretedGlucoseG` 先归 0，实际值只能由 transfer 加入。

- [x] **Step 2: 验证预期失败**

Run: `node --test test/organs.kidney-glucose.test.mjs`
Expected: 因 `organs/human-organs/kidney/glucose-excretion.ts` 尚不存在而 FAIL。

### Task 3: 共享葡萄糖、清单与真实 Gateway 失败测试

**Files:**
- Modify: `test/organs.glucose.test.mjs`
- Modify: `test/organs.glucose-gateway.test.mjs`
- Modify: `test/organs.modules.test.mjs`
- Modify: `test/organs.gateway.test.mjs`
- Modify: `test/dsh.tools.test.mjs`
- Modify: `test/organs.di.test.mjs`
- Modify: `test/organs.water-gateway.test.mjs`
- Modify: `test/parameters.test.mjs`

**Interfaces:**
- Consumes: Task 1/2 的部位与字段契约、既有碳水质量账。
- Produces: 唯一共享测试契约，供 Task 8 的 glucose/清单集成使用。

- [x] **Step 1: 写葡萄糖耦合失败测试**

`I=1` 精确旧公式；同一质量下 `D(2)>D(1)>D(0.5)>D(0)=0`；基线/低基线不补糖；胰腺缺失回退 1，异常抛错。`glucoseMassG` 增加 `transferOut:['kidneyGlucose.excretedGlucoseG']`，其他字段/初值不变。

用真实 `applyOperations` 固定：先算非肾清除，再把轮初肾请求钳到清除后可用量并 transfer；请求下一轮才执行；同轮小肠流入不支付；实际肾排泄和 disposed 分项守恒。

- [x] **Step 2: 写真实根清单时序与质量账测试**

60 g 碳水场景：第 4 轮浓度升，第 5 轮胰岛素升，第 6 轮首次出现胰岛素加快的非肾清除。肾糖不断言固定第 5 轮：只有浓度跨过 `339/1.88` 后才在下一轮写请求、再下一轮实际转移；另用预置高浓度固定这两个连续轮次。无碳水长期保持基线；低于/等于 `339/1.88` 不排肾糖。

扩展质量账为胃 + 队列 + 小肠 + `(glucose−B) + Σdisposed + ΣkidneyGlucose.excretedGlucoseG`，逐轮 ≤`1e-6 g`；水账仍 ≤`1e-6 mL`。覆盖非基线餐后重启、旧档 I=1/请求 0，以及胰腺/肾糖同时生效不双计。

- [x] **Step 3: 更新清单和参数失败断言**

根清单期望 15 部位并包含胰腺、肾糖；参数文件期望 18 份，加入胰腺和肾糖参数。固定胰腺参考血糖等于 glucose 基线，肾糖 `1.88` 和 75 kg 与 glucose 相同；肾糖 `filtrationRatePerMin=0.0005`、`renalThresholdMgKg=339` 为 `prior` + `SRC-DALLAMAN-2007`，其他工程参数 `design`。

- [x] **Step 4: 验证预期失败**

Run:

```bash
node --test test/organs.glucose.test.mjs test/organs.glucose-gateway.test.mjs test/organs.modules.test.mjs test/organs.gateway.test.mjs test/dsh.tools.test.mjs test/organs.di.test.mjs test/organs.water-gateway.test.mjs test/parameters.test.mjs
```

Expected: 因耦合、transfer、两个新部位和参数尚未实现而 FAIL；既有生理公式断言不得删除。

### Task 4: 口渴提醒失败测试

**Files:**
- Modify: `test/organs.brain-notify.test.mjs`
- Create: `test/organs.thirst-notify-gateway.test.mjs`

**Interfaces:**
- Consumes: 口渴设计 §3–§5、现有尿意测试方式。
- Produces: Task 9 的通知策略契约，不改产品代码。

- [x] **Step 1: 写通知单元失败测试**

64 不提醒、65 context、85 wake；同档不重复、40 以下重新武装；最高档优先，同档 `urinary > thirst > fullness > hunger`；未选中不消耗水位；缺读按 50；旧 `levels` 只补 `thirst=0`；共享冷却/配额、lastKind/lastLevel 迁移和 JSON-safe。

- [x] **Step 2: 写真实 Gateway 失败测试**

预置一致的 `bodyFluid.waterVolumeMl=29650`、`waterDeficit=0.7` 和通知会话：第 1/2 轮无通知，第 3 轮一条强口渴 wake；不自动 drink。只预置水量会让体液读数额外引入一轮延迟，不作为本用例的即时边界。显式 `body_act {type:'drink',volumeMl:1000}` 后运行足够轮次，口渴经既有水链回落且同档不重复，水账 ≤`1e-6 mL`。不得把 drink 当 urinate 一样在动作轮清零。

- [x] **Step 3: 验证预期失败**

Run: `node --test test/organs.brain-notify.test.mjs test/organs.thirst-notify-gateway.test.mjs`
Expected: 因 `brainNotify.thirst` 参数/信号/文本尚未实现而 FAIL。

### Task 5: 审查全部测试契约

**Files:**
- Review only: Tasks 1–4 的测试与三份 spec。

**Interfaces:**
- Consumes: 四组 RED 结果。
- Produces: 可执行的测试基线；reviewer 只读，测试所有者修正测试自身错误。

- [x] **Step 1: 独立审查**

重点核对 `I=1` 是否真精确、mg/kg 与 mg/dL 换算、请求/实际是否重复计数、 transfer 上限与轮次、旧 `levels` 迁移，以及测试是否把实现尚未加入的部位当成可选缺失。必要时在 /tmp 最小实现中跑深循环 GREEN，临时副本删除，不能冒充产品验收。

- [x] **Step 2: 修正测试自身错误并确认 RED**

由对应测试所有者修正后重跑 Task 1–4 的命令，确认失败仍指向缺失实现，再进入产品分片。

### Task 6: 实现胰腺模块

**Files:**
- Create: `organs/human-organs/pancreas/insulin.ts`
- Create: `organs/human-organs/pancreas/insulin.parameters.json`
- Test: `test/organs.pancreas.test.mjs`

**Interfaces:**
- Consumes: Task 1 的测试。
- Produces: `pancreasEndocrine.insulinRelative`，供 Task 8 轮初读取。

- [x] **Step 1: 最小实现**

按 spec 实现 `target=clamp(1+0.02×(G−90),0,5)` 和 10 min 一阶趋近；只写 `insulinRelative`。缺失 glucose 回退 90，异常失败；参数全部 design/null，头注释写清相对信号与证据边界。

- [x] **Step 2: 定向验证**

Run: `node --test test/organs.pancreas.test.mjs`
Expected: PASS。

### Task 7: 实现肾糖模块

**Files:**
- Create: `organs/human-organs/kidney/glucose-excretion.ts`
- Create: `organs/human-organs/kidney/glucose-excretion.parameters.json`
- Test: `test/organs.kidney-glucose.test.mjs`

**Interfaces:**
- Consumes: Task 2 的测试、Dalla Man 2007 已扩充笔记。
- Produces: `kidneyGlucose.excretionRequestG` 和 `excretedGlucoseG` transferIn 契约。

- [x] **Step 1: 最小实现**

按 spec 实现 `Gp=C×1.88`、`max(0,Gp−339)×0.0005×75×dtMin/1000`；每轮写请求和实际通量 0。两个 `prior` 参数只作平均模型锚点，其他 design；不读取或改变 kidney 水请求、bodyFluid 或 bladder。

- [x] **Step 2: 定向验证**

Run: `node --test test/organs.kidney-glucose.test.mjs`
Expected: PASS。

### Task 8: 集成葡萄糖与根清单

**Files:**
- Modify: `organs/human-compartments/glucose/glucose.ts`
- Modify: `organs/human-compartments/glucose/glucose.parameters.json`（只更新语义 note，不改数值/ID）
- Modify: `body-modules.json`
- Tests: Task 3 的全部共享测试。

**Interfaces:**
- Consumes: Task 6 的 `pancreasEndocrine.insulinRelative`、Task 7 的 `kidneyGlucose.excretionRequestG`。
- Produces: 胰岛素缩放非肾清除、肾糖 transferOut、15 部位根清单。

- [x] **Step 1: 集成实现**

`I=1` 时原公式逐位不变；按 I 缩放清除指数。先算非肾清除，再把轮初肾请求钳到清除后可用量，write 后 transfer 到 `kidneyGlucose.excretedGlucoseG`。缺胰腺回退 1、缺肾请求回退 0（仅模块独立行为），异常失败；完整清单 transfer 硬依赖不回退。根清单加入两个新脚本。

- [x] **Step 2: 集成验证**

Run: Task 3 Step 4 的完整命令。
Expected: PASS；不得通过删除原碳水/水账或时序断言消除失败。

### Task 9: 实现口渴提醒

**Files:**
- Modify: `organs/human-organs/brain/notify.ts`
- Modify: `organs/human-organs/brain/notify.parameters.json`
- Tests: Task 4 的通知测试。

**Interfaces:**
- Consumes: 既有 `interoception.thirst` 和 Task 4 契约。
- Produces: 第四类通知信号，不改变部位清单或工具。

- [x] **Step 1: 最小实现**

扩展 Kind、levels、参数、文本、观测和优先级，复用既有 reconcile/pick/cooldown/quota；同档 `urinary > thirst > fullness > hunger`。缺读 50，旧 levels 只补 thirst=0；不加 drink 抑制分支，不接 discomfort。更新头注释中的当前行为。

- [x] **Step 2: 定向验证**

Run: `node --test test/organs.brain-notify.test.mjs test/organs.thirst-notify-gateway.test.mjs`
Expected: PASS。

### Task 10: 文档、全量验证与最终审查

**Files:**
- Create: `organs/human-organs/pancreas/README.md`
- Modify: `organs/human-organs/kidney/README.md`
- Modify: `organs/human-compartments/glucose/README.md`
- Modify: `organs/human-organs/brain/README.md`
- Modify: `organs/human-organs/small-intestine/README.md`
- Modify: `organs/human-compartments/body-water/README.md`
- Modify: `organs/human-organs/bladder/README.md`
- Modify: `README.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`
- Add historical notes: `docs/superpowers/specs/2026-11-22-carbohydrate-glucose-design.md`
- Update checkboxes: `docs/superpowers/plans/2026-11-23-parallel-organ-slices.md`

**Interfaces:**
- Consumes: Tasks 6–9 已合入当前工作区的实现。
- Produces: 当前实现、验证证据与未实现边界一致的交付。

- [x] **Step 1: 全量集成验证**

Run: `npm test` 与 `git diff --check`。
Expected: 全部 PASS、diff check 退出 0；若有跨分片问题按根因修复，不删弱质量账或兼容断言。

- [x] **Step 2: 同步文档**

写清 15 部位、18 份参数、胰腺相对信号与第 6 轮清除、肾糖请求/实际 transfer 与六部位闭包、口渴第 3 轮提醒。更新外源碳水质量账，明确肾糖不改尿水、口渴不自动饮水。历史 spec 加后续链接，不改写当时 13 部位验收边界。

- [x] **Step 3: 独立整体审查与修正**

审查单写者、共享 glucose 所有权、I=1 回归、肾糖单位/质量账、口渴时序、旧档与自定义清单、证据等级和无意改动。修正后重跑必要定向测试和完整 `npm test`。

- [x] **Step 4: 记录交付边界**

勾选完成项；真实 DSH、独立生理曲线/肾糖数据、临床验证、完整肝糖/胰高血糖素/组织分区和 15 部位性能实测保持未验收/未实现。检查 `git status`，删除本轮临时产物，保留所有既有未提交工作，不 commit/push。

## 交付记录（2026-11-23）

- **已实现：** `pancreasEndocrine` 相对胰岛素信号及葡萄糖清除调节；`kidneyGlucose` 肾糖请求与实际 g→g 转移；`brainNotify` 第四类口渴提醒。根清单 15 部位、18 份参数文件，完整水/碳水/肾糖闭包为 6 个部位。
- **已验证：** 测试契约和实现分片审查均通过；共享集成 101/101；最终 `npm test` 367/367、0 fail、0 skipped；`git diff --check` 通过；最终整体审查无 Critical/Important，Ready=Yes。
- **边界：** 外源碳水账同时累计非肾 `disposedGlucoseG` 与实际 `kidneyGlucose.excretedGlucoseG`，不累计请求、不换算尿水。口渴预置一致缺水状态第 3 轮提醒，显式饮水经吸收回落；不自动饮水、不接 discomfort。
- **仍未验收/未实现：** 真实 DSH、独立生理数据与临床验证、15 部位性能实测、完整肝糖/胰高血糖素/组织分区。参数按 `design` / `prior` 标记，未提升为 `validated`。
- **工作区：** 未 commit、未 push；既有尿意/fasting/碳水和大型归档保留。SDD 临时目录在最终审查、全量验证和状态核对后删除。
