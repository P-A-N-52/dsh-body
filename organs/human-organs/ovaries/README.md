# 卵巢（ovaries）：周期钟与 E2/P4 相对量

**功能标签：** 生殖（女性周期钟、性激素相对量代理）。

`ovaries` 只有一个脚本 `menstrual-cycle.ts`，维护周期日、本身体周期长度、相位和雌二醇（E2）/孕酮（P4）两个 0–1 相对量。它没有动作、没有 `transfer`、不发送通知，也不读取其他部位。唯一消费者是 [`uterus`](../uterus/README.md)：子宫在下一轮按轮初快照读取本部位的 `cycleDay` / `estradiolRelative` / `progesteroneRelative`，生成内膜目标、月经失水请求与痛经代理。

**状态口径。** 当前实现（2026-11-23）：脚本与参数在 `organs/human-organs/ovaries/`，Bull 证据笔记在 [`references/notes/bull-2019.md`](references/notes/bull-2019.md)。本部位只随独立女性清单 `body-modules.female.json` 加载；根清单 `body-modules.json` 为 38 部位、34 份唯一参数文件，不含卵巢。女性清单为 41 部位、37 份唯一参数文件，并使用独立 `statePath`。Bull 只支撑周期与相位长度，激素曲线形状和其余参数都是 `design`；尚未做真实 DSH 会话、独立激素数据或临床验证。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `menstrual-cycle.ts` | `ovaries` | `cycleDay`、`cycleLengthDays`、`phase`、`estradiolRelative`、`progesteroneRelative` | 自己的轮初状态；`io.dt` | `menstrual-cycle.parameters.json` |

- `actionTypes = []`；无动作、无通知、不调用 `transfer`，不写其他部位。
- 参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。
- 本脚本没有 `resetOnStart`；`cycleDay` 随存档保留，重启接续，不按现实时间重算。

## 2. 字段与单位

五个字段都是 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `cycleDay` | `d` | 周期内第几天，`0 ≤ cycleDay < cycleLengthDays`；每轮推进 `dtMin / 1440`，到周期长度回卷。不是日历日期、排卵日或受孕日 |
| `cycleLengthDays` | `d` | 本身体使用的周期长度，来自参数 29.3 d；每轮重写，不是该身体的实测周期 |
| `phase` | `-` | `follicular` / `ovulatory` / `luteal` 字符串；模型相位，不是临床分期 |
| `estradiolRelative` | `1` | 雌二醇相对量 0–1，峰值归一为 1；不是 `pg/mL`、分泌率或实测浓度 |
| `progesteroneRelative` | `1` | 孕酮相对量 0–1，峰值归一为 1；不是 `ng/mL`、分泌率或实测浓度 |

时间原点：`cycleDay = 0` 表示周期第 1 天（Bull 定义中的记录月经第一天）。状态在轮末写出；`initialState` 的周期日由 `startCycleDay` 计算，不反推历史。相位和两个激素量都由同一个 `cycleDay` 决定，不读上一轮 `phase` 或激素值。

## 3. 相位与方程

设 `dtMin = io.dt / 60`、`dtDays = dtMin / 1440`，轮初周期日为 `D`：

```text
cycleDay = (D + dtDays) mod cycleLengthDays
phase =
  cycleDay < follicularLengthDays                  ? follicular
  : cycleDay < follicularLengthDays + 1            ? ovulatory
  :                                                  luteal
```

- `follicularLengthDays = 16.9`、`lutealLengthDays = 12.4` 来自 Bull 2019 的队列均值；周期长度 29.3 等于两者之和。
- 排卵带固定 1 天，是 `design`；它嵌在 Bull 的卵泡期 + 黄体期合计 29.3 天之内。因此模型里 `luteal` 相位从第 17.9 天开始，实际跨 **11.4 天**，不是 12.4 天。
- `lutealLengthDays = 12.4` 只作为激素曲线的形状参数，用来把黄体中期锚在 `follicularLengthDays + lutealLengthDays / 2 = 23.1` 天；它不是相位边界。Bull 的 16.9 + 12.4 是相邻分割，没有单独的排卵相位，不能用它反推本模型的相位边界。

激素曲线是分段线性 `design` 形状，不是实测浓度曲线，峰值归一为 1：

```text
E2(0) = nadir
E2(16.9) = 1
E2(17.9) = nadir
E2(23.1) = lutealBump
E2(29.3) = nadir

P4(0 … 17.9) = baseline
P4(23.1) = 1
P4(29.3) = baseline
```

各段在相邻锚点之间线性插值。回卷点两侧连续：E2 与 P4 的周期末值都等于周期首日值（`nadir` / `baseline`），回卷不会跳变。`cycleDay = 0` 时 E2 为 `nadir`、P4 为 `baseline`。脚本不对曲线另加钳位；参数范围 [0, 1] 与锚点关系保证输出落在 0–1。

## 4. 参数与来源

同目录 `menstrual-cycle.parameters.json`：

| 参数 ID | 默认值 | 单位 | 状态 | 来源 |
| --- | ---: | --- | --- | --- |
| `ovaries.cycleLengthDays` | 29.3 | `d` | `prior` | `SRC-BULL-2019` |
| `ovaries.follicularLengthDays` | 16.9 | `d` | `prior` | `SRC-BULL-2019` |
| `ovaries.lutealLengthDays` | 12.4 | `d` | `prior` | `SRC-BULL-2019` |
| `ovaries.startCycleDay` | 5 | `d` | `design` | — |
| `ovaries.estradiolNadirRelative` | 0.1 | `1` | `design` | — |
| `ovaries.estradiolLutealBumpRelative` | 0.5 | `1` | `design` | — |
| `ovaries.progesteroneBaselineRelative` | 0.05 | `1` | `design` | — |

