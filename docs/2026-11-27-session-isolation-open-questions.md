# 会话与身体隔离：当前基线与待思考问题记录

日期：2026-11-27  
对应提交：`c96ac2e`（`main`，已修复跨会话隔离 Bug 并通过本地 `npm test` 1096/1096）

> 本文严格区分 **当前实现**、**已确认边界** 与 **待思考问题 / 后续方向**；文中列出的待思考方案仅作决策记录，不代表已批准实现。

---

## 一、当前实现（`c96ac2e` 已落地）

1. **默认不绑定、不主动绑定、禁止抢占**
   - `multibody.js`：启用 `bodies.json` 时，未命中 `sessions` 映射且未绑定任何身体的会话返回 `null`（不再落入 `defaultId`）；`bodies.json` 格式或内容非法时直接抛错拒绝启动，不再静默合并回单身体 `main`；移除可变 `stickySessionId` 全局兜底。
   - `index.js` / `tools.js`：`dsh-body:cognition` 改为静态无 NSFW 中立文本，明确要求默认不绑定、不要主动调用 `body_bind`（仅在用户明确要求时操作）；工具休眠提示与 `409` 回执同步移除主动诱导绑定文案；`NSFW` 提示随 `dsh-body:feelings` 按 `requestSessionId === boundSessionId` 隔离注入。
   - `tools.js` / `gateway/simulation.js` / `gateway/actions.js` / `gateway/http.js`：一旦身体绑定了 `boundSessionId`，其他会话的 `body_state`、`body_act`、`body_bind`（`bind` / `unbind` / `status`）以及不匹配 `sessionId` 的 `/bind`、`/unbind`、`/actions` 均被拒绝，且不泄漏占用方的 `boundSessionId`、`nsfw`、睡眠/暂停状态或 `feeling`；禁用入参 `args.sessionId` 冒充其他会话。
2. **通知归属、队列与存档克隆修复**
   - `organs/human-organs/brain/notify.ts`：`latestSessionId` 改为优先使用权威 `io.boundSessionId`，仅当其为空时才回退动作 `sessionId` 或 `prev.lastSessionId`。
   - `gateway/simulation.js` / `notifications.js` / `index.js`：`unbind()` 时清理该解绑会话尚未投递的 `notifications`；通知泵投递前校验身体非休眠且 `notification.sessionId === gateway.getBoundSessionId()`；`agent/disposed` 传入 `disposedSessionId` 做期望匹配解绑。
   - `gateway.js` / `gateway/checkpoint.js` / `index.js`：DSH 插件启动传入 `legacyStatePath: null`，避免新建身体误克隆清单同目录的 `body-state.json`；启动时自动解绑与 `bodies.json` 显式规则冲突或跨身体重复占用的 `boundSessionId`。

---

## 二、已确认保持的设计边界

1. **静态显式配置**：保持无 `bodies.json` 时单身体单会话独占；有 `bodies.json` 时仅 `sessions` 显式映射的会话可连入对应身体，不自动为未映射会话或通配符派生新身体。
2. **换绑继承身体连续性**：同一具身体解绑后由另一会话显式绑定时，继承该身体的生理快照与 `<bodyDir>/logs/action-translations.json` 翻译参考历史；`brainNotify` 按 `sessionId` 各自记录提醒水位与退避步数。
3. **保留显式 `body_bind` 与停机手改存档**：允许用户在对话中明确要求绑定时通过 `body_bind` 操作，也允许停机时直接手动修改 `body-state.json` 顶层的 `boundSessionId`、`active`、`nsfw`、`profile` 与 `parameters`。

---

## 三、保留待思考的 5 个问题

### 问题 1：未来多会话绑定的架构形态（尚未实现）
- **背景**：当前每具身体严格单会话绑定（`boundSessionId: string | null`），`docs/gateway-and-scripts.md` 与 `organs/human-organs/brain/README.md` 均注明“目前仍无多会话并发绑定”。
- **需要想清楚的问题**：
  1. 未来“多会话绑定”是指**一具身体同时面向多个会话**（例如主人私聊 + 指定群聊共用同一具身体状态），还是**多个会话各自对应独立身体**？
  2. 若是一具身体同时绑定多个会话（`boundSessionIds: string[]`）：
     - **通知投递归属**：体感变化时，是发给“所有已绑定会话”、只发给“指定主会话”、还是发给“最近交互会话”？如果群聊和私聊同时收到 `wake` 唤醒，会不会出现两边同时吃喝导致双份摄入、或互相抢答？
     - **睡眠防梦游耦合**：某个已绑定会话说话/调用工具触发 `wake_up` 时，是同步唤醒整个身体影响所有绑定会话，还是不同会话有主次权限？
     - **翻译历史与隐私边界**：私聊里的饮食/性行为描述写入 `action-translations.json` 后，群聊会话调用 `body_act` 翻译时是否允许引用这些参考？
     - **工具与 HTTP 契约**：`body_bind({ action: 'unbind' })` 与 `agent/disposed` 需改为只解绑当前会话自身，仅当绑定集合清空时才进入 `dormant` 休眠。

