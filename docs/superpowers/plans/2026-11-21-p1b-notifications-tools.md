# P1b 实施计划：通知投递、`body_act` / `body_state` 与会话提醒

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让神经系统在饥饿/饱满达到明显档位时，向对应 DSH 会话投递有频率和次数上限的身体感受；同时提供 `body_act` 与 `body_state` 两个会话工具。

**Architecture:** `organs/human-organs/brain/notify.ts` 是神经系统里的提醒策略：只读 `interoception.hunger/fullness` 和动作里的 `sessionId`，写自己的 `brainNotify` 部位，并在满足显著性、滞回、冷却和配额时调用 `io.notify`。`index.js` 只做 DSH 适配：注册 `body_act` / `body_state`，轮询 Gateway 待确认通知，用 `agent.inject`（context）或 `agent.followup`（wake）投递，成功后 ACK。

**Tech Stack:** Node ≥ 22.18、ESM、可擦除 TypeScript、`node:test`、无第三方依赖；DSH 宿主提供 `ctx.tools`、`ctx.agents` 和 `agent.inject/followup`。

**Spec:** [`2026-11-20-organ-model-design.md`](../specs/2026-11-20-organ-model-design.md) §6、§11；[`2026-11-21-p1-input-interoception.md`](./2026-11-21-p1-input-interoception.md)。

**状态：** 已完成（2026-11-21）。验证：`npm test` 137/137；`body_act` / `body_state`、提醒策略和通知泵的目标测试全部通过。

## Global Constraints

- 一轮 = 60 仿真秒；模块读轮初快照；整轮成功才提交。
- 一个部位一个写者；`brainNotify` 只由 `notify.ts` 写。
- 通知策略是 `policy` / `design`，不是人体测量；阈值、冷却和次数上限不能写成生理常数。
- 通知只发 `context` 或 `wake` 两种模式；默认明显档位用 `context`，强档位才 `wake`（可配置）。
- 每个会话独立计数；同一个会话有最小间隔、每小时上限和每天上限。
- `body_act` 的 action id 由会话 ID + 工具调用 ID 稳定生成；重试复用同一 id。
- 会话 ID 来自 `exec.agent.session.id`；HTTP 直接提交的动作没有会话 ID，不产生提醒。
- Gateway 不新增字段校验层；工具层负责把明显非法的动作挡在入队前。
- 代码改动走 tower mission 或 swarm；纯文档改动直接编辑。

## 非目标

- 不做多身体路由、按会话绑定不同身体、浏览器数据页。
- 不做通知历史文件、已读回执 UI、提醒优先级队列。
- 不做“通知内容由 LLM 生成”；文本是固定策略模板。
- 不做疾病、情绪、疼痛、恶心、腹胀或撑感提醒。
- 不把 `wake` 当成默认行为；它只用于强档位，且受同一套配额限制。

## Review Focus

1. **没有会话 ID 的动作**：HTTP 直连或旧客户端提交的 `eat`/`drink` 不应产生永远无法投递的通知。
2. **通知风暴**：同一档位连续多轮、跨小时/跨天、同一会话多次进食，都不能绕过冷却或配额。
3. **会话隔离**：会话 A 的计数不能被会话 B 消耗；B 也不应收到 A 的提醒。
4. **投递重试**：`agent.inject` 成功但 ACK 失败时不能重复投递；会话暂不在线时通知应保留而不是丢弃。
5. **工具幂等**：同一 `callId` 重试得到同一 action id；不同载荷返回 409，而不是重复入账。

---

### Task 1: `brain/notify.ts` 提醒策略

**Files:**
- Create: `organs/human-organs/brain/notify.ts`
- Create: `organs/human-organs/brain/notify.parameters.json`
- Test: `test/organs.brain-notify.test.mjs`

**Interfaces:**
- Consumes: `io.read('brainNotify')`、`io.read('interoception')`、`io.actions`、`io.simulatedSeconds`、`io.notify({ mode, sessionId, text })`。
- Produces: 部位 `brainNotify`，状态 `{ lastSessionId: string | null, sessions: Record<string, SessionState> }`；`fields` 为 `lastSessionId` / `sessions`，单位 `1`，`absolute`。

**SessionState：**

