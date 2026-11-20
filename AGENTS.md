# AGENTS.md

> 给在本仓库工作的模型/代理：先读完本文件，再读具体文档。这里只写最容易误判的事实、硬约束和事实来源；细节由链接的文档展开。

**工作原则：这是一个信任环境。文档优先，检查从简。** 不要为了防御不可能发生的输入增加大量校验，也不要把测试或检查当成主要交付物；把 `docs/`、`organs/**/README.md`、`systems/**/README.md` 和本文件写准确、写清楚，比堆检查更重要。代码改动跑一次 `npm test` 确认没有破坏现有行为即可；纯文档改动不必跑测试。

**改动分流：纯 Markdown 文档可直接编辑；代码改动走 tower mission。** `AGENTS.md`、`docs/`、`organs/**/README.md`、`systems/**/README.md`、计划与笔记都算文档；`.js`、`.ts`、`test/`、配置和 `*.parameters.json` 算代码。代码改动先建 mission，在 `.tower/worktrees/` 里由 worker 完成，再 review/merge；不要用通用 `Agent` 冒充 tower worker。tower 的 mission 工具不可用时，先说明并停在计划层。

## 0. 一句话与当前阶段

`dsh-body` 是一个 DSH 插件：在宿主进程里运行一具虚拟身体的 Gateway，按 60 秒一轮调度生理脚本，维护同一份仿真时钟、动作队列和存档。**它不是已经完成的 11 系统人体模拟器；仿真单元按器官目录组织，11 个系统名只作为功能标签保留。**

截至 2026-11-21，仓库的真实状态：

| 状态 | 内容 |
| --- | --- |
| 已实现 | `gateway.js` + `gateway/` 的 HTTP、动作队列、存档、启动补算、常驻 BodyWorker；`index.js` 插件入口；`startup/reset-parts.js`；`lib/parameters.js` 的只读参数加载；身体启停与暂停恢复；P0 四个器官脚本（`organs/human-organs/stomach/` 的 `motility.ts`、`ghrelin.ts`、`gastric-sensory.ts`，`organs/human-organs/duodenum/` 的 `nutrient-exposure.ts`）及同目录四份参数文件；器官 README、共享证据台账和重放场景；`test/` 下的测试。 |
| 未实现 | 11 个功能标签的完整生理脚本（目前只有 P0 的胃与十二指肠）；根清单 `body-modules.json` 的 `scripts` 仍为 `[]`，Task 8 之后才启用真实身体；`body_act` / `body_state` 会话工具；通知到 DSH 的实际投递；浏览器数据页；多身体、会话绑定、器官间转移、病况。 |
| M1 进行中 | 器官级 P0：胃（动力、饥饿素、机械感受）与十二指肠（营养暴露）的脚本、参数、README、证据和重放已就位；旧的组件/动作/读数 JSON 契约层已删除；其余 `systems/*/` 只保留 legacy 证据。 |

当前 P0 的部位与信号以 `organs/human-organs/<organ>/README.md` 的表格为准，参数在 `organs/human-organs/**/*.parameters.json`，模块导出见 `organs/human-organs/**/*.ts`；设计是 `docs/superpowers/specs/2026-11-20-organ-model-design.md`，实施计划是 `docs/superpowers/plans/2026-11-20-organ-model-p0.md`。旧的 M1 计划已标废弃。具体文件以目录和 `git status` 为准。

判断“现在到底有什么”的顺序：**代码（必要时对照测试）> `docs/gateway-and-scripts.md` > `docs/virtual-body.md` 的已实现部分 > 计划文档**。计划里的勾选框只代表计划进度，不等于产品功能。

## 1. 最容易犯的错误（先扫一遍）

| # | 常见误解 | 实际 |
| --- | --- | --- |
| 1 | 把 `docs/virtual-body.md` 当成已实现功能清单 | 它是设计草案；开头新增的 5 条“已确认的行为契约（设计目标）”明确不是现状。当前实现以 `gateway/`、`test/` 和 `docs/gateway-and-scripts.md` 为准。 |
| 2 | 以为 11 个系统目录就是仿真层级 | 仿真单元是器官目录 `organs/human-organs/<organ>/`；`systems/` 只剩 legacy 证据，脚本以 `organs/**/*.ts` 为准；`body-modules.json` 的 `scripts` 在 Task 8 前仍是 `[]`。 |
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

## 2. 文档性质与事实来源

