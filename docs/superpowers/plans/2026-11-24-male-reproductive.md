# 男性生殖（睾丸 / 附睾）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 男性清单 `body-modules.male.json` = 根清单 + `testes`（睾酮）+ `epididymis`（精液储存与排空），接 `sexualResponse` 唤醒增益、`interoception.libidoMm` 与高潮排空；男性 30 部位 / 32 参数（在内分泌切片基础上）。

**Architecture:** `testes` 写 `testosteroneRelative`（基线 + 轻度昼夜）；`epididymis` 写 `spermStorageMl` 与 `ejaculatedMl`；`sexualResponse` 读睾酮调唤醒目标、读 `lastOrgasmAtSimMin` 触发排空。无新 transfer，闭包不变。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-male-reproductive-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 不做 HPG 轴、精子形态/活力、前列腺、生育力/受孕、性病、绝对浓度。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: testes 模块（TDD）

**Files:** Create `organs/human-organs/testes/testosterone.ts` + `testosterone.parameters.json`、`test/organs.testes.test.mjs`
- [x] Step 1: 失败测试（基线 1、60 min 半时、昼夜幅度 0.1、缺部位按 1、非法上游抛错、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`testosteroneRelative` 基线趋近 + 昼夜曲线，`hour = (io.simulatedSeconds / 3600) % 24`）。
- [x] Step 4: 参数文件（`testes.baselineRelative = 1`、`circadianAmplitude = 0.1`、`responseHalfTimeMin = 60`）。
- [x] Step 5: 运行预期通过。

### Task 2: epididymis 模块（TDD）

**Files:** Create `organs/human-organs/epididymis/storage.ts` + `storage.parameters.json`、`test/organs.epididymis.test.mjs`
- [x] Step 1: 失败测试（恢复与容量 5、高潮触发排空、下一轮恢复、缺 `sexualResponse` 不排空、非法上游抛错、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`spermStorageMl = min(prev + 0.002 × dtMin, 5)`；轮初 `lastOrgasmAtSimMin` 变为本 simMin 时 `ejaculatedMl = prev.spermStorageMl` 并清零，否则 0）。
- [x] Step 4: 参数文件（`epididymis.recoveryMlPerMin = 0.002`、`capacityMl = 5`）。
- [x] Step 5: 运行预期通过。

### Task 3: sexualResponse 睾酮增益 + interoception.libidoMm

**Files:** Modify `organs/human-organs/sexual-response/response.ts`、`organs/human-organs/brain/interoception.ts` 及各自测试
- [x] Step 1: 失败测试（睾酮 2 时唤醒目标 = `100 × intensity × (0.5 + 0.5 × 2)`，缺睾丸按 1；`libidoMm = clamp(100 × (T − 0.5), 0, 100)` 缺省 0）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（唤醒目标改 `100 × sexIntensity × (0.5 + 0.5 × testosteroneRelative)`；`libidoMm` 软读）并跑绿。

### Task 4: 男性清单、计数、真实 Gateway 与文档

**Files:** Create `body-modules.male.json`、`test/organs.male-reproductive-gateway.test.mjs`、两份新部位 README；Modify `package.json`（`files` 加男性清单）、相关计数/列表测试、`organs/human-organs/sexual-response/README.md`、`organs/human-organs/brain/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [x] Step 1: 男性清单 = 根 + 两部位（30 部位 / 32 参数）。
- [x] Step 2: 真实 Gateway：预置高睾酮 → 唤醒目标提高、`libidoMm` 上升；预置精液储存 + 高潮动作 → 排空、随后恢复；重启接续。
- [x] Step 3: 文档。
- [x] Step 4: `npm test` 与 `git diff --check`。

## 交付记录

- **已实现并合入：** 随本地提交 `c134fd0` 落地 `testes`、`epididymis`、`body-modules.male.json`（现为 40 部位 / 36 份唯一参数文件）、`sexualResponse` 睾酮增益、`interoception.libidoMm` 及 `test/organs.male-reproductive-gateway.test.mjs`。
- **P0 修正：** `sexualResponse` 强制释放与主动高潮判定检查 `!refractory`、释放当轮即切 `target = 0` 进入消退、`target` / `arousalMm` 钳位 `[0, 100]`，高睾酮时改用 `arousalHalfTimeMin / factor` 加速上升，消除不应期连发高潮；`test/organs.steady-state-24h.test.mjs` 验证男性 08:00 30 min 性活动仅触发 1 次高潮。
- **仍未实现/未验证：** `organs/human-organs/testes/README.md` 与 `organs/human-organs/epididymis/README.md` 仍未创建；真实 DSH 会话验收与独立生理数据未做。
