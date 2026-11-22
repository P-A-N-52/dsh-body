# 可选尿崩样多尿代理设计（DI-like polyuria proxy）

> **历史提示：** 本设计形成时 `brainNotify` 只读饥饿/饱满；尿意提醒的当前实现见 [`2026-11-22-urinary-notification-design.md`](./2026-11-22-urinary-notification-design.md)。本文件的设计正文与验收记录保持当时口径。

**状态：** 已实现（2026-11-22）：代码、独立参数、定向测试与最小文档均已落地，并完成 M19 真实 DSH 会话验收（2026-11-22，33/33 verdicts，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）。**默认身体不加载 DI 变体**：本设计形成时根清单为正常 12 部位，后续已扩展到 15 个正常部位，正常 ADH/肾参数文件未改。DI 样代理只通过独立清单与独立存档显式选择，不是临床诊断、默认病理状态或治疗依据；M19 只覆盖 2–5 轮短会话的机制对照，不是临床验证。测试证据见 §6。

## 1. 目标与取舍

只建一个**可选的 DI 样多尿代理**，用来在独立身体上演示“ADH 缺失”与“肾脏对 ADH 不响应”两种机制导致的多尿；不建临床诊断、分型判定、治疗或提醒。

- **默认身体绝不变成病人。** 正常根清单、正常参数、Gateway、`body_act` / `body_state`、通知、`bladder` 与 `interoception` 都不改。DI 身体必须复制根清单并把两个脚本入口换成变体，同时使用自己的 `statePath`。
- **同部位 id 的变体入口。** 变体分别导出 `id: "hypothalamusAdh"` 与 `id: "kidney"`，`fields` 与正常入口相同，`actionTypes: []`；因此同一清单只能出现一个 ADH 与一个肾脚本，替换是显式的文件选择，不是条件分支。
- **不做预设目录或 `condition` 字段。** 不新增 `presets/`、`condition`、热切换或病况状态；选择方式就是“清单里写哪个文件 + 用哪份存档”。
- **参数量级只作代理。** 4 mL/min（5.76 L/day）是工程设定，只借综述的“成人多尿 >3 L/day”量级；不是任何论文的均值、拟合或诊断阈值。所有 DI 参数都是 `design`、`source: null`。
- **不改共享水链。** 胃、小肠、体液、下丘脑口渴、膀胱、体感与通知仍按 `2026-11-22-water-balance-design.md` 运行；DI 只改 ADH 与肾请求两个环节。

## 2. 机制、文件与清单选择

| 情景 | ADH 入口（同 id `hypothalamusAdh`） | 肾入口（同 id `kidney`） | 期望 |
| --- | --- | --- | --- |
| 正常（默认，根清单） | `brain/hypothalamus-adh.ts` | `kidney/urine-production.ts` | 现有正常水链，零变化 |
| 中枢性 DI 样 | `brain/hypothalamus-adh-di-central.ts` | `kidney/urine-production-di-central.ts` | ADH 相对水平恒 0；肾请求约 4 mL/min |
| 肾性 DI 样 | 正常 `brain/hypothalamus-adh.ts` | `kidney/urine-production-di-nephrogenic.ts` | ADH 按正常轨迹变化；肾请求固定约 4 mL/min |

中枢性情景必须**同时**换两个入口：只换 ADH 变体时正常肾在 A=0 只到 2 倍基线（2 mL/min ≈ 2.88 L/day），够不到 DI 样量级；配套中枢肾变体把低 ADH 端拉到 4 倍基线。肾性情景只换肾入口，ADH 与口渴仍走正常模型。

独立清单的最小做法是复制 `body-modules.json` 的 `scripts`，把对应路径替换为变体文件，并让清单与存档都在独立目录。下面只是结构示意，实际路径要相对清单所在目录改写：

```json
{
  "startupScripts": ["./startup/reset-parts.js"],
  "scripts": [
    "./organs/human-organs/stomach/hydration.ts",
    "……其余正常部位……",
    "./organs/human-organs/brain/hypothalamus-adh-di-central.ts",
    "./organs/human-organs/brain/hypothalamus-thirst.ts",
    "./organs/human-organs/kidney/urine-production-di-central.ts",
    "./organs/human-organs/bladder/storage.ts",
    "./organs/human-organs/brain/interoception.ts",
    "./organs/human-organs/brain/notify.ts"
  ],
  "catchUpMinutes": 720,
  "scriptTimeoutMs": 10000
}
```

