# abrams-2002 — ICS 下尿路功能术语标准化（§3.2.4 膀胱容量与残余尿）

| 项 | 值 |
| --- | --- |
| source_id | `SRC-ABRAMS-2002` |
| PMID / DOI | `11857671` / `10.1002/nau.10052` |
| 原文链接 | <https://www.ics.org/publications/ici_3/v2.pdf/abram.pdf>（ICS 站点 PDF，期刊版 Neurourol Urodyn 21:167–178） |
| 归属系统 | 泌尿（膀胱、排尿术语） |
| 取数 / 核对 | 实施 worker 读 ICS PDF 全文并核对 §3.2.1 与 §3.2.4 / 待复核 |
| 获取状态 | 全文（ICS 站点 PDF） |
| 取数日期 | `2026-11-22` |
| 许可 | 只登记定义原句与节号；不复制原图或整表 |

## 1. 能回答的问题

下尿路功能的标准化术语如何定义膀胱测压容量、残余尿与充盈期感觉（FSF/FDV/SDV）？“排前量 = 排出量 + 排后余量”这个恒等式在术语中如何表述？

## 2. 设计与受试者

- 设计：国际尿控学会（ICS）标准化委员会术语报告；共识文件。
- 人群：不适用（无受试者）。
- 样本量与分组：不适用。
- 餐前状态、随机、盲法：不适用。

## 3. 刺激

不适用；本文规定术语与定义，不含实验刺激。

## 4. 测量

- 文件性质：症状、体征、尿动力学观察与病况的定义；不报告原始测量数据。
- 时间原点与采样：不适用（无受试者、无采样）。
- §3.2.4（Bladder capacity: during filling cystometry）原句：“Cystometric capacity is the bladder volume at the end of the filling cystometrogram, when “permission to void” is usually given. The end point should be specified, for example, if filling is stopped when the patient has a normal desire to void. **The cystometric capacity is the volume voided together with any residual urine.** (CHANGED)”
- 即：膀胱测压容量（排前量）= 排出量 + 残余尿。这是定义恒等式，不是某一人群的测量结果。
- §3.2.1（Bladder sensation during filling cystometry）定义：第一充盈感（first sensation of bladder filling）、首次尿意（first desire to void）、强烈尿意（strong desire to void，持续想排尿但无漏尿恐惧）、急迫（urgency，突发强烈想排尿）。尿意与充盈感按测压时的膀胱体积评价。
- 残余尿：全文只有 §3.2.4 这一处提到“any residual urine”；没有给出正常残余量的数值范围，也没有把某一数值定为正常。
- 儿童预期膀胱容量公式处写有“Assuming no residual urine”；那是公式的假设条件，不是正常残余量的标准。

## 5. 报告的结果

| quantity | arm | time_origin | time | value | statistic | uncertainty | n | locator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 膀胱测压容量定义 | NA | NA | NA | 排出量 + 残余尿 | NA | NA | NA | §3.2.4 |
| 正常残余量 | NA | NA | NA | 未规定 | NA | NA | NA | 全文（仅 §3.2.4 提及 residual urine） |

## 6. 可用于本项目

- 可支持：排尿结算采用“排前膀胱量 = 排出量 + 排后残余量”的定义关系；模型把 `voidedMl` 与 `postVoidResidualMl` 写成同一守恒式有术语依据。
- 只可用于探索：`bladder/storage.ts` 的结算结构与 `postVoidResidualMl = 0 mL` 的取舍背景。
- 不可用于：把 0 mL 残余说成 ICS 推荐值；引用本文支持任何具体残余量、正常上限或个体化残余；把术语定义当实测数据。

## 7. 不能推出 / 未报告

- 没有正常残余量的数值、分布或年龄/性别差异。
- 没有规定残余尿的测量方法（超声、导尿或公式）。
- 没有规定排尿量或膀胱容量的正常范围；容量是测压终点定义，不是人群阈值。
- 没有口咽解渴、饮水行为、ADH 或肾水处理内容。
- 没有原始数据、样本量或统计量；不能作为 `reported` 观测行使用。
- 2002 版是历史版本；后续 ICS 报告可能修订术语，本项目只按这一版的 §3.2.1/§3.2.4 引用。

## 8. 原文定位

- §3.2.1 Bladder sensation during filling cystometry（FSF/FDV/SDV/urgency 定义）。
- §3.2.4 Bladder capacity: during filling cystometry（“volume voided together with any residual urine”）。
- 期刊版：Neurourol Urodyn 2002;21(2):167–178；DOI `10.1002/nau.10052`。
- 补充材料：无。

## 9. 复核记录

- 复核人 / 日期：待指定 / `2026-11-22`
- 抽读的图与点：不适用；核对 §3.2.1 与 §3.2.4 原句及节号。
- 与取数行的差异：无；明确“正常残余量未规定”，模型 0 mL 仍为 `design`。