| 文档 | 性质 | 怎么用 |
| --- | --- | --- |
| `docs/gateway-and-scripts.md` | 当前实现的开发指南 | 接脚本、调 HTTP、排查状态先看它；与代码冲突时以代码为准，必要时对照测试。 |
| `docs/virtual-body.md` | 设计草案 + 设计目标 | 开头“已确认的行为契约（设计目标）”和 M1–M7 里程碑不是现状；§1 的器官层表描述当前结构。引用时必须写明“设计目标/计划”。 |
| `docs/superpowers/specs/*.md` | 设计文档（已批准） | 器官级结构的依据；与计划冲突时以设计文档为准。 |
| `docs/superpowers/plans/*.md` | 实施计划 | `- [x]` 才算完成；未勾选=未交付。旧的 M1 计划顶部已标废弃，当前 P0 计划是 `2026-11-20-organ-model-p0.md`。 |
| `organs/human-organs/<organ>/README.md` | 当前器官脚本、字段与证据入口 | P0 的部位、字段、单位和代理口径以这里为准。 |
| `systems/*/README.md` | 未迁移的系统资料入口（legacy） | 顶部标 legacy，不是实现，也不代表该系统的脚本已存在。 |
| `organs/human-organs/references/` | 共享证据台账与字段字典 | 科学口径以 `source-index.csv`、`m1-data-dictionary.md` 为准。 |
| `systems/**/references/` | 未迁移的旧证据台账与笔记（legacy） | 只作历史资料，随对应器官实现时迁移。 |
| `organs/human-organs/**/*.parameters.json` | 器官参数证据默认值 | 保留 `unit`、`status`、`source`、`range`；由 `lib/parameters.js` 只读加载，不是某具身体的最终值。`systems/nervous/interoception.parameters.json` 是唯一留在 `systems/` 的参数文件，属 legacy，仍被 `test/parameters.test.mjs` 校验。 |
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
- **没有的东西不要假装有。** 当前没有热切换、多身体路由、按会话绑定、`body_act` / `body_state` 工具、通知自动投递到 DSH、浏览器页、器官间转移、病况。这些在 `docs/virtual-body.md` 里是设计或里程碑。

## 4. 写模块时的契约

模块是 ESM 具名导出：

| 导出 | 要求 |
| --- | --- |
| `id` | 唯一、稳定的 camelCase 部位键；改名会被视为新部位。 |
| `initialState` | 本部位初值，默认 `{}`；只补缺失键，不每次重置。 |
| `actionTypes` | 能处理的动作名数组，默认 `[]`；不是过滤器。 |
| `heartbeat(io)` | 每轮入口，可同步或异步；返回值不作为输出。 |
| `initialize(snapshot, context)` | 仅启动脚本；同步；返回按部位 ID 分组的字段补丁，不是整部位对象。 |

一个器官目录可以放多个脚本（例如 `stomach/` 有 `motility.ts`、`ghrelin.ts`、`gastric-sensory.ts`）；目录只是分组，不参与 Gateway 寻址。部位 id 由脚本导出，不要求等于目录名，例如 `ghrelin.ts` 导出 `stomachGhrelin`、`gastric-sensory.ts` 导出 `stomachSensory`。器官 README 的脚本表列出目录内每个脚本的部位 id。

`io` 的关键语义：

| 接口 | 语义 |
| --- | --- |
| `io.read()` / `io.read(id)` | 读轮初快照/指定部位；只读，不要原地改。 |
| `io.write(nextPart)` | 暂存本部位的完整下一状态，不是补丁。只改一项也要 `{ ...prev, 字段: 新值 }`。 |
| `io.functions[alias]()` | 读清单 `inject` 声明的轮初状态；缺失返回 `undefined`。 |
| `io.actions` | 本轮全部原始动作，不按 `actionTypes` 过滤；自己检查 `type`、字段和单位。 |
| `io.notify({ mode, sessionId, text })` | 暂存通知；当前只到待确认队列，启动补算产生的通知直接丢弃。 |
| `io.dt` / `io.simulatedSeconds` / `io.wallTimeMs` | 60 秒 / 轮末仿真时刻 / 预定轮末现实时间戳。不要用 `Date.now()` 猜时间。 |

代码约束：

