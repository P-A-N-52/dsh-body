# 分区骨骼肌区域（头颈 / 躯干 / 四肢）

**功能标签：** 糖代谢（区域肌糖原代理）。

本目录是骨骼肌分区的三个独立部位：`muscleHead`（头颈）、`muscleTrunk`（躯干）、`muscleLimbs`（四肢）。每个区域各自持有糖原、按轮初 `physicalActivity` 消耗；摄糖由上一级聚合器 `muscleGlucose`（`../glucose-uptake.ts`）按份额分配。三个入口文件只调用共享核心 `region-core.ts`，公式、证据边界和迁移逻辑都在核心里。区域是独立部位，不是 `muscleGlucose` 的子字段；清单可以只加载其中一部分，缺失区域按剩余区域重新归一。

实现状态：`head.ts` / `trunk.ts` / `limbs.ts` 与 `region-core.ts` 已接入根清单、女性清单和男性清单；聚合器入口为 `../glucose-uptake.ts`，缺区域变体为 `../glucose-uptake.no-limbs.ts`。模块测试见 [`test/organs.muscle-regions.test.mjs`](../../../../test/organs.muscle-regions.test.mjs)，真实 Gateway 测试见 [`test/organs.muscle-regions-gateway.test.mjs`](../../../../test/organs.muscle-regions-gateway.test.mjs)。脚本、参数、迁移和变体用法是当前实现；区域肌肉质量分布、独立生理数据和真实 DSH 会话未验证。

## 1. 部位与字段

三个区域的字段相同，全部 `absolute`：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `uptakeG` | `g` | 本轮区域摄糖到账，仅由 `transferIn: ['muscleGlucose.uptakeG']` 增加，每轮 `write` 归 0（初值 `0`） |
| `glycogenG` | `g` | 区域糖原储量；初值按 `300 g × regionShare` 分配（头颈 `15 g`、躯干 `135 g`、四肢 `150 g`）；上一轮 `uptakeG` 在本轮并入；旧档迁移份额在默认种子状态取代该初值、在已有真实存档状态时并入；运动时扣除；钳到非负 |
| `glycogenConsumedG` | `g` | 本轮实际运动消耗，无活动为 0；不是累计量（初值 `0`） |

`uptakeG` 与 `glycogenConsumedG` 初值为 0，`glycogenG` 初值分别为 `15 / 135 / 150 g`。`uptakeG` 是通量，`glycogenG` 是状态，`glycogenConsumedG` 是读数/通量；三者不能重复计入质量账。时间原点是轮末：`glycogenG` 与 `glycogenConsumedG` 在本轮提交后，下一轮才对其他部位可见。

每个区域导出 `actionTypes = []`，没有动作、通知或主动 transfer。`uptakeG.transferIn` 固定指向 `muscleGlucose.uptakeG`，因此区域必须与一个聚合器入口同时加载；聚合器的 `fields.uptakeG.transferOut` 必须声明该区域，缺配对会在启动时被 Gateway 拒绝。

## 2. 公式与时序

设 `prev` 为轮初自身状态，`dtMin = io.dt / 60`：

```text
legacy   = 旧档迁移份额（仅旧档第一轮存在；无旧总量时 undefined）
uptake   = 轮初 uptakeG（字段缺失按 0）
seeded   = 本轮状态逐字段等于 initialState 默认种子
base     = legacy === undefined ? max(0, glycogenG)
         : seeded ? legacy
         : max(0, glycogenG) + legacy
active   = physicalActivity 已加载且 remainingExerciseMin > 0
consumed = active
  ? min(glycogenUseRateGPerMin × regionShare × intensity × dtMin, base + uptake)
  : 0
glycogenG = base + uptake − consumed
write { uptakeG: 0, glycogenG, glycogenConsumedG: consumed }
```

- 默认种子是 `uptakeG = 0`、`glycogenG = 300 g × regionShare`、`glycogenConsumedG = 0`（即 `15 / 135 / 150 g`）。旧档存在时，若区域仍是这组默认种子，迁移份额**取代**种子，迁移后总量等于旧总量；若区域已有真实存档状态，迁移份额并入其存量。没有旧总量时按区域自己的存量继续。

- `glycogenUseRateGPerMin = 0.5` 来自 `../glucose-uptake.parameters.json`，按区域份额（头颈 `0.05` / 躯干 `0.45` / 四肢 `0.50`）缩放；不新增区域参数。它是 `design`、`source: null` 的工程占位，不是实测区域糖原分解速率。
- **按份额缩放消耗：** `intensity = 1`、`dt = 60` 时头颈消耗 `0.025 g/min`、躯干消耗 `0.225 g/min`、四肢消耗 `0.25 g/min`，三区域全负荷合计恰好为 `0.5 g/min`（不再是旧的每区域 0.5、合计 1.5 g/min）。质量账按各区域实际消耗累计。
- 不足一分钟的活动不按 dt 比例截断：轮初 `remainingExerciseMin = 0.5` 且 `dt = 60` 时仍按整 dt 消耗。
- `consumed` 钳到 `base + uptake`，区域糖原不会为负；`glycogenConsumedG` 是实际消耗，不是请求。
- `physicalActivity` 未加载时消耗 0；已加载但 `remainingExerciseMin` / `intensity` 缺失、非数值、非有限、剩余时间为负或 `intensity ∉ [0, 1]` 时抛错，本轮不写状态，不用健康常量掩盖异常。合法 0 活动、0 到账与 0 存量都是有效值。

