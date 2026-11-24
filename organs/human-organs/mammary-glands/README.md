# 乳腺（mammaryGlands）：泌乳请求、乳汁水与乳糖汇

**功能标签：** 生殖 / 内分泌靶点。**仅女性清单加载**（`body-modules.female.json`），根清单 `body-modules.json` 不加载乳腺，也不加载女性葡萄糖变体。

`mammaryGlands` 是乳腺泌乳的薄切片：按布尔状态 `lactating`（默认 `false`）与轮初垂体相对催乳素写出下一轮乳汁水与乳糖请求，并把“产奶多于实际泌乳”的未排空量累积成 0–100 mm 胀奶代理（带 30 min 半时一阶回落，避免一轮结算滞后造成永久棘轮累积）。默认非泌乳状态下不发起泌乳水/糖请求，因此默认女性身体没有每天 1.44 L 的泌乳失水，垂体催乳素维持 1.0。它不建婴儿、吸吮动作、哺乳行为或乳汁成分；本切片只把乳汁的水接到体液、把乳糖能量接到血糖，并让 `fullnessMm` 进入体感不适。

实现状态：脚本 `milk.ts`、参数 `milk.parameters.json`、单元测试与真实 Gateway 测试已落地；当前女性清单为 41 部位、37 份唯一参数文件（根清单 38 / 34，男性清单 40 / 36）。全部参数 `design`、`source: null`，没有实测泌乳率、乳汁乳糖浓度或胀奶量表；未做真实 DSH 会话、独立人体数据或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `organs/human-organs/mammary-glands/milk.ts` | `mammaryGlands` | `lactating`、`milkRequestMl`、`milkMl`、`lactoseRequestG`、`lactoseG`、`fullnessMm` | 自己的轮初状态；轮初 `pituitary.prolactinRelative`（未加载按 1）；`io.dt` | `milk.parameters.json` |

消费者链：

```text
pituitary.prolactinRelative → mammaryGlands.milkRequestMl
mammaryGlands.milkRequestMl → bodyFluid 女性变体第五出口 → mammaryGlands.milkMl
mammaryGlands.lactoseRequestG → glucose 女性变体末位汇 → mammaryGlands.lactoseG
mammaryGlands.fullnessMm → interoception.discomfort 第六路（软读）
```

- `bodyFluid` 女性变体 `water.female.ts` 在肾 → 肺 → 汗 → 子宫之后读轮初 `milkRequestMl`，把 `bodyFluid.waterVolumeMl` 转入 `milkMl`；根清单 `water.ts` 不声明此出口。
- `glucose` 女性变体 `glucose.female.ts` 在肾 → 肝 → 肌之后读轮初 `lactoseRequestG`，把 `glucose.glucoseMassG` 转入 `lactoseG`；根清单 `glucose.ts` 不声明此汇。
- `interoception` 第六路软读 `fullnessMm`；`mammaryGlands` 未加载、字段缺失或非有限时按 0，根清单行为逐点不变，也不发通知。
- `pituitary` 用上一轮 `milkMl > 0` 作为吸吮/排空代理，把 `prolactinRelative` 目标抬到 2；无泌乳时回落到基线 1。该代理只说明“上一轮确有乳汁到账”，不是吸吮剂量或婴儿需求。

`milkMl`、`lactoseG` 每轮 `write` 先归 0，只由 transfer 增加；因此下一轮轮初的 `milkMl` / `lactoseG` 就是上一轮实际到账量。本脚本不调用 transfer，也不读 `bodyFluid` 或 `glucose` 的状态。

## 2. 字段与单位

所有字段均为 `absolute`；`milkMl` 与 `lactoseG` 是 transfer 接收端。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `lactating` | `1` | 布尔泌乳开关，初值 `false`；仅当 `prev.lactating === true` 时才生成乳汁与乳糖请求 |
| `milkRequestMl` | `mL` | 本轮写出的下一轮乳汁水请求；不是实测泌乳量 |
| `milkMl` | `mL` | 上一轮请求在本轮到账的实际乳汁水；`transferIn: ["bodyFluid.waterVolumeMl"]`，每轮 write 归 0 |
| `lactoseRequestG` | `g` | 本轮写出的下一轮乳糖葡萄糖当量请求；不是实测乳糖质量或乳汁成分 |
| `lactoseG` | `g` | 上一轮请求在本轮到账的实际乳糖当量；`transferIn: ["glucose.glucoseMassG"]`，每轮 write 归 0 |
| `fullnessMm` | `mm` | 胀奶代理 0–100 mm；不是乳腺压力、容量、胀痛或临床测量 |

