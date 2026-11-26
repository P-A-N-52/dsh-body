import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/ovaries/menstrual-cycle.ts';

const parametersUrl = new URL(
  '../organs/human-organs/ovaries/menstrual-cycle.parameters.json',
  import.meta.url,
);

const cycleLengthDays = 29.3;
const follicularLengthDays = 16.9;
const lutealLengthDays = 12.4;
const midLutealCycleDay = follicularLengthDays + lutealLengthDays / 2;

function round({ state, pituitary, mammaryGlands, dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'ovaries') return state;
      if (partId === 'pituitary') return pituitary;
      if (partId === 'mammaryGlands') return mammaryGlands;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written: writes[writes.length - 1], writes, transfers };
}

function stateAt(cycleDay, dt = 0) {
  return round({ state: { cycleDay }, dt }).written;
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function assertHormones(state, expected, label) {
  assertClose(state.estradiolPmolL, expected[0], `${label}: E2`);
  assertClose(state.progesteroneNmolL, expected[1], `${label}: P4`);
  assertClose(state.lhIuL, expected[2], `${label}: LH`);
  assertClose(state.fshIuL, expected[3], `${label}: FSH`);
}

test('ovaries exports the absolute hormone cycle contract without actions or transfers', () => {
  assert.equal(id, 'ovaries');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    cycleDay: { unit: 'd', mode: 'absolute' },
    cycleLengthDays: { unit: 'd', mode: 'absolute' },
    phase: { unit: '-', mode: 'absolute' },
    estradiolPmolL: { unit: 'pmol/L', mode: 'absolute' },
    progesteroneNmolL: { unit: 'nmol/L', mode: 'absolute' },
    lhIuL: { unit: 'IU/L', mode: 'absolute' },
    fshIuL: { unit: 'IU/L', mode: 'absolute' },
    cycleSuppression: { unit: '1', mode: 'absolute' },
    highProlactinDays: { unit: 'd', mode: 'absolute' },
  });
  assert.deepEqual(Object.keys(initialState), [
    'cycleDay',
    'cycleLengthDays',
    'phase',
    'estradiolPmolL',
    'progesteroneNmolL',
    'lhIuL',
    'fshIuL',
    'cycleSuppression',
    'highProlactinDays',
  ]);
  assert.equal(initialState.cycleDay, 5);
  assert.equal(initialState.cycleLengthDays, cycleLengthDays);
  assert.equal(initialState.phase, 'follicular');
  assert.equal(initialState.cycleSuppression, 0);
  assert.equal(initialState.highProlactinDays, 0);

  const { written, writes, transfers } = round({ state: initialState, dt: 0 });
  assert.equal(writes.length, 1);
  assert.deepEqual(written, initialState);
  assert.deepEqual(transfers, []);
});

test('the menstrual cycle parameters separate Bull cycle lengths from suppression defaults', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'ovaries');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expected = [
    ['ovaries.cycleLengthDays', 29.3, 'd', 'prior', 'SRC-BULL-2019'],
    ['ovaries.follicularLengthDays', 16.9, 'd', 'prior', 'SRC-BULL-2019'],
    ['ovaries.lutealLengthDays', 12.4, 'd', 'prior', 'SRC-BULL-2019'],
    ['ovaries.startCycleDay', 5, 'd', 'design', null],
    ['ovaries.hyperprolactinemiaThresholdNgMl', 35, 'ng/mL', 'design', 'SRC-HOSKOVA-2022'],
    ['ovaries.suppressionOnsetDays', 7, 'd', 'design', 'SRC-PAGEWILSON-2007'],
    ['ovaries.suppressionHalfTimeDays', 5, 'd', 'design', 'SRC-PAGEWILSON-2007'],
  ];
  assert.deepEqual(Object.keys(byId), expected.map(([parameterId]) => parameterId));
  for (const [parameterId, value, unit, status, source] of expected) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, status, `${parameterId}: status`);
    assert.equal(parameter.source, source, `${parameterId}: source`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(expected.map(([parameterId, value]) => [parameterId, value])),
  );
});

