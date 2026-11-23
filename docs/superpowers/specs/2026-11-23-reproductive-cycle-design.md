# 卵巢周期与子宫薄切片设计（女性身体）

日期：2026-11-23
状态：owner 已授权"一次把一个器官需要的部分做全"，明确**要做性激素**；清单形态、出血入水账、两部位拆分为主代理按 DI 先例与消费者约束选定。

## 目标与边界

新增 `ovaries`（周期钟 + 雌二醇/孕酮相对量）与 `uterus`（内膜 → 月经出血 + 痛经）两个部位，女性身体用**独立清单/独立存档** `body-modules.female.json`（DI 先例），不引入 `presets/`、sex 字段或 condition 概念。每个量都有消费者：

- `ovaries.estradiolRelative` / `progesteroneRelative` → `uterus.endometriumRelative` 目标值；
- `uterus.endometriumRelative` → `uterus.bleedingRequestMl`（经量正比于内膜）；
- `uterus.bleedingRequestMl` → `bodyFluid` 女性变体第四出口 → `uterus.bleedingMl`（实际转移）；
- `uterus.crampMm` → `interoception.discomfort` 第五路（软读，根清单无子宫时恒 0）。

本步不建激素绝对浓度（pg/mL、ng/mL）、排卵/受孕、子宫内膜毫米厚度、经血成分、阴道/乳腺/外阴、男性生殖器官与睾酮、性欲或情绪行为、痛经通知通道、体温与避孕。`brainNotify` 不读 `discomfort` 的现状不变，痛经只进 `discomfort`、不发通知。

## 方案比较

- **只做相位钟（不做）。** 钟单独没有脚本消费者，且 owner 明确要激素。
- **周期 + 激素 + 子宫全链（采用）。** 激素经内膜产生真实下游效应，出血与痛经都有消费者，一次做全，避免来回补刀。
- **出血只记录不进体液账（不做）。** 没有消费者；出血必须经 `bodyFluid` 才成立。
- **根清单加子宫/卵巢（不做）。** 会让所有身体（含男性）共用同一套生殖器官；用独立清单保持根清单 19 部位、21 份参数不变，根清单全部测试不受影响。

## 部位与参数

### `ovaries`（`organs/human-organs/ovaries/menstrual-cycle.ts`）

无动作、无 transfer。字段：

| 字段 | 单位 | mode | 含义 |
| --- | --- | --- | --- |
| `cycleDay` | `d` | absolute | 周期内第几天（小数），每轮推进 `dtMin / 1440`，到 `cycleLengthDays` 回卷 |
| `cycleLengthDays` | `d` | absolute | 本身体周期长度（参数） |
| `phase` | `-` | absolute | `follicular` / `ovulatory` / `luteal` 字符串 |
| `estradiolRelative` | `1` | absolute | 雌二醇相对量 0–1，不是 pg/mL |
| `progesteroneRelative` | `1` | absolute | 孕酮相对量 0–1，不是 ng/mL |

相位：`cycleDay < follicularLengthDays` 为 `follicular`；`< follicularLengthDays + 1` 为 `ovulatory`；其余 `luteal`。月经期不单独设相位（月经由子宫按 `cycleDay` 判定，与早卵泡期重叠是常态）。排卵带为 1 天 `design`，嵌在 Bull 的 F+L = 29.3 之内，因此 `luteal` 相位实际跨 11.4 天；`lutealLengthDays = 12.4` 只作激素曲线形状参数（黄体中期 = `follicular + luteal/2`），不是相位边界，两者口径不同。

激素曲线为分段线性（`design` 形状，不是实测浓度曲线；峰值归一为 1）：

- E2：卵泡期由 `nadir` 升至 1（排卵日）；随后 1 天降至 `nadir`；黄体中期（`follicular + luteal/2`）升到 `lutealBump`，周期末回到 `nadir`。
- P4：卵泡期与排卵日保持 `baseline`；排卵次日起到黄体中期升至 1；随后降至周期末 `baseline`。

参数（`menstrual-cycle.parameters.json`）：

| id | 值 | 来源 |
| --- | --- | --- |
| `ovaries.cycleLengthDays` | 29.3 | `SRC-BULL-2019`（以笔记核对值为准） |
| `ovaries.follicularLengthDays` | 16.9 | 同上 |
| `ovaries.lutealLengthDays` | 12.4 | 同上 |
| `ovaries.startCycleDay` | 5 | `design`，起始在经期外，避免新身体首轮即痛经 |
| `ovaries.estradiolNadirRelative` | 0.1 | `design` |
| `ovaries.estradiolLutealBumpRelative` | 0.5 | `design` |
| `ovaries.progesteroneBaselineRelative` | 0.05 | `design` |

Bull 2019（npj Digit Med，PMID 31482137，开放获取）只支撑周期/相位长度与变异，不支撑激素曲线形状、经量或痛经强度；其队列为 Natural Cycles 用户且有厂商资助，笔记须写明。

### `uterus`（`organs/human-organs/uterus/uterus.ts`）

无动作。字段：

| 字段 | 单位 | mode | 含义 |
| --- | --- | --- | --- |
| `endometriumRelative` | `1` | absolute | 内膜相对量 0–1，一阶趋近激素目标值 |
| `crampMm` | `mm` | absolute | 痛经代理 0–100 mm，经期前段高、随后衰减 |
| `bleedingRequestMl` | `mL` | absolute | 本轮月经失水请求，供下一轮 `bodyFluid` 读取 |
| `bleedingMl` | `mL` | absolute | 实际失水，仅 `transferIn: ['bodyFluid.waterVolumeMl']`，每轮 write 归 0 |

