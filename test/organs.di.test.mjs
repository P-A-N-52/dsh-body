import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { loadParameters } from '../lib/parameters.js';
import { checkpoint } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const initialBodyWaterMl = 30000;
const normalAdhPath = './organs/human-organs/brain/hypothalamus-adh.ts';
const normalKidneyPath = './organs/human-organs/kidney/urine-production.ts';
const lungsPath = './organs/human-organs/lungs/respiratory-water-loss.ts';
const centralAdhPath = './organs/human-organs/brain/hypothalamus-adh-di-central.ts';
const centralKidneyPath = './organs/human-organs/kidney/urine-production-di-central.ts';
const nephrogenicKidneyPath = './organs/human-organs/kidney/urine-production-di-nephrogenic.ts';
const partIds = [
  'adrenal',
  'bladder',
  'blood',
  'bloodOxygen',
  'bodyFluid',
  'brainNotify',
  'colon',
  'duodenum',
  'esophagus',
  'glucose',
  'heart',
  'hypothalamusAdh',
  'hypothalamusEndocrine',
  'hypothalamusThirst',
  'interoception',
  'kidney',
  'kidneyGluconeogenesis',
  'kidneyGlucose',
  'liver',
  'lungs',
  'lungsVentilation',
  'muscleGlucose',
  'muscleHead',
  'muscleLimbs',
  'muscleTrunk',
  'pancreasEndocrine',
  'physicalActivity',
  'pineal',
  'pituitary',
  'salivaryGlands',
  'sexualResponse',
  'skin',
  'smallIntestine',
  'stomach',
  'stomachGhrelin',
  'stomachSensory',
  'thermoregulation',
  'thyroid',
];

const normalGolden = [
  [60, 1, 1, 30000, 0, 50, 0],
  [120, 1, 1, 29999, 0, 50, 1],
  [180, 1, 1, 29998, 0.002, 50, 2],
  [240, 1.0001919112069608, 0.9999666666666666, 29997, 0.004, 50.1, 3],
  [300, 1.0005574708549203, 0.999741434920453, 29996.000033333334, 0.006, 50.2, 3.9999666666666664],
  [360, 1.0010801541098788, 0.9993425848921651, 29995.000291898414, 0.007999933333332591, 50.3, 4.999708101587119],
  [420, 1.0017450022866667, 0.9987866576872466, 29994.000949313522, 0.009999416203172587, 50.39999666666663, 5.9990506864792845],
  [480, 1.0025384433797615, 0.9980886315933493, 29993.002162655834, 0.011998101372955716, 50.49997081015863, 6.997837344166531],
  [540, 1.003448163611435, 0.9972620958723727, 29992.00407402424, 0.013995674688332656, 50.599905068647786, 7.995925975759881],
  [600, 1.0044629908699707, 0.9963193794666958, 29991.006811928368, 0.015991851951519493, 50.699783734416634, 8.993188071632254],
];

