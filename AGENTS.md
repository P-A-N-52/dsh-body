# AGENTS.md

> 给在本仓库工作的模型/代理：先读完本文件，再读具体文档。这里只写最容易误判的事实、硬约束和事实来源；细节由链接的文档展开。

**工作原则：这是一个信任环境。文档优先，检查从简。** 不要为了防御不可能发生的输入增加大量校验，也不要把测试或检查当成主要交付物；把 `docs/`、`organs/**/README.md`、`systems/**/README.md` 和本文件写准确、写清楚，比堆检查更重要。代码改动跑一次 `npm test` 确认没有破坏现有行为即可；纯文档改动不必跑测试。

**遇到问题，先停下来问用户。** 需求不明确、指令冲突、执行遇到意外或下一步需要用户决定时，停止推进，不自行猜测或擅自继续。完全自动权限模式下，不调用 `AskUserQuestion`；直接在聊天回复中说明遇到的问题和需要确认的事项，结束本轮，等用户回复后再继续。工具自动获批不代表用户已确认相关决定。

**改动分流：纯 Markdown 文档可直接编辑；代码改动走 tower mission 或 swarm。** `AGENTS.md`、`docs/`、`organs/**/README.md`、`systems/**/README.md`、计划与笔记都算文档；`.js`、`.ts`、`test/`、配置和 `*.parameters.json` 算代码。代码改动优先建 tower mission，在 `.tower/worktrees/` 里由 worker 完成，再 review/merge；swarm 模式下用 `AgentSwarm` 按可独立验证的分片并行完成，主代理负责合并与验收。不要用单个通用 `Agent` 冒充 tower worker。tower mission 与 swarm 都不可用时，先说明并停在计划层。

**资料搜集默认交给只读子代理。** 把文献、外部实现或跨模块资料拆成独立问题，交代要查的范围、原文出处和证据边界。子代理回报链接、原文定位、结论和哪些事还不能确定；主代理负责定题、归纳并复核影响设计的关键证据，不与子代理重复搜索。Tower 模式用只读 `survey` mission；非 Tower 模式按当前授权用 Swarm 或只读子代理。派工入口不可用时说明阻塞，不改由主代理继续大范围搜索，也不绕过当前模式。已知路径上的事实核对不必另派。

## 0. 一句话与当前阶段

`dsh-body` 是一个 DSH 插件：在宿主进程里运行一具虚拟身体的 Gateway，按 60 秒一轮调度生理脚本，维护同一份仿真时钟、动作队列和存档。**它不是已经完成的系统级人体模拟器；仿真单元按器官目录组织，11 个系统名只作为功能标签保留。**

截至 2026-11-21，仓库的真实状态：

| 状态 | 内容 |
| --- | --- |
| 已实现 | `gateway.js` + `gateway/` 的 HTTP、动作队列、存档、启动补算、常驻 BodyWorker；`index.js` 插件入口；`startup/reset-parts.js`；`lib/parameters.js` 的只读参数加载；身体启停与暂停恢复；P0 四个器官脚本（`organs/human-organs/stomach/` 的 `motility.ts`、`ghrelin.ts`、`gastric-sensory.ts`，`organs/human-organs/duodenum/` 的 `nutrient-exposure.ts`）；固／液餐胃排空分支（只有 `eat` 的 `mealKind: "solid"` 进入固餐小计并按 `stomach.emptying.solidHalfTimeMin` 单独排空；`drink` / `liquid` / `mixed` 与旧存档中已经入胃的存量走原算法，旧档 `mealQueue` 里尚未释放的切片仍按各自 `mealKind` 入账；代码与定向测试层面，不代替 M1 实机验收）；P1 输入契约（`drink` 可带 `energyKcal`）、体感读出 `brain/interoception.ts`、提醒策略 `brain/notify.ts`；DSH 工具 `body_act` / `body_state`（`tools.js`）与通知投递泵（`notifications.js`）；六个部位、六份同目录参数文件；器官 README、共享证据台账和重放场景；`test/` 下的测试；根清单 `body-modules.json` 已列出六条器官脚本，Gateway 启动即加载。 |
| 未实现 | 其余器官的生理脚本（食管、小肠吸收、血糖、胰岛素、心、肺、肾、膀胱等）；通知历史文件、按会话绑定与多身体路由；浏览器数据页；器官间转移、病况。 |
| M1 进行中 | 器官级 P0 + P1：胃（动力、饥饿素、机械感受）、十二指肠（营养暴露）、体感读出（`interoception`）与体感提醒（`brainNotify`）；输入契约、参数、README、证据、重放、会话工具和通知投递已就位；旧的组件/动作/读数 JSON 契约层已删除；其余 `systems/*/` 只保留 legacy 证据。 |

