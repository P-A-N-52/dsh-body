# 固／液餐胃排空 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本次由用户启用的 swarm 分派不重叠的文件范围；主代理统一验收。

**状态：** 已实现并验收本小改，改动留在工作区未提交。`npm test` 144/144；同条件固／液餐在原工具接真实 Gateway 的对照中产生差异，旧存档恢复用例通过；白水、可乐重放与改前逐字节一致。隔离原生 DSH 已通过插件装载及 HTTP 入队、重试冒烟，不代替真实双会话 M1 验收。

**Goal:** 现有 `mealKind: "solid"` 在真实 Gateway 中产生不同于液餐的排空，不更改 Agent 参数或其他里程碑范围。

**Architecture:** `stomach` 保持单写者，在原总量外存已入胃固餐小计。独立结算两组存量，再发布原来的总量和通量；旧存档缺少小计按 0 加载。

**Tech Stack:** Node ≥ 22.18、ESM、可擦除 TypeScript、`node:test`；不增加依赖。

**Spec:** [`2026-11-21-solid-meal-emptying-design.md`](../specs/2026-11-21-solid-meal-emptying-design.md)

## Global Constraints

- 仍然先结算当轮排空，再将摄入切片加到账本；一轮 60 仿真秒，读轮初快照。
- 仅 `eat` 的 `mealKind: "solid"` 进固餐小计；`drink`、`liquid`、`mixed` 仍走原算法。无固餐时保持原白水、液餐、可乐轨迹。
- 不改 `body_act` / `body_state`、清单、Gateway、存档版本或其他器官。不接睡眠、运动、消化酶、肠道反馈或会话绑定。
- 只在隔离工作区并行改动；不提交、不推送，保留用户已有 `AGENTS.md`、`README.md`、`LICENSE` 与 Markdown 修改。

## Review Focus

1. 入胃后队列已释放完：固餐小计仍在，下一轮不同于相同液餐（任务 1、3）。
2. 固餐仍在胃内时喝水或吃 `mixed`：新摄入不改变旧固餐的排空率，不挤掉小计（任务 1）。
3. 固餐跨轮摄入：尚在队列的量、胃内量和累计排出量，mL/kcal 分别守恒（任务 1）。
4. 旧档无两个小计：原有总量参与原排空，不重置、不猜餐型（任务 1）。
5. 工具回执 `queued` 时读不到刚入队的餐；生效轮仍先排空旧内容（任务 3）。

### Task 1: 胃动力与模块回归

**Files:** 修改 `organs/human-organs/stomach/motility.ts`、`organs/human-organs/stomach/motility.parameters.json` 和 `test/organs.motility.test.mjs`。

**Interfaces:** 保持 `heartbeat(io): void` 和 `stomach` 原字段；新增数值 `solidVolumeMl`（mL）与 `solidEnergyKcal`（kcal），`initialState` 为 0、`mode: "absolute"`。参数 `stomach.emptying.solidHalfTimeMin` = 68.7 min / `design` / `[1, 240]` / `SRC-VASAVID-2014`。

- [x] 在既有 `round` 测试中加固餐支路回归：300 mL、200 kcal、`durationMin: 3` 的固餐第一轮 `solidVolumeMl === 100` 且尚未排出；在三轮中加入 0 kcal 水和 `mixed`，小计按自身半时推进且只计入已释放的固餐。检查两种量按轮守恒（误差 `1e-6`）。旧状态 `{ volumeMl: 240, energyKcal: 0, emptiedMl: 0, emptiedKcal: 0, lastIntakeAt: null, mealQueue: [] }` 前进一轮应接近 `240 * 2 ** (-1 / 13)`，固餐小计为零。
- [x] `node --test test/organs.motility.test.mjs` 见 RED：读取固餐小计为 `undefined` 而非所需数值，原测试不能改变。
- [x] 添加参数与来源注释；按 Spec 分开结算、汇总，待释放和当轮摄入都保留各自 `mealKind`。不把 68.7 写成脚本硬编码，不增加框架或额外校验层。
- [x] `node --test test/organs.motility.test.mjs` 全通过。

### Task 2: 证据登记与现状文档

**Files:** 修改 `organs/human-organs/references/source-index.csv`、`organs/human-organs/stomach/references/notes/vasavid-2014.md`、`organs/human-organs/stomach/README.md`、`docs/virtual-body.md`、`AGENTS.md`；只修复 `docs/gateway-and-scripts.md` 中与本次行为冲突的说明（如有）。

**Interfaces:** 可按 Spec 写定行为；不编辑 Runtime/测试，也不写完成验收的声明。

- [x] 登记 `SRC-VASAVID-2014` / `vasavid-2014` / `C-VASAVID-2014-189`（`registered`、`free_fulltext`、`fulltext_read`、`results_seen`、`development`）。笔记改为已登记；Methods/Table 数据、量纲、验证边界不改。
- [x] 写明胃总量/固餐小计/通量区别，固餐参考半时和适用限制；`mixed` 与旧档语义及 Agent 参数不变。当前总览提到餐型分支；历史 P0/P1 计划不改成追溯性功能。README 扫掉“所有餐型共用”“餐型只记录”的现状表述。保留用户原有本地改动。

### Task 3: 以原工具在真实 Gateway 验收

**Files:** 仅在 `test/dsh.tools.test.mjs` 添加用例，复用 `startBody(t)`、`fakeExec()` 与原工具；不改 `tools.js`。

**Interfaces:** 对从空胃启动的两个独立 Gateway，按原接口执行 `body_act.execute({ type: 'eat', volumeMl: 300, energyKcal: 200, mealKind }, fakeExec())`，通过 `body_state.execute({ part: 'stomach' })` 读取。

- [x] 两类输入都断言 `202` / `queued`，提交前胃容积仍 0；一次 `gateway.tick()` 后回执 `applied` 且胃中是 300 mL / 200 kcal。再推进 30 轮，时间为 1860 s；对比两次读数，固餐组 `volumeMl` 与 `energyKcal` 严格大于液餐组。对照两个独立存档，不调用用户现有身体。
- [x] 任务 1 的运行代码可用后，`node --test test/dsh.tools.test.mjs` 全通过。并行期先写用例，最终由主代理在整合后的交付工作区运行。

### 整体验收（主代理）

- [x] 审阅三个分片，无越界改动；对照变更前捕获的 `node tools/replay.mjs scenarios/m1-water-240.json`、`scenarios/p1-cola-330.json` 结果：完整 JSON 一致，`actionLagRounds: 1`。
- [x] 在最终工作区跑一次 `npm test`，应零失败；`git diff --check` 无补丁格式错误，无新增日志/存档。核对用户原有改动保留；只凭实际结果勾选完成项。
- [x] 汇报实际 Gateway 验收结果，另标真实 DSH 双会话 M1 验收尚未由本次增强测试代替。不提交、不推送。