function fakeExec({ sessionId = 'di-session', callId = 'call-1' } = {}) {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
}

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function writeManifest(dir, swaps = {}) {
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const manifest = {
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts.map((entry) => {
      const path = typeof entry === 'string' ? entry : entry.path;
      return relative(dir, join(root, swaps[path] ?? path));
    }),
  };
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

function makeState(dir, parts = {}) {
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  return statePath;
}

async function startBody(t, { swaps = {}, parts = {}, statePath } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-di-'));
  const manifestPath = writeManifest(dir, swaps);
  const actualStatePath = statePath ?? makeState(dir, parts);
  const gateway = startGateway({
    manifestPath,
    statePath: actualStatePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, manifestPath, statePath: actualStatePath, tools: createBodyTools(gateway) };
}

function waterTotal(parts) {
  return parts.stomach.waterVolumeMl
    + parts.smallIntestine.waterVolumeMl
    + (parts.colon?.residueWaterMl ?? 0)
    + (parts.bodyFluid.waterVolumeMl - initialBodyWaterMl)
    + parts.bladder.volumeMl;
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function waterLedgerMl(parts, cumulativeVoidedMl) {
  return waterTotal(parts) + queuedWaterMl(parts.stomach) + cumulativeVoidedMl;
}

function snapshot(parts) {
  return {
    adh: parts.hypothalamusAdh.relativeConcentration,
    request: parts.kidney.urineProductionRequestMl,
    bodyWater: parts.bodyFluid.waterVolumeMl,
    deficit: parts.bodyFluid.waterDeficit,
    thirst: parts.hypothalamusThirst.thirst,
    bladder: parts.bladder.volumeMl,
  };
}

test('the root manifest keeps the normal water chain with no DI variant loaded', () => {
  const manifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  assert.equal(manifest.scripts.length, 38);
  assert.ok(manifest.scripts.includes(normalAdhPath));
  assert.ok(manifest.scripts.includes(normalKidneyPath));
  assert.ok(manifest.scripts.includes(lungsPath));
  for (const entry of manifest.scripts) {
    assert.equal(String(entry).includes('-di-'), false, `root manifest must not load ${entry}`);
  }
});

test('the normal ADH and kidney parameter files keep their design defaults', () => {
  const adh = loadParameters(new URL('../organs/human-organs/brain/hypothalamus-adh.parameters.json', import.meta.url));
  assert.deepEqual(adh, {
    'hypothalamusAdh.timeConstantMin': 10,
    'hypothalamusAdh.deficitGain': 1,
    'hypothalamusAdh.volumeGain': 0.5,
    'hypothalamusAdh.relativeMinimum': 0,
    'hypothalamusAdh.relativeMaximum': 3,
  });
  const kidney = loadParameters(new URL('../organs/human-organs/kidney/urine-production.parameters.json', import.meta.url));
  assert.deepEqual(kidney, {
    'kidney.urine.baselineRateMlPerMin': 1,
    'kidney.urine.adhGain': 1,
    'kidney.urine.minRelativeRate': 0.25,
    'kidney.urine.maxRelativeRate': 2,
  });
});

test('the default root manifest still produces the same ten rounds point by point', async (t) => {
  silence(t);
  const { gateway } = await startBody(t);
  assert.deepEqual(Object.keys(gateway.getState().parts).sort(), partIds);

  for (let index = 0; index < normalGolden.length; index++) {
    await gateway.tick();
    const row = snapshot(gateway.getState().parts);
    const [sim, adh, request, bodyWater, deficit, thirst, bladder] = normalGolden[index];
    assert.equal(gateway.getState().simulatedSeconds, sim);
    for (const [actual, expected] of [
      [row.adh, adh],
      [row.request, request],
      [row.bodyWater, bodyWater],
      [row.deficit, deficit],
      [row.thirst, thirst],
      [row.bladder, bladder],
    ]) {
      assert.ok(Math.abs(actual - expected) < 1e-12, `round ${index + 1}: ${actual} != ${expected}`);
    }
  }
  const finalParts = gateway.getState().parts;
  assert.deepEqual(finalParts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
  assert.deepEqual(finalParts.muscleGlucose, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
  const initialRegionGlycogen = {
    muscleHead: 15,
    muscleTrunk: 135,
    muscleLimbs: 150,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(finalParts[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(finalParts.pancreasEndocrine, { insulinRelative: 1, glucagonRelative: 1 });
  assert.deepEqual(finalParts.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
});

test('a central DI manifest zeroes ADH and produces four mL per minute of urine', async (t) => {
  silence(t);
  const { gateway } = await startBody(t, {
    swaps: { [normalAdhPath]: centralAdhPath, [normalKidneyPath]: centralKidneyPath },
  });
  assert.deepEqual(gateway.getCapabilities(), {
    drink: ['esophagus', 'stomach', 'stomachGhrelin', 'salivaryGlands'],
    eat: ['esophagus', 'stomach', 'stomachGhrelin', 'salivaryGlands'],
    defecate: ['colon'],
    urinate: ['bladder'],
    exercise: ['physicalActivity'],
    sex: ['physicalActivity', 'sexualResponse'],
    orgasm: ['sexualResponse'],
  });

  for (let round = 1; round <= 5; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(parts.hypothalamusAdh.relativeConcentration, 0);
    assert.equal(parts.kidney.urineProductionRequestMl, 4);
    assert.equal(parts.bladder.volumeMl, 4 * (round - 1));
  }

  const parts = gateway.getState().parts;
  assert.equal(parts.kidney.urineProductionRequestMl * 1440, 5760);
  assert.ok(parts.kidney.urineProductionRequestMl * 1440 > 3 * 1000, 'DI-like proxy must exceed 3 L/day');
  assert.ok(parts.bodyFluid.waterDeficit > 0, 'polyuria should raise the water deficit proxy');
  assert.ok(parts.hypothalamusThirst.thirst > 50, 'polyuria should raise thirst after the round offset');
});

test('a central DI manifest keeps the water ledger over 121 rounds with a drink', async (t) => {
  silence(t);
  const { gateway } = await startBody(t, {
    swaps: { [normalAdhPath]: centralAdhPath, [normalKidneyPath]: centralKidneyPath },
  });
  assert.equal(gateway.submitAction({ id: 'di-central-drink', type: 'drink', volumeMl: 240, energyKcal: 0 }).statusCode, 202);
  await gateway.tick();

  let cumulativeVoidedMl = 0;
  let maxResidualMl = 0;
  for (let round = 2; round <= 121; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    cumulativeVoidedMl += parts.bladder.voidedMl;
    maxResidualMl = Math.max(maxResidualMl, Math.abs(waterLedgerMl(parts, cumulativeVoidedMl) - 240));
  }
  assert.ok(maxResidualMl <= 1e-6, `water ledger residual ${maxResidualMl} mL`);

  const parts = gateway.getState().parts;
  assert.equal(parts.bladder.volumeMl, 480);
  assert.equal(parts.bladder.voidedMl, 0);
  assert.equal(gateway.getState().simulatedSeconds, 121 * 60);
});

test('a nephrogenic DI manifest keeps ADH driven by body water and fixes the kidney request', async (t) => {
  silence(t);
  const { gateway } = await startBody(t, {
    swaps: { [normalKidneyPath]: nephrogenicKidneyPath },
  });

  for (let round = 1; round <= 10; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(gateway.getState().simulatedSeconds, round * 60);
    assert.ok(parts.hypothalamusAdh.relativeConcentration > 0, 'nephrogenic DI must not zero ADH');
    assert.equal(parts.kidney.urineProductionRequestMl, 4);
    assert.equal(parts.bladder.volumeMl, 4 * (round - 1));
  }

  const parts = gateway.getState().parts;
  assert.ok(parts.bodyFluid.waterDeficit > 0, 'fixed polyuria should raise the water deficit proxy');
  assert.ok(parts.hypothalamusAdh.relativeConcentration > 1, 'ADH should rise with the deficit');
  assert.ok(parts.hypothalamusThirst.thirst > 50, 'thirst should rise with the deficit');
});

test('the nephrogenic kidney requests four mL even from different ADH states', async (t) => {
  silence(t);
  const low = await startBody(t, {
    swaps: { [normalKidneyPath]: nephrogenicKidneyPath },
    parts: { hypothalamusAdh: { relativeConcentration: 0 } },
  });
  const high = await startBody(t, {
    swaps: { [normalKidneyPath]: nephrogenicKidneyPath },
    parts: { hypothalamusAdh: { relativeConcentration: 3 } },
  });

  await low.gateway.tick();
  await high.gateway.tick();
  assert.equal(low.gateway.getState().parts.kidney.urineProductionRequestMl, 4);
  assert.equal(high.gateway.getState().parts.kidney.urineProductionRequestMl, 4);
});

test('a DI manifest restarts from its own committed state without re-seeding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-di-restart-'));
  const manifestPath = writeManifest(dir, { [normalAdhPath]: centralAdhPath, [normalKidneyPath]: centralKidneyPath });
  const statePath = makeState(dir);
  const start = () => startGateway({ manifestPath, statePath, port: 0, autoTick: false, now: () => 0 });

  let gateway = start();
  await gateway.ready;
  for (let round = 0; round < 10; round++) await gateway.tick();
  const before = gateway.getState();
  assert.equal(before.simulatedSeconds, 600);
  assert.equal(before.parts.bladder.volumeMl, 36);
  await gateway.stop();

  gateway = start();
  try {
    await gateway.ready;
    const restored = gateway.getState();
    assert.equal(restored.simulatedSeconds, 600);
    assert.deepEqual(restored.parts, before.parts);

    await gateway.tick();
    assert.equal(gateway.getState().simulatedSeconds, 660);
    assert.equal(gateway.getState().parts.kidney.urineProductionRequestMl, 4);
    assert.equal(gateway.getState().parts.bladder.volumeMl, 40);
  } finally {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('body_act and body_state keep their shapes under a DI manifest', async (t) => {
  silence(t);
  const { gateway, tools } = await startBody(t, {
    swaps: { [normalAdhPath]: centralAdhPath, [normalKidneyPath]: centralKidneyPath },
  });
  assert.deepEqual(Object.keys(tools).sort(), ['body_act', 'body_state']);
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    ['drink', 'eat', 'urinate', 'defecate', 'exercise', 'sex', 'orgasm'],
  );
  assert.deepEqual(tools.body_act.output.schema.required, ['ok', 'statusCode', 'receipt']);
  assert.deepEqual(tools.body_state.output.schema.required, ['simulatedSeconds', 'parts']);

  const result = await tools.body_act.execute(
    { type: 'drink', volumeMl: 240, energyKcal: 0 },
    fakeExec(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(result.receipt.status, 'queued');

  await gateway.tick();
  await gateway.tick();

  const state = await tools.body_state.execute({ part: 'kidney' });
  assert.deepEqual(Object.keys(state).sort(), ['parts', 'simulatedSeconds']);
  assert.equal(state.parts.kidney.urineProductionRequestMl, 4);
  assert.equal(gateway.getState().parts.hypothalamusAdh.relativeConcentration, 0);
  assert.equal(gateway.getState().parts.bladder.volumeMl, 4);
});
