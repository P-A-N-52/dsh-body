# 器官级身体模型设计

**状态：** 已批准（2026-11-20）。实施计划见 [`2026-11-20-organ-model-p0.md`](../plans/2026-11-20-organ-model-p0.md)。

> **历史提示（2026-11-21）：** 本文关于 P0 不做固餐排空、`mealKind` 仅作元数据的取舍属于当时设计；当前实现已由 [固／液餐小改设计](./2026-11-21-solid-meal-emptying-design.md) 更新，下文保留历史文本，不再代表现状。
>
> **历史提示（2026-11-22）：** 下文“不建模餐前上升”的边界已由 [空腹饥饿素上升设计](./2026-11-22-fasting-ghrelin-design.md) 扩展：当前 `stomachGhrelin` 按距上次含能摄入的分钟数做工程上升，但仍不建模餐时表与餐前预期。本文保留原批准文本，现状以代码和器官 README 为准。
>
> **历史提示（2026-11-22，后续碳水薄切片）：** 小肠碳水吸收与 `glucose` 隔室已由 [碳水—血糖薄切片设计](./2026-11-22-carbohydrate-glucose-design.md) 接入，本文把小肠吸收、血糖和胰岛素并列列为“计划”的表格不再代表现状。当前只实现碳水到血糖的薄切片；完整胰岛素、肝糖、组织摄糖与下游反馈仍未实现。

## 1. 意图与为什么

把仿真单元从“11 个生理系统”改成**器官**。一个器官是一个目录，可以由一个或多个脚本模拟；系统名只保留为功能标签，不再作为目录层级或仿真层级。

原因有三条：

1. **证据是器官级的。** 胃排空 t50、血浆饥饿素、VAS 评分、标记餐残留，都是按器官或整体测的；按系统分层只会多一层没有观测的抽象。
2. **一个器官本来就有多种功能。** 胃有动力、内分泌、机械感受；把它们放在同一个器官目录下，比拆到消化/内分泌/感觉器三个系统更直观。
3. **Gateway 已经不关心层级。** 它只认模块 id、部位和字段；Task 0 的 `fields`/`add`/`transfer` 也是按部位工作。取消系统层不需要动 Gateway。

## 2. 目标、非目标、反目标

**目标**

- `organs/human-organs/<organ>/` 成为唯一的仿真目录；脚本、参数、README、证据都跟着器官走。
- P0 只做胃和十二指肠：胃动力、胃内分泌（饥饿素）、胃壁机械感受、十二指肠营养暴露。
- 脚本仍由 `body-modules.json` 逐条列出；加器官 = 建目录 + 加脚本路径。
- P0 交付可运行的链、测试、重放和器官 README；旧 `systems/` 不再出现在仿真路径里。
- 器官清单给出 P1/P2，后续按清单推进。

**非目标**

- P0 不做感受与上报（`brain`），不产出饥饿/饱感/撑感。
- 不做新的 Gateway 能力；Task 0 的 `fields`/`add`/`transfer` 已够用。
- 不做热替换、并行执行、文件系统沙箱、多身体路由。
- 不做固餐排空、肠道吸收、血糖、胰岛素；这些是后续器官的事。

**反目标**

- 不为“血液”“皮肤”“骨骼”“肌肉”硬造 `organs/blood/` 这类单器官目录；它们是隔室或分区，单独列。
- 不让两个脚本写同一个部位；一个部位一个写者。
- 不在只接了一条输入时声称“多种调节方式已建模”。

### 2.1 建模取舍准则

**懂得取舍也是一种设计哲学。**

P0 的目标不是拟真，而是能用、能解释、能替换。每加一个字段、参数或脚本前，先过三问：

1. **谁读它？** 没有模块、用户或场景消费这个差异，就不建模。
2. **有证据吗？** 没有就标 `design` / `unset`，不要伪装成测量值。
3. **会不会破坏单写者、轮初快照或可替换性？** 会，就先不改，或者只保留为只读代理。

由此得到三条落地规则：

- **没有消费者的差异不建模。**
- **没有证据的参数标 `design`，并在 README 写清来源与限制。**
- **省略的东西必须在 README 的“未建模”里写清楚；不能用一个不起作用的字段假装它被建模了。**

当前 P0 的典型取舍：

