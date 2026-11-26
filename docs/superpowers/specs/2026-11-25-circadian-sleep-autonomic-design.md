# 本地生物节律、睡眠生理、交感惊醒与三档通知设计

日期：2026-11-25  
状态：已实现（以当前代码与 `npm test` 离线/Gateway 集成测试为准；真实 DSH 会话实机验收尚待后续完成，本文严格区分 **当前实现**、**设计目标** 与 **尚未实现**）

> 科学口径约束：本设计新增的所有节律相位、睡眠分期/惯性、交感张力与三档通知阈值均属工程代理与交互策略，在取得独立文献/实测验证前一律标为 `design` 或 `policy`，`source: null`，不称 `validated`。

---

## 一、现状基线与本次目标

### 1. 当前实现（HEAD 基线）
- **生物节律**：仅 [pineal/melatonin.ts](../../../organs/human-organs/pineal/melatonin.ts) 与 [testes/testosterone.ts](../../../organs/human-organs/testes/testosterone.ts) 按 `io.simulatedSeconds`（假设仿真起点为 00:00）生成余弦节律；不读取本地现实钟点。`adrenal/cortisol.ts`、`brain/hypothalamus-endocrine.ts`、`brain/thermoregulation.ts` 均明确未建模昼夜节律。
- **睡眠生理**：[brain/sleep.ts](../../../organs/human-organs/brain/sleep.ts) 仅维护 `sleeping`、`sleepPressureMm`、`sleepDurationMin`（`sleep` / `wake_up` 动作及自然转醒条件）；全库无器官读取 `sleep.sleeping` 下调心率、通气、氧耗或体温，无睡眠深度分期与睡眠惯性。
- **交感神经**：无显式自主神经/交感张力状态；[heart/heart.ts](../../../organs/human-organs/heart/heart.ts) 临时借用 `adrenal.cortisolRelative` 充当交感代理。
- **通知与唤醒**：[brain/notify.ts](../../../organs/human-organs/brain/notify.ts) 仅分普通（`context`，65–84 mm）与紧急（`wake`，`>= 85 mm` 或危机）；睡眠中抑制 `context`（不堆积、醒后不补发），允许所有 `>= 85 mm` 穿透睡眠发 `wake`，且发 `wake` 时既不自动结束 `sleep.sleeping`，也不会只报紧急而压过普通/重要信号。
- **DSH 睡眠行为约束**：[index.js](../../../index.js) 仅通过 `systemPrompt.context` 输出温和背景感受；[tools.js](../../../tools.js) 的 `body_act` 与 [gateway/actions.js](../../../gateway/actions.js) 在 `sleeping === true` 时不限制、不自动唤醒；未接入 DSH 工具/回复拦截钩子。

### 2. 本次设计目标
1. **本地时钟 + 多激素昼夜节律混合（Process C × Process S）**；
2. **睡眠生理细化**（睡眠分期/深度、睡眠惯性、睡眠期心肺代谢体温下调）；
3. **显式交感神经张力与惊醒闭环**（危机惊醒同轮脱离睡眠并拉升交感）；
4. **三档通知分级（普通 / 重要 / 紧急）+ 睡眠抬高重要阈值 + 紧急压制 + 睡眠堆积醒来集中发**；
5. **DSH 宿主防梦游与主动操作/发消息唤醒钩子**。

---

## 二、模块一：本地时钟与多激素昼夜节律混合

### 1. 本地时钟对齐工具（设计目标：新建 `lib/circadian.js`）
- **输入**：`io.wallTimeMs`（Gateway 每轮固定提供，真实运行源自 `Date.now()`；停机超 12 小时跳过补算或 `dormant` 解绑重连时，`wallTimeMs` 直接跳变到当前现实时间）。
- **时区与相位计算**：
  - `offsetMin`：优先读 `body-state.json` 顶层可选配置 `profile.timezoneOffsetMin`（单位 `min`，东八区为 `480`）；缺省（`null` / 未设置）时取运行环境的本地时区偏移 `-new Date(wallTimeMs).getTimezoneOffset()`，保证实机自动跟随用户当地时钟。
  - `phaseShiftHours`：支持参数级相位偏移（默认 `0 h`，`design`），允许作息早/晚型微调。
  - 昼夜时钟公式：
    $$\text{localHour} = \left(\frac{\text{wallTimeMs}}{3600000} + \frac{\text{offsetMin}}{60} + \text{phaseShiftHours}\right) \bmod \text{periodHours}$$
