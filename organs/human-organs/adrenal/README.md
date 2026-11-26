# 肾上腺（adrenal）：ACTH Hill 驱动与实证消除的总皮质醇浓度

**功能标签：** 内分泌（HPA 轴外周端）。

`adrenal/` 只有一个部位 `adrenal`，脚本为 `cortisol.ts`，没有动作、通知或 `transfer`，也不写其他部位。它读取轮初 `pituitary.acthPgMl`（pg/mL），按 Sigmoid Hill 响应与 `49 min`（`SRC-KEENAN-2004`，`prior`）消除半衰期积分血浆总皮质醇浓度代理 `cortisolNmolL`（单位 `nmol/L`，静息平衡 `180 nmol/L`）。下游消费者按 `cortisolNmolL / 180` 归一化消费：`liver`（低血糖肝糖输出缩放）、`interoception`（转成 `stressMm`）、`testes`（高皮质醇应激抑制）以及 `hypothalamusEndocrine` / `pituitary`（CRH/ACTH 负反馈）。

实现状态：脚本、参数与模块契约测试已落地；当前根清单为 43 部位、39 份唯一参数文件，女性清单为 46 部位、42 份，男性清单为 45 部位、41 份；硬闭包为根与男性 15 个部位、女性 17 个部位，本切片不新增 `transfer`。`acthEc50PgMl = 26`、`maxSecretionNmolLPerMin = 10` 与 `eliminationHalfTimeMin = 49` 标为 `prior`（`SRC-KEENAN-2004`）；`referenceCortisolNmolL = 180`、`referenceActhPgMl = 12` 与 `hillExponent = 1.85` 标为 `design`。本文只描述离线模型与契约，未做真实 DSH 会话、游离皮质醇多室拟合或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `cortisol.ts` | `adrenal` | `cortisolNmolL` | 自己的轮初状态；轮初 `pituitary.acthPgMl`（未加载垂体时按 12 pg/mL）；`io.dt` | `cortisol.parameters.json` |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- `pituitary` 是可选部位：未加载时 `acthPgMl` 按 12 pg/mL 回退。已加载但 `acthPgMl` 缺失、非数值、非有限或为负时抛错，本轮不写状态。
- 已全面统一为纯物理单位 `cortisolNmolL`（`nmol/L`），代码已移除旧相对字段回退；旧档不再读取相对字段偏差，缺字段按 `180 nmol/L` 起步。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `cortisolNmolL` | `nmol/L` | 血浆总皮质醇浓度代理，范围 `[0, 800]`，`180 nmol/L` 为静息参考基线（约 6% 游离量级对齐 Keenan 2004 24 h 游离均值 `11.5 nmol/L`）。未拆分快相游离皮质醇双室（1.8/4.1 min）或 CBG 结合动态 |

初值 `{ cortisolNmolL: 180 }`；字段是 `absolute`，JSON-safe。

## 3. 方程与参数

设 `prevCortisol` 为轮初浓度，`ACTH = pituitary.acthPgMl`（未加载按 12），`k = ln(2) / 49`：

```text
hill(a) = a <= 0 ? 0 : a^n / (EC50^n + a^n)          (EC50 = 26 pg/mL, n = 1.85)
basalSecretion = max(0, (180 × k − maxSec × hill(12)) / (1 − hill(12)))
secretion = basalSecretion + (maxSec − basalSecretion) × hill(ACTH)
steadyTarget = secretion / k
cortisolNmolL = clamp(steadyTarget + (prevCortisol − steadyTarget) × 2^(−dtMin / 49), 0, 800)
```

在 `ACTH = 12 pg/mL` 且 `prevCortisol = 180` 时，分泌与清除代数精确平衡，`cortisolNmolL` 保持精确 `180 nmol/L`。

同目录参数（`owner: adrenal`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与说明 |
| --- | ---: | --- | --- | --- |
| `adrenal.referenceCortisolNmolL` | 180 | `nmol/L` | `design` | `SRC-KEENAN-2004`；总皮质醇静息参考基线 |
| `adrenal.referenceActhPgMl` | 12 | `pg/mL` | `design` | `SRC-HORROCKS-1990`；与垂体静息 ACTH 对齐 |
| `adrenal.acthEc50PgMl` | 26 | `pg/mL` | `prior` | `SRC-KEENAN-2004`（n=32 去卷积 EC50 = 26 ± 2.4 ng/L SE） |
| `adrenal.maxSecretionNmolLPerMin` | 10 | `nmol/(L·min)` | `prior` | `SRC-KEENAN-2004`（n=32 最大效能 10 ± 1.8 nmol/(L·min) SE） |
| `adrenal.hillExponent` | 1.85 | `1` | `design` | `source: null`；Sigmoid Hill 陡度代理 |
| `adrenal.eliminationHalfTimeMin` | 49 | `min` | `prior` | `SRC-KEENAN-2004`（n=32 总皮质醇消除 t½ = 49 ± 2.4 min SE） |

## 4. 消费者与负反馈

`liver`、`interoception`、`testes`、`hypothalamusEndocrine` 与 `pituitary` 均通过 `ratio = cortisolNmolL / 180` 消费皮质醇信号；旧相对字段不是本次兼容承诺。

## 5. 未建模与未验证

**未建模：** 游离皮质醇双快时间尺度（1.8 / 4.1 min）、CBG 动态饱和、肾上腺髓质/醛固酮、免疫与疾病模型；外周脉冲仅平滑反映上游 CRH/CAR/交感变化。

**未验证：** 虽部分参数标 `prior`（`SRC-KEENAN-2004`），但整体闭环、稳态反解与下游比例系数仍为 `design`，未做真实 DSH 会话或独立临床验证，不称 `validated`。

## 6. 证据入口

- 文献笔记：[`references/notes/keenan-2004.md`](references/notes/keenan-2004.md)（`SRC-KEENAN-2004`）与 [`../brain/references/notes/horrocks-1990.md`](../brain/references/notes/horrocks-1990.md)
- 设计：[`2026-11-26-reproductive-lactation-reward-endocrine-design.md`](../../../docs/superpowers/specs/2026-11-26-reproductive-lactation-reward-endocrine-design.md)
- 模块契约与轴测试：[`test/organs.adrenal.test.mjs`](../../../test/organs.adrenal.test.mjs)、[`test/organs.endocrine-gateway.test.mjs`](../../../test/organs.endocrine-gateway.test.mjs)
