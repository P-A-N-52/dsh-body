# P1 实施计划：输入契约与体感闭环

**状态：** 已完成（2026-11-21）。验证：`npm test` 109/109；`node tools/replay.mjs scenarios/p1-cola-330.json` 与 `scenarios/m1-water-240.json` 均输出 `actionLagRounds: 1`。

**Spec:** [`2026-11-20-organ-model-design.md`](../specs/2026-11-20-organ-model-design.md) §6、§11。

**Goal:** 让含能量饮料能被输入，并让胃充盈、胃饥饿素、十二指肠营养暴露在 `brain/` 的体感脚本里汇成可读的饥饿/饱满；不新增消化器官，不做通知投递与会话工具。

**Architecture:** 器官目录仍是仿真单元。`stomach/motility.ts` 解析 `drink`/`eat`；`stomach/ghrelin.ts` 消费含能量摄入；新增 `brain/interoception.ts` 只读三个 P0 信号，写 `interoception` 部位。Gateway 不改。

## Global Constraints

- 一轮 = 60 仿真秒；模块读轮初快照；整轮成功才提交。
- 一个部位一个写者；`interoception` 只由 `brain/interoception.ts` 写。
- 参数进 `*.parameters.json`，保留 `unit`/`status`/`source`/`range`；`unset` 的值是 `null`。
- 脚本头部写来源：`source_id`、笔记路径、原文定位、支撑的方程/参数、不能推出的边界。
- 体感是代理，不是实测：`hunger`/`fullness` 是 0–100 的 VAS 代理，不是神经放电或激素浓度。
- 不新增 Gateway 校验层；动作字段非法时模块保持现有的忽略行为，输入语义写进文档。
- 代码改动走 tower mission 或 swarm；纯文档改动直接编辑。

## 非目标

- 不做 `body_act` / `body_state` 会话工具。
- 不做通知投递、会话绑定、提醒历史。
- 不做食管、小肠吸收、血糖、胰岛素、胆囊、胰腺。
- 不做餐食成分（脂肪/蛋白/碳水比例）、黏度、碳酸、甜味剂、温度。
- 不用 Levine 的 VAS 期望值校准新体感模型；那是论文目标，不是本模型的拟合目标。

## Task 1: 输入契约——`drink` 支持含能饮料

**Files:**
- Modify: `organs/human-organs/stomach/motility.ts`
- Modify: `organs/human-organs/stomach/ghrelin.ts`
- Test: `test/organs.motility.test.mjs`
- Test: `test/organs.ghrelin.test.mjs`

**行为：**

- `drink` 仍表示液体摄入；`volumeMl` 必填且 `> 0`，`energyKcal` 可选（有限数、`>= 0`，缺省 0），`durationMin` 可选。`mealKind` 固定 `liquid`。
- `eat` 仍要求 `volumeMl`、`energyKcal >= 0`、`mealKind`（`liquid`/`solid`/`mixed`），`durationMin` 可选。
- `stomach` 对 `drink` 的 `energyKcal` 记账；含能饮料不再被静默当成 0 kcal。
- `stomachGhrelin.actionTypes = ['eat', 'drink']`；任一 `eat`/`drink` 的 `energyKcal > 0` 都抑制，白水和 0 kcal 饮料不抑制。
- 含能饮料的胃排空沿用现有能量密度方程；饮料的黏度、碳酸、甜味剂、成分不建模。

**证据边界：**

- `drink` 的能量记账是输入语义，不是新的生理方程；胃排空证据仍是 Mudie（白水）与 Camps（含能液体奶昔）。
- 饥饿素对含能饮料的抑制方向沿用 Cummings 2001 与 Leone 2022 的含能摄入证据；没有登记饮料专属来源，脚本和 README 标 `design` 假设，不称 `validated`。

**Steps:**

