# 肝糖原与胰高血糖素薄切片设计

日期：2026-11-23
状态：owner 要求把身体做成自调节（血糖高→胰岛素→降糖，低→升糖），本切片补齐"低了能升"的另一半。

## 目标与边界

让血糖自调节双向闭环：高血糖 → 相对胰岛素 ↑ → 超基线处置（肌肉 + 肝 + 残余 + 肾糖）；低血糖 → 胰高血糖素 ↑ → 肝糖原释放 → 血糖回升。

消费者链：`pancreasEndocrine` 新增 `glucagonRelative`（低血糖驱动）→ `liver` 按信号释放肝糖原 → `glucose.glucoseMassG`；`glucose` 超基线处置新增肝糖原储存份额 → `liver.glycogenG`。

本步不建肝糖输出以外的肝功能（胆汁、解毒、蛋白合成、脂肪代谢）、胰岛素/胰高血糖素绝对浓度、肝糖原分解的酶促细节、酮症、脂肪组织分区。

## 现状与冲突

`glucose.ts` 目前只处理超基线部分，低于基线"保持原质量、不虚构肝糖补充"。本切片**推翻这条既有决定**（owner 要双向自调节），低血糖改为由 `liver` 真实转移补回，不是凭空生成：释放量恒受肝糖原存量限制，存量为 0 时血糖照掉，不产生无限供给。

## 方案比较

- **肝糖原 + 胰高血糖素（采用）。** 低血糖侧有了真实来源，且胰高血糖素终于有消费者；储存侧只是给现有处置增加一个份额，超基线轨迹保持 ≤1 ulp。
- **只加肝糖输出不加激素（不做）。** 没有调节信号，等于按固定速率漏水，不是自调节。
- **胰高血糖素单独成部位（不做）。** 与胰岛素同出一源（胰岛 α/β 细胞），放 `pancreasEndocrine` 一个部位两个信号字段即可，避免无意义拆分。

## 部位与参数

### `pancreasEndocrine` 新增 `glucagonRelative`

无量纲相对信号，`1` 为基线：目标 `clamp(1 + glucagonGainPerMgDl × (90 − G), 0, 5)`，按 `glucagonHalfTimeMin = 10` 一阶趋近。G 高于 90 时目标低于 1（最低 0），低血糖时升高。参数 `pancreasEndocrine.glucagon.glucoseGainPerMgDl = 0.02`、`responseHalfTimeMin = 10`、`maxRelative = 5`，均 `design`、`source: null`。既有 `insulinRelative` 行为不变。

### `liver`（`organs/human-organs/liver/glycogen.ts`）

无动作。字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `glycogenG` | `g` | 肝糖原存量；上一轮储存本轮入账，当轮释放经 transfer 扣出 |
| `storageG` | `g` | 本轮实际储存，仅 `transferIn: ['glucose.glucoseMassG']`，每轮 write 归 0 |
| `outputG` | `g` | 本轮实际释放记录，由本脚本写出，不是 transfer 目标 |

每轮（读轮初 `glucose.concentrationMgDl`、`pancreasEndocrine.glucagonRelative` 与自身 prev）：

```text
stored = prev.glycogenG + prev.storageG      （含上一轮到账的储存，释放前的存量）
releasing = G < baselineMgDl || glucagonRelative > 1
release = releasing ? min(maxOutputRateGPerMin × glucagonRelative × dtMin, max(0, stored)) : 0
write { glycogenG: max(0, stored), storageG: 0, outputG: release }
transfer liver.glycogenG → glucose.glucoseMassG: release（release > 0 时）
```

`G` 与 `glucagonRelative` 都是轮初快照；无胰腺时 `glucagonRelative` 按 1。`release` 由本脚本发起并钳到 `stored`，因此 transfer 不会被源余额拒绝；存量耗尽时 `release = 0`，不虚构供给。`outputG` 只是本轮实际释放记录，不参与质量账（释放是内部转移）。不走"请求—结算"滞后：肝自己持有糖原，当轮即可转出。

参数（`glycogen.parameters.json`，均 `design`、`source: null`）：

- `glucose.liverDisposalShare = 0.15`（肝糖原储存占超基线处置份额；肌肉 0.75、肝 0.15、残余 0.10）
- `liver.maxOutputRateGPerMin = 1`（`glucagonRelative = 1` 时的最大释放速率）
- `liver.initialGlycogenG = 80`（新身体肝糖原初始存量，不是测量）
- `liver.glycogenCapacityG = 100`（肝糖原储存上限，不是测量；`glucose` 按 `min(份额, 剩余容量)` 分配储存，存满后超出部分回残余清除）

## 转移与时序