当前 P0/P1 的部位与信号以 `organs/human-organs/<organ>/README.md` 的表格为准，参数在 `organs/human-organs/**/*.parameters.json`，模块导出见 `organs/human-organs/**/*.ts`；设计是 `docs/superpowers/specs/2026-11-20-organ-model-design.md`，P0 实施计划是 `docs/superpowers/plans/2026-11-20-organ-model-p0.md`，P1 实施计划是 `docs/superpowers/plans/2026-11-21-p1-input-interoception.md`，固／液餐胃排空小改的设计是 `docs/superpowers/specs/2026-11-21-solid-meal-emptying-design.md`。旧的 M1 计划已标废弃。具体文件以目录和 `git status` 为准。

判断“现在到底有什么”的顺序：**代码（必要时对照测试）> `docs/gateway-and-scripts.md` > `docs/virtual-body.md` 的已实现部分 > 计划文档**。计划里的勾选框只代表计划进度，不等于产品功能。

**建模取舍。** 懂得取舍也是一种设计哲学。加字段、参数或脚本前先问三件事：谁读它？有证据吗？会不会破坏单写者、轮初快照或可替换性？没有消费者的差异不建模；没有证据的参数标 `design`/`unset`；省略的东西在 README 的“未建模”里写清楚，不能用一个不起作用的字段假装它被建模了。P0 的典型例子见设计文档 §2.1。

## 1. 最容易犯的错误（先扫一遍）

| # | 常见误解 | 实际 |
| --- | --- | --- |
| 1 | 把 `docs/virtual-body.md` 当成已实现功能清单 | 它是设计草案；开头新增的 5 条“已确认的行为契约（设计目标）”明确不是现状。当前实现以 `gateway/`、`test/` 和 `docs/gateway-and-scripts.md` 为准。 |
| 2 | 以为 11 个系统目录就是仿真层级 | 仿真单元是器官目录 `organs/human-organs/<organ>/`；`systems/` 只剩 legacy 证据，脚本以 `organs/**/*.ts` 为准；`body-modules.json` 已列出六条器官脚本。 |
| 3 | 把 `body-modules.json` 和 `body-state.json` 混为一谈 | 前者是脚本清单（开发者改），后者是一具身体的存档（Gateway 写；用户只在停机时改顶层 `active`）。 |
| 4 | 运行中改存档 `active` 想热切换 | `active` 只在启动时读一次；必须停 Gateway → 改实际 `statePath` 的顶层 `active` → 再启动。运行中改不会生效，还可能被下次保存覆盖。 |
| 5 | 把 `activeBatch` 或 `startup.active` 当启停开关 | 都不是。开关只有存档顶层 `active`；`activeBatch` 是在途批次，`startup.active` 是上次启动记录。 |
| 6 | 看到 `202 queued` 就以为动作已生效 | 202 只表示入队；动作在轮末结算。`applied` 也只表示批次提交成功，不保证模块改了领域值。 |
| 7 | 以为 `io.actions` 已按 `actionTypes` 过滤 | 它是本轮全部原始动作；模块自己检查 `type`、字段和单位。 |
| 8 | 用 `io.write({ 某个字段 })` 当补丁 | `io.write` 要交回本部位的完整下一状态；只改一项也要展开旧值。 |
| 9 | 用 `Date.now()` 或现实秒数推进仿真 | 用 `io.dt`（60）、`io.simulatedSeconds`（轮末）、`io.wallTimeMs`（预定轮末）。 |
| 10 | 把代理量、工程读数当成直接生理测量，或跨量纲换算 | 每个量写清定义、单位、时间原点和是否为代理；没有方法学依据就不互换。 |
| 11 | 把 `status: "design"` / `"fitted_dev"` 的参数当人体测量值 | 只有 `validated` 才算验证过；`design` 是工程假设，`fitted_dev` 是开发集拟合，不是独立验证。 |
| 12 | 把已看过结果的数据称为“独立验证/盲测” | 当前台账来源都是 `results_seen`；只能标 `development` / `exploratory`，没有盲法留出。 |
| 13 | 把 Pulse 的 50 Hz 共享 `Data` 架构照搬过来 | 本项目是 60 秒一轮、单写者、整轮提交；Pulse 只借方程/参数/结构，参数必须重新标定。 |
| 14 | 把“检查/测试覆盖”当成主要目标，为不可能发生的输入堆防御代码 | 这是信任环境，主要交付是把文档和代码旁说明写准确；代码改动跑一次 `npm test` 即可，不为纯文档改动补测试，也不新增过度校验。 |
| 15 | 把 `solidVolumeMl` / `solidEnergyKcal` 当作总量之外另加的一份胃内容物，或把 Vasavid 的标记固相半排空时间中位数当成胃总内容量 mL/kcal、已验证参数 | 两个小计是 `volumeMl` / `energyKcal` 总量内的固餐部分，读总量时不能再加一遍；68.7 min 是标记固相半排空时间的中位数（标记保留曲线拟合，`reported`），用在体积和能量账本上是 `design`，不能换算成 mL 或 kcal，也不是独立验证。 |
| 16 | 把旧存档的所有内容都按原算法，包括 `mealQueue` 里尚未入胃的切片 | 缺小计按 0 补齐只针对已经入胃的 `volumeMl` / `energyKcal`；`mealQueue` 切片保留原 `mealKind`，释放时 `solid` 进固餐小计，其余进非固餐组。 |
| 17 | 把 `emptiedMl` 当十二指肠或体感的直接输入，或说分组后 `interoception` 数值不变 | `emptiedMl` 只作观察与重放读数；十二指肠读 `emptiedKcal` 并滤波成 `nutrientExposure`；`interoception` 经胃充盈、饥饿素与十二指肠营养暴露间接取得信号，数值会随固／液分组后的总量与排出量变化。 |

