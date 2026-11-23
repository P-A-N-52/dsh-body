# 乳腺泌乳薄切片设计（女性身体）

日期：2026-11-24
状态：owner 指定"乳腺需要"。泌乳必须有真实消费者，本切片把乳汁的水与能量接到体液和血糖上，并接入垂体催乳素。

## 目标与边界

新增 `mammaryGlands`（仅女性清单）：按垂体催乳素与催产反射生成乳汁，乳汁的水来自 `bodyFluid`（第五出口）、乳糖能量来自 `glucose`（血糖池汇）。同时给出胀奶读数（未排空时）。

消费者链：`pituitary.prolactinRelative` → `mammaryGlands` 产奶速率；`mammaryGlands.milkRequestMl` → `bodyFluid` 女性变体第五出口 → `mammaryGlands.milkMl`；`mammaryGlands.lactoseRequestG` → `glucose` 汇；`mammaryGlands.fullnessMm` → `interoception.discomfort`（第六路，软读）。

本步不建婴儿、吸吮动作、哺乳行为、乳腺病变、乳汁成分细分（脂肪/蛋白/免疫成分）、孕期与产后阶段状态机、催产素释放动作。数值全部 `design`、`source: null`。

## 部位与公式

### `pituitary` 新增 `prolactinRelative`

垂体在同部位新增第三信号 `prolactinRelative`（`1`、`absolute`）：目标由吸吮/排空驱动（本切片以 `mammaryGlands.milkMl > 0` 为吸吮代理），按 30 min 半时趋近；无排空调乳汁产量基线 1。`mammaryGlands` 未加载按 1。这样催乳素有真实下游（产奶），而非孤立读数。

### `mammaryGlands`（`organs/human-organs/mammary-glands/milk.ts`，仅女性清单）

字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `milkRequestMl` | `mL` | 本轮乳汁水请求，供下一轮 `bodyFluid` 读取 |
| `milkMl` | `mL` | 实际泌乳水，仅 `transferIn: ['bodyFluid.waterVolumeMl']`，每轮 write 归 0 |
| `lactoseRequestG` | `g` | 本轮乳糖能量请求（克葡萄糖当量），供 `glucose` 结算 |
| `lactoseG` | `g` | 实际乳糖，仅 `transferIn: ['glucose.glucoseMassG']`，每轮 write 归 0 |
| `fullnessMm` | `mm` | 胀奶代理：随产奶积累、随排空下降 |

```text
rateMlPerMin = basalMilkRateMlPerMin × prolactinRelative
milkRequestMl = rateMlPerMin × dtMin
lactoseRequestG = milkRequestMl × lactoseGPerMl
fullnessMm = clamp(prev.fullnessMm + fullnessGainPerMl × (milkRequestMl − prev.milkMl) , 0, 100)
```

参数（`milk.parameters.json`，均 design/null）：`mammaryGlands.basalMilkRateMlPerMin = 0.5`、`lactoseGPerMl = 0.07`、`fullnessGainPerMl = 4`。

`pituitary` 未加载按 `prolactinRelative = 1`；已加载但字段缺失/非有限/为负抛错。`bodyFluid` 女性变体出口顺序追加为"肾 → 肺 → 汗 → 子宫 → 乳腺"（`policy`，乳腺排在最后，水量小）。`glucose` 对 `lactoseRequestG` 按既有肾糖式请求—结算处理（目标 `mammaryGlands.lactoseG`，排在最后），实际不足时钳位。

胀奶只在产大于排时累积；`interoception.discomfort` 第六路 `excessOverOnset(mammaryGlands.fullnessMm, onsetMm)`，软读，无女性部位时为 0，不发通知。

## 清单与计数

女性清单 31 部位、33 份参数（含乳腺与垂体催乳素，不含根清单变化）。`body-water/water.female.ts` 增加第五出口后女性硬闭包 11 → 12 部位；`glucose` 增加 `mammaryGlands.lactoseG` transferOut 后闭包再 +1（以最终注册为准）。旧档缺 `mammaryGlands` 由 `initialState` 补 0，`pituitary.prolactinRelative` 补 1。

## 验收与未验证

- 单元：催乳素驱动产奶、乳汁水/乳糖请求与实际到账、胀奶累积与排空回落、缺垂体/体液/血糖回退、非法上游抛错、JSON-safe。
- 真实 Gateway（女性清单）：预置高催乳素 → 产奶增加、`bodyFluid` 水账含泌乳、血糖池出现乳糖汇、`fullnessMm` 上升并入 `discomfort`；缺乳腺时女性清单启动报目标未声明；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：实测泌乳率与乳汁成分、独立生理数据、真实 DSH 会话、临床验证、31 部位性能。
