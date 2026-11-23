# 唾液腺 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `salivaryGlands` 唾液产率（基础 + 进食刺激 − 脱水），接 `duodenum` 淀粉酶增益与 `interoception.dryMouthMm`；根清单 29 部位 / 31 参数、女性 31 / 33。

**Spec:** `docs/superpowers/specs/2026-11-24-salivary-glands-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 每轮只读轮初快照与本轮原始动作；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 无新 transfer；状态 JSON-safe；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: 唾液腺模块（TDD，后台先行）

**Files:** Create `organs/human-organs/salivary-glands/saliva.ts` + `saliva.parameters.json`、`test/organs.salivary.test.mjs`
- [ ] Step 1: 失败测试（基础产率 0.5、进食刺激 ×3 与 5 min 窗口、脱水减半、口干读数、缺体液按 deficit 0、JSON-safe）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现（公式见 spec，`mealStimulusMin` 递减、`eat`/`drink` 触发置 5）。
- [ ] Step 4: 参数文件（`salivaryGlands.*` 与 `duodenum.salivaryAmylaseGain = 0.05`）。
- [ ] Step 5: 运行预期通过。

### Task 2: duodenum 淀粉酶增益 + interoception 口干（内分泌切片落地后做）

**Files:** Modify `organs/human-organs/duodenum/nutrient-exposure.ts`（实际文件名以仓库为准）、`organs/human-organs/brain/interoception.ts` 及各自测试
- [ ] Step 1: 失败测试（含碳水餐暴露含增益、不含碳水不变、未加载唾液腺增益 0；`dryMouthMm` 软读缺省 0）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现并跑绿。

### Task 3: 清单、计数、真实 Gateway 与文档

**Files:** Modify 两份清单、相关计数/列表测试；Create `test/organs.salivary-gateway.test.mjs`、`organs/human-organs/salivary-glands/README.md`；Modify `organs/human-organs/duodenum/README.md`、`organs/human-organs/brain/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [ ] Step 1: 两份清单加唾液腺；根 29 部位 / 31 参数、女性 31 / 33。
- [ ] Step 2: 真实 Gateway：进食后产率上升、暴露含增益；预置脱水 → 产率下降、口干上升；重启接续。
- [ ] Step 3: 文档。
- [ ] Step 4: `npm test` 与 `git diff --check`。

## 交付记录（2026-11-24）

- **已实现：** `salivaryGlands` 唾液产率（基础 0.5 mL/min、进食刺激 ×3 持续 5 min、`bodyFluid.waterDeficit` 脱水减半）与 `mouthMoistureMm`；`duodenum` 对含碳水餐按 `1 + 0.05 × salivaRate / basalRate` 增益营养暴露（唾液淀粉酶）；`interoception` 新增 `dryMouthMm`（软读缺省 0）。根清单 29 部位 / 31 参数、女性 31 / 33。
- **已验证：** 模块单元测试全绿；真实 Gateway 4 用例：`eat`/`drink` 后产率 ×3 并于 5 轮后回落、碳水餐暴露含淀粉酶增益、预置脱水存档产率下降且 `dryMouthMm` 上升、重启接续。隔离副本 147/147。
- **仍未实现/未验证：** 唾液水账、淀粉酶浓度、吞咽/食管、口腔疾病、味觉、口咽解渴支路、独立生理数据、真实 DSH 会话、29 部位性能。
- **工作区：** 与内分泌轴、乳腺合入本地提交 `e0b2ae9`。