清单里的路径必须相对清单文件；测试在临时目录中用 `relative(dir, repoPath)` 生成，不往仓库提交 DI 清单。DI 身体应使用**新建或专门的存档**：`initialState` 只补缺失部位，不重置已有部位；本设计不支持在同一份正常存档上来回切换清单，也不提供热切换。

## 3. 方程与状态形状

正常入口的数值与状态形状逐点不变；正常 ADH 方程抽到 `hypothalamus-adh-core.ts`，肾请求公式抽到三个肾入口共用的 `urine-production-core.ts`。中枢 ADH 变体是硬固定 0，不复用滞后；肾变体只换参数或换固定请求。

### 3.1 ADH（正常入口使用 `brain/hypothalamus-adh-core.ts`）

```text
target = clamp(reference + deficitGain × waterDeficit, relativeMinimum, relativeMaximum)
next   = current + (1 − exp(−dtMin / timeConstantMin)) × (target − current)
reference = 1（无量纲相对水平的参考点）
```

- 正常：`timeConstantMin = 10`、`deficitGain = 1`、`relativeMinimum = 0`、`relativeMaximum = 3`，初值 1。
- 中枢变体：不读取 `bodyFluid`、不做滞后，直接每轮写 `fixedRelativeConcentration = 0`。分泌缺失没有“从某个水平衰减”的动力学，所以不复用一阶形式；参数只有一个固定值。
- `relativeConcentration` 始终是无量纲代理，不是血浆 AVP 浓度、分泌速率或渗透压。

### 3.2 肾请求（三个肾入口共用 `kidney/urine-production-core.ts`）

```text
A = max(0, relativeConcentration)（缺失或非有限输入按 1）
relativeRate = clamp(1 − adhGain × (A − 1), minRelativeRate, maxRelativeRate)
urineProductionRequestMl = baselineRateMlPerMin × dtMin × relativeRate
```

- 正常：`baselineRateMlPerMin = 1`、`adhGain = 1`、`minRelativeRate = 0.25`、`maxRelativeRate = 2`。
- 中枢肾变体：`baseline = 1`、`adhGain = 3`、`min = 0.25`、`max = 4`；A=0 时 `1 − 3 × (0 − 1) = 4` 倍基线，即 4 mL/min；A=1 时仍是 1 mL/min。提高增益只拉宽低 ADH 端，不改变基线锚点。
- 肾性变体：不使用上面的 ADH 公式，也不读取 `hypothalamusAdh`；每轮写 `4 mL/min × dtMin`，即 60 s 轮 4 mL、5.76 L/day。
- 请求仍是“下一轮”的待转出量，不是瞬时尿流率、GFR、自由水清除率或已排尿量；`kidney` 仍不调用 `transfer`。

### 3.3 状态形状

| 部位 | 正常 | 中枢 ADH 变体 | 中枢肾变体 | 肾性肾变体 |
| --- | --- | --- | --- | --- |
| `hypothalamusAdh` | `{ relativeConcentration }`，初值 1 | 同形状，初值 0 | — | — |
| `kidney` | `{ urineProductionRequestMl }`，初值 0 | — | 同形状，初值 0 | 同形状，初值 0 |

`fields`、`actionTypes` 与正常入口完全一致；没有新增部位、字段或动作类型。

## 4. 参数

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `hypothalamusAdh.central.fixedRelativeConcentration` | 0 | `1` | `design` | `null` |
| `kidney.diCentral.baselineRateMlPerMin` | 1 | `mL/min` | `design` | `null` |
| `kidney.diCentral.adhGain` | 3 | `1` | `design` | `null` |
| `kidney.diCentral.minRelativeRate` | 0.25 | `1` | `design` | `null` |
| `kidney.diCentral.maxRelativeRate` | 4 | `1` | `design` | `null` |
| `kidney.diNephrogenic.urineRateMlPerMin` | 4 | `mL/min` | `design` | `null` |

三份参数文件与各自脚本同目录：`brain/hypothalamus-adh-di-central.parameters.json`、`kidney/urine-production-di-central.parameters.json`、`kidney/urine-production-di-nephrogenic.parameters.json`。它们都是独立文件，正常参数文件一个字节未改；所有值都是工程假设，`source` 为 `null`，不是 `prior` / `fitted_dev` / `validated`。

