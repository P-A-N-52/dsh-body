# 男性生殖（睾丸 / 附睾）薄切片设计

日期：2026-11-24
状态：owner 指定"男性生殖除了分泌激素、储存精液和性行为，没什么其他需要的"。本切片只覆盖这三件事，且都有消费者。

## 目标与边界

新增男性清单 `body-modules.male.json`（根清单 + `testes` + `epididymis`），根清单保持性别中立。

- `testes`：产睾酮（`testosteroneRelative`），→ `sexualResponse` 唤醒增益与 `interoception.libidoMm`（性欲读数）。
- `epididymis`：精子成熟与储存（`spermStorageMl`），→ `sexualResponse` 高潮时排空（`ejaculatedMl`），随后数日恢复。

本步不建 HPG 轴（GnRH/LH/FSH 暂无消费者，记为后续）、精子形态/活力、前列腺、阴茎/阴囊形态、生育力与受孕、性病、绝对激素浓度。数值全部 `design`、`source: null`。

## 部位与公式

### `testes`（`organs/human-organs/testes/testosterone.ts`）

无动作 transfer。字段 `testosteroneRelative`（`1`、`absolute`）：按 60 min 半时向基线 1 趋近（本切片暂无刻意外源驱动，作为稳定分泌的工程近似），另叠加轻度昼夜波动（`1 + 0.1 × cos(2π × (hour − 8) / 24)`，design）。`sexualResponse` 的唤醒目标改为 `100 × sexIntensity × (0.5 + 0.5 × testosteroneRelative)`（`testes` 未加载按 1）。

`interoception` 新增 `libidoMm = clamp(100 × (testosteroneRelative − 0.5), 0, 100)`（`testes` 未加载按 0）。

参数（`testosterone.parameters.json`，均 design/null）：`testes.baselineRelative = 1`、`testes.circadianAmplitude = 0.1`、`testes.responseHalfTimeMin = 60`。

### `epididymis`（`organs/human-organs/epididymis/storage.ts`）

字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `spermStorageMl` | `mL` | 精液储存量，随时间恢复、高潮时排空 |
| `ejaculatedMl` | `mL` | 本轮实际射精量（高潮事件触发） |

```text
spermStorageMl = min(prev.spermStorageMl + recoveryMlPerMin × dtMin, capacityMl)
若本轮 sexualResponse 记录了高潮（lastOrgasmAtSimMin 更新为本 simMin）：
    ejaculatedMl = prev.spermStorageMl（排空）
    spermStorageMl = 0
否则 ejaculatedMl = 0
```

参数（`storage.parameters.json`，均 design/null）：`epididymis.recoveryMlPerMin = 0.002`、`capacityMl = 5`。

`sexualResponse` 未加载时不排空；`lastOrgasmAtSimMin` 变化以轮初快照判定，与既有高潮阈值逻辑不冲突。

## 清单与计数

男性清单 = 根清单 + `testes` + `epididymis`（在内分泌切片基础上：根 28 → 男 30 部位、30 → 32 份参数）。根清单与女性清单不变。`package.json` 的 `files` 增加 `body-modules.male.json`。旧档缺两部位由 `initialState` 补基线（`testosteroneRelative = 1`、`spermStorageMl = 0`、`ejaculatedMl = 0`）。

## 验收与未验证

- 单元：睾酮基线与昼夜曲线、唤醒目标随睾酮缩放、`libidoMm`、储存恢复与容量、高潮触发排空、下一轮恢复、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway（男性清单）：预置高睾酮 → 唤醒目标提高、`libidoMm` 上升；预置精液储存 + 高潮动作 → 排空、随后恢复；缺部位时启动报错或回退符合契约；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：睾酮实测、精液参数实测、独立生理数据、真实 DSH 会话、临床验证、30 部位性能。
