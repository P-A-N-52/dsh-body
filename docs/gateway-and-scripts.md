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
| [`body-modules.json`](../body-modules.json)（`manifestPath`） | 开发者改，Gateway 启动时读 | 根清单：声明要加载的脚本、每个脚本读取的状态字段、补算上限和脚本超时。 |
| [`body-modules.female.json`](../body-modules.female.json) | 开发者改，作为另一份 `manifestPath` 在启动时读 | 女性独立清单：根清单 38 脚本 + `ovaries` + `uterus` + `mammary-glands/milk.ts`，`body-water/water.ts` 换成 `water.female.ts`，`glucose.ts` 换成 `glucose.female.ts`，共 41 部位、37 份唯一参数文件（硬 transfer 闭包 17 部位）；必须配独立 `statePath`。 |
| `body-state.json`（`statePath`） | Gateway 创建、恢复和更新；用户只在停机时改顶层 `active`、`profile` 或 `parameters` | **一具身体一份存档**：所有部位的值、时钟、动作、通知，以及可选个体 `profile` 与稀疏参数差异 `parameters` 都在一起。根清单与女性/男性清单各用一份存档，不要为每个器官或每个脚本再建存档，也不要在同一份存档上切换清单。 |
| [`package.json`](../package.json) | 项目维护者改，由 Node/npm 使用 | 声明 ESM、Node 版本、测试命令和发布文件，不登记心跳脚本，也不存身体数据。`files` 收录根清单、女性清单与男性清单；[`cordis.patch.yml`](../cordis.patch.yml) 是 DSH 插件装载描述，不是身体 JSON。 |
| `organs/human-organs/**/*.parameters.json`、`organs/human-compartments/**/*.parameters.json` | 模块在 import 时读；标定者改，Gateway 不写 | 器官/隔室组件的证据默认值：参数值、单位、证据状态、范围与来源。不是某具身体的最终值，也不做运行中热切换。当前仓库共有 44 份参数文件：根清单（38 部位）加载 34 份唯一参数文件（`skeletal-muscle/activity.ts` 无参数文件，三个区域部位共享 `skeletal-muscle/glucose-uptake.parameters.json`，`stomach/ghrelin.ts` 经 `motility-core.ts` 复用 `stomach/motility.parameters.json`，同一文件只计一次）；女性清单（41 部位）加载 37 份唯一参数文件（多出 `ovaries/menstrual-cycle.parameters.json`、`uterus/uterus.parameters.json` 与 `mammary-glands/milk.parameters.json`）；男性清单（40 部位）加载 36 份唯一参数文件（多出 `testes/testosterone.parameters.json` 与 `epididymis/storage.parameters.json`）。其余 5 份不随任何清单加载：3 份是 DI 样变体的独立参数文件（`hypothalamus-adh-di-central`、`urine-production-di-central`、`urine-production-di-nephrogenic`），2 份是尚未挂入任何清单的甲状旁腺/血钙参数文件（`parathyroid/parathyroid.parameters.json`、`calcium/calcium.parameters.json`）。按去重并集计：根 34 + 女性独有 3 + 男性独有 2 + 其余 5 = 44 份。`systems/` 已不再有参数文件。 |

**清单的四个字段。** `scripts` 是心跳脚本数组，支持 `{ "path": "...", "inject": { ... } }` 和旧版字符串路径。仓库默认列出 38 条部位脚本：P0/P1 的六个部位（胃入口用 `hydration.ts`，不再加载旧 `motility.ts`；另有 `ghrelin.ts`、`gastric-sensory.ts`、`nutrient-exposure.ts`、`interoception.ts`、`notify.ts`），加上食管、小肠、结肠、体液、葡萄糖隔室、胰腺内分泌、肾糖、骨骼肌活动、骨骼肌摄糖聚合器、三个区域部位（`muscleHead` / `muscleTrunk` / `muscleLimbs`）、肺、肺通气、皮肤、两个下丘脑、下丘脑内分泌、垂体、甲状腺、肾上腺、松果体、肾、膀胱、性反应周期、血氧隔室、肝糖原、唾液腺、心脏、血液、体温调节与肾糖异生。另有三份可选的 DI 样变体入口（`brain/hypothalamus-adh-di-central.ts`、`kidney/urine-production-di-central.ts`、`kidney/urine-production-di-nephrogenic.ts`）和一份缺区域聚合器变体 `skeletal-muscle/glucose-uptake.no-limbs.ts`；它们与正常入口导出相同 `id` / `fields`，不在根清单。选择方式是复制清单、把对应路径替换为变体，使用独立 `statePath`，同一清单不能同时加载正常入口与同 id 变体。缺四肢清单还必须同时去掉 `skeletal-muscle/regions/limbs.ts` 并换用 `glucose-uptake.no-limbs.ts`，只删区域脚本会让正常聚合器的 `transferOut` 目标未声明。`parathyroid/parathyroid.ts` 与 `calcium/calcium.ts` 亦已存在且可单测，但尚未挂入任何 `body-modules*.json`。`startupScripts` 是有序的启动脚本路径数组，仓库默认挂了 [`startup/reset-parts.js`](../startup/reset-parts.js)。两个数组的路径都相对**清单所在目录**。`catchUpMinutes` 单位分钟，默认 `720`。`scriptTimeoutMs` 用于监督 Worker 响应和每个脚本的执行，单位毫秒，默认 `10000`。

**女性与男性清单。** [`body-modules.female.json`](../body-modules.female.json) 是另一份完整清单，不是根清单的运行时开关：根清单 38 脚本 + `organs/human-organs/ovaries/menstrual-cycle.ts` + `organs/human-organs/uterus/uterus.ts` + `organs/human-organs/mammary-glands/milk.ts`，把 `organs/human-compartments/body-water/water.ts` 换成 `water.female.ts`，并把 `organs/human-compartments/glucose/glucose.ts` 换成 `glucose.female.ts`，共 41 部位、37 份唯一参数文件（硬 transfer 闭包 17 部位）。使用时把 `manifestPath` 指向该文件，并给一个新 `statePath`；根清单 `body-modules.json` 为 38 部位、34 份唯一参数文件（硬闭包 15 部位），根身体不含卵巢/子宫/乳腺，`water.ts` 仍是三出口，`glucose.ts` 仍是三汇。男性清单 [`body-modules.male.json`](../body-modules.male.json) 在根清单上只增加 `testes` 与 `epididymis`，共 40 部位、36 份唯一参数文件（硬闭包 15 部位）。不要在同一份存档上切换这些清单：`initialState` 只补缺失部位，不会删掉另一份清单多出来的部位，也没有热切换或按会话选身体。`package.json` 的 `files` 必须同时收录三份清单，否则 npm 包会缺清单。

生殖链的读写边界：`ovaries` 只读自己的轮初状态与 `io.dt`，写周期日、相位和 E2/P4 相对量；`uterus` 下一轮读轮初卵巢值与自身内膜，写内膜、痉挛代理与月经请求；`water.female.ts` 再下一轮把水转入 `uterus.bleedingMl`；`interoception.discomfort` 第五路软读 `uterus.crampMm`，`brainNotify` 仍只读四类体感、不读不适。Bull 2019 只支撑周期 29.3 天、卵泡期 16.9 天、黄体期 12.4 天与自报出血天数 4.0 天；其队列为 Natural Cycles 用户、厂商资助、仅排卵周期。`uterus.mensesDays = 4.0` 为 `prior` / `SRC-BULL-2019`，1 天排卵带与激素曲线是 `design`，经量 50 mL/周期、85 mm 痛经等也全是 `design`。女性清单尚未做真实 DSH 会话、独立生殖数据或 41 部位性能验证，不能把 Bull 队列均值当成本身体的验证结果。详见 [`ovaries`](../organs/human-organs/ovaries/README.md)、[`uterus`](../organs/human-organs/uterus/README.md) 与 [`body-water`](../organs/human-compartments/body-water/README.md)。

乳腺链的读写边界：`mammaryGlands` 默认非泌乳（`lactating: false`，0 泌乳请求与 0 乳糖流失，催乳素维持 1.0）；显式开启 `lactating: true` 时，`pituitary.prolactinRelative` 下一轮驱动 `mammaryGlands.milkRequestMl` / `lactoseRequestG` / `fullnessMm`（胀奶带 30 min 半时回落，不再棘轮锁死）；`water.female.ts` 再下一轮把水转入 `mammaryGlands.milkMl`，`glucose.female.ts` 同轮把乳糖当量转入 `mammaryGlands.lactoseG`；`interoception.discomfort` 第六路软读 `fullnessMm`。乳腺和女性葡萄糖变体只在女性清单，根清单的 `glucose.ts` 不声明 `mammaryGlands.lactoseG`，`water.ts` 不声明 `mammaryGlands.milkMl`。详见 [`mammary-glands`](../organs/human-organs/mammary-glands/README.md) 与 [`glucose`](../organs/human-compartments/glucose/README.md)。

清单与存档在启动时解析。状态查询、动作排队和心跳使用主进程内存中的存档对象。BodyWorker 只加载一次模块和它们登记的函数。

**存档里值得认识的字段（不是手写模板）：**

