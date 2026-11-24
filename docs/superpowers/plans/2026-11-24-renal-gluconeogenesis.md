# 肾糖异生 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kidneyGluconeogenesis` 作为肝之外的第二个升糖来源：低血糖/高胰高血糖素时按自身速率向 `glucose.glucoseMassG` 产糖；根清单 32 部位 / 34 参数、女性 34 / 36。

**Architecture:** 不建糖原库，按速率受限的产糖代理实现（底物池未建模）：`active = G < 90 || glucagonRelative > 1`，`glucoseOutputG = min(0.3 × glucagonRelative × dtMin, 0.3)`，`transferOut: ['glucose.glucoseMassG']`。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-renal-gluconeogenesis-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 不做底物池（乳酸/氨基酸/甘油）、EPO、肾素/RAAS、GFR 实测、绝对浓度。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: kidneyGluconeogenesis 模块（TDD）

**Files:** Create `organs/human-organs/kidney/gluconeogenesis.ts` + `gluconeogenesis.parameters.json`、`test/organs.renal-gluconeogenesis.test.mjs`
- [x] Step 1: 失败测试（`G = 70` 或 `glucagonRelative = 2` 时产糖并 transfer 到 `glucose.glucoseMassG`、`G = 110` 不产糖、速率与每轮上限、缺部位回退、非法上游抛错且零写入、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`active = G < 90 || glucagonRelative > 1`，`output = min(0.3 × glucagonRelative × dtMin, 0.3)`，write `glucoseOutputG` 归 0 后 transfer）。
- [x] Step 4: 参数文件（`kidneyGluconeogenesis.maxOutputRateGPerMin = 0.3`、`maxOutputPerRoundG = 0.3`、`baselineMgDl = 90`）。
- [x] Step 5: 运行预期通过。

### Task 2: glucose transferIn 接入（TDD）

**Files:** Modify `organs/human-compartments/glucose/glucose-core.ts`（或 `glucose.ts`，以实际入口为准）与 `test/organs.glucose.test.mjs`
- [x] Step 1: 失败测试（`glucose.glucoseMassG.transferIn` 含 `kidneyGluconeogenesis.glucoseOutputG` 且排在 `liver.glycogenG` 之后；缺 `kidneyGluconeogenesis` 的清单启动报错）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现 transferIn 声明与配对校验。
- [x] Step 4: 运行预期通过。

### Task 3: 清单、计数、真实 Gateway 与文档

**Files:** Modify 两份清单、相关计数/列表测试；Create `test/organs.renal-gluconeogenesis-gateway.test.mjs`、`organs/human-organs/kidney/README.md` 补充小节；Modify `organs/human-compartments/glucose/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [x] Step 1: 两份清单各加 `kidney/gluconeogenesis.ts`；根 32 部位 / 34 参数、女性 34 / 36。
- [x] Step 2: 真实 Gateway：预置低血糖 + 无肝糖原时由肾产糖使血糖回升；肝糖原充足时两源并行；缺 `kidneyGluconeogenesis` 清单启动报错；重启接续。
- [x] Step 3: 文档（肾糖异生机制、与肝的分工、底物池未建模、未验证）。
- [x] Step 4: `npm test` 与 `git diff --check`。

## 交付记录

- **已实现并合入：** 随本地提交 `9cacc65` 落地 `kidneyGluconeogenesis` 与 `glucose.glucoseMassG.transferIn` 配对，并已挂入根/女性/男性三份主清单（硬 transfer 闭包现为根/男性 15 部位、女性 17 部位）。
- **P0 修正：** 改为平滑比例 + 餐后抑制公式（`basalOutputRateGPerMin = 0.024 g/min`、`hypoglycemiaOutputGainGPerMinPerMgDl = 0.005`、`glucagonOutputGainGPerMin = 0.05`、`maxOutputRateGPerMin = 0.5`、`maxOutputPerRoundG = 0.6`），静息与肝（`0.096 g/min`）合计 `0.120 g/min` 精确平衡基础耗糖，消除肝糖原耗尽后的阶跃锯齿过冲（`test/organs.steady-state-24h.test.mjs` 验证 24h 平滑接管并稳在 74.0 mg/dL）。
- **仍未实现/未验证：** 底物池（乳酸/氨基酸/甘油）、真实 DSH 会话验收与独立临床数据。
