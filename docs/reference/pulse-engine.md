# Pulse Physiology Engine 参考笔记

Pulse 是 Kitware 开发的开源 C++ 全人体生理模拟器，作为本项目的参考实现使用。源码只放在本地，不进入版本库。

## 1. 来源与版本

- 官方仓库：<https://gitlab.kitware.com/physiology/engine>
- 本地路径：`docs/reference/pulse-engine/`（相对本文件为 `./pulse-engine/`；`.gitignore` 已排除该目录）
- 分支：`stable`
- 版本：4.4.0
- 提交：`5e29e5b13710a08cec90874be7d36ecb192ebcda`（2026-09-30）
- 大小：约 257 MB
- 许可证：Apache-2.0。`NOTICE` 注明 fork 自 BioGears 6.1.1，并列出 Eigen、protobuf 等第三方依赖。

更新本地参考时重新浅克隆，或执行：

```sh
git -C docs/reference/pulse-engine fetch --depth 1 origin stable
git -C docs/reference/pulse-engine reset --hard origin/stable
```

## 2. 架构要点

Pulse 在代码职责上按系统拆分，但运行时不是原子隔离：

- 所有模型共享同一个 `Data` 对象。`Controller` 继承 `Data`，`GetRespiratory()` 等直接返回对应 Model 本身，不是快照拷贝（`src/cpp/engine/common/controller/Controller.cpp:190`）。
- 只有一个 `std::vector<Model*> m_Models`，按固定顺序执行 `PreProcess → Process → PostProcess`（`src/cpp/engine/common/controller/Controller.cpp:775`、`:1101`–`:1116`）。
- 顺序写死在 `src/cpp/engine/human_adult/whole_body/controller/Controller.cpp:100`：环境 → 循环 → 吸入器 → 呼吸 → 麻醉机 → BVM → 呼吸机 → 消化 → 肝 → 肾 → 神经 → 能量 → 内分泌 → 药物 → 血液化学 → 组织 → ECG → ECMO。
- 默认时间步 `0.02 s`（50 Hz，`src/cpp/engine/PulseConfiguration.cpp:462`），靠小步长和固定顺序维持耦合，不靠事务隔离。

因此可以借鉴它的系统划分、方程、参数和数据，但不要把“直接读写其他系统”的运行方式照搬进本项目的单写者模型。

## 3. 模块清单

### 3.1 器官系统

| 模块 | 模拟什么 |
| --- | --- |
| **CardiovascularModel** | 心脏（左右心、瓣膜、心包）与体循环/肺循环血管；心率、血压、心输出量、每搏量；心律失常、心包积液、心衰、出血、CPR |
| **RespiratoryModel** | 上/下气道、肺、呼吸肌、胸廓；气道阻力、肺顺应性、气体交换；中枢/外周化学感受器驱动的呼吸节律；机械通气、麻醉机、BVM、吸氧、吸入剂；哮喘、COPD、ARDS、肺炎、肺纤维化、肺分流、气胸/血胸、呼吸肌疲劳 |
| **NervousModel** | 压力感受器和化学感受器反馈；自主神经对心率、心肌弹性、血管阻力的调节；脑血流/CSF、脑状态、瞳孔 |
| **RenalModel** | 双肾、GFR、肾小管重吸收/分泌、电解质/水/尿素/葡萄糖/乳酸；输尿管、膀胱容量、排尿 |
| **GastrointestinalModel** | 胃排空、小肠食糜、营养吸收（葡萄糖、脂肪、钙、钠、尿素） |
| **EndocrineModel** | 胰岛素合成、肾上腺素/去甲肾上腺素释放 |
| **TissueModel** | 血液—组织物质交换、O₂/CO₂、葡萄糖/乳酸/脂肪、白蛋白、代谢产热、肝糖输出 |

### 3.2 功能系统

| 模块 | 模拟什么 |
| --- | --- |
| **BloodChemistryModel** | 血气分布、酸碱平衡、血红蛋白氧解离、CO₂ 平衡 |
| **EnergyModel** | 运动、代谢产热、体温、出汗、热阻 |
| **EnvironmentModel** | 环境温度、湿度、气压；辐射/对流/蒸发/呼吸散热 |
| **DrugModel** | PK/PD、给药、药物对心率/呼吸/神经肌肉阻滞/镇静的影响 |
| **HepaticModel** | 基本是空壳；没有独立肝脏模型，白蛋白在 TissueModel 里 |

### 3.3 设备

| 设备 | 模拟什么 |
| --- | --- |
| **AnesthesiaMachine** | 半闭式回路、压力控制通气、吸入麻醉剂、常见故障 |
| **BagValveMask** | 手动复苏球囊 |
| **MechanicalVentilator** | 通用呼吸机、多种通气模式、报警、与呼吸系统连接 |
| **Inhaler** | 定量吸入器、气溶胶沉积 |
| **ECMO** | 体外膜肺、VV/VA 插管、膜氧合、血泵 |
| **ECG** | 心电信号 |
| **SupplementalOxygen** | 鼻导管/面罩/非重复呼吸面罩（在呼吸模型内） |

