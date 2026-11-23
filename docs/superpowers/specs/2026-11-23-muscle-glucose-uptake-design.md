# 骨骼肌摄糖与肌糖原薄切片设计

日期：2026-11-23
状态：待批准。方向（M2"组织摄糖分区"落到骨骼肌）已由 owner 选定；范围、方案与参数为主代理提案，批准后再起 plan 与 swarm。

## 目标与边界

新增部位 `muscleGlucose`（脚本 `organs/human-organs/skeletal-muscle/glucose-uptake.ts`），让现有胰岛素缩放的超基线葡萄糖处置中的一个份额真实转移到骨骼肌并以肌糖原储存，运动时消耗糖原。这是 M2 表中"组织摄糖分区"与"糖原"两项的首个落点，也是 M2 与 M4 第一处真实交汇。

本步不建胰岛素浓度、胰高血糖素、肝糖、脂肪组织分区、肌糖原容量上限、静息糖原周转、乳酸/Cori 循环、运动类型或 MET。`insulinRelative` 保持无量纲相对信号，不换算 µU/mL；Rizza 1981 的半最大浓度不能套在无量纲信号上。

## 现状与冲突

`glucose.ts` 已有 `D = E × (1 − 2^(−dtMin × I / 60))` 作为"非肾表观清除汇"，其 README §6 明说它是组织利用的占位、将来由组织摄糖分区替换。若在 `D` 之外再加一个肌摄糖 sink，胰岛素依赖处置会被双计。

## 方案比较

- **份额改道（采用）。** `glucose` 把 `D_total` 的固定份额 `U` 经 transfer 交给 `muscleGlucose`，其余仍写 `disposedGlucoseG`。`glucoseMassG` 与 `concentrationMgDl` 轨迹不变（≤ 1 ulp，见下）；肌肉只做"接收—储存—运动消耗"，不读葡萄糖或胰岛素。残余 `disposedGlucoseG` 仍沿用胰岛素缩放，是占位；Dalla Man 的胰岛素非依赖项（中枢/红细胞）不单独建。
- **把胰岛素依赖搬进肌肉（暂缓）。** `glucose` 的残余清除改为胰岛素非依赖，肌肉读 `insulinRelative` 与超基线质量、按请求—结算 lag 转移。更接近 Dalla Man 的 U_id/U_ii 分区，但葡萄糖对胰岛素的响应轨迹全变、多一轮 lag、既有精确断言全部重写；留给完整 M2。
- **只存不出（不做）。** 糖原只增不减，没有消费者差异，违背建模约束。

## 部位与参数

部位 `muscleGlucose`，无动作，初值三个字段均为 0：

| 字段 | 单位 | mode | 含义 |
| --- | --- | --- | --- |
| `uptakeG` | g | absolute | 本轮实际肌摄糖，仅经 `transferIn: ['glucose.glucoseMassG']` 加入，每轮 write 先归 0 |
| `glycogenG` | g | absolute | 肌糖原储量；上一轮 `uptakeG` 在本轮入账 |
| `glycogenConsumedG` | g | absolute | 本轮运动消耗的糖原通量，无运动为 0 |

参数（两处，均 `design`、`source: null`）：

- `glucose.parameters.json` 新增 `glucose.muscleDisposalShare = 0.75`（单位 1，范围 [0, 1]）：`D_total` 中改道进肌肉的份额。量级上骨骼肌是胰岛素介导处置的主要去向，但仓库没有登记来源，该值是工程占位，不是引用值。
- `glucose-uptake.parameters.json`：`muscleGlucose.glycogenUseRateGPerMin = 0.5`（g/min，范围 [0, 5]）：`intensity = 1` 时每分钟糖原消耗，纯工程占位。

证据：`SRC-DALLAMAN-2007` §III.C.3 只支撑"利用分为胰岛素非依赖项与胰岛素依赖项"的结构方向（笔记 §8.2），不支撑份额与速率数值。Rizza 1981 笔记未补，本切片不以其为来源。

## 转移与时序

`glucose`（每轮，`I` / `R` 语义不变）：

```text
E = max(0, M − B)
D_total = E × (1 − 2^(−dtMin × I / 60))
U = D_total × muscleDisposalShare            （请求份额）
D = D_total − U                              （写出的残余清除）
M_after = M − D_total
W = M_after + U                              （write 值，转移前质量）
X = min(max(0, R), W − U)                    （= min(R, M_after)）
U_paid = min(U, W − X)                       （正常 = U；肾请求抽干池子时少 1 ulp）
write.glucoseMassG = W
write.concentrationMgDl = M × 1000 / V
write.disposedGlucoseG = D
transfer（Gateway 按目标名排序，肾先肌后）：
  glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG: X
  glucose.glucoseMassG → muscleGlucose.uptakeG: U_paid
```

