# 附睾（epididymis）：精液储存与高潮排空记账

**功能标签：** 男性生殖。**仅男性清单加载**（[`body-modules.male.json`](../../../body-modules.male.json)），根清单与女性清单不加载本部位。

`epididymis/` 目前只有一个部位 `epididymis`，脚本为 [`storage.ts`](storage.ts)，没有动作、通知或 `transfer`，也不写其他部位。它以恒定恢复速率累计 `spermStorageMl` 至容量上限，并在检测到轮初 `sexualResponse.lastOrgasmAtSimMin` 等于本轮轮初仿真分钟时，将轮初存量记入 `ejaculatedMl` 并把 `spermStorageMl` 归零。这两个字段都是模型内的精液体积占位，不是精液分析、精子计数/活力/形态、附睾容量或生育力指标。

**实现状态：** 脚本、参数与单元测试已落地，并已挂载进男性清单 `body-modules.male.json`（当前根清单 39 部位 / 35 份唯一参数文件，女性清单 42 部位 / 38 份，男性清单 41 部位 / 37 份；硬 `transfer` 闭包仍为根与男性 15 部位、女性 17 部位）。两项参数全部 `design`、`source: null`。本文只描述当前代码实现的模型与契约，未做真实 DSH 会话、精液测量或临床验证。

## 1. 脚本与读写关系

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| [`storage.ts`](storage.ts) | `epididymis` | `spermStorageMl`、`ejaculatedMl` | 自己的轮初状态；轮初 `sexualResponse.lastOrgasmAtSimMin`（可选）；`io.dt`；`io.simulatedSeconds` | [`storage.parameters.json`](storage.parameters.json) |

- `actionTypes = []`；不直接读 `io.actions` 中的 `orgasm` 或 `sex`，不调用 `transfer` / `notify`。
- `sexualResponse` 是可选上游：未加载时按 `lastOrgasmAtSimMin = null` 处理，永不排空，只持续恢复至容量上限。
- 若 `sexualResponse` 已加载但不是对象，或 `lastOrgasmAtSimMin` 不是 `null` 且非有限非负数字（例如缺失、`undefined`、`NaN`、负数或字符串），脚本立即抛错，本轮不写状态，由 Gateway 整轮原子提交作废。`null` 是“从未高潮”的合法值。

## 2. 字段与单位

两个字段均为 `absolute`，`initialState = { spermStorageMl: 0, ejaculatedMl: 0 }`。

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `spermStorageMl` | `mL` | 附睾精液储存占位；排空轮写 `0`，其余轮按 `recoveryMlPerMin` 递增并钳到 `capacityMl`；不是附睾解剖容量或精子数 |
| `ejaculatedMl` | `mL` | 本轮排空的轮初存量（每轮通量读数，非累计量）；非排空轮为 `0`；不是完整精液分析（不含前列腺/精囊液） |

输出只含两个有限数字段，JSON-safe；不建水账质量转移（本部位不从 `bodyFluid` 扣水）。

## 3. 方程、轮时序与参数

设 `prev` 为轮初自身状态，`dtMin = io.dt / 60`，`roundStartSimMin = (io.simulatedSeconds - io.dt) / 60`：

```text
ejaculated   = lastOrgasmAtSimMin !== null && lastOrgasmAtSimMin === roundStartSimMin
recoveredMl  = min(prev.spermStorageMl + recoveryMlPerMin × dtMin, capacityMl)
spermStorageMl = ejaculated ? 0 : recoveredMl
ejaculatedMl   = ejaculated ? prev.spermStorageMl : 0
```

- **一轮排空时序：** [`sexualResponse`](../sexual-response/README.md) 在高潮轮将 `lastOrgasmAtSimMin` 记为该轮轮末仿真分钟 `io.simulatedSeconds / 60`；该新值只在下一轮的轮初快照里可见。下一轮的 `roundStartSimMin` 恰好等于上一轮的轮末仿真分钟，因此排空记账比高潮事件晚一轮（60 s 轮下晚 1 min），且只触发一次。
- **排空当轮丢弃恢复量：** `ejaculated` 为真时只把轮初存量 `prev.spermStorageMl` 记入 `ejaculatedMl`，`spermStorageMl` 直接置 `0`（不保留当轮恢复量），与“排空”语义一致；下一轮再从 0 重新恢复。

同目录参数（`owner: epididymis`）：

| 参数 ID | 默认值 | 单位 | 状态 | 来源与替换点 |
| --- | ---: | --- | --- | --- |
| `epididymis.recoveryMlPerMin` | 0.002 | `mL/min` | `design` | `source: null`；工程恢复速率（约 2.88 mL/d，排空后约 1.7 d 填满 5 mL），不是精子发生率或附睾转运时间 |
| `epididymis.capacityMl` | 5 | `mL` | `design` | `source: null`；储存容量上限工程占位，不是正常精液量、附睾/精囊容量或临床界值 |

两项参数的 `range` 均只是工程调参范围。

## 4. 旧档与重启

- **旧档缺 `epididymis`：** 由 `initialState` 补 `{ spermStorageMl: 0, ejaculatedMl: 0 }`，不反推历史恢复或排空。
- **重启：** 保留已提交的 `spermStorageMl`、`ejaculatedMl` 与 `sexualResponse.lastOrgasmAtSimMin`。下一轮按存档值与当前 `roundStartSimMin` 继续判断：若高潮刚好发生在停机前一轮末且未进入下一轮，重启后的第一轮仍会按时序完成这一次排空记账，不会漏记也不会重复记账。

## 5. 未建模与未验证

**未建模：**

- 精子发生、附睾成熟与转运时间、睾酮对生精的调控（不读取 [`testes`](../testes/README.md)）。
- 前列腺液、精囊液、尿道球腺液与射精管反射；`ejaculatedMl` 与临床精液量没有等价换算关系。
- 精液分析指标（精子浓度、活力、形态、液化）、生育力/受孕、性传播感染与避孕。
- 不应期控制（由 `sexualResponse` 负责）、逆行射精、输精管结扎、年龄/BMI/疾病/药物与个体差异。
- 水账关联：不向 `bodyFluid` 要水，也不产生体液亏缺或口渴。

**未验证：** 没有精液恢复速率、储量上限或排空体积的直接人体来源、独立数据、临床验证或真实 DSH 会话验收。全部参数与公式均属 `design`、`source: null` 的工程假设，不能称拟合或 `validated`。

## 6. 证据入口

- 设计：[`2026-11-24-male-reproductive-design.md`](../../../docs/superpowers/specs/2026-11-24-male-reproductive-design.md)
- 模块测试：[`test/organs.epididymis.test.mjs`](../../../test/organs.epididymis.test.mjs)
- 真实 Gateway 男性清单测试：[`test/organs.male-reproductive-gateway.test.mjs`](../../../test/organs.male-reproductive-gateway.test.mjs)
- 上游与关联：[`sexual-response`](../sexual-response/README.md)、[`testes`](../testes/README.md)
- 共享来源登记簿：[`../references/source-index.csv`](../references/source-index.csv)（本切片未新增来源行）
