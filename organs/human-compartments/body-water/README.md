# 体液隔室（bodyFluid）：体液水与水分亏缺代理

**功能标签：** 体液隔室（不是解剖器官）。

`bodyFluid` 是一个工程隔室，不是解剖器官，因此放在 `organs/human-compartments/body-water/`。它维护“已吸收、尚未离开体液”的水量，并在同一轮向膀胱转出肾脏请求的尿量、向肺转出运动相关呼吸失水、向皮肤转出实际汗液；女性变体另向子宫转出月经失水、向乳腺转出乳汁水。小肠吸收水与结肠残渣水回收都经 `transferIn` 进入体液。下丘脑的 ADH 与口渴脚本只读它的水分亏缺代理。

结算逻辑在共享核心 `water-core.ts`：正常入口 `water.ts` 固定“肾 → 肺 → 汗”三出口，女性变体 `water.female.ts` 在同一列表末位追加 `uterus.bleedingMl` 第四出口与 `mammaryGlands.milkMl` 第五出口。两个入口导出相同的 `id` / `initialState` / `heartbeat`，`fields` 除 `waterVolumeMl.transferOut` 末位多两项外相同；同一清单不能同时加载；根清单只用 `water.ts`，女性清单 `body-modules.female.json` 才用 `water.female.ts`。两者复用同一份 `water.parameters.json`，不新增参数文件。

实现状态：脚本、参数与定向测试已在 `organs/human-compartments/body-water/`；根清单当前为 39 个部位、35 份唯一参数文件；女性清单为 42 个部位、38 份唯一参数文件，并使用独立 `statePath`；男性清单为 41 个部位、37 份唯一参数文件。按去重并集计，全库共 45 份参数文件：根清单 35 份，女性清单独有 3 份（`ovaries`、`uterus`、`mammary-glands`），男性清单独有 2 份（`testes`、`epididymis`），另有 5 份不随任何清单加载（3 份 DI 变体、`parathyroid` 与 `calcium` 各一份）。三份清单分别加载 35 / 38 / 37 份；三个肌肉区域共享 `skeletal-muscle/glucose-uptake.parameters.json`，`water.female.ts` 复用 `water.parameters.json`，饥饿素经 `motility-core.ts` 复用 `motility.parameters.json`，共享文件只计一次。乳腺切片把 `water.female.ts` 的出口从四路扩到五路，并按设计在 `glucose.female.ts` 末位增加乳糖汇；结肠切片把残渣水回收加入 `transferIn`，不新增出口。既有 M3 水链与 M19 验收记录保持原口径，乳腺与结肠切片没有重做真实 DSH 会话，也没有独立人体数据或临床验证。

**清单依赖（transfer 配对校验）。** 正常入口的 `waterVolumeMl` 同时声明 `transferIn: ["smallIntestine.waterVolumeMl", "colon.reclaimedWaterMl"]` 与 `transferOut: ["bladder.volumeMl", "lungs.respiratoryWaterLossMl", "skin.sweatVolumeMl"]`；女性变体在 `transferOut` 末位再加 `uterus.bleedingMl` 与 `mammaryGlands.milkMl`。所以自定义清单加载正常 `bodyFluid` 时必须同时加载 `smallIntestine`、`colon`、`bladder`、`lungs` 与 `skin`；加载女性变体还必须加载 `uterus` 与 `mammaryGlands`，否则启动报 `transferOut target "uterus.bleedingMl" is not declared` 或 `transferOut target "mammaryGlands.milkMl" is not declared`。女性清单的硬 transfer 闭包是在根清单 15 部位之上再加 `uterus` 与 `mammaryGlands`，共 17 部位；`ovaries` 只是子宫的普通轮初读取，不在配对校验内。以下闭包描述按根清单的正常入口：`smallIntestine` 还接收胃水链入口 `stomach/hydration.ts` 的水，向 `colon.residueWaterMl` 转出残渣，并向 `glucose.glucoseMassG` 转出碳水；`glucose` 又向 `kidneyGlucose.excretedGlucoseG` 转出肾糖，并向 `muscleGlucose.uptakeG` 转出肌摄糖。因此完整硬 transfer 闭包是 `hydration.ts`（胃）、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs` 十五个部位，缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；旧入口 `motility.ts` 不声明这些 transfer，不能替代水链胃入口。反过来，加载 `smallIntestine` 也必须带齐上述目标与来源。女性清单另用 `glucose.female.ts`，其 `glucoseMassG.transferOut` 末位多一个 `mammaryGlands.lactoseG`，因此乳腺也在这个闭包内。`physicalActivity` 只是 `skin`、`lungs` 与 `muscleGlucose` 的普通轮初读取，不是 transfer 配对依赖；根清单包含它以提供 `exercise` 能力。`kidney`、`hypothalamusAdh`、`hypothalamusThirst`、`pituitary` 与 `interoception` 之间只有普通 `io.read`，没有 transfer 字段对，所以不在配对校验内；缺这些部位时启动不报错，相关脚本按各自的缺失默认值处理。`esophagus` 不声明 transfer，也不在闭包内。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water.ts`（正常入口，三出口） | `bodyFluid` | `waterVolumeMl`、`waterDeficit` | 自己的轮初状态 `bodyFluid`；`kidney.urineProductionRequestMl`；轮初 `lungs.respiratoryWaterLossRequestMl`；轮初 `skin.sweatRequestMl` | `water.parameters.json` |
| `water.female.ts`（女性变体，五出口） | `bodyFluid` | 同上 | 同上，另读轮初 `uterus.bleedingRequestMl` 与 `mammaryGlands.milkRequestMl` | `water.parameters.json`（复用） |

