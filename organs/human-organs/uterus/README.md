# 子宫（uterus）：内膜、月经失水与痛经代理

**功能标签：** 生殖（子宫内膜相对量、月经失水请求、痛经代理）。

`uterus` 只有一个脚本 `uterus.ts`，把轮初卵巢激素相对量映射为内膜相对量，并按周期日产生月经失水请求与痛经代理。它没有动作、不调用 `transfer`、不发送通知，也不写其他部位。两个消费者：

- [`interoception`](../brain/README.md) 的第五路 `discomfort` 读取 `crampMm`（软读；根清单没有子宫时按 0）；
- [`bodyFluid`](../../human-compartments/body-water/README.md) 的女性变体读取 `bleedingRequestMl`，把 `bodyFluid.waterVolumeMl` 转入 `bleedingMl`。

**状态口径。** 当前实现：脚本与参数在 `organs/human-organs/uterus/`，只随独立女性清单 `body-modules.female.json` 加载；当前根清单为 43 部位、39 份唯一参数文件，女性清单为 46 部位、42 份，男性清单为 45 部位、41 份。`mensesDays = 4.0` 取 `SRC-BULL-2019`（`prior`），周期经量参考从 50 mL 调至 `30 mL`（对齐 `SRC-HALLBERG-1966` 总体中位数 30.0 mL，保留单口径水账 `design`），分泌期内膜平台参考 `SRC-BAKOS-1994`（`lutealEndometriumPlateau = 0.9`、`design`），高潮/催产素宫缩方向参考 `SRC-BLAICHER-1999`（`design`）。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

示例（只合并这一小段，数值仅用于演示）：

```json
{ "parameters": { "uterus.mensesDays": 5 } }
```

### uterus.parameters.json

参数文件：[`uterus.parameters.json`](uterus.parameters.json)。入口及清单：[`uterus.ts`](uterus.ts)（[女性](../../../body-modules.female.json)）。读取脚本：[`uterus.ts`](uterus.ts)。

月经请求/痛经依赖卵巢周期输入；月经不随 `nsfw` 关闭，性反应收缩和充血路径则关闭。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `uterus.mensesDays` | `4` | `d` | `prior` | 无 | — |
| `uterus.flowMlPerCycle` | `30` | `mL` | `design` | 无 | — |
| `uterus.crampPeakMm` | `85` | `mm` | `design` | 无 | — |
| `uterus.crampDurationDays` | `2.5` | `d` | `design` | 无 | — |
| `uterus.endometriumHalfTimeDays` | `2` | `d` | `design` | 无 | — |
| `uterus.lutealEndometriumPlateau` | `0.9` | `1` | `design` | 无 | — |
| `uterus.orgasmContractionPeakMm` | `68` | `mm` | `design` | 无 | 仅性反应门控开启时参与。 |
| `uterus.contractionHalfTimeMin` | `4` | `min` | `design` | 无 | 仅性反应门控开启时参与。 |
| `uterus.congestionHalfTimeMin` | `12` | `min` | `design` | 无 | 仅性反应门控开启时参与，且仅用于回落。 |

### response.parameters.json（共享）

参数文件：[`response.parameters.json`](../sexual-response/response.parameters.json)。入口及清单：[`uterus.ts`](uterus.ts)（[女性](../../../body-modules.female.json)）。读取脚本：[`response.ts`](../sexual-response/response.ts)。

性反应及释放判据随 `nsfw` 门控；只写覆盖不会开启该功能。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `sexualResponse.orgasmAllowedMm` | `70` | `mm` | `design` | 无 | — |
| `sexualResponse.orgasmForcedMm` | `95` | `mm` | `design` | 无 | — |
| `sexualResponse.refractoryMin` | `20` | `min` | `design` | 无 | 其余清单分支的不应期基线，另有 PRL 影响。 |
| `sexualResponse.femalePostOrgasmPauseMin` | `2` | `min` | `design` | 无 | 有卵巢且无睾丸时的停顿分支。 |

