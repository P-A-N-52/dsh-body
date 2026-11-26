# 胰腺内分泌（pancreasEndocrine）：血浆胰岛素（pmol/L）与胰高血糖素相对信号

**功能标签：** 内分泌（葡萄糖调节代理）。

`pancreasEndocrine` 读取轮初血浆葡萄糖浓度代理，写入血浆胰岛素绝对浓度代理 `insulinPmolL`（单位 `pmol/L`，静息基准 `60 pmol/L`）与低血糖反调节信号 `glucagonRelative`（单位 `1`）。`insulinPmolL` 在体内按 Michaelis-Menten 可饱和清除 ODE（参考 Thorsteinsson 1985 正常人可饱和半饱和尺度 `Km = 3890 pmol/L`）积分，由各下游摄糖部位（`muscleGlucose`、`liver`、`smallIntestine`）通过 `insulinPmolL / 60` 归一化消费；`glucagonRelative` 在血糖低于参考值 `90 mg/dL` 时温和升高，跌破反调节阈值 `68 mg/dL` 后叠加陡增增益，由 `liver` 与 `kidneyGluconeogenesis` 消费。

实现状态：胰腺脚本、参数与模块契约测试已落地；葡萄糖浓度、肌肉/肝摄糖请求与肝糖原释放的耦合、三清单注册均已接入，当前根清单为 43 个部位、39 份唯一参数文件（女性清单 46 个部位、42 份，男性清单 45 个部位、41 份；全库共 47 份唯一参数文件）。参数标 `design`；尚未做真实 DSH 会话验收或独立人体餐后曲线验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `insulin.ts` | `pancreasEndocrine` | `insulinPmolL`、`glucagonRelative` | 轮初 `glucose.concentrationMgDl`；自己的轮初 `insulinPmolL` / `glucagonRelative`；`io.dt` | `insulin.parameters.json` |

- 无动作、无 transfer、无通知；不写葡萄糖、肌肉或肝，也不搬任何胰岛素/胰高血糖素质量。
- 三类消费者：`muscleGlucose` 与 `liver` 各自用 `I = insulinPmolL / 60` 计算摄糖请求（肌肉敏感度 1.0、肝 0.5），`smallIntestine` 在高血糖碳水梯度读 `I`（当前灵敏度 0）；`liver` 与 `kidneyGluconeogenesis` 读 `glucagonRelative` 放大内源升糖。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `insulinPmolL` | `pmol/L` | 血浆胰岛素浓度代理（空腹 90 mg/dL 静息稳态精确保持 `60 pmol/L`，保护上限 `900 pmol/L`）；下游通过 `I = insulinPmolL / 60` 消费。不是 C-peptide 或临床实验室个体测定 |
| `glucagonRelative` | `1` | 轮末写入的无量纲相对胰高血糖素信号，供下一轮 `liver` 与 `kidneyGluconeogenesis` 使用；初值 1，不是 pg/mL |

时间原点：本轮轮末写出的两个值供下一轮下游读取；代码已移除旧相对字段兼容回退，全面以 `insulinPmolL`（`pmol/L`）为准。

## 3. 方程与参数

设 `G = glucose.concentrationMgDl`（未加载按 90），`dtMin = max(0, io.dt / 60)`：

```text
basalSecretion = clearanceVmax × basalPmolL / (clearanceKm + basalPmolL)
secretion = G >= 90
  ? basalSecretion + glucoseGain × (G − 90)
  : max(0, basalSecretion × max(0, (G − 45) / 45))

// RK2 亚步积分（每步 <= 0.5 min，clamp [0, maxPmolL]）：
dC/dt = secretion − clearanceVmax × C / (clearanceKm + C)

deepDrop = max(0, hypoglycemiaThresholdMgDl − G)   // 68 mg/dL 阈值
glucagonTarget = clamp(1 + glucoseGainPerMgDl × (90 − G) + counterregGainPerMgDl × deepDrop, 0, maxRelative)
H_next = glucagonTarget + (H − glucagonTarget) × 2^(−dtMin / responseHalfTimeMin)
```