时序（`design`）：第 N 轮聚合器把上一轮到账量转给区域；第 N+1 轮区域把 `uptakeG` 入账并消耗。运动动作第 1 轮进入 `physicalActivity`，第 2 轮区域开始消耗。区域只读轮初快照，不读聚合器或兄弟区域的运行中写入。

## 3. 聚合器份额与独立启停

`muscleGlucose` 的聚合分配（`design`，份额 `source: null`）：

```text
weight(muscleHead)  = 0.05
weight(muscleTrunk) = 0.45
weight(muscleLimbs) = 0.50
amount(region) = uptakeG × weight(region) / Σ(已加载区域 weight)
```

- 正常入口 `../glucose-uptake.ts` 声明三个区域，份额 0.05 / 0.45 / 0.50。
- 缺区域变体只声明存在的区域，份额按剩余区域重新归一。例如没有 `muscleLimbs` 时头和躯干为 `0.05 / 0.50 = 0.1` 与 `0.45 / 0.50 = 0.9`；这是 `policy`，只表示“现有区域重新归一”，不推断缺失肢体的肌肉质量。
- 区域可被清单单独启停；一个区域都没有时聚合器保留 `uptakeG` 作为在途余额，等区域加载后再分配，不凭空丢失质量。
- 缺失区域不会自动补回，也不会从其他区域借糖原；区域之间不互相搬运糖原。

## 4. 旧档迁移与重启

旧档只有 `muscleGlucose.glycogenG`（总量）时：

1. 各区域在自己的第一轮读该总量，并按**已加载区域**的份额重新归一。若区域仍是 `initialState` 补出的默认种子（`uptakeG = 0`、`glycogenG = 300 g × 份额`、`glycogenConsumedG = 0`），迁移份额**取代**种子，迁移后三区合计等于旧总量（例如旧档 100 g、三区齐全时头/躯干/四肢为 5 / 45 / 50 g，而不是在 300 g 上再加 100 g）；若区域已有真实存档状态，份额并入其存量。
2. `muscleGlucose` 聚合器第一次 `write` 只写 `uptakeG` / `uptakeRequestG`，不再保留旧总量；旧 `glycogenConsumedG` 也一并丢弃，不反推历史消耗。后续轮次读不到旧量，不会重复迁移。
3. 旧档的在途 `uptakeG` 不参与迁移，仍由聚合器在重启后的第一轮按份额 transfer 给区域，区域下一轮入账。总量与在途量都保留，不重复计。
4. 迁移只读旧 `muscleGlucose.glycogenG`，不写聚合器或兄弟区域；旧总量存在但非有限或为负时抛错使本轮失败，不用 0 掩盖异常。

**迁移边界。** 如果旧实现已经完成迁移并删除 `muscleGlucose.glycogenG`，新代码无法识别，也不会自动回改；唯一可靠纠正是从迁移前备份恢复。本仓库不声称已验证存在这种真实存档。

重启保留已提交的区域 `uptakeG`、`glycogenG`、`glycogenConsumedG` 和 `muscleGlucose.uptakeRequestG`；上一轮在途量在重启后的正常时序里只入账一次。

## 5. 独臂类变体用法

缺四肢（或独臂类）身体不能直接删掉 `regions/limbs.ts` 而保留正常聚合器：正常入口的 `transferOut` 固定声明 `muscleLimbs.uptakeG`，删除目标会让 Gateway 在启动时报 `transferOut target "muscleLimbs.uptakeG" is not declared`。正确做法是复制清单并同时改两处：

1. 去掉 `./organs/human-organs/skeletal-muscle/regions/limbs.ts`；
2. 把 `./organs/human-organs/skeletal-muscle/glucose-uptake.ts` 换成 `./organs/human-organs/skeletal-muscle/glucose-uptake.no-limbs.ts`。

变体只声明 `muscleHead` / `muscleTrunk`，份额自动归一为 0.1 / 0.9。同一清单不能同时加载正常入口与变体（两者 `id` 都是 `muscleGlucose`），也不能在同一份存档上切换清单；变体要配独立 `statePath`。更细的左右臂/左右腿拆分、缺失肢体的质量推断和残肢局部代谢不在本切片内。

## 6. 证据、未建模与未验证

- **证据：** 本切片没有区域肌肉质量分布、区域糖原储量、运动底物利用或区域糖原分解速率的实测数据。`glycogenUseRateGPerMin = 0.5`（按区域份额拆分为头 `0.025` / 躯干 `0.225` / 四肢 `0.25 g/min`）、`15 / 135 / 150 g` 初始糖原与 `0.05 / 0.45 / 0.50` 份额都是 `status: design`、`source: null` 的工程占位，不是引用值、拟合结果或临床阈值，不能称 validated。`SRC-DALLAMAN-2007` 只支撑“组织利用可分为不同部分”的结构方向，不支撑这些数值。
- **未建模：** 区域肌肉绝对质量、区域血流与纤维类型、肌群疲劳/延迟酸痛、左右肢体与皮肤分区、运动类型/MET/强度非线性、乳酸与 Cori 循环、脂肪组织分区、个体差异、区域耗竭对活动或疲劳的反馈。区域之间不互相搬运糖原；某区域耗尽后不虚构补充，消耗不回流血糖或肝。肌肉无葡萄糖-6-磷酸酶，不向血液释放葡萄糖。
- **未验证：** 没有真实 DSH 会话、独立区域肌糖原/运动生理数据、区域质量分布实测或临床验证。区域份额和共享消耗速率是工程假设，不能外推为人体测量。
