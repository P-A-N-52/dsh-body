# 乳腺 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 女性清单接入乳腺泌乳：垂体催乳素驱动产奶，乳汁水经 `bodyFluid` 第五出口、乳糖经 `glucose` 女性变体汇出，胀奶进 `interoception.discomfort` 第六路；根清单不装乳腺。

**Architecture:** `pituitary.prolactinRelative` → `mammaryGlands` 产奶；`water.female.ts` 出口顺序肾→肺→汗→子宫→乳腺；`glucose-core.ts` + `glucose.female.ts` 变体承载 `mammaryGlands.lactoseG` 汇（根 `glucose.ts` 不含），避免根清单被强制要求乳腺。

**Spec:** `docs/superpowers/specs/2026-11-24-mammary-glands-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 乳腺只能进女性清单：任何含 `glucose` 的清单不得因乳糖汇被强制要求乳腺，必须用 `glucose.female.ts` 变体隔离。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 状态 JSON-safe；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: 模块与消费者链（已由 agent-135 完成）

- `organs/human-organs/mammary-glands/milk.ts` + 参数 + `test/organs.mammary.test.mjs`
- `pituitary.prolactinRelative`、`water.female.ts` 第五出口、`glucose` 乳糖汇、`interoception` 第六路 discomfort
- 94/94 定向测试通过；真实 Gateway 冒烟链路生效。

### Task 2: glucose 核心抽取与女性变体（TDD）

**Files:** Create `organs/human-compartments/glucose/glucose-core.ts`、`organs/human-compartments/glucose/glucose.female.ts`；Modify `organs/human-compartments/glucose/glucose.ts`（薄入口，公开导出不变）、`body-modules.female.json`（`glucose.ts` 换 `glucose.female.ts` 并加 `mammary-glands/milk.ts`）；`organs/human-compartments/body-water/water-core.ts`（注释补第五出口）
- [x] Step 1: 失败测试（女性清单启动含乳腺且乳糖汇生效；根清单 `glucose.ts` 无 `mammaryGlands.lactoseG` 声明、根清单不因乳腺启动失败）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 抽核心（出口/请求方参数化，仿 `water-core.ts`），`glucose.ts` 薄入口不变，`glucose.female.ts` 增加乳腺汇并排在最后；女性清单换用变体并注册乳腺（女性 32 部位 / 34 参数，在唾液腺集成后的 31/33 基础上 +1）。
- [x] Step 4: `water-core.ts` 注释补第五出口。
- [x] Step 5: 运行预期通过。

### Task 3: 真实 Gateway 与文档

**Files:** Create `test/organs.mammary-gateway.test.mjs`、`organs/human-organs/mammary-glands/README.md`；Modify `organs/human-organs/brain/README.md`、`organs/human-compartments/body-water/README.md`、`organs/human-compartments/glucose/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`、相关计数测试
- [x] Step 1: 真实 Gateway（女性清单）：预置高催乳素 → 产奶增加、体液水账含泌乳、血糖池出现乳糖汇、`fullnessMm` 上升并入 `discomfort`；根清单无乳腺时行为不变；缺乳腺时女性清单启动报目标未声明；重启接续。
- [x] Step 2: 文档（乳腺机制、催乳素、第五出口、女性葡萄糖变体、未建模：婴儿/吸吮动作/乳汁成分/孕期）。
- [x] Step 3: `npm test` 与 `git diff --check`。

## 交付记录（2026-11-24）

- **已实现：** `mammaryGlands` 按 `pituitary.prolactinRelative` 产奶，乳汁水经 `bodyFluid` 第五出口（肾→肺→汗→子宫→乳腺）转移为 `milkMl`，乳糖经 `glucose.female.ts` 末位汇出为 `lactoseG`，`fullnessMm` 并入 `interoception.discomfort` 第六路。`pituitary.prolactinRelative` 由 `milkMl > 0`（吸吮代理）驱动。女性清单当时 32 部位 / 34 参数（现 41 部位 / 37 份唯一参数文件），根清单不含乳腺。
- **P0 修正：** 新增布尔状态 `lactating`（默认 `false`，静息女性 0 泌乳、0 乳糖流失、`prolactinRelative = 1`）与 `fullnessDecayHalfTimeMin = 30 min`，显式置 `lactating: true` 时恢复产奶与催乳素响应且 `fullnessMm` 带半时回落不锁死；`test/organs.steady-state-24h.test.mjs` 验证女性 24h 静息稳态。
- **已验证：** 模块与消费者链 94/94 定向测试通过；真实 Gateway 冒烟与 24h 稳态测试通过。
- **实施中修正：** 初版 `glucose.ts` 无条件声明乳糖汇导致根清单启动失败，改为 `glucose-core.ts` 工厂 + 根入口（无乳腺）+ `glucose.female.ts`（含乳腺乳糖汇）。
- **仍未实现/未验证：** 婴儿、吸吮动作、哺乳行为、乳腺病变、乳汁成分细分、孕期与产后阶段、独立生理数据、真实 DSH 会话、性能基线。
- **工作区：** 与内分泌轴、唾液腺合入本地提交 `e0b2ae9`。
