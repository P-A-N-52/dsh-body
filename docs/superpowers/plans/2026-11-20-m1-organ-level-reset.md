# M1 器官级重置实施计划

> **已废弃（2026-11-20）：** 本计划的系统分层与脚本路径不再适用；器官级设计见 [`2026-11-20-organ-model-design.md`](../specs/2026-11-20-organ-model-design.md)，P0 实施见 [`2026-11-20-organ-model-p0.md`](./2026-11-20-organ-model-p0.md)。

> 正文中的链接仍指向已删除的旧目录，仅作历史记录，不再维护。

**状态：待执行确认。** Gateway 操作层决策已并入：`fields` 由模块导出、所有模块必须声明、启动拒绝、运行 fatal。`set` 由现有 `io.write(完整 part)` 承担，只新增 `add` 与 `transfer`。确认后从 Task 0 开始拆 mission。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 Gateway 运行时的前提下，把仿真层重置为器官/功能单元级，删除 component / actions / readouts 契约层，重建五个部位脚本、参数、清单、重放与测试。

**Architecture:** Gateway 继续管时钟、动作队列、整轮提交和存档，除 Task 0 的操作层外不改。每个器官或可分离的功能一个 ESM 模块；模块自述 `id`、`actionTypes`、`initialState`、`fields`，参数从同目录 `*.parameters.json` 经 `systems/lib/parameters.js` 只读加载。部位与信号写进各系统 README 的表格，不再用 JSON 契约。重放用真实 Gateway 手动 tick，按轮末已提交值对照论文。

**Tech Stack:** Node ≥22.18、ESM、可擦除 TypeScript、`node:test`、无第三方依赖。

**Spec:** `docs/virtual-body.md` §6 的 M1；本文件第 1–2 节是本次重置后的事实来源。

## Global Constraints

- 一轮 = 60 仿真秒。用 `io.dt`，不写 `60`，不用 `Date.now()` 猜时间。
- 单写者：模块只写自己的部位，别处只读；不替别的器官算输出，也不替它下结论。
- 状态必须 JSON-safe：有限数字、普通对象/数组/字符串/布尔/`null`；空胃不得出现 `NaN`。
- 可调参数进 `*.parameters.json`，保留 `unit`、`status`、`source`、`range`；`unset` 的值必须是 `null`；`prior` / `fitted_dev` / `validated` 必须有已登记 `source`。
- 代理量在字段说明里写明“代理”；不跨量纲换算；缺失值不用 0 代替。
- Gateway 只加操作层：`fields` 声明、`add`、`transfer`、启动校验与 fatal 策略；时钟、存档、动作队列和整轮提交语义不变。

## Review Focus

1. **空胃首轮**：`volumeMl=0`、`energyKcal=0` 时不能出现 `0/0` 或 `0×NaN`，整轮必须能通过 JSON-safe。
2. **5 分钟餐与 bolus**：`durationMin>0` 要按轮分摊且总量不漂移；`durationMin=0` 是单轮。
3. **同一轮多笔摄入**：不能因为合并账本而丢总量、拉平时间分布或让 `meal` 永不结束。
4. **参数 unset**：必需参数缺失时启动即报错并指出参数 ID，不静默用 0 或默认值。
5. **重放时点**：取轮末已提交值；餐毕 0 min 对齐到最后一个入胃切片所在轮的轮末，不能声称与论文时点完全对齐。

---

## 0. 保留 / 删除 / 新建

**保留，除 Gateway 操作层外不改：**

- `gateway/`、`gateway.js`、`json-safe.js`、`index.js`、`startup/reset-parts.js`、`cordis.patch.yml`、`package.json` 的运行时字段。Task 0 只在 Gateway 增加 `fields` 校验、`add`、`transfer` 与 fatal 策略，不改时钟、存档、动作队列和整轮提交语义。
- `test/gateway.*.test.mjs`、`test-support/harness.mjs`、`test-support/models.mjs`。
- `systems/lib/parameters.js`。
- `systems/**/references/`（证据台账与逐篇笔记）。
- `systems/**/*.parameters.json`（参数值仍有效，Task 4 只改三个增益）。
- `systems/digestive/stomach.ts`、`systems/digestive/duodenum.ts`（M2 分支 `dcb6a4f`，独立 review clean；Task 3 只改账本，不重写方程）。
- `scenarios/*.json`（作为重放输入；不再有契约测试校验）。
- `docs/gateway-and-scripts.md` 的 Gateway 部分。

**删除：**

