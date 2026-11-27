import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_ROOT = join(root, 'body-modules.json');
const MANIFEST_FEMALE = join(root, 'body-modules.female.json');
const MANIFEST_MALE = join(root, 'body-modules.male.json');

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function fakeExec(sessionId = 'cal-session', callId = 'call-1') {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
}

async function startCalibratedBody(t, {
  manifestPath = MANIFEST_ROOT,
  wallTimeMs = Date.UTC(2026, 0, 1, 14, 0, 0),
  simulatedSeconds = 0,
  profile = { weightKg: 75, heightCm: 170, timezoneOffsetMin: 0 },
  parts = {},
  defaultNsfw = true,
  sessionId = 'cal-session',
} = {}) {
  silence(t);
  const parent = join(tmpdir(), 'dsh-body');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'cal-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(
    statePath,
    JSON.stringify(checkpoint({
      wallTimeMs,
      simulatedSeconds,
      profile,
      parts: {
        brainNotify: { lastSessionId: sessionId },
        ...parts,
      },
    })),
  );
  let clockMs = wallTimeMs;
  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => clockMs,
    requireBinding: false,
    defaultNsfw,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  const tools = createBodyTools(gateway);
  return {
    gateway,
    tools,
    sessionId,
    async tickRounds(count = 1) {
      for (let i = 0; i < count; i += 1) {
        clockMs += 60_000;
        await gateway.tick();
      }
    },
  };
}

test('Calibration 1: gentle sex (intensity 0.35, exertion 0.05) climbs past 70 mm for orgasm without phantom exertion or heavy sweat', async (t) => {
  const body = await startCalibratedBody(t, {
    manifestPath: MANIFEST_FEMALE,
    defaultNsfw: true,
  });

  const sexRes = await body.tools.body_act.execute(
    { type: 'sex', intensity: 0.35, exertion: 0.05, durationMin: 20 },
    fakeExec(body.sessionId, 'gentle-sex'),
  );
  assert.equal(sexRes.ok, true);

  await body.tickRounds(16);
  const preOrgasm = body.gateway.getState();
  assert.ok(
    preOrgasm.parts.sexualResponse.arousalMm > 70,
    `expected arousal > 70 mm under gentle 0.35 sex, got ${preOrgasm.parts.sexualResponse.arousalMm}`,
  );
  assert.equal(preOrgasm.parts.physicalActivity.intensity, 0.05);
  assert.ok(preOrgasm.parts.interoception.sweatDampMm < 15);
  assert.ok(preOrgasm.parts.interoception.muscleFatigueMm < 20);

  const stateRes = await body.tools.body_state.execute(
    { focus: 'all' },
    fakeExec(body.sessionId, 'state-pre'),
  );
  const allFeelingsText = stateRes.feelings.map((f) => f.feeling).join('\n');
  assert.equal(allFeelingsText.includes('四肢在持续发力'), false);
  assert.equal(allFeelingsText.includes('轻微发力'), false);
  assert.ok(
    stateRes.feelings.some((f) => f.area === 'sexual' && f.level !== 'rest'),
    'expected progressive sexual feeling before orgasm',
  );

  const orgasmRes = await body.tools.body_act.execute(
    { type: 'orgasm' },
    fakeExec(body.sessionId, 'gentle-orgasm'),
  );
  assert.equal(orgasmRes.ok, true);
  await body.tickRounds(1);
  const postOrgasm = body.gateway.getState();
  assert.equal(postOrgasm.parts.sexualResponse.phase, 'orgasm');
  assert.equal(postOrgasm.parts.sexualResponse.lastOrgasmAtSimMin, 17);
});

