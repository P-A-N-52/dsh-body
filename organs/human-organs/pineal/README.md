# 松果体（pineal）：昼夜褪黑素相对信号

**功能标签：** 内分泌（昼夜节律薄切片）。

`pineal/` 目前只有一个部位 `pineal`，脚本为 [`melatonin.ts`](melatonin.ts)，没有动作、通知或 `transfer`。它通过 `lib/circadian.js` 按本地时钟 `io.wallTimeMs`（未传入时回退 `io.simulatedSeconds`）计算内源 SCN 生物夜昼夜曲线（当地 02:00 峰值 1.8、14:00 谷值 0.2），并在加载 `sleep` 部位时结合当前清醒/闭眼入睡状态与日光/室内人工光照代理施加 Zeitzer 2000 方向（`SRC-ZEITZER-2000`）的 logistic 光照抑制及 `autonomic.sympatheticMm` 高交感压低；若 Body 未加载 `sleep`（纯孤立测试），则保持纯时钟 SCN 曲线。消费者是 `interoception.sleepinessMm` 与 `sleep` 自然转醒门控及分期深睡参考。

实现状态：脚本、参数与模块契约测试已落地；根清单为 41 部位、37 份唯一参数文件，女性清单为 44 部位、40 份，男性清单为 43 部位、39 份；本切片不新增 `transfer`，硬闭包为根/男性 15 / 女性 17 个部位。10 项参数中 `pineal.responseHalfTimeMin = 39.4 min`（参考 `SRC-DIJK-1995` 清醒光照/遮蔽后褪黑素变化速率尺度）与 `pineal.photicHalfMaxLux = 100 lx`（`SRC-ZEITZER-2000` 方向锚点）均保留 `design` 口径；无历史（单元测试隔离首轮）时直接取光照调节稳态目标，存在 `prev.melatoninRelative` 时按 `39.4 min` 半衰期一阶平滑趋近目标。本文只描述离线模型与契约，未做真实 DSH 会话、褪黑素实测或睡眠验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `melatonin.ts` | `pineal` | `melatoninRelative` | `io.wallTimeMs`（回退 `io.simulatedSeconds`）；可选 `sleep.sleeping`、`autonomic.sympatheticMm` | `melatonin.parameters.json` |

- `actionTypes = []`；不读动作，不调用 `transfer` / `notify`。
- 停机重启后随 `io.wallTimeMs`（或 `profile.timezoneOffsetMin`）立即重新对齐当地昼夜相位，无 `resetOnStart` 字段。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `melatoninRelative` | `1` | 褪黑素相对量，0–2；1 是工程基线。不是血浆/唾液褪黑素浓度（`pg/mL`、`pmol/L`）、实测照度（`lx`）或睡眠测量 |

初值 `{ melatoninRelative: 1 }`；字段是 `absolute`。输出钳在 `[0, 2]`，有限且 JSON-safe。

## 3. 方程与参数

```text
hour = resolveCircadianHour(io.wallTimeMs, { periodHours, phaseShiftHours })
circadianCurve = clamp(baseRelative + amplitudeRelative × cos(2π × (hour − peakHour) / periodHours), 0, 2)
// 加载 sleep 时结合自然日光与夜间室内人工光照门控：
solarLux = daytime ? daylightPeakLux × sin(π × (hour − 6.5) / 12) : 0
retinalLux = sleep.sleeping ? solarLux × eyelidTransmittance : max(solarLux, awakeNightRoomLux)
photicSuppression = retinalLux / (retinalLux + photicHalfMaxLux)
sympatheticFactor = 1 − 0.35 × clamp(sympatheticMm, 0, 100) / 100
target = clamp(minFloor + max(0, circadianCurve − minFloor) × (1 − photicSuppression) × sympatheticFactor, 0, 2)
// 若存在 prev.melatoninRelative：以 responseHalfTimeMin = 39.4 min 一阶趋近 target（dtMin <= 0 保持 prev）
melatoninRelative = prev?.melatoninRelative 有限
  ? clamp(target + (prev.melatoninRelative − target) × 2^(−dtMin / responseHalfTimeMin), 0, 2)
  : target
```

