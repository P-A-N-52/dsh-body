# 松果体（pineal）：昼夜褪黑素相对信号

**功能标签：** 内分泌（昼夜节律薄切片）。

`pineal/` 目前只有一个部位 `pineal`，脚本为 `melatonin.ts`，没有动作、通知或 `transfer`，也不读其他部位。它按仿真时刻计算 `melatoninRelative`（褪黑素相对量，0–2，1 为工程基线）：02:00 峰值 1.8、14:00 谷值 0.2。消费者是 `interoception.sleepinessMm`；本切片只提供 0–100 mm 困倦读数，不建睡眠行为、睡眠压力或光照抑制。曲线完全由 `io.simulatedSeconds` 驱动，不读现实时间。

实现状态：脚本、参数与模块契约测试已落地；根清单为 28 部位、30 份参数文件，女性清单为 30 部位、32 份；本切片不新增 `transfer`，硬闭包仍为根 10 / 女性 11 个部位。四个参数全部 `design`、`source: null`，没有登记人体来源。本文只描述离线模型与契约，未做真实 DSH 会话、褪黑素实测或睡眠验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `melatonin.ts` | `pineal` | `melatoninRelative` | `io.simulatedSeconds`（本轮结束的仿真时刻）；不读自身或其它部位 | `melatonin.parameters.json` |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- 不读自己的上一轮状态；每轮按仿真时刻重算，状态只用于 `body_state` 读出与旧档补键，不参与下一轮计算。
- 重启后不按现实时间补算相位；`simulatedSeconds` 从存档继续，曲线也继续。本部位没有 `resetOnStart` 字段。
- 时间原点：`hour = 0` 是仿真起点，不是本地钟点。同一仿真时刻在任意真实时间运行得到相同结果。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `melatoninRelative` | `1` | 褪黑素相对量，0–2；1 是工程基线。不是血浆/唾液褪黑素浓度（`pg/mL`、`pmol/L`）、分泌率、光照剂量或睡眠测量 |

初值 `{ melatoninRelative: 1 }`；字段是 `absolute`。初值只用于旧档或首轮补键；第一次 heartbeat 后按仿真时刻重算，不保留 1。输出钳在 `[0, 2]`，有限且 JSON-safe。

## 3. 方程与参数

```text
hour = (io.simulatedSeconds / 3600) % periodHours
melatoninRelative = clamp(
  baseRelative + amplitudeRelative × cos(2π × (hour − peakHour) / periodHours),
  0,
  2,
)
```

默认参数下：

| 仿真时刻 | `melatoninRelative` |
| --- | ---: |
| 02:00 | 1.8（峰值） |
| 08:00 | 1.0（中点） |
| 14:00 | 0.2（谷值） |
| 20:00 | 1.0（中点） |

曲线是固定余弦，不做自由运行周期、相位漂移、光照抑制、时差或年龄修正。

同目录参数（`owner: pineal`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `pineal.melatoninBaseRelative` | 1 | `1` | `design` | `source: null`；昼夜曲线的工程基线，不是人体褪黑素测量或绝对浓度。`range` 只是工程调参范围 |
| `pineal.melatoninAmplitudeRelative` | 0.8 | `1` | `design` | `source: null`；余弦振幅，与基线相加得到峰值 1.8、谷值 0.2。不是实测昼夜节律幅度 |
| `pineal.melatoninPeakHour` | 2 | `h` | `design` | `source: null`；峰值所在的仿真时刻（以仿真起点为 0 时），不是本地钟点或个体相位 |
| `pineal.melatoninPeriodHours` | 24 | `h` | `design` | `source: null`；固定 24 h 周期，未建自由运行周期或时差。`range` 只是工程调参范围 |

## 4. 消费者与读数

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| `interoception` | `melatoninRelative` | `sleepinessMm = clamp(100 × (melatoninRelative − 0.2) / 1.6, 0, 100)`；未加载、字段缺失或非有限时按 0 |

`sleepinessMm` 只是 0–100 mm 困倦代理：02:00 附近为 100、08:00 为 50、14:00 为 0。它不进入 `discomfort`，`brainNotify` 不读它，也没有睡眠提醒或自动入睡动作。褪黑素本身只通过这个读数被消费，不直接改体温、心率、血压、血糖、活动或胃排空。

读取存在一轮滞后：第 N 轮 `pineal` 写出按 `io.simulatedSeconds` 计算的褪黑素；第 N+1 轮 `interoception` 才读到它。因曲线连续变化，60 s 轮下一次滞后对读数影响很小，但不是零。

## 5. 旧档、重启与异常

- **旧档缺 `pineal`：** 启动时补 `melatoninRelative = 1`；第一轮按当时仿真时刻重算，不反推历史褪黑素或睡眠。
- **重启：** 保留已提交值，但下一轮立即按存档的 `simulatedSeconds` 重算；曲线从仿真时钟接续，不按现实时间重算，也不读取停机期间的真实钟点。本部位没有 `resetOnStart` 字段。
- **异常：** 本部位没有外部输入字段；参数在 import 时经 `lib/parameters.js` 校验，缺失或 `unset` 时启动失败。计算只使用有限的 `simulatedSeconds` 与参数，输出再钳到 `[0, 2]`。
- **无消费者时：** 未加载 `pineal` 的清单中，`interoception.sleepinessMm` 按 0 回退；根清单同时加载两者。

## 6. 未建模与未验证

**未建模：**

- 光照（强度、波长、时序）、夜间光照抑制、蓝光、季节与纬度。
- 自由运行周期、相位漂移、时差、轮班、年龄、性别与个体相位差异。
- 褪黑素绝对浓度、分泌率、代谢清除、 supplement 或药物。
- 睡眠压力、睡眠—觉醒行为、睡眠分期、昼夜偏好、体温与心率节律；`sleepinessMm` 只是读出，不是睡眠驱动力测量，也不会启动睡眠。
- 松果体钙化、肿瘤、褪黑素受体与免疫/生殖效应。

**未验证：** 没有褪黑素昼夜节律实测、光照实验、独立数据、临床验证或真实 DSH 会话验收。曲线形状、相位、振幅与固定 24 h 周期全是 `design`、`source: null` 的工程假设；02:00/14:00 的峰谷只是模型内约定，不是人体测量。本切片未做 28 部位性能实测。

## 7. 证据入口

- 设计：[`2026-11-24-endocrine-axes-design.md`](../../../docs/superpowers/specs/2026-11-24-endocrine-axes-design.md)
- 模块契约测试：[`test/organs.pineal.test.mjs`](../../../test/organs.pineal.test.mjs)
- 真实 Gateway 昼夜测试：[`test/organs.endocrine-gateway.test.mjs`](../../../test/organs.endocrine-gateway.test.mjs)
- 体感消费者：[`brain`](../brain/README.md)
