# 甲状旁腺与血钙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `parathyroid`（PTH）与 `bloodCalcium` 隔室 + 骨钙库形成血钙负反馈：低钙 → PTH 升 → 骨钙释放/重吸收增加，高钙 → PTH 降 → 沉积/排泄增加（经 `blood.gfrMlMin`）；症状读数进 `interoception`；三清单均已接入（根 43 部位 / 39 参数、女性 46 / 42、男性 45 / 41）。

**Architecture:** `bloodCalcium.mgDl` 低 → `parathyroid.pthPgMl`（`pg/mL`）升 → `bone` 释放增加、肾排泄减少；高则反向。`bone` 只作钙库，不做骨密度/骨折。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-parathyroid-calcium-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 不做维生素 D、肠道钙吸收、骨密度/骨折/骨代谢病、绝对钙浓度、降钙素。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: parathyroid 模块（TDD）

**Files:** Create `organs/human-organs/parathyroid/parathyroid.ts` + `parathyroid.parameters.json`、`test/organs.parathyroid.test.mjs`
- [x] Step 1: 失败测试（`bloodCalcium.mgDl = 8` → PTH 升、`mgDl = 11` → PTH 降、15 min 半时、缺 `bloodCalcium` 按 9.5、非法上游抛错、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`pthTarget = clamp(1 + 0.5 × (9.5 − mgDl), 0, 3)`，15 min 半时趋近）。
- [x] Step 4: 参数文件（`parathyroid.referenceCalciumMgDl = 9.5`、`pthGain = 0.5`）。
- [x] Step 5: 运行预期通过。

### Task 2: bloodCalcium 隔室与骨钙库（TDD）

**Files:** Create `organs/human-compartments/calcium/calcium.ts` + `calcium.parameters.json`、`test/organs.blood-calcium.test.mjs`
- [x] Step 1: 失败测试（PTH 高时骨钙释放增加、PTH 低时沉积增加、GFR 改变影响排泄、骨钙库钳 0–200、缺部位回退、非法上游抛错、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`release = 0.0004 × (pth − 1) × dtMin`（pth > 1）、`deposit = 0.0004 × (1 − pth) × dtMin`（pth < 1）、`excretion = gfr × 0.000001 × max(0, 1 − pthRelative) × dtMin`、`mgDl` 按分布体积积分）。
- [x] Step 4: 参数文件（`calcium.referenceMgDl = 9.5`、`boneStoreInitialG = 100`、`boneCapacityG = 200`、`boneReleaseRateGPerMin = 0.01`、`boneDepositRateGPerMin = 0.01`、`calciumExcretionPerMlG = 0.0001`、`distributionVolumeDl = 140`）。
- [x] Step 5: 运行预期通过。

### Task 3: 症状读数与清单、Gateway、文档

**Files:** Modify `organs/human-organs/brain/interoception.ts` 及其测试、两份清单、相关计数测试；Create `test/organs.parathyroid-gateway.test.mjs`、`organs/human-organs/parathyroid/README.md`、`organs/human-compartments/calcium/README.md`；Modify `docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [x] Step 1: `interoception` 新增 `hypocalcemiaMm` / `hypercalcemiaMm`（软读缺省 0）。
- [x] Step 2: 三份清单加 `parathyroid/parathyroid.ts` 与 `calcium/calcium.ts`（现行基数同步为根 43 部位 / 39 参数、女性 46 / 42、男性 45 / 41）。
- [x] Step 3: 真实 Gateway：新增 `test/organs.parathyroid-gateway.test.mjs`，覆盖三清单静息基线、预置低血钙 → PTH 升 / 骨钙库下降 / 血钙回升 / `hypocalcemiaMm` 升高、预置高血钙 → 排泄与沉积增加 / 血钙回落，以及重启接续。
- [x] Step 4: 器官 README 与主文档挂载描述已同步完成。
- [x] Step 5: `npm test` 与 `git diff --check`。

## 交付记录

- **已完成（Task 1–3 挂载、Gateway 测试与文档收口）：** 随本地提交 `9cacc65` 落地 `parathyroid/parathyroid.ts`、`calcium/calcium.ts`、各自参数文件以及单元/闭环测试 `test/organs.parathyroid.test.mjs`、`test/organs.blood-calcium.test.mjs`；`interoception.ts` 已包含 `hypocalcemiaMm` / `hypercalcemiaMm` 软读；P0 阶段在 `calcium.ts` 修正了 `/ 1000` → `* 1000` 的 g→mg 换算错误并增加 `depositG` 骨容量余量截断；2026-11-26 本轮收口已完成三份 `body-modules*.json` 挂载、新增 `test/organs.parathyroid-gateway.test.mjs` 并同步计数测试、器官 README 与主文档。
- **已落地纯物理统一与通知/唤醒扩展（2026-11-26）：** `parathyroid` 已由 `pthRelative` 统一为纯物理浓度 `pthPgMl`（`pg/mL`，`design` 基线 30、上限 90），`calcium.ts` 消费 `pthPgMl` 并移除旧相对字段回退；`hypocalcemiaMm` / `hypercalcemiaMm` 已接入 `brainNotify`（`EXPANDED_KEYS` 65/85/40 mm 无数字通知）与 `wake-evaluation`（92/95 mm 睡眠唤醒）。仍属 `design`/`source: null`，未做临床或真实 DSH 会话验证。
