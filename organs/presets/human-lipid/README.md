# 健康人体膳食长链脂质预设

这是一个与根清单并列的**完整选配身体**，不是第二个时钟，也不替换默认、女性或男性身体。保留根清单所有部位，只把 `stomach/hydration.ts` 换成复用其实现的 `hydration-lipid.ts`，另加肝供胆、胆囊与胆道交付、胰外分泌、小肠脂质、肠淋巴、循环脂质、脂肪组织七个写者。清单、脚本和参数随 npm 包的 `organs/` 发布。

## 启用与吃喝

停止目标 Gateway。在 DSH 插件配置（多身体时为 `bodies.json` 中相应身体条目）或 `startGateway` 参数中选择绝对路径，并使用**独立存档**：

```json
{
  "manifestPath": "/实际包目录/dsh-body/organs/presets/human-lipid/body-modules.json",
  "statePath": "/独立数据目录/human-lipid/body-state.json"
}
```

直接指向原位清单；只复制 JSON 会让相对脚本路径失效。重新启动后沿原本会话绑定规则使用 `body_act`。继续用同一份脂质存档重启会保留胃切片、胆囊库存和所有脂质存量；不在同一个存档上来回切换预设。新档或缺脂字段的旧数据不从历史 kcal 推测脂肪，旧在途切片缺成分按未知观测，其余既有输入不必改。

- 自然描述：`body_act({type: "drink", description: "喝了一小杯全脂奶"})`。原翻译官只在食物和份量足够明确时给出 `fatG`，并标记 `fatGSource: "estimate"`；不能可靠估计就省略。词句里的营养标签若要作为明确约束，可直接提供 `fatG`，也可保留描述来补其余必填值。
- 数值直通：`body_act({type: "eat", volumeMl: 250, energyKcal: 220, mealKind: "liquid", carbohydrateG: 6, fatG: 20})`。`fatG` 是已知的膳食**长链脂肪 TG 当量**（有限、非负 g）；明确无脂才填 `0`，未知不填，不能用 `null` 冒充。`energyKcal` 仍是全餐总能量，既不拿来反推脂肪，也不另加一笔 `9 × fatG`。`drink` 的脂肪只进非固餐组，原水子集代理照常入账。可像以前一样用 `durationMin` 分片。
- 只增加原 `body_act(eat/drink)` 的可选成分，不新增动作或宿主工具。未启用预设时仍可提交原吃喝载荷，不推进脂质账；`body_state` 仍只给纯定性体感。检查数值用 `GET /state` 或 `gateway.getState()`。

## 看什么、怎么算

- **入胃和排空：** `stomach.explicitFatIntakeG` / `estimatedFatIntakeG` 是本轮已入胃的两类克数，`null` 表示本轮无此类（明确的零就是 `0`）；`unknownFatIntakeSlices` 是未知成分切片数，不把未知克数计零。`solidFatG` / `nonSolidFatG` 是两笔实际库存，经原胃排空比例分别转出，`emptiedFatG` 是两笔实付之和。`mealQueue[].remainingFatG` 仅在成分已知/估得时记录尚未入胃的量。
- **助消化：** `liverBile.supplyActivityU` 为新供给，`gallbladder.stockActivityU` 和 `releasedActivityU` 区分库存和释放，`ductDeliveredActivityU` 为胆道到达的功能量（BAU）；`pancreasExocrine.lipaseActivityU` 为有效脂肪酶代理（LAU）。小肠在下一轮消费有时效的输出；胆盐作用同时限制水解和吸收，胰酶只限制水解。BAU/LAU 不是盐/酶的实测单位或营养 g。
- **脂质路径：** 胃两库存 → `intestinalLipid.lumenTgG` → `hydrolyzedG` → `intestinalLymph.tgInTransitG` → `lipidCirculation.mealTgG` → `adipose.storedTgG`。脂肪库以胰岛素相对代理调节净动员，实际量进入独立的 `lipidCirculation.nefaEquivalentG`。新到账从下一轮才可支付；未吸收残渣 `residueTotalG` 和组织摄取及未追踪残粒 `tissueUptakeTotalG` 为累计开放出口，不是库存、粪便或氧化。
- **质量检查：** 上述八份实际库存（胃两份）和两份累计出口之和，应等于初始禀赋（新档默认脂肪库 60 g，其余 0）加累计实际吞入的已知/估得克数。若按入队整笔量作入口，再把同一 `mealQueue` 的待入胃克数计入左侧；不要同时把入队整笔和后来入胃切片算成两次输入，也不要把 `emptiedFatG`、`returnedTgG` 等中间实付通量再加一次。

分流遵循 M25 工作稿的轮初规则：同一个供体按合计一阶率算支付上限，再按相对速率分配；脂肪库超出轮初可用容量的储存份额留在循环。取不到同口径人体数据的定量偏差为 `NA`。不模拟总血清 TG、NEFA 浓度、VLDL、短/中链脂肪旁路、全身或免疫淋巴、肠肝循环、食物热量预算或脂肪氧化；本预设不声称人体定量、DSH 宿主会话或临床验证。

## 自定义参数

清单没有隐含覆盖。要个别调整，仅在**停机时**修改选配身体的现有完整存档顶层 `parameters`，例如增加 `"liverBile.supplyActivityUPerMin": 0` 可关闭新供应；胆囊仍可先支付已有库存。不要用参数片段覆盖整份存档。无覆盖时，从模块同目录的参数文件加载；完整有效 ID、单位、默认和有效条件见：

- [肝供胆](../../human-organs/liver/bile.md)、[胆囊与胆道](../../human-organs/gallbladder/README.md)、[胰外分泌](../../human-organs/pancreas/exocrine.md)；
- [胃动力（沿用原参数与证据）](../../human-organs/stomach/README.md)、[小肠脂质](../../human-organs/small-intestine/README.md#选配长链脂质)；
- [肠淋巴](../../human-compartments/intestinal-lymph/README.md)、[循环 TG/NEFA](../../human-compartments/lipid-circulation/README.md)、[短程脂肪库](../../human-compartments/adipose/README.md)。

新增参数全为 `design` / `source: null`，没有人体拟合。修改胃/胰内分泌等共用参数仍会影响各自原消费者；脂链没有重新定义这些参数。

## 可复验的 Gateway 对照

运行 `node --test test/organs.lipid-gateway.test.mjs`。默认工程初值和固定时钟下，250 mL / 220 kcal / 6 g 碳水的合成夹具，20 g 脂质组 130 轮内循环餐源 TG 峰值约 1.092542 g（匹配 0 g 组为 0），实际进入脂肪库累计约 2.398135 g；两个脂质子账最大闭合误差约 `4.263e-14 g`。先后到账为肠腔 2、水解 4、肠淋巴 5、循环 6、储存 7 分钟。两次 20 g 餐相隔 35/480 分钟时，第二餐前胆库约 0.736870/2.191223 BAU、随后十二分钟经胆道累计约 1.097891/1.726905 BAU。中等间隔时前餐持续刺激可能影响总交付，不能把该对照理解为任何条件下都随餐间隔单调增加。这些是模型回放量，不是人体预测。
