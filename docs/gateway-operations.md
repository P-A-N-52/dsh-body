# Gateway 操作层（fields / add / transfer）

> 结论：每个心跳模块必须导出 `fields` 声明自己部位的字段；`io.write` 仍是部位所有者的绝对写入，`io.add` 只给 additive 字段做增量，`io.transfer` 只在已声明的字段对之间搬数量。声明错误拒绝启动；运行时越权、单位不符、源不足算 fatal，停止调度并在 `/health` 显示。超时与临时脚本异常仍按原来的失败批次重试。
>
> 本文只描述 Gateway 操作层。Gateway 的时钟、动作队列、存档和整轮提交语义见 `docs/gateway-and-scripts.md`；本文不改变它们。

## 1. `fields` 声明

模块是 ESM 具名导出，除 `id`、`actionTypes`、`initialState`、`heartbeat` 外，**必须**导出 `fields`。只做 `io.write` 的模块可以写 `export const fields = {};`，但导出本身不能省略。

```js
export const fields = {
  glucoseMmol: { unit: 'mmol/L', mode: 'additive', contributors: ['liver', 'muscle'] },
  volumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['duodenum.contentMl'] },
  contentMl: { unit: 'mL', mode: 'absolute', transferIn: ['stomach.volumeMl'] },
};
```

| 键 | 必填 | 含义 |
| --- | --- | --- |
| `unit` | 是 | 非空字符串。只做一致性比较，不做换算；`mL` 与 `kcal` 永远不能互相 transfer。 |
| `mode` | 是 | `absolute`（owner 用 `io.write` 绝对写入）或 `additive`（多个模块用 `io.add` 增量贡献）。 |
| `contributors` | additive 必填 | 允许对该字段 `io.add` 的部位 id 数组，不能为空、不能重复。owner 自己也可以 add。absolute 字段不能声明 `contributors`。 |
| `transferOut` | 否 | `"部位.字段"` 数组，列出本字段可以转出到的目标字段。只有 absolute 字段可以声明。 |
| `transferIn` | 否 | `"部位.字段"` 数组，列出来源字段。只有 absolute 字段可以声明。 |

声明规则（加载期校验，任一不满足则 Gateway 拒绝启动）：

1. 每个 `fields` 的键必须是本模块 `initialState` 的自有顶层键；`initialState` 里没有的字段不能声明。
2. `mode` 只能是 `absolute` 或 `additive`。
3. `additive` 必须有非空的 `contributors`，且不能声明 `transferOut` / `transferIn`。
4. `transferOut` 与 `transferIn` 必须成对：A 声明 `transferOut: ['b.c']` 时，`b.c` 必须存在、必须是 `absolute`、单位与 A 相同，并且 `b.c` 的 `transferIn` 必须包含 `'a.<field>'`。反向同理。
5. 每个 `"部位.字段"` 引用必须指向已加载模块声明的字段；不存在的部位或字段一律拒绝启动。

错误信息同时给出模块 id 与字段名，例如：

```text
Failed to load body modules: describe /path/modules/stomach.mjs failed:
Body module "stomach" field "volumeMl": transferOut target "duodenum.contentMl" has unit "kcal", expected "mL"
```

## 2. 三个操作

| 操作 | 语义 | 允许的调用方 |
| --- | --- | --- |
| `io.write(nextPart)` | 绝对写入本部位的完整下一状态；不是补丁。 | 部位所有者（模块只能写自己的部位，由 `io.write` 的 API 形状保证）。 |
| `io.add(partId, field, delta)` | 对 `partId.field` 增加 `delta`（有限数字，可为负）。 | 该字段的 owner，或 `contributors` 中列出的部位。字段必须是 `additive`。 |
| `io.transfer(fromPart, fromField, toPart, toField, amount)` | 从源字段减去 `amount`，向目标字段加上同一 `amount`（非负有限数字）。 | 源字段的 owner；且该字段对必须在 `transferOut` / `transferIn` 中声明。 |

`io.add` / `io.transfer` 只收集请求，不立即改状态；`async` 心跳里的调用同样在轮末统一结算。旧式 `step(snapshot, dt, actions)` 没有 `io`，不能用这两个操作。

## 3. 提交顺序

整轮所有模块跑完后，Gateway 在内存里按固定顺序应用：

1. **write**：把各模块写回的完整部位组成下一状态。
2. **add**：按 `部位.字段` 把本轮所有 delta 求和，一次性加到 write 之后的值上。求和顺序不影响结果。
3. **transfer**：按字段对 `源.字段 -> 目标.字段` 把本轮所有 amount 求和；字段对按 `"源.字段->目标.字段"` 字符串排序后依次应用。每一对都针对**当前**源值检查是否足够，因此同一轮多个字段对共用同一源时不会透支。先减源、再加目标。

因此同一轮里「write 300、transfer 200」的结果是源 100、目标 +200：write 先成为基准，transfer 最后扣减。add 不会作用于 absolute 字段；transfer 不会作用于 additive 字段。