- `systems/digestive/stomach.component.json`
- `systems/digestive/duodenum.component.json`
- `systems/digestive/stomach.actions.json`
- `systems/endocrine/ghrelin.component.json`
- `systems/sensory/gastric-sensory.component.json`
- `systems/nervous/interoception.component.json`
- `systems/nervous/readouts.json`
- `test/model.contracts.test.mjs`

**新建：**

- `gateway/operations.js`、`test/gateway.operations.test.mjs`（Task 0）
- `systems/endocrine/ghrelin.ts`
- `systems/sensory/gastric-sensory.ts`
- `systems/nervous/interoception.ts`
- `tools/m1-replay.mjs`
- `test/parameters.test.mjs`、`test/m1.modules.test.mjs`、`test/m1.chain.test.mjs`
- `test-support/module-io.mjs`、`test-support/m1-harness.mjs`

**标记废弃、不删：**

- `docs/superpowers/plans/2026-11-20-tissue-fidelity-m1.md`
- `docs/superpowers/plans/2026-11-20-m1-scope.md`

两篇顶部各加一行“已废弃，见 `2026-11-20-m1-organ-level-reset.md`”，保留证据链和旧链接。

**Tower 前置：** M2 已 review clean（`dcb6a4f`），由 tower 合并；M3、M4 放弃，分支保留为历史。本计划从合并 M2 后的 main 起 worktree。

## 1. 器官级分工

| 模块 / 部位 | 器官或功能 | 写入的公有信号 | 只读 |
| --- | --- | --- | --- |
| `stomach` | 胃：容纳、混匀、排空 | `volumeMl`、`energyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt` | 本轮动作 |
| `duodenum` | 十二指肠：感受到达的营养 | `nutrientExposure` | `stomach.emptiedKcal` |
| `ghrelin` | 胃内分泌功能：饥饿素相对变化 | `relativeConcentration` | `stomach.lastIntakeAt` |
| `gastricSensory` | 胃壁机械感受末梢：牵张转导 | `mechanical` | `stomach.volumeMl` |
| `interoception` | 神经系统：整合与读出 | `hunger`、`fullness`、`discomfortFullness` | 以上四个信号 |

边界：这是**集总器官模型**，不声称模拟黏膜、肌层、肠神经或单个神经元。神经没有特权通道；它和其他模块一样只读轮初快照、只写自己的部位；通报就是写自己的 JSON。

## 2. 冻结模型

**胃排空。** 先定义 `energyDensity = volumeMl > 0 ? energyKcal / volumeMl : 0`；`h = halfTimeMin + energyDensityGainMinPerKcalPerMl × energyDensity`；`out = volumeMl > 0 ? max(0, volumeMl − baselineMl) × (1 − 2^(−dtMin/h)) : 0`；`emptiedKcal = out × energyDensity`。先排空，再加本轮摄入切片。`volumeMl=0` 时全部归零，不出现 `NaN`。

**摄入分摊。** 动作在生效轮进入 `io.actions`。`durationMin=0` 是单轮 bolus；`durationMin>0` 时 `rounds = ceil(durationMin × 60 / io.dt)`，每轮加 `volumeMl/rounds` 与 `energyKcal/rounds`，最后一份取余数，剩余量存私有 `state.mealQueue`。`eat.volumeMl<=0` 且 `energyKcal>0` 整条忽略。

**十二指肠。** `Q = stomach.emptiedKcal / dtMin`（kcal/min）；`N_next = N + (1 − exp(−dtMin/τ)) × (Q − N)`，`τ=10 min`。`N` 是营养暴露代理，不是吸收量。

**饥饿素。** `t = io.simulatedSeconds − stomach.lastIntakeAt`；无进食时 `G = baseline`；否则 `G = nadir + (baseline − nadir) × (1 − 2^(−t_min/recoveryHalfTime))`。餐后抑制加指数恢复，不模拟餐前上升。

**胃壁牵张。** `mechanical = clamp(max(0, volumeMl) / referenceVolumeMl, 0, 1) ^ exponent`，是代理，不是张力实测。

**体感。**
`fullness = clamp(0 + 100 × mechanical, 0, 100)`；`fullness.ghrelinGain` 与 `fullness.nutrientGain` 必须为 0。
`hunger = clamp(50 − 20 × mechanical + 50 × (relativeConcentration − 1), 0, 100)`；`hunger.nutrientGain` 必须为 0。
`discomfortFullness`：`threshold` 或 `slope` 为 `null` 时输出 `null`。

