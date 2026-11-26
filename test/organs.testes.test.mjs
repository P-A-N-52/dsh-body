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
} from '../organs/human-organs/testes/testosterone.ts';

const parametersUrl = new URL(
  '../organs/human-organs/testes/testosterone.parameters.json',
  import.meta.url,
);

const baselineRelative = 1;
const circadianAmplitude = 0.1;
const responseHalfTimeMin = 60;

function round({ state, dt = 60, simulatedSeconds = 0, actions = [] } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => (partId === 'testes' ? state : undefined),
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function targetAt(simulatedSeconds) {
  const hour = (simulatedSeconds / 3600) % 24;
  return baselineRelative
    + circadianAmplitude * Math.cos((2 * Math.PI * (hour - 8)) / 24);
}

function expected(prev, simulatedSeconds, dt) {
  const target = targetAt(simulatedSeconds);
  return target + (prev - target) * 2 ** (-(dt / 60) / responseHalfTimeMin);
}

function assertClose(actual, expectedValue, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expectedValue) <= tolerance,
    `${label}: ${actual} != ${expectedValue}`,
  );
}

test('testes exports the testosterone contract without actions', () => {
  assert.equal(id, 'testes');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    testosteroneRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { testosteroneRelative: 1 });

  const withoutActions = round({
    state: initialState,
    simulatedSeconds: 8 * 3600,
    dt: 0,
  });
  const withActions = round({
    state: initialState,
    simulatedSeconds: 8 * 3600,
    dt: 0,
    actions: [
      { type: 'sex', intensity: 1, durationMin: 10 },
      { type: 'orgasm' },
    ],
  });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(Object.keys(withActions.written), ['testosteroneRelative']);
});

test('the testes parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'testes');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expectedParameters = {
    'testes.baselineRelative': { value: 1, unit: '1' },
    'testes.circadianAmplitude': { value: 0.1, unit: '1' },
    'testes.responseHalfTimeMin': { value: 60, unit: 'min' },
    'testes.phaseShiftHours': { value: 0, unit: 'h' },
    'testes.sleepDebtSuppressionThresholdMm': { value: 60, unit: 'mm', source: 'SRC-LEPROULT-2011' },
    'testes.sleepDebtMaxSuppressionFraction': { value: 0.15, unit: '1', source: 'SRC-LEPROULT-2011' },
    'testes.stressCortisolSuppressionGain': { value: 0.1, unit: '1' },
  };
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expectedParameters).sort());

  for (const [parameterId, { value, unit, source = null }] of Object.entries(expectedParameters)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, source, `${parameterId}: source`);
    assert.ok(Array.isArray(parameter.range), `${parameterId}: range`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expectedParameters).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('testosterone relaxes toward the circadian target with a 60 min half-time', () => {
  const crossing = 14 * 3600;

  const oneHour = round({
    state: { testosteroneRelative: 2 },
    simulatedSeconds: crossing,
    dt: 3600,
  });
  assertClose(oneHour.written.testosteroneRelative, 1.5, '60 min');
  assert.equal(oneHour.writes.length, 1);

  const twoHours = round({
    state: { testosteroneRelative: 2 },
    simulatedSeconds: crossing,
    dt: 7200,
  });
  assertClose(twoHours.written.testosteroneRelative, 1.25, '120 min');

  const downward = round({
    state: { testosteroneRelative: 0.5 },
    simulatedSeconds: crossing,
    dt: 3600,
  });
  assertClose(downward.written.testosteroneRelative, 0.75, 'pull up');

  const zeroDt = round({
    state: { testosteroneRelative: 2 },
    simulatedSeconds: crossing,
    dt: 0,
  });
  assertClose(zeroDt.written.testosteroneRelative, 2, 'zero-length round keeps the state');
});

test('the design circadian term peaks at simulated 08:00 and bottoms out at 20:00', () => {
  // 一小时步长、从基线 1 出发：目标 ±0.1，半时 60 min，所以只走一半。
  const afterOneHourAt = (hour) => round({
    state: initialState,
    simulatedSeconds: hour * 3600,
    dt: 3600,
  }).written.testosteroneRelative;

  assertClose(afterOneHourAt(8), 1.05, '08:00 peak 1.1, half reached');
  assertClose(afterOneHourAt(20), 0.95, '20:00 trough 0.9, half reached');
  assertClose(afterOneHourAt(14), 1, '14:00 crossing');
  assertClose(afterOneHourAt(2), 1, '02:00 crossing');
  assertClose(afterOneHourAt(0), 0.975, '00:00 is not a special case');
});

test('the circadian term follows simulatedSeconds and repeats every 24 simulated hours', () => {
  for (const hour of [0, 1.5, 8, 14, 23.75]) {
    const first = round({
      state: initialState,
      simulatedSeconds: hour * 3600,
      dt: 3600,
    }).written;
    assert.deepEqual(
      round({ state: initialState, simulatedSeconds: (hour + 24) * 3600, dt: 3600 }).written,
      first,
      `hour ${hour} + 24 h`,
    );
    assert.deepEqual(
      round({ state: initialState, simulatedSeconds: (hour + 72) * 3600, dt: 3600 }).written,
      first,
      `hour ${hour} + 72 h`,
    );
  }

  assert.deepEqual(
    round({ state: initialState, simulatedSeconds: 1234, dt: 90 }).written,
    round({ state: initialState, simulatedSeconds: 1234, dt: 90 }).written,
  );
});

test('a missing testes part starts from the baseline 1 before the circadian term', () => {
  const atCrossing = round({ simulatedSeconds: 14 * 3600, dt: 3600 }).written;
  assertClose(atCrossing.testosteroneRelative, 1, 'missing part at 14:00');

  const firstMinute = round({ simulatedSeconds: 60 }).written;
  assertClose(
    firstMinute.testosteroneRelative,
    expected(1, 60, 60),
    'missing part first minute',
  );
});

test('testes output is finite and JSON-safe across hours and deviations', () => {
  const cases = [
    {
      label: 'missing state',
      options: { simulatedSeconds: 14 * 3600, dt: 0 },
    },
    {
      label: 'high testosterone one minute',
      options: { state: { testosteroneRelative: 2 }, simulatedSeconds: 60 },
    },
    {
      label: 'low testosterone one hour',
      options: { state: { testosteroneRelative: 0.4 }, simulatedSeconds: 8 * 3600, dt: 3600 },
    },
    {
      label: 'fractional dt',
      options: { state: { testosteroneRelative: 1.2 }, simulatedSeconds: 90 * 60, dt: 90 },
    },
    {
      label: 'late night',
      options: { state: { testosteroneRelative: 0.95 }, simulatedSeconds: 23.5 * 3600, dt: 60 },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    assert.deepEqual(Object.keys(written), ['testosteroneRelative']);
    assert.ok(Number.isFinite(written.testosteroneRelative), `${label}: finite`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
