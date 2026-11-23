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
} from '../organs/human-organs/uterus/uterus.ts';

const parametersUrl = new URL(
  '../organs/human-organs/uterus/uterus.parameters.json',
  import.meta.url,
);

function round({ state, ovaries, dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'uterus') return state;
      if (partId === 'ovaries') return ovaries;
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

function ovariesAt(cycleDay, estradiolRelative = 0.1, progesteroneRelative = 0.05) {
  return { cycleDay, estradiolRelative, progesteroneRelative };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function expectUterusError(ovaries, label) {
  const writes = [];
  const transfers = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => (partId === 'ovaries' ? ovaries : undefined),
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { writes.push(next); },
      transfer: (...args) => { transfers.push(args); },
    }),
    Error,
    label,
  );
  assert.equal(writes.length, 0, `${label}: the round must not write`);
  assert.equal(transfers.length, 0, `${label}: the round must not transfer`);
}

test('uterus exports the bleeding and cramp contract without actions', () => {
  assert.equal(id, 'uterus');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    endometriumRelative: { unit: '1', mode: 'absolute' },
    crampMm: { unit: 'mm', mode: 'absolute' },
    bleedingRequestMl: { unit: 'mL', mode: 'absolute' },
    bleedingMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  });
  assert.deepEqual(initialState, {
    endometriumRelative: 0.1,
    crampMm: 0,
    bleedingRequestMl: 0,
    bleedingMl: 0,
  });

  const { written, writes, transfers } = round();
  assert.equal(writes.length, 1);
  assert.deepEqual(transfers, []);
  assert.equal(written.crampMm, 0);
  assert.equal(written.bleedingRequestMl, 0);
  assert.equal(written.bleedingMl, 0);
  assertClose(
    written.endometriumRelative,
    0.1 * 2 ** (-1 / 1440 / 2),
    'without ovaries the endometrium approaches zero',
  );
});

test('the uterus parameters carry the Bull bleeding length prior and design defaults', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'uterus');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expected = {
    'uterus.mensesDays': {
      value: 4,
      unit: 'd',
      status: 'prior',
      source: 'SRC-BULL-2019',
    },
    'uterus.flowMlPerCycle': { value: 50, unit: 'mL', status: 'design', source: null },
    'uterus.crampPeakMm': { value: 85, unit: 'mm', status: 'design', source: null },
    'uterus.crampDurationDays': { value: 2.5, unit: 'd', status: 'design', source: null },
    'uterus.endometriumHalfTimeDays': { value: 2, unit: 'd', status: 'design', source: null },
    'uterus.endometriumEstradiolWeight': { value: 0.7, unit: '1', status: 'design', source: null },
    'uterus.endometriumProgesteroneWeight': { value: 0.3, unit: '1', status: 'design', source: null },
  };
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expected).sort());

  for (const [parameterId, { value, unit, status, source }] of Object.entries(expected)) {
    assert.equal(byId[parameterId].value, value, `${parameterId}: value`);
    assert.equal(byId[parameterId].unit, unit, `${parameterId}: unit`);
    assert.equal(byId[parameterId].status, status, `${parameterId}: status`);
    assert.equal(byId[parameterId].source, source, `${parameterId}: source`);
  }
  assert.match(byId['uterus.mensesDays'].note, /Bull/);

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expected).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('the endometrium approaches the hormone target with the two day half-time', () => {
  const target = 0.7 * 1 + 0.3 * 0.05;
  const oneDay = round({
    state: { endometriumRelative: 0.1, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 },
    ovaries: ovariesAt(17, 1, 0.05),
    dt: 86400,
  }).written;
  assertClose(
    oneDay.endometriumRelative,
    target + (0.1 - target) * 2 ** (-1 / 2),
    'one day at E2=1 and P4=0.05',
  );

  const halfDay = round({
    state: { endometriumRelative: 0.1, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 },
    ovaries: ovariesAt(17, 1, 0.05),
    dt: 43200,
  }).written;
  assertClose(
    halfDay.endometriumRelative,
    target + (0.1 - target) * 2 ** (-0.5 / 2),
    'half a day uses the same half-time',
  );

  const fromHigh = round({
    state: { endometriumRelative: 0.9, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 },
    ovaries: ovariesAt(17, 0.1, 0.05),
    dt: 86400,
  }).written;
  assertClose(
    fromHigh.endometriumRelative,
    0.085 + (0.9 - 0.085) * 2 ** (-1 / 2),
    'a high endometrium falls toward the luteal target',
  );
});