## 2. 文档性质与事实来源

| 文档 | 性质 | 怎么用 |
| --- | --- | --- |
| `docs/gateway-and-scripts.md` | 当前实现的开发指南 | 接脚本、调 HTTP、排查状态先看它；与代码冲突时以代码为准，必要时对照测试。 |
| `docs/virtual-body.md` | 设计草案 + 设计目标 | 开头“已确认的行为契约（设计目标）”和 M1–M7 里程碑不是现状；§1 的器官层表描述当前结构。引用时必须写明“设计目标/计划”。 |
| `docs/superpowers/specs/*.md` | 设计文档（已批准） | 器官级结构的依据；与计划冲突时以设计文档为准。 |
| `docs/superpowers/plans/*.md` | 实施计划 | `- [x]` 才算完成；未勾选=未交付。旧的 M1 计划顶部已标废弃；当前是 P0 `2026-11-20-organ-model-p0.md` 与 P1 `2026-11-21-p1-input-interoception.md`。 |
| `organs/human-organs/<organ>/README.md` | 当前器官脚本、字段与证据入口 | P0/P1 的部位、字段、单位和代理口径以这里为准；体感在 `brain/README.md`。 |
| `systems/*/README.md` | 未迁移的系统资料入口（legacy） | 顶部标 legacy，不是实现，也不代表该系统的脚本已存在。 |
| `organs/human-organs/references/` | 共享证据台账与字段字典 | 科学口径以 `source-index.csv`、`m1-data-dictionary.md` 为准。 |
| `systems/**/references/` | 未迁移的旧证据台账与笔记（legacy） | 只作历史资料，随对应器官实现时迁移。 |
| `organs/human-organs/**/*.parameters.json` | 器官参数证据默认值 | 保留 `unit`、`status`、`source`、`range`；由 `lib/parameters.js` 只读加载，不是某具身体的最终值。`systems/` 已不再有参数文件；旧的 `systems/nervous/interoception.parameters.json` 已迁到 `brain/` 并裁剪。 |
| `docs/reference/pulse-engine.md` | 外部参考实现笔记 | 只借方程、参数、结构；`docs/reference/pulse-engine/` 是本地浅克隆，已被 gitignore，不要提交。 |
| `.tower/`、`.superpowers/` | 代理工作流产物 | 已 gitignore；`.tower/comms/` 由工具生成，不要手改。 |

