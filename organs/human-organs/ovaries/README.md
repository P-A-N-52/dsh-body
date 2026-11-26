# 卵巢（ovaries）：Stricker 周期浓度、LH/FSH 与慢性高 PRL/哺乳抑制

**功能标签：** 生殖（女性周期钟、性激素绝对浓度代理）。

`ovaries` 只有一个脚本 `menstrual-cycle.ts`，按 29.3 d 周期（`SRC-BULL-2019`）与 `SRC-STRICKER-2006` 每日血清中位数表插值输出 `estradiolPmolL`（pmol/L）、`progesteroneNmolL`（nmol/L）、`lhIuL`（IU/L）、`fshIuL`（IU/L），以及受慢性持续高 PRL 与规整泌乳刺激调节的慢时间常数 `cycleSuppression`（0–0.95，半衰期 5 天）。它没有动作、没有 `transfer`、不发送通知。主要消费者包括 [`uterus`](../uterus/README.md)、[`interoception`](../brain/README.md)（女性排卵期 E2 促进 / 黄体期 P4 抑制 `libidoMm`）与 [`sexualResponse`](../sexual-response/README.md)（女性性反应分型与排卵/卵泡唤醒增幅）。

**状态口径。** 当前实现：脚本与参数在 `organs/human-organs/ovaries/`，只随独立女性清单 `body-modules.female.json` 加载（根清单 43 部位 / 39 份唯一参数文件；女性清单 46 / 42；男性清单 45 / 41）。`cycleLengthDays = 29.3`、`follicularLengthDays = 16.9`、`lutealLengthDays = 12.4` 标 `prior`（`SRC-BULL-2019`）；Stricker 日中位数轨迹来自 `stricker-2006.md`，`hyperprolactinemiaThresholdNgMl = 35 ng/mL`、`suppressionOnsetDays = 7 d` 与 `suppressionHalfTimeDays = 5 d` 标 `design`（参考 `SRC-HOSKOVA-2022` / `SRC-PAGEWILSON-2007`）。

## 1. 脚本、字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `cycleDay` | `d` | 周期内第几天，`0 ≤ cycleDay < 29.3`；随时间步按 `1 − 0.85 × cycleSuppression(t)` 的分段解析积分延缓推进 |
| `cycleLengthDays` | `d` | 29.3 d（Bull 2019 `prior`） |
| `phase` | `-` | `follicular` / `ovulatory` / `luteal` |
| `estradiolPmolL` | `pmol/L` | 血清雌二醇参考轨迹插值，受 `1 − cycleSuppression` 向卵泡早期基底 140 pmol/L 压低 |
| `progesteroneNmolL` | `nmol/L` | 血清孕酮参考轨迹插值，受 `1 − cycleSuppression` 向基底 0.8 nmol/L 压低 |
| `lhIuL` | `IU/L` | 血清黄体生成素插值，受 `cycleSuppression` 向 3.3 IU/L 压低 |
| `fshIuL` | `IU/L` | 血清卵泡刺激素插值，受 `cycleSuppression` 向 5.5 IU/L 压低 |
| `cycleSuppression` | `1` | 慢性高催乳素血症或已建立 `mammaryGlands.lactating` 累积的 HPO 抑制度 `[0, 0.95]`（5 天半衰期） |
| `highProlactinDays` | `d` | 当前连续 `prolactinNgMl >= 35 ng/mL` 的累计天数；低于阈值清零，满 7 天前不启动高 PRL 抑制，已建立泌乳的抑制路径不受此等待窗限制 |

`initialState` 默认取 `startCycleDay = 5`；若身体顶层配置 `profile.lactating = true` 且 `nsfw` 允许，初始 `cycleSuppression = 0.75`。

## 2. 消费者、参数与证据

- `uterus` 在下一轮轮初读取 `cycleDay`、`phase`、`estradiolPmolL` 与 `progesteroneNmolL`（不再使用无量纲 `estradiolRelative` / `progesteroneRelative`）。
- `interoception` 仅女性身体读取 `estradiolPmolL` 与 `progesteroneNmolL` 计算周期驱动的 `libidoMm`（排卵期上调、黄体高孕酮回落，方向参考 `SRC-RONEY-2013`）。
- `sexualResponse` 与 `uterus` 通过无 `testes` + 有 `ovaries` 识别女性档案（启用女性 2 min 防连跳短停顿，取消固定 20 min 绝对不应期；排卵期/高频 E2 窗口温和增幅性唤醒）。
- 文献笔记：[`bull-2019.md`](references/notes/bull-2019.md)、[`stricker-2006.md`](references/notes/stricker-2006.md)、[`hoskova-2022.md`](references/notes/hoskova-2022.md)、[`roney-2013.md`](references/notes/roney-2013.md) 与 [`page-wilson-2007.md`](../mammary-glands/references/notes/page-wilson-2007.md)。
- 未建模完整下丘脑 GnRH 脉冲动力学、卵泡发育超声数目、个体月经异常疾病与受孕妊娠；未做真实 DSH 会话或临床验证。
