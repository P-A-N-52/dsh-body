# 血钙隔室（bloodCalcium）：血钙浓度与骨钙库缓冲

**功能标签：** 电解质 / 矿物质稳态（隔室代理，不是解剖器官）。

`calcium/` 目前只有一个部位 `bloodCalcium`，脚本为 [`calcium.ts`](calcium.ts)，没有动作、通知或 `transfer`，也不写其他部位。它维护血钙浓度代理 `mgDl` 与骨钙缓冲库 `boneStoreG`：当轮初 `parathyroid.pthRelative > 1` 时从骨库释放钙；当 `pthRelative < 1` 时向骨库沉积钙并按 `(1 − pthRelative)` 与 `blood.gfrMlMin` 排泄尿钙；当 `pthRelative = 1` 时保持在 `9.5 mg/dL` 稳态。骨钙库只作钙质量缓冲，不是骨密度、骨折或骨代谢模型。

**实现与挂载状态：** 脚本、参数与单元测试已实现（包含 `* 1000` 单位修正：将骨释放/沉积/排泄质量由 `g` 换算为 `mg` 再除以 `distributionVolumeDl` 得到 `mg/dL`，以及骨库满容截断 `depositG = min(rawDepositG, max(0, boneCapacityG - prevBoneStoreG))` 以保证钙质量守恒），**当前尚未挂载进三份清单**（[`body-modules.json`](../../../body-modules.json)、[`body-modules.female.json`](../../../body-modules.female.json) 与 [`body-modules.male.json`](../../../body-modules.male.json) 均未注册 `calcium.ts`）。七项参数全部 `design`、`source: null`。本文只描述离线模块与契约，未做真实 DSH 会话、血钙实测或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`calcium.ts`](calcium.ts) | `bloodCalcium` | `mgDl`、`boneStoreG` | 自己的轮初状态；轮初 `parathyroid.pthRelative`（未加载按 1）；轮初 `blood.gfrMlMin`（未加载按 100）；`io.dt` | [`calcium.parameters.json`](calcium.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- `parathyroid` 与 `blood` 均是可选上游：未加载（`undefined`）时分别按 `pthRelative = 1`、`gfrMlMin = 100 mL/min` 回退。
- 已加载但非对象，或 `pthRelative` / `gfrMlMin` 缺失、非数值、非有限或为负时抛错，本轮不写状态，不用回退值掩盖损坏状态。
- 自身缺状态或缺字段时通过 `finiteOr` 回落到 `9.5 mg/dL` 与 `100 g`。

## 2. 字段与单位

两个字段均为 `absolute`，`initialState = { mgDl: 9.5, boneStoreG: 100 }`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `mgDl` | `mg/dL` | 血钙浓度代理，钳位 `[0, 20]`；`9.5` 为工程参考设定点，不区分白蛋白校正或离子钙，不是实验室参考区间 |
| `boneStoreG` | `g` | 骨钙缓冲库存量，钳位 `[0, 200]`；只作质量缓冲，不是骨钙总量、骨密度或可交换钙池测量 |

输出只含两个有限数字段，JSON-safe。

## 3. 方程与参数

设 `prevMgDl = finiteOr(prev.mgDl, 9.5)`、`prevBoneStoreG = finiteOr(prev.boneStoreG, 100)`、`dtMin = io.dt / 60`，`pth = parathyroid.pthRelative`（未加载按 1）、`gfr = blood.gfrMlMin`（未加载按 100）：

```text
releaseG   = pth > 1
  ? min(boneReleaseRateGPerMin × (pth − 1) × dtMin, prevBoneStoreG)
  : 0
rawDepositG = pth < 1
  ? boneDepositRateGPerMin × (1 − pth) × dtMin
  : 0
depositG   = min(rawDepositG, max(0, boneCapacityG − prevBoneStoreG))
excretionG = gfr × calciumExcretionPerMlG × max(0, 1 − pth) × dtMin
boneStoreG = clamp(prevBoneStoreG − releaseG + depositG, 0, boneCapacityG)
mgDl       = clamp(prevMgDl + (releaseG − depositG − excretionG) × 1000 / distributionVolumeDl, 0, 20)
```

- **单位修正（`× 1000 / distributionVolumeDl`）：** `releaseG`、`depositG`、`excretionG` 单位为 `g`，乘 `1000` 换算为 `mg` 后除以表观分布体积 `140 dL`，直接得到 `mg/dL` 增量。
- **骨库满容截断：** `depositG` 在扣减血钙之前先按剩余骨容量 `max(0, boneCapacityG - prevBoneStoreG)` 截断，避免骨库在 `200 g` 封顶后仍继续从血钙凭空扣除质量，保证血—骨钙质量守恒。骨库耗尽（`prevBoneStoreG = 0`）时 `releaseG = 0`，同样不会透支为负。
- **肾排泄代理：** `pth >= 1` 时 `excretionG = 0`（视为完全重吸收）；`pth < 1` 时随 `(1 − pth)` 线性增加。因此 `pth = 1` 时 `9.5 mg/dL` 为精确静息稳态设定点。

同目录参数（`owner: calcium`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `calcium.referenceMgDl` | 9.5 | `mg/dL` | `design` | `source: null`；血钙参考值与旧档初值工程占位，不做白蛋白校正，不是人群正常值 |
| `calcium.boneStoreInitialG` | 100 | `g` | `design` | `source: null`；骨钙库初始量工程占位，不是骨钙总量或骨密度 |
| `calcium.boneCapacityG` | 200 | `g` | `design` | `source: null`；骨钙库容量上限工程占位，只用于钳位 |
| `calcium.boneReleaseRateGPerMin` | 0.0004 | `g/min` | `design` | `source: null`；`pth > 1` 每单位超额的骨钙释放速率，不是破骨细胞活性或实测钙流率 |
| `calcium.boneDepositRateGPerMin` | 0.0004 | `g/min` | `design` | `source: null`；`pth < 1` 每单位缺额的骨钙沉积速率，不是成骨细胞活性或实测钙流率 |
| `calcium.calciumExcretionPerMlG` | 0.000001 | `g/mL` | `design` | `source: null`；每毫升 GFR 对应的肾钙排泄基准质量（乘 `max(0, 1 − pth)`），作为 PTH 促重吸收代理 |
| `calcium.distributionVolumeDl` | 140 | `dL` | `design` | `source: null`；血钙表观分布体积工程占位，不是血浆容量或细胞外液实测 |

七项参数的 `range` 均只是工程调参范围。

## 4. 消费者

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| [`parathyroid`](../../human-organs/parathyroid/README.md) | 轮初 `bloodCalcium.mgDl` | 调节 `pthRelative` 目标，形成负反馈环路 |
| [`interoception`](../../human-organs/brain/README.md) | 轮初 `bloodCalcium.mgDl` | 软读输出 `hypocalcemiaMm = clamp(50 × (9.5 − mgDl), 0, 100)` 与 `hypercalcemiaMm = clamp(50 × (mgDl − 9.5), 0, 100)`；未加载或非有限按 `9.5`（两读数为 `0`）。两读数不进入 `discomfort` 或 `brainNotify`（`notify.ts` 未纳入两钙通道）；若加载且达到阈值，`body_state` 会将其转为纯定性感受（原始数值见 `GET /state` / `gateway.getState()`） |

- `interoception.ts` 已接好上述软读逻辑；在当前三份清单尚未挂载 `bloodCalcium` 时，`hypocalcemiaMm` 与 `hypercalcemiaMm` 恒为 `0`。

## 5. 未建模与未验证

**未建模：**

- 维生素 D（骨化三醇）与饮食肠道钙吸收（`eat` / `drink` 不含钙载荷）。
- 肾小管各段钙重吸收的分子机制、转运体、尿钙排泄量进水账/膀胱、肾结石或高钙尿症。
- 降钙素、血浆白蛋白结合与游离离子钙区分、酸碱平衡对游离钙的影响、钙磷乘积与磷酸盐。
- 骨密度、骨折、骨质疏松/骨软化、低钙抽搐或高钙心电图改变（`hypocalcemiaMm` / `hypercalcemiaMm` 只是线性代理读数）。
- 年龄、性别、妊娠/哺乳钙消耗与个体差异。

**未验证：** 没有骨钙流率、肾钙排泄、表观分布体积或症状斜率的直接人体来源、独立数据、临床验证或真实 DSH 会话验收；且当前尚未挂载进三份身体清单，未进入默认 Gateway 运行。全部参数与公式均属 `design`、`source: null` 的工程假设，不能称拟合或 `validated`。

## 6. 证据入口

- 设计：[`2026-11-24-parathyroid-calcium-design.md`](../../../docs/superpowers/specs/2026-11-24-parathyroid-calcium-design.md)
- 模块测试：[`test/organs.blood-calcium.test.mjs`](../../../test/organs.blood-calcium.test.mjs)
- 上游闭环测试：[`test/organs.parathyroid.test.mjs`](../../../test/organs.parathyroid.test.mjs)
- 上下游：[`parathyroid`](../../human-organs/parathyroid/README.md)、[`blood`](../blood/README.md)、[`brain`](../../human-organs/brain/README.md)
- 共享来源登记簿：[`../../human-organs/references/source-index.csv`](../../human-organs/references/source-index.csv)（本切片未新增来源行）
