# 甲状旁腺与血钙薄切片设计

日期：2026-11-24
状态：owner 指定"甲状旁腺 → 血钙"。血钙必须有扰动源才有动力学，本切片以骨钙库与肾钙排泄为两端，PTH 居中调节。

## 目标与边界

新增 `parathyroid`（PTH 分泌）与 `bloodCalcium` 隔室（血钙水平），`bone` 仅作钙库（不是骨密度/骨折模型）：

- `bloodCalcium` 低 → `parathyroid.pthRelative` 升 → 骨钙释放增加、肾钙重吸收增加 → 血钙回升；
- `bloodCalcium` 高 → PTH 降 → 骨钙沉积、肾钙排泄增加（经 `blood.gfrMlMin`）→ 血钙回落；
- 血钙偏离 → `interoception` 低钙/高钙症状读数（麻木、痉挛代理）。

本步不建维生素 D、肠道钙吸收、骨密度/骨折/骨代谢病、绝对钙浓度测量、钙磷乘积、甲状腺 C 细胞降钙素。数值全部 `design`、`source: null`。

## 部位与公式

### `parathyroid`（`organs/human-organs/parathyroid/parathyroid.ts`）

```text
pthTarget = clamp(1 + pthGain × (referenceCalciumMgDl − bloodCalciumMgDl), 0, 3)
pthRelative = pthTarget + (prevPth − pthTarget) × 2^(−dtMin / 15)
```

读轮初 `bloodCalcium.mgDl`（未加载按参考值 9.5）。参数 `parathyroid.referenceCalciumMgDl = 9.5`、`pthGain = 0.5`（design）。

### `bloodCalcium`（`organs/human-compartments/calcium/calcium.ts`）

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `mgDl` | `mg/dL` | 血钙浓度 |
| `boneStoreG` | `g` | 骨钙库（g） |

```text
release = pthRelative > 1 ? min(boneReleaseRateGPerMin × (pthRelative − 1) × dtMin, boneStoreG) : 0
deposit = pthRelative < 1 ? boneDepositRateGPerMin × (1 − pthRelative) × dtMin : 0
excretion = blood.gfrMlMin × calciumExcretionPerMlG × dtMin
boneStoreG = clamp(boneStoreG − release + deposit, 0, boneCapacityG)
mgDl = clamp(prev.mgDl + (release − deposit − excretion) / distributionVolumeDl / 1000, 0, 20)
```

参数（`calcium.parameters.json`，均 design/null）：`calcium.referenceMgDl = 9.5`、`boneStoreInitialG = 100`、`boneCapacityG = 200`、`boneReleaseRateGPerMin = 0.01`、`boneDepositRateGPerMin = 0.01`、`calciumExcretionPerMlG = 0.0001`、`distributionVolumeDl = 140`。

`blood` 未加载时按 `gfr = 100`；`parathyroid` 未加载时 PTH 按 1。`interoception` 新增 `hypocalcemiaMm = clamp(50 × (9.5 − bloodCalcium.mgDl), 0, 100)` 与 `hypercalcemiaMm = clamp(50 × (bloodCalcium.mgDl − 9.5), 0, 100)`（`bloodCalcium` 未加载按 0）。

## 清单与计数

根清单 33 部位、35 份参数；女性清单 35 部位、37 份参数（在循环切片基础上）。无新 transfer，硬闭包不变。旧档缺 `parathyroid` / `bloodCalcium` / `bone` 由 `initialState` 补基线（PTH 1、血钙 9.5、骨钙库 100）。

## 验收与未验证

- 单元：低血钙时 PTH 升高、骨钙释放增加、血钙回升；高血钙时 PTH 下降、沉积与排泄增加；GFR 改变影响排泄；缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：预置低血钙 → PTH 升、骨钙库下降、血钙回升、`hypocalcemiaMm` 下降；预置高血钙 → 排泄增加、血钙回落；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：实测血钙/PTH、独立生理数据、真实 DSH 会话、临床验证、33 部位性能。
