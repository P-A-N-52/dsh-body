# 胰腺内分泌（pancreasEndocrine）：相对胰岛素与胰高血糖素信号

**功能标签：** 内分泌（葡萄糖调节代理）。

`pancreasEndocrine` 读取轮初血浆葡萄糖浓度代理，写入两个无量纲的相对信号：高血糖侧 `insulinRelative`，低血糖侧 `glucagonRelative`。`insulinRelative` 由各摄糖部位各自使用：骨骼肌按敏感度 1.0、肝按 0.5 把相对信号换算成自己的摄糖请求；`glucagonRelative` 只由肝用于放大肝糖原释放。葡萄糖隔室自身的残余清除与胰岛素信号无关。它位于 `organs/human-organs/pancreas/`，只实现 `glucose.concentrationMgDl → pancreasEndocrine.insulinRelative → muscleGlucose / liver 摄糖请求` 与 `glucose.concentrationMgDl → pancreasEndocrine.glucagonRelative → liver 释放` 两条工程薄切片，不是胰岛素/胰高血糖素浓度、分泌率、C-peptide 或完整血糖—激素模型。

实现状态：胰腺脚本、参数与模块契约测试已落地；葡萄糖浓度、肌肉/肝摄糖请求与肝糖原释放的耦合、根清单注册均已接入，当前根清单为 23 个部位、25 份参数文件（女性清单 25 个部位、27 份，含 3 份 DI 变体）。`muscleGlucose` 与 `liver` 各自读取 `insulinRelative` 并用自己的敏感度计算请求；`liver` 另读 `glucagonRelative`；`glucose` 不再读本信号。尚未做真实 DSH 会话验收或独立生理数据验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `insulin.ts` | `pancreasEndocrine` | `insulinRelative`、`glucagonRelative` | 轮初 `glucose.concentrationMgDl`；自己的轮初 `insulinRelative` 与 `glucagonRelative`；`io.dt` | `insulin.parameters.json` |

- 无动作、无 transfer、无通知；不写葡萄糖、肌肉或肝，也不搬任何胰岛素/胰高血糖素质量。
- 三类消费者：`muscleGlucose` 与 `liver` 各自用 `insulinRelative` 计算摄糖请求（肌肉敏感度 1.0、肝 0.5），`liver` 用 `glucagonRelative` 放大肝糖原释放。三者都已接入；各部位只读轮初快照，不做同轮迭代。
- 胰腺只读血糖、只写相对信号；血糖偏离参考值时，两条信号按各自方向改变下游计算，但信号本身不修改任何质量，也不把不同组织的响应合并成一个“总清除”。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `insulinRelative` | `1` | 轮末写入的无量纲相对胰岛素信号，供下一轮 `muscleGlucose`（敏感度 1.0）与 `liver`（敏感度 0.5）各自计算摄糖请求；初值 1。不是 µU/mL、pmol/L、分泌率、血浆胰岛素浓度或实测值，不能与实测胰岛素换算 |
| `glucagonRelative` | `1` | 轮末写入的无量纲相对胰高血糖素信号，供下一轮 `liver` 放大肝糖原释放；初值 1。不是 pg/mL、pmol/L、分泌率、血浆胰高血糖素浓度或实测值，不能与实测胰高血糖素换算 |

时间原点：本轮轮末写出的两个值都表示下一轮的相对信号；`muscleGlucose`、`liver` 与 `glucose` 在本轮轮初读取上一轮已提交的值。两个字段都是状态，不是每轮通量。

## 3. 方程与参数

设 `G = glucose.concentrationMgDl` 的轮初读数，`I`、`H` 分别为胰腺轮初的 `insulinRelative`、`glucagonRelative`，`dtMin = io.dt / 60`：

```text
insulinTarget = clamp(1 + 0.02 × (G − 90), 0, 5)
I_next = insulinTarget + (I − insulinTarget) × 2^(−dtMin / 10)
glucagonTarget = clamp(1 + 0.02 × (90 − G), 0, 5)
H_next = glucagonTarget + (H − glucagonTarget) × 2^(−dtMin / 10)
write.insulinRelative = I_next
write.glucagonRelative = H_next
```

