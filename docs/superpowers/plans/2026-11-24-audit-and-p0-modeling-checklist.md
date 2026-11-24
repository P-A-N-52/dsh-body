# 项目审阅与 P0 生理建模修复清单

> **起始基线**：`HEAD` `70ec7f2`（修复前 `npm test`：`942/942` 通过）
> **最新实测（P0 + P1 + P2 完成后）**：Node `v24.19.0`，`npm test` **`987/987` 全部通过**（83 个测试文件、耗时 `~13.1 s`，含新增三清单 24h 稳态回归 `test/organs.steady-state-24h.test.mjs`、DSH 插件入口测试 `test/dsh.index.test.mjs`、`tools/replay.mjs --manifest` 测试与全清单一致性校验）；`git diff --check` 无告警。
> **口径说明**：本清单严格区分**当前实现 / 已验证 / 待修复 / 仍是计划**。本轮 P0 修正的生理参数均基于人体生理学规律与仓内文献笔记（`SRC-PERONNET-2012`、`SRC-MUDIE-2014`、`SRC-DALLAMAN-2007`），仍标为 `design`（`notify.parameters.json` 14 项提醒策略已按规范标为 `policy`），未做独立盲测前不宣称 `validated`。

---

## 一、现状与验证基线

- **已实现（含本轮 P0/P1/P2 改动，尚未提交）**：Gateway 运行时、回环 HTTP API、v1→v2 原子存档、`active` 开关、`write → add → transfer` 结算、`body_act`（7 动作）/`body_state`/带重入互斥保护的 4 路通知泵；中性 38 模块（34 份唯一参数、15 部位传输闭包）、男性 40 模块（36 份参数）、女性 41 模块（37 份参数、17 部位闭包）；另含 7 个未挂载入口（含 `parathyroid`/`bloodCalcium`）。`tools/replay.mjs` 已同时支持 5 模块旧模式与 `--manifest` 完整清单重放；31 份器官 README 已全部补齐并同步。
- **已验证**：`npm test`（**987/987** 全部通过），其中 [organs.steady-state-24h.test.mjs](file:///home/pan/桌面/dsh-body/test/organs.steady-state-24h.test.mjs) 已实测中性/男性/女性三份完整清单 24 小时（1440 轮）静息稳态与喝水/高强运动/男性性行为场景：
  - **24h 静息稳态（三清单一致）**：核心体温 `36.999998–37.000000 °C`；首轮静息血压 `120 / 80 mmHg`、`mouthMoistureMm = 100`、`dryMouthMm = 0`；空腹血糖 1h/6h/12h 稳在 `90.0 mg/dL`（肝糖原 `80 → 45.44 → 10.88 g`），约 13.9h 耗尽肝糖原后由肾糖异生平滑接管，24h 稳在 `74.0 mg/dL`（零阶跃锯齿过冲）；默认女性全程 `lactating = false`、`milkMl = 0`、`prolactinRelative = 1.0`。
  - **240 mL 饮水 2h**：`225.27 mL`（93.9%）进入体液及下游水账，小肠余 `8.70 mL`，结肠残渣仅 `5.61 mL`（累计入结肠 `11.54 mL`）。
  - **30 min 满强运动 + 60 min 恢复**：心率 `175 /min`、通气 `30.0 L/min`、`SpO2 = 97%`；核心体温峰值 `38.27 °C`、峰值出汗 `6.79 mL/min`（累计 `245.98 mL`），90 min 降至 `37.05 °C`；三分区肌糖原共耗 `15.00 g`（头 `0.75` / 躯干 `6.75` / 四肢 `7.50 g`）；血糖峰值 `90.75 mg/dL`。
  - **男性 08:00 持续性活动 30 min**：最高唤起 `95.34 mm`（`<= 100`），仅触发 `1` 次高潮并进入 20 min 不应期，零连发高潮。
- **尚未验证**：当前改动未在真实 DSH 宿主实机联调；未验证装入 `node_modules` 的加载（已于 `README.md` 注明 Node 类型擦除仅支持本地源码路径）；仓内 24 条登记文献均为 `results_seen`（0 盲测验证集）。
- **仍是计划（非本轮修复范围）**：多会话绑定与静默冻结、LLM 食物估算流水线、M5 浏览器观测页、身体预设与 5 级免疫、M6/M7 慢/急性状态、睡眠行为、脂肪/脂质代谢、`logs/` 滚动日志、通知阅读回执。

---

## 二、P0 — 生理数学建模修复清单（已完成并实测通过）

### 分片 A：体温调节、静息耗氧、皮肤热出汗与肺通气

- [x] **A1. 修正 `bloodOxygen` 静息甲状腺缩放基线偏移**
  - **已改**：`organs/human-compartments/blood-oxygen/oxygen.ts` 将 `0.8 + 0.4 * T4` 改为 `Math.max(0.2, 0.6 + 0.4 * T4)`（`T4=1 → 1.0× = 250 mL/min`，`T4=0 → 150`，`T4=2 → 350`）。
- [x] **A2. 修复 `thermoregulation` 静息高热失控与蒸发项 `dt` 量纲错误**
  - **已改**：`thermoregulation.parameters.json` 将 `metabolicFactor` 改为 `0.005 kcal/mL`、`lossGain` 改为 `0.104167 kcal/(min·°C)`；`thermoregulation.ts` 将蒸发项修正为 `evaporationKcalPerMl * (sweatVolumeMl / dtMin)`，并将 `coreTemperatureC` 钳位在 `[25, 45] °C`。
- [x] **A3. 修复 `skin` 静息高热不出汗与 `maxRateMlPerMin` 钳位绕过**
  - **已改**：`sweat.parameters.json` 将 `maxRateMlPerMin` 提至 `15 mL/min`、`heatGain` 改为加性热出汗增益 `5 mL/(min·°C)`；`sweat.ts` 改为 `min(maxRate, max(0, exerciseRate + thermalRate))`，静息 37.0 °C 仍为 0 出汗，高热与运动均受总上限钳位。
- [x] **A4. 修正 `lungsVentilation` `pantingGain` 量级与运动通气死区**
  - **已改**：`ventilation.parameters.json` 将 `inspiredO2Fraction` 改为净肺泡氧摄取分数 `0.058333`（静息 `250 mL/min → 6000 mL/min`，最大通气对应 `~2500 mL/min` 极限摄氧能力）、`pantingGain` 提至 `1500 mL/(min·°C)`；`ventilation.ts` 在静息下限之后叠加喘气增量。

### 分片 B：小肠吸收与结肠残渣

- [x] **B1. 修复 `smallIntestine` 每轮 5% 残渣复利抽水（“11.5 小时结肠水阱”）**
  - **已改**：`water-absorption.ts` 改为按离开通量 `95% / 5%` 比例分流（`min(water - absorbed, absorbed * f / (1 - f))`），自然随 `dtMin` 缩放。
- [x] **B2. 修复 `smallIntestine` 碳水/水吸收反馈符号错误与缺下界/上界透支风险**
  - **已改**：`water-absorption.ts` + `.parameters.json` 将脱水系数改为正向 `0.1`（不再把 74% 饮水倒进结肠）、血糖梯度改负反馈 `-0.2 * (G/90 - 1)`、胰岛素肠吸收增益归 `0`，所有吸收因子与转移量均做非负及不透支钳位。
- [x] **B3. 优化 `colon` 水回收动力学与统一 `bowelUrgencyMm` 消费链**
  - **已改**：`colon.ts` 改用解析指数回收 `1 - exp(-k * dtMin)`，`colon.parameters.json` 将 `reclamationRatePerMin` 提至 `0.01 /min`（半时 ~69 min）；`interoception.ts` 直接消费 `colon.bowelUrgencyMm`。

### 分片 C：血糖稳态、女性泌乳与分区骨骼肌

- [x] **C1. 修复女性默认清单永久泌乳 1.44 L/天与催乳素正反馈锁死**
  - **已改**：`mammary-glands/milk.ts` 新增 `lactating: false` 状态与 `fullnessDecayHalfTimeMin = 30 min`，默认女性 0 泌乳、0 乳糖流失、`prolactinRelative = 1.0`；显式 `lactating: true` 时恢复正常产乳与催乳素响应且不再棘轮锁死 `fullnessMm`。
- [x] **C2. 建立真实空腹血糖稳态：基础非胰岛素耗糖 + 运动耗糖 + 平滑肝肾放糖**
  - **已改**：
    - `glucose-core.ts` 新增 `glucose.basalConsumptionGPerMin = 0.12 g/min`（低糖 `< 50 mg/dL` 柔和衰减）；
    - `liver/glycogen.ts` 与 `kidney/gluconeogenesis.ts` 改用平滑比例 + 餐后抑制（静息 `0.096 + 0.024 = 0.120 g/min` 精确平衡基础耗糖），放宽肾糖异生 `maxOutputPerRoundG = 0.6`、`maxOutputRateGPerMin = 0.5`，补齐 `insulinResponse >= 0` 保护；
    - `skeletal-muscle/glucose-uptake-core.ts` 新增运动收缩摄糖 `exerciseUptakeRateGPerMin = 0.15 g/min` 与 `insulinResponse >= 0` 保护。
- [x] **C3. 修复分区骨骼肌 3 倍总耗糖与初始 0 肌糖原**
  - **已改**：`regions/region-core.ts` 与 `head/trunk/limbs.ts` 按区域份额（`5% / 45% / 50%`）缩放消耗率至总计 `0.5 g/min`，并设置静息初始肌糖原 `15 / 135 / 150 g`（合计 `300 g`）。

### 分片 D：血钙、性反应、唾液干口、提醒滞回、循环与内分泌轴

- [x] **D1. 修复 `bloodCalcium` 10⁶ 量纲错误与骨库满容质量守恒**（注：本轮保持未挂载，是否挂载进三份清单留作 P2 独立决策）
  - **已改**：`calcium.ts` 将 `/ 1000` 修正为 `* 1000`，并在扣减血钙前按 `boneCapacityG - prevBoneStoreG` 截断 `depositG`。
- [x] **D2. 修复 `sexualResponse` 不应期连续高潮循环与 `arousalMm > 100` 越界**
  - **已改**：`sexual-response/response.ts` 强制 `voluntaryRelease`/`forcedRelease` 检查 `!refractory`，释放当轮即切 `target = 0` 进入消退，`target`/`arousalMm` 严钳 `[0, 100]`（高睾酮改为加速上升半时）。
- [x] **D3. 修复 `salivaryGlands` 静息正常补水下 66.7 mm 重度口干**
  - **已改**：`saliva.ts` 以 `basalRateMlPerMin` 归一化 `mouthMoistureMm`（水合静息 `100 mm` → `dryMouthMm = 0 mm`），并对齐 `eat` 动作合法性校验。
- [x] **D4. 修正 `brainNotify` 滞回复位 `resetBelow = 40 mm` 失效与参数状态标注**
  - **已改**：`notify.ts` 在 `40–64 mm` 滞回带保持水位不清零，仅 `< 40 mm` 复位；`notify.parameters.json` 14 项参数全部由 `design` 改为 `policy`（`parameters.test.mjs` 新增状态白名单校验）。
- [x] **D5. 修复 `blood` / `heart` 静息心输出错位与血容量脱钩**
  - **已改**：`blood.ts` 将静息基准对齐 `4900 mL/min`（首轮精准 `120 / 80 mmHg`），并将 `bloodVolumeMl` 按 `bodyFluid.waterVolumeMl / 30000` 联动（钳位 `[2500, 6000]`）；`heart.ts` 加入血容量前负荷因子（`[0.5, 1.15]`）并将 `strokeVolumeMl` 钳位 `[30, 140] mL`。
- [x] **D6. 修复内分泌 HPT/HPA 轴 `NaN` 防护并接入基线中性上游生理驱动**
  - **已改**：`hypothalamus-endocrine.ts`、`pituitary.ts`、`thyroid.ts`、`cortisol.ts` 补齐 `finiteOr` 与 `[0, 3]` 钳位；`hypothalamus-endocrine.ts` 接入低温（`< 36.8 °C`）→ TRH、低血糖（`< 80 mg/dL`）/ 高强运动（`intensity > 0.5`）→ CRH 驱动（正常静息精确为 `1.0`）。

### 分片 E：全清单 24 小时稳态与日间场景回归闸门

- [x] **E1. 新增三清单 24 小时稳态与典型日间场景 Gateway 回归测试**
  - **已新增并通过**：`test/organs.steady-state-24h.test.mjs`（6/6 通过，耗时 ~4.8 s）。

---

## 三、P1 — Gateway 运行时与插件工程修复清单（已完成并实测通过）

- [x] **P1-1. 修复通知泵无重入保护导致的重复投递**（`notifications.js` + `index.js`）：已加入 `activeRun` 重入锁并新增 `test/dsh.index.test.mjs` 生命周期与真实 Gateway 联调测试及并发防重投单测。
- [x] **P1-2. 修复启动 `catchUp` 携带 `activeBatch` 时击穿 `catchUpMinutes` 上限**（`gateway/simulation.js`）：`remaining <= 0` 返回前快进 `wallTimeMs` 跳过超出上限的时段；清理存档顶层冗余 `catchUpError` 键；`start()` 不再覆盖 `catchUp` 触发的 `fatalFailure` 或虚假写入 `lastSuccessAtMs`；补齐回归测试。
- [x] **P1-3. 修复 `applyOperations` 浮点溢出绕过 JSON-safe**（`gateway/operations.js`）：已对累加后的 `delta`、`base + delta`、`pair.amount`、`targetValue + amount` 做 `Number.isFinite` 校验并补齐溢出 `FatalOperationError` 测试。
- [x] **P1-4. 修复次级运行边界**
  - `tools.js` 与 `lib/parameters.js` 已补 `Object.hasOwn` 防原型属性泄露，并补 `loadParameters` 异常分支测试；
  - `gateway/checkpoint.js` 已调整为先 `prune(next)` 再校验 `maxCheckpointBytes - actionReserveBytes`；
  - `gateway/http.js` 与 `gateway.js` 停机期间 `/notifications/ack` 返回 `503` 而非 `500`，守卫 `server.address()` 为 `null`；
  - `gateway/body-worker.js` 对 `io.add`/`io.transfer` 入参做 `structuredClone` 早校验；
  - `package.json` 保持零构建源码 `.ts` 路线，已在 `README.md` 明确标注需本地源码路径接入、装入 `node_modules` 须预编译。

---

## 四、P2 — 文档同步、离线回放与仓库卫生清单

- [x] **P2-1. 同步核心文档与本轮 P0 改动**（`README.md`、`docs/gateway-and-scripts.md`、`docs/virtual-body.md`）：已修正参数文件数（`34 / 37 / 36`，总 `44`）与硬传输闭包数（`15 / 17`）、清除过期“肾糖异生尚未实现”表述、修复 `README.md` 重复 `骨骼肌` 行、同步 P0 公式及 `tools/replay.mjs --manifest` 说明，并更新 12+1 份切片计划复选框。
- [x] **P2-2. 补齐缺失与过期器官文档**：已新增 `testes/`、`epididymis/`、`parathyroid/`、`calcium/` 四个 `README.md`，并更新 18 份过期或受 P0 影响的器官 `README.md`（全库 31 份器官 README 零断链）。
- [x] **P2-3. 把清单计数/闭包/README 存在性校验纳入测试**：已在 `test/organs.modules.test.mjs` 中自动校验三份清单 `createFieldRegistry`、脚本数、唯一参数文件数、传输闭包数、31 份器官 README 非空存在性及 `startup/reset-parts.js`。
- [x] **P2-4. 升级 `tools/replay.mjs`**：已保留默认 5 模块兼容路径并新增 `--manifest [path]` 全清单 `createFieldRegistry` + `applyOperations` 重放支持，补齐测试。
- [ ] **P2-5. 需用户拍板的剩余清理与决策**：
  - 根目录未跟踪的 219 MiB `dsh-body-transfer-20261122-144024.tar.gz`（按原血钙计划保留，待确认是否删除或移出）；
  - 是否将已修好 `* 1000` 与骨容量守恒且补齐 README 的 `parathyroid` + `bloodCalcium` 正式挂载进三份 `body-modules*.json` 清单；
  - 两处历史跨器官参数导入遗留（`blood.ts` 读 `heart.parameters.json`、`duodenum/nutrient-exposure.ts` 读 `saliva.parameters.json`）是否值得后续解耦；
  - 核对本地领先 `origin/main` 的 4 个提交与当前工作区全部改动并提交/推送。
