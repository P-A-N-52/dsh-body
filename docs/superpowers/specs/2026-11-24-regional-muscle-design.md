# 分区骨骼肌（头 / 躯干 / 四肢）设计

日期：2026-11-24
状态：owner 要分区骨骼肌，且要支撑"独臂角色"这类缺失部位的预设。区域必须是可独立加载的部位，而不是一个部位里的子字段。

## 目标与边界

把现有单一 `muscleGlucose` 的糖原储存与消耗拆成区域部位：`muscleHead`（头颈）、`muscleTrunk`（躯干）、`muscleLimbs`（四肢）。`muscleGlucose` 保留为**聚合器**：接收 `glucose` 的摄糖结算后，按区域质量份额经 transfer 分配（与 `bodyFluid` 往多个出口分水同一模式）。区域部位各自持有糖原、按轮初活动消耗。

缺失区域的预设（如独臂）通过**变体清单**实现：聚合器只声明存在的区域出口，份额按存在区域重新归一。不做 `presets/` 字段或 condition 概念（沿用 DI 变体先例）。

本步不做肌群疲劳/延迟酸痛（M4 后续）、左右小腿与皮肤分区（owner 明确不需要皮肤分区）、肌肉绝对质量、MET、运动类型。数值全部 `design`、`source: null`。

## 方案比较

- **一个部位三个糖原子字段（不做）。** 预设无法只关掉一个字段，且违背"区域可独立加载"。
- **聚合器 + 区域部位（采用）。** 每个区域是独立部位、可被清单单独启停；聚合器沿用现有摄糖请求—结算，区域继承现有糖原消耗逻辑，迁移路径清晰。

## 部位与公式

### 聚合器 `muscleGlucose`

```text
totalUptake = 按现有 muscleGlucose.uptakeRequestG 结算后的到账量
按区域份额 fractions = { head: 0.05, trunk: 0.45, limbs: 0.50 }
对每个已注册区域 region：
    transfer muscleGlucose.uptakeG → muscle{Region}.uptakeG: totalUptake × fractions[region] / Σ(已注册区域份额)
```

`muscleGlucose.uptakeG.transferOut` 按变体声明存在的区域目标；缺区域时启动不因目标缺失失败，因为变体只声明存在的目标（DI 变体写法）。

### 区域部位（`organs/human-organs/skeletal-muscle/regions/{head,trunk,limbs}.ts`）

每个区域字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `uptakeG` | `g` | 本轮区域摄糖到账，仅 `transferIn: ['muscleGlucose.uptakeG']`，每轮 write 归 0 |
| `glycogenG` | `g` | 区域糖原储量 |
| `glycogenConsumedG` | `g` | 本轮运动消耗 |

```text
uptake = prev.uptakeG
consumed = physicalActivity.remainingExerciseMin > 0
  ? min(glycogenUseRateGPerMin × intensity × dtMin, max(0, prev.glycogenG) + uptake) : 0
glycogenG = max(0, prev.glycogenG) + uptake − consumed
write { uptakeG: 0, glycogenG, glycogenConsumedG: consumed }
```

区域参数共享 `muscleGlucose.glycogenUseRateGPerMin = 0.5`（沿用现有参数文件，不新增区域参数）。`physicalActivity` 未加载时消耗 0；非法活动字段抛错。

## 旧档迁移

旧档只有 `muscleGlucose.glycogenG`（总量）时，按份额把总量分配到各区域初值（头 0.05 / 躯干 0.45 / 四肢 0.50），`muscleGlucose` 不再持有总量；在途 `uptakeG` 保留，下一轮按份额分配。这样老身体的糖原不丢失，也不需要重写历史。

## 独臂类预设（后续清单变体示例）

缺失 `muscleLimbs` 的变体清单：聚合器只声明 `muscleHead`、`muscleTrunk` 两个出口，份额归一为 0.05/0.45 → 约 0.1/0.9；活动消耗只发生在存在区域。更细的左右臂/左右腿拆分留给后续 M4（疲劳与伤病分区），本期不做。

## 验收与未验证

- 单元：聚合分配与归一、缺区域变体不报错、区域糖原入账与消耗、旧档按份额迁移、非法上游抛错、JSON-safe。
- 真实 Gateway：餐后各区域糖原按份额上升、运动消耗发生在各区域、总量账与旧单部位一致；独臂变体无 `muscleLimbs` 时仍启动且分配归一；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：区域肌肉质量分布实测、独立生理数据、真实 DSH 会话、临床验证、分区后部位性能。