`G = 90` 且两个信号都为 1 时精确保持 1；`G` 偏离参考值时两路各以一阶指数趋近目标，10 min 闭合剩余差距的一半。胰岛素目标在 `G = 70` 时为 0.6，在 `G = 0` 时钳到 0，在 `G ≥ 290` 时钳到 5；低糖只降低相对信号，不产生负值。胰高血糖素目标方向相反：`G = 70` 时为 1.4，`G = 110` 时为 0.6，`G = 90` 时为 1；当前增益与参考值下 `G = 0` 的目标只有 2.8，`maxRelative = 5` 只是未来参数变化时的保护，正常 0–600 mg/dL 血糖不会触顶；`G` 高于 90 时目标低于 1（最低 0）。两路都不区分分泌增加与清除变化，也不表示 α/β 细胞相互抑制。

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `pancreasEndocrine.referenceGlucoseMgDl` | 90 | `mg/dL` | `design` | `source: null`；暂与 `glucose.baselineConcentrationMgDl` 重复配置，测试固定两者相等；未来由共享身体预设/个体空腹基线替换 |
| `pancreasEndocrine.insulin.glucoseGainPerMgDl` | 0.02 | `1/(mg/dL)` | `design` | `source: null`；纯工程增益，不是 Dalla Man 2007 的分泌方程或拟合结果；未来由标准化餐后胰岛素剂量—反应替换 |
| `pancreasEndocrine.insulin.responseHalfTimeMin` | 10 | `min` | `design` | `source: null`；工程一阶时间尺度，不是实测分泌/清除半时；未来由 C-peptide/胰岛素分泌与清除证据替换 |
| `pancreasEndocrine.insulin.maxRelative` | 5 | `1` | `design` | `source: null`；防止无界响应的工程上限，不是 β 细胞饱和测量或临床界值；未来由饱和 β 细胞响应替换 |
| `pancreasEndocrine.glucagon.glucoseGainPerMgDl` | 0.02 | `1/(mg/dL)` | `design` | `source: null`；血糖低于参考值每 1 mg/dL 对相对胰高血糖素目标的线性增益，方向与胰岛素相反；消费者是 `liver`。纯工程假设，不是 α 细胞分泌方程或拟合结果；未来由胰高血糖素剂量—反应替换 |
| `pancreasEndocrine.glucagon.responseHalfTimeMin` | 10 | `min` | `design` | `source: null`；相对胰高血糖素信号一阶趋近目标的时间尺度；消费者是 `liver`。不是实测分泌/清除半时；未来由分泌与清除证据替换 |
| `pancreasEndocrine.glucagon.maxRelative` | 5 | `1` | `design` | `source: null`；相对胰高血糖素目标的工程上限；当前增益与参考值下 `G = 0` 的目标为 2.8，5 只是参数变化时的保护，不是测量或临床界值；未来由饱和 α 细胞响应替换 |

八个数值都不是人体测量、文献报告值或拟合结果。参考血糖与葡萄糖基线分属两份参数文件，不跨模块 import 对方参数；当前靠测试固定二者相等。`glucagonRelative` 的曲线是纯工程反向占位，Dalla Man 2007 不含胰高血糖素方程或参数。

## 4. 摄糖请求与肝释放的消费者

`insulinRelative` 不再统一缩放一个“总清除量”，而是由各组织各自使用。设 `E = max(0, glucose.excessMassG)`、`I = insulinRelative`、`dtMin = io.dt / 60`：

```text
肌肉请求 = muscleGlucose.maxUptakeRateGPerMin
         × (E / (E + muscleGlucose.halfMaxExcessG))
         × (1 + 1.0 × (I − 1))
         × dtMin

肝储存请求 = min(
  liver.maxUptakeRateGPerMin
  × (E / (E + liver.halfMaxExcessG))
  × (1 + 0.5 × (I − 1))
  × dtMin,
  max(0, liver.glycogenCapacityG − (liver.glycogenG + liver.storageG))
)
```

`glucose` 只保留自己的残余清除与结算：

```text
D = E × (1 − 2^(−dtMin / glucose.residualDisposalHalfTimeMin))   （与 I 无关）
M_after = M_start − D
X = min(max(0, kidneyGlucose.excretionRequestG), M_after)
L_paid = min(liver.storageRequestG, M_after − X)
U_paid = min(muscleGlucose.uptakeRequestG, M_after − X − L_paid)
W = M_after + L_paid + U_paid
write.glucoseMassG = W
write.disposedGlucoseG = D
write.excessMassG = E
```

