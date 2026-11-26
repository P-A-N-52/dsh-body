# `ctx.llm` 动作定量翻译官与单身体近期参考档案设计

日期：2026-11-25  
状态：已实现（以当前代码、单元测试、Gateway 集成测试，以及隔离真实 DSH `0.2.1-rc.2` 容器配合本地 SSE mock LLM 的端到端冒烟验证为准；接通真实远程在线模型后的自然语言估算准确率与延迟分布尚待实机对照验证）

> 本文区分 **当前实现** 与 **尚未验证 / 后续计划**；默认份量锚点与相似度参数均为 `design` 工程约定，不称 `validated`。

---

## 一、设计目标与边界

将主对话 Agent 从“边体验主观感受、边自己心算千卡/毫升/运动强度”的心智负担中彻底解耦，让主模型只需用自然语言描述行为，由后台轻量 LLM 翻译官转换为 Gateway 可执行的定量结构化动作：

1. **主入口自然语言化（[tools.js](../../../tools.js) & [index.js](../../../index.js)）**：
   - `body_act` 新增 `description`（自然语言描述）作为 `eat`、`drink`、`exercise`、`sex` 的主入口；[BODY_COGNITION_PROMPT](../../../index.js) 引导主 Agent 只传入如实行为描述（如 `"吃了一口白米饭"`、`"慢跑了二十分钟"`），避免主动猜数。
   - 同时保留既有 `volumeMl` / `energyKcal` / `carbohydrateG` / `mealKind` / `durationMin` / `intensity` 为**可选显式覆盖/直通字段**：已有精确数值的测试或直传调用（以及 `POST /actions`、[scenarios/](../../../scenarios)）完全免翻译直通。
   - `urinate`、`defecate`、`stop_exercise`、`sleep`、`wake_up`、`orgasm` 等零载荷动作及扩展动作完全跳过 LLM。
2. **后台轻量翻译引擎（方案 B：`ctx.llm.stream()` + 单工具 `ToolSchema`）**：
   - 在 [action-translator.js](../../../action-translator.js) 中以零第三方依赖方式调用 `ctx.llm.stream()`：
     - 使用独立极简系统提示词与**唯一工具** `submit_translated_actions`；
     - **不传 `sessionId`**：不新建 `Session`/`Agent`、不写 `.sessions/` 磁盘文件、不触发 Web UI `host/session-added`/`removed` 事件、不污染主会话 `tokenMeter`；
     - 自动从 `config` → `exec.agent.session.requestHeader().config` → `exec.agent.options` → `agentDefaultModel.currentSelection()` 解析当前模型路线，并在 `resolveModelInfo` 显式支持 `'off'` 时启用 `reasoningEffort: 'off'`；
     - 校验失败或未正确调用工具时自动带精确报错信息重问 1 次（`maxAttempts = 2`）。
3. **单身体、有上限、与大存档解耦的近期参考档案**：
   - 每具身体将近期翻译记录保存在 `<bodyDir>/logs/action-translations.json`（由 `dirname(gateway.getStatePath())` 推导，**严禁写入已经较大的 `body-state.json`**）。
   - **严格按身体隔离（仅限当前身体）**：随身体存档跨会话延续，不同身体目录互不混用。
   - **明确容量上限**：按需要定量的动作类型（`eat`、`drink`、`exercise`、`sex`）各保留最近 **100 条**（`maxEntriesPerType = 100`，FIFO 滚动淘汰最旧条目），原子临时文件重命名写盘。
   - **同类型相似匹配 + 连续参考**：收到新描述时，在当前 `type` 的最近 100 条里用零依赖中英文 Unigram+Bigram Dice 相似度挑选 Top-4 相似记录（阈值 `>= 0.15`），再补最近 2 条未重复的同类型连续记录（承接 `"又吃了一口"`、`"把剩下的喝完"`），注入翻译官上下文保持前后份量一致。
4. **安全门控与失败不胡编原则**：
   - **休眠/暂停早停**：提交到翻译 LLM 前先检查身体是否 `dormant` 或 `active === false`，直接返回 `409`，不白花 token。
   - **NSFW 硬门控**：`nsfw: false` 时工具枚举与校验阶段即拒绝 `sex`；翻译工具 `type.enum` 同步剔除 `sex` 并在二次清洗中拦截模型误吐出的 NSFW 动作。
   - **重试幂等缓存**：同会话同一 `callId`（相同 `type + description + explicitConstraints`）重试时直接复用上次已提交载荷进入 Gateway 幂等路径（`200`），避免重复花 token；同 `callId` 改换描述返回 `409`。
   - **绝不编造兜底数值**：当 `ctx.llm` 缺失、无可用模型路线、超时（默认 `20 s` → `504`）、被中止（`499`）或 2 次校验仍失败（`502`）时，直接向主 Agent 返回错误且不向 Gateway 入队任何猜测数值。
   - **支持合理拆单**：明显同时包含正餐与随餐饮品的自然描述（如 `"吃了半碗牛肉面，喝了两口冰可乐"`）可由翻译官拆分为最多 4 条有序原子动作（使用 `callId`、`callId#1`… 幂等键依次入队），工具返回值仅返回干净回执，不额外泄漏定量估算值。

---

## 二、仍暂缓 / 未验证项

- **仍暂缓**：通用身体状态变化与通知滚动日志（`logs/` 中的生理轨迹与通知阅读回执，此前同样要求只记变化/通知并设上限）。
- **尚未实机验证**：接通真实远程 DeepSeek API 的在线自然语言饮食/运动翻译准确率与延迟分布；现有验证覆盖 `npm test`（`1027/1027` 含 6 条翻译官专测）与隔离真实 DSH `0.2.1-rc.2`（`dsh headless` + 本地 SSE mock LLM）对 `body_bind` → 两次连续 `body_act`（带历史参考回传）与 `<dshHome>/dsh-body/logs/action-translations.json` 落盘的端到端测试。
