# 膀胱溢出与脑内不适感小改设计

**状态：** 用户已同意启动；尚未实现。范围来自“内容物过多的时候的不自觉排尿”与“不适就这么做吧，反正感觉都归属于 brain”。本设计不做尿崩、自动主动排尿、医学诊断或新提醒。

## 1. 取舍

- 膀胱负责储尿、主动排尿和过度充盈时的非自主溢出；脑只读取膀胱体积形成尿意与不适，不另造膀胱激素或脑内第二份尿量。
- `bladder.voidedMl` 保持“本轮离开身体的总尿量”，新增 `voluntaryVoidedMl` 与 `involuntaryVoidedMl` 两个分项。总量等于两项之和，水量守恒仍只累计总量一次。
- 溢出是过度充盈的工程代理，不声称模拟逼尿肌、尿道括约肌或某种特定溢流性尿失禁。阈值与速率都是 `design`，不是正常膀胱容量或临床诊断界值。
- `brain/interoception.ts` 新增 `discomfort`（0–100 mm 代理），由现有 `hunger`、`fullness`、`thirst`、`urinaryUrgency` 超过舒适区后的强度取最大值。它是当前最强的不适感受代理，不是疼痛评分、情绪或疾病严重度。
- 两个分片都是 O(1) 标量计算，不保存逐轮历史，不加工具、动作、通知或上下文注入。

## 2. 膀胱更新

参数：`bladder.voiding.overflowThresholdMl = 600 mL`、`overflowRateMlPerMin = 5 mL/min`，均 `design`、`source: null`。600 只是高于现有 410 mL 尿意锚点的工程溢出起点；5 mL/min 限制每轮离体量，不是论文测量。

每轮先读轮初体积 `V`，使用 `dtMin = io.dt / 60`：

```text
若本轮有 urinate：
  voluntary = max(0, V - postVoidResidualMl)
  involuntary = 0
否则若 V > overflowThresholdMl：
  voluntary = 0
  involuntary = min(V - overflowThresholdMl, overflowRateMlPerMin × dtMin)
否则：
  voluntary = involuntary = 0

voided = voluntary + involuntary
write.volumeMl = V - voided
```

主动 `urinate` 与溢出不重复结算；同轮多个主动动作仍只排一次。当轮肾新转入的尿在 write 后加入，不参与本轮主动或溢出排出，下一轮才按新轮初量判断。无动作且低于或等于阈值时保持原行为。

## 3. 脑内不适

参数：`interoception.discomfort.onsetMm = 70 mm`，`design`、`source: null`。对本轮已经算出的四个感受值 `x` 分别计算：

```text
excess(x) = clamp(100 × (x - onsetMm) / (100 - onsetMm), 0, 100)
discomfort = max(excess(hunger), excess(fullness), excess(thirst), excess(urinaryUrgency))
```

因此基线 `hunger=50`、`fullness=0`、`thirst=50`、`urinaryUrgency=0` 时不适为 0；感受 70 仍为 0，85 为 50，100 为 100。取最大值避免多个感受叠加成没有依据的总分。原四字段公式不变，`brainNotify` 仍只读饥饿和饱满。

## 4. 验收

1. 膀胱轮初 650 mL、无主动动作、dt 60 s：非自主排出 5 mL，总量与分项一致；同轮新尿仍留下。连续轮次降至 600 mL 后停止溢出。
2. 轮初 650 mL 且主动 `urinate`：只记主动排出，不额外记非自主排出；同轮多个动作仍只排一次。
3. 真实 Gateway 在溢出与主动排尿两种场景下均保持水账；累计离体水只累计 `voidedMl`，不能再加两个分项。
4. 脑内基线不适为 0；四个感受分别 85 时不适均为 50，多感受同时存在取最大值，超过 100 的输入仍由原有钳位处理。
5. `body_state` 可读膀胱三个排出字段与 `interoception.discomfort`；原工具、动作 ID 和通知行为不变。代码合并后运行一次 `npm test`。