`prior` 只表示已发表人群均值锚点，不是本身体的个体测量，也不是 `validated`。`startCycleDay = 5` 让新身体起始在经期之外（默认 4.0 天经期），避免首轮就产生痛经；它是 `design`，不是任何人的真实周期日。E2/P4 曲线形状（`nadir`、黄体中期次峰、P4 基线）全是 `design`，Bull 没有激素测量。参数文件里的 `range` 只是工程调参范围，不是人群百分位或个体预测区间。

## 5. 消费者与时序

消费者链只有一条：

```text
ovaries.cycleDay / estradiolRelative / progesteroneRelative
  → uterus（下一轮轮初读取）
      → endometriumRelative / crampMm / bleedingRequestMl
          → bodyFluid 女性变体（再下一轮结算月经失水）
          → interoception.discomfort（第五路软读 crampMm）
```

- Gateway 给同一轮所有脚本一份轮初快照；`uterus` 在下一轮才看到 `ovaries` 本轮写出的周期日与激素值，`interoception` / `bodyFluid` 再按各自轮初快照读取子宫字段。跨部位信号至少有一轮延迟，不能在同一轮里追上。
- `ovaries` 不调用 `io.transfer`，也不写子宫、体液或体感部位；`uterus` 是唯一直接读取本部位字段的脚本。
- 时间推进只用 `io.dt`，不用 `io.simulatedSeconds`、`io.wallTimeMs` 或现实时间猜周期进度。停机补算同样按已提交轮次推进，并受清单 `catchUpMinutes` 限制。

60 s 一轮时，`cycleDay` 每轮增加 `1 / 1440` 天；推进一整天需要 1440 轮。`cycleDay = 29.2` 再推进 1 天会回卷到 0.9，而不是 30.2。

## 6. 旧档与重启

- **新身体：** `initialState` 取 `startCycleDay = 5`（先按周期长度回卷），相位与 E2/P4 由该周期日计算。
- **旧女性档缺 `ovaries`：** 启动时只补本部位初值，不反推历史周期、历史相位或历史激素；已有 `uterus` 状态不被重置。
- **重启：** `cycleDay`、`cycleLengthDays`、`phase` 与 E2/P4 都随存档保留，下一次 heartbeat 从保存的周期日继续推进；不会每次启动回到第 5 天。超出 `catchUpMinutes` 的停机时间不按墙钟补算。
- **旧档字段缺失：** Gateway 用 `initialState` 递归补缺失键；参数文件改动只影响后续轮次，不追溯改写历史快照。
- 状态只含有限数字与字符串，JSON-safe；没有 `undefined`、`NaN`、`Infinity`、数组或嵌套对象。

## 7. 证据与不能推出

- **`SRC-BULL-2019` / [`bull-2019`](references/notes/bull-2019.md)：** Bull JR et al., *Real-world menstrual cycle characteristics of more than 600,000 menstrual cycles*, npj Digital Medicine 2019;2:83，PMID 31482137，DOI 10.1038/s41746-019-0152-7，PMC6710244，开放获取；登记见 [`source-index.csv`](../references/source-index.csv)。队列为 Natural Cycles app 用户，124,648 人、612,613 个排卵周期；只纳入算法检出排卵的周期，主要来自瑞典、英国和美国；研究由 Natural Cycles Nordic AB 资助，部分作者为雇员或创始人。作者自述队列不代表一般人群，肥胖比例低于一般人群，且近一半周期因未检出排卵被排除。
- 本切片（卵巢 + 子宫）只借四个队列均值：周期 29.3 ± 5.2 天、卵泡期 16.9 ± 5.3 天、黄体期 12.4 ± 2.4 天（Bull Table 1–3 "All cycles"），以及经期出血天数 4.0 ± 1.5 天（供 `uterus.mensesDays`）。这些是 app 自报与算法回溯的组均值，不是本身体的个体预测、正常范围或独立验证。
- Bull 不能推出激素绝对浓度（`pg/mL`、`ng/mL`）、激素曲线形状、排卵事件、受孕概率、经量（mL）、经血成分、子宫内膜厚度、痛经强度或临床分期；它也没有本模型的 1 天排卵带。
- 其余参数全是 `design`、`source: null`，不是人体测量或拟合；不因为参数挂在 Bull 笔记旁就变成 Bull 值。

## 8. 未建模

- **激素绝对浓度与调控：** 不建 E2/P4 的 `pg/mL` / `ng/mL`、分泌率、清除、脉冲、昼夜节律、HPO 轴反馈、LH/FSH、泌乳素或甲状腺激素；不把相对量换算成任何浓度。
- **排卵与受孕：** 没有排卵事件、卵泡生长、黄体形成/退化、受精、着床、妊娠或避孕模型；1 天排卵带只是相位标签，不是可检测的排卵日。
- **个体差异与病理：** 固定周期均值，不建周期长度变异、不规则周期、PCOS、甲状腺功能减退、子宫内膜异位、围绝经期、青春期、激素避孕或个体化周期预测。
- **男性生殖：** 不建睾丸、睾酮、精子发生或男性生殖道；根清单不含卵巢/子宫，女性清单是独立身体，不引入 `sex` 字段、`presets/` 或 condition 概念。
- **症状与行为：** 不建性欲、情绪、经前症状、乳房胀痛、基础体温、宫颈黏液、排卵痛或任何自动行为；本部位不产生动作、回执或通知。
- **未验证：** 没有真实 DSH 会话、独立周期/激素数据、临床验证或 41 部位性能基线；Bull 的队列均值不能当成本身体的验证结果。