test('Calibration 2: blocked orgasm records reason, bypasses normal cooldown notification, explains in body_state for <=3 min, and resets male refractory notice', async (t) => {
  // Female below_threshold block while normal cooldown is active from bladder urgency
  const female = await startCalibratedBody(t, {
    manifestPath: MANIFEST_FEMALE,
    defaultNsfw: true,
    parts: {
      bladder: { volumeMl: 300, voidedMl: 0, voluntaryVoidedMl: 0, involuntaryVoidedMl: 0 },
      interoception: { urinaryUrgency: 73 },
    },
  });

  await female.tickRounds(1);
  const initialNotes = female.gateway.getNotifications().length;
  assert.ok(initialNotes >= 1, 'expected normal urinary notification to engage cooldown');

  await female.tools.body_act.execute(
    { type: 'orgasm' },
    fakeExec(female.sessionId, 'early-orgasm'),
  );
  await female.tickRounds(1); // commits attempt at simMin = 2
  const blockedState = female.gateway.getState().parts.sexualResponse;
  assert.equal(blockedState.lastOrgasmBlockReason, 'below_threshold');
  assert.equal(blockedState.lastAttemptedOrgasmAtSimMin, 2);
  assert.equal(blockedState.lastOrgasmAtSimMin, null);

  const reproWithin3Min = await female.tools.body_state.execute(
    { focus: 'reproductive' },
    fakeExec(female.sessionId, 'repro-1'),
  );
  assert.ok(
    reproWithin3Min.feelings.some((f) => f.area === 'sexual' && f.feeling.includes('没能跨过释放门槛')),
    'expected below-threshold explanation in body_state within 3 min',
  );

  // One more tick lets brainNotify read round-start sexualResponse even inside normal cooldown
  await female.tickRounds(1);
  const blockContextNotes = female.gateway
    .getNotifications()
    .filter((n) => n.mode === 'context' && n.text.includes('没能跨过释放门槛'));
  assert.equal(blockContextNotes.length, 1);

  // Advance past 3 min window (> 3 min after simMin 2 => simMin 6)
  await female.tickRounds(3);
  const reproExpired = await female.tools.body_state.execute(
    { focus: 'reproductive' },
    fakeExec(female.sessionId, 'repro-expired'),
  );
  assert.equal(
    reproExpired.feelings.some((f) => f.feeling.includes('没能跨过释放门槛')),
    false,
  );

  // Male refractory block
  const male = await startCalibratedBody(t, {
    manifestPath: MANIFEST_MALE,
    defaultNsfw: true,
    parts: {
      sexualResponse: {
        arousalMm: 85,
        phase: 'plateau',
        remainingSexMin: 10,
        sexIntensity: 0.7,
        lastOrgasmAtSimMin: null,
        afterglowMm: 0,
        lastAttemptedOrgasmAtSimMin: null,
        lastOrgasmBlockReason: 'none',
      },
    },
  });
  await male.tools.body_act.execute({ type: 'orgasm' }, fakeExec(male.sessionId, 'male-org-1'));
  await male.tickRounds(1);
  assert.equal(male.gateway.getState().parts.sexualResponse.lastOrgasmAtSimMin, 1);

  await male.tools.body_act.execute(
    { type: 'sex', intensity: 0.8, exertion: 0.4, durationMin: 5 },
    fakeExec(male.sessionId, 'male-restim'),
  );
  await male.tickRounds(2);
  await male.tools.body_act.execute({ type: 'orgasm' }, fakeExec(male.sessionId, 'male-org-ref'));
  await male.tickRounds(1); // attempt at simMin = 3 (< 20 min refractory)
  assert.equal(male.gateway.getState().parts.sexualResponse.lastOrgasmBlockReason, 'refractory');

  const maleState = await male.tools.body_state.execute(
    { focus: 'reproductive' },
    fakeExec(male.sessionId, 'male-repro'),
  );
  assert.ok(
    maleState.feelings.some((f) => f.area === 'sexual' && f.feeling.includes('仍处在不应余缓期里')),
  );

  await male.tickRounds(1);
  assert.ok(
    male.gateway.getNotifications().some((n) => n.mode === 'context' && n.text.includes('仍处在不应余缓期')),
  );
});