- **测试确定性**：`test-support/harness.mjs` 或单测可通过固定 `wallTimeMs` 与 `profile.timezoneOffsetMin` 消除跨时区跑测试的偏移，不破坏现有确定性。
- **停机超 12h 与重连效果**：由于主生物钟直接基于 `io.wallTimeMs`，无需额外“停机超 12h 特判补算脚本”——醒来/重连的第一轮心跳就会立即按当前本地钟点输出对应的褪黑素、皮质醇与体温节律相位。

### 2. 多激素与体温昼夜混合
| 部位 / 脚本 | 节律表达式（均标 `design`） | 峰 / 谷锚点 | 混合耦合去向 |
| --- | --- | --- | --- |
| `pineal` ([melatonin.ts](../../../organs/human-organs/pineal/melatonin.ts)) | 保留既有 `1 + 0.8 * cos(2π(hour - 2)/24)` 形状，时钟源切至 `lib/circadian.js` | 02:00 峰 `1.8` / 14:00 谷 `0.2` | 驱动 `interoception.sleepinessMm`、门控 `sleep` 自然转醒与睡眠深睡倾向 |
| `hypothalamusEndocrine` → `pituitary` → `adrenal` | 在下丘脑 `crhTarget` 基准项 `1` 上叠加昼夜余弦驱动 `crhCircadianAmplitude * cos(2π(hour - 7)/24)`（默认振幅 `0.35`，约 07:00–08:00 晨峰、19:00–20:00 低谷），经 ACTH 传至 `adrenal.cortisolRelative` | 晨峰 ~`1.3–1.4` / 夜谷 ~`0.65–0.75` | 经 `liver` 温和调节空腹肝糖原输出与 `interoception.stressMm`；**不再**兼任心脏交感代理 |
| `brain/thermoregulation` | 动态昼夜调定点 `setpointC = baseSetpointC + circadianAmpC * cos(2π(hour - 17)/24) - sleepOffsetC`（默认 `37.0°C ± 0.25°C`，睡眠期再降 `0.2°C`） | 傍晚 17:00 峰 `37.25°C` / 凌晨 05:00 谷 `36.75°C`（睡中 ~`36.55°C`） | 维持 24h 空腹稳态始终在 `[36.5, 37.5]°C` 内；经 `heatMm` / `coldMm` 与 `ventilation` 传出 |
| `testes` ([testosterone.ts](../../../organs/human-organs/testes/testosterone.ts)) | 切至 `lib/circadian.js` 本地时钟 | 08:00 峰 `1.1` / 20:00 谷 `0.9` | `interoception.libidoMm`（受 `nsfw` 门控） |

- **Process C × Process S 混合**：`interoception.sleepinessMm` 继续融合褪黑素（Process C）与睡眠压力（Process S），并叠加醒后的睡眠惯性 `sleepInertiaMm`；`sleep.ts` 入睡后的深睡倾向同时参考高睡眠压力与夜间高褪黑素时段。

---

## 三、模块二：睡眠生理细化（`brain/sleep.ts` 与下游器官下调）

