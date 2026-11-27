# 血钙隔室（bloodCalcium）：血钙浓度与骨钙库缓冲

**功能标签：** 电解质 / 矿物质稳态（隔室代理，不是解剖器官）。

`calcium/` 目前只有一个部位 `bloodCalcium`，脚本为 [`calcium.ts`](calcium.ts)，没有动作、通知或 `transfer`，也不写其他部位。它维护血钙浓度代理 `mgDl` 与骨钙缓冲库 `boneStoreG`：读取轮初 `parathyroid.pthPgMl` 并按自身 `calcium.referencePthPgMl`（默认 `30 pg/mL`）归一化为 `pthRatio = pthPgMl / referencePthPgMl`；当 `pthRatio > 1` 时从骨库释放钙；当 `pthRatio < 1` 时向骨库沉积钙并按 `(1 − pthRatio)` 与 `blood.gfrMlMin` 排泄尿钙；当 `pthRatio = 1` 时保持在 `9.5 mg/dL` 稳态。骨钙库只作钙质量缓冲，不是骨密度、骨折或骨代谢模型。

**实现与挂载状态：** 脚本、参数、单元测试与真实 Gateway 集成测试（[`test/organs.parathyroid-gateway.test.mjs`](../../../test/organs.parathyroid-gateway.test.mjs)）已实现（包含 `* 1000` 单位修正、骨库满容截断 `depositG = min(rawDepositG, max(0, boneCapacityG - prevBoneStoreG))` 以保证钙质量守恒，以及对纯物理 `parathyroid.pthPgMl` 的接入），并**已正式挂载进三份清单**（[`body-modules.json`](../../../body-modules.json) 43 部位 / 39 份唯一参数文件、[`body-modules.female.json`](../../../body-modules.female.json) 46 / 42 与 [`body-modules.male.json`](../../../body-modules.male.json) 45 / 41）。八项参数全部 `design`、`source: null`。本文只描述离线模块与契约，未做真实 DSH 会话、血钙实测或临床验证。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "calcium.referencePthPgMl": 32 } }
```

有有效的甲状旁腺 PTH 输入时，此示例可改变已有存档后续的钙平衡计算，不重置血钙或骨钙库。

### calcium.parameters.json

参数文件：[`calcium.parameters.json`](calcium.parameters.json)。入口及清单：[`calcium.ts`](calcium.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json)）。读取脚本：[`calcium.ts`](calcium.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `calcium.referenceMgDl` | `9.5` | `mg/dL` | `design` | 无 | 血钙种子，只用于新建或 `mgDl` 缺失/非有限的回退；不覆盖已有有效值，不是运行设定点。 |
| `calcium.boneStoreInitialG` | `100` | `g` | `design` | 无 | 骨钙库种子，只用于新建或 `boneStoreG` 缺失/非有限的回退；不覆盖已有有效量。 |
| `calcium.boneCapacityG` | `200` | `g` | `design` | 无 | — |
| `calcium.boneReleaseRateGPerMin` | `0.0004` | `g/min` | `design` | 无 | — |
| `calcium.boneDepositRateGPerMin` | `0.0004` | `g/min` | `design` | 无 | — |
| `calcium.calciumExcretionPerMlG` | `0.000001` | `g/mL` | `design` | 无 | — |
| `calcium.distributionVolumeDl` | `140` | `dL` | `design` | 无 | — |
| `calcium.referencePthPgMl` | `30` | `pg/mL` | `design` | 无 | 有有效 `parathyroid.pthPgMl` 时作比例分母；未加载甲状旁腺时用相对基线 1，此键不参与该回退。 |

<!-- organ-parameters:end -->

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`calcium.ts`](calcium.ts) | `bloodCalcium` | `mgDl`、`boneStoreG` | 自己的轮初状态；轮初 `parathyroid.pthPgMl`（未加载按 `referencePthPgMl` 即比值 `1`）；轮初 `blood.gfrMlMin`（未加载按 100）；`io.dt` | [`calcium.parameters.json`](calcium.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- `parathyroid` 与 `blood` 均是可选上游：未加载（`undefined`）时分别按 `pthRatio = 1`（即等效 `pthPgMl = referencePthPgMl`）、`gfrMlMin = 100 mL/min` 回退。
- 已加载但非对象，或 `pthPgMl` / `gfrMlMin` 缺失、非数值、非有限或为负时抛错（不再接受旧无量纲 `pthRelative` 字段），本轮不写状态，不用回退值掩盖损坏状态。
- 自身缺状态或缺字段时通过 `finiteOr` 回落到 `9.5 mg/dL` 与 `100 g`。

## 2. 字段与单位

两个字段均为 `absolute`，`initialState = { mgDl: 9.5, boneStoreG: 100 }`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `mgDl` | `mg/dL` | 血钙浓度代理，钳位 `[0, 20]`；`9.5` 为工程参考设定点，不区分白蛋白校正或离子钙，不是实验室参考区间 |
| `boneStoreG` | `g` | 骨钙缓冲库存量，钳位 `[0, 200]`；只作质量缓冲，不是骨钙总量、骨密度或可交换钙池测量 |

输出只含两个有限数字段，JSON-safe。

## 3. 方程与参数

设 `prevMgDl = finiteOr(prev.mgDl, 9.5)`、`prevBoneStoreG = finiteOr(prev.boneStoreG, 100)`、`dtMin = io.dt / 60`，`pthRatio = parathyroid.pthPgMl / referencePthPgMl`（`parathyroid` 未加载按 `1`）、`gfr = blood.gfrMlMin`（未加载按 `100`）：

```text
releaseG   = pthRatio > 1
  ? min(boneReleaseRateGPerMin × (pthRatio − 1) × dtMin, prevBoneStoreG)
  : 0
