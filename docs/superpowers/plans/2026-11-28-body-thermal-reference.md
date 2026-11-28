# 每具身体的静态温度参考实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 让身体可独立配置核心温/空气舒适参考，普通和 DI 器官共用同一只读视图。

**架构：** Gateway 只传清单预设；每个 BodyWorker 叠加现有稀疏覆盖和同目录参数文件并解析一次，运行态提供冻结值。人体温控和体感用同一基线，温度、库存和 M31 发热仍由原 owner 写入。

**技术栈：** Node ≥ 22.18，ESM，无第三方依赖。

**规格：** [2026-11-28-body-thermal-reference.md](../specs/2026-11-28-body-thermal-reference.md)

## 全局约束

- 一具身体一份存档；不新增个体覆盖位置、动作、天气或部位。沿用 60 秒一步、轮初快照、原子提交。
- 参考字段单位 `°C`。核心区间含基线，空气未知不按 0；区间不是积分的数值护栏。
- M31/M35/M36 先独立实现；合流后回归，不提前复制他人实现。

## 审查重点

- 第三方无温控 owner 也读得到参考，普通/DI 字段一致且不能改写；空空气范围保留 null。
- 可选边界的 `null` 不挡清单数字，单侧空气必须报缺失边的 ID；必填 `setpointC` 显式 `null` 仍拒绝。
- 修改范围后存档仍保留当前核心温和实际库存，另一具完全不受影响。
- 显式局部冷阈仍可生效，但无局部覆盖时低基线不误报警；身体风格不是热收支。
- 陈旧发热值不可凭存档激活，实际冷/热输入和参考都走各自路径。

### 1. 配置与脚本契约

- [x] 写真实 Gateway 红测：`test/organs.thermal-profile-gateway.test.mjs` 中独立 .mjs 及 DI 调用 `io.getThermalProfile()`；冻结值 `baselineCoreC: 32, normalCoreMinC: 31.5, normalCoreMaxC: 32, ambientComfortMinC: 0, ambientComfortMaxC: 24`。另测无空气值、非法有效组合和校验早于脚本导入。
- [x] 跑 `node --test test/organs.thermal-profile-gateway.test.mjs`，确认缺接口／未拒绝配置。
- [x] `lib/thermal-profile.js` 负责完整 ID 映射与纯校验；`lib/parameters.js` 中 `getThermalProfile()` 从实际参数解析，`getDefaultCoreBaselineC()` 返回文件基线用于默认偏置；`gateway/config.js`、`runner.js`、`body-worker.js` 传入 `thermalDefaults` 并提供公共 getter。只在 `thermoregulation.parameters.json` 补新增 ID。
- [x] 清单回放 `tools/replay.mjs` 设置同一配置来源，在 common io 提供 getter；`test/tools.replay.test.mjs` 验证独立脚本。跑 Gateway、回放及参数清单回归至绿。

### 2. 真实人体脚本消费

- [x] 先复现同清单的 37 °C / 32 °C 两体安静对照（首轮低个体 `coldMm` 旧值 100）；加入冷/热离带、撤扰、位置不对称、局部阈值及停机重启矩阵。
- [x] `brain/interoception.ts` 以两侧区间和本体基线计算读数；`brain/autonomic.ts`、`skin/sweat.ts`、`lungs/ventilation.ts`、`brain/hypothalamus-endocrine.ts` 保留既有分支和防御偏置。温控用同一源初值，不迁移核心库存。
- [x] 跑 `node --test test/organs.thermal-profile*.mjs test/organs.thermoregulation*.mjs` 到绿；保留公式及休眠/缺部位路径。

### 3. 合流、使用说明和交付

- [x] `docs/gateway-and-scripts.md` 放可复制的清单、稀疏存档与 JS；脑、皮肤、肺 README 标真实 ID 和默认。
- [x] 在独立基线 `2344fce` 上跑全量 `npm test`（1108/1108）并实际解包 `npm pack`，以包外示例验证无测量输入、核心正常而空气偏冷、重启覆盖后的变化。
- [x] 待塔台对齐 M31/M35/M36：验证冷/热阈只平移已采用偏移一次、丢弃/重启无发布回退、M31 气候 owner 与核心正常并存；补气候 README 链接、重生成 M36 表，核对既有 M28–31/M35 语义。
- [ ] 在实际合流 tip 重跑 `npm test`、`git diff --check`、参数目录和实包冒烟；提交后用 `TowerComplete` 请求独立评审。