### 3.4 框架与数据

| 部分 | 内容 |
| --- | --- |
| **Patient** | 性别、年龄、身高、体重、体脂、血容量、心率/血压/呼吸/潮气量基线、肺容积等；成人 18–65 岁，无儿科/老年 |
| **Conditions** | 13 类条件（另有 1 个基类）：ARDS、慢性贫血、COPD、慢性心包积液、慢性肾动脉狭窄、慢性心室收缩功能障碍、进食、脱水、肺泡交换受损、肺炎、肺纤维化、肺分流、脓毒症 |
| **Actions** | 约 40 个动作（48 个头文件，含基类/命令类）：出血、输液/输血、吸氧、机械通气、插管、胸腔穿刺、CPR、药物、运动、进食、排尿、用力吸/呼气、屏气等 |
| **Scenario** | 215 个 JSON，分 12 类：acls、combined、compartments、drug、energyenvironment、equipment、miscellaneous、modification、nutrition、patient、showcase、validation |
| **求解器** | Circuit（液/电/热集总电路）、Compartment/SubstanceTransport（物质传输图）、Saturation（氧解离/酸碱） |
| **稳定化** | 初始化后动态稳定，约 7 个呼吸周期（约 25 秒）收敛；再施加慢性病并重新稳定 |
| **验证数据** | `data/human/adult/validation/` 下的呼吸/循环/肾/环境/药代波形 CSV，以及 `baselines/` 的期望输出 |

## 4. 与本项目 11 个系统的对照

覆盖度是相对本项目需求而言，不是 Pulse 自身的完整度。

| 本项目系统 | Pulse 覆盖 | 可借鉴 | 需要自建或补足 |
| --- | --- | --- | --- |
| 运动 | 低 | Exercise 动作、呼吸肌疲劳、Tissue 代谢 | 骨骼肌、关节、姿势、肌群负荷/疲劳/酸痛 |
| 消化 | 中 | 胃排空、小肠吸收、葡萄糖/脂肪/钙/钠/尿素转运 | 口腔、唾液、食管、大肠、直肠、排便、菌群、肝脏 |
| 呼吸 | 高 | 气道力学、肺顺应性、气体交换、呼吸驱动、呼吸机/麻醉机/BVM | 分钟级聚合与子步策略 |
| 循环 | 高 | 心脏与体/肺循环、压力感受器、出血、CPR、心律失常 | 60 秒粒度的简化与重新标定 |
| 泌尿 | 中高 | 肾滤过/重吸收、输尿管、膀胱容量、排尿 | ADH、尿意与膀胱充盈感知 |
| 生殖 | 无 | — | 全部 |
| 神经 | 低–中 | 压力/化学感受器、自主神经、脑血流/CSF、瞳孔 | 睡眠、昼夜节律、体感、认知、感觉整合 |
| 内分泌 | 很低 | 胰岛素合成/释放、儿茶酚胺基线 | 胰高血糖素、皮质醇、甲状腺、ADH、褪黑素、饥饿素 |
| 免疫 | 无 | Sepsis 条件的数据定义可作字段参考 | 免疫细胞、炎症介质、部位档位与全身反应 |
| 感觉器 | 无 | 瞳孔反射可忽略 | 视觉、听觉、嗅味觉、触觉、冷热、痛觉、内脏感觉 |
| 被皮 | 低 | Energy/Environment 的出汗、体温、热交换、烧伤 | 皮肤分区、屏障、湿度、红肿、破损、触觉 |

补充事实：

- `Sepsis` 只有 CDM 数据定义和序列化，引擎侧未见消费，不构成免疫模型。
- `HepaticModel` 的 `PreProcess/Process/PostProcess/ComputeExposedModelParameters` 基本为空；白蛋白由 `TissueModel` 以固定速率产生。
- `GastrointestinalModel` 主要是胃和小肠；未见到完整的大肠、直肠、排便模型。
- `RenalModel` 有膀胱容量和 `Urinate`，但没有 ADH，也没有尿意这种主观信号。
- `NervousModel` 没有睡眠、昼夜节律、痛觉或认知；`Sleep` 只出现在线程休眠代码里。
- `EndocrineModel` 没有胰高血糖素、皮质醇、甲状腺、ADH、褪黑素、饥饿素。

## 5. 时间尺度

Pulse 内部默认 `0.02 s` 一步，本项目是 `60 s` 一轮：

| | 本项目 | Pulse |
| --- | --- | --- |
| 一“步”的仿真时间 | 60 s | 0.02 s（默认） |
| 调度频率 | 每 60 现实秒一轮 | 50 步/仿真秒；按需调用 |
| 与现实时间 | 1:1 对齐 | 不绑定，可快可慢；实时只是性能目标 |
| 推进 60 s 仿真 | 1 轮 | 1 次 API 调用约 3000 内部步 |
| 推进 12 h 仿真 | 720 轮 | 2,160,000 步 |

