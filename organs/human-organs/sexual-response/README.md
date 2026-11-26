# 性反应周期（sexual-response）：性别分化唤醒、排卵增幅与性后余韵

**功能标签：** 神经、生殖（性反应周期薄切片；支持性别分化）。

`sexual-response/response.ts` 维护 `sexualResponse` 部位，接收 `sex { durationMin, intensity }` 与无载荷 `orgasm`，按 `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution` 推进，并输出 `afterglowMm`（高潮后温热余韵，峰值 `80 mm`，22 min 半衰期）及共享纯函数 `evaluateSexualRelease` 与 `resolveEffectiveRefractoryMin` 供 `brain/autonomic.ts`、`brain/reward.ts` 与 `uterus/uterus.ts` 在同轮基于轮初快照同步判别高潮。

- **性别分化与周期耦合（design）：** 男性（`testes` 加载）与中性身体保留 `refractoryMin = 20 min` 基础不应期，并在 `pituitary.prolactinNgMl > 14 ng/mL` 时温和延长（`+0.5 × (PRL − 14)`，最多 `+15 min`）；女性（加载 `ovaries` 且无 `testes`）取消固定 20 min 绝对不应期，仅保留 `femalePostOrgasmPauseMin = 2 min` 防连跳短停顿，持续刺激可连续唤起与多次高潮，高含 E2 / 排卵窗口对目标与上升速率给出温和正向增益。

**状态口径。** 当前实现：脚本与参数在 `organs/human-organs/sexual-response/`，三份清单均注册同一脚本（根 43 部位 / 39 份唯一参数文件，女性 46 / 42，男性 45 / 41）。8 项参数均标 `design`；PRL 性后饱和方向参考 `SRC-KRUGER-2003`；尚未做真实 DSH 会话或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `response.ts` | `sexualResponse` | `arousalMm`、`phase`、`remainingSexMin`、`sexIntensity`、`lastOrgasmAtSimMin`、`afterglowMm` | 自己的轮初状态；轮初 `testes.testosteroneRelative`、`ovaries`（E2/P4）、`pituitary.prolactinNgMl`；`io.actions`；`io.dt`；`io.simulatedSeconds` | `response.parameters.json` |

## 2. 字段与单位

六个字段均 `absolute`（`initialState = { arousalMm: 0, phase: 'rest', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null, afterglowMm: 0 }`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `arousalMm` | `mm` | 唤醒代理 0–100 |
| `phase` | `-` | `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution`（女性无固定 20 min 不应期，2 min 后即回 `excitement`/`plateau`/`resolution`） |
| `remainingSexMin` | `min` | 剩余性活动分钟 |
| `sexIntensity` | `1` | 相对强度 0–1 |
| `lastOrgasmAtSimMin` | `min` | 最近一次释放的仿真分钟，未发生为 `null` |
| `afterglowMm` | `mm` | 高潮触发跃升至 `80 mm` 的性后温热余韵（22 min 半衰期），向 `interoception.hedonicCalmMm` 与 `autonomic` 副交感反弹输出 |

## 3. 动作契约与校验

`body_act` 的 `sex` 载荷为 `{ type: "sex", intensity, durationMin }`，与 `exercise` 使用同一组字段和同一套校验：

- `intensity` 必填、有限且 `0 < intensity <= 1`；
- `durationMin` 必填、有限且 `> 0`；
- 不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`；
- 不接收伴侣、行为类型、体位、性别、避孕或任何内容字段。

非法 `sex`（强度为 0 或超过 1、时长为 0 或负数、NaN、非有限数、字段缺失）被忽略，不改变 `sexualResponse` 的任何字段。模块对已经到达的原始动作再按同一规则校验；工具层拒绝非法载荷，不进入动作队列。

`orgasm` 是**无载荷**动作，只写 `{ type: "orgasm" }`，没有 `intensity`、`durationMin`、`phase` 或 `lastOrgasmAtSimMin` 参数。它只在轮初 `arousalMm >= orgasmAllowedMm = 70` 时生效；轮初唤醒低于 70 时动作被忽略，不因该动作改变状态。它不要求 `active`，也不要求同轮存在 `sex`，只看轮初唤醒。

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
若 released：lastOrgasmAtSimMin = simMin

testosteroneRelative = max(0, finiteOr(testes.testosteroneRelative, 1))
testosteroneFactor   = 0.5 + 0.5 × testosteroneRelative
target = active && !refractory && !released
  ? clamp(100 × sexIntensity × testosteroneFactor, 0, 100)
  : 0
riseHalfTimeMin = testosteroneRelative > 1
  ? arousalHalfTimeMin / testosteroneFactor
  : arousalHalfTimeMin
halfTimeMin = target > prevArousal ? riseHalfTimeMin : resolutionHalfTimeMin
arousalMm   = target + (prevArousal − target) × 2^(−dtMin / halfTimeMin)

sinceOrgasm = lastOrgasmAtSimMin === null ? Infinity : simMin − lastOrgasmAtSimMin
phase = sinceOrgasm < orgasmDurationMin ? 'orgasm'
      : sinceOrgasm < refractoryMin     ? 'refractory'
      : active                          ? (arousalMm < 60 ? 'excitement' : 'plateau')
      : arousalMm >= 10                 ? 'resolution' : 'rest'
```

