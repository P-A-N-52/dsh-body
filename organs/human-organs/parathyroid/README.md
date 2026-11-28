# 甲状旁腺（parathyroid）：血钙驱动的 PTH 物理浓度

**功能标签：** 内分泌（甲状旁腺—血钙负反馈环路）。

`parathyroid/` 目前只有一个部位 `parathyroid`，脚本为 [`parathyroid.ts`](parathyroid.ts)，没有动作、通知或 `transfer`，也不写其他部位。它读取轮初 `bloodCalcium.mgDl`，通过比例目标与 15 min 一阶趋近输出纯物理浓度甲状旁腺激素代理 `pthPgMl`（单位 `pg/mL`，范围 `0–90`，`30 pg/mL` 为静息工程基线）：血钙低于参考值时 PTH 上升，高于参考值时下降。唯一的消费者是 [`bloodCalcium`](../../human-compartments/calcium/README.md)，读取 `pthPgMl` 并按自身 `calcium.referencePthPgMl`（默认 `30 pg/mL`）归一化后决定骨钙释放或沉积以及肾钙重吸收代理，构成闭环负反馈。

**实现与挂载状态：** 脚本、参数、单元测试与真实 Gateway 集成测试（[`test/organs.parathyroid-gateway.test.mjs`](../../../test/organs.parathyroid-gateway.test.mjs)）已实现并统一为纯物理浓度单位 `pthPgMl`（不保留旧无量纲 `pthRelative` 字段），且**已正式挂载进三份身体清单**（[`body-modules.json`](../../../body-modules.json) 43 部位 / 39 份唯一参数文件、[`body-modules.female.json`](../../../body-modules.female.json) 46 / 42 与 [`body-modules.male.json`](../../../body-modules.male.json) 45 / 41）。五项参数全部 `design`、`source: null`。本文只描述离线模块与契约，未做真实 DSH 会话、PTH 实测或临床验证。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "parathyroid.referenceCalciumMgDl": 9.6 } }
```

### parathyroid.parameters.json

参数文件：[`parathyroid.parameters.json`](parathyroid.parameters.json)。入口及清单：[`parathyroid.ts`](parathyroid.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json) / [可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。读取脚本：[`parathyroid.ts`](parathyroid.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `parathyroid.referenceCalciumMgDl` | `9.5` | `mg/dL` | `design` | 无 | — |
| `parathyroid.baselinePthPgMl` | `30` | `pg/mL` | `design` | 无 | — |
| `parathyroid.pthGainPgMlPerMgDl` | `15` | `pg/mL/(mg/dL)` | `design` | 无 | — |
| `parathyroid.maxPthPgMl` | `90` | `pg/mL` | `design` | 无 | — |
| `parathyroid.halfTimeMin` | `15` | `min` | `design` | 无 | — |

<!-- organ-parameters:end -->

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`parathyroid.ts`](parathyroid.ts) | `parathyroid` | `pthPgMl` | 自己的轮初状态；轮初 `bloodCalcium.mgDl`（未加载按 9.5）；`io.dt` | [`parathyroid.parameters.json`](parathyroid.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- `bloodCalcium` 是可选上游：未加载（`undefined`）时按参考值 `referenceCalciumMgDl = 9.5 mg/dL` 回退，PTH 向 `baselinePthPgMl = 30 pg/mL` 衰减。
- 若 `bloodCalcium` 已加载但为 `null`/非对象，或 `mgDl` 缺失、非数值、非有限或为负，脚本立即抛错，本轮不写状态，不用参考值掩盖损坏状态。
- 自身旧档缺少 `pthPgMl`（例如历史 `pthRelative` 旧档）或非有限时通过 `finiteOr(prev.pthPgMl, 30)` 按 `initialState`（`30 pg/mL`）起步，不保留无量纲回退。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `pthPgMl` | `pg/mL` | 血浆 PTH 物理浓度代理，`0–90 pg/mL`；`30 pg/mL` 表示静息工程基线。不是临床实验室 iPTH 参考区间、分泌速率或实测检验值 |

`initialState = { pthPgMl: 30 }`（取自 `parathyroid.baselinePthPgMl`），字段为 `absolute`。输出只含一个有限数字段，JSON-safe。

## 3. 方程与参数

设 `prevPth = finiteOr(prev.pthPgMl, baselinePthPgMl)`，`dtMin = io.dt / 60`：

```text
pthTarget = clamp(
  baselinePthPgMl + pthGainPgMlPerMgDl × (referenceCalciumMgDl − bloodCalcium.mgDl),
  0,
  maxPthPgMl,
)
pthPgMl = pthTarget + (prevPth − pthTarget) × 2^(−dtMin / halfTimeMin)
```

- 在默认 `referenceCalciumMgDl = 9.5 mg/dL`、`baselinePthPgMl = 30 pg/mL`、`pthGainPgMlPerMgDl = 15 pg/mL/(mg/dL)`、`maxPthPgMl = 90 pg/mL` 下：`mgDl = 9.5` 时 `pthTarget = 30 pg/mL`；血钙每低于 9.5 1 mg/dL，目标上升 15 pg/mL（最低 5.5 mg/dL 触顶 90 pg/mL）；高于 9.5 1 mg/dL，目标下降 15 pg/mL（≥11.5 mg/dL 触底 0 pg/mL）。
- 只读轮初快照，因此血钙变化到 PTH 响应有一轮滞后，PTH 变化再到 [`bloodCalcium`](../../human-compartments/calcium/README.md) 释放/沉积又有一轮滞后。

同目录参数（`owner: parathyroid`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `parathyroid.referenceCalciumMgDl` | 9.5 | `mg/dL` | `design` | `source: null`；PTH 目标的血钙参考值工程占位，不区分白蛋白校正，不是人群正常值或实验室参考区间 |
| `parathyroid.baselinePthPgMl` | 30 | `pg/mL` | `design` | `source: null`；参考血钙 `9.5 mg/dL` 时的静息血浆 PTH 参考基线工程占位 |
| `parathyroid.pthGainPgMlPerMgDl` | 15 | `pg/mL/(mg/dL)` | `design` | `source: null`；血钙每偏离参考值 1 mg/dL 时 PTH 目标斜率工程占位，不是钙感受受体敏感性或实测分泌曲线 |
| `parathyroid.maxPthPgMl` | 90 | `pg/mL` | `design` | `source: null`；PTH 稳态目标上限工程占位，不是最大分泌能力或临床界值 |
| `parathyroid.halfTimeMin` | 15 | `min` | `design` | `source: null`；PTH 浓度向目标值一阶趋近的工程半时，不是实测体内 PTH 分泌或清除半衰期 |

五项参数的 `range` 均只是工程调参范围。

## 4. 消费者与反馈闭环

```text
bloodCalcium.mgDl ──(轮初读)──► parathyroid.pthPgMl
         ▲                              │
         └──────────(轮初读)────────────┘
