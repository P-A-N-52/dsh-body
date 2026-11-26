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

function round({
  state,
  ovaries,
  sexualResponse,
  pituitary,
  testes,
  actions = [],
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'uterus') return state;
      if (partId === 'ovaries') return ovaries;
      if (partId === 'sexualResponse') return sexualResponse;
      if (partId === 'pituitary') return pituitary;
      if (partId === 'testes') return testes;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written: writes[writes.length - 1], writes, transfers };
}

function ovariesAt(cycleDay, estradiolPmolL = 139.46, progesteroneNmolL = 1.27, phase) {
  return {
    cycleDay,
    phase: phase ?? (cycleDay < 16.9 ? 'follicular' : cycleDay < 17.9 ? 'ovulatory' : 'luteal'),
    estradiolPmolL,
    progesteroneNmolL,
  };
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

test('uterus exports the bleeding, cramp, contraction and congestion contract', () => {
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
    contractionMm: { unit: 'mm', mode: 'absolute' },
    pelvicCongestionMm: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    endometriumRelative: 0.1,
    crampMm: 0,
    bleedingRequestMl: 0,
    bleedingMl: 0,
    contractionMm: 0,
    pelvicCongestionMm: 0,
  });

  const { written, writes, transfers } = round();
  assert.equal(writes.length, 1);
  assert.deepEqual(transfers, []);
  assert.equal(written.crampMm, 0);
  assert.equal(written.bleedingRequestMl, 0);
  assert.equal(written.bleedingMl, 0);
  assert.equal(written.contractionMm, 0);
  assert.equal(written.pelvicCongestionMm, 0);
  assertClose(
    written.endometriumRelative,
    0.1 * 2 ** (-1 / 1440 / 2),
    'without ovaries the endometrium approaches zero',
  );
});

test('the uterus parameters carry cycle, bleeding, endometrium and contraction defaults', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'uterus');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expected = {
    'uterus.mensesDays': { value: 4, unit: 'd', status: 'prior', source: 'SRC-BULL-2019' },
    'uterus.flowMlPerCycle': { value: 30, unit: 'mL', status: 'design', source: 'SRC-HALLBERG-1966' },
    'uterus.crampPeakMm': { value: 85, unit: 'mm', status: 'design', source: null },
    'uterus.crampDurationDays': { value: 2.5, unit: 'd', status: 'design', source: null },
    'uterus.endometriumHalfTimeDays': { value: 2, unit: 'd', status: 'design', source: null },
    'uterus.lutealEndometriumPlateau': { value: 0.9, unit: '1', status: 'design', source: 'SRC-BAKOS-1994' },
    'uterus.orgasmContractionPeakMm': { value: 68, unit: 'mm', status: 'design', source: 'SRC-BLAICHER-1999' },
    'uterus.contractionHalfTimeMin': { value: 4, unit: 'min', status: 'design', source: null },
    'uterus.congestionHalfTimeMin': { value: 12, unit: 'min', status: 'design', source: null },
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
    Object.fromEntries(Object.entries(expected).map(([parameterId, { value }]) => [parameterId, value])),
  );
});

test('the endometrium approaches absolute-hormone targets with the two day half-time', () => {
  const state = { ...initialState, endometriumRelative: 0.1 };
  const oneDay = round({
    state,
    ovaries: ovariesAt(10, 940, 1),
    dt: 86400,
  }).written;
  assertClose(oneDay.endometriumRelative, 1 + (0.1 - 1) * 2 ** (-1 / 2), 'E2 940 target');

  const halfDay = round({ state, ovaries: ovariesAt(10, 940, 1), dt: 43200 }).written;
  assertClose(halfDay.endometriumRelative, 1 + (0.1 - 1) * 2 ** (-0.5 / 2), 'half-day half-time');

  const fromHigh = round({
    state: { ...initialState, endometriumRelative: 0.9 },
    ovaries: ovariesAt(10, 125, 1),
    dt: 86400,
  }).written;
  assertClose(fromHigh.endometriumRelative, 0.15 + (0.9 - 0.15) * 2 ** (-1 / 2), 'E2 125 target');

  const luteal = round({
    state,
    ovaries: ovariesAt(23, 300, 20),
    dt: 86400,
  }).written;
  assertClose(luteal.endometriumRelative, 0.9 + (0.1 - 0.9) * 2 ** (-1 / 2), 'luteal plateau');
});