```ts
type SessionState = {
  lastSentAt: number | null;
  lastLevel: number; // 0 none, 1 mild, 2 marked, 3 strong
  lastKind: 'hunger' | 'fullness' | null;
  hourStartedAt: number;
  hourCount: number;
  dayStartedAt: number;
  dayCount: number;
  lastSeenAt: number;
};
```

**参数（全部 `design` / policy，`source: null`）：**

| 参数 | 值 | 单位 |
| --- | --- | --- |
| `brainNotify.hunger.marked` | 65 | `mm` |
| `brainNotify.hunger.strong` | 85 | `mm` |
| `brainNotify.fullness.marked` | 65 | `mm` |
| `brainNotify.fullness.strong` | 85 | `mm` |
| `brainNotify.resetBelow` | 40 | `mm` |
| `brainNotify.minIntervalMin` | 45 | `min` |
| `brainNotify.maxPerHour` | 2 | `1` |
| `brainNotify.maxPerDay` | 6 | `1` |
| `brainNotify.wakeAtLevel` | 3 | `1` |
| `brainNotify.maxTrackedSessions` | 32 | `1` |

**行为：**

- 从 `io.actions` 里找最后一个 `sessionId` 为非空字符串的动作；没有就用持久化的 `lastSessionId`。
- 读 `interoception.hunger/fullness`；缺失或非有限按 50 / 0。
- 档位：`>= strong` 为 3，`>= marked` 为 2，`>= resetBelow` 为 1，否则 0。
- 选择档位更高的那一路；同档位优先 `fullness`。
- 只有 `level >= 2`、`level > state.lastLevel`、冷却已过、小时/天配额未满时才通知。
- 档位下降时把 `lastLevel` 降下来；档位不变或上升但被冷却/配额挡住时，不更新 `lastLevel`，让它在条件满足后仍可提醒。
- `wakeAtLevel=3` 时强档位用 `mode: 'wake'`，明显档位用 `mode: 'context'`；`wakeAtLevel=4` 时永不唤醒。
- 文本固定四句，以 `身体感受：` 开头，不带数值；例如“身体感受：胃里有些空，饥饿感开始明显。”
- 计数按 `io.simulatedSeconds`：小时 3600 s、天 86400 s；跨边界重置。
- `sessions` 超过 `maxTrackedSessions` 时按 `lastSeenAt` 保留最近 32 个。
- 状态必须 JSON-safe；所有数字有限。

- [x] **Step 1: 写失败的策略测试**

`test/organs.brain-notify.test.mjs` 至少覆盖：

```js
test('no session id means no notification', () => { ... });
test('marked hunger sends one context notification', () => { ... });
test('same level does not repeat', () => { ... });
test('a drop below reset allows a later rise after cooldown', () => { ... });
test('strong fullness uses wake when wakeAtLevel is 3', () => { ... });
test('hour and day quotas are per session', () => { ... });
test('missing interoception falls back to baseline', () => { ... });
test('notify state stays JSON-safe across rounds', () => { ... });
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/organs.brain-notify.test.mjs`
Expected: FAIL，模块不存在。

- [x] **Step 3: 写参数文件与脚本**

按上面的接口、参数表和状态机实现；头部注释写明：阈值/冷却/配额是 `policy`，灵感来自“显著性 + 习惯化/滞回 + 不应期”，不是人体测量；不建模疼痛、恶心、腹胀、撑感。

- [x] **Step 4: 跑测试确认通过**