test('cycleDay advances by dtMin / 1440 and wraps to the matching Stricker point', () => {
  const oneMinuteLater = stateAt(16.9, 60);
  assertClose(oneMinuteLater.cycleDay, 16.9 + 1 / 1440, 'one minute advances the cycle day');

  const wrapped = round({ state: { cycleDay: 29.2 }, dt: 1440 * 60 }).written;
  assertClose(wrapped.cycleDay, 0.9, 'one day past 29.2 wraps at 29.3');
  assert.equal(wrapped.cycleLengthDays, cycleLengthDays);
  assert.equal(wrapped.phase, 'follicular');
  const direct = stateAt(0.9);
  assertHormones(wrapped, [direct.estradiolPmolL, direct.progesteroneNmolL, direct.lhIuL, direct.fshIuL], 'wrapped hormones');

  const beforeWrap = round({ state: { cycleDay: 0.2 }, dt: 1440 * 60 }).written;
  assertClose(beforeWrap.cycleDay, 1.2, 'no wrap before the cycle length');
});

test('phase boundaries are follicular < 16.9 <= ovulatory < 17.9 <= luteal', () => {
  assert.equal(stateAt(0).phase, 'follicular');
  assert.equal(stateAt(16.899999).phase, 'follicular');
  assert.equal(stateAt(follicularLengthDays).phase, 'ovulatory');
  assert.equal(stateAt(17.899999).phase, 'ovulatory');
  assert.equal(stateAt(follicularLengthDays + 1).phase, 'luteal');
  assert.equal(stateAt(29.299999).phase, 'luteal');
  assert.equal(stateAt(cycleLengthDays).phase, 'follicular', 'the cycle length wraps to day 0');
});

test('Stricker anchors set E2, P4, LH and FSH in absolute units', () => {
  assertHormones(stateAt(0), [139.46, 1.27, 2.28, 4.59], 'day 0 / aligned day -15');
  assertHormones(stateAt(follicularLengthDays), [671.06, 2.54, 41.19, 12.82], 'ovulation / aligned day 0');
  assertHormones(stateAt(23.1), [521.505, 39.75, 4.09, 3.14], 'mid-luteal interpolation');
  assertHormones(stateAt(cycleLengthDays), [139.46, 1.27, 2.28, 4.59], 'cycle wrap');
});

test('a start on cycle day 0 emits the first aligned Stricker measurements', () => {
  const firstDay = stateAt(0);
  assert.equal(firstDay.cycleDay, 0);
  assert.equal(firstDay.phase, 'follicular');
  assert.equal(firstDay.cycleSuppression, 0);
  assertHormones(firstDay, [139.46, 1.27, 2.28, 4.59], 'first day');
});

test('high prolactin does not suppress the cycle during the first seven days', () => {
  let state = stateAt(5);
  for (let day = 0; day < 6; day++) {
    state = round({
      state,
      pituitary: { prolactinNgMl: 120 },
      dt: 1440 * 60,
    }).written;
  }
  assert.equal(state.highProlactinDays, 6);
  assert.equal(state.cycleSuppression, 0);

  state = round({
    state,
    pituitary: { prolactinNgMl: 120 },
    dt: 1440 * 60,
  }).written;
  assert.equal(state.highProlactinDays, 7);
  assert.equal(state.cycleSuppression, 0, 'suppression starts only after seven full days');

  state = round({
    state,
    pituitary: { prolactinNgMl: 120 },
    dt: 1440 * 60,
  }).written;
  assert.equal(state.highProlactinDays, 8);
  assertClose(state.cycleSuppression, 0.95 * (1 - 2 ** (-1 / 5)), 'first post-onset day');

  const recovered = round({
    state,
    pituitary: { prolactinNgMl: 8 },
    dt: 1440 * 60,
  }).written;
  assert.equal(recovered.highProlactinDays, 0);
  assert.ok(recovered.cycleSuppression < state.cycleSuppression);
});

test('established lactation uses its independent immediate suppression path', () => {
  const written = round({
    state: stateAt(5),
    pituitary: { prolactinNgMl: 8 },
    mammaryGlands: { lactating: true, stimulationMin: 0 },
    dt: 1440 * 60,
  }).written;
  assert.equal(written.highProlactinDays, 0);
  assertClose(written.cycleSuppression, 0.65 * (1 - 2 ** (-1 / 5)), 'lactation without suckling');
});

