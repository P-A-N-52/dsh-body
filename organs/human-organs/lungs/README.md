# 肺（lungs）：运动相关呼吸失水请求与实际通量

**功能标签：** 呼吸（运动相关失水薄切片）。

`lungs` 只有一个脚本 `respiratory-water-loss.ts`，只持有两个 mL 字段：按轮初 `physicalActivity` 计算下一轮的运动相关呼吸失水请求，以及本轮由 `bodyFluid` 实际转入的通量。它不持有体液水、不调用 `transfer`，也不建通气、血气或呼吸力学。请求不是总呼吸失水：本切片不建静息呼吸失水，也不把活动强度换算成通气量、MET、耗氧量或呼吸频率。

**状态口径。** 当前实现（2026-11-23）：肺脚本与参数在 `organs/human-organs/lungs/`，已加入根清单；根清单为 19 个部位、21 份参数文件（含 3 份不随根清单加载的 DI 变体），硬 transfer 闭包为 9 个部位。肺模块定向测试 8/8 PASS（2026-11-23，[`test/organs.lungs.test.mjs`](../../../test/organs.lungs.test.mjs)），完整 `npm test` 418/418 PASS；这些只是离线实现、时序与水账测试。历史验收：活动—出汗切片当时为 17 部位、19 份参数，M3/M19 的真实 DSH 验收不覆盖肺；本切片未做真实 DSH 会话。设计目标：未来由具备环境条件与活动通气证据的通气/环境模型替换固定速率；当前没有静息呼吸、呼吸频率、潮气量、血气或气喘提醒。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `respiratory-water-loss.ts` | `lungs` | `respiratoryWaterLossRequestMl`、`respiratoryWaterLossMl` | 轮初 `physicalActivity.remainingExerciseMin` / `intensity`；`io.dt`；同目录参数 | `respiratory-water-loss.parameters.json` |

- `actionTypes = []`；无动作、无通知、无直接 `transfer`，不写其他部位。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是工程默认值，不做运行中热切换。
- 唯一真实消费者是 `bodyFluid`：它下一轮读取请求字段并把水转入 `respiratoryWaterLossMl`。`physicalActivity` 只是普通轮初读取，不是 transfer 配对依赖。

## 2. 字段与单位

两个字段都是 `absolute`，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `respiratoryWaterLossRequestMl` | `mL` | 按轮初活动计算的**下一轮**运动相关呼吸失水请求；不是实际失水、累计失水或 mL/min 速率，也不直接进入水账 |
| `respiratoryWaterLossMl` | `mL` | 本轮由 `bodyFluid.waterVolumeMl` 转入的实际通量；每轮写出的完整下一状态先把它置 0，只有 transfer 才加入；不是请求量、累计量或肺内水量 |

`respiratoryWaterLossMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`，表示这是离开体液、经呼吸到外部环境的逐轮通量，不是留在肺里的水或肺水容量。时间原点：`respiratoryWaterLossRequestMl` 在本轮轮末写出，表示下一轮请求；`respiratoryWaterLossMl` 表示本轮 transfer 结算后的实际通量，下一轮轮初会被重新归 0。请求与实际可以不同：体液不足时 `bodyFluid` 会把实际转移钳到可用水量，请求字段仍保留本轮计算值。

## 3. 方程与参数

设轮初活动剩余分钟 `R`、相对强度 `I`、`dtMin = io.dt / 60`：

```text
respiratoryWaterLossRequestMl = R > 0 ? 0.3 × I × dtMin : 0
write.respiratoryWaterLossMl = 0
```

`R = 0` 或 `physicalActivity` 部位缺失时请求为 0；`I = 0` 的合法活动请求也为 0。公式只使用 `io.dt`，不使用 `io.simulatedSeconds`、现实时间或累计运动时长。本轮剩余时间不足一个 `dt` 时，请求仍按整个 `dtMin` 计算，不另做按比例截断，与现有汗液语义一致。60 s 一轮、`I = 1` 时请求 0.3 mL；30 min 活动对应 30 次请求，共 9 mL。请求没有额外速率上限；`dt` 很大或体液不足时，实际转移由 `bodyFluid` 钳到轮初可用水量。

