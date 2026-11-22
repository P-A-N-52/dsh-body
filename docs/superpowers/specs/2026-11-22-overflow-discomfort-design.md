# 膀胱过度充盈非自主排尿与脑内不适感小改设计

**状态：** 已实现（2026-11-22，代码与定向测试已合并）。范围来自“内容物过多的时候的不自觉排尿”与“不适就这么做吧，反正感觉都归属于 brain”。`bladder/storage.ts` 已按本设计结算非自主排空，`brain/interoception.ts` 已输出 `discomfort`，两者都在默认根清单中；只有定向模块测试，以及真实根清单 + 临时存档的真实 Gateway 测试，**没有真实 DSH 会话验收**。没有新增工具、动作、通知或上下文注入，也不做尿崩、医学诊断或新提醒。

## 1. 取舍

- 膀胱负责储尿、主动排尿和过度充盈时的非自主排空；脑只读取膀胱体积形成尿意与不适，不另造膀胱激素或脑内第二份尿量。
- `bladder.voidedMl` 保持“本轮离开身体的总尿量”，新增 `voluntaryVoidedMl` 与 `involuntaryVoidedMl` 两个分项。总量等于两项之和，水量守恒仍只累计总量一次。
- 非自主排空是内容物过多的工程代理，不声称模拟逼尿肌、尿道括约肌、正常排尿反射或临床尿失禁。只有阈值为 `design`，不是正常膀胱容量或临床诊断界值；不增加漏尿速率参数。
- `brain/interoception.ts` 新增 `discomfort`（0–100 mm 代理），由现有 `hunger`、`fullness`、`thirst`、`urinaryUrgency` 超过舒适区后的强度取最大值。它是当前最强的不适感受代理，不是疼痛评分、情绪或疾病严重度。
- 两个分片都是 O(1) 标量计算，不保存逐轮历史，不加工具、动作、通知或上下文注入。

## 2. 膀胱更新

参数：`bladder.voiding.involuntaryThresholdMl = 600 mL`，`design`、`source: null`。600 只是高于现有 410 mL 尿意锚点的工程触发点，不是论文测量。

每轮先读轮初体积 `V`：

```text
available = max(0, V - postVoidResidualMl)
若本轮有 urinate：
  voluntary = available
  involuntary = 0
否则若 V > involuntaryThresholdMl：
  voluntary = 0
  involuntary = available
否则：
  voluntary = involuntary = 0

voided = voluntary + involuntary
write.volumeMl = V - voided
```

主动 `urinate` 优先且与非自主排尿不重复结算；同轮多个主动动作仍只排一次。非自主触发后排到既有 `postVoidResidualMl`，不是持续漏尿或夹紧到阈值。当轮肾新转入的尿在 write 后加入，不参与本轮主动或非自主排尿，下一轮才按新轮初量判断。无动作且低于或等于阈值时保持原行为。

## 3. 脑内不适

参数：`interoception.discomfort.onsetMm = 70 mm`，`design`、`source: null`。对本轮已经算出的四个感受值 `x` 分别计算：

```text
excess(x) = clamp(100 × (x - onsetMm) / (100 - onsetMm), 0, 100)
discomfort = max(excess(hunger), excess(fullness), excess(thirst), excess(urinaryUrgency))
```

因此基线 `hunger=50`、`fullness=0`、`thirst=50`、`urinaryUrgency=0` 时不适为 0；感受 70 仍为 0，85 为 50，100 为 100。取最大值避免多个感受叠加成没有依据的总分。原四字段公式不变，`brainNotify` 仍只读饥饿和饱满。

## 4. 验收与测试证据（已实现）

代码、参数与定向测试已完成；默认根清单已加载 `bladder` 与 `interoception`，没有新增工具、动作、通知或上下文注入。下列证据都是离线模块测试，或真实根清单 + 临时存档的真实 Gateway 测试，**不是真实 DSH 会话验收**：Task 10 的 30 轮会话早于本功能合并，不覆盖非自主排空或 `discomfort`。

| 验收项 | 实际证据 |
| --- | --- |
| 1. 膀胱轮初 650 mL、无主动动作非自主排出 650 mL，主动分项为 0，总量等于两个分项之和；同轮新尿仍留下；600 mL 恰好不触发 | `test/organs.bladder.test.mjs` 的 `a volume above 600 mL voids involuntarily without any action`、`exactly 600 mL does not trigger involuntary voiding`、`urine arriving in the same round stays after involuntary voiding` |
| 2. 轮初 650 mL 且主动 `urinate` 只记主动排出，不额外记非自主；同轮多个动作仍只排一次 | 同文件 `a urinate action takes priority over involuntary voiding above the threshold`、`two different urinate actions in one round void only once` |
| 3. 真实 Gateway 在非自主与主动排尿两种场景下均保持水账；累计离体水只累计 `voidedMl` | `test/organs.water-gateway.test.mjs` 的 `an overflow bladder voids involuntarily and keeps the water ledger`、`a 600 mL round-start bladder does not void until the next overflow round`、`urinate takes priority over overflow voiding and its retry does not void again` |
| 4. 脑内基线不适为 0；四个感受分别 85 时不适均为 50；多感受同时存在取最大值；超过 100 的输入仍由原有钳位处理 | `test/organs.interoception.test.mjs` 的 `discomfort stays at zero at and below the 70 mm onset`、`each feeling at 85 mm yields 50 discomfort`、`discomfort takes the strongest feeling instead of summing them`、`oversized inputs clamp outputs to the 0-100 band and stay finite` |
| 5. `body_state` 可读膀胱三个排出字段与 `interoception.discomfort`；原工具、动作 ID 和通知行为不变 | 膀胱三个排出字段由 `test/organs.bladder.test.mjs` 的字段契约用例与 `test/organs.water-gateway.test.mjs` 的 `body_state` 读取覆盖；工具名称、`body_act` 参数枚举与输出 schema 由 `test/dsh.tools.test.mjs` 与 `test/organs.di.test.mjs` 的形状用例保持不变；`brainNotify` 仍只读饥饿/饱满，没有新增通知。 |

2026-11-22 定向运行 `node --test test/organs.bladder.test.mjs test/organs.interoception.test.mjs test/organs.di.test.mjs test/organs.water-gateway.test.mjs`：55 tests / 55 pass / 0 fail。未覆盖：真实 DSH 会话中的非自主排空与 `discomfort` 读出；阈值 600 mL、起始 70 mm 都是 `design`，不是临床容量、疼痛阈值或失禁模型，边界见 `organs/human-organs/bladder/README.md` 与 `organs/human-organs/brain/README.md`。
