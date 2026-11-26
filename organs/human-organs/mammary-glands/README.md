# 乳腺（mammaryGlands）：非妊娠诱导、局部自抑制与催产素排乳反射

**功能标签：** 生殖 / 内分泌靶点。**仅女性清单加载**（`body-modules.female.json`），根清单 `body-modules.json` 不加载乳腺，也不加载女性葡萄糖变体。

`mammaryGlands` 实现双环路泌乳—排乳切片（动作 `express_milk` 与 `breastfeed`，均受 `nsfw` 门控）：
1. **非妊娠诱导状态机**：纯持续高催乳素（`pituitary.prolactinNgMl >= 45 ng/mL`）可在数天内跨越 `galactorrheaThreshold = 0.25` 出现微量溢乳（`galactorrhea: true`，无机械吸吮刺激时 `inductionProgress` 封顶 `0.35`，不可直接进入规整泌乳，`SRC-PAGEWILSON-2007`）；必须叠加多日规律排空/吸吮刺激方跨越 `1.0` 进入规整 `lactating`；同时支持身体存档顶层 `profile.lactating: true` 稳态启动（初始 `storedMilkMl = 120 mL`、`inductionProgress = 1`）。
2. **局部充盈度自抑制**：`DF = storedMilkMl / storageCapacityMl`（容量按体重缩放基准 `360 mL`，`SRC-KENT-2006` `prior`），产奶速率受 `1 − DF²` 强自抑制；不排空时高充盈自动刹停产奶并转化为 `fullnessMm`（半衰期 15 min）。
3. **催产素喷乳反射与单次水账**：水（`milkMl`）与乳糖（`lactoseG`）在**合成入储备池 `storedMilkMl`**时向 `bodyFluid` / `glucose` 结算一次；执行 `express_milk` / `breastfeed` 待 `pituitary.oxytocinPgMl >= 4 pg/mL` 按 `PAMR`（亲喂 67.3% `SRC-KENT-2006`、双侧泵乳 75% `SRC-PRIME-2012`，单侧 0.66；伴过胀衰减 `-0.14 / 100 mL`）从 `storedMilkMl` 向外排出 `ejectedMilkMl`，绝不重复向 `bodyFluid` 扣水。

实现状态：脚本 `milk.ts`、参数 `milk.parameters.json`、动作门控与单元/Gateway 测试已落地；女性清单 44 部位、40 份唯一参数文件（根 41 / 37，男性 43 / 39）。

## 1. 脚本与字段

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `lactating` | `1` | 是否处于规整泌乳状态（`nsfw: false` 强制为 `false`） |
| `galactorrhea` | `1` | 非产后纯高 PRL 诱发之微量溢乳开关（`!lactating && inductionProgress >= 0.25`） |
| `inductionProgress` | `1` | 非妊娠诱导进度 `[0, 1]`（无吸吮封顶 `0.35`，停刺激且恢复低 PRL 按 7 d 半时退化） |
| `storedMilkMl` | `mL` | 乳腺储备池体积（接收上一轮 `milkMl` 转入，被排乳反射扣除） |
| `ejectedMilkMl` | `mL` | 本轮经喷乳反射实际排出体外的乳汁体积（不再向体液扣水） |
| `stimulationMin` | `min` | 剩余乳头吸吮/泵乳刺激分钟（驱动 `pituitary` 分泌 PRL 与 OT） |
| `milkRequestMl` / `milkMl` | `mL` | **下一轮**产奶水请求 / 本轮由 `bodyFluid` 转入的合成水（`transferIn`） |
| `lactoseRequestG` / `lactoseG` | `g` | **下一轮**乳糖请求 / 本轮由 `glucose` 转入的葡萄糖当量（`transferIn`） |
| `fullnessMm` | `mm` | 乳腺胀满不适代理 0–100 mm（软读入 `interoception.mammaryFullnessMm` 与 `discomfort` 第六路，并接入 `brainNotify` / `body_state`） |

## 2. 消费者、参数与证据

- 参数（`milk.parameters.json` 共 14 项）：`basalMilkRateMlPerMin = 0.54 mL/min`、`storageCapacityMl = 360 mL`、`breastfeedPamr = 0.673`（`SRC-KENT-2006`，`prior`）；`expressPamr = 0.75`（`SRC-PRIME-2012`，`prior`）；其余 10 项（包括 `lactoseGPerMl = 0.074`、`letdownOxytocinThresholdPgMl = 4 pg/mL`、诱导门槛与速率等）均标 `design`。
- 文献笔记：[`references/notes/uvnas-moberg-2020.md`](references/notes/uvnas-moberg-2020.md)、[`references/notes/kent-2006.md`](references/notes/kent-2006.md)、[`references/notes/prime-2012.md`](references/notes/prime-2012.md) 与 [`references/notes/page-wilson-2007.md`](references/notes/page-wilson-2007.md)。
- 未建模妊娠期激素与产后复旧、乳汁脂肪/蛋白/钙分离组件及临床乳腺炎；未做真实 DSH 会话或临床验证。
