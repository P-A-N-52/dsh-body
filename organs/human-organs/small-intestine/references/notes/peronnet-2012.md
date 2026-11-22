# peronnet-2012 — 口服 D₂O 标记水的吸收、分布与消失

| 项 | 值 |
| --- | --- |
| source_id | `SRC-PERONNET-2012` |
| PMID / DOI | `21997675` / `10.1007/s00421-011-2194-7` |
| 原文链接 | <https://pmc.ncbi.nlm.nih.gov/articles/PMC3351614/> |
| 归属系统 | 消化（小肠水吸收） |
| 取数 / 核对 | 实施 worker 逐项核对并读 PMC 全文 / 待复核 |
| 获取状态 | 全文（PMC 开放获取，CC BY-NC） |
| 取数日期 | `2026-11-22` |
| 许可 | 只登记数值与原句定位；不复制原图或整表 |

## 1. 能回答的问题

空腹健康年轻男性一次喝下 300 mL 含 D₂O 的水后，标记水何时出现在血浆、表观吸收半时多长、多久完成吸收与全身分布？

## 2. 设计与受试者

- 设计：单臂、一次口服标记水；用 1-CM、2-CM、N-CM 三种药代模型拟合 60 min 血浆 D/H 与随后 9 天尿 D/H。
- 人群：36 名健康年轻男性；25.4 ± 4.0 岁；体重 76.9 ± 8.6 kg；BMI 23.3 ± 2.0 kg/m²（mean ± SD，Table 1）。
- 纳入条件：体型瘦；病史、体检、血生化与血常规无影响研究变量的疾病；GFR 正常；不吸烟、不规律训练、每日酒精不超过两杯、不用影响消化/代谢/肾功能的药物。
- 样本量与分组：36 人；6 种低矿化度瓶装水各 6 人随机分配，组间无显著差异后合并分析。42%（15 人）由 2-CM 拟合规最好，58%（21 人）由 1-CM 拟合最好；这是拟合分组，不是预设实验臂。
- 餐前状态：隔夜空腹，08:00–09:00 饮下；前 2 天与后 9 天不运动、不饮酒，咖啡/茶每日不超过 3 杯，另每日饮同种水约 2 L（实际 1.97 ± 0.09 L/天）。
- 随机、盲法：水种类随机分配；摘要与 Methods 未描述盲法。

## 3. 刺激

- 饮品：低矿化度水，渗透压 <20 mOsm/kg；D₂O 0.10 g/kg 瘦体重（实测 6.54 ± 0.76 g，0.327 ± 0.038 mol）。
- 体积：300 mL；先 100 mL 溶标记物快速喝下，再用两次 100 mL 冲洗杯并喝下，全过程约 1 min。
- 能量与组成：0 kcal，无电解质或碳水化合物强化。
- 对照：无平行对照；6 种水合并，比较的是模型与时间过程。

## 4. 测量

- 仪器：同位素比质谱（H₂-water equilibration，Micromass Isoprime DI + Aquaprep）；血浆、血细胞、尿、唾液 D/H。
- 单位：D/H 为 ppm（相对 V-SMOW，155.76 ppm）；时间为 min 或 day；容积为 L；清除率为 L/day。
- 测的量：D/H 时间曲线；吸收半时 ta½、峰值 Cmax 与 Tmax、AUC、体液总量 TBW、中央/外周容积 V1/V2、分布半时 td½、消失速率 kr、更新半时 tr½、MRT、水清除率 Clw。
- 时间原点：饮下开始（time 0）。血样 0/5/10/15/20/30/60 min；尿样第 1/3/5/7/9 天晨起；60 min 到次晨之间无采血点（作者在 Conclusions 自述为局限）。
- 统计量：Methods Statistics 明确“mean and standard deviation”；组间用 Kruskal–Wallis、t 检验、单/双因素 ANOVA，P<0.05。
- 关键结果：血浆与血细胞 D/H 在 5 min 已显著高于基线（血浆 192.8 ± 30.6 ppm、血细胞 192.2 ± 30.8 ppm，基线血浆 148.8 ± 0.9 ppm，P<0.0001）；平均峰值在 20 min，个体峰值 15–60 min；ta½ 10.9 ± 3.6 min（2-CM，n=15）与 12.9 ± 7.0 min（1-CM，n=21）；td½ 12.5 ± 4.3 min；作者按 7×ta½ 推得约 99% 吸收在 ~75–90 min，并在摘要与讨论写完全吸收与分布约 75–120 min；平均吸收率约 3.3–4 mL/min。

