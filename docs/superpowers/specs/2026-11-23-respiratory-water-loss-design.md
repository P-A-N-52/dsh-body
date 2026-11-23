# 运动相关呼吸失水薄切片设计

日期：2026-11-23
状态：已获继续实现授权；默认参数与最小范围由主代理选定。

## 目标与边界

新增 `lungs`，读取现有 `physicalActivity` 的轮初快照，计算**运动相关**呼吸失水请求；`bodyFluid` 在下一轮把水真实转移到肺部水槽。新增状态必须进入现有体液水账，不能只是展示读数。

本步不建静息呼吸、呼吸频率、潮气量、气体交换、血气、呼吸力学或气喘提醒；不把活动强度换算成 MET、耗氧量或通气量。结肠水回收和粪便因缺少上游与真实消费者，暂缓。

## 方案比较

- **完整肺通气：暂缓。** 需要新的活动—通气证据及血气或呼吸感觉消费者，不是薄切片。
- **仅保存通气读数：不做。** 没有其他脚本消费该差异，违背项目的建模约束。
- **运动相关失水 transfer：采用。** 复用现有活动、体液、口渴链与汗液结算方式，最小的新器官也有真实水账作用。

## 部位与参数

部位 ID 为 `lungs`，无动作，初值两个字段均为 0：

- `respiratoryWaterLossRequestMl`：mL、absolute。本轮请求，供下一轮 `bodyFluid` 读取，不是实际失水。
- `respiratoryWaterLossMl`：mL、absolute。每轮 write 先归 0，实际量仅通过 `transferIn: ['bodyFluid.waterVolumeMl']` 加入。

同目录 `respiratory-water-loss.parameters.json` 只设一个参数：

- `lungs.respiratoryWaterLoss.exerciseReferenceRateMlPerMin = 0.3 mL/min`，`design`、`source: null`，范围 `[0, 2]`。

该值是 `intensity=1` 时的临时工程速率，不是实测人体失水率，也不代表总呼吸失水。未来由具备环境条件和活动通气证据的模型替换；不得用固定值掩盖已接入活动状态的异常。

纯函数 `respiratoryWaterLossRequestMl({ remainingExerciseMin, intensity, dtMin })`：剩余时间大于 0 时返回 `0.3 × intensity × dtMin`，否则返回 0。使用 `io.dt / 60`，不使用现实时间；本轮不足一分钟的活动不另做按比例截断，与现有汗液语义一致。

活动部位未加载时请求为 0；已加载但活动字段缺失、非有限、剩余时间为负或强度超出 `[0,1]` 时失败，不写肺状态。肺脚本不写其他部位、不调用 transfer。

## 水转移与时序

`bodyFluid.waterVolumeMl.transferOut` 增加 `lungs.respiratoryWaterLossMl`。每轮按以下工程分配策略依次使用轮初水：

1. 肾请求；
2. 肺请求；
3. 汗液请求。

每项均钳到此前支付后的剩余量，三路总和不超过轮初水；同轮小肠流入不能支付它们。顺序只是 `policy`，不是人体优先级证据。模块单独调用时沿用现有非法请求按 0 的行为；根清单中的硬 transfer 配对不允许缺肺水槽。

默认时序：第 1 轮活动进入 `physicalActivity`，第 2 轮肺写请求，第 3 轮实际转移。`intensity=1`、`durationMin=30` 时累计汗液 18 mL、运动相关呼吸失水 9 mL；没有活动时保持现有十轮轨迹逐点不变。旧档只补肺部零值，不反推历史失水；重启不重复累计上一轮通量。

水账新增累计 `lungs.respiratoryWaterLossMl`，请求不计入实际失水。现有体液—口渴链可继续消费失水，但本步不新增提醒类型或自动饮水行为。

## 验收与未验证

新增肺单元测试与真实根清单 Gateway 测试，覆盖参数、公式、dt、活动异常、时序、30 分钟累计量、重启、旧档与完整水账；扩展体液多出口分配测试及根清单/参数计数。最终运行 `npm test` 与 `git diff --check`。

仅验证实现的确定性与水质量守恒；不声称生理拟合、独立数据验证、临床验证或真实 DSH 验收。根清单变为 18 个部位、20 份参数文件，硬水 transfer 闭包增加 `lungs`。