## 3. Gateway 运行约束

- **一具身体一份存档。** `statePath` 默认 `$DSH_HOME/dsh-body/body-state.json`（通常是 `~/.dsh/dsh-body/body-state.json`）。目标存档不存在时，Gateway 会尝试接续清单同目录的 `body-state.json`；仓库根目录的 `body-state.json` 被 gitignore，不一定是 DSH 正在写的那份。不要为每个器官另建存档。
- **清单不是存档。** `body-modules.json` 声明 `scripts`、`startupScripts`、`catchUpMinutes`（默认 720）、`scriptTimeoutMs`（默认 10000）；`body-state.json` 保存快照、时钟、动作、通知和在途批次。不要把两者合并，也不要用只有 `active` 的片段覆盖整份存档。
- **60 秒一轮，与现实 1:1。** 每轮推进 60 仿真秒；成功提交才推进。正常停机启动时按 `catchUpMinutes` 补算；显式暂停恢复不补算暂停时长。电脑休眠后唤醒会追赶所有到期轮次，是否与 12 小时上限共用仍待定。
- **`active` 只在启动时读一次。** 暂停步骤：停 Gateway → 只改实际 `statePath` 顶层 `active` 为 `false` → 再启动。运行中改文件不会热切换，还可能被下次保存覆盖。`activeBatch` 是已锁定待完成的批次，`startup.active` 是上次启动记录，都不是开关。旧 v1/v2 缺 `active` 按 `true`；非法值拒绝启动且不回写。
- **动作是异步结算的。** `POST /actions` 的 `202 queued` 只表示入队；动作在轮末生效。同 `id` 同载荷重试返回原回执（可能已是 `applied`）；同 `id` 不同载荷 `409`；启用时无处理者 `422`；暂停时新动作 `409`。`applied` 只表示所在批次提交成功，不保证领域值变化。
- **整轮全有或全无。** 所有模块读同一份轮初快照；任一脚本报错/超时，整轮暂存的状态和通知丢弃，保留已提交快照和 `activeBatch`，下次用同一批次重试。执行中收到的新动作进入后续轮次。
- **当前 HTTP 面。** `GET /state` 只返回 `{ simulatedSeconds, parts }`；`GET /actions/:id` 查动作；`GET /capabilities` 查动作类型→模块；`GET /health` 查实际 `active`、时钟和失败；`GET /notifications` / `POST /notifications/ack` 查/确认通知。默认 `127.0.0.1:3210`，无 token，只服务本地。请求体上限 64 KiB，存档默认上限 2 MiB，非 GET 会校验 `Host` / `Origin`。
- **DSH 工具与通知。** `index.js` 通过 `ctx.tools.register` 注册 `body_act` / `body_state`：前者把动作连同 `sessionId` 入队，后者读最近提交的快照。`notifications.js` 每 1000 ms 轮询 Gateway 待确认通知：`context` 用 `agent.inject`、`wake` 用 `agent.followup`，投递成功后 ACK；会话不在线时保留。`brain/notify.ts` 负责显著性、滞回、45 min 冷却和每会话每小时 2 次/每天 6 次的上限，阈值与次数都是 `policy`，不是人体测量。
- **没有的东西不要假装有。** 当前没有热切换、多身体路由、按会话绑定不同身体、通知历史文件、浏览器页、器官间转移、病况。这些在 `docs/virtual-body.md` 里是设计或里程碑。

## 4. 写模块时的契约

模块是 ESM 具名导出：

| 导出 | 要求 |
| --- | --- |
| `id` | 唯一、稳定的 camelCase 部位键；改名会被视为新部位。 |
| `initialState` | 本部位初值，默认 `{}`；只补缺失键，不每次重置。 |
| `fields` | 本部位字段声明；每个字段写 `unit` 与 `mode`（`absolute`/`additive`），规则见 `docs/gateway-operations.md`；不能省略，只做 `io.write` 的模块也要 `export const fields = {};`。 |
| `actionTypes` | 能处理的动作名数组，默认 `[]`；不是过滤器。 |
| `heartbeat(io)` | 每轮入口，可同步或异步；返回值不作为输出。 |
| `initialize(snapshot, context)` | 仅启动脚本；同步；返回按部位 ID 分组的字段补丁，不是整部位对象。 |

