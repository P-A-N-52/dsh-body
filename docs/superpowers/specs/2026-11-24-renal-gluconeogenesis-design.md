# 肾糖异生薄切片设计

日期：2026-11-24
状态：owner 指出"没有肝糖输出把血糖抬回去——不止是肝"。肾也参与糖异生（长期空腹约占内源葡萄糖 20–25%），本切片把它作为肝之外的第二个升糖来源。

## 目标与边界

新增 `kidneyGluconeogenesis`：低血糖或高胰高血糖素时，肾按自身速率把葡萄糖转入 `glucose.glucoseMassG`，与 `liver` 的释放并行、各自独立受各自阈值驱动。

与肝的区别：不建糖原库——肾糖异生利用乳酸/氨基酸等底物，按**速率受限的产糖代理**实现（底物池未建模），只有速率上限与信号驱动，没有存量耗尽语义。

本步不建底物池（乳酸/氨基酸/甘油）、肾脏其他内分泌（EPO、肾素/RAAS）、GFR 实测、绝对浓度。数值全部 `design`、`source: null`。

## 部位与公式

`kidneyGluconeogenesis`（`organs/human-organs/kidney/gluconeogenesis.ts`），无动作。字段（均 `absolute`）：

| 字段 | 单位 | 含义 |
| --- | --- | --- |
| `glucoseOutputG` | `g` | 本轮实际产糖，仅 `transferOut: ['glucose.glucoseMassG']`，每轮 write 归 0 |

```text
active = glucose.concentrationMgDl < baselineMgDl || pancreasEndocrine.glucagonRelative > 1
glucoseOutputG = active ? min(maxOutputRateGPerMin × glucagonRelative × dtMin, maxOutputPerRoundG) : 0
write { glucoseOutputG }
transfer kidneyGluconeogenesis.glucoseOutputG → glucose.glucoseMassG: glucoseOutputG（> 0 时）
```

参数（`gluconeogenesis.parameters.json`，均 design/null）：`kidneyGluconeogenesis.maxOutputRateGPerMin = 0.3`、`maxOutputPerRoundG = 0.3`、`baselineMgDl = 90`。

`glucose` 未加载按 `concentrationMgDl = 90`（不产糖）；`pancreasEndocrine` 未加载按 `glucagonRelative = 1`；已加载但字段缺失/非有限/为负抛错。`glucose.glucoseMassG.transferIn` 增加 `kidneyGluconeogenesis.glucoseOutputG`（在 `liver.glycogenG` 之后），闭包 +1 部位。

## 清单与计数

根清单 32 部位、34 份参数；女性清单 34 部位、36 份参数（在循环切片基础上）。旧档缺 `kidneyGluconeogenesis` 由 `initialState` 补 `glucoseOutputG = 0`。

## 验收与未验证

- 单元：低血糖/高胰高血糖素触发产糖、速率与每轮上限、高糖时不产糖、缺部位回退、非法上游抛错、JSON-safe。
- 真实 Gateway：预置低血糖 + 无肝糖原时由肾产糖使血糖回升；肝糖原充足时两源并行；`glucose.glucoseMassG` 的 transferIn 声明配对，缺 `kidneyGluconeogenesis` 清单启动报错；重启接续。
- 最终 `npm test` 与 `git diff --check`。

未验证：肾糖异生实测贡献比例、独立血糖曲线、真实 DSH 会话、临床验证、32 部位性能。
