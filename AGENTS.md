# AGENTS.md

> 给在本仓库工作的模型/代理：这里只保留最容易误判的事实、硬约束和事实来源；实现细节以代码及链接文档为准。

**工作原则：信任环境，文档优先，检查从简。** 不为不可能发生的输入堆防御代码，不把测试覆盖当成主要交付物。代码改动后跑一次 `npm test`；纯文档改动不必跑测试。

**遇到问题，先停下来问用户。** 需求不明确、指令冲突、执行遇到意外或下一步需要用户决定时，不自行猜测。完全自动权限模式下不调用 `AskUserQuestion`，直接在聊天中说明问题并结束本轮；工具自动获批不等于用户已确认决定。

**改动分流：纯 Markdown 文档可直接编辑；代码改动走 tower mission 或 swarm。** 文档包括 `AGENTS.md`、`docs/`、器官/系统 README、计划与笔记；`.js`、`.ts`、`test/`、配置和 `*.parameters.json` 算代码。代码优先由 tower worker 在 `.tower/worktrees/` 完成并 review/merge；swarm 下按可独立验证的分片使用 `AgentSwarm`。不要用单个通用 `Agent` 冒充 tower worker；两者都不可用时，说明阻塞并停在计划层。

**资料搜集默认交给只读子代理。** 按独立问题交代范围、原文出处和证据边界；子代理回报定位、结论与不确定性，主代理归纳并复核关键证据。Tower 用只读 `survey` mission，非 Tower 按授权用 Swarm 或只读子代理；已知路径上的事实核对不必另派，派工入口不可用时不要绕过模式自行大范围搜索。

## 0. 项目与当前阶段

`dsh-body` 是 DSH 插件：在宿主进程中运行虚拟身体 Gateway，每 60 秒调度一轮生理脚本，维护统一的仿真时钟、动作队列和存档。**它不是已完成的系统级人体模拟器；仿真单元按器官目录组织，11 个系统名只作功能标签。**

- **M1 已完成：** 器官级 P0/P1，包括胃动力/饥饿素/机械感受、十二指肠营养暴露、体感与提醒、`body_act` / `body_state`、通知投递及真实 DSH 会话验收。
- **M3 进行中：** 水链首段已接入根清单，并有膀胱过度充盈非自主排空、`interoception.discomfort` 和可选 DI 样变体。根清单当前是正常 12 部位；DI 变体只能经独立清单和独立存档显式加载。
- **尚未实现：** 其余器官与转移链、血浆/尿渗透压、电解质、血容量/血压、RAAS、汗液与不感蒸发、通知历史、多身体路由、浏览器页和病况系统。大负荷利尿仍不匹配，口咽解渴未建；睡眠、糖代谢与排便调研均为 defer，不是已批准任务。
- **验收边界：** Task 10 只覆盖 30 轮水链/主动排尿会话，M19 只覆盖 2–5 轮后加功能短会话；Task 11 是后加功能合并前的历史性能基线。它们都不代表当前 HEAD 已完成 120 轮长时程、通知/重启组合、大负荷利尿或性能验收。

现状判断顺序：**代码（必要时对照测试）> `docs/gateway-and-scripts.md` > `docs/virtual-body.md` 的已实现部分 > 计划文档**。计划勾选不等于产品功能；具体文件以目录和 `git status` 为准。

**建模取舍。** 新增字段、参数或脚本前先问：谁读它？有证据吗？会不会破坏单写者、轮初快照或可替换性？没有消费者的差异不建模；无证据参数标 `design` / `unset`；省略项写入对应 README 的“未建模”。

## 1. 最容易犯的错误

