# 消化链开环修复设计

日期：2026-11-24
状态：独立响应排查发现消化链是最大开环：胃排空不读肠抑信号、ghrelin 不读扩张/营养、小肠不读水合/血糖。本切片把三处接上真实信号，形成反馈闭环。

## 目标与边界

- **肠抑胃反射**：`stomach` 读 `duodenum.nutrientExposure`，营养暴露越高，排空越慢（CCK/GLP-1 的工程代理）。
- **ghrelin 抑制**：`stomachGhrelin` 读 `stomachSensory.mechanical`（扩张）与 `duodenum.nutrientExposure`（营养），按剂量抑制，不再被任意正能量一步压到谷值。
- **吸收调节**：`smallIntestine` 水吸收读 `bodyFluid.waterDeficit`，碳水吸收读 `glucose.concentrationMgDl` 与 `pancreasEndocrine.insulinRelative`。

全部为一阶轮初快照读取，滞后一轮；参数 `design`、`source: null`，不是人体测量。

## 方案比较

- **保留固定速率（不做）。** 吃多少都一个速度，违背真实消化调节。
- **接入反馈（采用）。** 三处都只新增读取和缩放，不改现有状态/transfer 形状，测试可在原轨迹上加扰动验证。

## 公式

### `stomach`（`motility-core.ts`）

```text
inhibition = 1 − gastricInhibitionGain × clamp(duodenum.nutrientExposure, 0, 1)
emptyingRate = 原速率 × inhibition（各餐型分别缩放，不改变队列结构）
```

参数 `stomach.gastricInhibitionGain = 0.5`（design）。暴露为 0 时与现有轨迹逐点一致。

### `stomachGhrelin`

```text
suppression = distensionGain × stomachSensory.mechanical
            + nutrientGain × duodenum.nutrientExposure
            + intakeGain × 本轮摄入能量 / referenceIntakeKcal
target = 原目标 − suppression（再按既有半时恢复/上升，钳到原上下限）
```

参数 `stomachGhrelin.distensionGain = 0.3`、`nutrientGain = 0.3`、`intakeGain = 0.4`、`referenceIntakeKcal = 250`（均 design）。无摄入且无暴露时行为不变。

### `smallIntestine`

```text
waterFactor = 1 − waterAbsorptionDehydrationFactor × clamp(bodyFluid.waterDeficit, 0, 1)
carbFactor = 1 + carbAbsorptionInsulinGain × (pancreasEndocrine.insulinRelative − 1)
           + carbAbsorptionGradientGain × (glucose.concentrationMgDl / baselineMgDl − 1)
waterAbsorption = 原水吸收 × waterFactor
carbAbsorption = 原碳水吸收 × carbFactor
```

参数 `smallIntestine.waterAbsorptionDehydrationFactor = 0.5`、`carbAbsorptionInsulinGain = 0.2`、`carbAbsorptionGradientGain = 0.2`（均 design）。`bodyFluid`/`glucose`/`pancreasEndocrine` 未加载按原速率；已加载但字段非法抛错。

## 清单与计数

无新部位、无新参数文件以外的变化（三份既有参数文件各加对应键），根/女性清单计数不变。旧档行为不变（无暴露/无亏缺/基线胰岛素时与原轨迹逐点一致）。

## 验收与未验证

- 单元：高暴露时排空减慢、ghrelin 随扩张/营养/剂量抑制、脱水时水吸收下降、胰岛素升高时碳水吸收上升、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：餐后 `duodenum.nutrientExposure` 上升后胃排空放慢、ghrelin 回落；预置脱水存档水吸收下降；血糖升高伴胰岛素升高时碳水吸收增加；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：肠抑胃反射实测、ghrelin 剂量曲线、吸收率实测、独立生理数据、真实 DSH 会话、临床验证、现有部位性能。
