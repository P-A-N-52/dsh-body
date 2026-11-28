# 乳房组织组成与乳腺泌乳

本目录有两个独立部位：`breastComposition` 记录组织形态，随根、男性和女性三份成人清单加载；`mammaryGlands` 计算泌乳与排乳，只随女性清单加载。设置前者不会启用后者或改变 `nsfw`。

## 乳房组织组成

[脚本 `composition.ts`](composition.ts) 用双组分近似记录连续组成，不划分“脂肪型”或“腺体型”。在 [`composition.parameters.json`](composition.parameters.json) 中，两项输入都没有人群默认值：

| `body-state.json` 顶层 `parameters` 中的 ID | 单位和输入 | 基础值及状态 |
| --- | --- | --- |
| `breastComposition.bilateralTissueVolumeMl` | mL；双侧合计只含脂肪与纤维腺体组织，接受正有限数，不随体重缩放 | `null`（`unset`） |
| `breastComposition.fibroglandularVolumePct` | %；同一双侧组织体积中纤维腺体占比，接受闭区间 `[0,100]`，如 `20` 表示 20% | `null`（`unset`） |

可用同一时点、同一组织边界的既有资料，或直接指定虚构角色参数；不要求照片、影像或额外检查。不要输入胸围、罩杯、全身体脂、单侧百分数、二维面积占比或 BI-RADS 类别来代替。若已有左右两侧匹配口径的组织数据，先把同类体积相加，再用双侧纤维腺体积除以双侧总体积，不能平均两个百分数或把单侧擅自乘二。分母不含胸壁/胸肌、皮肤、储奶等双组分口径之外的内容。

`parts.breastComposition` 发布同名的两个输入以及 `fibroglandularVolumeMl = bilateralTissueVolumeMl × (fibroglandularVolumePct / 100)`、`fatVolumeMl = bilateralTissueVolumeMl − fibroglandularVolumeMl`。只填一项时仍显示已知输入，两个派生值均为 `null`；两项不填时四个值都为 `null`。显式 `null` 也是未知；非法数值拒绝启动，不会钳位。

停 Gateway，在完整存档顶层已有 `parameters` 中合并如下设定，随后重启；不要覆盖整份存档或手改 `snapshot`。显式值优先于文件默认和旧读数。正常启动立即刷新；若启动时仍保留在途批次，首个成功心跳刷新。

```json
{
  "parameters": {
    "breastComposition.bilateralTissueVolumeMl": 600,
    "breastComposition.fibroglandularVolumePct": 20
  }
}
```

[真实 Gateway 对照](../../../test/organs.breast-composition-gateway.test.mjs)中，同为 `600 mL`，填 `20%` 得纤维腺体 `120 mL`、脂肪 `480 mL`，填 `60%` 得 `360 mL`、`240 mL`；都是合成例，不是人体参考值。同样的已泌乳配置下（`nsfw: true`、`profile.lactating: true`），从启动到第 3 轮水、糖、奶量和储奶完全相同；第 2 轮已有实际乳汁水结算。该读数不是物质库存，不换算成脂肪质量、也不额外加到 [全身体成分](../../human-compartments/body-composition/README.md)。它仅见于本机 `/state`、`gateway.getState()` 及脚本状态读取，不新增动作、主观感受或通知。

