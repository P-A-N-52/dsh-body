import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // Previously mocked in the same test.
    }
  }
}

async function bootCustomBody(t, { manifestPath = rootManifestPath, seed } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ext-body-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(seed));
  silence(t);
  let clock = 0;
  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => clock,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { dir, statePath, gateway, advanceClock: (ms) => { clock += ms; } };
}

test('two bodies sharing body-modules.json run independent profile weight scaling and sparse overrides', async (t) => {
  const light = await bootCustomBody(t, {
    seed: {
      ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
      profile: { weightKg: 50, heightCm: 158 },
      parameters: {
        'unknownModule.futureSetting': 42,
      },
    },
  });
  const heavy = await bootCustomBody(t, {
    seed: {
      ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
      profile: { weightKg: 100, heightCm: 185 },
      parameters: {
        'glucose.baselineConcentrationMgDl': 102,
      },
    },
  });

  // Check round 1 resting BP and 20-round resting steady state across weights.
  for (let round = 1; round <= 20; round++) {
    await light.gateway.tick();
    await heavy.gateway.tick();
    if (round === 1) {
      assert.equal(light.gateway.getState().parts.blood.systolicMmHg, 120);
      assert.equal(light.gateway.getState().parts.blood.diastolicMmHg, 80);
      assert.equal(heavy.gateway.getState().parts.blood.systolicMmHg, 120);
      assert.equal(heavy.gateway.getState().parts.blood.diastolicMmHg, 80);
    }
  }

  const lightParts = light.gateway.getState().parts;
  const heavyParts = heavy.gateway.getState().parts;

  // Different body sizes track identical scaled thermal equilibrium near 37 C and resting ~120/80 BP.
  assert.ok(
    lightParts.thermoregulation.coreTemperatureC >= 36.5
    && lightParts.thermoregulation.coreTemperatureC <= 37.5,
  );
  assert.ok(
    Math.abs(lightParts.thermoregulation.coreTemperatureC - heavyParts.thermoregulation.coreTemperatureC) < 1e-9,
  );
  assert.ok(Math.abs(lightParts.blood.systolicMmHg - 120) < 1.5);
  assert.ok(Math.abs(lightParts.blood.diastolicMmHg - 80) < 1.5);
  assert.ok(Math.abs(heavyParts.blood.systolicMmHg - 120) < 1.5);
  assert.ok(Math.abs(heavyParts.blood.diastolicMmHg - 80) < 1.5);

  // Light (50 kg) holds fasting 90 mg/dL with scaled pools; heavy (100 kg) uses its overridden 102 mg/dL baseline.
  assert.ok(Math.abs(lightParts.glucose.concentrationMgDl - 90) < 1e-6);
  assert.ok(Math.abs(lightParts.bodyFluid.waterVolumeMl - 20000) < 50);
  assert.ok(Math.abs(heavyParts.bodyFluid.waterVolumeMl - 40000) < 50);
  assert.ok(heavyParts.glucose.concentrationMgDl > 95);

  // Same 75 g glucose meal yields a noticeably higher concentration peak in the 50 kg body than 100 kg.
  const lightMealBody = await bootCustomBody(t, {
    seed: {
      ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
      profile: { weightKg: 50, heightCm: 158 },
    },
  });
  const heavyMealBody = await bootCustomBody(t, {
    seed: {
      ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} }),
      profile: { weightKg: 100, heightCm: 185 },
    },
  });
  assert.equal(
    lightMealBody.gateway.submitAction({
      id: 'carb-light',
      type: 'eat',
      volumeMl: 300,
      energyKcal: 300,
      mealKind: 'liquid',
      carbohydrateG: 75,
    }).statusCode,
    202,
  );
  assert.equal(
    heavyMealBody.gateway.submitAction({
      id: 'carb-heavy',
      type: 'eat',
      volumeMl: 300,
      energyKcal: 300,
      mealKind: 'liquid',
      carbohydrateG: 75,
    }).statusCode,
    202,
  );

  let lightPeak = 0;
  let heavyPeak = 0;
  for (let round = 1; round <= 30; round++) {
    await lightMealBody.gateway.tick();
    await heavyMealBody.gateway.tick();
    lightPeak = Math.max(lightPeak, lightMealBody.gateway.getState().parts.glucose.concentrationMgDl);
    heavyPeak = Math.max(heavyPeak, heavyMealBody.gateway.getState().parts.glucose.concentrationMgDl);
  }
  assert.ok(lightPeak > heavyPeak + 10, `expected 50kg peak (${lightPeak}) > 100kg peak (${heavyPeak}) + 10`);
  assert.ok(
    lightPeak - 90 > (heavyPeak - 90) * 1.5,
    `expected 50kg glycemic excursion (${lightPeak - 90}) > 1.5x 100kg excursion (${heavyPeak - 90})`,
  );

  // Verify sparse parameter override survives checkpoint commit & original parameter files remain untouched.
  const persistedHeavy = JSON.parse(readFileSync(heavy.statePath, 'utf8'));
  assert.deepEqual(persistedHeavy.profile, { weightKg: 100, heightCm: 185 });
  assert.deepEqual(persistedHeavy.parameters, { 'glucose.baselineConcentrationMgDl': 102 });
});