一个器官目录可以放多个脚本（例如 `stomach/` 有 `motility.ts`、`ghrelin.ts`、`gastric-sensory.ts`）；目录只是分组，不参与 Gateway 寻址。部位 id 由脚本导出，不要求等于目录名，例如 `ghrelin.ts` 导出 `stomachGhrelin`、`gastric-sensory.ts` 导出 `stomachSensory`。器官 README 的脚本表列出目录内每个脚本的部位 id。

**目录归器官，脚本按功能拆，系统是标签。** 同一器官的功能或反应分属不同系统时，若各有独立的状态、调节或信号消费者，可拆成独立脚本。例如下丘脑可把调节 ADH 的神经内分泌脚本与产生口渴驱动的神经脚本分开（设计示例，尚未实现）；两者可读同一个体液信号，但各自只写负责的量。新增脚本时在器官 README 写清功能标签、读入与产出；不恢复 `systems/` 运行目录，也不按标签复制同一份状态或计算。

`io` 的关键语义：

| 接口 | 语义 |
| --- | --- |
| `io.read()` / `io.read(id)` | 读轮初快照/指定部位；只读，不要原地改。 |
| `io.write(nextPart)` | 暂存本部位的完整下一状态，不是补丁。只改一项也要 `{ ...prev, 字段: 新值 }`。 |
| `io.functions[alias]()` | 读清单 `inject` 声明的轮初状态；缺失返回 `undefined`。 |
| `io.actions` | 本轮全部原始动作，不按 `actionTypes` 过滤；自己检查 `type`、字段和单位。 |
| `io.notify({ mode, sessionId, text })` | 暂存通知；在线轮次提交后由 `notifications.js` 投递到对应会话；启动补算产生的通知仍然直接丢弃。 |
| `io.dt` / `io.simulatedSeconds` / `io.wallTimeMs` | 60 秒 / 轮末仿真时刻 / 预定轮末现实时间戳。不要用 `Date.now()` 猜时间。 |

代码约束：

- Node ≥ 22.18，ESM，无第三方依赖；本地 `.ts` 由 Node 直接类型擦除。
- 只用可擦除语法：`type`、`interface`、类型标注；不要 `enum`、含运行时值的 `namespace`、参数属性、装饰器。相对导入带扩展名。
- 状态必须 JSON-safe：普通对象/数组/有限数字/字符串/布尔/`null`；不要 `undefined`、`NaN`、`Infinity`、`BigInt`、`Map`、`Set`、稀疏数组、循环引用；部位最外层必须是对象。
- 一个量只有一个写入者；其他部位只读。器官间转移是同一轮的两个写入，必须同时提交或同时作废。
- `package.json` 的 `files` 已包含 `organs/` 与 `lib/`；发布物包含器官脚本、同目录参数文件和参数加载库。
- **脚本必须标注来源。** 每个生理脚本头部写清它依赖的 `source_id` / citekey、证据笔记路径、原文定位（摘要 Results、Table、Methods 等），以及该来源支撑的是哪个方程、参数或方向性假设。没有直接来源的工程假设要写 `design` 并说明边界；参数文件里的 `source` 仍然保留，脚本注释负责解释“哪条方程/假设来自哪里、哪些不是”。不要只写论文标题或 DOI 而丢掉限制。

### 脚本通用性与参数归属