Gateway 先应用 write，再把本轮 transfer 按 transfer 对键排序后逐笔应用（`gateway/operations.js:206`）：`glucose` 的三个出口等价于肾糖 `X` → 肝储存 `L_paid` → 肌摄糖 `U_paid` 的目标名顺序；余额不足时后结算者被钳位，质量守恒仍逐轮成立。总清除量是肌肉请求、肝请求与 `glucose` 自身残余清除的涌现结果，不再承诺与旧的中央分配模型逐位一致。完整公式与钳位见[葡萄糖 README](../../human-compartments/glucose/README.md) §3。

- `I = 1` 时两部位响应都为 1；`I = 2` 时肌肉响应 2、肝响应 1.5；`I = 0` 时肌肉响应 0、肝响应 0.5。敏感度差异让同样信号下肌肉摄糖增加多于肝，但不是“胰岛素依赖/非依赖组织”的实测分区。
- `glucose.apparentDisposalHalfTimeMin` 已更名为 `glucose.residualDisposalHalfTimeMin`（值仍 60），只用于 `glucose` 自身残余清除（脑/红细胞等，与胰岛素无关）；肌肉与肝的摄糖效率由各自参数文件中的 `maxUptakeRateGPerMin`、`halfMaxExcessG` 与 `insulinSensitivity` 决定。
- `disposedGlucoseG` 只是本轮 `glucose` 自身残余清除，不区分具体组织去向，也不表示胰岛素依赖或非依赖的组织分区。肌摄糖实际支付 `U_paid` 另记在 `muscleGlucose.uptakeG`，肝储存实际支付 `L_paid` 另记在 `liver.storageG`，肝释放另记在 `liver.outputG`。浓度仍用轮初质量计算；本轮清除与到账只改变轮末质量，下一轮浓度才反映。
- `H = glucagonRelative` 只影响肝释放，不参与两部位的摄糖请求，也不缩放 `glucose` 的残余清除。肝读取轮初 `G = concentrationMgDl` 与 `H`，按 `G < 90 || H > 1` 释放 `min(liver.maxOutputRateGPerMin × H × dtMin, 肝糖原存量)`；完整存量和时序见[肝 README](../liver/README.md) §3–§4。肾糖排泄与肝释放是独立薄切片，不在本信号的质量账内。

## 5. 默认轮次时序

一次摄入沿用第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收；第 4 轮葡萄糖写出首次高浓度读数与 `excessMassG`，但胰腺轮初仍读旧值 90 mg/dL：

1. 第 4 轮：胰腺写 `I = 1`；`glucose` 写出 `E > 0`，并按自身残余清除开始下降。
2. 第 5 轮：胰腺读到高浓度，写出 `I > 1`；`muscleGlucose` 与 `liver` 读到第 4 轮的 `E` 和 `I = 1`，写出首批摄糖请求。
3. 第 6 轮：`glucose` 按“肾 → 肝 → 肌”结算首批请求，实际支付进入 `uptakeG` / `storageG`；同一轮两部位读第 5 轮升高的 `I`，写出增强请求。
4. 第 7 轮：增强后的请求到账；第 8 轮两部位把在途量并入糖原。存在逐层一轮的快照滞后，不存在同轮“血糖升 → 胰岛素升 → 摄糖升”的代数环。

低血糖方向：`glucose` 写出低浓度后，`liver` 下一轮读到低浓度即按 `H = 1` 的 1 g/min 基线释放（无胰腺时）；有胰腺时，`pancreasEndocrine` 也按该低浓度写出 `H > 1`，`liver` 再下一轮读到高信号并按比例放大释放。`liver` 当轮自己发起 transfer，提交后 `glucoseMassG` 回升，浓度下一轮才体现；存量耗尽后释放为 0。肝释放只读轮初快照，但肝自己持有糖原，当轮即可转出，不存在摄糖请求那样的“请求—结算”滞后。

## 6. 缺失、异常与旧档

必须区分“上游按设计未接入”和“已接入但异常”：

- **自定义清单没有 `pancreasEndocrine`：** `muscleGlucose` 与 `liver` 按 `I = 1` 计算摄糖请求，`liver` 按 `H = 1` 使用基线释放；`glucose` 的自身残余清除不受影响，保持清单可替换性。
- **自定义清单没有 `glucose`：** 胰腺按 `G = 90` 令两个目标都为 1，已有相对信号按 10 min 一阶形式趋近 1，而不是把非 1 状态冻结。
- **已加载 `glucose` 但读数异常：** 缺 `concentrationMgDl`、非有限或为负数时抛错，让本轮失败并暴露错误；不写两个相对信号，也不回退健康常量。合法 0 是有效低血糖读数，不是缺失。
- **旧根存档缺该部位：** 启动时只补 `insulinRelative = 1`、`glucagonRelative = 1`，不反推升级前的激素，也不重置已有葡萄糖。第一轮肌肉与肝按 `I = 1` 写请求、肝按 `H = 1` 基线释放，后续再响应。
- **重启：** 保留已提交的两个相对信号，不从当前血糖反推历史；餐后或低血糖重启后的第一轮使用恢复的信号。