test('Calibration 3: orgasm halts sex and exertion without rebound, while continueStimulation: true supports consecutive female climaxes', async (t) => {
  const body = await startCalibratedBody(t, {
    manifestPath: MANIFEST_FEMALE,
    defaultNsfw: true,
  });

  await body.tools.body_act.execute(
    { type: 'sex', intensity: 0.8, exertion: 0.3, durationMin: 15 },
    fakeExec(body.sessionId, 'sex-1'),
  );
  await body.tickRounds(10);
  assert.ok(body.gateway.getState().parts.sexualResponse.arousalMm > 70);

  // Standard orgasm ends remainingSexMin and paired physicalActivity without post-pause rebound
  await body.tools.body_act.execute({ type: 'orgasm' }, fakeExec(body.sessionId, 'orgasm-stop'));
  await body.tickRounds(1);
  const onOrgasm = body.gateway.getState().parts;
  assert.equal(onOrgasm.sexualResponse.phase, 'orgasm');
  assert.equal(onOrgasm.sexualResponse.remainingSexMin, 0);
  assert.equal(onOrgasm.sexualResponse.sexIntensity, 0);
  assert.equal(onOrgasm.physicalActivity.remainingExerciseMin, 0);
  assert.equal(onOrgasm.physicalActivity.intensity, 0);

  const trajectory = [onOrgasm.sexualResponse.arousalMm];
  for (let i = 0; i < 4; i += 1) {
    await body.tickRounds(1);
    trajectory.push(body.gateway.getState().parts.sexualResponse.arousalMm);
  }
  for (let i = 1; i < trajectory.length; i += 1) {
    assert.ok(
      trajectory[i] < trajectory[i - 1],
      `expected monotonic post-orgasm arousal decay without 2-min rebound, got ${trajectory.join(' -> ')}`,
    );
  }

  // Re-stimulate then orgasm with continueStimulation: true enables consecutive female climaxes
  await body.tools.body_act.execute(
    { type: 'sex', intensity: 0.85, exertion: 0.25, durationMin: 15 },
    fakeExec(body.sessionId, 'sex-2'),
  );
  await body.tickRounds(8);
  assert.ok(body.gateway.getState().parts.sexualResponse.arousalMm > 70);

  await body.tools.body_act.execute(
    { type: 'orgasm', continueStimulation: true },
    fakeExec(body.sessionId, 'orgasm-continue'),
  );
  await body.tickRounds(1);
  const continued = body.gateway.getState().parts;
  const firstReleaseSimMin = continued.sexualResponse.lastOrgasmAtSimMin;
  assert.equal(continued.sexualResponse.phase, 'orgasm');
  assert.ok(continued.sexualResponse.remainingSexMin > 0);
  assert.ok(continued.sexualResponse.sexIntensity > 0);
  assert.ok(continued.physicalActivity.remainingExerciseMin > 0);

  // Wait past 2-min female pause while stimulation stays active and arousal recovers > 70
  await body.tickRounds(6);
  assert.ok(body.gateway.getState().parts.sexualResponse.arousalMm >= 70);

  await body.tools.body_act.execute(
    { type: 'orgasm' },
    fakeExec(body.sessionId, 'orgasm-second'),
  );
  await body.tickRounds(1);
  const second = body.gateway.getState().parts.sexualResponse;
  assert.equal(second.phase, 'orgasm');
  assert.ok(second.lastOrgasmAtSimMin > firstReleaseSimMin);
});

test('Calibration 4: 50 kg post-exercise recovery cools via vasodilation, throttles rest sweat, and decays sweatDampMm monotonically without surge', async (t) => {
  const body = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
    wallTimeMs: Date.UTC(2026, 0, 1, 9, 0, 0),
    profile: { weightKg: 50, heightCm: 160, timezoneOffsetMin: 0 },
  });

  await body.tools.body_act.execute(
    { type: 'exercise', intensity: 0.35, durationMin: 20 },
    fakeExec(body.sessionId, 'ex-20m'),
  );

  let peakTempC = 0;
  let peakSweatDampMm = 0;
  for (let r = 1; r <= 20; r += 1) {
    await body.tickRounds(1);
    const s = body.gateway.getState().parts;
    peakTempC = Math.max(peakTempC, s.thermoregulation.coreTemperatureC);
    peakSweatDampMm = Math.max(peakSweatDampMm, s.interoception.sweatDampMm);
  }
  assert.ok(peakTempC > 37, `expected coreTemperatureC > 37 after 20-min moderate exercise, got ${peakTempC}`);
  assert.ok(peakSweatDampMm < 50, `expected moderate sweatDampMm < 50 without saturation, got ${peakSweatDampMm}`);

  const activeTempState = await body.tools.body_state.execute(
    { focus: 'temperature' },
    fakeExec(body.sessionId, 'temp-active'),
  );
  // Active sweat or mild moisture should appear during exercise
  assert.ok(activeTempState.feelings.some((f) => f.area === 'temperature'));

  // Rest 20 min: round 21 sees remaining=1 at round-start, round 22 settles skin, round 23 updates interoception peak -> decay from round 23..40
  await body.tickRounds(3);
  const restSweatSeries = [body.gateway.getState().parts.interoception.sweatDampMm];
  for (let r = 24; r <= 40; r += 1) {
    await body.tickRounds(1);
    restSweatSeries.push(body.gateway.getState().parts.interoception.sweatDampMm);
  }
  const endTempC = body.gateway.getState().parts.thermoregulation.coreTemperatureC;
  assert.ok(endTempC < peakTempC, `expected 20-min rest cooling below peak ${peakTempC}, got ${endTempC}`);
  for (let i = 1; i < restSweatSeries.length; i += 1) {
    assert.ok(
      restSweatSeries[i] <= restSweatSeries[i - 1] + 1e-9,
      `expected monotonic post-exercise sweatDampMm decay, index ${i}: ${restSweatSeries[i]} > ${restSweatSeries[i - 1]}`,
    );
  }

  // Intense run crosses sweat band (>=40 mm), then stopping transitions active sweating prose -> drying residual prose
  const runner = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
    wallTimeMs: Date.UTC(2026, 0, 1, 9, 0, 0),
    profile: { weightKg: 50, heightCm: 160, timezoneOffsetMin: 0 },
  });
  await runner.tools.body_act.execute(
    { type: 'exercise', intensity: 0.9, durationMin: 15 },
    fakeExec(runner.sessionId, 'intense-run'),
  );
  await runner.tickRounds(15);
  const runningState = await runner.tools.body_state.execute(
    { focus: 'temperature' },
    fakeExec(runner.sessionId, 'run-active'),
  );
  assert.ok(
    runningState.feelings.some((f) => f.feeling.includes('出汗') || f.feeling.includes('泛潮') || f.feeling.includes('粘腻')),
    `expected active sweating prose during 0.9 run, got ${JSON.stringify(runningState.feelings)}`,
  );

  // Residual dampness transition without active sweating renders drying prose and decays smoothly
  const dryingBody = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
    profile: { weightKg: 50, heightCm: 160, timezoneOffsetMin: 0 },
    parts: {
      skin: { sweatRequestMl: 0, sweatVolumeMl: 0 },
      interoception: { sweatDampMm: 75 },
    },
  });
  const dryingState = await dryingBody.tools.body_state.execute(
    { focus: 'temperature' },
    fakeExec(dryingBody.sessionId, 'dry-residual'),
  );
  assert.ok(
    dryingState.feelings.some((f) => f.feeling.includes('潮意')),
    `expected drying residual prose when sweat stopped, got ${JSON.stringify(dryingState.feelings)}`,
  );
  await dryingBody.tickRounds(6);
  assert.ok(dryingBody.gateway.getState().parts.interoception.sweatDampMm < 35);
});

