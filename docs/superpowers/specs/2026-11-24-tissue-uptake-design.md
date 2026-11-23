# 各部位自主摄糖（请求—结算）设计

日期：2026-11-24
状态：owner 明确"各部位收到信息自己干活、只是效率不一样；各凭本事/阈值来接受，每个只管自己的"。本切片把中央摊派改为各部位自主响应。

## 目标与边界

`glucose` 不再先算总清除量再按固定份额摊派。改为：每个组织按**自己的参数**（最大速率、半饱和量、胰岛素敏感度、容量上限）对轮初血糖与胰岛素信号计算摄糖请求，`glucose` 只持有血池、计算自身残余清除并按序结算请求。总清除量是各部位响应的涌现结果，不是写死的半时。

释放同理各按各的机制：只有肝（以及以后的肾）往血里放葡萄糖；肌肉与脂肪不向血液释放葡萄糖（肌肉无 G6Pase，脂肪释放甘油/脂肪酸）。

本步不改残余清除的定义（脑/红细胞等非器官组织的表观清除，仍由 `glucose` 自己计算），不建脂肪组织（后续按同接口接入）、胰岛素浓度、肝糖异生以外的肾糖异生。

## 方案比较

- **中央摊派（现状，放弃）。** `D_total` 由固定半时给出，再按 0.75/0.15/0.10 分配；各部位没有独立响应，容量、敏感度都只是账本标签。
- **请求—结算（采用）。** 每个部位独立给出 `uptakeRequestG`，`glucose` 按序支付并受池内余量限制；效率、半饱和、敏感度、容量都长在该部位自己的参数文件里，新增组织只需按同一接口加入。

## 接口：`glucose.excessMassG` 与 `uptakeRequestG`

`glucose` 新增只读字段 `excessMassG`（`g`、`absolute`）：`max(0, glucoseMassG − baselineMassG)`，供各组织计算摄糖请求。该字段由 `glucose` 唯一写出，其它部位不得写入。

每个摄糖部位写出自己的 `uptakeRequestG`（`g`、`absolute`，本轮请求），`glucose` 下一轮按序结算；实际到账量写入该部位的 `uptakeG`（`transferIn: ['glucose.glucoseMassG']`，每轮 write 归 0）。

## 各部位自主摄糖公式

### `muscleGlucose`

```text
request = maxUptakeRateGPerMin
        × (excess / (excess + halfMaxExcessG))
        × (1 + insulinSensitivity × (insulinRelative − 1))
        × dtMin
write { ..., uptakeRequestG: request, uptakeG: 0 }
```

参数（`glucose-uptake.parameters.json`，均 `design`、`source: null`）：

- `muscleGlucose.maxUptakeRateGPerMin = 0.5`
- `muscleGlucose.halfMaxExcessG = 20`
- `muscleGlucose.insulinSensitivity = 1.0`

### `liver`

```text
request = maxUptakeRateGPerMin
        × (excess / (excess + halfMaxExcessG))
        × (1 + insulinSensitivity × (insulinRelative − 1))
        × dtMin
request = min(request, max(0, glycogenCapacityG − (glycogenG + storageG)))
write { ..., storageRequestG: request, storageG: 0 }
```

参数（`glycogen.parameters.json`，均 `design`、`source: null`）：

- `liver.maxUptakeRateGPerMin = 0.2`
- `liver.halfMaxExcessG = 15`
- `liver.insulinSensitivity = 0.5`

`liver` 保留原有 `glycogenCapacityG` 容量字段与当轮自行释放逻辑（低血糖/高胰高血糖素 → 释放），释放只由肝发起，肌肉不参与。

## `glucose` 结算

```text
E = max(0, M − B)
D = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))   （自身残余清除，不再按 I 缩放）
M_after = M − D
X = min(max(0, R), M_after)                              （肾糖，旧表达式）
L_paid = min(liver.storageRequestG, M_after − X)         （肝摄糖）
U_paid = min(muscleGlucose.uptakeRequestG, M_after − X − L_paid)
W = M_after                                            （write 值，转移前质量；三笔转出按序从中扣减）
write { glucoseMassG: W, disposedGlucoseG: D, concentrationMgDl, excessMassG: E }
transfer（Gateway 按 fromPart.fromField->target 排序）：
  glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG: X
  glucose.glucoseMassG → liver.storageG: L_paid
  glucose.glucoseMassG → muscleGlucose.uptakeG: U_paid
  liver.glycogenG → glucose.glucoseMassG: release（由 liver 发起）
```

参数 `glucose.residualDisposalHalfTimeMin = 60`（`design`、`source: null`）：仅用于 `glucose` 自身残余清除（脑/红细胞等，与胰岛素无关），不再被 `insulinRelative` 缩放；原 `apparentDisposalHalfTimeMin` 的"全体清除"语义废止。

结算顺序是 `policy`（肾 → 肝 → 肌），与 Gateway 的排序键一致；`W = M_after`，三笔转出按序从中扣减，提交质量 = `M_after − X − L_paid − U_paid`，余额不足时后结算者被钳位。请求与释放都用轮初快照，滞后一轮。

质量账不变式：`M_start = M_final + X + (D + L_paid + U_paid)`，其中 `D` 是 `glucose` 自身残余清除。外源碳水质量账各项不变（肌肉糖原、在途摄取、累计消耗、肝糖原差值、在途储存）。

## 轨迹与兼容

总清除量由组织响应涌现，**不再承诺与旧模型逐位一致**；`D_total`、固定份额和"肝满只改账本"的旧说法全部废止。`insulinRelative` 仍由各组织各自使用（肌肉敏感度 1.0、肝 0.5），`glucose` 自身残余清除与胰岛素无关。

`muscleDisposalShare`、`liverDisposalShare` 两个份额参数废止，替换为各部位的 `maxUptakeRateGPerMin` / `halfMaxExcessG` / `insulinSensitivity`；`glucose.apparentDisposalHalfTimeMin` 改名 `residualDisposalHalfTimeMin`（仅语义更名，值仍 60）。

旧档：`excessMassG` 缺失时由轮初质量现算；`uptakeRequestG` / `storageRequestG` 旧档补 0；其余字段沿用既有初值。

## 验收与未验证

- 单元：各部位请求公式（速率、半饱和、敏感度、容量）、`glucose` 结算顺序与钳位、缺部位启动报错、非法上游抛错、质量守恒、JSON-safe。
- 真实 Gateway：餐后血糖先升后降（涌现轨迹）、高胰岛素时肌肉摄糖增加而肝增加较少、低血糖时只有肝释放、肝满后摄糖请求为 0、重启接续、逐轮质量账。
- 最终 `npm test` 与 `git diff --check`。

未验证：各组织实测摄糖速率与半饱和、独立血糖曲线、真实 DSH 会话、临床验证、23 部位性能。
