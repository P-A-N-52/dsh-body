import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { buildActionPayload, buildBodyFeelingsSummary, createBodyTools, registerBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fakeExec({ sessionId = 'session-a', callId = 'call-1' } = {}) {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
}

function assertNoDigits(value, label = 'result') {
  const json = JSON.stringify(value);
  assert.equal(/\d/.test(json), false, `${label} must not contain ASCII digits: ${json}`);
  assert.equal(/[\d０-９]/u.test(json), false, `${label} must not contain digits: ${json}`);
}

async function startBody(t, {
  manifestPath = join(root, 'body-modules.json'),
  parts = {},
  defaultNsfw = false,
  requireBinding = false,
  active,
  nsfw,
  boundSessionId,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tools-'));
  const statePath = join(dir, 'body-state.json');
  const seed = {
    ...checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts }),
    ...(active !== undefined ? { active } : {}),
    ...(nsfw !== undefined ? { nsfw } : {}),
    ...(boundSessionId !== undefined ? { boundSessionId } : {}),
  };
  writeFileSync(statePath, JSON.stringify(seed));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
    requireBinding,
    defaultNsfw,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, statePath, tools: createBodyTools(gateway) };
}

function actionId(sessionId, callId) {
  return `body-${createHash('sha256').update(`${sessionId}\0${callId}`).digest('hex').slice(0, 32)}`;
}

test('body_act enqueues a valid drink and returns a receipt', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const exec = fakeExec();

  const result = await tools.body_act.execute({ type: 'drink', volumeMl: 330, energyKcal: 140 }, exec);
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(result.receipt.id, actionId('session-a', 'call-1'));
  assert.equal(result.receipt.type, 'drink');
  assert.equal(result.receipt.status, 'queued');

  const queued = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(queued.pendingActionIds, [result.receipt.id]);
  assert.equal(queued.actions[result.receipt.id].action.sessionId, 'session-a');

  assert.equal(gateway.getState().parts.stomach.volumeMl, 0);
  await gateway.tick();

  const state = gateway.getState();
  assert.equal(state.simulatedSeconds, 60);
  assert.ok(state.parts.stomach.volumeMl > 0);
  assert.ok(state.parts.stomach.energyKcal > 0);
  assert.equal(gateway.getReceipt(result.receipt.id).status, 'applied');
});

test('body_act queues carbohydrateG unchanged and does not add it when omitted', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);

  const drink = await tools.body_act.execute(
    { type: 'drink', volumeMl: 330, energyKcal: 140, carbohydrateG: 42.5 },
    fakeExec({ sessionId: 'session-carb', callId: 'drink' }),
  );
  assert.equal(drink.ok, true);
  assert.equal(drink.statusCode, 202);

  const eat = await tools.body_act.execute(
    { type: 'eat', volumeMl: 250, energyKcal: 500, mealKind: 'solid', carbohydrateG: 35 },
    fakeExec({ sessionId: 'session-carb', callId: 'eat' }),
  );
  assert.equal(eat.ok, true);
  assert.equal(eat.statusCode, 202);

  const withoutCarbohydrate = await tools.body_act.execute(
    { type: 'drink', volumeMl: 200, energyKcal: 80 },
    fakeExec({ sessionId: 'session-carb', callId: 'omitted' }),
  );
  assert.equal(withoutCarbohydrate.statusCode, 202);

  const urinate = await tools.body_act.execute(
    { type: 'urinate' },
    fakeExec({ sessionId: 'session-carb', callId: 'urinate' }),
  );
  assert.equal(urinate.statusCode, 202);

  const queued = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(queued.actions[drink.receipt.id].action.carbohydrateG, 42.5);
  assert.equal(queued.actions[eat.receipt.id].action.carbohydrateG, 35);
  assert.equal(
    Object.hasOwn(queued.actions[withoutCarbohydrate.receipt.id].action, 'carbohydrateG'),
    false,
  );
  assert.ok(queued.pendingActionIds.includes(urinate.receipt.id));
});

test('body_act rejects invalid carbohydrateG without enqueuing', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const invalid = [
    [{ type: 'drink', volumeMl: 100, carbohydrateG: -1 }, 'negative drink'],
    [{ type: 'drink', volumeMl: 100, carbohydrateG: Number.NaN }, 'NaN drink'],
    [{ type: 'drink', volumeMl: 100, carbohydrateG: Number.POSITIVE_INFINITY }, 'Infinity drink'],
    [{ type: 'drink', volumeMl: 100, carbohydrateG: '30' }, 'string drink'],
    [{ type: 'eat', volumeMl: 100, energyKcal: 300, mealKind: 'solid', carbohydrateG: -1 }, 'negative eat'],
  ];

  for (const [args, label] of invalid) {
    const result = await tools.body_act.execute(args, fakeExec({ sessionId: 'session-invalid-carb', callId: label }));
    assert.equal(result.ok, false, label);
    assert.equal(result.statusCode, 400, label);
    assert.match(result.receipt.error, /carbohydrateG/, label);
  }

  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
  assert.equal(gateway.getState().parts.stomach.volumeMl, 0);
});

test('body_act enqueues defecate without a payload and exposes the colon capability', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const exec = fakeExec({ sessionId: 'session-bowel', callId: 'defecate-1' });

  const result = await tools.body_act.execute({ type: 'defecate' }, exec);
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(result.receipt.id, actionId('session-bowel', 'defecate-1'));
  assert.equal(result.receipt.type, 'defecate');
  assert.equal(result.receipt.status, 'queued');

  const queued = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(queued.pendingActionIds, [result.receipt.id]);
  assert.deepEqual(queued.actions[result.receipt.id].action, {
    type: 'defecate',
    id: result.receipt.id,
    sessionId: 'session-bowel',
  });
  assert.deepEqual(gateway.getCapabilities().defecate, ['colon']);
});

test('body_act rejects invalid fields and missing sessions before enqueue', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const invalid = [
    [{ type: 'sniff', volumeMl: 100 }, /type/],
    [{ type: 'drink' }, /volumeMl/],
    [{ type: 'drink', volumeMl: 0 }, /volumeMl/],
    [{ type: 'drink', volumeMl: Number.NaN }, /volumeMl/],
    [{ type: 'drink', volumeMl: 100, energyKcal: -1 }, /energyKcal/],
    [{ type: 'drink', volumeMl: 100, energyKcal: '140' }, /energyKcal/],
    [{ type: 'eat', volumeMl: 100, mealKind: 'solid' }, /energyKcal/],
    [{ type: 'eat', volumeMl: 100, energyKcal: 300 }, /mealKind/],
    [{ type: 'eat', volumeMl: 100, energyKcal: 300, mealKind: 'liquidy' }, /mealKind/],
    [{ type: 'drink', volumeMl: 100, durationMin: -1 }, /durationMin/],
  ];

  for (const [args, pattern] of invalid) {
    const result = await tools.body_act.execute(args, fakeExec());
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.receipt.error, pattern);
  }

  const withoutSession = await tools.body_act.execute(
    { type: 'drink', volumeMl: 100 },
    { callId: 'call-x', signal: new AbortController().signal },
  );
  assert.equal(withoutSession.ok, false);
  assert.equal(withoutSession.statusCode, 400);
  assert.match(withoutSession.receipt.error, /session/);

  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
  assert.equal(gateway.getState().parts.stomach.volumeMl, 0);
});