### 问题 2：混合 `nsfw` 与异构清单多身体下的全局工具 Schema 暴露取舍
- **当前限制**：DSH 宿主通过 `ctx.tools.register` 注册全局统一工具定义，调用 `body_act.parameters.properties.type.enum` 与 `body_act.description` 时不传 `sessionId`。
- **当前行为**：`multibody.js` 在无 `sessionId` 时对所有身体取 `nsfw` 逻辑或（`entries.some(...)`）与 `capabilities` 并集，保证开启 `nsfw: true` 或搭载扩展器官的身体能通过宿主 Schema 预校验；执行期再用当前会话对应身体的 `isNsfwEnabled(target)` 与 `getCapabilities()` 严格拦截。
- **待思考**：
  - 如果后续长期同时运行 `nsfw: true`（如私聊身体）与 `nsfw: false`（如群聊身体），或者部分身体带额外器官（如翅膀）而另一部分不带，是否需要：
    - **方案 A**：保持当前“Schema 并集 + 执行期严拦 + `systemPrompt` 严格隔离”（最简单，但 `nsfw: false` 会话仍能在工具 JSON Schema 的 `enum` 里看到 `sex` 等词）；
    - **方案 B**：只要存在任意身体未开启 `nsfw`，就从全局 `body_act` Schema 隐藏 NSFW 枚举（需确认 `nsfw: true` 身体的宿主调用会不会被宿主 Schema 预校验直接拦截）；
    - **方案 C**：排查目标 DSH 宿主版本是否支持按会话/按 Agent 过滤或注册工具 Schema，从宿主侧彻底隔离工具定义。

### 问题 3：新增可扩展身体部件的动作级 `nsfw` 声明能力
- **现状**：
  - 扩展部件在 `sensations[key]` 里已经支持 `nsfw: true` 字段，`interoception`、`brainNotify` 和 `body_state` 会自动受 `nsfw` 开关门控。
  - 但动作层面，`NSFW_ACTION_TYPES` / `NSFW_ACTIONS` 目前是硬编码的 4 个字符串（`sex`、`orgasm`、`express_milk`、`breastfeed`，位于 `action-translator.js`、`gateway/actions.js`）。
- **待思考**：如果后续新建的身体部件本身带有需要受 `nsfw` 门控的新动作（而不是归入上述 4 个名字），是否需要让器官模块直接声明诸如 `export const nsfwActionTypes = [...]` 或动作元数据，使 `gateway/actions.js`、`action-translator.js` 与 `tools.js` 自动按该身体 `nsfw` 开关门控，而不必每次修改核心白名单？

### 问题 4：DSH 宿主内接入外部新工具时的交互边界
- **现状**：
  1. **防梦游钩子**：`index.js` 的 `tools/pre-execute` 只对 `SLEEP_EXEMPT_TOOL_NAMES`（`body_state`、`body_bind`）和 `body_act(sleep/wake_up)` 豁免，已绑定且睡眠中的会话调用任何其他新工具都会触发 `wake_up` 唤醒身体。
  2. **队列写权限**：Gateway `actions.js` 要求 `boundSessionId` 非空时，动作必须携带匹配的 `sessionId`（否则返回 `403`）。
- **待思考**：
  - 后续如果新增**纯信息查看类工具**（或者在身体睡眠时也应该允许在后台安静运行的辅助工具，例如查天气/读记忆/定时工具），是否需要配置化的豁免列表（而非硬编码在 `SLEEP_EXEMPT_TOOL_NAMES`），避免每次调用都误唤醒睡眠中的身体？
  - 外部新工具若需要驱动生理行为，统一约束为“走 `body_act` 扩展 `actionTypes`”还是允许直接 HTTP `POST /actions`（并规范 `sessionId` 传递与 `id` 幂等键）？

### 问题 5：真实 DSH 宿主机运行态核验（尚未实机验证）
以下项目本次排查中未读取宿主机运行环境目录，后续切回实机联调时建议顺手核对：
1. `~/.dsh/dsh-body/bodies.json` 是否存在、`sessions` 规则是否已覆盖目标会话（以及是否仍存在让子代理或未映射会话意外接入的需求）；
2. 清单所在目录及 `$DSH_HOME/dsh-body/` 下是否存在残留的旧 `body-state.json` 或多余绑定；
3. 目标 DSH 宿主版本（如 `0.2.3-alpha.2`）在 `systemPrompt.section`、`tools.register` 与各类通道插件（QQ/Web/子代理）中传入 `exec` / `ctxArg` 的实际会话 ID 字段与子代理继承策略（例如子代理是否会继承父会话的 `sessionId`——如果宿主侧子代理直接复用了父会话 ID，则插件层无法仅靠 `sessionId` 区分主会话与子代理）。