- 保留：总体积、总能量、进食时长、`drink`/`eat` 的动作语义、能量密度对半衰期的影响。
- 降级为元数据：`mealKind`（`solid`/`liquid`/`mixed` 目前不参与计算）。
- 只读/观察用：`emptiedMl`、`emptiedKcal` 是每轮通量和重放读数，不是其他器官的输入；`lastIntakeAt` 目前没有消费者，保留时必须标 `producer only / not consumed`，否则删除。
- 暂不建模：质地、黏度、咀嚼、胃酸/酶分泌、CCK/GLP-1/迷走反馈、吸收、血糖、饱感、个体差异。

## 3. 约束

- Node ≥22.18、ESM、可擦除 TypeScript、`node:test`、无第三方依赖。
- 一轮 = 60 仿真秒；所有模块读同一份轮初快照；整轮原子提交。
- 每个模块必须导出 `id`、`initialState`、`actionTypes`、`heartbeat`、`fields`；`fields` 的规则沿用 `docs/gateway-operations.md`。
- 参数进 `*.parameters.json`，保留 `unit`/`status`/`source`/`range`；`unset` 的值是 `null`。
- 代理量写明“代理”；不跨量纲换算；缺失值不用 0 代替。

## 4. 已考虑的方案

| 决定 | 备选 | 选择与理由 |
| --- | --- | --- |
| 顶层结构 | 扁平器官目录 / 器官+体区 / 器官+功能标签 / 保留 systems 归档 | **扁平器官目录**：`organs/human-organs/<organ>/`；系统名只做 README 标签。 |
| 脚本语言 | TypeScript / Python / 多语言 | **TypeScript**：Gateway 直接加载，现有模块和测试不动。 |
| 脚本发现 | 根清单列脚本 / 列器官目录 / 自动扫描 | **根清单列脚本**：`body-modules.json` 逐条列 `.ts`；器官目录只负责组织，Gateway 零改动。 |
| 器官清单文件 | 每个器官 `manifest.json` / 无 | **无**：用户明确忽略 `manifest.json`；器官元数据写 README。 |
| 感受与上报 | `brain/` 作为神经器官 / 独立 `sensory/` / 推迟 | **推迟到 P1**；届时作为“感受与上报”系统，不叫泛化的脑。 |
| 多调节方式 | 主脚本内部整合 / 每种调节一个脚本 / 调节器单独成模块 | **按器官在实现时决定**；README 必须列全调节方式，不能默认只接一条输入。 |
| 证据迁移 | 一次性全搬 / 只搬 P0 / 保留 systems | **只搬 P0**：胃和十二指肠的证据迁到器官目录；P0 来源的三个空壳 `systems/{digestive,endocrine,sensory}` 删除；其余 `systems/*/references/` 暂留并标 legacy，随器官实现迁移。 |
| 根清单启用 | P0 完成即启用 / 测试全绿后单独启用 | **测试全绿后单独启用**：P0 先用测试/重放的临时清单验收；`npm test` 通过并提交后，再用单独一次提交把四条路径写进根 `body-modules.json`。 |

## 5. 选定结构

```text
organs/
├── human-organs/
│   ├── references/
│   │   ├── source-index.csv
│   │   └── m1-data-dictionary.md
│   ├── stomach/
│   │   ├── README.md
│   │   ├── motility.ts
│   │   ├── motility.parameters.json
│   │   ├── ghrelin.ts
│   │   ├── ghrelin.parameters.json
│   │   ├── gastric-sensory.ts
│   │   ├── gastric-sensory.parameters.json
│   │   └── references/notes/...
│   └── duodenum/
│       ├── README.md
│       ├── nutrient-exposure.ts
│       ├── nutrient-exposure.parameters.json
│       └── references/notes/...
├── animals/            # 以后
└── personalized/       # 以后
lib/
└── parameters.js
```

**部位 id 与脚本分工：**

| 器官目录 | 脚本 | 部位 id | 写什么 |
| --- | --- | --- | --- |
| `stomach/` | `motility.ts` | `stomach` | `volumeMl`、`energyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt` |
| `stomach/` | `ghrelin.ts` | `stomachGhrelin` | `relativeConcentration` |
| `stomach/` | `gastric-sensory.ts` | `stomachSensory` | `mechanical` |
| `duodenum/` | `nutrient-exposure.ts` | `duodenum` | `nutrientExposure` |

部位 id 用 camelCase，不含点号；字段路径是 `部位.字段`，点号会破坏寻址。器官目录只是分组，不参与 Gateway 寻址。

**P0 不引入 `brain`/`interoception`**；饥饿、饱感、撑感全部推迟。P0 的链是“吃/喝 → 胃排空 → 十二指肠营养暴露”，不是完整 M1 体感链。

## 6. 器官清单

**P0（本轮）**

