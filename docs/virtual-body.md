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
| M3 水链（已接入根清单） | 胃水子集、小肠水吸收、体液隔室、肾产尿请求、下丘脑 ADH / 口渴、膀胱储尿与主动排尿；随后合并了膀胱过度充盈非自主排空（轮初 >600 mL 自动排到排后余量，`voidedMl` 分主动/非自主）与 `interoception.discomfort`（根清单四感受超 70 mm 取最大；女性清单另有子宫痉挛第五路与乳腺胀奶第六路），均在默认根清单；可选中枢/肾性 DI 样多尿变体只在独立清单/存档，默认身体不变。水链完成时根清单为 12 个部位；碳水薄切片加入葡萄糖后为 13 个；胰腺与肾糖接入后为 15 个；活动—皮肤出汗薄切片接入后为 17 个；运动相关呼吸失水接入 `lungs` 后为 18 个，骨骼肌摄糖接入后为 19 个，性反应周期接入后为 20 个，血氧池与自动通气接入后为 22 个，肝糖原与胰高血糖素接入后为 23 个，内分泌轴与松果体接入后为 28 个，唾液腺接入后为 29 个，分区骨骼肌接入后当前为 32 个，多轮水账本补测与当时 12 部位性能基线已完成（Task 11，早于上述后加功能，属历史基线），论文可比数据对照已记录（Task 12，大负荷利尿仍不匹配），Task 10 真实会话验收已完成（30 轮 A/B + 排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`，早于上述后加功能）；后加功能由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts：650 mL 无动作 → involuntary 650、同轮新尿 1 mL 留下、下一轮尿意/不适回落；正常/中枢/肾性请求约 1/4/4；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；650 mL 预置与预置会话的稳态 1 mL 请求是测试设定，不是模型输出；正常会话 sim 300 的 0.9998 mL 是模型输出；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴未验证 |
| M2 碳水—血糖薄切片（已接入根清单） | `drink` / `eat.carbohydrateG` → 胃碳水与既有排空 → 小肠吸收 → `glucose` 可及池；`glucose` 写出 `excessMassG` 与自身残余清除（`residualDisposalHalfTimeMin`，与胰岛素无关），`pancreasEndocrine` 双相对信号：肌肉与肝各自按最大速率、半饱和、敏感度（肌肉 1.0、肝 0.5）写 `uptakeRequestG` / `storageRequestG`，肝再按容量钳位请求，`glucose` 下一轮按“肾 → 肝 → 肌”结算；总清除轨迹由组织响应涌现。`glucagonRelative` 驱动 `liver` 在低血糖时当轮释放肝糖原；`kidneyGlucose` 按请求把 `glucoseMassG` 转成 `excretedGlucoseG`（g，不换尿水）。固定体重、表观分布体积、基础浓度、残余清除和肾糖锚点参数按 `design` / `prior` 标注；肌摄糖实际到账进入 `muscleGlucose.uptakeG`，下一轮聚合器按区域份额转给 `muscleHead` / `muscleTrunk` / `muscleLimbs`，区域再下一轮入账各自 `glycogenG`，运动时按强度消耗；肝储存实际到账进入 `liver.storageG`，下一轮并入 `glycogenG`，储存请求受容量钳位，释放受存量限制。完整胰岛素/胰高血糖素浓度与分泌、肝糖异生、脂肪组织分区、肌糖原容量与静息周转仍未实现；当前只有模块和真实 Gateway 离线验收，没有真实 DSH 或独立血糖曲线验证。 |
| M4 活动—皮肤出汗与运动呼吸失水薄切片（已接入根清单） | `exercise` → `physicalActivity` 剩余活动/强度 → `skin.sweatRequestMl` 与 `lungs.respiratoryWaterLossRequestMl` → `bodyFluid` 肾尿+呼吸+汗液三出口 → `skin.sweatVolumeMl` 与 `lungs.respiratoryWaterLossMl`；默认 25°C、`I=1`、30 min 累计汗液 18 mL、运动相关呼吸失水 9 mL，无活动时请求与实际均为 0。0.3 mL/min 是 `design`，不是实测呼吸失水率或总呼吸失水。口渴仍由既有 `waterDeficit → hypothalamusThirst → interoception` 按轮初快照读出，不自动饮水。完整 M4 的肌群负荷、疲劳、延迟酸痛与皮肤分区状态仍未实现；呼吸侧只覆盖运动相关失水，静息/环境驱动的呼吸失水与完整肺模型未建；当前只有模块与真实 Gateway 集成测试，没有真实 DSH 会话、独立人体出汗或呼吸失水数据。`sex` 也走同一活动入口，性反应周期另见下文性行为小节。 |
| 生殖薄切片（女性独立清单，已实现） | `ovaries` 周期钟 + E2/P4 相对量 → `uterus` 内膜/月经失水请求/痛经代理 → `body-water/water.female.ts` 第四出口 → `uterus.bleedingMl`；`uterus.crampMm` 另由 `interoception.discomfort` 第五路软读。女性清单 `body-modules.female.json` 为 35 部位、34 份参数文件，使用独立 `statePath`；根清单为 32 部位、31 份参数，不含卵巢/子宫/乳腺，`water.ts` 三出口、`glucose.ts` 三汇与 `brainNotify` 四类提醒不变。Bull 2019 只支撑周期/相位/出血天数（Natural Cycles 用户、厂商资助、仅排卵周期）；激素曲线、经量、痛经等为 `design`；未做真实 DSH、独立数据或临床验证。 |
| 血氧池与自动通气薄切片（已接入根清单） | `physicalActivity` / `duodenum.nutrientExposure` → `bloodOxygen` 供需平衡 → `lungsVentilation` 自动通气 → `bloodOxygen` 下一轮读肺泡供给；`interoception` 软读 `oxygenDeficit` 写 `dyspneaMm`。`bloodOxygen` 是供—需平衡，不是可耗空的氧气账本；全部参数 `design`、`source: null`；不建血气分压、血红蛋白、心输出量、CO2、高原/病理缺氧、通气动作或气促通知。加入时根清单 22 部位、24 份参数，女性 24 部位、26 份；肝糖原切片加入后为根 23 / 25、女性 25 / 27；内分泌轴与松果体接入后为根 28 / 30、女性 30 / 32，唾液腺接入后为根 29 / 31、女性 31 / 33；乳腺切片后为根 29 / 31、女性 32 / 34；分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34，硬闭包根 13 / 女性 15；未做真实 DSH、独立人体数据或临床验证。 |
| 肝糖原、胰高血糖素与各部位自主摄糖（已接入根清单） | `glucose.concentrationMgDl` → `pancreasEndocrine.glucagonRelative` → `liver` 当轮释放 `liver.glycogenG → glucose.glucoseMassG`；高血糖侧由 `glucose.excessMassG` 与 `insulinRelative` 驱动，肌肉与肝各自用自己的最大速率、半饱和与敏感度写请求（肌肉敏感度 1.0、肝 0.5），肝再按容量钳位请求，`glucose` 按“肾 → 肝 → 肌”结算，肝满时肝自己把储存请求钳到 0。全部新参数 `design`、`source: null`；肝只建糖原存量、容量与转移，不建胆汁、解毒、蛋白合成、脂肪代谢或激素绝对浓度；内分泌轴与松果体接入后为根 28 部位 / 30 份参数，女性 30 / 32；唾液腺接入后为根 29 / 31、女性 31 / 33；乳腺切片接入后为根 29 / 31、女性 32 / 34，硬闭包根 10 / 女性 12；分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34，硬闭包根 13 / 女性 15；未做真实 DSH、独立人体数据或临床验证。 |
| 内分泌轴与松果体薄切片（已接入根清单） | `hypothalamusEndocrine`（TRH/CRH）→ `pituitary`（TSH/ACTH）→ `thyroid`（T4）/ `adrenal`（皮质醇），T4 与皮质醇反向抑制上游；`bloodOxygen` 基础需氧乘 `0.8 + 0.4 × T4`，`liver` 释放乘 `cortisolRelative`，`interoception` 新增 `stressMm` / `sleepinessMm` 软读；`pineal` 按仿真昼夜产褪黑素。全部参数 `design`、`source: null`；不建 T3、肾上腺素、醛固酮、绝对浓度、睡眠行为、光照抑制、甲状旁腺/血钙；乳腺切片后为根 29 / 31、女性 32 / 34，分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34；未做真实 DSH、激素实测或临床验证。 |
| 唾液腺薄切片（已接入根清单） | `salivaryGlands` 按基础产率、`eat` / `drink` 刺激窗口与 `bodyFluid.waterDeficit` 写 `salivaRateMlPerMin` / `mealStimulusMin` / `mouthMoistureMm`；`duodenum` 对含碳水餐按 `duodenum.salivaryAmylaseGain` 给营养暴露小幅增益，`interoception` 写 `dryMouthMm`。不建唾液水账、淀粉酶浓度、吞咽/食管、口腔疾病、味觉或口咽解渴；全部参数 `design`、`source: null`；乳腺切片后为根 29 / 31、女性 32 / 34，分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34，未做真实 DSH、唾液流率实测或临床验证。 |
| 乳腺薄切片（女性独立清单，已实现） | `pituitary.prolactinRelative` → `mammaryGlands` 写 `milkRequestMl` / `lactoseRequestG` / `fullnessMm` → `water.female.ts` 第五出口 → `mammaryGlands.milkMl`，`glucose.female.ts` 末位汇 → `mammaryGlands.lactoseG`，`interoception.discomfort` 第六路软读 `fullnessMm`；根清单不装乳腺，`glucose.ts` 仍为三汇。女性清单 35 部位、34 份参数（分区骨骼肌接入后）；全部参数 `design`、`source: null`；不建婴儿、吸吮动作、哺乳行为、孕期/产后、乳腺病变或乳汁成分；未做真实 DSH、独立泌乳数据或临床验证。 |
| 后续清单 | [`2026-11-20-organ-model-design.md`](./superpowers/specs/2026-11-20-organ-model-design.md) §6 |

11 个系统名（运动、消化、呼吸、循环、泌尿、生殖、神经、内分泌、免疫、感觉器、被皮）只保留为功能标签，不再是目录或仿真层级。当前 P0/P1 的器官资料见 [`stomach`](../organs/human-organs/stomach/README.md)、[`duodenum`](../organs/human-organs/duodenum/README.md) 与 [`brain`](../organs/human-organs/brain/README.md)；活动—皮肤与运动呼吸失水薄切片见 [`skeletal-muscle`](../organs/human-organs/skeletal-muscle/README.md)、[`skin`](../organs/human-organs/skin/README.md) 与 [`lungs`](../organs/human-organs/lungs/README.md)；血氧池与自动通气见 [`blood-oxygen`](../organs/human-compartments/blood-oxygen/README.md) 与 [`lungs`](../organs/human-organs/lungs/README.md)；肝糖原与胰高血糖素见 [`liver`](../organs/human-organs/liver/README.md) 与 [`pancreas`](../organs/human-organs/pancreas/README.md)；生殖薄切片见 [`ovaries`](../organs/human-organs/ovaries/README.md) 与 [`uterus`](../organs/human-organs/uterus/README.md)；性反应周期薄切片见 [`sexual-response`](../organs/human-organs/sexual-response/README.md)；唾液腺与口干薄切片见 [`salivary-glands`](../organs/human-organs/salivary-glands/README.md)。

同一器官承担多个功能标签时，各脚本读取该器官的同一份状态。例如胰腺的消化酶分泌与胰岛的激素分泌属于同一器官目录，器官内的平滑肌随所属器官推进。 [NCI 内分泌腺与激素](https://training.seer.cancer.gov/anatomy/endocrine/glands/)

### 器官目录与共享身体状态

每个器官的 `README.md` 记录要模拟的脚本、字段、调节方式、待查问题和证据入口。论文原文、逐篇摘记和从图表提取的数据放在该器官的 `references/` 下，P0/P1 的笔记在 `organs/human-organs/stomach/references/notes/`；共享登记簿和字段字典在 `organs/human-organs/references/`。脚本例如 `organs/human-organs/stomach/hydration.ts`、`organs/human-organs/stomach/ghrelin.ts`、`organs/human-organs/brain/interoception.ts`、`organs/human-organs/skeletal-muscle/activity.ts`、`organs/human-organs/skeletal-muscle/glucose-uptake.ts`、`organs/human-organs/skeletal-muscle/regions/head.ts`、`organs/human-organs/lungs/respiratory-water-loss.ts`、`organs/human-organs/lungs/ventilation.ts`、`organs/human-compartments/blood-oxygen/oxygen.ts`、`organs/human-organs/liver/glycogen.ts`、`organs/human-organs/skin/sweat.ts`、`organs/human-organs/sexual-response/response.ts` 和 `organs/human-organs/salivary-glands/saliva.ts`，由根目录的 `body-modules.json` 逐条挂载；根清单现在挂载 32 条部位脚本（原 P0/P1 六条，胃入口换成 `hydration.ts`，加小肠、体液、葡萄糖隔室、胰腺、肾糖、两个下丘脑、下丘脑内分泌、垂体、甲状腺、肾上腺、松果体、肾、膀胱、活动、肌摄糖聚合器、三个肌肉区域、肺、肺通气、皮肤、性反应周期、血氧隔室、肝糖原与唾液腺）。[`body-modules.female.json`](../body-modules.female.json) 是独立的 35 部位清单（根 32 条 + `ovaries` + `uterus` + `mammary-glands/milk.ts`，体液换成 `water.female.ts`，葡萄糖换成 `glucose.female.ts`），必须配独立 `statePath`，不改变根清单的 32 部位计数。

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

基础参数随对应模块接入。P0/P1 已接胃排空、胃饥饿素、胃壁机械感受、十二指肠营养暴露时间常数和体感线性读出的参数；胃容量上限与充盈感知阈值仍是后续设计。`stomachSensory.referenceVolumeMl` 只是归一化机械感受用的工程参考量，不截断胃容量；`interoception` 的基线、增益与缺失默认值全部是 `design`，不是人体测量。呼吸栏的静息呼吸频率、潮气量与活动通气响应倍率仍是设计目标；当前 `lungs` 只按 `physicalActivity` 写运动相关呼吸失水请求，`lungsVentilation` 另按 `bloodOxygen` 需氧自动调通气，但两者都不读这些身体预设参数，也不建血气状态。生殖栏同样是设计目标：当前没有 `presets/`、生理性别预设或 condition 概念；女性清单用 `ovaries/menstrual-cycle.parameters.json` 设置周期长度与起始周期日，用独立 `statePath` 选择身体。

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

目前 DSH 会话可发起进食、饮水、排尿、运动与性行为，胃排空、水链与活动—出汗链随心跳推进。M3 水链的主动排尿、膀胱充盈、过度充盈非自主排空、口渴、尿意与不适读出脚本已实现并接入根清单，Task 10 真实会话验收已完成（30 轮 A/B + 排尿重试/409，早于非自主排空与不适合并）；非自主排空、`discomfort` 与 DI 样变体已由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴未验证。可选 DI 样多尿变体只在独立清单/存档中显式加载，默认身体不变。状态与模块清单见第 6 节。Gateway 在线且身体启用时，即使会话空闲也继续计时；暂停身体或 DSH 退出（含崩溃）时心跳停止，心跳停止期间新增的主动动作为零。

当前插件已接入 Gateway 的启动与关闭，默认清单现在挂载 32 条部位脚本（原 P0/P1 六条，胃入口换成 `hydration.ts`，加小肠、体液、葡萄糖隔室、胰腺、肾糖、两个下丘脑、下丘脑内分泌、垂体、甲状腺、肾上腺、松果体、肾、膀胱、活动、肌摄糖聚合器、三个肌肉区域、肺、肺通气、皮肤、性反应周期、血氧隔室、肝糖原与唾液腺）。启用时，自定义空清单下新动作仍会因为没有模块声明对应类型而返回 `422`；停用时新动作返回 `409`，见「启用、暂停与恢复」。这是有意的 fail-fast，已声明类型按 `actionTypes` 放行；未声明类型仍返回 `422`。M1 的真实 DSH 会话验收已完成；通知历史文件与模型已读确认仍未实现；食物估算仍是接下来的设计。[插件入口](../index.js) · [默认脚本清单](../body-modules.json)

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
- `GET /actions/:id` 返回动作记录和状态；`GET /capabilities` 按动作类型列出处理它的模块 ID，例如当前根清单启用后 `{ "drink": ["stomach", "stomachGhrelin"], "eat": ["stomach", "stomachGhrelin"], "urinate": ["bladder"], "exercise": ["physicalActivity"], "sex": ["physicalActivity", "sexualResponse"], "orgasm": ["sexualResponse"] }`（暂停时为空对象）；`GET /health` 返回本次启动实际采用的 `active`、仿真时钟、在途批次、连续失败次数和队列计数。
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
- `sex`：与 `exercise` 同一组字段和同一校验（`intensity` 有限且 `(0, 1]`、`durationMin` 有限且 `> 0`），不需要体积、能量、餐型或碳水，也没有伴侣、行为类型或内容字段；非法动作不改变状态。
- `orgasm`：无载荷，只写 `{ type: "orgasm" }`；提交 `orgasm` 且轮初 `arousalMm >= 70` 时由 `sexualResponse` 记录释放，低于 70 被忽略、不因该动作改变状态；轮初 `arousalMm >= 95` 时无需动作也会强制释放。高潮由模型按轮初唤醒判定，调用方不能写状态。
- `carbohydrateG` 的单位是克，表示可消化葡萄糖当量碳水，不是总碳水或纤维；非法值使整条摄入无效。`body_act` 已暴露该可选字段，`body_state` 的返回结构不变。
- 胃动力只对 `eat` 的 `mealKind: "solid"` 分支按固餐小计单独排空，`drink`、`liquid`、`mixed` 仍走原算法，`mixed` 不拆分固液。其他成分比例、黏度、碳酸、甜味剂、温度不进入方程；不能从体积或能量反推碳水。

Gateway 将动作原文和采用的数值随动作 ID 一起保存，工具重试、心跳和重启补算都复用已入账的估值。`stomach` 用采用的体积、能量和碳水更新对应存量；`interoception` 在下一轮读取胃充盈、饥饿素、十二指肠营养暴露、下丘脑口渴驱动、膀胱体积与可选的性反应周期唤醒，计算 `hunger` / `fullness` / `thirst` / `urinaryUrgency` / `discomfort` 与 `sexualArousalMm`；性唤醒只作独立读数，不进 `discomfort`。小肠吸收的碳水经 transfer 进入 `glucose`；胰腺双相对信号、肾糖排泄、各部位自主摄糖请求与肝糖原储存/释放（含 100 g 容量钳位）已接入糖链，但血糖仍不改变体感或胃排空。

`exercise` 与 `sex` 由 `physicalActivity` 接收，只写 `remainingExerciseMin` 与 `intensity`，不直接扣水；`skin` 与 `lungs` 下一轮按轮初活动分别写 `sweatRequestMl` 与运动相关 `respiratoryWaterLossRequestMl`，`bodyFluid` 再下一轮按肾→肺→汗顺序把实际失水转入 `skin.sweatVolumeMl` 与 `lungs.respiratoryWaterLossMl`。活动剩余时间与强度随存档保留，重启可续用；本切片不自动开始运动，也不自动饮水。具体时序和水账见下文「M4 活动—皮肤出汗与运动呼吸失水薄切片」。

`sex` 与 `orgasm` 由 `sexualResponse` 接收，写自己的 `arousalMm` / `phase` / `remainingSexMin` / `sexIntensity` / `lastOrgasmAtSimMin`，不调用 `transfer`、不发通知；`interoception` 下一轮软读 `arousalMm` 写 `sexualArousalMm`。高潮由模型按轮初唤醒判定：轮初 ≥70 时 `orgasm` 动作可主动触发，轮初 ≥95 时无需动作强制释放，低于 70 的 `orgasm` 被忽略；事件轮 `sinceOrgasm = 0`，下一轮 `sinceOrgasm = dtMin`（60 s 轮下 1 min）进入不应期。LLM 只控制输入，`urinate` / `orgasm` 是少数允许主动触发的输出，分别有膀胱 >600 mL 非自主排空与唤醒 ≥95 强制释放兜底。六个参数全部 `design`、`source: null`，没有登记来源；不建激素、心率、受孕/妊娠、性欲/情绪、伴侣/性病/避孕或显性内容。完整说明见下文「性行为与性反应周期薄切片」。`brainNotify` 不读 `sexualArousalMm`，也不发相关提醒。

### 动作、查询与存档

- **动作入账。** `POST /actions` 将动作排进下一轮并返回回执。一轮开始后收到的动作在后一轮生效。DSH 里的 `body_act` 用来源会话与工具调用的 `callId` 组成动作标识，并把 `sessionId` 随动作载荷入队。同一标识、同一载荷重试时返回原回执；同一标识、不同载荷返回 `409`。没有模块声明该类型时返回 `422`，且不创建回执。 [DSH 工具执行信息](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools) · [LifeBody 动作接口](https://github.com/ShuangziG/maibot-body-emulator/blob/v1.2.4/docs/%E5%8F%AA%E8%AF%BB%E7%8A%B6%E6%80%81API.md)
- **状态查询。** `body_state`、`GET /state` 和浏览器读取最近一次提交的内存快照；`body_state` 可按部位过滤，`GET /actions/:id` 查询单条动作，`GET /capabilities` 查询可处理的类型，`GET /health` 查询时钟和心跳健康。一轮执行期间，查询继续返回上一次提交的状态和仿真时间。
- **动作记录与存档恢复。** 存档 v2 保存 `schemaVersion`、`active`、`snapshot`、`pendingActionIds`、`actions` 和 `activeBatch`。每条动作记录包含原始载荷、载荷指纹、状态（`queued` / `applied` / `failed`）、预定和实际生效时刻、批次、尝试次数及最后一次错误。`applied` 表示所在批次成功提交，不表示模块一定改变了状态；领域效果以模块自己的 part 记录为准。`queued` 和在途动作永不裁剪，`applied` / `failed` 按条数或时间窗口保留。每轮成功后把新快照、动作状态和批次记录一起写到临时文件，再替换存档。普通停机重启后按停机时长恢复身体，随后恢复定时推进。 [LifeBody 仿真与存档配置](https://github.com/ShuangziG/maibot-body-emulator/blob/v1.2.4/docs/%E9%85%8D%E7%BD%AE%E6%8C%87%E5%8D%97.md)

后续若加入日程联动，调度模块可向 DSH 提供日程事件，由模型决定是否发出相应动作。

### 神经系统的体感与通报

**只有神经系统向会话通报身体感受。** 各器官负责更新生理状态，感觉器提供局部感觉信号。神经只作为功能标签保留；P1 已在 `brain/interoception.ts` 实现体感读出、在 `brain/notify.ts` 实现提醒策略，`index.js` 的 `notifications.js` 负责投递。当前提醒发给“最近一次带 `sessionId` 的动作所属会话”；完整的多会话路由与按会话绑定身体仍未实现。

体感与提醒在一次心跳内按以下顺序处理：

1. 胃和饥饿素等生理脚本读取轮初快照。胃先计算过去一分钟的排空，再把轮末吃下的半块蛋糕计入胃内容量。
2. Gateway 汇总各部位结果，形成尚待提交的轮末快照。`brain/interoception.ts` 用轮初的胃充盈、相对饥饿素、十二指肠营养暴露、下丘脑口渴驱动与膀胱体积更新 `hunger` / `fullness` / `thirst` / `urinaryUrgency`，并汇总 `discomfort`；可选软读 `sexualResponse.arousalMm` 写 `sexualArousalMm`（不进不适、不发通知），可选软读 `bloodOxygen.oxygenDeficit` 写 `dyspneaMm`（同样不进不适、不发通知）。
3. `brain/notify.ts` 读上一轮的 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency` 与 `bladder.voidedMl`，以及本轮原始动作中 `type: "urinate"` 的动作和 `sessionId`，按显著性、滞回、冷却和配额决定是否 `io.notify`。Gateway 将身体状态、体感和本轮通知一次提交；任一阶段失败就按原批次重算。
4. `notifications.js` 每 1000 ms 轮询待确认通知：`context` 用 `agent.inject`，`wake` 用 `agent.followup`；投递成功后 ACK。