`io.write` 的 `nextPart` 是完整部位，缺少的键不会从旧状态补回。模块只改一项也要展开旧值：`io.write({ ...prev, field: next })`。

## 4. 运行时校验与 fatal

以下情况在应用阶段抛 `FatalOperationError`：

- `add` 的目标字段未声明，或不是 `additive`；
- `add` 的调用方既不是 owner 也不在 `contributors`；
- `delta` / `amount` 不是有限数字，或 `amount < 0`；
- `transfer` 的源字段或目标字段未声明；
- `transfer` 的调用方不是源字段 owner；
- 字段对未在 `transferOut` / `transferIn` 中声明；
- 源值不足（`源值 < amount`），或参与运算的值不是有限数字。

fatal 的语义：

- 本轮**不提交**：快照、时钟、通知都不前进；
- 本次 `activeBatch` 被放弃（存档里 `activeBatch` 置 `null`），在途动作保持 `queued`，**不进入同批次重试**；动作和批次的 `attempts` 不增加；
- 调度停止：不再安排下一轮心跳，`tick()` 也直接返回 `{ ran: false, failed: true, fatal: true }`；
- `/health` 返回 `ok: false`、`status: "fatal"`，并带 `fatal` 对象：

```json
{
  "ok": false,
  "status": "fatal",
  "batch": null,
  "fatal": {
    "module": "intruder",
    "operation": "add",
    "partId": "pool",
    "field": "amount",
    "target": null,
    "reason": "module is not a declared contributor",
    "message": "Body module \"intruder\" add pool.amount: module is not a declared contributor",
    "atWallTimeMs": 1700000000000,
    "batchTargetSimulatedSeconds": 60
  }
}
```

恢复方式是修好模块后重启 Gateway；`fatal` 只是本进程的运行状态，不写进存档。修复后重启会重新建立批次，尚未结算的动作继续按原 `effectiveAt` 生效。

超时（`scriptTimeoutMs`）与普通脚本异常**不是** fatal：仍按原逻辑给 `activeBatch.attempts` 加一、记录 `lastError`、下一次心跳用同一批次重试。只有操作层校验错误才停止调度。

## 5. 信任边界

- **API 层单写者。** Gateway 校验 `write` 只写调用者自己的部位（`io.write` 不接受部位 id），`add` 的调用方必须在 `contributors`，`transfer` 的调用方必须是源字段 owner，且字段对必须声明。模块不能借操作层改别人的字段。
- **声明来自模块本身。** `fields` 是模块自述的开发期契约，不是运行时可配置的白名单；声明错误只会在加载时被拒绝。
- **进程内运行。** 模块与 Gateway 在同一宿主进程的 worker 里执行，能自由读写文件系统；Gateway 不做文件系统沙箱，也不隔离模块之间的 import。把模块当成受信任的代码：`.tower/`、参数文件、存档目录的写权限都属于信任边界之内。
- **不做量纲换算。** 操作层只比较 `unit` 字符串，不提供换算表；需要换算时由模块自己按有依据的方法换算后再写入对应字段。

## 6. 已知限制

- **无并行。** 一轮内模块按清单顺序串行执行，所有模块读同一份轮初快照；操作层不提供模块间并发或乱序提交。
- **只有字段级增量。** 除 `add` / `transfer` 外没有别的增量或追加操作：没有 JSON Patch、没有按路径的深写、没有数组 append；数组、嵌套对象只能用 `write` 整体替换。
- **无热替换。** 模块与参数只在启动时加载；运行中改脚本或 `*.parameters.json` 不生效，也不重新校验 `fields`。
- **无沙箱。** 没有文件系统、网络或 CPU 配额限制；`scriptTimeoutMs` 只中断超时请求，不是安全边界。
- **fatal 不持久化。** `/health` 的 `fatal` 只存在于当前进程；重启后如果模块仍违规，会在下一次心跳再次触发。
- **不改变既有语义。** 时钟、动作队列、整轮全有或全无提交、启动补算与暂停恢复都不变；操作层只是给提交前加了一步内存应用。

## 7. 测试

`test/gateway.operations.test.mjs` 用真实 Gateway（端口 0、临时存档、`autoTick: false`）覆盖：

1. `add` 汇总 `1.0 + 0.5 - 0.3 = 1.2`；
2. `transfer` 源 300 转 200 → 100 / 200；
3. 源 100 转 200 → fatal，不提交，`activeBatch` 清空，`/health` 报模块/字段/操作，再次 `tick()` 不运行；
4. mL 目标声明成 kcal → 启动拒绝；
5. 非 `contributors` 模块 `add` → fatal；
6. absolute 字段 `add` → fatal；
7. 缺少 `fields` 导出 → 启动拒绝；
8. 同轮 `write` 300 后 `transfer` 200（起始 100）→ 100 / 200；
9. 交换两个贡献模块的清单顺序，`add` 结果相同。

既有 `test/gateway.*.test.mjs` 的玩具模块都补了 `export const fields = {};`，行为不变。
