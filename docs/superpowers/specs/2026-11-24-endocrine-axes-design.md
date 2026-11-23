# 内分泌轴（HPT / HPA）与松果体薄切片设计

日期：2026-11-24
状态：owner 要求内分泌腺按"下丘脑 → 垂体 → 外周腺"的轴结构实现，并具备负反馈自调节。

## 目标与边界

两条完整轴 + 一个节律腺，每个环节都有消费者，且外周激素反向抑制上游（负反馈）：

- **HPT**：`hypothalamusEndocrine.trhRelative` → `pituitary.tshRelative` → `thyroid.thyroxineRelative` → `bloodOxygen` 基础代谢；T4 升高反过来抑制 TRH 与 TSH。
- **HPA**：`hypothalamusEndocrine.crhRelative` → `pituitary.acthRelative` → `adrenal.cortisolRelative` → `liver` 肝糖释放；皮质醇升高反过来抑制 CRH 与 ACTH。
- **松果体**：`pineal.melatoninRelative` 按仿真昼夜变化 → `interoception.sleepinessMm`。

本步不做：甲状旁腺与血钙（骨交换/肾排泄/饮食钙至少一个扰动源才成立，暂记后续）、T3、肾上腺素/去甲肾上腺素、绝对激素浓度、睡眠行为（只有 `sleepinessMm` 读数，无睡眠动作）、免疫（胸腺/脾/淋巴，搁置）。全部参数 `design`、`source: null`，不是人体测量。

## 部位与公式

### `hypothalamusEndocrine`（`brain/hypothalamus-endocrine.ts`）

```text
trhTarget = clamp(1 + trhFeedbackGain × (1 − T4), 0, 3)
crhTarget = clamp(1 + crhFeedbackGain × (1 − cortisol), 0, 3)
trhRelative = trhTarget + (prevTRH − trhTarget) × 2^(−dtMin / 30)
crhRelative = crhTarget + (prevCRH − crhTarget) × 2^(−dtMin / 30)
```

读轮初 `thyroid.thyroxineRelative`、`adrenal.cortisolRelative`（未加载按 1）。参数 `hypothalamusEndocrine.trhFeedbackGain = 1`、`crhFeedbackGain = 1`（design）。

### `pituitary`

```text
tshTarget = clamp(trhRelative × (1 + tshFeedbackGain × (1 − T4)), 0, 3)
acthTarget = clamp(crhRelative × (1 + acthFeedbackGain × (1 − cortisol)), 0, 3)
tshRelative = tshTarget + (prevTSH − tshTarget) × 2^(−dtMin / 30)
acthRelative = acthTarget + (prevACTH − acthTarget) × 2^(−dtMin / 30)
```

读轮初下丘脑与外周激素（未加载按 1）。参数 `pituitary.tshFeedbackGain = 1`、`acthFeedbackGain = 1`（design）。

### `thyroid`

```text
thyroxineRelative = tshRelative + (prevT4 − tshRelative) × 2^(−dtMin / 60)
```

读轮初 `pituitary.tshRelative`（未加载按 1），`0–3` 相对量。`bloodOxygen.basalMlMin` 改为 `basalMlMin × (0.8 + 0.4 × thyroxineRelative)`（未加载按 1），即 T4 调基础氧耗。

### `adrenal`

```text
cortisolRelative = acthRelative + (prevCortisol − acthRelative) × 2^(−dtMin / 15)
```

读轮初 `pituitary.acthRelative`（未加载按 1）。`liver` 的释放速率乘 `adrenal.cortisolRelative`（未加载按 1）：应激时肝糖输出增加。

### `pineal`

```text
hour = (io.simulatedSeconds / 3600) % 24
melatoninRelative = clamp(1 + 0.8 × cos(2π × (hour − 2) / 24), 0, 2)
```

02:00 峰值 1.8、14:00 谷值 0.2，纯 `design` 曲线，不表示真实昼夜节律测量。

### `interoception` 新读数

- `stressMm = clamp(100 × (cortisolRelative − 1) / 2, 0, 100)`（`adrenal` 未加载按 0）
- `sleepinessMm = clamp(100 × (melatoninRelative − 0.2) / 1.6, 0, 100)`（`pineal` 未加载按 0）

## 清单与计数

根清单 28 部位、30 份参数；女性清单 30 部位、32 份参数。无新 transfer，硬闭包不变。旧档缺各部位由 `initialState` 补基线（信号 1、褪黑素按当前仿真时刻计算）。

## 验收与未验证

- 单元：TSH 驱动 T4、T4 升高抑制 TRH/TSH（负反馈）、ACTH 驱动皮质醇及反馈、T4 改变基础氧耗、皮质醇改变肝糖释放、松果体昼夜曲线、两个新读数、非法上游抛错、JSON-safe。
- 真实 Gateway：预置高 TSH → T4 上升 → 基础氧耗上升且 TRH/TSH 回落；预置高 ACTH → 皮质醇上升 → 肝糖释放增加、`stressMm` 上升；跨仿真昼夜 `sleepinessMm` 变化；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：激素实测浓度、独立生理数据、真实 DSH 会话、临床验证、28 部位性能。