## 5. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 血浆 D/H 5 min | `300ml-d2o` | `drink_start` | 5 min | 192.8 | mean | SD 30.6 | 36 | Results 第 1 段与 Fig. 1 |
| 基线血浆 D/H | `300ml-d2o` | `drink_start` | 0 min | 148.8 | mean | SD 0.9 | 36 | Results 第 1 段 |
| 吸收半时 ta½ | `300ml-d2o` | `drink_start` | 汇总终点 | 10.9 | mean | SD 3.6 | 15 | Table 2（2-CM, group 1） |
| 吸收半时 ta½ | `300ml-d2o` | `drink_start` | 汇总终点 | 12.9 | mean | SD 7.0 | 21 | Table 2（1-CM, group 2） |
| 分布半时 td½ | `300ml-d2o` | `drink_start` | 汇总终点 | 12.5 | mean | SD 4.3 | 15 | Table 2 脚注与 Fig. 3 |
| 完全吸收与分布 | `300ml-d2o` | `drink_start` | ~75–120 min | NA | unreported | none_reported | 36 | 摘要与 Discussion（7×ta½ 的文字概括） |

## 6. 可用于本项目

- 可支持：口服水吸收在饮后 5 min 内已可检出、完整吸收与分布跨数十分钟的探索性时间尺度；300 mL 水负荷下一阶吸收形式的定性合理性。
- 只可用于探索：`smallIntestine.absorption.halfTimeMin = 20 min` 的量级背景。20 min 是 `design`，不是本文拟合值；本文 ta½（10.9/12.9 min）是血浆示踪出现半时，不是肠腔水消失半时。
- 不可用于：把 75–120 min 当作小肠半时或肠段参数；把 D₂O 曲线当肠腔水量；外推到女性、老年人、非空腹、含能饮料、运动或热环境；个体参数标定。

## 7. 不能推出 / 未报告

- 没有肠段采样，无法区分胃排空与小肠吸收对血浆 D/H 的贡献。
- 没有肠腔水体积的直接测量；D₂O 是示踪水，不等于“纯水体积”或饮料体积。
- ta½ 依赖模型：N-CM 不估计 ta½；1-CM 与 2-CM 的分组由拟合优度决定。
- 75–120 min 是“完全吸收与分布”的文字概括，不是逐分钟测得的完成时刻。
- 36 人全是健康年轻男性、静息、空腹、单次 300 mL；不能外推到其他人群与饮用条件。
- 6 种水组间无显著差异，但每组仅 6 人；不能据此声称等价。
- 无口渴、胃排空、尿量或 ADH 测量。

## 8. 原文定位

- 摘要：Results 段（5 min 出现、~11–13 min 半时、~75–120 min 完全吸收）。
- 正文 Methods：Subjects（Table 1）、Labeled water ingestion and blood sampling、Measurement of D/H、Kinetics of ingested water、Statistics。
- 正文 Results：Fig. 1（60 min 血浆与血细胞 D/H）、Fig. 2（血浆与 9 天尿 D/H）、Table 2（模型参数）、Fig. 3（2-CM 微常数）。
- Discussion：Water absorption 段（75–120 min、3.3–4 mL/min、一阶动力学）。
- 补充材料：未查。

## 9. 复核记录

- 复核人 / 日期：待指定 / `2026-11-22`
- 抽读的图与点：Fig. 1 的 0 与 5 min 点；Table 2 的 ta½、Tmax、td½。
- 与取数行的差异：无；75–120 min 一行明确标为文字概括而非测点。