- `active` 只要求剩余分钟和强度都大于 0；`sexIntensity = 0` 或剩余分钟为 0 时目标为 0，唤醒按消退半时回落。
- **不应期门控与释放轮回落：** 两条释放路径都要求 `!refractory`（不应期内既不触发主动 `orgasm` 也不触发强制释放）；而且在释放当轮（`released === true`）即把 `target` 置为 `0`，使唤醒当轮就开始按消退半时下降、不会在释放轮仍向高潮前目标推升。`target` 已钳在 `[0, 100]`。
- **睾酮可选缩放：** 仅当加载 `testes` 时（如男性清单）才影响唤醒幅度和上升速度：`testosteroneFactor = 0.5 + 0.5 × testosteroneRelative`（`testosteroneRelative = 1` 时因子为 `1`，与无睾酮清单完全一致）；当 `testosteroneRelative > 1` 时上升半时缩短为 `arousalHalfTimeMin / testosteroneFactor`，高睾酮上升更快。未加载或非有限按 `1`。
- 释放判定用**轮初**唤醒：本轮 `sex` 写入的 `arousalMm` 不会在同一轮触发释放。例如轮初 69 mm、同轮 `sex` 把它推到 75 mm，主动 `orgasm` 仍被忽略；若升到 95 mm 以上，也要等到下一轮轮初才强制释放。
- 事件轮 `sinceOrgasm = 0`，相位为 `orgasm`；下一轮 `sinceOrgasm = dtMin`（60 s 轮下为 1 min），不再满足 `sinceOrgasm < orgasmDurationMin = 1`，进入 `refractory`，目标保持 0，唤醒继续按 15 min 半时下降。
- `target = 100 × sexIntensity`（无睾酮偏移时）。强度 0.8 的目标是 80 mm：第 15 轮写出的唤醒约 70 mm，下一轮轮初才达到 70 mm，可提交主动 `orgasm`；目标不到 95 mm，不会强制释放。强度 1 的目标是 100 mm：第 9 轮写出约 71 mm，下一轮轮初 ≥70 可主动释放；第 22 轮写出约 95 mm，下一轮轮初由强制路径释放。具体轮次由 `dt`、睾酮水平与轮初状态决定。
- 上升与下降使用不同半时：目标高于当前唤醒时用 `riseHalfTimeMin`（基线 5 min，高睾酮时更快）；目标低于或等于当前唤醒时用 `resolutionHalfTimeMin = 15`。这是工程反应速度，不是人体性反应潜伏期或消退时间。
- 不应期内（`sinceOrgasmBefore < 20` min）新到的合法 `sex` 仍更新 `remainingSexMin` 与 `sexIntensity`，但 `target = 0`，唤醒不上升且不再次释放；不应期结束后若仍有剩余活动，目标恢复。
- 相位优先级固定为：`orgasm`（事件轮，`sinceOrgasm = 0`）→ `refractory`（`sinceOrgasm < 20` min）→ `excitement` / `plateau`（`active`，以 60 mm 分界）→ `resolution`（无活动且 `arousalMm >= 10`）→ `rest`（无活动且 `arousalMm < 10`）。不应期内即使 `active` 仍为真，相位也显示 `refractory`。
- 60 s 轮下，`phase = 'orgasm'` 只在释放事件轮出现；下一轮 `sinceOrgasm = 1 min`，进入 20 min 不应期。`sinceOrgasm` 到 20 min 时 `refractory` 为假，若仍有活动则回到 `excitement` / `plateau`，否则按唤醒水平进入 `resolution` 或 `rest`。
- 没有活动时，唤醒只按消退半时下降；降到 10 mm 以下时相位为 `rest`。相位的 60 mm 与 10 mm 分界、`orgasmDurationMin = 1` 与不应期 20 min 都是 `design` 策略，不是诊断标准。

## 5. 参数、消费者与证据

同目录 `response.parameters.json`（8 项 `design`，无 `validated`）：`arousalHalfTimeMin = 5`、`resolutionHalfTimeMin = 15`、`orgasmAllowedMm = 70`、`orgasmForcedMm = 95`、`orgasmDurationMin = 1`、`refractoryMin = 20`、`femalePostOrgasmPauseMin = 2`、`afterglowHalfTimeMin = 22`。

- `brain/reward.ts`、`brain/autonomic.ts`、`uterus/uterus.ts` 与 `sexualResponse` 同轮调用 `evaluateSexualRelease`：一次释放同时引发自主交感脉冲（而后转入副交感余韵反弹）、中枢 `hedonicMm` / `satietyMm` 跃升（高 PRL 持续抑制性冲动）与子宫高潮收缩 `contractionMm`。
- `brainNotify` 以会话 `lastOrgasmAtSimMin` 边沿跳变发射重要余韵唤醒（并屏蔽重复 `sexualArousal` 合并）。
- 文献笔记：[`references/notes/kruger-2003.md`](references/notes/kruger-2003.md)（`SRC-KRUGER-2003`）、[`../ovaries/references/notes/roney-2013.md`](../ovaries/references/notes/roney-2013.md) 与 [`../brain/references/notes/oei-2012.md`](../brain/references/notes/oei-2012.md)。
- 未建模解剖细节、伴侣关系、性病、受孕、个体临床功能障碍；离线单元与真实 Gateway 测试仅作工程模型校验，不称 `validated`。
