# 器官级 P0 实施计划（胃与十二指肠）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有胃/十二指肠脚本迁到 `organs/human-organs/`，补齐 `fields`，修掉并发摄入的时间扭曲，新增 ghrelin 与胃壁机械感受，最后用单独一次提交启用根清单。

**Architecture:** 器官目录只是组织单位，脚本仍由 `body-modules.json` 逐条列出，Gateway 不改。P0 四个脚本：`stomach`（动力）、`stomachGhrelin`（内分泌）、`stomachSensory`（机械感受）、`duodenum`（营养暴露）。所有模块读同一份轮初快照，一轮 60 s，整轮原子提交。

**Tech Stack:** Node ≥ 22.18（本机 v26.9.0）、ESM、可擦除 TypeScript、`node:test`、无第三方依赖。

**Spec:** `docs/superpowers/specs/2026-11-20-organ-model-design.md`

## Global Constraints

- Node ≥ 22.18；ESM；只用可擦除 TS 语法；相对导入带扩展名。
- 一轮 = 60 仿真秒；模块读轮初快照；整轮成功才提交。
- 每个模块必须导出 `id`、`initialState`、`actionTypes`、`heartbeat`、`fields`；`fields` 规则见 `docs/gateway-operations.md`。
- 一个部位一个写者；字段路径是 `部位.字段`；部位 id 用 camelCase，不含点号。
- 参数进 `*.parameters.json`，保留 `unit`/`status`/`source`/`range`；`unset` 的值必须是 `null`；owner 前缀必须匹配。
- 代理量写明“代理”；不跨量纲换算；缺失值不用 0 代替。
- 根 `body-modules.json` 在 Task 8 之前保持 `scripts: []`；不要提前启用。
- 纯文档任务不新增测试；代码任务跑 `npm test` 一次。

## Review Focus

1. **同一轮多个摄入**：旧 `mergeMeals` 会把不同时长、不同速率的摄入合并，扭曲时间分布；`mealQueue` 必须逐条保留。
2. **白水与含能量摄入**：ghrelin 只对 `eat` 且 `energyKcal > 0` 抑制；白水和 0 kcal 的 `eat` 不能压到谷值。
3. **极端或非法胃容量**：胃壁感受在 `volumeMl` 为负、超大、`NaN` 时必须钳到 `[0,1]` 且不产生 `NaN`。
4. **首轮或缺失胃部位**：十二指肠和胃壁感受读不到 `stomach` 时按 0 处理，不能抛错。
5. **真实根清单**：`fields` 漏声明、单位写错或 transfer 未配对会让 Gateway 拒绝启动；必须用真实清单跑一次启动与动作。
6. **重放时序**：场景动作在下一轮生效；重放工具必须明确报告 `actionLagRounds: 1`，不能把偏移藏起来。

---

### Task 1: 器官目录、公共库与现有两个脚本迁移

**Files:**
- Create: `lib/parameters.js`（从 `systems/lib/parameters.js` 移入，内容不变）
- Create: `organs/human-organs/stomach/motility.ts`（从 `systems/digestive/stomach.ts` 移入）
- Create: `organs/human-organs/stomach/motility.parameters.json`（从 `systems/digestive/stomach.parameters.json` 移入）
- Create: `organs/human-organs/duodenum/nutrient-exposure.ts`（从 `systems/digestive/duodenum.ts` 移入）
- Create: `organs/human-organs/duodenum/nutrient-exposure.parameters.json`（从 `systems/digestive/duodenum.parameters.json` 移入）
- Modify: `test/parameters.test.mjs:4-11`
- Test: `test/organs.modules.test.mjs`

**Interfaces:**
- Consumes: 无。
- Produces: `lib/parameters.js` 的 `loadParameters(parametersUrl)` 与 `requireParameter(values, id)`；`stomach` 模块（`motility.ts`）与 `duodenum` 模块（`nutrient-exposure.ts`）仍导出 `id`、`actionTypes`、`initialState`、`heartbeat`，新增 `fields`。

- [x] **Step 1: 写失败的模块契约测试**

