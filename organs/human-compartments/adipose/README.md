# 单一可动用脂肪库（adipose）

仅[膳食脂质预设](../../presets/human-lipid/README.md)加载 `meal-storage.ts`。`storedTgG`（g 长链 TG/酰基当量）接收循环餐源 TG；这是短程可动用库，不是全身体脂 kg，也不按体重、性别或未知体脂推定。脂肪库通过只读 `storageCapacityG` 提供本次启动生效的容量（g）；`capacityG` 字段是上一次提交记录的容量，不用于重启首轮的限付。循环部位用生效容量减去轮初 `storedTgG` 算余量，沿用轮初 `storageFraction`，拒收留在循环。停机下调容量后，首个可提交轮（启动补算或重试也一样）即按新上限；已存脂肪不截断，库存未降到上限以下时不新收。

用 `pancreasEndocrine.insulinPmolL/I_ref` 滤成轮末 `insulinRelative`，未加载内分泌时以 1 为参照。轮初滤波值 `r` 的作用 `s=r/(K+r)`；储存比例 `p = pmax × s`，动员率 `k = kmax × (1−s)`。下一轮使用新滤波值。`mobilizedG` 为轮初有限库存实际扣除并转入 `lipidCirculation.nefaEquivalentG` 的账面 g，不是已证实脂解质量、NEFA 物理 g 或供能。无进食时也只用已有库存，没有隐性补油。

**可自定义参数：** 存档顶层 `parameters` 按 ID 覆盖，默认来自 [`meal-storage.parameters.json`](meal-storage.parameters.json)。全部 `design`、`source: null`，没有人体拟合。

| ID | 默认 | 单位 | 适用条件 |
| --- | ---: | --- | --- |
| `adipose.capacityG` | 150 | g TG 当量 | 非负；约束新沉积和缺库存时的起始量，不截断已有库存 |
| `adipose.initialStoredTgG` | 60 | g TG 当量 | 非负；只在缺库存字段时取此值与生效容量的较小值 |
| `adipose.insulinReferencePmolL` | 60 | pmol/L | 正数，`r=1` 的独立模型参照；若自定义胰腺静息值且希望继续以它为参照，可同步显式调整 |
| `adipose.insulinTimeConstantMin` | 8 | min | 正数；一阶滤波时间常数 |
| `adipose.insulinHalfEffectRelative` | 1 | 1 | 正数；相对半效值，不是人体阈值 |
| `adipose.maxStorageFraction` | 0.8 | 1 | [0, 1]；储存比例上界 |
| `adipose.mobilizationMaxPerMin` | 0.00035 | 1/min | [0, 5]；无胰岛素抑制的净动员最高率 |

[OpenStax A&P 2e §24.5 Absorptive/Postabsorptive States](https://openstax.org/books/anatomy-and-physiology-2e/pages/24-5-metabolic-states-of-the-body) 仅支持餐后储存/餐间净动员方向。没有全身脂肪平衡、高阶激素、脂肪组织分区、脂肪生成、氧化和体重变化。
