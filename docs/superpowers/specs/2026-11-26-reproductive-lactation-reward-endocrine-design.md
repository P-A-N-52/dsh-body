# 2026-11-26 生殖、泌乳排乳、中枢奖励、内分泌实证动力学与体感反馈设计规格

> **状态：** 主体已实现并合入当前工作区；此前排在收口后的 4 项工程与物理统一工作（`logs/` 状态变更与通知滚动历史、`agent/inbox/inserted` 收件箱回执、`blood.ts` / `duodenum` 跨器官读参解耦、以及 `parathyroid.pthPgMl` 纯物理统一与血钙主动通知/唤醒扩展）现均已落地并经离线与 Gateway 集成测试验证（新的真实 DSH 会话实机联调与临床验证仍未进行）。

## 1. 背景与当前实现边界

- **工作区基线**：在已包含 `2026-11-25` 脑部休眠绑定、动作定量翻译官与昼夜/睡眠/自主神经改造的当前工作区之上实施（不回滚已有未提交改动）。
- **本规格之前的当前实现与主要缺陷**：
  1. **内分泌与节律**：11 个内分泌模块全为无量纲相对量 `1` 且半衰期全部为 `design` 占位（10/15/30/60 min），与人体实测时间尺度脱节（例如甲状腺日尺度、`pancreasEndocrine` 胰岛素饱和清除、皮质醇 `49 min` / ACTH `20 min` / TSH `53.9 min`）；`pineal` 加载了 `responseHalfTimeMin` 却未平滑；`testes` 仅用单瞬时 `sleepPressureMm > 60` 代理多日睡眠债；`ovaries` 采用写死分段折线且无任何下丘脑-垂体或高泌乳素抑制耦合。
  2. **泌乳与排乳**：`mammaryGlands` 默认 `lactating: false` 且运行时无法开启，无储奶池、无排乳反射与动作、无局部充盈度自抑制（FIL），且 `pituitary` 误将水入账 `milkMl > 0` 当作吸吮代理引起自激循环。
  3. **子宫、两性性反应与性后余韵**：`uterus` 经期失液用 `50 mL` 纯水占位，内膜用 `0.7*E2 + 0.3*P4` 占位，且与性高潮/催产素完全解耦；`sexualResponse` 男女共用硬编码 `20 min` 不应期；女性 `interoception.libidoMm` 恒等于 `0`；`autonomic.ts` 仅检查 `action.type === 'orgasm'` 导致无效高潮空爆、漏算 `>=95` 强制高潮；`tools.js` 将 `resolution` 消退期混入 `excitement`。
  4. **中枢奖励**：全仓此前无中枢奖赏/享乐饱足/余韵缓冲模块。
  5. **进食味道与文字反馈盲区**：`action-translator.js` 仅输出 7 个定量字段，`body_act` 无味道反馈；`interoception.sensations` 丢失 `urgent` / `nsfw` 属性且缺 `nsfw` 过滤；经期出血、排卵、泌乳/排乳、射精、非缺氧高通气喘息、主动排尿/排便轻松感与副交感余韵等人类可感知体验缺少零数字反馈，局部查询别名亦有多处错位。

## 2. 本次设计目标与实现口径

### 2.1 内分泌实证动力学与物理浓度字段升级
- **采用绝对浓度字段的模块**（其余局部/缺乏统一人体基准的轴保留相对量 `1`）：
  - `pituitary`：`acthPgMl` (`pg/mL`, 基线 `12`, `t½ = 20 min` [`SRC-KEENAN-2004`])、`prolactinNgMl` (`ng/mL`, 清醒基线 `8`, 昼夜谐波 `2.1 ng/mL` [`SRC-VELDHUIS-1988`], 睡期+吸吮刺激时长+高潮脉冲, `t½ = 34.6 min`)、`oxytocinPgMl` (`pg/mL`, 基线 `2`, 吸吮 `14` [`SRC-UVNASMOBERG-2020`], 性唤起/高潮 `22` [`SRC-BLAICHER-1999`], `t½ = 3.8 min` [`SRC-FABIAN-1969`])、`tshRelative` (`1`, `t½ = 53.9 min` [`SRC-ODELL-1967`])。
  - `adrenal`：`cortisolNmolL` (`nmol/L`, 基线 `180`, ACTH→皮质醇 Hill Sigmoid 驱动 `EC50 = 26 pg/mL` / 最大分泌 `10 nmol/(L·min)` / 总消除半衰期 `49 min` [`SRC-KEENAN-2004`])。
  - `pancreasEndocrine`：`insulinPmolL` (`pmol/L`, 基线 `60`, Michaelis–Menten 饱和清除 ODE) 与 `glucagonRelative` (`1`, 低血糖反调节阈值 `68 mg/dL`)。
  - `ovaries`：`estradiolPmolL` (`pmol/L`)、`progesteroneNmolL` (`nmol/L`)、`lhIuL` (`IU/L`)、`fshIuL` (`IU/L`) 采用 `SRC-STRICKER-2006` 完整 `-15..+14` 排卵对齐逐日中位轨迹插值，并新增 `cycleSuppression` 与 `highProlactinDays`（高 PRL 连续满 7 天才启动慢性抑制，哺乳走已建立泌乳路径；不响应急性/7 天短期高 PRL [`SRC-PAGEWILSON-2007`, `SRC-HOSKOVA-2022`]）。