Run: `node --test test/organs.brain-notify.test.mjs`
Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add organs/human-organs/brain/notify.ts organs/human-organs/brain/notify.parameters.json test/organs.brain-notify.test.mjs
git commit -m "feat: 增加神经系统体感提醒策略"
```

---

### Task 2: `body_act` / `body_state` 工具

**Files:**
- Create: `tools.js`
- Test: `test/dsh.tools.test.mjs`

**Interfaces:**
- Consumes: `gateway.submitAction(payload)`、`gateway.getState()`、`exec.agent.session.id`、`exec.callId`。
- Produces: `createBodyTools(gateway)` → `{ body_act, body_state }`；`registerBodyTools(ctx, gateway)` 注册两个工具；`buildActionPayload(args, { sessionId, callId })` 供测试。

**`body_act`：**

- 参数：`type`（`drink` / `eat`）、`volumeMl`、`energyKcal`、`mealKind`、`durationMin`。
- 校验：`type` 必须是 `drink` / `eat`；`volumeMl` 必填、有限且 `> 0`；`drink.energyKcal` 可选、有限且 `>= 0`；`eat.energyKcal` 必填、有限且 `>= 0`；`eat.mealKind` 必填且为三选一；`durationMin` 可选、有限且 `>= 0`。
- 非法参数返回 `{ ok: false, statusCode: 400, receipt: { error } }`，不入队。
- action id：`body-` + `sha256(`${sessionId}\0${callId}`).slice(0, 32)`；payload 覆盖 `id` 和 `sessionId`，保留动作字段。
- 返回 `{ ok, statusCode, receipt }`；`202` 只表示入队，不表示已生效。

**`body_state`：**

- 参数：可选 `part`。
- 返回 `{ simulatedSeconds, parts }`；有 `part` 时只返回该部位，缺失返回 `null`。
- 不做单位换算，不把状态改写成自然语言。

**工具注册：**

- 用 `ctx.tools.register` 的原始 JSON Schema 形式；`output.schema` 是 JSON Schema，`output.render` 返回 `{ type: 'text', text: JSON.stringify(value, null, 2) }`。
- `registerBodyTools` 用 `ctx.effect(() => ctx.tools.register(definition))` 注册，dispose 时自动注销。

- [x] **Step 1: 写失败的工具测试**

`test/dsh.tools.test.mjs` 至少覆盖：

```js
test('body_act enqueues a valid drink and returns a receipt', async () => { ... });
test('body_act rejects invalid fields before enqueue', async () => { ... });
test('body_act is idempotent for the same session and callId', async () => { ... });
test('body_state returns all parts or one part', async () => { ... });
test('buildActionPayload overrides id and sessionId', () => { ... });
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/dsh.tools.test.mjs`
Expected: FAIL，`tools.js` 不存在。

- [x] **Step 3: 实现 `tools.js`**

按上面的接口实现；用 `node:crypto` 的 `createHash` 生成稳定 id；`body_state` 用 `gateway.getState()`；工具描述写明 `202 queued` 不等于已生效。

- [x] **Step 4: 跑测试确认通过**

Run: `node --test test/dsh.tools.test.mjs`
Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add tools.js test/dsh.tools.test.mjs
git commit -m "feat: 增加 body_act 与 body_state 会话工具"
```

---

### Task 3: 通知投递

**Files:**
- Create: `notifications.js`
- Test: `test/dsh.notifications.test.mjs`

**Interfaces:**
- Consumes: `gateway.getNotifications()`、`gateway.ackNotification(id)`、`agentFor(sessionId)` 返回 `{ inject(message), followup(message) } | undefined`。
- Produces: `createNotificationPump({ gateway, agentFor, makeId, logger })` → `{ run() }`；`buildBodyMessage(notification, makeId)`。

**行为：**

- `mode: 'wake'` 用 `agent.followup(message)`；`mode: 'context'` 用 `agent.inject(message)`。
- 消息形状：`{ id, role: 'user', content: [{ type: 'text', text: notification.text }], source: { kind: 'user' } }`。
- 投递成功后 ACK；ACK 失败时把 id 记入 `delivered`，下次只重试 ACK，不重复投递。
- 会话暂不在线（`agentFor` 返回 `undefined`）时不 ACK，保留通知等待会话恢复。
- 投递抛错时不 ACK，下次重试；记录错误但不中断其他通知。
- 通知队列的顺序就是 Gateway 的提交顺序；每次 `run()` 处理当前队列。

- [x] **Step 1: 写失败的投递测试**

`test/dsh.notifications.test.mjs` 至少覆盖：

```js
test('context notifications are injected into the matching session', () => { ... });
test('wake notifications use followup', () => { ... });
test('an offline session keeps its notification pending', () => { ... });
test('ack failure does not duplicate delivery', () => { ... });
test('message shape is a valid user message', () => { ... });
```

- [x] **Step 2: 跑测试确认失败**

Run: `node --test test/dsh.notifications.test.mjs`
Expected: FAIL，`notifications.js` 不存在。

- [x] **Step 3: 实现 `notifications.js`**

按上面的接口实现；`makeId` 默认 `randomUUID`；`logger.error` 可缺省；不要启动定时器，定时器由 `index.js` 管。

- [x] **Step 4: 跑测试确认通过**

