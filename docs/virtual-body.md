# DSH 虚拟身体设计草案

[Gateway 开发指南：JSON 文件、脚本参数与可运行的 TypeScript 示例](./gateway-and-scripts.md) 说明现在已经可以怎么用。本文同时记录后续设计。

**当前实现的仿真单元是器官目录 `organs/human-organs/<organ>/`，不是系统目录。** P0/P1 的器官、脚本与后续清单见[器官级身体模型设计 §6](./superpowers/specs/2026-11-20-organ-model-design.md#6-器官清单)。本文里的 11 个系统名只作为功能标签保留，不再表示目录或仿真层级。

身体 Gateway 由 DSH 插件在宿主进程内运行，管理一具身体、同一个仿真时钟和一份存档。身体启用时，Gateway 按脚本清单加载模块，每分钟调度一轮 `heartbeat`。会话工具和浏览器的曲线、病况页面是后续接入计划。

### 已确认的行为契约（设计目标）

以下几项是会话绑定、器官转移、未来输入脚本和故障诊断的设计契约，不代表当前 Gateway 已经提供这些行为。

1. **会话绑定与心跳。** 身体已启用且存在绑定时，即使会话空闲也继续运行，只有成功提交的心跳才推进生理时间。绑定数为零时停止计算，生理时间冻结在最后一次成功提交的时刻；重新绑定从该时刻继续，不补算解绑期间的现实时间。该规则不覆盖手动暂停；多会话投递如何处理仍待定。
2. **器官间转移。** 器官之间不互相调用，也不直接修改对方的状态。以一笔胃→肠的实际 200 mL 转移为例：同一轮结束时胃内容量 −200、肠内容量 +200，两者同时提交或同时作废，原批次重试不会重复转移；肠在下一轮读到这 200 mL 并可用于吸收。改变的是内容量，不是预设容量。
3. **外部摄入与排出。** 将来由输入脚本管理外部摄入和排出，份量估算及估算失败归输入环节负责，具体失败处理策略未定。已入账的估值在重试时复用；体内器官间的转移不算再次摄入。
4. **脚本故障日志。** 每具身体的脚本故障日志写在自己存档所在目录的 `logs/` 下，每次失败保存脚本、入口、当时的实际输入（含批次和时间）、出错前的调用和错误。日志与整轮提交相互独立：失败不发布暂存的变化或通知，并保留原批次重试。日志按记录产生的现实时间滚动保留最近 24 小时，不影响身体存档、未结算动作或现有动作记录的保留规则。
5. **普通停机恢复。** 恢复间隔从最后成功提交的身体快照所对应的现实时间算到重启，不从最后报错或上次启动算起。日志过期不影响恢复，也不计入手动暂停或零绑定期间的时段。超过默认 12 小时是直接推算还是先回放再修正、电脑休眠是否使用同一上限，仍待定。

## 1. 器官与功能标签

内置预设以成年人体为起点。**仿真单元是器官，不是系统**：一个器官一个目录，可由一个或多个脚本组成；系统名只作为功能标签保留。解剖名词参考 [FIPAT 国际解剖术语](https://ifaa.net/committees/anatomical-terminology-fipat/fipat-ifaa-terminologies/)。

| 层 | 内容 |
| --- | --- |
| 仿真单元 | `organs/human-organs/<organ>/`，一个器官可由多个脚本组成 |
| 功能标签 | 消化、内分泌、感觉器等，只用于 README 分类 |
| P0 | 胃（动力、饥饿素、机械感受）、十二指肠（营养暴露） |
| P1（已完成） | 输入契约（`drink` 可带能量）、体感读出（`hunger` / `fullness` 与提醒）；不新增消化器官 |
| M3 水链（已接入根清单） | 胃水子集、小肠水吸收、体液隔室、肾产尿请求、下丘脑 ADH / 口渴、膀胱储尿与主动排尿；随后合并了膀胱过度充盈非自主排空（轮初 >600 mL 自动排到排后余量，`voidedMl` 分主动/非自主）与 `interoception.discomfort`（四感受超 70 mm 取最大），均在默认根清单；可选中枢/肾性 DI 样多尿变体只在独立清单/存档，默认身体不变。水链完成时根清单为 12 个部位；碳水薄切片加入葡萄糖后为 13 个；胰腺与肾糖接入后为 15 个；活动—皮肤出汗薄切片接入后当前为 17 个，多轮水账本补测与当时 12 部位性能基线已完成（Task 11，早于上述后加功能，属历史基线），论文可比数据对照已记录（Task 12，大负荷利尿仍不匹配），Task 10 真实会话验收已完成（30 轮 A/B + 排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，早于上述后加功能）；后加功能由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts：650 mL 无动作 → involuntary 650、同轮新尿 1 mL 留下、下一轮尿意/不适回落；正常/中枢/肾性请求约 1/4/4；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；650 mL 预置与预置会话的稳态 1 mL 请求是测试设定，不是模型输出；正常会话 sim 300 的 0.9998 mL 是模型输出；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴未验证 |
| M2 碳水—血糖薄切片（已接入根清单） | `drink` / `eat.carbohydrateG` → 胃碳水与既有排空 → 小肠吸收 → `glucose` 可及池；`pancreasEndocrine` 相对信号缩放非肾表观清除，`kidneyGlucose` 按请求把 `glucoseMassG` 转成 `excretedGlucoseG`（g，不换尿水）。固定体重、表观分布体积、基础浓度、基线清除和肾糖锚点参数按 `design` / `prior` 标注。完整胰岛素浓度/分泌、肝糖、胰高血糖素与组织摄糖分区仍未实现；当前只有模块和真实 Gateway 离线验收，没有真实 DSH 或独立血糖曲线验证。 |
| M4 活动—皮肤出汗薄切片（已接入根清单） | `exercise` → `physicalActivity` 剩余活动/强度 → `skin.sweatRequestMl` → `bodyFluid` 肾尿+汗液双出口 → `skin.sweatVolumeMl`；默认 25°C、`I=1`、30 min 累计 18 mL，无活动时请求与实际均为 0。口渴仍由既有 `waterDeficit → hypothalamusThirst → interoception` 按轮初快照读出，不自动饮水。完整 M4 的肌群负荷、疲劳、延迟酸痛与皮肤分区状态仍未实现；当前只有模块与真实 Gateway 集成测试，没有真实 DSH 会话或独立人体出汗数据。 |
| 后续清单 | [`2026-11-20-organ-model-design.md`](./superpowers/specs/2026-11-20-organ-model-design.md) §6 |

11 个系统名（运动、消化、呼吸、循环、泌尿、生殖、神经、内分泌、免疫、感觉器、被皮）只保留为功能标签，不再是目录或仿真层级。当前 P0/P1 的器官资料见 [`stomach`](../organs/human-organs/stomach/README.md)、[`duodenum`](../organs/human-organs/duodenum/README.md) 与 [`brain`](../organs/human-organs/brain/README.md)；活动—皮肤薄切片见 [`skeletal-muscle`](../organs/human-organs/skeletal-muscle/README.md) 与 [`skin`](../organs/human-organs/skin/README.md)；其余 `systems/*/` 只保留未迁移的 legacy 证据。

同一器官承担多个功能标签时，各脚本读取该器官的同一份状态。例如胰腺的消化酶分泌与胰岛的激素分泌属于同一器官目录，器官内的平滑肌随所属器官推进。 [NCI 内分泌腺与激素](https://training.seer.cancer.gov/anatomy/endocrine/glands/)

### 器官目录与共享身体状态

每个器官的 `README.md` 记录要模拟的脚本、字段、调节方式、待查问题和证据入口。论文原文、逐篇摘记和从图表提取的数据放在该器官的 `references/` 下，P0/P1 的笔记在 `organs/human-organs/stomach/references/notes/`；共享登记簿和字段字典在 `organs/human-organs/references/`。脚本例如 `organs/human-organs/stomach/hydration.ts`、`organs/human-organs/stomach/ghrelin.ts`、`organs/human-organs/brain/interoception.ts`、`organs/human-organs/skeletal-muscle/activity.ts` 和 `organs/human-organs/skin/sweat.ts`，由根目录的 `body-modules.json` 逐条挂载；根清单现在挂载 17 条部位脚本（原 P0/P1 六条，胃入口换成 `hydration.ts`，加小肠、体液、葡萄糖隔室、胰腺、肾糖、两个下丘脑、肾、膀胱、活动与皮肤）。

运行时的公共池就是同一分钟的身体快照。`snapshot.simulatedSeconds` 给出仿真时刻，`snapshot.parts` 按模块 ID 保存当前值。每个量由一个模块写入，其他模块按需读取。例如胃内容量由 `stomach` 的 `hydration.ts` 维护，饥饿素相对浓度由 `stomachGhrelin` 的 `ghrelin.ts` 维护，`brain/interoception.ts` 读取胃充盈、饥饿素、十二指肠营养暴露、下丘脑口渴与膀胱体积后写 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`。Gateway 将所有部位一起写入一份 `body-state.json`，重启时也从同一分钟恢复。

### 可自定义的身体参数

身体预设可设置年龄（岁）、身高（cm）、体重（kg），以及启用的器官和身体分区。基线用于初始化新身体，并作为反馈计算的参考。恢复存档时从保存的现值继续推进。表中的相对倍率默认取 1。

| 功能标签 | 可自定义的基础参数 | 可单独设置免疫档位的部位 |
| --- | --- | --- |
| 运动 | 关节活动范围（°）、肌群耐力和疲劳恢复倍率 | 肌群、关节，可分左右 |
| 消化 | 胃容量（mL）、胃排空和肠道吸收倍率 | 口腔、食管、胃、小肠、大肠 |
| 呼吸 | 静息呼吸频率（次／分钟）、潮气量（mL／次）、活动时的通气响应倍率 | 鼻咽、气管、支气管、肺 |
| 循环 | 静息心率（次／分钟）、静息收缩压和舒张压（mmHg）、活动后心率恢复倍率 | 心脏、已启用的血管分区 |
| 泌尿 | 膀胱容量（mL）、肾脏排水响应倍率 | 肾、膀胱、尿道 |
| 生殖 | 启用对应器官时，可设周期长度和起始周期日（仿真日） | 已启用的生殖器官 |
| 神经 | 昼夜节律相位偏移（小时）、睡眠压力累积和回落倍率 | 脑、脊髓、已启用的周围神经区域 |
| 内分泌 | 各激素的基础分泌速率（相对浓度／仿真秒）、初始相对浓度、清除系数（每仿真秒）和靶点敏感度倍率 | 读取对应器官的档位，例如胰岛与胰腺共用档位 |
| 免疫 | 全身默认档位，各器官或身体分区的覆盖档位 | 脾、淋巴结等具体部位也可以覆盖全身档位 |
| 感觉器 | 触觉、冷热、疼痛和胃充盈的感知阈值，用对应感觉信号的量纲设置 | 眼、耳可单独设置。皮肤和内脏的感受器取所在组织的档位。 |
| 被皮 | 分区表面温度基线（℃）、湿润度基线（0–1）、出汗响应倍率 | 按第 3 节的皮肤分区设置，可细到左右和前后 |

基础参数随对应模块接入。P0/P1 已接胃排空、胃饥饿素、胃壁机械感受、十二指肠营养暴露时间常数和体感线性读出的参数；胃容量上限与充盈感知阈值仍是后续设计。`stomachSensory.referenceVolumeMl` 只是归一化机械感受用的工程参考量，不截断胃容量；`interoception` 的基线、增益与缺失默认值全部是 `design`，不是人体测量。

### 全身与局部免疫等级

免疫档位采用五级。**1 级弱、2 级偏弱、3 级基线、4 级偏强、5 级强。** 内置成年预设的全身默认是 3 级，各部位的 3 级都表示该部位自己的仿真基线。

每个位置可用一个档位覆盖全身默认值。同一器官或组织参与多个系统时，共用该位置的档位。例如全身设为 3 级，左小腿皮肤设为 2 级，左小腿皮肤读取 2 级，右小腿皮肤和其余沿用默认值的部位读取 3 级。

## 2. 激素的生产、现有浓度和作用

每种激素同时跟踪三个状态。生产改变循环中的浓度，浓度与靶点的状态共同决定作用。靶点的变化可以反馈到下一步生产。

| 状态 | 怎么计算 |
| --- | --- |
| **生产** | 记录来源和当前分泌速率。节律脚本给出基础分泌，器官反馈和身体事件调节这个速率。合成和释放发生在不同部位时分别标明，以进入循环的速率计算浓度变化。 |
| **现有浓度** | 延续上一时刻的浓度，由分泌和清除的差额决定升降。各激素使用各自的参考浓度和清除系数。同一种激素有多个入血来源时，各来源的分泌速率相加。 |
| **作用** | 根据现有浓度、靶点状态和敏感度计算各靶点的反应，用来推进器官状态或生成体感信号。 |

```text
浓度变化率 = 生产速率 − 清除系数 × 现有浓度
各靶点的作用 = 靶点响应(现有浓度, 靶点状态, 敏感度)
```

首批以每种激素的参考浓度为单位，生产和清除速率都表示为单位虚拟时间内的相对浓度变化。进食后，吸收的葡萄糖使血糖升高，胰岛素分泌增加，浓度随之上升。分泌回到基础水平后，先前积累的胰岛素继续被清除，对肌肉和肝的作用随浓度回落。

### 时间推进与反馈

每次 `heartbeat` 推进 60 仿真秒。各生理模块以同一份轮初状态为输入，计算各自负责的生产速率、浓度变化和靶点作用。三项结果与器官状态一起提交，供下一轮计算和外部查询。

### 分阶段接入的激素

| 激素 | 生产来源与驱动 | 靶点作用 |
| --- | --- | --- |
| 胰岛素 | 胰岛 β 细胞，血糖升高时增加分泌 | 提高肌肉等组织的葡萄糖摄取，抑制肝糖输出。 [NCI 胰岛分泌资料](https://training.seer.cancer.gov/anatomy/endocrine/glands/pancreas.html) · [人体葡萄糖代谢实验](https://pubmed.ncbi.nlm.nih.gov/3517554/) |
| 胰高血糖素 | 胰岛 α 细胞，血糖偏低时增加分泌 | 增加肝糖输出，帮助血糖回升。 [胰高血糖素与肝糖输出实验](https://pubmed.ncbi.nlm.nih.gov/7859939/) |
| 饥饿素（ghrelin） | 胃为主，首批用空腹和进餐驱动分泌变化 | 提高饥饿驱动，与胃充盈共同决定饥饿感。 [餐前与餐后饥饿素测量](https://pubmed.ncbi.nlm.nih.gov/11473029/) |
| 褪黑素 | 松果体，由昼夜节律脚本驱动 | 提供昼夜助眠信号，与清醒期间积累的睡眠压力共同影响困意。 [褪黑素昼夜节律实测](https://pmc.ncbi.nlm.nih.gov/articles/PMC3047226/) |
| 皮质醇 | 肾上腺皮质，受昼夜节律和应激事件驱动 | 持续偏高时逐步降低组织的胰岛素敏感度。下一步用更新后的敏感度计算胰岛素作用。 [皮质醇与胰岛素作用实验](https://pubmed.ncbi.nlm.nih.gov/3517554/) |
| 抗利尿激素（ADH） | 下丘脑合成，垂体后叶释放，体液渗透压升高时释放增多 | 提高肾脏水重吸收，减少排水。饮水经胃肠吸收后，体液渗透压降低，ADH 分泌随反馈回落。 [渗透压与 ADH 实验](https://pubmed.ncbi.nlm.nih.gov/1262438/) · [ADH 与肾脏排水实验](https://pubmed.ncbi.nlm.nih.gov/9679185/) |

接入其他激素时，按预设配置分泌规则、初始浓度、清除系数和靶点反应。

## 3. 运动与被皮的分区

运动系统的骨骼肌与被皮系统的皮肤共用一棵身体分区树，各区可以细分左右和前后。皮肤状态按表面区域保存，骨骼肌状态按肌群保存。同一区域可挂多个肌群。

| 大区 | 运动（肌群） | 被皮（皮肤区域） |
| --- | --- | --- |
| 头、面部 | 表情肌、咀嚼肌 | 头皮、额头、左右脸颊、耳周、下颌 |
| 颈部 | 胸锁乳突肌、颈后肌群 | 前颈、后颈、左右侧颈 |
| 胸背 | 胸肌、肋间肌、背阔肌、竖脊肌 | 左右胸、上背、肩胛周围、下背 |
| 腹部与骨盆 | 腹直肌、腹斜肌、臀肌、盆底肌 | 上腹、下腹、左右侧腹、臀部、会阴 |
| 左右上肢 | 三角肌、肩袖、肱二头肌和肱三头肌、前臂屈伸肌、手内在肌 | 肩、上臂、肘、前臂、腕、手背、掌、手指 |
| 左右下肢 | 髋屈肌、股四头肌、腘绳肌、胫前肌、小腿三头肌、足内在肌 | 髋、股前后侧、膝、小腿前后侧、踝、足背、足底、足趾 |

- **运动**按肌群记录动作负荷、疲劳、紧绷、酸痛和局部拉伤程度。疲劳随用力累积、随休息恢复。离心负荷后的延迟酸痛有独立的起效和恢复过程。
- **被皮**记录各区的表面温度、湿润度、红肿、破损和刺激强度。
- **感觉器**按部位记录触觉敏感度，并根据局部状态生成触觉、冷热或疼痛信号。神经系统整合这些信号，形成体感。
- **分区联动**按姿势或运动类型给各肌群分配负荷。比如长时间踮脚会增加两侧小腿后侧肌群的负荷和疲劳。左小腿已有拉伤时，同一动作也可能让左右两侧产生不同的体感。

## 4. 病况的条件、反应和方程

M6 接入基础病对身体参数的持续修正。M7 接入当前病况的触发、发作和恢复。

每种病况可以有独立的反应程序，并沿用同一套器官、激素和区域状态。病况定义包含作用位置、触发条件、反应强度和恢复条件。复杂病况还可有潜在、发作和恢复阶段。

1. **修改基础参数。** 按病况修正对应环节的参数。例如胰岛素抵抗降低肌肉等组织的敏感度，使同样浓度的胰岛素产生更弱的摄糖作用。
2. **添加条件反应。** 每个计算步先判定触发条件，再把生效病况的变化率加到身体反馈上。例如未吸收的乳糖到达大肠后，按剩余量逐步增加腹胀。
3. **推进发作阶段。** 延迟起效、持续和回落用同一个身体时钟计算，短时病况可以限定到一个皮肤区域或一个肌群。持续的参数修正可与阶段反应叠加。

```text
当步参数 = 身体预设参数经生效病况修正后的值
当步变化率 = 身体反馈(当步起始状态, 当步参数, 激素作用) + 各生效病况的变化率之和
```

| 病况候选 | 什么情况下有变化 | 模拟结果 |
| --- | --- | --- |
| 乳糖不耐受 | 预设有乳糖消化不足，进食含乳糖食物 | 由乳糖残余量带动延迟的腹胀、肠鸣或不适，再随消化推进回落。 [NIDDK 乳糖不耐受](https://www.niddk.nih.gov/health-information/digestive-diseases/lactose-intolerance/symptoms-causes) |
| 胃食管反流 | 有反流倾向，胃较充盈时躺下 | 胃与食管出现一段反流反应，有时能感觉到烧灼或反酸。 [NIDDK 胃食管反流](https://www.niddk.nih.gov/health-information/digestive-diseases/acid-reflux-ger-gerd-adults/eating-diet-nutrition) |
| 2 型糖尿病的胰岛素抵抗 | 预设启用持续的胰岛素抵抗，进食后供糖增加 | 组织对胰岛素的响应降低，同一餐的血糖回落可能更慢。是否察觉由体感规则决定。 [NIDDK 2 型糖尿病](https://www.niddk.nih.gov/health-information/diabetes/overview/what-is-diabetes/type-2-diabetes) |
| 局部皮肤刺激 | 指定皮肤区有持续摩擦或刺激事件 | 刺激累积到阈值后出现局部红、痒或刺痛，随后按该区恢复速度回落。 [局部累积刺激研究](https://pubmed.ncbi.nlm.nih.gov/3180788/) |
| 局部肌肉拉伤 | 预设腰背或某肌群已有拉伤，再次用到受影响的肌群 | 按该部位的负荷提高疼痛或紧绷程度，并限制身体动作的活动范围。 |

## 5. 身体 Gateway 与 DSH 接入

目前 DSH 会话可发起进食、饮水、排尿与运动，胃排空、水链与活动—出汗链随心跳推进。M3 水链的主动排尿、膀胱充盈、过度充盈非自主排空、口渴、尿意与不适读出脚本已实现并接入根清单，Task 10 真实会话验收已完成（30 轮 A/B + 排尿重试/409，早于非自主排空与不适合并）；非自主排空、`discomfort` 与 DI 样变体已由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴未验证。可选 DI 样多尿变体只在独立清单/存档中显式加载，默认身体不变。状态与模块清单见第 6 节。Gateway 在线且身体启用时，即使会话空闲也继续计时；暂停身体或 DSH 退出（含崩溃）时心跳停止，心跳停止期间新增的主动动作为零。

当前插件已接入 Gateway 的启动与关闭，默认清单现在挂载 17 条部位脚本（原 P0/P1 六条，胃入口换成 `hydration.ts`，加小肠、体液、葡萄糖隔室、胰腺、肾糖、两个下丘脑、肾、膀胱、活动与皮肤）。启用时，自定义空清单下新动作仍会因为没有模块声明对应类型而返回 `422`；停用时新动作返回 `409`，见「启用、暂停与恢复」。这是有意的 fail-fast，已声明类型按 `actionTypes` 放行；未声明类型仍返回 `422`。M1 的真实 DSH 会话验收已完成；通知历史文件与模型已读确认仍未实现；食物估算仍是接下来的设计。[插件入口](../index.js) · [默认脚本清单](../body-modules.json)

### 加载插件

在项目目录中将插件加入 Web profile，然后启动 DSH。

```sh
dsh plugin --profile web add "$(pwd)"
dsh web
```

DSH 加载插件时启动 Gateway，退出或卸载插件时关闭监听、定时器和正在执行的 Worker。Gateway 默认监听 `127.0.0.1:3210`。可在 profile 的 `dsh-body` 条目中设置 `port`、`manifestPath` 和 `statePath`。端口也可用 `DSH_BODY_PORT` 指定；端口必须是 0–65535 的整数，空值回退 3210。 [DSH 插件安装](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish) · [Cordis 生命周期](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/)

存档默认写入 `$DSH_HOME/dsh-body/body-state.json`，DSH 的默认数据目录是 `~/.dsh`。首次加载可接续脚本清单目录已有的 `body-state.json`。存档顶层的 `active` 决定本次启动是否推进身体，修改方法见「启用、暂停与恢复」。

- `GET /state` 返回最近一次提交的 `simulatedSeconds` 和各部位状态 `parts`。
- `POST /actions` 接收包含 `id` 和 `type` 的 JSON 动作，必须使用 `Content-Type: application/json`。启用时，有处理者的新动作返回 `202` 和 `{ id, type, status: "queued", effectiveAt }`；没有模块声明该类型则返回 `422`，且不写入存档。只要动作记录仍在，同 id、同载荷返回 `200` 和当前回执，同 id、不同载荷返回 `409`。
- `GET /actions/:id` 返回动作记录和状态；`GET /capabilities` 按动作类型列出处理它的模块 ID，例如当前根清单启用后 `{ "drink": ["stomach", "stomachGhrelin"], "eat": ["stomach", "stomachGhrelin"], "urinate": ["bladder"], "exercise": ["physicalActivity"] }`（暂停时为空对象）；`GET /health` 返回本次启动实际采用的 `active`、仿真时钟、在途批次、连续失败次数和队列计数。
- `GET /notifications` 返回待确认通知；`POST /notifications/ack` 提交 `{ "id": "…" }`，返回 `{ id, acked }`，未知 id 也返回 200 和 `acked: false`。

HTTP 边界：请求体上限 64 KiB；非 JSON 的 POST 返回 `415`；`Host` 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`，非 GET 的 `Origin` 只允许同源，否则返回 `403`；错误方法返回 `405`。存档默认上限 2 MiB，入队前会预留元数据空间，超过预算返回 `413`，不会把队列写坏；可用 `maxCheckpointBytes` 调整。当前不引入 token；同进程的 `body_act` 直接调用 Gateway 句柄，HTTP 只服务本地调试和未来的浏览器页。

### 脚本清单与启动

Gateway 启动时读取 `body-modules.json`，以清单所在目录为基准解析相对路径。下面是示意条目，只示意 `inject` 的写法：示例里的胃脚本声明读取轮初的饥饿素相对浓度；P0/P1 的 `motility.ts` 既不声明 `inject`，也不读 `stomachGhrelin`。P1 的 `brain/interoception.ts` 与 `brain/notify.ts` 直接读轮初部位，不使用 `inject`。

```json
{
  "startupScripts": ["./startup/reset-parts.js"],
  "scripts": [
    { "path": "./organs/human-organs/stomach/motility.ts", "inject": { "stomachGhrelinLevel": ["stomachGhrelin", "relativeConcentration"] } }
  ],
  "catchUpMinutes": 720,
  "scriptTimeoutMs": 10000
}
```

清单中的 `.ts` 模块由 Node 直接做类型擦除，只能使用可擦除语法：`enum`、含运行时值的 `namespace`、参数属性和装饰器不可用；相对导入必须带扩展名；`node_modules` 下的 `.ts` 不会被加载，发布到 npm 时应预编译为 `.js`。

Gateway 用 `initialState` 补齐新部位，并递归补齐已有部位缺失的嵌套对象键；数组整体替换。有存档时继承身体现值、仿真时间、待处理动作和动作记录。`catchUpMinutes` 只限制启动时最多补算多少分钟，随附清单和代码的默认值均为 720 分钟。[当前清单](../body-modules.json) · [恢复实现](../gateway/simulation.js)

#### 停机恢复的 12 小时分界

以下补算只适用于 `active`→`active` 的普通停机；停用后恢复不补算。

- **间隔不超过 12 小时。** 从上次存档逐分钟推进已经过去的完整分钟，恰好 12 小时补 720 轮。
- **间隔超过 12 小时。** 启动脚本结合部位存档、距上次快照的时长 `sinceCheckpointMs` 和重启的现实时刻 `startedAtMs`，计算恢复时的状态。比如昼夜节律可按启动时的当地时刻和预设的相位偏移计算。长停时直接恢复，还是先回放最近 12 小时再修正，留作一个独立的设计选择。

例如，模型刚吃完半块蛋糕，DSH 随即关闭两小时。重启时应连续推进 120 轮，算出那半块蛋糕消化到了哪一步。如果停机前另有已入账、尚未生效的动作，它仍按原回执在对应轮次结算一次。下一次吃饭、喝水或去厕所，要等模型恢复后决定。

启用时，Gateway 先补算并重试在途批次；完成后若没有在途 `activeBatch`，再按 `startupScripts` 的清单顺序调用各脚本导出的同步函数 `initialize(snapshot, context)`，每次启动各执行一次。返回值按部位列出要改写的字段，后一个脚本读取前一个脚本更新过的快照。全部执行完成后，把快照和本次启动记录一并保存，启动日志也输出这份记录。

`context.hasSavedState` 表示启动时是否找到有效存档。`startedAtMs`、`previousStartedAtMs` 是现实时间戳。`sincePreviousStartMs` 从上次启动算起，`sinceCheckpointMs` 从存档中最后一轮对应的现实时间算起，两者均以毫秒计。`caughtUpSeconds` 是实际补算的仿真秒数。`initialParts` 提供模块初值，`resetOnStart` 提供各部位标出的重置字段。initializer 直接读 `context.active` 和 `context.resumedFromPause`，这两个值持久化为 `startup.active` 和 `startup.resumedFromPause`；从 `active: false` 恢复时 `sinceCheckpointMs` 为 0。旧存档从原有快照补算，启动时间从首次使用该功能时开始记录。

默认的 `startup/reset-parts.js` 在运行 initializer 的启动中，将 `resetOnStart` 中列出的字段恢复为模块初值。需要跨重启连续的身体字段不要列入 `resetOnStart`；M1 的胃容量和饥饿素浓度应继承存档。长停时哪些身体字段需要重算、重置或继承，由对应部位的恢复规则决定。

若补算或停用恢复后仍有在途 `activeBatch`（例如上次补算失败或停用恢复保留了批次），本次启动不运行 initializer，保留批次供在线重试；等后续某次启动没有在途批次时再运行，`resetOnStart` 也随之后移。

#### 启用、暂停与恢复

存档顶层的 `active` 是启停开关，只接受布尔值。缺省或旧 v1/v2 缺字段按 `true`；非法值拒绝启动且不回写。关闭 Gateway（退出 DSH、卸载插件）会停止监听、定时器和查询；`active: false` 不同，Gateway 仍启动并可查询，只是不推进身体。

`active` 只在启动时读取一次。在线改文件不生效，下一次保存还可能覆盖。切换步骤：停 Gateway → 只改实际 `statePath` 存档顶层的 `active`（默认 `$DSH_HOME/dsh-body/body-state.json`）→ 再启动。不要改 `startup.active` 或 `activeBatch`；前者是上次启动记录，后者是在途批次，都不是开关。只改这一个字段，不能拿片段替换整份存档，也不能改 `body-modules.json` 代替。当前一具身体对应一个 `statePath`，没有多身体选择器、热切换或按会话路由。

```json
"active": false
```

- **`active: true`（或缺省）**：正常恢复、调度心跳。
- **`active: false`**：不跑初始化脚本、不补算、不调度心跳，`tick()` 不推进；`GET /state`、`GET /actions/:id`、`GET /notifications` 仍可查询，原回执保留。新动作 `POST /actions` 返回 `409`（响应含 `active: false`），既有动作同载荷重试仍返回原回执；`GET /capabilities` 仍为 `200 {}`。暂停不按墙钟裁剪动作，恢复后沿用原有的条数和时间窗保留规则。
- 暂停保留 `activeBatch`、待处理动作、动作记录和通知。恢复从最后提交的仿真时刻继续，不补算停用时长，现实时间锚点移到本次启动；原批次按原目标和顺序先重试，之后才处理恢复后新动作。

### Gateway 分工与常驻 BodyWorker

[`gateway.js`](../gateway.js) 负责启动和关闭。HTTP、存档、动作队列、仿真调度和脚本运行器各有自己的模块。身体启用时，运行器为这一具身体启动一个常驻 BodyWorker。

#### 脚本从 Gateway 接收状态输入

启动时，脚本向运行器登记 `id`、`initialState`、`actionTypes`、`fields` 和 `heartbeat`。每轮由 Gateway 提供 `io.read()`、`io.write()`、`io.notify()`、动作批次和时间参数。

`body-modules.json` 中每个脚本的 `inject` 把函数名映射到轮初身体状态路径 `[partId, ...stateKeys]`。胃脚本通过 `io.functions.stomachGhrelinLevel()` 读取轮初的 `snapshot.parts.stomachGhrelin.relativeConcentration`。各脚本把新计算出的状态交给 Gateway，在轮末一起提交。

模块级常量适合保存固定参数。跨轮变化的身体数据写回 part，通知通过 `io.notify()` 暂存。心跳返回前完成本轮的异步计算，以便整轮失败时从相同输入重试。

#### 清单、存档与内存对象

启动时解析清单和存档，计算与查询使用内存中的对象。

- `manifest` 是启动时读取的脚本清单，包含每个脚本声明的状态读取函数。
- `checkpoint`：主进程内已提交的快照、动作、通知和在途批次。查询直接读内存。提交时先原子替换存档，再更新内存中的版本。
- 模块注册表在常驻 BodyWorker 内保存 `heartbeat`、`fields`、状态路径和初值。模块在 Worker 生命周期内加载一次。

BodyWorker 只持有计算输入和暂存结果。脚本报错、超时或 Worker 退出后，主进程用保留的状态和批次重建计算环境。

#### 一具身体一个常驻 BodyWorker

每轮向 BodyWorker 传递一份轮初快照。各模块依清单顺序读取同一份只读输入，暂存各自 part 的更新和通知，由主进程一起提交。

启动补算复用同一个 Worker，由主进程逐轮接收结果，启动完成时统一落盘。脚本错误或超时会保留已经成功的轮次和失败的 `activeBatch`，上线后从该批次重试。DSH 若在这次启动写入存档前退出，下次从磁盘上最后一次提交恢复。

[`runner.js`](../gateway/runner.js) 提供 `describe`、`initialize`、`heartbeat` 和 `close`，并从主进程监督脚本超时。M1 的轮末体感计划在同一 Worker 内接续执行，读取生理模块暂存结果汇总成的轮末快照。

### 每分钟 heartbeat

清单 `scripts` 中的模块导出唯一的 `id` 和同步或异步的 `heartbeat(io)`。模块可以导出 `initialState` 为新部位提供初值。旧的 `step(snapshot, dt, actions)` 仍可返回本部位的下一状态。

| Gateway 提供的接口 | 含义 |
| --- | --- |
| `io.read(partId?)` | 读取指定部位在轮初的状态。省略 `partId` 时返回整份快照。 |
| `io.write(nextPart)` | 暂存当前模块负责的部位的完整下一状态。 |
| `io.functions[alias]()` | 读取脚本在 `inject` 中为该名称声明的轮初状态。部位或字段缺失时返回 `undefined`。 |
| `io.notify({ mode, sessionId, text })` | 向所有心跳脚本提供，暂存发往指定会话的通知；在线轮次提交后由 `notifications.js` 投递。启动补算产生的通知直接丢弃，但补算轮仍执行脚本并提交状态；若 `brainNotify` 在补算轮触发提醒，`levels` / `lastSentAt` 和小时/天计数照常更新、冷却与配额照常消耗，恢复后同档可能不补发；这是既有限制，需另立独立设计。P1 的提醒入口在 `brain/notify.ts`。 |
| `io.actions` | 本轮开始时确定的只读动作批次，动作在轮末生效。 |
| `io.dt`、`io.simulatedSeconds`、`io.wallTimeMs` | 固定步长 60 仿真秒、本轮结束的仿真时间、预定轮末的现实时间戳（毫秒）。 |

脚本先推进过去一分钟的变化，再处理轮末动作。例如消化脚本先推进原有胃内容物的排空，再加上这次进食。全部脚本成功后，Gateway 按清单顺序汇总状态和通知，并一次提交。

启动脚本用 `snapshot`、`context` 和返回的补丁交换数据。

组织可按需在自己的 `snapshot.parts[id]` 里留少量恢复记录。例如胃模块如果要按上次进食时间推算，可以在动作生效时记下该餐的时间，并与当前胃内容量一起提交。只靠现值就能恢复的组织继续保存现值。各组织共用 Gateway 的时钟和同一份存档。

`scriptTimeoutMs` 默认 10,000 毫秒。运行器用它监督 Worker 响应和每个脚本的装载或执行，包括启动脚本。任一脚本失败或超时，Gateway 结束该 Worker，丢弃整轮暂存结果，保留已提交快照和待处理动作。在线开算前，Gateway 把 `activeBatch`（目标仿真时刻、有序动作 ID、尝试次数）写入存档。重试沿用同一批次和目标，新动作进入后续批次。`GET /actions/:id` 可以查看尝试次数和最后一次错误。

Gateway 在线且身体启用时每 60 个现实秒调度一轮，每轮成功提交后推进 60 仿真秒。计算提前完成就等到下一个预定时刻，已经到期的轮次则依次追赶。每轮实际用时由脚本和运行硬件决定。

### 模型如何提交动作和估算食物

在线模型通过 DSH 工具 `body_act` 提交动作并取得回执；工具把动作原文对应的结构化字段和当前会话 ID 一起入队。模型只需把动作描述清楚，例如“我吃了半块奶油蛋糕”。已知的输入可以直接入账，例如“喝了 200 mL 白水”；动作在后续轮次生效，202 只表示入队。

食物份量需要估算时，在动作入账前用同一个模型发一次独立请求。可参照 DSH 的会话标题插件 `dsh-session-title-llm`，用 `ctx.llm.prepareCall()` 准备调用，单独提供估算用的 `system` 和 `messages`。DSH 的 fork 子代理会继承父会话的角色预设和已完成的对话。独立请求只带动作原文，以及辨认食物、食用者和实际份量所需的上文，让估算模型从旁观者角度判断。

估算只需分清一口、半块和整块的大致差别。比如“我把蛋糕分了一半给你，自己吃完剩下的一半”，就按本人吃下的半块估算。前文给过大小、重量或包装标注时沿用这些信息，份量不详时按常见切块处理。摄入体积 `volumeMl`（mL）和能量 `energyKcal`（kcal）各给一个约数即可。

当前动作载荷（模块自己检查，Gateway 不校验字段）：

- `drink`：`volumeMl` 必填且 `> 0`；`energyKcal` 可选、有限且 `>= 0`（缺省 0）；`carbohydrateG` 可选、有限且 `>= 0`（缺省 0）；`durationMin` 可选。固定按液体处理，`mealKind` 为 `liquid`。白水用 `energyKcal: 0` 或省略；可乐、果汁、牛奶等含能饮料填实际能量和已知的可消化碳水。
- `eat`：`volumeMl`、`energyKcal >= 0`、`mealKind`（`liquid` / `solid` / `mixed`）必填；`carbohydrateG` 与 `durationMin` 可选，碳水规则同饮料。
- `exercise`：`intensity` 必填、有限且 `0 < intensity <= 1`；`durationMin` 必填、有限且 `> 0`；不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。`intensity` 是模型内相对强度，不是 MET、心率、功率或能量消耗；非法强度/时长使整条动作无效，不进入动作队列。
- `carbohydrateG` 的单位是克，表示可消化葡萄糖当量碳水，不是总碳水或纤维；非法值使整条摄入无效。`body_act` 已暴露该可选字段，`body_state` 的返回结构不变。
- 胃动力只对 `eat` 的 `mealKind: "solid"` 分支按固餐小计单独排空，`drink`、`liquid`、`mixed` 仍走原算法，`mixed` 不拆分固液。其他成分比例、黏度、碳酸、甜味剂、温度不进入方程；不能从体积或能量反推碳水。

Gateway 将动作原文和采用的数值随动作 ID 一起保存，工具重试、心跳和重启补算都复用已入账的估值。`stomach` 用采用的体积、能量和碳水更新对应存量；`interoception` 在下一轮读取胃充盈、饥饿素、十二指肠营养暴露、下丘脑口渴驱动与膀胱体积，计算 `hunger` / `fullness` / `thirst` / `urinaryUrgency` 与 `discomfort`。小肠吸收的碳水经 transfer 进入 `glucose`；胰腺相对信号和肾糖排泄已接入糖链，但血糖仍不改变体感或胃排空。

`exercise` 由 `physicalActivity` 接收，只写 `remainingExerciseMin` 与 `intensity`，不直接扣水；`skin` 下一轮按轮初活动写 `sweatRequestMl`，`bodyFluid` 再下一轮按请求把实际汗液转入 `skin.sweatVolumeMl`。活动剩余时间与强度随存档保留，重启可续用；本切片不自动开始运动，也不自动饮水。具体时序和水账见下文「M4 活动—皮肤出汗薄切片」。

### 动作、查询与存档

- **动作入账。** `POST /actions` 将动作排进下一轮并返回回执。一轮开始后收到的动作在后一轮生效。DSH 里的 `body_act` 用来源会话与工具调用的 `callId` 组成动作标识，并把 `sessionId` 随动作载荷入队。同一标识、同一载荷重试时返回原回执；同一标识、不同载荷返回 `409`。没有模块声明该类型时返回 `422`，且不创建回执。 [DSH 工具执行信息](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools) · [LifeBody 动作接口](https://github.com/ShuangziG/maibot-body-emulator/blob/v1.2.4/docs/%E5%8F%AA%E8%AF%BB%E7%8A%B6%E6%80%81API.md)
- **状态查询。** `body_state`、`GET /state` 和浏览器读取最近一次提交的内存快照；`body_state` 可按部位过滤，`GET /actions/:id` 查询单条动作，`GET /capabilities` 查询可处理的类型，`GET /health` 查询时钟和心跳健康。一轮执行期间，查询继续返回上一次提交的状态和仿真时间。
- **动作记录与存档恢复。** 存档 v2 保存 `schemaVersion`、`active`、`snapshot`、`pendingActionIds`、`actions` 和 `activeBatch`。每条动作记录包含原始载荷、载荷指纹、状态（`queued` / `applied` / `failed`）、预定和实际生效时刻、批次、尝试次数及最后一次错误。`applied` 表示所在批次成功提交，不表示模块一定改变了状态；领域效果以模块自己的 part 记录为准。`queued` 和在途动作永不裁剪，`applied` / `failed` 按条数或时间窗口保留。每轮成功后把新快照、动作状态和批次记录一起写到临时文件，再替换存档。普通停机重启后按停机时长恢复身体，随后恢复定时推进。 [LifeBody 仿真与存档配置](https://github.com/ShuangziG/maibot-body-emulator/blob/v1.2.4/docs/%E9%85%8D%E7%BD%AE%E6%8C%87%E5%8D%97.md)

后续若加入日程联动，调度模块可向 DSH 提供日程事件，由模型决定是否发出相应动作。

### 神经系统的体感与通报

**只有神经系统向会话通报身体感受。** 各器官负责更新生理状态，感觉器提供局部感觉信号。神经只作为功能标签保留；P1 已在 `brain/interoception.ts` 实现体感读出、在 `brain/notify.ts` 实现提醒策略，`index.js` 的 `notifications.js` 负责投递。当前提醒发给“最近一次带 `sessionId` 的动作所属会话”；完整的多会话路由与按会话绑定身体仍未实现。

体感与提醒在一次心跳内按以下顺序处理：

1. 胃和饥饿素等生理脚本读取轮初快照。胃先计算过去一分钟的排空，再把轮末吃下的半块蛋糕计入胃内容量。
2. Gateway 汇总各部位结果，形成尚待提交的轮末快照。`brain/interoception.ts` 用轮初的胃充盈、相对饥饿素、十二指肠营养暴露、下丘脑口渴驱动与膀胱体积更新 `hunger` / `fullness` / `thirst` / `urinaryUrgency`，并汇总 `discomfort`。
3. `brain/notify.ts` 读上一轮的 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency` 与 `bladder.voidedMl`，以及本轮原始动作中 `type: "urinate"` 的动作和 `sessionId`，按显著性、滞回、冷却和配额决定是否 `io.notify`。Gateway 将身体状态、体感和本轮通知一次提交；任一阶段失败就按原批次重算。
4. `notifications.js` 每 1000 ms 轮询待确认通知：`context` 用 `agent.inject`，`wake` 用 `agent.followup`；投递成功后 ACK。

**提醒不是每轮播报。** `brainNotify` 读轮初 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`、最近提交的 `bladder.voidedMl` 和本轮动作里的 `urinate`，在任一体感达到“明显”或“强”档位时提醒。饥饿、饱满、口渴与尿意的阈值都是 65/85 mm；用于门控的 `levels` 只记录 0/2/3，40–64 mm 的观测中间档按 0 计；缺失或非有限读数按饥饿 50、口渴 50、饱满 / 尿意 0 处理。每个信号单独记录滞回水位（`brainNotify.sessions.<sessionId>.levels = { hunger, fullness, thirst, urinary }`）：同一信号重复同一档，需先低于已提醒档让水位回落；升到比水位更高的档（如 2→3）可直接提醒。`lastKind` 记录最近一次实际提醒的信号（可为 `thirst`）；`lastLevel` 保留下降闩锁（提醒时置为发送档位，之后当前档位更低时下降，可为 1），并作为旧档迁移来源，不只是摘要。每轮最多一条：在尚未提醒到当前档位的候选中先取档位最高者，同档按 `urinary > thirst > fullness > hunger`；未被选中的信号不消耗水位。45 仿真分钟冷却、每小时 2 次、每天 6 次按会话共享，不按信号拆分。明显档位用 `context`（不唤醒），强档位用 `wake`（唤醒）；文本固定，不带膀胱数值、诊断结论或排尿指令。最近提交快照的 `bladder.voidedMl > 0` 或本轮动作含 `urinate` 时，只抑制尿意候选：该轮不产生尿意提醒且 `levels.urinary` 按 0 回落；饥饿、饱满、口渴等其他信号仍按各自水位参与选择，不受影响。口渴没有动作后抑制：`drink` 只在胃、小肠吸收后改变 `waterDeficit`，不会在动作轮把 `levels.thirst` 清零，也不自动饮水。旧会话缺少 `levels` 时按 `lastKind` / `lastLevel` 惰性迁移（`lastKind` 可为 `thirst`）；已有 `levels` 缺少 `thirst` 时只补 `thirst = 0`，其他信号水位不变。`brainNotify` 不调用 `urinate`、`drink` 或 `exercise`；`discomfort` 仍没有提醒通道。上述提醒参数的 `status` 都是 `design`，属于提醒 `policy`，不是人体测量、临床尿急界值或口渴阈值。模块仍读轮初快照；`notify` 在 `interoception` 之上再晚一轮，尿意提醒相对轮初膀胱变化为两轮（预置 410 mL 后第 1 轮只更新体感，第 2 轮才提醒），口渴链路多一级下丘脑→体感，预置一致的 `waterVolumeMl = 29650`、`waterDeficit = 0.7` 时第 3 轮才提醒强口渴。启动补算丢弃通知，但补算轮若触发提醒仍提交本节状态、消耗冷却与配额，恢复后同档可能不补发；这是既有限制，需另立独立设计。会话 A/B 的计数分开；当前只有最近一次动作的会话收到提醒。

#### 投递与确认

Gateway 的 `GET /notifications` 返回待确认队列，目前最多保留 200 条。每条含 `id`、`mode`、`sessionId`、`text` 和创建时刻。当前通知没有来源脚本、体感类型或等级字段；`brainNotify.sessions` 用 `lastKind` 记录最近一次实际提醒的信号（`hunger` / `fullness` / `thirst` / `urinary`）、`lastLevel` 保留下降闩锁并作为旧档迁移来源，逐信号 `levels` 负责实际门控；这些信息供排查用。

- `context` 使用 `agent.inject` 将内容放入上下文，供后续模型调用读取，空闲会话继续等待。
- `wake` 使用 `agent.followup` 为目标会话安排一轮模型调用，空闲会话会被唤醒。 [DSH Agent 接口](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core#the-agent-handle)

投递泵对每个通知构造 `source.kind = "body-notify"` 的 user-role 消息，避免冒充真人输入。会话不在线时通知保留在 Gateway 队列；投递成功后 ACK；ACK 失败时下次只重试 ACK，不重复投递。通知历史文件与 `agent/inbox/inserted` 确认尚未实现：当前 ACK 表示“已交给会话收件箱”，不表示模型已读或已经消费。

### 会话里的身体

- `index.js` 通过 `ctx.tools.register` 注册 `body_act` 和 `body_state`，共用当前 DSH 进程里的 Gateway；工具随插件卸载自动注销。 [DSH 工具注册](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook) · [DSH 生命周期](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core)
- `body_act` 把结构化动作连同 `sessionId` 交给 Gateway；动作 id 由会话 ID 与工具 `callId` 稳定生成，重试复用同一回执。`body_state` 返回最近一轮的 `simulatedSeconds` 和 `parts`，可按部位过滤。202 queued 只表示入队，不表示已生效。
- `brain/notify.ts` 为会话筛选提醒：饥饿、饱满、口渴或尿意达到明显档位用 `context`，强档位用 `wake`，同一会话共享冷却与每小时/每天次数上限；它不自动排尿、饮水或运动，是否调用 `urinate` / `drink` / `exercise` 仍由会话决定。SFW / NSFW 会话选择、按会话绑定不同身体与通知历史尚未实现。

### 浏览器数据页

在 DSH Web 加一个只读页面，从 Gateway 获取当前快照、指定时间范围的曲线和事件。

| 页面 | 可以查看的数据 |
| --- | --- |
| 当前状态 | 仿真时间、正在做的身体动作、姿势、当下显著的体感 |
| 身体系统 | 按器官与功能标签查看指标和历史曲线。各激素的生产速率、现有浓度和靶点作用在同一仿真时刻采样，可与血糖、体液渗透压、困意等跨指标对照。 |
| 身体分区 | 按左、右或具体部位对照运动与被皮状态，以及相应的感觉信号。 |
| 病况与事件 | M5 展示近期动作记录。M6 展示已配置的基础病。M7 展示当前病况的阶段、触发条件和受影响的部位。 |

## 6. 里程碑与实机验收

每个里程碑在实际 DSH 实例里验收，通过后再接下一项。

P1（已完成）覆盖“吃/喝 → 胃排空 → 十二指肠营养暴露 → 体感读出 → 会话提醒”的链：`interoception.hunger` / `fullness` 是代理读数，`brainNotify` 做显著性/滞回/冷却/配额，`body_act` / `body_state` 与通知投递已接入。胃动力在 `volumeMl` / `energyKcal` 总量内保存固餐小计 `solidVolumeMl` / `solidEnergyKcal`：只有 `eat` 的 `mealKind: "solid"` 按单独的固餐参考半时（68.7 min，标记固相半排空时间中位数）排空，`drink`、`liquid`、`mixed` 与旧存档中已经入胃的存量仍走原算法，旧档 `mealQueue` 里尚未释放的切片继续按各自 `mealKind` 入账，`body_act` / `body_state` 参数不变。体感仍经胃充盈、相对饥饿素与十二指肠营养暴露间接反映这些总量与通量：体感字段不变，数值会随分组后的总量与排出量变化；只有查询原始 `stomach` 部位或整身状态时才会看到两个固餐小计。M1 的真实 DSH 会话验收已完成；通知历史文件、模型已读确认与按会话绑定不同身体仍未实现。M3 水链首段已实现脚本、参数、定向测试与现状文档并接入根清单（Tasks 1–9）；多轮水账本补测与 Task 11 当时 12 部位逐轮性能基线已完成（Task 11，spec §8；早于非自主排尿、`discomfort` 与 DI 变体，属历史基线），论文可比数据对照已记录（Task 12，spec §7），但大负荷利尿仍不匹配、口咽解渴支路未建，不能写成整体符合论文；Task 10 真实 DSH 会话验收已完成（30 轮 A/B + 排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`；早于后加功能）；膀胱过度充盈非自主排空、`discomfort` 与 DI 样变体已实现并有定向测试，且由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴未验证；睡眠与排便调研仍为 defer；M2 的碳水—血糖薄切片已另行批准并实现，后续又接入胰腺相对信号与肾糖质量排泄；M4 的活动—皮肤出汗薄切片已实现（`exercise` → `physicalActivity` → `skin.sweatRequestMl` → `bodyFluid` 双出口 → `skin.sweatVolumeMl`，默认 30 min 累计 18 mL，见下节）；完整 M2（含肝糖、胰高血糖素与组织摄糖分区）、完整 M4（肌群负荷/疲劳/延迟酸痛/皮肤分区）与 M5–M7 仍是设计目标。

### 首期优先完成（M1–M4）

M1 已完成；M1–M4 全部通过实机验收后，首期交付完成。首期用会话工具观察体感，从 Gateway 的开发日志核对仿真数值。

| 里程碑 | 交付范围 | DSH 实机验收 |
| --- | --- | --- |
| M1 · 基础身体与进食 | Gateway 加载身体预设、免疫档位和脚本清单。胃动力、胃饥饿素与胃壁机械感受脚本从轮初快照计算进食、排空和信号变化。神经系统读取轮末结果，体感与身体状态一次提交。 | 核对自定义参数和部位档位。在会话 A 提交“吃了半块奶油蛋糕”并重试，从会话 B 观察共享体感，在存档中确认同一动作只入账一次且沿用原估值。核对生理脚本按清单顺序读取同一份轮初快照，执行期间提交的动作在下一轮生效。让一个脚本超时，核对整轮状态和通知作废，待处理动作保留，成功重试后推进 60 秒。观察会话空闲时的胃排空，停机两小时后再核对这次进食的消化进度和恢复时的饱腹感。 |
| M2 · 餐后血糖 | **薄切片已实现：** `carbohydrateG` → 胃碳水 → 小肠吸收 → `glucose` 可及池质量/浓度代理，使用固定分布体积、基线和表观清除参数；`pancreasEndocrine` 相对信号缩放非肾表观清除，`kidneyGlucose` 按请求转出实际 g 质量，质量账含肾排泄。**完整目标仍未实现：** 肝糖输出、组织摄糖、胰岛素浓度/分泌、胰高血糖素和皮质醇调节。 [Dalla Man 等，图 2 和式 (1)、(13)、(18)](https://isbgroup.eu/files/Dalla%20Man%202007.pdf) | 已有当时 13 部位的 A/B、逐轮质量账、固体队列和吸收后重启测试，以及后续 15 部位的胰腺/肾糖集成测试；真实 DSH 会话、两种同碳水餐型、胰岛素状态和独立血糖曲线对照仍未验收。 |
| M3 · 饮水与睡眠 | 水链首段（饮水吸收、ADH、肾请求、膀胱与主动排尿）的脚本、参数、定向测试与文档已实现并接入根清单（Tasks 1–9）；多轮水账本补测与 12 部位性能基线已完成（Task 11，历史基线），论文对照已记录（Task 12，大负荷利尿仍不匹配）；Task 10 真实 DSH 实机验收已完成（30 轮 A/B + 排尿重试/409）；膀胱非自主排空、`discomfort` 与 DI 样变体已实现并有定向测试，且由 M19 真实 DSH 会话补验（33/33 verdicts，2–5 轮短会话）；120 轮长时程、通知/重启、大负荷利尿与口咽解渴未验证；睡眠压力与褪黑素节律经调研后暂缓（defer），未实现。 | 水链的 Task 10 实机验收已完成：从同一起点比较饮水与不饮水，核对吸收、口渴、ADH、产尿与尿意，并验证 `urinate` 与同调用重试；M19 又用真实 DSH 会话补验了非自主排空、`discomfort` 与 DI 样变体（33/33 verdicts，只覆盖 2–5 轮短会话）；120 轮长时程、通知投递与重启补算仍待后续实机验收；睡眠已 defer，不在近期验收范围。 |
| M4 · 活动与身体分区 | **薄切片已实现：** `body_act` 的 `exercise { intensity, durationMin }` → `physicalActivity` 剩余活动/强度 → `skin.sweatRequestMl` → `bodyFluid` 肾尿+汗液双出口 → `skin.sweatVolumeMl`；默认 25°C、`I=1`、30 min 累计 18 mL，无活动时 0，口渴沿用既有轮初快照，水账增加实际汗液，不自动饮水。**完整目标仍未实现：** 以左右小腿为第一组分区，接入肌群负荷、疲劳、延迟酸痛和同一区域的皮肤状态；METs、心率、体温调节、电解质与皮肤分区不在本切片。 | 已有活动/皮肤模块、双出口与真实 Gateway 水账测试；真实 DSH 会话、单侧离心活动对照、独立人体出汗数据与临床验证未做。 |

### M3 饮水与排尿：首段实现状态

**脚本已实现并接入根清单（Tasks 1–9）；多轮水账本补测与 12 部位性能基线已完成（Task 11，历史基线），论文对照已记录（Task 12）；Task 10 真实 DSH 验收已完成（30 轮 A/B + 排尿重试/409）；后加的非自主排空、`discomfort` 与 DI 样变体由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts，2–5 轮短会话）；120 轮长时程、通知/重启、大负荷利尿与口咽解渴仍未验证；Task 10/11 都早于后加功能合并。** 胃水链入口 `hydration.ts` 把 `drink` 的全部体积记为水，小肠 `water-absorption.ts` 吸收轮初肠水，`bodyFluid` 维护体液水与亏缺代理，`kidney` 只算下一轮产尿请求，下丘脑 `hypothalamus-adh.ts` / `hypothalamus-thirst.ts` 分开算 ADH 与口渴，`bladder` 储尿、结算主动 `urinate`，并在轮初体积严格大于 600 mL 且无 `urinate` 时非自主排空到排后余量；`interoception` 另输出 `discomfort`（饥饿、饱满、口渴、尿意超过 70 mm 的强度取最大值）。十二指肠脚本仍只计算营养暴露，不负责水吸收。

首段打通一条可核对水量的链：**喝水 → 胃排空 → 小肠吸收 → 体液反馈 → ADH 调节肾脏产尿 → 膀胱充盈 → 主动排尿或过度充盈非自主排空**。口渴、尿意与不适是独立的读出信号。不用「喝完定时加尿量」代替肾脏反馈，也不要求第一段就覆盖完整的水盐与血压调节。

| 功能标签 | 当前脚本 | 读写边界 |
| --- | --- | --- |
| 消化 | `stomach/hydration.ts`、`small-intestine/water-absorption.ts` | 胃只转出非固餐排出中的水 `emptiedWaterMl`；小肠只吸收轮初肠水。胃总内容量、`emptiedMl` 和 `emptiedKcal` 均不能充当饮水水量。 |
| 体液隔室 | `human-compartments/body-water/water.ts` | 接收吸收水，按 `kidney.urineProductionRequestMl` 向膀胱转水；M4 薄切片另按轮初 `skin.sweatRequestMl` 向皮肤转实际汗液，见下节。已进入膀胱或皮肤的水不再算体液。只输出 `waterDeficit` 代理，不叫实测血浆渗透压。 |
| 神经内分泌（下丘脑） | `brain/hypothalamus-adh.ts` | 用 `bodyFluid.waterDeficit` 调相对 ADH 水平；`relativeConcentration` 不是 pmol/L。ADH 由下丘脑合成、由垂体后叶释放；肾脏是靶点，不是其来源。 |
| 神经（下丘脑） | `brain/hypothalamus-thirst.ts` | 读同一亏缺，写 0–100 mm 口渴驱动；不写 ADH，不自动替会话喝水，首段不建吸收前口咽缓解。 |
| 泌尿 | `kidney/urine-production.ts`、`bladder/storage.ts` | 肾只写下一轮请求，不转移水；体液所有者按轮初请求结算转移；膀胱储存已转入的尿量，`urinate` 结算轮初体积，轮初严格大于 600 mL 且无 `urinate` 时非自主排空到排后余量；两种排尿都不扣体液，也不另设储尿激素。600 mL 是 `design` 工程阈值，不是临床失禁模型。 |
| 神经（体感） | `brain/interoception.ts` | 读出 `thirst`、`urinaryUrgency` 与 `discomfort`（四感受超过 70 mm 的强度取最大值）；`brainNotify` 读 `hunger` / `fullness` / `thirst` / `urinaryUrgency` 做四类提醒，不读不适，也不接管排尿、饮水或运动反射；是否 `urinate` / `drink` / `exercise` 仍由会话决定。 |

目录仍归器官；体液是隔室，放在 `organs/human-compartments/body-water/`；下丘脑的两种功能放在脑的同一区域下，分成两个脚本，系统名只做标签。睡眠节律另拆（调研已 defer），不把 `active: false` 当生理睡眠。本段也不建排便（结肠、直肠、便意调研已 defer），或肾素–血管紧张素–醛固酮系统（待接水盐、循环时再做）。DI 样变体是独立清单/存档中的可选入口，不是默认身体的一部分。

**接入与验收。** 沿用两个会话工具：`body_act` 仍接受 `drink` / `eat` / 无份量参数的 `urinate`，并新增 `exercise`；M3 的验收只覆盖前三类，排出量由膀胱轮初存量决定；根清单已加载 `bladder`。`body_state` 按部位读取体感，包括 `discomfort` 与膀胱四个字段；提醒只由 `brainNotify` 在饥饿、饱满、口渴或尿意达到明显/强档时发出，不新增每轮上下文注入，也不自动排尿或饮水。过度充盈非自主排空由 600 mL 阈值触发，没有动作、回执或通知；它不是持续的自动排尿或失禁模型。水量用 `io.transfer` 配对提交，不跨量纲扣账；进膀胱时已扣除体液，排尿时不能再扣一次。旧档不猜历史饮水，不重置胃值；旧自定义清单仍可只加载原胃脚本 `motility.ts`。实机从同一起点比较饮水与不饮水，核对吸收、口渴、ADH、产尿及尿意的变化；再观察一次排尿及同调用重试，核对只计一次排出。多轮队列水恒等式已补测（Task 11），离线测试与真实 Gateway 测试已覆盖模块守恒、根清单集成，以及非自主排空、分项与 `discomfort`（`test/organs.bladder.test.mjs`、`test/organs.interoception.test.mjs`、`test/organs.water-gateway.test.mjs`）；Task 10 已用真实 DSH 会话完成 30 轮 A/B 与主动排尿重试/409，但早于非自主排尿与不适合并；M19 又在真实 DSH 会话中补验了 650 mL 非自主排空（同轮新尿留下、下一轮尿意/不适回落）、主动优先/重试/409 与 DI 三组清单（请求 1/4/4 mL，通知 0，33/33 verdicts；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）。650 mL 预置与预置会话的稳态 1 mL 请求是测试设定，不是模型输出；DI 对照正常会话 sim 300 的 0.9998 mL 是模型输出。M19 只覆盖 2–5 轮短会话；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴仍未验证。

**证据与参数状态。** 所有新参数都是 `design`，论文只支撑方向与时间尺度：Péronnet 2012 只给 D₂O 吸收的探索时间尺度，20 min 半时不是论文值；Ota 1994 主队列是 5 名甲减患者加 5 名正常对照，只支撑水负荷后 AVP 降、尿变稀的方向；Andersen 1990 只支撑肾反应可延迟；Figaro & Mack 1997 只支撑口咽解渴与持续补液可分开，首段不建该支路；De Wachter & Wyndaele 2003 目前只核对到摘要（15 名健康女学生，190/268/410 mL 是交接数值、原文表图待核），410 mL 只作尿意归一化锚点；ICS 术语只给“排前量 = 排出量 + 残余量”的记账关系，不规定正常残余量。600 mL 非自主阈值与 70 mm 不适起始值同样没有直接来源，都是 `design` 工程代理；`brainNotify` 的 65/85 mm 尿意阈值、`resetBelow=40 mm`、45 min 冷却与次数上限等提醒参数的 `status` 都是 `design`，属于 `policy`；其中 `resetBelow` 只区分观测 0/1 档，用于门控的 `levels` 只存 0/2/3、40–64 mm 的中间档按 0 计，同档重复需先低于已提醒档，升更高档可直接提醒。它们都不是人体排尿阈值或临床尿急界值；三篇 DI 综述只支撑机制方向与 >3 L/day 量级，4 mL/min 不是论文值。逐篇边界见各器官 README 与 [`references/`](../organs/human-organs/references/)。

**未建：** 睡眠、排便、完整胰岛素/肝糖/胰高血糖素/组织分区糖代谢、血浆/尿渗透压、电解质、血容量/血压、RAAS、不感蒸发、口咽解渴、自动饮水；汗液只有显式运动薄切片，不建体温调节、汗液电解质或皮肤分区。过度充盈非自主排空已实现，但它只是 600 mL 阈值代理，不是持续漏尿、正常排尿反射或临床失禁模型。碳水—血糖薄切片、胰腺相对信号与肾糖质量排泄已实现；肾糖只是 g 质量汇，不产生尿水或尿糖浓度，不能当成完整 M2 糖代谢。

### M4 活动—皮肤出汗薄切片：当前实现

当前链为 **`exercise` → `physicalActivity` → `skin.sweatRequestMl` → `bodyFluid` 双出口（肾尿 + 汗液）→ `skin.sweatVolumeMl`**。它只把显式运动变成可对账的体液失水；默认没有活动时不出汗，既有水账与口渴轨迹不变。

`body_act` 的 `exercise` 载荷为 `{ type: "exercise", intensity, durationMin }`：

- `intensity` 必填、有限且 `0 < intensity <= 1`；1 是模型内最大相对强度，不是 MET、%VO₂max、心率、功率或能量消耗。
- `durationMin` 必填、有限且 `> 0`；不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。
- 非法值使整条动作 400/不入队；动作 ID、会话与重试幂等沿用既有 `body_act`。模块层再按同一规则校验，非法动作不改变活动状态。

| 部位 / 脚本 | 字段（单位） | 读写边界 |
| --- | --- | --- |
| `physicalActivity` / `skeletal-muscle/activity.ts` | `remainingExerciseMin` (min)、`intensity` (1) | 只读自己的轮初状态与本轮 `exercise`；先按 `io.dt` 递减，再取本轮最后一个合法动作替换，不累加时长；不扣水、不发通知 |
| `skin` / `skin/sweat.ts` | `sweatRequestMl` (mL/下一轮)、`sweatVolumeMl` (mL/轮) | 只读轮初活动与固定环境参数；每轮先写请求并把实际汗液归 0，实际量只由 `bodyFluid` 的 transfer 增加；不持有体液水 |
| `bodyFluid` / `human-compartments/body-water/water.ts` | `waterVolumeMl`、`waterDeficit` | 唯一从体液转出尿与汗的部位；读取轮初 `kidney.urineProductionRequestMl` 与 `skin.sweatRequestMl` |

出汗请求在 60 s 轮、默认环境 25°C、`I=1` 时为 0.6 mL；公式与参数：

```text
temperatureFactor = max(0, 1 + 0.04 × (T − 25))
rate = R > 0 ? min(2, 0.6 × I × temperatureFactor) : 0
sweatRequestMl = rate × dtMin
```

`ambientTemperatureC = 25`、`referenceRateMlPerMin = 0.6`、`ambientGainPerC = 0.04`、`maxRateMlPerMin = 2` 全部为 `design`、`source: null`，位于 `skin/sweat.parameters.json`。它们不是人体出汗测量、体温调节或最大出汗率；`range` 只是工程调参范围。

体液双出口按轮初水结算：

```text
U_kidney = clamp(R_kidney, 0, W_start)
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → skin: U_sweat
```

两路合计不超过轮初 `W_start`，小肠同轮流入不能支付本轮尿或汗；先 write 后两个 transfer，实际汗液只经 transfer 进入 `skin.sweatVolumeMl`。水账在既有恒等式上增加累计实际汗液：

```text
胃水 + 队列水 + 小肠水 + (体液水 − 初始体液水)
+ 膀胱尿 + 累计 voidedMl + 累计 skin.sweatVolumeMl
= 累计饮水
```

`skin.sweatRequestMl` 不进水账；请求是意图，实际汗液受轮初可用水钳制。无活动时两项均为 0，恒等式与 M3 一致。

**默认时序。** 60 s 一轮、25°C、`I=1`、`durationMin=30`：第 1 轮活动状态更新，皮肤仍读旧活动、请求 0；第 2 轮皮肤写出 0.6 mL 请求，体液仍读旧请求；第 3 轮体液首次转出 0.6 mL 实际汗液。第 2–31 轮共 30 次请求、第 3–32 轮共 30 次转移，累计 18 mL；第 32 轮活动已归零，第 33 轮起请求与实际均为 0。18 mL 是模型内水账/时序核对，不是实测汗量。

**口渴与旧档。** 体液下降后，口渴仍由既有 `waterDeficit → hypothalamusThirst → interoception` 按各自轮初快照逐轮读出；本切片不新增通知、不改阈值、不自动饮水。旧档只补 `physicalActivity = { remainingExerciseMin: 0, intensity: 0 }` 与 `skin = { sweatRequestMl: 0, sweatVolumeMl: 0 }`，不反推历史活动或出汗；已有体液、膀胱和饮水状态不重置。重启保留活动剩余时间/强度，已扣汗液不重复扣。

**清单与依赖。** 根清单当前 17 个部位、19 份参数文件（3 份 DI 变体不随根清单加载）。7 部位硬 transfer 闭包为 `hydration.ts`（胃）、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`skin`；缺 `skin` 时 `bodyFluid.waterVolumeMl` 的 `transferOut` 目标未声明，启动即失败。`physicalActivity` 只是 `skin` 的普通轮初读取，不构成 transfer 配对依赖。直接调用体液模块时缺皮肤请求按 0；完整 Gateway 清单不能用这个回退绕过 `skin` 配对。

**验收状态。** 活动 8/8、皮肤 10/10 模块测试与真实 Gateway 水账测试通过；默认 30 min 累计 18 mL、无活动 golden 轨迹、旧档补零和重启用例均在 `test/organs.sweat-gateway.test.mjs` 等定向测试中覆盖。**未做：** 真实 DSH 会话、独立人体出汗数据或临床验证。

**未建模。** 不建 METs、热量/能量消耗、摄氧量、心率、血压、血气、肌糖原、乳酸、疲劳、睡眠、运动类型、姿势、核心/皮肤温度、体温调节、皮肤分区/湿润度、蒸发残余、汗液电解质、环境热应激、疾病或个体差异；`intensity` 只是模型内相对强度。汗液只以 mL 表示，不换算成 METs、热量、心率或代谢率。

设计见 [`2026-11-23-activity-sweat-design.md`](./superpowers/specs/2026-11-23-activity-sweat-design.md)；活动与皮肤字段细节见 [`skeletal-muscle`](../organs/human-organs/skeletal-muscle/README.md) 与 [`skin`](../organs/human-organs/skin/README.md)；体液双出口见 [`body-water`](../organs/human-compartments/body-water/README.md)。

### M2 碳水—血糖薄切片：当前实现

当前链为 **`drink` / `eat.carbohydrateG` → 胃碳水记账 → 小肠吸收 → `glucose` 可及池 → 胰腺相对信号调节非肾表观清除；肾糖按请求把 `glucoseMassG` 转成 `kidneyGlucose.excretedGlucoseG`（g，不换尿水）**。`carbohydrateG` 是可选、有限、非负的克数，表示可消化葡萄糖当量碳水；缺省为 0，非法值使整条摄入无效，不能从体积或能量反推。

胃复用既有固/非固餐排空比例，小肠只吸收轮初碳水。三个 transfer 配对都以 g 为单位：

```text
stomach.carbohydrateG        → smallIntestine.carbohydrateG
smallIntestine.carbohydrateG → glucose.glucoseMassG
glucose.glucoseMassG         → kidneyGlucose.excretedGlucoseG
```

胃总碳水由 Gateway 扣转移量，`solidCarbohydrateG` 是其中固餐子集并由胃脚本预先扣除本轮固体排空，不能重复加总或双扣。多轮队列保存碳水余量，旧档缺碳水按 0；legacy `motility.ts` 不保留碳水队列元数据。

`glucose` 以 75 kg、`1.88 dL/kg`、90 mg/dL 和 60 min 基线表观清除半时作为固定边界，均为 `design`；60 min 是 `I = 1` 时的基线，胰腺接入后清除指数按轮初 `insulinRelative` 缩放。分布体积只借 Dalla Man 2007 的可及池定义与平均模型量级，不是血浆体积或个体实测；基线是初始量和清除下限，低于基线时不虚构肝糖补回。浓度按轮初质量计算：默认摄入第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收、第 4 轮才看到浓度读数上升；胰腺在第 4 轮仍读旧 90、第 5 轮写升高信号、第 6 轮葡萄糖才首次加快清除。

`pancreasEndocrine` 只写无量纲 `insulinRelative`（1 为基线），不是胰岛素浓度、分泌率、C-peptide 或实测值；0.02 增益、10 min 半时和 5 倍上限都是 `design`、`source: null`。`kidneyGlucose` 读取轮初浓度和 `io.dt`，写出下一轮 `excretionRequestG` 并把 `excretedGlucoseG` 每轮归 0；`glucose` 在非肾清除后按轮初请求结算 transfer，请求本身不进入质量账。肾糖阈值和滤过锚点来自 Dalla Man 2007 正常组 `k_e1 = 0.0005 min^-1`、`k_e2 = 339 mg/kg`（`prior`），1.88 dL/kg 与 75 kg 是重复配置的 `design`。肾糖只记 g 质量汇，不计算尿量、尿糖浓度或渗透性利尿。

外源碳水质量账在原有各项上增加实际肾排泄：

```text
累计摄入碳水
= stomach.carbohydrateG
+ Σ mealQueue.remainingCarbohydrateG
+ smallIntestine.carbohydrateG
+ (glucose.glucoseMassG − B)
+ 累计 disposedGlucoseG
+ 累计 kidneyGlucose.excretedGlucoseG
```

`disposedGlucoseG` 只表示非肾表观清除；`excretionRequestG` 不累计，只有实际 `excretedGlucoseG` 才从 `glucose.glucoseMassG` 转出并计入。完整水/碳水闭包必须同时包含 `hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`kidneyGlucose`、`skin` 七部位（活动—出汗薄切片加入 `skin` 出口）；缺任一 transfer 配对在启动时报错。根清单当前 17 部位、19 份参数文件。

模块和真实根清单 Gateway 测试覆盖同体积/能量 A/B、逐轮外源碳水质量账、三轮固体队列、非基线吸收后重启和旧档默认值；当时 13 部位验收记录保留，后续 15 部位集成测试覆盖胰腺 `I = 1` 基线、第 4/5/6 轮与肾糖跨阈后请求/结算；活动—出汗薄切片接入后当前根清单 17 部位，见上文 M4 节。真实 DSH 会话、长期曲线和独立生理数据对照未做。胰腺与肾糖读取血糖；体感或胃排空仍不读取血糖，四类通知也不含血糖。完整设计见 [`2026-11-22-carbohydrate-glucose-design.md`](./superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)、[`2026-11-22-pancreas-insulin-design.md`](./superpowers/specs/2026-11-22-pancreas-insulin-design.md) 与 [`2026-11-23-renal-glucose-design.md`](./superpowers/specs/2026-11-23-renal-glucose-design.md)。

**仍未实现：** 胰岛素浓度/分泌、胰高血糖素、肝糖输出、糖原、慢速组织隔室、组织摄糖分区、渗透性利尿、血糖对体感或胃排空的反馈，以及任何自动行为。

**调研与后续重审。** 睡眠和排便的调研结论仍是暂缓。糖代谢调研最初也暂缓；用户随后明确“共享 JSON 状态交互即可分阶段交付，不要求行为闭环”，本轮因此只实现上述薄切片。调研和路线图的完整 M2 目标不因这次实现而视为全部批准或完成。

### 后续里程碑（M5–M7）

| 里程碑 | 交付范围 | DSH 实机验收 |
| --- | --- | --- |
| M5 · 浏览器数据页 | 按器官与功能标签查看已接入的指标、历史曲线和动作事件。 | 在会话执行动作，从浏览器对照同一仿真时刻的动作和曲线。重启后可继续查询状态和在途事件。 |
| M6 · 基础病 | 在身体预设中接入持续参数修正，先选胰岛素抵抗等已有条目验收。 | 从相同的血糖和胰岛素浓度开始，给两个预设安排同一餐，比较靶点响应和血糖走势。 |
| M7 · 当前病况 | 接入病况触发、阶段推进与恢复。已有的乳糖相关腹胀、局部皮肤刺激和肌肉拉伤可作为首批案例。免疫相关规则在此阶段接入部位档位。 | 对照症状的起效和恢复过程。发作中重启 DSH，核对病况部位、阶段和恢复进度从存档接续。 |

### M1 管理项

| 部位 | 管理项 | 记录及计算方式 |
| --- | --- | --- |
| `stomach`（胃动力） | 胃内容量 | 保存胃内容量（mL）与总能量（kcal）；`solidVolumeMl` / `solidEnergyKcal` 是其中固餐小计。固餐小计按 `solidHalfTimeMin`（68.7 min，`design`，Vasavid 2014 的标记固相半排空时间中位数）一阶排空，其余内容物走原能量密度算法；`emptiedMl` 只作观察，`emptiedKcal` 供十二指肠读取，体感经间接信号反映分组结果。 |
| `stomachGhrelin`（胃内分泌） | 饥饿素 | 每轮记录相对浓度与距上次含能摄入的分钟数；含能 `eat` / `drink` 在当轮压到不高于谷值并清零计时，无含能摄入时按表观半时恢复，并按经批准的空腹时长工程曲线上升（180 min 后目标从餐间基准按 120 min 表观半时升向 1.8；均 `design`）。仍不建模餐时表、餐前预期、昼夜节律、能量剂量响应、多日饥饿适应与能量不足病理；曲线不是人体标定或实机验收。 |
| `stomachSensory`（胃壁机械感受） | 胃充盈信号 | 根据胃内容量估算归一化机械感受代理；P1 由 `interoception` 读取。 |
| `interoception`（体感读出） | 饥饿 / 饱满 | 每轮读取胃充盈、相对饥饿素与十二指肠营养暴露，按线性 `design` 模型写 0–100 mm VAS 代理；P1 已实现。 |
| `brainNotify`（体感提醒） | 提醒策略 | 读 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`、最近 `bladder.voidedMl` 与本轮 `urinate`；四类信号都用 65/85 mm 明显/强档阈值，`levels = { hunger, fullness, thirst, urinary }` 只存 0/2/3（40–64 mm 按 0），同档重复需先低于已提醒档，升更高档可直接；冷却、每小时 2 次和每天 6 次按会话共享，每轮最多一条，先在候选中取最高档、同档 `urinary > thirst > fullness > hunger`；明显 `context`、强 `wake`。`lastKind` 是最近提醒信号（可为 `thirst`），`lastLevel` 保留下降闩锁并用于旧档迁移。`bladder.voidedMl > 0` 或本轮有 `urinate` 时只抑制尿意候选，其他信号仍可提醒；`drink` 不在动作轮清零 `levels.thirst`。不自动排尿、饮水或运动；不适无提醒。提醒参数的 `status` 都是 `design`，属于 `policy`，不是人体测量。 |

M1 的 Gateway 动作记录保存动作标识、类型、原始载荷、载荷指纹、状态、预定/实际生效时刻、批次、尝试次数和错误；`stomach` 在自己的 part 里保存 `mealQueue` 与 `lastIntakeAt`，作为餐食领域记录。两者分工明确：Gateway 负责幂等、调度和审计，模块负责生理语义。

M1 的真实 DSH 会话验收已完成；通知历史文件、模型已读确认与按会话绑定不同身体仍未实现。M3 水链的 Task 10 已用真实会话核对：`urinate` 的 queued → applied、同 callId 重试只排一次、当轮新尿留下，以及饮水/不饮水对照中的口渴、ADH、肾请求与尿意方向；30 轮 A/B 与排尿链均通过。M19 又补验了非自主排空、`discomfort` 与 DI 样变体（33/33 verdicts，2–5 轮短会话）。上述 M1/M3/M19 验收都早于尿意/口渴提醒合并，不能当作这些通道的实机验收；尿意和口渴提醒目前只有离线单元测试与真实 Gateway 集成测试（`test/organs.brain-notify.test.mjs`、`test/organs.urinary-notify-gateway.test.mjs`、`test/organs.thirst-notify-gateway.test.mjs`），尚未做真实 DSH 会话验收。M4 活动—皮肤出汗薄切片目前也只有模块与真实 Gateway 集成测试，尚未做真实 DSH 会话、独立人体出汗数据或临床验证。离线守恒测试仍不能代替 120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴的验收。

### Gateway 待验证的设计想法

- **重试时的动作顺序。** 已实现：开算前持久化 `activeBatch` 的目标仿真时刻和有序动作 ID；失败重试复用同一批次，新动作进入后续批次，重启后按同一批次恢复。
- **可处理的动作。** 已实现：模块通过 `actionTypes` 声明可处理类型；无 handler 的动作入队返回 `422`，启动对账时发现 handler 已消失的旧 pending 动作标记 `failed(no-handler)`。
- **电脑休眠。** 启动补算受 `catchUpMinutes` 限制，DSH 随电脑休眠再唤醒时则会追赶所有到期轮次。两种恢复方式是否共用上限仍待确定。
- **执行模型与补算耗时。** 已切换到常驻 BodyWorker。旧实现的临时基准使用 Apple M1、8 GB 内存和极简模块：11 个模块每轮约 44 ms、峰值 RSS 约 203 MB；40 个模块每轮约 169 ms、峰值 RSS 约 508 MB；补满 720 轮时，2 个模块约 12.1 秒，11 个模块约 31.4 秒。接入生理模块后在真实 DSH 中记录完整恢复耗时。

### 曲线与参数的文献依据

模块预设随参数记录单位和取值依据。实机对照时采用与论文相近的动作或餐型，查看变化方向、量级和时间过程。

| 仿真环节 | 可用的实验依据 |
| --- | --- |
| 餐后达峰 | Freckmann 等比较了四种均含 50 g 碳水的标准餐。不同餐型的组平均峰值为 99.2–137.2 mg/dL，组平均达峰时间为 42.7–59.0 分钟。用表 4 的组织间液葡萄糖曲线特征对照不同餐型的峰值和达峰时间。 [Freckmann 等，2007，表 4](https://doi.org/10.1177/193229680700100513) |
| 日常葡萄糖水平 | Shah 等的无糖尿病受试者中，CGM 葡萄糖落在 70–140 mg/dL 的时间占比中位数为 96%。可作为日常仿真曲线的量级和波动对照。 [Shah 等，2019](https://academic.oup.com/jcem/article/104/10/4356/5479355) |
| 胰岛素的靶点敏感度 | Rizza 等的健康受试者钳夹实验中，肝糖输出达到半最大抑制和外周摄糖达到半最大反应所需的血浆胰岛素浓度分别约为 29 和 55 µU/mL。DSH 使用相对浓度时，以两种作用的敏感度差异为参照。 [Rizza 等，1981](https://pubmed.ncbi.nlm.nih.gov/7018254/) |
| 局部疲劳与延迟酸痛 | 肌肉疲劳可用休息、激活和疲劳三个状态建模。胫骨前肌的单侧离心运动实验中，运动侧酸痛评分在 24–48 小时最高，可用来对照延迟酸痛的时间过程。 [Xia 与 Frey Law，2008](https://pubmed.ncbi.nlm.nih.gov/18789445/) · [Larsen 等，2015，图 2](https://journals.physiology.org/doi/pdf/10.1152/japplphysiol.00563.2015) |
| 乳酸清除（运动扩展） | Devlin 等在最大强度运动后的实验中比较了主动与被动恢复，发现清除速度随恢复强度变化。接入乳酸时，可按恢复方式和强度标定清除参数。 [Devlin 等，2014](https://eprints.gla.ac.uk/95848/1/95848.pdf) |

## 7. 下一步查哪些资料

先把“吃下半块蛋糕后，胃里还有多少，什么时候觉得饿”这条链查通。各器官笔记里记录论文链接、图表或页码、受试人群、餐型或活动条件、测量方法、原始单位和时间点。使用相对浓度时记下参照值。源自论文的测量结果、从曲线估出的参数和脚本采用的提醒策略分别标明依据。

| M1 要回答的问题 | 资料归属 |
| --- | --- |
| 已知进食体积和能量后，哪些人体实验给出了相近餐型的胃内容量或排空曲线？ | [胃](../organs/human-organs/stomach/README.md) |
| 餐前、餐后测的是哪种饥饿素？采样时刻、基线和恢复过程能约束模型中的哪些量？ | [胃（ghrelin 节）](../organs/human-organs/stomach/README.md) |
| 研究怎样测胃充盈、饱胀和主观饥饿？同一批受试者有没有可对齐的测量时刻？ | [胃（机械感受节）](../organs/human-organs/stomach/README.md) · [体感读出](../organs/human-organs/brain/README.md) · [神经（legacy 证据）](../systems/nervous/README.md) |

后续按第 6 节的里程碑查餐后血糖、饮水与睡眠、局部活动与恢复。跨器官使用同一篇文献时，在负责该指标的器官目录记原始数据，其他器官从自己的笔记链接过去。
