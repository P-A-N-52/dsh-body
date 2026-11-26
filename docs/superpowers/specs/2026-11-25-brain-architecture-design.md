# 大脑感知、双模式无数字通知、纯感觉交互、休眠绑定与睡眠闭环设计

日期：2026-11-25  
状态：已实现（以当前代码与测试验收为准；真实 DSH 会话尚待后续验收，生理与策略参数仍标为 `design` / `policy`，不称 `validated`）

> 本文严格区分 **当前实现**、**本设计目标** 与 **尚未实现 / 后续计划**；全部生理阈值与策略参数在未取得独立人体数据前仅标为 `design` 或 `policy`，不称 `validated`。

---

## 一、设计目标与总体架构

在前序身体器官层（水/糖/循环/氧/体温/内分泌/消化/生殖/可扩展器官规范）完成的基础上，构建完整的大脑感知、认知接入与行为控制闭环：

1. **全身体感汇聚与补齐（A + B 类）**：在 [interoception.ts](../../../organs/human-organs/brain/interoception.ts) 保留既有 16 项 `mm` 代理与可扩展 `sensations` 通道之上，补齐基于现有器官状态的 **低血糖乏力心慌、心悸/低血压不适、出汗潮湿黏腻、肌肉疲乏、非自主排尿异常察觉** 五路新体感，并将除“食管呛咳”外的全部显著主观体感接入通知系统。
2. **彻底落实“只传感觉、零数值”（`body_state` + 通知 + 上下文）**：
   - 面向大模型的主动查询工具 `body_state` 改造为**仅返回纯定性身体感受摘要与当前状态描述，严禁返回任何阿拉伯数字、单位或客观生理数值**；
   - 原始精确数值保留给观测与测试通道 `HTTP GET /state` 与 `gateway.getState()`。
3. **无每日配额上限、逐级递增通知间隔与多感受聚合（`brainNotify`）**：
   - 废除不自然的 `maxPerHour` / `maxPerDay` 每日硬封顶，改用 **距上一次通知时间控制的逐级递增退避间隔（backoff）直到最大通知间隔**；
   - 区分普通通道与高危紧急通道（缩短冷却但同样逐级递增到各自封顶上限，绝不无限刷屏）；
   - 同一轮若同时存在多条跨档体感，**聚合成一条多感觉自然语言描述**统一投递。
4. **严格“无数字双通知”与 DSH 大脑认知接入层**：
   - 沿用 [notifications.js](../../../notifications.js) 的两类通道：`mode: 'context'`（`agent.inject`，仅写入上下文、不唤醒空闲会话）与 `mode: 'wake'`（`agent.followup`，系统消息注入并主动唤醒模型响应）；
   - 通过本地 DSH 实测确认的 `ctx.get('systemPrompt')` 可选注入服务，注册静态身体认知章节（`systemPrompt.section`）与轻度持续背景体感快照（`systemPrompt.context`，均零数值；mock 测试无该服务时安全旁路）。
5. **NSFW 总开关（默认关闭，含性与泌乳）**：
   - 归档在每具身体 `body-state.json` 顶层可选布尔 `nsfw`（缺省 `false`，停机修改或插件配置默认，存档优先）；
   - 关闭时屏蔽性兴奋、性欲、高潮/不应期与女性乳腺胀奶/泌乳的全部 `body_state` 暴露、通知推送与动作入口（`sex` / `orgasm`）。
6. **未绑定休眠与睡眠闭环（C 类）**：
   - **严格手动绑定（方案 B）**：身体必须经显式绑定 `sessionId`（`body_bind` / `POST /bind` / 存档 `boundSessionId`）才会推进生理时钟；未绑定或绑定会话关闭/解绑时自动休眠冻结，重连后从冻结时刻恢复且**不补算休眠期现实时间**，绝不覆盖存档顶层手动 `active: false`。
   - **睡眠/唤醒动作闭环（`sleep` / `wake_up` / `stop_exercise`）**：新增 `sleep` 器官维护清醒稳态睡眠压力与睡眠状态（联合松果体褪黑素驱动困倦）；无额外无源 `rest` 动作（不运动即为自然静息，`stop_exercise` 用于提前中止正在进行的运动）。