**方法与证据边界。** [NCI《Dense Breasts》](https://www.cancer.gov/types/breast/breast-changes/dense-breasts) 的 “What are dense breasts?” 区分腺体、纤维结缔组织和脂肪：纤维腺体是前两者的合称，不是纯分泌腺上皮，也不预测产乳能力。 [Chan 等，Radiology 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3219914/)（[DOI](https://doi.org/10.1148/radiol.11110506)，Methods 的组织分割与统计分析）在 30 名无症状亚洲女性的非增强 MRI 中用 `FV/BV × 100%`，这里只用于说明体积分数口径，不假定研究的组织分母与本模型一致，不外推至男性或哺乳期，也不作为默认值来源。两项参数 `source: null`；下文 `360 mL` 储奶容量不代表乳房组织体积。

## 乳腺泌乳（`mammaryGlands`）

`mammaryGlands` 实现双环路泌乳—排乳切片（动作 `express_milk` 与 `breastfeed`，均受 `nsfw` 门控）：
1. **非妊娠诱导状态机**：纯持续高催乳素（`pituitary.prolactinNgMl >= 45 ng/mL`）可在数天内跨越 `galactorrheaThreshold = 0.25` 出现微量溢乳（`galactorrhea: true`，无机械吸吮刺激时 `inductionProgress` 封顶 `0.35`，不可直接进入规整泌乳，`SRC-PAGEWILSON-2007`）；必须叠加多日规律排空/吸吮刺激方跨越 `1.0` 进入规整 `lactating`；同时支持身体存档顶层 `profile.lactating: true` 稳态启动（初始 `storedMilkMl = 120 mL`、`inductionProgress = 1`）。
2. **局部充盈度自抑制**：`DF = storedMilkMl / storageCapacityMl`（容量按体重缩放基准 `360 mL`，`SRC-KENT-2006` `prior`），产奶速率受 `1 − DF²` 强自抑制；不排空时高充盈自动刹停产奶并转化为 `fullnessMm`（半衰期 15 min）。
3. **催产素喷乳反射与单次水账**：水（`milkMl`）与乳糖（`lactoseG`）在**合成入储备池 `storedMilkMl`**时向 `bodyFluid` / `glucose` 结算一次；执行 `express_milk` / `breastfeed` 先把会话参数写入 `pendingEjections`，待轮初 `pituitary.oxytocinPgMl >= 5 pg/mL` 按单次 `PAMR`（亲喂 67.3% `SRC-KENT-2006`、双侧泵乳 75% `SRC-PRIME-2012`，单侧 0.66；伴过胀衰减 `-0.14 / 100 mL`）从 `storedMilkMl` 向外排出 `ejectedMilkMl`。默认催产素未达到阈值时，会话随存档等待后续轮次；同轮多个动作按提交顺序各结算一次，动作后的 `stimulationMin` 延续只维持激素刺激，不重复套用 PAMR，且绝不重复向 `bodyFluid` 扣水。

实现状态：脚本 `milk.ts`、参数 `milk.parameters.json`、动作门控与单元/Gateway 测试已落地。部位与参数总数见[三份清单](../../../docs/gateway-and-scripts.md#2-有哪些-json分别由谁管理)。

### 泌乳脚本与字段

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `lactating` | `1` | 是否处于规整泌乳状态（`nsfw: false` 强制为 `false`） |
| `galactorrhea` | `1` | 非产后纯高 PRL 诱发之微量溢乳开关（`!lactating && inductionProgress >= 0.25`） |
| `inductionProgress` | `1` | 非妊娠诱导进度 `[0, 1]`（无吸吮封顶 `0.35`，停刺激且恢复低 PRL 按 7 d 半时退化） |
| `storedMilkMl` | `mL` | 乳腺储备池体积（接收上一轮 `milkMl` 转入，被排乳反射扣除） |
| `ejectedMilkMl` | `mL` | 本轮经喷乳反射实际排出体外的乳汁体积（不再向体液扣水） |
| `stimulationMin` | `min` | 剩余乳头吸吮/泵乳刺激分钟（驱动 `pituitary` 分泌 PRL 与 OT） |
| `pendingEjections` | `1` | 待催产素达到阈值的排乳会话数组；每项保存 `durationMin` 与 `mode`，按动作顺序消费一次并随存档恢复 |
| `milkRequestMl` / `milkMl` | `mL` | **下一轮**产奶水请求 / 本轮由 `bodyFluid` 转入的合成水（`transferIn`） |
| `lactoseRequestG` / `lactoseG` | `g` | **下一轮**乳糖请求 / 本轮由 `glucose` 转入的葡萄糖当量（`transferIn`） |
| `fullnessMm` | `mm` | 乳腺胀满不适代理 0–100 mm（软读入 `interoception.mammaryFullnessMm` 与 `discomfort` 第六路，并接入 `brainNotify` / `body_state`） |

### 泌乳消费者、参数与证据

- 参数（`milk.parameters.json` 共 14 项）：`basalMilkRateMlPerMin = 0.54 mL/min`、`storageCapacityMl = 360 mL`、`breastfeedPamr = 0.673`（`SRC-KENT-2006`，`prior`）；`expressPamr = 0.75`（`SRC-PRIME-2012`，`prior`）；其余 10 项（包括 `lactoseGPerMl = 0.074`、`letdownOxytocinThresholdPgMl = 5 pg/mL`、诱导门槛与速率等）均标 `design`。
- 文献笔记：[`references/notes/uvnas-moberg-2020.md`](references/notes/uvnas-moberg-2020.md)、[`references/notes/kent-2006.md`](references/notes/kent-2006.md)、[`references/notes/prime-2012.md`](references/notes/prime-2012.md) 与 [`references/notes/page-wilson-2007.md`](references/notes/page-wilson-2007.md)。
- 未建模妊娠期激素与产后复旧、乳汁脂肪/蛋白/钙分离组件及临床乳腺炎；未做真实 DSH 会话或临床验证。