| 字段 | 含义 |
| --- | --- |
| `schemaVersion`、顶层 `active` | 现在写 v2。`active` 必须是布尔值，旧档缺字段默认 `true`；非法值拒绝启动，不改原档。 |
| 顶层 `profile`、顶层 `parameters`（均可选） | 每具身体的**个体差异表**（停机修改、重启生效，运行中不做热切换）。`profile` 为 `{ weightKg?: number, heightCm?: number }`，缺省按 `75 kg / 170 cm`（`massScale = weightKg / 75`）；`parameters` 为稀疏字典 `{ [parameterId]: number }`，只写与 `*.parameters.json` 默认值不同的参数，未知或当前清单未加载器官的参数键容错保留。Gateway 启动先 `store.load()`，再在 `BodyWorker` 导入任何器官前把 `{ profile, parameters }` 注入 [`lib/parameters.js`](../lib/parameters.js)。 |
| `snapshot.simulatedSeconds`、`snapshot.parts`、`wallTimeMs` | 最近一次提交的仿真秒数、按模块 `id` 存放的部位值，以及计算下一轮用的现实时间锚点（毫秒）。 |
| `actions`、`pendingActionIds`、`activeBatch`、`lastEffectiveAt` | 按 ID 查的动作记录、排队顺序、已锁定待完成的批次和最近分配的生效时刻。`activeBatch` **不是**启停开关。补算轮失败后保留的批次还会带 `suppressNotifications: true`，在线重试继续按补算语义抑制通知；旧档没有这个键时按 `false`。排队和在途动作不裁剪；启用时，已结束的记录默认最多留最近 2000 条，且不超过 30 天。记录被裁剪后，再用相同 ID 可能被视为新动作。 |
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
| **Gateway**给状态与时间 | `io.read()` 读轮初 `{ simulatedSeconds, parts }`；`io.read(id)` 读某一部位，找不到返回 `undefined`。`io.dt` 是本轮步长（60 秒），`io.simulatedSeconds` 是**轮末**仿真时刻，`io.wallTimeMs` 是预定轮末的现实时间戳（毫秒）。`io.suppressNotifications` 是只读布尔：启动补算轮为 `true`、在线轮为 `false`，只表示本轮只回放不投递，不是生理输入。计算用这些值，不要用 `Date.now()` 猜过了多久。 |
| **脚本**把结果交回 Gateway | `io.write(nextPart)` 暂存**本部位完整的新对象**，不是补丁；只改一项时可用 `{ ...prev, 新字段: 新值 }`。不调用则保留原部位。`heartbeat` 的返回值不作为输出。其他部位只能读，输入快照不能原地改。 |

**脚本头部要写来源。** 每个生理脚本在第一个 `import` 前用块注释列出：依赖的 `source_id` / citekey、证据笔记路径、原文定位（摘要 Results、Table、Methods 等）、支撑的方程或参数，以及不能推出的边界。参数文件里的 `source` 只回答“这个值来自哪条登记”；脚本注释要回答“哪条方程或假设来自哪里、哪些只是 `design`”。没有直接来源的代理量要明确写“无直接证据”，不能只挂一个论文标题或 DOI。

状态必须是可保存的 JSON：普通对象、数组、字符串、布尔值、有限数字或 `null`；部位最外层必须是对象。不要写 `undefined`、`NaN`、`Infinity`、`BigInt`、`Map` 或循环引用。项目要求 **Node ≥ 22.18**，可直接加载本地 `.ts`，不需要 `ts-node`。使用可擦除的类型语法（`type`、`interface`、类型标注）；相对导入带扩展名，避免 `enum`、参数属性等需要编译转换的语法。如果打包到 `node_modules`，先把 TS 编译成 JS，再让清单指向发布的文件。`package.json` 的 `files` 已包含 `organs/` 与 `lib/`；打包时脚本、同目录参数文件和 `lib/parameters.js` 要一起纳入 `files`。

### 参数文件是只读输入

可调参数不放脚本常量，放组件自己的 `*.parameters.json`；脚本只写通用模型。参数文件跟随器官脚本放在同一目录，例如 `organs/human-organs/stomach/motility.parameters.json`。当前 Gateway 不替模块读参数文件，也不提供热切换；模块在 **import 时**自己读一次，之后整轮心跳都用这份值。只读通道在 [`lib/parameters.js`](../lib/parameters.js)，只有两个函数：

| 函数 | 行为 |
| --- | --- |
| `loadParameters(parametersUrl)` | 读 JSON，返回 `{ [参数 ID]: 值 }`。校验 `schemaVersion === 1`、`owner` 非空、每个参数 `id` 以 `owner.` 开头且不重复、`status: "unset"` 与 `value: null` 一一对应；若当前 Worker 所属身体存档顶层 `parameters` 存在同名 key，返回稀疏覆盖后的值。 |
| `requireParameter(values, id)` | 返回值；若值为 `null` 或缺失，抛出带参数 ID 的错误。脚本需要的参数还没标定时，应当在这里失败，而不是拿 `0` 继续跑。 |
| `getBodyProfile()` / `hasParameterOverride(id)` / `getNumericParameterOverride(id)` / `scaleByBodyWeight(value, parameterId)` | 返回当前身体 `{ weightKg, heightCm }`、查询是否显式覆盖，并按 `weightKg / 75` 自动缩放体格相关参数（`75 kg` 原值逐位不变；`parameters` 显式覆盖优先于自动缩放）。核心隔室、血液、心脏、血氧、肺通气、体温调节、肝糖原、肾糖异生、肌糖原、下丘脑 ADH 与产尿基线已同步接入，保证不同体重下静息 `37.0 °C` 与空腹 `90.0 mg/dL` 平衡不被拆散。 |

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
- 这些水链脚本已加入根清单；水链完成时为 12 个部位，血氧池与肺通气切片加入后为 22 个（两者都不新增 transfer，闭包仍为 9 个），肝糖原切片加入后为 23 个，内分泌轴与松果体接入后为 28 个，唾液腺切片接入后为 29 个；分区骨骼肌、循环、体温、肾糖异生与食管/结肠切片接入后当前为根 38 个、硬闭包 15 个（女性 41 个、硬闭包 17 个，男性 40 个、硬闭包 15 个）。Task 10 真实 DSH 会话验收已完成（30 轮 A/B 与排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）；参数与证据边界见各器官 README。Task 10 早于非自主排尿、`discomfort`、DI 变体与分区肌肉合并，只覆盖主动排尿路径。非自主排尿与不适的定向测试在 `test/organs.bladder.test.mjs`、`test/organs.interoception.test.mjs` 与 `test/organs.water-gateway.test.mjs`；DI 变体在 `test/organs.di.test.mjs`；生殖链的 Gateway 测试在 `test/organs.reproductive-gateway.test.mjs`；分区肌肉的 Gateway 测试在 `test/organs.muscle-regions-gateway.test.mjs`；P0 三清单 24 小时空腹体温/血糖代理回归测试在 `test/organs.steady-state-24h.test.mjs`。尚未做真实 DSH 会话或独立数据验证。M19 已补做这些新增行为的真实 DSH 会话验收（33/33 核对通过，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；它只覆盖短会话，不重写 Task 10 历史，也不代表当前 HEAD 性能已重测。

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
- `pancreasEndocrine.insulinRelative` 与 `glucagonRelative` 都是无量纲相对信号，基础值 1。`glucose` 不再读取 `insulinRelative`：它只算基础利用与自身超基线残余清除 `D`，并写出 `excessMassG = max(0, M_start − B)`。各部位用自己的参数计算请求：肌肉 `request = 0.5 × E/(E + 20) × max(0, 1 + 1.0 × (I − 1)) × dtMin + exerciseUptakeG`（活动时另加 `0.15 × intensity × dtMin × clamp(G / 90, 0, 1.5)`）；肝 `request = min(0.2 × E/(E + 15) × max(0, 1 + 0.5 × (I − 1)) × dtMin, max(0, glycogenCapacityG − (glycogenG + storageG)))`。所有摄取参数都在各自参数文件，全部 `design`、`source: null`；`glucose.muscleDisposalShare`、`glucose.liverDisposalShare` 已废止，`glucose.apparentDisposalHalfTimeMin` 已更名 `residualDisposalHalfTimeMin`（值仍 60）。总清除量由各部位响应与基础/残余清除涌现，不再承诺与旧的中央分配模型逐位一致；肝满时肝自己把 `storageRequestG` 钳到 0。
- 默认第 4 轮浓度与 `excessMassG` 首次上升，第 5 轮胰腺写出升高的 `insulinRelative`、肌肉与肝写出首批请求；第 6 轮 `glucose` 结算首批请求（此时用的是 `I = 1` 的请求），第 7 轮升高信号计算出的请求到账。`glucagonRelative` 方向相反：血糖低于 90 时目标 `1 + 0.02 × (90 − G)`（钳位上限 5、下限 0；当前增益下 `G = 0` 只到 2.8），按 10 min 半时趋近；消费者是 `liver` 与 `kidneyGluconeogenesis`，不参与摄糖请求，也不缩放 `glucose` 基础/残余清除。无胰腺时两部位按 `I = 1` 写请求、`liver` 与 `kidneyGluconeogenesis` 按 `H = 1` 基线计算产糖。
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
- 旧档胃/小肠碳水按 0，新 `glucose` 补 `12.69 g / 90 mg/dL / 0 g`，`excessMassG` 首轮由轮初质量现算，胰腺补两个相对信号 1、肾糖请求/实际通量补 0，`muscleGlucose` 补 `uptakeRequestG = 0`、`uptakeG = 0`，三个区域补 `uptakeG = 0`、`glycogenG = 15 / 135 / 150`、`glycogenConsumedG = 0`；旧档只有 `muscleGlucose.glycogenG` 时，各区域第一轮按存在区域份额迁移：默认种子状态用迁移份额取代 300 g 份额初值，已有真实存档状态则并入存量；聚合器第一次 write 后旧总量不再保留，后续不会重复迁移。`liver` 补 `storageRequestG = 0`、`glycogenG = 80`、`storageG = 0`、`glycogenCapacityG = 100`、`outputG = 0`，不反推历史；重启保留已提交的请求与在途 `uptakeG` / `storageG`，各部位下一轮只处理一次，容量每轮由 `liver` 按参数重写为 100。
- 肝糖原（含 100 g 容量）、肾糖异生、胰高血糖素与各部位自主摄糖请求已由当前清单接入；胰岛素/胰高血糖素绝对浓度、肝糖异生、脂肪组织分区、肌糖原容量与静息周转仍未实现。M2 薄切片已含骨骼肌摄糖、分区肌糖原与肾糖异生。公式、质量账和证据边界见[碳水—血糖薄切片设计](./superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)、[胰腺设计](./superpowers/specs/2026-11-22-pancreas-insulin-design.md)、[肾糖设计](./superpowers/specs/2026-11-23-renal-glucose-design.md)、[骨骼肌摄糖设计](./superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md)、[肝糖原设计](./superpowers/specs/2026-11-23-liver-glycogen-design.md)、[各部位自主摄糖设计](./superpowers/specs/2026-11-24-tissue-uptake-design.md)与[肾糖异生设计](./superpowers/specs/2026-11-24-renal-gluconeogenesis-design.md)。