```

- `bloodCalcium` 读轮初 `parathyroid.pthPgMl` 并用自身 `calcium.referencePthPgMl` 归一化为 `pthRatio`：`pthRatio > 1`（默认 > `30 pg/mL`）时从骨钙库释放钙、并可视作完全重吸收（肾钙排泄为 0）；`pthRatio < 1` 时向骨钙库沉积钙并按 `(1 − pthRatio)` 比例增加尿钙排泄；`pthRatio = 1` 时在 `9.5 mg/dL` 处保持静息稳态。详见 [`calcium` README](../../human-compartments/calcium/README.md)。

## 5. 未建模与未验证

**未建模：**

- 维生素 D（骨化三醇）合成与反馈、肠道钙吸收、降钙素。
- 钙敏感受体（CaSR）非线性 S 形剂量反应、PTH 真实分泌/清除动力学。
- 骨密度、骨折、骨代谢疾病、肾性骨病、钙磷乘积与磷酸盐调节。
- 甲旁亢/甲旁减、手术、昼夜节律、年龄/性别与个体差异。

**未验证：** 没有 PTH 浓度基准、分泌/清除动力学或钙敏感受体曲线的直接人体来源、独立数据、临床验证或真实 DSH 会话验收。15 min 半时、0–90 pg/mL 范围、`30 pg/mL` 基线、`9.5 mg/dL` 与 `15 pg/mL/(mg/dL)` 斜率均属 `design`、`source: null` 的工程假设，不能称拟合或 `validated`。

## 6. 证据入口

- 设计：[`2026-11-24-parathyroid-calcium-design.md`](../../../docs/superpowers/specs/2026-11-24-parathyroid-calcium-design.md)
- 模块测试：[`test/organs.parathyroid.test.mjs`](../../../test/organs.parathyroid.test.mjs)
- 血钙环路测试：[`test/organs.blood-calcium.test.mjs`](../../../test/organs.blood-calcium.test.mjs)
- 消费者：[`calcium`](../../human-compartments/calcium/README.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片未新增来源行）
