# 心 / 循环与血压 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `heart`（心率/搏出量/心输出）与 `blood` 隔室（血容量、血压、氧输送）接入血氧、肾和内分泌：活动/皮质醇驱动心输出，氧输送限制组织供氧，GFR 随血容量调尿量与 ADH；根清单 30 部位 / 32 参数、女性 32 / 34。

**Architecture:** `physicalActivity` + `adrenal.cortisolRelative` → `heart` 心率/搏出 → `blood.cardiacOutputMlMin` → 氧输送与血压代理；`blood.gfrMlMin` → `kidney` 产尿、`hypothalamusAdh` 血容量驱动。无新 transfer，闭包不变。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-circulation-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 不做心电/瓣膜/心律、血压分级诊断、血管分区、血细胞/血红蛋白、CO2/酸碱。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: heart 模块（TDD）

**Files:** Create `organs/human-organs/heart/heart.ts` + `heart.parameters.json`、`test/organs.heart.test.mjs`
- [ ] Step 1: 失败测试（静息心率 70/搏出 70、活动 intensity 1 → drive 2.5、皮质醇 2 → +0.5、心率钳 180、心输出 = 心率 × 搏出、缺部位按 1、非法上游抛错、JSON-safe）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现（`drive = 1 + 1.5 × intensity + 0.5 × (cortisolRelative − 1)`，`strokeVolume = 70 × (1 + 0.2 × (drive − 1))`，`cardiacOutput = rate × stroke`）。
- [ ] Step 4: 参数文件（`heart.restingHeartRatePerMin = 70`、`maxHeartRatePerMin = 180`、`restingStrokeVolumeMl = 70`、`activityGain = 1.5`、`catecholamineGain = 0.5`）。
- [ ] Step 5: 运行预期通过。

### Task 2: blood 隔室（TDD）

**Files:** Create `organs/human-compartments/blood/blood.ts` + `blood.parameters.json`、`test/organs.blood.test.mjs`
- [ ] Step 1: 失败测试（心输出读数、氧输送 = CO × 含量、血压代理、GFR 随血容量、缺部位回退、非法上游抛错、JSON-safe）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现（`arterialContent = spo2 × 2`、`oxygenDelivery = CO × content / 1000`、血压指数式代理、`gfr = 100 × clamp(volume / 5000, 0.5, 1.2)`）。
- [ ] Step 4: 参数文件（`blood.referenceBloodVolumeMl = 5000`、`baselineSystolicMmHg = 120`、`baselineDiastolicMmHg = 80`、`baselineGfrMlMin = 100`、`oxygenContentPerPercentMlPerL = 2`）。
- [ ] Step 5: 运行预期通过。

### Task 3: 血氧、肾与 ADH 接入（TDD）

**Files:** Modify `organs/human-compartments/blood-oxygen/oxygen.ts`、`organs/human-organs/kidney/urine-production.ts`、`organs/human-organs/brain/hypothalamus-adh.ts` 及各自测试
- [ ] Step 1: 失败测试（`blood.oxygenDeliveryMlMin` 成为第三个供氧上限；`blood.gfrMlMin` 缩放产尿、低血容量尿量下降；`hypothalamusAdh` 目标加血容量项，缺 `blood` 按 0/1 回退）。
- [ ] Step 2: 运行预期失败。
- [ ] Step 3: 实现（`bloodOxygen` 供氧 `min(demand, alveolarCapacity, oxygenDelivery)`；`kidney` 请求 × `gfr / 100`；`hypothalamusAdh` 目标 + `volumeGain × (1 − volume / 5000)`，参数 `volumeGain = 0.5`）。
- [ ] Step 4: 运行预期通过。

### Task 4: 清单、计数、真实 Gateway 与文档

**Files:** Modify 两份清单、相关计数/列表测试；Create `test/organs.circulation-gateway.test.mjs`、`organs/human-organs/heart/README.md`、`organs/human-compartments/blood/README.md`；Modify `organs/human-compartments/blood-oxygen/README.md`、`organs/human-organs/kidney/README.md`、`organs/human-organs/brain/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [ ] Step 1: 两份清单各加 `heart/heart.ts` 与 `blood/blood.ts`；根 30 部位 / 32 参数、女性 32 / 34。
- [ ] Step 2: 真实 Gateway：活动时心率/心输出/氧输送上升且 SpO2 保持；低血容量变体 GFR 下降、尿量减少、ADH 上升；循环不足时血氧去饱和；重启接续。
- [ ] Step 3: 文档。
- [ ] Step 4: `npm test` 与 `git diff --check`。

## 交付记录

- **已实现：** `heart` 心率/搏出量/心输出与 `blood` 血容量/血压/氧输送/滤过代理落地并加入根、女性、男性清单；`bloodOxygen` 增加循环能力上限，`kidney` 产尿请求按 `gfr/100` 缩放，`hypothalamusAdh` 增加血容量项。真实 Gateway 测试见 `test/organs.circulation-gateway.test.mjs`，覆盖活动升心率/心输出/氧输送且 SpO2 保持、低血容量降 GFR/尿量并升 ADH、低输出心去饱和、重启接续。
- **已验证：** `heart` / `blood` 模块测试与 `test/organs.circulation-gateway.test.mjs` 通过；`bloodOxygen`、`kidney`、`hypothalamusAdh` 既有测试按新接口更新后通过。当前共享工作区同时有肾糖异生等并行切片，完整 `npm test` 受其他切片未完成的 transfer 清单影响，不能作为本切片单独结论。
- **实现偏差：** `blood` 增加 `maxOxygenDeliveryMlPerMin` 作为 `bloodOxygen` 的能力上限，而不是用含一轮滞后的 `oxygenDeliveryMlMin`；这样活动首轮不会因上一轮静息心输出假性去饱和。能力上限随轮初 SpO2 缩放，是工程近似，未被生理数据验证。
- **仍未实现/未验证：** 实测心率/血压/心输出/氧输送/GFR、血管分区与微循环、血红蛋白/血气、失血/输血动力学、血压调节反射、临床验证、真实 DSH 会话与性能基线。