test('menses requests flow proportional to the previous endometrium', () => {
  const state = { endometriumRelative: 0.8, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 };
  const oneMinute = 50 * 0.8 / (4.0 * 1440);

  const first = round({ state, ovaries: ovariesAt(1), dt: 60 }).written;
  assertClose(first.bleedingRequestMl, oneMinute, 'one minute of menses');

  const doubled = round({ state, ovaries: ovariesAt(1), dt: 120 }).written;
  assertClose(doubled.bleedingRequestMl, 2 * oneMinute, 'the request scales with io.dt');

  for (const cycleDay of [4.0, 5, 23]) {
    const outside = round({ state, ovaries: ovariesAt(cycleDay), dt: 60 }).written;
    assert.equal(outside.bleedingRequestMl, 0, `cycle day ${cycleDay} is outside menses`);
  }

  const updated = first.endometriumRelative;
  assert.ok(updated < state.endometriumRelative, 'the endometrium still approaches its target');
  assertClose(
    first.bleedingRequestMl,
    oneMinute,
    'the request reads the previous endometrium, not the updated one',
  );
});

test('the cramp proxy peaks on the first cycle day and fades by crampDurationDays', () => {
  const crampMm = (cycleDay) => round({ ovaries: ovariesAt(cycleDay) }).written.crampMm;

  assertClose(crampMm(0), 85, 'cycle day 0');
  assertClose(crampMm(1.25), 42.5, 'cycle day 1.25');
  assertClose(crampMm(2), 17, 'cycle day 2');
  assert.equal(crampMm(2.5), 0, 'the cramp duration boundary is excluded');
  assert.equal(crampMm(3), 0, 'after the cramp window');
});

test('a missing ovaries part keeps the uterus inert', () => {
  const { written, transfers } = round({
    state: { endometriumRelative: 0.1, crampMm: 50, bleedingRequestMl: 2, bleedingMl: 0.3 },
    dt: 86400,
  });

  assert.equal(written.crampMm, 0);
  assert.equal(written.bleedingRequestMl, 0);
  assert.equal(written.bleedingMl, 0);
  assertClose(
    written.endometriumRelative,
    0.1 * 2 ** (-1 / 2),
    'without ovaries the target is zero',
  );
  assert.deepEqual(transfers, []);
});

test('a loaded ovaries part with missing or invalid fields fails the round before writing', () => {
  const invalid = [
    ['empty part', {}],
    ['missing cycleDay', { estradiolRelative: 1, progesteroneRelative: 0.05 }],
    ['missing estradiol', { cycleDay: 1, progesteroneRelative: 0.05 }],
    ['missing progesterone', { cycleDay: 1, estradiolRelative: 1 }],
    ['non-finite cycleDay', ovariesAt(Number.NaN)],
    ['infinite cycleDay', ovariesAt(Number.POSITIVE_INFINITY)],
    ['negative cycleDay', ovariesAt(-0.5)],
    ['null cycleDay', ovariesAt(null)],
    ['string cycleDay', ovariesAt('1')],
    ['non-finite estradiol', ovariesAt(1, Number.NaN)],
    ['infinite estradiol', ovariesAt(1, Number.POSITIVE_INFINITY)],
    ['negative estradiol', ovariesAt(1, -0.1)],
    ['non-finite progesterone', ovariesAt(1, 1, Number.NaN)],
    ['negative progesterone', ovariesAt(1, 1, -0.1)],
    ['non-object part', 42],
  ];

  for (const [label, ovaries] of invalid) {
    expectUterusError(ovaries, label);
  }
});

test('every write resets the actual bleeding before the water transfer', () => {
  const { written, transfers } = round({
    state: { endometriumRelative: 0.8, crampMm: 80, bleedingRequestMl: 0.2, bleedingMl: 1.5 },
    ovaries: ovariesAt(1),
    dt: 60,
  });

  assert.ok(written.bleedingRequestMl > 0);
  assert.equal(written.bleedingMl, 0);
  assert.deepEqual(transfers, []);
});

test('uterus output is finite and JSON-safe across cycle phases', () => {
  const cases = [
    { label: 'missing ovaries', options: {} },
    { label: 'menses start', options: { ovaries: ovariesAt(0) } },
    { label: 'late menses', options: { ovaries: ovariesAt(3.99, 0.3, 0.05), dt: 90 } },
    { label: 'luteal', options: { ovaries: ovariesAt(23, 0.5, 1), dt: 120 } },
    { label: 'ovulatory', options: { ovaries: ovariesAt(17.5, 1, 0.05) } },
    {
      label: 'old state',
      options: {
        state: { endometriumRelative: 0.73, crampMm: 12, bleedingRequestMl: 0.004, bleedingMl: 2 },
        ovaries: ovariesAt(3, 0.2, 0.05),
        dt: 45,
      },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assert.ok(written.crampMm >= 0 && written.crampMm <= 100, `${label}: cramp range`);
    assert.ok(
      written.endometriumRelative >= 0 && written.endometriumRelative <= 1,
      `${label}: endometrium range`,
    );
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