**提醒不是每轮播报。** `brainNotify` 读轮初 `interoception.hunger` / `fullness` / `thirst` / `urinaryUrgency`、最近提交的 `bladder.voidedMl` 和本轮动作里的 `urinate`，在任一体感达到“明显”或“强”档位时提醒。饥饿、饱满、口渴与尿意的阈值都是 65/85 mm；用于门控的 `levels` 只记录 0/2/3，40–64 mm 的观测中间档按 0 计；缺失或非有限读数按饥饿 50、口渴 50、饱满 / 尿意 0 处理。每个信号单独记录滞回水位（`brainNotify.sessions.<sessionId>.levels = { hunger, fullness, thirst, urinary }`）：同一信号重复同一档，需先低于已提醒档让水位回落；升到比水位更高的档（如 2→3）可直接提醒。`lastKind` 记录最近一次实际提醒的信号（可为 `thirst`）；`lastLevel` 保留下降闩锁（提醒时置为发送档位，之后当前档位更低时下降，可为 1），并作为旧档迁移来源，不只是摘要。每轮最多一条：在尚未提醒到当前档位的候选中先取档位最高者，同档按 `urinary > thirst > fullness > hunger`；未被选中的信号不消耗水位。45 仿真分钟冷却、每小时 2 次、每天 6 次按会话共享，不按信号拆分。明显档位用 `context`（不唤醒），强档位用 `wake`（唤醒）；文本固定，不带膀胱数值、诊断结论或排尿指令。最近提交快照的 `bladder.voidedMl > 0` 或本轮动作含 `urinate` 时，只抑制尿意候选：该轮不产生尿意提醒且 `levels.urinary` 按 0 回落；饥饿、饱满、口渴等其他信号仍按各自水位参与选择，不受影响。口渴没有动作后抑制：`drink` 只在胃、小肠吸收后改变 `waterDeficit`，不会在动作轮把 `levels.thirst` 清零，也不自动饮水。旧会话缺少 `levels` 时按 `lastKind` / `lastLevel` 惰性迁移（`lastKind` 可为 `thirst`）；已有 `levels` 缺少 `thirst` 时只补 `thirst = 0`，其他信号水位不变。`brainNotify` 不调用 `urinate`、`drink` 或 `exercise`；`discomfort` 仍没有提醒通道，`sexualArousalMm` 与 `dyspneaMm` 也不进入提醒，没有气促通知。上述提醒参数的 `status` 都是 `design`，属于提醒 `policy`，不是人体测量、临床尿急界值或口渴阈值。模块仍读轮初快照；`notify` 在 `interoception` 之上再晚一轮，尿意提醒相对轮初膀胱变化为两轮（预置 410 mL 后第 1 轮只更新体感，第 2 轮才提醒），口渴链路多一级下丘脑→体感，预置一致的 `waterVolumeMl = 29650`、`waterDeficit = 0.7` 时第 3 轮才提醒强口渴。启动补算丢弃通知，但补算轮若触发提醒仍提交本节状态、消耗冷却与配额，恢复后同档可能不补发；这是既有限制，需另立独立设计。会话 A/B 的计数分开；当前只有最近一次动作的会话收到提醒。

#### 投递与确认

Gateway 的 `GET /notifications` 返回待确认队列，目前最多保留 200 条。每条含 `id`、`mode`、`sessionId`、`text` 和创建时刻。当前通知没有来源脚本、体感类型或等级字段；`brainNotify.sessions` 用 `lastKind` 记录最近一次实际提醒的信号（`hunger` / `fullness` / `thirst` / `urinary`）、`lastLevel` 保留下降闩锁并作为旧档迁移来源，逐信号 `levels` 负责实际门控；这些信息供排查用。