### 血糖双向自调节：自主摄糖、肝糖原、肾糖异生与胰高血糖素（当前模块）

血糖自调节现在由两条自主链组成：高血糖侧各摄糖部位按自己的参数写请求、`glucose` 按“肾 → 肝 → 肌”结算；空腹与低血糖侧由 `liver` 与 `kidneyGluconeogenesis` 按平滑比例 + 餐后抑制同时向 `glucose.glucoseMassG` 产糖，平衡 `glucose.basalConsumptionGPerMin = 0.12 g/min` 的基础耗糖。各部位只读轮初快照，不做同轮迭代；总清除轨迹是各部位响应的涌现结果。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `pancreasEndocrine` / `pancreas/insulin.ts` | `insulinRelative`、`glucagonRelative` | 轮初 `glucose.concentrationMgDl`、自身两个信号、`io.dt` | `muscleGlucose` 与 `liver` 读胰岛素信号；`liver` 与 `kidneyGluconeogenesis` 读胰高血糖素信号 |
| `liver` / `liver/glycogen.ts` | `storageRequestG`、`glycogenG`、`storageG`、`glycogenCapacityG`、`outputG` | 自身轮初状态；轮初 `glucose.excessMassG`、`pancreasEndocrine.insulinRelative`、`glucose.concentrationMgDl`（未加载按 90）、`pancreasEndocrine.glucagonRelative`（未加载按 1）、`adrenal.cortisolRelative`（未加载按 1）；`io.dt` | `glucose` 读 `storageRequestG` 并结算；`liver` 自己发起释放 |
| `kidneyGluconeogenesis` / `kidney/gluconeogenesis.ts` | `glucoseOutputG` | 轮初 `glucose.concentrationMgDl`（未加载按 90）、`pancreasEndocrine.glucagonRelative`（未加载按 1）；`io.dt` | `kidneyGluconeogenesis` 当轮 transfer 到 `glucose.glucoseMassG` |
| `muscleGlucose` / `skeletal-muscle/glucose-uptake.ts` | `uptakeRequestG`、`uptakeG` | 自身轮初状态；轮初 `glucose.excessMassG`、`glucose.concentrationMgDl`、`pancreasEndocrine.insulinRelative`、`physicalActivity`、各区域是否存在；`io.dt` | `glucose` 读 `uptakeRequestG` 并结算；聚合器把 `uptakeG` 按份额转给区域 |
| `muscleHead` / `muscleTrunk` / `muscleLimbs` / `regions/*.ts` | `uptakeG`、`glycogenG`、`glycogenConsumedG` | 自身轮初状态；`muscleGlucose.glycogenG`（仅旧档迁移）、`physicalActivity`；`io.dt` | 区域自己入账与消耗；`body_state` 读出 |

**储存请求。** 设 `E = max(0, glucose.excessMassG)`、`I = insulinRelative`：

```text
freeCapacity = max(0, glycogenCapacityG − (prev.glycogenG + prev.storageG))
storageRequestG = min(
  maxUptakeRateGPerMin × (E / (E + halfMaxExcessG)) × max(0, 1 + 0.5 × (I − 1)) × dtMin,
  freeCapacity
)
```

`liver` 自己把请求钳到剩余容量：肝满时 `storageRequestG = 0`，未请求部分留在血糖池，不进入 `disposedGlucoseG`。`glucose` 下一轮按请求与余额结算，实际支付经 transfer 进入 `liver.storageG`，再下一轮并入 `glycogenG`。肌肉静息胰岛素项用同一形式，参数为 `maxUptakeRateGPerMin = 0.5`、`halfMaxExcessG = 20`、`insulinSensitivity = 1.0`，并在运动时额外叠加收缩非胰岛素依赖摄糖 `exerciseUptakeRateGPerMin (0.15) × clamp(intensity, 0, 1) × dtMin × clamp(G / 90, 0, 1.5)`；实际到账进入 `muscleGlucose.uptakeG` 后，下一轮聚合器按 0.05 / 0.45 / 0.50 份额转给三个区域（缺区域变体按剩余份额归一），区域再下一轮入账，初值合计 300 g（15 / 135 / 150 g），运动消耗按区域份额分摊（`0.5 × regionShare × intensity × dtMin`，三区合计 0.5 g/min）。肝参数为 `maxUptakeRateGPerMin = 0.2`、`halfMaxExcessG = 15`、`insulinSensitivity = 0.5`，全部 `design`、`source: null`。

**释放与肾糖异生。** 设 `G` 为轮初血糖、`H` 为轮初 `glucagonRelative`、`C` 为轮初 `adrenal.cortisolRelative`（未加载按 1）、`stored = max(0, prev.glycogenG + prev.storageG)`：

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

**时序。** 高血糖侧：第 N 轮 `glucose` 写出高浓度与 `excessMassG`；第 N+1 轮胰腺读到高浓度、写出升高的 `insulinRelative`，同轮聚合器与肝仍读第 N 轮的 `excessMassG` 与信号，写出首批请求；第 N+2 轮 `glucose` 结算首批请求，实际支付到账；第 N+3 轮聚合器把 `muscleGlucose.uptakeG` 分给区域，肝把 `storageG` 并入 `glycogenG`；第 N+4 轮区域把到账量并入 `glycogenG`，同时按第 N+2 轮升高的信号写下一批请求。低血糖侧：`glucose` 写出低浓度后，`liver` 与 `kidneyGluconeogenesis` 下一轮平滑增加输出；有胰腺时再下一轮读到升高的 `glucagonRelative` 并进一步放大。释放/产糖轮的 `glucose` 浓度仍按轮初质量计算，提交后 `glucoseMassG` 已回升，再下一轮浓度才上升。

**旧档与重启。** 旧档缺 `liver` 时补 `storageRequestG = 0`、`glycogenG = 80`、`storageG = 0`、`glycogenCapacityG = 100`、`outputG = 0`；缺 `kidneyGluconeogenesis` 时补 `glucoseOutputG = 0`；缺 `muscleGlucose` 时补 `uptakeRequestG = 0`、`uptakeG = 0`，缺区域时补 `uptakeG = 0`、`glycogenG = 15 / 135 / 150`、`glycogenConsumedG = 0`；旧档只有 `muscleGlucose.glycogenG` 时，各区域第一轮按存在区域份额迁移：默认种子状态用迁移份额取代 300 g 份额初值，已有真实状态则并入存量；聚合器第一次 write 后旧总量不再保留，后续不会重复迁移；若旧实现已经完成迁移并删除 `muscleGlucose.glycogenG`，新代码无法识别或自动回改，唯一可靠纠正是从迁移前备份恢复；这里不声称已验证存在这种真实存档。在途 `uptakeG` 仍由聚合器正常分配。`glucose` 旧档的 `excessMassG` 由首轮轮初质量现算；`pancreasEndocrine` 旧档补两个相对信号 1，不反推历史。含 `glucose` 的旧清单必须补上 `liver`、`kidneyGluconeogenesis`、`muscleGlucose` 与三个区域（或对应缺区域变体），否则启动时报 transfer 配对错误。重启保留已提交请求、存量与在途 `storageG` / `uptakeG`，下一轮只处理一次；容量每轮由 `liver` 按参数重写为 100；`outputG` 不参与释放计算。

**清单与参数。** 当前根清单为 38 部位、34 份唯一参数文件，女性清单为 41 部位、37 份，男性清单为 40 部位、36 份；硬 transfer 闭包为根/男性 15 部位、女性 17 部位。`glucose.residualDisposalHalfTimeMin = 60`（由 `apparentDisposalHalfTimeMin` 更名）与 `glucose.basalConsumptionGPerMin = 0.12` 在 `glucose.parameters.json`；肌肉与肝摄取/释放参数分别在 `glucose-uptake.parameters.json` 与 `glycogen.parameters.json`，区域共享同一个消耗速率，不新增区域参数文件；肾糖异生六个参数在 `kidney/gluconeogenesis.parameters.json`；`pancreasEndocrine.glucagon.*` 在 `pancreas/insulin.parameters.json`，全部 `design`、`source: null`，没有登记来源、范围只作工程调参，不是人体测量或拟合结果。`glucose.muscleDisposalShare`、`glucose.liverDisposalShare` 已从所有参数文件删除。

