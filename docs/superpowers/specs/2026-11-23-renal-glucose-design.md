# 肾糖质量排泄薄切片设计

**状态：** 已实现并完成离线验收（2026-11-23）。用户已明确可以并行制作多个器官/功能薄切片；本设计只处理葡萄糖质量，不把葡萄糖换算成尿水。最终验证与未验收边界见 [`2026-11-23-parallel-organ-slices.md`](../plans/2026-11-23-parallel-organ-slices.md)。

## 1. 目标与边界

建立：

```text
glucose.concentrationMgDl
  → kidneyGlucose.excretionRequestG
  → glucose 按轮初请求转出质量
  → kidneyGlucose.excretedGlucoseG
```

目标是在血糖超过模型肾阈时产生可检查的肾糖质量汇，同时保留现有水账、膀胱和 ADH 产尿请求。

- 单位全程为 g；不计算尿量 mL，不改变 `bodyFluid`、`bladder`、口渴或尿意。
- `kidneyGlucose` 是肾目录下独立的糖排泄状态与写者，不复用或新增第二个 `kidney` 写者。
- `glucose` 仍是自己质量和浓度的唯一写者，按轮初请求发起 transfer；同轮新请求下一轮才执行。
- 本切片可与胰腺并行：胰腺改变表观清除，肾糖是单独的实际质量转移，两者不双计。

## 2. 方案取舍

### 选择：请求—结算的 g→g 转移

复用现有 `kidney.urineProductionRequestMl → bodyFluid` 的请求语义，但新链只传葡萄糖克数。肾糖请求不是已完成排泄，实际 transfer 后才写入 `excretedGlucoseG`。

### 不采用

- **直接把高糖转换为额外尿水：** 需要尿渗透压、溶质和水利尿适应证据，当前无依据。
- **同轮按当前浓度立即排泄：** 会绕过轮初快照，并允许同轮新吸收被重复支付。
- **把肾糖并入 `disposedGlucoseG`：** 会丢失实际肾排泄分项并双计。`disposedGlucoseG` 仍是非肾表观清除，肾糖由 transfer 单独记录。
- **扩展现有 `kidney` 部位：** 会把水请求与糖状态混在一个写者中；独立 `kidneyGlucose` 更容易保持原 DI 变体与水账不变。

## 3. 部位、字段与清单

| 项 | 契约 |
| --- | --- |
| 部位 ID | `kidneyGlucose` |
| 脚本 | `organs/human-organs/kidney/glucose-excretion.ts` |
| 参数 | 同目录 `glucose-excretion.parameters.json` |
| 动作 / 通知 | 均无 |

字段均为 `absolute`：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `excretionRequestG` | `g` | 按本轮轮初浓度和 `io.dt` 计算的下一轮请求；不是已排泄量 |
| `excretedGlucoseG` | `g` | 本轮实际接收的葡萄糖通量；每轮 write 先归 0，再由 transfer 加入 |

transfer 配对：

```text
glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG  (g)
```

`kidneyGlucose.excretedGlucoseG` 声明 `transferIn`，`glucose.glucoseMassG` 声明对应 `transferOut`。因此包含 glucose 的完整清单必须同时包含 kidneyGlucose；原五部位水/碳水闭包扩展为六部位。旧 `stomach/motility.ts` 不加载这条链，不受影响。

与胰腺共同实施时根清单由 13 增至 15；若单独实施肾糖则为 14。DI 变体复制根清单，自动包含新部位，原 ADH/水 golden 不变。

## 4. 证据与参数

证据为已登记的 Dalla Man 2007（`SRC-DALLAMAN-2007`），新增内容补入现有同一篇笔记，不新增来源行：

- p.1742：正常基础状态肾糖排泄为 0。
- p.1745 §III.C.5 式 (27)：`E = k_e1 × (G_p − k_e2)`，仅在 `G_p > k_e2` 时成立；`E` 为 mg/kg/min，`G_p` 为 mg/kg。
- p.1743 Table I 正常组：`k_e1 = 0.0005 min^-1`、`k_e2 = 339 mg/kg`。正文把 `k_e1` 称为 glomerular filtration rate，但单位是 `min^-1`，不能写成 mL/min 的实测 GFR。
- 原文没有给这两个常数单独的精度、± 类型或个体间离散度；它们是平均模型锚点，不是本项目独立验证。

参数：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `kidneyGlucose.filtrationRatePerMin` | 0.0005 | `min^-1` | `prior` | `SRC-DALLAMAN-2007`；未来由个体肾糖滤过/重吸收模型替换 |
| `kidneyGlucose.renalThresholdMgKg` | 339 | `mg/kg` | `prior` | 同上；未来由个体肾阈替换 |
| `kidneyGlucose.distributionVolumeDlPerKg` | 1.88 | `dL/kg` | `design` | 同一可及池定义；未来由共享身体预设替换 |
| `kidneyGlucose.referenceBodyMassKg` | 75 | `kg` | `design` | 未建个体体重；未来由身体预设替换 |