- **脚本只写通用模型。** 方程、动作解析、状态推进和单位处理放脚本；不写具体餐、具体人或具体场景，也不把可调参数写成魔法数。场景输入留在 `scenarios/` 和 action payload。
- **可调参数进组件自己的 `*.parameters.json`。** 会随个体、研究或标定变化的量（半衰期、基线、增益、参考量、时间常数等）都放这里，保留 `unit`、`status`、`source`、`range`；脚本不再重复写一份默认值。只有真正全人类一致、不随个体、研究或标定条件变化的常数才允许留在脚本里；拿不准就放参数文件，宁可多一个 `unset`。轮长用 `io.dt`，不要写 `60`。
- **个体差异是单独一层。** 年龄、身高、体重、器官倍率和个体化参数属于身体预设/运行时覆盖，不写回证据参数文件；参数文件是证据默认值，不是某具身体的最终值。
- **参数按启动期读取。** 参数变更不做运行中热切换。只读通道是 `lib/parameters.js`：`loadParameters(parametersUrl)` 读 `*.parameters.json` 并返回 `{ [参数 ID]: 值 }`（`null` 表示 `unset`），校验 `schemaVersion`、`owner` 前缀与 `unset`/`null` 对应；`requireParameter(values, id)` 在值为 `null` 时抛出带参数 ID 的错误。模块在 import 时用 `loadParameters(new URL('./x.parameters.json', import.meta.url))` 读自己的参数。参数文件跟随器官脚本放在同一目录。Gateway 不替模块读参数，`body-modules.json` 仍只声明脚本和 `inject`；参数文件是证据默认值，不是某具身体的最终值。

## 5. 量与单位的通用规则

- **每个量写清四件事：** 定义、单位、时间原点，以及它是状态、通量、读数还是代理。名字不能代替定义。
- **代理量不是实测。** 用归一化值、内容量或速率做代理时，在字段说明里写明“代理”；不要把它写成张力、浓度、吸收量或神经放电。
- **不跨量纲换算。** 没有方法学依据时，不要把百分比、体积、时间、相对浓度、评分互相换算；需要换算就单独写方法和假设。
- **参数状态是证据等级。** `unset` = 未定；`design` = 工程假设；`prior` = 文献先验；`fitted_dev` = 开发集拟合；`validated` = 已验证；`rejected` = 弃用。`design` / `fitted_dev` 不是人体测量值；`validated` 必须有来源。
- **缺失值不用 0 代替。** 未报告、未询问、未测到都写 `NA` 或 `null`，并给原因；0 是一个真实观测。
- **离线拟合不等于实机验收。** 离线重放通过只说明模型自洽；只有真实 DSH 会话里的动作、通知、重启恢复都核对过，才能说该里程碑验收通过。
- 具体 M1 的体感口径、量纲边界和证据要求写在 `docs/superpowers/specs/2026-11-20-organ-model-design.md`、`organs/human-organs/<organ>/README.md` 和 `organs/human-organs/references/` 里；本文件不重复这些细节。

## 6. 证据与来源（通用）

- 研究资料放在负责该指标的器官 `references/` 下；一篇论文一份笔记。未迁移的旧资料留在 `systems/<system>/references/`，顶部标 legacy，只链接路径，不复制数据或原图。
- 共享登记簿是 `organs/human-organs/references/source-index.csv`；`source_id` / `citekey` 一经分配不改，具体字段和取数规则见 `organs/human-organs/references/m1-data-dictionary.md`。
- 每条记录写清来源、人群、刺激、测量、单位、时间原点、统计量和原文定位。缺失写 `NA` 并给原因；不猜 DOI、单位、分母或时间原点。
- 原值保留原单位，换算值另列；均值/中位数/个体值分开，`SD` / `SEM` / `P95` / `range` / `CI95` 不互换。
- 一批受试者只算一个队列：交叉设计的多个臂、重复发表、同一批人的不同时点不能拆到标定和验证两边。
- 已看过结果的数据只能标 `development` / `exploratory`，不能称独立验证或盲测；当前台账来源均为 `results_seen`。
- `parameters.json` 中 `prior` / `fitted_dev` / `validated` 必须有 `source`，且是已登记 ID 或 `pending:<citekey>`；`unset` 的值必须为 `null`。
- 通知的显著性阈值、冷却时间、每小时/每天次数上限是 `policy`，不是人体测量；有定性灵感也要在脚本和 README 写明“不是论文参数”，不能写成生理常数。

## 7. 工程与测试

