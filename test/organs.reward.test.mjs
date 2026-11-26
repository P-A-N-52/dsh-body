import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/reward.ts';

function round({
  state = initialState,
  sexualResponse,
  ovaries,
  testes,
  pituitary,
  physicalActivity,
  duodenum,
  stomachGhrelin,
  adrenal,
  interoception,
  uterus,
  sleep,
  actions = [],
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  let written;
  heartbeat({
    read: (partId) => {
      const parts = {
        reward: state,
        sexualResponse,
        ovaries,
        testes,
        pituitary,
        physicalActivity,
        duodenum,
        stomachGhrelin,
        adrenal,
        interoception,
        uterus,
        sleep,
      };
      return parts[partId];
    },
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { written = next; },
  });
  return written;
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

test('reward exports the three design readouts and a stable baseline', () => {
  assert.equal(id, 'reward');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    wantingMm: { unit: 'mm', mode: 'absolute' },
    hedonicMm: { unit: 'mm', mode: 'absolute' },
    satietyMm: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { wantingMm: 25, hedonicMm: 15, satietyMm: 0 });
  assert.deepEqual(round({ dt: 0 }), initialState);
});

test('sexual release raises hedonic reward and satiety, then both decay', () => {
  const released = round({
    sexualResponse: { arousalMm: 80, phase: 'plateau', lastOrgasmAtSimMin: null },
    actions: [{ type: 'orgasm' }],
  });
  assert.equal(released.hedonicMm, 83);
  assert.equal(released.satietyMm, 78);

  const later = round({ state: released, dt: 25 * 60, simulatedSeconds: 26 * 60 });
  assertClose(later.hedonicMm, 49, 'hedonic 25 minute half-time');
  assertClose(later.satietyMm, 78 * 2 ** (-25 / 40), 'satiety 40 minute half-time');
});

test('an orgasm action wakes sleep and emits the reward pulse in the same round', () => {
  const released = round({
    sleep: {
      sleeping: true,
      sleepStage: 'light',
      sleepPressureMm: 80,
      sleepDurationMin: 10,
      wakeEvent: 'none',
    },
    sexualResponse: { arousalMm: 80, phase: 'plateau', lastOrgasmAtSimMin: null },
    actions: [{ type: 'orgasm' }],
  });
  assert.equal(released.hedonicMm, 83);
  assert.equal(released.satietyMm, 78);
});

test('a later sleep action suppresses the pulse from an earlier orgasm action', () => {
  const stillSleeping = round({
    sleep: {
      sleeping: false,
      sleepStage: 'awake',
      sleepPressureMm: 0,
      sleepDurationMin: 0,
      wakeEvent: 'none',
    },
    sexualResponse: { arousalMm: 80, phase: 'plateau', lastOrgasmAtSimMin: null },
    actions: [{ type: 'orgasm' }, { type: 'sleep' }],
  });
  assert.equal(stillSleeping.hedonicMm, 15);
  assert.equal(stillSleeping.satietyMm, 0);
});

test('duodenal nutrient exposure drives hedonic satiety and reduces wanting', () => {
  const baseline = round();
  const fed = round({ duodenum: { nutrientExposure: 8 } });
  assertClose(fed.hedonicMm, 33 + (15 - 33) * 2 ** (-1 / 25), 'meal hedonic target');
  assertClose(fed.satietyMm, 28 * (1 - 2 ** (-1 / 40)), 'meal satiety target');
  assert.ok(fed.wantingMm < baseline.wantingMm, 'post-meal satiety suppresses wanting');
});

test('only moderate exercise adds the hedonic exercise drive', () => {
  const baseline = round().hedonicMm;
  const moderate = round({ physicalActivity: { remainingExerciseMin: 20, intensity: 0.6 } });
  const light = round({ physicalActivity: { remainingExerciseMin: 20, intensity: 0.3 } });
  const maximal = round({ physicalActivity: { remainingExerciseMin: 20, intensity: 1 } });
  assert.ok(moderate.hedonicMm > baseline);
  assert.equal(light.hedonicMm, baseline);
  assert.equal(maximal.hedonicMm, baseline);
});

test('high cortisol and pain suppress reward without producing invalid values', () => {
  const drives = {
    duodenum: { nutrientExposure: 8 },
    physicalActivity: { remainingExerciseMin: 20, intensity: 0.6 },
  };
  const positive = round(drives);
  const stressed = round({
    ...drives,
    adrenal: { cortisolNmolL: 540 },
    interoception: { discomfort: 90 },
  });
  assert.ok(stressed.wantingMm < positive.wantingMm);
  assert.ok(stressed.hedonicMm < positive.hedonicMm);
  for (const value of Object.values(stressed)) assert.ok(Number.isFinite(value));
  assertJsonValue(stressed);
  assert.deepEqual(JSON.parse(JSON.stringify(stressed)), stressed);
});