test('large-dt cycleDay agrees with 60s steps across suppression onset and recovery', () => {
  function runFineTicks(initial, pituitary, days) {
    let cur = initial;
    const steps = days * 1440;
    for (let i = 0; i < steps; i++) {
      cur = round({ state: cur, pituitary, dt: 60, simulatedSeconds: (i + 1) * 60 }).written;
    }
    return cur;
  }

  const onsetSeed = { cycleDay: 5, cycleSuppression: 0, highProlactinDays: 7 };
  const coarseRising = round({
    state: onsetSeed,
    pituitary: { prolactinNgMl: 120 },
    dt: 1440 * 60,
  }).written;
  const fineRising = runFineTicks(onsetSeed, { prolactinNgMl: 120 }, 1);
  assertClose(coarseRising.cycleSuppression, fineRising.cycleSuppression, '1d rising suppression matches 60s steps', 1e-10);
  assertClose(coarseRising.cycleDay, fineRising.cycleDay, '1d rising cycleDay matches 60s steps', 1e-4);

  const preOnsetSeed = { cycleDay: 5, cycleSuppression: 0, highProlactinDays: 0 };
  const coarseCross = round({
    state: preOnsetSeed,
    pituitary: { prolactinNgMl: 120 },
    dt: 8 * 1440 * 60,
  }).written;
  const fineCross = runFineTicks(preOnsetSeed, { prolactinNgMl: 120 }, 8);
  assertClose(coarseCross.cycleSuppression, fineCross.cycleSuppression, '8d onset-crossing suppression matches 60s steps', 1e-10);
  assertClose(coarseCross.cycleDay, fineCross.cycleDay, '8d onset-crossing cycleDay matches 60s steps', 2e-4);

  const recoverySeed = { cycleDay: 12, cycleSuppression: 0.95, highProlactinDays: 30 };
  const coarseRecovery = round({
    state: recoverySeed,
    pituitary: { prolactinNgMl: 8 },
    dt: 1440 * 60,
  }).written;
  const fineRecovery = runFineTicks(recoverySeed, { prolactinNgMl: 8 }, 1);
  assertClose(coarseRecovery.cycleSuppression, fineRecovery.cycleSuppression, '1d recovery suppression matches 60s steps', 1e-10);
  assertClose(coarseRecovery.cycleDay, fineRecovery.cycleDay, '1d recovery cycleDay matches 60s steps', 1e-4);

  const zeroDt = round({
    state: { cycleDay: 12, cycleSuppression: 0.1, highProlactinDays: 3 },
    pituitary: { prolactinNgMl: 8 },
    mammaryGlands: { lactating: true, stimulationMin: 0 },
    dt: 0,
  }).written;
  assert.equal(zeroDt.cycleDay, 12);
  assert.equal(zeroDt.cycleSuppression, 0.1);
  assert.equal(zeroDt.highProlactinDays, 3);
});

test('ovaries output is finite and JSON-safe across the cycle and its wrap', () => {
  const cases = [
    { label: 'start', cycleDay: 5, dt: 60 },
    { label: 'ovulation', cycleDay: follicularLengthDays, dt: 60 },
    { label: 'mid-luteal', cycleDay: midLutealCycleDay, dt: 60 },
    { label: 'wrap', cycleDay: 29.2, dt: 1440 * 60 },
    { label: 'fractional dt', cycleDay: 23.1, dt: 90 },
    { label: 'cycle length', cycleDay: cycleLengthDays, dt: 60 },
  ];

  for (const { label, cycleDay, dt } of cases) {
    const { written, writes } = round({ state: { cycleDay }, dt });
    assert.equal(writes.length, 1, label);
    assert.equal(typeof written.phase, 'string', `${label}: phase must be a string`);
    for (const field of [
      'cycleDay',
      'cycleLengthDays',
      'estradiolPmolL',
      'progesteroneNmolL',
      'lhIuL',
      'fshIuL',
      'cycleSuppression',
      'highProlactinDays',
    ]) {
      assert.ok(Number.isFinite(written[field]), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
