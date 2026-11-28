# 全身体成分（`bodyComposition`）

[脚本 `composition.ts`](composition.ts) 给根、男性和女性清单提供同一个**只读档案读数**。它不建脂肪库存，不参加 `add` / `transfer`，也不改变体液、血糖、泌乳、能量消耗或阈值。不新增动作、提醒或 DSH 工具。

**数值与留存。** 当前数值可在本机 `GET /state`、`gateway.getState()` 或模块 `io.read('bodyComposition')` 中查看；定性宿主工具 `body_state` 不返回原始数值。提交过的数值也可能写入存档旁的 `logs/state-history.jsonl`，按现有滚动保留策略管理，可经本机 `GET /logs/state` 或 `gateway.getStateHistory()` 读取。将 `profile.bodyFatPercent` 改为 `null` 或移除该字段只影响之后的读数，不会追溯擦除历史。分享日志前先检查其中是否含个人数据。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

此目录无独立参数 JSON。若下文列有共享 ID，只覆盖原 ID，不能给这个部位另造一套参数键。

该部位不通过 `parameters` 覆盖：输入只来自存档顶层 `profile`（如 `profile.bodyFatPercent`），不是下文的参数 ID；具体口径见下文手写说明。

入口：[`composition.ts`](composition.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json) / [可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。

<!-- organ-parameters:end -->

## 需要什么数据

只读 `body-state.json` 顶层 `profile`，没有独立 `*.parameters.json`。`weightKg` 是身体质量（kg，正有限数），缺省沿用 [`lib/parameters.js`](../../../lib/parameters.js) 的 `75 kg` 工程默认；`heightCm` 仍默认 `170 cm`，**不参与此计算**。`bodyFatPercent` 是脂肪质量占身体总质量的**百分数（不是 0–1 小数）**，可来自已有同口径资料，也可为虚构角色直接指定。省略或写 `null` 都表示未知：不从体重、身高、BMI、清单或性别推测。`0` 和 `100` 是数学端点，不是成年人的生理默认值；字符串、非有限值或超出闭区间 `[0,100]` 的数值会被拒绝，不静默钳位。

| `parts.bodyComposition` 字段 | 单位 | 含义 |
| --- | --- | --- |
| `weightKg` | kg | 当前档案的体重，缺省 `75`。它不是每轮称量结果。 |
| `bodyFatPercent` | % | 档案的脂肪质量百分数，未知为 `null`。 |
| `fatMassKg` | kg | `weightKg × (bodyFatPercent / 100)`，体脂未知时为 `null`。 |
| `fatFreeMassKg` | kg | `weightKg − fatMassKg`，体脂未知时为 `null`。去脂质量还包含水、骨及其他非脂肪成分，不等于肌肉质量。 |

这是按定义二分的 `design` 读数，不是人体测量或诊断。乳房组织体积另见 [乳房组织组成](../../human-organs/mammary-glands/README.md#乳房组织组成)，不换算或另加到全身脂肪质量。

## 怎么设置、怎么核对

停 Gateway 后在已有存档中合并下列片段，保留其余顶层配置和完整 `snapshot`，再重启；不要手改读数字段。启动与心跳都从本次配置发布读数；如启动时保留未结算批次，则不提前重置已提交字段，首个成功心跳刷新。暂停档仍保留原快照。

```json
{
  "profile": { "weightKg": 65, "heightCm": 170, "bodyFatPercent": 20 }
}
```

[真实 Gateway 因子对照](../../../test/organs.body-composition-gateway.test.mjs)为男性、女性各运行以下四个合成档案，身高固定为 `170 cm`；数值不是人群代表值。

| 体重 | 体脂 | 脂肪 / 去脂质量（两清单相同） |
| --- | --- | --- |
| 65 kg | 20% | 13 / 52 kg |
| 65 kg | 30% | 19.5 / 45.5 kg |
| 75 kg | 20% | 15 / 60 kg |
| 75 kg | 30% | 22.5 / 52.5 kg |

同体重、同清单只改体脂，启动至第 3 轮的体液、葡萄糖及适用时的乳腺状态完全相同；同体重、体脂换清单，组成读数相同但加载的生殖部位不同。`65 → 75 kg` 的初始体液 `26000 → 30000 mL`、葡萄糖可及池 `10.998 → 12.69 g` 是**既有体重缩放**，两者初始血糖浓度均为 `90 mg/dL`，并非体脂调整的结果。没有独立人体或临床验证。
