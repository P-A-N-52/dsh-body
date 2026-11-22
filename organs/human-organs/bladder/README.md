# 膀胱（bladder）：储尿与主动排尿

**功能标签：** 泌尿（储尿与排尿）。

膀胱只有一个脚本：接收体液转来的尿、保存轮初体积，并在本轮出现 `urinate` 动作时排空到设定的排后余量。它不产激素，也不自动排尿；尿意由 `brain/interoception.ts` 从膀胱体积读出。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/bladder/`，并已加入根清单（12 个部位）；`body_act` 已接受 `urinate`。Task 10 真实 DSH 会话已核对 queued → applied、同 callId 重试返回原 applied ID、同 callId 异载荷 409，以及 250 mL 轮初存量排出后同轮 1 mL 新尿留下（30 轮 A/B；证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）。

**清单依赖（transfer 配对校验）。** `volumeMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`，所以加载 `bladder` 时必须同时加载 `bodyFluid`；`bodyFluid` 又声明来自 `smallIntestine.waterVolumeMl` 的 `transferIn` 和到 `bladder.volumeMl` 的 `transferOut`，`smallIntestine` 再声明来自 `stomach.waterVolumeMl` 的 `transferIn`。完整闭包是 `stomach/hydration.ts` → `smallIntestine` → `bodyFluid` → `bladder` 四个部位，缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；旧入口 `stomach/motility.ts` 不声明 `waterVolumeMl`，不能替代 `hydration.ts`。启用后，只要 `bladder` 已加载，`GET /capabilities` 就显示 `urinate: ["bladder"]`；但字段声明仍要求上述三个上游部位同在清单里，`kidney` 等软读取则不影响启动。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `storage.ts` | `bladder` | `volumeMl`、`voidedMl` | 自己的轮初状态 `bladder`；`io.actions` 里的 `urinate` | `storage.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `volumeMl` | `mL` | 轮末膀胱体积（状态）；`transferIn` 来自 `bodyFluid.waterVolumeMl` |
| `voidedMl` | `mL` | 本轮排出量（每轮通量，不是累计）；没有 `urinate` 时为 0 |

`volumeMl` 不是膀胱压力、逼尿肌张力或残余尿诊断值。`voidedMl` 不是尿流率；模型不建排尿时长与流率曲线。时间原点：`volumeMl` 是轮末状态；`voidedMl` 只表示本轮从轮初体积结算的排出，不含当轮新转入的尿。

## 3. 方程与参数

只要本轮至少一个 `urinate`：

```text
voidedMl = max(0, volumeStart − postVoidResidualMl)
write.volumeMl = volumeStart − voidedMl
```

多个不同 `urinate` 同轮也只结算一次；无动作时 `voidedMl = 0`。`postVoidResidualMl = 0 mL` 是 `design`，不是 ICS 给出的正常残余量，也不是人体测量。

先 write、后 transfer：当轮体液新转入的尿在 write 之后才加入膀胱，所以不在本轮排出，下一轮才可能被 `urinate` 排出。`urinate` 本身不触发 `transfer`：水转入膀胱时已经离开体液，排尿再扣体液会双扣。

## 4. 读写边界

- 本脚本是 `bladder` 的唯一写者，只读自己的轮初状态与本轮 `io.actions`。
- 不读 `bodyFluid` 的原始水量，也不写 `bodyFluid`；水只经 `bodyFluid` 发起的 `transfer` 进入。
- 不调用 `io.notify`，不自动排尿，不按体积阈值触发动作。
- 尿意由 `interoception` 读取轮初 `bladder.volumeMl` 计算：`urinaryUrgency = clamp(100 mm × volumeMl / 410 mL, 0, 100)`。410 mL 是 `design` 归一化锚点，不是自然排尿阈值；排尿后的低尿意与当轮新尿都在下一轮读出。

## 5. 工具与动作

`body_act` 接受 `{ type: "urinate" }`，不需要体积、能量、餐型或时长；动作 ID 仍由 `sessionId + callId` 稳定生成，同 callId 同载荷重试返回原回执。根清单已加载膀胱，启用后这个动作有处理者；真实会话的入队、生效与重试核对属 M3 任务 10。

## 6. 证据入口

- 脚本头部的块注释列出 ICS 术语的记账恒等式与排后余量的工程假设。
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 逐篇笔记：[`references/notes/de-wachter-2003.md`](references/notes/de-wachter-2003.md)、[`references/notes/abrams-2002.md`](references/notes/abrams-2002.md)
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.5

**证据边界：**

- **Abrams 2002 / ICS 术语（`SRC-ABRAMS-2002`，§3.2.4）**只支撑“排前量 = 排出量 + 排后余量”的记账恒等式；原文没有规定正常残余量，模型 0 mL 是 `design`。
- **De Wachter & Wyndaele 2003（`SRC-DEWACHTER-2003`）**目前只核对了摘要：15 名健康女学生，摘要**未说明是否未产**，也未给出 FSF/FDV/SDV 的具体数值与误差类型。设计文档与主会话交接记录的 190/268/410 mL 是**交接数值、原文表/图待核**，不能写成摘要已报告值，更不能当人群正常值、自然排尿阈值或个体尿意标定。410 mL 只作归一化锚点。
- 两者都是 `results_seen`；De Wachter 只到摘要层，不能称独立验证。

## 7. 当前限制

- **不建压力与流率**：没有逼尿肌压力、尿流率、排尿时长或残余尿诊断。
- **不建排尿反射**：不自动排尿、不失禁、不建夜尿或尿急综合征；`urinate` 是会话主动动作。
- **不建激素**：膀胱不产激素；尿意只从体积读出，不另设储尿激素。
- **不建解剖分层**：不区分逼尿肌、三角区、尿道括约肌或神经支配。
- **残余量是工程值**：0 mL 不是“正常人都排空”的结论；参数范围只是调参范围。
- **个体化缺失**：不随年龄、性别、产次、前列腺或膀胱容量调整。