test('Calibration 5: 05:00 nocturnal 50 kg rest keeps deadband sweat at 0 and euhydrated thirst at 0 while deficit scales positively', async (t) => {
  const nocturnal = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
    wallTimeMs: Date.UTC(2026, 0, 1, 5, 0, 0),
    profile: { weightKg: 50, heightCm: 160, timezoneOffsetMin: 0 },
  });

  await nocturnal.tickRounds(1);
  const round1Parts = nocturnal.gateway.getState().parts;
  assert.equal(round1Parts.skin.sweatRequestMl, 0);
  assert.equal(round1Parts.skin.sweatVolumeMl, 0);
  assert.equal(round1Parts.hypothalamusThirst.thirst, 0);
  assert.equal(round1Parts.interoception.thirst, 0);

  await nocturnal.tickRounds(19);
  const restParts = nocturnal.gateway.getState().parts;
  assert.equal(restParts.skin.sweatRequestMl, 0);
  assert.equal(restParts.skin.sweatVolumeMl, 0);
  // Basal urine over 20 min (~17 mL) only nudges osmotic thirst < 5 mm (nowhere near 15 mm mild or old 50 mm baseline)
  assert.ok(restParts.hypothalamusThirst.thirst < 5);
  assert.ok(restParts.interoception.thirst < 5);

  const restState = await nocturnal.tools.body_state.execute(
    { focus: 'all' },
    fakeExec(nocturnal.sessionId, 'nocturnal-rest'),
  );
  assert.equal(restState.feelings.some((f) => f.area === 'thirst'), false);

  const dehydrated = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
    wallTimeMs: Date.UTC(2026, 0, 1, 5, 0, 0),
    profile: { weightKg: 50, heightCm: 160, timezoneOffsetMin: 0 },
    parts: {
      bodyFluid: { waterVolumeMl: 19000, waterDeficit: 1 },
    },
  });
  await dehydrated.tickRounds(1);
  assert.ok(dehydrated.gateway.getState().parts.hypothalamusThirst.thirst > 0);
});

