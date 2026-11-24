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
  milkRequestMl: 0,
  milkMl: 0,
  lactoseRequestG: 0,
  lactoseG: 0,
  fullnessMm: 0,
};

const LACTATING_STATE = {
  ...EMPTY_STATE,
  lactating: true,
};

function round({ prev = EMPTY_STATE, pituitary, dt = 60, writes = [] } = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'mammaryGlands') return prev;
      if (partId === 'pituitary') return pituitary;
      return undefined;
    },
    actions: [],
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

test('mammary glands export the organ module contract', () => {
  assert.equal(id, 'mammaryGlands');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(initialState, EMPTY_STATE);
  assert.deepEqual(fields, {
    lactating: { unit: '1', mode: 'absolute' },
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

test('mammary parameters are design values with no source', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'mammaryGlands');
  const byId = Object.fromEntries(
    parameterFile.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'mammaryGlands.basalMilkRateMlPerMin',
    'mammaryGlands.fullnessDecayHalfTimeMin',
    'mammaryGlands.fullnessGainPerMl',
    'mammaryGlands.lactoseGPerMl',
  ]);
  for (const [parameterId, value, unit] of [
    ['mammaryGlands.basalMilkRateMlPerMin', 0.5, 'mL/min'],
    ['mammaryGlands.lactoseGPerMl', 0.07, 'g/mL'],
    ['mammaryGlands.fullnessGainPerMl', 4, 'mm/mL'],
    ['mammaryGlands.fullnessDecayHalfTimeMin', 30, 'min'],
  ]) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
    assert.equal(parameterValues[parameterId], value, `${parameterId}: loader value`);
  }
});

test('non-lactating default produces zero requests and decays fullness smoothly toward zero', () => {
  const idle = round({ pituitary: { prolactinRelative: 3 }, dt: 60 });
  assert.deepEqual(idle, EMPTY_STATE);

  const decaying = round({
    prev: { ...EMPTY_STATE, fullnessMm: 60, milkMl: 0 },
    pituitary: { prolactinRelative: 2 },
    dt: 1800,
  });
  assert.equal(decaying.lactating, false);
  assert.equal(decaying.milkRequestMl, 0);
  assert.equal(decaying.lactoseRequestG, 0);
  assertClose(decaying.fullnessMm, 30, '30 min half-time decay toward 0');
});

test('a missing pituitary falls back to prolactin 1 and basal production when lactating', () => {
  const written = round({ prev: LACTATING_STATE, dt: 60 });
  assert.deepEqual(written, {
    lactating: true,
    milkRequestMl: 0.5,
    milkMl: 0,
    lactoseRequestG: 0.035,
    lactoseG: 0,
    fullnessMm: 2,
  });
});

test('the lactating request scales with prolactin and dtMin', () => {
  const oneMinute = round({ prev: LACTATING_STATE, pituitary: { prolactinRelative: 2.5 }, dt: 60 });
  assert.equal(oneMinute.milkRequestMl, 1.25);
  assertClose(oneMinute.lactoseRequestG, 0.0875, 'lactose at 2.5x');
  assert.equal(oneMinute.fullnessMm, 5);

  const halfMinute = round({ prev: LACTATING_STATE, pituitary: { prolactinRelative: 1 }, dt: 30 });
  assert.equal(halfMinute.milkRequestMl, 0.25);
  assertClose(halfMinute.lactoseRequestG, 0.0175, 'lactose at half a minute');

  const twoMinutes = round({ prev: LACTATING_STATE, pituitary: { prolactinRelative: 1 }, dt: 120 });
  assert.equal(twoMinutes.milkRequestMl, 1);
  assertClose(twoMinutes.lactoseRequestG, 0.07, 'lactose at two minutes');
});