test('menses requests flow proportional to the previous endometrium', () => {
  const state = { ...initialState, endometriumRelative: 0.8 };
  const oneMinute = 30 * 0.8 / (4 * 1440);

  const first = round({ state, ovaries: ovariesAt(1), dt: 60 }).written;
  assertClose(first.bleedingRequestMl, oneMinute, 'one minute of menses');

  const doubled = round({ state, ovaries: ovariesAt(1), dt: 120 }).written;
  assertClose(doubled.bleedingRequestMl, 2 * oneMinute, 'the request scales with io.dt');

  for (const cycleDay of [4, 5, 23]) {
    const outside = round({ state, ovaries: ovariesAt(cycleDay), dt: 60 }).written;
    assert.equal(outside.bleedingRequestMl, 0, `cycle day ${cycleDay} is outside menses`);
  }

  assert.ok(first.endometriumRelative < state.endometriumRelative, 'the endometrium approaches the menses target');
  assertClose(first.bleedingRequestMl, oneMinute, 'the request uses the previous endometrium');
});

test('the cramp proxy peaks on the first cycle day and fades by crampDurationDays', () => {
  const crampMm = (cycleDay) => round({ ovaries: ovariesAt(cycleDay) }).written.crampMm;
  assertClose(crampMm(0), 85, 'cycle day 0');
  assertClose(crampMm(1.25), 42.5, 'cycle day 1.25');
  assertClose(crampMm(2), 17, 'cycle day 2');
  assert.equal(crampMm(2.5), 0, 'the cramp duration boundary is excluded');
  assert.equal(crampMm(3), 0, 'after the cramp window');
});

test('orgasm drives contraction and arousal drives pelvic congestion', () => {
  const { written } = round({
    state: initialState,
    ovaries: ovariesAt(10),
    sexualResponse: { arousalMm: 100, phase: 'plateau', lastOrgasmAtSimMin: null },
    simulatedSeconds: 60,
  });
  assert.equal(written.contractionMm, 68);
  assertClose(
    written.pelvicCongestionMm,
    85 * (1 - 2 ** (-1 / 4)),
    'one minute of rising congestion',
  );
});

test('a missing ovaries part keeps the uterus inert', () => {
  const { written, transfers } = round({
    state: {
      endometriumRelative: 0.1,
      crampMm: 50,
      bleedingRequestMl: 2,
      bleedingMl: 0.3,
    },
    dt: 86400,
  });

  assert.equal(written.crampMm, 0);
  assert.equal(written.bleedingRequestMl, 0);
  assert.equal(written.bleedingMl, 0);
  assert.equal(written.contractionMm, 0);
  assert.equal(written.pelvicCongestionMm, 0);
  assertClose(written.endometriumRelative, 0.1 * 2 ** (-1 / 2), 'without ovaries the target is zero');
  assert.deepEqual(transfers, []);
});

test('a loaded ovaries part with missing or invalid absolute fields fails before writing', () => {
  const invalid = [
    ['empty part', {}],
    ['missing cycleDay', { estradiolPmolL: 140, progesteroneNmolL: 1 }],
    ['missing estradiol', { cycleDay: 1, progesteroneNmolL: 1 }],
    ['missing progesterone', { cycleDay: 1, estradiolPmolL: 140 }],
    ['non-finite cycleDay', ovariesAt(Number.NaN)],
    ['infinite cycleDay', ovariesAt(Number.POSITIVE_INFINITY)],
    ['negative cycleDay', ovariesAt(-0.5)],
    ['null cycleDay', ovariesAt(null)],
    ['string cycleDay', ovariesAt('1')],
    ['non-finite estradiol', ovariesAt(1, Number.NaN)],
    ['infinite estradiol', ovariesAt(1, Number.POSITIVE_INFINITY)],
    ['negative estradiol', ovariesAt(1, -0.1)],
    ['non-finite progesterone', ovariesAt(1, 140, Number.NaN)],
    ['negative progesterone', ovariesAt(1, 140, -0.1)],
    ['non-object part', 42],
  ];

  for (const [label, ovaries] of invalid) expectUterusError(ovaries, label);
});

test('every write resets the actual bleeding before the water transfer', () => {
  const { written, transfers } = round({
    state: { ...initialState, endometriumRelative: 0.8, crampMm: 80, bleedingRequestMl: 0.2, bleedingMl: 1.5 },
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
    { label: 'late menses', options: { ovaries: ovariesAt(3.99, 200, 1), dt: 90 } },
    { label: 'luteal', options: { ovaries: ovariesAt(23, 500, 40), dt: 120 } },
    { label: 'ovulatory', options: { ovaries: ovariesAt(17.5, 900, 2) } },
    {
      label: 'partial state',
      options: {
        state: { endometriumRelative: 0.73, crampMm: 12, bleedingRequestMl: 0.004, bleedingMl: 2 },
        ovaries: ovariesAt(3, 200, 1),
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
    assert.ok(written.contractionMm >= 0 && written.contractionMm <= 100, `${label}: contraction range`);
    assert.ok(written.pelvicCongestionMm >= 0 && written.pelvicCongestionMm <= 100, `${label}: congestion range`);
    assert.ok(written.endometriumRelative >= 0 && written.endometriumRelative <= 1, `${label}: endometrium range`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