```js
// test/organs.modules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const organModules = [
  ['stomach', '../organs/human-organs/stomach/motility.ts'],
  ['duodenum', '../organs/human-organs/duodenum/nutrient-exposure.ts'],
];

for (const [expectedId, modulePath] of organModules) {
  test(`${expectedId} exports the organ module contract`, async () => {
    const module = await import(modulePath);
    assert.equal(module.id, expectedId);
    assert.equal(typeof module.heartbeat, 'function');
    assert.ok(module.initialState && typeof module.initialState === 'object');
    assert.ok(module.fields && typeof module.fields === 'object');
    assert.ok(Array.isArray(module.actionTypes));
  });
}

test('duodenum treats a missing or invalid stomach reading as zero exposure', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  for (const stomach of [undefined, { emptiedKcal: -5 }, { emptiedKcal: Number.NaN }]) {
    let written;
    heartbeat({
      read: (id) => (id === 'stomach' ? stomach : undefined),
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { written = next; },
    });
    assert.equal(written.nutrientExposure, 0);
  }
});

test('duodenum filters 10 kcal/min with the 10 min time constant', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  let written;
  heartbeat({
    read: (id) => (id === 'stomach' ? { emptiedKcal: 10 } : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  assert.ok(Math.abs(written.nutrientExposure - 10 * (1 - Math.exp(-0.1))) < 1e-12);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/organs.modules.test.mjs`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`，找不到 `organs/human-organs/stomach/motility.ts`。

- [x] **Step 3: 移动文件并补 `fields`**

用 `git mv` 保持历史：

```bash
mkdir -p organs/human-organs/stomach organs/human-organs/duodenum lib
git mv systems/lib/parameters.js lib/parameters.js
git mv systems/digestive/stomach.ts organs/human-organs/stomach/motility.ts
git mv systems/digestive/stomach.parameters.json organs/human-organs/stomach/motility.parameters.json
git mv systems/digestive/duodenum.ts organs/human-organs/duodenum/nutrient-exposure.ts
git mv systems/digestive/duodenum.parameters.json organs/human-organs/duodenum/nutrient-exposure.parameters.json
```

把两个脚本的 import 改为 `../../../lib/parameters.js`，参数 URL 改为同目录的新文件名。补：

```ts
// motility.ts
export const fields = {
  volumeMl: { unit: 'mL', mode: 'absolute' },
  energyKcal: { unit: 'kcal', mode: 'absolute' },
  emptiedMl: { unit: 'mL', mode: 'absolute' },
  emptiedKcal: { unit: 'kcal', mode: 'absolute' },
  lastIntakeAt: { unit: 's', mode: 'absolute' },
  meal: { unit: '1', mode: 'absolute' },
};

// nutrient-exposure.ts
export const fields = {
  nutrientExposure: { unit: 'kcal/min', mode: 'absolute' },
};
```

参数文件内容不变，owner 仍是 `stomach` / `duodenum`。同步更新 `test/parameters.test.mjs` 的两处路径和 `../lib/parameters.js` import，并删掉已不存在的 `systems/digestive` 标签。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/organs.modules.test.mjs test/parameters.test.mjs`
Expected: PASS。

Run: `npm test`
Expected: 全部 PASS（原 71 项，标签更新）。

- [x] **Step 5: 提交**

```bash
git add lib organs/human-organs/stomach organs/human-organs/duodenum test/parameters.test.mjs test/organs.modules.test.mjs
git commit -m "refactor: 迁移胃与十二指肠脚本到器官目录并补 fields"
```

---

### Task 2: `mealQueue` 修掉并发摄入的时间扭曲

**Files:**
- Modify: `organs/human-organs/stomach/motility.ts`
- Test: `test/organs.motility.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `motility.ts` 与 `fields`。
- Produces: `initialState.mealQueue: Meal[]`；`Meal` 形状不变（`remainingMl`、`remainingKcal`、`rateMlPerRound`、`rateKcalPerRound`、`remainingRounds`、`mealKind`）。其他模块不读这个字段。

- [x] **Step 1: 写失败的队列测试**

```js
// test/organs.motility.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, initialState } from '../organs/human-organs/stomach/motility.ts';

function round(state, actions = []) {
  let written;
  heartbeat({
    read: () => state,
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

test('two intakes in one round keep separate queues', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid', durationMin: 10 },
    { type: 'eat', volumeMl: 200, energyKcal: 200, mealKind: 'liquid', durationMin: 5 },
  ]);
  assert.equal(next.mealQueue.length, 2);
  assert.deepEqual(next.mealQueue.map((meal) => meal.remainingRounds), [9, 4]);
  assert.deepEqual(next.mealQueue.map((meal) => meal.rateMlPerRound), [10, 40]);
  assert.equal(next.volumeMl, 50);
});