**当前实现。** 上述脚本、参数、字段、transfer 配对、旧档补齐、缺区域变体和清单计数已实现；模块契约测试在 `test/organs.liver.test.mjs`、`test/organs.renal-gluconeogenesis.test.mjs`、`test/organs.muscle-glucose.test.mjs`、`test/organs.muscle-regions.test.mjs` 与 `test/organs.glucose.test.mjs`，真实 Gateway 账本测试在 `test/organs.liver-gateway.test.mjs`、`test/organs.renal-gluconeogenesis-gateway.test.mjs`、`test/organs.glucose-gateway.test.mjs`、`test/organs.tissue-uptake-gateway.test.mjs`、`test/organs.muscle-regions-gateway.test.mjs` 与 24 小时空腹体温/血糖代理回归测试 `test/organs.steady-state-24h.test.mjs`。这些测试都是离线的，不是实机验收。

**未建模。** 不建胰岛素/胰高血糖素绝对浓度、分泌率、C-peptide、两室激素动力学、α/β 细胞相互抑制、受体或胞内信号；不建肝糖异生、肾糖异生底物池（乳酸/氨基酸/甘油）、酶促糖原合成/分解、Cori 循环、脂肪组织分区与脂肪摄糖、肌糖原容量、静息肌糖原周转、酮症、尿素循环、肝血流；也不建胆汁生成/排泄、解毒、蛋白合成、脂肪代谢或其他肝功能。容量固定为 100 g，不随年龄、体重、进食状态、激素或肝体积变化，不建容量反馈或超容量存量对释放的抑制。

**后续项（计划）。** 脂肪组织按同一请求—结算接口接入；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。这些都不是当前实现。

**未验证。** 没有肝糖原/肾糖异生实测、容量实测、独立血糖曲线、激素浓度、正常餐后曲线复现、真实 DSH 会话或临床验证；肝/肾/肌/血糖新参数全部是 `design`、`source: null`。不能称 `validated` 或个体预测。设计见[肝糖原与胰高血糖素设计](./superpowers/specs/2026-11-23-liver-glycogen-design.md)、[各部位自主摄糖设计](./superpowers/specs/2026-11-24-tissue-uptake-design.md)与[肾糖异生设计](./superpowers/specs/2026-11-24-renal-gluconeogenesis-design.md)，部位契约见[肝 README](../organs/human-organs/liver/README.md)、[肾 README](../organs/human-organs/kidney/README.md)、[骨骼肌 README](../organs/human-organs/skeletal-muscle/README.md)与[胰腺 README](../organs/human-organs/pancreas/README.md)。

### 活动相关失水：皮肤出汗与呼吸（当前模块）

`body_act` 的 `exercise` 与 `sex` 都只需要 `0 < intensity <= 1` 与 `durationMin > 0`，均为有限数；不需要体积、能量、餐型或碳水。`physicalActivity` 先按 `io.dt` 递减活动剩余时间，再让本轮最后一个有效 `exercise` / `sex` 替换剩余时间和强度，两类动作共用同一字段与校验，非法动作不覆盖已有有效状态。

`skin` 与 `lungs` 读取同一份轮初活动快照，写下一轮请求：

- 皮肤：默认 25°C 时 `exerciseRate = R > 0 ? 0.6 × I × max(0, 1 + 0.04 × (T_amb − 25)) : 0`，叠加高核心温度热出汗 `thermalRate = 5 × max(0, coreTemperatureC − 37)`，总速率 `min(15, max(0, exerciseRate + thermalRate)) × dtMin`。
- 肺：剩余活动时间大于 0 时 `0.3 × intensity × dtMin`，否则为 0；只表示运动相关呼吸失水，不含静息呼吸。
- `dtMin = io.dt / 60`。活动剩余时间为 0 或部位未加载时活动项为 0；部位已加载但字段缺失、非有限、负数或 intensity>1 时抛错。

五个皮肤参数（含 `skin.heatGain = 5 mL/(min·°C)` 与 `maxRateMlPerMin = 15 mL/min`）和肺的唯一参数 `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3`（`mL/min`，同目录 `respiratory-water-loss.parameters.json`）都标为 `design`、`source: null`：0.3 是 intensity=1 时的临时工程速率，不是实测人体呼吸失水率或总呼吸失水；出汗参数也不表示 METs、实测代谢或人体最大出汗率。本步的肺失水切片不建静息呼吸失水；通气量、潮气量与呼吸频率另由 `lungsVentilation` 自动代理（见下节），血气与气喘提醒仍未建。

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

本切片新增 `bloodOxygen` 隔室与 `lungsVentilation` 部位，不新增动作、通知或 `transfer`；两者都不写其他部位。当前全清单硬 transfer 闭包为根/男性 15 部位、女性 17 部位；当前根清单为 38 部位 / 34 份唯一参数文件，女性清单为 41 部位 / 37 份，男性清单为 40 部位 / 36 份。

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
- **T4 与压力/困倦读数。** 内分泌轴接入后，`interoception` 另软读 `adrenal.cortisolRelative` 写 `stressMm`、软读 `pineal.melatoninRelative` 写 `sleepinessMm`；两者同样不进 `discomfort`、不发通知，细节见下文「内分泌轴与松果体」。
- **可选部位回退。** 未加载 `bloodOxygen` 时通气按基础需氧 250 mL/min；未加载 `lungsVentilation` 与 `blood` 时血氧池按 `supply = demand`、SpO2 保持基线；已加载但字段缺失、非有限或为负时抛错，本轮不写。旧档只补初值，不反推历史；根清单同时加载它们。
- `body_state` / `GET /state` 会返回 `bloodOxygen` 四个字段与 `lungsVentilation` 五个字段；`interoception` 增加 `dyspneaMm`。这些只是模型读数，不是血气、脉搏血氧或临床气促分级。本切片只有模块与真实 Gateway 离线测试，未做真实 DSH 会话、独立人体数据或临床验证。

### 内分泌轴与松果体（当前模块）

本切片新增五个部位：`hypothalamusEndocrine`、`pituitary`、`thyroid`、`adrenal` 与 `pineal`。五个脚本都没有动作、通知或 `transfer`，不新增硬闭包（当前为根/男性 15 / 女性 17 个部位）。根清单当前 38 部位、34 份唯一参数文件，女性清单 41 部位、37 份，男性清单 40 部位、36 份；旧档缺各部位时由 `initialState` 补基线（信号 1、褪黑素 1，加载后按仿真时刻重算）。HPT/HPA 是两条带负反馈与上游生理驱动的轴，松果体是昼夜节律薄切片。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `hypothalamusEndocrine` / `brain/hypothalamus-endocrine.ts` | `trhRelative`、`crhRelative` | 自己的轮初状态；`thyroid.thyroxineRelative`、`adrenal.cortisolRelative`（未加载按 1）；`thermoregulation.coreTemperatureC`、`glucose.concentrationMgDl`、`physicalActivity` | `pituitary` 读 TRH/CRH |
| `pituitary` / `brain/pituitary.ts` | `tshRelative`、`acthRelative`、`prolactinRelative` | 自己的轮初状态；`hypothalamusEndocrine.trhRelative` / `crhRelative`、`thyroid.thyroxineRelative`、`adrenal.cortisolRelative`（未加载按 1）、`mammaryGlands.milkMl`（未加载按无泌乳） | `thyroid` 读 TSH；`adrenal` 读 ACTH；`mammaryGlands` 读催乳素 |
| `thyroid` / `thyroid/thyroid.ts` | `thyroxineRelative` | 自己的轮初状态；`pituitary.tshRelative`（未加载按 1） | `bloodOxygen` 缩放基础氧耗；`hypothalamusEndocrine` / `pituitary` 负反馈 |
| `adrenal` / `adrenal/cortisol.ts` | `cortisolRelative` | 自己的轮初状态；`pituitary.acthRelative`（未加载按 1） | `liver` 缩放释放；`heart` 缩放驱动；`interoception.stressMm`；`hypothalamusEndocrine` / `pituitary` 负反馈 |
| `pineal` / `pineal/melatonin.ts` | `melatoninRelative` | `io.simulatedSeconds`；不读其他部位 | `interoception.sleepinessMm` |

```text
dtMin = io.dt / 60
coldDrive         = 0.3 × max(0, 36.8 − coreTemperatureC)
hypoglycemiaDrive = 0.02 × max(0, 80 − concentrationMgDl)
exerciseDrive     = remainingExerciseMin > 0 ? 0.4 × max(0, intensity − 0.5) : 0
trhTarget  = clamp(1 + trhFeedbackGain × (1 − T4) + coldDrive, 0, 3)
crhTarget  = clamp(1 + crhFeedbackGain × (1 − 皮质醇) + hypoglycemiaDrive + exerciseDrive, 0, 3)
trhRelative = clamp(trhTarget + (prevTRH − trhTarget) × 2^(−dtMin / 30), 0, 3)
crhRelative = clamp(crhTarget + (prevCRH − crhTarget) × 2^(−dtMin / 30), 0, 3)

tshTarget  = clamp(TRH × (1 + tshFeedbackGain  × (1 − T4)), 0, 3)
acthTarget = clamp(CRH × (1 + acthFeedbackGain × (1 − 皮质醇)), 0, 3)
tshRelative = clamp(tshTarget + (prevTSH − tshTarget) × 2^(−dtMin / 30), 0, 3)
acthRelative = clamp(acthTarget + (prevACTH − acthTarget) × 2^(−dtMin / 30), 0, 3)

prolactinTarget = mammaryGlands.milkMl > 0 ? 2 : 1
prolactinRelative = clamp(prolactinTarget + (prevProlactin − prolactinTarget) × 2^(−dtMin / 30), 0, 3)

thyroxineRelative = clamp(TSH + (prevT4 − TSH) × 2^(−dtMin / 60), 0, 3)
cortisolRelative  = clamp(ACTH + (prevCortisol − ACTH) × 2^(−dtMin / 15), 0, 3)

hour = (io.simulatedSeconds / 3600) % 24
melatoninRelative = clamp(1 + 0.8 × cos(2π × (hour − 2) / 24), 0, 2)
```

