# 子宫（uterus）：内膜、月经失水与痛经代理

**功能标签：** 生殖（子宫内膜相对量、月经失水请求、痛经代理）。

`uterus` 只有一个脚本 `uterus.ts`，把轮初卵巢激素相对量映射为内膜相对量，并按周期日产生月经失水请求与痛经代理。它没有动作、不调用 `transfer`、不发送通知，也不写其他部位。两个消费者：

- [`interoception`](../brain/README.md) 的第五路 `discomfort` 读取 `crampMm`（软读；根清单没有子宫时按 0）；
- [`bodyFluid`](../../human-compartments/body-water/README.md) 的女性变体读取 `bleedingRequestMl`，把 `bodyFluid.waterVolumeMl` 转入 `bleedingMl`。

**状态口径。** 当前实现（2026-11-23）：脚本与参数在 `organs/human-organs/uterus/`，只随独立女性清单 `body-modules.female.json` 加载；根清单为 38 部位、34 份唯一参数文件，不含子宫。女性清单为 41 部位、37 份唯一参数文件，并使用独立 `statePath`。`mensesDays = 4.0` 取 Bull 2019 的自报出血天数（`prior`、`SRC-BULL-2019`）；经量、痛经、内膜半时和权重全是 `design`、`source: null`。尚未做真实 DSH 会话、独立经量/痛经数据或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `uterus.ts` | `uterus` | `endometriumRelative`、`crampMm`、`bleedingRequestMl`、`bleedingMl` | 自己的轮初 `endometriumRelative`；轮初 `ovaries.cycleDay` / `estradiolRelative` / `progesteroneRelative`；`io.dt` | `uterus.parameters.json` |

- `actionTypes = []`；无动作、无通知、不调用 `transfer`，不写其他部位。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是工程默认值，不做运行中热切换。
- `bleedingMl` 只由 `transferIn` 增加；本脚本每轮写出的完整下一状态先把 `bleedingMl` 归 0，不是由本脚本主动失水。

## 2. 字段与单位

四个字段都是 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `endometriumRelative` | `1` | 子宫内膜相对量 0–1 代理；按激素目标做一阶趋近。不是毫米厚度、组织学分期或内膜容积 |
| `crampMm` | `mm` | 痛经代理 0–100 mm；经期前段高、随后线性衰减。不是疼痛测量、VAS 实测或临床痛经分级 |
| `bleedingRequestMl` | `mL` | **下一轮**月经失水请求；不是本轮已失水、瞬时经血流率或累计经量 |
| `bleedingMl` | `mL` | 本轮由 `bodyFluid.waterVolumeMl` 转入的实际失水；每轮 write 先归 0，只有 transfer 才加入。不是请求量或累计量 |

`bleedingMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`，与女性变体 `water.female.ts` 的 `transferOut` 配对。时间原点：`bleedingRequestMl` 在轮末写出，供下一轮 `bodyFluid` 读取；`bleedingMl` 表示本轮 transfer 结算后的实际通量，下一轮轮初会被重新归 0。`endometriumRelative` 是轮末状态，初值 0.1；`crampMm` 按轮初 `cycleDay` 计算。

## 3. 方程与参数

设轮初 `cycleDay = D`、轮初自身内膜 `prevEndo`、`E2 = estradiolRelative`、`P4 = progesteroneRelative`、`dtMin = io.dt / 60`、`dtDays = dtMin / 1440`：

```text
target = clamp(0.7 × E2 + 0.3 × P4, 0, 1)
endometriumRelative = target + (prevEndo − target) × 2^(−dtDays / 2)
crampMm = D < 2.5 ? clamp(85 × (1 − D / 2.5), 0, 100) : 0
bleedingRequestMl = D < 4.0 ? 50 × prevEndo / (4.0 × 1440) × dtMin : 0
write { endometriumRelative, crampMm, bleedingRequestMl, bleedingMl: 0 }
```

- 内膜一阶趋近的半时是 2 天；目标由 E2（权重 0.7）与 P4（权重 0.3）线性组合后钳到 0–1。权重与半时都是 `design`，不是受体动力学或内膜生长/脱落测量。
- 痉挛在周期第 0 天为 85 mm，按 2.5 天线性降到 0；第 2.5 天及以后为 0。`cycleDay` 是轮初值，所以同一轮的痉挛与经期判定都基于轮初快照。
- 经期请求只在 `D < 4.0` 时非 0，且正比于轮初内膜：内膜越厚，请求越大。请求是**速率 × dt**，不是一次性总量；60 s 一轮时，`D = 1`、`prevEndo = 0.8` 的请求为 `50 × 0.8 / (4.0 × 1440) ≈ 0.00694 mL`。
- `flowMlPerCycle = 50 mL` 是参数名义值；实际请求还要乘 `prevEndo`（0–1）并受轮初可用水钳制，因此实际周期失水通常小于 50 mL，不是固定 50 mL。
- 经期与早卵泡期重叠是常态；模型不为月经单独设相位，月经只由子宫按 `cycleDay` 判定。