**明确非目标与后续划分：**
- **已完成补充实现**：接入 `ctx.llm` 动作定量翻译官与单身体近期 100 条参考档案（见 [2026-11-25-llm-action-translator-design.md](./2026-11-25-llm-action-translator-design.md)）；
- **暂缓计划**：`logs/` 通用滚动日志（仅记录状态变化与通知，且设有明确上限）与通知阅读回执；
- **不做**：环境温度、衣物热阻与温控动作；不将 `esophagus.chokingMm` 送入大脑通知（仅留在 `discomfort` 内部代理）；心理情绪系统（喜怒哀乐）与长期体重增减；`parathyroid` / `bloodCalcium` 保持未挂载；
- **未来展望**：身体预设与 5 级免疫系统、慢/急性状态。

---

## 二、全身体感清单与分级策略

所有信号统一使用 0–100 `mm` VAS 代理量尺；门控阈值统一采用滞回四档：
- `0` 舒适/复位区：`[0, 40)` mm（低于 `resetBelow = 40` 才重置已通知水位与该信号的递增退避层数）；
- `1` 轻度觉察带：`[40, 65)` mm（可随正常对话作为 `systemPrompt.context` 极简背景，不主动发通知，也保持既有已通知水位不复位）；
- `2` 明显感觉（**`context` 注入不唤醒**）：`[65, 85)` mm；
- `3` 强烈感觉（**`wake` 系统消息唤醒**）：`[85, 100]` mm；
- **`urgent` 高危紧急级**：特定生理危机越线时触发（见下表），直接采用 `mode: 'wake'` 并走独立短间隔退避。

### A. 一般与高危体感映射表（全零数值输出）

