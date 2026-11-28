# 身体热平衡输入（climate / clothing）

两部位在根、女性和男性清单启用；各身体分别保存。场景只提供明确的温湿度，穿脱只按使用者的明确指令；不接天气服务、地图、衣柜、自动穿衣或新增宿主工具。两部位不写核心温、水账或疾病状态。

| 部位／字段 | 配置方式 | 缺省值与单位 | 含义 |
| --- | --- | --- | --- |
| `climate.airTemperatureC` | 预设或 `set_environment` | `25 °C` | 保存的空气温度，接受有限数；旧档缺项时可继承旧温度覆盖 |
| `climate.relativeHumidityPct` | 预设或同一 `set_environment` | `50 %` | `0–100`（含边界），`90` 即 `90 %` |
| `clothing.wornLayerIds` | 预设或 `wear_layer` / `remove_layer` | `[]`（无模拟附加衣层） | 唯一衣层 ID 的有序 JSON 列表；短袖和外套可叠穿 |

兼容默认是工程约定，不是实测环境。无存档时直接采用已启用 `climate` 部位 `initialState` 的完整温湿对；标准清单仍为 25 °C / 50% RH。气候不读取参数文件，也不在运行中由参数或提醒改动；旧温度键仅在缺气温的旧档迁移时使用。没有空气温湿度模型、风速、日晒或衣物蓄水。动作、回执与迁移细则见[开发指南](../../docs/gateway-and-scripts.md#身体气候与衣层当前模块)。

<!-- organ-parameters:start -->
## 个体可自定义参数与默认值

先停止 Gateway，备份该身体实际的 `body-state.json`，将要改的 ID 合并到存档顶层 `parameters`（[稀疏覆盖示例](../../CONTRIBUTING.md#个体参数覆盖示例)），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。

表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。

无本地参数文件的入口：[`climate.ts`](climate.ts)（[默认](../../body-modules.json) / [女性](../../body-modules.female.json) / [男性](../../body-modules.male.json) / [可选清单 human-lipid](../presets/human-lipid/body-modules.json)）；输出字段和脚本内常量不是可覆盖 ID。

### clothing.parameters.json

参数文件：[`clothing.parameters.json`](clothing.parameters.json)。入口及清单：[`clothing.ts`](clothing.ts)（[默认](../../body-modules.json) / [女性](../../body-modules.female.json) / [男性](../../body-modules.male.json) / [可选清单 human-lipid](../presets/human-lipid/body-modules.json)）；[`thermoregulation.ts`](../human-organs/brain/thermoregulation.ts)（[默认](../../body-modules.json) / [女性](../../body-modules.female.json) / [男性](../../body-modules.male.json) / [可选清单 human-lipid](../presets/human-lipid/body-modules.json)）。读取脚本：[`clothing.ts`](clothing.ts)。

只有存档 `wornLayerIds` 里穿戴的层参与透过率乘积；`wear_layer` / `remove_layer` 动作改穿戴状态，未穿戴层不参与热交换。

| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |
| --- | ---: | --- | --- | --- | --- |
| `clothing.tshirt.dryExchangeMultiplier` | `0.85` | `1` | `design` | 无 | — |
| `clothing.tshirt.evaporationMultiplier` | `0.8` | `1` | `design` | 无 | — |
| `clothing.jacket.dryExchangeMultiplier` | `0.55` | `1` | `design` | 无 | — |
| `clothing.jacket.evaporationMultiplier` | `0.45` | `1` | `design` | 无 | — |

<!-- organ-parameters:end -->

## 可调衣层参数

[`clothing.parameters.json`](clothing.parameters.json) 的有限目录为 `tshirt`（短袖内层）、`jacket`（外套）。倍率是无量纲工程默认，均 `status: design`、`source: null`，不是服装的实测 clo 或湿阻。按身体可在存档 `parameters` 给出数值覆盖，重启加载，不改变已经穿戴的 ID；可分别调保温和透湿：

| 参数 ID | 默认 | 单位 | 适用条件 |
| --- | ---: | --- | --- |
| `clothing.tshirt.dryExchangeMultiplier` | 0.85 | `1` | 穿 `tshirt`，干交换倍率 `(0, 1]` |
| `clothing.tshirt.evaporationMultiplier` | 0.8 | `1` | 穿 `tshirt`，蒸发透过倍率 `[0, 1]` |
| `clothing.jacket.dryExchangeMultiplier` | 0.55 | `1` | 穿 `jacket`，干交换倍率 `(0, 1]` |
| `clothing.jacket.evaporationMultiplier` | 0.45 | `1` | 穿 `jacket`，蒸发透过倍率 `[0, 1]` |

两类倍率各自连乘；空列表各为 1，同时穿短袖和外套时分别为 `0.4675` / `0.36`。量化工程检查及证据限制见[热平衡验收记录](thermal-replay.md)。温湿度与衣层在第 N 轮提交，皮肤请求和热账最早 N+1 才能读到；皮肤的运动出汗因子读温度，衣层和湿度作用于[体温热账](../human-organs/brain/README.md#thermoregulation)的交换，不反算汗液支付量。
