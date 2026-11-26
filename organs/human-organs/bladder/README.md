# 膀胱（bladder）：储尿、主动排尿与过度充盈非自主排空

**功能标签：** 泌尿（储尿与排尿）。

膀胱只有一个脚本：接收体液转来的尿、保存轮初体积，并在本轮出现 `urinate` 动作时主动排空；没有动作但轮初体积超过过度充盈阈值时，做一次非自主排空。它不产激素；尿意由 `brain/interoception.ts` 从膀胱体积读出。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/bladder/`，并已加入根清单（当前根清单 39 个部位、35 份唯一参数文件；3 份 DI 变体与 `parathyroid`/`calcium` 参数不随清单加载）；`body_act` 已接受 `urinate`。Task 10 真实 DSH 会话已核对 queued → applied、同 callId 重试返回原 applied ID、同 callId 异载荷 409，以及 250 mL 轮初存量排出后同轮 1 mL 新尿留下（30 轮 A/B；证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）。过度充盈非自主排空由定向单测与真实 Gateway 水账测试覆盖，并已由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts：预置 650 mL、无动作 → sim 60 `involuntaryVoidedMl = 650`、`voluntaryVoidedMl = 0`、同轮新尿 1 mL 留下；sim 120 尿意/不适回落；`urinate` 优先、同 callId 重试不重复排空、异载荷 409；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）。M19 只覆盖 3 轮非自主排空短会话；650 mL 预置与预置会话的稳态 1 mL 请求都是测试设定，不是模型输出；600 mL 仍是 `design` 工程阈值，不是临床容量或失禁模型。

**清单依赖（transfer 配对校验）。** `volumeMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`，所以加载 `bladder` 时必须同时加载 `bodyFluid`；`bodyFluid` 又声明来自 `smallIntestine.waterVolumeMl` 的 `transferIn`，以及到 `bladder.volumeMl`、`lungs.respiratoryWaterLossMl` 与 `skin.sweatVolumeMl` 的三个 `transferOut`；`smallIntestine` 再声明来自 `stomach.waterVolumeMl` 的 `transferIn`，以及 `carbohydrateG` 的 `transferOut: ["glucose.glucoseMassG"]`，而 `glucose` 还声明到 `kidneyGlucose.excretedGlucoseG` 与 `muscleGlucose.uptakeG` 的 `transferOut`。完整硬 transfer 闭包是 `stomach/hydration.ts`、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin` 与 `lungs` 十五个部位：水路由胃经小肠入体液再到膀胱，`bodyFluid` 另向 `lungs` 与 `skin` 转水，也接收 `colon.reclaimedWaterMl`；`glucose` 向 `liver`、`kidneyGlucose` 与 `muscleGlucose` 结算，`muscleGlucose` 再向三个区域转出，`kidneyGluconeogenesis` 向 `glucose` 产糖。缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误。旧入口 `stomach/motility.ts` 不声明 `waterVolumeMl` 或 `carbohydrateG` 的 transfer，不能替代 `hydration.ts`。启用后，只要 `bladder` 已加载，`GET /capabilities` 就显示 `urinate: ["bladder"]`；但字段声明仍要求闭包内全部十五个部位同在清单里，`kidney` 等软读取则不影响启动。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `storage.ts` | `bladder` | `volumeMl`、`voidedMl`、`voluntaryVoidedMl`、`involuntaryVoidedMl` | 自己的轮初状态 `bladder`；`io.actions` 里的 `urinate` | `storage.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `volumeMl` | `mL` | 轮末膀胱体积（状态）；`transferIn` 来自 `bodyFluid.waterVolumeMl` |
| `voidedMl` | `mL` | 本轮离开身体的总尿量（每轮通量，不是累计）；等于 `voluntaryVoidedMl` + `involuntaryVoidedMl` |
| `voluntaryVoidedMl` | `mL` | 本轮由 `urinate` 动作主动排出的量（每轮通量）；没有 `urinate` 时为 0 |
| `involuntaryVoidedMl` | `mL` | 本轮由过度充盈阈值代理非自主排出的量（每轮通量）；没有触发时为 0 |

`volumeMl` 不是膀胱压力、逼尿肌张力或残余尿诊断值。三个排出字段都不是尿流率；模型不建排尿时长与流率曲线。时间原点：`volumeMl` 是轮末状态；三个排出量只表示本轮从轮初体积结算的排出，不含当轮新转入的尿。水账只累计 `voidedMl` 一次，不能把两个分项再加一遍。

## 3. 方程与参数

每轮先读轮初体积 `V`：

```text
available = max(0, V − postVoidResidualMl)
若本轮至少一个 urinate：
  voluntaryVoidedMl = available
  involuntaryVoidedMl = 0
否则若 V > involuntaryThresholdMl：
  voluntaryVoidedMl = 0
  involuntaryVoidedMl = available
否则：
  voluntaryVoidedMl = involuntaryVoidedMl = 0