- `context` 使用 `agent.inject` 将内容放入上下文，供后续模型调用读取，空闲会话继续等待。
- `wake` 使用 `agent.followup` 为目标会话安排一轮模型调用，空闲会话会被唤醒。 [DSH Agent 接口](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core#the-agent-handle)

投递泵对每个通知构造 `source.kind = "body-notify"` 的 user-role 消息，避免冒充真人输入。会话不在线时通知保留在 Gateway 队列；投递成功后 ACK；ACK 失败时下次只重试 ACK，不重复投递。通知历史文件与 `agent/inbox/inserted` 确认尚未实现：当前 ACK 表示“已交给会话收件箱”，不表示模型已读或已经消费。

### 会话里的身体

- `index.js` 通过 `ctx.tools.register` 注册 `body_act` 和 `body_state`，共用当前 DSH 进程里的 Gateway；工具随插件卸载自动注销。 [DSH 工具注册](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook) · [DSH 生命周期](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core)
- `body_act` 把结构化动作连同 `sessionId` 交给 Gateway；动作 id 由会话 ID 与工具 `callId` 稳定生成，重试复用同一回执。`body_state` 返回最近一轮的 `simulatedSeconds` 和 `parts`，可按部位过滤。202 queued 只表示入队，不表示已生效。
- `brain/notify.ts` 为会话筛选提醒：饥饿、饱满、口渴或尿意达到明显档位用 `context`，强档位用 `wake`，同一会话共享冷却与每小时/每天次数上限；它不自动排尿、饮水、运动或性行为，是否调用 `urinate` / `drink` / `exercise` / `sex` / `orgasm` 仍由会话决定。SFW / NSFW 会话选择、按会话绑定不同身体与通知历史尚未实现。

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

P1（已完成）覆盖“吃/喝 → 胃排空 → 十二指肠营养暴露 → 体感读出 → 会话提醒”的链：`interoception.hunger` / `fullness` 是代理读数，`brainNotify` 做显著性/滞回/冷却/配额，`body_act` / `body_state` 与通知投递已接入。胃动力在 `volumeMl` / `energyKcal` 总量内保存固餐小计 `solidVolumeMl` / `solidEnergyKcal`：只有 `eat` 的 `mealKind: "solid"` 按单独的固餐参考半时（68.7 min，标记固相半排空时间中位数）排空，`drink`、`liquid`、`mixed` 与旧存档中已经入胃的存量仍走原算法，旧档 `mealQueue` 里尚未释放的切片继续按各自 `mealKind` 入账，`body_act` / `body_state` 参数不变。体感仍经胃充盈、相对饥饿素与十二指肠营养暴露间接反映这些总量与通量：体感字段不变，数值会随分组后的总量与排出量变化；只有查询原始 `stomach` 部位或整身状态时才会看到两个固餐小计。M1 的真实 DSH 会话验收已完成；通知历史文件、模型已读确认与按会话绑定不同身体仍未实现。M3 水链首段已实现脚本、参数、定向测试与现状文档并接入根清单（Tasks 1–9）；多轮水账本补测与 Task 11 当时 12 部位逐轮性能基线已完成（Task 11，spec §8；早于非自主排尿、`discomfort` 与 DI 变体，属历史基线），论文可比数据对照已记录（Task 12，spec §7），但大负荷利尿仍不匹配、口咽解渴支路未建，不能写成整体符合论文；Task 10 真实 DSH 会话验收已完成（30 轮 A/B + 排尿重试/409，证据在 `/tmp/dsh-body/task10-dsh.5SgAh8/`；早于后加功能）；膀胱过度充盈非自主排空、`discomfort` 与 DI 样变体已实现并有定向测试，且由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts，证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴未验证；睡眠与排便调研仍为 defer；M2 的碳水—血糖薄切片已另行批准并实现，后续又接入胰腺相对信号、肾糖质量排泄、肝糖原储存/释放、胰高血糖素相对信号与各部位自主摄糖请求；M4 的活动—皮肤出汗与运动呼吸失水薄切片已实现（`exercise` → `physicalActivity` → `skin.sweatRequestMl` 与 `lungs.respiratoryWaterLossRequestMl` → `bodyFluid` 三出口 → `skin.sweatVolumeMl` 与 `lungs.respiratoryWaterLossMl`，默认 30 min 累计汗液 18 mL、运动相关呼吸失水 9 mL，见下节）；完整 M2（除已实现的骨骼肌摄糖、肌糖原、肝糖原储存/释放与胰高血糖素信号外，仍含胰岛素/胰高血糖素绝对浓度与分泌、肝糖异生、脂肪组织分区与肌糖原容量/静息周转等）、完整 M4（肌群负荷/疲劳/延迟酸痛/皮肤分区）与 M5–M7 仍是设计目标。

### 首期优先完成（M1–M4）

M1 已完成；M1–M4 全部通过实机验收后，首期交付完成。首期用会话工具观察体感，从 Gateway 的开发日志核对仿真数值。

| 里程碑 | 交付范围 | DSH 实机验收 |
| --- | --- | --- |
| M1 · 基础身体与进食 | Gateway 加载身体预设、免疫档位和脚本清单。胃动力、胃饥饿素与胃壁机械感受脚本从轮初快照计算进食、排空和信号变化。神经系统读取轮末结果，体感与身体状态一次提交。 | 核对自定义参数和部位档位。在会话 A 提交“吃了半块奶油蛋糕”并重试，从会话 B 观察共享体感，在存档中确认同一动作只入账一次且沿用原估值。核对生理脚本按清单顺序读取同一份轮初快照，执行期间提交的动作在下一轮生效。让一个脚本超时，核对整轮状态和通知作废，待处理动作保留，成功重试后推进 60 秒。观察会话空闲时的胃排空，停机两小时后再核对这次进食的消化进度和恢复时的饱腹感。 |
| M2 · 餐后血糖 | **薄切片已实现：** `carbohydrateG` → 胃碳水 → 小肠吸收 → `glucose` 可及池质量/浓度代理，使用固定分布体积、基线和残余清除参数；`glucose` 写出 `excessMassG`，`pancreasEndocrine` 双相对信号，肌肉与肝各自按最大速率、半饱和、敏感度写 `uptakeRequestG` / `storageRequestG`，肝再按容量钳位请求，`glucose` 下一轮按“肾 → 肝 → 肌”结算，总清除轨迹由组织响应涌现；肝储存请求受 100 g 容量钳位，低血糖时由 `liver` 释放；`kidneyGlucose` 按请求转出实际 g 质量；质量账含肾排泄、肌摄糖、肌糖原与肝糖原。**完整目标仍未实现：** 胰岛素/胰高血糖素绝对浓度与分泌、肝糖异生、脂肪组织分区、完整皮质醇/应激调节（薄切片已接入肝糖释放乘数与 `stressMm`）、肌糖原容量与静息周转。 [Dalla Man 等，图 2 和式 (1)、(13)、(18)](https://isbgroup.eu/files/Dalla%20Man%202007.pdf) | 已有当时 13 部位的 A/B、逐轮质量账、固体队列和吸收后重启测试，以及后续 15 部位的胰腺/肾糖集成测试与当前 32 部位的肝糖原/自主摄糖/内分泌轴/分区肌肉测试；真实 DSH 会话、两种同碳水餐型、激素浓度和独立血糖曲线对照仍未验收。 |
| M3 · 饮水与睡眠 | 水链首段（饮水吸收、ADH、肾请求、膀胱与主动排尿）的脚本、参数、定向测试与文档已实现并接入根清单（Tasks 1–9）；多轮水账本补测与 12 部位性能基线已完成（Task 11，历史基线），论文对照已记录（Task 12，大负荷利尿仍不匹配）；Task 10 真实 DSH 实机验收已完成（30 轮 A/B + 排尿重试/409）；膀胱非自主排空、`discomfort` 与 DI 样变体已实现并有定向测试，且由 M19 真实 DSH 会话补验（33/33 verdicts，2–5 轮短会话）；120 轮长时程、通知/重启、大负荷利尿与口咽解渴未验证；褪黑素昼夜曲线已由 `pineal` 薄切片实现并驱动 `sleepinessMm`，但睡眠压力、睡眠行为与睡眠分期仍暂缓（defer）。 | 水链的 Task 10 实机验收已完成：从同一起点比较饮水与不饮水，核对吸收、口渴、ADH、产尿与尿意，并验证 `urinate` 与同调用重试；M19 又用真实 DSH 会话补验了非自主排空、`discomfort` 与 DI 样变体（33/33 verdicts，只覆盖 2–5 轮短会话）；120 轮长时程、通知投递与重启补算仍待后续实机验收；睡眠行为已 defer，不在近期验收范围；褪黑素薄切片只有离线模块与 Gateway 测试。 |
| M4 · 活动与身体分区 | **薄切片已实现：** `body_act` 的 `exercise { intensity, durationMin }` → `physicalActivity` 剩余活动/强度 → `skin.sweatRequestMl` 与 `lungs.respiratoryWaterLossRequestMl` → `bodyFluid` 肾尿+呼吸+汗液三出口 → `skin.sweatVolumeMl` 与 `lungs.respiratoryWaterLossMl`；默认 25°C、`I=1`、30 min 累计汗液 18 mL、运动相关呼吸失水 9 mL，无活动时 0，口渴沿用既有轮初快照，水账增加实际汗液与呼吸失水，不自动饮水。**完整目标仍未实现：** 以左右小腿为第一组分区，接入肌群负荷、疲劳、延迟酸痛和同一区域的皮肤状态；呼吸侧只覆盖运动相关失水与自动通气代理，静息/环境驱动的呼吸失水、血气与完整肺模型未建；METs、心率、体温调节、电解质与皮肤分区不在本切片。 | 已有活动/皮肤/肺模块、三出口与真实 Gateway 水账测试；真实 DSH 会话、单侧离心活动对照、独立人体出汗或呼吸失水数据与临床验证未做。 |

### M3 饮水与排尿：首段实现状态

**脚本已实现并接入根清单（Tasks 1–9）；多轮水账本补测与 12 部位性能基线已完成（Task 11，历史基线），论文对照已记录（Task 12）；Task 10 真实 DSH 验收已完成（30 轮 A/B + 排尿重试/409）；后加的非自主排空、`discomfort` 与 DI 样变体由 M19 真实 DSH 会话补验（2026-11-22，33/33 verdicts，2–5 轮短会话）；120 轮长时程、通知/重启、大负荷利尿与口咽解渴仍未验证；Task 10/11 都早于后加功能合并。** 胃水链入口 `hydration.ts` 把 `drink` 的全部体积记为水，小肠 `water-absorption.ts` 吸收轮初肠水，`bodyFluid` 维护体液水与亏缺代理，`kidney` 只算下一轮产尿请求，下丘脑 `hypothalamus-adh.ts` / `hypothalamus-thirst.ts` 分开算 ADH 与口渴，`bladder` 储尿、结算主动 `urinate`，并在轮初体积严格大于 600 mL 且无 `urinate` 时非自主排空到排后余量；`interoception` 另输出 `discomfort`（根清单为饥饿、饱满、口渴、尿意四路超过 70 mm 的强度取最大值；女性清单另有子宫痉挛第五路与乳腺胀奶第六路）。十二指肠脚本仍只计算营养暴露，不负责水吸收。

首段打通一条可核对水量的链：**喝水 → 胃排空 → 小肠吸收 → 体液反馈 → ADH 调节肾脏产尿 → 膀胱充盈 → 主动排尿或过度充盈非自主排空**。口渴、尿意与不适是独立的读出信号。不用「喝完定时加尿量」代替肾脏反馈，也不要求第一段就覆盖完整的水盐与血压调节。

| 功能标签 | 当前脚本 | 读写边界 |
| --- | --- | --- |
| 消化 | `stomach/hydration.ts`、`small-intestine/water-absorption.ts` | 胃只转出非固餐排出中的水 `emptiedWaterMl`；小肠只吸收轮初肠水。胃总内容量、`emptiedMl` 和 `emptiedKcal` 均不能充当饮水水量。 |
| 体液隔室 | `human-compartments/body-water/water.ts` | 接收吸收水，按 `kidney.urineProductionRequestMl` 向膀胱转水；M4 薄切片另按轮初 `lungs.respiratoryWaterLossRequestMl` 与 `skin.sweatRequestMl`，按肾→肺→汗的工程顺序向肺与皮肤转实际失水，见下节。已进入膀胱、肺或皮肤的水不再算体液。只输出 `waterDeficit` 代理，不叫实测血浆渗透压。 |
| 神经内分泌（下丘脑） | `brain/hypothalamus-adh.ts` | 用 `bodyFluid.waterDeficit` 调相对 ADH 水平；`relativeConcentration` 不是 pmol/L。ADH 由下丘脑合成、由垂体后叶释放；肾脏是靶点，不是其来源。 |
| 神经（下丘脑） | `brain/hypothalamus-thirst.ts` | 读同一亏缺，写 0–100 mm 口渴驱动；不写 ADH，不自动替会话喝水，首段不建吸收前口咽缓解。 |
| 泌尿 | `kidney/urine-production.ts`、`bladder/storage.ts` | 肾只写下一轮请求，不转移水；体液所有者按轮初请求结算转移；膀胱储存已转入的尿量，`urinate` 结算轮初体积，轮初严格大于 600 mL 且无 `urinate` 时非自主排空到排后余量；两种排尿都不扣体液，也不另设储尿激素。600 mL 是 `design` 工程阈值，不是临床失禁模型。 |
| 神经（体感） | `brain/interoception.ts` | 读出 `thirst`、`urinaryUrgency`、`discomfort` 与 `sexualArousalMm`（不适为四感受超过 70 mm 的强度取最大值；女性清单另把 `uterus.crampMm` 作为第五路、`mammaryGlands.fullnessMm` 作为第六路并入；性唤醒为独立软读，不进不适）；`brainNotify` 读 `hunger` / `fullness` / `thirst` / `urinaryUrgency` 做四类提醒，不读不适或性唤醒，也不接管排尿、饮水、运动或性行为反射；是否 `urinate` / `drink` / `exercise` / `sex` / `orgasm` 仍由会话决定。 |

目录仍归器官；体液是隔室，放在 `organs/human-compartments/body-water/`；下丘脑的两种功能放在脑的同一区域下，分成两个脚本，系统名只做标签。睡眠节律的褪黑素相对量与 `sleepinessMm` 读数已由 `pineal` 薄切片接入，睡眠压力与睡眠行为仍另拆（调研已 defer），不把 `active: false` 当生理睡眠。本段也不建排便（结肠、直肠、便意调研已 defer），或肾素–血管紧张素–醛固酮系统（待接水盐、循环时再做）。DI 样变体是独立清单/存档中的可选入口，不是默认身体的一部分。

**接入与验收。** 沿用两个会话工具：`body_act` 接受 `drink` / `eat` / 无份量参数的 `urinate`，以及 `exercise` / `sex` / 无载荷 `orgasm`；M3 的验收只覆盖前三类，排出量由膀胱轮初存量决定；根清单已加载 `bladder`。`body_state` 按部位读取体感，包括 `discomfort`、`sexualArousalMm`、`sexualResponse` 五个字段与膀胱四个字段；提醒只由 `brainNotify` 在饥饿、饱满、口渴或尿意达到明显/强档时发出，不新增每轮上下文注入，也不自动排尿或饮水。过度充盈非自主排空由 600 mL 阈值触发，没有动作、回执或通知；它不是持续的自动排尿或失禁模型。水量用 `io.transfer` 配对提交，不跨量纲扣账；进膀胱时已扣除体液，排尿时不能再扣一次。旧档不猜历史饮水，不重置胃值；旧自定义清单仍可只加载原胃脚本 `motility.ts`。实机从同一起点比较饮水与不饮水，核对吸收、口渴、ADH、产尿及尿意的变化；再观察一次排尿及同调用重试，核对只计一次排出。多轮队列水恒等式已补测（Task 11），离线测试与真实 Gateway 测试已覆盖模块守恒、根清单集成，以及非自主排空、分项与 `discomfort`（`test/organs.bladder.test.mjs`、`test/organs.interoception.test.mjs`、`test/organs.water-gateway.test.mjs`）；Task 10 已用真实 DSH 会话完成 30 轮 A/B 与主动排尿重试/409，但早于非自主排尿与不适合并；M19 又在真实 DSH 会话中补验了 650 mL 非自主排空（同轮新尿留下、下一轮尿意/不适回落）、主动优先/重试/409 与 DI 三组清单（请求 1/4/4 mL，通知 0，33/33 verdicts；证据在 `/tmp/dsh-body/m19-real-dsh.syuWHR/`，仓库外未入库）。650 mL 预置与预置会话的稳态 1 mL 请求是测试设定，不是模型输出；DI 对照正常会话 sim 300 的 0.9998 mL 是模型输出。M19 只覆盖 2–5 轮短会话；120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴仍未验证。

**证据与参数状态。** 所有新参数都是 `design`，论文只支撑方向与时间尺度：Péronnet 2012 只给 D₂O 吸收的探索时间尺度，20 min 半时不是论文值；Ota 1994 主队列是 5 名甲减患者加 5 名正常对照，只支撑水负荷后 AVP 降、尿变稀的方向；Andersen 1990 只支撑肾反应可延迟；Figaro & Mack 1997 只支撑口咽解渴与持续补液可分开，首段不建该支路；De Wachter & Wyndaele 2003 目前只核对到摘要（15 名健康女学生，190/268/410 mL 是交接数值、原文表图待核），410 mL 只作尿意归一化锚点；ICS 术语只给“排前量 = 排出量 + 残余量”的记账关系，不规定正常残余量。600 mL 非自主阈值与 70 mm 不适起始值同样没有直接来源，都是 `design` 工程代理；`brainNotify` 的 65/85 mm 尿意阈值、`resetBelow=40 mm`、45 min 冷却与次数上限等提醒参数的 `status` 都是 `design`，属于 `policy`；其中 `resetBelow` 只区分观测 0/1 档，用于门控的 `levels` 只存 0/2/3、40–64 mm 的中间档按 0 计，同档重复需先低于已提醒档，升更高档可直接提醒。它们都不是人体排尿阈值或临床尿急界值；三篇 DI 综述只支撑机制方向与 >3 L/day 量级，4 mL/min 不是论文值。逐篇边界见各器官 README 与 [`references/`](../organs/human-organs/references/)。

**未建：** 睡眠、排便、完整胰岛素/胰高血糖素浓度与分泌、肝糖异生与脂肪组织分区糖代谢（骨骼肌摄糖、肌糖原、肝糖原储存/释放与胰高血糖素相对信号薄切片已实现）、血浆/尿渗透压、电解质、血容量/血压、RAAS、静息/环境驱动的呼吸失水、皮肤不感蒸发、口咽解渴、自动饮水；汗液只有显式运动薄切片，不建体温调节、汗液电解质或皮肤分区；呼吸失水只有运动相关的薄切片，另有固定 `design` 参数的自动通气代理（`lungsVentilation`）；仍缺静息/环境驱动呼吸失水、血气分压、血红蛋白/氧合曲线、CO2、心输出量、通气动作、气促通知与完整肺模型。过度充盈非自主排空已实现，但它只是 600 mL 阈值代理，不是持续漏尿、正常排尿反射或临床失禁模型。碳水—血糖薄切片、胰腺双相对信号、肾糖质量排泄、肝糖原储存/释放与各部位自主摄糖请求已实现；肾糖只是 g 质量汇，不产生尿水或尿糖浓度，肝只建糖原存量与转移，不能当成完整 M2 糖代谢或肝功能。性反应周期只有唤醒代理、体力活动入口与 `orgasm` 主动/强制释放，不建激素、心率/血压/通气、受孕/妊娠、性欲/情绪、伴侣/性病/避孕或任何显性内容。

### M4 活动—皮肤出汗与运动呼吸失水薄切片：当前实现

当前链为 **`exercise` → `physicalActivity` → `skin.sweatRequestMl` 与 `lungs.respiratoryWaterLossRequestMl` → `bodyFluid` 三出口（肾尿 + 呼吸失水 + 汗液）→ `skin.sweatVolumeMl` 与 `lungs.respiratoryWaterLossMl`**。它只把显式运动变成可对账的体液失水；默认没有活动时不出汗、不产生运动相关呼吸失水，既有水账与口渴轨迹不变。

`body_act` 的 `exercise` 载荷为 `{ type: "exercise", intensity, durationMin }`：

- `intensity` 必填、有限且 `0 < intensity <= 1`；1 是模型内最大相对强度，不是 MET、%VO₂max、心率、功率或能量消耗。
- `durationMin` 必填、有限且 `> 0`；不需要 `volumeMl`、`energyKcal`、`mealKind` 或 `carbohydrateG`。
- 非法值使整条动作 400/不入队；动作 ID、会话与重试幂等沿用既有 `body_act`。模块层再按同一规则校验，非法动作不改变活动状态。

| 部位 / 脚本 | 字段（单位） | 读写边界 |
| --- | --- | --- |
| `physicalActivity` / `skeletal-muscle/activity.ts` | `remainingExerciseMin` (min)、`intensity` (1) | 只读自己的轮初状态与本轮 `exercise`；先按 `io.dt` 递减，再取本轮最后一个合法动作替换，不累加时长；不扣水、不发通知 |
| `skin` / `skin/sweat.ts` | `sweatRequestMl` (mL/下一轮)、`sweatVolumeMl` (mL/轮) | 只读轮初活动与固定环境参数；每轮先写请求并把实际汗液归 0，实际量只由 `bodyFluid` 的 transfer 增加；不持有体液水 |
| `lungs` / `lungs/respiratory-water-loss.ts` | `respiratoryWaterLossRequestMl` (mL/下一轮)、`respiratoryWaterLossMl` (mL/轮) | 只读轮初 `physicalActivity`；每轮先写运动相关请求并把实际量归 0，实际量只由 `bodyFluid` 的 transfer 增加；不持有体液水，不含静息呼吸 |
| `bodyFluid` / `human-compartments/body-water/water.ts` | `waterVolumeMl`、`waterDeficit` | 唯一从体液转出尿、呼吸失水与汗的部位；读取轮初 `kidney.urineProductionRequestMl`、`lungs.respiratoryWaterLossRequestMl` 与 `skin.sweatRequestMl` |

出汗请求在 60 s 轮、默认环境 25°C、`I=1` 时为 0.6 mL；公式与参数：

```text
temperatureFactor = max(0, 1 + 0.04 × (T − 25))
rate = R > 0 ? min(2, 0.6 × I × temperatureFactor) : 0
sweatRequestMl = rate × dtMin
```

`ambientTemperatureC = 25`、`referenceRateMlPerMin = 0.6`、`ambientGainPerC = 0.04`、`maxRateMlPerMin = 2` 全部为 `design`、`source: null`，位于 `skin/sweat.parameters.json`。它们不是人体出汗测量、体温调节或最大出汗率；`range` 只是工程调参范围。

运动相关呼吸失水请求在 60 s 轮、`I=1` 时为 0.3 mL；公式与参数：

```text
respiratoryWaterLossRequestMl = R > 0 ? 0.3 × I × dtMin : 0
```

`lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3` 为 `design`、`source: null`，位于 `lungs/respiratory-water-loss.parameters.json`；它只是 `intensity=1` 时的临时工程速率，不是实测呼吸失水率、总呼吸失水或通气量。`R` 是轮初活动剩余分钟，`dtMin = io.dt / 60`；活动部位缺失时请求为 0，字段缺失、非有限、剩余时间为负或强度越界时整轮失败。请求字段不计入实际失水。

体液三出口按轮初水结算，顺序是工程 `policy`，不是人体优先级证据：

```text
U_kidney = clamp(R_kidney, 0, W_start)
U_lung = clamp(R_lung, 0, max(0, W_start − U_kidney))
U_sweat = clamp(R_sweat, 0, max(0, W_start − U_kidney − U_lung))
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U_kidney
transfer bodyFluid → lungs: U_lung
transfer bodyFluid → skin: U_sweat
```

三路合计不超过轮初 `W_start`，小肠同轮流入不能支付本轮任一出口；先 write 后三个 transfer，实际呼吸失水与汗液只经 transfer 进入各自字段。水账在既有恒等式上增加累计实际呼吸失水与汗液：

```text
胃水 + 队列水 + 小肠水 + (体液水 − 初始体液水)
+ 膀胱尿 + 累计 voidedMl
+ 累计 skin.sweatVolumeMl + 累计 lungs.respiratoryWaterLossMl
= 累计饮水
```

`skin.sweatRequestMl` 与 `lungs.respiratoryWaterLossRequestMl` 都不进水账；请求是意图，实际通量受轮初可用水与支付顺序钳制。无活动时皮肤与肺的请求、实际四项均为 0，恒等式与 M3 一致。

**默认时序。** 60 s 一轮、25°C、`I=1`、`durationMin=30`：第 1 轮活动状态更新，皮肤与肺仍读旧活动、请求 0；第 2 轮皮肤写出 0.6 mL 请求、肺写出 0.3 mL 请求，体液仍读旧请求；第 3 轮体液首次转出 0.6 mL 汗液与 0.3 mL 呼吸失水。第 2–31 轮共 30 次请求、第 3–32 轮共 30 次转移，累计汗液 18 mL、运动相关呼吸失水 9 mL；第 32 轮活动已归零，第 33 轮起请求与实际均为 0。18 mL 与 9 mL 都是模型内水账/时序核对，不是实测汗量或呼吸失水量。

**口渴与旧档。** 体液下降后，口渴仍由既有 `waterDeficit → hypothalamusThirst → interoception` 按各自轮初快照逐轮读出；本切片不新增通知、不改阈值、不自动饮水。旧档只补 `physicalActivity = { remainingExerciseMin: 0, intensity: 0 }`、`skin = { sweatRequestMl: 0, sweatVolumeMl: 0 }` 与 `lungs = { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 }`，不反推历史活动、出汗或呼吸失水；已有体液、膀胱和饮水状态不重置。重启保留活动剩余时间/强度，已扣汗液与呼吸失水不重复扣。

**清单与依赖。** 根清单当前 32 个部位、31 份参数文件（含 3 份不随根清单加载的 DI 变体）；女性清单为 35 个部位、34 份，男性清单为 34 个部位、33 份。13 部位硬 transfer 闭包为 `hydration.ts`（胃）、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs`；缺 `skin`、`lungs`、`muscleGlucose`、任一区域或 `liver` 时，相应 `transferOut` 目标未声明，启动即失败。女性清单再加 `uterus` 与 `mammaryGlands`，硬闭包为 15 部位；女性葡萄糖变体另声明 `mammaryGlands.lactoseG`。`physicalActivity` 只是 `skin`、`lungs`、三个肌肉区域与 `bloodOxygen` 的普通轮初读取，不构成 transfer 配对依赖。直接调用体液模块时缺皮肤或肺请求按 0；完整 Gateway 清单不能用这个回退绕过 `skin` / `lungs` 配对。

**验收状态。** M4 切片验收时 `npm test` 418/418 通过；肺 8/8、活动 8/8、皮肤 10/10 模块测试与真实 Gateway 水账测试通过，覆盖三出口分配、默认 30 min 累计汗液 18 mL 与运动相关呼吸失水 9 mL、无活动 golden 轨迹、旧档补零和重启不重复扣（`test/organs.lungs.test.mjs`、`test/organs.body-water.test.mjs`、`test/organs.sweat-gateway.test.mjs` 等）。**未做：** 真实 DSH 会话、独立人体出汗/呼吸失水数据或临床验证。

**未建模。** 本节的肺失水切片只有运动相关呼吸失水请求—结算，不建静息呼吸、环境驱动的呼吸失水；通气量、潮气量与呼吸频率由血氧切片的 `lungsVentilation` 自动代理，仍不建气体交换、血气、呼吸力学、气喘或呼吸不适提醒，也不建完整肺模型；0.3 mL/min 不是实测呼吸失水率。其余不建 METs、热量/能量消耗、摄氧量、心率、血压、乳酸、疲劳、睡眠、运动类型、姿势、核心/皮肤温度、体温调节、皮肤分区/湿润度、蒸发残余、汗液电解质、环境热应激、疾病或个体差异；肌糖原只按 M2 薄切片的固定速率代理消耗，不由 `intensity` 换算 MET 或能量；`intensity` 只是模型内相对强度。汗液与呼吸失水只以 mL 表示，不换算成 METs、热量、心率、代谢率或通气量。

设计见 [`2026-11-23-activity-sweat-design.md`](./superpowers/specs/2026-11-23-activity-sweat-design.md) 与 [`2026-11-23-respiratory-water-loss-design.md`](./superpowers/specs/2026-11-23-respiratory-water-loss-design.md)；活动、皮肤与肺字段细节见 [`skeletal-muscle`](../organs/human-organs/skeletal-muscle/README.md)、[`skin`](../organs/human-organs/skin/README.md) 与 [`lungs`](../organs/human-organs/lungs/README.md)；体液三出口见 [`body-water`](../organs/human-compartments/body-water/README.md)。

### M2 碳水—血糖薄切片：当前实现

当前链为 **`drink` / `eat.carbohydrateG` → 胃碳水记账 → 小肠吸收 → `glucose` 可及池 → 各部位自主摄糖请求 → `glucose` 按“肾 → 肝 → 肌”结算**。`glucose` 写出 `excessMassG` 与自身残余清除（`residualDisposalHalfTimeMin`，与胰岛素无关）；`pancreasEndocrine` 写两个相对信号；`muscleGlucose` 与 `liver` 各自按最大速率、半饱和、敏感度（肌肉 1.0、肝 0.5）写 `uptakeRequestG` / `storageRequestG`，肝再按容量钳位请求；下一轮由 `glucose` 按请求与余额结算；实际到账分别进入 `muscleGlucose.uptakeG` 与 `liver.storageG`，再下一轮入账糖原。`glucagonRelative` 驱动 `liver` 在低血糖时当轮释放肝糖原，由 `liver` 自己发起并钳到存量；肌肉不向血液放糖。肾糖按请求把 `glucoseMassG` 转成 `kidneyGlucose.excretedGlucoseG`（g，不换尿水）。`carbohydrateG` 是可选、有限、非负的克数，表示可消化葡萄糖当量碳水；缺省为 0，非法值使整条摄入无效，不能从体积或能量反推。

胃复用既有固/非固餐排空比例，小肠只吸收轮初碳水。六个 transfer 配对都以 g 为单位：

```text
stomach.carbohydrateG        → smallIntestine.carbohydrateG
smallIntestine.carbohydrateG → glucose.glucoseMassG
liver.glycogenG              → glucose.glucoseMassG
glucose.glucoseMassG         → kidneyGlucose.excretedGlucoseG
glucose.glucoseMassG         → liver.storageG
glucose.glucoseMassG         → muscleGlucose.uptakeG
```

transfer 图按来源 → 目标列出；Gateway 按 transfer 对键逐笔结算（`gateway/operations.js:206`），与脚本调用顺序无关。`glucose` 的三个出口等价于肾糖 → 肝储存 → 肌肉的目标名顺序；`liver` 的释放是另一笔转移。

胃总碳水由 Gateway 扣转移量，`solidCarbohydrateG` 是其中固餐子集并由胃脚本预先扣除本轮固体排空，不能重复加总或双扣。多轮队列保存碳水余量，旧档缺碳水按 0；legacy `motility.ts` 不保留碳水队列元数据。

`glucose` 以 75 kg、`1.88 dL/kg`、90 mg/dL 和 60 min 残余清除半时作为固定边界，均为 `design`；60 min 只用于自身残余清除（脑/红细胞等非器官组织），不按 `insulinRelative` 缩放。分布体积只借 Dalla Man 2007 的可及池定义与平均模型量级，不是血浆体积或个体实测；基线是初始量和残余清除下限，低于基线时本隔室不补糖，是否回升由 `liver` 的真实释放决定。每次结算：

```text
E = max(0, M_start − B)
D = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))      （与 I 无关）
M_after = M_start − D
X = min(max(0, kidneyGlucose.excretionRequestG), M_after)
L_paid = min(liver.storageRequestG, M_after − X)
U_paid = min(muscleGlucose.uptakeRequestG, M_after − X − L_paid)
W = M_after（只扣自身残余清除）
write { glucoseMassG: W, concentrationMgDl: M_start × 1000 / V,
        disposedGlucoseG: D, excessMassG: E }
