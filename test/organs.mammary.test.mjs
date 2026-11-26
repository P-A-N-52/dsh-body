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
} from '../organs/human-organs/mammary-glands/milk.ts';

const parametersUrl = new URL(
  '../organs/human-organs/mammary-glands/milk.parameters.json',
  import.meta.url,
);
const parameterValues = loadParameters(parametersUrl);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

const EMPTY_STATE = {
  lactating: false,
  galactorrhea: false,
  inductionProgress: 0,
  storedMilkMl: 0,
  ejectedMilkMl: 0,
  stimulationMin: 0,
  pendingEjections: [],
  milkRequestMl: 0,
  milkMl: 0,
  lactoseRequestG: 0,
  lactoseG: 0,
  fullnessMm: 0,
};

const LACTATING_STATE = {
  ...EMPTY_STATE,
  lactating: true,
  inductionProgress: 1,
};

function round({ prev = EMPTY_STATE, pituitary, actions = [], dt = 60, writes = [] } = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'mammaryGlands') return prev;
      if (partId === 'pituitary') return pituitary;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds: dt,
    write: (next) => { writes.push(next); },
  });
  return writes[writes.length - 1];
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('mammary glands export the induction, storage and ejection contract', () => {
  assert.equal(id, 'mammaryGlands');
  assert.deepEqual(actionTypes, ['express_milk', 'breastfeed']);
  assert.deepEqual(initialState, EMPTY_STATE);
  assert.deepEqual(fields, {
    lactating: { unit: '1', mode: 'absolute' },
    galactorrhea: { unit: '1', mode: 'absolute' },
    inductionProgress: { unit: '1', mode: 'absolute' },
    storedMilkMl: { unit: 'mL', mode: 'absolute' },
    ejectedMilkMl: { unit: 'mL', mode: 'absolute' },
    stimulationMin: { unit: 'min', mode: 'absolute' },
    pendingEjections: { unit: '1', mode: 'absolute' },
    milkRequestMl: { unit: 'mL', mode: 'absolute' },
    milkMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
    lactoseRequestG: { unit: 'g', mode: 'absolute' },
    lactoseG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    fullnessMm: { unit: 'mm', mode: 'absolute' },
  });
  assertJsonValue(initialState);
});

test('mammary parameters keep their evidence statuses and design values', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'mammaryGlands');
  const byId = Object.fromEntries(
    parameterFile.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expected = {
    'mammaryGlands.basalMilkRateMlPerMin': [0.54, 'mL/min', 'prior', 'SRC-KENT-2006'],
    'mammaryGlands.storageCapacityMl': [360, 'mL', 'prior', 'SRC-KENT-2006'],
    'mammaryGlands.lactoseGPerMl': [0.074, 'g/mL', 'design', null],
    'mammaryGlands.galactorrheaRateMlPerMin': [0.012, 'mL/min', 'design', 'SRC-PAGEWILSON-2007'],
    'mammaryGlands.inductionPrlThresholdNgMl': [45, 'ng/mL', 'design', 'SRC-PAGEWILSON-2007'],
    'mammaryGlands.galactorrheaThreshold': [0.25, '1', 'design', 'SRC-PAGEWILSON-2007'],
    'mammaryGlands.hormonalInductionPerDay': [0.05, '1/d', 'design', 'SRC-PAGEWILSON-2007'],
    'mammaryGlands.stimulatedInductionPerDay': [0.055, '1/d', 'design', null],
    'mammaryGlands.involutionHalfTimeDays': [7, 'd', 'design', null],
    'mammaryGlands.breastfeedPamr': [0.673, '1', 'prior', 'SRC-KENT-2006'],
    'mammaryGlands.expressPamr': [0.75, '1', 'prior', 'SRC-PRIME-2012'],
    'mammaryGlands.engorgementPamrPenaltyPer100Ml': [0.14, '1', 'design', 'SRC-PRIME-2012'],
    'mammaryGlands.letdownOxytocinThresholdPgMl': [5, 'pg/mL', 'design', 'SRC-UVNASMOBERG-2020'],
    'mammaryGlands.fullnessHalfTimeMin': [15, 'min', 'design', null],
  };
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expected).sort());
  for (const [parameterId, [value, unit, status, source]] of Object.entries(expected)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, status, `${parameterId}: status`);
    assert.equal(parameter.source, source, `${parameterId}: source`);
    assert.equal(parameterValues[parameterId], value, `${parameterId}: loader value`);
  }
});