## 5. 证据与边界

三篇都是综述、无原始受试者，全部 `results_seen`，只能标 `exploratory` / `development`。登记见 `organs/human-organs/references/source-index.csv`，逐篇笔记在 `organs/human-organs/kidney/references/notes/`。

| 来源 | 本设计只借什么 | 不能推出什么 |
| --- | --- | --- |
| Flynn 2025，`SRC-FLYNN-2025`，DOI `10.3389/fendo.2024.1479764`，PMC11750692；叙述性综述 | 中枢 = ADH 分泌不足、肾性 = 肾脏对 ADH 不响应；成人多尿 >3 L/day（儿童 2 L/m² 或 50 mL/kg/24 h）；低渗尿 <300 mOsm/kg | 0 相对 ADH、4 mL/min、5.76 L/day 都不是本文值；3 L/day 不是模型阈值或诊断标准；无可移植的 ADH 浓度、增益或时程 |
| Hui 2024，`SRC-HUI-2024`，PMID 29262153，NBK470458；StatPearls 教学综述 | 同上两种机制；成人 >3 L/day、儿童 2 L/m²、>50 mL/kg/24 h；AVP-D/AVP-R 命名 | 20 L/day 上限、copeptin 阈值与去氨加压素反应率不入模型；不能把命名或诊断流程写成模型能力 |
| Mutter 2021，`SRC-MUTTER-2021`，DOI `10.7759/cureus.13523`，PMC7996474；叙述性综述 | 成人 DI 常用 24 h 尿量 >3–3.5 L、尿渗 <300 mOsm/kg；最大抗利尿约 0.5 mL/min、700–800 mL/day，用于量级对照 | 4 mL/min 不是本文值；0.5 mL/min 不能反推本模型基线或增益；无原始尿流曲线可拟合 |

**可比性判断：** 三篇综述的人群、刺激、测量与时间原点都不适用于本模型的 60 s 轮；它们只支持机制方向与“>3 L/day”的量级。`design` 不因引用综述升级；没有拟合记录不得写 `fitted_dev`，没有独立验证不得写 `validated`。Ota 1994 与 Andersen 1990 仍是正常水链的证据边界（见 `2026-11-22-water-balance-design.md` §7），本设计不把它们改写成 DI 证据。

## 6. 验收与测试证据（已实现）

全部测试用临时目录、临时清单与独立存档，`autoTick: false`、固定 `now: () => 0`；仓库不提交 DI 清单或存档。测试文件是 `test/organs.di.test.mjs`（9 个用例），变体契约另由 `test/organs.hypothalamus.test.mjs`、`test/organs.kidney.test.mjs`、`test/organs.modules.test.mjs` 与 `test/parameters.test.mjs` 覆盖。这些是离线/临时清单 Gateway 证据；真实 DSH 会话验收见本节末的 M19 记录。

1. **正常不变：** 根清单仍 12 个脚本，不含任何 `-di-` 入口；正常 ADH/肾参数文件数值逐项保持；从空存档运行正常根清单 10 轮，ADH、肾请求、体液水、缺水代理、口渴、膀胱体积与重构前的 10 轮 golden 逐点一致（`1e-12`）。
2. **中枢性：** 临时清单换入中枢 ADH + 中枢肾后，ADH 恒 0、每轮请求 4 mL、膀胱逐轮 +4 mL；121 轮含 240 mL 饮水的水账本误差 ≤`1e-6 mL`，膀胱 480 mL（低于 600 mL 非自主阈值，因此没有自动排尿）。
3. **肾性：** 只换肾入口时，ADH 不被固定为 0，仍随缺水代理上升，但肾请求恒 4 mL；再用 `relativeConcentration = 0` 与 `3` 两种初始存档各跑一轮，请求都是 4 mL，证明肾变体完全不读 `hypothalamusAdh`。
4. **重启：** 中枢 DI 清单运行 10 轮后停止，再用同一清单与同一存档启动；`simulatedSeconds`、`parts` 完全保持，下一轮继续 4 mL/min。
5. **工具形状：** DI 清单下 `body_act` / `body_state` 的名称、参数枚举、输出 schema 与根清单一致；`body_act` 仍只接受 drink/eat/urinate，DI 不新增动作。
6. **模块/参数：** 三个变体导出同 id、同 fields、`actionTypes: []`；三份新参数文件通过 `test/parameters.test.mjs` 的 schema、唯一 ID 与 loader 校验。