- [x] 在 `motility.ts` 的 `parseIntake` 里解析 `drink.energyKcal`，缺省 0；非法值整条忽略。
- [x] 更新 `motility.ts` 头部注释：`drink` 可以是白水或含能饮料；饮料成分不建模。
- [x] 在 `ghrelin.ts` 里让 `actionTypes` 包含 `drink`，`hasEnergyIntake` 接受 `eat`/`drink`。
- [x] 更新 `ghrelin.ts` 头部注释：饮料方向是从含能餐外推的 `design` 假设。
- [x] 测试：`drink` 330 mL / 140 kcal 计入体积与能量；0 kcal 白水不计能量；负能量/非有限能量被忽略；含能饮料抑制 ghrelin；白水不抑制。
- [x] 跑 `node --test test/organs.motility.test.mjs test/organs.ghrelin.test.mjs`。

## Task 2: 体感脚本 `brain/interoception.ts`

**Files:**
- Create: `organs/human-organs/brain/interoception.ts`
- Create: `organs/human-organs/brain/interoception.parameters.json`
- Create: `organs/human-organs/brain/README.md`
- Test: `test/organs.interoception.test.mjs`
- Modify: `test/parameters.test.mjs`

**部位与字段：**

- 部位 `interoception`，目录 `organs/human-organs/brain/`。
- 字段 `hunger`、`fullness`，单位 `mm`，含义是 0–100 的 VAS 代理；不是物理长度、神经放电或激素浓度。
- `initialState` 取参数里的空腹基线。

**输入：**

- `stomachSensory.mechanical`（0–1 代理；缺失/非法按 0）。
- `stomachGhrelin.relativeConcentration`（相对值，基线 1；缺失/非法按 1）。
- `duodenum.nutrientExposure`（`kcal/min` 代理；缺失/非法按 0）。

**方程（全部 gain 为 `design`）：**

```text
hunger   = clamp(hungerBaseline   + hungerGhrelinGain   × (G − 1)
                                  + hungerMechanicalGain × M
                                  + hungerNutrientGain   × N, 0, 100)
fullness = clamp(fullnessBaseline + fullnessGhrelinGain × (G − 1)
                                  + fullnessMechanicalGain × M
                                  + fullnessNutrientGain × N, 0, 100)
```

- `M` 先钳到 `[0, 1]`；`N` 先钳到 `>= 0`；`G` 先钳到 `>= 0`。
- 输出再钳到 `[0, 100]`；所有输出必须是有限数。

**参数（从 `systems/nervous/interoception.parameters.json` 迁入并裁剪）：**

| 参数 | 值 | 状态 |
| --- | --- | --- |
| `interoception.hunger.baselineMm` | 50 | `design` |
| `interoception.fullness.baselineMm` | 0 | `design` |
| `interoception.hunger.ghrelinGain` | 50 | `design` |
| `interoception.fullness.ghrelinGain` | -50 | `design` |
| `interoception.hunger.mechanicalGain` | -20 | `design` |
| `interoception.fullness.mechanicalGain` | 100 | `design` |
| `interoception.hunger.nutrientGain` | -5 | `design` |
| `interoception.fullness.nutrientGain` | 10 | `design` |

不迁入：`ghrelinGainAbsolute`（需要绝对 ng/mL，当前模型用相对浓度）、`discomfort.*`（`unset`，没有消费者）。

**证据：**

- 方向：Cummings 2001（餐前升、餐后降）、Leone 2022（餐后饥饿素与 H/F 变化）、Levine 2015（胃饱满 VAS 时序）、Camps 2016（饱感与胃排空不一致）。
- 边界：这些研究没有把机械感受、营养暴露或相对饥饿素校准到 0–100 VAS；线性叠加、增益、基线全是 `design`，不是拟合，也不是独立验证。
- 不建模：恶心、腹胀、疼痛、过度饱满、餐食成分、个体差异。

**Steps:**

- [x] 写失败的 `test/organs.interoception.test.mjs`：基线、低饥饿素、机械充盈、营养暴露、钳位、缺失/NaN 输入。
- [x] 迁移并裁剪参数文件；`owner` 改为 `interoception`。
- [x] 写 `interoception.ts`，头部注释列出来源与边界。
- [x] 更新 `test/parameters.test.mjs`：加入 `brain/interoception.parameters.json`，移除 legacy `systems/nervous/interoception.parameters.json`；`requireParameter` 的 unset 测试改用本地对象。
- [x] 写 `brain/README.md`：脚本、字段、输入、方程、证据、未建模、`producer-only` 说明。
- [x] 跑 `node --test test/organs.interoception.test.mjs test/parameters.test.mjs`。

