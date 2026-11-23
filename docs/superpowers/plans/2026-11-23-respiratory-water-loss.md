# 运动相关呼吸失水 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增肺部运动相关呼吸失水请求和体液真实转移，保持现有水账与无活动轨迹。

**Architecture:** `lungs` 只拥有请求和实际通量字段，读取 `physicalActivity`；`bodyFluid` 按肾、肺、汗的工程顺序分配轮初水。先并行固定失败测试，再并行实现两个不重叠的产品分片。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md`

## Global Constraints

- 已在 `38ed0c1` 提交上一批成果；本批不 commit、不 push，保留大型传输归档。
- 代码、测试、配置和参数通过 AgentSwarm 修改；独立分片最多 6 路并行，测试先行。
- 参数 `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin=0.3 mL/min` 为 `design`、`source:null`，不是测量或验证值。
- 每轮读轮初快照，write 后才 transfer；`io.dt/60` 是 dtMin。缺活动请求 0，已加载活动字段异常则整轮失败。
- 不建通气状态、血气、呼吸动作、静息失水或新提醒。旧档只补零值，不回填历史。
- 根清单 18 部位、20 份参数；不修改工具动作契约。

## Review Focus

- 请求和实际通量不能双计，肺实际通量每轮先归 0。
- 肾、肺、汗三路只能使用轮初水，合计不足时依次钳位。
- 无活动不改变原有轨迹，活动读数异常不能用固定值回退。
- 根清单必须有成对 transfer，旧自定义清单的缺目标失败是契约校验而非静默兼容。
- 重启只累计新一轮实际失水，水账不重复加存档最后一轮通量。

---

### Task 1: 肺部失败测试

**Files:**
- Create: `test/organs.lungs.test.mjs`

**Interfaces:**
- Produces: `lungs`、`respiratoryWaterLossRequestMl({remainingExerciseMin,intensity,dtMin})`、两个 mL/absolute 字段和参数的契约。

- [x] **Step 1: 写单元失败测试。** 覆盖初值/transferIn、纯函数 0.3×I×dtMin、缺活动、dt 与 simulatedSeconds 的区别、每轮实际量归零、异常活动和 JSON-safe。参数必须是 0.3、design/null。
- [x] **Step 2: 运行 `node --test test/organs.lungs.test.mjs`。** 预期因肺模块不存在而失败。

### Task 2: 体液与根清单失败测试

**Files:**
- Modify: `test/organs.body-water.test.mjs`
- Modify: `test/organs.sweat-gateway.test.mjs`
- Modify: `test/organs.modules.test.mjs`
- Modify: `test/organs.gateway.test.mjs`
- Modify: `test/organs.di.test.mjs`
- Modify: `test/parameters.test.mjs`
- Modify: `test/dsh.tools.test.mjs`

**Interfaces:**
- Consumes: Task 1 的部位/字段契约。
- Produces: `bodyFluid` 第三出口、18 部位、20 参数与真实 Gateway 时序/水账契约。

- [x] **Step 1: 写体液失败测试。** 增加肺部 stub 和第三条 transfer；覆盖肾→肺→汗的剩余量分配、同轮肠流入不可支付、非法肺请求按 0。保留原水账断言。
- [x] **Step 2: 写根清单失败测试。** 30 分钟活动仍出汗 18 mL，另累计肺失水 9 mL，第 1/2/3 轮依次活动、请求、实际转移；无活动旧 golden 不变；水账加肺实际量；旧档补零和重启不双计。更新部位/参数计数及缺肺 transfer 目标测试。
- [x] **Step 3: 运行上述测试。** 预期因肺模块、第三出口和根清单尚未实现而失败，不删除既有精确断言。

### Task 3: 肺模块实现

**Files:**
- Create: `organs/human-organs/lungs/respiratory-water-loss.ts`
- Create: `organs/human-organs/lungs/respiratory-water-loss.parameters.json`
- Test: `test/organs.lungs.test.mjs`

**Interfaces:**
- Consumes: Task 1 已观察到的 RED。
- Produces: Task 4 根清单需要的肺模块。

- [x] **Step 1: 实现最小肺模块。** 仅按 spec 读取活动、计算请求并写回实际通量 0；头注释说明 design、单位、消费者和未来替换点。
- [x] **Step 2: 运行 `node --test test/organs.lungs.test.mjs`。** 预期通过。

### Task 4: 体液与根清单集成

**Files:**
- Modify: `organs/human-compartments/body-water/water.ts`
- Modify: `body-modules.json`
- Test: Task 2 的所有文件

**Interfaces:**
- Consumes: Task 2 的 RED 和 Task 3 的肺字段。
- Produces: 完整的运动—肺请求—体液 transfer 链。

- [x] **Step 1: 实现第三出口。** 加入双向 transfer 配对，按肾、肺、汗分配轮初水，写回转出前体积；更新旧行为注释，根清单加入肺脚本。
- [x] **Step 2: 运行 Task 2 的所有定向测试。** 预期通过，原无活动和水/碳水质量账不弱化。

### Task 5: 文档、验证与审查

**Files:**
- Create: `organs/human-organs/lungs/README.md`
- Modify: `organs/human-compartments/body-water/README.md`
- Modify: `organs/human-organs/skeletal-muscle/README.md`
- Modify: `organs/human-organs/skin/README.md`
- Modify: `README.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`
- Modify: 本计划及必要的历史设计现状链接

- [x] **Step 1: 同步当前实现和未建模边界。** 写明 18/20、运动相关而非总呼吸失水、design 固定参数、三出口顺序和水账，不把未来肺通气写为已交付。
- [x] **Step 2: 运行 `npm test` 和 `git diff --check`。** 必须全部通过。
- [x] **Step 3: 独立整体审查。** 核对单写者、时序、守恒、重启、清单兼容和证据等级；非阻塞 Minor 不反复扩修。清理本轮临时产物，记录真实 DSH 与独立生理验证仍未做。

## 交付记录（2026-11-23）

- **已实现：** 新部位 `lungs` 按轮初活动产生运动相关呼吸失水请求；`bodyFluid` 按肾→肺→汗分配轮初水并真实转移。根清单 18 部位、20 份参数文件、8 部位硬 transfer 闭包。固定 0.3 mL/min 参数保持 `design`、`source:null`。
- **已验证：** 肺模块 8/8；体液及共享集成 109/109；真实 Gateway 中 30 分钟活动累计汗液 18 mL、肺失水 9 mL，无活动轨迹不变，旧档补零、重启水账不双计。最终 `npm test` 418/418、0 fail、0 skipped；`git diff --check` 通过。最终整体审查与文档修正复核均为 Ready=Yes，无未关闭 Critical/Important。
- **仍未实现/未验证：** 静息及环境驱动呼吸失水、通气量、潮气量、呼吸频率、血气、气喘提醒与完整肺模型未实现；真实 DSH 会话、独立人体数据、临床验证和 18 部位性能未验收。结肠水回收与粪便因缺上游及真实消费者暂缓。
- **工作区：** 上一批成果已提交 `38ed0c1`；本批未 commit、未 push。大型传输归档未跟踪保留，临时原型与测试存档未入库。
