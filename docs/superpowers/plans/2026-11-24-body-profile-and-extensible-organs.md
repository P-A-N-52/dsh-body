# 个体档案参数覆盖、统一体格基线与可扩展器官规范实施计划

> **状态说明**：本页记录 2026-11-24 约定的两阶段合批升级计划与设计边界；全部代码、文档与新增/回归测试已实现并纳入工作区，最终验收结论以当前工作区 `npm test` 实测为准。

**目标：**
1. **不同身体不同参数（只写差异）**：在每具身体自己的 `body-state.json` 顶层支持可选的 `profile: { weightKg, heightCm }` 与稀疏 `parameters: { [paramId]: number }` 差异覆盖，按“停机修改 → 重启生效”模式在 `BodyWorker` 启动加载参数时合并生效，不改动无关器官脚本。
2. **统一身高/体重物理底座**：在保持默认 `75 kg / 170 cm` 与现有行为逐点一致的前提下，把分散在核心隔室与代谢器官中的 `75 kg` / `30000 mL` / `5000 mL` / `250 mL/min` 等参考基准收口到统一体格缩放（同时保持静息 `37 °C` 热平衡与 `90 mg/dL` 空腹血糖稳态）；显式写在 `parameters` 里的个体覆盖值优先于体格自动缩放。
3. **新器官（如翅膀、尾巴）即插即用**：
   - 在 `interoception` 与 `brainNotify` 中支持任意器官通过通用协议字段上报 `discomfortMm` 与 `sensations`（按 2 档 `context` 注入不唤醒 / 3 档 `wake` 唤醒投递，且通知文本严格只含定性感觉、不含数值）；
   - 在 `tools.js` 中让 `body_act` 根据 `gateway.getCapabilities()` 动态放行新器官声明的 `actionTypes`，同时保留内置 7 类动作的严格校验；
   - 在 `CONTRIBUTING.md` 与 `docs/gateway-and-scripts.md` 补齐“新器官编写规范”。

**非目标：**
- 不挂载 `parathyroid` / `bloodCalcium`（保持未挂载）；
- 不建长期能量账本与脂肪/体重动态增减（体重与差异参数均为停机修改、重启生效）；
- 不破坏现有 `body-modules*.json` 的 `38 / 41 / 40` 脚本数、`44` 份参数文件数、以及既有 15/17 部位硬 `transfer` 闭包与测试契约。

---

## Step 1: 存档格式与参数注入通道（Gateway + `lib/parameters.js`）

**Files:**
- Modify: `gateway/checkpoint.js`
- Modify: `gateway/runner.js`
- Modify: `gateway/body-worker.js`
- Modify: `gateway.js`
- Modify: `lib/parameters.js`

**Design:**
1. **`body-state.json` 顶层扩展字段**（均为可选，缺省时无缝兼容旧 v2/v1 存档）：
   - `profile`（可选对象）：`{ weightKg?: number, heightCm?: number }`，缺省或未指定项分别按 `75` kg、`170` cm；若给出则校验为正有限数字。
   - `parameters`（可选对象）：稀疏覆盖字典 `{ [parameterId]: number }`，仅保存与 `*.parameters.json` 默认值不同的参数；校验每个值为有限数字（与 `null` 的 `unset` 一样，覆盖数值必须有限；未知或未加载器官的参数键容错保留，不因清单精简破坏旧存档）。
2. **启动参数注入顺序**：
   - `gateway.js` 的 `boot()` 先 `store.load()`，从 `saved` 解析并校验 `{ profile, parameters }`；
   - `runner.describe(bodyConfig)` 在首次拉起 `Worker` 时将 `{ scripts, profile, parameters }` 传给 `workerData`；
   - `body-worker.js` 在 `describeModules()` 导入任何器官模块前，调用 `lib/parameters.js` 的 `setWorkerParameterConfig({ profile, parameters })`（或等效上下文设置函数）；
   - `loadParameters(parametersUrl)` 先读取并校验同目录 `*.parameters.json`，再对当前激活的 `overrides` 执行同 key 覆盖；
   - 暴露 `getBodyProfile()` 与 `hasParameterOverride(id)` 给体格缩放部位使用，同时保持主线程单元测试无副作用。

## Step 2: 统一 `profile.weightKg` 体型缩放（保持 `75 kg` 默认逐点一致）

**Files:**
- Modify: `organs/human-compartments/glucose/glucose-core.ts`
- Modify: `organs/human-organs/kidney/glucose-excretion.ts`
- Modify: `organs/human-compartments/body-water/water-core.ts`
- Modify: `organs/human-compartments/blood/blood.ts`
- Modify: `organs/human-organs/heart/heart.ts`
- Modify: `organs/human-compartments/blood-oxygen/oxygen.ts`
- Modify: `organs/human-organs/brain/thermoregulation.ts`
- Modify: `organs/human-organs/lungs/ventilation.ts`
- Modify: `organs/human-organs/liver/glycogen.ts`
- Modify: `organs/human-organs/kidney/gluconeogenesis.ts`
- Modify: `organs/human-organs/skeletal-muscle/regions/region-core.ts`
- Modify: `organs/human-organs/brain/hypothalamus-adh.ts`
- Modify: `organs/human-organs/kidney/urine-production.ts`