test('fullness rises on unemptied production and decays smoothly without permanent ratcheting', () => {
  const rising = round({
    prev: { ...LACTATING_STATE, fullnessMm: 10, milkMl: 0.5 },
    pituitary: { prolactinRelative: 2 },
    dt: 60,
  });
  assert.equal(rising.milkRequestMl, 1);
  assertClose(rising.fullnessMm, 10 * (2 ** (-1 / 30)) + 4 * (1 - 0.5), 'rising fullness');
  assert.ok(rising.fullnessMm > 10);

  const steadyDecay = round({
    prev: { ...LACTATING_STATE, fullnessMm: 10, milkMl: 1 },
    pituitary: { prolactinRelative: 2 },
    dt: 60,
  });
  assertClose(steadyDecay.fullnessMm, 10 * (2 ** (-1 / 30)), 'steady payout decays fullness');
  assert.ok(steadyDecay.fullnessMm < 10);

  const falling = round({
    prev: { ...LACTATING_STATE, fullnessMm: 10, milkMl: 2 },
    pituitary: { prolactinRelative: 2 },
    dt: 60,
  });
  assertClose(falling.fullnessMm, 10 * (2 ** (-1 / 30)) - 4, 'falling fullness');

  const empty = round({
    prev: { ...LACTATING_STATE, fullnessMm: 1, milkMl: 2 },
    pituitary: { prolactinRelative: 1 },
    dt: 60,
  });
  assert.equal(empty.fullnessMm, 0);

  const saturated = round({
    prev: { ...LACTATING_STATE, fullnessMm: 99 },
    pituitary: { prolactinRelative: 2 },
    dt: 600,
  });
  assert.equal(saturated.milkRequestMl, 10);
  assert.equal(saturated.fullnessMm, 100);
});

test('actual milk and lactose are reset every write and never accumulate', () => {
  const written = round({
    prev: {
      lactating: true,
      milkRequestMl: 9,
      milkMl: 1.5,
      lactoseRequestG: 9,
      lactoseG: 0.1,
      fullnessMm: 4,
    },
    pituitary: { prolactinRelative: 2 },
    dt: 60,
  });
  assert.equal(written.lactating, true);
  assert.equal(written.milkRequestMl, 1);
  assert.equal(written.milkMl, 0);
  assert.equal(written.lactoseRequestG, 0.07);
  assert.equal(written.lactoseG, 0);
  assertClose(written.fullnessMm, 4 * (2 ** (-1 / 30)) + 4 * (1 - 1.5), 'fullness');
});

test('an old or partial save falls back to non-lactating zero without producing NaN', () => {
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
    pituitary: { prolactinRelative: 1 },
    dt: 60,
  });
  assert.equal(invalid.lactating, true);
  for (const [key, value] of Object.entries(invalid)) {
    if (key !== 'lactating') assert.ok(Number.isFinite(value), key);
  }
});

test('missing body fluid and glucose are irrelevant to the request', () => {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'mammaryGlands') return LACTATING_STATE;
      if (partId === 'pituitary') return { prolactinRelative: 1 };
      return undefined;
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].milkRequestMl, 0.5);
});

test('a loaded pituitary with an invalid prolactin reading fails before writing', () => {
  const invalid = [
    { label: 'null pituitary', pituitary: null },
    { label: 'empty pituitary', pituitary: {} },
    { label: 'NaN prolactin', pituitary: { prolactinRelative: Number.NaN } },
    { label: 'infinite prolactin', pituitary: { prolactinRelative: Number.POSITIVE_INFINITY } },
    { label: 'negative prolactin', pituitary: { prolactinRelative: -0.1 } },
    { label: 'string prolactin', pituitary: { prolactinRelative: '1' } },
  ];

  for (const { label, pituitary } of invalid) {
    const writes = [];
    assert.throws(
      () => round({ pituitary, writes }),
      /mammaryGlands/,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('mammary output stays finite and JSON-safe for extreme inputs', () => {
  const cases = [
    {},
    { pituitary: { prolactinRelative: 0 }, dt: 1800 },
    { pituitary: { prolactinRelative: 1e9 }, dt: 3600 },
    {
      prev: { ...EMPTY_STATE, fullnessMm: 100, milkMl: 1e9 },
      pituitary: { prolactinRelative: 1e9 },
      dt: 3600,
    },
  ];

  for (const parts of cases) {
    const written = round(parts);
    for (const [field, value] of Object.entries(written)) {
      if (field === 'lactating') assert.equal(typeof value, 'boolean');
      else assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
