# 分区骨骼肌（头 / 躯干 / 四肢）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单一 `muscleGlucose` 的糖原拆成 `muscleHead` / `muscleTrunk` / `muscleLimbs` 三个可独立加载的区域部位，`muscleGlucose` 保留为聚合分配器；独臂类缺失区域用变体清单实现，旧档按份额迁移。

**Architecture:** `muscleGlucose` 接收 `glucose` 摄糖结算后按份额（头 0.05 / 躯干 0.45 / 四肢 0.50）经 transfer 分配给已注册区域；区域各自持有糖原并按轮初活动消耗（沿用现有 `glycogenUseRateGPerMin = 0.5`）。缺失区域的变体只声明存在的出口并按存在区域归一。

**Tech Stack:** Node >=22.18、ESM、本地可擦除 TypeScript、`node:test` + `node:assert`，无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-24-regional-muscle-design.md`

## Global Constraints

- 后台子代理分片修改；本批不 commit、不 push，保留根目录大型传输归档。
- 分片只改自己列出的文件；不改 plan/spec；所有新参数 `design`、`source: null`。
- 区域必须可独立加载/启停，不做子字段、不做 `presets/` 或 condition 字段（沿用 DI 变体先例）。
- 每轮只读轮初快照；`dtMin = io.dt / 60`；`physicalActivity` 未加载消耗 0，非法活动字段抛错使本轮失败。
- 不做肌群疲劳/延迟酸痛、左右小腿与皮肤分区、绝对肌量、MET。
- 状态 JSON-safe；`fields` 每字段声明 `unit` 与 `mode`；文档中文，区分"当前实现 / 未建模 / 未验证"。
- 临时产物只放 `mktemp -d /tmp/dsh-body/<任务>.XXXXXX`。

## Tasks

### Task 1: 聚合器改造（TDD）

**Files:** Modify `organs/human-organs/skeletal-muscle/glucose-uptake.ts`（保留摄糖请求，改为聚合分配）、`test/organs.muscle-glucose.test.mjs`
- [x] Step 1: 失败测试（`uptakeG` 按 0.05/0.45/0.50 分配到三区域；`muscleGlucose` 不再持有 `glycogenG`；`glycogenConsumedG` 移到区域）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现聚合分配（`muscleGlucose.uptakeG.transferOut` 声明三区域，按份额 transfer；保留 `uptakeRequestG` 计算与 `uptakeG` 每轮归 0）。
- [x] Step 4: 运行预期通过。

### Task 2: 三个区域部位（TDD）

**Files:** Create `organs/human-organs/skeletal-muscle/regions/head.ts`、`trunk.ts`、`limbs.ts` 与 `test/organs.muscle-regions.test.mjs`
- [x] Step 1: 失败测试（区域 `uptakeG` 到账入账、按活动消耗并钳到可用量、`physicalActivity` 未加载消耗 0、非法活动抛错、JSON-safe）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现（`uptakeG.transferIn: ['muscleGlucose.uptakeG']`、每轮归 0；`glycogenG`、`glycogenConsumedG` 字段与公式同旧单部位）。
- [x] Step 4: 运行预期通过。

### Task 3: 旧档迁移与独臂变体

**Files:** Modify 迁移逻辑与清单变体（`organs/human-organs/skeletal-muscle/glucose-uptake.ts` 的 initialState/迁移路径、`body-modules*.json` 及变体）
- [x] Step 1: 失败测试（旧档只有总量时按份额分配到区域初值；独臂变体无 `muscleLimbs` 时启动正常且分配归一）。
- [x] Step 2: 运行预期失败。
- [x] Step 3: 实现迁移（旧档总量按 0.05/0.45/0.50 分配，在途 `uptakeG` 保留）与变体出口声明。
- [x] Step 4: 运行预期通过。

### Task 4: 真实 Gateway 与文档

**Files:** Create `test/organs.muscle-regions-gateway.test.mjs`、`organs/human-organs/skeletal-muscle/regions/README.md`；Modify `organs/human-organs/skeletal-muscle/README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`、相关计数测试
- [x] Step 1: 真实 Gateway：餐后各区域糖原按份额上升、运动消耗发生在各区域、总量账与旧单部位一致；独臂变体可用；重启接续。
- [x] Step 2: 文档（区域机制、聚合分配、旧档迁移、独臂变体用法、未建模：疲劳/延迟酸痛/左右分区/绝对肌量/MET）。
- [x] Step 3: `npm test` 与 `git diff --check`。

## 交付记录（2026-11-24）

- **已实现：** `muscleGlucose` 由单一糖原库改为聚合分配器：按 `head 0.05 / trunk 0.45 / limbs 0.50` 把摄糖经 transfer 分配给 `muscleHead` / `muscleTrunk` / `muscleLimbs`（存在区域归一）。`glucose-uptake.no-limbs.ts` 为独臂变体。旧档总量按份额迁移到区域初值，在途 `uptakeG` 保留。当时根清单 32 部位（现 38 部位 / 34 份唯一参数）。
- **P0 修正：** `regions/region-core.ts` 将区域消耗率按份额拆分为 `0.5 × regionShare`（三区合计 `0.5 g/min`，修正原 3 倍总消耗），初始糖原设为 `15 / 135 / 150 g`（合计 `300 g`）；`glucose-uptake-core.ts` 新增运动收缩非胰岛素依赖摄糖 `exerciseUptakeRateGPerMin = 0.15 g/min`。
- **已验证：** 聚合与区域单元 21/21；真实 Gateway（`test/organs.muscle-regions-gateway.test.mjs`）与 `test/organs.steady-state-24h.test.mjs` 通过（`c134fd0` 合入时 `npm test` 772/772，P0 后 967/967）。
- **仍未实现/未验证：** 肌群疲劳/延迟酸痛、左右小腿与皮肤分区、绝对肌量、MET、独立生理数据、真实 DSH 会话、性能基线。
- **工作区：** 与男性生殖、消化反馈合入本地提交 `c134fd0`。
