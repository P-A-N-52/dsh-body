# 心 / 循环与血压薄切片设计

日期：2026-11-24
状态：owner 排期"心/循环 + 血压"。循环必须产生真实下游：氧输送、肾滤过与血容量调节，而不是一个心率读数。

## 目标与边界

新增 `heart`（心率/搏出量/心输出）与 `blood` 隔室（血容量、血压、氧输送），把循环接到血氧、肾和内分泌上：

- `physicalActivity` 与 `adrenal.cortisolRelative` → `heart` 心率与搏出量 → `blood.cardiacOutputMlMin`；
- `blood.cardiacOutputMlMin` × 血氧含量 → `bloodOxygen` 组织氧输送上限（通气只是氧源，循环才是运输）；
- `blood.bloodVolumeMl` / 血压 → `kidney` 滤过与产尿（低血容量时滤过下降、尿量减少），并作为 `hypothalamusAdh` 的第二个驱动（血容量 + 水亏缺）。

本步不建心电、瓣膜/心律、血压分级诊断、血管分区与微循环、血细胞与血红蛋白（骨髓搁置）、CO2/酸碱、运动性高血压病理。数值全部 `design`、`source: null`。

## 部位与公式

### `heart`（`organs/human-organs/heart/heart.ts`）

```text
drive = 1 + activityGain × intensity（remainingExerciseMin > 0 时）
      + catecholamineGain × (adrenal.cortisolRelative − 1)
heartRatePerMin = clamp(restingHeartRatePerMin × drive, restingHeartRatePerMin, maxHeartRatePerMin)
strokeVolumeMl = restingStrokeVolumeMl × (1 + 0.2 × (drive − 1))
cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl
```

参数（`heart.parameters.json`，均 design/null）：`heart.restingHeartRatePerMin = 70`、`maxHeartRatePerMin = 180`、`restingStrokeVolumeMl = 70`、`activityGain = 1.5`、`catecholamineGain = 0.5`。

### `blood`（`organs/human-compartments/blood/blood.ts`）

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `bloodVolumeMl` | `mL` | 血容量（随体液变化） |
| `cardiacOutputMlMin` | `mL/min` | 读轮初 `heart` 心输出 |
| `systolicMmHg` | `mmHg` | 收缩压代理 |
| `diastolicMmHg` | `mmHg` | 舒张压代理 |
| `oxygenDeliveryMlMin` | `mL/min` | 氧输送 = 心输出 × 动脉血氧含量 |
| `gfrMlMin` | `mL/min` | 滤过代理，供 `kidney` 读取 |

```text
arterialContent = bloodOxygen.spo2Percent × oxygenContentPerPercentMlPerL
oxygenDeliveryMlMin = cardiacOutputMlMin × arterialContent / 1000
systolicMmHg = clamp(baselineSystolic × (cardiacOutputMlMin / restingCardiacOutputMlMin) ^ 0.5, 80, 200)
diastolicMmHg = clamp(baselineDiastolic × (cardiacOutputMlMin / restingCardiacOutputMlMin) ^ 0.3, 40, 120)
gfrMlMin = baselineGfrMlMin × clamp(bloodVolumeMl / referenceBloodVolumeMl, 0.5, 1.2)
```

参数（`blood.parameters.json`，均 design/null）：`blood.referenceBloodVolumeMl = 5000`、`baselineSystolicMmHg = 120`、`baselineDiastolicMmHg = 80`、`baselineGfrMlMin = 100`、`oxygenContentPerPercentMlPerL = 2`。

`bloodOxygen` 的组织供氧改为 `min(demand, alveolarO2CapacityMlMin, blood.oxygenDeliveryMlMin)`：`blood` 未加载时只用通气能力上限，加载后循环不足也会导致去饱和。

`kidney` 的产尿请求改为 `原请求 × (blood.gfrMlMin / baselineGfrMlMin)`：`blood` 未加载按 1，低血容量时尿量下降。`hypothalamusAdh` 的目标改为 `原目标 + volumeGain × (1 − blood.bloodVolumeMl / referenceBloodVolumeMl)`：`blood` 未加载按 0，血容量低时 ADH 进一步升高。

## 清单与计数

根清单 30 部位、32 份参数；女性清单 32 部位、34 份参数（在内分泌 + 唾液腺基础上）。无新 transfer，硬闭包不变。旧档缺 `heart` / `blood` 由 `initialState` 补基线（心率 70、搏出 70、血容量 5000、血压 120/80、GFR 100）。

## 验收与未验证

- 单元：活动/皮质醇驱动心率与搏出、心输出计算、血压代理、氧输送、GFR 随血容量变化、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：活动时心率/心输出/氧输送上升且 SpO2 保持；低血容量变体 GFR 下降、尿量减少、ADH 上升；循环不足时血氧去饱和；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：实测心率/血压/心输出、独立生理数据、真实 DSH 会话、临床验证、30 部位性能。