```

请求由各部位在上一轮按轮初 `excessMassG` 与 `insulinRelative` 计算：肌肉 `0.5 × E/(E + 20) × (1 + 1.0 × (I − 1)) × dtMin`；肝 `min(0.2 × E/(E + 15) × (1 + 0.5 × (I − 1)) × dtMin, max(0, capacity − (glycogenG + storageG)))`。请求不是质量；余额不足时后结算者被钳位，`glucose` 不重新计算组织响应，也不读肝容量。总清除量是肌肉请求、肝请求与自身残余清除的涌现结果，不再承诺与旧的中央分配模型逐位一致；`muscleDisposalShare`、`liverDisposalShare` 与 `D_total` 已废止，`apparentDisposalHalfTimeMin` 更名为 `residualDisposalHalfTimeMin`（值仍 60）。`concentrationMgDl` 仍按轮初质量计算；肾糖 `X` 仍按旧表达式 `min(max(0, R), M_after)` 钳位。`excessMassG` 只由 `glucose` 写出，其他部位只读不写。浓度按轮初质量计算：默认摄入第 1 轮入胃、第 2 轮胃排入小肠、第 3 轮首次吸收、第 4 轮才看到浓度与 `excessMassG` 上升；胰腺在第 4 轮仍读旧 90、第 5 轮写出升高的 `insulinRelative`，肌肉与肝第 5 轮写首批请求，第 6 轮 `glucose` 才首次结算到账。

`pancreasEndocrine` 只写两个无量纲信号（1 为基线）：`insulinRelative` 供 `muscleGlucose` 与 `liver` 各自计算摄糖请求（肌肉敏感度 1.0、肝 0.5），`glucagonRelative` 供 `liver` 放大释放；都不是激素浓度、分泌率、C-peptide 或实测值，0.02 增益、10 min 半时和 5 倍上限都是 `design`、`source: null`。`glucagonRelative` 的目标为 `clamp(1 + 0.02 × (90 − G), 0, 5)`，方向与胰岛素相反；当前增益下 `G = 0` 的目标只有 2.8，5 只是参数变化时的保护。`kidneyGlucose` 读取轮初浓度和 `io.dt`，写出下一轮 `excretionRequestG` 并把 `excretedGlucoseG` 每轮归 0；`glucose` 先算 `M_after`，按“肾 → 肝 → 肌”依次支付 `X = min(max(0, R), M_after)`、`L_paid = min(storageRequestG, M_after − X)`、`U_paid = min(uptakeRequestG, M_after − X − L_paid)`，write `W = M_after（只扣自身残余清除）`。请求本身不进入质量账，只有实际 transfer 计入；余额不足时后结算者被钳位，质量守恒仍精确。肾糖阈值和滤过锚点来自 Dalla Man 2007 正常组 `k_e1 = 0.0005 min^-1`、`k_e2 = 339 mg/kg`（`prior`），1.88 dL/kg 与 75 kg 是重复配置的 `design`。肾糖只记 g 质量汇，不计算尿量、尿糖浓度或渗透性利尿。

`muscleGlucose` 每轮读轮初 `glucose.excessMassG` 与 `insulinRelative`，写 `uptakeRequestG`；下一轮 `glucose` 结算，实际支付进入 `uptakeG`；再下一轮把在途 `uptakeG` 入账 `glycogenG`。`exercise` / `sex` 动作第 1 轮进入 `physicalActivity`，第 2 轮肌肉开始按轮初活动消耗糖原，糖原不足时钳到可用量。`liver` 同样读轮初 `excessMassG` 与 `insulinRelative`，写 `storageRequestG` 并自己钳到剩余容量；实际到账进入 `storageG`，下一轮并入 `glycogenG`。低血糖侧：`liver` 按轮初 `glucose.concentrationMgDl` 与 `glucagonRelative` 决定是否释放，`G < 90` 或 `H > 1` 时 `release = min(1 × H × dtMin, max(0, stored))`，当轮 transfer 回 `glucoseMassG`；存量耗尽后为 0。容量只限制新的储存请求，不截断已有存量或释放；肌肉不向血液释放葡萄糖，只有肝发起释放。`glucose` 不读肝容量或存量，也不写任一部位的字段。

外源碳水质量账各项与恒等式不变，在原有各项上增加实际肾排泄、肌摄糖、肌糖原与肝糖原项：

```text
累计摄入碳水
= stomach.carbohydrateG
+ Σ mealQueue.remainingCarbohydrateG
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

