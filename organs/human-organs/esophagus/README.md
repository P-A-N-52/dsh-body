# 食管（esophagus）：食团转运与呛咳风险代理

**功能标签：** 消化（食团转运时延、呛咳风险读数）。

`esophagus` 目前只有一个部位写者 `esophagus.ts`。它把本轮合法的 `eat` / `drink` 体积记为在途食团，按固定转运时间递减，并把超过参考食团的部分映射成 0–100 mm 的呛咳风险代理；`interoception.discomfort` 以软读方式取该风险，超过不适起始值后并入第七路。

实现状态：脚本、参数与定向测试已在 `organs/human-organs/esophagus/`，并已加入根清单 `body-modules.json`、女性清单与男性清单。当前根清单 38 部位、34 份唯一参数文件，女性清单 41 部位、37 份，男性清单 40 部位、36 份。旧存档缺 `esophagus` 时由 `initialState` 补 0。

**清单依赖。** 本脚本不声明 `transfer`，不是硬 transfer 闭包成员，也不要求其他部位同时加载。`interoception` 只是可选软读：未加载 `esophagus` 时该路按 0。胃的摄入时刻由胃脚本按既有动作队列结算，不依赖本部位；因此只加载胃、不加载食管的自定义清单仍可启动，只是没有食管读数。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `esophagus.ts` | `esophagus` | `bolusVolumeMl`、`transitMin`、`chokingMm` | 自己的轮初状态与本轮 `io.actions` | `esophagus.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

所有字段均为 `absolute`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `bolusVolumeMl` | `mL` | 本轮结束时仍在转运的食团体积（状态）；不是累计摄入量 |
| `transitMin` | `min` | 该食团剩余转运时间（读数）；60 s 轮下正常一轮后为 0 |
| `chokingMm` | `mm` | 超过参考食团后的 0–100 mm 风险代理；不是气道梗阻概率或临床评分 |

时间原点：`bolusVolumeMl` 与 `transitMin` 是轮末状态；`chokingMm` 由本轮结束时的食团体积现算。食团在 `transitMin` 到达 0 的下一个轮次清零。

## 3. 方程与参数

设 `dtMin = io.dt / 60`：

```text
prevTransitMin = max(0, prev.transitMin)
transitMin = max(0, prevTransitMin − dtMin)
bolusVolumeMl = transitMin > 0 ? max(0, prev.bolusVolumeMl) : 0
每条合法 eat/drink：bolusVolumeMl += 动作体积；transitMin = bolusTransitMin
chokingMm = clamp(chokeGain × max(0, bolusVolumeMl / referenceBolusMl − 1), 0, 100)
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | ---: | --- | --- | --- |
| `esophagus.bolusTransitMin` | 0.2 | `min` | `design` | —（无直接证据） |
| `esophagus.chokeGain` | 50 | `mm/1` | `design` | —（无直接证据） |
| `esophagus.referenceBolusMl` | 250 | `mL` | `design` | —（无直接证据） |

“合法 eat/drink”沿用胃的输入契约：`volumeMl` 为有限正数，可选 `durationMin` / `carbohydrateG` 有限非负，`drink` 的 `energyKcal` 可缺省，`eat` 必须给出有限非负 `energyKcal` 与 `liquid` / `solid` / `mixed` 餐型；非法动作整条忽略，不报错。同轮多条合法动作相加成一个食团，后一条动作重置转运计时，不叠加时延。`durationMin` 只影响胃的按轮分摊，食管仍把动作完整体积记入吞下轮。

## 4. 读写边界

- 本脚本是 `esophagus` 的唯一写者，只读自己的轮初状态与本轮原始动作。
- 不调用 `io.transfer`、`io.add` 或 `io.notify`；不写胃、肠、体液或体感部位。
- 胃在本轮动作结算时已收到摄入；`transitMin` 只是读数，不改变胃的摄入时刻。因此本切片没有为“延迟到胃”新增第二套动作队列。
- `chokingMm` 只由本轮结束时仍在转运的食团体积计算，不由累计摄入、饮水速度或现实时间计算。输出钳到 `[0, 100]`，状态 JSON-safe。

## 5. 证据入口

- 设计：[`docs/superpowers/specs/2026-11-24-bowel-design.md`](../../../docs/superpowers/specs/2026-11-24-bowel-design.md)
- 定向测试：[`test/organs.esophagus.test.mjs`](../../../test/organs.esophagus.test.mjs)；真实 Gateway 在 [`test/organs.bowel-gateway.test.mjs`](../../../test/organs.bowel-gateway.test.mjs)
- 共享登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片未新增来源行）

**证据边界：** 0.2 min、50 mm 与 250 mL 都没有直接人体测量来源，不是食管转运时间、食团体积阈值或呛咳量表。它们只提供工程时序与风险读数，不能称 `validated`，也不能外推为误吸诊断、吞咽造影或临床吞咽功能。

## 6. 当前限制

- **未建模：** 食管蠕动、上下食管括约肌、会厌与气道保护、吞咽分期、分段转运、固液差异、重力与体位、反流、食管炎或吞咽障碍。
- **未验证：** 没有食管转运时间实测、食团体积或呛咳阈值的人体数据、独立验证、真实 DSH 会话、临床验证或 38 部位性能实测；`chokingMm` 只是模型内 0–100 mm 读数。
- 60 s 轮长大于 0.2 min，正常一轮后 `transitMin` 即为 0；只有短于 0.2 min 的轮次能读出中间转运时间。食团不会跨多轮保留。