| 感受分组 | 数据源（`interoception` / 器官） | 触发条件 / 计算规则（均 `design`） | 2 档 `context` 文案（示例口径） | 3 档 `wake` / 高危文案（示例口径） | 高危判据 | NSFW? |
| --- | --- | --- | --- | --- | --- | --- |
| **饥饿** | `interoception.hunger` | 现有公式 | 胃里有些空，开始觉得有点饿。 | 胃里空得难受，饥饿感很强烈。 | 否 | 否 |
| **饱腹** | `interoception.fullness` | 现有公式 | 胃里有些满，饱足感比较明显。 | 胃里很胀，撑得有点难受。 | 否 | 否 |
| **口渴** | `interoception.thirst` | 现有公式 | 有些口渴了。 | 非常口渴，急需喝水。 | 否 | 否 |
| **口干** | `interoception.dryMouthMm` | 现有公式（来自唾液湿润度） | 嘴里和舌头有些发干。 | 口腔干涩发紧，咽口水都不顺畅。 | 否 | 否 |
| **尿意** | `interoception.urinaryUrgency` | 现有公式（含排尿抑制卫士） | 隐约有尿意了。 | 膀胱胀满，尿意非常迫切。 | 否 | 否 |
| **便意** | `interoception.bowelUrgencyMm` | 现有公式（结肠粪便 proxy） | 肚子有些发沉，隐约有便意。 | 下腹坠胀明显，急需排便。 | 否 | 否 |
| **漏尿异常** *(新增 B)* | `bladder.involuntaryVoidedMl > 0` | 轮初膀胱 >600 mL 非自主排空发生轮次 | — | 身体一阵失控热流，刚才意外漏尿了。 | 一次事件 `wake`（视作高危打断） | 否 |
| **缺氧气促** | `interoception.dyspneaMm` | 现有公式（血氧供需缺口） | 呼吸变得有点急，胸口微微发闷。 | 呼吸困难、喘不上气，胸口发闷。 | `>= 90`（严重缺氧窒息感） | 否 |
| **发热** | `interoception.heatMm` | 现有公式 `50*(T-37)` | 身上有些燥热冒温。 | 浑身滚烫发昏，热得很难受。 | `>= 85`（核心温 `>= 38.7°C`） | 否 |
| **发冷** | `interoception.coldMm` | 现有公式 `50*(37-T)` | 身上觉得有点发凉。 | 浑身冰冷打颤，手脚发僵。 | `>= 85`（核心温 `<= 35.3°C`） | 否 |
| **低血糖不适** *(新增 B)* | `interoception.hypoglycemiaMm` | 读 `glucose.concentrationMgDl`：`clamp((75 - C) * 4, 0, 100)`（`75` 为 `0`，`53.75` 为 `85`，`50` 为 `100`；未加载/非有限按 `0`） | 觉得有点发虚乏力，精神微微发晃。 | 脑子发昏、手脚发软发慌，整个人很虚脱。 | `>= 85`（严重低血糖 `<= 53.75 mg/dL`） | 否 |
| **心悸循环不适** *(新增 B)* | `interoception.palpitationMm` | 读 `heart.heartRatePerMin` 与 `blood.systolicMmHg`（非中高强度运动时 `max(clamp((HR - 115) * 1.5, 0, 100), clamp((95 - SBP) * 5, 0, 100))`；`remainingExerciseMin > 0 && intensity >= 0.2` 时屏蔽静止心动过速项，仅取低血压项） | 觉得心跳有些乱或发快，头略微发沉。 | 心跳剧烈发慌、阵阵眩晕站不稳。 | `SBP < 78`（休克前严重低血压，强制提升至 3 档） | 否 |
| **出汗黏腻** *(新增 B)* | `interoception.sweatDampMm` | 读自身上一轮 `sweatDampMm` 按 `20 min` 半时衰减，叠加轮初 `skin.sweatVolumeMl` 折算汗率增量（`sweatRateMlMin * 4 * dtMin`） | 后背和皮肤有些出汗潮湿。 | 浑身湿透粘腻，汗水流个不停。 | 否 | 否 |
| **肌肉疲乏** *(新增 B)* | `interoception.muscleFatigueMm` | 读自身上一轮 `muscleFatigueMm` 按 `30 min` 半时恢复，叠加运动强度增量（`2.1 * intensity * dtMin`）与已加载骨骼肌三区（`15/135/150 g` 随体重缩放）糖原亏空比例的 `0.5` 倍 | 四肢肌肉有点发酸发沉。 | 肌肉酸痛发软，已经很疲乏使不上力。 | 否 | 否 |
| **困倦** | `interoception.sleepinessMm` | 未加载 `sleep` 时保持原 `pineal` 公式逐点不变；加载 `sleep` 且同时加载 `pineal` 时取 `clamp(0.4 * melatoninMm + 0.8 * sleepPressureMm, 0, 100)`，仅有 `sleep` 时取 `sleepPressureMm` | 眼皮有些发沉，脑子开始犯困。 | 困意极重，上下眼皮直打架，几乎撑不住。 | 否 | 否 |
| **紧绷压力** | `interoception.stressMm` | 现有公式（来自 `adrenal.cortisolRelative`） | 心神有些紧绷发焦。 | 心头焦躁紧绷得很，难以平静下来。 | 否 | 否 |
| **经期不适（女性）** | `interoception.uterineCrampMm`（及 `discomfort` 第五路） | 软读 `uterus.crampMm`（新增固定字段 `uterineCrampMm`，同步并入 `discomfort`） | 下腹有些隐隐发坠发紧。 | 小腹一阵阵绞痛得厉害，整个人直不起腰。 | 否 | 否 |
| **非标器官扩展** | `interoception.sensations` | 任意器官自写 `sensations[k]`（含 `intensityMm`, `discomfort?`, `urgent?`, `nsfw?`, `contextText?`, `wakeText?`） | 取无数字 `contextText` | 取无数字 `wakeText` | 可由扩展声明 `urgent: true` | 若声明 `nsfw: true` 则受开关门控 |
| **性唤醒 / 性欲 / 高潮余韵** | `interoception.sexualArousalMm` / `libidoMm` / `sexualResponse.phase` | 现有读数 + 高潮相位句（`phase === 'orgasm'` 且 3 档） | 体内泛起明显的燥热与悸动。 | 强烈的冲动与反应翻涌上来（/ 刚经历过一阵释放余韵）。 | 否 | **是（`nsfw: true` 才启用）** |
| **乳腺胀奶（女性）** | `mammaryGlands.fullnessMm` | 现有读数（受 `nsfw` 总开关控制） | 胸口觉得有些发胀。 | 胸部胀痛沉重得十分明显。 | 否 | **是（`nsfw: true` 才启用）** |

