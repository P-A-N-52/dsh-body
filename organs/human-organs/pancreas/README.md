# 胰腺内分泌（pancreasEndocrine）：相对胰岛素信号

**功能标签：** 内分泌（葡萄糖调节代理）。

`pancreasEndocrine` 读取轮初血浆葡萄糖浓度代理，写入一个无量纲的相对胰岛素信号；葡萄糖隔室再按该相对信号缩放超基线表观清除。它位于 `organs/human-organs/pancreas/`，只实现 `glucose.concentrationMgDl → pancreasEndocrine.insulinRelative → glucose 表观清除` 的工程薄切片，不是胰岛素浓度、分泌率、C-peptide 或完整血糖—胰岛素模型。

实现状态：胰腺脚本、参数与模块契约测试已落地（11/11 PASS）；葡萄糖耦合与根清单注册已接入，当前根清单为 17 个部位。尚未做真实 DSH 会话验收或独立生理数据验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `insulin.ts` | `pancreasEndocrine` | `insulinRelative` | 轮初 `glucose.concentrationMgDl`；自己的轮初 `insulinRelative`；`io.dt` | `insulin.parameters.json` |

- 无动作、无 transfer、无通知；不写葡萄糖，也不搬任何胰岛素质量。
- 唯一消费者是 `glucose` 的表观清除计算，已接入。葡萄糖仍是自己三个字段的唯一写者，双方都只读轮初快照，不做同轮迭代。
- 胰腺只读血糖、只写相对信号；血糖升高后信号按葡萄糖侧的乘性缩放改变清除。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `insulinRelative` | `1` | 轮末写入的无量纲相对信号，供下一轮葡萄糖清除作乘性缩放；初值 1。不是 µU/mL、pmol/L、分泌率、血浆胰岛素浓度或实测值，不能与实测胰岛素换算 |

时间原点：本轮轮末写出的值表示下一轮的相对信号；葡萄糖在本轮轮初读取上一轮已提交的值。该字段是状态，不是每轮通量。

## 3. 方程与参数

设 `G = glucose.concentrationMgDl` 的轮初读数，`I` 为胰腺轮初自身状态，`dtMin = io.dt / 60`：

```text
target = clamp(1 + 0.02 × (G − 90), 0, 5)
I_next = target + (I − target) × 2^(−dtMin / 10)
write.insulinRelative = I_next
```

`G = 90` 且 `I = 1` 时精确保持 1；`G` 偏离参考值时以一阶指数趋近目标，10 min 闭合剩余差距的一半。目标在 `G = 70` 时为 0.6，在 `G = 0` 时钳到 0，在 `G ≥ 290` 时钳到 5。低糖只降低相对信号，不产生负值；高糖提高目标但不区分分泌增加与清除变化。

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `pancreasEndocrine.referenceGlucoseMgDl` | 90 | `mg/dL` | `design` | `source: null`；暂与 `glucose.baselineConcentrationMgDl` 重复配置，测试固定两者相等；未来由共享身体预设/个体空腹基线替换 |
| `pancreasEndocrine.insulin.glucoseGainPerMgDl` | 0.02 | `1/(mg/dL)` | `design` | `source: null`；纯工程增益，不是 Dalla Man 2007 的分泌方程或拟合结果；未来由标准化餐后胰岛素剂量—反应替换 |
| `pancreasEndocrine.insulin.responseHalfTimeMin` | 10 | `min` | `design` | `source: null`；工程一阶时间尺度，不是实测分泌/清除半时；未来由 C-peptide/胰岛素分泌与清除证据替换 |
| `pancreasEndocrine.insulin.maxRelative` | 5 | `1` | `design` | `source: null`；防止无界响应的工程上限，不是 β 细胞饱和测量或临床界值；未来由饱和 β 细胞响应替换 |

四个数值都不是人体测量、文献报告值或拟合结果。参考血糖与葡萄糖基线分属两份参数文件，不跨模块 import 对方参数；当前靠测试固定二者相等。

## 4. 葡萄糖侧消费者

葡萄糖模块读取轮初 `I = pancreasEndocrine.insulinRelative`，并沿用碳水薄切片的基线质量 `B`、分布体积 `V` 与浓度定义：

```text
E = max(0, M_start − B)
D = E × (1 − 2^(−dtMin × I / 60))
write.glucoseMassG = M_start − D
write.disposedGlucoseG = D
```