默认参数下（以 `sleep` 加载为例）：当地 02:00 闭眼熟睡向峰值 `1.8` 平滑趋近（不再因开关灯单步阶跃）；14:00 处谷值 `0.2`。

同目录参数（`owner: pineal`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `pineal.melatoninBaseRelative` | 1 | `1` | `design` | `source: null`；昼夜曲线的工程基线 |
| `pineal.melatoninAmplitudeRelative` | 0.8 | `1` | `design` | `source: null`；余弦振幅（峰值 1.8、谷值 0.2） |
| `pineal.melatoninPeakHour` | 2 | `h` | `design` | `source: null`；内源 SCN 生物夜峰值当地钟点（02:00） |
| `pineal.melatoninPeriodHours` | 24 | `h` | `design` | `source: null`；固定 24 h 昼夜周期 |
| `pineal.phaseShiftHours` | 0 | `h` | `design` | `source: null`；相对本地钟点的个体相位偏移（小时） |
| `pineal.photicHalfMaxLux` | 100 | `lx` | `design` | `SRC-ZEITZER-2000`（仅借半数抑制约 ~100 lx 量级方向，曲线代理仍为 `design`） |
| `pineal.awakeNightRoomLux` | 120 | `lx` | `design` | `source: null`；夜间清醒时默认室内人工照度代理 |
| `pineal.daylightPeakLux` | 1000 | `lx` | `design` | `source: null`；正午自然日光环境照度代理峰值 |
| `pineal.eyelidTransmittance` | 0.05 | `1` | `design` | `source: null`；闭眼睡眠眼睑透光比例 |
| `pineal.responseHalfTimeMin` | 39.4 | `min` | `design` | `SRC-DIJK-1995`（方向参考 Dijk 1995 光暗切换时程，避免单轮阶跃；具体一阶形式仍为 `design`） |

## 4. 消费者与读数

| 消费者 | 读什么 | 用途 |
| --- | --- | --- |
| `interoception` | `melatoninRelative` | 未加载 `brain/sleep.ts` 时按纯 `pineal` 公式 `sleepinessMm = clamp(100 × (melatoninRelative − 0.2) / 1.6, 0, 100)`；加载 `sleep` 后与 `sleep.sleepPressureMm` 联合计算 `clamp(0.4 × melatoninMm + 0.8 × sleepPressureMm, 0, 100)`；未加载、缺失或非有限时按 0 |

`sleepinessMm` 不进入 `discomfort`，现已进入 `brainNotify`（睡眠期间普通通知受抑）与纯定性 `body_state`；纯 `pineal` 项在 02:00 附近为 100、08:00 为 50、14:00 为 0。褪黑素本身只通过这个读数被消费，不直接改体温、心率、血压、血糖、活动或胃排空。

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
- 睡眠分期、昼夜偏好、体温与心率节律；`pineal` 自身不建睡眠压力或自动入睡行为（睡眠状态与清醒睡眠压力由 `brain/sleep.ts` 独立建模）。
- 松果体钙化、肿瘤、褪黑素受体与免疫/生殖效应。

**未验证：** 没有褪黑素昼夜节律实测、光照实验、独立数据、临床验证或真实 DSH 会话验收。曲线形状、相位、振幅与固定 24 h 周期全是 `design`、`source: null` 的工程假设；02:00/14:00 的峰谷只是模型内约定，不是人体测量。本切片未做 38 部位性能实测。

## 7. 证据入口

- 设计：[`2026-11-24-endocrine-axes-design.md`](../../../docs/superpowers/specs/2026-11-24-endocrine-axes-design.md)
- 模块契约测试：[`test/organs.pineal.test.mjs`](../../../test/organs.pineal.test.mjs)
- 真实 Gateway 昼夜测试：[`test/organs.endocrine-gateway.test.mjs`](../../../test/organs.endocrine-gateway.test.mjs)
- 体感消费者：[`brain`](../brain/README.md)