同目录参数：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin` | 0.3 | `mL/min` | `design` | `source: null`；`intensity=1` 时的临时工程速率，不是实测人体呼吸失水率、总呼吸失水或通气量。未来由具备环境条件与活动通气证据的通气/环境模型替换 |

参数文件中的 `range: [0, 2]` 只是工程调参范围，不是人体呼吸失水率范围。该值未被独立数据验证，不能称 `validated`。

## 4. 读写边界与真实消费者

- 本脚本是 `lungs` 的唯一写者，只读轮初 `physicalActivity` 与 `io.dt`；不读自己的轮初状态，不写活动部位。
- 不调用 `transfer`，不写 `bodyFluid`、`skin`、`bladder` 或任何其他部位；实际通量只由 `bodyFluid` 发起的 transfer 进入。
- 真实消费者是 [`bodyFluid`](../../human-compartments/body-water/README.md)：其水账按肾 → 肺 → 汗的工程顺序分配轮初水，读取上一轮 `respiratoryWaterLossRequestMl`，把实际转移加入 `lungs.respiratoryWaterLossMl`。
- 只有实际通量进入水账；请求字段不扣水、不进入水账。实际失水降低 `bodyFluid.waterVolumeMl`，随后由既有 `waterDeficit → hypothalamusThirst → interoception` 链按各自轮初快照读出，但本切片不新增通知、不改变阈值，也不自动饮水。
- 没有其他器官读取肺的两个字段，肺也不产生动作或回执。

## 5. 请求与实际时序

以 60 s 一轮、默认参数、`intensity=1`、`durationMin=30` 为例，一次 `exercise` 在第 1 轮入队并提交：

| 轮次 | 轮初活动（肺所见） | `respiratoryWaterLossRequestMl` | `respiratoryWaterLossMl` | `bodyFluid` 动作 |
| ---: | --- | ---: | ---: | --- |
| 1 | 无活动（0） | 0 | 0 | 读到旧请求 0，不转水 |
| 2 | 30 min / 1 | 0.3 | 0 | 仍读旧请求 0，不转水 |
| 3 | 29 min / 1 | 0.3 | 0.3 | 读第 2 轮请求 0.3，转 0.3 mL |
| … | … | … | … | … |
| 31 | 1 min / 1 | 0.3 | 0.3 | 读第 30 轮请求 0.3 |
| 32 | 0 / 0 | 0 | 0.3 | 读第 31 轮请求 0.3，完成最后一次转移 |
| 33 | 0 / 0 | 0 | 0 | 读第 32 轮请求 0，停止 |

- 第 1 轮活动状态更新，但肺读的是轮初旧活动，所以请求仍为 0；这是“活动先提交、肺下一轮读取”。
- 第 2 轮肺写出 0.3 mL 请求，`bodyFluid` 仍读上一轮请求 0，因此没有实际失水；这是“请求先写出、体液下一轮结算”。
- 第 3 轮 `bodyFluid` 才按请求转水，肺本轮写出的完整状态先把实际量置 0，transfer 后得到 0.3 mL；这是“实际再晚一轮”。
- 30 个活动分钟对应第 2–31 轮共 30 次 0.3 mL 请求，第 3–32 轮共 30 次实际转移，累计 9 mL；不是 0.3 mL 总量，也不在第 1 轮预扣。
- 同一活动的皮肤汗液为 18 mL，肺失水为 9 mL，两者分别记账；18 mL 仍是皮肤汗量，不能改写成包含肺的 27 mL，也不能把 9 mL 算作汗液。
- 以上是模型内的轮次示例，不是人体呼吸失水时程或实测失水量。

## 6. 异常、旧档与重启

- **没有 `physicalActivity`：** 肺按“无活动”请求 0，写出两个 0；根清单包含该部位以提供 `exercise` 能力。
- **已加载 `physicalActivity` 但字段异常：** 部位不是对象、字段缺失、非有限、`remainingExerciseMin < 0`、`intensity < 0` 或 `intensity > 1` 时，肺抛错且本轮不 write；Gateway 整轮原子提交作废，不用固定值掩盖。合法的 `remainingExerciseMin = 0` 与 `intensity = 0` 是有效状态。
- **请求大于可用水：** 肺本身不钳请求；`bodyFluid` 在下一轮把实际转移钳到扣除肾请求后的轮初余量，实际量可以小于请求，不制造负水或额外补液。
- **旧档：** 启动时只给缺失的 `lungs` 部位或字段补 `{ respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 }`，不反推历史呼吸失水；既有 `bodyFluid` 水量不被重置。
- **重启：** 保留活动剩余时间/强度、上一轮请求和上一轮实际量；下一次 heartbeat 按当前活动重算请求，并在 write 时把实际量归 0，`bodyFluid` 再结算存档中的上一轮请求。上一轮请求只结算一次，存档中的实际量不会被重复累计；已发生的失水已在体液中扣除，重启不会重复扣水。

## 7. 硬 transfer 配对与清单闭包

- `lungs.respiratoryWaterLossMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`；`bodyFluid.waterVolumeMl` 声明 `transferOut: ["bladder.volumeMl", "lungs.respiratoryWaterLossMl", "skin.sweatVolumeMl"]`。两个字段都是 `mL` / `absolute`，单位必须一致。
- 缺 `lungs` 时，`bodyFluid` 的 `transferOut` 目标未声明，`createFieldRegistry` 启动失败；缺 `bodyFluid` 时，肺的 `transferIn` 来源未声明，同样启动失败。不能用一个未加载的槽位或“先欠着”的请求绕过。
- 完整硬 transfer 闭包为 9 个部位：`stomach/hydration.ts`（胃）、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`muscleGlucose`、`skin`、`lungs`。`hydration.ts` 向小肠转水，小肠向体液转水并向葡萄糖转碳水，体液向膀胱、肺和皮肤转水，葡萄糖向肾糖与肌肉转糖；缺任一个都会在启动校验时报字段配对错误。
- `physicalActivity` 只是 `skin` 与 `lungs` 的普通轮初读取，不构成 transfer 配对；缺它时两个脚本按无活动处理，但根清单包含它以提供 `exercise` 能力。`kidney`、`hypothalamusAdh`、`hypothalamusThirst`、`interoception` 也只是软读取，不在配对校验内。

## 8. 证据与未建模边界

- 唯一参数 `0.3 mL/min` 是 `design`、`source: null`，没有人体来源；它不是实测呼吸失水率、总呼吸失水、通气量、潮气量或呼吸频率，`range` 只是工程调参范围。脚本头注释、参数文件与设计文档都标注同一等级。
- 只建模**运动相关**呼吸失水：不建静息呼吸失水、不感蒸发、呼吸频率、潮气量、通气量、气体交换、血气、呼吸力学、环境温湿度、运动类型、METs、耗氧量、核心体温、体温调节、气喘/呼吸困难提醒、个体差异或疾病。
- 不建结肠水回收与粪便失水；这些没有上游或真实消费者，仍暂缓。
- 离线测试只验证公式、时序、异常、旧档/重启和水质量守恒；没有真实 DSH 会话、独立人体呼吸失水数据或临床验证，不能把 0.3 mL/min 或 9 mL 外推为人体测量、通气模型或临床结论。
- 设计：[`2026-11-23-respiratory-water-loss-design.md`](../../../docs/superpowers/specs/2026-11-23-respiratory-water-loss-design.md)；体液侧见 [`bodyFluid`](../../human-compartments/body-water/README.md)；活动侧见 [`physicalActivity`](../skeletal-muscle/README.md)；共享登记簿 [`source-index.csv`](../references/source-index.csv)（本切片未新增来源行）。