### 1. `sleep` 新增状态与边界（单写者仍为 `sleep`）
在原有 `{ sleeping, sleepPressureMm, sleepDurationMin }` 基础上扩展以下字段（全部声明 `fields` 的 `unit` 与 `mode: 'absolute'`）：
- `sleepStage`: `'awake' | 'light' | 'deep' | 'rem'`（`unit: '1'`）
  - 清醒时固定 `'awake'`。
  - 入睡后按工程周期（约 `90 min` 一周期，前段深睡占比高、后段 REM 占比高，全部 `design`）推进：`light` → `deep` → `light` → `rem` 循环。
  - **周期消费者**：
    1. 深睡（`deep`）对 `sleepPressureMm` 的半衰期恢复加速（如 `1.3x`），浅睡 `1.0x`，REM `0.9x`；
    2. 深睡时“重要提醒”的唤醒门槛更难触发（提高抗打扰能力），且若被强行打断则产生更高的睡眠惯性；
    3. 下游心肺代谢按深睡/浅睡/REM 分档调节。
- `sleepInertiaMm`: `number`（`0–100 mm`，`unit: 'mm'`）
  - 睡眠期间为 `0`。
  - **醒来瞬间注入**：自然睡饱醒来注入轻度惯性（如 `15 mm`）；浅睡/REM 被 `wake_up` / 重要唤醒 / 操作唤醒注入中度惯性（如 `40 mm`）；深睡被打断注入较高惯性（如 `65 mm`）；紧急惊醒时因交感瞬间压过睡意，不额外放大或被高交感警觉覆盖（仍保留少量昏沉底噪或迅速衰减）。
  - 清醒后按半衰期（默认 `20 min`，`design`）指数衰减至 `0`。
  - **消费者**：并入 `brain/interoception.ts` 的 `sleepinessMm`（或独立定性表述于 `tools.js` `body_state`：“刚醒还有些发懵犯迷糊”）。
- `wakeEvent`: `'none' | 'natural' | 'action' | 'important' | 'startle' | 'speech'`（`unit: '1'`）
  - 仅在刚脱离睡眠的**当轮**置为对应醒因（下一轮如继续保持清醒则归 `'none'`），供 `brainNotify` 与 `tools.js` 在同轮/紧接轮识别“刚刚睡醒”并说明原因。

### 2. 睡眠期下游器官生理下调（均读取轮初 `sleep` 快照）
- **`bloodOxygen` ([oxygen.ts](../../../organs/human-compartments/blood-oxygen/oxygen.ts))**：睡眠时基础氧耗乘数 `sleepMetabolicFactor`（`awake: 1.0`, `light/rem: 0.90`, `deep: 0.85`，`design`）。
- **`heart` ([heart.ts](../../../organs/human-organs/heart/heart.ts))**：睡眠时副交感占优，静息心率基线按乘数下调（`light/rem: 0.88`, `deep: 0.80`，如 `70 bpm -> 56–62 bpm`），搏出量轻微下调或维持稳定；`clamp` 下限允许下探至睡眠心率下限（如 `42 bpm`）而非硬卡 `70 bpm`。**但只要交感张力升高（惊醒/低血压/运动）仍可立即突破向上飙升。**
- **`lungsVentilation` ([ventilation.ts](../../../organs/human-organs/lungs/ventilation.ts))**：随睡眠氧耗降低自然降通气量，且睡眠时呼吸频率下限允许下探至约 `9–10 次/分`（`design`）。
- **`brain/thermoregulation` ([thermoregulation.ts](../../../organs/human-organs/brain/thermoregulation.ts))**：睡眠时调定点下调 `0.2°C`。

---

## 四、模块三：显式交感神经张力（`brain/autonomic.ts`）与惊醒闭环

### 1. 新建器官 `autonomic`（位置 `organs/human-organs/brain/autonomic.ts` + `autonomic.parameters.json`）
- **状态字段**：
  - `sympatheticMm`: `number`（`0–100 mm`, `unit: 'mm', mode: 'absolute'`, 初值 `0`）— 交感神经活跃度工程代理。
  - `parasympatheticMm`: `number`（`0–100 mm`, `unit: 'mm', mode: 'absolute'`, 初值 `20` 或睡眠升高）— 副交感/迷走基调代理。
  - `startleActive`: `boolean`（`unit: '1', mode: 'absolute'`, 初值 `false`）— 当前是否处于惊醒应激余波。
