# 消化链开环修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消化链从单向管道变反馈闭环：`stomach` 读 `duodenum.nutrientExposure` 肠抑排空、`stomachGhrelin` 读扩张/营养/剂量抑制、`smallIntestine` 读水合与血糖调吸收；不改现有状态/transfer 形状，计数不变。

**Architecture:** 三处都只新增轮初读取与缩放，滞后一轮；暴露/亏缺/基线胰岛素为 0 时与原轨迹逐点一致。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-digestive-feedback-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按原速率，非法上游抛错使本轮失败。
- 状态 JSON-safe；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: 肠抑胃反射（TDD）

**Files:** Modify `organs/human-organs/stomach/motility-core.ts`、`motility-core.parameters.json`（或实际参数文件）、`test/organs.stomach*.test.mjs`
- [x] Step 1: 失败测试（`duodenum.nutrientExposure = 0.5` 时排空速率减半，暴露 0 时与原轨迹逐点一致，非法暴露抛错）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现 `inhibition = 1 − 0.5 × clamp(exposure, 0, 1)` 缩放各餐型排空，参数 `stomach.gastricInhibitionGain = 0.5`。
- [x] Step 4: 运行预期通过。

### Task 2: ghrelin 抑制（TDD）

**Files:** Modify `organs/human-organs/stomach/ghrelin.ts`、参数、`test/organs.ghrelin.test.mjs`（若不存在则定位现有 ghrelin 测试）
- [x] Step 1: 失败测试（`mechanical = 1`、`exposure = 1`、摄入 500 kcal 时目标显著下降；无摄入无暴露时行为不变；不再任意正能量一步压到谷值）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现 `suppression = 0.3 × mechanical + 0.3 × exposure + 0.4 × intakeKcal / 250`，按既有半时恢复/上升并钳到原上下限；参数 `distensionGain = 0.3`、`nutrientGain = 0.3`、`intakeGain = 0.4`、`referenceIntakeKcal = 250`。
- [x] Step 4: 运行预期通过。

### Task 3: 吸收调节（TDD）

**Files:** Modify `organs/human-organs/small-intestine/water-absorption.ts`、参数、`test/organs.small-intestine.test.mjs`（定位现有测试）
- [x] Step 1: 失败测试（`waterDeficit = 1` 时水吸收减半；`insulinRelative = 2` 且 `concentrationMgDl = 180` 时碳水吸收增加；缺部位按原速率；非法上游抛错）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现 `waterFactor = 1 − 0.5 × clamp(deficit, 0, 1)`、`carbFactor = 1 + 0.2 × (I − 1) + 0.2 × (G / 90 − 1)`；参数 `waterAbsorptionDehydrationFactor = 0.5`、`carbAbsorptionInsulinGain = 0.2`、`carbAbsorptionGradientGain = 0.2`。
- [x] Step 4: 运行预期通过。

### Task 4: 真实 Gateway 与文档

**Files:** Create `test/organs.digestive-feedback-gateway.test.mjs`；Modify `organs/human-organs/stomach/README.md`、`organs/human-organs/duodenum/README.md`、`organs/human-organs/small-intestine/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [x] Step 1: 真实 Gateway：餐后暴露上升后胃排空放慢、ghrelin 回落；预置脱水存档水吸收下降；血糖与胰岛素升高时碳水吸收增加；重启接续。
- [x] Step 2: 文档（三处反馈链、参数、时序、未建模：CCK/GLP-1 真实激素、绝对吸收率、独立数据）。
- [x] Step 3: `npm test` 与 `git diff --check`。

## 交付记录

- **已实现并合入：** 随本地提交 `c134fd0` 落地胃肠抑排空、ghrelin 分级抑制与小肠吸收调节，以及 `test/organs.digestive-feedback-gateway.test.mjs`。
- **P0 修正：** `smallIntestine` 将脱水系数改回正向 `waterAbsorptionDehydrationFactor = 0.1`、胰岛素吸收增益归 `0`（SGLT1 不依赖胰岛素）、高血糖梯度改为负反馈 `−0.2 × (G / 90 − 1)` 并对所有吸收因子与转移量做非负及不透支钳位。
- **仍未实现/未验证：** CCK/GLP-1 真实激素通路、绝对吸收率实测与真实 DSH 会话验收。
