# 结肠（colon）：残渣水回收、粪便储存与便意代理

**功能标签：** 消化（结肠残渣水回收、粪便形成、排便动作、便意读数）。

`colon` 目前只有一个部位写者 `colon.ts`。它接收小肠按通量比例分流转入的未吸收残渣水，按一阶指数回收速率把一部分水转回 `bodyFluid.waterVolumeMl`，同时按固定速率形成粪便、响应 `defecate` 动作排出轮初粪便，并写出 0–100 mm 的便意代理。`interoception.bowelUrgencyMm` 优先软读本部位的 `colon.bowelUrgencyMm`（缺失或非有限时再按 `colon.stoolG` 回落）。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/colon/`，并已加入根清单 `body-modules.json`、女性清单与男性清单。当前根清单 43 部位、39 份唯一参数文件，女性清单 46 / 42，男性清单 45 / 41。旧存档缺 `colon` 时由 `initialState` 补 0。

**清单依赖。** `colon.residueWaterMl` 声明 `transferIn: ["smallIntestine.waterVolumeMl"]`，与小肠的 `transferOut` 配对；`colon.reclaimedWaterMl` 声明 `transferOut: ["bodyFluid.waterVolumeMl"]`，与体液的 `transferIn` 配对。因此完整清单必须同时加载 `smallIntestine` 与 `bodyFluid`：缺 `colon` 时启动报 `Body module "smallIntestine" field "waterVolumeMl": transferOut target "colon.residueWaterMl" is not declared`；缺 `bodyFluid` 时报 `colon.reclaimedWaterMl` 的 `transferOut` 目标未声明。当前根与男性清单的硬 transfer 闭包为 15 个部位，女性清单为 17 个部位；`esophagus` 不在闭包内。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "colon.reclamationRatePerMin": 0.012 } }
```

### colon.parameters.json

参数文件：[`colon.parameters.json`](colon.parameters.json)。入口及清单：[`colon.ts`](colon.ts)（[默认](../../../body-modules.json) / [女性](../../../body-modules.female.json) / [男性](../../../body-modules.male.json) / [可选清单 human-lipid](../../presets/human-lipid/body-modules.json)）。读取脚本：[`colon.ts`](colon.ts)。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `colon.reclamationRatePerMin` | `0.01` | `1/min` | `design` | 无 | — |
| `colon.stoolFormationGPerMin` | `0.01` | `g/min` | `design` | 无 | — |
| `colon.referenceStoolG` | `200` | `g` | `design` | 无 | — |

<!-- organ-parameters:end -->

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `colon.ts` | `colon` | `residueWaterMl`、`stoolG`、`defecatedG`、`reclaimedWaterMl`、`bowelUrgencyMm` | 自己的轮初状态、轮初 `bodyFluid.waterVolumeMl` 与本轮 `io.actions` | `colon.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `residueWaterMl` | `mL` | 结肠残渣水池（状态）；`transferIn` 来自 `smallIntestine.waterVolumeMl`，唯一上游是小肠 |
| `stoolG` | `g` | 粪便储存（状态）；不是每日粪便量或粪便干重 |
| `defecatedG` | `g` | 本轮 `defecate` 排出的轮初粪便（每轮通量，不是累计量） |
| `reclaimedWaterMl` | `mL` | 本轮回收水的暂存字段；`transferOut` 到 `bodyFluid.waterVolumeMl`，提交后回到 0 |
| `bowelUrgencyMm` | `mm` | 0–100 mm 便意代理读数；不是直肠压力或临床便意评分 |

时间原点：`residueWaterMl`、`stoolG` 是轮末状态，初值 0；`defecatedG` 与 `reclaimedWaterMl` 只表示本轮；`bowelUrgencyMm` 由本轮 `stoolG` 现算。

## 3. 方程与参数

设 `dtMin = io.dt / 60`：

```text
startResidue = max(0, prev.residueWaterMl)
reclaimed = clamp(startResidue × (1 − exp(−reclamationRatePerMin × dtMin)), 0, startResidue)
startStoolG = max(0, prev.stoolG)
本轮有 defecate：defecatedG = startStoolG；stoolG = 0
否则：defecatedG = 0；stoolG = startStoolG + stoolFormationGPerMin × dtMin
bowelUrgencyMm = clamp(100 × stoolG / referenceStoolG, 0, 100)
write.residueWaterMl = startResidue − reclaimed
transfer colon.reclaimedWaterMl → bodyFluid.waterVolumeMl: reclaimed
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | ---: | --- | --- | --- |
| `colon.reclamationRatePerMin` | 0.01 | `1/min` | `design` | —（无直接证据；半时约 69 min） |
| `colon.stoolFormationGPerMin` | 0.01 | `g/min` | `design` | —（无直接证据） |
| `colon.referenceStoolG` | 200 | `g` | `design` | —（无直接证据） |

