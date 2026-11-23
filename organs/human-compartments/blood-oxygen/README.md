# 血氧隔室（bloodOxygen）：供—需平衡代理

**功能标签：** 血氧（供氧—需氧平衡代理，不是解剖器官）。

`bloodOxygen` 位于 `organs/human-compartments/blood-oxygen/`，由 `oxygen.ts` 维护。它每轮按轮初快照合成需氧 `oxygenConsumptionMlMin`（基础 + 活动 + 消化），其中基础项按轮初 `thyroid.thyroxineRelative` 缩放为 `basalMlMin × (0.8 + 0.4 × T4)`；再读取轮初 `lungsVentilation.alveolarO2MlMin` 作为肺泡氧供给，按缺口写 `oxygenDeficit` 与 `spo2Percent`。**它是供—需平衡，不是可耗空的氧气账本**：不保存氧气质量，不做逐轮扣减，也不累计“氧债”；每轮重算供需，供 ≥ 需时 SpO2 停在基线，供 < 需时按缺口比例下降。它没有动作、通知或 `transfer`，也不写其他部位。

实现状态（2026-11-24）：脚本与参数在 `organs/human-compartments/blood-oxygen/`，已加入根清单。加入本切片时根清单为 22 部位、24 份参数文件，女性清单为 24 部位、26 份；肝糖原与内分泌轴切片加入后当前为根 28 部位、30 份参数文件，女性 30 部位、32 份。硬 transfer 闭包仍为根 10 个、女性 11 个部位，本切片不新增 transfer。同期新增 `lungsVentilation`（见 [`lungs`](../../human-organs/lungs/README.md)）、`interoception.dyspneaMm`（见 [`brain`](../../human-organs/brain/README.md)）与 `thyroid.thyroxineRelative`（见 [`thyroid`](../../human-organs/thyroid/README.md)）。本切片有模块测试与真实 Gateway 进程的离线集成测试；未做真实 DSH 会话、独立人体氧耗/通气/SpO2 数据或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `oxygen.ts` | `bloodOxygen` | `oxygenConsumptionMlMin`、`oxygenSupplyMlMin`、`spo2Percent`、`oxygenDeficit` | 轮初 `physicalActivity.remainingExerciseMin` / `intensity`、`duodenum.nutrientExposure`、`lungsVentilation.alveolarO2MlMin`、`thyroid.thyroxineRelative` | `oxygen.parameters.json` |

- `actionTypes = []`；无动作、无通知、无 `transfer`，只写自己的部位。
- 四个上游都是可选软读：未加载时分别按“无活动”“无消化氧耗”“供给等于本轮需氧”“基础项不随 T4 缩放”处理；已加载但字段缺失、非有限或为负时抛错，本轮不 `write`，Gateway 整轮原子提交作废。
- 每轮只读轮初快照。`physicalActivity` 与 `duodenum` 本轮写出的新值最早下一轮才进入需氧；`lungsVentilation` 本轮写出的供给也最早下一轮才被本隔室读到，形成一轮滞后。
- 本隔室不读自己的上一轮状态，也不累计消耗；重启后没有需要接续的氧气质量或历史缺口。

## 2. 字段与单位

四个字段都是 `absolute`，初值为静息基线 `250 / 250 / 97 / 0`。该初值只用于新部位或旧档补键，不反推历史。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `oxygenConsumptionMlMin` | `mL/min` | 本轮总需氧 = 基础（按 T4 缩放）+ 活动 + 消化；不是实测耗氧量、MET、能量消耗或代谢率 |
| `oxygenSupplyMlMin` | `mL/min` | 本轮采用的肺泡氧供给；来自轮初 `lungsVentilation.alveolarO2MlMin`，未加载时等于本轮需氧 |
| `spo2Percent` | `%` | 血氧饱和度代理；`baselineSpo2Percent × (1 − oxygenDeficit)`，不是脉搏血氧仪读数、血气分析或氧合曲线 |
| `oxygenDeficit` | `1` | 本轮未满足需求的比例，0–1；不是累计氧债、组织缺氧量、乳酸或临床指标 |

