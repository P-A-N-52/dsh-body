# 身体 Gateway 开发指南：文件、时钟和第一个 TS 脚本

**接一个新部位，只需写一个 TS 模块，再把路径加进脚本清单；不用造一份新的身体 JSON。** Gateway 管时钟、动作队列和存档，脚本只回答一个问题：给定轮初状态和这一轮的动作，我的部位在轮末是什么状态？本文说的是当前实现；器官层设计与 P0/P1 清单见[虚拟身体设计草案](./virtual-body.md)和[器官级身体模型设计](./superpowers/specs/2026-11-20-organ-model-design.md)，M3 水链见[水链设计](./superpowers/specs/2026-11-22-water-balance-design.md)。

## 1. Gateway 做什么，一轮怎么走？

以“喝了 200 mL 水”为例。调用方把动作交给 Gateway，而不是直接把存档里的数值加 200。中间分三步：

1. **启动时决定跑什么。** DSH 加载插件后，Gateway 读取脚本清单和身体存档，只在这时采样 `active`。启用时，它加载清单里的模块，检查 `id`，登记各模块接受的动作类型，恢复状态。若以 `requireBinding: true` 启动（DSH 插件默认开启）且存档无 `boundSessionId`，身体进入 `dormant` 休眠状态（跳过 `catchUp`、不调度心跳，动作返回 `409`，直到通过 `body_bind` 或 `POST /bind` 绑定会话后重锚 `wallTimeMs` 启动，且不补算休眠时间）。已绑定启用时，普通停机按 `catchUpMinutes` 限额补算；没有遗留在途批次时，按清单顺序运行启动脚本。暂停（`active: false`）最高优先级：不加载生理脚本、不调度心跳、拒绝绑定激活，但本机查询仍可用。
2. **收到动作时先排队。** 调用方 `POST /actions`，给出唯一 `id`、`type` 和业务参数，例如 `volumeMl: 200`。Gateway 依次检查 `active`、`requireBinding` 休眠状态、`nsfw` 门控（`nsfw: false` 时 `sex` / `orgasm` / `express_milk` / `breastfeed` 返回 `403`）以及是否有模块声明该动作，然后返回 `202 queued` 和预定生效的仿真时刻 `effectiveAt`。这表示“记下来了”，**不是“已经喝了”**。只要这条动作记录仍在，同一 `id`、同一载荷重试会返回 `200` 和**当前**回执（可能已经是 `applied`），不会再排一次。
3. **到点才结算。** 默认每 60 个现实秒推进 60 个仿真秒。Gateway 锁定本轮动作，由常驻 BodyWorker 依次给各模块注入**同一份轮初快照**。全部成功才提交部位新值、动作状态和通知。模块报错或超时会丢弃本轮暂存结果，下次用保留的批次重试。执行中收到的新动作排在后续轮次。

默认地址是 `http://127.0.0.1:3210`。`GET /health` 看本次实际生效的 `active`、`dormant`、`boundSessionId`、`nsfw`、时钟和失败信息；`GET /capabilities` 看 **动作类型 → 模块 ID 列表**（`nsfw: false` 时过滤 `sex` / `orgasm` / `express_milk` / `breastfeed`）；`POST /bind`（传 `{ sessionId }`）与 `POST /unbind` 控制会话绑定与休眠切换；`GET /actions/:id` 查单个动作；`GET /state` 只返回最近提交的数值 `{ simulatedSeconds, parts }`，不是整份存档（面向 LLM 的 `body_state` 工具则转为纯定性零数值感受描述）；`GET /notifications` 与 `POST /notifications/ack` / `POST /notifications/receipt` 维护通知投递、确认与阅读回执；`GET /logs/state?limit=N` 与 `GET /logs/notifications?limit=N` 读近期滚动历史。

## 2. 有哪些 JSON，分别由谁管理？

| 文件 | 谁写、何时读 | 用来做什么 |
| --- | --- | --- |
| [`body-modules.json`](../body-modules.json)（`manifestPath`） | 开发者改，Gateway 启动时读 | 根清单：声明要加载的脚本、每个脚本读取的状态字段、补算上限和脚本超时（当前 47 部位、41 份唯一参数文件，含派生只读的 `bodyComposition` 与 `breastComposition` 两个组成读数部位）。 |
| [`body-modules.female.json`](../body-modules.female.json) | 开发者改，作为另一份 `manifestPath` 在启动时读 | 女性独立清单：根清单 + `ovaries` + `uterus` + `mammary-glands/milk.ts`，`body-water/water.ts` 换成 `water.female.ts`，`glucose.ts` 换成 `glucose.female.ts`，共 50 部位、44 份唯一参数文件（硬 transfer 闭包 17 部位）；必须配独立 `statePath`。 |
| [`body-modules.male.json`](../body-modules.male.json) | 开发者改，作为另一份 `manifestPath` 在启动时读 | 男性独立清单：根清单 + `testes` + `epididymis`，共 49 部位、43 份唯一参数文件；必须配独立 `statePath`。 |
| [`organs/presets/human-lipid/body-modules.json`](../organs/presets/human-lipid/body-modules.json) | 调用方选配，由 `manifestPath` 指定 | 根清单的胃入口换为 `hydration-lipid.ts`，其余部位（含气候、衣层与两个组成读数）保持，再加七个脂质部位。共 54 部位、48 份唯一参数文件（硬 transfer 闭包 19 部位）；必须配独立 `statePath`。 |
| `body-state.json`（`statePath`） | Gateway 创建、恢复和更新；用户只在停机时改顶层 `active`、`profile`、`parameters` 或 `nsfw` | **一具身体一份存档**：所有部位的值、时钟、动作、通知，以及可选个体 `profile`（支持 `weightKg`、`heightCm`、`bodyFatPercent`（0–100，缺失或 `null` 为未知）、`timezoneOffsetMin` 与女性静息泌乳预设 `lactating?: boolean`）、稀疏参数差异 `parameters`、`nsfw` 开关与 `boundSessionId` 都在一起。每份清单配独立存档，不要为每个器官或每个脚本再建存档，也不要在同一份存档上切换清单。 |
| [`package.json`](../package.json) | 项目维护者改，由 Node/npm 使用 | 声明 ESM、Node 版本、测试命令和发布文件，不登记心跳脚本，也不存身体数据。`files` 收录三份主清单，选配脂质清单随 `organs/` 一起打包；[`cordis.patch.yml`](../cordis.patch.yml) 是 DSH 插件装载描述，不是身体 JSON。 |
| `organs/**/*.parameters.json` | 模块在 import 时读；标定者改，Gateway 不写 | 器官、隔室与衣层的默认值、单位、证据状态、范围及来源。全库共 56 份，含 3 份仅供 DI 变体使用的参数。各清单的参数文件数见上表；共享参数只计一次，`climate` 无参数文件，`clothing` 有 1 份；`bodyComposition` 只读存档 `profile`，无参数文件，`breastComposition` 使用 mammary-glands 目录 1 份共用参数文件（两个输入缺省 `unset`，值为 `null`）。 |

