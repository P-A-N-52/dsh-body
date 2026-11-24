# 开发与协作约定

先区分**当前实现**与**设计目标**。对当前行为，以代码和测试为准，再查 [Gateway 开发指南](docs/gateway-and-scripts.md)；[虚拟身体设计草案](docs/virtual-body.md)及实施计划不能作为功能已交付的证据。给自动化代理的工作约定见 [AGENTS.md](AGENTS.md)。

## 模块与存档

- **按器官组织，不按系统搭运行层。** 新器官脚本放 `organs/human-organs/<organ>/`，在该器官的 `README.md` 记录脚本、部位 ID、字段、单位与未建模项。把脚本路径加入 [`body-modules.json`](body-modules.json) 的 `scripts`；路径相对清单所在目录。
- **遵循模块契约。** 使用 ESM 具名导出：`id` 是唯一且稳定的 camelCase 部位键，`heartbeat(io)` 是轮次入口，`fields` 必须导出（只用 `io.write` 时可为 `{}`）。`initialState` 只补缺失初值；`actionTypes` 用于登记能力，不会过滤 `io.actions`。脚本自行按动作类型、字段和单位判断。Node.js ≥ 22.18；相对导入带扩展名，TypeScript 只用 Node 能直接擦除的类型语法。
- **同一轮读同一份快照。** 用 `io.dt`、`io.simulatedSeconds`、`io.wallTimeMs` 处理时间，不自行读墙钟推进。`io.write` 接收本部位完整的下一状态，不是补丁；状态须可保存为 JSON，不写 `undefined`、`NaN` 或 `Infinity`。跨部位的增量或转移必须遵守 [`fields` 操作约定](docs/gateway-operations.md)，统一在轮末校验、结算。
- **清单和存档分开。** `body-modules.json` 是开发者编辑的脚本清单；`body-state.json` 由 Gateway 维护，一具身体一份。暂停或恢复时先停 Gateway，只修改实际 `statePath` 存档顶层的 `active`，再启动。不要覆盖存档或在运行中修改它；`activeBatch` 不是开关。

## 建模、参数与证据

1. **先问必要性。** 谁消费这个信号？有什么证据？是否破坏轮初快照、单写者或模块可替换性？没有消费者的差异不建模；省略的能力应明确写进器官 README，不用空字段冒充实现。
2. **脚本写通用模型，参数和场景分开。** 可调值放脚本同目录的 `*.parameters.json`，保留 `unit`、`status`、`source`、`range`，用 [`lib/parameters.js`](lib/parameters.js) 只读加载，改后重启。缺失参数用 `unset` / `null`，不填 `0`；具体餐、个体和实验条件不要硬编码到方程里。
3. **在脚本开头交代来源。** 标明 `source_id` / citekey、证据笔记路径、原文定位，以及它支撑的方程、参数和不能推出的结论。来源登记到[共享证据台账](organs/human-organs/references/source-index.csv)，记录格式见[字段字典](organs/human-organs/references/m1-data-dictionary.md)。
4. **标清量纲和证据边界。** 写明定义、单位、时间原点和是否是代理量。区分论文直接报告的 `reported`、推算的 `derived` 和工程策略 `policy`。`design` 是工程假设，`fitted_dev` 是开发数据拟合；见过结果的数据不能称为独立验证。通知阈值和冷却时间是策略，不是生理常数。

## 验证与提交

- 从 `main` 切主题分支，提交和 PR 聚焦一个改动。说明改了什么、影响哪些接口／字段／单位、做了什么验证；文档用中文，并把未实现项标为计划。改动相关契约时同步对应指南和 [`AGENTS.md`](AGENTS.md)。
- 代码或参数改动跑一次 `npm test`。需要测试 Gateway 时，复用 [`test-support/harness.mjs`](test-support/harness.mjs) 的临时目录、随机可用端口和手动推进；不要使用个人存档。离线重放可检查模型走势，但不能替代真实 DSH 会话里的动作、通知和恢复验收。纯文档改动核对链接、命令和实现口径即可。
- 提交前查看 `git status`，只提交本次相关文件。不上传本地身体存档、会话通知、凭据、日志、`node_modules/`、`.tower/`、`.superpowers/` 或本地 Pulse 源码检出。
