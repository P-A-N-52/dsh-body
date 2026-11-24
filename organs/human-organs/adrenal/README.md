# 肾上腺（adrenal）：ACTH 驱动的皮质醇相对信号

**功能标签：** 内分泌（HPA 轴外周端）。

`adrenal/` 目前只有一个部位 `adrenal`，脚本为 `cortisol.ts`，没有动作、通知或 `transfer`，也不写其他部位。它把轮初 `pituitary.acthRelative` 一阶趋近成 `cortisolRelative`（皮质醇相对量，1 为工程基线）：ACTH 高于基线时皮质醇上升，低于基线时下降。皮质醇的消费者是 `liver`（低血糖释放速率乘该信号）与 `interoception`（转成 `stressMm` 读数）；皮质醇还经 `hypothalamusEndocrine` / `pituitary` 反向抑制 CRH/ACTH。本切片只建相对信号与一阶时滞，不是血浆皮质醇、ACTH 剂量反应、HPA 轴时程或临床应激模型。

实现状态：脚本、参数与模块契约测试已落地；当前根清单为 38 部位、34 份唯一参数文件，女性清单为 41 部位、37 份，男性清单为 40 部位、36 份；硬闭包为根与男性 15 个部位、女性 17 个部位，本切片不新增 `transfer`。`adrenal.responseHalfTimeMin` 是 `design`、`source: null`，没有登记人体来源。本文只描述离线模型与契约，未做真实 DSH 会话、激素实测或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `cortisol.ts` | `adrenal` | `cortisolRelative` | 自己的轮初状态；轮初 `pituitary.acthRelative`（未加载垂体时按 1）；`io.dt` | `cortisol.parameters.json` |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- 只读轮初快照。垂体本轮写出的新 ACTH 最早下一轮才改变皮质醇；`liver` 与 `interoception` 本轮读到的也是轮初皮质醇，形成一轮滞后。
- `pituitary` 是可选部位：未加载时 `acthRelative` 按 1 回退，皮质醇保持基线。已加载但 `acthRelative` 缺失、非数值、非有限或为负时抛错，本轮不写状态，由 Gateway 整轮作废。
- 自身旧档缺 `cortisolRelative` 时按 `initialState` 的 1 处理；该值不是人体正常值，只是工程基线。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `cortisolRelative` | `1` | 皮质醇相对量，1 表示未受刺激的工程基线。不是 `µg/dL`、`nmol/L`、分泌率、血浆浓度或 ACTH 浓度，不能与实测值换算 |

初值 `{ cortisolRelative: 1 }`；字段是 `absolute`。输出只有一个有限数字段，JSON-safe。合法 0 是有效相对信号，不是缺失。

## 3. 方程与参数

设 `prevCortisol = prev.cortisolRelative`，`ACTH = 轮初 pituitary.acthRelative`（未加载垂体时按 1），`dtMin = io.dt / 60`：

```text
cortisolRelative = clamp(
  ACTH + (prevCortisol − ACTH) × 2^(−dtMin / responseHalfTimeMin),
  0, 3
)
```

- 一阶趋近的目标就是轮初 ACTH；输出 `cortisolRelative` 显式钳在 `[0, 3]`，确保极端上游输入不越界。
- `dtMin = responseHalfTimeMin` 时距离减半；60 s 一轮时每轮保留 `2^(−1/15)` 的距离。
- `ACTH = 1` 且 `prev = 1` 时皮质醇精确保持 1。ACTH 高于 1 时皮质醇单调上移，低于 1 时下移。

同目录参数（`owner: adrenal`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `adrenal.responseHalfTimeMin` | 15 | `min` | `design` | `source: null`；皮质醇相对信号向轮初 ACTH 一阶趋近的半时工程占位。不是实测 HPA 轴响应时间、皮质醇半衰期或 ACTH 剂量反应；`range` 只是工程调参范围。未来由具备 HPA 轴时程的证据替换 |

## 4. 消费者与负反馈

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| `liver` | `cortisolRelative` | 低血糖或高胰高血糖素时的释放速率乘该信号；皮质醇高于 1 时肝糖输出增加 |
| `interoception` | `cortisolRelative` | `stressMm = clamp(100 × (cortisolRelative − 1) / 2, 0, 100)`；未加载或非有限时按 0 |
| `hypothalamusEndocrine` | `cortisolRelative` | 皮质醇高于 1 时压低 CRH 目标，低于 1 时抬高目标 |
| `pituitary` | `cortisolRelative` | 皮质醇高于 1 时压低 ACTH 目标，低于 1 时抬高目标 |

`liver` 采用平滑比例内源产糖速率公式，整体乘以 `max(0, cortisolRelative)` 并受存量与速率上限钳位；皮质醇只是释放速率的乘数，不会单独启动或直接改写血糖质量。`stressMm` 只是 0–100 mm 代理读数，不进入 `discomfort`，不触发通知或动作。负反馈闭合顺序与 HPT 轴相同：第 N 轮写出的皮质醇最早第 N+1 轮被下丘脑、垂体和消费者读到；新 CRH/ACTH 再晚一轮进入下游。

## 5. 旧档、重启与异常

- **旧档缺 `adrenal`：** 启动时补 `cortisolRelative = 1`，不反推历史 ACTH 或皮质醇；`pituitary`、`liver`、`interoception` 等已有状态不重置。
- **重启：** 保留已提交的皮质醇；下一轮按存档中的皮质醇与轮初 ACTH 继续一阶趋近，不重置为 1，也不按现实时间补算。本部位没有 `resetOnStart` 字段。
- **缺垂体：** 直接调用模块时按 `ACTH = 1` 回退；完整清单不依赖该回退，根清单同时加载垂体。
- **已加载但异常：** `pituitary.acthRelative` 缺失、非数值、非有限或为负时抛错，本轮不写；合法 0 是有效相对信号，不是缺失。

## 6. 未建模与未验证

**未建模：**

- 肾上腺髓质与肾上腺素/去甲肾上腺素、醛固酮、肾素—血管紧张素—醛固酮系统。
- 皮质醇结合球蛋白、游离皮质醇比例、绝对浓度、分泌率、脉冲式分泌与昼夜节律。
- 应激输入、疾病、药物、手术、肾上腺增生或功能减退；本切片没有“应激事件”动作或输入，只响应垂体 ACTH。
- 皮质醇对免疫、炎症、骨、脂肪分布、情绪、睡眠与代谢的其它效应；本切片只经 `liver` 与 `stressMm` 暴露。
- 负反馈在垂体/下丘脑侧的完整剂量反应与受体动力学；本切片只有线性目标与一阶时滞。

**未验证：** 没有皮质醇绝对浓度、ACTH 剂量反应或 HPA 轴时程的直接证据、独立数据、临床验证或真实 DSH 会话验收。15 min 半时、一阶指数形式与 `1` 基线全是 `design`、`source: null` 的工程假设，不能称拟合、实测或 `validated`。本切片未做 28 部位性能实测。

## 7. 证据入口

- 设计：[`2026-11-24-endocrine-axes-design.md`](../../../docs/superpowers/specs/2026-11-24-endocrine-axes-design.md)
- 模块契约测试：[`test/organs.adrenal.test.mjs`](../../../test/organs.adrenal.test.mjs)
- 真实 Gateway 轴测试：[`test/organs.endocrine-gateway.test.mjs`](../../../test/organs.endocrine-gateway.test.mjs)
- 上游：[`pituitary`](../brain/README.md) 与 [`hypothalamusEndocrine`](../brain/README.md) 的脑 README
- 消费者：[`liver`](../liver/README.md) 与 [`brain`](../brain/README.md)