> 剔除核对：**食管呛咳 (`esophagus.chokingMm`)** 保留在 `interoception.discomfort` 第七路作为数值代理，**不单独输出字段，不进入 `brainNotify`，也不作为单独报警弹出**。`body_state` 仅在无更高级别感受且 `chokingMm >= 70` 时输出泛化的 `discomfort` 描述。

### B. 新增 `interoception` 状态字段契约
为满足 `AGENTS.md`（“所有部位字段在 `fields` 声明 `unit` 与 `mode`”），`interoception` 在原有 16 项字段外追加 5 个 `{ unit: 'mm', mode: 'absolute' }`（初值均为 `0`），合计 21 个固定 `mm` 字段：
- `hypoglycemiaMm`
- `palpitationMm`
- `sweatDampMm`（读取自身上一轮 `sweatDampMm` 按半时 20 min 衰减再叠加汗率增量）
- `muscleFatigueMm`（读取自身上一轮 `muscleFatigueMm` 按半时 30 min 恢复再叠加运动强度与肌糖原缺口）
- `uterineCrampMm`（暴露轮初 `uterus.crampMm`，未加载或非有限按 `0`）

> 兼容性说明：现有基线测试已同步更新为 21 项字段的 `initialState` 与 `fields` 契约。

---

## 三、通知调度机制：逐级递增间隔 + 多感觉聚合

### 1. 废除小时/每日总上限，采用“距上次通知时间 + 逐级退避”

`brainNotify` 每个会话 `session` 状态结构演进为（保留既有 `levels` 对原有 4 路读写的兼容结构并统一管理所有信号）：

- **常规通道门控**（`context` 与常规 `wake`）：
  - 字段：`lastSentAt: number | null`、`backoffStep: number`（初值 `0`）
  - 允许发送条件：当前存在至少 1 个**未通知过更高水位**的普通信号（`observedLevel >= 2 && observedLevel > watermark`），且：
    - `session.lastSentAt === null` 或
    - `(now - session.lastSentAt) >= requiredNormalIntervalSec(session.backoffStep)`
  - 其中递增公式（参数全部 `policy`，可配在 `notify.parameters.json`）：
    ```text
    requiredIntervalMin(step) = min(maxIntervalMin, baseIntervalMin * 2^step)
    默认：baseIntervalMin = 20 min，maxIntervalMin = 240 min
    步进序列：20 → 40 → 80 → 160 → 240 min（封顶）
    ```
  - 每次成功发出一笔普通通知后：`lastSentAt = now`，`backoffStep = min(maxBackoffStep, backoffStep + 1)`。
  - **回落重置**：当任一已锁定信号跌破 `resetBelow = 40 mm`、或由 3 档步降至 2 档（仅复位紧急退避）、或本轮收到匹配的缓解动作（`eat`、`drink`、`urinate`、`defecate`、`sleep`、`stop_exercise`、`wake_up`）或排尿/排便实绩（`bladder.voidedMl > 0`、`colon.defecatedG > 0`）时，重置对应通道的退避状态（`backoffStep = 0, lastSentAt = null` 或 `urgentBackoffStep = 0, lastUrgentSentAt = null`）。
- **高危紧急通道门控**（`dyspneaMm >= 90`、`heatMm >= 85`、`coldMm >= 85`、`hypoglycemiaMm >= 85`、`blood.systolicMmHg < 78`、`involuntaryVoidedMl > 0` 跃升边沿、任意达到 `wakeAtLevel = 3` 的强档信号或声明 `urgent: true` 的扩展感受）：
  - 字段：`lastUrgentSentAt: number | null`、`urgentBackoffStep: number`（初值 `0`）
  - **穿透普通冷却与睡眠抑制**：不受普通 `backoffStep` 与 20–240 min 间隔阻塞，也不受 `sleep.sleeping === true` 抑制，仅检查 `lastUrgentSentAt`；发送紧急 `wake` 时同时更新 `lastSentAt = now`，避免紧急唤醒后紧跟普通上下文打扰：
    ```text
    requiredUrgentIntervalMin(step) = min(urgentMaxIntervalMin, urgentBaseIntervalMin * 2^step)
    默认：urgentBaseIntervalMin = 5 min，urgentMaxIntervalMin = 60 min
    步进序列：5 → 10 → 20 → 40 → 60 min（封顶）
    ```
  - 当该高危信号解除（降到 2 档或 `< 40 mm` 或缓解动作触发）时，`urgentBackoffStep` 与 `lastUrgentSentAt` 复位。

