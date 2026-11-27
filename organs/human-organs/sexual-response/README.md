# 性反应周期（sexual-response）：性别分化唤醒、排卵增幅与性后余韵

**功能标签：** 神经、生殖（性反应周期薄切片；支持性别分化）。

`sexual-response/response.ts` 维护 `sexualResponse` 部位，接收 `sex { durationMin, intensity, exertion? }` 与 `orgasm { continueStimulation?: boolean }`，按 `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution` 推进，并输出 `afterglowMm`（高潮后温热余韵，峰值 `80 mm`，22 min 半衰期）及共享纯函数 `evaluateSexualRelease` 与 `resolveEffectiveRefractoryMin` 供 `brain/autonomic.ts`、`brain/reward.ts`、`skeletal-muscle/activity.ts` 与 `uterus/uterus.ts` 在同轮基于轮初快照同步判别高潮。

- **性别分化、周期耦合与低中强度饱和（design）：** 男性（`testes` 加载）与中性身体保留 `refractoryMin = 20 min` 基础不应期，并在 `pituitary.prolactinNgMl > 14 ng/mL` 时温和延长（`+0.5 × (PRL − 14)`，最多 `+15 min`）；女性（加载 `ovaries` 且无 `testes`）取消固定 20 min 绝对不应期，仅保留 `femalePostOrgasmPauseMin = 2 min` 防连跳短停顿，持续刺激可连续唤起与多次高潮，高含 E2 / 排卵窗口对目标与上升速率给出柔和 `[0.9, 1.15]` 正向增益。唤醒稳态目标通过双曲饱和曲线（`stimulusHalfSaturation = 0.022`、`stimulusFloorWeight = 0.77`，潜伏期量级参考 `SRC-LEVIN-1985`，两项形状系数属工程 `design` 占位）使持续温和刺激（如 `intensity = 0.25–0.40`）亦可随时间越过 `70 mm` 门槛，而极微弱试探性接触（`0.05–0.10`）仍停留在门槛下。

**状态口径。** 当前实现：脚本与参数在 `organs/human-organs/sexual-response/`，三份清单均注册同一脚本（根 43 部位 / 39 份唯一参数文件，女性 46 / 42，男性 45 / 41）。10 项参数均标 `design`（含 `stimulusHalfSaturation` 与 `stimulusFloorWeight` 两项工程假设/占位）；PRL 性后饱和方向参考 `SRC-KRUGER-2003`，唤醒潜伏期量级参考 `SRC-LEVIN-1985`；尚未做真实 DSH 会话或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `response.ts` | `sexualResponse` | `arousalMm`、`phase`、`remainingSexMin`、`sexIntensity`、`lastOrgasmAtSimMin`、`afterglowMm`、`lastAttemptedOrgasmAtSimMin`、`lastOrgasmBlockReason` | 自己的轮初状态；轮初 `testes.testosteroneRelative`、`ovaries`（E2/P4）、`pituitary.prolactinNgMl`；`io.actions`；`io.dt`；`io.simulatedSeconds`；`getNsfwSetting()` | `response.parameters.json` |

## 2. 字段与单位

八个字段均 `absolute`（`initialState = { arousalMm: 0, phase: 'rest', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null, afterglowMm: 0, lastAttemptedOrgasmAtSimMin: null, lastOrgasmBlockReason: 'none' }`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `arousalMm` | `mm` | 唤醒代理 0–100 |
| `phase` | `-` | `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution`（女性无固定 20 min 不应期，2 min 后即回 `excitement`/`plateau`/`resolution`） |
| `remainingSexMin` | `min` | 剩余性活动分钟（高潮释放时默认收尾清零，除非 `orgasm.continueStimulation: true` 或本轮后附新 `sex`） |
| `sexIntensity` | `1` | 局部/感官性刺激相对强度 0–1（运动体力负荷由 `sex.exertion` 传入 `physicalActivity`） |
| `lastOrgasmAtSimMin` | `min` | 最近一次释放的仿真分钟，未发生为 `null` |
| `afterglowMm` | `mm` | 高潮触发跃升至 `80 mm` 的性后温热余韵（22 min 半衰期），向 `interoception.hedonicCalmMm` 与 `autonomic` 副交感反弹输出 |
| `lastAttemptedOrgasmAtSimMin` | `min` | 最近一次主动提交 `orgasm` 的仿真分钟（无论成功与否），供受阻通知与 `body_state` 3 min 窗口判定 |
| `lastOrgasmBlockReason` | `-` | `'none' | 'below_threshold' | 'refractory'`；释放成功、唤醒越阈且非不应期或回落 `rest` 时重置为 `'none'` |