接入时只有两种现实选择：

1. **轮内子步**：heartbeat 仍是每分钟一次，由常驻 BodyWorker 执行，轮末一次 commit。呼吸/循环模块可用 0.02–0.1 秒子步算完这一分钟，再写回轮末聚合状态。
2. **分钟平均模型**：只保留分钟级趋势，用 Pulse 的方程和参数做平均化/离散化，重新标定时间常数、清除率和增益。

不能直接把 50 Hz 调好的参数原样放进 60 秒步长；呼吸波形、心搏和呼吸机送气会失真或失稳。

## 6. 许可证与数据来源

- Pulse 代码为 Apache-2.0。直接翻译或复制代码属于派生作品，需要保留 `LICENSE`、`NOTICE` 和版权声明，注明修改；只借鉴方程和参数通常不触发许可证义务，但仍应注明来源。
- 参数值本身多来自文献。Pulse 方法学文档里有参数表和引用，优先追溯到原始论文，用 Pulse 值做交叉验证。
- `data/` 没有单独的数据许可证。Pulse 自产的场景和基线可按 Apache-2.0 使用并注明；来自第三方论文/数据库的验证波形，权利可能在原作者或出版方，复制前要核对原始许可。
- 建议在每个系统的 `references/` 下记录：Pulse 版本/commit、文件路径和行号、公式、参数、单位、适用条件、原始文献。需要复制代码片段时，在项目根维护 `THIRD_PARTY_NOTICES` 或 `NOTICE`。

以上是工程习惯，不构成法律意见。

## 7. 待定取舍

以下只是候选，最终由项目决定。

| 处理方式 | 候选内容 | 说明 |
| --- | --- | --- |
| 直接借鉴，重写为 TS | 呼吸力学与气体交换、循环电路与心功能、肾滤过/重吸收、GI 吸收、Tissue 代谢、Energy 出汗/体温、Patient 基线、Conditions/Actions 分类、场景 JSON、验证波形 | 方程、参数和数据结构成熟，但不能直接编译 C++ |
| 借结构但简化 | 压力/化学感受器反馈、机械通气/麻醉机/BVM、血液化学/酸碱、ECMO | 保留输入输出和反馈结构，先用集总/代数近似 |
| 只借概念 | Circuit solver、Compartment transport、Stabilization、Data requests | 用简单 ODE、显式通量和存档代替通用求解器 |
| 不照搬 | 50 Hz 全身电路求解器、CDM/protobuf、完整药物 PK/PD、全套设备库、HepaticModel、Sepsis | 复杂度高、空壳，或与 60 秒粒度不匹配 |
| 必须自建 | 骨骼肌/关节/姿势/疲劳/酸痛、生殖、免疫、感觉器、被皮分区、睡眠/昼夜、饥饿素/褪黑素/ADH/皮质醇/胰高血糖素/甲状腺、体感与通报 | Pulse 没有或只有雏形 |

## 8. 关键文件索引

本地根目录为 `docs/reference/pulse-engine/`。

| 内容 | 路径 |
| --- | --- |
| 呼吸主模型 | `src/cpp/engine/common/system/physiology/RespiratoryModel.cpp` |
| 呼吸驱动（化学反馈） | `src/cpp/engine/common/system/physiology/RespiratoryModel.cpp:1695` |
| 压力/化学感受器 | `src/cpp/engine/common/system/physiology/NervousModel.cpp:274`、`:491` |
| 循环 | `src/cpp/engine/common/system/physiology/CardiovascularModel.cpp` |
| 肾与膀胱 | `src/cpp/engine/common/system/physiology/RenalModel.cpp` |
| 消化与吸收 | `src/cpp/engine/common/system/physiology/GastrointestinalModel.cpp` |
| 组织代谢 | `src/cpp/engine/common/system/physiology/TissueModel.cpp` |
| 内分泌 | `src/cpp/engine/common/system/physiology/EndocrineModel.cpp` |
| 能量与出汗 | `src/cpp/engine/common/system/physiology/EnergyModel.cpp:298`、`:682` |
| 环境热交换 | `src/cpp/engine/common/system/environment/EnvironmentModel.cpp` |
| 血液化学 | `src/cpp/engine/common/system/physiology/BloodChemistryModel.cpp`、`Saturation.cpp` |
| 设备 | `src/cpp/engine/common/system/equipment/` |
| 方法学文档 | `docs/Methodology/`（呼吸、循环、神经、肾、消化、内分泌、患者、呼吸机等） |
| 场景 | `data/human/adult/scenarios/` |
| 验证波形 | `data/human/adult/validation/` |

## 9. 维护记录

- 2026-11-20：首次建立。记录 `stable` 分支 4.4.0（`5e29e5b`）的模块清单、覆盖度、时间尺度和待定取舍。
