# Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审查发现的旧档迁移、补算提醒和摄入校验问题，并让文档与验收口径重新符合当前实现。

**Architecture:** 按肌肉区域、通知、胃摄入和文档验收四个独立分片实施。生产代码采用最小改动；每个缺陷先由真实模块或真实 Gateway 测试复现，再修复。子代理不提交，主代理在全部改动汇合后统一验收。

**Tech Stack:** Node.js >=22.18、ESM、本地可擦除 TypeScript、node:test，无第三方依赖。

**Spec:** `AGENTS.md`；`docs/superpowers/plans/2026-11-24-audit-and-p0-modeling-checklist.md`；2026-11-24 两路只读审查结论。

**执行状态（2026-11-24 最终修复波次后）：** 四个分片与最终 activeBatch 集成修复均已落地在汇合工作树；复选框只表示实施和本地验证完成，不是提交、发布或实机验收证据。

## Global Constraints

- 保持 60 秒一轮、轮初快照、整轮原子提交和单写者契约。
- 不改变生理参数，不新增器官，不把离线回归称为 `validated` 或全身生理稳态。
- 新测试优先使用 `test-support/harness.mjs`、临时目录、端口 0、`autoTick: false` 和固定 `now`。
- 每个代码缺陷必须先看到新测试因预期原因失败，再写最小实现；子代理只改分配给自己的文件，不提交。

## Review Focus

- 旧档缺少一个或多个肌肉区域时，迁移不得增加、丢失或反复复制旧糖原。
- 多轮补算后首个在线轮次仍应能投递满足条件的提醒，且不重复投递历史提醒。
- 同一条畸形 `eat` / `drink` 动作不得只影响饥饿素而被胃忽略。
- 三份清单的计数、闭包和水账必须与实际清单及守恒测试一致。
- 24 小时测试的名称与文档只能声称实际断言覆盖的体温／血糖代理回归。

---

### Task 1: 旧档肌糖原迁移守恒

**Files:**
- Modify: `organs/human-organs/skeletal-muscle/regions/region-core.ts`
- Modify: `organs/human-organs/skeletal-muscle/glucose-uptake-core.ts`
- Modify: `organs/human-organs/skeletal-muscle/glucose-uptake.ts`
- Modify: `organs/human-organs/skeletal-muscle/README.md`
- Modify: `organs/human-organs/skeletal-muscle/regions/README.md`
- Test: `test/organs.muscle-regions-gateway.test.mjs`

**Interfaces:**
- Consumes: 旧档 `muscleGlucose.glycogenG`、三个区域已有状态与 `uptakeG`。
- Produces: 迁移前后糖原总量守恒；新身体仍使用 300 g 默认初值；后续轮次不重复迁入旧量。

- [x] 用真实 Gateway 写旧档总量 100 g 的守恒测试，并覆盖新身体 300 g 初值与迁移后的下一轮。
- [x] 运行该测试，确认旧实现因总量变成 400/402 g 或重复累加而失败。
- [x] 追踪 `initialState` 补键与 legacy 字段清除路径，在区域读取旧量的源头做最小修复，不改变正常摄糖和运动消耗。
- [x] 重跑该测试及 `test/organs.muscle-regions.test.mjs`，确认通过并报告 RED/GREEN 证据。

### Task 2: 补算不消耗在线提醒机会

**Files:**
- Modify: `gateway/simulation.js`
- Modify: `gateway/body-worker.js`
- Modify: `organs/human-organs/brain/notify.ts`
- Test: `test/gateway.checkpoint.test.mjs`
- Test: `test/organs.brain-notify.test.mjs`
- Later integration: `docs/gateway-and-scripts.md`、`organs/human-organs/brain/README.md`、`docs/superpowers/specs/2026-11-22-urinary-notification-design.md`

**Interfaces:**
- Consumes: `runHeartbeat(..., { suppressNotifications })` 的现有布尔选项。
- Produces: 心跳 IO 中同名只读 `suppressNotifications`；`brainNotify` 在抑制投递时不提交会阻止后续在线提醒的发送水位、冷却或配额变化。历史通知仍不投递。

- [x] 用真实 `brainNotify` 写多轮 catch-up 后接在线心跳的测试：补算通知为零，首个满足条件的在线提醒可投递且不重复，配额不被补算消耗。
- [x] 运行测试并确认旧实现因补算水位／配额导致在线提醒缺失而失败。
- [x] 将现有抑制选项原样传入 Worker IO，让 `brainNotify` 区分“本轮抑制投递”和“实际提交投递”；保持其他模块和通知队列契约不变。
- [x] 重跑通知与 checkpoint 相关测试，确认通过并报告 RED/GREEN 证据。