## 3. 动作契约与校验

`body_act` 的 `sex` 载荷为 `{ type: "sex", intensity, durationMin, exertion? }`，其中 `intensity` 表示局部/感官性刺激强度，`exertion`（可选，`0 <= exertion <= 1`）供 [`skeletal-muscle`](../skeletal-muscle/README.md) 单独计入全身骨骼肌体力负荷（结构化调用缺省时向后兼容回退 `intensity`）：

- `intensity` 必填、有限且 `0 < intensity <= 1`；
- `durationMin` 必填、有限且 `> 0`；
- `exertion` 可选，提供时须有限且 `0 <= exertion <= 1`；
- 不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`；
- 不接收伴侣、行为类型、体位、性别、避孕或任何内容字段。

非法 `sex`（强度为 0 或超过 1、时长为 0 或负数、NaN、非有限数、字段缺失）被忽略，不改变 `sexualResponse` 的任何字段。模块对已经到达的原始动作再按同一规则校验；工具层拒绝非法载荷，不进入动作队列。

`orgasm` 支持空对象 `{ type: "orgasm" }` 或可选 `{ type: "orgasm", continueStimulation?: boolean }`，不接受 `intensity`、`durationMin`、`phase` 或 `lastOrgasmAtSimMin`。它只在 `!refractory && prev.arousalMm >= orgasmAllowedMm = 70` 时生效：释放当轮会把自身 `remainingSexMin` / `sexIntensity` 与 [`physicalActivity`](../skeletal-muscle/README.md) 配对计时默认清零（避免高潮后继续挂着刺激倒计时引发反弹），若明确传 `continueStimulation: true` 或同轮后随新 `sex` 则保留后续刺激以便女性连续高潮；若轮初唤醒低于 70 或正处不应期，`sexualResponse` 会记录 `lastAttemptedOrgasmAtSimMin` 与 `lastOrgasmBlockReason`（`'below_threshold'` / `'refractory'`），由 `brainNotify` 发射边沿 `context` 反馈并在 `body_state` 3 min 窗口内解释原因，而不强制推进高潮。

**高潮由模型判定，LLM 只能提交请求。** LLM 只控制输入（`drink` / `eat` / `urinate` / `exercise` / `sex` / `orgasm` 等动作），不直接写 `arousalMm`、`phase` 或 `lastOrgasmAtSimMin`。只有少数输出允许主动触发：`urinate` 与 `orgasm`；两者都有非自主兜底——膀胱 >600 mL 时非自主排空，唤醒 ≥95 mm 时强制释放。`orgasm` 动作低于 70 mm 被忽略，≥95 mm 时即使没有动作也会释放；这是模型判定，不是调用方宣布。

同一轮有多条合法 `sex` 时，按到达顺序处理，后一条用自身的 `durationMin` / `intensity` 替换前一条；后面的非法动作不会覆盖此前的合法值。同一轮存在多条 `orgasm` 动作时也只释放一次。`sex` 与 `exercise` 同轮时，`physicalActivity` 也按“最后一条合法动作替换”处理，两类动作互相替换，不累加时长；`orgasm` 不参与这条替换。

## 4. 状态机与方程

设轮初自身状态为 `prev`（`prevArousal = prev.arousalMm`），`dtMin = io.dt / 60`，`simMin = io.simulatedSeconds / 60`：

```text
remainingSexMin = max(0, prev.remainingSexMin − dtMin)
本轮合法 sex 动作：remainingSexMin = durationMin，sexIntensity = intensity

active = remainingSexMin > 0 && sexIntensity > 0
sinceOrgasmBefore = lastOrgasmAtSimMin === null ? Infinity : simMin − lastOrgasmAtSimMin
refractory = sinceOrgasmBefore < refractoryMin

voluntaryRelease = !refractory && (本轮存在 orgasm 动作) && prevArousal >= orgasmAllowedMm
forcedRelease    = !refractory && prevArousal >= orgasmForcedMm
released         = voluntaryRelease || forcedRelease
if released：lastOrgasmAtSimMin = simMin
if released && orgasm.continueStimulation !== true && 后无新 sex：
  remainingSexMin = 0，sexIntensity = 0

hormoneFactor = testes 已加载 ? (0.5 + 0.5 × max(0, testes.testosteroneRelative))
              : ovaries 已加载 ? clamp(1 + 0.12 × (E2 − 140) / 800 − 0.08 × P4 / 42, 0.9, 1.15)
              : 1