rawDepositG = pthRatio < 1
  ? boneDepositRateGPerMin × (1 − pthRatio) × dtMin
  : 0
depositG   = min(rawDepositG, max(0, boneCapacityG − prevBoneStoreG))
excretionG = gfr × calciumExcretionPerMlG × max(0, 1 − pthRatio) × dtMin
boneStoreG = clamp(prevBoneStoreG − releaseG + depositG, 0, boneCapacityG)
mgDl       = clamp(prevMgDl + (releaseG − depositG − excretionG) × 1000 / distributionVolumeDl, 0, 20)
```

- **单位修正（`× 1000 / distributionVolumeDl`）：** `releaseG`、`depositG`、`excretionG` 单位为 `g`，乘 `1000` 换算为 `mg` 后除以表观分布体积 `140 dL`，直接得到 `mg/dL` 增量。
- **骨库满容截断：** `depositG` 在扣减血钙之前先按剩余骨容量 `max(0, boneCapacityG - prevBoneStoreG)` 截断，避免骨库在 `200 g` 封顶后仍继续从血钙凭空扣除质量，保证血—骨钙质量守恒。骨库耗尽（`prevBoneStoreG = 0`）时 `releaseG = 0`，同样不会透支为负。
- **肾排泄代理：** `pthRatio >= 1` 时 `excretionG = 0`（视为完全重吸收）；`pthRatio < 1` 时随 `(1 − pthRatio)` 线性增加。因此 `pthRatio = 1`（默认 `30 pg/mL`）时 `9.5 mg/dL` 为精确静息稳态设定点。

同目录参数（`owner: calcium`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `calcium.referenceMgDl` | 9.5 | `mg/dL` | `design` | `source: null`；血钙参考值与旧档初值工程占位，不做白蛋白校正，不是人群正常值 |
| `calcium.boneStoreInitialG` | 100 | `g` | `design` | `source: null`；骨钙库初始量工程占位，不是骨钙总量或骨密度 |
| `calcium.boneCapacityG` | 200 | `g` | `design` | `source: null`；骨钙库容量上限工程占位，只用于钳位 |
| `calcium.boneReleaseRateGPerMin` | 0.0004 | `g/min` | `design` | `source: null`；`pthRatio > 1` 每单位超额的骨钙释放速率，不是破骨细胞活性或实测钙流率 |
| `calcium.boneDepositRateGPerMin` | 0.0004 | `g/min` | `design` | `source: null`；`pthRatio < 1` 每单位缺额的骨钙沉积速率，不是成骨细胞活性或实测钙流率 |
| `calcium.calciumExcretionPerMlG` | 0.000001 | `g/mL` | `design` | `source: null`；每毫升 GFR 对应的肾钙排泄基准质量（乘 `max(0, 1 − pthRatio)`），作为 PTH 促重吸收代理 |
| `calcium.distributionVolumeDl` | 140 | `dL` | `design` | `source: null`；血钙表观分布体积工程占位，不是血浆容量或细胞外液实测 |
| `calcium.referencePthPgMl` | 30 | `pg/mL` | `design` | `source: null`；把上游 `parathyroid.pthPgMl` 归一化为无量纲驱动比值的参考 PTH 浓度 |

八项参数的 `range` 均只是工程调参范围。

## 4. 消费者

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| [`parathyroid`](../../human-organs/parathyroid/README.md) | 轮初 `bloodCalcium.mgDl` | 调节 `pthPgMl` 目标，形成负反馈环路 |
| [`interoception`](../../human-organs/brain/README.md) | 轮初 `bloodCalcium.mgDl` | 软读输出 `hypocalcemiaMm = clamp(50 × (9.5 − mgDl), 0, 100)` 与 `hypercalcemiaMm = clamp(50 × (mgDl − 9.5), 0, 100)`；未加载或非有限按 `9.5`（两读数为 `0`）。两读数不进 `discomfort` |
| [`brainNotify` / `wake-evaluation` / `body_state`](../../human-organs/brain/README.md) | 轮初 `hypocalcemiaMm`、`hypercalcemiaMm` | 已接入 `brainNotify` 标准扩展体感通道（`>= 65 / 85 mm`，重度时 `mode: 'wake'`）、`wake-evaluation`（睡眠期超重要阈值触发 `wakeReason: 'important'`）与 `body_state` 定性呈现（两项均在 `>= 85 mm` 时标为 `urgent`）；原始数值仍仅由 `GET /state` / `gateway.getState()` 返回 |

- `interoception.ts`、`notify.ts`、`wake-evaluation.ts` 与 `tools.js` 已接好上述软读、主动提醒/唤醒与纯定性展现（两读数仍不纳入 `discomfort` 聚合）。

## 5. 未建模与未验证

**未建模：**

- 维生素 D（骨化三醇）与饮食肠道钙吸收（`eat` / `drink` 不含钙载荷）。
- 肾小管各段钙重吸收的分子机制、转运体、尿钙排泄量进水账/膀胱、肾结石或高钙尿症。
- 降钙素、血浆白蛋白结合与游离离子钙区分、酸碱平衡对游离钙的影响、钙磷乘积与磷酸盐。
- 骨密度、骨折、骨质疏松/骨软化、低钙抽搐或高钙心电图改变（`hypocalcemiaMm` / `hypercalcemiaMm` 只是线性代理读数）。
- 年龄、性别、妊娠/哺乳钙消耗与个体差异。

**未验证：** 没有骨钙流率、肾钙排泄、表观分布体积或症状斜率的直接人体来源、独立数据、临床验证或真实 DSH 会话验收。全部参数与公式均属 `design`、`source: null` 的工程假设，不能称拟合或 `validated`。

## 6. 证据入口

- 设计：[`2026-11-24-parathyroid-calcium-design.md`](../../../docs/superpowers/specs/2026-11-24-parathyroid-calcium-design.md)
- 模块测试：[`test/organs.blood-calcium.test.mjs`](../../../test/organs.blood-calcium.test.mjs)
- 上游闭环测试：[`test/organs.parathyroid.test.mjs`](../../../test/organs.parathyroid.test.mjs)
- 上下游：[`parathyroid`](../../human-organs/parathyroid/README.md)、[`blood`](../blood/README.md)、[`brain`](../../human-organs/brain/README.md)
- 共享来源登记簿：[`../../human-organs/references/source-index.csv`](../../human-organs/references/source-index.csv)（本切片未新增来源行）
