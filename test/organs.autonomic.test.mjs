import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertJsonValue } from '../json-safe.js';
import { loadParameters } from '../lib/parameters.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/autonomic.ts';

const parametersUrl = new URL(
  '../organs/human-organs/brain/autonomic.parameters.json',
  import.meta.url,
);

function round({
  state = initialState,
  sleep,
  physicalActivity,
  glucose,
  bloodOxygen,
  blood,
  thermoregulation,
  interoception,
  bladder,
  colon,
  sexualResponse,
  ovaries,
  testes,
  pituitary,
  reward,
  actions = [],
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'autonomic') return state;
      if (partId === 'sleep') return sleep;
      if (partId === 'physicalActivity') return physicalActivity;
      if (partId === 'glucose') return glucose;
      if (partId === 'bloodOxygen') return bloodOxygen;
      if (partId === 'blood') return blood;
      if (partId === 'thermoregulation') return thermoregulation;
      if (partId === 'interoception') return interoception;
      if (partId === 'bladder') return bladder;
      if (partId === 'colon') return colon;
      if (partId === 'sexualResponse') return sexualResponse;
      if (partId === 'ovaries') return ovaries;
      if (partId === 'testes') return testes;
      if (partId === 'pituitary') return pituitary;
      if (partId === 'reward') return reward;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { written = next; },
  });
  return written;
}

test('autonomic exports contract and design parameters', () => {
  assert.equal(id, 'autonomic');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(initialState, {
    sympatheticMm: 0,
    parasympatheticMm: 20,
    startleActive: false,
  });
  assert.deepEqual(fields, {
    sympatheticMm: { unit: 'mm', mode: 'absolute' },
    parasympatheticMm: { unit: 'mm', mode: 'absolute' },
    startleActive: { unit: '1', mode: 'absolute' },
  });

  const file = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(file.owner, 'autonomic');
  for (const param of file.parameters) {
    assert.equal(param.status, 'design');
    assert.ok(param.source === null || param.source === 'SRC-SOMERS-1993');
  }
  const loaded = loadParameters(parametersUrl);
  assert.equal(loaded['autonomic.startleBurstMm'], 85);
});

test('awake resting baseline stays at zero sympatheticMm while sleep elevates parasympatheticMm', () => {
  const resting = round();
  assert.equal(resting.sympatheticMm, 0);
  assert.equal(resting.parasympatheticMm, 20);
  assert.equal(resting.startleActive, false);

  const deepSleeping = round({
    sleep: { sleeping: true, sleepStage: 'deep' },
  });
  assert.equal(deepSleeping.sympatheticMm, 0);
  assert.ok(deepSleeping.parasympatheticMm > 20, 'deep sleep raises parasympathetic tone');
});

test('emergency crisis during sleep triggers immediate startle burst and decays gradually after crisis clears', () => {
  const startled = round({
    state: { sympatheticMm: 0, parasympatheticMm: 70, startleActive: false },
    sleep: { sleeping: true, sleepStage: 'deep' },
    interoception: { dyspneaMm: 95 },
  });
  assert.ok(startled.sympatheticMm >= 85);
  assert.equal(startled.startleActive, true);
  assert.ok(startled.parasympatheticMm < 70);

  const afterDecay = round({
    state: startled,
    sleep: { sleeping: false, sleepStage: 'awake' },
    dt: 12 * 60,
  });
  assert.ok(afterDecay.sympatheticMm < startled.sympatheticMm);
  assert.ok(afterDecay.sympatheticMm >= 10);
  assert.equal(afterDecay.startleActive, true);

  const cleared = round({
    state: { sympatheticMm: 12, parasympatheticMm: 18, startleActive: true },
    sleep: { sleeping: false, sleepStage: 'awake' },
    dt: 30 * 60,
  });
  assert.ok(cleared.sympatheticMm < 10);
  assert.equal(cleared.startleActive, false);
});

