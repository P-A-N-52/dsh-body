# 身体 Gateway 开发指南：文件、时钟和第一个 TS 脚本

**接一个新部位，只需写一个 TS 模块，再把路径加进脚本清单；不用造一份新的身体 JSON。** Gateway 管时钟、动作队列和存档，脚本只回答一个问题：给定轮初状态和这一轮的动作，我的部位在轮末是什么状态？本文说的是当前实现；器官层设计与 P0 清单见[虚拟身体设计草案](./virtual-body.md)和[器官级身体模型设计](./superpowers/specs/2026-11-20-organ-model-design.md)。

## 1. Gateway 做什么，一轮怎么走？

以“喝了 200 mL 水”为例。调用方把动作交给 Gateway，而不是直接把存档里的数值加 200。中间分三步：

1. **启动时决定跑什么。** DSH 加载插件后，Gateway 读取脚本清单和身体存档，只在这时采样 `active`。启用时，它加载清单里的模块，检查 `id`，登记各模块接受的动作类型，恢复状态。普通停机按 `catchUpMinutes` 限额补算；没有遗留在途批次时，按清单顺序运行启动脚本。暂停时它不加载生理脚本，也不调度心跳，但本机查询仍可用。
2. **收到动作时先排队。** 调用方 `POST /actions`，给出唯一 `id`、`type` 和业务参数，例如 `volumeMl: 200`。Gateway 检查是否有模块声明 `drink`，返回 `202 queued` 和预定生效的仿真时刻 `effectiveAt`。这表示“记下来了”，**不是“已经喝了”**。只要这条动作记录仍在，同一 `id`、同一载荷重试会返回 `200` 和**当前**回执（可能已经是 `applied`），不会再排一次。
3. **到点才结算。** 默认每 60 个现实秒推进 60 个仿真秒。Gateway 锁定本轮动作，由常驻 BodyWorker 依次给各模块注入**同一份轮初快照**。全部成功才提交部位新值、动作状态和通知。模块报错或超时会丢弃本轮暂存结果，下次用保留的批次重试。执行中收到的新动作排在后续轮次。

默认地址是 `http://127.0.0.1:3210`。`GET /health` 看本次实际生效的 `active`、时钟和失败信息；`GET /capabilities` 看 **动作类型 → 模块 ID 列表**；`GET /actions/:id` 查单个动作；`GET /state` 只返回最近提交的 `{ simulatedSeconds, parts }`，不是整份存档。

## 2. 有哪些 JSON，分别由谁管理？

| 文件 | 谁写、何时读 | 用来做什么 |
| --- | --- | --- |
| [`body-modules.json`](../body-modules.json)（`manifestPath`） | 开发者改，Gateway 启动时读 | 声明要加载的脚本、每个脚本读取的状态字段、补算上限和脚本超时。 |
| `body-state.json`（`statePath`） | Gateway 创建、恢复和更新；用户只在停机时改顶层 `active` | **一具身体一份存档**：所有部位的值、时钟、动作和通知都在一起。不要为每个器官或每个脚本再建存档。 |
| [`package.json`](../package.json) | 项目维护者改，由 Node/npm 使用 | 声明 ESM、Node 版本、测试命令和发布文件，不登记心跳脚本，也不存身体数据。[`cordis.patch.yml`](../cordis.patch.yml) 是 DSH 插件装载描述，不是身体 JSON。 |
| `organs/human-organs/**/*.parameters.json` | 模块在 import 时读；标定者改，Gateway 不写 | 器官组件的证据默认值：参数值、单位、证据状态、范围与来源。不是某具身体的最终值，也不做运行中热切换。`systems/nervous/interoception.parameters.json` 是唯一留在 `systems/` 的参数文件，属 legacy。 |