## Task 3: 接线——清单、重放、Gateway、场景

**Files:**
- Modify: `body-modules.json`
- Modify: `tools/replay.mjs`
- Modify: `test/tools.replay.test.mjs`
- Modify: `test/organs.gateway.test.mjs`
- Create: `scenarios/p1-cola-330.json`
- Modify: `scenarios/m1-liquid-meal-levine-355.json`（只改 note，不动 expected）

**Steps:**

- [x] `body-modules.json` 加入 `./organs/human-organs/brain/interoception.ts`。
- [x] `tools/replay.mjs` 导入 `interoception`，五模块按顺序跑；note 改成“P1 产出体感，体感是 design 读出”。
- [x] `test/tools.replay.test.mjs` 加可乐场景：`drink` 330 mL / 140 kcal，断言能量入账、`stomachGhrelin.relativeConcentration` 下降、`interoception.fullness` 上升。
- [x] `test/organs.gateway.test.mjs` 改成五个部位；`capabilities.drink` 期望 `['stomach', 'stomachGhrelin']`；发送含能 `drink`，断言 `stomach.energyKcal > 0`、ghrelin 被抑制、interoception 可读。
- [x] 新建 `scenarios/p1-cola-330.json`，`source: null`，note 写明“示意输入，不是论文场景”；观察 `stomach.volumeMl`、`stomach.energyKcal`、`stomachGhrelin.relativeConcentration`、`interoception.hunger`、`interoception.fullness`。
- [x] 给 `m1-liquid-meal-levine-355.json` 的 note 加一句：`expected` 是论文 VAS 目标，不是当前线性体感模型的输出。
- [x] 跑 `node --test test/tools.replay.test.mjs test/organs.gateway.test.mjs`。

## Task 4: 文档与状态

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/virtual-body.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/superpowers/specs/2026-11-20-organ-model-design.md`
- Modify: `organs/human-organs/stomach/README.md`
- Modify: `docs/superpowers/plans/2026-11-21-p1-input-interoception.md`（完成勾选）

**Steps:**

- [x] `AGENTS.md`：当前状态改为 P0 四脚本 + P1 输入契约/体感；根清单五条；体感已实现但通知/会话工具仍未实现；参数测试说明改为五份器官参数。
- [x] `docs/virtual-body.md`：动作契约补 `drink.energyKcal`；P1 体感接入说明；M1 里程碑里区分“已实现读出”与“未实现通知/工具”。
- [x] `docs/gateway-and-scripts.md`：动作示例补含能饮料；当前清单五条；体感脚本作为只读消费者示例。
- [x] 设计文档 §6 把 P1 标成“先做输入契约 + 感受与上报，其余器官顺延”；§11 回答 `brain/` 目录、脚本拆分和 `interoception` 部位名。
- [x] `stomach/README.md`：`drink` 可选能量；ghrelin 消费 `drink`；饮料成分未建模。
- [x] 扫描 `git grep -n "四.*脚本\|四个部位\|P0 不产出体感"` 等旧文案并修正。

## 交付检查

- [x] `npm test` 全绿。
- [x] `node tools/replay.mjs scenarios/p1-cola-330.json` 输出含能饮料的体积、能量、ghrelin 抑制与体感变化。
- [x] `node tools/replay.mjs scenarios/m1-water-240.json` 仍报告 `actionLagRounds: 1`，白水不抑制 ghrelin。
- [x] 根清单加载五个部位；`/capabilities.drink` 为 `['stomach','stomachGhrelin']`。
- [x] 新脚本头部有来源注释，参数文件 `source`/`status` 与 README 一致。
- [x] 不新增 `body_act`、通知投递、多身体或热切换的假实现。
