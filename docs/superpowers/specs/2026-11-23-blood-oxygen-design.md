# 血氧池与肺通气薄切片设计

日期：2026-11-23
状态：owner 提出"不同行为会消耗氧气，涉及消化与肺呼吸量，建议用血氧池判断"；平衡式血氧池与自动通气为主代理按生理约束选定。

## 目标与边界

新增 `bloodOxygen` 隔室与 `lungsVentilation` 部位，让**行为与消化产生氧耗**、**肺自动调节通气**、**供不足时出血氧下降与气促读数**。

两条设计约束：

1. 氧气不是可耗空账本：血氧池是**供—需平衡**，输出 SpO2 代理与氧耗速率，不做缓慢消耗的质量守恒账。
2. 健康人运动时 SpO2 基本不降：需氧上升**自动**驱动通气上升（身体调节，不是 LLM 动作），只有通气触顶时才去饱和。

消费者链：

- `physicalActivity`（`exercise` / `sex`）与 `duodenum.nutrientExposure`（餐后产热）→ `bloodOxygen` 需氧；
- `bloodOxygen.oxygenConsumptionMlMin` → `lungsVentilation` 自动通气（潮气量 × 呼吸频率）；
- `bloodOxygen.spo2Percent` / `oxygenDeficit` → `interoception` 新读数 `dyspneaMm`（软读，不进 discomfort、无通知）。

本步不建血气分压（PaO2/PaCO2）、血红蛋白与氧合曲线、心输出量、CO2 与酸碱、高原/病理缺氧、通气动作（LLM 不控制呼吸）、气促通知。数值全部 `design`、`source: null`，不是人体测量。

## 部位与参数

### `bloodOxygen`（`organs/human-compartments/blood-oxygen/oxygen.ts`，隔室）

无动作、无 transfer。字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `oxygenConsumptionMlMin` | `mL/min` | 本轮总需氧 = 基础 + 活动 + 消化 |
| `oxygenSupplyMlMin` | `mL/min` | 本轮肺泡氧供给（读轮初 `lungsVentilation`） |
| `spo2Percent` | `%` | 血氧饱和度代理 |
| `oxygenDeficit` | `1` | 未满足需求比例 0–1 |

公式（读轮初 `physicalActivity`、`duodenum`、`lungsVentilation`；`dtMin = io.dt / 60`）：

```text
demand = basalMlMin
       + activityGainMlMin × intensity（remainingExerciseMin > 0 时）
       + digestionGain × nutrientExposure × basalMlMin
capacity = lungsVentilation.alveolarO2CapacityMlMin（通气能力上限，未加载时按 demand 全额供给）
supply = min(demand, capacity)
deficit = clamp((demand − supply) / demand, 0, 1)
spo2Percent = baselineSpo2Percent × (1 − deficit)
write { oxygenConsumptionMlMin: demand, oxygenSupplyMlMin: supply, spo2Percent, oxygenDeficit: deficit }
```

SpO2 由**需求与通气能力上限**决定，而不是由上一轮实际通气量决定：自动调节假定在一轮之内跟上需求，只有需求超过能力才去饱和。若直接用上一轮通气量算 SpO2，活动首轮会出现约 30% 的假性缺口（实施中实测 69.84%），与健康人运动不降 SpO2 矛盾，已修正。`alveolarO2MlMin`（实际通气供氧）保留为读数，体现一轮滞后。

参数（`oxygen.parameters.json`，均 design/null）：

- `bloodOxygen.basalMlMin = 250`（静息氧耗量级，design）
- `bloodOxygen.activityGainMlMin = 1000`（intensity = 1 时的附加氧耗，design）
- `bloodOxygen.digestionGain = 0.1`（餐后产热占基础氧耗比例，design）
- `bloodOxygen.baselineSpo2Percent = 97`

### `lungsVentilation`（`organs/human-organs/lungs/ventilation.ts`）

无动作、无 transfer。字段：`tidalVolumeMl`（mL）、`respiratoryRatePerMin`（1/min）、`ventilationMlMin`（mL/min）、`alveolarO2MlMin`（mL/min，实际供氧读数）、`alveolarO2CapacityMlMin`（mL/min，通气能力上限 = `maxVentilationMlMin × inspiredO2Fraction / deadSpaceFactor`，默认 9000，供 `bloodOxygen` 判定去饱和）。

通气随需氧自动调节：以满足需求为目标，按死腔与吸入氧分数换算，触顶后供给不足：

```text
targetVentilation = demand × deadSpaceFactor / inspiredO2Fraction
ventilationMlMin = clamp(targetVentilation, restingVentilationMlMin, maxVentilationMlMin)
respiratoryRatePerMin = clamp(ventilationMlMin / tidalVolumeMl, restingRatePerMin, maxRatePerMin)
tidalVolumeMl = restingTidalVolumeMl（本切片固定）
alveolarO2MlMin = ventilationMlMin × inspiredO2Fraction / deadSpaceFactor
```

参数（`ventilation.parameters.json`，均 design/null）：`lungsVentilation.restingTidalVolumeMl = 500`、`restingRatePerMin = 12`、`maxRatePerMin = 40`、`restingVentilationMlMin = 6000`、`maxVentilationMlMin = 60000`、`inspiredO2Fraction = 0.21`、`deadSpaceFactor = 1.4`。

`bloodOxygen` 未加载时按基础需氧 250 mL/min 计算；已加载但字段缺失/非有限/为负时抛错使本轮失败。需求来自上一轮快照，供给与需求之间存在一轮滞后，与既有反馈链一致。

### `interoception`

新增 `dyspneaMm`（`mm`、`absolute`）：`clamp(100 × bloodOxygen.oxygenDeficit, 0, 100)`；`bloodOxygen` 未加载/缺失/NaN 按 0；其余读数与 `discomfort` 不变。

## 清单与计数

根清单 22 部位、24 份参数；女性清单 24 部位、26 份参数。无新 transfer，硬闭包不变。旧档缺 `bloodOxygen` 与 `lungsVentilation` 由 `initialState` 补基线值，不反推历史。

## 验收与未验证

- 单元：`bloodOxygen` 需氧合成（基础/活动/消化）、供需平衡与去饱和曲线、`lungsVentilation` 自动通气与触顶、非法上游抛错、`dyspneaMm` 软读、JSON-safe。
- 真实 Gateway：`exercise` 与 `sex` 使需氧与通气上升，正常参数下 SpO2 保持基线（含活动首轮，无假性去饱和）；餐后 `nutrientExposure` 上升带来消化氧耗；低通气能力变体（`maxVentilationMlMin = 6000` → 能力 900 mL/min）下需求超过能力，SpO2 下降、`dyspneaMm > 0`；无血氧池的旧清单行为不变；重启后供需接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：实测氧耗/通气/SpO2、独立生理数据、真实 DSH 会话、临床验证、22 部位性能。
