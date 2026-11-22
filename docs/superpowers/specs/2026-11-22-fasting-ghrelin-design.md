# 空腹饥饿素上升设计

**状态：已批准（2026-11-22）。**

## 1. 问题与目标

当前 `stomachGhrelin` 只在含能摄入后压低相对浓度，随后向 `fasting.baseline = 1` 恢复；没有含能摄入时不会继续上升。空胃且 `G = 1` 时，`interoception.hunger = 50 mm`，低于 65/85 mm 提醒线。实际模块复现 1200 轮后仍为 `G = 1`、`hunger = 50`、通知 0。

目标是让长期无含能摄入的身体逐步进入明显、强饥饿档，同时：

- 新身体和旧存档升级时不立即误报；
- 含能 `eat` / `drink` 重置空腹过程；纯水和零能量摄入不重置；
- 保持单写者、轮初快照和现有提醒阈值；
- 不把工程参数说成人体测量或已验证曲线。

## 2. 方案取舍

**选择：在 `stomachGhrelin` 内记录距上次含能摄入的分钟数，并驱动相对浓度饱和上升。** 下游仍只读 `relativeConcentration`，无需复制动作解析，激素信号与体感保持一致。

不采用以下方案：

- 调大 `hungerGhrelinGain`：`G = 1` 时该项为零，无效。
- 降低提醒线：会在启动或旧档升级时误报，没有解决缺失的空腹过程。
- 在 `interoception` 记录空腹时长：破坏其无自身历史的纯读出契约，并重复解析摄入动作。
- 复用 `stomach.lastIntakeAt`：白水也会刷新它，且会引入跨部位依赖。

## 3. 状态与方程

`stomachGhrelin` 新增字段：

```text
minutesSinceEnergyIntake: min，absolute，初值 0
```

该字段只由 `ghrelin.ts` 写入。使用 `io.dt` 累加，不使用墙钟，不读取 `stomach.lastIntakeAt`。

设 `dtMin = io.dt / 60`，`t` 为轮初空腹分钟数，`c` 为轮初相对浓度：

```text
含能摄入：
  t_next = 0
  c_next = min(c, postmeal.nadir)

无含能摄入：
  t_next = t + dtMin
  target = fasting.baseline
         + (fasting.peak - fasting.baseline)
         × (1 - 2^(-max(0, t_next - fasting.rise.onsetMin)
                         / fasting.rise.apparentHalfTimeMin))
  c_next = c + (target - c)
         × (1 - 2^(-dtMin / recovery.apparentHalfTimeMin))
```

有限且 `energyKcal > 0` 的 `eat` / `drink` 都算含能摄入；纯水、零能量及非法能量值不重置。摄入轮只抑制和清零，不同时执行上升。

## 4. 工程参数与预期行为

保留现有 `fasting.baseline = 1`、`postmeal.nadir = 0.5`、`recovery.apparentHalfTimeMin = 90`。新增：

| 参数 | 默认值 | 单位 | 状态 |
| --- | ---: | --- | --- |
| `stomachGhrelin.fasting.peak` | 1.8 | `1` | `design` |
| `stomachGhrelin.fasting.rise.onsetMin` | 180 | `min` | `design` |
| `stomachGhrelin.fasting.rise.apparentHalfTimeMin` | 120 | `min` | `design` |

这些值只定义可解释的工程曲线，不是人体标定。180 min 的起始延迟保留现有餐后恢复窗口，因此现有“从 0.5 经 90 min 恢复到 0.75”等早期行为不变。

在胃机械和营养输入为 0 时，一次性方程试算得到：

- 约 6.3 h 达到 `hunger = 65 mm` 明显档；
- 约 12.1 h 达到 `hunger = 85 mm` 强档；
- 20 h 时约为 `G = 1.80`、`hunger = 90 mm`，随后饱和，不继续无界增长。

这些是设计目标，不是临床阈值或论文结果。实际通知还需要已有会话，并受档位、冷却和配额约束；无会话时不保证通知。

## 5. 存档兼容与边界

- 旧存档缺少 `minutesSinceEnergyIntake` 时，由 `initialState` 补 0；保留原 `relativeConcentration`，从升级时刻重新累计，不反推过去空腹时长。
- 因此旧档升级第一轮不会凭空出现高饥饿；后续重启保留该字段，不反复清零。
- 不根据 `stomach.lastIntakeAt`、存档 `simulatedSeconds` 或当前浓度猜迁移历史。
- 继续不建模餐时表、昼夜节律、餐前预期、能量剂量响应、多日饥饿适应和能量不足病理。
- 任何正能量摄入仍按现有假设在当轮压到不高于谷值；本次不扩展零食剂量模型。

## 6. 证据边界

Cummings 2001 只支持餐前上升、餐后下降的方向；其“约 2 倍”参照不是本模型的 `G = 1`，固定餐时观察也不能分离空腹时长、餐前预期和昼夜节律。Leone 2022 只支持餐后下降方向。

因此，时间驱动、起始延迟、峰值和时间常数全部为 `design`、`source: null`。不得把 `peak = 1.8` 解释为论文“两倍”的换算，也不得声称 20 h 曲线已验证。

## 7. 验收与文档

- 模块测试：起始阶段不上升；onset 后上升并饱和；20 h 达到强档所需浓度；含能摄入清零并抑制；纯水/零能量不重置；旧状态缺字段从 0 开始；既有早期恢复断言保持不变。
- 下游测试：强饥饿跨档产生 `wake`，冷却仍生效；不改现有 65/85/40 mm、45 min 和配额。
- 真实根清单 Gateway：绑定会话后运行 1200 轮，无含能摄入时至少产生饥饿提醒且 20 h 达到强档；再用含能饮料验证回落和复位。补旧存档缺字段加载验收。
- 同步更新 `ghrelin.ts` 头注释、胃/脑 README 和参数表；在原器官模型设计的“不建模餐前上升”处标注本设计扩展了该边界。开发指南只有在当前行为描述需要时才修改。
- 实施后运行一次完整 `npm test`；20 h Gateway 验收只证明本设计契约，不提升证据等级。