## 3. 任务

### Task 0: Gateway 操作层（fields / add / transfer）

**Files:**
- Create: `gateway/operations.js`、`test/gateway.operations.test.mjs`
- Modify: `gateway/body-worker.js`、`gateway/simulation.js`、`test-support/models.mjs`
- Test: `test/gateway.operations.test.mjs`

**Interfaces:**
- Consumes: 模块导出 `id`、`initialState`、`heartbeat`、`fields`。
- Produces: `io.add(partId, field, delta)`、`io.transfer(fromPart, fromField, toPart, toField, amount)`；`io.write(wholePart)` 保持为 owner 的绝对写入。

`fields` 形状：

```js
export const fields = {
  glucoseMmol: { unit: 'mmol/L', mode: 'additive', contributors: ['liver', 'muscle'] },
  volumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['duodenum.contentMl'] },
  contentMl: { unit: 'mL', mode: 'absolute', transferIn: ['stomach.volumeMl'] },
};
```

规则：每个模块必须导出 `fields`；每个 key 必须存在于 `initialState`；`mode` 只能是 `absolute` 或 `additive`；`additive` 必须有 `contributors`；`transferOut` 与 `transferIn` 必须成对、单位相同；`absolute` 字段不能 `add`。

- [ ] **Step 1: 写失败的 Gateway 测试**

用两个玩具模块（`pool` 拥有 `amount`，`source`/`sink` 贡献）覆盖：
1. `add` 汇总：1.0 + 0.5 − 0.3 = 1.2。
2. `transfer`：源 300 转 200 → 源 100、目标 200。
3. 源不足：源 100 转 200 → 整轮 fatal，不提交。
4. 单位不符：mL 转 kcal → 启动拒绝。
5. 越权 `add`：调用者不在 `contributors` → fatal。
6. 缺少 `fields` 导出 → 启动拒绝。
7. 同轮 `write` + `transfer`：write 先应用，transfer 再扣；源 300 写 300 再转 200 → 100。
8. 两个 `add` 交换模块顺序 → 结果相同。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/gateway.operations.test.mjs`
Expected: FAIL，`fields` 未校验、`io.add`/`io.transfer` 不存在。

- [ ] **Step 3: 在 `gateway/body-worker.js` 校验 `fields`**

模块加载时检查上述规则；失败时抛带模块 id 与字段名的错误，Gateway 拒绝启动。

- [ ] **Step 4: 实现操作收集与应用**

`io.add`/`io.transfer` 只收集请求，不立即改状态。提交时按 `write → add → transfer` 顺序应用：write 组装各部位；add 按字段求和后加到 write 后的值；transfer 按字段对求和，检查源足够后从源减、向目标加。单位不一致、越权、源不足都标 fatal。

- [ ] **Step 5: fatal 策略**

操作校验错误不进入“同批次重试”，而是记录 fatal，停止调度，`/health` 显示失败模块、字段和操作；超时与临时异常仍按原逻辑重试。

- [ ] **Step 6: 更新玩具模块**

`test-support/models.mjs` 的每个模块补 `fields`（可为空对象，但导出必须存在）；`test/gateway.*` 现有测试保持通过。

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS，包含新增的 8 个用例。

- [ ] **Step 8: 提交**

```bash
git add gateway test test-support
git commit -m "feat: Gateway 增加 fields 声明与 add/transfer 操作"
```

### Task 1: 删除旧契约层，补参数测试

**Files:**
- Create: `test/parameters.test.mjs`
- Delete: 7 个 JSON 契约与 `test/model.contracts.test.mjs`
- Test: `test/parameters.test.mjs`

**Interfaces:**
- Consumes: `loadParameters(parametersUrl)`、`requireParameter(values, id)`（`systems/lib/parameters.js`）。
- Produces: 无新接口；后续任务只依赖 `*.parameters.json` 与 loader。

- [ ] **Step 1: 写参数测试**

覆盖五份参数文件：`schemaVersion === 1`；每个 `id` 以 `owner.` 开头且不重复；`status==='unset'` 与 `value===null` 一一对应；`prior`/`fitted_dev`/`validated` 有 `source`；`requireParameter` 对缺失 ID 抛出包含该 ID 的错误。

- [ ] **Step 2: 跑测试确认通过**

Run: `node --test test/parameters.test.mjs`
Expected: PASS（loader 已存在）。

- [ ] **Step 3: 删除契约文件**

删除第 0 节列出的 7 个 JSON 与 `test/model.contracts.test.mjs`。

- [ ] **Step 4: 跑全量测试**

Run: `npm test`
Expected: 全部 PASS，0 fail。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 删除 M1 组件契约层，保留参数与场景"
```

