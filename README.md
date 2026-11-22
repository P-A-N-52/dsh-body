# dsh-body

`dsh-body` 是 [DSH](https://github.com/deepseek-harness/deepseek-harness) 的虚拟身体插件。核心是一个**按固定步长结算、可从存档恢复的仿真 Gateway**：会话提交动作，器官脚本计算下一状态，Gateway 决定时间何时前进、哪些结果一起生效。身体启用时，即使会话空闲，仿真也会继续。

## Gateway 设计

**一具身体、一条仿真时钟、一份存档。** [Gateway](gateway.js) 在 DSH 宿主进程的主线程管理动作队列、调度和提交；[BodyWorker](gateway/body-worker.js) 在独立工作线程运行器官脚本。[`body-modules.json`](body-modules.json) 决定加载哪些脚本；`body-state.json` 由 Gateway 写，保存这一具身体的状态。加一个器官不需要再造一套时钟、动作入口或存档。

### 动作与时钟分开：接收不等于生效

[`body_act`](tools.js) 从 DSH 进程内直接提交动作，本地 `POST /actions` 也进入同一个[动作队列](gateway/actions.js)。Gateway 写入动作并分配预定生效的仿真时刻 `effectiveAt`，再返回 `202 queued`，不在请求里直接改胃容积。动作记录仍保留时，同 ID、同载荷的重试返回当前回执，不重复入队；同 ID 换载荷则返回 `409`。执行中的批次不会被新动作插队。

[调度器](gateway/simulation.js) 用现实时间锚点 `wallTimeMs` 判断哪一轮到期，用 `simulatedSeconds` 记录身体确实走到哪一轮。每轮固定计算 **60 个仿真秒**，成功提交才推进。脚本算得慢或失败，不会因此拿到一个更大的仿真步长。

### 计算与写入分开：一轮只读一份快照

启用时，一个常驻 Worker 按清单顺序运行脚本；所有脚本拿到**同一份不可变的轮初快照和动作批次**。比如一条饮水动作排到第 N 轮，读胃状态的其他脚本要到第 N+1 轮才能看到胃脚本的新写入。代价是跨模块信号有轮次延迟，换来同一轮不会因脚本先后执行而读到别人更新了一半的身体。

部位遵循**单写者**约束：`io.write` 只能暂存本部位的完整下一状态。要跨部位协作，脚本只能向 Gateway 提交操作请求，不能直接改别人的状态。`io.add` 只允许字段所属模块或声明的贡献者为 `additive` 字段记增量；`io.transfer` 只能由源字段所属模块发起，要求两端配对声明、单位相同且源量足够。Gateway 统一按 **write → add → transfer** 结算，脚本不负责持久化。详见 [Gateway 操作层](docs/gateway-operations.md)。

### 提交与恢复：先锁定输入，再一次发布结果

在线开算前，Gateway 先把本轮的动作 ID 和目标时刻写进 `activeBatch`。成功时，快照、时钟、动作回执和待发通知一起提交；[存档层](gateway/checkpoint.js) 写临时文件并替换原存档，然后才更新内存版本。即使 Worker 正在算，`body_state` / `GET /state` 仍读取上一次已提交的快照。`applied` 表示动作所在的轮次已提交；单个动作的回执由 `GET /actions/:id` 查询。

- **超时或普通脚本异常：** 丢弃整轮暂存结果，保留原批次和快照；[运行器](gateway/runner.js) 可重建 Worker，下一次仍从同一批输入重试。
- **操作层校验失败：** 不发布本轮结果，清除在途批次、保留排队动作，并停止调度；通过 `/health` 看 `fatal` 原因，修复后重启。
- **正常停机与主动暂停不同：** 正常重启按 `catchUpMinutes` 限额逐轮补算；显式暂停只冻住身体时钟，恢复不追算暂停时长。没有完成的批次保存在存档里，不需要会话再发一次。

[通知泵](notifications.js) 与轮次计算分开：`io.notify` 只暂存通知，在线轮次提交后才按 `sessionId` 投递，成功后 ACK。启动补算不产生补发通知，会话不在线也不会阻塞身体继续推进。这个提交边界保护的是 Gateway 管理的状态和通知队列；Worker 不是安全沙箱，通知投递与存档也不是同一个事务。

## 运行逻辑示意图

![Gateway 运行逻辑：动作入队、批次锁定、轮初快照计算与整轮提交；普通错误沿用原批次重试，操作校验失败则停止调度。](docs/assets/gateway-runtime.png)

## 当前实现范围

当前根清单已接入胃动力、相对饥饿素、胃壁机械感受代理、十二指肠营养暴露代理、水链六部位，以及饥饿／饱满／口渴／尿意／不适读出，和饥饿／饱满／口渴／尿意四类体感提醒。`body_act` 接收结构化 `drink` / `eat` / `urinate` / `exercise`，不负责从菜名推算容量、热量或活动代谢；饥饿／饱满／口渴／尿意／不适都是模型代理量，不是人体实测。M1 的真实 DSH 会话验收已完成；M3 水链的 Task 10 真实 DSH 会话验收也已完成（2026-11-22，30 轮 A/B 与排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，仓库外未入库）。后加的非自主排空、`discomfort` 与 DI 样变体由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts：预置 650 mL 无动作 → `involuntaryVoidedMl = 650`、同轮新尿 1 mL 留下、下一轮尿意/不适回落；正常/中枢/肾性请求约 1/4/4 mL；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）。650 mL 预置与预置会话的稳态 1 mL 请求是测试设定，不是模型输出；正常会话 sim 300 的 0.9998 mL 是模型输出。参数按登记分为 `design`、`prior` 和 `fitted_dev`，均不等于临床验证。

碳水—血糖及调节薄切片已接入同一身体存档：`drink` / `eat` 可显式携带有限且非负的 `carbohydrateG`（克，可消化葡萄糖当量），依次经胃碳水记账、既有固/非固餐排空、小肠吸收进入 `glucose` 隔室。隔室以固定 75 kg、`1.88 dL/kg` 表观分布体积、90 mg/dL 基线和 60 min 基线表观清除半时作为工程边界；`pancreasEndocrine` 的相对信号会缩放超基线非肾清除，基础信号 1 保持原公式。`kidneyGlucose` 在浓度超过 `339 / 1.88 ≈ 180.32 mg/dL` 后按下一轮请求把葡萄糖质量转入 `excretedGlucoseG`，只记 g，不换算尿水，实际排泄与非肾清除分别计入外源碳水质量账。模块与真实根清单 Gateway 测试覆盖 A/B、质量守恒、固体队列、餐后胰岛素/肾糖时序和吸收后重启；肝糖、胰高血糖素和组织分区仍未实现，也未做真实 DSH 会话或独立生理数据验证。

活动—皮肤出汗薄切片已接入：`exercise { intensity, durationMin }` 先更新 `physicalActivity` 的剩余时间与相对强度，`skin` 再按活动和固定环境参数写 `sweatRequestMl`，`bodyFluid` 最后按轮初请求把水量转入 `skin.sweatVolumeMl`。肾尿与汗液两路合计不超过轮初体液，水账新增实际汗液项，口渴沿用既有读出。默认 25°C、intensity=1、30 min 的工程场景累计 18 mL；所有出汗参数均为 `design`，不表示 METs、实测代谢、体温或人体最大出汗率。当前根清单为 17 部位、19 份参数文件，完整硬 transfer 闭包为 7 部位。

M3 水链首段的脚本、参数与证据笔记已实现：胃水子集入口 `hydration.ts`、小肠水吸收、体液隔室、肾产尿请求、下丘脑 ADH 与口渴双脚本、膀胱储尿与 `urinate` 动作；`interoception` 新增 `thirst` / `urinaryUrgency` / `discomfort`。膀胱在轮初体积严格大于 600 mL 且本轮无 `urinate` 时非自主排空到排后余量，`voidedMl` 拆成 `voluntaryVoidedMl` 与 `involuntaryVoidedMl` 两个分项；600 mL 与 70 mm 不适起始值都是 `design` 工程值，不是正常膀胱容量、临床失禁模型或疼痛评分。可选的中枢/肾性 DI 样多尿代理只在独立清单与独立存档中显式加载，默认根清单与正常参数不变，不是临床诊断。M3 首段当时没有新增工具、动作或通知，`brainNotify` 当时仍只读饥饿/饱满；尿意提醒是后续单独加入的。M3 水链完成时根清单为 12 个部位脚本；当前已扩展到 17 个部位；Task 10 真实 DSH 会话验收已完成（30 轮 A/B、同 sim 1800、方向符合 spec §6.2、账本误差 ≤`1e-6 mL`；排尿 queued→applied、250 mL 排出 + 同轮 1 mL 新尿留下、同 callId 重试 200 原 applied ID、异载荷 409）。Task 10 与 Task 11 都早于非自主排尿、不适与 DI 变体合并，不能代表当前版本的验收或性能。非自主排空、`discomfort` 与 DI 变体已由 M19 真实 DSH 会话补验（33/33 verdicts；650 mL → involuntary 650、同轮新尿 1 mL 留下、下一轮 urgency/discomfort 回落；主动优先与同 callId 200 原 ID、异载荷 409；正常/中枢/肾性请求约 1/4/4，通知 0）。650 mL 预置与预置会话的稳态 1 mL 请求是测试设定，不是模型输出；正常会话 sim 300 的 0.9998 mL 是模型输出。但它只覆盖 2–5 轮短会话；120 轮长时程、通知投递、重启补算、大负荷利尿和口咽解渴仍未验证，当前 HEAD 性能未重测。

`brainNotify` 现在读轮初 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`、最近提交的 `bladder.voidedMl` 和本轮 `urinate`：四类信号都按 65 mm 明显、85 mm 强档；用于门控的 `levels` 只存 0/2/3（40–64 mm 按 0），同一信号重复同档要先低于已提醒档，升更高档可直接提醒。每个信号独立滞回，冷却与每小时/每天配额按会话共享，每轮最多一条，在候选里先取最高档，同档 `urinary > thirst > fullness > hunger`；`lastKind` 是最近提醒信号，`lastLevel` 保留下降闩锁并用于旧档迁移。最近提交的 `bladder.voidedMl > 0` 或本轮有 `urinate` 时只抑制尿意候选，其他信号仍可提醒。提醒文本固定，不带数值、诊断或动作指令；不自动排尿或饮水，口渴只能经饮水吸收后回落，`discomfort` 仍不提醒。预置一致缺水状态时口渴第 3 轮提醒，尿意则是第 2 轮。提醒参数都是 `design` / `policy`，不是人体测量或临床界值。离线单元测试和真实 Gateway 集成测试覆盖这些通道（`test/organs.brain-notify.test.mjs`、`test/organs.urinary-notify-gateway.test.mjs`、`test/organs.thirst-notify-gateway.test.mjs`），尚未做真实 DSH 会话验收；M1/M3/M19 的历史验收都不包含尿意或口渴提醒。

现在不是全身生理模拟器，也不支持按会话选择不同身体。`systems/` 中的系统目录是历史资料，不代表已有对应模拟。

## 快速开始

需要 **Node.js ≥ 22.18**。在源码目录下即可运行测试和离线重放，不需要安装第三方依赖或启动 DSH：

```sh
git clone https://github.com/P-A-N-52/dsh-body.git
cd dsh-body
npm test
node tools/replay.mjs scenarios/p1-cola-330.json
```

示例重放 330 mL、140 kcal 的含糖饮料，输出胃内体积、能量及饥饿／饱满等观测点的 JSON。它不会写身体存档，也不验证真实会话里的通知投递。

### 接入 DSH

已安装 DSH CLI 时，在 `dsh-body` 源码目录下运行：

```sh
dsh plugin --profile web add "$(pwd)"
dsh web
```

保持 DSH 运行，在另一终端用 `curl -fsS http://127.0.0.1:3210/health` 查看启停状态和轮次错误。Gateway 默认仅监听本机 `127.0.0.1:3210`，接口没有令牌鉴权，不要将该端口转发到公网。DSH 默认将存档写入 `$DSH_HOME/dsh-body/body-state.json`（通常是 `~/.dsh/dsh-body/body-state.json`）；自定义路径、暂停恢复和 HTTP 接口见 [Gateway 开发指南](docs/gateway-and-scripts.md)。

## 代码与文档入口

| 入口 | 内容 |
| --- | --- |
| [`index.js`](index.js)、[`gateway/`](gateway/) | DSH 插件入口；本地 HTTP、动作队列、轮次结算和存档。 |
| [`body-modules.json`](body-modules.json)、[`organs/human-organs/`](organs/human-organs/) | 脚本清单；[胃](organs/human-organs/stomach/README.md)、[十二指肠](organs/human-organs/duodenum/README.md)、[小肠](organs/human-organs/small-intestine/README.md)、[骨骼肌活动](organs/human-organs/skeletal-muscle/README.md)、[皮肤](organs/human-organs/skin/README.md)、[胰腺](organs/human-organs/pancreas/README.md)、[肾](organs/human-organs/kidney/README.md)、[膀胱](organs/human-organs/bladder/README.md)、[体感和提醒](organs/human-organs/brain/README.md)的模块、参数与证据；[体液隔室](organs/human-compartments/body-water/README.md)与[葡萄糖隔室](organs/human-compartments/glucose/README.md)是隔室而不是器官。 |
| [`docs/gateway-and-scripts.md`](docs/gateway-and-scripts.md)、[`docs/gateway-operations.md`](docs/gateway-operations.md) | 当前接口、脚本接入，以及 `write` / `add` / `transfer` 的边界。 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | 已批准的设计文档：器官模型、固／液餐、水链、碳水—血糖、胰腺相对胰岛素、肾糖、口渴提醒、活动—皮肤出汗、过度充盈与不适、可选 DI 样代理。 |
| [`docs/virtual-body.md`](docs/virtual-body.md) | 设计草案与路线图，设计目标不等于已实现功能。 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 开发与协作约定：脚本、参数、证据与提交。 |

## 许可证

本项目的原创代码和文档采用 [MIT License](LICENSE)。第三方内容仍遵循各自的许可。