test('Calibration 6: Hey plot recruits tidalVolumeMl before respiratoryRatePerMin, and resting mild hyperthermia avoids false panting', async (t) => {
  const exBody = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
  });
  await exBody.tools.body_act.execute(
    { type: 'exercise', intensity: 0.35, durationMin: 10 },
    fakeExec(exBody.sessionId, 'mild-ex'),
  );
  await exBody.tickRounds(3); // round 1 activity -> round 2 O2 demand -> round 3 lungsVentilation reads O2
  const vent = exBody.gateway.getState().parts.lungsVentilation;
  assert.ok(vent.tidalVolumeMl > 700, `expected VT recruitment > 700 mL, got ${vent.tidalVolumeMl}`);
  assert.ok(vent.respiratoryRatePerMin < 24, `expected calm RR < 24 /min, got ${vent.respiratoryRatePerMin}`);

  const warmRest = await startCalibratedBody(t, {
    manifestPath: MANIFEST_ROOT,
    wallTimeMs: Date.UTC(2026, 0, 1, 14, 0, 0),
    parts: {
      thermoregulation: { coreTemperatureC: 37.6, setpointC: 37.0 },
    },
  });
  await warmRest.tickRounds(1);
  const restVent = warmRest.gateway.getState().parts.lungsVentilation;
  assert.ok(restVent.ventilationMlMin < 8000, `expected no resting false panting, got ${restVent.ventilationMlMin}`);
  assert.ok(restVent.respiratoryRatePerMin < 20);
  const respState = await warmRest.tools.body_state.execute(
    { focus: 'respiration' },
    fakeExec(warmRest.sessionId, 'warm-rest-resp'),
  );
  assert.equal(respState.feelings.some((f) => f.feeling.includes('大口喘气')), false);
});

test('Calibration 7: body_state renders progressive sexual/thirst bands cleanly and guards health.fatal', async (t) => {
  // Progressive sexual arousal tiers
  const expectedSnippets = [
    [15, '兴奋刚刚泛起', '刚刚泛起'],
    [30, '稳步爬升'],
    [50, '明显的燥热与悸动在蔓延'],
    [70, '高台'],
    [82, '临近顶点'],
  ];
  for (const [idx, [arousalMm, snippetA, snippetB]] of expectedSnippets.entries()) {
    const body = await startCalibratedBody(t, {
      manifestPath: MANIFEST_FEMALE,
      defaultNsfw: true,
      parts: {
        sexualResponse: {
          arousalMm,
          phase: arousalMm >= 60 ? 'plateau' : 'excitement',
          remainingSexMin: 5,
          sexIntensity: 0.4,
          lastOrgasmAtSimMin: null,
          afterglowMm: 0,
          lastAttemptedOrgasmAtSimMin: null,
          lastOrgasmBlockReason: 'none',
        },
        interoception: { sexualArousalMm: arousalMm },
      },
    });
    const res = await body.tools.body_state.execute(
      { focus: 'reproductive' },
      fakeExec(body.sessionId, `arousal-${idx}`),
    );
    const sexualText = res.feelings.filter((f) => f.area === 'sexual').map((f) => f.feeling).join('\n');
    assert.ok(
      sexualText.includes(snippetA) || (snippetB && sexualText.includes(snippetB)),
      `expected progressive sexual prose for ${arousalMm} mm, got ${sexualText}`,
    );
  }

  // Progressive thirst bands: silent in focus:'all' (steady in focus:'thirst') at 10, mild at 20, marked at 45, strong at 70
  const thirstCases = [
    [10, null],
    [20, '隐约有一点微渴'],
    [45, '有些口渴了'],
    [70, '非常口渴'],
  ];
  for (const [idx, [thirst, expectedText]] of thirstCases.entries()) {
    const body = await startCalibratedBody(t, {
      manifestPath: MANIFEST_ROOT,
      parts: {
        hypothalamusThirst: { thirst },
        interoception: { thirst },
      },
    });
    const res = await body.tools.body_state.execute(
      { focus: expectedText === null ? 'all' : 'thirst' },
      fakeExec(body.sessionId, `thirst-${idx}`),
    );
    const thirstFeelings = res.feelings.filter((f) => f.area === 'thirst');
    if (expectedText === null) {
      assert.equal(thirstFeelings.length, 0);
    } else {
      assert.ok(thirstFeelings.some((f) => f.feeling.includes(expectedText)));
    }
  }

  // health.fatal guard returns paused status without throwing
  const fatalTools = createBodyTools({
    getHealth: () => ({ active: true, fatal: { message: 'boom' }, dormant: false, nsfw: true }),
    getState: () => {
      throw new Error('should not call getState on fatal gateway');
    },
  });
  const fatalRes = await fatalTools.body_state.execute(
    { focus: 'all' },
    fakeExec('fatal-session', 'fatal-1'),
  );
  assert.equal(fatalRes.status, 'paused');
  assert.deepEqual(fatalRes.feelings, []);
  assert.ok(fatalRes.summary.includes('异常已停机'));
});
