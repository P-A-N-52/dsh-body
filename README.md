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

根清单 `body-modules.json`（38 部位、37 份参数文件）：

| 器官 | 已实现功能 |
| --- | --- |
| 胃 | 固/液餐排空、碳水记账、相对饥饿素、胃壁机械感受 |
| 食管 | 食团转运时延与呛咳风险代理（并入 `discomfort` 第七路） |
| 十二指肠 | 近期营养暴露代理 |
| 小肠 | 水与碳水一阶吸收；未吸收残渣水按固定比例转入结肠 |
| 骨骼肌 | 活动计时、肌糖原储存与运动消耗 |
| 皮肤 | 活动相关汗液请求与实际汗量 |
| 肺 | 运动相关呼吸失水、自动通气 |
| 胰腺 | 血糖驱动的相对胰岛素与胰高血糖素信号 |
| 肝 | 肝糖原储存（上限 100 g）与低血糖释放 |
| 骨骼肌 | 活动状态、摄糖聚合器、头/躯干/四肢三个区域糖原 |
| 肾 | ADH 驱动产尿、肾糖质量排泄；可选中枢/肾性 DI 变体（独立清单） |
| 膀胱 | 储尿、主动排尿、过度充盈非自主排空 |
| 结肠 | 残渣水回收回流体液、粪便储存、`defecate` 排出与便意读数 |
| 脑 | 下丘脑 ADH、口渴与内分泌轴（TRH/CRH、TSH/ACTH）、体感读出、四类体感提醒 |
| 甲状腺 | TSH 驱动的 T4 相对信号，缩放基础氧耗并负反馈抑制 TRH/TSH |
| 肾上腺 | ACTH 驱动的皮质醇相对信号，缩放肝糖释放、产生 `stressMm` 并负反馈抑制 CRH/ACTH |
| 松果体 | 仿真昼夜褪黑素相对信号，驱动 `sleepinessMm` |
| 体液隔室 | 体液水与水分亏缺，按肾 → 肺 → 汗结算 |
| 葡萄糖隔室 | 可及池质量与浓度代理，按肾 → 肝 → 肌结算摄糖请求；女性变体末位加乳腺乳糖汇 |
| 血氧隔室 | 行为与消化氧耗、供需平衡与 SpO2 代理 |

女性清单 `body-modules.female.json`（41 部位、40 份参数文件，独立存档）在此基础上增加：

| 器官 | 已实现功能 |
| --- | --- |
| 卵巢 | 周期日与相位、雌二醇/孕酮相对量（周期长度取 Bull 2019） |
| 子宫 | 内膜相对量、月经失水、痛经（并入 `discomfort` 第五路） |
| 乳腺 | 催乳素驱动的乳汁水与乳糖请求、胀奶（并入 `discomfort` 第六路；乳汁水走 `bodyFluid` 第五出口，乳糖走女性 `glucose` 变体） |

完整部位与动作清单以 `body-modules.json`、`tools.js` 及各器官 README 为准。

### Agent 行为

- `body_act` 提交结构化动作：`drink`（体积、能量、碳水）、`eat`（另含餐型）、`urinate`、`defecate`、`exercise`（强度、时长）。动作进入队列，下一轮结算；同 ID 同载荷重试复用回执。
- `body_state` 读取已提交的身体快照。
- `brainNotify` 对饥饿、饱满、口渴、尿意按明显/强档投递提醒，带滞回、冷却与配额。
- LLM 通过提交动作驱动身体，状态由器官脚本计算并整轮提交。
- 参数分 `prior`（有登记文献支撑）与 `design`（工程假设）两类。M1、M3 水链与 M19 已做真实 DSH 会话验收，其余切片有离线单元与真实 Gateway 集成测试。

## 开发与验证

- **一个部位 = 一个后台子代理整包**：模块、参数、单元测试、清单与文档一起完成，spec 写半页即可；相关小部位可打包一片，主代理最后跑 `npm test` 与 `git diff --check`。
- **测试底线**：质量守恒、transfer 双向闭包、旧档与重启、参数 schema（`owner` 前缀、`design` / `source`、`unset` / `null`）、JSON-safe。这些是反复抓到过 bug 的地方。
- **Gateway 的 transfer 顺序**：按 `fromPart.fromField->target` 排序（`gateway/operations.js:206`），与模块调用顺序无关；write 先于 transfer，源余额按 write 值逐笔校验，所以 write 值必须覆盖本轮全部转出。
- **不要写“轨迹逐位一致”**：用加法构造 write 值时跨二进制 binade 会差 1 ulp，应写 ≤ 1 ulp 或给容差。
- **质量账只记真实转移量**：请求字段不入账，在途字段（本轮到账、下轮入账）必须入账，否则账会漏。

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
| [`body-modules.json`](body-modules.json)、[`body-modules.female.json`](body-modules.female.json)、[`organs/human-organs/`](organs/human-organs/) | 脚本清单；[胃](organs/human-organs/stomach/README.md)、[十二指肠](organs/human-organs/duodenum/README.md)、[小肠](organs/human-organs/small-intestine/README.md)、[骨骼肌活动与肌糖原](organs/human-organs/skeletal-muscle/README.md)、[皮肤](organs/human-organs/skin/README.md)、[肺](organs/human-organs/lungs/README.md)、[胰腺](organs/human-organs/pancreas/README.md)、[肝](organs/human-organs/liver/README.md)、[肾](organs/human-organs/kidney/README.md)、[膀胱](organs/human-organs/bladder/README.md)、[卵巢](organs/human-organs/ovaries/README.md)、[子宫](organs/human-organs/uterus/README.md)、[乳腺](organs/human-organs/mammary-glands/README.md)、[甲状腺](organs/human-organs/thyroid/README.md)、[肾上腺](organs/human-organs/adrenal/README.md)、[松果体](organs/human-organs/pineal/README.md)、[体感和提醒](organs/human-organs/brain/README.md)的模块、参数与证据；[体液隔室](organs/human-compartments/body-water/README.md)、[葡萄糖隔室](organs/human-compartments/glucose/README.md)与[血氧隔室](organs/human-compartments/blood-oxygen/README.md)是隔室而不是器官。女性清单另用独立存档。 |
| [`docs/gateway-and-scripts.md`](docs/gateway-and-scripts.md)、[`docs/gateway-operations.md`](docs/gateway-operations.md) | 当前接口、脚本接入，以及 `write` / `add` / `transfer` 的边界。 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | 已批准的设计文档：器官模型、固／液餐、水链、碳水—血糖、胰腺相对胰岛素、肾糖、口渴提醒、活动—皮肤出汗、运动相关呼吸失水、过度充盈与不适、女性生殖周期、肝糖原与胰高血糖素、血氧池与肺通气、内分泌轴与松果体、可选 DI 样代理。 |
| [`docs/virtual-body.md`](docs/virtual-body.md) | 设计草案与路线图，设计目标不等于已实现功能。 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 开发与协作约定：脚本、参数、证据与提交。 |

## 许可证

本项目的原创代码和文档采用 [MIT License](LICENSE)。第三方内容仍遵循各自的许可。