### 2. 多感受一次聚合（替代单挑一条）

当本轮通过上述时间门控允许发送通知时：
1. 收集当前**所有** `observedLevel >= 2` 且 `observedLevel > levelWatermark[k]`（同时满足 `nsfw` 与无异常回落）的信号，形成 `candidates[]`；
2. 同时附带收集“已在当前 `level >= 2` 持续、虽然之前报过但本轮仍有伴随存在感的其他显著感受”是否并入？——为避免每次都啰嗦所有旧信号：
   - **主合并规则**：优先合并所有**尚未报过当前水位（`observedLevel > levelWatermark[k]`）**的信号，并记录它们的新水位；
   - 若同时存在紧急高危信号，所有同轮跨档的新显著信号一并并入这次推送中，免得紧跟着再来一条普通上下文干扰；
3. 按严重程度排序（高危 → 3 档强体感 → 2 档明显体感），将各自纯定性短语去重拼接为一句自然中文：
   - 例：`"身体感受：呼吸发闷有些喘不上气；同时胃里很空饿得发慌，眼皮也有些发沉。"`
   - 任何单条都经过 `!/\d/.test(text)` 断言校验，合并文本严禁出现任何数字或单位。
4. 投递 `mode` 判定：只要合并列表中存在任意高危或 `level >= wakeAtLevel`（`3` 档），整条通知使用 **`mode: 'wake'`**（触发 `agent.followup` 唤醒响应）；若全为 `2` 档，则使用 **`mode: 'context'`**（调用 `agent.inject` 静默加入上下文不唤醒）。

*(同步修正：此前审阅发现扩展感受 `reconcileSensationLevels` 在 3→2 档降级未做步降，本次一并改为统一滞回器：只要高于 `resetBelow` 允许 `3→2` 步降并只在升档 `next > watermark` 时重触发。)*

---

## 四、DSH 认知与交互：彻底纯感觉 `body_state` + `systemPrompt` + `body_bind`

### 1. `tools.js` 的工具职责重划分

插件通过 `ctx.tools.register` 对 DSH 注册 **3** 个模型工具：

1. **`body_state`**（**彻底纯感觉化，零数值**）：
   - 入参保持 `{ focus?: string, part?: string }`（若传 `part` 为原型污染名或不存在的部位则返回 `feelings: null` 与未感知提示；省略则返回全身完整主观感觉总览）。
   - 返回结构只含定性描述，例如：
     ```json
     {
       "status": "active",
       "focus": "all",
       "feelings": [
         { "area": "hunger", "level": "marked", "feeling": "胃里有些空，开始觉得明显饿了。" },
         { "area": "sleep", "level": "mild", "feeling": "略微有些犯困，精神稍微发沉。" }
       ],
       "summary": "当前清醒静息；胃里有些空，开始觉得明显饿了；略微有些犯困，精神稍微发沉。"
     }
     ```
     （`status` 取 `'active' | 'sleeping' | 'dormant' | 'paused'`；`level` 取 `'steady' | 'mild' | 'marked' | 'strong' | 'urgent'`。）
   - 硬约束：**绝不包含 `simulatedSeconds` 秒数、`mg/dL`、`mL`、`g`、`mm`、`°C` 等任何数字**；`nsfw: false` 时过滤掉一切性、高潮与乳腺泌乳感受及别名；休眠（未绑定）时返回 `status: 'dormant'` 并明确告知需先调用 `body_bind`。
   - 观测面板与测试仍调用 `GET /state` 与 `gateway.getState()` 获取全量精准数值，互不干扰。

2. **`body_act`**（**动作执行 + `nsfw` 门控 + 扩展动作透传**）：
   - 基础动作：`drink`、`eat`、`urinate`、`defecate`、`exercise`、`stop_exercise`、`sleep`、`wake_up`；
   - `sex` / `orgasm` 仅在 `nsfw === true` 时列入动态 `type.enum` 并允许入队；`nsfw === false` 提交时在工具侧返回 `400` 拒绝（Gateway `POST /actions` 队列侧返回 `403` 拒绝，`GET /capabilities` 同步过滤）；
   - 自定义扩展器官声明的 `actionTypes` 继续动态并入 `enum` 并透传。
   - 若身体当前处于休眠（未绑定）或 `active: false` 暂停状态，返回 `409`（休眠时附带 `body_bind` 引导提示）。