公式（读轮初 `ovaries` 的 `cycleDay` / E2 / P4 与自身上一轮 `endometriumRelative`；`dtDays = dtMin / 1440`）：

```text
target = clamp(estradiolWeight × E2 + progesteroneWeight × P4, 0, 1)
endometriumRelative = target + (prevEndo − target) × 2^(−dtDays / endometriumHalfTimeDays)
crampMm = cycleDay < crampDurationDays
  ? clamp(crampPeakMm × (1 − cycleDay / crampDurationDays), 0, 100) : 0
bleedingRequestMl = cycleDay < mensesDays
  ? flowMlPerCycle × prevEndo / (mensesDays × 1440) × dtMin : 0
write { endometriumRelative, crampMm, bleedingRequestMl, bleedingMl: 0 }
```

参数（`uterus.parameters.json`；`mensesDays = 4.0` 取 Bull 2019 自报连续出血天数（不含 spotting），`status: prior`、`source: SRC-BULL-2019`，其余均 `design`、`source: null`）：

`uterus.mensesDays = 4.0`、`uterus.flowMlPerCycle = 50`、`uterus.crampPeakMm = 85`、`uterus.crampDurationDays = 2.5`、`uterus.endometriumHalfTimeDays = 2`、`uterus.endometriumEstradiolWeight = 0.7`、`uterus.endometriumProgesteroneWeight = 0.3`。

`ovaries` 未加载时子宫整体惰性（`crampMm = 0`、`bleedingRequestMl = 0`，内膜维持自身一阶趋近目标 0）；已加载但 `cycleDay` / E2 / P4 缺失、非有限或为负时抛错使本轮失败，不用常量掩盖。自身字段缺失由 `initialState` 补 `endometriumRelative = 0.1`、其余 0。

## `interoception` 第五路

`discomfort = max(原四路, excessOverOnset(uterus.crampMm, discomfortOnsetMm))`。`uterus` 未加载时按 0，根清单行为逐点不变；`crampMm` 缺失/NaN 按 0（沿用 `finiteOr` 惯例）。不加字段、不加通知。

## `bodyFluid` 女性变体

按 `kidney/urine-production-core.ts`、`stomach/motility-core.ts` 的既有模式把 `water.ts` 抽成 `water-core.ts` 工厂 + 入口；`water.ts` 出口不变（肾 → 肺 → 汗），`water.female.ts` 增加第四出口（排在最后，顺序是 `policy`）：

```text
U_uterus = clamp(uterus.bleedingRequestMl, 0, max(0, W_start − U_kidney − U_lung − U_sweat))
transfer bodyFluid.waterVolumeMl → uterus.bleedingMl: U_uterus
```

`uterus.bleedingMl.transferIn: ['bodyFluid.waterVolumeMl']` 与变体 `transferOut` 双向配对；女性清单缺 `uterus` 时启动报 `transferOut target "uterus.bleedingMl" is not declared`。变体复用 `water.parameters.json`，不新增参数文件；`water.ts` 公开导出（`id` / `fields` / `initialState` / `heartbeat`）保持不变，既有体液测试不改语义。

女性清单水账 = 原水账 + 累计 `uterus.bleedingMl`。默认 50 mL/周期、4.0 天 ≈ 每天 12.5 mL，经 `bodyFluid.waterDeficit` → 口渴的量级约 +5 mm/周期，不是大出血模型。

## 女性清单

`body-modules.female.json`：根清单 19 脚本 + `ovaries/menstrual-cycle.ts` + `uterus/uterus.ts`，其中 `body-water/water.ts` 换成 `water.female.ts`，共 21 部位、23 份参数文件。根清单 `body-modules.json` 不变。`package.json` 的 `files` 增加 `body-modules.female.json`。根清单变化时需同步该文件（文档注明）。

## 旧档、重启与验收

旧女性档缺 `ovaries` / `uterus` 时由 `initialState` 补初值，不反推历史周期；`cycleDay` 随存档保留，重启接续不重置。测试：卵巢单元（推进/回卷/相位/曲线锚点/参数）；子宫单元（内膜趋近、经期请求量、痉挛曲线、卵巢缺失/异常、归零、JSON-safe）；`interoception` 第五路有无子宫；体液女性变体第四出口分配与钳位；女性清单真实 Gateway（21 部位、经期实际转移、`discomfort` 第五路、含出血的水账、重启）；参数清单 23 份。最终 `npm test` 与 `git diff --check`。

未验证：激素绝对浓度、独立周期/经量/痛经数据、真实 DSH 会话、临床验证、21 部位性能。Bull 的周期长度是队列分布均值，不是本身体的个体预测。

## 证据

- `SRC-BULL-2019`：Bull JR et al., npj Digit Med 2019;2:83，PMID 31482137，DOI 10.1038/s41746-019-0152-7，PMC6710244，开放获取。笔记 `organs/human-organs/ovaries/references/notes/bull-2019.md` + `source-index.csv` 登记；数值以笔记核对为准，不猜。
- 经量 50 mL/周期、痛经 85 mm、内膜半时与激素曲线形状均为 `design`、`source: null`，不冒充测量。
