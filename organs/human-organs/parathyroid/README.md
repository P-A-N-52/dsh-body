# 甲状旁腺（parathyroid）：血钙驱动的 PTH 相对信号

**功能标签：** 内分泌（甲状旁腺—血钙负反馈环路）。

`parathyroid/` 目前只有一个部位 `parathyroid`，脚本为 [`parathyroid.ts`](parathyroid.ts)，没有动作、通知或 `transfer`，也不写其他部位。它读取轮初 `bloodCalcium.mgDl`，通过比例目标与 15 min 一阶趋近输出无量纲相对甲状旁腺激素信号 `pthRelative`（范围 0–3，1 为工程基线）：血钙低于参考值时 PTH 上升，高于参考值时下降。唯一的消费者是 [`bloodCalcium`](../../human-compartments/calcium/README.md)，用 `pthRelative` 决定骨钙释放或沉积以及肾钙重吸收代理，构成闭环负反馈。

**实现与挂载状态：** 脚本、参数与单元测试已实现，**当前尚未挂载进三份清单**（[`body-modules.json`](../../../body-modules.json)、[`body-modules.female.json`](../../../body-modules.female.json) 与 [`body-modules.male.json`](../../../body-modules.male.json) 均未注册 `parathyroid.ts`）。两项参数全部 `design`、`source: null`。本文只描述离线模块与契约，未做真实 DSH 会话、PTH 实测或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`parathyroid.ts`](parathyroid.ts) | `parathyroid` | `pthRelative` | 自己的轮初状态；轮初 `bloodCalcium.mgDl`（未加载按 9.5）；`io.dt` | [`parathyroid.parameters.json`](parathyroid.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- `bloodCalcium` 是可选上游：未加载（`undefined`）时按参考值 `referenceCalciumMgDl = 9.5` 回退，PTH 向 1 衰减。
- 若 `bloodCalcium` 已加载但为 `null`/非对象，或 `mgDl` 缺失、非数值、非有限或为负，脚本立即抛错，本轮不写状态，不用参考值掩盖损坏状态。
- 自身旧档缺状态或缺字段时通过 `finiteOr(prev.pthRelative, 1)` 回落到 1。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `pthRelative` | `1` | PTH 相对量，0–3；`1` 表示未受刺激的工程基线。不是血浆 PTH 浓度（`pg/mL`）、分泌率或临床检验值，不能与实测值换算 |

`initialState = { pthRelative: 1 }`，字段为 `absolute`。输出只含一个有限数字段，JSON-safe。

## 3. 方程与参数

设 `prevPth = finiteOr(prev.pthRelative, 1)`，`dtMin = io.dt / 60`，脚本内 `design` 常量 `pthHalfTimeMin = 15 min`、`pthTargetRange = [0, 3]`：

```text
pthTarget = clamp(1 + pthGain × (referenceCalciumMgDl − bloodCalcium.mgDl), 0, 3)
pthRelative = pthTarget + (prevPth − pthTarget) × 2^(−dtMin / 15)
```

- 在默认 `referenceCalciumMgDl = 9.5`、`pthGain = 0.5` 下：`mgDl = 9.5` 时 `pthTarget = 1`；血钙每低于 9.5 1 mg/dL，目标上升 0.5（最低 5.5 mg/dL 触顶 3）；高于 9.5 1 mg/dL，目标下降 0.5（≥11.5 mg/dL 触底 0）。
- 只读轮初快照，因此血钙变化到 PTH 响应有一轮滞后，PTH 变化再到 [`bloodCalcium`](../../human-compartments/calcium/README.md) 释放/沉积又有一轮滞后。

同目录参数（`owner: parathyroid`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `parathyroid.referenceCalciumMgDl` | 9.5 | `mg/dL` | `design` | `source: null`；PTH 目标的血钙参考值工程占位，不区分白蛋白校正，不是人群正常值或实验室参考区间 |
| `parathyroid.pthGain` | 0.5 | `1` | `design` | `source: null`；血钙每偏离参考值 1 mg/dL 时 PTH 相对目标的斜率工程占位，不是钙感受受体敏感性或 PTH 分泌曲线 |

两项参数的 `range` 均只是工程调参范围。

## 4. 消费者与反馈闭环

```text
bloodCalcium.mgDl ──(轮初读)──► parathyroid.pthRelative
         ▲                              │
         └──────────(轮初读)────────────┘
```

- `bloodCalcium` 读轮初 `pthRelative`：高于 1 时从骨钙库释放钙、并可视作完全重吸收（肾钙排泄为 0）；低于 1 时向骨钙库沉积钙并按 `(1 − pthRelative)` 比例增加尿钙排泄；等于 1 时在 `9.5 mg/dL` 处保持静息稳态。详见 [`calcium` README](../../human-compartments/calcium/README.md)。

## 5. 未建模与未验证

**未建模：**

- 维生素 D（骨化三醇）合成与反馈、肠道钙吸收、降钙素。
- 钙敏感受体（CaSR）非线性 S 形剂量反应、PTH 分泌与清除半衰期（15 min 半时是脚本内 `design` 常量）。
- 骨密度、骨折、骨代谢疾病、肾性骨病、钙磷乘积与磷酸盐调节。
- 甲旁亢/甲旁减、手术、昼夜节律、年龄/性别与个体差异。

**未验证：** 没有 PTH 分泌/清除动力学或钙敏感受体曲线的直接人体来源、独立数据、临床验证或真实 DSH 会话验收；且当前尚未挂载进三份身体清单，未进入默认 Gateway 运行。15 min 半时、0–3 范围、`9.5 mg/dL` 与 `0.5` 斜率均属 `design`、`source: null` 的工程假设，不能称拟合或 `validated`。

## 6. 证据入口

- 设计：[`2026-11-24-parathyroid-calcium-design.md`](../../../docs/superpowers/specs/2026-11-24-parathyroid-calcium-design.md)
- 模块测试：[`test/organs.parathyroid.test.mjs`](../../../test/organs.parathyroid.test.mjs)
- 血钙环路测试：[`test/organs.blood-calcium.test.mjs`](../../../test/organs.blood-calcium.test.mjs)
- 消费者：[`calcium`](../../human-compartments/calcium/README.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片未新增来源行）
