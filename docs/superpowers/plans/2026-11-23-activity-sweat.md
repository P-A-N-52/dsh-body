# 活动、皮肤出汗与体液消耗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让显式 exercise 活动经皮肤出汗请求减少体液水，并形成可逐轮核对的水账与口渴变化。

**Architecture:** `physicalActivity` 只保存活动剩余时间与强度，`skin` 只计算请求和实际汗液，`bodyFluid` 统一支付肾尿与汗液。工具、根清单和体液由共享集成任务修改，默认无活动时既有轨迹不变。

**Tech Stack:** Node >=22.18、ESM、可擦除 TypeScript、`node:test`、无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-activity-sweat-design.md`

## Global Constraints

- 保留当前 main 上所有未提交实现与大型归档；不 commit、不 push。代码/测试/参数走 AgentSwarm，最多 6 路独立并发，依赖阶段串行。
- `exercise` 只含 `0 < intensity <= 1` 与 `durationMin > 0`，均为有限数；不需要体积、能量、餐型或碳水。动作幂等不变。
- 活动先递减，再取本轮最后一个有效 exercise 替换；皮肤下一轮请求，体液再下一轮转移。无活动汗液为 0。
- 汗液仅为 mL：默认 25°C、0.6 mL/min、0.04/°C、上限 2 mL/min，全部 `design`、`source:null`，不是人体测量。
- `bodyFluid` 同时支付肾尿与汗液，合计不超过轮初水；小肠同轮流入不支付。水账新增累计 `skin.sweatVolumeMl`。
- 最终根清单 17 部位、19 份参数文件、7 部位硬 transfer 闭包；physicalActivity 是软读取依赖。
- 不建 METs、疲劳、心率、体温、电解质、皮肤湿度或临床出汗模型，不自动饮水。

## Review Focus

- `io.dt` 与 `io.simulatedSeconds` 必须隔离，活动递减和出汗不能误用累计秒数：Task 1/2 固定。
- 活动动作缺少体积/能量仍可入队，但非法 intensity/duration 必须 400 且不入队：Task 2 固定。
- 肾尿与汗液分别钳位仍可能超额：Task 2 用合计上限固定，Task 4 实现。
- 请求与实际汗液双计、结束后的残余转移、同轮新水被支付：Task 1/2 固定，Task 3/4 实现。
- 根清单与闭包漏 `skin` 会启动失败：Task 2 固定负向测试，Task 4 实现。

---

### Task 1: 活动与皮肤模块失败测试

**Files:**
- Create: `test/organs.activity.test.mjs`
- Create: `test/organs.skin.test.mjs`

**Interfaces:**
- Consumes: spec §3–§4 的字段、动作和方程。
- Produces: 两个新部位的独立 RED 契约。

- [x] **Step 1: 写活动测试**

固定 `id='physicalActivity'`、`actionTypes=['exercise']`、`remainingExerciseMin/intensity` 初值 0。合法动作替换状态；无动作按 `io.dt` 递减并归零；多个有效动作取最后；非法 intensity/duration 不改变状态；重启状态可续用；输出 JSON-safe。

- [x] **Step 2: 写皮肤测试**

固定 `id='skin'`、无动作、`sweatRequestMl/sweatVolumeMl` 均为 mL/absolute，实际字段 `transferIn=['bodyFluid.waterVolumeMl']`。无活动请求 0；25°C、I=1 时 0.6 mL/min，I=0.5 减半，35°C 乘 1.4，上限 2；dt=60/120 与 simulatedSeconds 隔离；实际每轮 write 先归 0；缺活动为 0，已加载字段缺失/非有限/负数/I>1 抛错；JSON-safe。

- [x] **Step 3: 验证 RED**

Run: `node --test test/organs.activity.test.mjs test/organs.skin.test.mjs`
Expected: 两个产品模块尚不存在而 FAIL，不是测试语法/公式错误。

### Task 2: 工具、体液与真实 Gateway 失败测试

**Files:**
- Modify: `test/organs.body-water.test.mjs`
- Modify: `test/dsh.tools.test.mjs`
- Modify: `test/organs.modules.test.mjs`
- Modify: `test/organs.gateway.test.mjs`
- Modify: `test/organs.di.test.mjs`
- Modify: `test/organs.water-gateway.test.mjs`
- Modify: `test/parameters.test.mjs`
- Create: `test/organs.sweat-gateway.test.mjs`

**Interfaces:**
- Consumes: Task 1 字段、spec §5–§7、现有水账和工具测试方式。
- Produces: Task 4 的共享集成契约。

- [x] **Step 1: 写工具与清单失败测试**

`exercise` 合法入队且 capabilities 包含 physicalActivity；0、负数、>1、NaN、字符串 intensity 和非正/非有限 durationMin 均 400 且 pending 为空；urinate/drink/eat 行为不变。根清单 17 部位、19 份参数，body_state 含 physicalActivity/skin，缺 skin 时因 bodyFluid transferOut 目标未声明而失败。

- [x] **Step 2: 写体液双出口失败测试**

用真实 `createFieldRegistry/applyOperations` 验证：先 `write` 轮初水，再分别 transfer 到 bladder 和 skin；肾请求优先展示计算顺序，汗液只能取 `max(0,W_start−U_kidney)`；合计不超过轮初水，小肠同轮流入不支付，实际汗液不写入请求字段。

- [x] **Step 3: 写真实 exercise 水账失败测试**

默认 25°C、intensity=1、durationMin=30：第 1 轮活动入状态、第 2 轮皮肤请求、第 3 轮首次实际汗液，最终累计 18 mL 且结束后停止。逐轮水账加入 `skin.sweatVolumeMl`，误差 ≤`1e-6 mL`；体液下降、下丘脑口渴按既有快照上升，无自动饮水。无 exercise 对照与原轨迹一致；旧档活动/皮肤请求均为 0，重启保留活动。

- [x] **Step 4: 验证 RED**

Run:

```bash
node --test test/organs.body-water.test.mjs test/dsh.tools.test.mjs test/organs.modules.test.mjs test/organs.gateway.test.mjs test/organs.di.test.mjs test/organs.water-gateway.test.mjs test/parameters.test.mjs test/organs.sweat-gateway.test.mjs
```

Expected: 因 exercise、skin、17 部位、双出口和参数尚未实现而 FAIL；既有水/糖/通知断言不删弱。

### Task 3: 实现活动与皮肤模块

**Files:**
- Create: `organs/human-organs/skeletal-muscle/activity.ts`
- Create: `organs/human-organs/skin/sweat.ts`
- Create: `organs/human-organs/skin/sweat.parameters.json`
- Tests: Task 1 的两个测试文件。

**Interfaces:**
- Consumes: Task 1 的 RED 契约。
- Produces: `physicalActivity` 活动状态和 `skin.sweatRequestMl/sweatVolumeMl` 供 Task 4 使用。

- [x] **Step 1: 最小实现**

活动先按 dt 递减再取最后有效 exercise；非法动作不改变状态。皮肤按 `min(2,0.6×I×max(0,1+0.04×(T−25)))×dtMin` 计算请求，R>0 才生效；实际 write 先归 0。导出纯函数 `sweatRequestMl({ remainingExerciseMin, intensity, dtMin, ambientTemperatureC })`，heartbeat 传入默认 25°C，便于独立测试温度/上限。缺失回退、异常抛错，参数全 design/null，头注释明确无实测代谢/体温模型。

- [x] **Step 2: 定向验证**

Run: `node --test test/organs.activity.test.mjs test/organs.skin.test.mjs`
Expected: PASS。

### Task 4: 工具体液与根清单集成

**Files:**
- Modify: `organs/human-compartments/body-water/water.ts`
- Modify: `tools.js`
- Modify: `body-modules.json`
- Tests: Task 2 的全部测试。

**Interfaces:**
- Consumes: Task 3 的活动与皮肤契约。
- Produces: exercise 工具、体液双出口和 17 部位根清单。

- [x] **Step 1: 最小集成**

tools 在 drink/eat 校验前独立处理 exercise，保留 urinate 早返回和原动作幂等。bodyFluid 读取轮初皮肤请求，先算 `U_kidney`，再令 `U_sweat=clamp(sweatRequest,0,max(0,W_start−U_kidney))`，write 后分别 transfer；缺皮肤请求仅在直接模块调用时为 0，Gateway 硬配对必须含 skin。根清单加入 activity 和 skin。

- [x] **Step 2: 集成验证**

Run: Task 2 Step 4 的完整命令。
Expected: PASS；不得通过改弱水账、时序或旧输入断言消除失败。

### Task 5: 文档、全量验证与审查

**Files:**
- Create: `organs/human-organs/skeletal-muscle/README.md`
- Create: `organs/human-organs/skin/README.md`
- Modify: `organs/human-compartments/body-water/README.md`
- Modify: `organs/human-organs/small-intestine/README.md`
- Modify: `organs/human-organs/bladder/README.md`
- Modify: `organs/human-organs/kidney/README.md`
- Modify: `organs/human-organs/stomach/README.md`
- Modify: `organs/human-compartments/glucose/README.md`
- Modify: `organs/human-organs/pancreas/README.md`
- Modify: `README.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`
- Add historical note: `docs/superpowers/specs/2026-11-22-water-balance-design.md`
- Update checkboxes: `docs/superpowers/plans/2026-11-23-activity-sweat.md`

**Interfaces:**
- Consumes: Tasks 3–4 已落地的实现。
- Produces: 当前实现、验证与未建模边界一致的交付。

- [x] **Step 1: 全量验证**

Run: `npm test` 和 `git diff --check`。
Expected: 全绿、退出 0；有跨分片问题按根因修复，不删弱断言。

- [x] **Step 2: 同步文档**

写清 exercise 载荷、活动/皮肤字段、请求—结算时序、双出口水账、17 部位/19 参数、7 部位闭包、旧档与未建模边界。保留历史验收与尿意/fasting/碳账内容，不把工程出汗率称为人体测量。

- [x] **Step 3: 一次整体审查与收尾**

只处理真实 Critical/Important：单写者、双出口超额、时间/轮次、异常/缺失、旧档和文档错误；不再增加非阻塞打磨。修正后重跑必要测试和全量 `npm test`，记录真实 DSH/独立出汗数据/临床验证未做，删除临时目录并检查 `git status`，不 commit/push。

## 交付记录（2026-11-23）

- **已实现：** `exercise` 动作与 `physicalActivity` 活动状态；`skin` 出汗请求和实际汗液通量；`bodyFluid` 肾尿与汗液双出口；根清单 17 部位、19 份参数文件、7 部位硬 transfer 闭包。
- **已验证：** 活动/皮肤模块 18/18；工具体液与共享集成 105/105；兼容性修正后共享测试 108/108；最终 `npm test` 401/401、0 fail、0 skipped；`git diff --check` 通过。默认 25°C、intensity=1、30 min 场景累计 18 mL，水账误差 ≤`1e-6 mL`，无活动时原轨迹不变。
- **仍未验收/未实现：** 真实 DSH、独立出汗数据与临床验证、17 部位性能实测；METs/能量消耗、疲劳、心率/血压、核心与皮肤温度、体温调节、汗液电解质、蒸发和皮肤分区均未建模。参数保持 `design`，不是人体测量。
- **工作区：** 未 commit、未 push；既有尿意/fasting/碳水/胰腺/肾糖/口渴改动与大型归档保留。临时 SDD 目录在最终整体审查与状态核对后删除。

**最终审查：** Ready=Yes，无 Critical/Important；分任务实现审查与最终整体审查一致。