Run: `node --test test/dsh.notifications.test.mjs`
Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add notifications.js test/dsh.notifications.test.mjs
git commit -m "feat: 增加 DSH 通知投递泵"
```

---

### Task 4: 接线

**Files:**
- Modify: `index.js`
- Modify: `body-modules.json`
- Modify: `package.json`
- Modify: `test/parameters.test.mjs`
- Modify: `test/organs.gateway.test.mjs`

**行为：**

- `index.js` 的 `inject` 增加 `tools`、`agents`；启动 Gateway 后注册工具；每 1000 ms 调一次 `pump.run()`；`ctx.effect` 清理定时器。
- `body-modules.json` 追加 `./organs/human-organs/brain/notify.ts`。
- `package.json` 的 `files` 增加 `tools.js`、`notifications.js`。
- `test/parameters.test.mjs` 增加 `brain/notify.parameters.json`。
- `test/organs.gateway.test.mjs` 改成六条脚本、六个部位，断言 `brainNotify` 初始状态可读；`/capabilities` 仍只有 `drink`/`eat`。

- [x] **Step 1: 改 `index.js`**

```js
export const inject = ['profileContext', 'tools', 'agents'];
```

启动后：

```js
registerBodyTools(ctx, gateway);
const agents = ctx.get('agents');
const pump = createNotificationPump({ gateway, agentFor: (id) => agents.get(id) });
const timer = setInterval(() => { try { pump.run(); } catch (error) { console.error(...); } }, 1000);
timer.unref?.();
ctx.effect(() => () => clearInterval(timer));
await gateway.ready;
pump.run();
```

- [x] **Step 2: 改清单、打包和测试**

按 File 列表修改；`test/organs.gateway.test.mjs` 的测试名与断言改为六条。

- [x] **Step 3: 跑目标测试**

Run: `node --test test/parameters.test.mjs test/organs.gateway.test.mjs test/dsh.tools.test.mjs test/dsh.notifications.test.mjs`
Expected: PASS。

- [x] **Step 4: 提交**

```bash
git add index.js body-modules.json package.json test/parameters.test.mjs test/organs.gateway.test.mjs
git commit -m "feat: 接线通知投递与身体会话工具"
```

---

### Task 5: 文档与验收

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/virtual-body.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/superpowers/specs/2026-11-20-organ-model-design.md`
- Modify: `organs/human-organs/brain/README.md`
- Modify: `systems/nervous/README.md`
- Modify: `docs/superpowers/plans/2026-11-21-p1b-notifications-tools.md`

**Steps:**

- [x] 大脑 README：新增 `notify.ts` 脚本表、策略表、频率/次数、会话绑定、`context`/`wake` 区别、未建模项。
- [x] `docs/virtual-body.md`：把 `body_act` / `body_state` / 通知投递从“设计”改成“当前实现”；写清 `context` / `wake`、ACK、离线会话保留、频率/次数。
- [x] `docs/gateway-and-scripts.md`：增加 DSH 工具注册与通知泵一节；写清 202 不等于已生效、通知只投给对应会话。
- [x] `AGENTS.md`：更新已实现/未实现、六条脚本、`body_act`/`body_state` 已可用、通知历史文件仍未实现。
- [x] 设计文档 P1 进度表：把通知投递与会话工具改成已实现；保留多身体/浏览器为未实现。
- [x] `systems/nervous/README.md`：指向 `brain/notify.ts` 与 `brain/README.md`。
- [x] 扫描 `git grep -n "body_act\|body_state\|通知"`，修掉“未实现”的旧文案。
- [x] 跑 `npm test` 全绿；用真实 Gateway 跑一次 `body_act` + `body_state`，检查 `brainNotify` 部位；用 fake agent 验证投递（已有测试）。
- [x] 更新本计划状态为已完成，勾选全部步骤。

## 交付检查

- [x] `npm test` 全绿。
- [x] `body_act` 能提交含能饮料并返回 202 回执；`body_state` 能读到六个部位。
- [x] `brainNotify` 在明显档位只提醒一次，冷却、每小时/每天上限和会话隔离都有测试。
- [x] 通知泵对 `context` 用 `inject`、对 `wake` 用 `followup`；离线会话不丢通知；ACK 失败不重复投递。
- [x] 根清单六条脚本；`package.json` 的 `files` 含 `tools.js`、`notifications.js`。
- [x] 文档明确：阈值/冷却/次数是 policy，不是人体测量；通知不是医疗建议。
