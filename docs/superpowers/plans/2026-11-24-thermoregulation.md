# 体温调节 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `thermoregulation` 核心温度由产热（氧耗/T4、活动、寒战）与散热（汗液蒸发、辐射对流）决定并负反馈，驱动出汗、喘息与冷热读数；根清单 31 部位 / 33 参数、女性 33 / 35。

**Architecture:** `bloodOxygen.oxygenConsumptionMlMin` → 产热；`skin.sweatVolumeMl` 蒸发 + 辐射 → 散热；`coreTemperatureC` 积分。`skin` 出汗随体温、`lungsVentilation` 通气随体温、`interoception` 新增 `heatMm` / `coldMm`。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-thermoregulation-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 不做皮肤分区温度、血管舒缩、寒战做功细节、发热/低温症、湿度风速。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；可选部位未加载按 spec 回退，非法上游抛错使本轮失败。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: thermoregulation 模块（TDD）

**Files:** Create `organs/human-organs/brain/thermoregulation.ts` + `thermoregulation.parameters.json`、`test/organs.thermoregulation.test.mjs`
- [x] Step 1: 失败测试（产热随氧耗、汗液蒸发散热、温度积分、热时出汗增益、冷时寒战、缺部位回退、非法上游抛错、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`heatProduction = 0.02 × oxygenConsumptionMlMin + 2 × max(0, 37 − T)`，`loss = 0.58 × sweatVolumeMl + 0.05 × (T − 25)`，`T += dtMin × (prod − loss) / 60`）。
- [x] Step 4: 参数文件（`setpointC = 37`、`ambientTemperatureC = 25`、`heatCapacityKcalPerC = 60`、`metabolicFactor = 0.02`、`shiveringGain = 2`、`lossGain = 0.05`、`evaporationKcalPerMl = 0.58`）。
- [x] Step 5: 运行预期通过。

### Task 2: 出汗、通气与读数接入（TDD）

**Files:** Modify `organs/human-organs/skin/sweat.ts`、`organs/human-organs/lungs/ventilation.ts`、`organs/human-organs/brain/interoception.ts` 及各自测试
- [x] Step 1: 失败测试（`skin.sweatRequestMl` 随核心温度增加、`lungsVentilation` 目标加喘息项、`heatMm`/`coldMm` 软读缺省 0）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`skin` 请求 × `(1 + heatGain × max(0, T − 37))`，`heatGain = 1`；`lungsVentilation` 目标 + `pantingGain × max(0, T − 37)`，`pantingGain = 0.5`；`interoception` 两个新读数）。
- [x] Step 4: 运行预期通过。

### Task 3: 清单、计数、真实 Gateway 与文档

**Files:** Modify 两份清单、相关计数/列表测试；Create `test/organs.thermoregulation-gateway.test.mjs`、`organs/human-organs/brain/thermoregulation.README.md`（或写入 brain/README.md 新增小节）；Modify `organs/human-organs/skin/README.md`、`organs/human-organs/lungs/README.md`、`organs/human-organs/brain/README.md`、`organs/human-compartments/blood-oxygen/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`
- [x] Step 1: 两份清单加 `brain/thermoregulation.ts`；根 31 部位 / 33 参数、女性 33 / 35。
- [x] Step 2: 真实 Gateway：活动使体温上升、出汗增加并拉回设定点附近；预置高体温散热增强、体温回落；预置低体温寒战产热；重启接续。
- [x] Step 3: 文档。
- [x] Step 4: `npm test` 与 `git diff --check`。

## 交付记录

- **已实现：** `thermoregulation` 核心温度积分落地并随本地提交 `9cacc65` 加入三份主清单；`skin` 按核心温度叠加出汗请求，`lungsVentilation` 叠加喘息项，`interoception` 新增 `heatMm` / `coldMm`。真实 Gateway 测试见 `test/organs.thermoregulation-gateway.test.mjs`。
- **P0 修正：** 修复原静息高热失控与蒸发 `dt` 量纲错误：`metabolicFactor = 0.005 kcal/mL`、`lossGain = 0.104167 kcal/(min·°C)`、蒸发项按 `evaporationKcalPerMl × (sweatVolumeMl / dtMin)` 结算、体温钳位 `[25, 45] °C`；`skin.sweat.ts` 改为加性热出汗 `heatGain = 5 mL/(min·°C)` 与总上限 `15 mL/min`；`lungsVentilation` 改为 `inspiredO2Fraction = 0.058333` 与 `pantingGain = 1500 mL/(min·°C)`。
- **已验证：** `thermoregulation`、`skin`、`lungsVentilation` 单元测试与 `test/organs.thermoregulation-gateway.test.mjs`、`test/organs.steady-state-24h.test.mjs` 通过（24h 静息稳态核心温度 `36.999998–37.000000 °C`，30 min 满强运动峰值 `38.27 °C`、90 min 回落至 `37.05 °C`）。
- **仍未实现/未验证：** 实测体温曲线、皮肤分区温度、血管舒缩、寒战做功细节、发热/低温症、湿度/风速、真实 DSH 会话、临床验证与性能基线。
