# 甲状腺（thyroid）：TSH 驱动的 T4 相对信号

**功能标签：** 内分泌（HPT 轴外周端）。

`thyroid/` 目前只有一个部位 `thyroid`，脚本为 `thyroid.ts`，没有动作、通知或 `transfer`，也不写其他部位。它把轮初 `pituitary.tshRelative` 一阶趋近成 `thyroxineRelative`（T4 相对量，0–3，1 为工程基线）：TSH 高于基线时 T4 上升，低于基线时下降。T4 的消费者是 `bloodOxygen`（基础氧耗缩放）以及 `hypothalamusEndocrine` / `pituitary` 的负反馈读取；T4 升高会反向压低 TRH 与 TSH。本切片只建相对信号与一阶时滞，不是甲状腺功能检查、T4 浓度、分泌率或临床甲状腺模型。

实现状态：脚本、参数与模块契约测试已落地；当前根清单为 43 部位、39 份唯一参数文件，女性清单为 46 部位、42 份，男性清单为 45 部位、41 份；硬闭包为根与男性 15 个部位、女性 17 个部位，本切片不新增 `transfer`。`thyroid.thyroxineHalfTimeMin = 1440 min`（24 h）引用 `SRC-NICOLOFF-1972` 游离 T3 清除半衰期作为表观代谢池时间尺度（标 `prior`），其余方程形式与钳位仍为 `design`。本文只描述离线模型与契约，未做真实 DSH 会话、激素实测或临床验证。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "thyroid.thyroxineHalfTimeMin": 1500 } }
```

### thyroid.parameters.json

参数文件：[`thyroid.parameters.json`](thyroid.parameters.json)。入口及清单：[`thyroid.ts`](thyroid.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json)）。读取脚本：[`thyroid.ts`](thyroid.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `thyroid.thyroxineHalfTimeMin` | `1440` | `min` | `prior` | 无 | — |

<!-- organ-parameters:end -->

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `thyroid.ts` | `thyroid` | `thyroxineRelative` | 自己的轮初状态；轮初 `pituitary.tshRelative`（未加载垂体时按 1）；`io.dt` | `thyroid.parameters.json` |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- 只读轮初快照。垂体本轮写出的新 TSH 最早下一轮才改变 T4；`bloodOxygen` 本轮读到的也是轮初 T4，形成一轮滞后。
- `pituitary` 是可选部位：未加载时 `tshRelative` 按 1 回退，T4 保持基线。已加载但 `tshRelative` 缺失、非数值、非有限或为负时抛错，本轮不写状态，由 Gateway 整轮作废。
- 自身旧档缺 `thyroxineRelative` 时按 `initialState` 的 1 处理；该值不是人体正常值，只是工程基线。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `thyroxineRelative` | `1` | T4 相对量，0–3；1 表示未受刺激的工程基线。不是 T4/T3 浓度、游离激素、分泌率或代谢率，不能与 `pmol/L`、`µIU/mL` 等实测值换算 |

初值 `{ thyroxineRelative: 1 }`；字段是 `absolute`。`1` 只用于新部位或旧档补键，不反推历史。状态只含一个有限数字，JSON-safe。

## 3. 方程与参数

设 `prevThyroxine = prev.thyroxineRelative`，`TSH = 轮初 pituitary.tshRelative`（未加载垂体时按 1），`dtMin = io.dt / 60`：

```text
thyroxineRelative = clamp(
  TSH + (prevThyroxine − TSH) × 2^(−dtMin / thyroxineHalfTimeMin),
  0, 3
)
```

- 一阶趋近的目标就是轮初 TSH；输出 `thyroxineRelative` 显式钳在 `[0, 3]`，防止极大上游信号越界。
- `dtMin = thyroxineHalfTimeMin` 时距离减半；60 s 一轮时每轮保留 `2^(−1/1440)` 的距离（替代旧版 60 min 瞬时响应占位）。
- `TSH = 1` 且 `prev = 1` 时 T4 精确保持 1。TSH 高于 1 时 T4 单调上移，低于 1 时下移。

同目录参数（`owner: thyroid`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `thyroid.thyroxineHalfTimeMin` | 1440 | `min` | `prior` | `SRC-NICOLOFF-1972`（[`nicoloff-1972.md`](references/notes/nicoloff-1972.md)）；Nicoloff 1972 报道正常组活性 T3 同位素示踪平均半衰期 `1.0 d = 1440 min`，用作单池表观调节尺度。未建模 T4 约 7 天超慢储库与外周脱碘转换 |

## 4. 消费者与负反馈

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| `bloodOxygen` | `thyroid.thyroxineRelative` | 基础氧耗乘 `max(0.2, 0.6 + 0.4 × T4)`；未加载甲状腺时保持 `basalMlMin` |
| `hypothalamusEndocrine` | `thyroid.thyroxineRelative` | T4 高于 1 时压低 TRH 目标，低于 1 时抬高目标 |
| `pituitary` | `thyroid.thyroxineRelative` | T4 高于 1 时压低 TSH 目标，低于 1 时抬高目标 |

`max(0.2, 0.6 + 0.4 × T4)` 使 T4 = 1 时基础需氧正好等于 `1.0 × basalMlMin = 250 mL/min`（与静息参考和热平衡对齐）、T4 = 0 时为 `0.6 × basalMlMin`（最低下限 `0.2 × basalMlMin`）、T4 = 2 时为 `1.4 × basalMlMin`；整条曲线是 `design` 常量，不是代谢率或甲状腺功能测量。T4 只经 `bloodOxygen` 改变基础氧耗项，不直接写血氧质量、血糖、体温、心率或行为；活动附加氧耗与消化氧耗仍按各自公式，不随 T4 缩放。

负反馈闭合顺序（60 s 一轮）：

```text
第 N 轮   hypothalamusEndocrine / pituitary / thyroid 读同一份轮初快照
          thyroid 写出下一轮 T4
