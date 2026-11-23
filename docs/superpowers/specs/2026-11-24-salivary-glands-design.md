# 唾液腺薄切片设计

日期：2026-11-24
状态：owner 指定"唾液腺有口水"，本切片给唾液一个可计算的产率与口干反馈，并接到消化与体感。

## 目标与边界

新增 `salivaryGlands`：按基础分泌、进食刺激与脱水状态计算唾液产率，输出两个消费者链：

1. `salivaRateMlPerMin` → `duodenum`：唾液淀粉酶对含碳水餐的营养暴露有小幅增益（消化从口腔开始）。
2. `mouthMoistureMm` → `interoception.dryMouthMm`：脱水时唾液减少、口干读数上升（`bodyFluid.waterDeficit` 驱动）。

本步不做唾液水账（不进出 `bodyFluid`）、淀粉酶浓度、吞咽/食管、口腔疾病、唾液腺结石、味觉、口咽解渴支路。数值全部 `design`、`source: null`。

## 部位与公式

`salivaryGlands`（`organs/human-organs/salivary-glands/saliva.ts`），无动作 transfer。字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `salivaRateMlPerMin` | `mL/min` | 本轮唾液产率 |
| `mealStimulusMin` | `min` | 进食刺激剩余分钟（`eat` / `drink` 触发） |
| `mouthMoistureMm` | `mm` | 口腔湿润度代理 0–100 |

```text
mealStimulusMin = max(0, prev.mealStimulusMin − dtMin)；本轮有合法 eat/drink 时置为 mealWindowMin
stimulated = mealStimulusMin > 0 ? mealGain : 1
dehydration = 1 − dehydrationFactor × clamp(bodyFluid.waterDeficit, 0, 1)
salivaRateMlPerMin = basalRateMlPerMin × stimulated × dehydration
mouthMoistureMm = clamp(100 × salivaRateMlPerMin / (basalRateMlPerMin × mealGain), 0, 100)
```

参数（`saliva.parameters.json`，均 design/null）：`salivaryGlands.basalRateMlPerMin = 0.5`、`mealGain = 3`、`mealWindowMin = 5`、`dehydrationFactor = 0.5`、`duodenum.salivaryAmylaseGain = 0.05`。

`duodenum` 对含碳水餐的营养暴露改为 `base × (1 + salivaryAmylaseGain × salivaRateMlPerMin / basalRateMlPerMin)`（`salivaryGlands` 未加载按增益 0），即唾液越足、淀粉酶消化贡献越大；不含碳水时不变。

`interoception` 新增 `dryMouthMm = clamp(100 − mouthMoistureMm, 0, 100)`（`salivaryGlands` 未加载按 0）。

## 清单与计数

根清单 29 部位、31 份参数；女性清单 31 部位、33 份参数（在内分泌切片基础上累加）。无新 transfer，硬闭包不变。旧档缺 `salivaryGlands` 由 `initialState` 补 `mealStimulusMin = 0` 与基础产率。

## 验收与未验证

- 单元：基础产率、进食刺激 ×3 与 5 min 窗口、脱水减半、口干读数、淀粉酶增益（含碳水/不含碳水）、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：进食后产率上升、营养暴露含淀粉酶增益；预置脱水存档 → 产率下降、`dryMouthMm` 上升；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：实测唾液流率与淀粉酶活性、独立生理数据、真实 DSH 会话、临床验证、29 部位性能。