**清单字段。** 可选的 [`thermalDefaults`](#按身体配置温度参考) 声明温度参考预设。`scripts` 是心跳脚本数组，支持 `{ "path": "...", "inject": { ... } }` 和旧版字符串路径。`startupScripts`、`catchUpMinutes`（720）与 `scriptTimeoutMs`（10000）含义不变。三份主清单的硬 transfer 闭包仍为根/男性 15 部位、女性 17 部位。

**女性与男性清单。** [`body-modules.female.json`](../body-modules.female.json) 与 [`body-modules.male.json`](../body-modules.male.json) 各自使用独立 `statePath`；部位和参数数量见上表。`bodyComposition` 与 `breastComposition` 在三份成人清单都可用；泌乳模块 `mammaryGlands` 仍仅在女性清单加载。女性生殖链已升级为：`ovaries` 采用 `SRC-STRICKER-2006` 每日血清中位数插值物理浓度（`estradiolPmolL`、`progesteroneNmolL`、`lhIuL`、`fshIuL`）与慢性高催乳素/泌乳抑制度 `cycleSuppression`；`uterus` 经量参考调整为 `30 mL/周期`（对齐 `SRC-HALLBERG-1966` 总体中位数，保留单口径水账）、支持黄体平台 `0.9`（`SRC-BAKOS-1994`）以及高潮/催产素相关 `contractionMm` 与 `pelvicCongestionMm`；`mammaryGlands` 实现非妊娠高 PRL + 机械排空刺激诱导状态机（区分 `galactorrhea` 溢乳与 `lactating` 规整产奶，支持 `profile.lactating: true`）、局部充盈自抑制 `1 − DF²` 与催产素门控 `express_milk` / `breastfeed` 喷乳反射（保持合成入池一次记水账、绝不双扣体液）；详见 [`ovaries`](../organs/human-organs/ovaries/README.md)、[`uterus`](../organs/human-organs/uterus/README.md) 与 [`mammary-glands`](../organs/human-organs/mammary-glands/README.md)。

清单与存档在启动时解析。状态查询、动作排队和心跳使用主进程内存中的存档对象。BodyWorker 只加载一次模块和它们登记的函数。

**存档里值得认识的字段（不是手写模板）：**

| 字段 | 含义 |
| --- | --- |
| `schemaVersion`、顶层 `active` | 现在写 v2。`active` 必须是布尔值，旧档缺字段默认 `true`；非法值拒绝启动，不改原档。 |
| 顶层 `profile`、顶层 `parameters`、顶层 `nsfw`、顶层 `boundSessionId`（均可选） | `profile` 含可选 `weightKg`、`heightCm`（缺省 `75 kg / 170 cm`）、`bodyFatPercent`（数值百分数或 `null`）、`timezoneOffsetMin`（缺省用宿主时区）、`lactating`（缺省 `false`；`true` 在女性清单开启 `nsfw` 时提供已建立泌乳预设）。`parameters` 是参数 ID 到有限数值或 `null` 的稀疏字典。`nsfw` 是布尔开关（缺省 `false`，可由 `startGateway({ defaultNsfw })` 设置默认；控制性与泌乳的动作、感受及通知）。`boundSessionId` 是绑定会话 ID 或 `null`，通过绑定/解绑入口维护。Gateway 启动先 `store.load()`，再在 BodyWorker 导入器官前把 `{ profile, parameters, nsfw }` 注入 [`lib/parameters.js`](../lib/parameters.js)。 |
| `snapshot.simulatedSeconds`、`snapshot.parts`、`wallTimeMs` | 最近一次提交的仿真秒数、按模块 `id` 存放的部位值，以及计算下一轮用的现实时间锚点（毫秒）。从 `active: false` 恢复或从休眠绑定激活时，Gateway 会把 `wallTimeMs`（及在途批次 `targetWallTimeMs`）重锚到当前 `now()`，不补算暂停/休眠时长。 |
| `actions`、`pendingActionIds`、`activeBatch`、`lastEffectiveAt` | 按 ID 查的动作记录、排队顺序、已锁定待完成的批次和最近分配的生效时刻。`activeBatch` **不是**启停开关。补算轮失败后保留的批次还会带 `suppressNotifications: true`，在线重试继续按补算语义抑制通知；旧档没有这个键时按 `false`。排队和在途动作不裁剪；启用时，已结束的记录默认最多留最近 2000 条，且不超过 30 天。记录被裁剪后，再用相同 ID 可能被视为新动作。 |
| `notifications`、`startup` | 尚未确认的通知和上次启动记录。`startup.active`、`startup.resumedFromPause` 由 Gateway 写，供恢复与诊断，不要手改。 |

**我该改哪一份？** 换脚本：改 `manifestPath` 指向的清单，重启。暂停身体：停 Gateway → 把实际 `statePath` 存档顶层的 `active` 改成 `false` → 再启动；恢复用 `true`。不要用只有 `active` 的片段覆盖存档。暂停仍能查状态和确认旧通知，新动作返回 `409`；恢复从原仿真时刻继续，**不补算暂停的时间**。如果只在停机时把 `false` 改回 `true`、从未以 `false` 启动，Gateway 并没有记录一次暂停，仍按普通停机处理。运行中改存档不会热切换，反而可能被下次保存覆盖。

DSH 插件的默认存档是 `$DSH_HOME/dsh-body/body-state.json`（通常是 `~/.dsh/dsh-body/body-state.json`），可在插件配置里指定 `statePath`、`manifestPath`、`port` 与 `nsfw`（若存档已有顶层 `nsfw`，以存档为准）。若默认存档同目录下存在 `bodies.json`（由 `multibody.js` 解析），`index.js` 会按其中声明的多个身体规格对等挂载各自独立的 Gateway（各自拥有独立的 `statePath`、`port`、`manifestPath`、`nsfw`、`logs/` 与通知泵），并通过 `sessions` 精确或通配符前缀映射会话到目标身体（未在 `sessions` 映射的会话默认不绑定任何身体，`default` 仅作主档存储/端口继承，且 `bodies.json` 格式非法时拒绝回退单身体；DSH 插件启动传入 `legacyStatePath: null`，不会克隆清单同目录的 `body-state.json`）。独立 CLI 启动 `startGateway` 且目标存档不存在时，默认仍会尝试接续**清单同目录**的 `body-state.json`；下面的示例把清单和存档都放进新目录，避免接续已有身体。

`POST /actions` 的请求体、`GET /state` 的返回值也是 JSON，但不是要维护的文件。当 `startGateway({ requireBinding: true })` 开启时（DSH 插件默认开启），通过存档 `boundSessionId` 与 `POST /bind` / `POST /unbind` / `body_bind` 实现单会话独占绑定与未绑定休眠：身体已绑定时，其他会话的 `body_bind`、`body_state`、`body_act` 与不同 `sessionId` 的 `/bind` / `/actions` 均会被拒绝，解绑时会清理该会话尚未投递的通知队列；`<bodyDir>/logs/state-history.jsonl` 与 `<bodyDir>/logs/notification-history.json` 分别记录有界状态变更滚动历史与通知投递/ACK/`agent/inbox/inserted` 阅读回执历史（独立落盘于存档旁 `logs/` 目录，不混入 `body-state.json`）；目前仍无多会话并发绑定。

### 单具身体的组成设置

停 Gateway 后，把需要的字段合并到实际 `statePath` 的**完整存档**；保留 `profile`、`parameters` 中的其他键和原 `snapshot`，再重启。以下是合成示例，不是人群默认或推荐值：

```json
{
  "profile": { "weightKg": 65, "bodyFatPercent": 20 },
  "parameters": {
    "breastComposition.bilateralTissueVolumeMl": 600,
    "breastComposition.fibroglandularVolumePct": 20
  }
}
```

- `profile.bodyFatPercent` 为全身脂肪**质量百分数**，填 `20` 表示 20%；省略或填 `null` 表示未知。示例的 `parts.bodyComposition` 给出 `13 kg` 脂肪与 `52 kg` 去脂质量；未知时两项都为 `null`，不按 BMI 或清单估计。
- `breastComposition.*` 参数来自[同目录组成参数文件](../organs/human-organs/mammary-glands/composition.parameters.json)（均为 `unset` / `null`），用存档里的同名键覆盖。体积必须是正有限 mL；百分数为匹配口径的双侧**体积百分数**。示例给出 `120 mL` 纤维腺体与 `480 mL` 脂肪。只给一项会保留该输入，但不推导分量；显式 `null` 同样表示未知。
- 两种百分数都接受 `[0,100]` 的有限数值，不接受数字字符串或越界值。正常启动以配置而非旧 `snapshot` 为准；如恢复时仍有未结算批次，首个成功心跳刷新读数。暂停档不刷新读数，保留已提交快照。
- 根、男性、女性清单都提供这两个部位。只改形态不重算水、糖、乳汁或其他库存，乳房体积也不另计全身脂肪。见[全身体成分](../organs/human-compartments/body-composition/README.md)与[乳房组织组成](../organs/human-organs/mammary-glands/README.md#乳房组织组成)的输入口径与对照。
- **数值与留存。** 本机 `GET /state` 和 `gateway.getState()` 可查看当前快照中的原始数值；定性宿主工具 `body_state` 不返回这些数值。已提交的组成字段也可能进入存档旁的 `logs/state-history.jsonl`，按现有滚动保留策略管理，可由本机 `GET /logs/state` 或 `gateway.getStateHistory()` 读取。改设 `null`、移除体脂输入或取消乳房参数覆盖只影响之后的读数，不会追溯擦除已写入的历史。可使用虚构数值；分享日志前请检查是否包含个人测量值。

## 3. 写 TS 时，参数谁给，结果给谁？

模块用 ESM **具名导出**：`id` 是唯一、稳定的部位键（改名就不再读原部位），`heartbeat(io)` 是每轮入口，可同步或异步，`fields` 声明本部位字段（每个字段写 `unit` 与 `mode`，规则见 [`docs/gateway-operations.md`](./gateway-operations.md)；不能省略，只做 `io.write` 的模块也要 `export const fields = {};`）。常用的两个可选导出是 `initialState`（部位初值，默认 `{}`）和 `actionTypes`（能处理的动作名，默认 `[]`，只靠时钟推进的模块可以不声明动作）。已有部位只补缺少的初值。若模块还导出 `resetOnStart` 字段清单，标准 `startup/reset-parts.js` 会在无在途批次、无补算错误的启用启动时重建这些字段；不要用它清除需持久保留的库存。

| 谁提供 | 脚本怎么取、怎么交回 |
| --- | --- |
| **脚本作者**给初值、固定常数和单位 | 如 `initialState = { totalMl: 0 }`。模块级常量只保存全人类一致、不随个体或标定变化的常数；可调参数放组件自己的 `*.parameters.json`（见下）。跨轮状态通过 `io.write` 存回本部位。 |
| **调用方**给每次动作的参数 | 如 `{ "id": "cup-1", "type": "drink", "volumeMl": 200 }` 或含能饮料 `{ "id": "cola-1", "type": "drink", "volumeMl": 330, "energyKcal": 140 }`。`io.actions` 是本轮**全部原始动作**，不是回执，也不会按 `actionTypes` 给每个模块过滤。脚本自己检查 `type`、字段和单位；TS 类型不会替你校验收到的 JSON。 |
| **Gateway**给状态与时间 | `io.read()` 读轮初 `{ simulatedSeconds, parts }`；`io.read(id)` 读某一部位，找不到返回 `undefined`。`io.dt` 是本轮步长（60 秒），`io.simulatedSeconds` 是**轮末**仿真时刻，`io.wallTimeMs` 是预定轮末的现实时间戳（毫秒）。`io.suppressNotifications` 是只读布尔（启动补算轮为 `true`、在线轮为 `false`）；`io.boundSessionId` 是只读 `string \| null`（当前绑定会话 ID）。计算用这些值，不要用 `Date.now()` 猜过了多久。 |
| **脚本**把结果交回 Gateway | `io.write(nextPart)` 暂存**本部位完整的新对象**，不是补丁；只改一项时可用 `{ ...prev, 新字段: 新值 }`。不调用则保留原部位。`heartbeat` 的返回值不作为输出。其他部位只能读，输入快照不能原地改。 |

**脚本头部要写来源。** 每个生理脚本在第一个 `import` 前用块注释列出：依赖的 `source_id` / citekey、证据笔记路径、原文定位（摘要 Results、Table、Methods 等）、支撑的方程或参数，以及不能推出的边界。参数文件里的 `source` 只回答“这个值来自哪条登记”；脚本注释要回答“哪条方程或假设来自哪里、哪些只是 `design`”。没有直接来源的代理量要明确写“无直接证据”，不能只挂一个论文标题或 DOI。

状态必须是可保存的 JSON：普通对象、数组、字符串、布尔值、有限数字或 `null`；部位最外层必须是对象。不要写 `undefined`、`NaN`、`Infinity`、`BigInt`、`Map` 或循环引用。项目要求 **Node ≥ 22.18**，可直接加载本地 `.ts`，不需要 `ts-node`。使用可擦除的类型语法（`type`、`interface`、类型标注）；相对导入带扩展名，避免 `enum`、参数属性等需要编译转换的语法。如果打包到 `node_modules`，先把 TS 编译成 JS，再让清单指向发布的文件。`package.json` 的 `files` 已包含 `organs/` 与 `lib/`；打包时脚本、同目录参数文件和 `lib/parameters.js` 要一起纳入 `files`。

### 参数文件是只读输入

可调参数不放脚本常量，放组件自己的 `*.parameters.json`；脚本只写通用模型。参数文件跟随器官脚本放在同一目录，例如 `organs/human-organs/stomach/motility.parameters.json`。模块通常在 **import 时**自己读参数。共享的五个温度参考由 Gateway 在导入模块前解析；两条路径都不热切换。只读通道在 [`lib/parameters.js`](../lib/parameters.js)，包括：

| 函数 | 行为 |
| --- | --- |
| `loadParameters(parametersUrl)` | 读 JSON，返回 `{ [参数 ID]: 值 }`。校验 `schemaVersion === 1`、`owner` 非空、每个参数 `id` 以 `owner.` 开头且不重复、`status: "unset"` 与 `value: null` 一一对应；若当前 Worker 所属身体存档顶层 `parameters` 存在同名 key，返回稀疏覆盖后的值；五个温度参考 ID 额外支持下述清单预设及可选边界规则。 |
| `requireParameter(values, id)` | 返回值；若值为 `null` 或缺失，抛出带参数 ID 的错误。脚本需要的参数还没标定时，应当在这里失败，而不是拿 `0` 继续跑。 |
| `getBodyProfile()` / `hasParameterOverride(id)` / `getNumericParameterOverride(id)` / `scaleByBodyWeight(value, parameterId)` | 返回当前身体 `{ weightKg, heightCm }`、查询是否显式覆盖，并按 `weightKg / 75` 自动缩放体格相关参数（`75 kg` 原值逐位不变；`parameters` 显式覆盖优先于自动缩放）。核心隔室、血液、心脏、血氧、肺通气、体温调节、肝糖原、肾糖异生、肌糖原、下丘脑 ADH 与产尿基线已同步接入，保证不同体重下静息 `37.0 °C` 与空腹 `90.0 mg/dL` 平衡不被拆散。 |
| `getProfileBodyFatPercent()` | 返回 `profile.bodyFatPercent`（0–100 的质量百分数）或 `null`；`getBodyProfile()` 的返回形状不变。 |
| `getNsfwSetting()` | 返回当前 Worker 配置的 `nsfw` 布尔开关（在脱离 Worker 的独立单元测试中未配置时返回 `null`）。`mammaryGlands`、`interoception` 与 `brainNotify` 以 `getNsfwSetting() !== false` 判断是否启用，即在 Gateway 运行态 `nsfw: false` 时严格禁用。 |

`parametersUrl` 可以是文件 URL（`URL` 对象）或文件系统路径；相对路径按进程工作目录解析，所以模块里用 `new URL('./motility.parameters.json', import.meta.url)` 最稳：

```js
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

const parameters = loadParameters(new URL('./motility.parameters.json', import.meta.url));
const halfTimeMin = requireParameter(parameters, 'stomach.emptying.halfTimeMin');
```

示例的 import 深度 `../../../lib/parameters.js` 按脚本位于 `organs/human-organs/<organ>/` 计算；体液与葡萄糖隔室 `organs/human-compartments/<compartment>/` 也在同样的第三层，深度相同。脚本放在其他层级时，需要按实际目录调整相对深度。

边界：参数文件是**证据默认值**，不是某具身体的最终值；年龄、体重、器官倍率等个体差异属于身体预设或运行时覆盖，不写回参数文件。`unset` 参数的值必须是 `null`，缺失值不用 `0` 代替。参数变更不做运行中热切换，改完要重启 Gateway。`package.json` 的 `files` 已包含 `organs/` 与 `lib/`；打包生理脚本时，脚本、同目录参数文件和 `lib/parameters.js` 要一起纳入 `files`，否则运行时会找不到。

### 在清单里声明状态读取函数

在脚本条目的 `inject` 中，函数名映射到 `snapshot.parts` 下的数组路径。路径第一段是部位 ID，后面是字段名。每轮 Gateway 从轮初快照取值，脚本通过 `io.functions` 里的同名函数读取。

```json
{
  "path": "./organs/human-organs/stomach/motility.ts",
  "inject": {
    "stomachGhrelinLevel": ["stomachGhrelin", "relativeConcentration"]
  }
}
```

胃脚本调用 `io.functions.stomachGhrelinLevel()`，得到当轮开始时的饥饿素相对浓度。只有部位 ID 的路径（如 `["stomachGhrelin"]`）会返回该部位的完整只读状态。字段或部位缺失时返回 `undefined`。多个脚本读到的值都来自同一轮初快照。上面的条目是示意；P0/P1 的 `motility.ts` 实际直接读自己的轮初状态，不声明 `inject`，`brain/interoception.ts` 也直接 `io.read('stomachSensory')` 等部位，不需要 `inject`。M3 水链的脚本同样直接 `io.read(...)`；它们之间的搬水靠 `fields` 里的 `transferOut` / `transferIn` 配对，不靠 `inject`。

### 按身体配置温度参考

`io.getThermalProfile()` 在普通路径、`inject` 路径及包外自定义 `heartbeat` 中都可用，不需要加载人体温控器官，也不需要 `body_act`。它返回当前身体的冻结对象，字段都是 `°C` 标量：

| 脚本读取字段 | `thermalDefaults` / 存档 `parameters` 的完整 ID | 缺省 |
| --- | --- | --- |
| `baselineCoreC` | `thermoregulation.setpointC` | 参数文件的 37 °C（`design`） |
| `normalCoreMinC` | `thermoregulation.normalCoreMinC` | 本体 `baselineCoreC` |
| `normalCoreMaxC` | `thermoregulation.normalCoreMaxC` | 本体 `baselineCoreC` |
| `ambientComfortMinC` | `thermoregulation.ambientComfortMinC` | `null`，未知 |
| `ambientComfortMaxC` | `thermoregulation.ambientComfortMaxC` | `null`，未知 |

顺序是本具身体的 `parameters` **有限数字** > 该清单的 `thermalDefaults` > [原参数文件](../organs/human-organs/brain/thermoregulation.parameters.json)。省略键可继承；四个可选边界写 `null` 也继承，但必填基线 `thermoregulation.setpointC` 显式写 `null` 仍会报错。核心范围须包含基线；可只填一侧，另一侧取基线。空气边界允许负值和 0，生效后必须两侧齐备且下界 ≤ 上界，否则启用时在导入脚本、补算或积分前报错，原存档不改。默认空气舒适带未知，不是 `0 °C` 也不是热收支用的默认气温。

例如在新目录中建立以下独立 `body-modules.json`。给人体清单加参考时，保留原 `scripts` / `startupScripts`，合入 `thermalDefaults` 并追加脚本即可。32 °C 对照只是虚构工程预设，不是已标定物种。

```json
{
  "scripts": ["./thermal-inspect.mjs"],
  "thermalDefaults": {
    "thermoregulation.setpointC": 32,
    "thermoregulation.normalCoreMinC": 31.5,
    "thermoregulation.normalCoreMaxC": 32.5,
    "thermoregulation.ambientComfortMinC": 18,
    "thermoregulation.ambientComfortMaxC": 24
  }
}
```

要单独修改一具身体，在停机后把下面的**片段**合入它已有存档的顶层 `parameters`，保留 `snapshot` 等键，再启动。例子只放宽正常核心带上界和空气舒适带下界；其他值仍用清单或参数文件。不重置当前核心温、库存或之前已提交的状态；新部位才用配置基线补初值。

```json
{
  "parameters": {
    "thermoregulation.normalCoreMaxC": 32.75,
    "thermoregulation.ambientComfortMinC": 16
  }
}
```

在清单旁新建 `thermal-inspect.mjs`。只写本脚本自己的判定结果，不写温度、舒适参考或水账：

```js
export const id = 'thermalInspection';
export const initialState = { baselineCoreC: null, coreInNormalBand: null, airInComfortBand: null };
export const fields = {
  baselineCoreC: { unit: '°C', mode: 'absolute' },
  coreInNormalBand: { unit: '1', mode: 'absolute' },
  airInComfortBand: { unit: '1', mode: 'absolute' },
};

function inBand(reading, min, max) {
  if (!Number.isFinite(reading) || min === null || max === null) return null;
  return min <= reading && reading <= max;
}

export function heartbeat(io) {
  const p = io.getThermalProfile();
  const core = io.read('thermoregulation')?.coreTemperatureC;
  const air = io.read('climate')?.airTemperatureC;
  io.write({
    baselineCoreC: p.baselineCoreC,
    coreInNormalBand: inBand(core, p.normalCoreMinC, p.normalCoreMaxC),
    airInComfortBand: inBand(air, p.ambientComfortMinC, p.ambientComfortMaxC),
  });
}
```

这个独立清单即使没有两个测量部位，也会报静态 `baselineCoreC: 32`、两个判定 `null`。若轮初有 `climate.airTemperatureC: 16` 和核心温 `32`，未加存档覆盖时输出核心 `true`、空气 `false`；若空气字段缺失，不用核心温或配置值代替。第三方也可用自己的核心/气温部位替换两个 `io.read`，或在清单中用 `inject` 取得真实轮初输入。`tools/replay.mjs --manifest` 同样读清单预设，不读身体存档。

人体内感受用相对核心带计算冷热；皮肤、肺与内分泌仍使用各自原有的动态偏置和热防御。静态参考不是体温钳位，也不替代昼夜/睡眠目标或实际核心温；空气舒适带不参与散热、出汗结算或肺失水。未实现外温型热平衡、异温或冬眠、非人物种热适应、临床阈值或新行为策略。

### 水链的 transfer 配对（当前模块）

M3 水链最初用三个 `io.transfer` 配对搬水，两端都声明 `mL` / `absolute`：

```text
stomach.waterVolumeMl        → smallIntestine.waterVolumeMl
smallIntestine.waterVolumeMl → bodyFluid.waterVolumeMl
bodyFluid.waterVolumeMl      → bladder.volumeMl
```

- 活动相关失水在同一 `bodyFluid.waterVolumeMl` 上另有两路出口：`→ lungs.respiratoryWaterLossMl` 与 `→ skin.sweatVolumeMl`（两端均为 `mL` / `absolute`）。它们与膀胱共用轮初水，分配公式与时序见下节。
- 女性清单的体液入口 `water.female.ts` 在同一字段末位再声明第四出口 `→ uterus.bleedingMl` 与第五出口 `→ mammaryGlands.milkMl`；正常入口 `water.ts` 不声明它们。第四、第五路排在前三路之后，只使用轮初余量，顺序是 `policy`，不是人体失水优先级证据；乳腺排在最后（水量小）。请求超出余量时钳到余量，不制造负水。
- 只有源字段的所有者发起 transfer：`stomach/hydration.ts`、`small-intestine/water-absorption.ts`、`human-compartments/body-water/water.ts`（正常入口三路）或 `water.female.ts`（女性变体五路）。同一清单不能同时加载两个体液入口。
- 源部位先 `io.write` 本轮转出前基准，Gateway 再按 write → add → transfer 结算。胃写 `W + D`（`D` 为本轮入胃水），小肠写轮初肠水，体液写轮初体液水；同轮新流入不能支付本轮下游需求。
- `urinate` 不触发 transfer：水进入膀胱时已经离开体液，排尿再扣一次会双扣。
- 非自主排空也不触发 transfer：轮初膀胱体积**严格大于** 600 mL 且本轮无 `urinate` 时，膀胱把轮初体积排到 `postVoidResidualMl`，记入 `involuntaryVoidedMl`；主动 `urinate` 优先，同轮只结算一次。`voidedMl = voluntaryVoidedMl + involuntaryVoidedMl`，水账只累计 `voidedMl` 一次，两个分项不能再加一遍。600 mL 是 `design` 工程阈值，不模拟逼尿肌/括约肌、持续漏尿或临床失禁。
- 加载约束：`hydration.ts` 必须与 `smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose`、三个肌肉区域、`skin`、`lungs` 同时加载，否则水/碳水/肾糖异生/肾糖/肝糖/肌摄糖/区域糖原/汗液/呼吸失水/结肠残渣 `transferOut` / `transferIn` 配对校验拒绝启动；旧 `motility.ts` 不声明 transfer，可单独加载且不需要下游部位。两个 `stomach` 入口不能同时加载。
- 当前根清单与男性清单的硬 transfer 闭包为 15 个部位：`stomach`（`hydration.ts`）、`smallIntestine`、`colon`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGluconeogenesis`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs`；缺任一端都会在启动时因配对校验失败。女性清单在此基础上加 `uterus` 与 `mammaryGlands`，硬闭包为 17 个部位（`ovaries` 只是子宫的普通轮初读取，不在配对内）；女性清单缺 `uterus` 或 `mammaryGlands` 时启动分别报 `transferOut target "uterus.bleedingMl" is not declared` 或 `transferOut target "mammaryGlands.milkMl" is not declared`。女性清单另用 `glucose.female.ts`，其 `glucoseMassG.transferOut` 末位声明 `mammaryGlands.lactoseG`，因此乳腺也在糖侧配对内。`esophagus` 不声明 transfer，不在闭包内。
- 水账在根清单的恒等式上增加累计 `uterus.bleedingMl` 与 `mammaryGlands.milkMl`（仅女性变体）；`bleedingRequestMl` / `milkRequestMl` 不进入水账，只有实际转移量计入。根清单水账与三出口语义不变。
- 旧 `motility.ts` 以 `trackWater: false`、`trackCarbohydrate: false` 运行，推进既有 `mealQueue` 时会剥离切片的水与碳水元数据；不要用“完整清单 → 旧清单 → 完整清单”保存待释放水/碳水，切回时按 0 计。正常旧档升级只补默认值，不猜历史成分。
- 这些水链脚本已加入根清单；水链完成时为 12 个部位，血氧池与肺通气切片加入后为 22 个（两者都不新增 transfer，闭包仍为 9 个），肝糖原切片加入后为 23 个，内分泌轴与松果体接入后为 28 个，唾液腺切片接入后为 29 个；分区骨骼肌、循环、体温、肾糖异生与食管/结肠切片接入后为 38 个，新增 `brain/sleep.ts` 时根/女/男分别达到 39 / 42 / 41 个；现行计数见 §2。Task 10 真实 DSH 会话验收已完成（30 轮 A/B 与排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）；参数与证据边界见各器官 README。Task 10 与 M19（33/33 核对通过，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）均早于 `sleep`、5 项新增体感、双轨退避、休眠绑定与纯感觉工具改造，不覆盖这些后续行为。非自主排尿、不适、DI 变体、生殖链、分区肌肉与 P0 三清单 24 h 回归等离线与 Gateway 测试位于 `test/organs.*.test.mjs`。

### 食管与结肠薄切片（当前模块）

`esophagus`（`esophagus/esophagus.ts`）只处理 `eat` / `drink`：本轮合法动作的体积累加成食团，`transitMin` 从 0.2 min 递减，食团在转运到 0 后清零；`chokingMm = clamp(50 × max(0, bolusVolumeMl / 250 − 1), 0, 100)`。它不声明 `transfer`，不改变胃的摄入时刻，也不写其他部位。`interoception.discomfort` 以第七路软读 `esophagus.chokingMm`；未加载时按 0。

`colon`（`colon/colon.ts`）接收 `smallIntestine.waterVolumeMl → colon.residueWaterMl`，按解析指数 `startResidue × (1 − exp(−0.01 × dtMin))`（`reclamationRatePerMin = 0.01 /min`，半时约 69 min）回收并 `transfer colon.reclaimedWaterMl → bodyFluid.waterVolumeMl`；非排便轮按 `0.01 g/min` 形成粪便，`defecate` 动作把轮初 `stoolG` 记为 `defecatedG` 并把 `stoolG` 清零。`bowelUrgencyMm = clamp(100 × stoolG / 200, 0, 100)`，由 `interoception.bowelUrgencyMm` 直接软读（缺失时回落 `100 × stoolG / 200`），不进入 `discomfort`，也不触发通知。`defecate` 与 `urinate` 同类，无载荷；`body_act` 的 `type` 枚举和 Gateway 的 `actionTypes` 都接受它，根清单启用后 `GET /capabilities` 返回 `defecate: ["colon"]`。`esophagus` 不在硬闭包内；`colon` 在，缺它时启动报 `transferOut target "colon.residueWaterMl" is not declared`。水账增加“结肠残渣水”项，回收是内部回流，不另加外部流入。全部参数 `design`、`source: null`，没有食管转运/呛咳、结肠转运/吸水/粪便形成或便意阈值的人体测量。

### 碳水与葡萄糖的 transfer 配对（当前模块）

`drink` / `eat` 可携带可选 `carbohydrateG`：单位克，表示可消化葡萄糖当量碳水；缺省为 0，负数、非有限数或非数字使整条摄入无效。它不从体积或能量反推。碳水/糖质量用九笔 `io.transfer` 配对，两端均为 `g` / `absolute`：

```text
stomach.carbohydrateG                 → smallIntestine.carbohydrateG
smallIntestine.carbohydrateG          → glucose.glucoseMassG
liver.glycogenG                       → glucose.glucoseMassG
kidneyGluconeogenesis.glucoseOutputG  → glucose.glucoseMassG
glucose.glucoseMassG                  → kidneyGlucose.excretedGlucoseG
glucose.glucoseMassG                  → liver.storageG
glucose.glucoseMassG                  → muscleGlucose.uptakeG
muscleGlucose.uptakeG                 → muscleHead.uptakeG
muscleGlucose.uptakeG                 → muscleTrunk.uptakeG
muscleGlucose.uptakeG                 → muscleLimbs.uptakeG
```

缺区域变体只声明存在的区域出口（如 `glucose-uptake.no-limbs.ts` 只声明头和躯干）。transfer 图按来源 → 目标列出；Gateway 按 transfer 对键逐笔结算（`gateway/operations.js:206`），与脚本调用顺序无关。`glucose` 的三个出口等价于肾糖 → 肝储存 → 肌肉的目标名顺序；`liver` 与 `kidneyGluconeogenesis` 的产糖/释放是另外两笔转入，按 transfer 对键排序并增加本轮结束后的池质量。`glucose` 的 write 值 `W = M_after` 只扣自身基础消耗与超基线残余清除，不含三笔转出；Gateway 在 write 之后按 transfer 逐笔扣减，余额不足时后结算者被钳位，不会产生负质量。

- 胃复用既有固/非固餐排空比例，并受 `duodenum.nutrientExposure` 反馈抑制（`inhibition = 1 − 0.5 × clamp(exposure, 0, 1)`）。写回的总碳水包含本轮新摄入，Gateway 再从总量扣本轮转出；`solidCarbohydrateG` 是总量子集，胃脚本必须预先写成扣除本轮固餐排空后的值，不能再由 transfer 扣一次。
- 小肠只吸收轮初碳水，按 `design` 半时 20 min 与反馈因子 `carbFactor = max(0, 1 + 0 × (I − 1) − 0.2 × (G / 90 − 1))`（高血糖降低梯度负反馈）计算；水吸收按 `waterFactor = max(0, 1 + 0.1 × clamp(waterDeficit, 0, 1))` 计算，且离开通量按 95% 吸收 / 5% 残渣分流：`residueWaterMl = min(waterVolumeMl − absorbedWaterMl, absorbedWaterMl × f / (1 − f))`（`f = 0.05`），随 `dtMin` 自然缩放而不复利抽水。胃同轮转入的碳水下一轮才吸收。
- `glucose` 是可及池隔室，不是解剖器官。固定参数 75 kg、`1.88 dL/kg`、90 mg/dL、60 min 残余清除半时与 `basalConsumptionGPerMin = 0.12 g/min`（脑/红细胞等非胰岛素依赖基础消耗）均为 `design`；分布体积以 `SRC-DALLAMAN-2007` 作定义与量级锚点。
- 葡萄糖浓度按轮初质量计算，小肠 transfer 在 write 后到账：默认摄入第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收、第 4 轮首次看到浓度读数上升。`disposedGlucoseG` 合计基础利用 `basalDisposedG = min(M_start, 0.12 × dtMin × clamp(C_start / 50, 0, 1))` 与超基线残余清除 `excessDisposedG = E × (1 − 2^(−dtMin / 60))`；空腹 90 mg/dL 稳态时，0.12 g/min 基础消耗与静息肝释放（0.096 g/min）+ 肾糖异生（0.024 g/min）精确平衡。低于基线时血糖池不自行生糖，回升由 `liver` 与 `kidneyGluconeogenesis` 的真实转移决定（见下节）。
- `pancreasEndocrine.insulinPmolL` 现采用物理浓度单位（`pmol/L`，基线 `60 pmol/L`，上限 `900 pmol/L`），与 `glucagonRelative`（基线 `1`）共同调节外周代谢。`glucose` 不再读取胰岛素，只算基础利用与自身超基线残余清除 `D`，并写出 `excessMassG = max(0, M_start − B)`。消费者通过归一化相对量 `I = insulinPmolL / 60` 计算请求：肌肉 `request = 0.5 × E/(E + 20) × max(0, 1 + 1.0 × (I − 1)) × dtMin + exerciseUptakeG`（活动时另加 `0.15 × intensity × dtMin × clamp(G / 90, 0, 1.5)`）；肝 `request = min(0.2 × E/(E + 15) × max(0, 1 + 0.5 × (I − 1)) × dtMin, max(0, glycogenCapacityG − (glycogenG + storageG)))`。`insulin` 采用 Michaelis–Menten 饱和清除（`Vmax = 274`、`Km = 3890`、`glucoseGain = 0.085`），详细动力学见 [`pancreas`](../organs/human-organs/pancreas/README.md)。
- 胰腺餐后升高与 `glucagonRelative` 反向调控时序不变：`glucagonRelative` 在血糖低于低血糖阈值（`68 mg/dL`）时另叠加反调节增益（`0.06 / (mg/dL)`），上限钳位 5、半时 10 min 趋近；消费者仍是 `liver` 与 `kidneyGluconeogenesis`。无胰腺时按基线 `I = 1`、`H = 1` 计算。
- `kidneyGlucose` 只在跨阈后产生质量请求：`requestG = max(0, C × 1.88 − 339) × 0.0005 × 75 × dtMin / 1000`。跨阈后的下一轮写请求，再下一轮由 `glucose` 先算 `M_after`、按 transfer 对键先结算肾糖 `X = min(max(0, R), M_after)`，再结算肝与肌请求。请求不是实际排泄，肾糖只记 g，不换算尿水。
- `glucose` 读轮初 `liver.storageRequestG` 与 `muscleGlucose.uptakeRequestG`，先 write `W = M_after`、`disposedGlucoseG = D`、`excessMassG = E`；脚本按 `L_paid = min(storageRequestG, M_after − X)`、`U_paid = min(uptakeRequestG, M_after − X − L_paid)` 封顶。Gateway 把 transfer 逐笔应用（`gateway/operations.js:206`）：肾糖 `X`、肝储存 `L_paid`、肌摄糖 `U_paid`。余额不足时后结算者被钳位，质量守恒仍逐轮成立；总轨迹是涌现结果，不再与旧模型逐位一致。`muscleGlucose` 到账的 `uptakeG` 在下一轮由聚合器按区域份额转给 `muscleHead` / `muscleTrunk` / `muscleLimbs` 的 `uptakeG`，区域再下一轮入账各自的 `glycogenG`（初值合计 300 g：15 / 135 / 150 g），并按轮初 `physicalActivity` 以各自份额消耗（`0.5 × regionShare × intensity × dtMin`，三区合计 0.5 g/min）；`liver` 在到账后的下一轮把 `storageG` 并入 `glycogenG`，并按平滑比例 + 低血糖/胰高血糖素/皮质醇释放。`exercise` / `sex` 第 1 轮写活动，第 2 轮区域开始消耗；糖原不足时消耗钳到各区域可用量，`glycogenConsumedG` 记实际值。
- 外源碳水质量账在外源摄入之外，包含内源基础消耗、肝糖原净变化与在途储存，以及肾糖异生累计产糖（内源输入项，移到等式左侧或从 `disposedGlucoseG` 中扣除）；不能重复累计请求或在途/已入账糖原，`liver.outputG` 是内部转移记录、不另加：

  ```text
  累计摄入碳水 + 累计 kidneyGluconeogenesis.glucoseOutputG
  = stomach.carbohydrateG
  + Σ stomach.mealQueue.remainingCarbohydrateG
  + smallIntestine.carbohydrateG
  + (glucose.glucoseMassG − B)
  + 累计 disposedGlucoseG
  + 累计 kidneyGlucose.excretedGlucoseG
  + Σ 区域 glycogenG
  + Σ 区域 uptakeG
  + muscleGlucose.uptakeG
  + 累计 Σ 区域 glycogenConsumedG
  + (liver.glycogenG − liver.initialGlycogenG)
  + liver.storageG
  ```

  水账不含糖项。
- 旧档胃/小肠碳水按 0，新 `glucose` 补 `12.69 g / 90 mg/dL / 0 g`，`excessMassG` 首轮由轮初质量现算，胰腺补 `insulinPmolL = 60` 与 `glucagonRelative = 1`，不承诺保留旧 `insulinRelative` 偏差；肾糖请求/实际通量补 0，`muscleGlucose` 补 `uptakeRequestG = 0`、`uptakeG = 0`，三个区域补 `uptakeG = 0`、`glycogenG = 15 / 135 / 150`、`glycogenConsumedG = 0`；旧档只有 `muscleGlucose.glycogenG` 时，各区域第一轮按存在区域份额迁移：默认种子状态用迁移份额取代 300 g 份额初值，已有真实存档状态则并入存量；聚合器第一次 write 后旧总量不再保留，后续不会重复迁移。`liver` 补 `storageRequestG = 0`、`glycogenG = 80`、`storageG = 0`、`glycogenCapacityG = 100`、`outputG = 0`，不反推历史；重启保留已提交的请求与在途 `uptakeG` / `storageG`，各部位下一轮只处理一次，容量每轮由 `liver` 按参数重写为 100。
- 肝糖原（含 100 g 容量）、肾糖异生、胰高血糖素与各部位自主摄糖请求已由当前清单接入；胰高血糖素绝对浓度、肝糖异生、脂肪组织分区、肌糖原容量与静息周转仍未实现。M2 薄切片已含骨骼肌摄糖、分区肌糖原与肾糖异生。公式、质量账和证据边界见[碳水—血糖薄切片设计](./superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)、[胰腺设计](./superpowers/specs/2026-11-22-pancreas-insulin-design.md)、[肾糖设计](./superpowers/specs/2026-11-23-renal-glucose-design.md)、[骨骼肌摄糖设计](./superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md)、[肝糖原设计](./superpowers/specs/2026-11-23-liver-glycogen-design.md)、[各部位自主摄糖设计](./superpowers/specs/2026-11-24-tissue-uptake-design.md)与[肾糖异生设计](./superpowers/specs/2026-11-24-renal-gluconeogenesis-design.md)。

### 血糖双向自调节：自主摄糖、肝糖原、肾糖异生与胰高血糖素（当前模块）

血糖自调节现在由两条自主链组成：高血糖侧各摄糖部位按自己的参数写请求、`glucose` 按“肾 → 肝 → 肌”结算；空腹与低血糖侧由 `liver` 与 `kidneyGluconeogenesis` 按平滑比例 + 餐后抑制同时向 `glucose.glucoseMassG` 产糖，平衡 `glucose.basalConsumptionGPerMin = 0.12 g/min` 的基础耗糖。各部位只读轮初快照，不做同轮迭代；总清除轨迹是各部位响应的涌现结果。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `pancreasEndocrine` / `pancreas/insulin.ts` | `insulinPmolL`、`glucagonRelative` | 轮初 `glucose.concentrationMgDl`、自身两个字段、`io.dt` | `muscleGlucose` 与 `liver` 读胰岛素（`insulinPmolL / 60`）；`liver` 与 `kidneyGluconeogenesis` 读胰高血糖素 |
| `liver` / `liver/glycogen.ts` | `storageRequestG`、`glycogenG`、`storageG`、`glycogenCapacityG`、`outputG` | 自身轮初状态；轮初 `glucose.excessMassG`、`pancreasEndocrine.insulinPmolL`、`glucose.concentrationMgDl`（未加载按 90）、`pancreasEndocrine.glucagonRelative`（未加载按 1）、`adrenal.cortisolNmolL`（除以 180 归一化，未加载按 180）、`autonomic.sympatheticMm`；`io.dt` | `glucose` 读 `storageRequestG` 并结算；`liver` 自己发起释放 |
| `kidneyGluconeogenesis` / `kidney/gluconeogenesis.ts` | `glucoseOutputG` | 轮初 `glucose.concentrationMgDl`（未加载按 90）、`pancreasEndocrine.glucagonRelative`（未加载按 1）；`io.dt` | `kidneyGluconeogenesis` 当轮 transfer 到 `glucose.glucoseMassG` |
| `muscleGlucose` / `skeletal-muscle/glucose-uptake.ts` | `uptakeRequestG`、`uptakeG` | 自身轮初状态；轮初 `glucose.excessMassG`、`glucose.concentrationMgDl`、`pancreasEndocrine.insulinPmolL`、`physicalActivity`、各区域是否存在；`io.dt` | `glucose` 读 `uptakeRequestG` 并结算；聚合器把 `uptakeG` 按份额转给区域 |
| `muscleHead` / `muscleTrunk` / `muscleLimbs` / `regions/*.ts` | `uptakeG`、`glycogenG`、`glycogenConsumedG` | 自身轮初状态；`muscleGlucose.glycogenG`（仅旧档迁移）、`physicalActivity`；`io.dt` | 区域自己入账与消耗；`body_state` 读出 |

**储存请求。** 设 `E = max(0, glucose.excessMassG)`、`I = insulinPmolL / 60`：

```text
freeCapacity = max(0, glycogenCapacityG − (prev.glycogenG + prev.storageG))
storageRequestG = min(
  maxUptakeRateGPerMin × (E / (E + halfMaxExcessG)) × max(0, 1 + 0.5 × (I − 1)) × dtMin,
  freeCapacity
)
```

`liver` 自己把请求钳到剩余容量：肝满时 `storageRequestG = 0`，未请求部分留在血糖池，不进入 `disposedGlucoseG`。`glucose` 下一轮按请求与余额结算，实际支付经 transfer 进入 `liver.storageG`，再下一轮并入 `glycogenG`。肌肉静息胰岛素项用同一形式，参数为 `maxUptakeRateGPerMin = 0.5`、`halfMaxExcessG = 20`、`insulinSensitivity = 1.0`，并在运动时额外叠加收缩非胰岛素依赖摄糖 `exerciseUptakeRateGPerMin (0.15) × clamp(intensity, 0, 1) × dtMin × clamp(G / 90, 0, 1.5)`；实际到账进入 `muscleGlucose.uptakeG` 后，下一轮聚合器按 0.05 / 0.45 / 0.50 份额转给三个区域（缺区域变体按剩余份额归一），区域再下一轮入账，初值合计 300 g（15 / 135 / 150 g），运动消耗按区域份额分摊（`0.5 × regionShare × intensity × dtMin`，三区合计 0.5 g/min）。肝参数为 `maxUptakeRateGPerMin = 0.2`、`halfMaxExcessG = 15`、`insulinSensitivity = 0.5`，全部 `design`、`source: null`。

**释放与肾糖异生。** 设 `G` 为轮初血糖、`H` 为轮初 `glucagonRelative`、`C` 为轮初 `adrenal.cortisolNmolL / 180`（未加载按 1）、`stored = max(0, prev.glycogenG + prev.storageG)`：

```text
suppression = 1 / (1 + max(0, G − 90) / 30)
liverRate = clamp((0.096 × suppression + 0.015 × max(0, 90 − G) + 0.15 × max(0, H − 1)) × max(0, C), 0, 1)
liverRelease = min(liverRate × dtMin, stored)
transfer liver.glycogenG → glucose.glucoseMassG: liverRelease（liverRelease > 0）

renalRate = clamp(0.024 × suppression + 0.005 × max(0, 90 − G) + 0.05 × max(0, H − 1), 0, 0.5)
renalOutput = min(renalRate × dtMin, 0.6)
transfer kidneyGluconeogenesis.glucoseOutputG → glucose.glucoseMassG: renalOutput（renalOutput > 0）
```

在 90 mg/dL、`H = 1`、`C = 1` 空腹静息基线下，肝释放 `0.096 g/min` + 肾糖异生 `0.024 g/min` = `0.120 g/min`，与 `glucose.basalConsumptionGPerMin = 0.12 g/min` 精确平衡（稳态血糖 90.0 mg/dL）；肝糖原耗尽后由肾糖异生平滑接管，单次运行观察到 24 h 平台约 74.0 mg/dL（无阶跃锯齿）。测试并不逐点断言 74.0：它逐轮断言血糖 `[60, 95] mg/dL` 且 `<= 105`，第 360 轮（6 h）另断言 `[85, 95] mg/dL` 与 `liver.glycogenG < 80`；这些不是人体测量或独立验证。`liver.outputG` 只是本轮释放记录，不进质量账；`kidneyGluconeogenesis.glucoseOutputG` 在 write 时写入本轮产量、经 transfer 转出后回合末归 0。只有肝与肾糖异生向血液产糖，肌肉没有释放路径。

**时序。** 高血糖侧：第 N 轮 `glucose` 写出高浓度与 `excessMassG`；第 N+1 轮胰腺读到高浓度、写出升高的 `insulinPmolL`，同轮聚合器与肝仍读第 N 轮的 `excessMassG` 与信号，写出首批请求；第 N+2 轮 `glucose` 结算首批请求，实际支付到账；第 N+3 轮聚合器把 `muscleGlucose.uptakeG` 分给区域，肝把 `storageG` 并入 `glycogenG`；第 N+4 轮区域把到账量并入 `glycogenG`，同时按第 N+2 轮升高的信号写下一批请求。低血糖侧：`glucose` 写出低浓度后，`liver` 与 `kidneyGluconeogenesis` 下一轮平滑增加输出；有胰腺时再下一轮读到升高的 `glucagonRelative` 并进一步放大。释放/产糖轮的 `glucose` 浓度仍按轮初质量计算，提交后 `glucoseMassG` 已回升，再下一轮浓度才上升。

**旧档与重启。** 旧档缺 `liver` 时补 `storageRequestG = 0`、`glycogenG = 80`、`storageG = 0`、`glycogenCapacityG = 100`、`outputG = 0`；缺 `kidneyGluconeogenesis` 时补 `glucoseOutputG = 0`；缺 `muscleGlucose` 时补 `uptakeRequestG = 0`、`uptakeG = 0`，缺区域时补 `uptakeG = 0`、`glycogenG = 15 / 135 / 150`、`glycogenConsumedG = 0`；旧档只有 `muscleGlucose.glycogenG` 时，各区域第一轮按存在区域份额迁移：默认种子状态用迁移份额取代 300 g 份额初值，已有真实状态则并入存量；聚合器第一次 write 后旧总量不再保留，后续不会重复迁移；若旧实现已经完成迁移并删除 `muscleGlucose.glycogenG`，新代码无法识别或自动回改，唯一可靠纠正是从迁移前备份恢复；这里不声称已验证存在这种真实存档。在途 `uptakeG` 仍由聚合器正常分配。`glucose` 旧档的 `excessMassG` 由首轮轮初质量现算；`pancreasEndocrine` 旧档补 `insulinPmolL = 60` 与 `glucagonRelative = 1`，不承诺保留旧 `insulinRelative` 偏差，不反推历史。含 `glucose` 的旧清单必须补上 `liver`、`kidneyGluconeogenesis`、`muscleGlucose` 与三个区域（或对应缺区域变体），否则启动时报 transfer 配对错误。重启保留已提交请求、存量与在途 `storageG` / `uptakeG`，下一轮只处理一次；容量每轮由 `liver` 按参数重写为 100；`outputG` 不参与释放计算。

**清单与参数。** 现行清单与硬 transfer 闭包数量见 §2。`glucose.residualDisposalHalfTimeMin = 60` 与 `glucose.basalConsumptionGPerMin = 0.12` 在 `glucose.parameters.json`；肌肉与肝参数在 `glucose-uptake.parameters.json` 与 `glycogen.parameters.json`；肾糖异生在 `kidney/gluconeogenesis.parameters.json`；`pancreasEndocrine.*`（11 项）在 `pancreas/insulin.parameters.json`，全为 `design`、`source: null` 工程调参。

**当前实现。** 上述脚本、参数、字段、transfer 配对、旧档补齐、缺区域变体和清单计数已实现；模块契约测试在 `test/organs.liver.test.mjs`、`test/organs.renal-gluconeogenesis.test.mjs`、`test/organs.muscle-glucose.test.mjs`、`test/organs.muscle-regions.test.mjs` 与 `test/organs.glucose.test.mjs`，真实 Gateway 账本测试在 `test/organs.liver-gateway.test.mjs`、`test/organs.renal-gluconeogenesis-gateway.test.mjs`、`test/organs.glucose-gateway.test.mjs`、`test/organs.tissue-uptake-gateway.test.mjs`、`test/organs.muscle-regions-gateway.test.mjs` 与 24 小时空腹体温/血糖代理回归测试 `test/organs.steady-state-24h.test.mjs`。这些测试都是离线的，不是实机验收。

**未建模。** 不建胰高血糖素绝对浓度、分泌率、C-peptide、两室激素动力学、α/β 细胞相互抑制、受体或胞内信号；不建肝糖异生、肾糖异生底物池（乳酸/氨基酸/甘油）、酶促糖原合成/分解、Cori 循环、脂肪组织分区与脂肪摄糖、肌糖原容量、静息肌糖原周转、酮症、尿素循环、肝血流；也不建胆汁生成/排泄、解毒、蛋白合成、脂肪代谢或其他肝功能。容量固定为 100 g，不随年龄、体重、进食状态、激素或肝体积变化，不建容量反馈或超容量存量对释放的抑制。

**后续项（计划）。** 脂肪组织按同一请求—结算接口接入；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。这些都不是当前实现。

**未验证。** 没有肝糖原/肾糖异生实测、容量实测、独立血糖曲线、激素浓度、正常餐后曲线复现、真实 DSH 会话或临床验证；肝/肾/肌/血糖新参数全部是 `design`、`source: null`。不能称 `validated` 或个体预测。设计见[肝糖原与胰高血糖素设计](./superpowers/specs/2026-11-23-liver-glycogen-design.md)、[各部位自主摄糖设计](./superpowers/specs/2026-11-24-tissue-uptake-design.md)与[肾糖异生设计](./superpowers/specs/2026-11-24-renal-gluconeogenesis-design.md)，部位契约见[肝 README](../organs/human-organs/liver/README.md)、[肾 README](../organs/human-organs/kidney/README.md)、[骨骼肌 README](../organs/human-organs/skeletal-muscle/README.md)与[胰腺 README](../organs/human-organs/pancreas/README.md)。

### 活动相关失水：皮肤出汗与呼吸（当前模块）

`body_act` 的 `exercise` 只需要 `0 < intensity <= 1` 与 `durationMin > 0`；`sex`（受 `nsfw` 门控）除必填 `intensity`（感官刺激强度）与 `durationMin` 外，还支持可选 `exertion`（`0 <= exertion <= 1`，代表全身骨骼肌体力负荷；结构化直传缺省时兼容沿用 `intensity`，翻译官会按单人躺卧轻抚 `0–0.08`、主动伴侣性交 `0.30–0.65` 解耦填写）。`physicalActivity` 先按 `io.dt` 递减活动剩余时间，再处理本轮 `io.actions`：遇到 `stop_exercise`、`sleep` 或未传入 `continueStimulation: true` 的释放型 `orgasm`（仅当存在配对性活动上下文且后面无新 `exercise`/`sex` 时）会将剩余时间与强度清零；遇到合法 `exercise` / `sex`（且 `exertion > 0`）则替换剩余时间和强度，非法动作不覆盖已有有效状态。

`skin` 与 `lungs` 读取同一份轮初活动快照，写下一轮请求：

- 皮肤：默认 25°C 时 `exerciseRate = (R > 0 && I > 0) ? 0.6 × weightScale × I × max(0, 1 + 0.04 × (T_amb − 25)) : 0`；非运动静息态相对动态设定点增加 `interthresholdOffsetC = 0.25 °C` 阈间死区（夜间 `setpointC < 37 °C` 时展宽为 `0.45 °C`），运动态沿用 `max(37, setpointC)`，叠加 `thermalRate = heatGain × weightScale × max(0, coreTemperatureC − thermalThresholdC)`，总速率按体重缩放上限（75 kg 为 `15 mL/min`）钳位后乘 `dtMin`。
- 肺：剩余活动时间大于 0 时 `0.3 × weightScale × intensity × dtMin`，否则为 0；只表示运动相关呼吸失水，不含静息呼吸。
- `dtMin = io.dt / 60`。活动剩余时间为 0 或部位未加载时活动项为 0；部位已加载但字段缺失、非有限、负数或 intensity>1 时抛错。

七个皮肤参数（含 `skin.interthresholdOffsetC = 0.25`、`skin.nocturnalDeadbandOffsetC = 0.45` 两项以 `SRC-WENGER-1976` / `SRC-KENNY-2008` 为机制背景的 `design` 工程占位）和肺的 `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3`（`mL/min`）均标为 `design`；`lungsVentilation` 新增 Hey Plot 潮气量先招募后升频与静息 `+0.8 °C` / 运动 `0.35` 分离热致喘息机制（全部 `design`，参考 `SRC-HEY-1966`、`SRC-NEDER-2003`、`SRC-LOE-2014`、`SRC-TSUJI-2012`）。`hypothalamusThirst` 水合稳态基线已归 `0 mm`，采用体重同步缩放体液容积丢失转等效渗透压再接入 `SRC-HUGHES-2018`（`285.23 mOsm/kg` 阈值与 `5.4 mm/(mOsm/kg)` 斜率两项标 `prior`，等效渗透池 `osmoticPoolReferenceMl = 30000` 与基线起点标 `design`）。`interoception.sweatDampMm` 改为按 `referenceEvapRateMlMin = 4.5 mL/min`（按体重缩放）折算 Gagge 皮肤湿润度稳态平衡并与 `halfTimeMin = 5 min`（工程占位 `design`）平滑弛豫，消除停动后累加过冲。

体液对同一份轮初水按肾 → 肺 → 汗依次分配（顺序是 `policy`，不是人体优先级证据）：

```text
U_kidney = clamp(kidney.urineProductionRequestMl, 0, W_start)
U_lung   = clamp(lungs.respiratoryWaterLossRequestMl, 0, max(0, W_start − U_kidney))
U_sweat  = clamp(skin.sweatRequestMl, 0, max(0, W_start − U_kidney − U_lung))
```

`bodyFluid` write 轮初水后，分别向 `bladder.volumeMl`、`lungs.respiratoryWaterLossMl` 和 `skin.sweatVolumeMl` transfer；三路合计不超过 `W_start`，小肠同轮流入不能支付本轮出口。肺和皮肤的实际通量每轮 write 先归 0，只由 `transferIn` 增加；请求字段不是实际失水。

默认时序固定为：第 1 轮活动进入 `physicalActivity`，第 2 轮皮肤与肺同时写请求，第 3 轮首次实际转移。25°C、intensity=1、durationMin=30 时，两路请求都在第 2–31 轮出现，结算在第 3–32 轮完成，累计汗液 18 mL、运动相关呼吸失水 9 mL。水账为

```text
胃水 + 队列水 + 小肠水 + 结肠残渣水 + (体液水 − 初始体液水) + 膀胱尿 + 累计 voidedMl
  + 累计 skin.sweatVolumeMl + 累计 lungs.respiratoryWaterLossMl = 累计饮水
```

“结肠残渣水”是 `colon.residueWaterMl`；结肠回收是残渣水池到体液的内部回流，只在残渣水项里体现，不另加外部流入。请求不计入实际失水；无活动时原十轮轨迹与水账不变。旧档只为缺失的 `lungs` 补 `respiratoryWaterLossRequestMl` / `respiratoryWaterLossMl` 两个 0 字段，不反推历史失水；重启保留已提交状态，上一轮通量不会重复计入。口渴仍经下丘脑、体感和通知按各自轮初快照变化，不自动饮水，也不新增提醒类型。本切片只有离线模块与根清单 Gateway 测试，未做真实 DSH 会话或独立人体验证。完整设计见[活动—皮肤出汗设计](./superpowers/specs/2026-11-23-activity-sweat-design.md)与[运动相关呼吸失水设计](./superpowers/specs/2026-11-23-respiratory-water-loss-design.md)。

### 血氧池与自动通气（当前模块）

本切片新增 `bloodOxygen` 隔室与 `lungsVentilation` 部位，不新增动作、通知或 `transfer`；两者都不写其他部位。现行清单与硬 transfer 闭包数量见 §2。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `bloodOxygen` / `organs/human-compartments/blood-oxygen/oxygen.ts` | `oxygenConsumptionMlMin`、`oxygenSupplyMlMin`、`spo2Percent`、`oxygenDeficit` | 轮初 `physicalActivity`、`duodenum.nutrientExposure`、`lungsVentilation.alveolarO2CapacityMlMin`、`blood.maxOxygenDeliveryMlPerMin`、`thyroid.thyroxineRelative` | `lungsVentilation` 与 `thermoregulation` 读需氧；`blood` 读 `spo2Percent`；`interoception` 读缺口；`body_state` 读 SpO2/缺口 |
| `lungsVentilation` / `organs/human-organs/lungs/ventilation.ts` | `tidalVolumeMl`、`respiratoryRatePerMin`、`ventilationMlMin`、`alveolarO2MlMin`、`alveolarO2CapacityMlMin` | 轮初 `bloodOxygen.oxygenConsumptionMlMin`、`thermoregulation.coreTemperatureC` | `bloodOxygen` 读 `alveolarO2CapacityMlMin` |

四个 `bloodOxygen` 字段都是 `absolute`：`oxygenConsumptionMlMin`（`mL/min`，基础 + 活动 + 消化需氧）、`oxygenSupplyMlMin`（`mL/min`，受能力上限约束的供给）、`spo2Percent`（`%`，血氧饱和度代理）、`oxygenDeficit`（`1`，未满足比例）。五个 `lungsVentilation` 字段也是 `absolute`：`tidalVolumeMl`（`mL`）、`respiratoryRatePerMin`（`1/min`）、`ventilationMlMin`（`mL/min`）、`alveolarO2MlMin`（`mL/min`）与 `alveolarO2CapacityMlMin`（`mL/min`）。

```text
basalDemand = 250 × max(0.2, 0.6 + 0.4 × thyroxineRelative)   （未加载 thyroid 时 = 250）
demand = basalDemand + 1000 × intensity（remainingExerciseMin > 0）+ 0.1 × nutrientExposure × 250
capacity = min(lungsVentilation.alveolarO2CapacityMlMin, blood.maxOxygenDeliveryMlPerMin)（均未加载时 = demand）
supply = min(demand, capacity)
deficit = demand > 0 ? clamp((demand − supply) / demand, 0, 1) : 0
spo2Percent = 97 × (1 − deficit)

metabolicVentilation = demand × 1.4 / 0.058333
pantingMlMin = 1500 × max(0, coreTemperatureC − 37)
targetVentilation = max(6000, metabolicVentilation) + pantingMlMin
ventilationMlMin = clamp(targetVentilation, 6000, 60000)
respiratoryRatePerMin = clamp(ventilationMlMin / 500, 12, 40)
tidalVolumeMl = 500
alveolarO2MlMin = ventilationMlMin × 0.058333 / 1.4
alveolarO2CapacityMlMin = 60000 × 0.058333 / 1.4   （约 2500 mL/min）
```

- 全部参数 `design`、`source: null`：`bloodOxygen.basalMlMin = 250`、`activityGainMlMin = 1000`、`digestionGain = 0.1`、`baselineSpo2Percent = 97`；`lungsVentilation.restingTidalVolumeMl = 500`、`restingRatePerMin = 12`、`maxRatePerMin = 40`、`restingVentilationMlMin = 6000`、`maxVentilationMlMin = 60000`、`inspiredO2Fraction = 0.058333`（净肺泡氧摄取分数）、`deadSpaceFactor = 1.4`、`pantingGain = 1500`。它们不是人体测量、实测最大通气量或血气；`range` 只是工程调参范围。
- **T4 缩放基础项。** `thyroid.thyroxineRelative` 只乘基础需氧：T4 = 1 时精确保持 `1.0×`（250 mL/min）、T4 = 0 时为 `0.6×`（150 mL/min）、T4 = 2 时为 `1.4×`（350 mL/min），下限钳位 `0.2×`；活动附加项与消化项仍按 `250` 计。未加载甲状腺时基础项保持 `250`。
- **不是耗空账本。** 每轮按轮初快照重算供需，不保存氧气质量、不累计氧债；`spo2Percent` 与 `oxygenDeficit` 只是代理读数，不是脉搏血氧仪或血气分析。
- **自动通气。** 呼吸由 `lungsVentilation` 自动调节，`actionTypes = []`；LLM 不提交呼吸、屏气或过度通气动作。SpO2 由需氧与能力上限 `min(alveolarO2CapacityMlMin, maxOxygenDeliveryMlPerMin)` 决定，避免活动首轮假性去饱和；`alveolarO2MlMin` 只作实际通气滞后读数。
- **触顶。** 默认肺泡氧供给能力上限约为 `60000 × 0.058333 / 1.4 ≈ 2500 mL/min`；需求继续升高或循环上限更低时由 `bloodOxygen` 计算缺口。频率读数在触顶时单独钳到 40 次/min，不再等于 `ventilationMlMin / tidalVolumeMl`。
- **气促读数。** `interoception` 软读 `oxygenDeficit` 写 `dyspneaMm = clamp(100 × deficit, 0, 100)`；未加载、缺失或非有限按 0。它不进入 `discomfort`，`brainNotify` 不读它，也没有气促通知。
- **T4 与压力/困倦读数。** 内分泌轴接入后，`interoception` 另软读 `adrenal.cortisolNmolL`（除以 `180 nmol/L` 归一化）与 `autonomic.sympatheticMm` 写 `stressMm`，软读 `pineal.melatoninRelative`、`sleep` 与 `hedonicCalmMm` 写 `sleepinessMm`，详见下文「内分泌轴与松果体」及 [`brain` README](../organs/human-organs/brain/README.md)。
- **可选部位回退。** 未加载 `bloodOxygen` 时通气按基础需氧 250 mL/min；未加载 `lungsVentilation` 与 `blood` 时血氧池按 `supply = demand`、SpO2 保持基线；已加载但字段缺失、非有限或为负时抛错，本轮不写。旧档只补初值，不反推历史；根清单同时加载它们。
- `body_state` / `GET /state` 会返回 `bloodOxygen` 四个字段与 `lungsVentilation` 五个字段；`interoception` 增加 `dyspneaMm`。这些只是模型读数，不是血气、脉搏血氧或临床气促分级。本切片只有模块与真实 Gateway 离线测试，未做真实 DSH 会话、独立人体数据或临床验证。

### 内分泌轴与松果体（当前模块）

内分泌切片涵盖 `hypothalamusEndocrine`、`pituitary`、`thyroid`、`adrenal` 与 `pineal` 五个部位（不新增硬闭包），已随三份清单（41/37、女性 44/40、男性 43/39）加载。`pituitary` 与 `adrenal` 现采用物理浓度单位（`acthPgMl`、`prolactinNgMl`、`oxytocinPgMl`、`cortisolNmolL`），结合文献清除半衰期（`prior`）与工程反馈常数（`design`）。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `hypothalamusEndocrine` / `brain/hypothalamus-endocrine.ts` | `trhRelative`、`crhRelative`、`carElapsedMin` | 自己的轮初状态与 CAR 醒后计时；`thyroid.thyroxineRelative`、`adrenal.cortisolNmolL`（`/ 180` 归一化）；`thermoregulation`、`glucose`、`physicalActivity`、`autonomic`、`sleep`、`reward.hedonicMm` 与 `pituitary.oxytocinPgMl`（非低血糖应激温和缓冲）；`io.wallTimeMs`、`io.dt` | `pituitary` 读 TRH/CRH |
| `pituitary` / `brain/pituitary.ts` | `tshRelative`、`acthPgMl`、`prolactinNgMl`、`oxytocinPgMl` | 自己的轮初状态；`hypothalamusEndocrine`、`thyroid`、`adrenal.cortisolNmolL`、`mammaryGlands.lactating`/`stimulationMin`（与 `milkMl` 解耦）、`sleep`、`sexualResponse`、`io.actions`、`io.wallTimeMs`、`io.simulatedSeconds` | `thyroid` 读 TSH；`adrenal` 读 `acthPgMl`；`mammaryGlands`/`ovaries`/`testes` 读 `prolactinNgMl`；`mammaryGlands`/`uterus`/`reward`/`autonomic`/`hypothalamusEndocrine` 读 `oxytocinPgMl` |
| `thyroid` / `thyroid/thyroid.ts` | `thyroxineRelative` | 自己的轮初状态；`pituitary.tshRelative`（未加载按 1） | `bloodOxygen` 缩放基础氧耗；`hypothalamusEndocrine` / `pituitary` 负反馈 |
| `adrenal` / `adrenal/cortisol.ts` | `cortisolNmolL` | 自己的轮初状态；`pituitary.acthPgMl`（未加载按 12 pg/mL）；非线性 Hill 分泌与消除（半衰期 `49 min`） | `liver`、`heart`、`interoception.stressMm`、`testes`、`reward`、`hypothalamusEndocrine` / `pituitary` |
| `pineal` / `pineal/melatonin.ts` | `melatoninRelative` | `io.wallTimeMs`（本地时钟光照/昼夜节律）与 `sleep.sleeping`；滞后半衰期 `39.4 min`（`SRC-DIJK-1995`） | `interoception.sleepinessMm`、`sleep`、`lungsVentilation`、`autonomic` |

- **负反馈与基线稳态。** `pituitary` 基线稳态为 `tshRelative = 1`、`acthPgMl = 12 pg/mL`、`prolactinNgMl = 8 ng/mL`（叠加 24h 节律、`6 ng/mL` 睡眠抬升、`82 ng/mL` 吸吮刺激与高潮冲击；半衰期 `34.6 min`）与 `oxytocinPgMl = 2 pg/mL`（叠加吸吮/性唤醒/高潮脉冲；半衰期 `3.8 min`）。`adrenal` 以 Michaelis–Menten Hill 曲线（`Ec50 = 26 pg/mL`、`maxSecretion = 10 nmol/(L·min)`、`hill = 1.85`、`eliminationHalfTimeMin = 49 min`）围绕 `180 nmol/L` 参考稳态响应。`thyroid` 半衰期调整为 `1440 min`（`SRC-NICOLOFF-1972`，`prior`）。下游读者通过 `cortisolNmolL / 180` 得到归一化驱动，不把这些物理浓度当成临床化验。
- **可选部位回退与异常。** 未加载上游部位时按基线回退；已加载但必需激素/刺激字段缺失、非有限或为负（含已加载 `mammaryGlands` 时检查 `stimulationMin`）则抛错，本轮不写。
- **甲状旁腺与血钙：** `parathyroid`（PTH）与 `bloodCalcium` 隔室及单元闭环测试已入库，但当前仍未挂载进三份 `body-modules*.json` 清单，运行时不生效。详见 [`thyroid`](../organs/human-organs/thyroid/README.md)、[`adrenal`](../organs/human-organs/adrenal/README.md)、[`pineal`](../organs/human-organs/pineal/README.md) 与 [`brain`](../organs/human-organs/brain/README.md)。
- **未建模。** T3、反 T3、甲状腺结合球蛋白、碘摄入、甲状腺疾病；肾上腺素/去甲肾上腺素、醛固酮与 RAAS；T4、胰高血糖素、褪黑素等其余激素的绝对浓度，完整分泌脉冲机制、受体、结合蛋白、疾病与个体差异；真实环境光输入、光史、时差、自由运行周期与睡眠行为决策。**甲状旁腺与血钙：** `parathyroid`（PTH）与 `bloodCalcium` 隔室（含骨钙库、`* 1000` 单位修正与骨容量上限质量守恒）及单元闭环测试已入库，但尚未挂载进三份 `body-modules*.json` 清单，运行时不生效。
- **未验证。** 没有本模型的激素实测、剂量反应、独立人体数据、临床验证、真实 DSH 会话或性能基线实测。部分清除/半衰期参数以已登记人体文献为先验（`prior`），但分泌与反馈增益、曲线形状、耦合系数及多种基线仍为 `design`；这些文献锚点不等于本模型经过拟合、实测或 `validated`。`stressMm` / `sleepinessMm` 也不能当作压力、困倦量表、激素浓度或睡眠分期。详见 [`thyroid`](../organs/human-organs/thyroid/README.md)、[`adrenal`](../organs/human-organs/adrenal/README.md)、[`pineal`](../organs/human-organs/pineal/README.md) 与 [`brain`](../organs/human-organs/brain/README.md)。

### 唾液腺与口干（当前模块）

本切片新增 `salivaryGlands`，脚本为 `organs/human-organs/salivary-glands/saliva.ts`，处理 `eat` / `drink` 动作。它不新增 `transfer` 或通知；现行清单与硬 transfer 闭包数量见 §2。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `salivaryGlands` / `salivary-glands/saliva.ts` | `salivaRateMlPerMin`、`mealStimulusMin`、`mouthMoistureMm` | 自己的轮初状态；`bodyFluid.waterDeficit`（未加载按 0）；本轮 `eat` / `drink`；`io.dt` | `duodenum` 读产率；`interoception` 读湿润度 |

```text
dtMin = io.dt / 60
mealStimulusMin = max(0, prev.mealStimulusMin − dtMin)；本轮有合法 eat / drink 时置为 mealWindowMin
stimulated  = mealStimulusMin > 0 ? mealGain : 1
dehydration = 1 − dehydrationFactor × clamp(bodyFluid.waterDeficit, 0, 1)
salivaRateMlPerMin = basalRateMlPerMin × stimulated × dehydration
mouthMoistureMm    = clamp(100 × salivaRateMlPerMin / basalRateMlPerMin, 0, 100)
```

- **当前实现。** 合法摄入对齐胃/食管契约：`drink` 需正有限 `volumeMl`（`energyKcal` 可选且非负有限）；`eat` 另需合法 `mealKind`（`liquid`/`solid`/`mixed`）与非负有限 `energyKcal`；同轮多条合法动作只重置一次刺激窗口。水合静息时 `salivaRateMlPerMin = 0.5`、`mouthMoistureMm = 100`（`dryMouthMm = 0`）；最大脱水（`waterDeficit = 1`）时 `mouthMoistureMm = 50`（`dryMouthMm = 50`）；一次 `eat` / `drink` 后产率在 5 个 60 s 轮次保持 `×3`（`mouthMoistureMm` 钳到 100），第 6 轮回到基线。旧档缺该部位时补 `{ salivaRateMlPerMin: 0.5, mealStimulusMin: 0, mouthMoistureMm: 100 }`，不反推历史进食；重启保留已提交的窗口与产率，没有 `resetOnStart`。
- **消费者。** `duodenum` 只在轮初 `stomach.emptiedCarbohydrateG > 0` 时把到达速率乘 `1 + salivaryAmylaseGain × salivaRateMlPerMin / duodenum.referenceSalivaRateMlPerMin`（不再读取 `saliva.parameters.json`），`salivaryGlands` 未加载时增益按 0；已加载但产率非法时抛错，本轮不写。`interoception` 写 `dryMouthMm = clamp(100 − mouthMoistureMm, 0, 100)`，未加载或字段非法时按 0；口干不入 `discomfort`，也不改变口渴或饮水。
- **时序。** 两个消费者都读轮初快照。摄入轮本脚本写出刺激状态；`interoception` 下一轮才读到新湿润度，`duodenum` 还要等胃把该餐排入下一轮快照，最早再下一轮才把淀粉酶增益计入暴露。
- **快速解渴与口干独立。** [内感受的工程快路](../organs/human-organs/brain/README.md#interoception) 只用轮初新鲜的、已经提交的 `stomach.deliveredWaterMl` 产生短暂的主观口渴缓解；唾液和口干不参与。这条快路不增加体液，也不抑制 ADH，不是实测的口咽或激素响应模型。
- **参数。** `salivaryGlands.basalRateMlPerMin = 0.5`、`mealGain = 3`、`mealWindowMin = 5`、`dehydrationFactor = 0.5` 都在 `saliva.parameters.json`；`duodenum.salivaryAmylaseGain = 0.05` 与 `duodenum.referenceSalivaRateMlPerMin = 0.5` 在 `duodenum/nutrient-exposure.parameters.json`（唾液腺参数文件的 `consumerParameters` 另保留 `duodenum.salivaryAmylaseGain` 供对照，两模块不再跨器官直读参数文件）。全部 `design`、`source: null`，没有唾液流率、刺激时长、脱水缩减或淀粉酶活性证据。
- **未建模。** 唾液水账（唾液不进出 `bodyFluid`）、淀粉酶浓度/活性/pH、完整吞咽分期与食管运动（食管薄切片只建食团转运时延与呛咳读数）、口腔疾病与唾液腺结石、味觉与咀嚼、个体差异与昼夜节律、免疫与口腔微生物组。
- **未验证。** 没有唾液流率、刺激窗口、脱水系数或淀粉酶增益的实测、独立人体数据、临床验证或真实 DSH 会话。详见 [`salivary-glands`](../organs/human-organs/salivary-glands/README.md)、[`duodenum`](../organs/human-organs/duodenum/README.md) 与 [`brain`](../organs/human-organs/brain/README.md) README。

### 乳腺泌乳与女性葡萄糖变体（当前模块）

女性清单专属加载 `mammaryGlands`、`water.female.ts` 与 `glucose.female.ts`。`mammaryGlands` 现升级为**非妊娠泌乳诱导状态机、腺泡局部反馈自抑制（`1 − DF²`）与催产素门控喷乳反射**：

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `pituitary` / `brain/pituitary.ts` | `tshRelative`、`acthPgMl`、`prolactinNgMl`、`oxytocinPgMl` | 自身轮初状态；`mammaryGlands.lactating` / `stimulationMin`（与 `milkMl` 解耦）、`sexualResponse`、`sleep` 等 | `mammaryGlands` 读 `prolactinNgMl` 与 `oxytocinPgMl` |
| `mammaryGlands` / `mammary-glands/milk.ts` | `lactating`、`galactorrhea`、`inductionProgress`、`storedMilkMl`、`ejectedMilkMl`、`stimulationMin`、`pendingEjections`、`milkRequestMl`、`milkMl`、`lactoseRequestG`、`lactoseG`、`fullnessMm` | 自身轮初状态；`pituitary.prolactinNgMl` / `oxytocinPgMl`、`ovaries`（高孕酮抑制诱导）；`getProfileLactating()`、`getNsfwSetting()`、`io.actions`（`express_milk` / `breastfeed`）、`io.dt` | `water.female.ts` 读 `milkRequestMl`；`glucose.female.ts` 读 `lactoseRequestG`；`interoception` 读 `fullnessMm`；`pituitary` 读 `lactating` / `stimulationMin`；`brainNotify` 读 `fullnessMm` / `ejectedMilkMl` |
| `bodyFluid` / `water.female.ts` | `waterVolumeMl`、`waterDeficit` | 轮初肾、肺、皮肤、子宫与乳腺请求 | 第五出口把水转入 `mammaryGlands.milkMl`（唯一体液扣账点） |
| `glucose` / `glucose.female.ts` | `glucoseMassG`、`concentrationMgDl`、`disposedGlucoseG`、`excessMassG` | 轮初肾糖、肝、肌与乳腺请求 | 末位汇把糖转入 `mammaryGlands.lactoseG` |
| `interoception` / `brain/interoception.ts` | `mammaryFullnessMm`、`discomfort`（第六路） | 轮初 `mammaryGlands.fullnessMm`（受 `nsfw` 门控） | `body_state` 与 `brainNotify` |

- **默认非泌乳、预设与诱导状态机。** 默认女性身体未在哺乳；可通过存档顶层 `profile.lactating: true`（在 `nsfw: true` 下把 `inductionProgress` / `lactating` 设为已建立稳态）或持续高 PRL（`>= 45 ng/mL`）+ 机械刺激（`express_milk` / `breastfeed`）逐步推进 `inductionProgress ∈ [0, 1]`（≥ `0.25` 出现 `galactorrhea` 溢乳、达到 `1.0` 进入 `lactating` 产奶；停止刺激按 `7 d` 半衰期退化）。`nsfw: false` 时清零泌乳请求与排乳并让充盈回落。
- **水/糖单口径守恒与两段池。** 新合成乳汁先通过 `milkRequestMl`（`bodyFluid → mammaryGlands.milkMl`）与 `lactoseRequestG`（`glucose → mammaryGlands.lactoseG`）一次记账进入腺泡池 `storedMilkMl`（上限 `360 mL`，按 `DF = storedMilkMl / 360` 产生 `1 − DF²` 局部自抑制并推导 `fullnessMm`）；`express_milk` / `breastfeed` 在 `oxytocinPgMl >= 5 pg/mL` 门控下将 `storedMilkMl` 按单次 PAMR 排出为 `ejectedMilkMl`，后续刺激延续不重复套用 PAMR，且绝不双扣 `bodyFluid` 或 `glucose`。
- **清单与证据。** 女性清单数量见 §2；`mammaryGlands` 是女性清单独有的泌乳部位，三份成人清单共用的 `breastComposition` 是独立派生读数，不参与泌乳、库存或 transfer。`milk.parameters.json` 现含 14 项参数（其中 `basalMilkRateMlPerMin = 0.54`、`storageCapacityMl = 360`、`breastfeedPamr = 0.673` 挂 `SRC-KENT-2006`，`expressPamr = 0.75` 挂 `SRC-PRIME-2012`，其余 `design`）。详细方程与文献边界见 [`mammary-glands`](../organs/human-organs/mammary-glands/README.md)。

### 性行为与性反应周期（当前模块）

`body_act` 的 `type` 在 `nsfw: true` 时支持 `sex`、`orgasm`、`express_milk` 与 `breastfeed`（默认 `nsfw: false` 时由工具层与 HTTP 队列 `403` 禁用）。`sex` 载荷为 `{ type: "sex", intensity, durationMin, exertion? }`，`orgasm` 支持 `{ type: "orgasm", continueStimulation?: boolean }`，`express_milk` / `breastfeed` 支持可选 `durationMin` 与 `bilateral?: boolean`。

`sexualResponse` / `sexual-response/response.ts` 维护 8 个字段（`arousalMm`、`phase`、`remainingSexMin`、`sexIntensity`、`lastOrgasmAtSimMin`、`afterglowMm`、`lastAttemptedOrgasmAtSimMin`、`lastOrgasmBlockReason`）与 10 项 `design` 参数（含 `stimulusHalfSaturation = 0.022` 与 `stimulusFloorWeight = 0.77` 两项工程饱和曲线占位，使持续 `0.25–0.40` 温和刺激也能稳步越过 `70 mm` 释放门槛），并导出共享纯函数 `evaluateSexualRelease(prev, actions, context)` 供 `autonomic.ts`、`reward.ts`、`skeletal-muscle/activity.ts` 与 `uterus.ts` 复用：

- **男女不应期与性周期差异：** 女性（加载 `ovaries` 且无 `testes`）取消固定 20 min 绝对不应期，仅保留 `femalePostOrgasmPauseMin = 2 min` 防连跳窗口，期间允许再次激发唤醒与多次高潮，性欲与唤醒幅值受 `ovaries` E2/P4（温和 `[0.9, 1.15]` 区间）、`reward` 与 `pituitary.prolactinNgMl` 共同调节（`SRC-RONEY-2013`）；男性保留 `refractoryMin = 20 min` 基础不应期并受高 PRL 延长（`testes` 9 项参数另纳入睡眠债务与应激/PRL 抑制）。高潮释放当轮默认停止 `remainingSexMin` 与配对体力活动（除非 `orgasm.continueStimulation === true`）；未达阈值或处于不应期提交 `orgasm` 会记录 `lastAttemptedOrgasmAtSimMin` / `lastOrgasmBlockReason`，并经 `brainNotify` 发一次跳过常规冷却的 `context` 反馈及 `body_state` 3 min 窗口解释。
- **高潮余韵与奖赏联动：** 释放时推高 `afterglowMm`（半衰期 `22 min`），在 `autonomic.ts` 与 `reward.hedonicMm` / `pituitary.oxytocinPgMl` 共同形成 `[0, 20] mm` 副交感余韵回升；`interoception` 暴露 `hedonicCalmMm` 并适度缓冲非低血糖 `stressMm`；`brainNotify` 追踪 `lastOrgasmAtSimMin` 以 5 min 防陈旧窗口触发高潮事件通知，并与性兴奋通知去重、同步给予受阻/出汗/交感退避复位。详见 [`sexual-response`](../organs/human-organs/sexual-response/README.md) 与 [`brain`](../organs/human-organs/brain/README.md)。

### 身体气候与衣层（当前模块）

三份主清单及选配脂质清单各自保存 `climate = { airTemperatureC, relativeHumidityPct }` 与 `clothing = { wornLayerIds }`。场景或穿着方只提交明确输入，不新增宿主工具、身份或远程场景权限，也不由系统提示、天气服务或提醒自动变化。可以在启用对应部位的初始身体预设写 `snapshot.parts`，运行中用 `POST /actions` 或现有 `body_act` 的结构化直传（工具自动填会话及动作 ID，不让翻译官猜温湿）。HTTP 例子省略会话字段：

```jsonl
{"id":"room","type":"set_environment","airTemperatureC":32,"relativeHumidityPct":90}
{"id":"tshirt-on","type":"wear_layer","layerId":"tshirt"}
{"id":"jacket-on","type":"wear_layer","layerId":"jacket"}
{"id":"jacket-off","type":"remove_layer","layerId":"jacket"}
```

温度必须是有限数，湿度为含边界的 `0–100`（`90` 表示 90%）。`climate` 只取当批最后一对完整有效值；`clothing` 按队列顺序维护有序唯一 ID，重复穿、脱未穿项、未知 ID 和非法动作载荷无效果。动作仍走原绑定、暂停、整轮提交与 ID 回执；记录保留时同载荷重试复用回执，异载荷冲突；裁剪后不保证去重。`queued` / `applied` 只描述队列，不保证领域值变化。第 N 轮提交的输入最早影响第 N+1 轮计算。

没有存档时，`climate` 整对采用已启用部位的 `initialState`；三份主清单仍为 25 °C / 50% RH。旧档在补算和重试前按原存档字段是否存在来补缺项：缺湿度填 50%、缺衣层填 `[]`，不沿用新身体的场景预设。只有旧档缺气温才检查存档 `parameters` 的 `skin.sweat.ambientTemperatureC` 与 `thermoregulation.ambientTemperatureC`。无有限覆盖取 25 °C；仅一值或同值沿用；冲突选择体温侧以保留旧干梯度，`startup.climateTemperatureMigration` 记录皮肤旧值、体温旧值与选择。已有气候、衣着、核心温和实汗不会被旧参数重写；两旧键仅留作迁移，以后用场景动作改气温。

发热预留可选 manifest owner `feverDrive` 的非负有限 `setpointOffsetC`（°C 温差），没有默认提供者也没有动作。普通状态走 `io.read`；`io.readPublished(id)` 只返回**本次运行上一成功轮**已启用部位通过 `io.write` 实际提交的冻结值，上一成功轮未写则返回 `undefined`。失败不推进该有效期；启动补丁可更新普通快照但不替换已提交的发布。重启清空发布记录，首个补算/重试轮不沿用旧发热信号；保留核心温与已付实汗。

例如第 N 轮发热源写正值、第 N+1 轮沉默：体温第 N+1 轮采用该值，第 N+2 轮回零；皮肤、冷热感和热喘读上一轮体温已采用值，所以第 N+2 轮仍反映该偏移，第 N+3 轮才回零。持续生效需要每轮发布，再发布可重新生效。衣层参数见[输入 README](../organs/body-inputs/README.md)，工程回放与不可比较项见[验收记录](../organs/body-inputs/thermal-replay.md)。

### 循环、体温调节与消化反馈补充（当前模块）

- **循环（`heart` + `blood`）：** `heart/heart.ts` 读轮初活动强度、`autonomic.sympatheticMm`、`sleep` 副交感下调与 `blood.bloodVolumeMl`，算 `drive = sleepBase + max(activityGain × intensity, sympatheticDriveGain × effectiveSympatheticMm)`、`preloadFactor = clamp(bloodVolumeMl / 5000, 0.5, 1.15)`、`strokeVolumeMl = clamp(70 × (1 + 0.2 × (drive − 1)) × preloadFactor, 30, 140)` 与 `cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl`（清醒静息 `70 × 70 = 4900`，睡眠期下调至约 55–60 bpm，惊醒时交感飙升拉高心率）。`blood/blood.ts` 在 `bodyFluid` 加载时将 `bloodVolumeMl` 耦合为 `clamp(5000 × bodyFluid.waterVolumeMl / 30000, 2500, 6000)`（未加载时保留自身状态），按 `referenceCardiacOutputMlMin = 4900` 与 `autonomic.sympatheticMm` 轻度血管收缩加成推出 `systolicMmHg` / `diastolicMmHg`（首轮静息精确 `120 / 80 mmHg`）、`oxygenDeliveryMlMin`、`maxOxygenDeliveryMlPerMin` 与 `gfrMlMin`。详见 [`heart`](../organs/human-organs/heart/README.md) 与 [`blood`](../organs/human-compartments/blood/README.md)。
- **体温调节（`thermoregulation`）：** 氧耗与寒战供热；干热项用非负基础/舒张导度乘带符号温差和衣层干倍率；蒸发项只扣轮初已付实汗中可被当轮水汽压差与衣层透过倍率蒸发的部分，不重复扣水。唯一温度写者按净热积分并钳到 `[25, 45] °C`。原昼夜/睡眠 `setpointC` 和可选发热增量分开发布，默认增量 0；详见[热账字段与参数](../organs/human-organs/brain/README.md#thermoregulation)及[真实 Gateway 工程与论文对照](../organs/body-inputs/thermal-replay.md)。
- **消化链闭环反馈：** `stomach` 排空速率乘 `1 − 0.5 × clamp(duodenum.nutrientExposure, 0, 1)`；`stomachGhrelin` 在含能摄入当轮改为分级下调 `clamp(min(current, nadir) − suppression, 0, peak)`（`suppression = 0.3 × mechanical + 0.3 × exposure + 0.4 × energyKcal / 250`）；`smallIntestine` 水吸收随 `waterDeficit` 微调、碳水吸收随高血糖浓度梯度负反馈减缓。详见 [`stomach`](../organs/human-organs/stomach/README.md) 与 [`small-intestine`](../organs/human-organs/small-intestine/README.md)。
- **离线重放工具：** [`tools/replay.mjs`](../tools/replay.mjs) 默认重放固定 5 模块 P0/P1 子集（含历史 `stomach/motility.ts`）以保持与既有用例兼容；传入 `--manifest [path]`（未指定路径时默认 `body-modules.json`，也可传入 `body-modules.male.json` / `body-modules.female.json` 与 `--signals`）即可通过 `createFieldRegistry` 与 `applyOperations` 运行完整清单的多器官离线仿真与守恒诊断。

### 本地生物节律、睡眠生理、自主神经与三档通知（当前模块）

- **本地时钟与多激素昼夜节律混合（`lib/circadian.js`）：** `pineal/melatonin.ts`、`testes/testosterone.ts`、`brain/hypothalamus-endocrine.ts`（CRH 晨峰夜谷）与 `brain/thermoregulation.ts` 基于 `io.wallTimeMs` 与运行环境本地时区（支持存档 `profile.timezoneOffsetMin` 与参数 `phaseShiftHours`）对齐当地钟点；停机超 12h 或休眠重连后即刻对齐当前本地相位。
- **睡眠节律、分期与睡眠下调（`sleep` / `brain/sleep.ts`）：** 处理 `actionTypes = ['sleep', 'wake_up']`，写 `sleeping`、`sleepPressureMm`（0–100 mm）、`sleepDurationMin`、`sleepStage`（`'awake' | 'light' | 'deep' | 'rem'` 90 min 周期）、`sleepInertiaMm`（醒后半衰期 20 min 衰减）与 `wakeEvent`（`'none' | 'natural' | 'action' | 'important' | 'startle' | 'speech'`）。深睡加速压力恢复（1.3x），`bloodOxygen`、`heart`、`lungsVentilation` 与 `thermoregulation` 在睡眠期间读取 `sleep` 做生理性下调；若睡眠中命中 `wake-evaluation.ts` 的高危惊醒（`startle`）、抬高后的重要门槛（`important`）、主动行为（吃/喝/如厕/运动/性）或 `wake_up`，同轮退出睡眠并写出 `wakeEvent`。**未建模：** 真实脑电波形、REM 梦境内容与长期睡眠剥夺损伤。
- **自主神经系统（`autonomic` / `brain/autonomic.ts`）：** 维护 `sympatheticMm`、`parasympatheticMm` 与 `startleActive`（14 项 `design` 参数）。睡眠中遭遇高危危机惊醒时同轮将 `sympatheticMm` 拉升至 `>= 85 mm`，并结合运动、低血糖、缺氧、低血压与寒冷应激按 2 min / 12 min 半时动力学调节；性释放余韵期结合 `sexualResponse.afterglowMm`、`reward.hedonicMm` 与 `pituitary.oxytocinPgMl` 产生 `[0, 20] mm` 副交感回升；驱动 `heart`、`blood`、`lungsVentilation`、`hypothalamusEndocrine`、`liver` 与 `interoception`。
- **中枢奖赏与全身体感汇聚（`reward` / `brain/reward.ts`、`interoception` / `brain/interoception.ts`）：** `reward` 维护 `wantingMm`、`hedonicMm` 与 `satietyMm`（14 项 `design` 参数），接入 HPA 非低血糖应激缓冲、副交感回升与性欲调制；`interoception` 共 23 个固定 `mm` 字段（新增 `mammaryFullnessMm` 与 `hedonicCalmMm`，外加可选 `sensations`）。
- **三档无数字通知与睡眠堆积（`brainNotify` / `brain/notify.ts`）：** `notify.parameters.json` 共 19 项 `policy` 参数，区分 **普通（`normal`，65–84 mm `context`）**、**重要（`important`，清醒 `>= 85` mm `wake`，睡眠抬高至浅睡/REM `>= 92` mm、深睡 `>= 95` mm）** 与 **紧急（`emergency`，危机 `wake` + 惊醒）**：紧急通知压过普通和重要两级暂不混发；新增 `lastOrgasmAtSimMin` 高潮边沿通知（5 min 防陈旧窗口 + 与性兴奋去重）与 `express_milk`/`breastfeed`/`ejectedMilkMl` 缓解提示；睡眠期间信号记入 `sleepBacklog` 并在醒来集中唤醒注入。详细方程与边界见 [`brain` README](../organs/human-organs/brain/README.md)。

## 4. 跑通第一个模块：记录一杯水

这个模块只累计已登记的饮水量，**不模拟吸收或排泄**。下面都从仓库根目录操作，无需安装 DSH，也不用修改仓库自带的清单或真实存档。先在同一终端创建一个空目录，用输出的路径保存下面三个文件：

```sh
REPO_ROOT=$PWD
mkdir -p /tmp/dsh-body
DEMO_DIR=$(mktemp -d /tmp/dsh-body/body-demo.XXXXXX)
mkdir -p "$DEMO_DIR/organs/human-organs/stomach"
printf '%s\n' "$DEMO_DIR"
```

**① `$DEMO_DIR/organs/human-organs/stomach/water-intake.ts`** — 正式开发时，你需要写的就是这样的部位模块。这里的 `IO` 只描述示例用到的接口，不是需要安装的 SDK。

```ts
export const id = 'waterIntake';
export const actionTypes = ['drink'];
export const initialState = { totalMl: 0 };
export const fields = {};

type State = typeof initialState;
type IO = {
  read(partId: typeof id): Readonly<State> | undefined;
  readonly actions: readonly { readonly type: string; readonly volumeMl?: unknown }[];
  write(next: State): void;
};

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  let totalMl = prev.totalMl;
  for (const action of io.actions) {
    const ml = action.volumeMl;
    if (action.type === 'drink' && typeof ml === 'number' && Number.isFinite(ml) && ml > 0) {
      totalMl += ml;
    }
  }
  if (totalMl !== prev.totalMl) io.write({ ...prev, totalMl });
}
```

**② `$DEMO_DIR/body-modules.json`** — 让 Gateway 知道要加载它。这里不挂启动脚本，普通停机补算也设为 0，便于观察一次动作。

```json
{
  "scripts": ["./organs/human-organs/stomach/water-intake.ts"],
  "startupScripts": [],
  "catchUpMinutes": 0,
  "scriptTimeoutMs": 10000
}
```

**③ `$DEMO_DIR/check.mjs`** — 只用于自测，不要加进 `scripts`。它启动真实 Gateway，用一个空闲端口发 HTTP 请求，然后手动推进一轮，省去等一分钟。正式运行由 DSH 启动 Gateway 并自动计时。

```js
import { pathToFileURL } from 'node:url';

const { startGateway } = await import(pathToFileURL(`${process.env.REPO_ROOT}/gateway.js`).href);
const gateway = startGateway({
  manifestPath: `${import.meta.dirname}/body-modules.json`,
  statePath: `${import.meta.dirname}/body-state.json`,
  port: 0,
  autoTick: false,
});
try {
  const { url } = await gateway.ready;
  const get = async (path) => (await fetch(url + path)).json();
  console.log(await get('/capabilities'));
  const response = await fetch(url + '/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'cup-1', type: 'drink', volumeMl: 200 }),
  });
  console.log(response.status, (await response.json()).status);
  await gateway.tick();
  console.log(await get('/state'));
  console.log((await get('/actions/cup-1')).status);
} finally {
  await gateway.stop();
}
```

运行 `REPO_ROOT="$REPO_ROOT" node "$DEMO_DIR/check.mjs"`。**在新目录第一次运行**，应依次看到：`drink` 对应 `['waterIntake']` → `202 queued` → `simulatedSeconds: 60` 且 `parts.waterIntake.totalMl: 200` → `applied`。再用同一目录运行，`cup-1` 是重试，累计值仍为 200，而不是 400。要在 DSH 中使用，按[加载插件](./virtual-body.md#加载插件)接入，把 TS 路径追加到实际清单的 `scripts`，保留其他条目，再重启 Gateway。`check.mjs` 不需要部署，自测目录可以删除。

### 接下来可能用到的接口

- **只在启动时执行：** 模块放进 `startupScripts`，具名导出**同步**的 `initialize(snapshot, context)`，返回按部位 ID 分组的**字段补丁**（与 `io.write` 的整部位对象不同）。`snapshot`、`context` 都是只读；`context.hasSavedState` 表示有无旧档，`context.sinceCheckpointMs` 是距快照的毫秒数（首次无存档为 `null`，从暂停恢复为 `0`）；`context.resumedFromPause` 标明此次恢复。内置 [reset-parts.js](../startup/reset-parts.js) 展示了如何用 `context.initialParts` 重置模块 `resetOnStart` 列出的字段。如果启动后仍有在途批次，本次跳过初始化，先保留旧快照给重试。
- **发通知与阅读回执：** `io.notify({ mode: 'context', sessionId, text })`（也支持 `'wake'`）暂存通知，只有在线轮次成功才入队；启动补算产生的通知由 Gateway 直接丢弃，不会稍后补发。补算轮 IO 带只读 `io.suppressNotifications = true`：`brainNotify` 在该标记下不调用 `io.notify`，也不抬高水位、不更新 `lastSentAt` / `lastUrgentSentAt` 或退避步数，因此恢复后首个在线轮仍保有发送机会；其他模块若在补算轮产生通知，Gateway 仍兜底丢弃。`GET /notifications` 可查，`POST /notifications/ack` 用 `{ "id": "通知ID", "messageId"?: "消息ID", "insertedAtWallTimeMs"?: 毫秒 }` 确认，并支持 `POST /notifications/receipt`（`{ "messageId" | "notificationId", "insertedAtWallTimeMs"? }`）补写收件箱插入回执。`sessionId` 指定通知目标（`brainNotify` 优先使用 `io.boundSessionId`，仅在无绑定会话时依次回退 `io.actions` 最后一条 `sessionId` → `prev.lastSessionId`）；`index.js` 的 `notifications.js` 仅在身体非休眠且 `notification.sessionId === gateway.getBoundSessionId()` 时把 `context` 用 `agent.inject`、`wake` 用 `agent.followup` 投递到对应会话，投递成功后带 `messageId` ACK，同时 `index.js` 监听宿主 `agent/inbox/inserted`（同步于投递期间或异步到达均可匹配）写入受试/阅读回执；宿主未发射该事件时安全降解为仅保持 `acked`，不阻塞后续投递。
- **滚动日志（`<bodyDir>/logs/`）：** Gateway 与 `logs/action-translations.json` 并列维护两个有界历史文件（默认均保留最近 500 条）：`logs/state-history.jsonl` 仅在状态发生变化或初始/补算提交时追加变更字段，`logs/notification-history.json` 记录 `queued` → `acked` → `inserted` 状态转换；回环 HTTP 提供只读 `GET /logs/state?limit=N` 与 `GET /logs/notifications?limit=N`。跨器官参数直接导入已完成解耦：`blood.ts` 消费 `heart.maxCardiacOutputMlMin`（缺省回退自身 `blood.referenceMaxCardiacOutputMlMin`），`duodenum` 消费本目录 `duodenum.referenceSalivaRateMlPerMin`，`calcium.ts` 消费本目录 `calcium.referencePthPgMl`。
- **读旧脚本。** 旧版字符串路径继续支持调用模块导出的 `functions` 和 `io.call(partId, name, ...args)`。旧的 `step(snapshot, dt, actions)` 可以返回本部位完整状态。同一模块有两个轮次入口时使用 `heartbeat`。
- **接入非标/可扩展器官（如翅膀、尾巴）的规范与即插即用接口：**
  - **动作扩展：** 模块导出 `export const actionTypes = ['fold_wings', ...]` 并在清单中排在 `brain/interoception.ts` 与 `brain/notify.ts` 之前。`GET /capabilities` 自动登记对应动作，`tools.js` 的 `body_act` 会动态读取 `gateway.getCapabilities()` 并把这些扩展动作并入 `type` 枚举、放行对应载荷；未声明的动作名仍返回 `400`，内置结构化动作继续执行严格字段校验。
  - **向 `interoception` 与 `brainNotify` 上报通用体感（免改脑部代码）：**
    - 模块在 `io.write(...)` 中可写可选数字段 `discomfortMm`（`0–100 mm`），`interoception` 会通过轮初 `io.read()?.parts` 自动扫描其他部位（跳过自身）并按 `discomfort.onsetMm = 70` 并入 `interoception.discomfort`。
    - 模块还可写可选 `sensations: { [key]: { intensityMm, discomfort?, urgent?, nsfw?, contextText?, wakeText? } }`（JSON-safe）；`interoception` 自动汇聚到可选字段 `sensations['<partId>.<key>']`（无扩展感受时不写出该键），若 `discomfort: true` 同时参与 `discomfort` 计算。
    - `brainNotify` 在保留原有核心 `levels` 与内置扩展 `sensations` 之外，维护可选 `session.sensationLevels`（无激活扩展感受时省略）按统一 65/85/40 mm 滞回（含 `3 -> 2` 步降）与双轨指数退避门控投递：默认 `2` 档用 `mode: 'context'`（`agent.inject`，添加进上下文不唤醒）、`3` 档或标记 `urgent: true` 用 `mode: 'wake'`（`agent.followup`，系统消息唤醒），标记 `nsfw: true` 时随 `nsfw` 开关门控。
    - **纯感觉、零数值硬规则**：`contextText` / `wakeText` 必须是不含阿拉伯数字和数值单位的定性感受描述；若包含数字或未提供文本，`brainNotify` 与 `tools.js` 会强制回退为无数字的通用定性提示，不把 mm 读数、比例或分数发给大脑。
  - **体型缩放：** 若新器官带有与体重成比例的容量/消耗常数，建议接入 `scaleByBodyWeight(value, paramId)`（见上节 `lib/parameters.js`）。

### DSH 工具、`systemPrompt` 与通知泵

`index.js` 默认以 `requireBinding: true`、`defaultNsfw: Boolean(config.nsfw)` 启动 Gateway（启动时若存档里记录的 `boundSessionId` 在宿主 `agents` 服务中已不存在则自动解绑；运行中监听 `agent/disposed` 在绑定会话销毁时自动解绑回休眠）。Gateway ready 后通过 `ctx.tools.register` 注册 **3** 个工具：

- `body_bind`：`{ action?: 'bind' | 'unbind' | 'status', sessionId?: string }`（默认 `'bind'`），用于绑定、解绑或查看当前身体与会话的绑定/休眠状态（返回 `{ ok, bound, dormant, active, nsfw, boundSessionId, error?, feeling? }`；身体默认不绑定，且已被其他会话占用时拒绝覆盖、窥探或解绑；`bind` 成功且非休眠/非暂停时附带一句零数值 `feeling` 背景感知）。
- `body_state`：面向大模型的**纯定性、零数值**体感感知工具。支持可选 `part` / `focus`（如 `all`、`hunger`、`thirst`、`urinary`、`bowel`、`respiration`、`circulation`、`temperature`、`sleep`、`activity`、`fatigue`、`metabolism`、`stress`、`discomfort`、`reproductive`，或自定义部位 ID；其中 `discomfort` 会汇聚呛咳与强不适来源，`thirst` 起始感知门从 `15 mm` 分档，`sexual` 分 5 档渐进刻画且高潮受阻在 3 min 内补充解释，`sweatDamp` 区分活跃出汗与干燥残余潮意，`activity` 仅在体力负荷 `>= 0.15` 时写“四肢发力”，`health?.fatal` 停机时安全返回 `status: 'paused'`），返回 `{ status, focus, feelings, summary }`（`status` 为 `'active' | 'sleeping' | 'dormant' | 'paused'`，`feelings` 各项只含 `{ area, level, feeling }`，不含任何数字或单位；`nsfw: false` 时屏蔽性/泌乳感受与别名；`dormant`、未分配身体、绑定到其他会话或 `active: false` 时均不读取生理快照，且不诱导主动调用 `body_bind`）。调试与观测所需的精确数值继续保留在 HTTP `GET /state` 与 `gateway.getState()`。
- `body_act`：把 `drink` / `eat` / `urinate` / `defecate` / `exercise` / `stop_exercise` / `sleep` / `wake_up` 动作（以及 `nsfw: true` 时的 `sex` / `orgasm` / `express_milk` / `breastfeed`，或 `capabilities` 里的扩展动作）连同当前 `sessionId` 交给 Gateway。对 `eat` / `drink` / `exercise`（及开启 `nsfw` 时的 `sex` / `express_milk` / `breastfeed`），主 Agent 可直接传自然语言 `description`（仅保留精确数值/布尔字段作可选显式覆盖或程序直通，`sex` 暴露可选 `exertion` 区分感官与体力负荷、`orgasm` 暴露可选 `continueStimulation`）：工具会先检查归属权限、休眠与 `nsfw` 门控，再通过 [action-translator.js](../action-translator.js) 调用 `ctx.llm.stream()`（单工具 `submit_translated_actions`、不传 `sessionId` 无会话副作用、失败重问 1 次；无 `ctx.llm`/超时/多次失败直接报错不编造数字），对 `eat`/`drink` 可在顶层返回零数字定性味觉文本 `tasteFeedback`（严格不写进动作载荷或 `<bodyDir>/logs/action-translations.json`，也不改变器官状态）；未传 `description` 时的无参/可选参 `express_milk`/`breastfeed`/`orgasm` 直接放行。`nsfw: false` 时 `sex` / `orgasm` / `express_milk` / `breastfeed` 不出现在工具 `type.enum`，直接调用由工具层返回 `400`（HTTP 队列侧返回 `403`）；处于 `dormant` 休眠状态时返回 `409`，已被其他会话绑定或未分配身体时返回 `403`。action id 由会话 ID 与工具 `callId` 稳定生成，202 只表示入队；用 `GET /actions/:id` 查动作回执，用 `body_state` 看主观感受或用 `GET /state` 查调试快照。

**可选 `systemPrompt` 整合（`index.js`）：** 若宿主提供 `systemPrompt` 服务（`ctx.get('systemPrompt')`，单元测试无该服务时安全跳过）：
- `systemPrompt.section({ name: 'dsh-body:cognition', order: 120, text })`：注入静态中立的“身体认知与纯感觉交互准则”（明确默认不绑定、不要主动调用 `body_bind`，也不在全局章节泄露 `nsfw` 能力；仅当上下文出现 `[身体背景感受]` 或明确绑定时以主观感受交互，严禁编造具体数值单位）。
- `systemPrompt.context({ name: 'dsh-body:feelings', order: 120, text: (ctxArg) => ... })`：仅当身体激活、非休眠且请求会话 `requestSessionId === boundSessionId` 时，注入一句零数值 `[身体背景感受] ...`；当该绑定身体 `nsfw === true` 时附带 `[亲密与泌乳能力]` 提示；当 `sleep.sleeping === true` 时追加 `[睡眠状态行为规则]` 提醒模型保持安静，避免梦游发言或日常行为。未绑定或会话不匹配时返回空字符串。
- **DSH 睡眠防梦游唤醒钩子（`index.js`）：** 当 `ctx.on` 可用且仅针对当前 `boundSessionId` 处于 `sleep.sleeping === true` 时，监听 `tools/pre-execute`（豁免 `body_state`、`body_bind` 与 `body_act(sleep/wake_up)`，调用其余工具如群聊/发消息或日常身体行为时自动提交 `wake_up` 唤醒身体并放行）以及 `session/event`（检测到非空文本 `assistant/message` 输出时提交 `wake_up` 脱离睡眠）。

`notifications.js` 每 1000 ms 轮询 `gateway.getNotifications()`：

- `context` → `agent.inject`（不唤醒空闲会话，下一次模型调用读取）；`wake` → `agent.followup`（唤醒会话）。
- 消息来源是 `body-notify`，不冒充真人 `user` 源。
- 投递成功后 ACK；ACK 失败时下次只重试 ACK，不重复投递；会话不在线时保留。
- `brain/notify.ts` 每轮读轮初 `interoception`、`bladder` / `colon` / `sleep` / `pineal` / `blood` / `uterus` / `mammaryGlands` / `sexualResponse` 与 `io.boundSessionId`，执行三档通知（普通 / 重要 / 紧急）、睡眠抬高重要门槛（92/95 mm）、紧急压制普通与重要、高潮事件 5 min 边沿通知（`lastOrgasmAtSimMin`）与高潮受阻反馈（`sexualOrgasmBlocked`，常规冷却内仍可投递 `context` 说明）、高潮/挤奶/哺乳退避缓解抑制、睡眠堆积 `sleepBacklog` 醒来集中发与滞回退避。`notify.parameters.json` 全部 19 项提醒参数均标为 `policy`（`source: null`），口渴缺失回退同步调整为 `0 mm`；本次生理校准与体感补丁尚未经过真机 DSH 会话实机复测，不能宣称已实机验收。
- 目前这些新增行为已覆盖于离线单元测试、真实 Gateway 集成测试，以及真实 DSH `0.2.1-rc.2` CLI（`dsh --profile headless` + 本地 SSE mock LLM）对 `dshHomePath` 存档解析、3 个工具注册（含 `body_bind` `oneOf` schema 与自然语言 `body_act` 经 `ctx.llm.stream()` 翻译及同身体历史参考回传）、未绑定 `409`、绑定后无数字 `[身体背景感受]` 上下文注入及 `nsfw` 开关的实机联调；但长时运行的多分钟定时通知投递与真实远程在线模型估算准确率尚未重测，不能替代完整实机验收。

**排查顺序：** `/capabilities` 没有动作名，先用 `/health` 确认身体 `active`（非 `false`），再核对清单里的脚本路径、模块导出的 `actionTypes` 以及是否因 `nsfw: false` 被过滤。启用且已绑定时无处理者的新动作是 `422`，`active: false` 或未绑定休眠时是 `409`，`nsfw: false` 提交 `sex` / `orgasm` 在 HTTP 侧是 `403`；同一 `id` 换了载荷也是 `409`。动作已经 `queued` 但状态没变，先看 `effectiveAt` 和 `/state` 的仿真时刻，再看 `/health` 的心跳错误。如果已经 `applied`，但数值没变，查脚本对类型、字段和单位的判断：`applied` 表示批次提交成功，不保证某个模块实际改了值。