`disposedGlucoseG` 只表示 `glucose` 自身残余清除；三个请求字段（`excretionRequestG`、`liver.storageRequestG`、`muscleGlucose.uptakeRequestG`）都不累计，只有实际 `excretedGlucoseG`、`liver.storageG` 与 `muscleGlucose.uptakeG` 才从 `glucose.glucoseMassG` 转出并计入；女性变体另把实际 `mammaryGlands.lactoseG` 计入。`muscleGlucose.uptakeG` 是聚合器在途量，区域的 `glycogenG` 是已入账区域糖原，区域 `uptakeG` 是已分配但尚未入账的在途量，区域 `glycogenConsumedG` 是每轮消耗通量、需累计；这些项不能重复加总。`liver.glycogenG − 80` 是肝糖原相对初始禀赋的净变化，`liver.storageG` 是在途储存；`liver.outputG` 是内部转移记录，不另加。`liver.glycogenCapacityG` 是常量容量字段，不是质量，也不进质量账。池内质量账为 `M_start = M_final + X + (D + L_paid + U_paid + G_paid)`（不含同轮肝释放；女性变体 `G_paid` 为乳汁乳糖），余额不足时后结算者被钳位；请求本身不进入质量账。完整水/碳水闭包必须同时包含 `hydration.ts`、`smallIntestine`、`bodyFluid`、`bladder`、`glucose`、`liver`、`kidneyGlucose`、`muscleGlucose`、`muscleHead`、`muscleTrunk`、`muscleLimbs`、`skin`、`lungs` 十三部位（活动—出汗薄切片加入 `skin`，运动相关呼吸失水加入 `lungs` 出口，肌摄糖加入 `muscleGlucose` 出口，分区肌肉加入三个区域出口，肝糖原加入 `liver` 与 `glucose` 双向配对）；女性清单再加 `uterus` 与 `mammaryGlands`，为 15 部位；缺任一 transfer 配对在启动时报错。根清单当前 32 部位、31 份参数文件，女性清单 35 部位、34 份，男性清单 34 部位、33 份。

模块和真实根清单 Gateway 测试覆盖同体积/能量 A/B、逐轮外源碳水质量账、三轮固体队列、非基线吸收后重启和旧档默认值；当时 13 部位验收记录保留，后续 15 部位集成测试覆盖胰腺 `I = 1` 基线、第 4/5/6 轮与肾糖跨阈后请求/结算；骨骼肌摄糖接入后根清单 19 部位，性反应周期接入后为 20 部位，血氧池与自动通气接入后为 22 部位，肝糖原与胰高血糖素接入后为 23 部位、25 份参数文件；内分泌轴与松果体接入后为 28 部位、30 份参数文件，唾液腺接入后为 29 部位、31 份参数文件，分区骨骼肌接入后当前为 32 部位、31 份参数文件（区域共享现有参数文件）。真实 Gateway 账本需覆盖肌摄糖、区域糖原、区域运动消耗、肝储存、肝容量钳位、满肝请求为 0、按序结算与肝释放，活动—出汗与运动呼吸失水薄切片见上文 M4 节；分区肌肉的份额、缺区域归一、旧档迁移与重启见 [`test/organs.muscle-regions-gateway.test.mjs`](../test/organs.muscle-regions-gateway.test.mjs)。真实 DSH 会话、长期曲线和独立生理数据对照未做。胰腺、肾糖与肝读取血糖浓度，肌肉与肝读取 `excessMassG`；体感或胃排空仍不读取血糖，四类通知也不含血糖。完整设计见 [`2026-11-22-carbohydrate-glucose-design.md`](./superpowers/specs/2026-11-22-carbohydrate-glucose-design.md)、[`2026-11-22-pancreas-insulin-design.md`](./superpowers/specs/2026-11-22-pancreas-insulin-design.md)、[`2026-11-23-renal-glucose-design.md`](./superpowers/specs/2026-11-23-renal-glucose-design.md)、[`2026-11-23-muscle-glucose-uptake-design.md`](./superpowers/specs/2026-11-23-muscle-glucose-uptake-design.md)、[`2026-11-23-liver-glycogen-design.md`](./superpowers/specs/2026-11-23-liver-glycogen-design.md) 与 [`2026-11-24-tissue-uptake-design.md`](./superpowers/specs/2026-11-24-tissue-uptake-design.md)。

**仍未实现：** 胰岛素/胰高血糖素绝对浓度与分泌、C-peptide、两室激素动力学、α/β 细胞相互抑制、肝糖异生、酶促糖原合成/分解、脂肪组织分区、脂肪摄糖、肌糖原容量与静息周转、慢速组织隔室、渗透性利尿、血糖对体感或胃排空的反馈，以及任何自动行为。M2 薄切片已含骨骼肌摄糖与分区肌糖原（自主请求、聚合器分配、区域下一轮入账、区域运动消耗）与肝糖原储存/释放（自主请求按容量钳位、低血糖当轮释放、存量限制），但没有激素浓度、肝糖异生或独立数据验证，不能当成完整 M2。

### 分区骨骼肌薄切片：当前实现、独臂变体与未验证