| 器官 | 脚本 | 说明 |
| --- | --- | --- |
| `stomach` | motility、ghrelin、gastric-sensory | 胃动力沿用现有方程；ghrelin 是胃内分泌；gastric-sensory 是胃壁机械感受末梢，P0 只产出信号，P1 由 `interoception` 读取 |
| `duodenum` | nutrient-exposure | 沿用现有“读胃流出能量”的一阶滤波；P0 不建肠内容量/吸收模型，P1 仍不改 |

**P1（下一圈）**

`esophagus`、`jejunum`、`ileum`、`colon`、`liver`、`pancreas`、`heart`、`lungs`、`kidneys`、`bladder`、`blood`（隔室）、`brain`（感受与上报）。

**P1 当前进度（2026-11-21）**

本轮先做输入契约与感受/上报，其余 P1 器官顺延：

| 项 | 状态 |
| --- | --- |
| `drink` 可带 `energyKcal`；`stomachGhrelin` 消费含能 `drink` | 已实现 |
| `organs/human-organs/brain/interoception.ts`（部位 `interoception`，写 `hunger` / `fullness`） | 已实现 |
| `organs/human-organs/brain/notify.ts`（部位 `brainNotify`，显著性/滞回/冷却/配额） | 已实现 |
| `body_act` / `body_state` 会话工具 | 已实现 |
| 通知投递到对应会话（`context` / `wake`） | 已实现 |
| 完整多会话路由、通知历史文件、模型已读确认 | 未实现 |
| `esophagus`、小肠吸收、血糖、胰岛素、心、肺、肾、膀胱等 | 计划 |

**P2（只登记，不实现）**

`pituitary`、`pineal`、`thyroid`、`parathyroid`、`eyes`、`ears`、`nose`、`tongue`、`salivary-glands`、`pharynx`、`larynx`、`trachea`、`bronchi`、`diaphragm`、`thymus`、`mammary-glands`、`rectum`、`gallbladder`、`spleen`、`adrenal-glands`、`ureters`、`urethra`、`ovaries`、`fallopian-tubes`、`uterus`、`vagina`、`testes`、`epididymis`、`vas-deferens`、`prostate`、`penis`、`scrotum`、`skeletal-muscles`、`bones`、`joints`、`skin`、`lymph`、`bone-marrow`、`peripheral-nerves`。

**隔室/分区，不按器官目录处理：** `blood`、`skin`、`bones`、`skeletal-muscles`、`joints`、`lymph`、`bone-marrow`、`peripheral-nerves`。它们是组织、分区或网络，等真正实现时单独定目录，不硬塞进 `organs/`。

## 7. P0 的模型边界

- **胃动力**：沿用现有方程 `energyDensity = V>0 ? E/V : 0`、`h = halfTime + gain × energyDensity`、`out = V>0 ? max(0,V−B)(1−2^(−dtMin/h)) : 0`；先排空后入胃；空胃归零。摄入账本从单对象改成 `mealQueue` 队列，修掉并发多轮摄入被合并的时间扭曲。
- **胃内分泌**：只有含能量的摄入（`eat` 且 `kcal > 0`）触发抑制，白水不抑制；随后按指数恢复。`relativeConcentration` 是相对值，不是 ng/mL。P0 不建模餐前上升（没有餐时表，无法触发），README 明确写“未建模”。**2026-11-22 更新：** 空腹时长驱动的工程上升已由 [空腹饥饿素上升设计](./2026-11-22-fasting-ghrelin-design.md) 扩展；仍不建模餐时表与餐前预期。
- **胃壁机械感受**：`mechanical = clamp(V / reference, 0, 1)^exponent`，是代理，不是张力。
- **十二指肠**：继续读 `stomach.emptiedKcal`，一阶滤波到 `nutrientExposure`；P0 不用 `transfer`，因为还没有肠内容量/吸收模型。`transfer` 留给 P1 的器官间转移。
- **多调节方式**：P0 的胃动力只接摄入和自身状态，不接迷走/CCK/GLP-1；README 要写清“这些调节方式尚未接入”，不能暗示已建模。

## 8. 迁移