- **负反馈与基线中性上游驱动。** T4 高于 1 时同时压低 TRH 与 TSH 目标；皮质醇高于 1 时同时压低 CRH 与 ACTH 目标。低于 1 时方向相反。低温（`< 36.8°C`）抬高 TRH 目标，低血糖（`< 80 mg/dL`）与高强度运动（`intensity > 0.5`）抬高 CRH 目标；在正常 37°C、90 mg/dL 静息基线下三项驱动均为 0，HPT/HPA 精确保持 1.0。四条内分泌脚本对各自旧状态缺字段/非有限均有 `finiteOr` 保护并钳在 `[0, 3]`。
- **消费者。** `bloodOxygen` 基础项为 `basalMlMin × max(0.2, 0.6 + 0.4 × T4)`（未加载甲状腺时保持 `basalMlMin`；T4 = 1 时精确保持 `1.0× = 250 mL/min`）。`liver` 释放乘 `max(0, cortisolRelative)`，仍钳到存量；`heart` 将 `0.5 × (cortisolRelative − 1)` 并入泵血驱动。`interoception` 新增 `stressMm = clamp(100 × (cortisolRelative − 1) / 2, 0, 100)` 与 `sleepinessMm = clamp(100 × (melatoninRelative − 0.2) / 1.6, 0, 100)`，两者都不进 `discomfort`、不触发提醒。
- **松果体。** 曲线按仿真时刻，不读现实时间；02:00 峰值 1.8、14:00 谷值 0.2、08:00 与 20:00 为 1。`sleepinessMm` 在 02:00 附近 100、08:00 为 50、14:00 为 0。只作读数，没有睡眠行为、光照抑制或睡眠压力模型。
- **催乳素。** 有泌乳（上一轮 `mammaryGlands.milkMl > 0`）时目标为 2，无泌乳时回落到 1；默认 `mammaryGlands.lactating: false` 时 `milkMl = 0`，女性静息催乳素维持 1.0。2 与 30 min 半时是 `pituitary.ts` 的 `design` 常量，不新增参数文件。
- **参数。** `hypothalamusEndocrine.trhFeedbackGain = 1` / `crhFeedbackGain = 1`、`pituitary.tshFeedbackGain = 1` / `acthFeedbackGain = 1`、`thyroid.thyroxineHalfTimeMin = 60`、`adrenal.responseHalfTimeMin = 15`、`pineal.melatoninBaseRelative = 1` / `amplitudeRelative = 0.8` / `peakHour = 2` / `periodHours = 24` 全部 `design`、`source: null`；30 min 与 60 min 的半时、0–3 钳位、0–2 钳位与 `0.6 + 0.4 × T4` 也都是脚本常量或工程假设，不是人体测量、剂量反应或临床指标。
- **可选部位回退与异常。** 未加载上游部位时信号按 1、读数按 0 回退；已加载但字段缺失、非有限或为负时抛错，本轮不写。负反馈依赖外周激素，因此“缺甲状腺/肾上腺”时轴仍按 1 回退，不会报错。
- **旧档与重启。** 旧档缺五个部位时只补 `trhRelative = 1`、`crhRelative = 1`、`tshRelative = 1`、`acthRelative = 1`、`thyroxineRelative = 1`、`cortisolRelative = 1`、`melatoninRelative = 1`，不反推历史激素；重启保留已提交值，`pineal` 下一轮按存档仿真时刻重算。五个脚本都没有 `resetOnStart`。
- **当前实现。** 上述五个脚本、消费者改动、参数、旧档补齐、清单计数与离线模块/真实 Gateway 测试已落地；轴测试覆盖“预置高 TSH → T4 升 → 基础需氧升且 TRH/TSH 回落”“预置高 ACTH → 皮质醇升 → 肝糖释放增加且 `stressMm` 升”“跨仿真昼夜 `sleepinessMm` 跟随曲线”与重启接续。
- **未建模。** T3、反 T3、甲状腺结合球蛋白、碘摄入、甲状腺疾病；肾上腺素/去甲肾上腺素、醛固酮、RAAS、皮质醇昼夜节律与应激事件；激素绝对浓度、分泌脉冲、受体、结合蛋白、疾病与个体差异；光照、时差、自由运行周期与睡眠行为。**甲状旁腺与血钙：** `parathyroid`（PTH）与 `bloodCalcium` 隔室（含骨钙库、`* 1000` 单位修正与骨容量上限质量守恒）及单元闭环测试已入库，但尚未挂载进三份 `body-modules*.json` 清单，运行时不生效。
- **未验证。** 没有激素实测、剂量反应、独立人体数据、临床验证、真实 DSH 会话或性能基线实测。全部参数与曲线是 `design`、`source: null`，不能称拟合、实测或 `validated`；`stressMm` / `sleepinessMm` 也不能当作压力、困倦量表、激素浓度或睡眠分期。详见 [`thyroid`](../organs/human-organs/thyroid/README.md)、[`adrenal`](../organs/human-organs/adrenal/README.md)、[`pineal`](../organs/human-organs/pineal/README.md) 与 [`brain`](../organs/human-organs/brain/README.md)。

### 唾液腺与口干（当前模块）

本切片新增 `salivaryGlands`，脚本为 `organs/human-organs/salivary-glands/saliva.ts`，处理 `eat` / `drink` 动作。它不新增 `transfer` 或通知；当前硬闭包为根/男性 15 / 女性 17 个部位，根清单当前 38 部位、34 份唯一参数文件，女性清单 41 部位、37 份，男性清单 40 部位、36 份。

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
- **消费者。** `duodenum` 只在轮初 `stomach.emptiedCarbohydrateG > 0` 时把到达速率乘 `1 + salivaryAmylaseGain × salivaRateMlPerMin / basalRateMlPerMin`，`salivaryGlands` 未加载时增益按 0；已加载但产率非法时抛错，本轮不写。`interoception` 写 `dryMouthMm = clamp(100 − mouthMoistureMm, 0, 100)`，未加载或字段非法时按 0；口干不入 `discomfort`、不入 `brainNotify`，也不改变口渴或饮水。
- **时序。** 两个消费者都读轮初快照。摄入轮本脚本写出刺激状态；`interoception` 下一轮才读到新湿润度，`duodenum` 还要等胃把该餐排入下一轮快照，最早再下一轮才把淀粉酶增益计入暴露。
- **参数。** `salivaryGlands.basalRateMlPerMin = 0.5`、`mealGain = 3`、`mealWindowMin = 5`、`dehydrationFactor = 0.5` 都在 `saliva.parameters.json`；`duodenum.salivaryAmylaseGain = 0.05` 在 `duodenum/nutrient-exposure.parameters.json`，唾液腺参数文件的 `consumerParameters` 另保留一份同值声明供对照。全部 `design`、`source: null`，没有唾液流率、刺激时长、脱水缩减或淀粉酶活性证据。
- **未建模。** 唾液水账（唾液不进出 `bodyFluid`）、淀粉酶浓度/活性/pH、完整吞咽分期与食管运动（食管薄切片只建食团转运时延与呛咳读数）、口腔疾病与唾液腺结石、味觉与咀嚼、口咽解渴、个体差异与昼夜节律、免疫与口腔微生物组。
- **未验证。** 没有唾液流率、刺激窗口、脱水系数或淀粉酶增益的实测、独立人体数据、临床验证或真实 DSH 会话。详见 [`salivary-glands`](../organs/human-organs/salivary-glands/README.md)、[`duodenum`](../organs/human-organs/duodenum/README.md) 与 [`brain`](../organs/human-organs/brain/README.md) README。

### 乳腺泌乳与女性葡萄糖变体（当前模块）

本切片新增女性清单专属的 `mammaryGlands` 与 `glucose.female.ts`。`pituitary` 在既有 TSH/ACTH 之外增加第三个相对信号 `prolactinRelative`；乳腺默认非泌乳（`lactating: false`），显式开启 `lactating: true` 时按轮初催乳素写下一轮乳汁水与乳糖请求；`water.female.ts` 在第五出口把水转入 `mammaryGlands.milkMl`；`glucose.female.ts` 在末位汇把葡萄糖当量转入 `mammaryGlands.lactoseG`；`interoception.discomfort` 增加第六路软读 `mammaryGlands.fullnessMm`。根清单不加载乳腺，也不加载女性葡萄糖变体。

