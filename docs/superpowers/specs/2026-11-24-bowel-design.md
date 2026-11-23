# 食管与结肠薄切片设计

日期：2026-11-24
状态：owner 排期"食管、结肠也补上"。结肠做残渣—水回收—粪便—便意全链，食管做食团转运与呛咳风险，全部落到既有消费者上。

## 目标与边界

- `esophagus`：食团从动作到胃的转运（时延与分段），大口快饮时产生呛咳风险 → `interoception.discomfort`。
- `colon`：接收小肠未吸收残渣，按结肠转运时间回收水分回流 `bodyFluid`，形成粪便储存，`defecate` 动作排出，`interoception` 产生便意。

本步不建肠道菌群、消化酶、纤维发酵、气体/腹胀、直肠肛门细节、绝对转运时间测量。数值全部 `design`、`source: null`。

## 食管（`organs/human-organs/esophagus/esophagus.ts`）

字段（均 `absolute`）：`bolusVolumeMl`（在途食团体积）、`transitMin`（剩余转运分钟）、`chokingMm`（呛咳风险代理）。

```text
本轮有合法 eat/drink：bolusVolumeMl += 动作体积；transitMin = bolusTransitMin
transitMin = max(0, prev.transitMin − dtMin)
当 transitMin 到达 0：stomach 接收（经既有动作队列，不新增 transfer，胃在下一轮动作中生效）
chokingMm = clamp(chokeGain × max(0, bolusVolumeMl / referenceBolusMl − 1), 0, 100)
```

参数 `esophagus.bolusTransitMin = 0.2`、`chokeGain = 50`、`referenceBolusMl = 250`（design）。`interoception.discomfort` 追加 `excessOverOnset(esophagus.chokingMm, onsetMm)`（软读）。

说明：食管不另设转移字段，胃的食团到达由既有动作队列时序表达；新增的是转运时延与呛咳读数，避免为延迟而延迟。

## 结肠（`organs/human-organs/colon/colon.ts`）

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `residueWaterMl` | `mL` | 残渣水（小肠转入） |
| `stoolG` | `g` | 粪便储存 |
| `defecatedG` | `g` | 本轮 `defecate` 排出量 |
| `bowelUrgencyMm` | `mm` | 便意代理 |

`smallIntestine.waterVolumeMl` 增加 `transferOut: ['colon.residueWaterMl']`（未吸收残渣按固定比例进入结肠，不改动既有吸收公式）；`colon.residueWaterMl.transferIn: ['smallIntestine.waterVolumeMl']`。闭包 +1 部位。

```text
reclaimed = min(residueWaterMl × reclamationRatePerMin × dtMin, prev.residueWaterMl)
transfer colon.reclaimedWaterMl → bodyFluid.waterVolumeMl: reclaimed
stoolG = prev.stoolG + stoolFormationGPerMin × dtMin
defecate 动作：defecatedG = prev.stoolG；stoolG = 0
bowelUrgencyMm = clamp(100 × stoolG / referenceStoolG, 0, 100)
```

参数（`colon.parameters.json`，均 design/null）：`colon.reclamationRatePerMin = 0.001`、`stoolFormationGPerMin = 0.01`、`referenceStoolG = 200`。

`bodyFluid.waterVolumeMl.transferIn` 增加 `colon.reclaimedWaterMl`（在小肠之后）。`defecate` 与 `urinate` 同类，是少数允许 LLM 主动触发的输出之一；`interoception` 新增 `bowelUrgencyMm` 读数（软读，暂不接 `brainNotify`）。

## 清单与计数

根清单 34 部位、36 份参数；女性清单 36 部位、38 份参数（在循环切片基础上）。旧档缺 `esophagus` / `colon` 由 `initialState` 补 0；水账新增结肠回收项，方向为回流而非支出。

## 验收与未验证

- 单元：食团转运与呛咳、残渣回收与回流、粪便形成与排出、便意、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：进食后食团转运、呛咳读数出现；小肠残渣进入结肠并回流水、水账含回收项；`defecate` 排出后 `stoolG = 0` 且便意回落；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：结肠转运时间实测、粪便形成实测、独立生理数据、真实 DSH 会话、临床验证、34 部位性能。
