import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/sleep.ts';
import { heartbeat as autonomicHeartbeat } from '../organs/human-organs/brain/autonomic.ts';
import { heartbeat as hypothalamusEndocrineHeartbeat } from '../organs/human-organs/brain/hypothalamus-endocrine.ts';
import { heartbeat as rewardHeartbeat } from '../organs/human-organs/brain/reward.ts';
import { evaluateSleepTransition } from '../organs/human-organs/brain/wake-evaluation.ts';
import {
  actionTypes as activityActionTypes,
  heartbeat as activityHeartbeat,
} from '../organs/human-organs/skeletal-muscle/activity.ts';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const tempBase = join(tmpdir(), 'dsh-body');

function roundSleep({ state, pineal, actions = [], dt = 60 } = {}) {
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'sleep') return state;
      if (partId === 'pineal') return pineal;
      return undefined;
    },
    actions,
    dt,
    write: (next) => { written = next; },
  });
  return written;
}

function roundActivity({ state, actions = [], dt = 60 } = {}) {
  let written;
  activityHeartbeat({
    read: (partId) => (partId === 'physicalActivity' ? state : undefined),
    actions,
    dt,
    write: (next) => { written = next; },
  });
  return written;
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // Already mocked in this test.
    }
  }
}

async function startRealBody(t, {
  parts = {},
  simulatedSeconds = 0,
  wallTimeMs = 0,
  profile,
  boundSessionId = null,
} = {}) {
  mkdirSync(tempBase, { recursive: true });
  const dir = mkdtempSync(join(tempBase, 'sleep-gateway.'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify({
    ...checkpoint({
      wallTimeMs,
      simulatedSeconds,
      parts,
    }),
    ...(profile ? { profile } : {}),
    ...(boundSessionId !== null ? { boundSessionId } : {}),
  }));
  silence(t);
  const gateways = [];
  t.after(async () => {
    for (const gateway of gateways) await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const gateway = startGateway({
    manifestPath: rootManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => wallTimeMs,
  });
  gateways.push(gateway);
  await gateway.ready;
  return gateway;
}

test('sleep exports the organ module contract', () => {
  assert.equal(id, 'sleep');
  assert.deepEqual(actionTypes, ['sleep', 'wake_up']);
  assert.deepEqual(initialState, {
    sleeping: false,
    sleepPressureMm: 0,
    sleepDurationMin: 0,
    sleepStage: 'awake',
    sleepInertiaMm: 0,
    wakeEvent: 'none',
  });
  assert.deepEqual(fields, {
    sleeping: { unit: '1', mode: 'absolute' },
    sleepPressureMm: { unit: 'mm', mode: 'absolute' },
    sleepDurationMin: { unit: 'min', mode: 'absolute' },
    sleepStage: { unit: '1', mode: 'absolute' },
    sleepInertiaMm: { unit: 'mm', mode: 'absolute' },
    wakeEvent: { unit: '1', mode: 'absolute' },
  });
});

test('awake sleepPressureMm accumulates at 0.08 mm/min and clamps to [0, 100]', () => {
  const afterOneMin = roundSleep({ state: initialState, dt: 60 });
  assertClose(afterOneMin.sleepPressureMm, 0.08, '1 min awake');
  assert.equal(afterOneMin.sleeping, false);
  assert.equal(afterOneMin.sleepDurationMin, 0);

  // 16 hours (960 min) -> 76.8 mm
  const after16h = roundSleep({ state: initialState, dt: 960 * 60 });
  assertClose(after16h.sleepPressureMm, 76.8, '16 hours awake');

  // Clamps at 100 mm
  const clamped = roundSleep({
    state: { sleeping: false, sleepPressureMm: 99, sleepDurationMin: 50 },
    dt: 60 * 60,
  });
  assert.equal(clamped.sleepPressureMm, 100);
  assert.equal(clamped.sleepDurationMin, 0);
});

test('sleep and wake_up actions toggle sleeping state and track sleepDurationMin', () => {
  const fellAsleep = roundSleep({
    state: { sleeping: false, sleepPressureMm: 60, sleepDurationMin: 0 },
    actions: [{ type: 'sleep' }],
    dt: 60,
  });
  assert.equal(fellAsleep.sleeping, true);
  assert.equal(fellAsleep.sleepDurationMin, 1);
  assertClose(fellAsleep.sleepPressureMm, 60 * Math.pow(0.5, 1 / 150), '1 min sleep decay');

  // Repeated sleep action while already sleeping does not reset sleepDurationMin
  const stillSleeping = roundSleep({
    state: { sleeping: true, sleepPressureMm: 50, sleepDurationMin: 45 },
    actions: [{ type: 'sleep' }],
    dt: 60,
  });
  assert.equal(stillSleeping.sleeping, true);
  assert.equal(stillSleeping.sleepDurationMin, 46);

  // wake_up wakes immediately, zeroes sleepDurationMin, and switches to awake accumulation
  const woken = roundSleep({
    state: { sleeping: true, sleepPressureMm: 40, sleepDurationMin: 120 },
    actions: [{ type: 'wake_up' }],
    dt: 60,
  });
  assert.equal(woken.sleeping, false);
  assert.equal(woken.sleepDurationMin, 0);
  assertClose(woken.sleepPressureMm, 40.08, 'awake accumulation after wake_up');
});

test('sleepPressureMm recovers exponentially with a 150-minute half-time (faster in deep sleep)', () => {
  const afterLightOneHalfTime = roundSleep({
    state: { sleeping: true, sleepPressureMm: 80, sleepDurationMin: 0, sleepStage: 'light' },
    pineal: { melatoninRelative: 1.8 },
    dt: 150 * 60,
  });
  // At 150 min (150 % 90 = 60 -> light stage -> 1.0x multiplier), pressure halves cleanly to 40
  assert.equal(afterLightOneHalfTime.sleepDurationMin, 150);
  assert.equal(afterLightOneHalfTime.sleeping, true);
  assertClose(afterLightOneHalfTime.sleepPressureMm, 40, '150-min light sleep half-time');

  const afterLightBaseline = roundSleep({
    state: { sleeping: true, sleepPressureMm: 80, sleepDurationMin: 0, sleepStage: 'light' },
    pineal: { melatoninRelative: 1.8 },
    dt: 10 * 60, // 10 min -> light stage (1.0x multiplier)
  });
  assertClose(afterLightBaseline.sleepPressureMm, 80 * Math.pow(0.5, 10 / 150), '10-min light sleep recovery');

  const afterDeepAccelerated = roundSleep({
    state: { sleeping: true, sleepPressureMm: 80, sleepDurationMin: 15, sleepStage: 'deep' },
    pineal: { melatoninRelative: 1.8 },
    dt: 15 * 60, // 30 min -> deep stage (1.3x multiplier)
  });
  assertClose(afterDeepAccelerated.sleepPressureMm, 80 * Math.pow(0.5, (15 * 1.3) / 150), '15-min deep sleep accelerated recovery');
});

test('natural wake-up checks pressure, duration, melatonin ceiling, and full-rest override', () => {
  // Blocked when melatonin > 1.45 (deep midnight biological night) and pressure >= 4
  const blockedByMelatonin = roundSleep({
    state: { sleeping: true, sleepPressureMm: 8, sleepDurationMin: 359 },
    pineal: { melatoninRelative: 1.46 },
    dt: 60,
  });
  assert.equal(blockedByMelatonin.sleeping, true);
  assert.equal(blockedByMelatonin.sleepDurationMin, 360);

  // Blocked when duration < 360 min even with low pressure and low melatonin
  const blockedByDuration = roundSleep({
    state: { sleeping: true, sleepPressureMm: 5, sleepDurationMin: 358 },
    pineal: { melatoninRelative: 0.5 },
    dt: 60,
  });
  assert.equal(blockedByDuration.sleeping, true);
  assert.equal(blockedByDuration.sleepDurationMin, 359);

  // Blocked when sleepPressureMm >= 10 after recovery
  const blockedByPressure = roundSleep({
    state: { sleeping: true, sleepPressureMm: 10.5, sleepDurationMin: 360 },
    pineal: { melatoninRelative: 0.5 },
    dt: 60,
  });
  assert.equal(blockedByPressure.sleeping, true);
  assert.ok(blockedByPressure.sleepPressureMm >= 10);

  // Fires when pressure < 10, duration >= 360, and melatonin <= 1.45 (early morning ~06:00+)
  const naturalWake = roundSleep({
    state: { sleeping: true, sleepPressureMm: 8, sleepDurationMin: 359 },
    pineal: { melatoninRelative: 1.45 },
    dt: 60,
  });
  assert.equal(naturalWake.sleeping, false);
  assert.equal(naturalWake.sleepDurationMin, 0);

  // Full-rest override (>= 420 min and pressure < 4) wakes even if melatonin remains high
  const fullRestWake = roundSleep({
    state: { sleeping: true, sleepPressureMm: 3, sleepDurationMin: 419 },
    pineal: { melatoninRelative: 1.75 },
    dt: 60,
  });
  assert.equal(fullRestWake.sleeping, false);
  assert.equal(fullRestWake.wakeEvent, 'natural');

  // Fires when pineal is absent (undefined)
  const naturalWakeNoPineal = roundSleep({
    state: { sleeping: true, sleepPressureMm: 8, sleepDurationMin: 359 },
    pineal: undefined,
    dt: 60,
  });
  assert.equal(naturalWakeNoPineal.sleeping, false);
  assert.equal(naturalWakeNoPineal.sleepDurationMin, 0);
});

test('ordered same-round actions resolve cleanly and wake_up startle is ignored when already awake', () => {
  const sleepLast = roundSleep({
    state: { sleeping: true, sleepPressureMm: 50, sleepDurationMin: 30 },
    actions: [{ type: 'wake_up' }, { type: 'sleep' }],
    dt: 60,
  });
  assert.equal(sleepLast.sleeping, true);
  assert.equal(sleepLast.wakeEvent, 'none');

  const wakeLast = roundSleep({
    state: { sleeping: false, sleepPressureMm: 50, sleepDurationMin: 0 },
    actions: [{ type: 'sleep' }, { type: 'wake_up' }],
    dt: 60,
  });
  assert.equal(wakeLast.sleeping, false);

  const awakeStartleIgnored = roundSleep({
    state: { sleeping: false, sleepPressureMm: 10, sleepDurationMin: 0, sleepInertiaMm: 0, wakeEvent: 'none' },
    actions: [{ type: 'wake_up', startle: true }],
    dt: 60,
  });
  assert.equal(awakeStartleIgnored.sleeping, false);
  assert.equal(awakeStartleIgnored.wakeEvent, 'none');
});

test('stop_exercise and sleep clear physicalActivity remainingExerciseMin and intensity', () => {
  assert.deepEqual(activityActionTypes, ['exercise', 'sex', 'stop_exercise']);

  const active = { remainingExerciseMin: 25, intensity: 0.7 };

  const stopped = roundActivity({
    state: active,
    actions: [{ type: 'stop_exercise' }],
    dt: 60,
  });
  assert.deepEqual(stopped, { remainingExerciseMin: 0, intensity: 0 });

  const slept = roundActivity({
    state: active,
    actions: [{ type: 'sleep' }],
    dt: 60,
  });
  assert.deepEqual(slept, { remainingExerciseMin: 0, intensity: 0 });
});

test('Gateway integration: sleep clears exercise, accumulates backlog, raises wake threshold, and completes natural/startle awakening', async (t) => {
  // Phase 1: Start at local 10:00 (melatonin <= 0.9) with active exercise, marked hunger, and bladder >= 92 mm (380 mL)
  const gateway = await startRealBody(t, {
    simulatedSeconds: 10 * 3600,
    wallTimeMs: 10 * 3600 * 1000,
    profile: { timezoneOffsetMin: 0 },
    boundSessionId: 'session-sleep',
    parts: {
      sleep: { sleeping: false, sleepPressureMm: 50, sleepDurationMin: 0, sleepStage: 'awake', sleepInertiaMm: 0, wakeEvent: 'none' },
      physicalActivity: { remainingExerciseMin: 20, intensity: 0.6 },
      stomachGhrelin: { relativeConcentration: 1.5 },
      bladder: { volumeMl: 380 },
    },
  });

  // Submit sleep action -> clears physicalActivity and enters sleeping state
  const sleepRes = await gateway.submitAction({
    id: 'sleep-1',
    type: 'sleep',
    sessionId: 'session-sleep',
  });
  assert.equal(sleepRes.statusCode, 202);
  await gateway.tick();

  let state = gateway.getState();
  assert.equal(state.parts.sleep.sleeping, true);
  assert.equal(state.parts.sleep.sleepDurationMin, 1);
  assert.equal(state.parts.sleep.sleepStage, 'light');
  assert.equal(state.parts.physicalActivity.remainingExerciseMin, 0);
  assert.equal(state.parts.physicalActivity.intensity, 0);
  assert.ok(state.parts.interoception.hunger >= 65);
  // Marked hunger is suppressed and queued into sleepBacklog while sleeping
  assert.equal(
    gateway.getNotifications().filter((n) => n.mode === 'context').length,
    0,
  );

  // Tick once more -> round-start bladder (380 mL -> urinaryUrgency >= 92) crosses raised sleep important threshold -> wakes + exits sleeping!
  await gateway.tick();
  state = gateway.getState();
  assert.equal(state.parts.sleep.sleeping, false);
  assert.equal(state.parts.sleep.wakeEvent, 'important');
  const wakeAlerts = gateway.getNotifications().filter((n) => n.mode === 'wake');
  assert.equal(wakeAlerts.length, 1);
  assert.equal(wakeAlerts[0].sessionId, 'session-sleep');
  assert.equal(/\d/.test(wakeAlerts[0].text), false);

  // Model urinates
  await gateway.submitAction({ id: 'void-1', type: 'urinate', sessionId: 'session-sleep' });
  await gateway.tick();
  state = gateway.getState();
  assert.equal(state.parts.sleep.sleeping, false);
  assert.equal(state.parts.sleep.sleepDurationMin, 0);
  assert.ok(state.parts.bladder.volumeMl < 50);

  // Phase 2: Natural awakening blocked when melatonin > 1.45 (02:00), then occurs when melatonin <= 1.45 (11:00)
  const nightGateway = await startRealBody(t, {
    simulatedSeconds: 2 * 3600 - 60,
    wallTimeMs: (2 * 3600 - 60) * 1000,
    profile: { timezoneOffsetMin: 0 },
    boundSessionId: 'session-sleep',
    parts: {
      pineal: { melatoninRelative: 1.8 },
      sleep: { sleeping: true, sleepPressureMm: 8, sleepDurationMin: 360, sleepStage: 'rem', sleepInertiaMm: 0, wakeEvent: 'none' },
    },
  });
  await nightGateway.tick(); // 02:00: pineal writes melatonin ~ 1.8
  await nightGateway.tick(); // sleep reads round-start melatonin ~ 1.8 -> stays asleep
  assert.equal(nightGateway.getState().parts.sleep.sleeping, true);
  assert.equal(nightGateway.getState().parts.sleep.sleepDurationMin, 362);

  const morningGateway = await startRealBody(t, {
    simulatedSeconds: 11 * 3600 - 60,
    wallTimeMs: (11 * 3600 - 60) * 1000,
    profile: { timezoneOffsetMin: 0 },
    boundSessionId: 'session-sleep',
    parts: {
      sleep: { sleeping: true, sleepPressureMm: 8, sleepDurationMin: 360, sleepStage: 'rem', sleepInertiaMm: 0, wakeEvent: 'none' },
    },
  });
  await morningGateway.tick(); // 11:00: pineal writes melatonin <= 0.9
  await morningGateway.tick(); // sleep reads round-start melatonin <= 0.9 -> natural awakening
  assert.equal(morningGateway.getState().parts.sleep.sleeping, false);
  assert.equal(morningGateway.getState().parts.sleep.sleepDurationMin, 0);
  assert.ok(
    morningGateway.getNotifications().some((n) => n.mode === 'wake' && n.text.includes('醒')),
    'natural awakening sends wake notification',
  );
});

test('sleep staging, inertia, active-action wake, and emergency startle wake behave as designed', () => {
  // Deep sleep recovers faster and produces higher inertia if interrupted
  const deepSleep = roundSleep({
    state: { sleeping: true, sleepPressureMm: 80, sleepDurationMin: 30, sleepStage: 'deep', sleepInertiaMm: 0, wakeEvent: 'none' },
    dt: 60,
  });
  assert.equal(deepSleep.sleepStage, 'deep');
  assert.ok(deepSleep.sleepPressureMm < 80 * Math.pow(0.5, 1 / 150), 'deep sleep recovers faster than 1x');

  const deepInterrupted = roundSleep({
    state: { sleeping: true, sleepPressureMm: 60, sleepDurationMin: 40, sleepStage: 'deep', sleepInertiaMm: 0, wakeEvent: 'none' },
    actions: [{ type: 'eat' }],
    dt: 60,
  });
  assert.equal(deepInterrupted.sleeping, false);
  assert.equal(deepInterrupted.wakeEvent, 'action');
  assert.equal(deepInterrupted.sleepInertiaMm, 65);

  const inertiaDecayed = roundSleep({
    state: deepInterrupted,
    dt: 20 * 60,
  });
  assertClose(inertiaDecayed.sleepInertiaMm, 32.5, 'inertia halves in 20 min');

  // Speech wake_up
  const speechWake = roundSleep({
    state: { sleeping: true, sleepPressureMm: 50, sleepDurationMin: 60, sleepStage: 'light', sleepInertiaMm: 0, wakeEvent: 'none' },
    actions: [{ type: 'wake_up', reason: 'speech' }],
    dt: 60,
  });
  assert.equal(speechWake.sleeping, false);
  assert.equal(speechWake.wakeEvent, 'speech');

  // Emergency startle during sleep forces wakeEvent = 'startle'
  let startleWritten;
  heartbeat({
    read: (partId) => {
      if (partId === 'sleep') {
        return { sleeping: true, sleepPressureMm: 50, sleepDurationMin: 60, sleepStage: 'deep', sleepInertiaMm: 0, wakeEvent: 'none' };
      }
      if (partId === 'interoception') {
        return { dyspneaMm: 95 };
      }
      return undefined;
    },
    actions: [],
    dt: 60,
    write: (next) => { startleWritten = next; },
  });
  assert.equal(startleWritten.sleeping, false);
  assert.equal(startleWritten.wakeEvent, 'startle');
  assert.equal(startleWritten.sleepInertiaMm, 25);
});

test('same-round wake-then-sleep resets sleepDurationMin in shared transition and downstream brains', () => {
  // Deeply rested sleeper close to circadian and full-rest natural-wake thresholds wakes then returns to sleep in the same round.
  const sleep = {
    sleeping: true,
    sleepStage: 'deep',
    sleepPressureMm: 3,
    sleepDurationMin: 419,
    sleepInertiaMm: 0,
    wakeEvent: 'none',
  };
  const pineal = { melatoninRelative: 1.0 };
  const sexualResponse = { arousalMm: 80, phase: 'plateau', lastOrgasmAtSimMin: null, afterglowMm: 0 };

  for (const wakingAction of [{ type: 'wake_up' }, { type: 'orgasm' }]) {
    const actions = [wakingAction, { type: 'sleep' }];
    const parts = {
      sleep,
      pineal,
      sexualResponse,
      autonomic: { sympatheticMm: 0, parasympatheticMm: 20, startleActive: false },
      reward: { wantingMm: 25, hedonicMm: 15, satietyMm: 0 },
      hypothalamusEndocrine: { trhRelative: 1, crhRelative: 1, carElapsedMin: null },
    };
    const read = (partId) => parts[partId];

    const sleepNext = roundSleep({ state: sleep, pineal, actions, dt: 60 });
    assert.equal(sleepNext.sleeping, true, `${wakingAction.type} + sleep keeps sleep`);
    assert.equal(sleepNext.wakeEvent, 'none');
    assert.equal(sleepNext.sleepDurationMin, 1);
    assert.equal(sleepNext.sleepStage, 'light');

    const transition = evaluateSleepTransition(
      { read, actions },
      {
        prevSleeping: true,
        sleepStage: 'deep',
        sleepPressureMm: sleep.sleepPressureMm,
        sleepDurationMin: sleep.sleepDurationMin,
        pinealMelatoninRelative: pineal.melatoninRelative,
        hasPineal: true,
        dtMin: 1,
      },
    );
    assert.deepEqual(
      transition,
      { sleeping: true, wakeEvent: 'none' },
      `${wakingAction.type} + sleep must match sleep.ts transition`,
    );

    let rewardNext;
    rewardHeartbeat({ read, actions, dt: 60, simulatedSeconds: 60, write: (next) => { rewardNext = next; } });
    assert.equal(rewardNext.hedonicMm, 15, `${wakingAction.type} + sleep must not emit awake orgasm reward`);
    assert.equal(rewardNext.satietyMm, 0);
    assert.ok(rewardNext.wantingMm < 25);

    let hpaNext;
    hypothalamusEndocrineHeartbeat({ read, actions, dt: 60, wallTimeMs: 0, write: (next) => { hpaNext = next; } });
    assert.equal(hpaNext.carElapsedMin, null, `${wakingAction.type} + sleep must not start CAR window`);

    let autonomicNext;
    autonomicHeartbeat({ read, actions, dt: 60, simulatedSeconds: 60, write: (next) => { autonomicNext = next; } });
    assert.equal(autonomicNext.sympatheticMm, 0, `${wakingAction.type} + sleep must not fire awake orgasm burst`);
    assert.ok(autonomicNext.parasympatheticMm > 20, `${wakingAction.type} + sleep raises sleep parasympathetic tone`);
  }

  // Repeated sleep action without prior wake does NOT reset sleepDurationMin in sleep.ts or evaluateSleepTransition.
  const repeatedSleepActions = [{ type: 'sleep' }];
  const repeatedSleepNext = roundSleep({ state: sleep, pineal, actions: repeatedSleepActions, dt: 60 });
  assert.equal(repeatedSleepNext.sleeping, false);
  assert.equal(repeatedSleepNext.wakeEvent, 'natural');
  assert.deepEqual(
    evaluateSleepTransition(
      { read: (partId) => ({ sleep, pineal }[partId]), actions: repeatedSleepActions },
      {
        prevSleeping: true,
        sleepStage: 'deep',
        sleepPressureMm: sleep.sleepPressureMm,
        sleepDurationMin: sleep.sleepDurationMin,
        pinealMelatoninRelative: pineal.melatoninRelative,
        hasPineal: true,
        dtMin: 1,
      },
    ),
    { sleeping: false, wakeEvent: 'natural' },
  );
});
