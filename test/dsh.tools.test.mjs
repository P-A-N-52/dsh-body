import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { buildActionPayload, createBodyTools, registerBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fakeExec({ sessionId = 'session-a', callId = 'call-1' } = {}) {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tools-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
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

test('body_act enqueues sex and orgasm and exposes both capabilities', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);

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
  const { statePath, tools } = await startBody(t);
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

test('body_state returns all parts or one part', async (t) => {
  const { gateway, tools } = await startBody(t);
  await tools.body_act.execute({ type: 'drink', volumeMl: 250 }, fakeExec());
  await gateway.tick();

  const all = await tools.body_state.execute({}, fakeExec({ callId: 'call-2' }));
  assert.equal(all.simulatedSeconds, 60);
  assert.equal(Object.keys(all.parts).length, 38);
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
    'pineal',
    'kidney',
    'bladder',
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
  assert.deepEqual(all.parts.physicalActivity, { remainingExerciseMin: 0, intensity: 0 });
  assert.deepEqual(all.parts.sexualResponse, {
    arousalMm: 0,
    phase: 'rest',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  });
  assert.equal(all.parts.interoception.sexualArousalMm, 0);
  assert.equal(all.parts.interoception.libidoMm, 0);
  assert.equal(all.parts.interoception.heatMm, 0);
  assert.equal(all.parts.interoception.coldMm, 0);
  assert.deepEqual(all.parts.heart, {
    heartRatePerMin: 70,
    strokeVolumeMl: 70,
    cardiacOutputMlMin: 4900,
  });
  assert.deepEqual(all.parts.blood, {
    bloodVolumeMl: 5000,
    cardiacOutputMlMin: 4900,
    systolicMmHg: 120 * (4900 / 5000) ** 0.5,
    diastolicMmHg: 80 * (4900 / 5000) ** 0.3,
    oxygenDeliveryMlMin: 4900 * (97 * 2) / 1000,
    maxOxygenDeliveryMlPerMin: 3666.6,
    gfrMlMin: 100,
  });
  assert.ok(
    all.parts.thermoregulation.coreTemperatureC > 37,
    'basal heat production warms the core above the setpoint in the first model round',
  );
  assert.deepEqual(all.parts.skin, { sweatRequestMl: 0, sweatVolumeMl: 0 });
  assert.deepEqual(all.parts.lungs, { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 });
  assert.deepEqual(all.parts.bloodOxygen, {
    oxygenConsumptionMlMin: 250 * (0.8 + 0.4),
    oxygenSupplyMlMin: 250 * (0.8 + 0.4),
    spo2Percent: 97,
    oxygenDeficit: 0,
  });
  assert.deepEqual(all.parts.lungsVentilation, {
    tidalVolumeMl: 500,
    respiratoryRatePerMin: 12,
    ventilationMlMin: 6000,
    alveolarO2MlMin: 900,
    alveolarO2CapacityMlMin: 9000,
  });
  assert.equal(all.parts.interoception.dyspneaMm, 0);
  assert.deepEqual(all.parts.glucose, {
    glucoseMassG: 12.69,
    concentrationMgDl: 90,
    disposedGlucoseG: 0,
    excessMassG: 0,
  });
  assert.deepEqual(all.parts.pancreasEndocrine, { insulinRelative: 1, glucagonRelative: 1 });
  assert.deepEqual(all.parts.hypothalamusEndocrine, { trhRelative: 1, crhRelative: 1 });
  assert.deepEqual(all.parts.pituitary, { tshRelative: 1, acthRelative: 1, prolactinRelative: 1 });
  assert.deepEqual(all.parts.thyroid, { thyroxineRelative: 1 });
  assert.deepEqual(all.parts.adrenal, { cortisolRelative: 1 });
  assert.equal(all.parts.interoception.stressMm, 0);
  assert.equal(all.parts.interoception.sleepinessMm, 50);
  assert.deepEqual(all.parts.liver, {
    glycogenCapacityG: 100,
    glycogenG: 80,
    storageG: 0,
    storageRequestG: 0,
    outputG: 0,
  });
  assert.deepEqual(all.parts.muscleGlucose, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(all.parts[region], {
      uptakeG: 0,
      glycogenG: 0,
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(all.parts.kidneyGlucose, { excretionRequestG: 0, excretedGlucoseG: 0 });
  assert.deepEqual(all.parts.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assert.ok(all.parts.stomach.volumeMl > 0);

  const one = await tools.body_state.execute({ part: 'stomach' }, fakeExec({ callId: 'call-3' }));
  assert.deepEqual(one, { simulatedSeconds: 60, parts: { stomach: all.parts.stomach } });

  const missing = await tools.body_state.execute({ part: 'spleen' }, fakeExec({ callId: 'call-4' }));
  assert.deepEqual(missing, { simulatedSeconds: 60, parts: { spleen: null } });
});

test('solid and liquid meals empty at different rates through the body tools', async (t) => {
  const readings = {};
  const meal = { type: 'eat', volumeMl: 300, energyKcal: 200 };

  for (const mealKind of ['solid', 'liquid']) {
    await t.test(`${mealKind} meal is recorded, then empties for 30 rounds`, async (child) => {
      const body = await startBody(child);
      const readStomach = (callId) => body.tools.body_state.execute({ part: 'stomach' }, fakeExec({ callId }));

      const queued = await body.tools.body_act.execute(
        { ...meal, mealKind },
        fakeExec({ sessionId: `session-${mealKind}`, callId: `call-${mealKind}` }),
      );
      assert.equal(queued.ok, true);
      assert.equal(queued.statusCode, 202);
      assert.equal(queued.receipt.type, 'eat');
      assert.equal(queued.receipt.status, 'queued');

      const before = await readStomach(`read-${mealKind}-queued`);
      assert.equal(before.simulatedSeconds, 0);
      assert.equal(before.parts.stomach.volumeMl, 0);

      await body.gateway.tick();
      assert.equal(body.gateway.getReceipt(queued.receipt.id).status, 'applied');
      const intake = await readStomach(`read-${mealKind}-intake`);
      assert.equal(intake.simulatedSeconds, 60);
      assert.equal(intake.parts.stomach.volumeMl, 300);
      assert.equal(intake.parts.stomach.energyKcal, 200);

      for (let round = 0; round < 30; round++) await body.gateway.tick();
      const after = await readStomach(`read-${mealKind}-after`);
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
  const readStomach = (callId) => tools.body_state.execute({ part: 'stomach' }, fakeExec({ callId }));

  const loaded = await readStomach('read-legacy-loaded');
  assert.equal(loaded.parts.stomach.volumeMl, 240);
  assert.equal(loaded.parts.stomach.energyKcal, 0);
  assert.equal(loaded.parts.stomach.solidVolumeMl, 0);
  assert.equal(loaded.parts.stomach.solidEnergyKcal, 0);
  assert.equal(loaded.parts.stomach.mealQueue.length, 1);

  await gateway.tick();
  const after = await readStomach('read-legacy-after');
  const waterRemainingMl = 240 * 2 ** (-1 / 13);
  assert.ok(Math.abs(after.parts.stomach.volumeMl - (waterRemainingMl + 100)) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.energyKcal - 50) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.solidVolumeMl - 100) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.solidEnergyKcal - 50) < 1e-9);
  assert.ok(Math.abs(after.parts.stomach.emptiedMl - (240 - waterRemainingMl)) < 1e-9);
  assert.equal(after.parts.stomach.emptiedKcal, 0);
  assert.equal(after.parts.stomach.mealQueue.length, 0);
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
  const gateway = { submitAction() {}, getState() {} };
  const tools = createBodyTools(gateway);
  assert.deepEqual(Object.keys(tools).sort(), ['body_act', 'body_state']);

  assert.deepEqual(tools.body_act.parameters.required, ['type']);
  assert.deepEqual(
    tools.body_act.parameters.properties.type.enum,
    ['drink', 'eat', 'urinate', 'defecate', 'exercise', 'sex', 'orgasm'],
  );
  assert.equal(tools.body_act.parameters.properties.intensity.type, 'number');
  assert.equal(tools.body_act.parameters.properties.durationMin.type, 'number');
  assert.match(tools.body_act.description, /exercise/);
  assert.match(tools.body_act.description, /sex/);
  assert.match(tools.body_act.description, /orgasm/);
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
  assert.deepEqual(Object.keys(registeredTools).sort(), ['body_act', 'body_state']);
  assert.deepEqual(registered.map((definition) => definition.name), ['body_act', 'body_state']);
  assert.equal(registered[0], registeredTools.body_act);
  assert.equal(registered[1], registeredTools.body_state);
  assert.equal(disposers.length, 2);
});