<!-- organ-parameters:end -->

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `uterus.ts` | `uterus` | `endometriumRelative`、`crampMm`、`bleedingRequestMl`、`bleedingMl`、`contractionMm`、`pelvicCongestionMm` | 自己的轮初状态；轮初 `ovaries`（`cycleDay` / `phase` / `estradiolPmolL` / `progesteroneNmolL`）、`sexualResponse`、`testes`、`pituitary`、`io.actions`、`io.dt`、`io.simulatedSeconds` | `uterus.parameters.json` |

- `actionTypes = []`；不主动触发动作或通知；通过共享 `evaluateSexualRelease`（与 `sexualResponse` 同口径）与 `pituitary.oxytocinPgMl`、`sexualResponse.arousalMm` 同步响应性反应（受 `nsfw` 门控）。
- `bleedingMl` 只由 `transferIn` 增加；本脚本每轮先归 0。

## 2. 字段与单位

六个字段均 `absolute`（`initialState = { endometriumRelative: 0.1, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0, contractionMm: 0, pelvicCongestionMm: 0 }`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `endometriumRelative` | `1` | 子宫内膜相对量 0–1 代理（分泌期维持 0.9 平台，不再随 E2 下降而被提前腰斩） |
| `crampMm` | `mm` | 痛经代理 0–100 mm；经期前段线性衰减 |
| `bleedingRequestMl` | `mL` | **下一轮**经液失水请求（按 30 mL/周期缩放） |
| `bleedingMl` | `mL` | 本轮由 `bodyFluid.waterVolumeMl` 转入的实际经期失水（`transferIn`） |
| `contractionMm` | `mm` | 性高潮跃升（峰值 68 mm）及高催产素（`oxytocinPgMl > 6 pg/mL`）引发的温和子宫收缩代理，4 min 半时消退（受 `nsfw` 门控） |
| `pelvicCongestionMm` | `mm` | 随性唤起 `0.85 × arousalMm` 上升（4 min 半时）、停止后 12 min 半时消退的盆腔充盈代理（受 `nsfw` 门控） |

## 3. 方程与参数

- 内膜目标：经期（`cycleDay < 4.0`）为 `0.15`；黄体期（`phase === 'luteal' || progesteroneNmolL >= 5`）维持 `lutealEndometriumPlateau = 0.9`；卵泡/排卵期按 `clamp(0.15 + 0.85 × ((estradiolPmolL − 125) / (940 − 125)), 0.15, 1)` 上升，半时 2 天一阶趋近。
- 经期失水：`flowMlPerCycle = 30 mL`，`bleedingRequestMl = cycleDay < 4.0 ? 30 × prevEndo / (4.0 × 1440) × dtMin : 0`。
- 参数（`uterus.parameters.json` 共 9 项）：`mensesDays = 4`（`prior`、`SRC-BULL-2019`），`flowMlPerCycle = 30`、`crampPeakMm = 85`、`crampDurationDays = 2.5`、`endometriumHalfTimeDays = 2`、`lutealEndometriumPlateau = 0.9`、`orgasmContractionPeakMm = 68`、`contractionHalfTimeMin = 4`、`congestionHalfTimeMin = 12`（均 `design`）。

## 4. 消费者、清单与证据

- 经期失水仍经 `water.female.ts`（硬闭包 17 部位）结算入总水账；`crampMm`、`bleedingMl`、`contractionMm` 与 `pelvicCongestionMm` 均已接入定性无数字体感 `body_state`（后两项受 `nsfw` 门控，`crampMm` 仍经 `interoception` 第五路进入 `discomfort` 与 `brainNotify`）。
- 文献笔记：[`references/notes/hallberg-1966.md`](references/notes/hallberg-1966.md)、[`references/notes/bakos-1994.md`](references/notes/bakos-1994.md)、[`references/notes/blaicher-1999.md`](references/notes/blaicher-1999.md) 与 [`bull-2019.md`](../ovaries/references/notes/bull-2019.md)。
- 未建模经血非纯水成分分室（仅 36% 为全血的代理说明）、妊娠/分娩、子宫内膜毫米厚度绝对值或独立宫内压 IUP 拟合，未做临床验证。