`mm` 只沿用 100-mm 视觉模拟量表的刻度，不与乳房体积、压力或疼痛评分互换；`g` 是葡萄糖当量，不是乳汁总固形物、脂肪、蛋白或免疫成分。

## 3. 方程与参数

设 `dtMin = io.dt / 60`，`prev` 为本部位轮初状态，`P = pituitary.prolactinRelative`（未加载按 1），`decay = 2^(−dtMin / fullnessDecayHalfTimeMin)`：

```text
若 prev.lactating !== true：
  lactating = false, milkRequestMl = 0, lactoseRequestG = 0
  fullnessMm = clamp(prev.fullnessMm × decay, 0, 100)
  write { lactating: false, milkRequestMl: 0, milkMl: 0, lactoseRequestG: 0, lactoseG: 0, fullnessMm }

若 prev.lactating === true：
  rateMlPerMin    = basalMilkRateMlPerMin × P
  milkRequestMl   = rateMlPerMin × dtMin
  lactoseRequestG = milkRequestMl × lactoseGPerMl
  fullnessMm      = clamp(prev.fullnessMm × decay + fullnessGainPerMl × (milkRequestMl − prev.milkMl), 0, 100)
  write { lactating: true, milkRequestMl, milkMl: 0, lactoseRequestG, lactoseG: 0, fullnessMm }
```

胀奶只在“本轮产奶请求 > 上一轮实际泌乳量”时累积，实际泌乳量更大或停滞时按 30 min 半时一阶回落（防止一轮结算滞后造成的永久棘轮累积，并在非泌乳状态平滑归零）；它不反馈到产奶速率，也不区分左右乳、排空方式或哺乳阶段。

| 参数 ID | 值 | 单位 | 状态 | 来源与边界 |
| --- | ---: | --- | --- | --- |
| `mammaryGlands.basalMilkRateMlPerMin` | 0.5 | `mL/min` | `design` | 催乳素为 1 时的工程速率；不是实测泌乳量、婴儿需求或乳头刺激剂量—反应 |
| `mammaryGlands.lactoseGPerMl` | 0.07 | `g/mL` | `design` | 每毫升乳汁的乳糖葡萄糖当量；不是实测乳糖浓度，也不拆分脂肪、蛋白或免疫成分 |
| `mammaryGlands.fullnessGainPerMl` | 4 | `mm/mL` | `design` | 产奶请求超出上一轮实际泌乳量 1 mL 时的胀奶增量；不是乳腺压力、容量或胀痛测量 |
| `mammaryGlands.fullnessDecayHalfTimeMin` | 30 | `min` | `design` | 胀奶代理的一阶回落半时工程假设，防止棘轮累积并在非泌乳状态平滑归零 |

四个参数都在 `milk.parameters.json`，`status: "design"`、`source: null`；`range` 只是工程调参范围。参数文件跟随脚本发布，模块在 import 时经 `lib/parameters.js` 只读加载，不做运行中热切换。

## 4. 时序、异常与旧档

请求与到账分离：

1. 第 N 轮：`pituitary` 写 `prolactinRelative`；`mammaryGlands` 按轮初催乳素写 `milkRequestMl` / `lactoseRequestG` / `fullnessMm`。
2. 第 N+1 轮：`bodyFluid` 女性变体按轮初请求把水转入 `milkMl`；`glucose` 女性变体按轮初请求把糖转入 `lactoseG`；`interoception` 读第 N 轮的 `fullnessMm`。
3. 第 N+2 轮：`pituitary` 读到 `milkMl > 0`，把催乳素目标抬到 2；乳房 `fullnessMm` 用第 N+1 轮的实际 `milkMl` 判断产大于排。