test('non-lactating default produces zero requests and decays fullness smoothly toward zero', () => {
  const idle = round({ pituitary: { prolactinNgMl: 24 }, dt: 60 });
  assert.deepEqual(idle, EMPTY_STATE);

  const decaying = round({
    prev: { ...EMPTY_STATE, fullnessMm: 60 },
    pituitary: { prolactinNgMl: 16 },
    dt: 900,
  });
  assert.equal(decaying.lactating, false);
  assert.equal(decaying.milkRequestMl, 0);
  assert.equal(decaying.lactoseRequestG, 0);
  assertClose(decaying.fullnessMm, 30, '15 min half-time decay toward 0');
});

test('a missing pituitary uses the absolute hormone fallbacks when lactating', () => {
  const written = round({ prev: LACTATING_STATE, dt: 60 });
  assert.deepEqual(written, {
    ...LACTATING_STATE,
    milkRequestMl: 0.54,
    lactoseRequestG: 0.03996,
  });
});

test('the lactating request uses prolactin permission, local inhibition and dtMin', () => {
  const oneMinute = round({ prev: LACTATING_STATE, pituitary: { prolactinNgMl: 24 }, dt: 60 });
  assertClose(oneMinute.milkRequestMl, 0.5184, 'PRL 24 request');
  assertClose(oneMinute.lactoseRequestG, 0.0383616, 'PRL 24 lactose');

  const halfMinute = round({ prev: LACTATING_STATE, pituitary: { prolactinNgMl: 8 }, dt: 30 });
  assertClose(halfMinute.milkRequestMl, 0.0864, 'half-minute request');
  assertClose(halfMinute.lactoseRequestG, 0.0063936, 'half-minute lactose');

  const halfFull = round({
    prev: { ...LACTATING_STATE, storedMilkMl: 180 },
    pituitary: { prolactinNgMl: 25 },
    dt: 60,
  });
  assertClose(halfFull.milkRequestMl, 0.405, 'DF 0.5 inhibits synthesis');
});

test('fullness follows stored milk and decays smoothly without permanent ratcheting', () => {
  const rising = round({
    prev: { ...LACTATING_STATE, storedMilkMl: 100, milkMl: 50, fullnessMm: 10 },
    pituitary: { prolactinNgMl: 25 },
    dt: 60,
  });
  assertClose(rising.storedMilkMl, 150, 'arrived synthesis joins the storage pool');
  const risingTarget = 100 * (150 / 360) ** 1.15;
  const expectedRising = risingTarget + (10 - risingTarget) * 2 ** (-1 / 15);
  assertClose(rising.fullnessMm, expectedRising, 'fullness follows stored milk');
  assert.ok(rising.fullnessMm > 10);

  const decaying = round({
    prev: { ...LACTATING_STATE, fullnessMm: 10 },
    pituitary: { prolactinNgMl: 25 },
    dt: 60,
  });
  assertClose(decaying.fullnessMm, 10 * 2 ** (-1 / 15), 'empty storage decays fullness');

  const saturated = round({
    prev: { ...LACTATING_STATE, storedMilkMl: 360, fullnessMm: 99 },
    pituitary: { prolactinNgMl: 120 },
    dt: 600,
  });
  assert.equal(saturated.milkRequestMl, 0);
  assertClose(saturated.fullnessMm, 100 - 2 ** (-10 / 15), 'fullness approaches the full-storage target');
});

