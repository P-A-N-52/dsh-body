# 身体 Gateway 开发指南：文件、时钟和第一个 TS 脚本

**接一个新部位，只需写一个 TS 模块，再把路径加进脚本清单；不用造一份新的身体 JSON。** Gateway 管时钟、动作队列和存档，脚本只回答一个问题：给定轮初状态和这一轮的动作，我的部位在轮末是什么状态？本文说的是当前实现；器官层设计与 P0/P1 清单见[虚拟身体设计草案](./virtual-body.md)和[器官级身体模型设计](./superpowers/specs/2026-11-20-organ-model-design.md)，M3 水链见[水链设计](./superpowers/specs/2026-11-22-water-balance-design.md)。

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
| `organs/human-organs/**/*.parameters.json`、`organs/human-compartments/**/*.parameters.json` | 模块在 import 时读；标定者改，Gateway 不写 | 器官/隔室组件的证据默认值：参数值、单位、证据状态、范围与来源。不是某具身体的最终值，也不做运行中热切换。当前共 15 份参数文件：原六份都在 `organs/human-organs/`，M3 水链新增六份（其中体液隔室在 `organs/human-compartments/body-water/`），DI 样变体另有 3 份独立 `design` 参数文件（`hypothalamus-adh-di-central`、`urine-production-di-central`、`urine-production-di-nephrogenic`），只随变体清单加载。`systems/` 已不再有参数文件。 |

**清单的四个字段。** `scripts` 是心跳脚本数组，支持 `{ "path": "...", "inject": { ... } }` 和旧版字符串路径。仓库默认列出 12 条部位脚本：P0/P1 的六个部位（胃入口用 `hydration.ts`，不再加载旧 `motility.ts`；另有 `ghrelin.ts`、`gastric-sensory.ts`、`nutrient-exposure.ts`、`interoception.ts`、`notify.ts`），加上小肠、体液、两个下丘脑、肾和膀胱。另有三份可选的 DI 样变体入口：`brain/hypothalamus-adh-di-central.ts`、`kidney/urine-production-di-central.ts`、`kidney/urine-production-di-nephrogenic.ts`。它们与正常入口导出相同 `id` / `fields`，不在根清单；选择方式是复制清单、把对应路径替换为变体，并使用独立 `statePath`，同一清单不能同时加载正常入口与同 id 变体。`startupScripts` 是有序的启动脚本路径数组，仓库默认挂了 [`startup/reset-parts.js`](../startup/reset-parts.js)。两个数组的路径都相对**清单所在目录**。`catchUpMinutes` 单位分钟，默认 `720`。`scriptTimeoutMs` 用于监督 Worker 响应和每个脚本的执行，单位毫秒，默认 `10000`。

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
| **调用方**给每次动作的参数 | 如 `{ "id": "cup-1", "type": "drink", "volumeMl": 200 }` 或含能饮料 `{ "id": "cola-1", "type": "drink", "volumeMl": 330, "energyKcal": 140 }`。`io.actions` 是本轮**全部原始动作**，不是回执，也不会按 `actionTypes` 给每个模块过滤。脚本自己检查 `type`、字段和单位；TS 类型不会替你校验收到的 JSON。 |
| **Gateway**给状态与时间 | `io.read()` 读轮初 `{ simulatedSeconds, parts }`；`io.read(id)` 读某一部位，找不到返回 `undefined`。`io.dt` 是本轮步长（60 秒），`io.simulatedSeconds` 是**轮末**仿真时刻，`io.wallTimeMs` 是预定轮末的现实时间戳（毫秒）。计算用这些值，不要用 `Date.now()` 猜过了多久。 |
| **脚本**把结果交回 Gateway | `io.write(nextPart)` 暂存**本部位完整的新对象**，不是补丁；只改一项时可用 `{ ...prev, 新字段: 新值 }`。不调用则保留原部位。`heartbeat` 的返回值不作为输出。其他部位只能读，输入快照不能原地改。 |

**脚本头部要写来源。** 每个生理脚本在第一个 `import` 前用块注释列出：依赖的 `source_id` / citekey、证据笔记路径、原文定位（摘要 Results、Table、Methods 等）、支撑的方程或参数，以及不能推出的边界。参数文件里的 `source` 只回答“这个值来自哪条登记”；脚本注释要回答“哪条方程或假设来自哪里、哪些只是 `design`”。没有直接来源的代理量要明确写“无直接证据”，不能只挂一个论文标题或 DOI。

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

示例的 import 深度 `../../../lib/parameters.js` 按脚本位于 `organs/human-organs/<organ>/` 计算；体液隔室 `organs/human-compartments/body-water/` 也在同样的第三层，深度相同。脚本放在其他层级时，需要按实际目录调整相对深度。

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

### 水链的 transfer 配对（当前模块）

M3 水链用三个 `io.transfer` 配对搬水，两端都声明 `mL` / `absolute`：

```text
stomach.waterVolumeMl        → smallIntestine.waterVolumeMl
smallIntestine.waterVolumeMl → bodyFluid.waterVolumeMl
bodyFluid.waterVolumeMl      → bladder.volumeMl
```

