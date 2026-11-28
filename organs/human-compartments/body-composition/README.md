# 全身体成分（`bodyComposition`）

[脚本 `composition.ts`](composition.ts) 给根、男性和女性清单提供同一个**只读档案读数**。它不建脂肪库存，不参加 `add` / `transfer`，也不改变体液、血糖、泌乳、能量消耗或阈值。读数可在本机 `GET /state`、`gateway.getState()` 或模块 `io.read('bodyComposition')` 中查询，不新增动作、提醒或 DSH 工具。

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