3. **`body_bind`**（**显式会话绑定与解绑**）：
   - `{ action?: 'bind' | 'unbind' | 'status', sessionId?: string }`（默认 `'bind'`），绑定到当前工具调用上下文里的 `exec.agent.session.id`（或 `exec.sessionId` / 显式传入的 `sessionId`）。
   - 返回 `{ ok, bound, dormant, active, nsfw, boundSessionId, error?, feeling? }`：绑定成功时唤醒休眠身体、重锚 `wallTimeMs = now()` 开始计时推进，并在非休眠/非暂停时通过 `feeling` 附带一句零数值初始身体背景感知；
   - 解绑成功：立即进入休眠冻结生理时间。

### 2. DSH `systemPrompt` 整合（[index.js](../../../index.js)）

使用真实 DSH 的可选服务模式：
```js
const systemPrompt = tryGetService(ctx, 'systemPrompt');
```
- **存在 `systemPrompt` 时**：
  1. 注册持久化 `section({ name: 'dsh-body:cognition', order: 120, text })`：
     向模型阐明身体交互规则（你是具身存在，只能以主观定性感受体会自身状态，严禁输出或编造具体数值单位；收到来源为 `body-notify` 的消息代表自己的身体内部感受信号，不是外界用户说话；可按需调用 `body_bind`、`body_state`、`body_act`）。
  2. 注册轻量背景 `context({ name: 'dsh-body:feelings', order: 120, text: (ctxArg) => ... })`：
     仅当身体激活、非休眠且请求会话 ID 与 `boundSessionId` 一致时，调用 `formatBodyFeelingsContext(...)` 输出一句纯感觉背景（例如 `"[身体背景感受] 当前清醒静息；胃里有些空，开始觉得明显饿了。"`）；未绑定、休眠、暂停或会话不匹配时返回空字符串。
- **无 `systemPrompt`（如现有简化单测 `ctx`）时**：优雅降级忽略，保持 `test/dsh.index.test.mjs` 兼容。

---

## 五、严格手动绑定与“无绑定即休眠”生命周期（方案 B）

### 状态优先级（严格遵守 `AGENTS.md` 硬约束）

```text
1. 存档顶层 active === false（手动硬暂停）
   → 最高优先级：启动不加载生理脚本、拒绝动作与绑定激活，绝不被绑定/休眠覆盖。
2. active === true && dormant === true（无活跃绑定会话）
   → 保持 Worker 与能力表可查（支持 body_bind / HTTP /bind / /health），
     停止心跳定时器、禁止推进生理时间；body_act 返回 409。
3. active === true && dormant === false（已绑定活跃会话）
   → 正常每 60 秒推进一次心跳并按通知泵投递至 boundSessionId。
```

### 绑定、持久化与冷重启语义
- `body-state.json` 新增顶层可选字段：
  - `boundSessionId?: string | null`（默认 `null`）
  - `nsfw?: boolean`（默认 `false`）
- **冷启动（`boot()`）**：
  - `saved?.active === false`：维持既有语义完全暂停。
  - **宿主模式开关（`requireBinding`）**：[index.js](../../../index.js) 启动网关时默认传入 `requireBinding: true`（DSH 运行时强制生效）；直接调用 `startGateway` 的纯器官离线测试若未传 `requireBinding: true` 保持既有直接跑表语义，同时支持通过 `requireBinding: true` 启用相同休眠状态机。
  - 在 `requireBinding: true` 下无绑定（`boundSessionId` 为 `null` / 缺省）：即使 DSH 里已经开启多个对话，**身体保持休眠（`dormant = true`）**，不跑 `catchUp`、不自动挂载任何聊天窗口。
  - 启动时存档虽曾记录 `boundSessionId`，但 DSH 接入后在 `index.js` 中会校验：若存在 `agents.get` 且 `!agents.get(initialBoundId)`，则启动即自动解绑为未绑定休眠态；运行中监听 **`agent/disposed`（绑定对话被关闭销毁）**，自动调用 `unbindSession()` 回到 `boundSessionId = null` 并进入休眠冻结；新会话或重连会话通过 `body_bind` / `POST /bind` 显式绑定激活。
  - （独立 `startGateway({ requireBinding: true })` 测试可通过 `POST /bind` / `POST /unbind` 或 `body_bind` 验证休眠与唤醒切换。）
