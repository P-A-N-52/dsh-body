# 体液隔室（bodyFluid）：体液水与水分亏缺代理

**功能标签：** 体液隔室（不是解剖器官）。

`bodyFluid` 是一个工程隔室，不是解剖器官，因此放在 `organs/human-compartments/body-water/`。它维护“已吸收、尚未离开体液”的水量，并向膀胱转出肾脏请求的尿量；下丘脑的 ADH 与口渴脚本只读它的水分亏缺代理。

实现状态：脚本、参数与定向测试已在 `organs/human-compartments/body-water/`，并已加入根清单（12 个部位）。

**清单依赖（transfer 配对校验）。** `waterVolumeMl` 同时声明 `transferIn: ["smallIntestine.waterVolumeMl"]` 与 `transferOut: ["bladder.volumeMl"]`，所以自定义清单加载 `bodyFluid` 时必须同时加载 `smallIntestine` 与 `bladder`；`smallIntestine` 又声明 `transferIn: ["stomach.waterVolumeMl"]`，因此还要加载胃的水链入口 `stomach/hydration.ts`（旧入口 `motility.ts` 不声明 `waterVolumeMl`，不能替代）。完整闭包是 `hydration.ts` → `smallIntestine` → `bodyFluid` → `bladder` 四个部位，缺任一个都会在 `createFieldRegistry` 启动校验时报字段配对错误；反过来，加载 `smallIntestine` 或 `bladder` 也必须带 `bodyFluid`。`kidney`、`hypothalamusAdh`、`hypothalamusThirst` 与 `interoception` 之间只有普通 `io.read`，没有 transfer 字段对，所以不在配对校验内；缺这些部位时启动不报错，相关脚本按各自的缺失默认值处理。

## 1. 脚本与部位

| 脚本 | 部位 id | 写什么 | 读什么 | 参数文件 |
| --- | --- | --- | --- | --- |
| `water.ts` | `bodyFluid` | `waterVolumeMl`、`waterDeficit` | 自己的轮初状态 `bodyFluid`；`kidney.urineProductionRequestMl` | `water.parameters.json` |

参数文件与脚本同目录，模块在 import 时经 `lib/parameters.js` 只读加载；参数是证据默认值，不做运行中热切换。

## 2. 字段与单位

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `waterVolumeMl` | `mL` | 体液水总量（状态）；`transferIn` 来自 `smallIntestine.waterVolumeMl`，`transferOut` 到 `bladder.volumeMl` |
| `waterDeficit` | `1` | 相对参考量的归一化亏缺代理，范围 −1…1；正为低于参考量，负为高于参考量 |

`waterVolumeMl` 是工程体液水隔室，不是血浆容量、细胞外液、总体水或体重比例。`waterDeficit` 不是血浆渗透压、血容量、口渴评分或尿意评分；它只给下丘脑两个脚本读。

时间原点：`waterVolumeMl` 是轮末状态，初值等于 `referenceVolumeMl`；`waterDeficit` 按轮初水量计算，本轮吸收与产尿下一轮才反映。

## 3. 方程与参数

设轮初体液水 `W_start`，肾脏请求 `R = kidney.urineProductionRequestMl`：

```text
waterDeficit = clamp((referenceVolumeMl − W_start) / deficitScaleMl, −1, 1)
U = clamp(R, 0, W_start)
write.waterVolumeMl = W_start
transfer bodyFluid → bladder: U
```

| 参数 ID | 值 | 单位 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| `bodyFluid.referenceVolumeMl` | 30000 | `mL` | `design` | —（无直接证据） |
| `bodyFluid.deficitScaleMl` | 500 | `mL` | `design` | —（无直接证据） |

初值水量等于参考量。`U` 只能用轮初水支付：小肠同轮转入的水在 transfer 阶段才加入体液，不能支付本轮产尿。请求大于轮初可用量时钳到可用量，不制造 fatal。`waterDeficit` 是轮初水量的读出，本轮吸收与产尿要到下一轮才反映。

肾脏请求本身有**一轮延迟**：`kidney` 每轮按轮初 ADH 计算下一轮请求，`bodyFluid` 在下一轮读到它。`kidney` 缺失时请求按 0 处理，体液不向膀胱转水。

## 4. 读写边界

- 本脚本是 `bodyFluid` 的唯一写者，只读自己的轮初状态与 `kidney` 的请求字段。
- 先 `write` 转出前基准，再请求 `transfer`；Gateway 先应用 write，再扣 transfer、加小肠流入。
- 不写 `smallIntestine`、`bladder`、`kidney` 或下丘脑部位；也不读胃或肠的原始状态。
- 不建器官间“转移账本”之外的任何状态；`waterDeficit` 是唯一对外信号。

## 5. 证据入口

- 脚本头部的块注释明确写“无直接证据”，两个参数都是工程假设。
- 设计：[`docs/superpowers/specs/2026-11-22-water-balance-design.md`](../../../docs/superpowers/specs/2026-11-22-water-balance-design.md) §3.3
- 共享登记簿：[`../../human-organs/references/source-index.csv`](../../human-organs/references/source-index.csv)

**证据边界：** 30 L 与 500 mL 都没有人体来源，不能称为实测总体水、血浆容量、体重比例或渗透压阈值；参数文件里的 `range` 只是工程调参范围，不是人体百分位。

## 6. 当前限制

- **不是渗透压模型**：不建血浆/尿渗透压、电解质、钠钾平衡或口渴阈值；水量 mL 不换算成 mOsm。
- **不是血容量/血压模型**：不建循环、RAAS、心房利钠肽或压力感受器。
- **不含不感蒸发与汗液**：首段没有皮肤、呼吸或粪便失水；体液只经肾脏请求离开。
- **不是总体水**：30 L 只是一个工程参考量，不随年龄、性别、体重或体脂调整。
- **单隔室**：不区分细胞内、细胞外、血浆与间质。