`glucose.glucoseMassG.transferOut` 增加 `liver.storageG`（肾糖之后）；`glucose.glucoseMassG.transferIn` 增加 `liver.glycogenG`（小肠之后）。`liver.glycogenG.transferIn = ['glucose.glucoseMassG']`、`transferOut = ['glucose.glucoseMassG']` 双向配对。含 `glucose` 的清单必须同时含 `liver`，硬闭包 9 → 10 部位；女性清单 10 → 11。

每轮 `glucose`：

```text
E = max(0, M − B)
D_total = E × (1 − 2^(−dtMin × I / 60))
U = D_total × muscleDisposalShare
L = min(D_total × liverDisposalShare, max(0, liver.glycogenCapacityG − (liver.glycogenG + liver.storageG)))
D = D_total × 0.10                  （残余份额固定，不承接存不下的肝份额）
disposedTotal = U + L + D            （肝满时 < D_total）
M_after = M − disposedTotal
W = M_after + U + L                 （write 值，转移前质量）
X = min(max(0, R), M_after)         （肾糖，旧表达式）
U_paid = min(U, W − X)
L_paid = min(L, W − X − U_paid)
write { glucoseMassG: W, disposedGlucoseG: D, concentrationMgDl }
transfer（Gateway 按目标名排序）：
  liver.glycogenG → glucose.glucoseMassG: release（由 liver 发起）
  glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG: X
  glucose.glucoseMassG → liver.storageG: L_paid
  glucose.glucoseMassG → muscleGlucose.uptakeG: U_paid
```

释放由 `liver` 自己发起（源部位持有糖原）。Gateway 的排序键是 `${fromPart}.${fromField}->${target}`（`gateway/operations.js:206`），因此 `glucose.glucoseMassG` 的三笔转出排在 `liver.glycogenG → glucose.glucoseMassG`（释放）之前；`W = M_after + U + L` 已覆盖这三笔转出，释放随后入账，提交质量 = `W − X − L_paid − U_paid + release`，不依赖"释放先入账"。`glucose` 读轮初 `liver.glycogenG` 与 `liver.storageG` 计算剩余容量（闭包已强制 `liver` 存在，无回退）。超基线轨迹：肝未满时 `disposedTotal = D_total`（份额合计为 1），`glucoseMassG` 与旧轨迹一致到 ≤ 1 ulp，`disposedGlucoseG` 为原值 0.10 倍；**肝存满后 `L = 0`、`disposedTotal = 0.85 × D_total`，存不下的肝份额留在血里，血糖下降变慢，这是预期行为**；`disposedGlucoseG` 始终为 `0.10 × D_total`，不随肝容量变化。低于基线时由释放补回，外源碳水质量账新增 `(liver.glycogenG − initialGlycogenG)` 与 `liver.storageG` 两项（`liver.outputG` 是内部转移记录，不进账；`initialGlycogenG` 与 `B` 一样是初始禀赋）。

时序：第 N 轮 `glucose` 高 → 第 N+1 轮胰岛素升 → 第 N+2 轮处置到肌肉/肝；第 N 轮血糖低 → 第 N+1 轮胰高血糖素升、`liver` 当轮按轮初信号直接释放 → 提交后 `glucoseMassG` 回升，浓度下一轮体现。肝糖原耗尽时释放为 0，不虚构。

## 清单与计数

根清单 23 部位、25 份参数；女性清单 25 部位、27 份参数。硬闭包 10 部位（根）、11 部位（女性）。旧档缺 `liver` 由 `initialState` 补 `glycogenG = 80`、其余 0；`pancreasEndocrine` 旧档补 `glucagonRelative = 1`，不反推历史。

## 验收与未验证

- 单元：`liver` 储存入账、低血糖/高胰高血糖素触发释放、释放钳到存量、存量耗尽请求 0、`glucagonRelative` 曲线与既有 `insulinRelative` 不变、非法上游抛错、JSON-safe。
- `glucose`：份额拆分（肌肉 0.75 / 肝 0.15 / 残余 0.10）、超基线轨迹 ≤ 1 ulp、释放转入、缺 `liver` 的清单启动报错。
- 真实 Gateway：餐后血糖先升后降且肝糖原储存；预置低血糖 + 肝糖原 → 血糖回升、存量下降、胰高血糖素升高；存量耗尽后血糖不回升；肝糖原存满（capacity = 100）后 `L = 0`、超出部分回残余，血糖下降变慢；完整碳水质量账（含肝糖原两项）逐轮成立；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：肝糖原实测、胰高血糖素/胰岛素浓度、独立血糖曲线、真实 DSH 会话、临床验证、23 部位性能。

后续项：肾糖异生（长期空腹约占内源葡萄糖 20–25%，低血糖时也能由肾释放）；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。