### Task 3: 饥饿素与胃共用摄入合法性口径

**Files:**
- Modify: `organs/human-organs/stomach/ghrelin.ts`
- Modify: `organs/human-organs/stomach/motility-core.ts`
- Modify: `organs/human-organs/stomach/README.md`
- Test: `test/organs.ghrelin.test.mjs`

**Interfaces:**
- Consumes: 与胃一致的 `eat` / `drink` 原始动作字段及 `dt`。
- Produces: 只有胃会接受的摄入动作才能向 `stomachGhrelin` 提供摄入能量；非法动作对胃和饥饿素都无效。

- [x] 为缺少／非法 `volumeMl`、`mealKind`、`durationMin`、`carbohydrateG` 的正能量动作写参数化回归，断言饥饿素与计时器不受影响；合法摄入保持不变。
- [x] 运行测试并确认旧实现错误地接受这些动作。
- [x] 优先复用胃的同一个 parse/validation 辅助函数；若共享会引入循环或过大改动，则做最小等价校验并说明原因。
- [x] 重跑 ghrelin 与胃相关测试，确认通过并报告 RED/GREEN 证据。

### Task 4: 文档和验收口径同步

**Files:**
- Modify: `README.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`
- Modify: `docs/superpowers/plans/2026-11-24-audit-and-p0-modeling-checklist.md`
- Modify: `docs/superpowers/specs/2026-11-22-urinary-notification-design.md`
- Modify: `organs/human-compartments/body-water/README.md`
- Modify: `organs/human-organs/{bladder,brain,esophagus,ovaries,pancreas,pineal,skin,stomach,uterus}/README.md`
- Modify: `organs/human-organs/skeletal-muscle/README.md`
- Modify: `organs/human-organs/skeletal-muscle/regions/README.md`
- Test: `test/organs.steady-state-24h.test.mjs`

**Interfaces:**
- Consumes: 三份当前清单、真实守恒测试和现有 24 小时断言。
- Produces: 一致的部位／参数／闭包计数、含结肠残渣水的水账、默认不泌乳说明，以及明确的“体温／血糖代理回归”口径。

- [x] 对照清单与代码列出旧数字和旧行为，修正 README 与主指南；水账加入 `colon.residueWaterMl`。
- [x] 将 24 小时测试名及相关文档改为实际覆盖的 fasting temperature/glucose regression，不新增未验证的全身稳态声称。
- [x] 把审计清单中的精确输出标为观察值而非逐项断言；记录传输压缩包已由用户明确要求删除。
- [x] 不修改通知实现、生理参数或其他任务文件；通知语义如需改文档，留给汇合后的集成检查。
- [x] 运行受影响的 24 小时测试与 `git diff --check`，报告结果。

### Final fix wave: failed catch-up `activeBatch`

**Files:**
- Modify: `gateway/simulation.js`
- Test: `test/gateway.regressions.test.mjs`
- Test support: `test-support/models.mjs`（`flakySource` 可配置失败次数，默认值不变）

**Interfaces:**
- Consumes: 存档中已有的 `activeBatch`。
- Produces: 补算轮（包括已有批次重试与回放新建批次）在失败时把只读 `suppressNotifications: true` 随批次持久化；在线重试读取该标记继续抑制，成功提交后才由下一新批次恢复在线提醒；旧档无标记按 `false`。

- [x] 用真实 Gateway + 真实 `brainNotify` 写失败注入回归：catch-up 第一次失败、在线重试再失败，`activeBatch` 标记不丢失；下一次重试成功但仍不投递、不写 `lastSentAt` / `levels` / 配额；再下一新在线批次恰好发送一次。
- [x] 运行测试并确认旧实现会在在线重试成功时投递历史通知、消耗水位与配额。
- [x] 在 `catchUp` 执行前给已有批次和回放批次标记 `suppressNotifications: true`，让 `failBatch` 原样保留；`heartbeatOnce` 按 `batch.suppressNotifications === true` 决定抑制；不改 checkpoint schema。
- [x] 重跑 checkpoint、regression、notification 相关测试，确认通过并报告 RED/GREEN 证据。

## Verification

最终完整 `npm test` 与 `git diff --check` 的实际结果记录在 `docs/superpowers/plans/2026-11-24-audit-and-p0-modeling-checklist.md` 的“现状与验证基线”中；本页复选框不是交付证据。