### Task 2: 器官级文档

**Files:**
- Modify: `docs/virtual-body.md`（§6 M1）
- Modify: `AGENTS.md`（§0、§4、§7 中指向 component / actions / readouts / contract test 的段落）
- Modify: `docs/gateway-and-scripts.md`（参数小节保留，删除“组件 JSON”表述）
- Modify: `systems/digestive/README.md`、`systems/endocrine/README.md`、`systems/sensory/README.md`、`systems/nervous/README.md`
- Modify: `docs/superpowers/plans/2026-11-20-tissue-fidelity-m1.md`、`docs/superpowers/plans/2026-11-20-m1-scope.md`（顶部加废弃行）
- Modify: `systems/digestive/references/m1-data-dictionary.md`（状态行改为指向本计划）

**Interfaces:**
- Produces: 每个系统 README 一张“M1 部位 / 信号 / 单位 / 读写”表；神经系统 README 额外列出三个量表的端点、方向、缺失语义。

- [ ] **Step 1: 改 `docs/virtual-body.md` §6**

M1 行改为器官级：Gateway 加载五个模块；胃与十二指肠管内容量/排空/营养暴露；内分泌管饥饿素；感觉器管机械牵张；神经整合并写读数。删除“组织层面”与“逐组织拆分”的措辞。

- [ ] **Step 2: 四份系统 README 加表**

每张表列：模块 id、器官/功能、写入信号（单位、类别）、读取信号、参数文件。神经 README 另列 `hunger`（0–100 mm）、`fullness`（0–100 mm）、`discomfortFullness`（0–10，仅餐后，未标定输出 `null`）。

- [ ] **Step 3: 清理 `AGENTS.md` 与 Gateway 指南**

删除“组件 JSON / actions JSON / readouts JSON / `test/model.contracts.test.mjs` 覆盖契约”的描述；改为“模块 + `*.parameters.json` + README 表”。保留参数只读通道与单写者说明。

- [ ] **Step 4: 两篇旧计划加废弃行**

各在标题下加：`> **已废弃：** 见 [2026-11-20-m1-organ-level-reset.md](./2026-11-20-m1-organ-level-reset.md)。`

- [ ] **Step 5: 检查与提交**

Run: `git diff --check`
Expected: 无空白错误；相对链接存在。

```bash
git add -A
git commit -m "docs: M1 改为器官/功能单元级"
```

### Task 3: 胃与十二指肠模块（保留 M2 方程，修账本）

**Files:**
- Modify: `systems/digestive/stomach.ts`、`systems/digestive/duodenum.ts`（从 M2 的 `dcb6a4f` 起）
- Create: `test-support/module-io.mjs`
- Create: `test/m1.modules.test.mjs`
- Test: `test/m1.modules.test.mjs`

**Interfaces:**
- Consumes: `loadParameters`、`requireParameter`；`stomach.parameters.json`（13、0、53.75）；`duodenum.parameters.json`（10）。
- Produces: `stomach` 写 `volumeMl/energyKcal/emptiedMl/emptiedKcal/lastIntakeAt`；`duodenum` 写 `nutrientExposure`。

- [ ] **Step 1: 写模块测试**

`test-support/module-io.mjs` 导出 `runModule(module, { parts, actions, simulatedSeconds, dt })`，用内存 `io` 调用一次 `heartbeat` 并返回写回的部位。

