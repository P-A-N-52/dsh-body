# Urinary Notification and Voluntary Voiding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有体感提醒补上尿意通道，并由会话显式决定主动排尿。

**Architecture:** 只修改 `brainNotify` 的提醒策略与状态，继续读取轮初快照；每种信号独立滞回，冷却和配额仍按会话共享。真实 Gateway 集成测试复用现有根清单和 `urinate`，不改水链或膀胱规则。

**Tech Stack:** Node ≥22.18、ESM、可擦除 TypeScript、`node:test`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-22-urinary-notification-design.md`

## Global Constraints

- 保留工作区所有未提交空腹饥饿素改动，不重置、不覆盖、不提交任何文件。
- 60 秒一轮、轮初快照、整轮原子提交；状态必须 JSON-safe。
- 阈值是 `design` 提醒 policy，不是临床测量；没有消费者的字段不新增。
- 代码按 swarm 分片，单元测试、集成测试、实现和文档编辑范围不得冲突。
- 每轮最多一条通知；`mode/sessionId/text` 的 Gateway 契约不变。

## Review Focus

- 旧会话只有 `lastKind/lastLevel`：迁移后原信号不得重复提醒，新信号仍可提醒。
- 强饥饿和强尿意相继出现：各自档位独立，但共享冷却和配额。
- 排尿后旧体感仍偏高：最近 `voidedMl > 0` 或本轮已有 `urinate` 时不得补发过期尿意，其他信号仍可提醒。
- 同轮多个候选：最高档优先，同档 `urinary > fullness > hunger`，未选中信号不消耗水位。
- 缺失、NaN、Infinity 和旧存档：回退值有限、状态 JSON-safe，整轮不得因此失败。

---

### Task 1: 通知单元契约

**Files:**
- Modify: `test/organs.brain-notify.test.mjs`
- Consumes: 当前 `brainNotify` 模块契约和未提交 fasting 测试。
- Produces: Task 2 必须满足的精确行为测试。

- [x] **Step 1: 写失败测试。** 覆盖 65 mm `context`、85 mm `wake`、64 mm 不提醒；同档不重复、排空后重新武装、共享 45 分钟冷却；跨信号双向不压制；最高档和同档优先级；旧状态迁移；缺失/非有限尿意；最近 `voidedMl > 0` 的过期候选守卫。保留所有 fasting 测试原文。
- [x] **Step 2: 验证失败。** 运行 `node --test test/organs.brain-notify.test.mjs`，确认新增尿意用例因尚未实现而失败，既有用例不被误改。

### Task 2: 真实 Gateway 闭环契约

**Files:**
- Create: `test/organs.urinary-notify-gateway.test.mjs`
- Test: `test/organs.urinary-notify-gateway.test.mjs`

**Interfaces:**
- Consumes: 现有 `body_act`/`urinate`、真实 `body-modules.json` 和 `test-support/harness.mjs`。
- Produces: Task 3 必须满足的端到端行为测试。

- [x] **Step 1: 写失败测试。** 预置 `bladder.volumeMl=410` 和 `brainNotify.lastSessionId="urgency-session"`，固定时钟、端口 0、`autoTick:false`。第 1 轮尿意 100 且无通知；第 2 轮恰好一条尿意 `wake` 且没有排尿；随后显式 `urinate` 并推进，确认只发生主动排尿；再推进一轮确认尿意回落且无重复提醒。
- [x] **Step 2: 验证失败。** 运行 `node --test test/organs.urinary-notify-gateway.test.mjs`，确认第 2 轮因没有尿意通知而失败。

### Task 3: 提醒策略实现

**Files:**
- Modify: `organs/human-organs/brain/notify.ts`
- Modify: `organs/human-organs/brain/notify.parameters.json`
- Test: `test/organs.brain-notify.test.mjs`
- Test: `test/organs.urinary-notify-gateway.test.mjs`

**Interfaces:**
- Consumes: `interoception.urinaryUrgency`、最近提交的 `bladder.voidedMl` 和本轮原始 `io.actions`。
- Produces: 每会话 `levels: { hunger, fullness, urinary }`，`lastKind` 新增 `"urinary"`；新增参数 `brainNotify.urinary.marked/strong`。

- [x] **Step 1: 最小实现。** 新增尿意阈值、固定文本和每信号水位；保留最近提醒摘要、共享冷却/配额和现有饥饿/饱满行为。在 `normalizeSession` 惰性迁移旧状态，不改顶层 `initialState/fields`。
- [x] **Step 2: 验证单元行为。** 运行 `node --test test/organs.brain-notify.test.mjs`，预期全部通过。
- [x] **Step 3: 验证闭环与兼容。** 运行 `node --test test/organs.urinary-notify-gateway.test.mjs test/organs.fasting-gateway.test.mjs test/organs.modules.test.mjs test/parameters.test.mjs`，预期全部通过。

### Task 4: 文档与整体验证

**Files:**
- Modify: `organs/human-organs/brain/README.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/virtual-body.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-11-22-urinary-notification.md`

- [x] **Step 1: 同步当前实现。** 记录三类输入、尿意阈值、每信号滞回、共享冷却/配额、优先级、旧档迁移、排后卫士和轮次偏移；保留口渴/不适无提醒、无自动排尿及未做真实 DSH 验收的边界。历史 spec 和验收记录不改写。
- [x] **Step 2: 全量验证。** 运行 `npm test`，预期所有测试通过、0 失败。
- [x] **Step 3: 检查交付面。** 运行 `git status --short`，确认没有测试临时产物、没有覆盖既有空腹改动；勾选已完成步骤，未做的实机验收保持未勾选。

### 后续实机验收（不在本次实施范围）

- [ ] 真实 DSH 会话中确认尿意提醒能按 `context` / `wake` 投递到目标会话。
- [ ] 真实 DSH 会话中确认“提醒 → 显式 `urinate` → 尿意回落”闭环且不自动排尿。
- [ ] 真实 DSH 会话/重启补算场景中确认通知丢弃、`levels` / `lastSentAt` / 冷却与配额消耗，以及恢复后同档不补发的行为；决定是否另立设计修复。

## 交付记录

- **已实现并合入：** 提交 `490154d` 已完成尿意通知通道、每信号滞回水位与排后防过期守卫；P0 阶段进一步修复 `resetBelow = 40 mm` 在 40–64 mm 区间锁定水位不误清零的滞回边界，并将 `notify.parameters.json` 14 项参数标注为 `policy`。
- **仍未验证：** 上述三项真实 DSH 会话与重启补算实机验收尚未执行。