同目录 `uterus.parameters.json`：

| 参数 ID | 默认值 | 单位 | 状态 | 来源 |
| --- | ---: | --- | --- | --- |
| `uterus.mensesDays` | 4.0 | `d` | `prior` | `SRC-BULL-2019` |
| `uterus.flowMlPerCycle` | 50 | `mL` | `design` | — |
| `uterus.crampPeakMm` | 85 | `mm` | `design` | — |
| `uterus.crampDurationDays` | 2.5 | `d` | `design` | — |
| `uterus.endometriumHalfTimeDays` | 2 | `d` | `design` | — |
| `uterus.endometriumEstradiolWeight` | 0.7 | `1` | `design` | — |
| `uterus.endometriumProgesteroneWeight` | 0.3 | `1` | `design` | — |

`mensesDays = 4.0` 是 Bull 2019 队列的**自报连续出血天数**（bleed length，不含 spotting）均值，不是临床测量的经期天数、经量或个体预测。其余六个值都是工程假设：50 mL/周期不是实测经量，85 mm 不是痛经测量，2.5 天不是症状持续时间证据，2 天半时与 0.7/0.3 权重不是内膜生物学拟合。参数文件里的 `range` 只是工程调参范围，不是人群范围或临床界值。

## 4. 消费者与时序

```text
ovaries.cycleDay / estradiolRelative / progesteroneRelative
  → uterus（下一轮轮初读取）
      → interoception.discomfort（第五路软读 crampMm）
      → bleedingRequestMl
          → bodyFluid 女性变体（再下一轮轮初读取并结算）
              → uterus.bleedingMl（实际转移）
```

- Gateway 给同一轮所有脚本一份轮初快照。`uterus` 在下一轮才看到 `ovaries` 本轮写出的周期日与激素；`interoception` 读到的 `crampMm` 和 `bodyFluid` 读到的 `bleedingRequestMl` 也都是轮初值，最早下一轮才反映子宫本轮写入，不会在同一轮里追上。具体来说，`ovaries` 第 N 轮写激素，`uterus` 第 N+1 轮按轮初值写请求与痉挛，`bodyFluid` 第 N+2 轮才结算月经失水。
- `interoception` 只在 `discomfort` 的第五路读取 `crampMm`：`crampMm` 缺失、NaN 或非有限时按 0；子宫未加载时也按 0，根清单行为逐点不变。它不新增字段、不通知，`brainNotify` 不读 `discomfort`，所以痛经不会发提醒。
- `bodyFluid` 女性变体把 `bleedingRequestMl` 钳到扣除肾、肺、汗之后的本轮轮初余量，再把实际量转入 `bleedingMl`；请求超出余量时实际量小于请求，不制造负水或额外补液。请求本身不进入水账，只有实际 `bleedingMl` 逐轮累计。
- 60 s 一轮、`D = 1`、`prevEndo = 0.8` 时，痉挛为 `85 × (1 − 1 / 2.5) = 51 mm`，低于 `discomfort` 的 70 mm 起始值，所以下一轮体感读到它时 `discomfort` 仍为 0；`D = 0` 的 85 mm 在下一轮体感读出时才会给出 50 mm 的 `discomfort`（`100 × (85 − 70) / 30`）。
- 本脚本不自动开始或停止月经；`cycleDay` 由卵巢周期钟推进，卵巢 `initialState` 的默认 `startCycleDay = 5` 在经期之外，所以新身体首轮不会自动出血或痛经。预置 `cycleDay < 4.0` 的旧档才会进入经期。

## 5. 清单、transfer 配对与边界

