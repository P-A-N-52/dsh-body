# 性行为与性反应周期薄切片设计

日期：2026-11-23
状态：owner 明确要求加入"性行为定义"；动作形态、部位与消费者链为主代理按"没有消费者的差异不建模"选定。

## 目标与边界

给"性行为"一个可计算的生理定义：新动作 `sex { durationMin, intensity }` 与性别中立部位 `sexualResponse`，覆盖两件事——**强度 × 时长的体力消耗**与**兴奋 / 平台 / 高潮 / 消退 / 不应期的反应周期**。消费者两条：

1. `sex` 计入 `physicalActivity`（性活动是体力活动），走现有的汗液、运动呼吸失水与肌糖原消耗链；
2. `interoception` 软读 `sexualResponse.arousalMm`，输出新的体感读数 `sexualArousalMm`（与 `discomfort` 一样只进 `body_state`，不发通知、不进 discomfort）。

本步不建催产素 / 催乳素 / 内啡肽（无消费者）、心率 / 血压 / 通气量、受孕 / 妊娠 / 生育力窗（需要另一套生育模型，另起一刀）、性欲或情绪行为、伴侣与性病 / 避孕、任何显性内容。数值全部 `design`、`source: null`，不是人体测量。

## 方案比较

- **只加动作不建状态（不做）。** 没有消费者，等于在动作日志里写标签。
- **反应周期 + 体力消耗（采用）。** 既有可读的生理状态，又复用已验收的活动—失水—糖原链，最小且每条路都有消费者。
- **激素通路（不做）。** 没有部位读取这些激素，违反建模约束。

## 动作契约

`body_act` 增加 `sex`，载荷与校验同 `exercise`：`intensity` 有限且 `(0, 1]`，`durationMin` 有限且 `> 0`。非法动作被忽略，不改变状态。`physicalActivity.actionTypes` 变为 `['exercise', 'sex']`，两类都按同一校验计入剩余活动，最后一条合法动作替换（与现行"最后有效动作"策略一致）；没有 `sex` 动作时 `physicalActivity` 行为与现状逐点一致。

`body_act` 另增加 `orgasm`，**无载荷**：只在轮初 `arousalMm >= orgasmAllowedMm` 时生效，低于阈值被忽略、不改状态。这是继 `urinate` 之后第二个允许 LLM 主动触发的输出。

**LLM 介入原则（design）：** LLM 只控制输入（`drink` / `eat` / `urinate` / `exercise` / `sex` / `orgasm` 等动作），不直接写身体状态；只有少数输出允许主动触发（`urinate`、`orgasm`），且都有非自主兜底——膀胱 >600 mL 非自主排空、唤醒 ≥ `orgasmForcedMm` 强制高潮。

## 部位与参数

`sexualResponse`（`organs/human-organs/sexual-response/response.ts`），无 transfer、无性别差异、根清单与女性清单都注册。

| 字段 | 单位 | mode | 含义 |
| --- | --- | --- | --- |
| `arousalMm` | `mm` | absolute | 唤醒代理 0–100，不是生理测量 |
| `phase` | `-` | absolute | `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution` |
| `remainingSexMin` | `min` | absolute | 本轮剩余的性活动分钟 |
| `sexIntensity` | `1` | absolute | 模型内相对强度 0–1，不是 MET |
| `lastOrgasmAtSimMin` | `min` | absolute | 最近一次高潮的仿真分钟，从未发生为 `null` |

每轮（读自身 prev 与本轮原始动作；`dtMin = io.dt / 60`，`simMin = io.simulatedSeconds / 60`）：

```text
remainingSexMin = max(0, prev.remainingSexMin − dtMin)，新 sex 动作用 durationMin/intensity 替换
active = remainingSexMin > 0 && sexIntensity > 0
sinceOrgasm = lastOrgasmAtSimMin === null ? Infinity : simMin − lastOrgasmAtSimMin
refractory = sinceOrgasm < refractoryMin
target = active && !refractory ? 100 × sexIntensity : 0
halfTime = target > prevArousal ? arousalHalfTimeMin : resolutionHalfTimeMin
arousalMm = target + (prevArousal − target) × 2^(−dtMin / halfTime)

release（高潮，两条路径，用轮初 arousalMm 判定）：
  主动：本轮有 orgasm 动作且 prevArousal >= orgasmAllowedMm（70）
  强制：prevArousal >= orgasmForcedMm（95），无需动作
  任一成立 → lastOrgasmAtSimMin = simMin（每轮最多记一次）
  主动动作在 prevArousal < orgasmAllowedMm 时被忽略，不改状态
phase = sinceOrgasm < orgasmDurationMin ? 'orgasm'
      : refractory ? 'refractory'
      : active ? (arousalMm < 60 ? 'excitement' : 'plateau')
      : arousalMm >= 10 ? 'resolution' : 'rest'
```

参数（`response.parameters.json`，均 `design`、`source: null`）：`sexualResponse.arousalHalfTimeMin = 5`、`resolutionHalfTimeMin = 15`、`orgasmAllowedMm = 70`、`orgasmForcedMm = 95`、`orgasmDurationMin = 1`、`refractoryMin = 20`。分期结构参照一般性反应周期（兴奋/平台/高潮/消退/不应期），无登记来源，数值不是测量或拟合。

`interoception` 新增字段 `sexualArousalMm`（`mm`、`absolute`）：`clamp(finiteOr(io.read('sexualResponse')?.arousalMm, 0), 0, 100)`；`sexualResponse` 未加载 / 缺失 / NaN 按 0，根清单无该部位时读数恒 0；既有五路与 `discomfort` 不变。

## 清单与计数

根清单 20 部位、22 份参数；女性清单 22 部位、24 份参数（都新增同一脚本与参数文件）。`package.json` 的 `files` 已含 `organs/`，无需改动。旧档缺 `sexualResponse` 由 `initialState` 补 `arousalMm = 0`、`phase = 'rest'`、两个 0、`lastOrgasmAtSimMin = null`，不反推历史；重启保留在途活动与 `lastOrgasmAtSimMin`。

## 验收与未验证

- 单元：动作校验与替换、兴奋上升、高潮触发并写 `lastOrgasmAtSimMin`、高潮后进入消退、不应期内新动作不提升唤醒、phase 派生、非法动作忽略、JSON-safe（含 `null` 往返）。
- `physicalActivity`：`sex` 计入剩余活动，与 `exercise` 同一替换策略，无 `sex` 时旧断言不变。
- `interoception`：`sexualArousalMm` 软读与缺省 0，既有五路不变。
- 真实 Gateway：`sex` 动作后唤醒上升、汗/呼吸失水/肌糖原出现对应通量、`sexualArousalMm` 读出；`body_act` schema 含 `sex` 且不放宽既有校验；根 20/22、女性 22/24 计数。
- 最终 `npm test` 与 `git diff --check`。

未验证：生理测量、独立数据、真实 DSH 会话、临床验证、20 部位性能。