`water-core.ts` 不是入口，不导出 `id` / `fields` / `heartbeat`；它只提供 `createBodyWater(outlets)`，由两个入口分别给出出口列表。参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

`bodyFluid` 不声明动作（`actionTypes = []`）。`exercise` 由 [`physicalActivity`](../../human-organs/skeletal-muscle/README.md) 接收；皮肤出汗请求由 [`skin`](../../human-organs/skin/README.md) 计算，运动相关呼吸失水请求由 [`lungs`](../../human-organs/lungs/README.md) 计算，月经失水请求由 [`uterus`](../../human-organs/uterus/README.md) 计算，乳汁水请求由 [`mammaryGlands`](../../human-organs/mammary-glands/README.md) 计算；尿、肺失水、汗液、月经失水与乳汁水的转移都由本脚本发起，不经过 `bodyFluid` 的动作入口。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 体液水总量（状态）；`transferIn` 来自 `smallIntestine.waterVolumeMl` 与 `colon.reclaimedWaterMl`，正常入口 `transferOut` 到 `bladder.volumeMl`、`lungs.respiratoryWaterLossMl` 与 `skin.sweatVolumeMl`，女性变体再加 `uterus.bleedingMl` 与 `mammaryGlands.milkMl` |
| `waterDeficit` | `1` | 相对参考量的归一化亏缺代理，范围 −1…1；正为低于参考量，负为高于参考量 |

`waterVolumeMl` 是工程体液水隔室，不是血浆容量、细胞外液、总体水或体重比例。`colon.reclaimedWaterMl` 是结肠残渣水回流的内部暂存字段，提交后为 0，不是外部摄入或支出。`skin.sweatVolumeMl` 是离开体液、经皮肤到外部环境的实际汗液通量；`lungs.respiratoryWaterLossMl` 是离开体液、经呼吸到外部环境的运动相关失水通量，不是总呼吸失水、肺内水量或通气量；`uterus.bleedingMl` 是离开体液、经子宫到外部环境的月经失水通量，只记水量，不含经血成分；`mammaryGlands.milkMl` 是离开体液、经乳腺到外部环境的乳汁水通量，只记水量，不含乳汁成分。`bodyFluid` 不读这些实际通量字段，只通过 transfer 写入。`waterDeficit` 不是血浆渗透压、血容量、口渴评分或尿意评分；它只给下丘脑两个脚本读。

时间原点：`waterVolumeMl` 是轮末状态，初值等于 `referenceVolumeMl`；`waterDeficit` 按轮初水量计算。本轮小肠流入、肾尿、肺失水和汗液都在 transfer 阶段结算，下一轮轮初才反映到体液水。

## 3. 方程与参数

