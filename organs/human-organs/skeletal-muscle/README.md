# 骨骼肌活动（physicalActivity）：活动剩余时间与相对强度

**功能标签：** 活动（骨骼肌活动状态薄切片）。

`physicalActivity` 位于 `organs/human-organs/skeletal-muscle/activity.ts`，只保存一次 `exercise` 动作留下的活动剩余分钟和相对强度，供皮肤出汗脚本按轮初快照读取。它不模拟肌肉收缩、运动类型、代谢产热或疲劳，也不消耗能量、产热、调节体温或自动运动；从未 `exercise` 时初值为 0，进行中的活动在没有新动作时仍按 `io.dt` 递减并保留强度，既有水账与口渴轨迹不变。

实现状态：活动脚本已在 `organs/human-organs/skeletal-muscle/`，无参数文件；模块定向测试 8/8 PASS（2026-11-23，[`test/organs.activity.test.mjs`](../../../test/organs.activity.test.mjs)）。`exercise` 工具入口、皮肤请求链、根清单与体液双出口均已接入，完整切片为 17 个部位、19 份参数文件；完整契约见本文与 [`skin`](../skin/README.md)。尚未做真实 DSH 会话、独立运动生理数据或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `activity.ts` | `physicalActivity` | `remainingExerciseMin`、`intensity` | 自己的轮初状态；`io.actions` 中的 `exercise`；`io.dt` | 无 |

- 导出 `actionTypes = ['exercise']`；无 transfer、无通知、无其他部位写入。
- 唯一消费者是 `skin` 的轮初读取；两者之间是普通 `io.read`，不构成 transfer 配对，也不要求两者同轮提交。
- 本模块不自动产生 `exercise`，也不根据时间、活动量或环境自行开始/停止运动；动作只来自 `body_act`。

## 2. 字段与单位

两个字段都是 `absolute` 状态，初值均为 0。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `remainingExerciseMin` | `min` | 轮末剩余活动时间；先按 `io.dt` 递减，再被本轮合法 `exercise` 的 `durationMin` 替换。0 表示没有剩余活动 |
| `intensity` | `1` | 当前活动的模型内相对强度，范围 0…1；无活动时为 0。不是 MET、%VO₂max、心率、功率、RPE 或任何实测强度 |

`remainingExerciseMin` 是状态，不是累计运动时长、运动距离或历史总量；新动作替换而不是累加。`intensity` 是模型内相对量，1 只表示本模型的最大相对活动强度，不代表人群最大运动能力，也不能用 MET 表反推。时间原点：两个字段都是本轮轮末写出的状态，下一轮轮初才对 `skin` 可见；`io.simulatedSeconds` 不参与递减。

## 3. 动作、递减与“最后有效动作”

设轮初状态为 `prev`，`dtMin = io.dt / 60`：

```text
remainingExerciseMin = max(0, prev.remainingExerciseMin − dtMin)
intensity = remainingExerciseMin > 0 ? prev.intensity : 0

for action in 本轮 io.actions（按到达顺序）:
  若 action 是合法 exercise:
    remainingExerciseMin = action.durationMin
    intensity = action.intensity
write({ remainingExerciseMin, intensity })
```

合法 `exercise` 必须同时满足：

- `type === 'exercise'`；
- `intensity` 是有限数且 `0 < intensity <= 1`；
- `durationMin` 是有限数且 `> 0`。

同一轮只有**最后一个合法** `exercise` 生效；它用新的 `durationMin`/`intensity` 整体替换剩余活动，不与旧剩余时间相加。后面的非法 `exercise` 被跳过，不会把此前合法动作替换掉；`drink`、`eat`、`urinate` 等其他动作对活动无影响。非法动作不改变活动状态，也不产生错误写入。

“先按 `io.dt` 递减，再处理本轮动作”是轮初快照策略：本轮新动作从自己的完整 `durationMin` 开始，不从被本轮 `dt` 扣过的余量开始。这是动作策略（`design`/`policy`），不是运动生理规律。

`body_act` 的载荷是 `{ type: "exercise", intensity, durationMin }`，不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。工具层对非法强度/时长直接拒绝，不进入动作队列；模块层对已到达的原始动作再按同一规则校验，非法值不改变状态。动作 ID、会话和重试幂等沿用既有 `body_act`，本模块不改变它们。

## 4. 读写边界与旧档

- 本脚本是 `physicalActivity` 的唯一写者，只读自己的轮初状态、本轮 `io.actions` 与 `io.dt`。
- 不调用 `transfer`，不写 `skin`、`bodyFluid`、`bladder` 或任何其他部位；活动本身不直接扣水。
- `skin` 在下一轮读取本轮提交的活动状态，因此一次 `exercise` 对出汗请求有一轮延迟；活动结束后同理，皮肤先读到剩余时间为 0，再在后续轮次停止请求。
- 旧存档缺 `remainingExerciseMin` / `intensity` 时按 0 补齐，不反推历史活动；已有剩余时间和强度随存档保留，重启后可继续递减。
- 旧自定义清单若没有 `physicalActivity`，`skin` 按“无活动”处理（请求 0），但本切片根清单包含该部位以提供 `exercise` 能力；这不是运动模型的替代入口。

## 5. 证据与未建模边界

- 活动脚本没有参数文件，也没有登记来源；递减、归零清强度和“最后有效动作”都是 `design` / `policy`，不是人体测量、拟合或独立验证。
- 不建 METs、能量消耗/kcal、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、姿势、核心/皮肤温度、体温调节、汗液电解质、环境热应激、疾病或个体差异。
- 不声称真实的 DSH 会话验收、独立人体活动数据、运动生理验证或临床验证；`intensity=1` 只是模型内上限，不能写成任何实测强度或最大能力。
- 设计背景见 [`2026-11-23-activity-sweat-design.md`](../../../docs/superpowers/specs/2026-11-23-activity-sweat-design.md) §3；出汗侧见 [`skin`](../skin/README.md)。
