# 睾丸（testes）：昼夜节律睾酮相对信号

**功能标签：** 内分泌 / 男性生殖。**仅男性清单加载**（[`body-modules.male.json`](../../../body-modules.male.json)），根清单与女性清单不加载本部位。

`testes/` 目前只有一个部位 `testes`，脚本为 [`testosterone.ts`](testosterone.ts)，没有动作、通知或 `transfer`，也不写其他部位。它以仿真的昼夜时间驱动 `testosteroneRelative`（无量纲睾酮相对信号，`1` 表示工程基线），以 60 min 半时一阶趋近 08:00 峰值 1.1、20:00 谷值 0.9 的余弦昼夜目标。`testosteroneRelative` 不是血清睾酮浓度、游离睾酮、分泌率或脉冲幅度，不能与 `nmol/L`、`ng/dL` 等实测值换算。

**实现状态：** 脚本、参数与单元测试已落地，并已挂载进男性清单 `body-modules.male.json`（当前根清单 38 部位 / 34 份唯一参数文件，女性清单 41 部位 / 37 份，男性清单 40 部位 / 36 份；硬 `transfer` 闭包仍为根与男性 15 部位、女性 17 部位）。三个参数全部 `design`、`source: null`。本文只描述当前代码实现的模型与契约，未做真实 DSH 会话、激素实测或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`testosterone.ts`](testosterone.ts) | `testes` | `testosteroneRelative` | 自己的轮初状态；`io.dt`；`io.simulatedSeconds` | [`testosterone.parameters.json`](testosterone.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- 只读 `io.simulatedSeconds` 与 `io.dt`，绝不读取现实时间或本地钟点；同一仿真时刻在任意真实时间运行结果一致。仿真起点 `simulatedSeconds = 0` 对应 `hour = 0`。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `testosteroneRelative` | `1` | 睾酮相对量，以 `1` 为工程基线；不是血清睾酮浓度、游离激素、分泌率或脉冲幅度，不能与 `nmol/L`、`ng/dL` 等实测值换算 |

`initialState = { testosteroneRelative: 1 }`，字段为 `absolute`。状态只含一个有限数字，JSON-safe；旧存档缺 `testes` 时按 `1` 起步，不反推历史节律或昼夜相位。

## 3. 方程与参数

设 `prev` 为轮初自身状态，`dtMin = io.dt / 60`，`hour = (io.simulatedSeconds / 3600) % 24`：

```text
target = baselineRelative + circadianAmplitude × cos(2π × (hour − 8) / 24)
testosteroneRelative = target + (prev.testosteroneRelative − target) × 2^(−dtMin / responseHalfTimeMin)
```

- 默认参数下昼夜目标围绕 1.0 在 `[0.9, 1.1]` 之间平滑振荡：仿真 08:00 达到峰值 `1.1`，20:00 达到谷值 `0.9`。
- 本切片没有外源刺激或负反馈驱动，`responseHalfTimeMin = 60 min` 主要作用于旧存档或预置偏离值的回落以及跟随余弦目标的轻微相位滞后。

同目录参数（`owner: testes`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `testes.baselineRelative` | 1 | `1` | `design` | `source: null`；工程基线，不是血清睾酮浓度、分泌率或人体正常值 |
| `testes.circadianAmplitude` | 0.1 | `1` | `design` | `source: null`；相对基线的余弦振幅（08:00 峰、20:00 谷），纯工程假设 |
| `testes.responseHalfTimeMin` | 60 | `min` | `design` | `source: null`；向当前昼夜目标一阶趋近的工程半时，不是睾酮半衰期或 HPG 轴动力学 |

三项参数的 `range` 均只是工程调参范围，不是人体测量范围。

## 4. 消费者与时序

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| [`sexualResponse`](../sexual-response/README.md) | 轮初 `testes.testosteroneRelative` | 按 `factor = 0.5 + 0.5 × testosteroneRelative` 缩放唤醒目标 `clamp(100 × sexIntensity × factor, 0, 100)`；当 `testosteroneRelative > 1` 时上升半时缩短为 `arousalHalfTimeMin / factor` |
| [`interoception`](../brain/README.md) | 轮初 `testes.testosteroneRelative` | `libidoMm = clamp(100 × (testosteroneRelative − 0.5), 0, 100)`；未加载或非有限按 `0.5`（对应 `0 mm`），基线 `1` 对应 `50 mm` |

- 两个消费者均做可选软读，且只读轮初快照，形成一轮滞后。
- `interoception.libidoMm` 只作为独立读数通过 `body_state` / `GET /state` 暴露，不进入 `discomfort`，也不触发 `brainNotify`。

## 5. 未建模与未验证

**未建模：**

- HPG 轴（GnRH / LH / FSH）驱动与睾酮对下丘脑/垂体的负反馈。
- 脉冲式分泌、昼夜相位个体差异、性腺功能减退/亢进、年龄/BMI/疾病/药物影响。
- 性激素结合球蛋白（SHBG）、游离睾酮比例与绝对浓度；不能与任何实验室单位换算。
- 睾酮对骨骼肌质量、骨代谢、造血、情绪或行为的长期效应；本切片只接 `sexualResponse` 与 `interoception.libidoMm`。
- 与 [`epididymis`](../epididymis/README.md) 的精子发生关联：本切片不把睾酮写入附睾储量或恢复速率。

**未验证：** 没有血清睾酮昼夜幅度、半衰期、性欲斜率或唤醒增益的直接人体来源、独立数据、临床验证或真实 DSH 会话验收。全部参数与公式均属 `design`、`source: null` 的工程假设，不能称拟合或 `validated`。

## 6. 证据入口

- 设计：[`2026-11-24-male-reproductive-design.md`](../../../docs/superpowers/specs/2026-11-24-male-reproductive-design.md)
- 模块测试：[`test/organs.testes.test.mjs`](../../../test/organs.testes.test.mjs)
- 真实 Gateway 男性清单测试：[`test/organs.male-reproductive-gateway.test.mjs`](../../../test/organs.male-reproductive-gateway.test.mjs)
- 消费者：[`sexual-response`](../sexual-response/README.md)、[`brain`](../brain/README.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片未新增来源行）