test('body_act enqueues a valid exercise and exposes physicalActivity capability', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const exec = fakeExec({ sessionId: 'session-exercise', callId: 'exercise-1' });

  const result = await tools.body_act.execute({ type: 'exercise', intensity: 1, durationMin: 30 }, exec);
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(result.receipt.id, actionId('session-exercise', 'exercise-1'));
  assert.equal(result.receipt.type, 'exercise');
  assert.equal(result.receipt.status, 'queued');

  const queued = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(queued.pendingActionIds, [result.receipt.id]);
  assert.deepEqual(queued.actions[result.receipt.id].action, {
    type: 'exercise',
    intensity: 1,
    durationMin: 30,
    id: result.receipt.id,
    sessionId: 'session-exercise',
  });
  assert.deepEqual(gateway.getCapabilities().exercise, ['physicalActivity']);
});

test('body_act rejects invalid exercise intensity and duration without enqueuing', async (t) => {
  const { statePath, tools } = await startBody(t);
  const invalid = [
    [{ type: 'exercise', durationMin: 30 }, /intensity/, 'missing intensity'],
    [{ type: 'exercise', intensity: 0, durationMin: 30 }, /intensity/, 'zero intensity'],
    [{ type: 'exercise', intensity: -0.5, durationMin: 30 }, /intensity/, 'negative intensity'],
    [{ type: 'exercise', intensity: 1.1, durationMin: 30 }, /intensity/, 'intensity above one'],
    [{ type: 'exercise', intensity: Number.NaN, durationMin: 30 }, /intensity/, 'NaN intensity'],
    [{ type: 'exercise', intensity: '1', durationMin: 30 }, /intensity/, 'string intensity'],
    [{ type: 'exercise', intensity: 1 }, /durationMin/, 'missing duration'],
    [{ type: 'exercise', intensity: 1, durationMin: 0 }, /durationMin/, 'zero duration'],
    [{ type: 'exercise', intensity: 1, durationMin: -1 }, /durationMin/, 'negative duration'],
    [{ type: 'exercise', intensity: 1, durationMin: Number.NaN }, /durationMin/, 'NaN duration'],
    [{ type: 'exercise', intensity: 1, durationMin: Number.POSITIVE_INFINITY }, /durationMin/, 'infinite duration'],
    [{ type: 'exercise', intensity: 1, durationMin: '30' }, /durationMin/, 'string duration'],
  ];

  for (const [args, pattern, label] of invalid) {
    const result = await tools.body_act.execute(
      args,
      fakeExec({ sessionId: 'session-invalid-exercise', callId: label }),
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.statusCode, 400, label);
    assert.match(result.receipt.error, pattern, label);
  }

  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
});

test('body_act enqueues sex and orgasm when defaultNsfw is true and exposes both capabilities', async (t) => {
  const { gateway, statePath, tools } = await startBody(t, { defaultNsfw: true });

  assert.equal(gateway.getNsfw(), true);
  assert.ok(tools.body_act.parameters.properties.type.enum.includes('sex'));
  assert.ok(tools.body_act.parameters.properties.type.enum.includes('orgasm'));

  const sexResult = await tools.body_act.execute(
    { type: 'sex', intensity: 0.8, durationMin: 30 },
    fakeExec({ sessionId: 'session-sex', callId: 'sex-1' }),
  );
  assert.equal(sexResult.ok, true);
  assert.equal(sexResult.statusCode, 202);
  assert.equal(sexResult.receipt.type, 'sex');
  assert.equal(sexResult.receipt.status, 'queued');

  const orgasmResult = await tools.body_act.execute(
    { type: 'orgasm' },
    fakeExec({ sessionId: 'session-sex', callId: 'orgasm-1' }),
  );
  assert.equal(orgasmResult.ok, true);
  assert.equal(orgasmResult.statusCode, 202);
  assert.equal(orgasmResult.receipt.type, 'orgasm');

  const queued = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(queued.actions[sexResult.receipt.id].action, {
    type: 'sex',
    intensity: 0.8,
    durationMin: 30,
    id: sexResult.receipt.id,
    sessionId: 'session-sex',
  });
  assert.deepEqual(queued.actions[orgasmResult.receipt.id].action, {
    type: 'orgasm',
    id: orgasmResult.receipt.id,
    sessionId: 'session-sex',
  });
  assert.deepEqual(gateway.getCapabilities().sex, ['physicalActivity', 'sexualResponse']);
  assert.deepEqual(gateway.getCapabilities().orgasm, ['sexualResponse']);
});

test('body_act rejects invalid sex with the exercise validation without enqueuing', async (t) => {
  const { statePath, tools } = await startBody(t, { defaultNsfw: true });
  const invalid = [
    [{ type: 'sex', durationMin: 30 }, /intensity/, 'missing intensity'],
    [{ type: 'sex', intensity: 0, durationMin: 30 }, /intensity/, 'zero intensity'],
    [{ type: 'sex', intensity: 1.5, durationMin: 30 }, /intensity/, 'intensity above one'],
    [{ type: 'sex', intensity: '1', durationMin: 30 }, /intensity/, 'string intensity'],
    [{ type: 'sex', intensity: 1 }, /durationMin/, 'missing duration'],
    [{ type: 'sex', intensity: 1, durationMin: 0 }, /durationMin/, 'zero duration'],
    [{ type: 'sex', intensity: 1, durationMin: -1 }, /durationMin/, 'negative duration'],
    [{ type: 'sex', intensity: 1, durationMin: Number.NaN }, /durationMin/, 'NaN duration'],
  ];

  for (const [args, pattern, label] of invalid) {
    const result = await tools.body_act.execute(
      args,
      fakeExec({ sessionId: 'session-invalid-sex', callId: label }),
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.statusCode, 400, label);
    assert.match(result.receipt.error, pattern, label);
  }

  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
});

test('body_act rejects sex and orgasm and omits them from schema when defaultNsfw is false', async (t) => {
  const { gateway, statePath, tools } = await startBody(t, { defaultNsfw: false });

  assert.equal(gateway.getNsfw(), false);
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    ['drink', 'eat', 'urinate', 'defecate', 'exercise', 'stop_exercise', 'sleep', 'wake_up'],
  );
  assert.equal(tools.body_act.parameters.properties.type.enum.includes('sex'), false);
  assert.equal(tools.body_act.parameters.properties.type.enum.includes('orgasm'), false);
  assert.equal(/\bsex\b|\borgasm\b/.test(tools.body_act.description), false);
  assert.equal(Object.hasOwn(gateway.getCapabilities(), 'sex'), false);
  assert.equal(Object.hasOwn(gateway.getCapabilities(), 'orgasm'), false);

  for (const [args, callId] of [
    [{ type: 'sex', intensity: 0.8, durationMin: 20 }, 'nsfw-off-sex'],
    [{ type: 'orgasm' }, 'nsfw-off-orgasm'],
  ]) {
    const result = await tools.body_act.execute(args, fakeExec({ sessionId: 'session-nsfw-off', callId }));
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.equal(result.receipt.error, 'NSFW actions are disabled for this body');
  }

  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
});