**清单的四个字段。** `scripts` 是心跳脚本数组，支持 `{ "path": "...", "inject": { ... } }` 和旧版字符串路径，仓库默认列出 P0 的四条器官脚本。`startupScripts` 是有序的启动脚本路径数组，仓库默认挂了 [`startup/reset-parts.js`](../startup/reset-parts.js)。两个数组的路径都相对**清单所在目录**。`catchUpMinutes` 单位分钟，默认 `720`。`scriptTimeoutMs` 用于监督 Worker 响应和每个脚本的执行，单位毫秒，默认 `10000`。

清单与存档在启动时解析。状态查询、动作排队和心跳使用主进程内存中的存档对象。BodyWorker 只加载一次模块和它们登记的函数。

**存档里值得认识的字段（不是手写模板）：**

| 字段 | 含义 |
| --- | --- |
| `schemaVersion`、顶层 `active` | 现在写 v2。`active` 必须是布尔值，旧档缺字段默认 `true`；非法值拒绝启动，不改原档。 |
| `snapshot.simulatedSeconds`、`snapshot.parts`、`wallTimeMs` | 最近一次提交的仿真秒数、按模块 `id` 存放的部位值，以及计算下一轮用的现实时间锚点（毫秒）。 |
| `actions`、`pendingActionIds`、`activeBatch`、`lastEffectiveAt` | 按 ID 查的动作记录、排队顺序、已锁定待完成的批次和最近分配的生效时刻。`activeBatch` **不是**启停开关。排队和在途动作不裁剪；启用时，已结束的记录默认最多留最近 2000 条，且不超过 30 天。记录被裁剪后，再用相同 ID 可能被视为新动作。 |
| `notifications`、`startup` | 尚未确认的通知和上次启动记录。`startup.active`、`startup.resumedFromPause` 由 Gateway 写，供恢复与诊断，不要手改。 |

**我该改哪一份？** 换脚本：改 `manifestPath` 指向的清单，重启。暂停身体：停 Gateway → 把实际 `statePath` 存档顶层的 `active` 改成 `false` → 再启动；恢复用 `true`。不要用只有 `active` 的片段覆盖存档。暂停仍能查状态和确认旧通知，新动作返回 `409`；恢复从原仿真时刻继续，**不补算暂停的时间**。如果只在停机时把 `false` 改回 `true`、从未以 `false` 启动，Gateway 并没有记录一次暂停，仍按普通停机处理。运行中改存档不会热切换，反而可能被下次保存覆盖。

DSH 插件的默认存档是 `$DSH_HOME/dsh-body/body-state.json`（通常是 `~/.dsh/dsh-body/body-state.json`），可在插件配置里指定 `statePath`、`manifestPath` 和 `port`。目标存档不存在时，Gateway 会先尝试接续**清单同目录**的 `body-state.json`；仓库根目录那份不一定是 DSH 正在写的那份。下面的示例把清单和存档都放进新目录，避免接续已有身体。

`POST /actions` 的请求体、`GET /state` 的返回值也是 JSON，但不是要维护的文件。现在也没有“会话 → 身体”的映射文件。设计草案里的按会话绑定和单独的体感投递历史不是接一个脚本的前置条件。

## 3. 写 TS 时，参数谁给，结果给谁？

模块用 ESM **具名导出**：`id` 是唯一、稳定的部位键（改名就不再读原部位），`heartbeat(io)` 是每轮入口，可同步或异步，`fields` 声明本部位字段（每个字段写 `unit` 与 `mode`，规则见 [`docs/gateway-operations.md`](./gateway-operations.md)；不能省略，只做 `io.write` 的模块也要 `export const fields = {};`）。常用的两个可选导出是 `initialState`（部位初值，默认 `{}`）和 `actionTypes`（能处理的动作名，默认 `[]`，只靠时钟推进的模块可以不声明动作）。已有部位只补缺少的初值，不会每次启动都重置。