riseSpeedFactor = hormoneFactor > 1 ? hormoneFactor : 1
stimulusTargetFraction = sexIntensity > 0
  ? (stimulusFloorWeight + (1 − stimulusFloorWeight) × sexIntensity)
    × ((1 + stimulusHalfSaturation) × sexIntensity / (sexIntensity + stimulusHalfSaturation))
  : 0
target = active && !refractory && !released
  ? clamp(100 × stimulusTargetFraction × hormoneFactor, 0, 100)
  : 0
stimulusSpeedFactor = 0.95 + 0.05 × sexIntensity
riseHalfTimeMin = arousalHalfTimeMin / max(0.5, riseSpeedFactor × stimulusSpeedFactor)
halfTimeMin = target > prevArousal ? riseHalfTimeMin : resolutionHalfTimeMin
arousalMm   = target + (prevArousal − target) × 2^(−dtMin / halfTimeMin)

sinceOrgasm = lastOrgasmAtSimMin === null ? Infinity : simMin − lastOrgasmAtSimMin
phase = sinceOrgasm < orgasmDurationMin           ? 'orgasm'
      : sinceOrgasm < effectiveRefractoryMin      ? 'refractory'
      : active                                    ? (arousalMm < 60 ? 'excitement' : 'plateau')
      : arousalMm >= 10                           ? 'resolution' : 'rest'
```

- `active` 只要求剩余分钟和强度都大于 0；`sexIntensity = 0` 或剩余分钟为 0 时目标为 0，唤醒按消退半时回落。
- **不应期门控与释放轮清刺激回落：** 两条释放路径都要求 `!refractory`（不应期内既不触发主动 `orgasm` 也不触发强制释放）；释放当轮默认置零 `remainingSexMin` / `sexIntensity` 与 `target = 0`，避免仅因短暂停顿 window 结束后残留 `sex` 计时再次回弹拉高唤醒。
- **温和刺激可越阈的饱和映射（design）：** 通过 `stimulusHalfSaturation = 0.022` 与 `stimulusFloorWeight = 0.77`，`sexIntensity = 0.35` 对应无激素偏移稳态目标约 `81.8 mm`（约 15–17 min 可越过 `70 mm` 门槛），而 `0.05` 微弱试探稳态目标仅 `~55.7 mm`（不越阈）；这是工程占位曲线，待个体/感官分级证据替换。
- **两性激素可选缩放：** 仅当加载 `testes` 时按 `0.5 + 0.5 × testosteroneRelative` 缩放；仅当加载 `ovaries` 且无 `testes` 时按 E2/P4 给 `[0.9, 1.15]` 温和周期调节。

## 5. 参数、消费者与证据

同目录 `response.parameters.json`（10 项 `design`，无 `validated`）：`arousalHalfTimeMin = 5`、`resolutionHalfTimeMin = 15`、`orgasmAllowedMm = 70`、`orgasmForcedMm = 95`、`orgasmDurationMin = 1`、`refractoryMin = 20`、`femalePostOrgasmPauseMin = 2`、`afterglowHalfTimeMin = 22`、`stimulusHalfSaturation = 0.022`（工程占位）、`stimulusFloorWeight = 0.77`（工程占位）。

- `brain/reward.ts`、`brain/autonomic.ts`、`skeletal-muscle/activity.ts`、`uterus/uterus.ts` 与 `sexualResponse` 同轮调用 `evaluateSexualRelease`：一次释放同时引发自主交感脉冲（而后转入副交感余韵反弹）、中枢 `hedonicMm` / `satietyMm` 跃升（高 PRL 持续抑制性冲动）、子宫高潮收缩 `contractionMm`，以及默认结束配对的性活动体力负载。
- `brainNotify` 以会话 `lastOrgasmAtSimMin` 与 `lastAttemptedOrgasmAtSimMin` 分别发射高潮事件通知及受阻原因（`below_threshold` / `refractory`）边沿 `context` 反馈；`body_state` 区分 5 档渐进性唤醒文本并保留 3 min 受阻原因说明。
- 文献笔记：[`references/notes/kruger-2003.md`](references/notes/kruger-2003.md)（`SRC-KRUGER-2003`）、[`references/notes/levin-1985.md`](references/notes/levin-1985.md)（`SRC-LEVIN-1985`）、[`../ovaries/references/notes/roney-2013.md`](../ovaries/references/notes/roney-2013.md) 与 [`../brain/references/notes/oei-2012.md`](../brain/references/notes/oei-2012.md)。
- 未建模解剖细节、伴侣关系、性病、受孕、个体临床功能障碍；离线单元与真实 Gateway 测试仅作工程模型校验，不称 `validated`。