| 部位 / 脚本 | 写什么 | 读什么 | 消费者 |
| --- | --- | --- | --- |
| `pituitary` / `brain/pituitary.ts` | `tshRelative`、`acthRelative`、`prolactinRelative` | 自己的轮初状态；`hypothalamusEndocrine.trhRelative` / `crhRelative`、`thyroid.thyroxineRelative`、`adrenal.cortisolRelative`、`mammaryGlands.milkMl`（均未加载按 1 或无泌乳） | `thyroid`、`adrenal`、`mammaryGlands` |
| `mammaryGlands` / `mammary-glands/milk.ts` | `lactating`、`milkRequestMl`、`milkMl`、`lactoseRequestG`、`lactoseG`、`fullnessMm` | 自己的轮初状态；轮初 `pituitary.prolactinRelative`（未加载按 1）；`io.dt` | `bodyFluid` 女性变体读 `milkRequestMl`；`glucose` 女性变体读 `lactoseRequestG`；`interoception` 读 `fullnessMm`；`pituitary` 读 `milkMl` |
| `bodyFluid` / `water.female.ts` | `waterVolumeMl`、`waterDeficit` | 轮初肾、肺、皮肤、子宫与乳腺请求 | 第五出口把水转入 `mammaryGlands.milkMl` |
| `glucose` / `glucose.female.ts` | `glucoseMassG`、`concentrationMgDl`、`disposedGlucoseG`、`excessMassG` | 轮初肾糖、肝、肌与乳腺请求 | 末位汇把糖转入 `mammaryGlands.lactoseG` |
| `interoception` / `brain/interoception.ts` | `discomfort`（第六路） | 轮初 `mammaryGlands.fullnessMm`（可选） | `body_state` 读出；不通知 |

```text
dtMin = io.dt / 60
decay = 2^(−dtMin / fullnessDecayHalfTimeMin)   （半时 30 min）
prolactinTarget = mammaryGlands.milkMl > 0 ? 2 : 1
prolactinRelative = clamp(target + (prev − target) × 2^(−dtMin / 30), 0, 3)

若 lactating !== true：
  milkRequestMl = 0, lactoseRequestG = 0, fullnessMm = clamp(prev.fullnessMm × decay, 0, 100)
若 lactating === true：
  milkRequestMl   = 0.5 × prolactinRelative × dtMin
  lactoseRequestG = milkRequestMl × 0.07
  fullnessMm      = clamp(prev.fullnessMm × decay + 4 × (milkRequestMl − prev.milkMl), 0, 100)

U_mammary = clamp(mammaryGlands.milkRequestMl, 0,
                  max(0, W_start − U_kidney − U_lung − U_sweat − U_uterus))
G_paid    = min(max(0, mammaryGlands.lactoseRequestG), M_after − X − L_paid − U_paid)
```

- **默认非泌乳与请求分离。** 默认女性身体 `lactating: false`，24 h 空腹静息下 `milkMl = 0`、`lactoseG = 0`、`prolactinRelative = 1.0`；显式置 `lactating: true` 时第 N 轮写请求，第 N+1 轮支付，第 N+2 轮 `pituitary` 读到 `milkMl > 0` 并把催乳素目标抬到 2。`milkMl > 0` 只是吸吮/排空代理，不是婴儿需求或吸吮剂量。
- **胀奶。** 随 `fullnessDecayHalfTimeMin = 30 min` 一阶回落，并在 `lactating: true` 且“本轮产奶请求 > 上一轮实际泌乳量”时累积，不再因一轮结算滞后产生永久棘轮锁死；它不反馈到产奶速率，也不是乳腺压力、容量或疼痛测量。`interoception` 下一轮才读到新的 `fullnessMm`。
- **可选回退与非法上游。** 未加载 `pituitary` 时乳腺按 `prolactinRelative = 1` 产奶；已加载但字段缺失、非有限或为负时抛错，本轮不写。未加载 `mammaryGlands` 时 `pituitary` 按无泌乳处理，`interoception` 第六路按 0，`water.female.ts` / `glucose.female.ts` 直接调用时请求按 0；完整女性清单缺 `mammaryGlands` 则在启动时因 `transferOut target "mammaryGlands.milkMl" is not declared` 失败。
- **清单与闭包。** 女性清单 41 部位、37 份唯一参数文件；根清单 38 部位、34 份。根清单使用 `water.ts`（三出口）与 `glucose.ts`（三汇），不含乳腺；女性清单使用 `water.female.ts`（五出口）与 `glucose.female.ts`（四汇），硬 transfer 闭包为 17 部位（根 15 + `uterus` + `mammaryGlands`）。同一清单不能同时加载 `glucose.ts` 与 `glucose.female.ts`，也不能同时加载两个体液入口。
- **参数与证据。** `mammaryGlands.basalMilkRateMlPerMin = 0.5`、`lactoseGPerMl = 0.07`、`fullnessGainPerMl = 4`、`fullnessDecayHalfTimeMin = 30` 全部 `design`、`source: null`；`prolactinRelative` 的 2 倍目标与 30 min 半时是 `pituitary.ts` 脚本常量，也没有新增参数文件。没有实测泌乳率、乳汁乳糖浓度、胀奶量表、婴儿需求或吸吮剂量—反应。
- **旧档与重启。** 旧档缺 `mammaryGlands` 时补 `lactating: false` 与五个 0（`initialState`），缺 `pituitary.prolactinRelative` 时补 1；不反推历史泌乳、乳糖或胀奶。重启保留 `lactating`、请求、实际到账与 `fullnessMm`，每轮 write 先把 `milkMl` / `lactoseG` 归 0，不会重复累计。
- **当前实现。** 脚本、参数、字段配对、旧档补齐、清单计数和离线测试已落地；模块测试在 `test/organs.mammary.test.mjs`，真实 Gateway 在 `test/organs.mammary-gateway.test.mjs` 与 `test/organs.steady-state-24h.test.mjs`，女性变体入口在 `test/organs.glucose.test.mjs` 与 `test/organs.body-water-female.test.mjs`。**未建模：** 婴儿、吸吮动作、哺乳行为、排空事件、孕期/产后阶段、乳腺病变、乳汁脂肪/蛋白/免疫成分、乳糖合成、乳房体积/压力、个体差异。**未验证：** 没有实测泌乳率、乳汁成分、胀奶量表、独立人体数据、真实 DSH 会话或临床验证；全部参数是 `design`，不能称拟合、实测或 `validated`。

### 性行为与性反应周期（当前模块）

`body_act` 的 `type` 枚举增加 `sex` 与无载荷 `orgasm`。`sex` 载荷为 `{ type: "sex", intensity, durationMin }`，校验与 `exercise` 相同：`intensity` 有限且 `(0, 1]`，`durationMin` 有限且 `> 0`；不需要体积、能量、餐型或碳水，也不接收伴侣、行为类型或内容字段。`orgasm` 只写 `{ type: "orgasm" }`，不接收 `intensity` / `durationMin` 等载荷；`sexualResponse.actionTypes = ['sex', 'orgasm']`，`physicalActivity` 仍只接受 `exercise` / `sex`。

**LLM 介入原则（design）：** LLM 只控制输入（`drink` / `eat` / `urinate` / `defecate` / `exercise` / `sex` / `orgasm` 等动作），不直接写身体状态；只有少数输出允许主动触发（`urinate`、`defecate`、`orgasm`），且都有非自主兜底——膀胱 >600 mL 非自主排空、唤醒 ≥95 mm 且非不应期时强制释放；`defecate` 没有自动排便兜底，空结肠时排出 0。`orgasm` 动作在轮初 `arousalMm < 70` 或处于不应期（`sincePreviousOrgasm < 20 min`）时被忽略，不因该动作改变状态；非不应期下轮初 70–94 mm 时由该动作触发释放，≥95 mm 时即使没有动作也会释放。

`sexualResponse` / `sexual-response/response.ts` 只写自己的五个字段，无 `transfer`、无通知：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `arousalMm` | `mm` | 唤醒代理 0–100；不是生理测量 |
| `phase` | `-` | `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution` |
| `remainingSexMin` | `min` | 剩余性活动分钟，先按 `io.dt` 递减，再由合法 `sex` 替换 |
| `sexIntensity` | `1` | 模型内相对强度 0–1；不是 MET 或能量消耗 |
| `lastOrgasmAtSimMin` | `min` | 最近一次主动或强制释放的仿真分钟；从未发生为 `null` |

六个参数 `sexualResponse.arousalHalfTimeMin = 5`、`resolutionHalfTimeMin = 15`、`orgasmAllowedMm = 70`、`orgasmForcedMm = 95`、`orgasmDurationMin = 1`、`refractoryMin = 20` 全部是 `design`、`source: null`。`factor = 0.5 + 0.5 × max(0, testes.testosteroneRelative)`（未加载睾丸按 1，`factor = 1`），`target = active && !refractory && !released ? clamp(100 × sexIntensity × factor, 0, 100) : 0`；高睾酮（`> 1`）时上升半时加快为 `5 / factor`，否则 5 min 上升、15 min 下降，`arousalMm` 严钳 `[0, 100]`。释放判定只看轮初 `prev.arousalMm` 与 `!refractory`：本轮存在 `orgasm` 动作且轮初 ≥70，或轮初 ≥95（无需动作），就记一次 `lastOrgasmAtSimMin = simMin` 并立即把该轮 `target` 切为 0 进入消退，避免连续高潮循环；低于 70 或处于不应期的 `orgasm` 被忽略；本轮 `sex` 新推高的唤醒最早下一轮参与释放判定。事件轮 `sinceOrgasm = 0`、相位 `orgasm`；下一轮 `sinceOrgasm = dtMin`（60 s 轮下 1 min），进入 `refractory`，目标为 0、唤醒下降；不应期内新动作仍更新剩余分钟与强度，但唤醒不升。相位的 60 / 10 mm 分界也是 `design`。

