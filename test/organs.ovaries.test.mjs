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
const estradiolNadirRelative = 0.1;
const estradiolLutealBumpRelative = 0.5;
const progesteroneBaselineRelative = 0.05;

function round({ state, dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => (partId === 'ovaries' ? state : undefined),
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

test('ovaries exports the menstrual cycle contract without actions or transfers', () => {
  assert.equal(id, 'ovaries');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    cycleDay: { unit: 'd', mode: 'absolute' },
    cycleLengthDays: { unit: 'd', mode: 'absolute' },
    phase: { unit: '-', mode: 'absolute' },
    estradiolRelative: { unit: '1', mode: 'absolute' },
    progesteroneRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(Object.keys(initialState), [
    'cycleDay',
    'cycleLengthDays',
    'phase',
    'estradiolRelative',
    'progesteroneRelative',
  ]);
  assert.equal(initialState.cycleDay, 5);
  assert.equal(initialState.cycleLengthDays, cycleLengthDays);
  assert.equal(initialState.phase, 'follicular');
  assertClose(
    initialState.estradiolRelative,
    estradiolNadirRelative + (1 - estradiolNadirRelative) * (5 / follicularLengthDays),
    'start cycle day estradiol',
    1e-15,
  );
  assert.equal(initialState.progesteroneRelative, progesteroneBaselineRelative);

  const { written, writes, transfers } = round({ state: initialState, dt: 0 });
  assert.equal(writes.length, 1);
  assert.deepEqual(written, initialState);
  assert.deepEqual(transfers, []);
});

test('the menstrual cycle parameters separate Bull cycle lengths from design defaults', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'ovaries');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId), [
    'ovaries.cycleLengthDays',
    'ovaries.follicularLengthDays',
    'ovaries.lutealLengthDays',
    'ovaries.startCycleDay',
    'ovaries.estradiolNadirRelative',
    'ovaries.estradiolLutealBumpRelative',
    'ovaries.progesteroneBaselineRelative',
  ]);

  const expected = [
    ['ovaries.cycleLengthDays', 29.3, 'd', 'prior', 'SRC-BULL-2019'],
    ['ovaries.follicularLengthDays', 16.9, 'd', 'prior', 'SRC-BULL-2019'],
    ['ovaries.lutealLengthDays', 12.4, 'd', 'prior', 'SRC-BULL-2019'],
    ['ovaries.startCycleDay', 5, 'd', 'design', null],
    ['ovaries.estradiolNadirRelative', 0.1, '1', 'design', null],
    ['ovaries.estradiolLutealBumpRelative', 0.5, '1', 'design', null],
    ['ovaries.progesteroneBaselineRelative', 0.05, '1', 'design', null],
  ];
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

test('cycleDay advances by dtMin / 1440 and wraps at cycleLengthDays', () => {
  const oneMinuteLater = stateAt(16.9, 60);
  assertClose(
    oneMinuteLater.cycleDay,
    16.9 + 1 / 1440,
    'one minute advances the cycle day',
  );

  const wrapped = round({ state: { cycleDay: 29.2 }, dt: 1440 * 60 }).written;
  assertClose(
    wrapped.cycleDay,
    29.2 + 1 - cycleLengthDays,
    'one day past 29.2 wraps at 29.3',
  );
  assert.equal(wrapped.cycleLengthDays, cycleLengthDays);
  assert.equal(wrapped.phase, 'follicular');
  assertClose(
    wrapped.estradiolRelative,
    estradiolNadirRelative
      + (1 - estradiolNadirRelative)
        * ((29.2 + 1 - cycleLengthDays) / follicularLengthDays),
    'wrapped estradiol',
  );
  assert.equal(wrapped.progesteroneRelative, progesteroneBaselineRelative);

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

test('estradiolRelative anchors the design piecewise linear curve', () => {
  const anchors = [
    [0, estradiolNadirRelative],
    [follicularLengthDays, 1],
    [follicularLengthDays + 1, estradiolNadirRelative],
    [midLutealCycleDay, estradiolLutealBumpRelative],
    [cycleLengthDays, estradiolNadirRelative],
  ];
  for (const [cycleDay, expected] of anchors) {
    assertClose(
      stateAt(cycleDay).estradiolRelative,
      expected,
      `estradiol at day ${cycleDay}`,
    );
  }
  assertClose(
    stateAt(follicularLengthDays / 2).estradiolRelative,
    estradiolNadirRelative + (1 - estradiolNadirRelative) / 2,
    'the follicular rise is linear',
  );
  assertClose(
    stateAt(midLutealCycleDay + (cycleLengthDays - midLutealCycleDay) / 2).estradiolRelative,
    estradiolLutealBumpRelative - (estradiolLutealBumpRelative - estradiolNadirRelative) / 2,
    'the late luteal fall is linear',
  );
});

test('progesteroneRelative anchors the design luteal curve', () => {
  assertClose(stateAt(0).progesteroneRelative, progesteroneBaselineRelative, 'day 0');
  assertClose(
    stateAt(follicularLengthDays).progesteroneRelative,
    progesteroneBaselineRelative,
    'ovulation day',
  );
  assertClose(
    stateAt(follicularLengthDays + 1).progesteroneRelative,
    progesteroneBaselineRelative,
    'the day after ovulation',
  );
  assertClose(stateAt(midLutealCycleDay).progesteroneRelative, 1, 'mid-luteal peak');
  assertClose(
    stateAt(cycleLengthDays).progesteroneRelative,
    progesteroneBaselineRelative,
    'cycle end',
  );
});

test('a start on cycle day 0 begins at the estradiol nadir and progesterone baseline', () => {
  const firstDay = stateAt(0);
  assert.equal(firstDay.cycleDay, 0);
  assert.equal(firstDay.phase, 'follicular');
  assert.equal(firstDay.estradiolRelative, estradiolNadirRelative);
  assert.equal(firstDay.progesteroneRelative, progesteroneBaselineRelative);
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
      'estradiolRelative',
      'progesteroneRelative',
    ]) {
      assert.ok(Number.isFinite(written[field]), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