- 脚本：`systems/digestive/stomach.ts` → `organs/human-organs/stomach/motility.ts`；`systems/digestive/duodenum.ts` → `organs/human-organs/duodenum/nutrient-exposure.ts`。
- 参数：跟随脚本移动；文件头部的 `owner` 改为新部位 id。
- 公共库：`systems/lib/parameters.js` → `lib/parameters.js`；所有 import 更新。
- 证据：Mudie、Camps、Tougas、Levine、Cummings、Leone 的笔记迁到 `organs/human-organs/stomach/references/notes/`；`source-index.csv` 与 `m1-data-dictionary.md` 放 `organs/human-organs/references/`；两处的 `note_path` 与相对链接同步更新。
- `systems/digestive`、`systems/endocrine`、`systems/sensory` 搬空后整个目录删除；其余 `systems/*/references/` 暂留，所在系统 README 顶部标“legacy evidence only, not simulation”，随对应器官实现时迁移。
- 旧计划：`2026-11-20-m1-organ-level-reset.md`、`2026-11-20-m1-scope.md`、`2026-11-20-tissue-fidelity-m1.md` 顶部标“已废弃，见本文”。
- 文档：`docs/virtual-body.md` 的 11 系统表改成器官清单，并全文把仿真路径与旧部位名（`systems/…`、`ghrelin`、`gastricSensory`）更新为 `organs/human-organs/…`、`stomachGhrelin`、`stomachSensory`；`AGENTS.md` 与 `docs/gateway-and-scripts.md` 同步扫一遍。
- 清单：P0 先不写根 `body-modules.json`；脚本与测试全绿并提交后，再用单独一次提交加入四条路径。
- 测试：`test/parameters.test.mjs` 的扫描路径改为 `organs/**/*.parameters.json` 加仍保留的 `systems/**/*.parameters.json`；为胃动力、ghrelin、胃壁感受、十二指肠补模块行为测试（当前没有）；Gateway 测试不动。
- 重放：当前没有 `tools/` 目录，P0 新建一个重放脚本（路径在实施计划定），能重放 `scenarios/m1-water-240.json` 与液餐场景，并报告一轮偏移。
- 打包：`package.json` 的 `files` 加 `organs/`、`lib/`；不再引用 `systems/`。

## 9. 我的判断（可推翻）

- **P0 保留 gastric-sensory**，虽然暂时没有消费者；它是胃的功能，先产出信号，等 `brain` 接入时直接用。
- **P0 不用 `transfer`**。胃→十二指肠的转移等 P1 有肠内容量/吸收模型时再用；现在用 `emptiedKcal` 的一轮滞后，并用模块测试固定这一行为。
- **部位 id 保留 `stomach`、`duodenum`**，只把 ghrelin/sensory 命名为 `stomachGhrelin`、`stomachSensory`；这样现有 M2 代码改动最小。
- **证据只迁 P0**。一次性搬 11 个系统的 references 风险大、收益低；P1 每实现一个器官再搬它的证据。
- **ghrelin 只对含能量摄入抑制**（按“现实情况”）。白水不抑制；没有餐时表，P0 不建模餐前上升。（2026-11-22：空腹时长驱动的工程上升已由 [新设计](./2026-11-22-fasting-ghrelin-design.md) 扩展；仍不建模餐时表与餐前预期。）
- **根清单在测试全绿后单独提交**（按“先提交、跑测试”）。P0 先用临时清单验收，避免脚本未验证就进入真实身体。

## 10. 成功标准

- 新建一个器官只需：建 `organs/human-organs/<organ>/`、放脚本与参数、在 `body-modules.json` 加路径；Gateway 不改。
- P0 的四个脚本在真实 Gateway 里用临时清单启动，跑喝水与液餐、质量守恒、无 `NaN`、`fields` 校验通过；随后根清单用单独一次提交启用。
- `npm test` 全绿；新建的重放脚本能重放白水场景，并明确报告一轮偏移。
- 仓库的仿真路径里不再出现 `systems/`；P0 来源的三个空壳目录已删除，其余旧目录只作为 legacy evidence，且有明确标记。
- 文档能回答：一个器官有哪些脚本、每个脚本写什么、读什么、单位是什么、证据在哪。

## 11. 留给实施计划的开放项

- 十二指肠的一阶滤波仍未改成“肠内容量 + 吸收”；P1 先保持一阶滤波，吸收链顺延。
- `brain`/感受与上报：P1 用 `brain/` 一个目录、`interoception.ts` 与 `notify.ts` 两个脚本；部位 id 为 `interoception`、`brainNotify`。`body_act` / `body_state` 与 `context`/`wake` 投递已实现；通知历史文件、`agent/inbox/inserted` 已读确认、完整多会话路由仍开放。
- 多调节方式在 P1 仍未接入：胃动力保持“摄入 + 自身状态”，不接迷走/CCK/GLP-1。
- 旧 `systems/` 的剩余 references 何时全部迁完；按后续器官逐个迁。`systems/nervous/` 的 Sebaratnam、Schamberg 笔记仍是 legacy，撑感/不适读出未实现。