- **交感驱动源**（取轮初快照计算瞬时目标 `sympatheticTarget`，未加载相关器官时安全回退）：
  1. **惊醒爆发**：若本轮满足“睡眠中被紧急危机惊醒”判据（见下节同轮共享判据），`sympatheticMm` **同轮直接拉升至 `>= 80 mm`**（如 `max(prev, 85)`），并标 `startleActive = true`；
  2. **运动兴奋**：`physicalActivity.remainingExerciseMin > 0` 时按 `intensity` 贡献（替代原 `heart.activityGain` 或与运动协同）；
  3. **低血糖/缺氧/低血压/寒冷应激**：`glucose < 70 mg/dL`、`oxygenDeficit > 0`、`blood.systolicMmHg < 95`、`coreTemperatureC < 36.5°C` 各自产生渐进交感反射（`design`）。
- **衰减动力学**：上升快（惊醒瞬间跳升，一般应激半衰期 `2 min`），撤除刺激后按约 `12 min` 半衰期指数回落至基线 `0`；低于 `10 mm` 时 `startleActive` 归 `false`。

### 2. 交感下游联动
- **`heart.ts`**：去掉 `catecholamineGain * (cortisolRelative - 1)`，改读 `autonomic.sympatheticMm`：
  - 清醒静息且无应激时 `sympatheticMm = 0` → `drive = 1.0`（保留 `steady-state-24h` 第 1 轮 `120/80 mmHg` 稳态）；
  - 惊醒 `sympatheticMm = 85` 时，`drive` 迅速拉高，心率跃升至 ~`110–130 bpm`、心输出量增加。
- **`blood.ts`**：通过心输出量提升与轻度交感缩血管增益（如收缩压额外 `+0.15 * sympatheticMm`，上限钳在安全范围），体现惊醒后的血压波动。
- **`lungsVentilation.ts`**：交感活跃贡献额外通气驱动（如 `sympatheticVentilationGain * sympatheticMm`），体现惊醒后喘息/呼吸变急。
- **`brain/hypothalamus-endocrine.ts`**：读取 `autonomic.sympatheticMm`（例如 `> 20` 时按比例放大 CRH 驱动），形成“惊醒 → 交感先飙升 → HPA 轴皮质醇跟进抬升”的真实先后节律。
- **`liver/glycogen.ts`**：交感张力适度放大糖原释放乘数（应激血糖动员，`design`）。
- **`brain/interoception.ts`**：`palpitationMm` 结合 `heartRatePerMin`、`SBP` 与 `autonomic.sympatheticMm`；`stressMm` 同时纳入 `cortisolRelative` 与 `autonomic.sympatheticMm`。

### 3. 解决“轮初快照”下惊醒同轮脱离睡眠的设计
Gateway 所有脚本同轮 `io.read(...)` 只读轮初快照，因此不能让 `sleep.ts` 等 `brainNotify` 下一轮才改 `sleeping`。解法如下：
- 抽出一份无副作用纯函数模块 `organs/human-organs/brain/wake-evaluation.ts`（同时被 `sleep.ts`、`autonomic.ts`、`notify.ts` 复用），根据轮初快照里的各器官数值、`io.actions` 与 `notify.parameters.json` / `sleep.parameters.json` 阈值，在当轮直接判定：
  - 是否命中 **紧急危机（`emergency`）**；
  - 若 `sleep.sleeping === true`，是否命中 **睡眠抬高后的重要唤醒（`important`）**；
  - 是否收到 `wake_up`、`sleep_wake_speech`（聊天唤醒内部动作）或主动物理动作（`eat`/`drink`/`exercise`/`urinate`/`defecate`/`sex`）。