test('body_act is idempotent for the same session and callId', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const exec = fakeExec();
  const args = { type: 'drink', volumeMl: 200, energyKcal: 80 };

  const first = await tools.body_act.execute(args, exec);
  const second = await tools.body_act.execute(args, exec);
  assert.equal(first.statusCode, 202);
  assert.equal(second.statusCode, 200);
  assert.equal(second.receipt.id, first.receipt.id);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, [first.receipt.id]);

  const conflict = await tools.body_act.execute({ type: 'drink', volumeMl: 250 }, exec);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.statusCode, 409);
  assert.equal(gateway.getReceipt(first.receipt.id).type, 'drink');
});

test('gateway.getState returns all raw numeric parts while body_state returns zero-digit qualitative feelings', async (t) => {
  const { gateway, tools } = await startBody(t);
  await tools.body_act.execute({ type: 'drink', volumeMl: 250 }, fakeExec());
  await gateway.tick();

  const all = gateway.getState();
  assert.equal(all.simulatedSeconds, 60);
  assert.equal(Object.keys(all.parts).length, 43);
  for (const part of [
    'esophagus',
    'stomach',
    'stomachGhrelin',
    'stomachSensory',
    'duodenum',
    'salivaryGlands',
    'smallIntestine',
    'colon',
    'glucose',
    'liver',
    'heart',
    'blood',
    'muscleGlucose',
    'muscleHead',
    'muscleLimbs',
    'muscleTrunk',
    'pancreasEndocrine',
    'kidneyGluconeogenesis',
    'kidneyGlucose',
    'bodyFluid',
    'hypothalamusAdh',
    'hypothalamusThirst',
    'hypothalamusEndocrine',
    'pituitary',
    'thyroid',
    'adrenal',
    'parathyroid',
    'bloodCalcium',
    'pineal',
    'kidney',
    'bladder',
    'sleep',
    'interoception',
    'thermoregulation',
    'brainNotify',
    'physicalActivity',
    'sexualResponse',
    'skin',
    'lungs',
    'bloodOxygen',
    'lungsVentilation',
  ]) {
    assert.ok(Object.hasOwn(all.parts, part), `missing part ${part}`);
  }
  assert.deepEqual(all.parts.sleep, {
    sleeping: false,
    sleepPressureMm: 0.08,
    sleepDurationMin: 0,
    sleepStage: 'awake',
    sleepInertiaMm: 0,
    wakeEvent: 'none',
  });
  assert.deepEqual(all.parts.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(all.parts.sexualResponse, {
    arousalMm: 0,
    phase: 'rest',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
    afterglowMm: 0,
    lastAttemptedOrgasmAtSimMin: null,
    lastOrgasmBlockReason: 'none',
  });
  assert.equal(all.parts.interoception.sexualArousalMm, 0);
  assert.equal(all.parts.interoception.libidoMm, 0);
  assert.equal(all.parts.interoception.heatMm, 0);
  assert.equal(all.parts.interoception.coldMm, 0);
  assert.deepEqual(all.parts.heart, {
    heartRatePerMin: 70,
    strokeVolumeMl: 70,
    cardiacOutputMlMin: 4900,
    maxCardiacOutputMlMin: 16380,
  });
  assert.deepEqual(all.parts.blood, {
    bloodVolumeMl: 5000,
    cardiacOutputMlMin: 4900,
    systolicMmHg: 120,
    diastolicMmHg: 80,
    oxygenDeliveryMlMin: 4900 * (97 * 2) / 1000,
    maxOxygenDeliveryMlPerMin: 3177.72,
    gfrMlMin: 100,
  });
  const setpointC = all.parts.thermoregulation.setpointC;
  const expectedProd = 0.005 * 250 + 0.1 * Math.max(0, setpointC - 37);
  const expectedLoss = 0.104167 * 12 + Math.min(0.55, 0.5 * Math.max(0, 37 - setpointC));
  assert.ok(
    Math.abs(
      all.parts.thermoregulation.coreTemperatureC
        - (37 + (expectedProd - expectedLoss) / 60),
    ) < 1e-12,
    'basal heat production balances resting heat loss near 37 °C in the first model round',
  );
  assert.deepEqual(all.parts.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(all.parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
  assert.deepEqual(all.parts.bloodOxygen, {
    oxygenConsumptionMlMin: 250,
    oxygenSupplyMlMin: 250,
    spo2Percent: 97,
    oxygenDeficit: 0,
  });
  assert.deepEqual(all.parts.lungsVentilation, {
    tidalVolumeMl: 500,
    respiratoryRatePerMin: (250 * 1.4 / 0.058333) / 500,
    ventilationMlMin: 250 * 1.4 / 0.058333,
    alveolarO2MlMin: 250,
    alveolarO2CapacityMlMin: 60000 * (0.058333 / 1.4),
  });
  assert.equal(all.parts.interoception.dyspneaMm, 0);
  assert.deepEqual(all.parts.glucose, {
    glucoseMassG: 12.69,
    concentrationMgDl: 90,
    disposedGlucoseG: 0.12,
    excessMassG: 0,
  });
  assert.deepEqual(all.parts.pancreasEndocrine, { insulinPmolL: 60, glucagonRelative: 1 });
  assert.equal(all.parts.hypothalamusEndocrine.trhRelative, 1);
  assert.ok(Number.isFinite(all.parts.hypothalamusEndocrine.crhRelative));
  assert.equal(all.parts.pituitary.tshRelative, 1);
  assert.ok(all.parts.pituitary.acthPgMl > 0 && Number.isFinite(all.parts.pituitary.acthPgMl));
  assert.ok(all.parts.pituitary.prolactinNgMl > 0 && Number.isFinite(all.parts.pituitary.prolactinNgMl));
  assert.ok(all.parts.pituitary.oxytocinPgMl > 0 && Number.isFinite(all.parts.pituitary.oxytocinPgMl));
  assert.deepEqual(all.parts.thyroid, { thyroxineRelative: 1 });
  assert.ok(all.parts.adrenal.cortisolNmolL > 170 && all.parts.adrenal.cortisolNmolL < 190);
  assert.equal(all.parts.interoception.stressMm, 0);
  assert.ok(all.parts.interoception.sleepinessMm >= 0 && all.parts.interoception.sleepinessMm <= 25);
  assert.deepEqual(all.parts.liver, {
    glycogenCapacityG: 100,
    glycogenG: 80 - 0.096,
    storageG: 0,
    storageRequestG: 0,
    outputG: 0.096,
  });
  assert.deepEqual(all.parts.muscleGlucose, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
  const initialRegionGlycogen = {
    muscleHead: 15,
    muscleTrunk: 135,
    muscleLimbs: 150,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(all.parts[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(all.parts.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.deepEqual(all.parts.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assert.ok(all.parts.stomach.volumeMl > 0);

  const wholeBody = await tools.body_state.execute({}, fakeExec({ callId: 'call-2' }));
  assertNoDigits(wholeBody, 'body_state wholeBody');
  assert.equal(wholeBody.status, 'active');
  assert.equal(wholeBody.focus, 'all');
  assert.ok(Array.isArray(wholeBody.feelings));
  assert.equal(typeof wholeBody.summary, 'string');
  assert.equal(Object.hasOwn(wholeBody, 'simulatedSeconds'), false);
  assert.equal(Object.hasOwn(wholeBody, 'parts'), false);

  const stomachFocused = await tools.body_state.execute({ part: 'stomach' }, fakeExec({ callId: 'call-3' }));
  assertNoDigits(stomachFocused, 'body_state stomach');
  assert.equal(stomachFocused.status, 'active');
  assert.equal(stomachFocused.focus, 'stomach');
  assert.ok(Array.isArray(stomachFocused.feelings));
  assert.equal(stomachFocused.feelings.length, 1);
  assert.equal(stomachFocused.feelings[0].area, 'hunger');

  const missing = await tools.body_state.execute({ part: 'spleen' }, fakeExec({ callId: 'call-4' }));
  assertNoDigits(missing, 'body_state spleen');
  assert.deepEqual(missing, {
    status: 'active',
    focus: 'spleen',
    feelings: null,
    summary: '没有感知到这个部位或区域。',
  });
});

test('solid and liquid meals empty at different rates through the body tools', async (t) => {
  const readings = {};
  const meal = { type: 'eat', volumeMl: 300, energyKcal: 200 };

  for (const mealKind of ['solid', 'liquid']) {
    await t.test(`${mealKind} meal is recorded, then empties for 30 rounds`, async (child) => {
      const body = await startBody(child);
      const readStomach = () => body.gateway.getState();

      const queued = await body.tools.body_act.execute(
        { ...meal, mealKind },
        fakeExec({ sessionId: `session-${mealKind}`, callId: `call-${mealKind}` }),
      );
      assert.equal(queued.ok, true);
      assert.equal(queued.statusCode, 202);
      assert.equal(queued.receipt.type, 'eat');
      assert.equal(queued.receipt.status, 'queued');

      const before = readStomach();
      assert.equal(before.simulatedSeconds, 0);
      assert.equal(before.parts.stomach.volumeMl, 0);

      await body.gateway.tick();
      assert.equal(body.gateway.getReceipt(queued.receipt.id).status, 'applied');
      const intake = readStomach();
      assert.equal(intake.simulatedSeconds, 60);
      assert.equal(intake.parts.stomach.volumeMl, 300);
      assert.equal(intake.parts.stomach.energyKcal, 200);

      const feeling = await body.tools.body_state.execute(
        { focus: 'hunger' },
        fakeExec({ callId: `feeling-${mealKind}` }),
      );
      assertNoDigits(feeling, `hunger feeling (${mealKind})`);
      assert.equal(feeling.focus, 'hunger');
      assert.ok(Array.isArray(feeling.feelings));

      for (let round = 0; round < 30; round++) await body.gateway.tick();
      const after = readStomach();
      assert.equal(after.simulatedSeconds, 1860);
      readings[mealKind] = after.parts.stomach;
    });
  }

  assert.ok(
    readings.solid.volumeMl > readings.liquid.volumeMl,
    `solid volume ${readings.solid.volumeMl} should exceed liquid ${readings.liquid.volumeMl}`,
  );
  assert.ok(
    readings.solid.energyKcal > readings.liquid.energyKcal,
    `solid energy ${readings.solid.energyKcal} should exceed liquid ${readings.liquid.energyKcal}`,
  );

  const liquidNoFeedbackMl = 300 * 2 ** (-30 / (13 + 53.75 * (200 / 300)));
  assert.ok(
    readings.liquid.volumeMl > liquidNoFeedbackMl,
    `liquid volume ${readings.liquid.volumeMl} should be slowed by duodenum feedback (${liquidNoFeedbackMl})`,
  );
  assert.ok(readings.liquid.volumeMl < 300);
  assert.ok(
    Math.abs(readings.liquid.energyKcal - readings.liquid.volumeMl * (200 / 300)) < 1e-9,
    'non-solid emptying should keep the meal energy density',
  );
});

test('a legacy checkpoint keeps its water and delivers a queued solid slice once', async (t) => {
  const legacyStomach = {
    volumeMl: 240,
    energyKcal: 0,
    emptiedMl: 0,
    emptiedKcal: 0,
    lastIntakeAt: null,
    mealQueue: [{
      remainingMl: 100,
      remainingKcal: 50,
      rateMlPerRound: 100,
      rateKcalPerRound: 50,
      remainingRounds: 1,
      mealKind: 'solid',
    }],
  };
  const { gateway, tools } = await startBody(t, { parts: { stomach: legacyStomach } });
  const readStomach = () => gateway.getState();

  const loaded = readStomach();
  assert.equal(loaded.parts.stomach.volumeMl, 240);
  assert.equal(loaded.parts.stomach.energyKcal, 0);
  assert.equal(loaded.parts.stomach.solidVolumeMl, 0);
  assert.equal(loaded.parts.stomach.solidEnergyKcal, 0);
  assert.equal(loaded.parts.stomach.mealQueue.length, 1);

  await gateway.tick();
  const after = readStomach();
  const waterRemainingMl = 240 * 2 ** (-1 / 13);
  assert.ok(Math.abs(after.parts.stomach.volumeMl - (waterRemainingMl + 100)) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.energyKcal - 50) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.solidVolumeMl - 100) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.solidEnergyKcal - 50) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.emptiedMl - (240 - waterRemainingMl)) < 1e-9);
  assert.equal(after.parts.stomach.emptiedKcal, 0);
  assert.equal(after.parts.stomach.mealQueue.length, 0);

  const feeling = await tools.body_state.execute({}, fakeExec({ callId: 'legacy-feeling' }));
  assertNoDigits(feeling, 'legacy body_state');
});

test('body_state returns strictly zero-digit qualitative feelings, honors focus/part, and masks NSFW when disabled', async (t) => {
  const parts = {
    sleep: { sleeping: false, sleepPressureMm: 75, sleepDurationMin: 0 },
    physicalActivity: { remainingExerciseMin: 15, intensity: 0.8 },
    interoception: {
      hunger: 88,
      thirst: 70,
      sleepinessMm: 90,
      sexualArousalMm: 92,
      libidoMm: 88,
      sensations: {
        'customOrgan.ache': {
          intensityMm: 72,
          contextText: '左肋隐隐发酸 123',
          wakeText: '左肋剧烈抽痛',
        },
        'customOrgan.secret': {
          intensityMm: 95,
          nsfw: true,
          wakeText: '敏感部位燥热悸动 99',
        },
      },
    },
    thermoregulation: { coreTemperatureC: 38.9 },
    heart: { heartRatePerMin: 145 },
    blood: { systolicMmHg: 74 },
    sexualResponse: { phase: 'plateau', arousalMm: 92 },
    mammaryGlands: { fullnessMm: 86 },
  };

  const { tools: safeTools } = await startBody(t, { parts, defaultNsfw: false });
  const safeAll = await safeTools.body_state.execute({}, fakeExec({ callId: 'safe-all' }));
  assertNoDigits(safeAll, 'safeAll');
  assert.equal(safeAll.status, 'active');
  assert.equal(safeAll.focus, 'all');
  assert.equal(safeAll.feelings.some((f) => f.area === 'sexual' || f.area === 'mammary'), false);
  assert.equal(safeAll.feelings.some((f) => f.area === 'customOrgan' && f.feeling.includes('123')), false);
  assert.equal(safeAll.feelings.some((f) => f.feeling.includes('敏感部位')), false);

  for (const [key, expectedArea] of [
    [{ focus: 'all' }, 'all'],
    [{ focus: 'hunger' }, 'hunger'],
    [{ part: 'sleep' }, 'sleep'],
    [{ focus: 'temperature' }, 'temperature'],
    [{ focus: 'circulation' }, 'circulation'],
  ]) {
    const focused = await safeTools.body_state.execute(key, fakeExec({ callId: `focus-${expectedArea}` }));
    assertNoDigits(focused, `focused ${expectedArea}`);
    assert.ok(Array.isArray(focused.feelings) && focused.feelings.length >= 1, expectedArea);
    if (expectedArea !== 'all') {
      assert.ok(focused.feelings.every((f) => f.area === expectedArea), expectedArea);
    }
  }

  for (const nsfwFocus of ['nsfw', 'sex', 'sexualResponse', 'arousal', 'libido', 'mammaryGlands', 'testes', 'epididymis', 'lactation']) {
    const masked = await safeTools.body_state.execute({ focus: nsfwFocus }, fakeExec({ callId: `mask-${nsfwFocus}` }));
    assertNoDigits(masked, `masked ${nsfwFocus}`);
    assert.deepEqual(masked, {
      status: 'active',
      focus: nsfwFocus,
      feelings: null,
      summary: '该感知功能当前未开启。',
    });
  }

  const { tools: nsfwTools } = await startBody(t, { parts, defaultNsfw: true });
  const nsfwAll = await nsfwTools.body_state.execute({}, fakeExec({ callId: 'nsfw-all' }));
  assertNoDigits(nsfwAll, 'nsfwAll');
  assert.ok(nsfwAll.feelings.some((f) => f.area === 'sexual'));
  assert.ok(nsfwAll.feelings.some((f) => f.area === 'mammary'));
  assert.ok(nsfwAll.feelings.some((f) => f.area === 'customOrgan'));

  const nsfwFocused = await nsfwTools.body_state.execute({ focus: 'nsfw' }, fakeExec({ callId: 'nsfw-only' }));
  assertNoDigits(nsfwFocused, 'nsfwFocused');
  assert.ok(nsfwFocused.feelings.some((f) => f.area === 'sexual'));
  assert.ok(nsfwFocused.feelings.some((f) => f.area === 'mammary'));
});

test('body_state reports dormant and paused states cleanly and never leaks numbers via buildBodyFeelingsSummary', async (t) => {
  const { tools: dormantTools } = await startBody(t, { requireBinding: true, defaultNsfw: false });
  const dormantResult = await dormantTools.body_state.execute({ focus: 'hunger' }, fakeExec({ callId: 'dormant-1' }));
  assertNoDigits(dormantResult, 'dormant body_state');
  assert.equal(dormantResult.status, 'dormant');
  assert.equal(dormantResult.focus, 'hunger');
  assert.deepEqual(dormantResult.feelings, []);
  assert.match(dormantResult.summary, /未绑定/);
  assert.equal(dormantResult.summary.includes('body_bind'), false);

  const dormantNsfw = await dormantTools.body_state.execute({ focus: 'sexualResponse' }, fakeExec({ callId: 'dormant-nsfw' }));
  assertNoDigits(dormantNsfw, 'dormant nsfw body_state');
  assert.equal(dormantNsfw.status, 'dormant');
  assert.equal(dormantNsfw.focus, 'redacted');
  assert.deepEqual(dormantNsfw.feelings, []);

  const { tools: pausedTools } = await startBody(t, { active: false, defaultNsfw: false });
  const pausedResult = await pausedTools.body_state.execute({}, fakeExec({ callId: 'paused-1' }));
  assertNoDigits(pausedResult, 'paused body_state');
  assert.equal(pausedResult.status, 'paused');
  assert.deepEqual(pausedResult.feelings, []);
  assert.match(pausedResult.summary, /暂停/);

  const sleepingSummary = buildBodyFeelingsSummary(
    {
      simulatedSeconds: 3600,
      parts: {
        sleep: { sleeping: true, sleepPressureMm: 45 },
        glucose: { concentrationMgDl: 50 },
      },
    },
    { focus: 'all', nsfw: false },
  );
  assertNoDigits(sleepingSummary, 'sleepingSummary');
  assert.equal(sleepingSummary.status, 'sleeping');
  assert.ok(sleepingSummary.feelings.some((f) => f.area === 'metabolism' && f.level === 'urgent'));
});

test('body_bind binds, unbinds, reports status, and gates dormant body_act with 409', async (t) => {
  const { gateway, tools } = await startBody(t, { requireBinding: true });

  const initialStatus = await tools.body_bind.execute({ action: 'status' }, fakeExec());
  assert.equal(initialStatus.ok, true);
  assert.equal(initialStatus.bound, false);
  assert.equal(initialStatus.dormant, true);
  assert.equal(initialStatus.boundSessionId, null);

  const dormantAct = await tools.body_act.execute({ type: 'drink', volumeMl: 200 }, fakeExec());
  assert.equal(dormantAct.ok, false);
  assert.equal(dormantAct.statusCode, 409);
  assert.equal(dormantAct.receipt.dormant, true);
  assert.equal(dormantAct.receipt.hint, undefined);

  const bound = await tools.body_bind.execute({}, fakeExec({ sessionId: 'session-bind' }));
  assert.equal(bound.ok, true);
  assert.equal(bound.bound, true);
  assert.equal(bound.dormant, false);
  assert.equal(bound.active, true);
  assert.equal(bound.boundSessionId, 'session-bind');
  assertNoDigits(bound.feeling, 'body_bind feeling');
  assert.equal(gateway.isDormant(), false);

  // Other sessions cannot inspect, unbind, hijack, act on, or sense a bound body.
  const otherState = await tools.body_state.execute({ focus: 'sexualResponse' }, fakeExec({ sessionId: 'session-other' }));
  assert.equal(otherState.status, 'dormant');
  assert.equal(otherState.focus, 'redacted');
  assert.deepEqual(otherState.feelings, []);

  const otherStatus = await tools.body_bind.execute({ action: 'status' }, fakeExec({ sessionId: 'session-other' }));
  assert.equal(otherStatus.ok, false);
  assert.equal(otherStatus.bound, false);
  assert.equal(otherStatus.boundSessionId, null);

  const otherHijack = await tools.body_bind.execute({ action: 'bind' }, fakeExec({ sessionId: 'session-other' }));
  assert.equal(otherHijack.ok, false);
  assert.equal(otherHijack.boundSessionId, null);
  assert.equal(otherHijack.feeling, undefined);

  const otherSpoof = await tools.body_bind.execute(
    { action: 'unbind', sessionId: 'session-bind' },
    fakeExec({ sessionId: 'session-other' }),
  );
  assert.equal(otherSpoof.ok, false);
  assert.equal(otherSpoof.boundSessionId, null);

  const otherUnbind = await tools.body_bind.execute({ action: 'unbind' }, fakeExec({ sessionId: 'session-other' }));
  assert.equal(otherUnbind.ok, false);
  assert.equal(gateway.getBoundSessionId(), 'session-bind');

  const otherAct = await tools.body_act.execute(
    { type: 'drink', volumeMl: 200, sessionId: 'session-bind' },
    fakeExec({ sessionId: 'session-other', callId: 'spoof-act' }),
  );
  assert.equal(otherAct.ok, false);
  assert.equal(otherAct.statusCode, 403);

  const noExecState = await tools.body_state.execute({});
  assert.equal(noExecState.status, 'dormant');
  assert.deepEqual(noExecState.feelings, []);

  const actAfterBind = await tools.body_act.execute(
    { type: 'sleep' },
    fakeExec({ sessionId: 'session-bind', callId: 'sleep-1' }),
  );
  assert.equal(actAfterBind.ok, true);
  assert.equal(actAfterBind.statusCode, 202);

  const unbound = await tools.body_bind.execute({ action: 'unbind' }, fakeExec({ sessionId: 'session-bind' }));
  assert.equal(unbound.ok, true);
  assert.equal(unbound.bound, false);
  assert.equal(unbound.dormant, true);
  assert.equal(unbound.boundSessionId, null);
  assert.equal(gateway.isDormant(), true);

  const invalidAction = await tools.body_bind.execute({ action: 'reset' }, fakeExec());
  assert.equal(invalidAction.ok, false);
  assert.match(invalidAction.error, /bind.*unbind.*status/);
});

test('buildActionPayload overrides id and sessionId', () => {
  const payload = buildActionPayload(
    { id: 'client-id', sessionId: 'client-session', type: 'drink', volumeMl: 200 },
    { sessionId: 'session-a', callId: 'call-1' },
  );
  assert.equal(payload.id, actionId('session-a', 'call-1'));
  assert.equal(payload.sessionId, 'session-a');
  assert.equal(payload.type, 'drink');
  assert.equal(payload.volumeMl, 200);
  assert.equal(
    payload.id,
    buildActionPayload({}, { sessionId: 'session-a', callId: 'call-1' }).id,
  );
  assert.notEqual(
    payload.id,
    buildActionPayload({}, { sessionId: 'session-a', callId: 'call-2' }).id,
  );
});

test('tool definitions expose JSON Schema and register through ctx.effect', () => {
  let nsfwFlag = false;
  const gateway = {
    submitAction() {},
    getState() {},
    getNsfw: () => nsfwFlag,
    isDormant: () => false,
    bindSession: async () => ({}),
    unbindSession: async () => ({}),
  };
  const tools = createBodyTools(gateway);
  assert.deepEqual(Object.keys(tools).sort(), ['body_act', 'body_bind', 'body_state']);

  assert.deepEqual(tools.body_act.parameters.required, ['type']);
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    ['drink', 'eat', 'urinate', 'defecate', 'exercise', 'stop_exercise', 'sleep', 'wake_up'],
  );
  assert.equal(tools.body_act.parameters.properties.intensity.type, 'number');
  assert.equal(tools.body_act.parameters.properties.durationMin.type, 'number');
  assert.match(tools.body_act.description, /exercise/);
  assert.match(tools.body_act.description, /stop_exercise/);
  assert.match(tools.body_act.description, /sleep/);
  assert.match(tools.body_act.description, /wake_up/);
  assert.equal(/\bsex\b|\borgasm\b/.test(tools.body_act.description), false);

  nsfwFlag = true;
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    [
      'drink', 'eat', 'urinate', 'defecate', 'exercise', 'stop_exercise', 'sleep', 'wake_up',
      'sex', 'orgasm', 'express_milk', 'breastfeed',
    ],
  );
  assert.match(tools.body_act.description, /sex/);
  assert.match(tools.body_act.description, /orgasm/);
  assert.match(tools.body_act.description, /express_milk/);
  assert.match(tools.body_act.description, /breastfeed/);
  assert.match(tools.body_act.parameters.properties.intensity.description, /sex/);
  assert.match(tools.body_act.parameters.properties.durationMin.description, /sex/);
  nsfwFlag = false;

  const carbohydrateG = tools.body_act.parameters.properties.carbohydrateG;
  assert.ok(carbohydrateG, 'body_act schema must expose carbohydrateG');
  assert.equal(carbohydrateG.type, 'number');
  assert.match(carbohydrateG.description, /gram|克/i);
  assert.match(carbohydrateG.description, /digestible|可消化/i);
  assert.match(carbohydrateG.description, /glucose|葡萄糖/i);
  assert.match(tools.body_act.description, /urinate/);
  assert.match(tools.body_act.description, /defecate/);
  assert.equal(tools.body_act.parameters.additionalProperties, true);
  assert.deepEqual(tools.body_act.output.schema.required, ['ok', 'statusCode', 'receipt']);
  assert.equal(tools.body_act.output.schema.additionalProperties, false);
  assert.equal(tools.body_state.parameters.additionalProperties, false);
  assert.deepEqual(tools.body_state.output.schema.required, ['status', 'focus', 'feelings', 'summary']);
  assert.deepEqual(tools.body_bind.parameters.properties.action.enum, ['bind', 'unbind', 'status']);
  assert.deepEqual(
    tools.body_bind.output.schema.required,
    ['ok', 'bound', 'dormant', 'active', 'nsfw', 'boundSessionId'],
  );
  assert.deepEqual(
    tools.body_act.output.render(null, { ok: true, statusCode: 202, receipt: {} }),
    [{ type: 'text', text: JSON.stringify({ ok: true, statusCode: 202, receipt: {} }, null, 2) }],
  );

  const registered = [];
  const disposers = [];
  const ctx = {
    effect(callback) {
      disposers.push(callback());
    },
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
  };
  const registeredTools = registerBodyTools(ctx, gateway);
  assert.deepEqual(Object.keys(registeredTools).sort(), ['body_act', 'body_bind', 'body_state']);
  assert.deepEqual(registered.map((definition) => definition.name), ['body_act', 'body_state', 'body_bind']);
  assert.equal(registered[0], registeredTools.body_act);
  assert.equal(registered[1], registeredTools.body_state);
  assert.equal(registered[2], registeredTools.body_bind);
  assert.equal(disposers.length, 3);
});

test('body_state ignores prototype property names and unknown areas cleanly', async (t) => {
  const { tools } = await startBody(t);

  for (const part of ['toString', 'constructor', 'prototype', '__proto__', 'spleen']) {
    const result = await tools.body_state.execute({ part }, fakeExec({ callId: `proto-${part}` }));
    assertNoDigits(result, `proto ${part}`);
    assert.equal(result.status, 'active');
    assert.equal(result.focus, part);
    assert.equal(result.feelings, null);
    assert.equal(result.summary, '没有感知到这个部位或区域。');
  }
});

test('body_act dynamically exposes extra capability actionTypes while keeping built-in validation strict', async () => {
  const submitted = [];
  let nsfw = false;
  const fakeGateway = {
    getNsfw: () => nsfw,
    isDormant: () => false,
    getCapabilities() {
      return {
        drink: ['stomach'],
        fold_wings: ['wings'],
        wag_tail: ['tail'],
      };
    },
    submitAction(payload) {
      submitted.push(payload);
      return { statusCode: 202, body: { ...payload, status: 'queued' } };
    },
    getState() {
      return { simulatedSeconds: 0, parts: {} };
    },
  };
  const tools = createBodyTools(fakeGateway);
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    [
      'drink', 'eat', 'urinate', 'defecate', 'exercise', 'stop_exercise', 'sleep', 'wake_up',
      'fold_wings', 'wag_tail',
    ],
  );

  nsfw = true;
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    [
      'drink', 'eat', 'urinate', 'defecate', 'exercise', 'stop_exercise', 'sleep', 'wake_up',
      'sex', 'orgasm', 'express_milk', 'breastfeed',
      'fold_wings', 'wag_tail',
    ],
  );
  nsfw = false;

  const customOk = await tools.body_act.execute(
    { type: 'fold_wings', angleDeg: 15 },
    fakeExec({ sessionId: 'session-ext', callId: 'wings-1' }),
  );
  assert.equal(customOk.ok, true);
  assert.equal(customOk.statusCode, 202);
  assert.equal(submitted[0].type, 'fold_wings');
  assert.equal(submitted[0].angleDeg, 15);

  const unknownRejected = await tools.body_act.execute(
    { type: 'sniff' },
    fakeExec({ sessionId: 'session-ext', callId: 'bad-1' }),
  );
  assert.equal(unknownRejected.ok, false);
  assert.equal(unknownRejected.statusCode, 400);
  assert.match(unknownRejected.receipt.error, /type/);

  const badDrinkRejected = await tools.body_act.execute(
    { type: 'drink', volumeMl: 0 },
    fakeExec({ sessionId: 'session-ext', callId: 'bad-drink' }),
  );
  assert.equal(badDrinkRejected.ok, false);
  assert.equal(badDrinkRejected.statusCode, 400);
});

test('body_act gates express_milk and breastfeed by nsfw and validates payloads cleanly', async (t) => {
  const gated = await startBody(t, {
    manifestPath: join(root, 'body-modules.female.json'),
    defaultNsfw: false,
  });
  assert.equal(gated.tools.body_act.parameters.properties.type.enum.includes('express_milk'), false);
  assert.equal(gated.tools.body_act.parameters.properties.type.enum.includes('breastfeed'), false);

  const blocked = await gated.tools.body_act.execute(
    { type: 'express_milk' },
    fakeExec({ sessionId: 'lact-off', callId: 'c1' }),
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.statusCode, 400);

  const enabled = await startBody(t, {
    manifestPath: join(root, 'body-modules.female.json'),
    defaultNsfw: true,
    parts: {
      mammaryGlands: {
        lactating: true,
        galactorrhea: false,
        inductionProgress: 1,
        storedMilkMl: 80,
        ejectedMilkMl: 0,
        stimulationMin: 0,
        milkRequestMl: 0,
        milkMl: 0,
        lactoseRequestG: 0,
        lactoseG: 0,
        fullnessMm: 22,
      },
      pituitary: { tshRelative: 1, acthPgMl: 12, prolactinNgMl: 60, oxytocinPgMl: 12 },
    },
  });
  assert.equal(enabled.tools.body_act.parameters.properties.type.enum.includes('express_milk'), true);
  assert.equal(enabled.tools.body_act.parameters.properties.type.enum.includes('breastfeed'), true);

  const zeroArg = await enabled.tools.body_act.execute(
    { type: 'express_milk' },
    fakeExec({ sessionId: 'lact-on', callId: 'c2' }),
  );
  assert.equal(zeroArg.ok, true);
  assert.equal(zeroArg.statusCode, 202);
  assert.equal(zeroArg.receipt.type, 'express_milk');
  assert.equal(Object.hasOwn(zeroArg.receipt, 'tasteFeedback'), false);

  const withFields = await enabled.tools.body_act.execute(
    { type: 'breastfeed', durationMin: 8, bilateral: true },
    fakeExec({ sessionId: 'lact-on', callId: 'c3' }),
  );
  assert.equal(withFields.ok, true);
  assert.equal(withFields.statusCode, 202);

  const invalidDuration = await enabled.tools.body_act.execute(
    { type: 'breastfeed', durationMin: 0 },
    fakeExec({ sessionId: 'lact-on', callId: 'c4' }),
  );
  assert.equal(invalidDuration.ok, false);
  assert.equal(invalidDuration.statusCode, 400);

  const invalidBilateral = await enabled.tools.body_act.execute(
    { type: 'express_milk', bilateral: 'yes' },
    fakeExec({ sessionId: 'lact-on', callId: 'c5' }),
  );
  assert.equal(invalidBilateral.ok, false);
  assert.equal(invalidBilateral.statusCode, 400);

  await enabled.gateway.tick();
  assert.ok(enabled.gateway.getState().parts.mammaryGlands.ejectedMilkMl > 0);
});

test('body_state emits zero-digit qualitative feedback across newly exposed reproductive, secretory, cardiorespiratory and reward cues', async (t) => {
  const female = await startBody(t, {
    manifestPath: join(root, 'body-modules.female.json'),
    defaultNsfw: true,
    parts: {
      salivaryGlands: { salivaRateMlPerMin: 1.5, mealStimulusMin: 3, mouthMoistureMm: 90 },
      bladder: { volumeMl: 0, voidedMl: 200, voluntaryVoidedMl: 200, involuntaryVoidedMl: 0 },
      colon: { residueWaterMl: 0, stoolG: 0, defecatedG: 80, reclaimedWaterMl: 0, bowelUrgencyMm: 0 },
      lungsVentilation: {
        tidalVolumeMl: 700,
        respiratoryRatePerMin: 30,
        ventilationMlMin: 30000,
        alveolarO2MlMin: 350,
        alveolarO2CapacityMlMin: 500,
      },
      heart: { heartRatePerMin: 112, strokeVolumeMl: 70, cardiacOutputMlMin: 7840 },
      physicalActivity: { remainingExerciseMin: 0, intensity: 0 },
      ovaries: {
        cycleDay: 14,
        cycleLengthDays: 29.3,
        phase: 'ovulatory',
        estradiolPmolL: 850,
        progesteroneNmolL: 1.5,
        lhIuL: 35,
        fshIuL: 12,
        cycleSuppression: 0,
      },
      uterus: {
        endometriumRelative: 0.6,
        crampMm: 10,
        bleedingRequestMl: 1,
        bleedingMl: 2.5,
        contractionMm: 55,
        pelvicCongestionMm: 60,
      },
      sexualResponse: {
        arousalMm: 45,
        phase: 'resolution',
        remainingSexMin: 0,
        sexIntensity: 0,
        lastOrgasmAtSimMin: 2,
        afterglowMm: 60,
      },
      mammaryGlands: {
        lactating: true,
        galactorrhea: false,
        inductionProgress: 1,
        storedMilkMl: 40,
        ejectedMilkMl: 12,
        stimulationMin: 0,
        milkRequestMl: 0,
        milkMl: 0,
        lactoseRequestG: 0,
        lactoseG: 0,
        fullnessMm: 20,
      },
      interoception: {
        hunger: 50,
        fullness: 0,
        thirst: 50,
        urinaryUrgency: 0,
        discomfort: 0,
        sexualArousalMm: 0,
        dyspneaMm: 0,
        stressMm: 10,
        sleepinessMm: 0,
        dryMouthMm: 0,
        libidoMm: 55,
        bowelUrgencyMm: 0,
        heatMm: 0,
        coldMm: 0,
        hypocalcemiaMm: 0,
        hypercalcemiaMm: 0,
        hypoglycemiaMm: 0,
        palpitationMm: 0,
        sweatDampMm: 0,
        muscleFatigueMm: 0,
        uterineCrampMm: 10,
        mammaryFullnessMm: 20,
        hedonicCalmMm: 78,
      },
    },
  });

  const femaleState = await female.tools.body_state.execute({}, fakeExec({ callId: 'female-all' }));
  assertNoDigits(femaleState, 'female new feedbacks');
  assert.ok(femaleState.feelings.some((f) => f.area === 'thirst' && f.feeling.includes('唾液')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'urinary' && f.feeling.includes('排尿')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'bowel' && f.feeling.includes('排便')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'respiration' && f.feeling.includes('喘气')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'circulation' && f.feeling.includes('心跳偏快')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'stress' && f.feeling.includes('舒畅')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'reproductive' && f.feeling.includes('经血')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'reproductive' && f.feeling.includes('排卵')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'reproductive' && f.feeling.includes('收缩')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'reproductive' && f.feeling.includes('充盈')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'sexual' && f.feeling.includes('余韵尚存')));
  assert.ok(femaleState.feelings.some((f) => f.area === 'mammary' && f.feeling.includes('排乳')));

  const male = await startBody(t, {
    manifestPath: join(root, 'body-modules.male.json'),
    defaultNsfw: true,
    parts: {
      epididymis: { storedSemenMl: 0, ejaculatedMl: 2.8 },
      interoception: { libidoMm: 52 },
      mammaryGlands: undefined,
    },
  });
  const maleSexState = await male.tools.body_state.execute(
    { focus: 'reproductive' },
    fakeExec({ callId: 'male-repro' }),
  );
  assertNoDigits(maleSexState, 'male ejaculation + libido');
  assert.ok(maleSexState.feelings.some((f) => f.area === 'sexual' && f.feeling.includes('射精')));
  assert.ok(maleSexState.feelings.some((f) => f.area === 'sexual' && f.feeling.includes('渴望')));

  const maskedMale = await startBody(t, {
    manifestPath: join(root, 'body-modules.male.json'),
    defaultNsfw: false,
    parts: {
      epididymis: { storedSemenMl: 0, ejaculatedMl: 2.8 },
      interoception: { libidoMm: 52 },
    },
  });
  const maskedState = await maskedMale.tools.body_state.execute({}, fakeExec({ callId: 'male-masked' }));
  assertNoDigits(maskedState, 'masked male');
  assert.equal(maskedState.feelings.some((f) => f.area === 'sexual' || f.area === 'mammary'), false);
});

test('body_state surfaces discomfort focus, wakeEvent, reward wanting/satiety, and pending milk letdown without digits', async (t) => {
  const { tools } = await startBody(t, {
    manifestPath: join(root, 'body-modules.female.json'),
    defaultNsfw: true,
    parts: {
      sleep: {
        sleeping: false,
        sleepPressureMm: 10,
        sleepDurationMin: 0,
        sleepStage: 'awake',
        sleepInertiaMm: 25,
        wakeEvent: 'important',
      },
      reward: { wantingMm: 78, hedonicMm: 20, satietyMm: 72 },
      mammaryGlands: {
        lactating: true,
        pendingEjections: [{ durationMin: 15, mode: 'express' }],
        ejectedMilkMl: 0,
        fullnessMm: 30,
      },
      interoception: {
        hunger: 70,
        fullness: 92,
        discomfort: 75,
        stressMm: 0,
        hedonicCalmMm: 10,
      },
    },
  });

  const all = await tools.body_state.execute({}, fakeExec({ callId: 'polish-all' }));
  assertNoDigits(all, 'polish-all');
  assert.ok(all.feelings.some((f) => f.area === 'sleep' && f.feeling.includes('唤醒')));
  assert.ok(all.feelings.some((f) => f.area === 'hunger' && f.feeling.includes('渴求')));
  assert.ok(all.feelings.some((f) => f.area === 'stress' && f.feeling.includes('饱足')));
  assert.ok(all.feelings.some((f) => f.area === 'mammary' && f.feeling.includes('排乳前兆')));

  const discomfortFocus = await tools.body_state.execute({ focus: 'discomfort' }, fakeExec({ callId: 'polish-discomfort' }));
  assertNoDigits(discomfortFocus, 'polish-discomfort');
  assert.equal(discomfortFocus.focus, 'discomfort');
  assert.ok(discomfortFocus.feelings.length >= 1);

  const esophagusSteady = await tools.body_state.execute({ focus: 'esophagus' }, fakeExec({ callId: 'polish-esophagus' }));
  assertNoDigits(esophagusSteady, 'polish-esophagus');
  assert.equal(esophagusSteady.focus, 'esophagus');

  const calcUrgent = await startBody(t, {
    parts: {
      interoception: { hypocalcemiaMm: 90, hypercalcemiaMm: 90 },
    },
  });
  const metabolism = await calcUrgent.tools.body_state.execute({ focus: 'metabolism' }, fakeExec({ callId: 'calc-urgent' }));
  assertNoDigits(metabolism, 'calc-urgent');
  assert.ok(metabolism.feelings.some((f) => f.area === 'metabolism' && f.level === 'urgent' && f.feeling.includes('麻木')));
  assert.ok(metabolism.feelings.some((f) => f.area === 'metabolism' && f.level === 'urgent' && f.feeling.includes('混浊')));
});
