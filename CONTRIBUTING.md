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
## 个体差异与可扩展器官开发规范

1. **个体档案与参数差异（只写差异、停机重启生效）**：
   - 个体差异不修改 `organs/**/*.parameters.json` 证据默认值，也不复制身体清单里的器官代码。
   - 每具身体在自己的 `body-state.json` 顶层可选声明 `profile: { weightKg, heightCm }`（默认 `75 kg / 170 cm`）、稀疏 `parameters: { [parameterId]: number }` 差异表，以及可选 `nsfw: boolean`（默认 `false`）与 `boundSessionId: string | null`；`profile` / `parameters` / `nsfw` 在停机修改并重启后经 `BodyWorker` 在模块加载时生效。
2. **体格缩放与 NSFW 门控接入**：
   - 新部位若存在随体型/体重比例缩放的容积、基线速率或储量常量，应通过 `lib/parameters.js` 的 `scaleByBodyWeight(value, parameterId)` 获取缩放值，保持 `75 kg` 默认逐点一致并允许 `parameters` 显式覆盖优先。
   - 若涉及性反应或泌乳相关生理，模块应读取 `lib/parameters.js` 的 `getNsfwSetting()`（`false` 时关闭产出与暴露）。
3. **新增非标器官（如翅膀、尾巴）即插即用**：
   - 模块遵循既有 ESM 命名导出：`id`、`heartbeat(io)`、`fields`（必选）与 `initialState`、`actionTypes`（可选），保持单一写者与 JSON-safe。
   - **向大脑上报感受无需改写脑部脚本**：在轮末 `io.write(...)` 中可选写入 `discomfortMm`（`0–100 mm`，与 `discomfort.onsetMm = 70` 同口径）及 `sensations: { [key]: { intensityMm, discomfort?, urgent?, nsfw?, contextText?, wakeText? } }`。
   - **纯感觉、零数值与双轨门控硬规则**：`brainNotify` 对 `>= 65 mm` 默认投递不唤醒 `context`（`agent.inject`）、对 `>= 85 mm` 或 `urgent: true` 投递唤醒 `wake`（`agent.followup`），支持 `3 -> 2` 步降并在 `< 40 mm` 复位；普通与紧急通道各自按指数退避（20→240 min / 5→60 min），`nsfw: true` 随 `nsfw` 开关门控。`contextText` / `wakeText` **严禁包含任何阿拉伯数字或数值单位**（含数字将被拦截并回退为通用无数字定性描述）。
   - **自定义动作自动注册**：器官导出的 `actionTypes` 会进入 Gateway 能力表，`tools.js` (`body_act`) 会自动把已声明动作加入 `type` 枚举并透传 JSON-safe 载荷（未声明动作仍返回 `400`；`sex` / `orgasm` 在 `nsfw: false` 时被门控拒绝）。

## 个体参数覆盖示例

到目标部位的 `organs/**/README.md` 找 **个体可自定义参数与默认值**，先核对它是否在这具身体的清单中、是否需要特定输入或门控。例如，为一具仿真身体把[心脏](organs/human-organs/heart/README.md#个体可自定义参数与默认值)的静息心率基线设为 `72 1/min`：

```json
{
  "parameters": {
    "heart.restingHeartRatePerMin": 72
  }
}
```

1. 停止 Gateway，备份这具身体实际 `statePath` 对应的 `body-state.json`。
2. 将示例中的完整 ID 和数值合并到存档**顶层**的 `parameters` 对象，保留其他键和整个存档。不要改 `body-modules*.json`、`parts` 输出或仓库中的默认参数 JSON。恢复某一项默认时删除相应覆盖键，不要用 `null` 代替删除；必读参数被覆盖成 `null` 可能使模块加载失败。
3. 启动 Gateway。覆盖在加载模块时读取，不热更新；`initialState` 只补缺项，修改基线不等于自动清空旧存量或重置周期。各部位自己的迁移或指定重置规则仍适用。

没覆盖的 ID 使用该模块自己的 JSON 基础值（已有少量直接读取覆盖的共享路径会回退到脚本内置基线，器官 README 会标明）。仅标有 `weightKg / 75` 且传入 ID 的参数使用该缩放；数值覆盖是最终输入，不再乘体重比。未缩放的项仍可能受其他状态、公式钳制或耦合影响。`status` 是来源/证据口径，不是临床验证；`range` 元数据并不等同统一运行时校验。

维护目录时，先改实际读取脚本、同目录参数 JSON/清单，手工核对未消费、共享与条件路径，再从仓库根目录运行：

```sh
node tools/sync-organ-parameters.mjs --write
node tools/sync-organ-parameters.mjs --check
node --test test/tools.organ-parameter-docs.test.mjs
```

不带参数等同 `--check`，不会写文件；`--write` 只会新增或替换现有 README 的 `organ-parameters` 标记区块，不修改手写段落或默认 JSON。脚本、清单或 JSON 变化后与 README 同提交。新增部位请先写手工 README；有新可选替换、条件、保留键或非字面的参数读取方式时，同步维护生成工具的相应说明，不把未识别的声明当成有效覆盖。

- 提交前查看 `git status`，只提交本次相关文件。不上传本地身体存档、会话通知、凭据、日志、`node_modules/`、`.tower/`、`.superpowers/` 或本地 Pulse 源码检出。