测试断言：
1. 空胃一轮后 `volumeMl/energyKcal/emptiedMl/emptiedKcal` 全为 0，`lastIntakeAt` 为 `null`。
2. 喝水 240 mL 后第一轮 `out=0`、`volumeMl=240`；第二轮 `out≈12.461397`、`volumeMl≈227.538603`。
3. 237 mL / 355 kcal / `durationMin=5` 跑满 5 轮后账本为空，且 `volumeMl + Σ emptiedMl = 237`、`energyKcal + Σ emptiedKcal = 355`。
4. `eat` 体积 0、能量 355 被整条忽略，状态不变。
5. `duodenum` 在 `stomach.emptiedKcal=2.59` 时一轮后 `nutrientExposure≈0.2465`（τ=10）。
6. 同一轮提交 `drink 100 mL, durationMin=2` 与 `eat 500 mL/500 kcal, durationMin=10`：两条各自在第 2、10 轮结束；600 mL / 500 kcal 全部交付；中途不出现“体积已完、能量未完”的单账本错位。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/m1.modules.test.mjs`
Expected: 用例 1–5 PASS（M2 已有实现）；用例 6 FAIL，因为当前是单账本合并。

- [ ] **Step 3: 把单账本改成队列**

`state.meal` 改为 `state.mealQueue` 数组，每个元素保存 `{ remainingMl, remainingKcal, rateMlPerRound, rateKcalPerRound, remainingRounds, mealKind }`。每轮按到达顺序逐条推进，各自用各自的速率与剩余轮数，完成后从队列移除；不合并成 `mixed`。胃排空方程、能量密度守卫、空胃归零不变。

两个模块都按 Task 0 的规范导出 `fields`：stomach 的五个公有信号、duodenum 的 `nutrientExposure`，全部 `absolute`；M1 不声明 transfer 对。

- [ ] **Step 4: 十二指肠不变**

只读 `stomach.emptiedKcal`；缺失或非正时 `Q=0`；只写 `nutrientExposure`。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/m1.modules.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add systems/digestive test-support/module-io.mjs test/m1.modules.test.mjs
git commit -m "refactor: 胃摄入账本改为队列，保留 M2 排空方程"
```

### Task 4: 饥饿素、机械感觉与体感

**Files:**
- Create: `systems/endocrine/ghrelin.ts`、`systems/sensory/gastric-sensory.ts`、`systems/nervous/interoception.ts`
- Modify: `systems/nervous/interoception.parameters.json`（三个增益改 0）
- Modify: `test/m1.modules.test.mjs`
- Test: `test/m1.modules.test.mjs`

**Interfaces:**
- Consumes: `stomach.lastIntakeAt`、`stomach.volumeMl`、`gastricSensory.mechanical`、`duodenum.nutrientExposure`、`ghrelin.relativeConcentration`。
- Produces: `ghrelin.relativeConcentration`；`gastricSensory.mechanical`；`interoception.hunger/fullness/discomfortFullness`。

- [ ] **Step 1: 写失败的模块测试**

1. 饥饿素：无进食 `G=1`；餐毕 `G=0.5`；餐后 90 min `G=0.75`。
2. 机械：`volumeMl=500`、参考量 1000、指数 1 时 `mechanical=0.5`。
3. 体感：`mechanical=1`、`relativeConcentration=0.5`、`nutrientExposure=10` 时 `fullness=100`（ghrelin/nutrient 增益为 0）、`hunger=5`（50−20−25）、`discomfortFullness=null`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/m1.modules.test.mjs`
Expected: FAIL，模块文件不存在。

- [ ] **Step 3: 实现三个模块**

按第 2 节方程；参数全部从各自 `*.parameters.json` 读取；体感输出四舍五入到 0.1；`threshold` 或 `slope` 为 `null` 时 `discomfortFullness=null`。三个模块都按 Task 0 的规范导出 `fields`，全部 `absolute`：ghrelin 的 `relativeConcentration`、gastricSensory 的 `mechanical`、interoception 的三个读出。

- [ ] **Step 4: 把三项增益改为 0**

`fullness.ghrelinGain`、`fullness.nutrientGain`、`hunger.nutrientGain` 改为 `0`，`status` 保持 `design`，`note` 写“M1 冻结期不启用；启用只改此值”。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add systems/endocrine systems/sensory systems/nervous test/m1.modules.test.mjs
git commit -m "feat: 器官级饥饿素、机械感觉与体感读出"
```

### Task 5: 清单、重放与全链测试

**Files:**
- Modify: `body-modules.json`（按 `stomach`、`duodenum`、`gastricSensory`、`ghrelin`、`interoception` 顺序列五个路径）
- Modify: `package.json`（`files` 加入 `systems/` 与 `tools/`）
- Create: `test-support/m1-harness.mjs`、`tools/m1-replay.mjs`、`test/m1.chain.test.mjs`
- Test: `test/m1.chain.test.mjs`

**Interfaces:**
- Consumes: 五个模块与 `scenarios/*.json`。
- Produces: `launchM1(t, { scripts })`，用绝对路径清单启动真实 Gateway（`autoTick:false`、端口 0、临时存档）；`node tools/m1-replay.mjs --scenario <path>` 打印每个观察时点的仿真值、期望值与偏差。

- [ ] **Step 1: 写全链测试**