- **唤醒（解冻）时钟重锚**：
  - 每次从“未绑定休眠 (`dormant = true`)”变为“绑定激活 (`dormant = false`)”时，调用类似既有 `resumedFromPause` 的锚点重置：**把 `wallTimeMs` 与 `activeBatch.targetWallTimeMs` 平移对齐到当前 `now()`，严禁对休眠期间流失的现实时间执行 `catchUp` 补算**（保证解绑一天后再重连，不会一下被饿昏或脱水，同时身体记忆停留在离开那一刻）。

---

## 六、C 类新增器官与行为闭环：`sleep` + `stop_exercise`

1. **新增部位 `sleep`（`organs/human-organs/brain/sleep.ts` + `sleep.parameters.json`）**
   - **`actionTypes`**：`['sleep', 'wake_up']`。
   - **字段（全部在 `fields` 声明 `unit` 与 `mode`）**：
     - `sleeping`: `{ unit: '1', mode: 'absolute' }`（boolean，初值 `false`）
     - `sleepPressureMm`: `{ unit: 'mm', mode: 'absolute' }`（Process S 清醒稳态睡意，初值 `0`，钳位 `[0, 100]`）
     - `sleepDurationMin`: `{ unit: 'min', mode: 'absolute' }`（本次连续入睡分钟数，清醒时归 `0`）
   - **稳态公式（`design`, `source: null`）**：
     - 清醒期间（`sleeping === false`）：`sleepPressureMm` 按慢增长率累计（`sleep.wakePressureRateMmMin = 0.08 mm/min`，约连续清醒 16 小时升到 `76.8 mm`）；遇到 `sleep` 动作进入睡眠（已在睡眠时重复 `sleep` 不重置 `sleepDurationMin`）。
     - 睡眠期间（`sleeping === true`）：`sleepDurationMin += dtMin`，`sleepPressureMm` 按半时 `sleep.sleepRecoveryHalfTimeMin = 150 min` 向 `0` 回落；若外部提交 `wake_up` 动作，或自然睡足（`sleepPressureMm < sleep.naturalWakePressureThresholdMm (10)` 且 `sleepDurationMin >= sleep.naturalWakeMinDurationMin (360)` 且 `pineal === undefined || pineal.melatoninRelative <= sleep.naturalWakeMelatoninCeilingRelative (0.9)`），自动转醒（`sleeping = false`, `sleepDurationMin = 0`）。
   - **睡眠期间通知门控策略**：当 `sleep.sleeping === true` 时，`brainNotify` 屏蔽 `sleepiness` 候选并抑制普通轻/中度 `context` 骚扰消息；但一旦任意信号跨入 **`wake`（3 档）或高危紧迫**（如尿憋极、漏尿、严重低血糖、极冷极热），照常发出 `mode: 'wake'` 唤醒模型，由模型决定回应或提交 `wake_up`（`sleep.ts` 本身不直接读 `brainNotify`）。
   - **与 `interoception.sleepinessMm` 耦合**：存在 `sleep` 部位且同时存在 `pineal` 时，`sleepinessMm = clamp(0.4 * melatoninMm + 0.8 * sleepPressureMm, 0, 100)`；仅存在 `sleep` 时取 `sleepPressureMm`；未加载 `sleep` 时 100% 回退原 `pineal` 单输入曲线。
   - **与 `skeletal-muscle/activity.ts` 耦合**：`physicalActivity` 增加 `actionTypes = ['exercise', 'sex', 'stop_exercise']`——当收到 `'stop_exercise'` 或 `'sleep'` 动作时立即把 `remainingExerciseMin` 与 `intensity` 归零（结束运动即可使心率、呼吸、肌肉疲劳与出汗开始自然恢复，无需另造无前提的 `rest` 动作）。

---

## 七、NSFW 总开关边界细化