- **保留相对量但校准动力学**：`thyroid.thyroxineHalfTimeMin = 1440 min` (`SRC-NICOLOFF-1972` `prior`)；`pineal` 在有无 `sleep` 时均启用 `39.4 min` 一阶平滑；`hypothalamusEndocrine` 以 `carElapsedMin` 记录醒后 CAR 计时，采用 `10 min` 潜伏平滑、10–30 min 平台与 45 min 结束窗口，并接受 `reward.hedonicMm` / `oxytocinPgMl` 对 `stressDrive` 的温和缓冲；`testes` 新增 `sleepDebtDays` 多日睡眠债累积恢复状态变量并受高 PRL 轻度抑制。
- **旧档策略（用户已确认）**：消费端按静态参考分母归一化；本次不新增旧 `*Relative` 到新绝对浓度的专门迁移或双字段优先逻辑。旧档中的这些激素偏差不保证保留，按新模型默认值或轨迹重新起步。

### 2.2 大脑中枢奖励模块（`brain/reward.ts`，三清单挂载）
- 导出 `id = 'reward'`、`wantingMm` / `hedonicMm` / `satietyMm`（`0–100 mm`，全参数 `status: 'design'`）。
- 耦合性动机（`SRC-OEI-2012`）、性高潮后催产素/PRL 满足与余韵（`SRC-BLAICHER-1999`, `SRC-KRUGER-2003`）、十二指肠营养暴露餐后饱足、中等强度运动（`intensity ∈ [0.4, 0.88]`）愉悦弛豫，以及高皮质醇/疼痛不适抑制。高潮奖励按本轮最终睡醒转态决定：高潮唤醒当轮可发放，高潮后若最终仍入睡则不发放。

### 2.3 泌乳与排乳双环路及 `profile.lactating` 预设
- `mammaryGlands` 新增 `express_milk` 与 `breastfeed` 两个受 `nsfw` 门控与主动唤醒豁免检查的动作（支持自然语言翻译官提取 `durationMin` 与 `bilateral`）。
- 区分**慢性诱导进程 `inductionProgress`**：纯高 PRL（`>= 45 ng/mL`）数天内可触发 `galactorrhea`（微量溢乳，`inductionProgress` 封顶 `0.35` [`SRC-PAGEWILSON-2007`]）；高 PRL 叠加连续多日排乳刺激方可跨越 `1.0` 进入规整 `lactating`；同时支持 `checkpoint.profile.lactating = true` 在新身体/稳态测试中直接以稳态哺乳期起步（通过 `lib/parameters.js` `getProfileLactating()` 读取，保持 `getBodyProfile()` 返回结构不变）。
- 储奶池 `storedMilkMl`（双侧 `360 mL` [`SRC-KENT-2006`]）实现充盈度 `DF` 局部自抑制；`ejectedMilkMl` 在 `pituitary.oxytocinPgMl >= 5` 时按 `PAMR`（亲喂 `0.673`、双侧泵乳 `0.75` [`SRC-KENT-2006`, `SRC-PRIME-2012`]）与过度蓄奶惩罚从 `storedMilkMl` 排出；每个排乳动作先持久化到 `pendingEjections`，达到催产素阈值后按提交顺序各套用一次会话 PAMR；跨轮与重启保留待排乳会话，后续刺激延续不重复排空。**体液/血糖只在水和乳糖合成入乳腺时单次扣账，排乳绝不重复扣体液**。

### 2.4 子宫行为、两性性反应差异与性后余韵
- `uterus` 经期失液调整为 `flowMlPerCycle = 30 mL`（锚定 `SRC-HALLBERG-1966` 中位数 `30.0 mL` 的水账代理，明确注明经液非纯水），内膜按 E2 卵泡增厚 + `lutealEndometriumPlateau = 0.9` 黄体平台（`SRC-BAKOS-1994`），并新增 `contractionMm`（高潮/哺乳催产素驱动）与 `pelvicCongestionMm`。
- `sexualResponse` 新增 `afterglowMm` 与 `evaluateSexualRelease` 共享纯判定函数，女性（加载 `ovaries` 且无 `testes`）取消固定 20 min 绝对不应期（仅保留 2 min 防连跳窗口）且受卵巢 E2/P4 调制（`SRC-RONEY-2013`），男性保留不应期并随高 PRL 延长；`autonomic.ts` 与 `reward.ts` 复用 `evaluateSexualRelease`，并在余韵期间由副交感反弹反映身体松弛平复。

### 2.5 进食味道纯文本反馈与可感知文字反馈全补齐
- `action-translator.js` 顶层增加可选无数字 `tasteFeedback` 字段，仅在 `eat`/`drink` 时由同一轮 `ctx.llm.stream()` 生成口腔味道/冷热/质感短句并返回给 `body_act`（带幂等缓存与零数字拦截），**不改器官状态、不作消化生理联动**。
- 修复 `interoception.ts` `sensations` 丢失 `urgent`/`nsfw` 与门控漏洞、补 `mammaryFullnessMm` 与 `hedonicCalmMm`、重构男/女/中性 `libidoMm`；修复 `tools.js` `FOCUS_AREA_ALIASES`、`thirst = 50` 误报、性 `resolution` 文案与 `notify.ts` 高潮边沿漏报；由 `body_state` 补齐射精、经期出血、排卵、泌乳排乳、高通气喘息、主动排尿/排便轻松感及中枢余韵等零数字文字反馈，不为这些体验另建一套主动通知事件队列。

## 3. 未建模边界（仍显式排除）
- 妊娠 / 分娩 / 产后复旧、乳汁脂肪/蛋白/钙精确分解、纯化分子 FIL IC50（`unreported` in humans）、独立情绪系统（喜怒哀乐）、环境温度联动、血液成分代替纯水转移、味觉生理反馈（唾液/饱食联动）。