`spo2Percent` 与 `oxygenDeficit` 只是 `design` 口径的模型读数：供氧充足时 97%，完全无供给时 0%；它们不对应任何个体的实测血氧，也不能用血气分压或血红蛋白反推。

## 3. 方程与参数

设轮初活动剩余分钟 `R`、相对强度 `I`、营养暴露 `N`（`kcal/min`）、甲状腺相对量 `T4`：

```text
basalDemand = basalMlMin × (0.8 + 0.4 × T4)   （未加载 thyroid 时 = basalMlMin）
demand = basalDemand
       + activityGainMlMin × I                （R > 0 时）
       + digestionGain × N × basalMlMin
supply = lungsVentilation.alveolarO2MlMin     （未加载时 supply = demand）
deficit = demand > 0 ? clamp((demand − supply) / demand, 0, 1) : 0
spo2Percent = baselineSpo2Percent × (1 − deficit)
write { oxygenConsumptionMlMin: demand, oxygenSupplyMlMin: supply, spo2Percent, oxygenDeficit: deficit }
```

- `T4 = 1` 时基础项是 `basalMlMin` 的 1.2 倍；`T4 = 0.5` 时回到 `basalMlMin`，`T4 = 2` 时为 1.6 倍。`0.8 + 0.4 × T4` 是 `design` 常量，不是代谢率或甲状腺功能测量；活动附加项与消化项仍按 `basalMlMin` 计，不随 T4 缩放。
- `R = 0` 时活动项为 0，即使 `I` 仍是旧值；`I = 0` 或 `N = 0` 时对应项也为 0。
- `demand = 0` 是合法边界：缺口按 0 处理，不产生 `NaN`；正常参数下不会出现。
- `supply ≥ demand` 时 `deficit = 0`、`spo2Percent = 97`；`supply < demand` 时缺口按比例放大，`deficit = 1` 时 SpO2 为 0。
- 本轮写出的供给只来自上一轮 `lungsVentilation` 快照；不存在同轮“先调通气、再用新供给”的捷径。

同目录参数（`owner: bloodOxygen`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `bloodOxygen.basalMlMin` | 250 | `mL/min` | `design` | `source: null`；静息氧耗量级，工程占位，不是人体测量或代谢实测。未来由具备氧耗证据的模型替换 |
| `bloodOxygen.activityGainMlMin` | 1000 | `mL/min` | `design` | `source: null`；`intensity = 1` 时在基础需氧上追加的氧耗，工程占位；模型内相对强度不是 MET、%VO₂max 或实测强度。未来由活动—氧耗证据替换 |
| `bloodOxygen.digestionGain` | 0.1 | `1` | `design` | `source: null`；餐后产热占基础氧耗的比例，乘轮初 `duodenum.nutrientExposure`；不是间接测热法测量，也不表示营养暴露与氧耗的线性关系。未来由餐后产热/消化氧耗证据替换 |
| `bloodOxygen.baselineSpo2Percent` | 97 | `%` | `design` | `source: null`；供氧充足时的血氧饱和度代理基线，不是脉搏血氧仪读数、血气分析或个体基线。未来由具备血氧证据的模型替换 |

参数文件中的 `range` 只是工程调参范围，不是人体生理范围；四个参数全部 `design`、`source: null`，不能称 `validated`。

## 4. 消费者链

```text
physicalActivity（exercise / sex）
  └─ 轮初 remainingExerciseMin / intensity ─┐
duodenum.nutrientExposure ──────────────────┼─► bloodOxygen.oxygenConsumptionMlMin
thyroid.thyroxineRelative ──────────────────┘        │
                                                     │ 轮初需氧
lungsVentilation.alveolarO2MlMin ◄───────────────────┘
        │
        │ 自动通气                          lungsVentilation（潮气量 × 呼吸频率）
        └──────────── 下一轮肺泡氧供给 ──────────────┘

bloodOxygen.oxygenDeficit ─► interoception.dyspneaMm = clamp(100 × deficit, 0, 100)
bloodOxygen.spo2Percent / oxygenDeficit ─► body_state / GET /state（只读）
```