- 于是**同一轮内**：
  1. `sleep.ts` 立刻写出 `sleeping: false`、`wakeEvent: 'startle' | 'important' | 'action' | 'natural' | 'speech'` 与对应 `sleepInertiaMm`；
  2. `autonomic.ts` 立刻在 `startle` 时拉高 `sympatheticMm`；
  3. `brainNotify` 立刻感知“本轮刚刚醒来 / 紧急惊醒”，发出对应通知并按规则处理积攒队列！

---

## 五、模块四：三档通知、睡眠抬高阈值、紧急压制与堆积集中发

### 1. 通知三级划分（`policy` 参数放在 `notify.parameters.json`）

| 级别 | 触发条件（清醒 vs 睡眠） | 投递模式 | 退避通道 | 睡眠中处理 |
| --- | --- | --- | --- | --- |
| **普通 (`normal`)** | `[65, 85)` mm（一般明显体感） | `mode: 'context'` (`agent.inject`) | 普通退避 `20 → 240 min` | **不发出**，全部记入 `sleepBacklog` |
| **重要 (`important`)** | 清醒：`>= 85 mm`；<br>**睡眠时阈值抬高**：浅睡/REM `>= 92 mm`，深睡 `>= 95 mm`（或统一 `sleepImportantThresholdMm = 92 mm`，`policy`） | `mode: 'wake'` (`agent.followup`) | 重要退避 `5 → 60 min`（或独立重要退避） | 未跨过睡眠门槛者记入 `sleepBacklog`；**跨过睡眠门槛则触发常规唤醒**（脱离睡眠、不触发剧烈交感惊跳） |
| **紧急 (`emergency`)** | 生理危机：`dyspnea >= 90`、高热 `heat >= 85`、失温 `cold >= 85`、严重低血糖 `hypoglycemia >= 85`、休克低血压 `SBP < 78`、非自主漏尿边沿、扩展 `urgent: true` | `mode: 'wake'` (`agent.followup`) | 紧急短冷却 `5 → 60 min` | **无视睡眠门槛直接惊醒**（`sleeping = false` + 交感活跃） |

### 2. 紧急压制规则
- 当某轮有 **`emergency`** 候选需要发出时：
  - **压过普通和重要两级**：本条通知**只包含紧急危机文本**，普通与重要候选暂不显示在本次通知中；
  - 尚未发出的普通/重要候选不标记为“已通知水位”，保留在水位之外（若仍在睡眠中则留在 `sleepBacklog`），等后续轮次紧急解除或退避窗口打开后再正常发出。

### 3. 睡眠堆积与醒来集中发（`SessionState.sleepBacklog`）
- **睡眠期间积累**：只要 `wasSleeping === true` 且未触发紧急发送，本轮新跨入 `>= marked (65 mm)`（或超过既有锁定水位、但未跨过睡眠重要门槛）的所有信号，记录进 `session.sleepBacklog`（键为信号 ID，存 `{ peakLevel, stillActive }`，同时有上限裁剪保持 JSON-safe）。
- **脱离睡眠瞬间（`wasSleeping === true && nowAwake === true`）**：
  - **情况 A（紧急惊醒）**：遵循“紧急压制”，当轮只发紧急惊醒通知（明确点明被某种危机惊醒、心慌喘急等，全零数字）；`sleepBacklog` 暂保留（若后续危机仍持续或平息后，下一轮清醒普通/重要窗口再合并发）。
  - **情况 B（自然醒 / `wake_up` / 重要唤醒 / 动作或说话唤醒）**：
    - 当轮**强制以 `mode: 'wake'` 发一条整合唤醒通知**（即使自然醒时没有堆积也要发一条“已经睡醒了”通知模型脱离睡眠状态）；
    - 将**“已脱离睡眠（含唤醒方式与刚醒昏沉/清醒感）” + `sleepBacklog` 中积攒的未解决感受 + 睡眠期间出现过并已回落的显著插曲（如曾出汗、短暂偏冷/热、或漏尿等离散事件）**去重聚合成一条无数字自然语言描述发出，随后清空 `sleepBacklog` 并更新对应水位。