当身体存档 `nsfw !== true`（**默认值**）时，整条链路保持完全安全无 NSFW 泄露：
1. **`tools.js` (`body_act`) & `gateway/actions.js`**：从 `type.enum` 与 `GET /capabilities` 中剔除 `'sex'` 与 `'orgasm'`，工具层直接调用返回 `400 { error: 'NSFW actions are disabled for this body' }`，Gateway `POST /actions` 队列返回 `403 { error: 'Action <type> is disabled when nsfw is false', nsfw: false }`。
2. **`mammaryGlands` (`organs/human-organs/mammary-glands/milk.ts`)**：读取 `getNsfwSetting()`——`false` 时即使存档偶然残留 `lactating: true` 也强制写回 `lactating: false`、`milkRequestMl: 0`、`milkMl: 0`、`lactoseRequestG: 0`、`lactoseG: 0`（仅让既有 `fullnessMm` 衰减，与非泌乳行为一致）。
3. **`interoception` / `brainNotify` / `body_state` / `systemPrompt`**：屏蔽 `sexualArousalMm`、`libidoMm`、`sexualResponse.phase`、`mammaryGlands.fullnessMm` 与标记 `nsfw: true` 的扩展感受（它们在 `interoception` 中置 0，不进 `discomfort`、不触发通知，也不进 `body_state` 返回列表与文本摘要）。
4. **`HTTP GET /state` / `gateway.getState()`**：器官底层生理字段仍在调试快照内保持可查与既有单测兼容。

---

## 八、测试覆盖与验收边界

1. **受 `body_state` 纯感觉化影响需迁移的 4 份既有测试**：
   - [test/dsh.tools.test.mjs](../../../test/dsh.tools.test.mjs)、[test/organs.water-gateway.test.mjs](../../../test/organs.water-gateway.test.mjs)、[test/organs.di.test.mjs](../../../test/organs.di.test.mjs)、[test/dsh.index.test.mjs](../../../test/dsh.index.test.mjs) 中的数值检查迁移到 `gateway.getState()` / `GET /state`，同时为 `tools.body_state.execute` 新增**零数字与纯定性断言**。
2. **清单与参数计数测试（[test/organs.modules.test.mjs](../../../test/organs.modules.test.mjs)）**：
   - 新增 `brain/sleep.ts` 与 `sleep.parameters.json` 后，三份 `body-modules*.json` 脚本数与唯一参数文件数均 `+1`（根 39/35、男 41/37、女 42/38，全库总参数文件 45 份）。
3. **专题单元与真实 Gateway 集成测试**：
   - 新增 5 项 B 类体感（低血糖、心悸、出汗黏腻、肌肉疲乏、痛经暴露）与漏尿异常通知 + 食管呛咳不发通知验证；
   - `brainNotify` 双轨递增间隔（普通 `20→40→80→160→240`、高危 `5→10→20→40→60`、缓解复位与 `3→2` 步降）+ 多感受同时合并通知；
   - `nsfw: false`（默认）屏蔽性与泌乳门控 & `nsfw: true` 开启恢复验证；
   - `body_bind` / `POST /bind` / `POST /unbind` + 未绑定休眠冻结 + `agent/disposed` 自动重回休眠 + 唤醒时不补算休眠时间 + 不覆盖 `active: false`；
   - `sleep` / `wake_up` / `stop_exercise` 睡眠压力累计/消退、睡眠抑制 `context` 与高危 `wake` 穿透、以及 DSH `systemPrompt` 可选挂载集成测试。
4. **验收边界与实机联调现状**：
   - **已验证**：`npm test` 覆盖单元与本地真实 Gateway 集成测试；并在隔离的真实 DSH `0.2.1-rc.2` 容器（`dsh --profile headless --patch`，配合本地 SSE mock LLM）中实测通过 `dshHomePath` 兼容挂载（`index.js`）、`body_bind` / `body_state` / `body_act`（含 `oneOf` 输出 schema 校验）、未绑定 `409` 拦截、`systemPrompt.section` + `systemPrompt.context`（无数字 `[身体背景感受]` 注入）与 `nsfw` 动作门控。
   - **仍未验证**：真实长时对话窗口内的多分钟定时推送（`agent.inject` / `agent.followup`）、真实在线 LLM 自主决策与人类盲测数据（全部参数仍为 `design` / `policy`，不声称 `validated`）。
