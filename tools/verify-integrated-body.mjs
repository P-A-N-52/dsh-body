/**
 * 整合发布联测入口（M38）：在真实 Gateway、临时目录、端口 0、autoTick:false、固定时钟上，
 * 对可发布的 dsh-body 做一次性跨系统验收。默认 `node tools/verify-integrated-body.mjs`
 * 即可运行全部检查；各驱动同时导出，供 `test/organs.integrated-body.test.mjs` 复用。
 *
 * 检查内容（与任务一一对应）：
 * 1. `verifyPackagedManifests`：npm pack 到临时目录并解包，从解包目录启动人体根/女/男清单与
 *    可选脂质预设，核对加载部位数（当前 47/50/49/54）与启动脚本数，并逐轮心跳若干轮。
 * 2. `verifyThermalPair`：同一第三方包外脚本经 `io.getThermalProfile()` 并行读取 37 °C 默认
 *    人体与虚构 32 °C（31.5–32.5）个体；各自静态参考正确、互不污染、无 `body_act`，
 *    32 °C 个体安静基线无错误冷感/唤醒。
 * 3. `verifyIntegratedScenario`：脂质预设上一组已知脂肪摄入 + 饮水 + 温湿/衣层 + 暂停重启
 *    双胞胎对照；核对 `stomach.deliveredWaterMl`、快渴缓解（仅已提交胃水）、实汗扣水与受限
 *    蒸发、糖/肾/肌关键读数、脂质有限库存（显式 `fatG:0` 不被估值覆盖）与只读体成分；
 *    同 id 重放与暂停重启均不重复结算（回执与库存前后对照）。
 * 4. `verifyOrganParameterDocs`：在解包目录运行 `tools/sync-organ-parameters.mjs --check`
 *    （`tools/` 不在发布清单内，用被测同版本工具副本执行）。
 * 5. `verifyNonhumanDemoSpotCheck`：`experiments/nonhuman-traits/` 仍在实验分支（f2761e8…），
 *    用 `git archive` 导出该 tip 到解包目录旁，对解包运行时跑一次 demo，只记录通过/失败与
 *    原因——非主线、默认不打包、未验收；不修改任何一方。
 * 6. `runSeventyTwoHourReplay`：同一整合代码、无个人存档，按 M12 A 日程（
 *    `test-support/integrated-body-schedule.mjs`）走真实 Gateway 心跳 4320 轮，动作提前一轮
 *    入队，原路经过第 2606 轮；每轮断言提交成功、无 fatal/NaN/±Infinity/非法负库存、时钟对齐；
 *    结束后核对 51 个动作恰好各结算一次与水/糖真实收支。
 *
 * 时序约定（两个驱动一致）：先在上一轮已提交的 `simulatedSeconds` 上入队（`effectiveAt` 即为
 * 下一轮目标），再推进固定时钟一分钟，再 `tick()`；动作因此在“生效分钟整”的批次恰好结算一次。
 *
 * 未测边界：DSH 宿主实机会话投递与临床/人体标定均不在本入口范围内。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

import { checkpoint } from '../test-support/harness.mjs';
import {
  ACTIONS_PER_DAY,
  INTEGRATED_START_EPOCH_MS,
  ORIGINAL_M12_ROUND,
  ROUND_SECONDS,
  SCHEDULE_DAYS,
  TOTAL_ROUNDS,
  assertEventSettledOnce,
  buildIntegratedSchedule,
  eventsDueForSubmission,
} from '../test-support/integrated-body-schedule.mjs';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const keepTemp = process.env.DSH_BODY_VERIFY_KEEP === '1';
const NONHUMAN_COMMIT = 'f2761e8f514c408617cb79d00c0fa0c5b2fb0ad6';
const HUMAN_THERMAL_REFERENCE = {
  baselineCoreC: 37,
  coreBandRelative: false,
  normalCoreMinC: 37,
  normalCoreMaxC: 37,
  ambientComfortMinC: null,
  ambientComfortMaxC: null,
};
const LOW_THERMAL_REFERENCE = {
  baselineCoreC: 32,
  coreBandRelative: true,
  normalCoreMinC: 31.5,
  normalCoreMaxC: 32.5,
  ambientComfortMinC: null,
  ambientComfortMaxC: null,
};
const LOW_CORE_PARAMETERS = {
  'thermoregulation.setpointC': 32,
  'thermoregulation.normalCoreMinC': 31.5,
  'thermoregulation.normalCoreMaxC': 32.5,
};
const DEFAULT_BODY_COMPOSITION = { weightKg: 75, bodyFatPercent: null, fatMassKg: null, fatFreeMassKg: null };
// 轮初快照允许为负的合法路径：夜间净热收支、热空气下的干换热（环境向核心传热）可以为负；
// 过量饮水后缺水代理按定义钳到 [-1, 1]。
const NEGATIVE_ALLOWED_PATHS = new Set([
  'thermoregulation.heatBalance.netHeatKcal',
  'thermoregulation.heatBalance.dryHeatLossKcal',
  'bodyFluid.waterDeficit',
]);
const PACKAGED_MANIFESTS = [
  { label: 'root', file: 'body-modules.json', expectedParts: 47 },
  { label: 'female', file: 'body-modules.female.json', expectedParts: 50 },
  { label: 'male', file: 'body-modules.male.json', expectedParts: 49 },
  { label: 'lipid', file: 'organs/presets/human-lipid/body-modules.json', expectedParts: 54 },
];

function out(...args) {
  process.stdout.write(`${args.join(' ')}\n`);
}

function makeWorkDir(label) {
  const base = join(tmpdir(), 'dsh-body');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${label}.`));
}

function captureConsole() {
  const methods = ['log', 'error', 'warn'];
  const original = Object.fromEntries(methods.map((method) => [method, console[method]]));
  const lines = [];
  for (const method of methods) {
    console[method] = (...args) => lines.push([method, args.map(String).join(' ')]);
  }
  return function restore() {
    for (const method of methods) console[method] = original[method];
    return lines;
  };
}

export function createClock(startMs = INTEGRATED_START_EPOCH_MS) {
  let ms = startMs;
  return {
    startMs,
    now: () => ms,
    advanceMinute() { ms += 60_000; },
  };
}

function seedCheckpointFile(statePath, { clock, parts = {}, parameters } = {}) {
  mkdirSync(dirname(statePath), { recursive: true });
  const seeded = checkpoint({ wallTimeMs: clock.now(), simulatedSeconds: 0, parts, profile: { timezoneOffsetMin: 480 } });
  if (parameters !== undefined) seeded.parameters = { ...parameters };
  writeFileSync(statePath, JSON.stringify(seeded));
}

async function loadGatewayModule(rootDir = repoRoot) {
  return import(pathToFileURL(join(rootDir, 'gateway.js')).href);
}

/**
 * 从（新或已有）存档启动 Gateway。`seed` 为 null 时不写存档文件，用于暂停/重启后的恢复启动。
 */
async function bootBody({
  rootDir = repoRoot,
  manifestPath,
  statePath,
  clock,
  seed = {},
} = {}) {
  const { startGateway } = await loadGatewayModule(rootDir);
  if (seed !== null) seedCheckpointFile(statePath, { clock, ...seed });
  const restore = captureConsole();
  let gateway;
  try {
    gateway = startGateway({
      manifestPath,
      statePath,
      port: 0,
      heartbeatIntervalMs: ROUND_SECONDS * 1000,
      autoTick: false,
      now: clock.now,
    });
    await gateway.ready;
  } finally {
    restore();
  }
  return gateway;
}