- `lungsVentilation` 是**自动调节**：它下一轮读 `oxygenConsumptionMlMin`，按死腔与吸入氧分数换算目标通气量；LLM 不提交呼吸动作，也不能直接写通气或 SpO2。
- `interoception` 软读 `oxygenDeficit` 写 `dyspneaMm`；`bloodOxygen` 未加载、字段缺失或非有限时按 0。`dyspneaMm` 不进入 `discomfort`，`brainNotify` 不读它，也没有气促通知。
- `spo2Percent` 与 `oxygenDeficit` 只通过 `body_state` / `GET /state` 暴露；当前没有器官读取 SpO2。
- 本隔室没有反向消费者：血氧变化不反馈到活动、消化、肌糖原或体温，也不自动停止运动。

## 5. 时序与一轮滞后

以 60 s 一轮、默认参数、一次 `exercise`（`intensity = 1`、`durationMin = 30`）、其余上游为 0 为例，只示意反馈顺序：

| 轮次 | 轮初活动 | `bloodOxygen` 需氧 / 供给（SpO2） | `lungsVentilation` 轮初看到的需氧 / 写出的通气 |
| ---: | --- | --- | --- |
| 1 | 无（动作轮末写入 30 min / 1） | 250 / 900（97%） | 250 → 6000 mL/min，供给 900 |
| 2 | 30 min / 1 | 1250 / 900（约 69.8%） | 250 → 仍 6000 mL/min，供给 900 |
| 3 | 29 min / 1 | 1250 / 900（约 69.8%） | 1250 → 约 8333 mL/min，供给 1250 |
| 4 | 28 min / 1 | 1250 / 1250（97%） | 1250 → 约 8333 mL/min，供给 1250 |
| … | … | … | … |
| 31 | 1 min / 1 | 1250 / 1250（97%） | 1250 → 约 8333 mL/min |
| 32 | 0 / 0 | 250 / 1250（97%，供给富余） | 1250 → 约 8333 mL/min |
| 33 | 0 / 0 | 250 / 900（97%） | 250 → 6000 mL/min，供给 900 |

- 第 1 轮活动状态在轮末提交，血氧与通气都还读不到；第 2 轮血氧先看到活动，通气仍读第 1 轮的基础需氧。
- 第 2–3 轮的短时缺口来自“供给读上一轮通气、通气读上一轮需氧”的双重滞后；通气跟上后 SpO2 回到基线。该短时下降是模型时序，不是人体去饱和时程，也不代表通气触顶。
- 活动结束后，需氧先回落，通气再晚一轮回到静息；血氧会先看到上一轮的高供给，形成短暂的供给富余，不产生缺口。
- 若需氧持续超过通气上限，肺泡供给封顶，缺口才会持续存在；默认参数下通气上限对应约 9000 mL/min 肺泡氧供给，具体见 [`lungs`](../../human-organs/lungs/README.md)。本表的数值是模型内算例，不是实测氧耗或 SpO2 时程。

## 6. 旧档、重启与可选部位

