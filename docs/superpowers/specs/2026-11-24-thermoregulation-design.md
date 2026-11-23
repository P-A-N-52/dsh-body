# 体温调节薄切片设计

日期：2026-11-24
状态：owner 排期"体温"。体温必须由产热与散热的平衡决定，并反向驱动出汗与气促，而不是一个固定读数。

## 目标与边界

新增 `thermoregulation`（`organs/human-organs/brain/thermoregulation.ts`）：核心温度 = 产热（基础代谢/T4、活动、寒战）− 散热（汗液蒸发、辐射对流、呼吸），并按设定点负反馈调节出汗与寒战。

消费者链：`bloodOxygen.oxygenConsumptionMlMin`（代谢产热）与 `thyroid.thyroxineRelative` → 产热；`thermoregulation.coreTemperatureC` → `skin.sweatRequestMl`（热→汗增）、`lungsVentilation`（热→通气增/喘息）、`interoception` 冷热不适读数（`heatMm` / `coldMm`）。

本步不建皮肤分区温度、血管扩张/收缩、寒战肌肉做功细节、发热与疾病、低温症、绝对核心温度测量、湿度与风速。数值全部 `design`、`source: null`。

## 部位与公式

```text
heatProductionKcalMin = metabolicFactor × bloodOxygen.oxygenConsumptionMlMin
                      + shiveringGain × max(0, setpointC − coreTemperatureC)
evaporativeLossKcalMin = skin.sweatVolumeMl × evaporationKcalPerMl
otherLossKcalMin = lossGain × (coreTemperatureC − ambientTemperatureC)
coreTemperatureC = prev.coreTemperatureC
                 + dtMin × (heatProductionKcalMin − evaporativeLossKcalMin − otherLossKcalMin) / heatCapacityKcalPerC
```

参数（`thermoregulation.parameters.json`，均 design/null）：

- `thermoregulation.setpointC = 37`、`ambientTemperatureC = 25`、`heatCapacityKcalPerC = 60`
- `thermoregulation.metabolicFactor = 0.02`（每 mL/min 氧耗对应产热 kcal/min 的工程系数）
- `thermoregulation.shiveringGain = 2`、`lossGain = 0.05`、`evaporationKcalPerMl = 0.58`

`skin.sweatRequestMl` 改为 `原请求 × (1 + heatGain × max(0, coreTemperatureC − setpointC))`（`thermoregulation` 未加载按 1），体温升高时出汗增加。`lungsVentilation` 的通气目标增加 `pantingGain × max(0, coreTemperatureC − setpointC)`（未加载按 0），热时喘息。

`interoception` 新增 `heatMm = clamp(50 × (coreTemperatureC − setpointC), 0, 100)` 与 `coldMm = clamp(50 × (setpointC − coreTemperatureC), 0, 100)`（`thermoregulation` 未加载按 0）。

## 清单与计数

根清单 31 部位、33 份参数；女性清单 33 部位、35 份参数（在循环切片基础上）。无新 transfer，硬闭包不变。旧档缺 `thermoregulation` 由 `initialState` 补 `coreTemperatureC = 37`。

## 验收与未验证

- 单元：产热随氧耗与 T4、汗液蒸发散热、温度积分、热时出汗增加、冷时寒战产热、冷热读数、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：活动使体温上升、出汗增加并拉回设定点附近；预置高体温存档散热增强、体温回落；预置低体温寒战产热；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：实测体温曲线、独立生理数据、真实 DSH 会话、临床验证、31 部位性能。