设轮初体液水 `W_start`、肾脏请求 `R_kidney = kidney.urineProductionRequestMl`、肺请求 `R_lung = lungs.respiratoryWaterLossRequestMl`、皮肤出汗请求 `R_sweat = skin.sweatRequestMl`、子宫月经请求 `R_uterus = uterus.bleedingRequestMl`、乳腺乳汁请求 `R_mammary = mammaryGlands.milkRequestMl`。正常入口 `water.ts`：

```text
waterDeficit = clamp((referenceVolumeMl − W_start) / deficitScaleMl, −1, 1)
U_kidney = clamp(R_kidney, 0, W_start)
U_lung = clamp(R_lung, 0, max(0, W_start − U_kidney))
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney − U_lung))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → lungs: U_lung
transfer bodyFluid → skin: U_sweat
```

女性变体 `water.female.ts` 在前三路之后追加第四、第五路，顺序是 `policy`：

```text
U_uterus  = clamp(R_uterus, 0, max(0, W_start − U_kidney − U_lung − U_sweat))
U_mammary = clamp(R_mammary, 0, max(0, W_start − U_kidney − U_lung − U_sweat − U_uterus))
write.waterVolumeMl = W_start
transfer bodyFluid → uterus: U_uterus
transfer bodyFluid → mammaryGlands: U_mammary
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `bodyFluid.referenceVolumeMl` | 30000 | `mL` | `design` | —（无直接证据） |
| `bodyFluid.deficitScaleMl` | 500 | `mL` | `design` | —（无直接证据） |

初值水量等于参考量。肾脏请求先支付，肺请求其次，汗液只能使用扣除前两路后的轮初余量；女性变体的月经失水再排在汗之后，乳汁水再排在月经之后，只能使用前序出口之后的余量。`U_kidney + U_lung + U_sweat + U_uterus + U_mammary ≤ W_start`，各路分别钳位不会造成重复支付。顺序只是 `policy`，不是人体排泄优先级证据；乳腺排在最后是因为水量小且请求来自乳腺脚本，不代表人体失水优先级。transfer 都在 `write` 之后发出，小肠同轮新流入在 transfer 阶段才加入体液，不能支付本轮尿、肺失水、汗、月经失水或乳汁水。`write.waterVolumeMl = W_start` 是转出前基准；Gateway 再扣各路 transfer，实际肺失水只通过 transfer 加入 `lungs.respiratoryWaterLossMl`，实际汗液只通过 transfer 加入 `skin.sweatVolumeMl`，实际月经失水只通过 transfer 加入 `uterus.bleedingMl`，实际乳汁水只通过 transfer 加入 `mammaryGlands.milkMl`。

肾脏请求、肺请求、皮肤请求、子宫请求和乳腺请求都有一轮延迟：`kidney` 每轮按轮初 ADH 计算下一轮请求，`lungs` 每轮按轮初活动计算下一轮请求，`skin` 每轮按轮初活动计算下一轮请求，`uterus` 每轮按轮初卵巢周期日、激素和自身内膜计算下一轮请求，`mammaryGlands` 每轮按轮初垂体催乳素计算下一轮请求；`bodyFluid` 在下一轮轮初读取它们。请求大于轮初可用量时按上述顺序钳到可用量，不制造 fatal。**直接调用本模块**时，`kidney`、`lungs`、`skin`、女性变体的 `uterus` 或 `mammaryGlands` 缺失，或对应请求字段缺失、负数、非有限、非数值，都按 0 处理。完整 Gateway 清单不能缺 `skin`、`lungs` 等 `transferOut` 目标：目标未声明会让 `createFieldRegistry` 启动失败，不能靠这个 0 回退绕过；女性清单缺 `uterus` 或 `mammaryGlands` 时同样启动失败。

水账在既有恒等式上增加结肠残渣水项、累计实际肺失水、汗液和（仅女性变体）月经失水、乳汁水项：

```text
胃水 + 队列水 + 小肠水 + 结肠残渣水 + (体液水 − 初始体液水)
+ 膀胱尿 + 累计 voidedMl + 累计 lungs.respiratoryWaterLossMl
+ 累计 skin.sweatVolumeMl
+ 累计 uterus.bleedingMl
+ 累计 mammaryGlands.milkMl
= 累计饮水
```

结肠回收水（`colon.reclaimedWaterMl → bodyFluid.waterVolumeMl`）是残渣水池到体液的内部回流，不是新的外部支出或第二次摄入：它让结肠残渣水同量减少、体液水同量增加，所以只在结肠残渣水项里体现，不另加一条外部流入；`reclaimedWaterMl` 提交后为 0，不是可累计读数。最后两项只在加载 `water.female.ts` 时存在；根清单没有子宫与乳腺，水账保持原恒等式。“胃水”是 `stomach.waterVolumeMl`，“队列水”是 `stomach.mealQueue` 中剩余水量之和，“小肠水”是 `smallIntestine.waterVolumeMl`，“结肠残渣水”是 `colon.residueWaterMl`，“膀胱尿”是当前 `bladder.volumeMl`；`voidedMl` 已包含主动与非自主排出，只累计一次。`respiratoryWaterLossRequestMl`、`sweatRequestMl`、`bleedingRequestMl` 与 `milkRequestMl` 不进入水账，只有实际 `respiratoryWaterLossMl`、`sweatVolumeMl`、`bleedingMl` 和 `milkMl` 逐轮累加；无活动时肺与汗两项为 0，非经期子宫项为 0，乳腺请求未被支付时乳汁水项为 0。逐轮核对容差为 `1e-6 mL`。

## 4. 读写边界

- 每个入口在自己的清单里是 `bodyFluid` 的唯一写者，只读自己的轮初状态、`kidney` 的请求字段、轮初 `lungs.respiratoryWaterLossRequestMl` 和轮初 `skin.sweatRequestMl`；女性变体另读轮初 `uterus.bleedingRequestMl` 与 `mammaryGlands.milkRequestMl`。
- 先 `write` 转出前基准，再分别向膀胱、肺和皮肤（女性变体再加子宫与乳腺）请求 `transfer`；即使某路请求为 0 也发 transfer，Gateway 以 write → transfer 的顺序结算。
- 不写 `smallIntestine`、`colon`、`bladder`、`lungs`、`skin`、`uterus`、`mammaryGlands`、`kidney` 或下丘脑部位；也不读胃或肠的原始状态。实际肺失水只由 transfer 进入 `lungs.respiratoryWaterLossMl`，实际汗液只由 transfer 进入 `skin.sweatVolumeMl`，实际月经失水只由 transfer 进入 `uterus.bleedingMl`，实际乳汁水只由 transfer 进入 `mammaryGlands.milkMl`；本脚本不直接写这四个字段，也不改写 `lungs.respiratoryWaterLossRequestMl`、`skin.sweatRequestMl`、`uterus.bleedingRequestMl` 或 `mammaryGlands.milkRequestMl`。结肠回收水由结肠脚本作为源字段唯一写者发 transfer，本脚本只接收，不写 `colon.reclaimedWaterMl`。
- 不建器官间“转移账本”之外的任何状态；`waterDeficit` 是唯一对外信号。月经量、经期与内膜的证据边界归 [`uterus`](../../human-organs/uterus/README.md)，乳汁水与乳糖的证据边界归 [`mammaryGlands`](../../human-organs/mammary-glands/README.md)，本脚本只做水量结算。

## 5. 时序、旧档与无活动轨迹

活动、请求和体液转移各隔一轮：一次 `exercise` 在第 1 轮提交活动状态，`skin` 与 `lungs` 第 2 轮按轮初活动分别写出汗和运动相关呼吸失水请求，`bodyFluid` 第 3 轮才按这两个请求转出实际汗液与肺失水。活动结束后皮肤和肺下一轮请求归 0，体液再下一轮停止转移；轮次示例见 [`skin` README](../../human-organs/skin/README.md) 与 [`lungs` README](../../human-organs/lungs/README.md)。

月经失水同理再隔两轮：`ovaries` 在第 N 轮写周期日与激素，`uterus` 第 N+1 轮按轮初卵巢值写 `bleedingRequestMl`，`bodyFluid` 女性变体第 N+2 轮才按该请求把水转入 `uterus.bleedingMl`。经期结束后子宫下一轮请求归 0，体液再下一轮停止转移；请求字段不是实际失水，只有 transfer 后的 `bleedingMl` 进入水账。

乳汁水同理：`pituitary` 在第 N 轮写 `prolactinRelative`，`mammaryGlands` 第 N+1 轮按轮初催乳素写 `milkRequestMl`，`bodyFluid` 女性变体第 N+2 轮才按该请求把水转入 `mammaryGlands.milkMl`。默认女性 `mammaryGlands.lactating: false` 时，乳腺把 `milkRequestMl = 0`、`milkMl = 0`、`lactoseRequestG = 0`、`lactoseG = 0` 写回自身状态，不发起乳汁或乳糖请求；`pituitary` 下一轮读到 `milkMl` 仍为 0，催乳素维持 1.0。显式把 `lactating` 置 `true` 后乳腺才写非零请求，`bodyFluid` 再下一轮支付，`pituitary` 在支付后的轮初读到 `milkMl > 0` 才把催乳素目标抬到 2。根清单没有乳腺与第五出口，行为不变。

- **旧档：** 启动时只给缺失的 `physicalActivity` 补 `{ remainingExerciseMin: 0, intensity: 0 }`、给缺失的 `skin` 补 `{ sweatRequestMl: 0, sweatVolumeMl: 0 }`、给缺失的 `lungs` 部位或字段补 `{ respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 }`、给缺失的 `colon` 补 `{ residueWaterMl: 0, stoolG: 0, defecatedG: 0, reclaimedWaterMl: 0, bowelUrgencyMm: 0 }`；女性清单还只给缺失的 `ovaries` / `uterus` / `mammaryGlands` 补各自 `initialState`，不反推历史活动、历史出汗、历史呼吸失水、历史周期、历史经量或历史泌乳。既有 `bodyFluid` 水量不被重置；旧 `pituitary` 档缺 `prolactinRelative` 时由该模块补 1。
- **重启：** 保留活动剩余时间/强度、皮肤请求/实际汗液、肺请求/实际失水，以及女性清单的周期日、内膜、上一轮子宫请求、乳腺请求/实际乳汁/胀奶；已发生的汗液、呼吸失水、月经失水与乳汁水已在体液中扣除，不会按历史轮数重复扣水。`skin`、`lungs`、`uterus` 与 `mammaryGlands` 每轮 `write` 先把各自的实际量归 0，存档最后一轮的实际量不会被下一轮重复累计。
- **无活动：** 默认没有 `exercise` 时 `skin` 请求、`lungs` 请求和两路实际通量都是 0，`bodyFluid` 的肺与汗出口为 0；水账、`waterDeficit` 与口渴轨迹与既有 M3 行为一致。肺切片不自动运动、不自动饮水，也不因时间流逝产生汗液或呼吸失水。
- **无子宫或非经期：** 根清单没有子宫，女性变体也不会被加载，月经出口不存在；女性清单在经期结束后子宫请求归 0，体液再下一轮停止转移，之后 `bleedingRequestMl` 与 `bleedingMl` 都为 0，水账对应项不再增加。子宫未加载而直接调用女性变体时，该路按 0 处理；完整女性清单缺 `uterus` 则在启动时因 transfer 配对失败。
- **无乳腺或默认非泌乳：** 根清单没有乳腺，女性变体也不会被加载，乳汁出口不存在；女性清单默认 `mammaryGlands.lactating: false`，乳腺每轮把 `milkRequestMl = 0`、`milkMl = 0`、`lactoseG = 0` 写回自身状态（不是跳过写入），`pituitary` 读到的 `milkMl` 为 0，催乳素维持 1.0，水账该路不增加。显式把 `lactating` 置 `true` 后才按基线 0.5 mL/min 写请求。乳腺未加载而直接调用女性变体时，该路按 0 处理；完整女性清单缺 `mammaryGlands` 则在启动时因 transfer 配对失败。

## 6. 证据入口

- 脚本头部的块注释明确写“无直接证据”，两个体液参数都是工程假设。
- 皮肤出汗的四个参数（25°C、0.6 mL/min、0.04/°C、2 mL/min）全部为 `design`、`source: null`，位于 `skin/sweat.parameters.json`；详见 [`skin` README](../../human-organs/skin/README.md)。它们不是人体出汗测量、METs、热量或最大出汗率。
- 肺失水参数 `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3 mL/min` 为 `design`、`source: null`，位于 `lungs/respiratory-water-loss.parameters.json`；只表示运动相关呼吸失水的临时工程速率，不是实测呼吸失水率或总呼吸失水。详见 [`lungs` README](../../human-organs/lungs/README.md)。
- 月经失水的证据边界归 [`uterus` README](../../human-organs/uterus/README.md)：`mensesDays = 4.0` 是 Bull 2019 的自报出血天数（`prior`；队列为 Natural Cycles 用户、厂商资助、仅排卵周期），50 mL/周期等其余参数为 `design`、`source: null`。本变体不新增参数、不新增来源，只复用 `water.parameters.json`。
- 乳汁水的证据边界归 [`mammaryGlands` README](../../human-organs/mammary-glands/README.md)：`basalMilkRateMlPerMin = 0.5`、`lactoseGPerMl = 0.07`、`fullnessGainPerMl = 4` 与 `fullnessDecayHalfTimeMin = 30` 四个参数全部 `design`、`source: null`，不是实测泌乳率、乳糖浓度、胀奶量表或婴儿需求；本变体只按请求结算水量，默认 `lactating: false` 时请求为 0。
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.3；活动—出汗切片：[`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §5–§8；肺切片：[`2026-11-23-respiratory-water-loss-design.md`](../../../docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md)；女性变体与第四出口：[`2026-11-23-reproductive-cycle-design.md`](../../../docs/superpowers/specs/2026-11-23-reproductive-cycle-design.md)；第五出口：[`2026-11-24-mammary-glands-design.md`](../../../docs/superpowers/specs/2026-11-24-mammary-glands-design.md)。
- 共享登记簿：[`../../human-organs/references/source-index.csv`](../../human-organs/references/source-index.csv)（本切片未新增来源行；`SRC-BULL-2019` 的笔记在卵巢目录，登记行在共享登记簿）。