- 运行环境：Node ≥ 22.18，ESM，无第三方依赖。不要为了一个功能引入库；先看 `package.json` 和现有 import。
- **验证按需、从简。** 代码改动跑一次 `npm test`（即 `node --test`）即可，不必为每个改动新增测试；纯文档改动不必跑测试。不要把“补检查”当成主要工作。
- 需要写测试时，用 `test-support/harness.mjs` 的 `launch(t, { modules, ... })` 起真实 Gateway（端口 0、临时目录、`autoTick: false`），用固定 `now`，不要依赖真实 `Date.now()` 抖动。
- 模块或参数文件改动后跑一次 `npm test` 即可；`test/parameters.test.mjs` 已经覆盖六份器官参数文件的格式一致性，不需要再补一套重复校验。
- 不要创建仓库根目录的 `body-state.json` 来“测试”；测试用临时目录。`body-state.json`、`body-state.json.tmp`、`docs/reference/pulse-engine/` 都已 gitignore。
- 提交前扫一眼 `git status`，删掉测试产生的临时文件；不要把 `.tower/`、`.superpowers/`、日志或个人存档加入提交。
- 如果新增运行时文件，检查 `package.json` 的 `files`；`files` 已包含 `organs/` 与 `lib/`（另有 `index.js`、`gateway.js`、`gateway/`、`json-safe.js`、`body-modules.json`、`startup/`、`cordis.patch.yml`）。打包时脚本、同目录参数文件和 `lib/parameters.js` 要一起发布。

## 8. 文档与协作

- 文档用中文；先给结论，再用表格/短段落展开。路径、命令、接口名用反引号。
- 区分三类数值：`reported`（论文直接报告）、`derived`（本项目推算/读图）、`policy`（工程或提醒策略）。不要把 `policy` 写成生理事实。
- 不要把设计目标写成已实现。用“设计目标”“计划”“尚未实现”“当前实现”明确标注；引用 `docs/virtual-body.md` 时尤其注意。
- 计划里的 `- [x]` 只在有代码、测试或实际验收证据时勾选；未交付就保持 `- [ ]`。不要为了让计划“看起来完整”而勾选。
- **文档是主要交付物。** 接口、状态、量纲、证据边界写清楚，比补大量检查更有价值；不要为了“更安全”引入复杂的 schema、权限或风控层。
- 改了本文提到的路径、命令、契约或状态字段，同步更新 `AGENTS.md` 和相关文档；扫一遍旧文案是否还成立。
- **代理代仓库所有者提交和推送时，使用 `P-A-N-52`。** GitHub 推送账号、Git 作者和提交者都用此用户名；署名邮箱用 `233015466+P-A-N-52@users.noreply.github.com`。不要使用真实姓名、私人邮箱或 Git 自动推断的本机身份。
- **提交前核对署名。** 用 `git var GIT_AUTHOR_IDENT` 和 `git var GIT_COMMITTER_IDENT` 检查实际生效的身份；需要调整时只改本仓库的 `git config --local`，不要改全局配置。公开仓库或推送已有提交前，还要检查将发布的提交本身的署名。未经用户明确授权，不改写已发布的历史或强制推送。

## 9. 开工前清单

1. 先判断是文档还是代码：纯 Markdown 文档可直接编辑；代码、脚本、测试、配置和 JSON 契约走 tower mission 或 swarm。不同类别的事实来源也不同。
2. 对“当前行为”，读代码（必要时对照测试）；对“怎么用”，读 `docs/gateway-and-scripts.md`；对“为什么这样设计”，读 `docs/virtual-body.md`、`docs/superpowers/specs/` 和计划；对“科学口径”，读 `organs/human-organs/references/` 与各器官 README。
3. 确认要动的东西是否已存在：以 `organs/human-organs/**/*.ts`、`organs/human-organs/**/*.parameters.json` 和器官 README 表为准；`systems/` 只剩 legacy 证据；不要把一个计划中的模块当成可改的实现。
4. 做最小改动，保持现有命名、单位、JSON 形状和单写者模型。
5. 代码改动跑一次 `npm test`；纯文档改动不必跑。不要为了小改动新增测试或依赖。
6. 提交前扫一眼 `git status`，清理临时文件；在最终回复里区分“已实现/已验证”和“仍是计划”。
7. 加字段、参数或脚本前，先过 §0 的取舍三问；没有消费者的差异不建模，没有证据的参数标 `design`/`unset`，省略的项写进 README 的“未建模”。
8. 写或改生理脚本时，同步更新脚本头部的来源注释：`source_id`、笔记路径、原文定位、支撑的方程/参数、以及不能推出的内容；没有直接来源的部分明确标 `design`。