test('physiological stressors (exercise, hypoglycemia, hypoxia, hypotension, cold) drive sympatheticMm and stay JSON-safe', () => {
  const exercise = round({ physicalActivity: { remainingExerciseMin: 15, intensity: 1 }, dt: 5 * 60 });
  const hypo = round({ glucose: { concentrationMgDl: 55 }, dt: 5 * 60 });
  const hypoxia = round({ bloodOxygen: { oxygenDeficit: 0.5 }, dt: 5 * 60 });
  const hypotension = round({ blood: { systolicMmHg: 75 }, dt: 5 * 60 });
  const cold = round({ thermoregulation: { coreTemperatureC: 35 }, dt: 5 * 60 });

  for (const state of [exercise, hypo, hypoxia, hypotension, cold]) {
    assert.ok(state.sympatheticMm > 20, `expected sympatheticMm > 20, got ${state.sympatheticMm}`);
    assert.ok(Number.isFinite(state.sympatheticMm));
    assert.ok(Number.isFinite(state.parasympatheticMm));
    assertJsonValue(state);
  }
});

test('autonomic timing: ignores startle when awake, avoids overnight 74 mg/dL & 36.55 C false triggers, and differentiates sleep entry & REM', () => {
  const awakeStartleIgnored = round({
    sleep: { sleeping: false, sleepStage: 'awake' },
    actions: [{ type: 'wake_up', startle: true }],
  });
  assert.equal(awakeStartleIgnored.sympatheticMm, 0);
  assert.equal(awakeStartleIgnored.startleActive, false);

  const overnightSteadySleep = round({
    sleep: { sleeping: true, sleepStage: 'deep' },
    glucose: { concentrationMgDl: 74 },
    thermoregulation: { coreTemperatureC: 36.55, setpointC: 36.55 },
    blood: { systolicMmHg: 103 },
  });
  assert.equal(overnightSteadySleep.sympatheticMm, 0, 'overnight fasting 74 mg/dL and 36.55 C sleep must not spike sympathetic');

  const remSleep = round({
    state: { sympatheticMm: 0, parasympatheticMm: 70, startleActive: false },
    sleep: { sleeping: true, sleepStage: 'rem' },
    dt: 5 * 60,
  });
  assert.ok(remSleep.sympatheticMm > 5 && remSleep.sympatheticMm <= 10);
  assert.equal(remSleep.startleActive, false);

  const enteringSleep = round({
    state: { sympatheticMm: 50, parasympatheticMm: 20, startleActive: false },
    sleep: { sleeping: false, sleepStage: 'awake' },
    physicalActivity: { remainingExerciseMin: 10, intensity: 0.8 },
    actions: [{ type: 'sleep' }],
    dt: 60,
  });
  assert.ok(enteringSleep.sympatheticMm < 50, 'sleep entry stops exercise drive immediately');
  assert.ok(enteringSleep.parasympatheticMm > 20, 'sleep entry immediately begins shifting parasympathetic upward');
});


test('only a valid orgasm triggers sympathetic burst and afterglow raises parasympathetic tone', () => {
  const belowThreshold = round({
    sexualResponse: { arousalMm: 60, lastOrgasmAtSimMin: null, afterglowMm: 0 },
    actions: [{ type: 'orgasm' }],
  });
  assert.equal(belowThreshold.sympatheticMm, 0);

  const released = round({
    sexualResponse: { arousalMm: 80, lastOrgasmAtSimMin: null, afterglowMm: 0 },
    actions: [{ type: 'orgasm' }],
  });
  assert.equal(released.sympatheticMm, 70);

  const resting = round({
    sexualResponse: { arousalMm: 0, lastOrgasmAtSimMin: null, afterglowMm: 0 },
    pituitary: { oxytocinPgMl: 2 },
    reward: { hedonicMm: 15 },
  });
  const afterglow = round({
    sexualResponse: { arousalMm: 0, lastOrgasmAtSimMin: 1, afterglowMm: 80 },
    pituitary: { oxytocinPgMl: 2 },
    reward: { hedonicMm: 15 },
  });
  assert.ok(afterglow.parasympatheticMm > resting.parasympatheticMm);
});