| 常见误解 | 实际 |
| --- | --- |
| 把 `docs/virtual-body.md` 当功能清单 | 它是设计草案；当前行为以代码、测试和 `docs/gateway-and-scripts.md` 为准。 |
| 把 `systems/` 当运行层级 | 脚本在 `organs/**`；`systems/` 只剩 legacy 证据。 |
| 混淆清单、存档和启停开关 | `body-modules.json` 是脚本清单，`body-state.json` 是身体存档；只有存档顶层 `active` 控制启停，`activeBatch` / `startup.active` 都不是开关。 |
| 运行中改 `active` 热切换 | `active` 只在启动时读取；须停 Gateway、改实际 `statePath`、再启动。 |
| 把 `202 queued` 或 `applied` 当领域值已改变 | queued 只表示入队；applied 只表示批次提交成功，不保证模块修改领域值。 |
| 把 `io.write` 当补丁，或以为 `io.actions` 已过滤 | `io.write` 交回本部位完整下一状态；`io.actions` 含本轮全部原始动作，模块自行检查。 |
| 用现实时间推进仿真 | 使用 `io.dt`、`io.simulatedSeconds`、`io.wallTimeMs`，不要用 `Date.now()` 猜仿真时间。 |
| 把代理量或 `design` / `fitted_dev` 参数当实测、独立验证 | 代理量不跨量纲换算；只有具备独立验证来源的 `validated` 才能称已验证。 |
| 把固餐小计或胃水当总量之外的第二份内容物 | `solidVolumeMl` / `solidEnergyKcal` 是总量内固餐子集，`waterVolumeMl` 是非固餐水子集；水量转移读 `emptiedWaterMl`，不是 `emptiedMl`。 |
| 同时加载 `motility.ts` 与 `hydration.ts` | 两者都导出 `id: "stomach"`，同一清单不能同时出现；水链接口的下游配对要求见胃 README 和水链设计。 |
| 重复累计排尿或把工程阈值临床化 | `voidedMl = voluntaryVoidedMl + involuntaryVoidedMl`，水账只累计一次；600 mL、70 mm、410 mL 等都是 `design` 工程量，不是临床阈值。 |
| 把 `discomfort` 当疼痛总分或提醒触发 | 它只是四种感受超过 70 mm 后的最大强度代理；`brainNotify` 仍只读饥饿/饱满。 |
| 把 DI 样代理当默认病理或临床诊断 | 默认身体不加载 DI；变体与正常入口同 id，不能同时加载，4 mL/min 只是 `design` 代理。 |
| 把历史会话或 12 部位基线外推成当前版本、几十模块的结论 | 性能与实机验收必须按当前 HEAD、同环境同口径重测；历史结果的范围见 §0 和 M3 设计文档。 |
| 照搬 Pulse 的 50 Hz 共享 `Data` 架构 | 本项目是 60 秒一轮、单写者、整轮提交；只借方程/参数/结构，参数须重新标定。 |

旧存档固餐切片、各字段口径和特定论文队列的限制，以对应器官 README、证据笔记和设计文档为准，不在本文件重复。

## 2. 文档性质与事实来源

| 来源 | 用途 |
| --- | --- |
| `docs/gateway-and-scripts.md` | 当前实现与使用指南；与代码冲突时以代码为准。 |
| `docs/virtual-body.md` | 设计草案与目标；引用时明确标“设计目标/计划”。 |
| `docs/superpowers/specs/*.md` | 已批准设计及验收边界；与计划冲突时以设计为准。 |
| `docs/superpowers/plans/*.md` | 实施进度；只有实际交付才能勾选。旧 M1 计划已废弃。 |
| `organs/human-organs/<organ>/README.md`、`organs/human-compartments/<compartment>/README.md` | 部位脚本、字段、单位、代理口径和证据入口。 |
| `organs/**/references/` | 共享证据台账与字段字典；科学口径以 `source-index.csv`、`m1-data-dictionary.md` 为准。 |
| `organs/**/*.parameters.json` | 证据默认值，保留 `unit`、`status`、`source`、`range`；不是某具身体的最终值。 |
| `systems/*/README.md`、`systems/**/references/` | legacy 资料，不代表已有运行脚本。 |

P0/P1、固液餐、水链、过度充盈/不适和 DI 的设计与计划集中在 `docs/superpowers/`；Task 10/11、M19 的详细数据及仓库外证据路径见对应文档。`docs/reference/pulse-engine.md` 只是外部实现笔记，本地浅克隆不得提交。

## 3. Gateway 运行约束