两个消费者与男/女性别扩展：

- `physicalActivity` 的 `actionTypes = ['exercise', 'sex']`，两类动作共用 `remainingExerciseMin` / `intensity` 与同一校验，最后一条合法动作替换；后续 `skin` 汗液、`lungs` 运动相关呼吸失水、`heart` 心率/搏出量与三个肌肉区域的糖原消耗沿用既有活动链，`sex` 不另建失水或代谢字段，`orgasm` 也不改变活动。
- `interoception` 下一轮软读 `sexualResponse.arousalMm`，钳位后写 `sexualArousalMm`；`sexualResponse` 未加载、字段缺失或非有限时按 0。该读数只进 `body_state` / `GET /state`，不进入 `discomfort`，`brainNotify` 不读它，也不发任何通知。
- 男性清单额外加载 `testes`（`testes/testosterone.ts`：08:00 峰值 `1.1` / 20:00 谷值 `0.9` 的 60 min 半时昼夜曲线，缩放 `sexualResponse` 目标与上升半时，并经 `interoception.libidoMm` 输出读数）与 `epididymis`（`epididymis/storage.ts`：按 `0.002 mL/min` 回补至上限 5 mL，并在 `sexualResponse.lastOrgasmAtSimMin` 对应的下一轮把轮初存量排空为 `ejaculatedMl`）；契约分别见 [`testes`](../organs/human-organs/testes/README.md) 与 [`epididymis`](../organs/human-organs/epididymis/README.md)。

动作轮 `sexualResponse` 与 `physicalActivity` 同时写自己的状态；皮肤、肺、三个肌肉区域、血氧需氧和 `interoception` 最早下一轮读到。旧档缺 `sexualResponse` 时补 `{ arousalMm: 0, phase: 'rest', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null }`，不反推历史；`lastOrgasmAtSimMin` 的 `null` 保持 JSON-safe。重启保留剩余活动、唤醒与高潮时间，不重复记录已发生的高潮；重启后非不应期下轮初 ≥95 仍会强制释放，<70 的 `orgasm` 仍被忽略。当前根清单 38 部位 / 34 份唯一参数、女性清单 41 / 37、男性清单 40 / 36，硬闭包根/男性 15 / 女性 17。本切片只有离线测试，未做真实 DSH 会话、独立人体性反应数据或临床验证。完整契约见[`sexual-response`](../organs/human-organs/sexual-response/README.md)。

### 循环、体温调节与消化反馈补充（当前模块）

- **循环（`heart` + `blood`）：** `heart/heart.ts` 读轮初活动强度、`adrenal.cortisolRelative` 与 `blood.bloodVolumeMl` 算 `drive = 1 + 1.5 × intensity + 0.5 × (cortisolRelative − 1)`、`preloadFactor = clamp(bloodVolumeMl / 5000, 0.5, 1.15)`、`strokeVolumeMl = clamp(70 × (1 + 0.2 × (drive − 1)) × preloadFactor, 30, 140)` 与 `cardiacOutputMlMin = heartRatePerMin × strokeVolumeMl`（静息 `70 × 70 = 4900`）。`blood/blood.ts` 在 `bodyFluid` 加载时将 `bloodVolumeMl` 耦合为 `clamp(5000 × bodyFluid.waterVolumeMl / 30000, 2500, 6000)`（未加载时保留自身状态），按 `referenceCardiacOutputMlMin = 4900` 推出 `systolicMmHg` / `diastolicMmHg`（首轮静息精确 `120 / 80 mmHg`）、`oxygenDeliveryMlMin`、`maxOxygenDeliveryMlPerMin`（供 `bloodOxygen` 作循环能力上限）与 `gfrMlMin`（缩放 `kidney` 产尿请求；`hypothalamusAdh` 同时读取 `bloodVolumeMl` 参与目标）。详见 [`heart`](../organs/human-organs/heart/README.md) 与 [`blood`](../organs/human-compartments/blood/README.md)。
- **体温调节（`thermoregulation`）：** `brain/thermoregulation.ts` 按轮初 `bloodOxygen.oxygenConsumptionMlMin`（`metabolicFactor = 0.005 kcal/mL`）与寒战 `2 × max(0, 37 − T)` 算产热，按 `0.58 × (skin.sweatVolumeMl / dtMin) + 0.104167 × (T − 25)` 算散热，积分 `coreTemperatureC` 并钳位 `[25, 45] °C`。消费端：`skin` 叠加加性热出汗 `5 × max(0, T − 37)`，`lungsVentilation` 叠加喘息 `1500 × max(0, T − 37)`，`hypothalamusEndocrine` 读 `< 36.8°C` 驱动 TRH，`interoception` 软读 `heatMm` / `coldMm`。三清单 24 h 空腹静息回归逐轮断言核心体温在 `[36.5, 37.5] °C`；单次运行的观察值约 `36.999998–37.000000 °C`，不是全身体温稳态或人体测量。30 min 满强运动 + 60 min 恢复场景（`test/organs.steady-state-24h.test.mjs:171-236`）逐轮断言核心体温 `< 39.5 °C`，结束时断言峰值 `> 37 °C` 且恢复值低于峰值；同一场景第 2 轮断言心率 `> 140 /min` 且 `SpO2 = 97`，第 3 轮通气 `> 20000 mL/min`，每轮血糖 `<= 105 mg/dL`，三区耗糖合计 `15 g`（各自 `0.75 / 6.75 / 7.50 g`，容差 `1e-6 g`）。单次运行观察峰值为 `38.27 °C`、90 min 时 `37.05 °C`，不是人体测量。详见 [`brain`](../organs/human-organs/brain/README.md)。
- **消化链闭环反馈：** `stomach` 排空速率乘 `1 − 0.5 × clamp(duodenum.nutrientExposure, 0, 1)`；`stomachGhrelin` 在含能摄入当轮改为分级下调 `clamp(min(current, nadir) − suppression, 0, peak)`（`suppression = 0.3 × mechanical + 0.3 × exposure + 0.4 × energyKcal / 250`）；`smallIntestine` 水吸收随 `waterDeficit` 微调、碳水吸收随高血糖浓度梯度负反馈减缓。详见 [`stomach`](../organs/human-organs/stomach/README.md) 与 [`small-intestine`](../organs/human-organs/small-intestine/README.md)。
- **离线重放工具：** [`tools/replay.mjs`](../tools/replay.mjs) 默认重放固定 5 模块 P0/P1 子集（含历史 `stomach/motility.ts`）以保持与既有用例兼容；传入 `--manifest [path]`（未指定路径时默认 `body-modules.json`，也可传入 `body-modules.male.json` / `body-modules.female.json` 与 `--signals`）即可通过 `createFieldRegistry` 与 `applyOperations` 运行完整清单的多器官离线仿真与守恒诊断。

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
- **发通知：** `io.notify({ mode: 'context', sessionId, text })`（也支持 `'wake'`）暂存通知，只有在线轮次成功才入队；启动补算产生的通知由 Gateway 直接丢弃，不会稍后补发。补算轮 IO 带只读 `io.suppressNotifications = true`：`brainNotify` 在该标记下不调用 `io.notify`，也不抬高 `levels`、不更新 `lastSentAt`、不消耗小时/天配额，因此恢复后首个在线轮仍保有发送机会，同一档位不会在补算中被提前消耗；其他模块若在补算轮产生通知，Gateway 仍兜底丢弃。`GET /notifications` 可查，`POST /notifications/ack` 用 `{ "id": "通知ID" }` 确认。`sessionId` 指定通知目标；`index.js` 的 `notifications.js` 会把 `context` 用 `agent.inject`、`wake` 用 `agent.followup` 投递到对应会话，投递成功后 ACK。会话不在线时通知保留；通知历史文件和模型已读确认尚未实现。
- **读旧脚本。** 旧版字符串路径继续支持调用模块导出的 `functions` 和 `io.call(partId, name, ...args)`。旧的 `step(snapshot, dt, actions)` 可以返回本部位完整状态。同一模块有两个轮次入口时使用 `heartbeat`。
- **接入非标/可扩展器官（如翅膀、尾巴）的规范与即插即用接口：**
  - **动作扩展：** 模块导出 `export const actionTypes = ['fold_wings', ...]` 并在清单中排在 `brain/interoception.ts` 与 `brain/notify.ts` 之前。`GET /capabilities` 自动登记对应动作，`tools.js` 的 `body_act` 会动态读取 `gateway.getCapabilities()` 并把这些扩展动作并入 `type` 枚举、放行对应载荷；未声明的动作名仍返回 `400`，7 类内置动作继续执行严格字段校验。
  - **向 `interoception` 与 `brainNotify` 上报通用体感（免改脑部代码）：**
    - 模块在 `io.write(...)` 中可写可选数字段 `discomfortMm`（`0–100 mm`），`interoception` 会通过轮初 `io.read()?.parts` 自动扫描其他部位（跳过自身）并按 `discomfort.onsetMm = 70` 并入 `interoception.discomfort`。
    - 模块还可写可选 `sensations: { [key]: { intensityMm, discomfort?, contextText?, wakeText? } }`（JSON-safe）；`interoception` 自动汇聚到可选字段 `sensations['<partId>.<key>']`（无扩展感受时不写出该键），若 `discomfort: true` 同时参与 `discomfort` 计算。
    - `brainNotify` 在保留原有 4 路 `levels.{hunger,fullness,urinary,thirst}` 与内置 `SIGNAL_ORDER` 优先级不变的前提下，新增可选 `session.sensationLevels`（无激活扩展感受时省略）按统一 65/85/40 mm 滞回门控投递：`2` 档用 `mode: 'context'`（`agent.inject`，添加进上下文不唤醒）、`3` 档用 `mode: 'wake'`（`agent.followup`，系统消息唤醒）。
    - **纯感觉、零数值硬规则**：`contextText` / `wakeText` 必须是不含阿拉伯数字和数值单位的定性感受描述；若包含数字或未提供文本，`brainNotify` 会强制回退为无数字的通用定性提示，不把 mm 读数、比例或分数发给大脑。
  - **体型缩放：** 若新器官带有与体重成比例的容量/消耗常数，建议接入 `scaleByBodyWeight(value, paramId)`（见上节 `lib/parameters.js`）。