第 N+1 轮 bloodOxygen 读第 N 轮 T4，缩放基础氧耗
          hypothalamusEndocrine 读第 N 轮 T4，调整 TRH 目标
          pituitary 读第 N 轮 T4，调整 TSH 目标
第 N+2 轮 新的 TRH/TSH 才进入下游
```

因此 T4 升高对 TRH/TSH 的抑制不是同轮发生的，而是下一轮及之后；这是轮初快照模型的时滞，不是额外的生理延迟参数。

## 5. 旧档、重启与异常

- **旧档缺 `thyroid`：** 启动时补 `thyroxineRelative = 1`，不反推历史 TSH 或 T4；`pituitary`、`bloodOxygen` 等已有状态不重置。
- **重启：** 保留已提交的 T4；下一轮按存档中的 T4 与轮初 TSH 继续一阶趋近，不重置为 1，也不按现实时间补算。本部位没有 `resetOnStart` 字段。
- **缺垂体：** 直接调用模块时按 `TSH = 1` 回退；完整清单不依赖该回退，根清单同时加载垂体。
- **已加载但异常：** `pituitary.tshRelative` 缺失、非数值、非有限或为负时抛错，本轮不写；合法 0 是有效相对信号，不是缺失。

## 6. 未建模与未验证

**未建模：**

- T3、反 T3、甲状腺结合球蛋白、游离激素比例、脱碘酶与组织转换。
- 碘摄入、甲状腺体积、结节、甲状腺炎、甲减/甲亢、药物与手术。
- 脉冲式分泌、昼夜节律、年龄、性别、体重与个体差异。
- 绝对浓度、分泌率、清除率与临床检验单位；`thyroxineRelative` 不能与任何实测值换算。
- 甲状腺对体温、心率、胃肠动力、情绪与体重的直接效应；本切片只经 `bloodOxygen` 调基础氧耗。
- 甲状旁腺与血钙：本切片不建 PTH、骨交换、肾钙排泄或饮食钙，故暂不建血钙轴。

**未验证：** 没有完整 HPT 轴人体动态闭合验证、独立临床数据或真实 DSH 会话验收。`thyroid.thyroxineHalfTimeMin = 1440 min` 仅标 `prior`（锚定 Nicoloff 1972 T3 代谢池清除均值，未建双池脱碘）；一阶指数形式、`0–3` 范围与 `1` 基线仍属 `design`，不能称拟合或 `validated`。

## 7. 证据入口

- 文献笔记：[`references/notes/nicoloff-1972.md`](references/notes/nicoloff-1972.md)（`SRC-NICOLOFF-1972`）
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 设计：[`2026-11-24-endocrine-axes-design.md`](../../../docs/superpowers/specs/2026-11-24-endocrine-axes-design.md) 与 [`2026-11-26-reproductive-lactation-reward-endocrine-design.md`](../../../docs/superpowers/specs/2026-11-26-reproductive-lactation-reward-endocrine-design.md)
- 模块契约测试：[`test/organs.thyroid.test.mjs`](../../../test/organs.thyroid.test.mjs)
- 真实 Gateway 轴测试：[`test/organs.endocrine-gateway.test.mjs`](../../../test/organs.endocrine-gateway.test.mjs)
- 上游：[`pituitary`](../brain/README.md) 与 [`hypothalamusEndocrine`](../brain/README.md) 的脑 README
- 血氧消费者：[`blood-oxygen`](../../human-compartments/blood-oxygen/README.md)