test('actual milk and lactose are reset every write and never accumulate', () => {
  const written = round({
    prev: {
      ...LACTATING_STATE,
      storedMilkMl: 100,
      milkRequestMl: 9,
      milkMl: 1.5,
      lactoseRequestG: 9,
      lactoseG: 0.1,
      fullnessMm: 4,
    },
    pituitary: { prolactinNgMl: 25 },
    dt: 60,
  });
  assert.equal(written.lactating, true);
  assert.equal(written.storedMilkMl, 101.5);
  assert.equal(written.milkMl, 0);
  assert.equal(written.lactoseG, 0);
  assert.ok(written.milkRequestMl > 0);
  assert.ok(written.lactoseRequestG > 0);
});

test('a partial save falls back to non-lactating zero without producing NaN', () => {
  const written = round({ prev: {}, dt: 60 });
  assert.deepEqual(written, EMPTY_STATE);

  const invalid = round({
    prev: {
      lactating: true,
      milkRequestMl: Number.NaN,
      milkMl: Number.NaN,
      lactoseRequestG: Number.NaN,
      lactoseG: Number.NaN,
      fullnessMm: Number.NaN,
    },
    pituitary: { prolactinNgMl: 8 },
    dt: 60,
  });
  assert.equal(invalid.lactating, true);
  for (const [key, value] of Object.entries(invalid)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
  }
  assert.deepEqual(invalid.pendingEjections, []);
});

test('missing body fluid and glucose are irrelevant to the request', () => {
  const writes = [];
  const written = round({ prev: LACTATING_STATE, pituitary: { prolactinNgMl: 25 }, writes });
  assert.equal(writes.length, 1);
  assert.equal(written.milkRequestMl, 0.54);
});

test('a loaded pituitary with an invalid absolute prolactin reading fails before writing', () => {
  const invalid = [
    { label: 'null pituitary', pituitary: null },
    { label: 'empty pituitary', pituitary: {} },
    { label: 'NaN prolactin', pituitary: { prolactinNgMl: Number.NaN } },
    { label: 'infinite prolactin', pituitary: { prolactinNgMl: Number.POSITIVE_INFINITY } },
    { label: 'negative prolactin', pituitary: { prolactinNgMl: -0.1 } },
    { label: 'string prolactin', pituitary: { prolactinNgMl: '25' } },
  ];

  for (const { label, pituitary } of invalid) {
    const writes = [];
    assert.throws(() => round({ pituitary, writes }), /mammaryGlands/, label);
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('ejection requires oxytocin 5 pg/mL and applies one PAMR per action', () => {
  const prev = { ...LACTATING_STATE, storedMilkMl: 100 };
  const action = { type: 'express_milk', durationMin: 15, bilateral: true };
  const belowThreshold = round({
    prev,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 4.9 },
    actions: [action],
  });
  assert.equal(belowThreshold.ejectedMilkMl, 0);
  assert.equal(belowThreshold.storedMilkMl, 100);

  const expressed = round({
    prev,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 5 },
    actions: [action],
  });
  assertClose(expressed.ejectedMilkMl, 75, 'single bilateral expression PAMR');
  assertClose(expressed.storedMilkMl, 25, 'remaining stored milk');

  const continuing = round({
    prev: expressed,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 10 },
  });
  assert.equal(continuing.ejectedMilkMl, 0, 'stimulation continuation does not repeat the session PAMR');
  assert.equal(continuing.storedMilkMl, 25);
  assert.equal(continuing.stimulationMin, 14);

  const breastfed = round({
    prev,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 14 },
    actions: [{ type: 'breastfeed', durationMin: 12 }],
  });
  assertClose(breastfed.ejectedMilkMl, 67.3, 'single breastfeeding PAMR');
});