- 只有源字段的所有者发起 transfer：`stomach/hydration.ts`、`small-intestine/water-absorption.ts`、`human-compartments/body-water/water.ts`。
- 源部位先 `io.write` 本轮转出前基准，Gateway 再按 write → add → transfer 结算。胃写 `W + D`（`D` 为本轮入胃水），小肠写轮初肠水，体液写轮初体液水；同轮新流入不能支付本轮下游需求。
- `urinate` 不触发 transfer：水进入膀胱时已经离开体液，排尿再扣一次会双扣。
- 非自主排空也不触发 transfer：轮初膀胱体积**严格大于** 600 mL 且本轮无 `urinate` 时，膀胱把轮初体积排到 `postVoidResidualMl`，记入 `involuntaryVoidedMl`；主动 `urinate` 优先，同轮只结算一次。`voidedMl = voluntaryVoidedMl + involuntaryVoidedMl`，水账只累计 `voidedMl` 一次，两个分项不能再加一遍。600 mL 是 `design` 工程阈值，不模拟逼尿肌/括约肌、持续漏尿或临床失禁。
- 加载约束：`hydration.ts` 必须与 `smallIntestine`、`bodyFluid`、`bladder` 同时加载，否则 `transferOut` / `transferIn` 配对校验拒绝启动；旧 `motility.ts` 不声明 transfer，可单独加载且不需要下游部位。两个 `stomach` 入口不能同时加载。
- 旧 `motility.ts` 以 `trackWater: false` 运行，推进既有 `mealQueue` 时会剥离切片的 `remainingWaterMl` / `rateWaterMl`；不要用“水链清单 → 旧清单 → 水链清单”保存待释放水，切回时按 0 计。正常旧档升级到水链只补 0，不受影响。
- 这些脚本已加入根清单（12 个部位），Task 10 真实 DSH 会话验收已完成（30 轮 A/B 与排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）；参数与证据边界见各器官 README。Task 10 早于非自主排尿、`discomfort` 与 DI 变体合并，只覆盖主动排尿路径。非自主排尿与不适的定向测试在 `test/organs.bladder.test.mjs`、`test/organs.interoception.test.mjs` 与 `test/organs.water-gateway.test.mjs`；DI 变体在 `test/organs.di.test.mjs`。M19 已补做这些新增行为的真实 DSH 会话验收（33/33 核对通过，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；它只覆盖短会话，不重写 Task 10 历史，也不代表当前 HEAD 性能已重测。

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
- **发通知：** `io.notify({ mode: 'context', sessionId, text })`（也支持 `'wake'`）暂存通知，只有在线轮次成功才入队；启动补算产生的通知直接丢弃，不会稍后补发。`GET /notifications` 可查，`POST /notifications/ack` 用 `{ "id": "通知ID" }` 确认。`sessionId` 指定通知目标；`index.js` 的 `notifications.js` 会把 `context` 用 `agent.inject`、`wake` 用 `agent.followup` 投递到对应会话，投递成功后 ACK。会话不在线时通知保留；通知历史文件和模型已读确认尚未实现。
- **读旧脚本。** 旧版字符串路径继续支持调用模块导出的 `functions` 和 `io.call(partId, name, ...args)`。旧的 `step(snapshot, dt, actions)` 可以返回本部位完整状态。同一模块有两个轮次入口时使用 `heartbeat`。

### DSH 工具与通知泵

`index.js` 在 Gateway ready 后通过 `ctx.tools.register` 注册两个工具：

- `body_act`：把 `drink` / `eat` / `urinate` 动作连同当前 `sessionId` 交给 Gateway；`urinate` 不需要体积、能量、餐型或时长。action id 由会话 ID 与工具 `callId` 稳定生成。202 只表示入队；用 `GET /actions/:id` 查动作回执，用 `body_state` 或 `GET /state` 看已提交的快照。根清单已加载 `bladder`，启用后 `urinate` 有处理者；Task 10 真实 DSH 会话已核对 queued → applied、同 callId 重试返回原 applied ID、同 callId 异载荷 409，以及当轮新尿留下。非自主排空不产生动作、回执或工具调用，只改变膀胱状态字段；不要用 `body_act` 触发它。
- `body_state`：读最近提交的 `simulatedSeconds` 和 `parts`，可用 `part` 过滤，例如 `stomach`、`interoception`、`bladder`；根清单已接入水链，`interoception` 会返回 `thirst` / `urinaryUrgency` / `discomfort`，`bladder` 会返回 `volumeMl` / `voidedMl` / `voluntaryVoidedMl` / `involuntaryVoidedMl`。这些读数仍是代理：`discomfort` 不是疼痛评分或疾病严重度，膀胱体积与排出量不是临床容量、残余尿诊断或失禁结论。
- **DI 样变体不改变工具形状。** `body_act` / `body_state` 的名称、参数枚举与输出 schema 与根清单一致（`test/organs.di.test.mjs` 的形状用例覆盖）；工具不会按会话或清单切换身体。DI 身体必须使用自己的清单与独立 `statePath`，默认根清单不加载变体。

`notifications.js` 每 1000 ms 轮询 `gateway.getNotifications()`：

- `context` → `agent.inject`（不唤醒空闲会话，下一次模型调用读取）；`wake` → `agent.followup`（唤醒会话）。
- 消息来源是 `body-notify`，不冒充真人 `user` 源。
- 投递成功后 ACK；ACK 失败时下次只重试 ACK，不重复投递；会话不在线时保留。
- `brain/notify.ts` 决定何时通知：明显/强档位、同档不重复、45 min 冷却、每会话每小时 2 次/每天 6 次；阈值与次数是 `policy`，不是人体测量。

**排查顺序：** `/capabilities` 没有动作名，先用 `/health` 确认身体已启用，再核对清单里的脚本路径和模块导出的 `actionTypes`。启用时无处理者的新动作是 `422`，暂停时是 `409`；同一 `id` 换了载荷也是 `409`。动作已经 `queued` 但状态没变，先看 `effectiveAt` 和 `/state` 的仿真时刻，再看 `/health` 的心跳错误。如果已经 `applied`，但数值没变，查脚本对类型、字段和单位的判断：`applied` 表示批次提交成功，不保证某个模块实际改了值。