- Node ≥ 22.18，ESM，无第三方依赖；本地 `.ts` 由 Node 直接类型擦除。
- 只用可擦除语法：`type`、`interface`、类型标注；不要 `enum`、含运行时值的 `namespace`、参数属性、装饰器。相对导入带扩展名。
- 状态必须 JSON-safe：普通对象/数组/有限数字/字符串/布尔/`null`；不要 `undefined`、`NaN`、`Infinity`、`BigInt`、`Map`、`Set`、稀疏数组、循环引用；部位最外层必须是对象。
- 一个量只有一个写入者；其他部位只读。器官间转移是同一轮的两个写入，必须同时提交或同时作废。
- `package.json` 的 `files` 需要包含 `organs/` 与 `lib/`（P0 的 Task 8 补上）；在此之前发布物里没有器官脚本、参数文件或参数加载库。

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

## 7. 工程与测试

- 运行环境：Node ≥ 22.18，ESM，无第三方依赖。不要为了一个功能引入库；先看 `package.json` 和现有 import。
- **验证按需、从简。** 代码改动跑一次 `npm test`（即 `node --test`）即可，不必为每个改动新增测试；纯文档改动不必跑测试。不要把“补检查”当成主要工作。
- 需要写测试时，用 `test-support/harness.mjs` 的 `launch(t, { modules, ... })` 起真实 Gateway（端口 0、临时目录、`autoTick: false`），用固定 `now`，不要依赖真实 `Date.now()` 抖动。
- 模块或参数文件改动后跑一次 `npm test` 即可；`test/parameters.test.mjs` 已经覆盖四份器官参数文件与 `systems/nervous/interoception.parameters.json` 这份 legacy 参数文件的格式一致性，不需要再补一套重复校验。
- 不要创建仓库根目录的 `body-state.json` 来“测试”；测试用临时目录。`body-state.json`、`body-state.json.tmp`、`docs/reference/pulse-engine/` 都已 gitignore。
- 提交前扫一眼 `git status`，删掉测试产生的临时文件；不要把 `.tower/`、`.superpowers/`、日志或个人存档加入提交。
- 如果新增运行时文件，检查 `package.json` 的 `files`；当前只发布 `index.js`、`gateway.js`、`gateway/`、`json-safe.js`、`body-modules.json`、`startup/`、`cordis.patch.yml`，P0 的 Task 8 会把 `organs/` 与 `lib/` 加进去。打包器官脚本时，脚本、同目录参数文件和 `lib/parameters.js` 要一起进 `files`。

## 8. 文档与协作

- 文档用中文；先给结论，再用表格/短段落展开。路径、命令、接口名用反引号。
- 区分三类数值：`reported`（论文直接报告）、`derived`（本项目推算/读图）、`policy`（工程或提醒策略）。不要把 `policy` 写成生理事实。
- 不要把设计目标写成已实现。用“设计目标”“计划”“尚未实现”“当前实现”明确标注；引用 `docs/virtual-body.md` 时尤其注意。
- 计划里的 `- [x]` 只在有代码、测试或实际验收证据时勾选；未交付就保持 `- [ ]`。不要为了让计划“看起来完整”而勾选。
- **文档是主要交付物。** 接口、状态、量纲、证据边界写清楚，比补大量检查更有价值；不要为了“更安全”引入复杂的 schema、权限或风控层。
- 改了本文提到的路径、命令、契约或状态字段，同步更新 `AGENTS.md` 和相关文档；扫一遍旧文案是否还成立。

## 9. 开工前清单

1. 先判断是文档还是代码：纯 Markdown 文档可直接编辑；代码、脚本、测试、配置和 JSON 契约走 tower mission。不同类别的事实来源也不同。
2. 对“当前行为”，读代码（必要时对照测试）；对“怎么用”，读 `docs/gateway-and-scripts.md`；对“为什么这样设计”，读 `docs/virtual-body.md`、`docs/superpowers/specs/` 和计划；对“科学口径”，读 `organs/human-organs/references/` 与各器官 README。
3. 确认要动的东西是否已存在：以 `organs/human-organs/**/*.ts`、`organs/human-organs/**/*.parameters.json` 和器官 README 表为准；`systems/` 只剩 legacy 证据；不要把一个计划中的模块当成可改的实现。
4. 做最小改动，保持现有命名、单位、JSON 形状和单写者模型。
5. 代码改动跑一次 `npm test`；纯文档改动不必跑。不要为了小改动新增测试或依赖。
6. 提交前扫一眼 `git status`，清理临时文件；在最终回复里区分“已实现/已验证”和“仍是计划”。