- `G = 90`、初值 `insulinPmolL = 60`、`glucagonRelative = 1` 时，`secretion = basalSecretion` 与饱和清除精确抵消，稳态精确维持 `60 pmol/L` 与 `1`。
- 高血糖时，`glucoseGainPmolLPerMinPerMgDl = 0.085` 在稳态下于 `+50..+100 mg/dL` 升幅区间温和抬升胰岛素至约 `2–3×` 基线而不致过度清除餐后峰值。
- 跌破 `68 mg/dL` 低血糖反调节阈值后，额外叠加 `0.06 / (mg/dL)` 陡增反调节增益加速动员肝释放与肾糖异生。

| 参数 ID | 默认值 | 单位 | 状态 | 来源与说明 |
| --- | ---: | --- | --- | --- |
| `pancreasEndocrine.referenceGlucoseMgDl` | 90 | `mg/dL` | `design` | 与 `glucose.baselineConcentrationMgDl` 对齐的稳态参考血糖 |
| `pancreasEndocrine.insulin.basalPmolL` | 60 | `pmol/L` | `design` | 空腹静息基础血浆胰岛素浓度代理 |
| `pancreasEndocrine.insulin.glucoseGainPmolLPerMinPerMgDl` | 0.085 | `pmol/(L·min·mg/dL)` | `design` | 高糖分泌刺激斜率（保证正常餐后稳态 ~2–3x） |
| `pancreasEndocrine.insulin.clearanceKmPmolL` | 3890 | `pmol/L` | `design` | 可饱和清除半饱和常数（量级参考 Thorsteinsson 1985 3.89 nmol/L；design） |
| `pancreasEndocrine.insulin.clearanceVmaxPmolLPerMin` | 274 | `pmol/(L·min)` | `design` | 血浆室表观最大饱和清除速率 |
| `pancreasEndocrine.insulin.maxPmolL` | 900 | `pmol/L` | `design` | 浓度保护上限 |
| `pancreasEndocrine.glucagon.hypoglycemiaThresholdMgDl` | 68 | `mg/dL` | `design` | 低血糖反调节陡增门槛（量级参考 Cryer 阶梯钳夹；design） |
| `pancreasEndocrine.glucagon.glucoseGainPerMgDl` | 0.02 | `1/(mg/dL)` | `design` | 低于 90 mg/dL 的温和斜率 |
| `pancreasEndocrine.glucagon.counterregGainPerMgDl` | 0.06 | `1/(mg/dL)` | `design` | 跌破 68 mg/dL 的反调节增益 |
| `pancreasEndocrine.glucagon.responseHalfTimeMin` | 10 | `min` | `design` | 胰高血糖素一阶半衰期 |
| `pancreasEndocrine.glucagon.maxRelative` | 5 | `1` | `design` | 目标上限 |

## 4. 消费者（`I = insulinPmolL / 60`）与时序

`liver`、`muscleGlucose` 与 `smallIntestine` 在本轮轮初读取 `pancreasEndocrine.insulinPmolL` 并除以 `60` 换算为无量纲归一化因子 `I`（未加载胰腺时回退 `1`；已加载但 `insulinPmolL` 缺失、非有限或为负时抛错）；`liver` 与 `kidneyGluconeogenesis` 读取 `glucagonRelative`。其余结算、质量守恒与轮次滞后边界保持不变。

`insulinPmolL` 不统一缩放一个“总清除量”，而是由各组织按 `I = insulinPmolL / 60` 归一化后各自使用。设 `E = max(0, glucose.excessMassG)`、`dtMin = io.dt / 60`：

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