voidedMl = voluntaryVoidedMl + involuntaryVoidedMl
write.volumeMl = V − voidedMl
```

- 主动 `urinate` 优先，且与非自主排空不重复结算；多个不同 `urinate` 同轮也只结算一次。
- 非自主排空在轮初体积**严格大于** `involuntaryThresholdMl` 时触发，排到既有 `postVoidResidualMl`；不是持续漏尿、不是夹紧到阈值，也不增加漏尿速率参数。
- 600 mL 恰好不触发；阈值只在 `V > 600 mL` 时生效。
- `postVoidResidualMl = 0 mL` 与 `involuntaryThresholdMl = 600 mL` 都是 `design`、`source: null`。600 mL 只高于 410 mL 尿意归一化锚点的工程量级，不是正常膀胱容量、临床诊断界值或论文测量。

先 write、后 transfer：当轮体液新转入的尿在 write 之后才加入膀胱，所以不在本轮排出。非自主排空与主动排尿都不触发 `transfer`：水转入膀胱时已经离开体液，排尿再扣体液会双扣。当轮新尿留下，下一轮才按新轮初量判断。

## 4. 读写边界

- 本脚本是 `bladder` 的唯一写者，只读自己的轮初状态与本轮 `io.actions`。
- 不读 `bodyFluid` 的原始水量，也不写 `bodyFluid`；水只经 `bodyFluid` 发起的 `transfer` 进入。
- 本部位自身不调用 `io.notify`；主动排尿由会话动作触发，非自主排空只由体积阈值触发。当 `bladder.involuntaryVoidedMl > 0` 由 `<= 0` 上升触发（上升沿）时，`brainNotify` 会发出一条紧急 `wake` 纯定性感受通知（并在 `body_state` 表现为漏尿紧急感受），原始数值由 `GET /state` / `gateway.getState()` 返回。
- 旧存档中缺 `voluntaryVoidedMl` / `involuntaryVoidedMl` 的膀胱按 0 补齐，不重置已有 `volumeMl`；旧字段 `voidedMl` 每轮按新规则重算。
- 尿意由 `interoception` 读取轮初 `bladder.volumeMl` 计算：`urinaryUrgency = clamp(100 mm × volumeMl / 410 mL, 0, 100)`。410 mL 是 `design` 归一化锚点，不是自然排尿阈值；排尿后的低尿意与当轮新尿都在下一轮读出。

## 5. 工具与动作

`body_act` 接受 `{ type: "urinate" }`，不需要体积、能量、餐型或时长；动作 ID 仍由 `sessionId + callId` 稳定生成，同 callId 同载荷重试返回原回执。非自主排空不产生动作、回执或工具调用；只改变膀胱状态字段。根清单已加载膀胱，启用后 `urinate` 有处理者。`exercise` 由 [`physicalActivity`](../skeletal-muscle/README.md) 接收，膀胱不读活动；排尿、运动相关呼吸失水与活动出汗共享 `bodyFluid` 的轮初水，按肾→肺→汗的顺序分配，汗液只取扣除肾尿与肺失水后的剩余部分（见 [`skin`](../skin/README.md) 与 [`lungs`](../lungs/README.md)）。

## 6. 证据入口

- 脚本头部的块注释列出 ICS 术语的记账恒等式、主动/非自主排尿的工程假设与阈值边界。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`references/notes/de-wachter-2003.md`](references/notes/de-wachter-2003.md)、[`references/notes/abrams-2002.md`](references/notes/abrams-2002.md)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.5；过度充盈与不适：[`docs/superpowers/specs/2026-11-22-overflow-discomfort-design.md`](../../../docs/superpowers/specs/2026-11-22-overflow-discomfort-design.md) §2

**证据边界：**

- **Abrams 2002 / ICS 术语（`SRC-ABRAMS-2002`，§3.2.4）**只支撑“排前量 = 排出量 + 排后余量”的记账恒等式；原文没有规定正常残余量，模型 0 mL 是 `design`。它不支撑 600 mL 阈值或非自主排空。
- **De Wachter & Wyndaele 2003（`SRC-DEWACHTER-2003`）**目前只核对了摘要：15 名健康女学生，摘要**未说明是否未产**，也未给出 FSF/FDV/SDV 的具体数值与误差类型。设计文档与主会话交接记录的 190/268/410 mL 是**交接数值、原文表/图待核**，不能写成摘要已报告值，更不能当人群正常值、自然排尿阈值或个体尿意标定。410 mL 只作归一化锚点。
- **600 mL 非自主阈值没有直接来源**：它是 `design` 工程触发点，只借“高于尿意锚点”的量级关系；不声称复现逼尿肌收缩、括约肌松弛、正常排尿反射或临床尿失禁，也不是流行病学容量分布或诊断界值。
- 两者都是 `results_seen`；De Wachter 只到摘要层，不能称独立验证。

## 7. 当前限制

- **不建压力与流率**：没有逼尿肌压力、尿流率、排尿时长或残余尿诊断。
- **不建排尿反射或失禁**：非自主排空只是“内容物过多”的工程代理；不建模逼尿肌/括约肌协同、神经支配、尿急综合征、夜尿、持续漏尿或漏尿速率。也不建临床尿失禁分型或诊断。
- **不建激素**：膀胱不产激素；尿意只从体积读出，不另设储尿激素。
- **不建解剖分层**：不区分逼尿肌、三角区、尿道括约肌或神经支配。
- **残余量是工程值**：0 mL 不是“正常人都排空”的结论；参数范围只是调参范围。
- **个体化缺失**：不随年龄、性别、产次、前列腺或膀胱容量调整；600 mL 不是任何人群的膀胱容量。