---

## 六、模块五：DSH 宿主睡眠防梦游与操作/发言唤醒（`index.js` + `tools.js`）

基于对 `@deepseek-ai/dsh@0.2.2-rc.5` 类型定义的核对，接入 3 层配合：

1. **`systemPrompt.context` HOOK 睡眠态强提醒**（[index.js](../../../index.js)）
   - 当 `sleep.sleeping === true` 时，注入明确行为约束：当前处于睡眠状态，请保持静默，不要在对话或群聊中搭话，也不要发起吃喝运动等日常行为；如果强行发言或调用外部/身体操作工具，身体将被唤醒并退出睡眠状态。
2. **`tools/pre-execute` 通用工具钩子**（[index.js](../../../index.js)，可选监听 `ctx.on('tools/pre-execute', ...)`）
   - 无需绑定某个特定“发消息 tool”名称，且**仅对当前绑定会话（`exec.agent` 的 sessionId 严格匹配 `boundSessionId`）生效**；其他会话或子代理不受影响。在绑定会话 `sleep.sleeping === true` 时调用工具：
     - **豁免工具**：`body_state`（只读查看状态）、`body_bind`、`body_act` 且 `action === 'sleep' | 'wake_up'`。
     - **其余所有工具**（包括 DSH 的发消息/群聊工具、`bash`、以及 `body_act` 的 `eat`/`drink`/`exercise`/`urinate`/`defecate`/`sex` 等主动行为）：
       - 自动向 Gateway 提交 `wake_up` 脱离睡眠并**直接放行**该工具（其中 `body_act` 主动行为在 `sleep.ts` 也可同轮直接自唤醒，双保险）。
3. **`session/event` 纯文本发言兜底**（[index.js](../../../index.js)）
   - 监听 `ctx.on('session/event', (session, event) => ...)`（可选监听）：若绑定会话在 `sleep.sleeping === true` 时真正输出了 `assistant/message`（即在群里/私聊直接发出了文字回复，未经过工具），自动向 Gateway 提交 `wake_up`，确保模型“一去聊天就立刻唤醒身体并带出睡眠堆积通知”。
4. **`tools.js` 内部动作映射与定性描述**
   - `body_act` 提交自主行为时直接被 `sleep.ts` 视作脱离睡眠；
   - `body_state` 新增对**睡眠惯性（刚醒发懵）**、**交感惊醒状态（心跳急、神经紧绷、冷汗/喘气）**的纯定性无数字表达。

---

## 七、跨模块清单与交付同步边界（实施前核对）

- **新增文件需纳入清单**：
  - `lib/circadian.js` → 核对并加入 [package.json](../../../package.json) `files`；
  - `organs/human-organs/brain/autonomic.ts` + `autonomic.parameters.json` + `wake-evaluation.ts` → 同步三份 `body-modules*.json`（排在 `heart.ts`、`blood.ts`、`sleep.ts`、`interoception.ts`、`notify.ts` 相关顺序内，遵守轮初快照与 `interoception`/`notify` 在后习惯）及 `test/organs.modules.test.mjs`、`test/parameters.test.mjs`、`test/tools.replay.test.mjs`；
  - 同步更新 `organs/human-organs/brain/README.md`、`pineal/README.md`、`adrenal/README.md`、`heart/README.md`、`docs/gateway-and-scripts.md`；
  - 新增并更新单元与真实 Gateway 集成测试（`test/organs.autonomic.test.mjs`、`test/organs.circadian-sleep.test.mjs`、`test/organs.sleep.test.mjs`、`test/organs.brain-notify.test.mjs`、`test/dsh.index.test.mjs`、`test/organs.steady-state-24h.test.mjs` 等）。
- **尚未实现（明确排除出本轮范围）**：
  - 光照强度传感抑制褪黑素、跨时区自动时差渐变、REM 梦境内容生成、真实文献标定（在无独立人体数据时所有新参数保持 `design` / `policy`）。