**当前实现。** 肌糖原从旧的单一 `muscleGlucose` 拆成 `muscleHead`（头颈）、`muscleTrunk`（躯干）、`muscleLimbs`（四肢）三个独立部位，脚本为 `skeletal-muscle/regions/{head,trunk,limbs}.ts`，共享 `regions/region-core.ts`。`muscleGlucose`（`glucose-uptake.ts`）保留为聚合器：每轮用轮初 `glucose.excessMassG` 与 `pancreasEndocrine.insulinRelative` 写 `uptakeRequestG`；`glucose` 下一轮结算，实际到账进入 `muscleGlucose.uptakeG`；聚合器再下一轮按 0.05 / 0.45 / 0.50 的 `design` 份额把在途量 transfer 给已加载区域，最后一笔取剩余量。区域各自持有 `uptakeG` / `glycogenG` / `glycogenConsumedG`，下一轮把 `uptakeG` 入账并按轮初 `physicalActivity` 消耗；`glycogenUseRateGPerMin = 0.5` 由三个区域共享，因此 `intensity = 1` 时每区域 0.5 g/min、合计 1.5 g/min，不是旧单部位 0.5 g/min 的速率；质量账按各区域实际值累计，外源碳水总账与旧模型仍逐轮守恒。所有参数沿用 `glucose-uptake.parameters.json`，不新增区域参数文件；全部 `design`、`source: null`。旧档只有 `muscleGlucose.glycogenG` 时，各区域第一轮按存在区域归一后的份额并入糖原，聚合器第一次 write 后不再保留旧总量；在途 `uptakeG` 仍按正常时序分配，区域下一轮入账。真实 Gateway 测试见 [`test/organs.muscle-regions-gateway.test.mjs`](../test/organs.muscle-regions-gateway.test.mjs)，覆盖餐后份额、区域运动消耗、旧档迁移、重启接续与独臂变体；根清单当前 32 部位、31 份参数，女性清单 35 部位、34 份。

**独臂变体用法。** 缺失区域不能只从清单删掉区域脚本：正常聚合器的 `transferOut` 固定声明三个目标，删掉 `muscleLimbs` 会让 Gateway 以 `transferOut target "muscleLimbs.uptakeG" is not declared` 拒绝启动。正确做法是复制清单，去掉 `./organs/human-organs/skeletal-muscle/regions/limbs.ts`，并把 `./organs/human-organs/skeletal-muscle/glucose-uptake.ts` 换成 `./organs/human-organs/skeletal-muscle/glucose-uptake.no-limbs.ts`。变体只声明 `muscleHead` / `muscleTrunk`，份额自动归一为 0.1 / 0.9；同一清单不能同时加载两个聚合器入口（`id` 都是 `muscleGlucose`），变体要配独立 `statePath`。这是 `policy`：只按现有区域归一，不推断缺失肢体的肌肉质量；更细的左右臂/左右腿拆分与残肢局部代谢未建。

**未建模。** 区域肌肉绝对质量与质量分布、区域血流与纤维类型、肌群疲劳/延迟酸痛、左右肢体与皮肤分区、运动类型/MET/强度非线性、乳酸与 Cori 循环、脂肪组织分区、个体差异、区域耗竭对活动或疲劳的反馈；区域之间不互相搬运糖原，某区域耗尽后不虚构补充，消耗不回流血糖或肝，肌肉不向血液释放葡萄糖。区域份额与共享消耗速率是工程假设，不随动作类型或肢体使用变化。

**未验证。** 没有区域肌肉质量分布实测、独立区域肌糖原/运动生理数据、真实 DSH 会话、临床验证或分区后 32 / 35 部位性能实测；旧档迁移只有离线 Gateway 测试。0.05 / 0.45 / 0.50 份额、0.5 g/min 区域消耗速率、0.5 g/min 最大摄糖速率、20 g 半饱和与 1.0 敏感度都不能称 `validated` 或人体测量。设计见 [`2026-11-24-regional-muscle-design.md`](./superpowers/specs/2026-11-24-regional-muscle-design.md)，部位契约见 [`skeletal-muscle`](../organs/human-organs/skeletal-muscle/README.md) 与 [`regions`](../organs/human-organs/skeletal-muscle/regions/README.md)。

**调研与后续重审。** 睡眠和排便的调研结论仍是暂缓。糖代谢调研最初也暂缓；用户随后明确“共享 JSON 状态交互即可分阶段交付，不要求行为闭环”，本轮因此只实现上述薄切片。调研和路线图的完整 M2 目标不因这次实现而视为全部批准或完成。

### 血糖双向自调节与自主摄糖薄切片：当前实现

**当前实现。** 高血糖侧：`glucose` 写出 `excessMassG = max(0, M − B)` 与自身残余清除 `D = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))`（与胰岛素无关）；`muscleGlucose` 与 `liver` 各自按轮初 `excessMassG`、`insulinRelative` 与自己的最大速率、半饱和、敏感度写 `uptakeRequestG` / `storageRequestG`，肝再自己钳到 `max(0, glycogenCapacityG − (glycogenG + storageG))`；`glucose` 下一轮按“肾 → 肝 → 肌”结算，`L_paid = min(storageRequestG, M_after − X)`、`U_paid = min(uptakeRequestG, M_after − X − L_paid)`，write `W = M_after（只扣自身残余清除）`。肝满时 `storageRequestG = 0`，未请求部分留在血糖池；总清除轨迹由请求与残余清除涌现，不再与旧的中央分配模型逐位一致。低血糖侧：`pancreasEndocrine.glucagonRelative` 按 `clamp(1 + 0.02 × (90 − G), 0, 5)` 反向趋近，`liver` 在 `G < 90 || H > 1` 时释放 `min(1 × H × dtMin, stored)`（`stored = max(0, prev.glycogenG + prev.storageG)`，缺失/非数值/非有限字段按 0 代入），由 `liver` 自己发起 `liver.glycogenG → glucose.glucoseMassG`，提交后血糖质量回升；存量耗尽后 `release = 0`。容量只限制新的储存请求，不截断已有存量或释放。`liver.glycogenG` 只声明 `transferOut: ['glucose.glucoseMassG']`，`liver.storageG` 只声明 `transferIn: ['glucose.glucoseMassG']`，`liver.storageRequestG` 是请求、不参与 transfer，`liver.glycogenCapacityG` 是常量容量字段，`liver.outputG` 是释放记录、不进质量账。`disposedGlucoseG` 只表示 `glucose` 自身残余清除，不随肝容量变化。

**时序与旧档。** 第 N 轮 `glucose` 写出 `excessMassG`；第 N+1 轮聚合器与肝写请求；第 N+2 轮 `glucose` 结算，实际到账进入 `muscleGlucose.uptakeG` / `liver.storageG`；第 N+3 轮聚合器按区域份额转给区域、肝并入 `glycogenG`；第 N+4 轮区域并入 `glycogenG`。释放由肝当轮完成，但 `glucose.concentrationMgDl` 仍按轮初质量计算，所以浓度回升再晚一轮。旧档缺 `liver` 补 `storageRequestG = 0`、`glycogenG = 80`、`storageG = 0`、`glycogenCapacityG = 100`、`outputG = 0`；缺 `muscleGlucose` 补 `uptakeRequestG = 0`、`uptakeG = 0`，缺区域补 `uptakeG = 0`、`glycogenG = 0`、`glycogenConsumedG = 0`；旧档只有 `muscleGlucose.glycogenG` 时各区域第一轮按份额迁移，聚合器第一次 write 后旧总量不再保留；`glucose` 的 `excessMassG` 首轮由轮初质量现算；`pancreasEndocrine` 旧档补两个相对信号 1，不反推历史。含 `glucose` 的完整清单必须含 `liver`、`muscleGlucose` 与三个区域（或对应缺区域变体），否则启动报 transfer 配对错误；重启保留请求、存量与在途 `storageG` / `uptakeG`，下一轮只处理一次，容量每轮由 `liver` 按参数重写为 100。加入本切片后根清单为 23 部位、25 份参数文件，女性清单 25 部位、27 份，硬闭包为根 10 部位、女性 11 部位；乳腺切片后为根 29 / 31、女性 32 / 34，硬闭包为根 10 / 女性 12；分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34，硬闭包为根 13 / 女性 15。

**未建模。** 不建胰岛素/胰高血糖素绝对浓度、分泌率、C-peptide、两室激素动力学、α/β 细胞相互抑制、受体或胞内信号；不建肝糖异生、酶促糖原合成/分解、乳酸/Cori 循环、脂肪组织分区、酮症、尿素循环、肝血流；也不建胆汁生成/排泄、解毒、蛋白合成、脂肪代谢或其他肝功能。容量固定为 100 g，不随年龄、体重、进食状态、激素或肝体积变化，不建容量反馈或超容量存量对释放的抑制。释放只来自肝糖原存量，不等于完整低血糖反调节。

**后续项（计划）。** 肾糖异生（长期空腹约占内源葡萄糖 20–25%，低血糖时也能由肾释放）；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。这些都不是当前实现。

**未验证。** 没有肝糖原实测、容量实测、独立血糖曲线、激素浓度、正常餐后曲线复现、真实 DSH 会话或临床验证；`liver.initialGlycogenG = 80`、`liver.glycogenCapacityG = 100`、`liver.maxOutputRateGPerMin = 1`、`liver.maxUptakeRateGPerMin = 0.2`、`liver.halfMaxExcessG = 15`、`liver.insulinSensitivity = 0.5`、`muscleGlucose.maxUptakeRateGPerMin = 0.5`、`muscleGlucose.halfMaxExcessG = 20`、`muscleGlucose.insulinSensitivity = 1.0`、`glucose.residualDisposalHalfTimeMin = 60`、glucagon 的 0.02 增益 / 10 min 半时 / 5 倍上限全部是 `design`、`source: null`，不能称 `validated`、拟合值或个体预测；当时 29 部位性能也未实测；分区肌肉接入后当前根清单 32 部位，也未做性能实测。设计见 [`2026-11-23-liver-glycogen-design.md`](./superpowers/specs/2026-11-23-liver-glycogen-design.md) 与 [`2026-11-24-tissue-uptake-design.md`](./superpowers/specs/2026-11-24-tissue-uptake-design.md)，部位契约见 [`liver`](../organs/human-organs/liver/README.md)、[`skeletal-muscle`](../organs/human-organs/skeletal-muscle/README.md) 与 [`pancreas`](../organs/human-organs/pancreas/README.md)。

### 生殖系统薄切片（女性独立清单）：当前实现

当前链为 **`ovaries` 周期钟 → `uterus` 内膜/月经失水/痛经代理 → `body-water/water.female.ts` 第四出口 → `uterus.bleedingMl`；`uterus.crampMm` 另由 `interoception.discomfort` 第五路软读**。它只服务女性清单，不进入根清单。

**当前实现。** `ovaries/menstrual-cycle.ts` 只读自身轮初状态与 `io.dt`，维护 `cycleDay`、`cycleLengthDays`、`phase` 与 `estradiolRelative` / `progesteroneRelative`：周期 29.3 天、卵泡期 16.9 天、黄体期参数 12.4 天；`cycleDay` 每轮推进 `dtMin / 1440` 并回卷。相位边界是 16.9 天与 17.9 天；1 天排卵带是 `design`，嵌在 Bull 的卵泡期 + 黄体期合计 29.3 天之内，所以 `luteal` 相位实际跨 11.4 天，`lutealLengthDays = 12.4` 只作激素曲线的黄体中期锚点，不是相位边界。E2/P4 曲线是 `design` 分段线性、峰值归一为 1，不是 `pg/mL` / `ng/mL`。

`uterus/uterus.ts` 下一轮读轮初卵巢值与自身内膜，写 `endometriumRelative`（一阶趋近 `0.7 × E2 + 0.3 × P4`，半时 2 天）、`crampMm`（0–100 mm 代理，经期前段线性衰减）、`bleedingRequestMl`（经期按轮初内膜正比请求）与 `bleedingMl`（每轮 write 归 0，只由 transfer 增加）。女性清单缺 `uterus` 时启动报 `transferOut target "uterus.bleedingMl" is not declared`；无 `ovaries` 时子宫惰性，已加载但字段非法时整轮失败。

`body-water/water.female.ts` 复用 `water-core.ts` 与 `water.parameters.json`，在肾 → 肺 → 汗之后追加第四出口 `uterus.bleedingMl` 与第五出口 `mammaryGlands.milkMl`，月经失水与乳汁水只能使用前序出口后的轮初余量；水账在根清单恒等式上增加累计 `uterus.bleedingMl` 与 `mammaryGlands.milkMl`。`interoception` 的第五路为 `excess(uterus.crampMm)` 并入 `discomfort` 的最大值，`uterus` 未加载或字段缺失时按 0；不新增字段、不产生通知，`brainNotify` 仍只读四类体感。

**清单与计数。** 女性清单 [`body-modules.female.json`](../body-modules.female.json) 为 35 部位、34 份参数文件（根 32 部位 + `ovaries` + `uterus` + `mammaryGlands`，`water.ts` 换成 `water.female.ts`，`glucose.ts` 换成 `glucose.female.ts`），必须使用独立 `statePath`。根清单 `body-modules.json` 为 32 部位、31 份参数，不含卵巢/子宫/乳腺，`water.ts` 三出口、`glucose.ts` 三汇与根清单全部测试语义不变；`package.json` 的 `files` 同时收录根、女性与男性三份清单。这条切片不引入 `presets/`、生理性别预设或 condition 概念，选身体靠清单与存档。

**参数与证据。** Bull 2019（`SRC-BULL-2019`，npj Digit Med 2019;2:83，PMID 31482137）只支撑周期 29.3 天、卵泡期 16.9 天、黄体期 12.4 天与自报出血天数 4.0 天的队列均值；队列为 Natural Cycles 用户、厂商资助、仅排卵周期，不是本身体的个体预测或独立验证。`uterus.mensesDays = 4.0` 为 `prior` / `SRC-BULL-2019`；`startCycleDay = 5`、E2/P4 曲线、50 mL/周期、85 mm 痛经峰值、2.5 天痉挛窗、2 天内膜半时与 0.7/0.3 权重全是 `design`、`source: null`。

**未建模。** 不建性激素绝对浓度（`pg/mL`、`ng/mL`）、分泌/清除、HPO 轴、LH/FSH、排卵事件、黄体、受孕/着床/妊娠、避孕、子宫内膜毫米厚度/组织学、经血成分（血块、血红蛋白、铁）、凝血/纤溶、前列腺素、痛经机制与严重度分级、阴道/宫颈/外阴解剖、PCOS/子宫内膜异位/围绝经期等病理，也不建男性生殖器官与睾酮。痛经只进 `discomfort` 第五路，没有痛经通知；根清单身体没有这些部位。