根清单（`body-modules.json`）当前为 23 个部位、25 份参数文件（含 3 份 DI 变体），包含胰腺、肝糖原、肾糖、活动—皮肤切片加入的 [`physicalActivity`](../skeletal-muscle/README.md) 与 [`skin`](../skin/README.md)、肺切片加入的 [`lungs`](../lungs/README.md)，以及肌摄糖切片加入的 [`muscleGlucose`](../skeletal-muscle/README.md)；自定义清单可以省略胰腺（两部位按 `I = 1` 写请求、肝按 `H = 1` 释放），但不能只加载胰腺而期待它改变不存在的葡萄糖、肌肉或肝状态。`liver` 与 `muscleGlucose` 是含 `glucose` 清单的硬依赖，不能靠省略它们来跳过请求—结算链。

## 7. 证据入口

- 脚本头注释：[`insulin.ts`](insulin.ts)
- Dalla Man 2007 笔记：[`../../human-compartments/glucose/references/notes/dalla-man-2007.md`](../../human-compartments/glucose/references/notes/dalla-man-2007.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 设计：[`docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md`](../../../docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md)、[肝糖原/胰高血糖素设计](../../../docs/superpowers/specs/2026-11-23-liver-glycogen-design.md) 与[各部位自主摄糖设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- 消费者：[`liver` README](../liver/README.md) §3–§4、[`muscleGlucose` README](../skeletal-muscle/README.md) §6 与 [`glucose` README](../../human-compartments/glucose/README.md) §3

`SRC-DALLAMAN-2007` 只作结构背景：p.1742 §III.B 与式 (3) 的血浆/肝两室胰岛素动力学，p.1744 §III.C.4 与式 (26) 的葡萄糖驱动分泌，p.1744–1745 §III.C.3 的胰岛素依赖与非依赖组织利用，p.1748 的平均模型说明。当前的一阶目标响应、0.02 增益、10 min 半时和 5 倍上限都不是原文方程或参数，全部保持 `design`、`source: null`；肌肉/肝的 `maxUptakeRateGPerMin`、`halfMaxExcessG` 与 `insulinSensitivity` 同样不是原文值，§III.C.3 只支撑“组织利用可分区”的结构方向。原文不含胰高血糖素；`glucagonRelative` 的反向目标、增益、半时和上限也没有登记来源，不能称 `fitted_dev`、`validated`、正常餐后胰岛素/胰高血糖素曲线或个体预测。

## 8. 未建模与未验证

- 不建胰岛素/胰高血糖素的绝对浓度、分泌率、C-peptide、两室激素动力学、α/β 细胞相互抑制、受体或胞内信号、肝糖异生、脂肪组织分区、肌糖原容量上限、静息糖原周转、饱和作用或慢速组织隔室；M2 薄切片已含骨骼肌摄糖与肌糖原（肌肉按自身参数写 `uptakeRequestG`，`glucose` 结算后进入 `uptakeG`，下一轮入账 `glycogenG`，运动时消耗）与肝糖原储存/释放（肝按自身参数写 `storageRequestG`，实际到账进入 `storageG`，低血糖或高 `glucagonRelative` 时由肝释放），但不是完整组织分区或激素模型。
- 不建胰岛素抵抗、脂肪组织摄糖、自动行为或药物作用；不把两个相对信号换算成任何实测单位，也不表示胰高血糖素直接促进糖异生。
- 无激素 transfer，不搬质量；`insulinRelative` 只被肌肉与肝各自用于计算摄糖请求，`glucagonRelative` 只放大肝糖原释放；`glucose` 的自身残余清除与两者无关。肾糖排泄由独立薄切片处理，与本信号不互相替代；肝释放受存量限制，耗尽后不会凭空升糖。
- 模块与离线 Gateway 测试不等于真实 DSH 实机验收、独立生理数据验证、临床验证或个体预测；本项目尚未登记/提取可用于对照的餐后胰岛素或胰高血糖素测量。