- **旧档：** 启动时只为缺失的 `bloodOxygen` 补初值 `250 / 250 / 97 / 0`，不反推历史氧耗、SpO2 或氧债；已有活动、十二指肠、通气与甲状腺状态不重置。旧档缺 `thyroid` 时由甲状腺模块补 `thyroxineRelative = 1`，第一轮基础项按 1.2 倍计。
- **重启：** 没有累计氧气质量或历史缺口需要恢复；下一次 heartbeat 按当时的轮初活动、营养暴露、T4 和存档中的通气重新合成供需。若重启前通气或 T4 处于高位，血氧第一轮可能读到这些旧值，属于正常的轮初快照，不是重复消耗。
- **合法零值：** `oxygenDeficit = 0`、`spo2Percent = 0`（极端供给不足）与 `oxygenSupplyMlMin = 0` 都是合法状态，不是缺失。
- **自定义清单没有 `bloodOxygen`：** `lungsVentilation` 按基础需氧 250 mL/min 回退，`interoception.dyspneaMm` 按 0；根清单不依赖这个回退，而是完整加载三者。
- **自定义清单没有 `lungsVentilation`：** 本隔室把供给视为等于需氧，SpO2 保持基线；这是可选部位回退，不是“供氧无限”的生理结论。
- **自定义清单没有 `thyroid`：** 基础项保持 `basalMlMin`，不乘 `0.8 + 0.4 × T4`；这是可选部位回退，不是“T4 正常”的生理结论。根清单同时加载两者。
- **已加载但上游异常：** `physicalActivity`、`duodenum`、`lungsVentilation` 或 `thyroid` 存在但字段缺失、非有限或为负时抛错，不用默认值掩盖，避免把损坏状态读成健康状态。合法的 `remainingExerciseMin = 0`、`intensity = 0`、`nutrientExposure = 0`、`alveolarO2MlMin = 0` 与 `thyroxineRelative = 0` 不是异常。

## 7. 未建模与未验证

**未建模：**

- 血气分压（PaO2 / PaCO2）、血红蛋白浓度、氧合曲线、氧含量与氧输送；`spo2Percent` 不是由这些量推导。
- 心输出量、血流分布、组织灌注与局部氧合；血氧池不区分脑、肌肉、内脏等区域。
- CO2 产生与排出、酸碱平衡、呼吸商与代谢底物。
- 高原、贫血、肺部疾病、心血管疾病等病理缺氧，以及吸氧、通气支持或呼吸机。
- 甲状腺激素的生成、转运、T3 转换与甲状腺疾病；本隔室只读相对 T4 信号，不建甲状腺轴本身，细节归 [`thyroid`](../../human-organs/thyroid/README.md)。
- 通气动作与自主呼吸控制：LLM 不能提交呼吸、屏气或过度通气动作；呼吸频率与潮气量只由 `lungsVentilation` 自动写。
- 气促通知：`dyspneaMm` 只是 `interoception` 的软读，不进入 `discomfort`，不进入 `brainNotify`，也不产生任何提醒或动作。
- 氧气质量守恒、累计氧债、组织缺氧损伤、乳酸、疲劳与运动耐量反馈；血氧下降不会自动限制活动或改变动作校验。
- 运动类型、MET、能量消耗、体温、环境温度/湿度/海拔、年龄、性别、BMI、训练状态与个体差异；`intensity` 只是模型内相对强度。

**未验证：** 四个参数全部是 `design`、`source: null`，没有登记人体来源；250 mL/min、1000 mL/min、0.1 与 97% 都不是实测值或拟合值。`0.8 + 0.4 × T4` 同样是 `design` 脚本常量，没有甲状腺—代谢实测标定。模块测试与真实 Gateway 离线测试只核对公式、供需平衡、时序、回退、异常与 JSON-safe，不等于独立人体数据、临床验证或真实 DSH 会话验收。不能把本隔室的 SpO2、需氧或缺口外推为人体测量、血气结论或疾病判断。本切片未做 28 / 30 部位性能基线。

设计见 [`2026-11-23-blood-oxygen-design.md`](../../../docs/superpowers/specs/2026-11-23-blood-oxygen-design.md)；通气侧见 [`lungs`](../../human-organs/lungs/README.md)，气促读数见 [`brain`](../../human-organs/brain/README.md)，消化氧耗上游见 [`duodenum`](../../human-organs/duodenum/README.md)，活动氧耗上游见 [`skeletal-muscle`](../../human-organs/skeletal-muscle/README.md)。