- **自定义清单没有 `pancreasEndocrine`：** `muscleGlucose`、`liver` 与 `smallIntestine` 按 `I = 1`、`H = 1` 回退；`glucose` 的自身残余清除不受影响。
- **旧根存档只有历史相对字段：** 代码已统一移除旧字段兼容回退，全面以 `insulinPmolL`（`pmol/L`）为准；缺失 `insulinPmolL` 时直接按基线 `60 pmol/L` 起步。
- **已加载 `glucose` 但读数异常：** 缺 `concentrationMgDl`、非有限或为负时抛错，让本轮失败并暴露错误。

根清单（`body-modules.json`）当前为 43 个部位、39 份唯一参数文件（女性 46 / 42、男性 45 / 41）。

## 7. 证据入口

- 脚本头注释：[`insulin.ts`](insulin.ts)
- Dalla Man 2007 笔记：[`../../human-compartments/glucose/references/notes/dalla-man-2007.md`](../../human-compartments/glucose/references/notes/dalla-man-2007.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)
- 设计：[`docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md`](../../../docs/superpowers/specs/2026-11-22-pancreas-insulin-design.md)、[肝糖原/胰高血糖素设计](../../../docs/superpowers/specs/2026-11-23-liver-glycogen-design.md) 与[各部位自主摄糖设计](../../../docs/superpowers/specs/2026-11-24-tissue-uptake-design.md)
- 消费者：[`liver` README](../liver/README.md) §3–§4、[`muscleGlucose` README](../skeletal-muscle/README.md) §6 与 [`glucose` README](../../human-compartments/glucose/README.md) §3

`SRC-DALLAMAN-2007` 只作结构背景：p.1742 §III.B 与式 (3) 的血浆/肝两室胰岛素动力学，p.1744 §III.C.4 与式 (26) 的葡萄糖驱动分泌，p.1744–1745 §III.C.3 的胰岛素依赖与非依赖组织利用，p.1748 的平均模型说明。当前的一阶目标响应、0.02 增益、10 min 半时和 5 倍上限都不是原文方程或参数，全部保持 `design`、`source: null`；肌肉/肝的 `maxUptakeRateGPerMin`、`halfMaxExcessG` 与 `insulinSensitivity` 同样不是原文值，§III.C.3 只支撑“组织利用可分区”的结构方向。原文不含胰高血糖素；`glucagonRelative` 的反向目标、增益、半时和上限也没有登记来源，不能称 `fitted_dev`、`validated`、正常餐后胰岛素/胰高血糖素曲线或个体预测。

## 8. 未建模与未验证

- 已建胰岛素绝对浓度与饱和清除；不建胰高血糖素绝对浓度、C-peptide、α/β 细胞相互抑制、受体或胞内信号、肝糖异生、脂肪组织分区、肌糖原容量上限、静息糖原周转或慢速组织隔室；M2 薄切片已含骨骼肌摄糖与肌糖原（肌肉按自身参数写 `uptakeRequestG`，`glucose` 结算后进入 `uptakeG`，下一轮入账 `glycogenG`，运动时消耗）与肝糖原储存/释放（肝按自身参数写 `storageRequestG`，实际到账进入 `storageG`，低血糖或高 `glucagonRelative` 时由肝释放），但不是完整组织分区或激素模型。
- 不建胰岛素抵抗、脂肪组织摄糖、自动行为或药物作用；`glucagonRelative` 不换算成实测浓度，也不表示胰高血糖素直接促进糖异生。
- 无激素 transfer，不搬质量；`insulinPmolL / 60` 只被肌肉与肝各自用于计算摄糖请求，`glucagonRelative` 只放大肝糖原释放；`glucose` 的自身残余清除与两者无关。肾糖排泄由独立薄切片处理，与本信号不互相替代；肝释放受存量限制，耗尽后不会凭空升糖。
- 模块与离线 Gateway 测试不等于真实 DSH 实机验收、独立生理数据验证、临床验证或个体预测；本项目尚未登记/提取可用于对照的餐后胰岛素或胰高血糖素测量。
