# 睾丸（testes）：昼夜节律睾酮相对信号

**功能标签：** 内分泌 / 男性生殖。**仅男性清单加载**（[`body-modules.male.json`](../../../body-modules.male.json)），根清单与女性清单不加载本部位。

`testes/` 目前只有一个部位 `testes`，脚本为 [`testosterone.ts`](testosterone.ts)，没有动作、通知或 `transfer`，也不写其他部位。它通过 `lib/circadian.js` 按本地时钟 `io.wallTimeMs`（未传入时回退 `io.simulatedSeconds`）驱动 `testosteroneRelative`（无量纲睾酮相对信号，`1` 表示工程基线），以 60 min 半时一阶趋近当地 08:00 峰值 1.1、20:00 谷值 0.9 的余弦昼夜目标，并参考 `SRC-LEPROULT-2011` 方向耦合 `sleep.sleepPressureMm`（重度睡眠欠债可温和抑制至多 `15%`）与高皮质醇应激抑制。

**实现状态：** 脚本、参数与单元测试已落地，并已挂载进男性清单 `body-modules.male.json`（当前根清单 43 部位 / 39 份唯一参数文件，女性清单 46 部位 / 42 份，男性清单 45 部位 / 41 份；硬 `transfer` 闭包仍为根与男性 15 部位、女性 17 部位）。参数均标 `design`（多日睡眠债抑制方向与 ~15% 量级引 `SRC-LEPROULT-2011`）。本文只描述当前代码实现的模型与契约，未做真实 DSH 会话、激素实测或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`testosterone.ts`](testosterone.ts) | `testes` | `testosteroneRelative`、`sleepDebtDays` | 轮初自身状态；`io.dt`、`io.simulatedSeconds`、`io.wallTimeMs`；可选 `sleep`、`adrenal.cortisolNmolL`、`pituitary.prolactinNgMl` | [`testosterone.parameters.json`](testosterone.parameters.json) |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- 优先使用 `io.wallTimeMs` 与本地/配置时区计算昼夜相位，缺失时回退 `io.simulatedSeconds`；多日睡眠债 `sleepDebtDays` 只随 `io.dt` 演化。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `testosteroneRelative` | `1` | 睾酮相对量，以 `1` 为工程基线；不是血清睾酮浓度、游离激素或分泌率 |
| `sleepDebtDays` | `d` | 连续多日高睡眠压力累积的工程睡眠债；清醒且 `sleepPressureMm > 60` 时按天累积，睡眠充足时按 36 h 半衰期恢复 |

`initialState = { testosteroneRelative: 1, sleepDebtDays: 0 }`，两字段均为 `absolute`，JSON-safe。

## 3. 方程与参数

- 昼夜目标围绕 `baselineRelative = 1` 在 `[0.9, 1.1]` 波动（当地 08:00 峰、20:00 谷），按 `responseHalfTimeMin = 60 min` 一阶趋近。
- 清醒睡眠压力高于 `60 mm` 时累积 `sleepDebtDays`，充足睡眠（压力低于 `30 mm` 或睡中）按 `36 h` 半衰期恢复；单夜偶发晚睡不会骤降，多日欠债最多温和压低目标 `15%`（`SRC-LEPROULT-2011`）。
- 高皮质醇（`cortisolNmolL / 180 > 1.5`）与高催乳素（`pituitary.prolactinNgMl > 25 ng/mL`）温和压低睾酮目标。
- 全部 9 项参数（含 `sleepDebtSuppressionThresholdMm = 60`、`sleepDebtMaxSuppressionFraction = 0.15`、`sleepDebtRecoveryHalfTimeHours = 36`、`stressCortisolSuppressionGain = 0.1`、`prolactinSuppressionGain = 0.006`）见 [`testosterone.parameters.json`](testosterone.parameters.json)，均标 `design`。

## 4. 消费者与时序

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| [`sexualResponse`](../sexual-response/README.md) | 轮初 `testes.testosteroneRelative` | 按 `factor = 0.5 + 0.5 × testosteroneRelative` 缩放唤醒目标；男性及中性保留 20 min 基础不应期（并随 `pituitary.prolactinNgMl > 14` 温和延长最多 +15 min） |
| [`interoception`](../brain/README.md) | 轮初 `testes.testosteroneRelative` | 男性基础 `libidoMm` 计算，并与 `reward.wantingMm` / `satietyMm`、高 PRL、不适、低血糖及高压力耦合 |

- 两个消费者均做可选软读，且只读轮初快照，形成一轮滞后。
- `interoception.libidoMm` 不进入 `discomfort`，现已受 `nsfw: true` 门控接入 `brainNotify` 与纯定性 `body_state`（默认 `nsfw: false` 时置 0 并屏蔽通知与暴露）；原始数值由 `GET /state` / `gateway.getState()` 返回。

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