| 谁提供 | 脚本怎么取、怎么交回 |
| --- | --- |
| **脚本作者**给初值、固定常数和单位 | 如 `initialState = { totalMl: 0 }`。模块级常量只保存全人类一致、不随个体或标定变化的常数；可调参数放组件自己的 `*.parameters.json`（见下）。跨轮状态通过 `io.write` 存回本部位。 |
| **调用方**给每次动作的参数 | 如 `{ "id": "cup-1", "type": "drink", "volumeMl": 200 }`。`io.actions` 是本轮**全部原始动作**，不是回执，也不会按 `actionTypes` 给每个模块过滤。脚本自己检查 `type`、字段和单位；TS 类型不会替你校验收到的 JSON。 |
| **Gateway**给状态与时间 | `io.read()` 读轮初 `{ simulatedSeconds, parts }`；`io.read(id)` 读某一部位，找不到返回 `undefined`。`io.dt` 是本轮步长（60 秒），`io.simulatedSeconds` 是**轮末**仿真时刻，`io.wallTimeMs` 是预定轮末的现实时间戳（毫秒）。计算用这些值，不要用 `Date.now()` 猜过了多久。 |
| **脚本**把结果交回 Gateway | `io.write(nextPart)` 暂存**本部位完整的新对象**，不是补丁；只改一项时可用 `{ ...prev, 新字段: 新值 }`。不调用则保留原部位。`heartbeat` 的返回值不作为输出。其他部位只能读，输入快照不能原地改。 |

状态必须是可保存的 JSON：普通对象、数组、字符串、布尔值、有限数字或 `null`；部位最外层必须是对象。不要写 `undefined`、`NaN`、`Infinity`、`BigInt`、`Map` 或循环引用。项目要求 **Node ≥ 22.18**，可直接加载本地 `.ts`，不需要 `ts-node`。使用可擦除的类型语法（`type`、`interface`、类型标注）；相对导入带扩展名，避免 `enum`、参数属性等需要编译转换的语法。如果打包到 `node_modules`，先把 TS 编译成 JS，再让清单指向发布的文件。`package.json` 的 `files` 已包含 `organs/` 与 `lib/`；打包时脚本、同目录参数文件和 `lib/parameters.js` 要一起纳入 `files`。

### 参数文件是只读输入

可调参数不放脚本常量，放组件自己的 `*.parameters.json`；脚本只写通用模型。参数文件跟随器官脚本放在同一目录，例如 `organs/human-organs/stomach/motility.parameters.json`。当前 Gateway 不替模块读参数文件，也不提供热切换；模块在 **import 时**自己读一次，之后整轮心跳都用这份值。只读通道在 [`lib/parameters.js`](../lib/parameters.js)，只有两个函数：

| 函数 | 行为 |
| --- | --- |
| `loadParameters(parametersUrl)` | 读 JSON，返回 `{ [参数 ID]: 值 }`。校验 `schemaVersion === 1`、`owner` 非空、每个参数 `id` 以 `owner.` 开头且不重复、`status: "unset"` 与 `value: null` 一一对应。 |
| `requireParameter(values, id)` | 返回值；若值为 `null` 或缺失，抛出带参数 ID 的错误。脚本需要的参数还没标定时，应当在这里失败，而不是拿 `0` 继续跑。 |

`parametersUrl` 可以是文件 URL（`URL` 对象）或文件系统路径；相对路径按进程工作目录解析，所以模块里用 `new URL('./motility.parameters.json', import.meta.url)` 最稳：

```js
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

const parameters = loadParameters(new URL('./motility.parameters.json', import.meta.url));
const halfTimeMin = requireParameter(parameters, 'stomach.emptying.halfTimeMin');
```

示例的 import 深度 `../../../lib/parameters.js` 按脚本位于 `organs/human-organs/<organ>/` 计算；脚本放在其他层级时，需要按实际目录调整相对深度。

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