- **一具身体一份存档。** 默认 `statePath` 是 `$DSH_HOME/dsh-body/body-state.json`；目标不存在时可接续清单同目录存档。不要为每个器官另建存档，也不要用只有 `active` 的片段覆盖整份存档。
- **60 秒一轮，成功提交才推进。** 正常启动按 `catchUpMinutes` 补算；显式暂停恢复不补暂停时长。所有模块读同一轮初快照，任一脚本失败则整轮状态与通知作废，保留 `activeBatch` 供重试。
- **动作异步结算。** 同 id 同载荷重试返回原回执，同 id 异载荷 `409`；启用时无处理者 `422`，暂停时新动作 `409`。执行中新到的动作进入后续轮次。
- **HTTP 默认只服务 `127.0.0.1:3210`。** `GET /state` 仅返回 `{ simulatedSeconds, parts }`；另有动作、能力、健康与通知查询/ACK 接口。无 token，请求体和存档有大小上限，非 GET 校验 `Host` / `Origin`；细节见开发指南。
- **DSH 工具与通知。** `body_act` 接受 `drink` / `eat` / `urinate`，`body_state` 读最近提交快照。`notifications.js` 投递成功后 ACK，离线会话保留通知；启动补算通知直接丢弃。提醒阈值、冷却与配额都是 `policy`，不是人体测量。
- **不要假装有未实现能力。** 当前没有热切换、多身体路由、按会话绑定不同身体、通知历史文件、浏览器页或通用病况系统；非自主排空也不是持续漏尿或临床失禁模型。

## 4. 写模块时的契约

模块是 ESM 具名导出：

| 导出 | 要求 |
| --- | --- |
| `id` | 唯一、稳定的 camelCase 部位键；改名视为新部位。 |
| `initialState` | 默认 `{}`；只补缺失键，不每次重置。 |
| `fields` | 必填；每字段声明 `unit` 与 `mode`（`absolute` / `additive`），无字段则导出 `{}`。 |
| `actionTypes` | 能处理的动作名，默认 `[]`；不是输入过滤器。 |
| `heartbeat(io)` | 每轮入口，可同步或异步；返回值不作为输出。 |
| `initialize(snapshot, context)` | 仅启动脚本；同步返回按部位 ID 分组的字段补丁。 |

目录只作器官分组，不参与寻址；一个器官可有多个脚本，部位 id 由脚本导出。功能拆分须有独立状态、调节或信号消费者，并在器官 README 写明读入与产出；不要恢复 `systems/` 运行目录或按系统复制状态。

| `io` 接口 | 语义 |
| --- | --- |
| `io.read()` / `io.read(id)` | 读轮初快照/指定部位，只读。 |
| `io.write(nextPart)` | 暂存本部位完整下一状态；只改一项也要展开旧值。 |
| `io.functions[alias]()` | 读清单 `inject` 声明的轮初状态；缺失返回 `undefined`。 |
| `io.actions` | 本轮全部原始动作，模块自行检查类型、字段和单位。 |
| `io.notify({ mode, sessionId, text })` | 暂存通知，提交后由通知泵投递。 |
| `io.dt` / `io.simulatedSeconds` / `io.wallTimeMs` | 轮长 / 轮末仿真时刻 / 预定轮末现实时间戳。 |

代码约束：

- Node ≥ 22.18，ESM，无第三方依赖；本地 `.ts` 只用可擦除语法，相对导入带扩展名。
- 状态必须 JSON-safe，部位最外层是对象；不要 `undefined`、非有限数字、`BigInt`、`Map`、`Set`、稀疏数组或循环引用。
- 一个量只有一个写入者；器官间转移的两个写入必须同轮同时提交或同时作废。
- `heartbeat` 是热路径：不要每轮重读参数、解析大 JSON 或无界复制历史。
- 每个生理脚本头部标注 `source_id` / citekey、证据笔记、原文定位及其支撑的方程/参数/方向假设；无直接来源的工程假设明确标 `design`。

### 脚本通用性与参数归属

- 脚本只写通用模型；具体餐、个体和场景留在 `scenarios/`、身体预设或动作 payload。
- 可调参数放组件同目录的 `*.parameters.json`；只有真正全人类一致且不随研究/标定变化的常数才可留在脚本，轮长使用 `io.dt`。
- 参数文件是证据默认值；年龄、身高、体重、器官倍率等个体差异属于预设/运行时覆盖，不写回证据文件。
- 模块在 import 时通过 `lib/parameters.js` 只读加载参数；`unset` 对应 `null`，运行中不热切换。Gateway 不替模块读参数。

## 5. 量与单位

- 每个量写清定义、单位、时间原点，以及它是状态、通量、读数还是代理；代理不得冒充实测。
- 没有方法学依据不跨量纲换算；需要换算时单独记录方法与假设。
- 参数状态：`unset` 未定、`design` 工程假设、`prior` 文献先验、`fitted_dev` 开发集拟合、`validated` 已验证、`rejected` 弃用。
- 缺失写 `NA` 或 `null` 并说明原因，不用 0 代替真实观测。
- 离线拟合不等于实机验收；论文对照先核对人群、刺激、测量、单位、时间原点和统计量是否可比，模型方向一致不会提升证据等级。
- 区分 `reported`（论文报告）、`derived`（本项目推算/读图）和 `policy`（工程/提醒策略）。

