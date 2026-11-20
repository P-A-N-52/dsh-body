# 身体启动开关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 停止 Gateway，编辑身体 JSON 的 `active`，再启动；暂停不推进，恢复不补算暂停时间。

**Architecture:** 对现有 `statePath` 的单具身体实现开关。启动时决定是否加载、恢复和调度生理脚本，之后只读内存；不新增文件监听器、开关 API、多身体路由或会话绑定。`body-modules.json` 继续负责项目级脚本装载。

**Tech Stack:** Node.js ≥22.18，ES 模块、Worker、`node:test`。

**Spec:** 用户确认「只有每次开始的时候决定哪些要运行，如果要切换是否启用，需要重启gateway」；恢复从暂停处继续。当前 Gateway 存档与恢复协议见 `docs/virtual-body.md` 第 5 节。

## Global Constraints

- 身体 JSON 顶层的 `active` 必须是布尔值；新身体、缺字段的 v1/v2 存档默认为 `true`。非法值不覆盖原档。只新增兼容字段，不重写现有协议版本。
- 只有 `active` 可由用户停机编辑。上一次启动的实际启用状态是同一存档内的恢复元数据，不是第二个用户开关。普通启用→启用重启继续按原补算策略；连续停用保持冻结。
- 在用户当前目录实现，不建分支、不提交、不改用户的 `body-state.json`。不引入依赖，不改既有心跳并发/整轮提交规则。

## Review Focus

- 停用启动不能运行动作、初始化脚本、恢复旧批次或排定定时器；手动 `tick()` 也不能推进。
- 运行中改文件不会热切换；`GET /health` 报告本次启动实际使用的 `active`，`GET /state` 仍能查询。
- 停用不把已入账的动作标记丢失或执行。新动作拒绝入队（409），相同既有动作仍可取得原回执。
- 恢复后把现实时间锚点移到本次启动，已有批次的仿真目标、动作顺序和重试记录不丢；旧现实时间戳不能让后续轮次追赶暂停时长。
- 通过固定 `now` 和同一临时存档测试暂停/恢复；正常停机补算、v1/v2 兼容和错误存档不被破坏。

### Task 1: 启动开关、心跳与存档

**Files:** `gateway.js`、新建 `test/gateway.activation.test.mjs`。
**Interfaces:** 读取身体存档顶层 `active`；`GET /health` 增加 `active`；保留 `GET /state` 的形状。`tick()` 在暂停时返回未运行；新动作返回 409，仅操作性读写（如查询/确认既有通知）保留已有约定。

- [x] 先用 `launch` 的真实 Gateway 写测试并看到失败：缺字段默认启用（新建/v1/v2）、错误类型拒绝且不写回、暂停跳过补算/初始化/自动和手动心跳、无新动作入队、运行中不重读磁盘、恢复后的普通重启仍补算。使用固定 `now`；不把真实 `Date.now()` 抖动当作校验。
- [x] 调整 checkpoint 创建、迁移、校验、初始化和调度入口。暂停保留最后提交的部位、待处理动作、在途批次和通知；不要对暂停档使用空 handlers 做动作对账。恢复用持久化的上次实际启用状态区分暂停与普通停机；防止旧批次的现实时间拉回时钟。不要让旧失败标志或启动脚本的停机间隔把暂停误算作经过的生理时间。
- [x] 运行 `node --test test/gateway.activation.test.mjs`、现有相关测试、`npm test`，记录红绿证据及任何原有不稳定测试。人工核对无再次读取存档的运行路径。

### Task 2: 停机修改与在途动作端到端验收

**Files:** 新建 `test/gateway.activation-recovery.test.mjs`；不改实现或其他测试。
**Interfaces:** 只用 `startGateway` / `launch` 暴露的真实接口、HTTP、用户会编辑的 `active` 字段；不伪造新的内部“上次启用”标志。

- [x] 先对未实现版本运行测试观察缺失行为。用临时目录、固定 `now`、同一份存档做实际的「启用→停机改 false→启动→停机改 true→启动」。构造真实发生过失败的在途批次与其后排队的另一个动作。
- [x] 断言停用期间无推进、老回执可查询，已有批次不被清空、合并或改成 failed；停用期过去数小时并跨至少一次停用重启，恢复时无补算；恢复后用显式 tick 逐轮验证原批次先执行、后到动作再执行且不重复，下一次动作的预定时刻和 wall clock 不跳回暂停前。
- [x] 同一 Gateway 在仍启用时正常停机/重启另验能按现有策略补算，与暂停形成对照。运行 `node --test test/gateway.activation-recovery.test.mjs`；若并行期间实现尚未到位，报告红测，由集成验证最终绿测。用例完成后清理自己的临时目录。

### Task 3: 使用说明

**Files:** `docs/virtual-body.md`。不改 11 个系统的清单或生理脚本。
**Interfaces:** 解释身体 JSON 顶层 `active` 和 `GET /health.active`，不把未来设计当成已实现的功能。

- [x] 在现有加载/恢复说明中写明停 Gateway → 编辑实际 `statePath`（默认 `$DSH_HOME/dsh-body/body-state.json`）→ 再启动，旧档缺字段按启用处理，不能编辑身体清单代替存档。片段只是已有 JSON 的一个字段，不能清空原档。
- [x] 对照普通停机补算与停用恢复，区分 `active` 与 `activeBatch`；列出暂停时能查看状态、不能新增动作；不要承诺热切换、多会话路由等未来功能已实现。扫除修改范围内直接矛盾的文案。
- [x] 自审示例、接口和路径与实现一致，通过 `git diff --check`。