胃脚本调用 `io.functions.stomachGhrelinLevel()`，得到当轮开始时的饥饿素相对浓度。只有部位 ID 的路径（如 `["stomachGhrelin"]`）会返回该部位的完整只读状态。字段或部位缺失时返回 `undefined`。多个脚本读到的值都来自同一轮初快照。上面的条目是示意；P0 的 `motility.ts` 实际直接读自己的轮初状态，不声明 `inject`。

## 4. 跑通第一个模块：记录一杯水

这个模块只累计已登记的饮水量，**不模拟吸收或排泄**。下面都从仓库根目录操作，无需安装 DSH，也不用修改仓库自带的清单或真实存档。先在同一终端创建一个空目录，用输出的路径保存下面三个文件：

```sh
DEMO_DIR=$(mktemp -d "$PWD/.body-demo.XXXXXX")
mkdir -p "$DEMO_DIR/organs/human-organs/stomach"
printf '%s\n' "$DEMO_DIR"
```

**① `$DEMO_DIR/organs/human-organs/stomach/water-intake.ts`** — 正式开发时，你需要写的就是这样的部位模块。这里的 `IO` 只描述示例用到的接口，不是需要安装的 SDK。

```ts
export const id = 'waterIntake';
export const actionTypes = ['drink'];
export const initialState = { totalMl: 0 };

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
import { startGateway } from '../gateway.js';

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

运行 `node "$DEMO_DIR/check.mjs"`。**在新目录第一次运行**，应依次看到：`drink` 对应 `['waterIntake']` → `202 queued` → `simulatedSeconds: 60` 且 `parts.waterIntake.totalMl: 200` → `applied`。再用同一目录运行，`cup-1` 是重试，累计值仍为 200，而不是 400。要在 DSH 中使用，按[加载插件](./virtual-body.md#加载插件)接入，把 TS 路径追加到实际清单的 `scripts`，保留其他条目，再重启 Gateway。`check.mjs` 不需要部署，自测目录可以删除。

### 接下来可能用到的接口

- **只在启动时执行：** 模块放进 `startupScripts`，具名导出**同步**的 `initialize(snapshot, context)`，返回按部位 ID 分组的**字段补丁**（与 `io.write` 的整部位对象不同）。`snapshot`、`context` 都是只读；`context.hasSavedState` 表示有无旧档，`context.sinceCheckpointMs` 是距快照的毫秒数（首次无存档为 `null`，从暂停恢复为 `0`）；`context.resumedFromPause` 标明此次恢复。内置 [reset-parts.js](../startup/reset-parts.js) 展示了如何用 `context.initialParts` 重置模块 `resetOnStart` 列出的字段。如果启动后仍有在途批次，本次跳过初始化，先保留旧快照给重试。
- **发通知：** `io.notify({ mode: 'context', sessionId, text })`（也支持 `'wake'`）暂存通知，只有在线轮次成功才入队；启动补算产生的通知直接丢弃，不会稍后补发。`GET /notifications` 可查，`POST /notifications/ack` 用 `{ "id": "通知ID" }` 确认。当前实现到待确认队列为止，`sessionId` 指定的是通知的目标，不会自动投递到 DSH，也不是会话与身体的绑定。
- **读旧脚本。** 旧版字符串路径继续支持调用模块导出的 `functions` 和 `io.call(partId, name, ...args)`。旧的 `step(snapshot, dt, actions)` 可以返回本部位完整状态。同一模块有两个轮次入口时使用 `heartbeat`。

**排查顺序：** `/capabilities` 没有动作名，先用 `/health` 确认身体已启用，再核对清单里的脚本路径和模块导出的 `actionTypes`。启用时无处理者的新动作是 `422`，暂停时是 `409`；同一 `id` 换了载荷也是 `409`。动作已经 `queued` 但状态没变，先看 `effectiveAt` 和 `/state` 的仿真时刻，再看 `/health` 的心跳错误。如果已经 `applied`，但数值没变，查脚本对类型、字段和单位的判断：`applied` 表示批次提交成功，不保证某个模块实际改了值。