`share = 0.75`、`I = 1` 时提交后的 `glucoseMassG`（= `W − X − U_paid`）与 `concentrationMgDl` 与现有轨迹 `M_after − X` 一致到 **≤ 1 ulp（< 1e-12 g）**：旧模型直接写 `M_after` 再减 `X`，新模型写 `W = M_after + U` 再由 Gateway 减回去，`W` 跨二进制 binade 时 `W − U` 可与 `M_after` 差 1 ulp（审查实测 3.55e-15 g），物理上无意义；肾糖 `X = min(max(0, R), M_after)` 用与旧模型相同的表达式，逐位不变。`disposedGlucoseG` 变为原来的 0.25 倍。Gateway 先应用 write，再把本轮 transfer **按目标名排序**后逐笔应用（`gateway/operations.js:206`），每笔都校验源字段余额；因此 `kidneyGlucose.excretedGlucoseG` 永远先于 `muscleGlucose.uptakeG` 结算，与模块的调用顺序无关。肾糖仍按 `min(max(0, R), M_after)` 钳位；肌肉按肾糖结算后的余额封顶 `U_paid = min(U, W − X)`。正常范围下 `W − X = M_after + U − X > U`，全额支付且 `disposed + U_paid = D_total` 逐位成立；仅当测试注入的肾请求抽干池子（`X = M_after`）时，`W − X = (M_after + U) − M_after` 因浮点误差可能比 `U` 少 1 ulp，封顶后提交质量比旧轨迹多 1 ulp、`disposed + U_paid` 比 `D_total` 少 1 ulp（均 < 1e-18 g），质量守恒仍精确成立。真实肾请求每轮远小于 `M_after`（需约 23 万 mg/dL 才抽干），不会触发；若要严格全额，需让 Gateway 保留调用顺序，不在本切片范围。这是实施中实测发现并修正的边界。

`muscleGlucose`（每轮）：

```text
uptake = prev.uptakeG
active = physicalActivity 已加载且 remainingExerciseMin > 0
consumed = active
  ? min(glycogenUseRateGPerMin × intensity × dtMin, max(0, prev.glycogenG) + uptake)
  : 0
glycogenG = max(0, prev.glycogenG) + uptake − consumed
write.uptakeG = 0
write.glycogenG = glycogenG
write.glycogenConsumedG = consumed
```

`dtMin = io.dt / 60`；不足一分钟的活动不按比例截断，与汗液/呼吸失水语义一致。`physicalActivity` 未加载时 `consumed = 0`；已加载但 `remainingExerciseMin` 或 `intensity` 缺失、非有限、为负或 `intensity ∉ [0, 1]` 时抛错使本轮失败，不用健康常量掩盖。`consumed` 产物按局部利用出账，不回流肝（无肝）。自身字段缺失由 `initialState` 补 0。

时序：第 N 轮 `glucose` 转出 `U(N)`；第 N+1 轮 `muscleGlucose` 把 `U(N)` 计入 `glycogenG` 并写 `uptakeG = 0`，随后 `U(N+1)` 到账。`exercise` 第 1 轮进入 `physicalActivity`，第 2 轮肌肉开始消耗糖原。

`glucose.glucoseMassG.transferOut` 增加 `muscleGlucose.uptakeG`；含 `glucose` 的 Gateway 清单必须同时加载 `muscleGlucose`，硬 transfer 闭包由 8 增至 9 部位。`physicalActivity` 只是普通轮初读取，不在闭包内。

## 质量账

```text
累计摄入碳水
= stomach.carbohydrateG
+ Σ stomach.mealQueue.remainingCarbohydrateG
+ smallIntestine.carbohydrateG
+ (glucose.glucoseMassG − B)
+ 累计 disposedGlucoseG
+ 累计 kidneyGlucose.excretedGlucoseG
+ muscleGlucose.glycogenG
+ muscleGlucose.uptakeG
+ 累计 muscleGlucose.glycogenConsumedG
```

每个已提交轮次按 `1e-6 g` 容差成立。

## 旧档、重启与验收

旧档缺 `muscleGlucose` 时由 `initialState` 补三个 0，不反推历史摄取；`glucose.muscleDisposalShare` 只影响加载后的轮次。重启保留在途 `uptakeG`，不重复计入。根清单变为 19 部位、21 份参数文件。

验收：肌单元测试（公式、dt、活动缺失/异常、糖原钳位、JSON-safe）；glucose 既有测试更新为 `disposed + uptake = D_total` 且 `glucoseMassG` 轨迹逐位不变；真实 Gateway 覆盖餐后累积、运动消耗、旧档、重启与完整质量账；清单/参数计数与缺 `muscleGlucose` 的配对校验；最终 `npm test` 与 `git diff --check`。

未验证：胰岛素浓度、个体预测、独立血糖/肌糖原数据、真实 DSH 会话、临床。

## 留给实施

- DI 独立清单若含 `glucose` 链，同步加 `muscleGlucose`。
- `organs.gateway.test.mjs` 部位列表与初值断言、`parameters.test.mjs` 文件清单、`dsh.tools.test.mjs` 计数。
- 文档同步：glucose README §1–§4 与 §6、skeletal-muscle README、根 README、`docs/gateway-and-scripts.md`、`docs/virtual-body.md` M2 行。