async function stopAll(gateways) {
  await Promise.allSettled(gateways.map((gateway) => gateway.stop()));
}

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: measured ${actual}, expected ${expected} ± ${tolerance}`,
  );
}

/** 遍历轮初快照全部数值字段：NaN/±Infinity 一律报错；负值仅白名单路径合法。 */
function scanPartsNumbers(parts, label) {
  const problems = [];
  const walk = (partId, value, keys) => {
    if (typeof value === 'number') {
      const path = [partId, ...keys].join('.');
      if (!Number.isFinite(value)) problems.push(`${label}: non-finite ${path} = ${String(value)}`);
      else if (value < 0 && !NEGATIVE_ALLOWED_PATHS.has(path)) {
        problems.push(`${label}: negative ${path} = ${value}`);
      }
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(partId, item, [...keys, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(value)) walk(partId, child, [...keys, key]);
  };
  for (const [partId, part] of Object.entries(parts)) walk(partId, part, []);
  return problems;
}

function readStateFile(statePath) {
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

/** Gateway `getReceipt` 返回完整记录；`submitAction` 回执是其投影视图。按视图字段对齐比较。 */
function receiptViewOf(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    effectiveAt: record.effectiveAt,
    attempts: record.attempts,
    lastError: record.lastError,
    appliedAtSimulatedSeconds: record.appliedAtSimulatedSeconds,
    appliedAtWallTimeMs: record.appliedAtWallTimeMs,
    failedReason: record.failedReason,
  };
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFilesRecursive(root, prefix = '') {
  const entries = readdirSync(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFilesRecursive(root, relativePath));
    else files.push(relativePath);
  }
  return files.sort();
}

/* ---------------------------------------------------------------- *
 * 1. 实包冒烟：npm pack → 解包 → 从解包目录启动四种清单
 * ---------------------------------------------------------------- */

export async function verifyPackagedManifests({ workDir = null } = {}) {
  const ownedWorkDir = workDir === null;
  const dir = ownedWorkDir ? makeWorkDir('m38-pack') : workDir;
  const gateways = [];
  try {
    const packed = spawnSync('npm', ['pack', '--pack-destination', dir], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(packed.status, 0, `npm pack failed: ${packed.stderr}`);
    const tarballName = packed.stdout.trim().split('\n').filter(Boolean).pop();
    const tarball = join(dir, tarballName);
    const extracted = spawnSync('tar', ['-xzf', tarball, '-C', dir], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, `tar extraction failed: ${extracted.stderr}`);
    const unpackedDir = join(dir, 'package');

    const repoFiles = listFilesRecursive(repoRoot, 'organs');
    const packedFiles = listFilesRecursive(unpackedDir, 'organs');
    assert.deepEqual(packedFiles, repoFiles, 'packaged organs tree differs from the repo organs tree');
    let mismatched = 0;
    for (const file of packedFiles) {
      if (sha256File(join(repoRoot, file)) !== sha256File(join(unpackedDir, file))) {
        mismatched += 1;
      }
    }
    assert.equal(mismatched, 0, 'packaged organ files differ in content from the repo');

    const manifestResults = [];
    const clock = createClock();
    for (const manifest of PACKAGED_MANIFESTS) {
      const manifestPath = join(unpackedDir, manifest.file);
      const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const gateway = await bootBody({
        rootDir: unpackedDir,
        manifestPath,
        statePath: join(dir, `${manifest.label}-body-state.json`),
        clock,
      });
      gateways.push(gateway);
      const partCount = Object.keys(gateway.getState().parts).length;
      assert.equal(partCount, manifest.expectedParts,
        `${manifest.label}: loaded ${partCount} parts, expected ${manifest.expectedParts}`);
      assert.equal(manifestJson.startupScripts.length, 1, `${manifest.label}: startup script count`);
      for (let round = 1; round <= 3; round += 1) {
        clock.advanceMinute();
        const outcome = await gateway.tick();
        assert.deepEqual(outcome, { ran: true, failed: false }, `${manifest.label} round ${round}`);
      }
      const health = gateway.getHealth();
      assert.equal(health.status, 'ok', `${manifest.label}: health status after smoke rounds`);
      manifestResults.push({
        label: manifest.label,
        manifest: manifest.file,
        partCount,
        startupScripts: manifestJson.startupScripts.length,
        heartbeats: 3,
      });
    }
    return {
      name: 'pack-smoke',
      ok: true,
      unpackedDir,
      workDir,
      tarball: tarballName,
      tarballSha256: sha256File(tarball),
      organsFilesChecked: packedFiles.length,
      manifests: manifestResults,
    };
  } finally {
    await stopAll(gateways);
    if (ownedWorkDir && !keepTemp) rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- *
 * 2. 温度参考双体：同一第三方脚本并行读 37 °C 与虚构 32 °C
 * ---------------------------------------------------------------- */

const THERMAL_REPORT_SOURCE = `
export const id = 'integratedThermalReport';
export const initialState = {
  reference: null, frozen: false, coreC: null, coldMm: null, sleeping: null, wakeEvent: null,
};
export const fields = {
  reference: { unit: 'record', mode: 'absolute' },
  frozen: { unit: '1', mode: 'absolute' },
  coreC: { unit: '°C', mode: 'absolute' },
  coldMm: { unit: 'mm', mode: 'absolute' },
  sleeping: { unit: '1', mode: 'absolute' },
  wakeEvent: { unit: 'label', mode: 'absolute' },
};
export const actionTypes = [];
export function heartbeat(io) {
  const reference = io.getThermalProfile?.();
  if (!reference) return;
  io.write({
    reference,
    frozen: Object.isFrozen(reference) && !Reflect.set(reference, 'baselineCoreC', 90),
    coreC: io.read('thermoregulation')?.coreTemperatureC ?? null,
    coldMm: io.read('interoception')?.coldMm ?? null,
    sleeping: io.read('sleep')?.sleeping ?? null,
    wakeEvent: io.read('sleep')?.wakeEvent ?? null,
  });
}
`;

export async function verifyThermalPair({ rootDir = repoRoot } = {}) {
  const workDir = makeWorkDir('m38-thermal');
  const gateways = [];
  const restore = captureConsole();
  try {
    const fixturePath = join(workDir, 'integrated-thermal-report.mjs');
    writeFileSync(fixturePath, THERMAL_REPORT_SOURCE);
    const organManifest = JSON.parse(readFileSync(join(rootDir, 'body-modules.json'), 'utf8'));
    const externalize = (path) => relative(workDir, join(rootDir, path));
    const manifestPath = join(workDir, 'body-modules.pair.json');
    writeFileSync(manifestPath, JSON.stringify({
      startupScripts: organManifest.startupScripts.map(externalize),
      scripts: [...organManifest.scripts.map(externalize), relative(workDir, fixturePath)],
      catchUpMinutes: 0,
    }));

    const clock = createClock();
    const humanPath = join(workDir, 'human-37c.json');
    const lowPath = join(workDir, 'fictional-32c.json');
    seedCheckpointFile(humanPath, { clock });
    seedCheckpointFile(lowPath, { clock, parameters: LOW_CORE_PARAMETERS });
    const { startGateway } = await loadGatewayModule(rootDir);
    const boot = (statePath) => {
      const gateway = startGateway({
        manifestPath,
        statePath,
        port: 0,
        heartbeatIntervalMs: ROUND_SECONDS * 1000,
        autoTick: false,
        now: clock.now,
      });
      gateways.push(gateway);
      return gateway;
    };
    const human = boot(humanPath);
    const low = boot(lowPath);
    await Promise.all([human.ready, low.ready]);
    for (let round = 1; round <= 10; round += 1) {
      clock.advanceMinute();
      for (const [label, gateway] of [['human-37c', human], ['fictional-32c', low]]) {
        const outcome = await gateway.tick();
        assert.deepEqual(outcome, { ran: true, failed: false }, `${label} round ${round}`);
      }
    }
    const humanParts = human.getState().parts;
    const lowParts = low.getState().parts;
    assert.deepEqual(humanParts.integratedThermalReport.reference, HUMAN_THERMAL_REFERENCE);
    assert.deepEqual(lowParts.integratedThermalReport.reference, LOW_THERMAL_REFERENCE);
    assert.equal(humanParts.integratedThermalReport.frozen, true, 'the thermal profile must stay frozen');
    assert.equal(lowParts.integratedThermalReport.frozen, true, 'the thermal profile must stay frozen');
    for (const [label, parts, expectedCoreC] of [['human-37c', humanParts, 37], ['fictional-32c', lowParts, 32]]) {
      // 06:00 当地处昼夜谷：legacy 人体按固定 37 °C 冷阈可读到 <1 mm 的谷值冷感（模型正确行为）；
      // 相对模式的虚构 32 °C 个体冷阈在本体带下界，必须精确无冷感。
      if (parts === humanParts) assert.ok(parts.integratedThermalReport.coldMm < 1,
        `${label}: only the circadian-valley cold readout is allowed (measured ${parts.integratedThermalReport.coldMm})`);
      else assert.equal(parts.integratedThermalReport.coldMm, 0, `${label}: no cold sensation at rest`);
      assert.equal(parts.integratedThermalReport.sleeping, false, `${label}: stays awake at rest`);
      assert.equal(parts.integratedThermalReport.wakeEvent, 'none', `${label}: no spurious wake event`);
      assertClose(parts.integratedThermalReport.coreC, expectedCoreC, 0.5, `${label}: core near own baseline`);
    }
    assert.ok(
      Math.abs(humanParts.integratedThermalReport.coreC - lowParts.integratedThermalReport.coreC) > 4,
      'the two bodies must not contaminate each other’s core temperature',
    );
    for (const [label, gateway] of [['human-37c', human], ['fictional-32c', low]]) {
      const capabilities = gateway.getCapabilities();
      assert.equal(Object.hasOwn(capabilities, 'body_act'), false, `${label}: no body_act action type`);
      assert.ok(Array.isArray(capabilities.drink) && capabilities.drink.length > 0, `${label}: drink still served`);
      const coldOrWake = gateway.getNotifications().filter(
        ({ mode, text }) => mode === 'wake' || /发凉|冰冷|燥热|滚烫/u.test(text),
      );
      assert.deepEqual(coldOrWake, [], `${label}: no cold-alarm or wake notifications at rest`);
    }
    return {
      name: 'thermal-pair',
      ok: true,
      workDir,
      rounds: 10,
      human: {
        reference: humanParts.integratedThermalReport.reference,
        coreC: humanParts.integratedThermalReport.coreC,
        coldMm: humanParts.integratedThermalReport.coldMm,
      },
      low: {
        reference: lowParts.integratedThermalReport.reference,
        coreC: lowParts.integratedThermalReport.coreC,
        coldMm: lowParts.integratedThermalReport.coldMm,
      },
    };
  } finally {
    restore();
    await stopAll(gateways);
    if (!keepTemp) rmSync(workDir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- *
 * 3. 脂质预设整合场景（已知脂肪 + 饮水 + 温湿/衣层 + 暂停重启对照）
 * ---------------------------------------------------------------- */

const SCENARIO_MINUTE = {
  WATER_1: 1,
  MEAL: 3,
  HEAT: 5,
  WATER_2: 30,
  COOL: 40,
  HOT_DRY: 60,
  COOL_2: 120,
  REHYDRATE: 130,
};
const SCENARIO_ROUNDS = 600; // 10 h：脂肪链到脂肪库接近稳态，且热应激结束后有充分回落窗

function scenarioActionPlan() {
  return [
    { atMin: SCENARIO_MINUTE.WATER_1, id: 'm38-water-1', action: {
      type: 'drink', volumeMl: 300, energyKcal: 0, carbohydrateG: 0, fatG: 0, durationMin: 1,
    } },
    { atMin: SCENARIO_MINUTE.MEAL, id: 'm38-fat-meal', action: {
      type: 'eat', volumeMl: 400, energyKcal: 700, carbohydrateG: 70, fatG: 20, mealKind: 'solid', durationMin: 15,
    } },
    { atMin: SCENARIO_MINUTE.HEAT, id: 'm38-hot-humid', action: {
      type: 'set_environment', airTemperatureC: 38, relativeHumidityPct: 90,
    } },
    { atMin: SCENARIO_MINUTE.HEAT, id: 'm38-wear-jacket', action: {
      type: 'wear_layer', layerId: 'jacket',
    } },
    { atMin: SCENARIO_MINUTE.WATER_2, id: 'm38-water-2', action: {
      type: 'drink', volumeMl: 300, energyKcal: 0, carbohydrateG: 0, fatG: 0, durationMin: 1,
    } },
    { atMin: SCENARIO_MINUTE.COOL, id: 'm38-mild-air', action: {
      type: 'set_environment', airTemperatureC: 25, relativeHumidityPct: 50,
    } },
    { atMin: SCENARIO_MINUTE.COOL, id: 'm38-remove-jacket', action: {
      type: 'remove_layer', layerId: 'jacket',
    } },
    { atMin: SCENARIO_MINUTE.HOT_DRY, id: 'm38-hot-dry', action: {
      type: 'set_environment', airTemperatureC: 38, relativeHumidityPct: 20,
    } },
    { atMin: SCENARIO_MINUTE.COOL_2, id: 'm38-recovery-air', action: {
      type: 'set_environment', airTemperatureC: 25, relativeHumidityPct: 50,
    } },
    { atMin: SCENARIO_MINUTE.REHYDRATE, id: 'm38-rehydrate', action: {
      type: 'drink', volumeMl: 800, energyKcal: 0, carbohydrateG: 0, fatG: 0, durationMin: 1,
    } },
  ];
}

function setBodyActive(statePath, active) {
  const saved = readStateFile(statePath);
  saved.active = active;
  writeFileSync(statePath, JSON.stringify(saved));
}

/**
 * 在一具脂质预设身体上走完整场景，返回每轮快照、回执、最终状态与通知。
 * `pauseAroundTick` 非空时，该轮入队后先停止 Gateway、写 active:false 验证暂停行为，
 * 再写 active:true 恢复，其余与对照身体逐轮一致。
 */
export async function driveLipidScenario({ manifestPath, workDir, clock, label, pauseAroundTick = null }) {
  const statePath = join(workDir, `${label}-body-state.json`);
  let gateway = await bootBody({
    manifestPath,
    statePath,
    clock,
    seed: { parts: { bodyFluid: { waterVolumeMl: 29400 } } },
  });
  const gateways = [gateway];
  const plan = scenarioActionPlan();
  const receipts = {};
  const history = [];
  const submitted = [];
  let pauseDone = false;
  let idempotentRecheckDone = false;
  try {
    for (let round = 1; round <= SCENARIO_ROUNDS; round += 1) {
      const startSeconds = (round - 1) * ROUND_SECONDS;
      for (const entry of plan) {
        if ((entry.atMin - 1) * ROUND_SECONDS !== startSeconds) continue;
        const first = gateway.submitAction({ id: entry.id, ...entry.action });
        assert.equal(first.statusCode, 202, `${label}: submit ${entry.id}`);
        submitted.push(entry.id);
        if (entry.id === 'm38-water-1') {
          const replay = gateway.submitAction({ id: entry.id, ...entry.action });
          assert.equal(replay.statusCode, 200, `${label}: same payload must replay the same receipt`);
          assert.deepEqual(replay.body, first.body, `${label}: replayed receipt must be identical`);
          const conflict = gateway.submitAction({ id: entry.id, ...entry.action, volumeMl: 500 });
          assert.equal(conflict.statusCode, 409, `${label}: same id with a new payload must be rejected`);
        }
      }
      if (!idempotentRecheckDone && round >= 2) {
        // 首个饮水动作已 applied：同载荷重放仍是同一回执，且不追加胃水。
        const receipt = gateway.getReceipt('m38-water-1');
        assert.equal(receipt.status, 'applied');
        const before = gateway.getState().parts.stomach.deliveredWaterMl;
        const replay = gateway.submitAction({
          id: 'm38-water-1', type: 'drink', volumeMl: 300, energyKcal: 0, carbohydrateG: 0, fatG: 0, durationMin: 1,
        });
        assert.equal(replay.statusCode, 200, `${label}: post-apply replay stays idempotent`);
        assert.deepEqual(replay.body, receiptViewOf(receipt), `${label}: post-apply replay returns the same receipt`);
        assert.equal(gateway.getState().parts.stomach.deliveredWaterMl, before,
          `${label}: replaying the applied action must not deliver water again`);
        idempotentRecheckDone = true;
      }

      if (pauseAroundTick !== null && round === pauseAroundTick && !pauseDone) {
        // 暂停对照：入队后停机 → active:false 重启（动作入队被拒、tick 空转）→ active:true 恢复。
        await gateway.stop();
        setBodyActive(statePath, false);
        const paused = await bootBody({ manifestPath, statePath, clock, seed: null });
        gateways.push(paused);
        assert.equal(paused.getHealth().active, false, `${label}: paused boot must report active=false`);
        const pausedTick = await paused.tick();
        assert.deepEqual(pausedTick, { ran: false, failed: false, paused: true },
          `${label}: paused body must not run heartbeats`);
        const rejected = paused.submitAction({ id: `${label}-while-paused`, type: 'urinate' });
        assert.equal(rejected.statusCode, 409, `${label}: actions are rejected while paused`);
        await paused.stop();
        setBodyActive(statePath, true);
        gateway = await bootBody({ manifestPath, statePath, clock, seed: null });
        gateways.push(gateway);
        const saved = readStateFile(statePath);
        assert.ok(saved.pendingActionIds.includes('m38-water-2'),
          `${label}: the pre-pause action must still be queued after resume`);
        pauseDone = true;
      }

      clock.advanceMinute();
      const outcome = await gateway.tick();
      assert.deepEqual(outcome, { ran: true, failed: false }, `${label}: round ${round}`);
      const parts = gateway.getState().parts;
      const problems = scanPartsNumbers(parts, label);
      assert.deepEqual(problems, [], `${label}: round ${round} state scan`);
      history.push(parts);
    }

    for (const entry of plan) {
      const receipt = gateway.getReceipt(entry.id);
      assertEventSettledOnce(receipt, { id: entry.id, atMin: entry.atMin });
      receipts[entry.id] = receipt;
    }
    const notifications = gateway.getNotifications().map(({ mode, sessionId, text, createdAtSimulatedSeconds }) => ({
      mode, sessionId, text, createdAtSimulatedSeconds,
    }));
    return {
      label,
      history,
      receipts,
      finalParts: gateway.getState().parts,
      notifications,
      submitted,
    };
  } finally {
    await stopAll(gateways);
  }
}

function fatChainInventoryG(parts) {
  return parts.stomach.solidFatG
    + parts.stomach.nonSolidFatG
    + parts.intestinalLipid.lumenTgG
    + parts.intestinalLipid.hydrolyzedG
    + parts.intestinalLipid.residueTotalG
    + parts.intestinalLymph.tgInTransitG
    + parts.lipidCirculation.mealTgG
    + parts.lipidCirculation.nefaEquivalentG
    + parts.adipose.storedTgG
    + parts.lipidCirculation.tissueUptakeTotalG;
}

function sumHistory(history, read) {
  return history.reduce((total, parts) => total + read(parts), 0);
}

export async function verifyIntegratedScenario({ rootDir = repoRoot, manifestPath } = {}) {
  const resolvedManifestPath = manifestPath ?? join(rootDir, 'organs/presets/human-lipid/body-modules.json');
  const workDir = makeWorkDir('m38-scenario');
  try {
    const control = await driveLipidScenario({
      manifestPath: resolvedManifestPath, workDir, clock: createClock(), label: 'control',
    });
    const pausedBody = await driveLipidScenario({
      manifestPath: resolvedManifestPath, workDir, clock: createClock(), label: 'paused', pauseAroundTick: 30,
    });

    const at = (body, round) => body.history[round - 1];

    // —— 饮水入胃与显式零脂肪 ——
    const controlR1 = at(control, 1);
    assert.equal(controlR1.stomach.deliveredWaterMl, 300, 'round 1 delivers the submitted water');
    assert.equal(controlR1.stomach.waterVolumeMl, 300, 'round 1 gastric water equals the delivered bolus');
    assert.equal(controlR1.stomach.explicitFatIntakeG, 0, 'explicit fatG:0 stays an explicit zero');
    assert.equal(controlR1.stomach.estimatedFatIntakeG, null, 'no estimated fat is invented');
    assert.equal(controlR1.stomach.unknownFatIntakeSlices, 0, 'no unknown-fat slices are invented');

    // —— 快渴缓解：只来自上一轮已提交胃水 ——
    const slowR1 = controlR1.hypothalamusThirst.thirst;
    assert.ok(slowR1 > 0, `seeded dehydration must raise the slow drive (measured ${slowR1})`);
    const reliefFraction = at(control, 2).interoception.oralThirstReliefFraction;
    assert.ok(reliefFraction !== null && reliefFraction > 0.5,
      `committed gastric water must open the quick-relief path (measured ${reliefFraction})`);
    const compositeR2 = at(control, 2).interoception.thirst;
    assert.ok(compositeR2 < slowR1,
      `quick relief must cut the composite thirst below the slow drive (composite ${compositeR2} vs slow ${slowR1})`);
    assert.ok(compositeR2 < 20, `300 mL in the stomach nearly silences thirst (measured ${compositeR2})`);

    // —— 已知脂肪餐：显式克数一路入账，全链守恒 ——
    const explicitFatSumG = sumHistory(control.history, (parts) => parts.stomach.explicitFatIntakeG ?? 0);
    assertClose(explicitFatSumG, 20, 1e-6, 'explicit meal fat delivered to the stomach');
    for (const parts of control.history) {
      assert.equal(parts.stomach.estimatedFatIntakeG, null, 'no round invents estimated fat');
      assert.equal(parts.stomach.unknownFatIntakeSlices, 0, 'no round invents unknown-fat slices');
    }
    const finalFatInventoryG = fatChainInventoryG(control.finalParts);
    assertClose(finalFatInventoryG, 80, 1e-3,
      '20 g meal fat + 60 g adipose seed must close across the whole lipid chain');
    assert.ok(control.finalParts.adipose.storedTgG > 60.5,
      `meal fat must reach the finite store (measured ${control.finalParts.adipose.storedTgG} g vs the 60 g seed)`);
    assert.ok(control.finalParts.adipose.storedTgG <= control.finalParts.adipose.capacityG,
      'the stored TG must respect the finite capacity');

    // —— 温湿 + 衣层：实汗扣水与受限蒸发；干热对照：蒸发足额 ——
    const paidRounds = control.history
      .map((parts, index) => ({ round: index + 1, parts }))
      .filter(({ parts }) => parts.skin.sweatVolumeMl > 0);
    assert.ok(paidRounds.length >= 1, 'the heat episodes must produce paid sweat');
    const firstPaidRound = paidRounds[0].round;
    assert.ok(firstPaidRound <= 45,
      `sweat must start promptly under 38 °C / 90 % RH + jacket (round ${firstPaidRound})`);
    const restricted = paidRounds.find(({ round, parts }) => round > firstPaidRound
      && round < SCENARIO_MINUTE.COOL + 10
      && parts.thermoregulation.heatBalance
      && parts.thermoregulation.heatBalance.paidSweatMl > 0
      && parts.thermoregulation.heatBalance.evaporationMultiplier < 1
      && parts.thermoregulation.heatBalance.evaporationLimitMl < parts.thermoregulation.heatBalance.paidSweatMl);
    assert.ok(restricted, 'humidity + jacket must restrict evaporation below the paid sweat');
    const previousSweatMl = at(control, restricted.round - 1).skin.sweatVolumeMl;
    assertClose(restricted.parts.thermoregulation.heatBalance.paidSweatMl, previousSweatMl, 1e-9,
      'evaporation accounting must consume exactly the previously committed sweat');
    // 汗窗水账（闭合等式）：体水变化 = 小肠吸收 + 结肠回收 − 实汗 − 尿 − 呼吸失水。
    // absorbedWaterMl 是本轮通量读数；colon.reclaimedWaterMl 是 transferOut 暂存字段
    // （转出后归零），因此回收量从小肠/结肠库存平衡精确重构。所有转移按 Gateway
    // 原子提交，等式应在浮点精度内闭合。
    const firstPaid = paidRounds[0].round;
    const lastPaid = paidRounds[paidRounds.length - 1].round;
    let absorbedMl = 0;
    let reclaimMl = 0;
    let respiratoryMl = 0;
    let paidInWindowMl = 0;
    for (let round = firstPaid; round <= lastPaid; round += 1) {
      const parts = at(control, round);
      const previous = at(control, round - 1);
      const residueOutMl = previous.smallIntestine.waterVolumeMl + parts.stomach.emptiedWaterMl
        - parts.smallIntestine.absorbedWaterMl
        - parts.smallIntestine.waterVolumeMl;
      reclaimMl += previous.colon.residueWaterMl + residueOutMl - parts.colon.residueWaterMl;
      absorbedMl += parts.smallIntestine.absorbedWaterMl;
      respiratoryMl += parts.lungs.respiratoryWaterLossMl;
      paidInWindowMl += parts.skin.sweatVolumeMl;
    }
    const beforeWindow = at(control, firstPaid - 1);
    const afterWindow = at(control, lastPaid);
    const urineOutMl = (afterWindow.bladder.volumeMl + afterWindow.bladder.voidedMl)
      - (beforeWindow.bladder.volumeMl + beforeWindow.bladder.voidedMl);
    const bodyWaterDeltaMl = afterWindow.bodyFluid.waterVolumeMl - beforeWindow.bodyFluid.waterVolumeMl;
    const ledgerBalanceMl = (absorbedMl + reclaimMl - paidInWindowMl - urineOutMl - respiratoryMl)
      - bodyWaterDeltaMl;
    assert.ok(paidInWindowMl > 0, 'the heat episodes must pay real water');
    assertClose(ledgerBalanceMl, 0, 1e-6,
      `the sweat-window water ledger must close: ΔW = ${bodyWaterDeltaMl.toFixed(3)} mL vs ` +
      `absorbed ${absorbedMl.toFixed(3)} + reclaimed ${reclaimMl.toFixed(3)} − sweat ${paidInWindowMl.toFixed(3)} ` +
      `− urine ${urineOutMl.toFixed(3)} − respiratory ${respiratoryMl.toFixed(3)} mL (residual ${ledgerBalanceMl.toExponential(2)})`);
    const unrestricted = paidRounds.filter(({ round }) => round > SCENARIO_MINUTE.HOT_DRY).find(({ parts }) =>
      parts.thermoregulation.heatBalance
      && parts.thermoregulation.heatBalance.paidSweatMl > 0
      && parts.thermoregulation.heatBalance.evaporationMultiplier === 1
      && parts.thermoregulation.heatBalance.evaporationLimitMl >= parts.thermoregulation.heatBalance.paidSweatMl);
    assert.ok(unrestricted, 'hot dry air without a jacket must let evaporation cover all paid sweat');
    assertClose(unrestricted.parts.thermoregulation.heatBalance.evaporatedSweatMl,
      unrestricted.parts.thermoregulation.heatBalance.paidSweatMl, 1e-9,
      'unrestricted evaporation equals the paid sweat');

    // —— 糖 / 肾 / 肌 ——
    const glucosePeak = Math.max(...control.history.map((parts) => parts.glucose.concentrationMgDl));
    assert.ok(glucosePeak > 105, `the meal must disturb blood glucose (peak ${glucosePeak})`);
    assert.ok(glucosePeak < 400, `glucose stays physiological (peak ${glucosePeak})`);
    assert.ok(control.finalParts.kidneyGlucose.excretedGlucoseG >= 0, 'kidney glucose excretion is non-negative');
    const muscleTotalG = ['muscleHead', 'muscleTrunk', 'muscleLimbs']
      .reduce((total, id) => total + control.finalParts[id].glycogenG, 0);
    assert.ok(muscleTotalG > 0 && Number.isFinite(muscleTotalG), 'muscle glycogen stays finite and positive');
    assert.ok(control.finalParts.liver.glycogenG > 0 && control.finalParts.liver.glycogenG <= 100,
      `liver glycogen stays within its finite store (measured ${control.finalParts.liver.glycogenG})`);

    // —— 只读体成分与渴感回落 ——
    const composition = (parts) => ({
      weightKg: parts.bodyComposition.weightKg,
      bodyFatPercent: parts.bodyComposition.bodyFatPercent,
      fatMassKg: parts.bodyComposition.fatMassKg,
      fatFreeMassKg: parts.bodyComposition.fatFreeMassKg,
    });
    assert.deepEqual(composition(control.finalParts), DEFAULT_BODY_COMPOSITION,
      'body composition stays the profile-derived read-only value');
    const compositeThirstPeak = Math.max(...control.history.map((parts) => parts.interoception.thirst));
    assert.ok(control.finalParts.hypothalamusThirst.thirst < slowR1,
      `rehydration must lower the slow thirst drive (end ${control.finalParts.hypothalamusThirst.thirst} vs ${slowR1})`);
    assert.ok(compositeThirstPeak > control.finalParts.interoception.thirst + 10,
      `thirst must fall back after the heat and rehydration cycle (peak ${compositeThirstPeak} vs end ${control.finalParts.interoception.thirst})`);

    // —— 暂停重启不重复结算 ——
    assert.deepEqual(pausedBody.finalParts, control.finalParts,
      'the paused twin must land on exactly the same state as the uninterrupted control');
    assert.deepEqual(pausedBody.notifications, control.notifications,
      'the paused twin must produce identical notifications (modulo random ids)');
    for (const entry of scenarioActionPlan()) {
      assert.deepEqual(pausedBody.receipts[entry.id], control.receipts[entry.id],
        `${entry.id}: the paused twin settles the action identically`);
    }
    assert.equal(at(pausedBody, SCENARIO_MINUTE.WATER_2).stomach.deliveredWaterMl, 300,
      'the action queued right before the pause settles exactly once after resume');
    assert.equal(at(pausedBody, SCENARIO_MINUTE.WATER_2 - 1).stomach.deliveredWaterMl, 0,
      'no water is delivered before its batch');
    const totalDeliveredWaterMl = sumHistory(control.history, (parts) => parts.stomach.deliveredWaterMl);
    assertClose(totalDeliveredWaterMl, 1400, 1e-6,
      'the three water actions (300 + 300 + 800 mL) settle exactly once across the whole scenario');
    assert.equal(at(control, 2).stomach.deliveredWaterMl, 0,
      'the replayed water action must not deliver again in the following round');

    return {
      name: 'integrated-scenario',
      ok: true,
      workDir,
      rounds: SCENARIO_ROUNDS,
      thirst: {
        slowAfterSeed: slowR1,
        reliefFraction,
        compositeAfterRelief: compositeR2,
        end: control.finalParts.hypothalamusThirst.thirst,
      },
      water: {
        deliveredMl: [300, 300, 800],
        endBodyFluidMl: control.finalParts.bodyFluid.waterVolumeMl,
      },
      sweat: {
        firstPaidRound,
        restrictedExample: {
          round: restricted.round,
          paidMl: restricted.parts.thermoregulation.heatBalance.paidSweatMl,
          limitMl: restricted.parts.thermoregulation.heatBalance.evaporationLimitMl,
          evaporatedMl: restricted.parts.thermoregulation.heatBalance.evaporatedSweatMl,
          evaporationMultiplier: restricted.parts.thermoregulation.heatBalance.evaporationMultiplier,
        },
        unrestrictedRound: unrestricted.round,
        paidInWindowMl,
      },
      fat: {
        explicitSumG: explicitFatSumG,
        chainInventoryG: finalFatInventoryG,
        storedTgG: control.finalParts.adipose.storedTgG,
        capacityG: control.finalParts.adipose.capacityG,
      },
      glucosePeak,
      muscleGlycogenTotalG: muscleTotalG,
      liverGlycogenG: control.finalParts.liver.glycogenG,
      pause: { pausedAtTick: 30, pendingAcrossPause: 'm38-water-2' },
    };
  } finally {
    if (!keepTemp) rmSync(workDir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- *
 * 4. 参数目录校验（解包目录 --check）
 * ---------------------------------------------------------------- */

export async function verifyOrganParameterDocs({ unpackedDir } = {}) {
  assert.ok(unpackedDir, 'verifyOrganParameterDocs needs the unpacked package directory');
  const toolSource = readFileSync(join(repoRoot, 'tools', 'sync-organ-parameters.mjs'), 'utf8');
  const toolDir = join(unpackedDir, 'tools');
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(join(toolDir, 'sync-organ-parameters.mjs'), toolSource);
  const run = spawnSync(process.execPath, ['tools/sync-organ-parameters.mjs', '--check'], {
    cwd: unpackedDir,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0,
    `sync-organ-parameters --check failed in the unpacked tree:\n${run.stdout}\n${run.stderr}`);
  return {
    name: 'organ-parameter-docs',
    ok: true,
    command: 'node tools/sync-organ-parameters.mjs --check',
    summary: run.stdout.trim().split('\n').pop() ?? '',
  };
}

/* ---------------------------------------------------------------- *
 * 5. 非人实验兼容抽检（非主线、默认不打包、未验收）
 * ---------------------------------------------------------------- */

export async function verifyNonhumanDemoSpotCheck({ unpackedDir } = {}) {
  assert.ok(unpackedDir, 'verifyNonhumanDemoSpotCheck needs the unpacked package directory');
  const marker = '非主线、默认不打包、未验收';
  const archive = spawnSync('git', ['archive', NONHUMAN_COMMIT, 'experiments/nonhuman-traits'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (archive.status !== 0) {
    return {
      name: 'nonhuman-demo-spot-check',
      ok: false,
      marker,
      failure: `git archive ${NONHUMAN_COMMIT} failed: ${archive.stderr?.toString()}`,
    };
  }
  const tar = spawnSync('tar', ['-x', '-C', unpackedDir], { input: archive.stdout, encoding: 'buffer' });
  if (tar.status !== 0) {
    return {
      name: 'nonhuman-demo-spot-check',
      ok: false,
      marker,
      failure: `extracting experiments/nonhuman-traits failed: ${tar.stderr?.toString()}`,
    };
  }
  const demoPath = join(unpackedDir, 'experiments/nonhuman-traits/demo.mjs');
  const run = spawnSync(process.execPath, [demoPath], {
    cwd: unpackedDir,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const outputTail = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
  return {
    name: 'nonhuman-demo-spot-check',
    ok: run.status === 0,
    marker,
    commit: NONHUMAN_COMMIT,
    exitCode: run.status,
    outputTail,
    note: '导出实验分支 tip 的 experiments/nonhuman-traits 到解包目录后运行其 demo 一次；不改任何一方。',
  };
}

/* ---------------------------------------------------------------- *
 * 6. M12 A 日程 72 小时 4320 轮联合回放
 * ---------------------------------------------------------------- */

export async function runSeventyTwoHourReplay({ rootDir = repoRoot, manifestPath } = {}) {
  const resolvedManifestPath = manifestPath ?? join(rootDir, 'body-modules.json');
  const workDir = makeWorkDir('m38-replay-72h');
  let gateway = null;
  const restore = captureConsole();
  let logs = [];
  try {
    const schedule = buildIntegratedSchedule();
    assert.equal(schedule.length, ACTIONS_PER_DAY * SCHEDULE_DAYS);
    const clock = createClock();
    const statePath = join(workDir, 'body-state.json');
    gateway = await bootBody({ rootDir, manifestPath: resolvedManifestPath, statePath, clock });
    assert.equal(Object.keys(gateway.getState().parts).length, 47, 'the replay boots the 47-part root manifest');

    const sums = { deliveredWaterMl: 0, emptiedCarbohydrateG: 0, paidSweatMl: 0, voidedMl: 0, defecatedG: 0 };
    const glucoseSeries = [];
    let submitted = 0;
    let round2606 = null;
    let maxGlucose = { value: -Infinity, round: 0 };
    let maxThirst = { value: -Infinity, round: 0 };

    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      const startSeconds = (round - 1) * ROUND_SECONDS;
      for (const event of eventsDueForSubmission(schedule, startSeconds)) {
        const response = gateway.submitAction({ id: event.id, ...event.action });
        assert.equal(response.statusCode, 202, `submit ${event.id} for minute ${event.atMin}`);
        submitted += 1;
      }
      clock.advanceMinute();
      const outcome = await gateway.tick();
      if (!outcome.ran || outcome.failed) {
        throw new Error(`round ${round} did not commit cleanly: ${JSON.stringify(gateway.getHealth())}`);
      }
      const parts = gateway.getState().parts;
      const problems = scanPartsNumbers(parts, `round ${round}`);
      if (problems.length > 0) throw new Error(problems.join('; '));
      const health = gateway.getHealth();
      if (health.status === 'fatal' || health.fatal) {
        throw new Error(`round ${round} recorded a fatal failure: ${JSON.stringify(health.fatal)}`);
      }
      assert.equal(health.wallTimeMs, clock.now(), `round ${round}: simulated wall clock must advance in step`);
      assert.equal(gateway.getState().simulatedSeconds, round * ROUND_SECONDS, `round ${round}: simulatedSeconds`);

      sums.deliveredWaterMl += parts.stomach.deliveredWaterMl;
      sums.emptiedCarbohydrateG += parts.stomach.emptiedCarbohydrateG;
      sums.paidSweatMl += parts.skin.sweatVolumeMl;
      sums.voidedMl += parts.bladder.voidedMl;
      sums.defecatedG += parts.colon.defecatedG;
      glucoseSeries.push(parts.glucose.concentrationMgDl);
      if (parts.glucose.concentrationMgDl > maxGlucose.value) {
        maxGlucose = { value: parts.glucose.concentrationMgDl, round };
      }
      if (parts.hypothalamusThirst.thirst > maxThirst.value) {
        maxThirst = { value: parts.hypothalamusThirst.thirst, round };
      }
      if (round === ORIGINAL_M12_ROUND) round2606 = { round, ok: true };
    }

    logs = restore();
    const fatalLogs = logs.filter(([, text]) =>
      /Heartbeat failed|due actions outside the batch|still running after/u.test(text));
    assert.deepEqual(fatalLogs, [], 'the replay must not log heartbeat failures or overdue batches');

    const saved = readStateFile(statePath);
    assert.equal(saved.snapshot.simulatedSeconds, TOTAL_ROUNDS * ROUND_SECONDS, '72 h must have elapsed');
    assert.equal(saved.wallTimeMs, INTEGRATED_START_EPOCH_MS + TOTAL_ROUNDS * ROUND_SECONDS * 1000,
      'the committed wall clock must end exactly 72 h after the local start');
    assert.deepEqual(saved.pendingActionIds, [], 'no action may stay pending at the end');
    assert.equal(saved.active, true, 'the body stays active');

    for (const event of schedule) {
      assertEventSettledOnce(gateway.getReceipt(event.id), event);
    }
    assert.equal(submitted, schedule.length, 'every scheduled action was submitted exactly once');
    const health = gateway.getHealth();
    assert.equal(health.status, 'ok', 'final health must be ok');
    assert.equal(health.pendingActions, 0, 'final pending actions must be zero');

    const parts = gateway.getState().parts;
    const muscleGlycogenG = ['muscleHead', 'muscleTrunk', 'muscleLimbs']
      .reduce((total, id) => total + parts[id].glycogenG, 0);
    return {
      rounds: TOTAL_ROUNDS,
      simulatedHours: (TOTAL_ROUNDS * ROUND_SECONDS) / 3600,
      actionsSubmitted: submitted,
      actionsSettledOnce: schedule.length,
      round2606,
      sums: {
        deliveredWaterMl: sums.deliveredWaterMl,
        emptiedCarbohydrateG: sums.emptiedCarbohydrateG,
        paidSweatMl: sums.paidSweatMl,
        voidedMl: sums.voidedMl,
        defecatedG: sums.defecatedG,
      },
      end: {
        glucoseMgDl: parts.glucose.concentrationMgDl,
        thirstMm: parts.hypothalamusThirst.thirst,
        compositeThirstMm: parts.interoception.thirst,
        bodyWaterMl: parts.bodyFluid.waterVolumeMl,
        bladderMl: parts.bladder.volumeMl,
        muscleGlycogenG,
        liverGlycogenG: parts.liver.glycogenG,
        stomachWaterMl: parts.stomach.waterVolumeMl,
        // carbohydrateG 是含固体的总量（solidCarbohydrateG 只是固相小计，不能叠加）。
        stomachCarbohydrateG: parts.stomach.carbohydrateG,
        notifications: gateway.getNotifications().length,
      },
      glucose: {
        peakMgDl: maxGlucose.value,
        peakRound: maxGlucose.round,
        minMgDl: Math.min(...glucoseSeries),
      },
      thirst: { peakMm: maxThirst.value, peakRound: maxThirst.round },
      workDir,
    };
  } finally {
    restore();
    if (gateway) await gateway.stop();
    if (!keepTemp) rmSync(workDir, { recursive: true, force: true });
  }
}

/** 72 h 回放指标与日程收支的验收带；实测数值见 runSeventyTwoHourReplay 返回值（2026-11-28 基线）。 */
export function assertSeventyTwoHourMetrics(metrics) {
  assert.equal(metrics.rounds, TOTAL_ROUNDS, 'all 4320 rounds must run');
  assert.equal(metrics.actionsSubmitted, 51, '51 scheduled actions submitted');
  assert.equal(metrics.actionsSettledOnce, 51, '51 scheduled actions settled exactly once');
  assert.deepEqual(metrics.round2606, { round: ORIGINAL_M12_ROUND, ok: true },
    'the original M12 round 2606 path must be walked cleanly');
  assertClose(metrics.sums.deliveredWaterMl, 18 * 300, 1e-6,
    '18 × 300 mL of submitted water must all reach the stomach');
  assertClose(metrics.sums.emptiedCarbohydrateG + metrics.end.stomachCarbohydrateG, 3 * (76 + 92 + 82), 0.5,
    '9 solid meals must conserve 750 g digestible carbohydrate (delivered past the stomach + gastric stock)');
  assert.ok(metrics.sums.voidedMl > 0, `urination must void real water (measured ${metrics.sums.voidedMl} mL)`);
  assert.ok(metrics.sums.defecatedG > 0, `defecation must void real stool (measured ${metrics.sums.defecatedG} g)`);
  assert.ok(metrics.sums.paidSweatMl >= 0, 'paid sweat stays non-negative');
  // 实测（5068fa2 基线、本日程）：峰值血糖 129.6 mg/dL、隔夜空腹末值约 77（肝糖原耗尽后的
  // 设计行为，非临床低血糖口径）、肌糖原 300 g 种子经餐后摄糖升至约 608 g、肝糖原 100 g 容量内
  // 走到 0。这些是工程带，不是人体标定。
  assert.ok(metrics.glucose.peakMgDl > 105, `meals must disturb glucose (peak ${metrics.glucose.peakMgDl})`);
  assert.ok(metrics.glucose.peakMgDl < 200, `glucose peaks stay physiological (peak ${metrics.glucose.peakMgDl})`);
  assert.ok(metrics.glucose.minMgDl >= 70, `glucose stays above the design floor (min ${metrics.glucose.minMgDl})`);
  assert.ok(metrics.end.glucoseMgDl >= 72 && metrics.end.glucoseMgDl <= 88,
    `overnight-fasted end glucose must sit in the measured fasting band (measured ${metrics.end.glucoseMgDl})`);
  assert.ok(metrics.end.glucoseMgDl < metrics.glucose.peakMgDl - 15,
    'post-meal glucose must fall back toward baseline after the disturbance ends');
  assert.ok(metrics.end.thirstMm <= 10, `end thirst must stay low (measured ${metrics.end.thirstMm})`);
  assert.ok(metrics.end.thirstMm < metrics.thirst.peakMm,
    'thirst must fall back after the last drinking window');
  assert.ok(metrics.end.bodyWaterMl > 27000 && metrics.end.bodyWaterMl < 34000,
    `body water stays in a physiological band (measured ${metrics.end.bodyWaterMl})`);
  assert.ok(metrics.end.muscleGlycogenG > 500 && metrics.end.muscleGlycogenG < 720,
    `regional muscle glycogen reflects meal uptake on the 300 g seed (measured ${metrics.end.muscleGlycogenG})`);
  assert.ok(metrics.end.liverGlycogenG >= 0 && metrics.end.liverGlycogenG <= 100,
    `liver glycogen stays within its finite store (measured ${metrics.end.liverGlycogenG})`);
  assert.ok(metrics.end.bladderMl < 800, `overnight bladder filling stays bounded (measured ${metrics.end.bladderMl})`);
  assert.ok(metrics.end.stomachWaterMl < 1, `all gastric water must have emptied (measured ${metrics.end.stomachWaterMl})`);
}

/* ---------------------------------------------------------------- *
 * CLI
 * ---------------------------------------------------------------- */

function summaryOf(result) {
  switch (result.name) {
    case 'pack-smoke':
      return {
        tarball: result.tarball,
        sha256: result.tarballSha256.slice(0, 16),
        organsFilesChecked: result.organsFilesChecked,
        manifests: result.manifests.map(({ label, partCount, startupScripts }) => `${label}=${partCount}+${startupScripts}`),
      };
    case 'thermal-pair':
      return {
        humanCoreC: result.human.coreC,
        lowCoreC: result.low.coreC,
        lowColdMm: result.low.coldMm,
      };
    case 'integrated-scenario':
      return {
        thirst: result.thirst,
        sweat: result.sweat,
        fat: result.fat,
        glucosePeak: result.glucosePeak,
        pause: result.pause,
      };
    case 'organ-parameter-docs':
      return { command: result.command, summary: result.summary };
    case 'nonhuman-demo-spot-check':
      return { ok: result.ok, marker: result.marker, exitCode: result.exitCode };
    case '72h-replay':
      return {
        rounds: result.metrics.rounds,
        actions: `${result.metrics.actionsSettledOnce}/51 applied once`,
        deliveredWaterMl: result.metrics.sums.deliveredWaterMl,
        emptiedCarbohydrateG: result.metrics.sums.emptiedCarbohydrateG,
        end: result.metrics.end,
        glucose: result.metrics.glucose,
        thirstPeak: result.metrics.thirst,
      };
    default:
      return {};
  }
}

async function runAll() {
  const results = [];
  let unpackedDir = null;
  const sharedPackDir = makeWorkDir('m38-pack');
  const sections = [
    ['pack-smoke', async () => {
      const result = await verifyPackagedManifests({ workDir: sharedPackDir });
      unpackedDir = result.unpackedDir;
      return result;
    }],
    ['thermal-pair', () => verifyThermalPair()],
    ['integrated-scenario', () => verifyIntegratedScenario()],
    ['organ-parameter-docs', () => verifyOrganParameterDocs({ unpackedDir })],
    ['nonhuman-demo-spot-check', () => verifyNonhumanDemoSpotCheck({ unpackedDir })],
    ['72h-replay', async () => {
      const metrics = await runSeventyTwoHourReplay();
      assertSeventyTwoHourMetrics(metrics);
      return { name: '72h-replay', ok: true, metrics };
    }],
  ];
  let prerequisiteFailed = false;
  for (const [label, run] of sections) {
    out(`\n== ${label}`);
    if ((label === 'organ-parameter-docs' || label === 'nonhuman-demo-spot-check') && prerequisiteFailed) {
      results.push({
        name: label,
        ok: false,
        skipped: true,
        error: new Error('前置 pack-smoke 未产出解包目录，本节跳过'),
      });
      out('   SKIP 前置 pack-smoke 失败，无解包目录');
      continue;
    }
    try {
      const result = await run();
      results.push(result);
      if (label === 'pack-smoke' && !result.ok) prerequisiteFailed = true;
      out(`   OK ${JSON.stringify(summaryOf(result))}`);
    } catch (error) {
      if (label === 'pack-smoke') prerequisiteFailed = true;
      results.push({ name: label, ok: false, error });
      out(`   FAIL ${error?.stack ?? error}`);
    }
  }

  out('\n== summary');
  let failed = 0;
  let skipped = 0;
  let spotCheckNotes = 0;
  for (const result of results) {
    if (result.ok) out(`  PASS ${result.name}`);
    else if (result.name === 'nonhuman-demo-spot-check') {
      spotCheckNotes += 1;
      const reason = result.error?.message ?? result.failure ?? `exit=${result.exitCode ?? 'n/a'}`;
      const tail = result.outputTail ? `\n${result.outputTail.split('\n').slice(-8).join('\n')}` : '';
      out(`  NOTE ${result.name} — ${result.marker ?? '非主线、默认不打包、未验收'}; ${reason}${tail}`);
    } else if (result.skipped) {
      skipped += 1;
      out(`  SKIP ${result.name}: ${result.error?.message ?? ''}`);
    } else {
      failed += 1;
      out(`  FAIL ${result.name}: ${result.error?.message ?? 'unknown'}`);
    }
  }
  out(`\n未测边界：无 DSH 宿主实机会话投递，无临床/人体标定；非人 demo 抽检为非主线、默认不打包、未验收${spotCheckNotes > 0 ? '，且本次未通过' : ''}。`);
  if (!keepTemp) rmSync(sharedPackDir, { recursive: true, force: true });
  out(keepTemp ? 'DSH_BODY_VERIFY_KEEP=1：临时目录已保留（见各节输出）。' : '临时产物已清理。');
  if (failed > 0) {
    out(`\nverify-integrated-body: ${failed} in-scope section(s) FAILED`);
    return 1;
  }
  out(`\nverify-integrated-body: all in-scope sections passed${spotCheckNotes > 0 ? '（非主线 demo 抽检另有记录）' : ''}`);
  return 0;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(await runAll());
}