test('queues drain independently and disappear when finished', () => {
  let state = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid', durationMin: 10 },
    { type: 'eat', volumeMl: 200, energyKcal: 200, mealKind: 'liquid', durationMin: 5 },
  ]);
  for (let i = 0; i < 5; i++) state = round(state);
  assert.equal(state.mealQueue.length, 1);
  assert.equal(state.mealQueue[0].remainingRounds, 4);
});

test('water adds volume without creating a meal', () => {
  const next = round({ ...initialState, volumeMl: 35 }, [{ type: 'drink', volumeMl: 240 }]);
  assert.equal(next.mealQueue.length, 0);
  assert.equal(next.lastIntakeAt, 60);
  assert.ok(next.volumeMl > 240);
});

test('intake mass is conserved over 200 rounds', () => {
  let state = { ...initialState };
  let emptied = 0;
  for (let i = 0; i < 200; i++) {
    state = round(state, i === 0
      ? [{ type: 'eat', volumeMl: 300, energyKcal: 300, mealKind: 'liquid', durationMin: 10 }]
      : []);
    emptied += state.emptiedMl;
  }
  assert.ok(Math.abs(emptied + state.volumeMl - 300) < 0.01);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/organs.motility.test.mjs`
Expected: FAIL，`next.mealQueue` 为 `undefined`。

- [x] **Step 3: 实现 `mealQueue`**

`initialState` 把 `meal: null` 改成 `mealQueue: []`，`fields` 把 `meal` 改成 `mealQueue`。`heartbeat` 保留“先排空、再处理已有餐、最后处理新动作”的顺序：

- 用 `prev.mealQueue.map((meal) => ({ ...meal }))` 克隆，不原地改旧状态。
- 每轮按队列顺序对每条 `Meal` 取 slice、加到 `volumeMl`/`energyKcal`、更新 `lastIntakeAt`、`advanceMeal`，完成后过滤掉空项。
- 新动作逐条 `startIntake`，把剩余部分 `push` 到队列；删除 `mergeMeals`。
- 输出 `mealQueue` 只含仍有剩余轮次或剩余量的项。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/organs.motility.test.mjs`
Expected: PASS。

Run: `npm test`
Expected: 全部 PASS。

- [x] **Step 5: 提交**

```bash
git add organs/human-organs/stomach/motility.ts test/organs.motility.test.mjs
git commit -m "fix: 胃动力改用 mealQueue 保留并发摄入的时间分布"
```

---

### Task 3: 胃饥饿素脚本

**Files:**
- Create: `organs/human-organs/stomach/ghrelin.ts`
- Create: `organs/human-organs/stomach/ghrelin.parameters.json`（从 `systems/endocrine/ghrelin.parameters.json` 移入并改 owner）
- Test: `test/organs.ghrelin.test.mjs`

**Interfaces:**
- Consumes: `lib/parameters.js`；`io.actions` 里的 `eat`（读 `energyKcal`）。
- Produces: 部位 `stomachGhrelin`，状态 `{ relativeConcentration: number }`；`fields` 为 `relativeConcentration: { unit: '1', mode: 'absolute' }`。

- [x] **Step 1: 写失败的 ghrelin 测试**

```js
// test/organs.ghrelin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, initialState } from '../organs/human-organs/stomach/ghrelin.ts';

function round(state, actions = []) {
  let written;
  heartbeat({
    read: () => state,
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

test('water does not suppress ghrelin', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [{ type: 'drink', volumeMl: 240 }]);
  assert.equal(next.relativeConcentration, 1);
});

test('an energy-bearing eat suppresses to nadir', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 0.5);
});

test('a zero-energy eat does not suppress', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [
    { type: 'eat', volumeMl: 100, energyKcal: 0, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 1);
});

test('recovery reaches 0.75 exactly after 90 rounds', () => {
  let state = { relativeConcentration: 0.5 };
  for (let i = 0; i < 90; i++) state = round(state);
  assert.ok(Math.abs(state.relativeConcentration - 0.75) < 1e-12);
});

test('a new energy intake never raises a lower value to nadir', () => {
  const next = round({ ...initialState, relativeConcentration: 0.3 }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 0.3);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/organs.ghrelin.test.mjs`
Expected: FAIL，模块不存在。

- [x] **Step 3: 写参数文件和脚本**

`ghrelin.parameters.json`：

```json
{
  "schemaVersion": 1,
  "owner": "stomachGhrelin",
  "parameters": [
    { "id": "stomachGhrelin.fasting.baseline", "unit": "1", "value": 1, "status": "design", "range": [0, 5], "source": null, "note": "相对浓度基线，不是绝对浓度" },
    { "id": "stomachGhrelin.postmeal.nadir", "unit": "1", "value": 0.5, "status": "design", "range": [0, 1], "source": null, "note": "摘要只给方向和相对趋势；此值仅用于让 P0 可运行" },
    { "id": "stomachGhrelin.recovery.apparentHalfTimeMin", "unit": "min", "value": 90, "status": "design", "range": [10, 360], "source": null, "note": "表观恢复时间，不是清除率" }
  ]
}
```

删除旧的 `premeal.leadMin`：P0 没有餐时表，不建模餐前上升。

`ghrelin.ts` 逻辑：

- `initialState = { relativeConcentration: baseline }`。
- 若 `prev.relativeConcentration` 不是有限数字，回落到 `baseline`。
- 扫描 `io.actions`，只认 `type === 'eat'` 且 `Number.isFinite(energyKcal)` 且 `energyKcal > 0`；有则 `next = Math.min(current, nadir)`。
- 没有能量摄入时按 `current + (baseline - current) * (1 - 2 ** (-(io.dt / 60) / halfTimeMin))` 恢复。
- `write({ relativeConcentration: Math.max(0, next) })`。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/organs.ghrelin.test.mjs`
Expected: PASS。

Run: `npm test`（`test/parameters.test.mjs` 要加新参数文件路径，删旧 `systems/endocrine` 路径）
Expected: 全部 PASS。

- [x] **Step 5: 提交**

```bash
git add organs/human-organs/stomach/ghrelin.ts organs/human-organs/stomach/ghrelin.parameters.json test/organs.ghrelin.test.mjs test/parameters.test.mjs
git commit -m "feat: 胃饥饿素只对含能量摄入抑制"
```

---

### Task 4: 胃壁机械感受脚本

**Files:**
- Create: `organs/human-organs/stomach/gastric-sensory.ts`
- Create: `organs/human-organs/stomach/gastric-sensory.parameters.json`（从 `systems/sensory/gastric-sensory.parameters.json` 移入并改 owner）
- Test: `test/organs.gastric-sensory.test.mjs`

**Interfaces:**
- Consumes: `io.read('stomach').volumeMl`。
- Produces: 部位 `stomachSensory`，状态 `{ mechanical: number }`；`fields` 为 `mechanical: { unit: '1', mode: 'absolute' }`。

- [x] **Step 1: 写失败的机械感受测试**

```js
// test/organs.gastric-sensory.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat, initialState } from '../organs/human-organs/stomach/gastric-sensory.ts';

function round(stomach) {
  let written;
  heartbeat({
    read: (id) => (id === 'stomach' ? stomach : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

test('empty stomach maps to zero', () => {
  assert.equal(round({ volumeMl: 0 }).mechanical, 0);
});

test('reference volume maps to one', () => {
  assert.equal(round({ volumeMl: 1000 }).mechanical, 1);
});

test('half reference maps to 0.5', () => {
  assert.ok(Math.abs(round({ volumeMl: 500 }).mechanical - 0.5) < 1e-12);
});

test('volume above reference clamps to one', () => {
  assert.equal(round({ volumeMl: 2000 }).mechanical, 1);
});

test('missing stomach and NaN volume map to zero', () => {
  assert.equal(round(undefined).mechanical, 0);
  assert.equal(round({ volumeMl: Number.NaN }).mechanical, 0);
  assert.equal(round({ volumeMl: -100 }).mechanical, 0);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/organs.gastric-sensory.test.mjs`
Expected: FAIL，模块不存在。

- [x] **Step 3: 写参数文件和脚本**

`gastric-sensory.parameters.json`：

```json
{
  "schemaVersion": 1,
  "owner": "stomachSensory",
  "parameters": [
    { "id": "stomachSensory.referenceVolumeMl", "unit": "mL", "value": 1000, "status": "design", "range": [200, 3000], "source": null, "note": "归一化参考量，不截断胃容量" },
    { "id": "stomachSensory.response.exponent", "unit": "1", "value": 1, "status": "design", "range": [0.2, 3], "source": null, "note": "饱和曲线形状；不是人体拟合" }
  ]
}
```

`gastric-sensory.ts` 逻辑：读 `volumeMl`，非有限或负数按 0；`ratio = Math.min(1, volume / referenceVolumeMl)`；`mechanical = ratio ** exponent`；写回。`initialState = { mechanical: 0 }`。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/organs.gastric-sensory.test.mjs`
Expected: PASS。

Run: `npm test`（参数测试路径同步更新）
Expected: 全部 PASS。

- [x] **Step 5: 提交**

```bash
git add organs/human-organs/stomach/gastric-sensory.ts organs/human-organs/stomach/gastric-sensory.parameters.json test/organs.gastric-sensory.test.mjs test/parameters.test.mjs
git commit -m "feat: 胃壁机械感受代理"
```

---

### Task 5: 证据迁移、器官 README 与旧目录退场

**Files:**
- Create: `organs/human-organs/references/source-index.csv`（从 `systems/digestive/references/source-index.csv` 移入）
- Create: `organs/human-organs/references/m1-data-dictionary.md`（从 `systems/digestive/references/m1-data-dictionary.md` 移入）
- Create: `organs/human-organs/stomach/references/notes/*.md`（Mudie、Camps、Tougas、Levine、Cummings、Leone、`_template.md`）
- Create: `organs/human-organs/stomach/README.md`
- Create: `organs/human-organs/duodenum/README.md`
- Delete: `systems/digestive/`、`systems/endocrine/`、`systems/sensory/`
- Modify: 其余 `systems/*/README.md` 的死链与 legacy 标记

**Interfaces:**
- Consumes: Task 1–4 的四个脚本与参数文件。
- Produces: 器官 README 的脚本/字段/调节方式/证据入口；共享 `source-index.csv` 的 `note_path` 指向新笔记位置。

- [x] **Step 1: 移动证据并更新登记簿**

```bash
mkdir -p organs/human-organs/references organs/human-organs/stomach/references/notes
git mv systems/digestive/references/source-index.csv organs/human-organs/references/source-index.csv
git mv systems/digestive/references/m1-data-dictionary.md organs/human-organs/references/m1-data-dictionary.md
git mv systems/digestive/references/notes/_template.md organs/human-organs/stomach/references/notes/_template.md
git mv systems/digestive/references/notes/camps-2016.md organs/human-organs/stomach/references/notes/camps-2016.md
git mv systems/digestive/references/notes/levine-2015.md organs/human-organs/stomach/references/notes/levine-2015.md
git mv systems/digestive/references/notes/mudie-2014.md organs/human-organs/stomach/references/notes/mudie-2014.md
git mv systems/digestive/references/notes/tougas-2000.md organs/human-organs/stomach/references/notes/tougas-2000.md
git mv systems/endocrine/references/notes/cummings-2001.md organs/human-organs/stomach/references/notes/cummings-2001.md
git mv systems/endocrine/references/notes/leone-2022.md organs/human-organs/stomach/references/notes/leone-2022.md
```

把 `source-index.csv` 里的 `systems/digestive/references/notes/` 与 `systems/endocrine/references/notes/` 全部替换为 `organs/human-organs/stomach/references/notes/`。把 `m1-data-dictionary.md` 里的 `./notes/` 替换为 `../stomach/references/notes/`；`./source-index.csv` 保持不变。

- [x] **Step 2: 写两个器官 README**

`stomach/README.md` 至少包含：

- 脚本表：`motility.ts` / `stomach`（写 `volumeMl`、`energyKcal`、`emptiedMl`、`emptiedKcal`、`lastIntakeAt`、`mealQueue`）、`ghrelin.ts` / `stomachGhrelin`（写 `relativeConcentration`）、`gastric-sensory.ts` / `stomachSensory`（写 `mechanical`）。
- 每个脚本读什么、参数文件、单位、代理说明；写明 `emptiedMl`/`emptiedKcal` 是每轮排出量（不是累计），`lastIntakeAt` 是仿真秒，`mealQueue` 是内部队列，`nutrientExposure` 是 kcal/min 代理。
- 调节方式清单：P0 只接摄入和自身状态；迷走、CCK、GLP-1 等尚未接入，不能写成已建模。
- 证据入口：`../references/source-index.csv`、`../references/m1-data-dictionary.md`、本目录 `references/notes/`。
- 当前限制：ghrelin 不建模餐前上升；机械感受是代理，不是张力。

`duodenum/README.md` 至少包含：

- 脚本表：`nutrient-exposure.ts` / `duodenum`（写 `nutrientExposure`，单位 `kcal/min`）。
- 读取 `stomach.emptiedKcal`，一阶滤波；P0 不建肠内容量/吸收模型，不用 `transfer`。
- 证据入口与当前限制。

- [x] **Step 3: 删除空壳目录并修死链**

```bash
git rm -r systems/digestive systems/endocrine systems/sensory
```

修以下死链：

- `systems/circulatory/README.md`：`[内分泌系统](../endocrine/README.md)` → `[激素资料](../../docs/virtual-body.md#分阶段接入的激素)`。
- `systems/integumentary/README.md`：`[感觉器](../sensory/README.md)` → `[体感设计](../../docs/virtual-body.md)`。
- `systems/nervous/README.md`：`[胃充盈信号](../sensory/README.md)` → `[胃壁机械感受](../../organs/human-organs/stomach/README.md)`；`[饥饿素](../endocrine/README.md)` → `[胃饥饿素](../../organs/human-organs/stomach/README.md)`；`[共享登记簿](../digestive/references/source-index.csv)` → `[共享登记簿](../../organs/human-organs/references/source-index.csv)`；`[Cummings 2001](../endocrine/references/notes/cummings-2001.md)` → `[Cummings 2001](../../organs/human-organs/stomach/references/notes/cummings-2001.md)`。
- `systems/urinary/README.md`：`[抗利尿激素](../endocrine/README.md)` → `[激素资料](../../docs/virtual-body.md)`；`[感觉器](../sensory/README.md)` → `[体感设计](../../docs/virtual-body.md)`。
- `systems/reproductive/README.md`：`[内分泌系统](../endocrine/README.md)` → `[激素资料](../../docs/virtual-body.md#分阶段接入的激素)`。

给仍保留的 8 个 `systems/*/README.md`（circulatory、immune、integumentary、musculoskeletal、nervous、reproductive、respiratory、urinary）顶部加同一行：

```markdown
> **legacy evidence only, not simulation.** 仿真脚本已迁到 `organs/human-organs/`；本目录只保留未迁移的证据与索引。
```

- [x] **Step 4: 验证路径与测试**

Run:

```bash
test ! -d systems/digestive && test ! -d systems/endocrine && test ! -d systems/sensory
grep -oE 'organs/human-organs/[^,]+\.md' organs/human-organs/references/source-index.csv | while read -r p; do test -f "$p" || echo "MISSING $p"; done
```

Expected: 没有 `MISSING`。

Run: `npm test`
Expected: 全部 PASS。

- [x] **Step 5: 提交**

```bash
git add -A organs systems docs
git commit -m "docs: 胃与十二指肠证据迁到器官目录并删除旧系统空壳"
```

---

### Task 6: 文档与 AGENTS 清扫

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/virtual-body.md`
- Modify: `docs/gateway-and-scripts.md`
- Modify: `docs/superpowers/plans/2026-11-20-m1-organ-level-reset.md`（顶部加废弃标记）
- Modify: `docs/superpowers/plans/2026-11-20-m1-scope.md`（顶部加废弃标记）
- Modify: `docs/superpowers/plans/2026-11-20-tissue-fidelity-m1.md`（顶部加废弃标记）

**Interfaces:**
- Consumes: Task 5 的新路径与器官 README。
- Produces: 仓库文档里的仿真路径只指向 `organs/human-organs/`；旧计划明确标为废弃。

- [x] **Step 1: 更新 `AGENTS.md`**

- `systems/lib/parameters.js` → `lib/parameters.js`（全部出现处）。
- `systems/digestive/references/source-index.csv` → `organs/human-organs/references/source-index.csv`。
- `systems/**/*.parameters.json` → `organs/human-organs/**/*.parameters.json`；`systems/nervous/interoception.parameters.json` 仍保留并被 `test/parameters.test.mjs` 校验，注明它是 legacy。
- “当前 M1 契约分布在 `systems/digestive/`……”改成器官目录与 P0 脚本的实际路径。
- “已实现”表补上 P0 四个脚本与 `organs/`；明确根清单在 Task 8 之后才启用。
- `package.json` 的 `files` 说明改成包含 `organs/` 与 `lib/`。
- 模块契约表补一句：一个器官目录可放多个脚本，部位 id 不要求等于目录名。

- [x] **Step 2: 更新 `docs/virtual-body.md`**

- 顶部保留“设计草案”声明，并加一句：当前实现的仿真单元是 `organs/human-organs/<organ>/`，P0 见设计文档 §6。
- 把 §1 的 11 系统表改成“器官层”表：仿真单元、功能标签、当前 P0、后续清单入口；11 个系统名只作为功能标签保留，不再作为目录或仿真层级。表骨架：

  ```markdown
  | 层 | 内容 |
  | --- | --- |
  | 仿真单元 | `organs/human-organs/<organ>/`，一个器官可由多个脚本组成 |
  | 功能标签 | 消化、内分泌、感觉器等，只用于 README 分类 |
  | P0 | 胃（动力、饥饿素、机械感受）、十二指肠（营养暴露） |
  | 后续清单 | [`2026-11-20-organ-model-design.md`](./superpowers/specs/2026-11-20-organ-model-design.md) §6 |
  ```
- 全文把 `systems/digestive/stomach.ts`、`systems/endocrine/ghrelin.ts` 等仿真路径改成 `organs/human-organs/...` 示例。
- 把旧部位名 `ghrelin`、`gastricSensory` 改成 `stomachGhrelin`、`stomachSensory`。
- §7 的证据/管理表链接改为器官 README 或设计文档；删除指向已删目录的链接。

- [x] **Step 3: 更新 `docs/gateway-and-scripts.md`**

- `systems/lib/parameters.js` → `lib/parameters.js`。
- 示例清单路径 `./systems/digestive/stomach.ts` → `./organs/human-organs/stomach/motility.ts`。
- 教程里的 `$DEMO_DIR/systems/digestive/` 改成 `$DEMO_DIR/organs/human-organs/stomach/`，命令与清单同步。
- 参数章节补一句：参数文件跟随器官脚本放同目录。

- [x] **Step 4: 给三份旧计划加废弃标记**

在每份文件标题下加：

```markdown
> **已废弃（2026-11-20）：** 本计划的系统分层与脚本路径不再适用；器官级设计见 [`2026-11-20-organ-model-design.md`](../specs/2026-11-20-organ-model-design.md)，P0 实施见 [`2026-11-20-organ-model-p0.md`](./2026-11-20-organ-model-p0.md)。
```

- [x] **Step 5: 验证并提交**

Run:

```bash
git grep -nE 'systems/(digestive|endocrine|sensory)' -- AGENTS.md docs/virtual-body.md docs/gateway-and-scripts.md
```

Expected: 无输出。

Run: `npm test`
Expected: 全部 PASS（纯文档改动也应保持绿）。

```bash
git add AGENTS.md docs
git commit -m "docs: 把仿真路径与契约口径统一到器官目录"
```

---

### Task 7: 重放工具

**Files:**
- Create: `tools/replay.mjs`
- Test: `test/tools.replay.test.mjs`

**Interfaces:**
- Consumes: Task 1–4 的四个模块；`scenarios/m1-water-240.json` 与 `scenarios/m1-liquid-meal-levine-355.json`。
- Produces: CLI `node tools/replay.mjs [scenarioPath]`，输出 JSON：`{ scenario, actionLagRounds: 1, note, observations }`；`observations` 每项含 `simMin` 与场景 `signals` 里的字段路径。

- [x] **Step 1: 写失败的 CLI 测试**

```js
// test/tools.replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('water replay reports the one-round action lag', () => {
  const output = execFileSync(process.execPath, ['tools/replay.mjs', 'scenarios/m1-water-240.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  assert.equal(result.scenario, 'm1-water-240');
  assert.equal(result.actionLagRounds, 1);
  assert.equal(result.observations[0].simMin, 0);
  assert.equal(result.observations[0]['stomach.volumeMl'], 35);
  const atFive = result.observations.find((entry) => entry.simMin === 5);
  assert.ok(atFive['stomach.volumeMl'] > 35);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/tools.replay.test.mjs`
Expected: FAIL，`tools/replay.mjs` 不存在。

- [x] **Step 3: 实现重放工具**

`tools/replay.mjs`：

- 读场景 JSON；默认 `scenarios/m1-water-240.json`。
- 按固定顺序导入四个模块：`motility.ts`、`ghrelin.ts`、`gastric-sensory.ts`、`nutrient-exposure.ts`。
- 用各模块 `initialState` 建 `parts`，再按场景 `baseline` 的 `部位.字段` 覆盖。
- 观察时点取 `observe.atMin` 或 `observe.postMealMin` 的并集；最大轮数取最大时点。
- 第 `t` 轮（`t` 从 1 开始，`simulatedSeconds = t * 60`）投递 `atMin === t - 1` 的动作，因此 `actionLagRounds` 固定为 1；`atMin: 0` 的动作在第 1 轮生效。
- 每轮先冻结轮初 `parts`，按模块顺序调用 `heartbeat`；`io.read(id)` 返回轮初部位，`io.write` 收集下一状态；应用所有写回后再进入下一轮。
- 在 `simMin = 0` 记录基线；每轮结束后若 `t` 在观察时点集合里，记录 `signals` 指定的字段。
- 液餐场景的 `interoception.fullness` 在 P0 没有消费者；工具照常输出基线值，并在 `note` 里写明“P0 不产出体感”。
- 只输出 `JSON.stringify(result, null, 2)`，不要额外日志。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/tools.replay.test.mjs`
Expected: PASS。

Run: `node tools/replay.mjs scenarios/m1-water-240.json`
Expected: 能看到 `"actionLagRounds": 1` 和 `stomach.volumeMl` 序列。

Run: `npm test`
Expected: 全部 PASS。

- [x] **Step 5: 提交**

```bash
git add tools/replay.mjs test/tools.replay.test.mjs
git commit -m "feat: 增加器官级场景重放工具"
```

---

### Task 8: 根清单启用与真实 Gateway 验收

**Files:**
- Modify: `body-modules.json`
- Modify: `package.json:7`
- Test: `test/organs.gateway.test.mjs`

**Interfaces:**
- Consumes: Task 1–7 的全部交付物。
- Produces: 根清单四条脚本路径；`package.json` 的 `files` 含 `organs/`、`lib/`；真实 Gateway 启动后 `/capabilities` 有 `drink`/`eat`，`/state` 有四个部位。

- [x] **Step 1: 写失败的 Gateway 验收测试**

```js
// test/organs.gateway.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the root manifest loads all four organ scripts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-'));
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath: join(dir, 'body-state.json'),
    port: 0,
    autoTick: false,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const info = await gateway.ready;

  const capabilities = await (await fetch(`http://127.0.0.1:${info.port}/capabilities`)).json();
  assert.deepEqual(capabilities.drink, ['stomach']);
  assert.deepEqual(capabilities.eat, ['stomach', 'stomachGhrelin']);

  const response = await fetch(`http://127.0.0.1:${info.port}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'drink-1', type: 'drink', volumeMl: 240 }),
  });
  assert.equal(response.status, 202);
  await gateway.tick();

  const state = await (await fetch(`http://127.0.0.1:${info.port}/state`)).json();
  assert.ok(state.parts.stomach.volumeMl > 0);
  assert.ok(state.parts.stomachGhrelin.relativeConcentration > 0);
  assert.ok(state.parts.stomachSensory.mechanical >= 0);
  assert.ok(state.parts.duodenum.nutrientExposure >= 0);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/organs.gateway.test.mjs`
Expected: FAIL，`capabilities.drink` 为空或 `/capabilities` 没有 `drink`。

- [x] **Step 3: 启用根清单与打包路径**

`body-modules.json` 的 `scripts` 改为：

```json
[
  "./organs/human-organs/stomach/motility.ts",
  "./organs/human-organs/stomach/ghrelin.ts",
  "./organs/human-organs/stomach/gastric-sensory.ts",
  "./organs/human-organs/duodenum/nutrient-exposure.ts"
]
```

`package.json` 的 `files` 加 `"organs/"`、`"lib/"`。

- [x] **Step 4: 运行验收**

Run: `node --test test/organs.gateway.test.mjs`
Expected: PASS。

Run: `npm test`
Expected: 全部 PASS。

- [x] **Step 5: 提交**

```bash
git add body-modules.json package.json test/organs.gateway.test.mjs
git commit -m "feat: 启用胃与十二指肠四个器官脚本"
```

---

## 交付检查

- [x] `npm test` 全绿。
- [x] `node tools/replay.mjs scenarios/m1-water-240.json` 输出 `actionLagRounds: 1` 与白水体积序列。
- [x] `git grep -nE 'systems/(digestive|endocrine|sensory)' -- ':!docs/superpowers/plans/*' ':!docs/superpowers/specs/*'` 无输出。
- [x] `body-modules.json` 只有四条器官脚本；`package.json` 的 `files` 含 `organs/`、`lib/`。
- [x] 真实 Gateway 启动后 `/capabilities` 为 `drink → ['stomach']`、`eat → ['stomach','stomachGhrelin']`（ghrelin 消费 `eat` 动作，因此声明该类型），`/state` 有 `stomach`、`stomachGhrelin`、`stomachSensory`、`duodenum`。
