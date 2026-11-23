# 内分泌轴（HPT / HPA）与松果体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两条完整内分泌轴（HPT、HPA）+ 松果体昼夜节律，含负反馈与消费者；根清单 28 部位 / 30 参数、女性 30 / 32。

**Architecture:** `hypothalamusEndocrine`（TRH/CRH）→ `pituitary`（TSH/ACTH）→ `thyroid`（T4）/ `adrenal`（皮质醇），外周激素反向抑制上游；`pineal` 按仿真昼夜产褪黑素。消费者：`bloodOxygen` 基础氧耗随 T4、`liver` 释放随皮质醇、`interoception` 新增 `stressMm` / `sleepinessMm`。Task 1–5 文件不重叠可并行（后台），Task 6 依赖其落地。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-endocrine-axes-design.md`

## Global Constraints

- 代码、测试、配置和参数通过后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；别的分片尚未落地导致的红测试只报告、不绕过；不改 plan/spec。
- 所有新参数 `design`、`source: null`；不做甲状旁腺/血钙、T3、肾上腺素、绝对浓度、睡眠行为、免疫。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 1（信号）或 0（读数）回退，已加载但字段缺失/非有限/为负抛错使本轮失败。
- 无新 transfer，硬闭包不变；状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`，仓库根不留新文件。

## Review Focus

- 负反馈：T4/皮质醇升高必须同时降低 TRH/TSH 与 CRH/ACTH，不是单向放大（Task 1/2）。
- 缺外周部位时下丘脑/垂体按 1 回退，不报错（Task 1/2）。
- T4 只经 `bloodOxygen` 调基础氧耗、皮质醇只经 `liver` 调释放，不直接改血糖/血氧池状态（Task 3/4）。
- `sleepinessMm` 由仿真时刻驱动，不用现实时间（Task 5）。

---

### Task 1: hypothalamusEndocrine

**Files:** Create `organs/human-organs/brain/hypothalamus-endocrine.ts` + 参数、`test/organs.hypothalamus-endocrine.test.mjs`
- [ ] Step 1: 失败测试（T4=2 → TRH/TSH 下降、T4=0.5 → 上升、皮质醇同、30 min 半时、缺部位按 1）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现（公式见 spec，读 `thyroid.thyroxineRelative` / `adrenal.cortisolRelative`）。
- [ ] Step 4: 参数文件（`hypothalamusEndocrine.trhFeedbackGain = 1`、`crhFeedbackGain = 1`）。
- [ ] Step 5: 运行预期通过。

### Task 2: pituitary

**Files:** Create `organs/human-organs/brain/pituitary.ts` + 参数、`test/organs.pituitary.test.mjs`
- [ ] Step 1: 失败测试（TRH 驱动 TSH、T4 负反馈、ACTH 同、30 min 半时、缺部位按 1）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现（读 `hypothalamusEndocrine.trhRelative/crhRelative`、`thyroid.thyroxineRelative`、`adrenal.cortisolRelative`）。
- [ ] Step 4: 参数文件（`pituitary.tshFeedbackGain = 1`、`acthFeedbackGain = 1`）。
- [ ] Step 5: 运行预期通过。

### Task 3: thyroid + bloodOxygen 基础代谢

**Files:** Create `organs/human-organs/thyroid/thyroid.ts` + 参数、`test/organs.thyroid.test.mjs`；Modify `organs/human-compartments/blood-oxygen/oxygen.ts` 与其测试
- [ ] Step 1: 失败测试（TSH 驱动 T4、60 min 半时、缺垂体按 1；`bloodOxygen` 基础氧耗随 T4 缩放 0.8+0.4×T4，缺甲状腺按 1）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现 `thyroid` 并改 `bloodOxygen.basalMlMin` 的用法（保留原参数名，基础值改按 T4 缩放）。
- [ ] Step 4: 参数文件（`thyroid.*` 按 spec，无额外增益参数时只写 owner/版本说明亦可，但要有参数文件）。
- [ ] Step 5: 运行预期通过。

### Task 4: adrenal + liver 释放

**Files:** Create `organs/human-organs/adrenal/cortisol.ts` + 参数、`test/organs.adrenal.test.mjs`；Modify `organs/human-organs/liver/glycogen.ts` 与其测试
- [ ] Step 1: 失败测试（ACTH 驱动皮质醇、15 min 半时、缺垂体按 1；`liver` 释放速率乘皮质醇，缺肾上腺按 1）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现 `adrenal` 并改 `liver` 释放公式（`maxOutputRateGPerMin × glucagonRelative × cortisolRelative × dtMin`，仍钳到存量）。
- [ ] Step 4: 参数文件（`adrenal.*`）。
- [ ] Step 5: 运行预期通过。

### Task 5: pineal + interoception 读数

**Files:** Create `organs/human-organs/pineal/melatonin.ts` + 参数、`test/organs.pineal.test.mjs`；Modify `organs/human-organs/brain/interoception.ts` 与其测试
- [ ] Step 1: 失败测试（`hour = 2` → 1.8、`hour = 14` → 0.2；`stressMm`/`sleepinessMm` 软读与缺省 0；其余读数不变）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现 `pineal`（用 `io.simulatedSeconds`，不用现实时间）；`interoception` 加 `stressMm`、`sleepinessMm`（`mm`、`absolute`）。
- [ ] Step 4: 参数文件（`pineal.*`，如需要 amplitude/base，按 spec 固定曲线写常量）。
- [ ] Step 5: 运行预期通过。

### Task 6: 清单、计数、真实 Gateway 与文档

**Files:** Modify 两份清单、`test/organs.gateway.test.mjs`、`organs.modules.test.mjs`、`parameters.test.mjs`、`dsh.tools.test.mjs`、`organs.di.test.mjs`、`organs.reproductive-gateway.test.mjs`、`organs.water-gateway.test.mjs`、`organs.sexual-response-gateway.test.mjs`、`organs.blood-oxygen-gateway.test.mjs`（计数/列表）；Create `test/organs.endocrine-gateway.test.mjs`、五份新部位 README；Modify `organs/human-compartments/blood-oxygen/README.md`、`organs/human-organs/liver/README.md`、`organs/human-organs/brain/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [ ] Step 1: 两份清单各加 5 个脚本；根 28 部位 / 30 参数、女性 30 / 32。
- [ ] Step 2: 同步计数、部位列表与初值。
- [ ] Step 3: 真实 Gateway：预置高 TSH → T4 升、基础氧耗升、TRH/TSH 回落；预置高 ACTH → 皮质醇升、肝糖释放增、`stressMm` 升；跨仿真昼夜 `sleepinessMm` 变化；重启接续。
- [ ] Step 4: 文档（新部位 README + 上述修改文件）。
- [ ] Step 5: `npm test` 与 `git diff --check`。

## 交付记录

（Task 6 填写）