test('an action remains pending until a later round crosses the oxytocin threshold', () => {
  const prev = { ...LACTATING_STATE, storedMilkMl: 100 };
  const belowThreshold = round({
    prev,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 4.9 },
    actions: [{ type: 'express_milk', durationMin: 15, bilateral: true }],
  });
  assert.equal(belowThreshold.ejectedMilkMl, 0);
  assert.equal(belowThreshold.storedMilkMl, 100);

  const delayed = round({
    prev: belowThreshold,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 6.28 },
  });
  assertClose(delayed.ejectedMilkMl, 75, 'the original action ejects when let-down arrives');
  assertClose(delayed.storedMilkMl, 25, 'the original action is settled only once');
  assert.deepEqual(delayed.pendingEjections, []);

  const continuing = round({
    prev: delayed,
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 10 },
  });
  assert.equal(continuing.ejectedMilkMl, 0);
  assert.equal(continuing.storedMilkMl, 25);
});

test('two ejection actions in one round each apply their own PAMR in order', () => {
  const written = round({
    prev: { ...LACTATING_STATE, storedMilkMl: 100 },
    pituitary: { prolactinNgMl: 25, oxytocinPgMl: 10 },
    actions: [
      { type: 'express_milk', durationMin: 15, bilateral: true },
      { type: 'breastfeed', durationMin: 12 },
    ],
  });
  assertClose(written.ejectedMilkMl, 91.825, '75 mL expression plus 67.3% of the remaining 25 mL');
  assertClose(written.storedMilkMl, 8.175, 'both sessions leave milk for the next action');
  assert.deepEqual(written.pendingEjections, []);
});

test('induction requires high prolactin and repeated stimulation for established lactation', () => {
  let lowPrl = EMPTY_STATE;
  for (let day = 0; day < 5; day++) {
    lowPrl = round({
      prev: lowPrl,
      pituitary: { prolactinNgMl: 25, oxytocinPgMl: 10 },
      actions: [{ type: 'express_milk', durationMin: 120 }],
      dt: 1440 * 60,
    });
  }
  assert.equal(lowPrl.inductionProgress, 0);
  assert.equal(lowPrl.galactorrhea, false);
  assert.equal(lowPrl.lactating, false);

  let highPrlOnly = EMPTY_STATE;
  for (let day = 0; day < 5; day++) {
    highPrlOnly = round({
      prev: highPrlOnly,
      pituitary: { prolactinNgMl: 120 },
      dt: 1440 * 60,
    });
  }
  assertClose(highPrlOnly.inductionProgress, 0.25, 'five days of high PRL');
  assert.equal(highPrlOnly.galactorrhea, true);
  assert.equal(highPrlOnly.lactating, false);
  for (let day = 0; day < 20; day++) {
    highPrlOnly = round({
      prev: highPrlOnly,
      pituitary: { prolactinNgMl: 120 },
      dt: 1440 * 60,
    });
  }
  assert.equal(highPrlOnly.inductionProgress, 0.35, 'hormone-only induction remains capped');
  assert.equal(highPrlOnly.lactating, false);

  let induced = highPrlOnly;
  for (let day = 0; day < 5; day++) {
    induced = round({
      prev: induced,
      pituitary: { prolactinNgMl: 120, oxytocinPgMl: 14 },
      actions: [{ type: 'breastfeed', durationMin: 120 }],
      dt: 1440 * 60,
    });
  }
  assert.equal(induced.inductionProgress, 1);
  assert.equal(induced.lactating, true);
});

test('mammary output stays finite and JSON-safe for extreme inputs', () => {
  const cases = [
    {},
    { pituitary: { prolactinNgMl: 0 }, dt: 1800 },
    { pituitary: { prolactinNgMl: 1e9 }, dt: 3600 },
    {
      prev: { ...EMPTY_STATE, fullnessMm: 100, milkMl: 1e9 },
      pituitary: { prolactinNgMl: 1e9 },
      dt: 3600,
    },
  ];

  for (const parts of cases) {
    const written = round(parts);
    for (const [field, value] of Object.entries(written)) {
      if (field === 'lactating' || field === 'galactorrhea') assert.equal(typeof value, 'boolean');
      else if (field === 'pendingEjections') assert.deepEqual(value, []);
      else assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