`distributionVolumeDlPerKg` 和 `referenceBodyMassKg` 暂时与 glucose 重复配置，测试固定相等；不跨模块 import 参数文件。`prior` 只表示已发表模型锚点，不是人体测量、拟合或验证。

## 5. 离散方程

肾糖脚本读取轮初 `C = glucose.concentrationMgDl`：

```text
Gp = C × 1.88                              // mg/kg
E  = max(0, Gp − 339) × 0.0005            // mg/kg/min
requestG = E × 75 × dtMin / 1000           // g/下一轮
write.excretionRequestG = requestG
write.excretedGlucoseG = 0                 // 等待本轮实际 transfer
```

阈值对应浓度 `339 / 1.88 ≈ 180.32 mg/dL`，只是单位换算，不是临床诊断界值。低于或等于阈值时请求为 0。

葡萄糖在自身 write 阶段读取轮初请求 `R`：

```text
D = 现有非肾表观清除量（若有胰腺则受其调节）
M_afterDisposal = max(0, M_start − D)
E = min(max(0, R), M_afterDisposal)
write.glucoseMassG = M_afterDisposal
write.disposedGlucoseG = D
transfer glucose → kidneyGlucose: E
```

- 请求不超过本轮清除后可用质量；同轮小肠/其他来源的新流入不能支付本轮排泄。
- `kidneyGlucose.excretedGlucoseG` 在实际 transfer 后才为 `E`；请求本身不进入质量账。
- 正常基础浓度 90 时请求和排泄均为 0。某轮出现高于阈值的浓度读数后，肾糖下一轮写请求，葡萄糖再下一轮首次执行；自然餐的跨阈轮次由轨迹决定，不固定为第 5/6 轮。若高浓度与胰腺信号在同一轮初出现，两种效应可在后续同轮发生，但必须分别记账。
- 旧档只补请求/实际通量 0，不反推历史排泄；第一轮即使已有高糖也不会自动补排历史量。

## 6. 缺失与异常

- 完整清单的 transfer 配对是硬依赖，不能预留一个未加载的 kidneyGlucose 槽位；缺部位应在启动时明确报错，文档必须更新旧自定义清单。
- 模块独立单元测试中没有上游部位时，请求/排泄按 0，以覆盖纯模块行为；这不改变完整清单的配对要求。
- 上游部位已加载但浓度或请求字段缺失、非有限、为负数时，不用健康常量掩盖，令本轮失败。合法 0 请求表示无排泄，不是异常。
- 不用固定参考值替代已接入的异常血糖或异常请求。

## 7. 质量账

在既有外源碳水账上增加实际肾糖分项：

```text
累计摄入碳水
= stomach.carbohydrateG
+ Σ mealQueue.remainingCarbohydrateG
+ smallIntestine.carbohydrateG
+ (glucose.glucoseMassG − B)
+ 累计 disposedGlucoseG
+ 累计 kidneyGlucose.excretedGlucoseG
```

`disposedGlucoseG` 只表示非肾表观清除；`excretionRequestG` 不累计；`excretedGlucoseG` 是每轮实际通量，由读取方逐轮求和。容差仍为 `1e-6 g`。水账不含肾糖项，原 `1e-6 mL` 恒等式不变。

## 8. 验收

1. **模块契约：** 低于/等于阈值无请求；刚好跨阈有正请求；单位、dt、体重和 `/1000` 换算正确；每轮实际字段先归 0，异常输入失败。
2. **transfer 时序：** 请求下一轮才执行；实际转移不超过清除后可用量；当轮小肠新流入不支付；同轮 write/transfer 不双扣。
3. **真实根清单：** 预置高于阈值的浓度，下一轮请求、再下一轮实际排泄；自然餐按实际跨阈时刻检查同一间隔，低碳餐无肾糖，高碳餐有肾糖且质量账 ≤`1e-6 g`。
4. **与胰腺并行：** 缺失胰腺按 I=1；胰腺升高只改变非肾清除，肾糖仍按实际 transfer 单列，两项之和守恒。
5. **兼容：** 水账、ADH、膀胱、DI、原尿意/口渴行为不变；旧档从 0 请求开始；六部位闭包文档与启动测试一致。
6. **最终：** 完整 `npm test` 与 `git diff --check`；不做真实 DSH、独立肾糖数据、尿量或临床验证。

## 9. 尚未实现

不建肾小管转运体、GFR mL/min、尿糖浓度、尿渗透压、SGLT、渗透性利尿、血容量/电解质或个体疾病。实际肾糖是终端质量汇，未来若有尿液组成或渗透调节需求，必须另立证据与设计。