用 `launchM1` 起真实 Gateway：
1. 首轮空胃 `GET /state` 五个部位全部有限数，体感 `fullness=0`、`hunger=50`、`discomfortFullness=null`。
2. `POST /actions` 喝水 240 mL，`tick()` 两次，断言第一轮 `out=0`、第二轮 `out≈12.461`；同 ID 同载荷重试不重复入账。
3. `POST /actions` 237 mL / 355 kcal / 5 min，跑 5 轮后 `meal===null`，体积与能量守恒。
4. 重放 `scenarios/m1-water-240.json`：13 min 时胃水约为初始 275 mL 的一半（±10%）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/m1.chain.test.mjs`
Expected: FAIL，`launchM1` 或清单不存在。

- [ ] **Step 3: 接线并实现工具**

清单按顺序列五条路径；`package.json` 的 `files` 加 `systems/`、`tools/`；`launchM1` 写临时清单，`scripts` 用 `resolve()` 后的绝对路径；重放工具按 `atMin` 提交、`tick()`、读 `GET /state`，报告轮末采样的一轮偏移。

- [ ] **Step 4: 跑测试与重放**

Run: `node --test test/m1.chain.test.mjs`
Expected: PASS。

Run: `node tools/m1-replay.mjs --scenario scenarios/m1-water-240.json`
Expected: 打印 T50 约 13 min 的对照，不报错。

Run: `node tools/m1-replay.mjs --scenario scenarios/m1-liquid-meal-levine-355.json`
Expected: 打印餐毕/45/60 min 的仿真值、Levine 观测值与偏差；不为了让曲线更像而调参数。

- [ ] **Step 5: 提交**

```bash
git add body-modules.json package.json tools test test-support
git commit -m "feat: 接入五个器官模块、重放工具与全链测试"
```

## 4. 文档变更清单

| 文档 | 改什么 | 为什么 |
| --- | --- | --- |
| `docs/virtual-body.md` | §6 M1 改为器官/功能单元级，删除组织拆分措辞 | 与实现一致 |
| `AGENTS.md` | §0/§4/§7 删除 component / actions / readouts / contract test 的描述 | 否则指向已删文件 |
| `docs/gateway-and-scripts.md` | 参数小节保留；删除组件 JSON 表述 | 与实现一致 |
| `systems/digestive/README.md` | 胃、十二指肠的部位/信号/动作表 | 替代 component / actions JSON |
| `systems/endocrine/README.md` | 饥饿素表 | 替代 component JSON |
| `systems/sensory/README.md` | 机械感觉表 | 替代 component JSON |
| `systems/nervous/README.md` | 体感表与三个量表 | 替代 component / readouts JSON |
| `systems/digestive/references/m1-data-dictionary.md` | 状态行指向本计划 | 旧计划已废弃 |
| `docs/superpowers/plans/2026-11-20-tissue-fidelity-m1.md` | 顶部加“已废弃” | 保留证据链 |
| `docs/superpowers/plans/2026-11-20-m1-scope.md` | 顶部加“已废弃” | 保留证据链 |

## 5. 验收

- `npm test` 全绿，包含 gateway 既有测试、Task 0 的操作层测试、参数测试、模块测试、全链测试。
- 五个模块都导出 `fields`；缺 `fields` 的模块在启动时被拒绝；`add`/`transfer` 的越权、单位不符、源不足都按 fatal 处理。
- `node tools/m1-replay.mjs --scenario scenarios/m1-water-240.json` 输出 T50 对照，且明确写出“一轮 = 60 s、取轮末值、0 min 有一轮偏移”。
- `node tools/m1-replay.mjs --scenario scenarios/m1-liquid-meal-levine-355.json` 输出三个时点的偏差；报告写明这是开发对照，不是独立验证。
- `GET /capabilities` 列出 `drink`/`eat` → `stomach`；`GET /state` 五个部位齐全；首轮空胃无 `NaN`。
- Gateway 只加操作层；现有 56 项 gateway 测试保持通过（玩具模块补 `fields` 后）。

## 6. 不做

- 不拆黏膜、肌层、肠神经等组织级结构；不模拟单个神经元或放电频率。
- 不做固餐排空标定、肠道吸收、血糖、胰岛素（M2 之后）。
- 不给 `discomfortFullness` 设阈值；没有健康人逐时数据就保持 `null`。
- 不做会话绑定、通知自动投递、多身体路由。
- 不合并旧的 M2/M3/M4 分支；它们只作为历史。
- 不做 `provides` / `replaces` 职责声明；一个过程一个模型，靠文档与评审约定。