**Design (`massScale = profile.weightKg / 75`, 仅 `design` 工程标度):**
- 规则：**若 `parameters` 显式覆盖了某个参数（如 `bodyFluid.referenceVolumeMl`），以显式覆盖为准；否则该参考量按 `massScale` 同步缩放**（`75 kg` 时 `massScale === 1`，全部输出与现有 988 条测试逐点完全一致）。
- 糖稳态联动：`glucose`（`referenceBodyMassKg`、`basalConsumptionGPerMin`）、`kidneyGlucose`（`referenceBodyMassKg`）、`liver`（`initialGlycogenG`、`glycogenCapacityG`、`basalOutputRateGPerMin`、`maxOutputRateGPerMin`、`maxUptakeRateGPerMin`）、`kidneyGluconeogenesis`（`basalOutputRateGPerMin`、`maxOutputRateGPerMin`、`maxOutputPerRoundG`）、`muscleRegions`（`INITIAL_TOTAL_GLYCOGEN_G`、`glycogenUseRateGPerMin`）同步按 `massScale` 缩放，保证任意体重下空腹仍维持 `90.0 mg/dL` 平衡。
- 体液与循环联动：`bodyFluid`（`referenceVolumeMl`、`deficitScaleMl`）、`blood`（`referenceBloodVolumeMl`、`bloodVolumeRange`、`baselineGfrMlMin`、`referenceCardiacOutputMlMin` 以及以 `bodyFluid.referenceVolumeMl` 派生替代硬编码 `30000`）、`heart`（`restingStrokeVolumeMl` 未被显式覆盖时按 `massScale` 缩放，连带 `strokeVolumeRange` `[30 * massScale, 140 * massScale]` 与 `referenceBloodVolumeMl = 5000 * massScale`）、`hypothalamusAdh`（`5000 * massScale`）、`kidney`（`BASELINE_GFR_ML_MIN = 100 * massScale`），保证任意健康体重静息血压 `120/80`、前负荷与 GFR 因子为 `1.0`。
- 耗氧、通气与热平衡联动：`bloodOxygen`（`basalMlMin`、`activityGainMlMin`）、`lungsVentilation`（`fallbackBasalDemandMlMin`、`restingTidalVolumeMl`、`restingVentilationMlMin`、`maxVentilationMlMin`、`pantingGain`）、`thermoregulation`（`fallbackBasalOxygenConsumptionMlMin`、`lossGain`、`heatCapacityKcalPerC`、`shiveringGain`）按 `massScale` 同步缩放，保证任意体重静息产热与散热精确持平于 `37.0 °C`。

## Step 3: 可扩展器官感受汇聚（无数值 `context`/`wake`）与动态 `body_act`

**Files:**
- Modify: `organs/human-organs/brain/interoception.ts`
- Modify: `organs/human-organs/brain/notify.ts`
- Modify: `tools.js`

**Design:**
1. **通用器官感受上报字段约定**（JSON-safe，可选导出）：
   - `discomfortMm?: number`（0–100）：贡献到 `interoception.discomfort`；
   - `sensations?: Record<string, { intensityMm: number; discomfort?: boolean; contextText?: string; wakeText?: string }>`：
     - `intensityMm` 为 `0–100` 有限数字，仅作内部档位/不适计算，**严禁写入任何通知文本**；
     - `contextText`（2 档 `marked`，不唤醒）与 `wakeText`（3 档 `strong`，唤醒）须为非空定性感受文本；缺省时回退到无数字通用不适文案（`'身体感受：出现明显的异样感受。'` / `'身体感受：出现强烈的异样感受。'`）。
2. **`interoception.ts`**：
   - 保留原有 16 个字段和 7 路 `discomfort` 不动；
   - 通过 `io.read()?.parts` 扫描其他部位（跳过 `interoception` 自身），合并 `part.discomfortMm` 与 `sensations[k].discomfort === true` 到 `discomfort`；
   - 仅当至少存在 1 条扩展 `sensations` 时，在 `io.write` 中附带 `sensations` 汇总字典（无扩展感受时不写出该键，100% 兼容现有 `deepEqual` 断言）。
3. **`notify.ts`**：
   - 保留原有 4 路 `levels`（`{ hunger, fullness, urinary, thirst }`）结构不变；
   - 读取 `interoception.sensations`，用可选 `session.sensationLevels`（仅非空时保存）按相同的 `marked`/`strong`/`resetBelow`、冷却、小时/天配额与 `suppressNotifications` 规则进行滞回门控；
   - 同档优先级仍以内置 4 路 `SIGNAL_ORDER` 优先，其次按排序后的扩展键选择；投递时仅发纯感觉文案，`mode` 为 `level >= wakeAtLevel ? 'wake' : 'context'`。
4. **`tools.js` (`body_act`)**：
   - 保留内置 7 种动作的严格校验；
   - 若 `gateway.getCapabilities` 存在，读取其声明的所有动作名并合并进 `body_act.parameters.properties.type.enum`，允许声明过的扩展动作（如 `fold_wings`、`wag_tail`）免修改直接转发给 `gateway.submitAction(payload)`；未声明动作仍返回 `400`。

## Step 4: 测试、新器官开发规范文档与全量验收

**Files:**
- Modify / Add tests: `test/gateway.checkpoint.test.mjs`, `test/parameters.test.mjs`, `test/organs.interoception.test.mjs`, `test/organs.brain-notify.test.mjs`, `test/dsh.tools.test.mjs` (or dedicated gateway tests for body profile scaling & extensible wing/tail organ)
- Modify docs: `CONTRIBUTING.md`, `docs/gateway-and-scripts.md`, `docs/superpowers/plans/2026-11-24-audit-and-p0-modeling-checklist.md` (marking plan items)
- Verify: `npm test` & `git diff --check`