回收量按轮初残渣计算且不超过轮初残渣；同轮小肠转入在 Gateway 的 transfer 阶段才加到 `residueWaterMl`，不参与本轮回收（write 先于 transfer）。方向是回流而非体液支出：残渣水减少、体液水同量增加，不产生第二份水。`defecatedG` 不是累计量；排便轮不再累加本轮粪便形成，`stoolG` 与便意都归零。空结肠上的 `defecate` 仍合法，只是排出 0。

## 4. 读写边界

- 本脚本是 `colon` 的唯一写者，只读自己的轮初状态、轮初 `bodyFluid.waterVolumeMl` 与本轮原始动作。
- 先 `write` 本轮回收后的残渣与粪便，再请求 `transfer`；不直接写 `bodyFluid`。
- 不读小肠状态、胃容量或摄入体积来自行生成残渣；残渣只经声明的 transfer 配对从 `smallIntestine.waterVolumeMl` 进入。
- `bodyFluid` 未加载（直接调用）时不做目标校验；已加载但字段缺失、非有限或为负时抛错，且在 `write` 与 transfer 之前抛错，本轮不留部分状态。完整清单缺 `bodyFluid` 或配对字段会在启动校验时报错。
- `defecate` 与 `urinate` 同类，是少数允许会话主动触发的输出动作；同轮多个 `defecate` 只结算一次。没有自动排便反射。

## 5. 消费与水账

- `interoception.bowelUrgencyMm` 优先软读轮初 `colon.bowelUrgencyMm`（有限时钳到 0–100 mm）；若该字段缺失或非有限，再回落到 `clamp(100 × colon.stoolG / 200, 0, 100)`；`colon` 未加载时按 0。它不进入 `discomfort`，现已接入 `brainNotify` 与纯定性 `body_state`（无数字）。
- 水账新增“结肠残渣水”项：`胃水 + 队列水 + 小肠水 + 结肠残渣水 + (体液水 − 初始体液水) + 膀胱尿 + 累计 voidedMl + 累计汗液 + 累计呼吸失水 = 累计饮水`。结肠回收是残渣水池到体液的内部回流，只在残渣水项里体现，不另加外部流入；`reclaimedWaterMl` 提交后为 0，不是可累计读数。
- 它不改 `discomfort` 的七路组成；便意现已进入 `brainNotify`，`body_state` 仅返回纯定性感受，原始数值保留在 `GET /state` / `gateway.getState()`。

## 6. 证据入口

- 设计：[`docs/superpowers/specs/2026-11-24-bowel-design.md`](../../../docs/superpowers/specs/2026-11-24-bowel-design.md)
- 定向测试：[`test/organs.colon.test.mjs`](../../../test/organs.colon.test.mjs)；真实 Gateway 在 [`test/organs.bowel-gateway.test.mjs`](../../../test/organs.bowel-gateway.test.mjs)
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片未新增来源行）

**证据边界：** `0.01 /min`（解析指数回收，半时约 69 min）、0.01 g/min 与 200 g 都是 `design`、`source: null` 的工程假设，不是结肠转运时间、结肠吸水率、粪便形成率或便意阈值的人体测量，也不是对任何研究的拟合。实际结肠转运约以小时计，本切片用 60 s 轮上的指数回收代理，不能称 `validated`。

## 7. 当前限制

- **未建模：** 肠道菌群、发酵、气体/腹胀、消化酶、膳食纤维、Bristol 分型、便秘/腹泻、直肠储袋、肛门括约肌、自动排便反射、粪便水/能量账本、结肠分段转运与昼夜节律。
- **未验证：** 结肠转运时间、吸水率、粪便形成率、便意阈值都没有实测或独立人体数据；没有真实 DSH 会话、临床验证或全清单性能实测。
- 粪便质量只按固定速率增长，不由摄入成分反推；便意只由粪便量线性映射，不是直肠压力或肛门直肠测压结果。