test('extensible non-human organ (wings) integrates with body_act, interoception, and feeling-only brainNotify', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-wings-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const organPath = join(dir, 'wings.ts');
  writeFileSync(organPath, `
export const id = 'wings';
export const actionTypes = ['fold_wings', 'strain_wings'];
export const initialState = { posture: 'open', strainMm: 0, discomfortMm: 0 };
export const fields = {
  posture: { unit: '1', mode: 'absolute' },
  strainMm: { unit: 'mm', mode: 'absolute' },
  discomfortMm: { unit: 'mm', mode: 'absolute' },
};

export function heartbeat(io) {
  const prev = io.read('wings') ?? initialState;
  let posture = prev.posture;
  let strainMm = prev.strainMm;
  for (const action of io.actions) {
    if (action.type === 'fold_wings') {
      posture = 'folded';
      strainMm = 20;
    } else if (action.type === 'strain_wings' && typeof action.strainMm === 'number') {
      strainMm = action.strainMm;
    }
  }
  io.write({
    posture,
    strainMm,
    discomfortMm: strainMm,
    sensations: {
      wingStrain: {
        intensityMm: strainMm,
        discomfort: true,
        contextText: '双翼有些发酸紧绷。',
        wakeText: '双翼传来强烈的疼痛牵拉感。',
      },
    },
  });
}
`);

  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const customManifestPath = join(dir, 'body-modules.wings.json');
  const scripts = rootManifest.scripts.map((entry) => relative(dir, join(root, entry)));
  const notifyIdx = scripts.findIndex((s) => s.endsWith('brain/notify.ts'));
  const interoIdx = scripts.findIndex((s) => s.endsWith('brain/interoception.ts'));
  assert.ok(interoIdx >= 0 && notifyIdx > interoIdx);
  // Insert wings before interoception & notify, matching manifest ordering rules.
  scripts.splice(interoIdx, 0, './wings.ts');
  writeFileSync(customManifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((s) => relative(dir, join(root, s))),
    scripts,
  }));

  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts: {},
  })));
  silence(t);
  const gateway = startGateway({
    manifestPath: customManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
  });
  await gateway.ready;

  const tools = createBodyTools(gateway);
  assert.ok(tools.body_act.parameters.properties.type.enum.includes('fold_wings'));
  assert.ok(tools.body_act.parameters.properties.type.enum.includes('strain_wings'));

  const unknownRejected = await tools.body_act.execute(
    { type: 'sniff' },
    { agent: { session: { id: 'session-wings' } }, callId: 'call-bad', signal: new AbortController().signal },
  );
  assert.equal(unknownRejected.ok, false);
  assert.equal(unknownRejected.statusCode, 400);

  // Establish active brainNotify session with a valid action.
  const foldResult = await tools.body_act.execute(
    { type: 'fold_wings' },
    { agent: { session: { id: 'session-wings' } }, callId: 'call-1', signal: new AbortController().signal },
  );
  assert.equal(foldResult.statusCode, 202);
  await gateway.tick();
  assert.equal(gateway.getState().parts.wings.posture, 'folded');

  // Raise wing strain to marked level (70 mm) -> triggers non-waking context notification next round.
  const strain1 = await tools.body_act.execute(
    { type: 'strain_wings', strainMm: 70 },
    { agent: { session: { id: 'session-wings' } }, callId: 'call-2', signal: new AbortController().signal },
  );
  assert.equal(strain1.statusCode, 202);
  await gateway.tick(); // Round 2: wings writes 70 mm
  await gateway.tick(); // Round 3: interoception reads wings 70 mm
  await gateway.tick(); // Round 4: brainNotify reads interoception & emits context

  const notifsAfterMarked = gateway.getNotifications();
  assert.equal(notifsAfterMarked.length, 1);
  assert.equal(notifsAfterMarked[0].mode, 'context');
  assert.equal(notifsAfterMarked[0].text, '双翼有些发酸紧绷。');
  assert.equal(/\d/.test(notifsAfterMarked[0].text), false);
  await gateway.ackNotification(notifsAfterMarked[0].id);

  // Raise wing strain to strong level (90 mm) and advance past cooldown (45 min) -> wake notification.
  const strain2 = await tools.body_act.execute(
    { type: 'strain_wings', strainMm: 90 },
    { agent: { session: { id: 'session-wings' } }, callId: 'call-3', signal: new AbortController().signal },
  );
  assert.equal(strain2.statusCode, 202);
  for (let i = 0; i < 46; i++) {
    await gateway.tick();
  }
  const notifsAfterStrong = gateway.getNotifications();
  assert.equal(notifsAfterStrong.length, 1);
  assert.equal(notifsAfterStrong[0].mode, 'wake');
  assert.equal(notifsAfterStrong[0].text, '双翼传来强烈的疼痛牵拉感。');
  assert.equal(/\d/.test(notifsAfterStrong[0].text), false);
  assert.ok(gateway.getState().parts.interoception.discomfort > 60);
});