**未验证。** 没有真实 DSH 会话、独立周期/经量/痛经/内膜数据、临床验证或 35 部位性能基线；该切片当时的离线 Gateway 测试只核对 22 部位启动、经期实际转移、`discomfort` 第五路、含出血的水账与重启接续。Bull 的队列均值不能当成个体预测或 `validated`。

### 性行为与性反应周期薄切片：当前实现

当前链为 **`sex { intensity, durationMin }` → `sexualResponse` 唤醒/反应周期；同一动作由 `physicalActivity` 计入体力活动 → `skin` / `lungs` / `muscleGlucose`；`orgasm` 动作（轮初 ≥70）或轮初 ≥95（无需动作）→ `sexualResponse` 释放；`interoception` 下一轮软读 `arousalMm` → `sexualArousalMm`**。`sexualResponse` 不是解剖器官，是性别中立的反应周期代理部位，目录仍放在 `organs/human-organs/sexual-response/`。

**当前实现。** `body_act` 的 `type` 枚举增加 `sex` 与无载荷 `orgasm`。`sex` 的载荷与校验同 `exercise`：`intensity` 有限且 `(0, 1]`，`durationMin` 有限且 `> 0`；不需要体积、能量、餐型或碳水，也没有伴侣、行为类型或内容字段。`orgasm` 只写 `{ type: "orgasm" }`；`sexualResponse.actionTypes = ['sex', 'orgasm']`，`physicalActivity` 仍只接受 `exercise` / `sex`。LLM 只控制输入、不直接写身体状态；`urinate` 与 `orgasm` 是少数允许主动触发的输出，分别有膀胱 >600 mL 非自主排空与唤醒 ≥95 强制释放兜底。`sexualResponse` 的五个字段都是 `absolute`：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `arousalMm` | `mm` | 唤醒代理 0–100；不是生理测量 |
| `phase` | `-` | `rest` / `excitement` / `plateau` / `orgasm` / `refractory` / `resolution` |
| `remainingSexMin` | `min` | 剩余性活动分钟；先按 `io.dt` 递减，再由合法 `sex` 替换 |
| `sexIntensity` | `1` | 模型内相对强度 0–1；不是 MET 或能量消耗 |
| `lastOrgasmAtSimMin` | `min` | 最近一次主动或强制释放的仿真分钟；从未发生为 `null` |

目标为 `100 × sexIntensity`；目标高于当前唤醒时用 5 min 半时上升，否则用 15 min 半时下降。释放只按轮初 `prev.arousalMm` 判定：本轮有 `orgasm` 动作且轮初 ≥`orgasmAllowedMm = 70`，或轮初 ≥`orgasmForcedMm = 95`（无需动作），就记一次 `lastOrgasmAtSimMin = simMin`；每轮最多一次。低于 70 的 `orgasm` 被忽略；本轮 `sex` 新推高的唤醒最早下一轮参与释放判定。事件轮 `sinceOrgasm = 0`、相位 `orgasm`；下一轮 `sinceOrgasm = dtMin`（60 s 轮下 1 min），进入 `refractoryMin = 20` 的不应期，目标为 0、唤醒下降。`orgasmDurationMin = 1`、相位 60 / 10 mm 分界与六个参数全部是 `design`、`source: null`，没有登记来源。

两个消费者：`physicalActivity` 的 `actionTypes = ['exercise', 'sex']`，两类动作共用 `remainingExerciseMin` / `intensity` 与同一校验，最后一条合法动作替换；`skin` / `lungs` / `muscleGlucose` 下一轮按轮初活动沿用既有汗液、运动相关呼吸失水与糖原消耗链。`orgasm` 只由 `sexualResponse` 接收，不改变活动。`interoception` 下一轮软读 `sexualResponse.arousalMm` 写 `sexualArousalMm`（钳到 0–100）；未加载、缺失或非有限按 0。`sexualArousalMm` 只进 `body_state` / `GET /state`，不进 `discomfort`，`brainNotify` 不读它，也不发通知。

动作轮 `sexualResponse` 与 `physicalActivity` 同时写各自状态；皮肤、肺、三个肌肉区域与体感最早下一轮读到。旧档缺 `sexualResponse` 时补 `arousalMm = 0`、`phase = 'rest'`、两个 0 与 `lastOrgasmAtSimMin = null`，不反推历史；重启保留剩余活动、唤醒与高潮时间，`null` 保持 JSON-safe，不重复记录已发生的高潮；重启后轮初 ≥95 仍会强制释放，<70 的 `orgasm` 仍被忽略。性反应周期加入后当时为根清单 20 部位、22 份参数文件，女性清单 22 部位、24 份；血氧池与自动通气切片加入后为根 22 / 24、女性 24 / 26；肝糖原切片加入后为根 23 部位、25 份参数文件，女性 25 部位、27 份；内分泌轴与松果体接入后为根 28 部位、30 份参数文件，女性 30 部位、32 份；唾液腺切片接入后为根 29 部位、31 份参数文件，女性 31 部位、33 份；乳腺切片接入后为根 29 / 31、女性 32 / 34，根 10 部位、女性 12 部位硬 transfer 闭包；分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34，硬闭包根 13 / 女性 15，本部位不声明 transfer。

**未建模。** 不建催产素、催乳素、内啡肽、睾酮/雌激素等激素，也不建心率、血压、呼吸频率、通气量、血流或独立的性反应自主神经通路；汗液与呼吸失水只复用 `physicalActivity`。不建受孕、着床、妊娠、生育力窗或避孕；不建性欲、动机、愉悦、情绪、亲密关系、伴侣、性传播感染或安全性行为；不建性别差异、个体差异、年龄/BMI/疾病影响、行为类型、体位、能量消耗/MET、临床性功能障碍或性反应周期测量。不描述、生成或要求任何显性内容、行为细节或解剖细节。`sexualArousalMm` 不进 `discomfort`，没有性唤醒、不适或高潮提醒；高潮由模型按轮初唤醒判定，LLM 只能提交无载荷 `orgasm` 请求，不能写 `phase` 或 `lastOrgasmAtSimMin`。

**未验证。** 只有离线模块、`physicalActivity` / `interoception` 集成与真实 Gateway 测试覆盖动作校验、时序、JSON-safe 与读数；没有真实 DSH 会话、独立人体性反应数据、临床验证或当时 20 部位性能基线。六个参数全是工程假设，不能称 `validated`，也不能把模型相位或 70 / 95 mm 阈值当作人体测量或诊断标准。

设计见 [`2026-11-23-sexual-response-design.md`](./superpowers/specs/2026-11-23-sexual-response-design.md)；部位契约见 [`sexual-response`](../organs/human-organs/sexual-response/README.md)。

### 血氧池与自动通气薄切片：当前实现

当前链为 **`physicalActivity`（`exercise` / `sex`）与 `duodenum.nutrientExposure` → `bloodOxygen` 供需平衡 → `lungsVentilation` 自动通气 → `bloodOxygen` 下一轮读肺泡供给；`interoception` 软读缺口写 `dyspneaMm`**。`bloodOxygen` 是隔室，位于 `organs/human-compartments/blood-oxygen/`；`lungsVentilation` 是肺目录的独立部位，与同目录的 `lungs` 失水部位不共享状态、不互相 `transfer`。

**当前实现。** `bloodOxygen` 只写四个字段，`lungsVentilation` 只写四个字段，二者都无动作、无通知、无 `transfer`，也不写其他部位。`bloodOxygen` 读轮初 `physicalActivity.remainingExerciseMin` / `intensity`、`duodenum.nutrientExposure` 与 `lungsVentilation.alveolarO2MlMin`：

```text
demand = 250 + 1000 × intensity（remainingExerciseMin > 0）+ 0.1 × nutrientExposure × 250
supply = lungsVentilation.alveolarO2MlMin（未加载时 = demand）
deficit = demand > 0 ? clamp((demand − supply) / demand, 0, 1) : 0
spo2Percent = 97 × (1 − deficit)
```

`lungsVentilation` 读轮初 `bloodOxygen.oxygenConsumptionMlMin`：

```text
targetVentilation = demand × 1.4 / 0.21
ventilationMlMin = clamp(targetVentilation, 6000, 60000)
respiratoryRatePerMin = clamp(ventilationMlMin / 500, 12, 40)
tidalVolumeMl = 500
alveolarO2MlMin = ventilationMlMin × 0.21 / 1.4
```

`bloodOxygen` 的四个字段是 `oxygenConsumptionMlMin`（`mL/min`）、`oxygenSupplyMlMin`（`mL/min`）、`spo2Percent`（`%`）与 `oxygenDeficit`（`1`）；`lungsVentilation` 的四个字段是 `tidalVolumeMl`（`mL`）、`respiratoryRatePerMin`（`1/min`）、`ventilationMlMin`（`mL/min`）与 `alveolarO2MlMin`（`mL/min`）。全部字段都是 `absolute`。

- **参数全部 `design`、`source: null`：** `bloodOxygen.basalMlMin = 250`、`activityGainMlMin = 1000`、`digestionGain = 0.1`、`baselineSpo2Percent = 97`；`lungsVentilation.restingTidalVolumeMl = 500`、`restingRatePerMin = 12`、`maxRatePerMin = 40`、`restingVentilationMlMin = 6000`、`maxVentilationMlMin = 60000`、`inspiredO2Fraction = 0.21`、`deadSpaceFactor = 1.4`。它们不是人体测量、血气、实测最大通气量或氧合曲线；`range` 只是工程调参范围。
- **供—需平衡，不是耗空账本。** 每轮按轮初快照重算供需，不保存氧气质量、不逐轮扣减、不累计氧债；供 ≥ 需时 `deficit = 0`、SpO2 停在 97%，供 < 需时按缺口比例下降。`spo2Percent` 与 `oxygenDeficit` 只是代理读数，不是脉搏血氧仪或血气分析。
- **自动通气与触顶。** 呼吸由 `lungsVentilation` 自动调节，`actionTypes = []`；LLM 不提交呼吸、屏气或过度通气动作。需氧上升先由血氧池写出，下一轮通气目标上升，再下一轮血氧池读到新供给；两处各有一轮滞后，运动开始后可能出现 1–2 轮短时缺口，通气跟上后回到基线，不是人体去饱和时程。默认肺泡氧供给上限为 `60000 × 0.21 / 1.4 = 9000 mL/min`；需氧持续超过该上限时才持续去饱和。频率读数在触顶时单独钳到 40 次/min，不再等于 `ventilationMlMin / tidalVolumeMl`。
- **气促读数。** `interoception` 软读 `oxygenDeficit` 写 `dyspneaMm = clamp(100 × deficit, 0, 100)`；`bloodOxygen` 未加载、字段缺失或非有限时按 0。`dyspneaMm` 不进入 `discomfort`，`brainNotify` 不读它，也没有气促通知或自动呼吸动作。
- **可选回退与异常。** 未加载 `bloodOxygen` 时通气按基础需氧 250 mL/min；未加载 `lungsVentilation` 时血氧池按 `supply = demand`、SpO2 保持基线；已加载但字段缺失、非有限或为负时抛错，本轮不写。合法的 0 值按 0 处理。
- **旧档与重启。** 旧档只为缺失的 `bloodOxygen` 补 `250 / 250 / 97 / 0`、为缺失的 `lungsVentilation` 补静息值 `500 / 12 / 6000 / 900`，不反推历史。没有累计氧气质量或氧债需要恢复；重启后第一轮按当时的轮初活动、营养暴露与存档通气重算，存活状态不重复扣。
- **清单与闭包。** 加入本切片后当时根清单为 22 部位、24 份参数文件，女性清单为 24 部位、26 份；两者都不新增 transfer，当时硬 transfer 闭包仍为根 9 / 女性 10 个部位；肝糖原切片加入后为根 23 / 25、女性 25 / 27；内分泌轴与松果体接入后为根 28 / 30、女性 30 / 32，唾液腺接入后为根 29 / 31、女性 31 / 33；乳腺切片后为根 29 / 31、女性 32 / 34，硬闭包为根 10 / 女性 12；分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34，硬闭包为根 13 / 女性 15。`physicalActivity` 与 `duodenum` 只是普通轮初读取，不在闭包内。

**未建模。** 不建血气分压（PaO2 / PaCO2）、血红蛋白浓度、氧合曲线、氧含量与氧输送；不建心输出量、血流分布、组织灌注与局部氧合；不建 CO2 产生/排出、酸碱平衡、呼吸商与代谢底物；不建呼吸力学、潮气量调节、高原/贫血/肺病/心血管病等病理缺氧，也不建吸氧、通气支持或呼吸机。LLM 不能提交通气动作；`dyspneaMm` 不进入 `discomfort`、不进入 `brainNotify`、没有气促通知。不建氧气质量守恒、累计氧债、组织缺氧损伤、乳酸、疲劳与运动耐量反馈；血氧下降不会自动限制活动或改变动作校验。不建 MET、能量消耗、体温、环境温湿度/海拔、年龄、性别、BMI、训练状态或个体差异；`intensity` 只是模型内相对强度。`spo2Percent` 不是脉搏血氧测量，`dyspneaMm` 不是呼吸困难量表、呼吸功或临床气促分级。

**未验证。** `bloodOxygen` 的四个参数与 `lungsVentilation` 的七个参数全部是 `design`、`source: null`，没有登记人体来源，也没有独立数据、临床验证或真实 DSH 会话验收。模块与真实 Gateway 离线测试只核对公式、供需平衡、时滞、触顶、回退、异常、旧档与 JSON-safe，不能把 SpO2、需氧、通气或 `dyspneaMm` 外推为人体测量、血气结论或疾病判断；也没有根 32 / 女性 35 部位性能基线。

设计见 [`2026-11-23-blood-oxygen-design.md`](./superpowers/specs/2026-11-23-blood-oxygen-design.md)；部位契约见 [`blood-oxygen`](../organs/human-compartments/blood-oxygen/README.md) 与 [`lungs`](../organs/human-organs/lungs/README.md)。

### 内分泌轴与松果体薄切片：当前实现