### DSH 工具与通知泵

`index.js` 在 Gateway ready 后通过 `ctx.tools.register` 注册两个工具：

- `body_act`：把 `drink` / `eat` / `urinate` / `defecate` / `exercise` / `sex` / `orgasm` 动作连同当前 `sessionId` 交给 Gateway；`urinate` 与 `defecate` 不需要体积、能量、餐型或时长，`exercise` 与 `sex` 都只需要 `intensity` 与 `durationMin`，校验相同，`orgasm` 不需要任何载荷；`body_act` 的 `type` 枚举包含 `defecate`、`sex` 与 `orgasm`，复用已有字段，不新增伴侣、行为类型或内容字段。LLM 只控制输入，`urinate` / `defecate` / `orgasm` 是少数允许主动触发的输出，分别有非自主排空、无自动兜底与强制释放兜底。action id 由会话 ID 与工具 `callId` 稳定生成。202 只表示入队；用 `GET /actions/:id` 查动作回执，用 `body_state` 或 `GET /state` 看已提交的快照。根清单已加载 `bladder` 与 `colon`，启用后 `urinate` / `defecate` 有处理者；Task 10 真实 DSH 会话已核对 queued → applied、同 callId 重试返回原 applied ID、同 callId 异载荷 409，以及当轮新尿留下。非自主排空不产生动作、回执或工具调用，只改变膀胱状态字段；不要用 `body_act` 触发它。
- `body_state`：读最近提交的 `simulatedSeconds` 和 `parts`，可用 `part` 过滤，例如 `stomach`、`interoception`、`bloodOxygen`、`lungsVentilation`、`pancreasEndocrine`、`liver`、`bladder`、`heart`、`blood`、`thermoregulation`、`kidneyGluconeogenesis`；根清单已接入水链、血氧链、循环、体温与糖链，`interoception` 会返回 `thirst` / `urinaryUrgency` / `discomfort` / `sexualArousalMm` / `dyspneaMm` / `stressMm` / `sleepinessMm` / `dryMouthMm` / `bowelUrgencyMm` / `heatMm` / `coldMm` 等读数（`libidoMm` 随男性 `testes` 启用、`hypocalcemiaMm` / `hypercalcemiaMm` 在 `bloodCalcium` 挂载前保持 0），`bloodOxygen` 会返回四个供需字段，`lungsVentilation` 会返回五个通气字段，`heart` 会返回心率/搏出/心输出，`blood` 会返回血容量/血压/氧输送/循环能力上限/GFR，`thermoregulation` 会返回 `coreTemperatureC`，`kidneyGluconeogenesis` 会返回 `glucoseOutputG`，`pancreasEndocrine` 会返回 `insulinRelative` / `glucagonRelative`，`liver` 会返回 `glycogenG` / `storageG` / `glycogenCapacityG` / `outputG`，`bladder` 会返回 `volumeMl` / `voidedMl` / `voluntaryVoidedMl` / `involuntaryVoidedMl`，`sexualResponse` 会返回 `arousalMm` / `phase` / `remainingSexMin` / `sexIntensity` / `lastOrgasmAtSimMin`；女性清单还会返回 `ovaries` 与 `uterus` 的周期日、相位、相对激素、内膜、痉挛、月经请求与实际失水，以及 `mammaryGlands` 的 `lactating`、乳汁请求/实际乳汁、乳糖请求/实际乳糖与胀奶读数；男性清单还会返回 `testes` 的 `testosteroneRelative`、`epididymis` 的 `spermStorageMl` / `ejaculatedMl` 与 `interoception.libidoMm`。`brainNotify` 会返回每会话的 `lastKind` / `lastLevel` 与逐信号 `levels`，可核对提醒被哪个信号或水位挡住。这些读数仍是代理：`discomfort` 不是疼痛评分或疾病严重度，`uterus.crampMm` 不是痛经测量，`sexualArousalMm` 与 `libidoMm` 不是性欲、情绪或临床性功能测量，`dyspneaMm` 不是呼吸困难评分或呼吸功，`spo2Percent` 不是脉搏血氧仪读数，`liver.glycogenG` 不是肝活检或影像测量、`glucagonRelative` 不是激素浓度，膀胱体积与排出量不是临床容量、残余尿诊断或失禁结论。
- **DI 样变体不改变工具形状。** `body_act` / `body_state` 的名称、参数枚举与输出 schema 与根清单一致（`test/organs.di.test.mjs` 的形状用例覆盖）；工具不会按会话或清单切换身体。DI 身体必须使用自己的清单与独立 `statePath`，默认根清单不加载变体。

`notifications.js` 每 1000 ms 轮询 `gateway.getNotifications()`：

- `context` → `agent.inject`（不唤醒空闲会话，下一次模型调用读取）；`wake` → `agent.followup`（唤醒会话）。
- 消息来源是 `body-notify`，不冒充真人 `user` 源。
- 投递成功后 ACK；ACK 失败时下次只重试 ACK，不重复投递；会话不在线时保留。
- `brain/notify.ts` 每轮读轮初 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`、最近提交的 `bladder.voidedMl` 和本轮动作里的 `urinate`，按四类信号决定是否通知：明显/强档阈值都是 65/85 mm；观测分 0（`< 40`）、1（`40–64`）、2（`65–84`）、3（`>= 85`）四档，用于门控的 `levels` 存 `0/2/3`——只有严格低于 `resetBelow = 40 mm`（观测 0 档）才把水位清零，在 `40–64 mm` 观测中间档保持既有水位锁定不复位；尿意缺失或非有限时按 0 mm，口渴缺失或非有限按 50 mm。每个信号各记一份滞回水位 `brainNotify.sessions.<sessionId>.levels.{hunger,fullness,thirst,urinary}`；同一信号重复同一档，需先降到 40 mm 以下让水位回落；若观测升到比水位更高的档（如 2→3），可直接提醒。
- `lastKind` 记录最近一次实际提醒的信号；`lastLevel` 仍按下降闩锁维护（提醒时置为发送档位，之后当前档位更低时下降，可为 1），并作为旧档迁移来源，不是纯展示摘要。每轮最多一条通知，在尚未提醒到当前档位的候选中先选档位最高者，同档按 `urinary > thirst > fullness > hunger`；未被选中的信号不消耗自己的水位。45 min 冷却、每会话每小时 2 次、每天 6 次按会话共享，不按信号各记一份。
- 最近提交快照里 `bladder.voidedMl > 0` 或本轮动作含 `urinate` 时，只抑制尿意候选：该轮不产生尿意提醒，`levels.urinary` 按 0 回落；其他信号仍按各自水位参与选择，从而避免补发排尿前的过期尿意。旧会话没有 `levels` 时按 `lastKind` / `lastLevel` 惰性迁移，已有 `levels` 的其他键按既有归一逻辑补 0，不升存档 `schemaVersion`。提醒文本固定，不带数值、诊断结论或动作指令；`brainNotify` 不自动排尿或饮水，`discomfort` 不提醒。`notify.parameters.json` 全部 14 项提醒参数均标为 `policy`（`source: null`），不是人体测量或临床界值。
- 尿意提醒相对轮初膀胱变化为两轮；预置一致的 `waterVolumeMl=29650` 与 `waterDeficit=0.7` 时，口渴经下丘脑→体感→通知在第 3 轮提醒，只预置水量会再晚一轮。显式 `drink` 只能经胃→小肠→体液吸收后降低口渴，不在动作轮清零。`io.notify` 的载荷仍只有 `mode` / `sessionId` / `text`，类型和档位只在 `brainNotify.sessions` 里。
- 尿意和口渴提醒目前只有离线单元测试和真实 Gateway 集成测试（`test/organs.brain-notify.test.mjs`、`test/organs.urinary-notify-gateway.test.mjs`、`test/organs.thirst-notify-gateway.test.mjs`），尚未做真实 DSH 会话验收；不能把离线测试当成实机会话验收。

**排查顺序：** `/capabilities` 没有动作名，先用 `/health` 确认身体已启用，再核对清单里的脚本路径和模块导出的 `actionTypes`。启用时无处理者的新动作是 `422`，暂停时是 `409`；同一 `id` 换了载荷也是 `409`。动作已经 `queued` 但状态没变，先看 `effectiveAt` 和 `/state` 的仿真时刻，再看 `/health` 的心跳错误。如果已经 `applied`，但数值没变，查脚本对类型、字段和单位的判断：`applied` 表示批次提交成功，不保证某个模块实际改了值。