**证据边界：** 30 L 与 500 mL 都没有人体来源，不能称为实测总体水、血浆容量、体重比例或渗透压阈值；参数文件里的 `range` 只是工程调参范围，不是人体百分位。`0.3 mL/min` 同样没有人体来源，只覆盖运动相关呼吸失水的工程近似，不包含静息或总呼吸失水。月经失水只记水量，不建经血成分、铁丢失、血红蛋白、凝血或大出血；`uterus` 的 50 mL/周期、85 mm 痛经代理等都不是实测值。既有 M3/M19 验收记录只覆盖各自历史范围，本切片不重写它们，也不把它们当作活动—肺—汗链或生殖链的验收；肺切片与生殖切片都未做真实 DSH 会话、独立人体数据或临床验证，工程参数不能称为已测量或 `validated`。

## 7. 当前限制

- **不是渗透压模型**：不建血浆/尿渗透压、电解质、钠钾平衡或口渴阈值；水量 mL 不换算成 mOsm。
- **不是血容量/血压模型**：不建循环、RAAS、心房利钠肽或压力感受器。
- **只建模显式运动出汗与运动相关呼吸失水**：不建静息呼吸失水、不感蒸发、通气量、潮气量、呼吸频率、血气或粪便干重；汗液只以 mL 表示，不建汗液电解质、皮肤分区、皮肤温度、湿润度、蒸发残余、环境热应激或体温调节。无活动时不出汗、不产生肺失水。结肠残渣水与回收水只作为水量项进入水账，不建粪便成分、纤维发酵或菌群。
- **只建模月经失水与乳汁水的水量**：女性变体只把 `uterus.bleedingRequestMl` 与 `mammaryGlands.milkRequestMl` 当体积请求，不建经血成分、血块、组织液、血红蛋白/铁丢失、凝血、纤溶、前列腺素、子宫内膜厚度、痛经机制或大出血，也不建乳汁脂肪/蛋白/免疫成分、乳糖合成、乳房解剖、婴儿吸吮或哺乳行为；请求不是瞬时经血流率或泌乳率。根清单不加载这两个出口，`water.ts` 的三出口语义不变。
- **不是运动生理模型**：不建 METs、热量/能量消耗、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、姿势或个体差异；`intensity` 只是模型内相对强度。
- **不是总体水**：30 L 只是一个工程参考量，不随年龄、性别、体重或体脂调整。
- **单隔室**：不区分细胞内、细胞外、血浆与间质。
- **未做真实 DSH 会话、独立人体出汗/呼吸失水/泌乳数据或临床验证**：模型内的出汗量、肺失水量与乳汁水量只是水账/时序核对，不是实测汗量、呼吸失水量或泌乳量，也不能外推为运动、通气、体温或哺乳模型。