- **缺垂体：** 直接调用或清单未加载 `pituitary` 时按 `prolactinRelative = 1`，仍按基础速率产奶。
- **缺体液或血糖：** 本脚本不读它们，请求照常写出；实际不足由 `bodyFluid` / `glucose` 按各自出口顺序钳位，本脚本记 0 到账。
- **非法上游：** 已加载 `pituitary` 但 `prolactinRelative` 缺失、非数字、非有限或为负时抛错，校验在 `io.write` 之前完成，本轮不写状态、不发起 transfer。
- **旧档：** 缺 `mammaryGlands` 时由 `initialState` 补 `{ lactating: false, milkRequestMl: 0, milkMl: 0, lactoseRequestG: 0, lactoseG: 0, fullnessMm: 0 }`；缺 `pituitary.prolactinRelative` 时补 1。不反推历史泌乳、乳糖或胀奶。
- **重启：** 保留已提交的请求、实际到账与 `fullnessMm`；每轮 write 先把 `milkMl`、`lactoseG` 归 0，上一轮的实际量不会重复累计。脚本无 `resetOnStart`。

## 5. 清单、配对与消费者

女性清单 `body-modules.female.json` 使用 `water.female.ts`、`glucose.female.ts` 与 `milk.ts`：

```text
bodyFluid.waterVolumeMl → mammaryGlands.milkMl        （water.female.ts 第五出口）
glucose.glucoseMassG    → mammaryGlands.lactoseG      （glucose.female.ts 末位汇）
```

- 女性清单缺 `mammaryGlands` 时，`createFieldRegistry` 启动报 `transferOut target "mammaryGlands.milkMl" is not declared`（`water.female.ts` 先于 `glucose.female.ts` 校验）；即使先通过水体校验，`glucose.female.ts` 也会因 `mammaryGlands.lactoseG` 失败。
- 根清单 `body-modules.json` 不含 `mammary-glands/`，使用 `water.ts` 与 `glucose.ts`；根清单的 `glucoseMassG.transferOut` 只声明肾糖、肝储存与肌摄糖，不因乳腺或乳糖汇被强制要求乳腺部位。
- 硬 transfer 闭包：根与男性清单为 15 部位，女性清单因 `uterus` 与 `mammaryGlands` 为 17 部位（`water.female.ts` 的第五出口 + `glucose.female.ts` 的乳糖汇）。乳腺本身只接收两笔 transfer，不再向外转出。
- 参数文件计数：根清单 38 部位、34 份唯一参数；女性清单 41 部位、37 份；男性清单 40 部位、36 份。

## 6. 证据入口与边界

- 本切片没有直接人体来源；四个参数全部 `design`、`source: null`。设计见 [`2026-11-24-mammary-glands-design.md`](../../../docs/superpowers/specs/2026-11-24-mammary-glands-design.md)。
- 催乳素相对信号的证据边界归 [`pituitary`](../brain/README.md) 与 [`brain` README](../brain/README.md)；`prolactinRelative` 不是血浆催乳素浓度、分泌率或临床单位。
- 乳汁水与乳糖的证据边界归本 README；`bodyFluid` 只做水量结算，`glucose` 只做葡萄糖当量结算，二者不新增来源。
- 胀奶的证据边界归本 README；`interoception` 只把 `fullnessMm` 钳位后并入 `discomfort` 第六路，不把它当作疼痛或乳腺压力测量。

**未建模。** 不建婴儿、吸吮动作、哺乳行为、排空事件、乳头刺激、左右乳差异、孕期/产后阶段状态机、哺乳期长短、乳腺病变（炎症、肿瘤、乳腺炎）、乳汁脂肪/蛋白/免疫成分、乳糖合成路径、受体动力学、个体差异、乳房体积/压力/温度、乳汁储存容量与喷射反射。也不建婴儿需求对产奶的反馈；`milkMl > 0` 只是上一轮实际到账的工程代理。

**未验证。** 没有实测泌乳率、乳汁乳糖浓度、胀奶量表、独立人体数据、真实 DSH 会话或临床验证；0.5 mL/min、0.07 g/mL、4 mm/mL 与 30 min 半时都是工程假设，不能称拟合、实测或 `validated`。女性 41 部位性能未实测。

## 7. 测试

- `test/organs.mammary.test.mjs`：模块契约、参数、催乳素/缺失回退、请求公式、胀奶累积与回落、JSON-safe、非法上游。
- `test/organs.mammary-gateway.test.mjs`：真实 Gateway 女性清单预置高催乳素 → 乳汁水与乳糖到账、血糖池减少、`fullnessMm` 上升并进入 `discomfort`、水账包含 `mammaryGlands.milkMl`、缺乳腺启动报错、根清单无乳腺可启动、重启接续。
- `test/organs.glucose.test.mjs` 与 `test/organs.body-water-female.test.mjs`：两个变体入口的字段配对、结算顺序与钳位。
