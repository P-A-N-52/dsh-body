# Fasting Ghrelin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让长期无含能摄入的身体通过胃饥饿素上升进入明显和强饥饿档，并在真实 Gateway 中按现有策略提醒。

**Architecture:** `stomachGhrelin` 自己记录 `minutesSinceEnergyIntake`，用饱和目标驱动现有相对浓度；下游 `interoception` 和 `brainNotify` 的方程、权重、阈值不变。代码/测试与文档分派给不同 swarm worker，最后独立评审并统一验证。

**Tech Stack:** Node ≥22.18、ESM、可擦除 TypeScript、JSON 参数文件、`node:test`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-22-fasting-ghrelin-design.md`

## Global Constraints

- 使用 `io.dt`、轮初快照和单写者；不得读取 `stomach.lastIntakeAt` 或墙钟推进空腹时间。
- 新参数均为 `design`、`source: null`：`peak=1.8`、`onsetMin=180`、`rise.apparentHalfTimeMin=120`。
- 保留既有 `baseline=1`、`nadir=0.5`、`recovery.apparentHalfTimeMin=90` 和通知阈值/冷却/配额。
- 含能 `eat`/`drink` 清零并抑制；纯水、零能量和非法能量值不清零。
- 旧存档缺少计时字段时从 0 开始，不反推历史，不在升级第一轮制造高饥饿。
- 文档用中文，明确工程曲线不是人体标定。任务不提交 git，保留工作树供统一检查。

## Review Focus

- 旧档缺字段：补 0 后首轮 `hunger=50`，后续重启不重复清零；由 Task 1 旧档测试覆盖。
- onset 后纯水/零能量：与无动作对照具有相同计时和浓度，不得重置；由 Task 1 对照测试覆盖。
- 含能摄入轮：只清零和抑制，不同时恢复或上升；由 Task 1 单步测试覆盖。
- 无会话/冷却：强档只有在有会话且策略允许时产生 `wake`；由 Task 1 notify 与根清单 Gateway 测试覆盖。
- 非有限或负计时：回落 0，状态保持有限、JSON-safe；由 Task 1 模块测试覆盖。

---

### Task 1: 胃饥饿素实现与回归测试

**Files:**
- Modify: `organs/human-organs/stomach/ghrelin.ts`
- Modify: `organs/human-organs/stomach/ghrelin.parameters.json`
- Modify: `test/organs.ghrelin.test.mjs`
- Modify: `test/organs.brain-notify.test.mjs`
- Create: `test/organs.fasting-gateway.test.mjs`

**Interfaces:**
- Consumes: 现有 `heartbeat(io)`、`hasEnergyIntake` 语义、根清单和 `startGateway` 测试方式。
- Produces: `GhrelinState { relativeConcentration: number; minutesSinceEnergyIntake: number }`；`fields.minutesSinceEnergyIntake = { unit: 'min', mode: 'absolute' }`；三个新参数的准确 ID 见 spec。

- [ ] **Step 1: 先写模块失败测试**

在 `test/organs.ghrelin.test.mjs` 增加：初值/字段声明；缺失、负值和非有限计时回落 0；onset 前保持既有恢复；onset 后上升且不超过 peak；初始状态跑 1200 轮后计时为 1200、`G>=1.7` 且 `G<=1.8`；含能摄入当轮 `t=0`、`c=min(c,nadir)`；onset 后纯水和零能量动作分别与无动作对照结果相同。保留现有“0.5 经 90 轮到 0.75”等精确断言。

- [ ] **Step 2: 验证模块测试按预期失败**

Run: `node --test test/organs.ghrelin.test.mjs`
Expected: 新断言因缺少计时字段/上升行为而失败，既有断言不被预先放宽。

- [ ] **Step 3: 实现 spec 的状态、参数和方程**

在 `ghrelin.ts` 增加计时状态和三个参数，摄入轮只抑制/清零，其余轮按 spec 计算 `t_next`、`target`、`c_next`；缺失或非法计时回落 0。更新脚本头来源与未建模边界，删除“完全不建模餐前上升”的旧描述，保留“不建模餐时表、昼夜节律和剂量响应”。

- [ ] **Step 4: 验证模块测试通过**

Run: `node --test test/organs.ghrelin.test.mjs`
Expected: PASS，包括全部旧用例。

- [ ] **Step 5: 补强饥饿通知测试**

在 `test/organs.brain-notify.test.mjs` 以已发送过明显饥饿的会话为种子：44 min 时强饥饿不重复通知，45 min 时产生一个强饥饿 `wake`，档位和计数正确。Run: `node --test test/organs.brain-notify.test.mjs`，Expected: PASS，生产 notify 代码不变。

- [ ] **Step 6: 写真实根清单 Gateway 验收**

在 `test/organs.fasting-gateway.test.mjs` 使用临时目录、端口 0、`autoTick:false`、固定时钟和真实 `body-modules.json`：
1. 第一轮以 0 kcal 饮水绑定 `sessionId`，跑 1200 轮；断言 `G>=1.7`、`hunger>=85`，通知队列包含该会话的饥饿提醒，至少一次强饥饿 `wake`。
2. 加入 330 mL、140 kcal 饮料；一轮后 `G=0.5`、计时 0，再一轮后 `hunger<40`，没有新增饥饿通知。
3. 旧档只含 `stomachGhrelin.relativeConcentration=1` 时加载根清单；一轮后计时 1、`G=1`、`hunger=50`，无通知。

Run: `node --test test/organs.fasting-gateway.test.mjs`
Expected: PASS；若失败，先核对会话、轮初快照和动作时序，不改通知阈值来凑结果。

### Task 2: 同步模型文档与历史设计边界

**Files:**
- Modify: `organs/human-organs/stomach/README.md`
- Modify: `organs/human-organs/brain/README.md`
- Modify: `docs/superpowers/specs/2026-11-20-organ-model-design.md`

**Interfaces:**
- Consumes: Task 1 的字段名、参数 ID 和 spec 方程；不改任何代码或测试。
- Produces: 与实现一致的状态、参数、证据和未建模说明。

- [ ] **Step 1: 更新胃 README**

记录 `minutesSinceEnergyIntake`、三个新参数、含能重置/纯水不重置、旧档从 0 开始及饱和曲线；把“完全不建模餐前上升”改为“建模空腹时长驱动的工程上升，不建模餐时表、餐前预期、昼夜节律和剂量响应”。

- [ ] **Step 2: 更新脑 README 与历史设计提示**

脑 README 说明 `G=1` 是餐间基准，空腹时可高于 1，65/85 mm 映射及通知策略不变。原器官模型设计顶部增加历史提示，链接新 spec，不静默重写原批准文本；只更新会误导当前行为的说明。

- [ ] **Step 3: 检查文档改动**

Run: `git diff --check -- organs/human-organs/stomach/README.md organs/human-organs/brain/README.md docs/superpowers/specs/2026-11-20-organ-model-design.md`
Expected: 无输出；没有声称临床阈值、独立验证或实机验收。

### Final Verification and Review

- [ ] **Step 1: 完整验证**

Run: `npm test`
Expected: 全部通过，包括 1200 轮真实根清单验收。

- [ ] **Step 2: 独立 swarm 评审与清理**

由未参与实现的 reviewer 核对 spec 每项要求、diff、证据边界和测试真实性；发现问题先修复再复审。最后检查 `git status`，删除本轮不需要的临时产物，区分已验证行为和未做的真实 DSH 会话验收。