当前链为 **`hypothalamusEndocrine`（TRH/CRH）→ `pituitary`（TSH/ACTH/催乳素）→ `thyroid`（T4）/ `adrenal`（皮质醇）/ `mammaryGlands`（泌乳）；T4 与皮质醇反向抑制 TRH/TSH 与 CRH/ACTH；`pineal` 按仿真昼夜写褪黑素 → `interoception.sleepinessMm`**。五个内分泌部位都没有动作、通知或 `transfer`，本切片自身不新增硬闭包；分区骨骼肌接入后硬闭包为根 13 / 女性 15 个部位。

**当前实现。** `hypothalamusEndocrine` 读轮初 T4 与皮质醇，按 `clamp(1 + gain × (1 − 外周激素), 0, 3)` 写 TRH/CRH 目标，再以 30 min 半时一阶趋近；`pituitary` 读 TRH/CRH 与 T4/皮质醇，按 `TRH × (1 + gain × (1 − T4))` 写 TSH 目标、`CRH × (1 + gain × (1 − 皮质醇))` 写 ACTH 目标，也以 30 min 半时趋近；另按上一轮 `mammaryGlands.milkMl > 0`（吸吮/排空代理）把 `prolactinRelative` 目标抬到 2、无泌乳时回落到 1，同样以 30 min 半时趋近，2 倍目标与半时都是 `design` 常量。`thyroid` 以 60 min 半时把 T4 拉向轮初 TSH；`adrenal` 以 15 min 半时把皮质醇拉向轮初 ACTH。四个反馈增益与三个半时都是 `design`、`source: null`；T4/皮质醇高于 1 时同时压低上游目标，低于 1 时抬高，形成负反馈而不是单向放大。外周部位未加载时信号按 1 回退；已加载但字段缺失、非有限或为负时抛错，本轮失败。

**消费者。** `bloodOxygen` 的基础需氧改为 `250 × (0.8 + 0.4 × T4)`，未加载甲状腺时保持 250；T4 = 1 时为 300，T4 = 0.5 时回到 250，T4 = 2 时为 400。活动附加项与消化项仍按 250 计。`liver` 的释放改为 `min(1 × glucagonRelative × cortisolRelative × dtMin, stored)`，仍只在 `G < 90` 或 `glucagonRelative > 1` 时触发；皮质醇只是释放速率的乘数，不会单独启动释放。`interoception` 新增 `stressMm = clamp(100 × (cortisolRelative − 1) / 2, 0, 100)` 与 `sleepinessMm = clamp(100 × (melatoninRelative − 0.2) / 1.6, 0, 100)`，两者都不进 `discomfort`、不触发提醒，也不产生动作。

**松果体。** `pineal` 只读 `io.simulatedSeconds`，按 `hour = (simulatedSeconds / 3600) % 24` 与余弦曲线写 `melatoninRelative`，02:00 峰值 1.8、14:00 谷值 0.2、08:00/20:00 为 1；不读现实时间，也不保留自身历史。`sleepinessMm` 在 02:00 附近 100、08:00 为 50、14:00 为 0。曲线形状、相位、振幅与固定 24 h 周期全是 `design`，不是褪黑素实测或睡眠测量。

**时序与旧档。** 所有部位只读轮初快照：第 N 轮写出的 T4/皮质醇/褪黑素最早第 N+1 轮被消费者与上游负反馈读到；新的 TRH/TSH 再晚一轮进入下游。旧档缺五个部位时补 `trhRelative = 1`、`crhRelative = 1`、`tshRelative = 1`、`acthRelative = 1`、`thyroxineRelative = 1`、`cortisolRelative = 1`、`melatoninRelative = 1`，不反推历史；重启保留已提交值，`pineal` 下一轮按存档仿真时刻重算。五个脚本都没有 `resetOnStart`。

**清单与计数。** 加入本切片后根清单为 28 部位、30 份参数文件，女性清单为 30 部位、32 份；唾液腺接入后为根 29 / 31、女性 31 / 33；乳腺切片后为根 29 / 31、女性 32 / 34；分区骨骼肌接入后当前为根 32 / 31、女性 35 / 34。硬 transfer 闭包为根 13 / 女性 15 个部位。全部新参数都是 `design`、`source: null`；`thyroid`、`adrenal` 与 `pineal` 各有独立 README，`hypothalamusEndocrine` / `pituitary` 的字段与参数见 [`brain`](../organs/human-organs/brain/README.md)。

**未建模。** 不建 T3、反 T3、甲状腺结合球蛋白、碘摄入、甲状腺疾病；不建肾上腺素/去甲肾上腺素、醛固酮、RAAS、皮质醇昼夜节律与应激事件；不建激素绝对浓度、分泌脉冲、受体、结合蛋白、疾病或个体差异；不建光照、时差、自由运行周期、睡眠压力、睡眠行为或睡眠分期。**甲状旁腺与血钙暂缓（deferred）**：至少需要骨交换、肾钙排泄或饮食钙扰动源之一才成立，本切片不建 PTH、血钙、骨钙或钙调轴。

**未验证。** 没有激素实测、剂量反应、独立人体数据、临床验证或真实 DSH 会话验收；根 32 / 女性 35 部位性能未实测。四个反馈增益、30/60/15 min 半时、`0.8 + 0.4 × T4`、皮质醇释放乘数、褪黑素余弦曲线与两个新读数的换算全部是 `design`、`source: null`，不能称拟合、实测或 `validated`，也不能把 `stressMm` / `sleepinessMm` 当作压力、困倦量表、激素浓度或睡眠分期。模块与真实 Gateway 离线测试只覆盖公式、负反馈、消费者时滞、昼夜曲线、旧档与重启，不等于人体验证。设计见 [`2026-11-24-endocrine-axes-design.md`](./superpowers/specs/2026-11-24-endocrine-axes-design.md)。

### 唾液腺与口干薄切片：当前实现

`salivaryGlands`（`salivary-glands/saliva.ts`）按基础产率、`eat` / `drink` 的 5 min 刺激窗口和轮初 `bodyFluid.waterDeficit` 写出 `salivaRateMlPerMin` / `mealStimulusMin` / `mouthMoistureMm`。`duodenum` 在轮初 `stomach.emptiedCarbohydrateG > 0` 时按 `1 + duodenum.salivaryAmylaseGain × salivaRateMlPerMin / salivaryGlands.basalRateMlPerMin` 缩放到达速率；`interoception` 写 `dryMouthMm = clamp(100 − mouthMoistureMm, 0, 100)`。本切片无动作以外的接口、无 `transfer`、无通知，根 32 部位 / 31 份参数、女性乳腺切片后 35 / 34，硬闭包为根 13 / 女性 15。

- **当前实现。** `eat` / `drink` 后产率在 5 个 60 s 轮次为基线 3 倍，第 6 轮回到基线；`waterDeficit = 0.5` 时产率乘 0.75，`= 1` 时乘 0.5。旧档缺该部位时补基础产率、`mealStimulusMin = 0` 与基础湿润度；重启保留刺激窗口。两个消费者都读轮初快照：摄入轮本脚本写出刺激，`interoception` 下一轮读到新湿润度；`duodenum` 还要等胃排入，最早再下一轮才计入淀粉酶增益。
- **未建模。** 唾液水账（唾液不进出 `bodyFluid`）、淀粉酶浓度/活性/pH、吞咽与食管、口腔疾病与唾液腺结石、味觉与咀嚼、口咽解渴、个体差异与昼夜节律、免疫与口腔微生物组。
- **未验证。** 没有唾液流率、刺激窗口、脱水系数或淀粉酶增益的实测、独立人体数据、临床验证或真实 DSH 会话；本切片未做根 32 / 女性 35 部位性能实测，`dryMouthMm` 也不能当作口干量表或临床干燥症指标。设计与测试见 [`2026-11-24-salivary-glands-design.md`](./superpowers/specs/2026-11-24-salivary-glands-design.md) 与 [`salivary-glands`](../organs/human-organs/salivary-glands/README.md)。

### 乳腺泌乳薄切片：当前实现

女性清单新增 `mammaryGlands`（`mammary-glands/milk.ts`）与 `glucose.female.ts`。链为 **`pituitary.prolactinRelative` → `mammaryGlands.milkRequestMl` / `lactoseRequestG` / `fullnessMm` → `water.female.ts` 第五出口 `mammaryGlands.milkMl` 与 `glucose.female.ts` 末位汇 `mammaryGlands.lactoseG`；`interoception.discomfort` 第六路软读 `fullnessMm`**。根清单不加载乳腺，也不加载女性葡萄糖变体。

```text
dtMin = io.dt / 60
prolactinTarget = mammaryGlands.milkMl > 0 ? 2 : 1
prolactinRelative = target + (prev − target) × 2^(−dtMin / 30)
milkRequestMl   = 0.5 × prolactinRelative × dtMin
lactoseRequestG = milkRequestMl × 0.07
fullnessMm      = clamp(prev.fullnessMm + 4 × (milkRequestMl − prev.milkMl), 0, 100)
```

- **当前实现。** 乳腺只写自己的五个字段，无动作、无 `transfer`；`milkMl` / `lactoseG` 是 transfer 接收端，每轮 write 先归 0，下一轮轮初值就是上一轮实际到账量。请求与到账分离：第 N 轮写请求，`bodyFluid` / `glucose` 第 N+1 轮支付，`pituitary` 第 N+2 轮才读到 `milkMl > 0` 并把催乳素目标抬到 2；无泌乳时回落到 1。胀奶只在产奶请求大于上一轮实际泌乳量时累积，实际泌乳更多时回落，不反馈到产奶速率。
- **消费者。** `water.female.ts` 在肾 → 肺 → 汗 → 子宫之后追加第五出口，乳汁水只用前序出口后的轮初余量，水账增加累计 `mammaryGlands.milkMl`；`glucose.female.ts` 在肾 → 肝 → 肌之后追加第四汇，`G_paid` 最后被余额钳位，质量账增加累计 `mammaryGlands.lactoseG`；`interoception` 把 `fullnessMm` 钳位后并入 `discomfort` 第六路，未加载或字段非法按 0，不发通知。`pituitary` 的 `prolactinRelative` 是第三个相对信号，1 为基线，不是血浆催乳素浓度。
- **清单与计数。** 女性清单为 35 部位、34 份参数文件（新增 `mammary-glands/milk.parameters.json`）；根清单为 32 部位、31 份。女性清单使用 `water.female.ts` 五出口与 `glucose.female.ts` 四汇，硬 transfer 闭包为 15 部位（根 13 + `uterus` + `mammaryGlands`）；根清单 `glucose.ts` 的 `transferOut` 不含 `mammaryGlands.lactoseG`，`water.ts` 不含 `mammaryGlands.milkMl`，不因乳腺被强制要求。女性清单缺 `mammaryGlands` 时启动报 `transferOut target "mammaryGlands.milkMl" is not declared`。
- **旧档与重启。** 缺 `mammaryGlands` 时补五个 0（`milkRequestMl`、`milkMl`、`lactoseRequestG`、`lactoseG`、`fullnessMm`），缺 `pituitary.prolactinRelative` 时补 1；不反推历史泌乳。重启保留请求、实际到账与胀奶，上一轮通量不会重复累计。
- **未建模。** 婴儿、吸吮动作、哺乳行为、排空事件、乳头刺激、左右乳差异、孕期/产后阶段、哺乳期长短、乳腺病变、乳汁脂肪/蛋白/免疫成分、乳糖合成路径、受体动力学、乳房体积/压力/温度与个体差异。
- **未验证。** `basalMilkRateMlPerMin = 0.5`、`lactoseGPerMl = 0.07`、`fullnessGainPerMl = 4` 全部 `design`、`source: null`；没有实测泌乳率、乳汁乳糖浓度、胀奶量表、独立人体数据、真实 DSH 会话、临床验证或女性 35 部位性能实测。模块测试见 [`organs.mammary.test.mjs`](../test/organs.mammary.test.mjs)，真实 Gateway 测试见 [`organs.mammary-gateway.test.mjs`](../test/organs.mammary-gateway.test.mjs)。

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

M1 的真实 DSH 会话验收已完成；通知历史文件、模型已读确认与按会话绑定不同身体仍未实现。M3 水链的 Task 10 已用真实会话核对：`urinate` 的 queued → applied、同 callId 重试只排一次、当轮新尿留下，以及饮水/不饮水对照中的口渴、ADH、肾请求与尿意方向；30 轮 A/B 与排尿链均通过。M19 又补验了非自主排空、`discomfort` 与 DI 样变体（33/33 verdicts，2–5 轮短会话）。上述 M1/M3/M19 验收都早于尿意/口渴提醒合并，不能当作这些通道的实机验收；尿意和口渴提醒目前只有离线单元测试与真实 Gateway 集成测试（`test/organs.brain-notify.test.mjs`、`test/organs.urinary-notify-gateway.test.mjs`、`test/organs.thirst-notify-gateway.test.mjs`），尚未做真实 DSH 会话验收。M4 活动—皮肤出汗与运动呼吸失水薄切片目前也只有模块与真实 Gateway 集成测试，尚未做真实 DSH 会话、独立人体出汗/呼吸失水数据或临床验证；血氧池与自动通气切片同样只有模块与真实 Gateway 集成测试，未做真实 DSH、独立人体氧耗/通气/SpO2 数据或临床验证；肝糖原与胰高血糖素切片同样只有离线模块与真实 Gateway 测试，未做真实 DSH、肝糖原/激素或独立血糖数据验证。离线守恒测试仍不能代替 120 轮长时程、通知/重启组合、大负荷利尿与口咽解渴的验收。

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
| 胰岛素的靶点敏感度 | Rizza 等的健康受试者钳夹实验中，肝糖输出达到半最大抑制和外周摄糖达到半最大反应所需的血浆胰岛素浓度分别约为 29 和 55 µU/mL。DSH 使用相对浓度时，只把“不同组织敏感度不同”作为方向参照，肌肉 1.0 / 肝 0.5 仍是 `design` 工程值，不是由该研究标定。 [Rizza 等，1981](https://pubmed.ncbi.nlm.nih.gov/7018254/) |
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

**后续项（计划，不是当前实现）：** 肾糖异生（长期空腹约占内源葡萄糖 20–25%，低血糖时也能由肾释放）；骨髓造血与胸腺/脾/淋巴免疫搁置（难做出效果）；胆囊不做（无脂肪消化链消费者）。它们尚未进入默认清单或当前糖链。