- `I = 1` 时与原 60 min 表观清除公式逐位一致；`I > 1` 加快、`0 ≤ I < 1` 减慢，`I = 0` 时停止超基线清除。
- 始终 `0 ≤ D ≤ E`，不会把质量压到基线以下，也不引入低基线补糖。
- `glucose.apparentDisposalHalfTimeMin = 60 min` 的 ID 和值不变，语义为 `I = 1` 时的基线表观清除半时；未新增葡萄糖参数。
- `disposedGlucoseG` 只是本轮**非肾**表观清除汇，不区分组织去向，也不表示“胰岛素依赖份额”。浓度仍用轮初质量计算；本轮清除只改变轮末质量，下一轮浓度才反映。

这是把现有非肾聚合清除整体按相对信号缩放的工程简化，不表示所有组织摄糖都依赖胰岛素。肾糖排泄是另一独立薄切片，不在本信号的质量账内。

## 5. 默认轮次时序

一次摄入沿用第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收；第 4 轮葡萄糖写出首次高浓度读数，但胰腺轮初仍读旧值 90 mg/dL：

1. 第 4 轮胰腺写 1；葡萄糖也按 `I = 1` 清除。
2. 第 5 轮胰腺读到高浓度，写出 `I > 1`；葡萄糖本轮仍使用轮初 `I = 1`，清除尚未加快。
3. 第 6 轮葡萄糖第一次使用第 5 轮提交的高相对信号，清除开始加快。

不存在同轮“血糖升 → 胰岛素升 → 清除升”的代数环；信号上升与清除加快固定相隔一轮。

## 6. 缺失、异常与旧档

必须区分“上游按设计未接入”和“已接入但异常”：

- **自定义清单没有 `pancreasEndocrine`：** 葡萄糖按 `I = 1` 使用既有固定清除，保持清单可替换性。
- **自定义清单没有 `glucose`：** 胰腺按 `G = 90` 令目标为 1，已有相对信号按 10 min 一阶形式趋近 1，而不是把非 1 状态冻结。
- **已加载 `glucose` 但读数异常：** 缺 `concentrationMgDl`、非有限或为负数时抛错，让本轮失败并暴露错误；不写相对信号，也不回退健康常量。合法 0 是有效低信号，不是缺失。
- **旧根存档缺该部位：** 启动时只补 `insulinRelative = 1`，不反推升级前的胰岛素，也不重置已有葡萄糖。第一轮仍按 `I = 1` 的旧公式清除，后续再响应。
- **重启：** 保留已提交的相对信号，不从当前血糖反推历史；餐后重启后的第一轮使用恢复的信号。

根清单（`body-modules.json`）当前为 17 个部位，包含胰腺、肾糖以及本切片新增的 [`physicalActivity`](../skeletal-muscle/README.md) 与 [`skin`](../skin/README.md)；自定义清单可以省略胰腺（葡萄糖按 `I = 1`），但不能只加载胰腺而期待它改变不存在的葡萄糖状态。

## 7. 证据入口

- 脚本头注释：[`insulin.ts`](insulin.ts)
- Dalla Man 2007 笔记：[`../../human-compartments/glucose/references/notes/dalla-man-2007.md`](../../human-compartments/glucose/references/notes/dalla-man-2007.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 设计：[`docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md`](../../../docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md)

`SRC-DALLAMAN-2007` 只作结构背景：p.1742 §III.B 与式 (3) 的血浆/肝两室胰岛素动力学，p.1744 §III.C.4 与式 (26) 的葡萄糖驱动分泌，p.1744–1745 §III.C.3 的胰岛素依赖与非依赖组织利用，p.1748 的平均模型说明。当前的一阶目标响应、线性清除缩放、0.02 增益、10 min 半时和 5 倍上限都不是原文方程或参数，全部保持 `design`、`source: null`；不能称 `fitted_dev`、`validated`、正常餐后胰岛素曲线或个体预测。

## 8. 未建模与未验证

- 不建胰岛素浓度、分泌率、C-peptide、两室胰岛素动力学、肝糖输出、胰高血糖素、糖原、组织摄糖分区或饱和作用。
- 不建胰岛素抵抗、胰岛素非依赖利用份额、自动行为或药物作用；不把相对信号换算成任何实测单位。
- 无胰岛素 transfer，不搬质量；只缩放葡萄糖已有的超基线表观清除。肾糖排泄由独立薄切片处理，与本信号不互相替代。
- 模块与离线 Gateway 测试不等于真实 DSH 实机验收、独立生理数据验证、临床验证或个体预测；本项目尚未登记/提取可用于对照的餐后胰岛素测量。