## 6. 证据与来源

- 一篇论文一份笔记，放在负责该指标的器官 `references/`；旧资料留在 `systems/` 并标 legacy，不复制数据或原图。
- 共享登记簿是 `organs/human-organs/references/source-index.csv`；`source_id` / citekey 分配后不改，取数规则见字段字典。
- 记录来源、人群、刺激、测量、单位、时间原点、统计量和原文定位；不猜 DOI、单位、分母或时间原点。
- 原值保留原单位，换算另列；均值/中位数/个体值及 `SD` / `SEM` / `P95` / `range` / `CI95` 不互换。同一受试者队列不得拆到标定与验证两边。
- 已看过结果的数据只能标 `development` / `exploratory`，不能称独立验证或盲测；当前台账均为 `results_seen`。
- `prior` / `fitted_dev` / `validated` 必须有已登记来源或 `pending:<citekey>`；`unset` 的值必须为 `null`。

## 7. 工程与测试

- 不为一个功能随意引入依赖，先检查 `package.json` 和现有 import；代码改动跑一次 `npm test`，纯文档改动不必跑。
- 测试优先使用 `test-support/harness.mjs` 的真实 Gateway、临时目录、端口 0、`autoTick: false` 和固定 `now`；已有参数格式测试，不重复造一套校验。
- **性能按实测。** 使用真实根清单，分别记录空载/负载的轮数、总耗时、预热与正式轮 p50/p95、状态字节数及增长；优化前后同环境同轮数比较。Task 11 历史数据见水链设计 §8，不得写成当前 HEAD 或几十模块的性能。
- **临时产物统一进 `/tmp/dsh-body/<任务>.XXXXXX/`。** 用 `mktemp -d` 建隔离目录；交接证据保留并报告路径，一次性文件用完删除，不清理其他任务目录。
- 不要在仓库根目录创建 `body-state.json` 测试；个人存档、日志、`.tower/`、`.superpowers/` 和 Pulse 本地克隆不得提交。提交前检查 `git status` 并清理本轮临时文件。
- 新增运行时文件时检查 `package.json` 的 `files`；器官脚本、同目录参数和 `lib/parameters.js` 必须一起发布。

## 8. 文档与协作

- 文档用中文，先结论后展开；明确区分“当前实现”“设计目标”“尚未实现”。改了路径、命令、契约或状态字段，同步更新相关文档并扫描旧文案。
- 计划只在有代码、测试或实际验收证据时勾选；文档准确清晰比堆检查、schema、权限或风控层更重要。
- 论文差异不自动生成待办。每个 survey 必须给出“做 / 暂缓 / 不做”；没有消费者、证据不足或复杂度不划算就停止，调研不等于批准实现。
- 睡眠、糖代谢与排便当前均 defer。重审前分别需要明确消费者与最小闭环、可利用碳水输入及血糖/胰岛素消费者、结肠/直肠或便意消费者；共同前提是不破坏单写者、轮初快照和现有水链。
- 子代理沿用工具默认或宿主指定模型；无明确需求不切换模型或配置。
- 代仓库所有者提交/推送时，GitHub 账号、Git 作者和提交者均用 `P-A-N-52`，邮箱用 `233015466+P-A-N-52@users.noreply.github.com`。提交前用 `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` 核对；需要调整时只改本仓库 `git config --local`。公开或推送前检查提交本身署名；未经明确授权不改写已发布历史或强制推送。

## 9. 开工前清单

1. 区分文档与代码改动，并遵守对应工作流。
2. 当前行为读代码，使用方法读开发指南，设计原因读设计文档，科学口径读证据台账和器官 README。
3. 确认目标已存在，不把计划中的模块当实现；做最小改动，保持命名、单位、JSON 形状和单写者模型。
4. 新字段/参数/脚本先过建模取舍三问；生理脚本同步维护来源注释和 README 的未建模边界。
5. 代码改动跑 `npm test`，纯文档改动不补测试或依赖。
6. 提交前检查 `git status` 和署名；最终回复区分已实现、已验证与仍是计划的内容。