**M19 真实 DSH 会话补充（2026-11-22）。** 三组独立清单与独立 `statePath` 在真实 DSH 会话中运行：正常、中枢性（中枢 ADH 变体 + 中枢肾变体）、肾性（只换肾变体）；代码 base `ab74389`，当时 main `27e03f5` 与其仅文档差异；`npm test` 264/264。sim 300 的同起点对照：

| 量 | 正常 | 中枢性 | 肾性 |
| --- | ---: | ---: | ---: |
| `relativeConcentration` | 1.0006 | 0 | 1.0022（仍随缺水上升） |
| `urineProductionRequestMl` | 0.9998 | 4 | 4 |
| `bodyFluid.waterVolumeMl` | 29996 | 29987 | 29984 |
| `bladder.volumeMl` | 4 | 13 | 16 |
| `urinaryUrgency` | 0.732 | 2.195 | 2.927 |
| `voidedMl` / `discomfort` / 通知 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

另用 ADH 初值 0 的中枢存档从 sim 0 起跑，sim 300 仍为 ADH 0、请求 4 mL、膀胱 16 mL；高 ADH（3）肾性预置在 sim 120 仍请求 4 mL。中枢清单的 `GET /capabilities` 与默认清单一致，默认清单仍 12 个脚本、0 个 DI 入口。`logs/analysis.json` 的 33 条 verdict 全为 true。证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`（`EVIDENCE.md`、`logs/analysis.json`；仓库外，未入库）。覆盖只有各 2–5 轮短会话，不覆盖通知投递、120 轮长时程、重启补算或大负荷利尿；所有参数仍是 `design`，不是诊断或治疗依据。

2026-11-22 定向运行 `node --test test/organs.bladder.test.mjs test/organs.interoception.test.mjs test/organs.di.test.mjs test/organs.water-gateway.test.mjs`：55 tests / 55 pass / 0 fail（该命令同时覆盖本文件、非自主排尿与不适代理）。M19 已在真实 DSH 会话中补验三组 DI 清单（见上），但仍未把 DI 变体加入根清单；默认身体的正常水链数值保持逐点不变。

## 7. 未建模与明确不做

- 不做临床诊断、分型判定、限水试验、copeptin、尿渗透压、血钠/血浆渗透压、电解质、血容量/血压、RAAS 或 GFR。
- 不建部分性 DI、垂体柄损伤三相反应、渴感缺失（adipsic DI）、原发性多饮、妊娠性 DI、溶质性利尿、慢性肾病或锂盐等病因。
- 不建 AQP2/V2 受体、集合管水通道、自由水清除率或尿浓缩机制；4 mL/min 只是体积请求。
- 不做治疗、去氨加压素、补水建议、自动饮水、提醒或任何临床告警；`brainNotify` 仍只读饥饿/饱满。
- 不做预设目录、`condition` 字段、热切换、按会话绑定病况或多身体路由；DI 身体与默认身体是两份独立清单/存档。
- 真实 DSH 验收只覆盖 M19 的 2–5 轮短会话与机制对照；120 轮长时程、通知投递、重启补算、大负荷利尿与口咽解渴未验。本设计不因此变成临床诊断或治疗依据。

## 8. 范围决策

- **为什么不做成参数开关？** 正常参数必须零变化，且 ADH 变体要固定 0、肾性变体要完全不读 ADH；用同 id 的独立入口最直接，也避免在正常脚本里塞病况分支或未使用字段。
- **为什么中枢需要配套肾变体？** 正常肾在 A=0 只到 2 倍基线（2.88 L/day），低于综述的 >3 L/day 量级；配套变体只放宽低 ADH 端到 4 倍基线，不碰正常参数。
- **为什么不拟合 4 mL/min？** 三篇综述都没有可用的个体尿流曲线、ADH 剂量轴或时间原点；4 mL/min 只是量级代理，拟合会制造不存在的证据等级。
- **为什么不在 `brain/README.md` 写 DI 变体？** 正常入口文档只描述默认身体，避免把可选病况混进 ADH 与体感的正常语义；ADH 变体的说明集中在本设计与 `organs/human-organs/kidney/README.md` §3a。