- `uterus.bleedingMl` 声明 `transferIn: ["bodyFluid.waterVolumeMl"]`；女性变体 `water.female.ts` 的 `bodyFluid.waterVolumeMl` 在 `transferOut` 末位声明 `uterus.bleedingMl`。两端都是 `mL` / `absolute`。
- 女性清单缺 `uterus` 时，启动报 `transferOut target "uterus.bleedingMl" is not declared`；不能靠省略字段或运行中兜底绕过。缺 `bodyFluid` 时，`uterus.bleedingMl` 的来源未声明，同样启动失败。
- 根清单的 `water.ts` 只有肾 → 肺 → 汗三出口，不声明 `uterus.bleedingMl`；根清单也不加载 `uterus`，所以根身体没有月经失水。同一清单不能同时加载 `water.ts` 与 `water.female.ts`。
- 根清单硬 transfer 闭包为 15 部位（`hydration.ts`、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs`）；女性清单在此之上再加 `uterus` 与 `mammaryGlands`，硬闭包为 17 部位（`mammaryGlands` 也经 `glucose.female.ts` 的乳糖汇进入配对）。`ovaries` 只是 `uterus` 的普通轮初读取，不参与 transfer 配对。
- 女性清单为 41 部位、37 份唯一参数文件（根 38 部位 + `ovaries` + `uterus` + `mammary-glands`；`water.ts` 换成 `water.female.ts`，`glucose.ts` 换成 `glucose.female.ts`，不新增体液或葡萄糖参数文件）。`body-modules.female.json` 必须与根清单一起发布（`package.json` 的 `files` 收录），并使用独立 `statePath`；不要在根身体存档上直接切换清单。

## 6. 旧档与重启

- **新身体：** `initialState = { endometriumRelative: 0.1, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 }`；默认卵巢起始日在经期外，首轮不出血、不痛经。
- **旧女性档缺 `uterus`：** 启动时只补上述初值，不反推历史经期、经量或痛经；已有卵巢周期日不被重置。
- **卵巢未加载：** 子宫整体惰性：`crampMm = 0`、`bleedingRequestMl = 0`，内膜继续按目标 0 一阶衰减；不抛错。缺卵巢的清单不能产生月经失水。
- **卵巢已加载但字段缺失/非有限/为负：** 抛错使本轮失败且不写状态，不用常量掩盖；合法的 0 是有效读数。
- **重启：** `endometriumRelative`、`cycleDay` 等状态随存档保留，下一次 heartbeat 从保存值继续。上一轮 `bleedingMl` 已在体液中扣除；下一轮 write 先把它归 0，不会重复累计或重复扣水。水账按每轮提交的实际 `bleedingMl` 逐轮相加。
- 状态只含有限数字，JSON-safe；没有 `undefined`、`NaN`、`Infinity`、数组或嵌套对象。

## 7. 证据与不能推出

- **`SRC-BULL-2019` / [`bull-2019`](../ovaries/references/notes/bull-2019.md)：** Bull JR et al., npj Digital Medicine 2019;2:83，PMID 31482137，DOI 10.1038/s41746-019-0152-7，PMC6710244，开放获取；登记见 [`source-index.csv`](../references/source-index.csv)。队列为 Natural Cycles app 用户，124,648 人、612,613 个排卵周期；只纳入算法检出排卵的周期；研究由 Natural Cycles Nordic AB 资助，部分作者为雇员或创始人。作者自述队列不代表一般人群，且近一半周期因未检出排卵被排除。
- 本部位只借 Bull 的经期出血天数 **4.0 ± 1.5 天**（Table 1–3 "All cycles"）：连续记录为出血、不含 spotting 的自报天数。它不支撑经量（mL）、经血成分、血红蛋白损失、痛经强度、痉挛持续时间、内膜厚度或激素曲线；Bull 没有流量、疼痛或超声测量。
- 不能把 4.0 天与 50 mL/周期相乘得到每日经量；50 mL 是 `design`，不是 Bull 值，也不是临床月经过多界值。`crampMm` 只是 0–100 mm 代理，不是 VAS 实测或痛经诊断。
- 其余参数都是 `design`、`source: null`，不能称 `validated`；离线测试只核对公式、时序、水账与 JSON-safe，不是人体测量或临床验证。

## 8. 未建模

- **激素与周期调控：** 不建 E2/P4 绝对浓度（`pg/mL`、`ng/mL`）、HPO 轴、LH/FSH、排卵事件、黄体形成/退化、受孕、着床或妊娠；不建激素曲线形状的证据（曲线归 `ovaries`，仍是 `design`）。
- **内膜与经血：** 不建子宫内膜毫米厚度、组织学分期、着床窗口、经血成分（血块、组织液、血红蛋白、铁）、凝血、纤溶、前列腺素或止血机制；只记水量。
- **痛经与症状：** 不建前列腺素机制、疼痛通路、痛经严重度分级、恶心/头痛/腰酸等伴随症状，也没有痛经通知通道；`crampMm` 只进 `interoception.discomfort` 第五路，`brainNotify` 不读不适、不发痛经提醒。不建经前情绪、性欲、乳房胀痛、基础体温或宫颈黏液。
- **解剖与病理：** 不建阴道、宫颈、外阴、输卵管、乳腺或盆腔结构；不建 PCOS、子宫内膜异位、子宫肌瘤、腺肌症、异常子宫出血、围绝经期、青春期、激素避孕或妊娠。
- **男性生殖：** 不建睾丸、睾酮、精子发生或男性生殖道；根清单不含子宫/卵巢，女性清单是独立身体，不引入 `sex` 字段、`presets/` 或 condition 概念。
- **未验证：** 没有真实 DSH 会话、独立经量/痛经/内膜数据、临床验证或 41 部位性能基线；Bull 的 4.0 天是队列均值，不是本身体的个体预测。
