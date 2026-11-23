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
} from '../organs/human-organs/thyroid/thyroid.ts';

const parametersUrl = new URL(
  '../organs/human-organs/thyroid/thyroid.parameters.json',
  import.meta.url,
);

const HALF_TIME_MIN = 60;

function round({ state, pituitary, dt = 60, actions = [] } = {}) {
  const writes = [];
  const transfers = [];
  const notifications = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'thyroid') return state;
      if (partId === 'pituitary') return pituitary;
      throw new Error(`unexpected read: ${partId}`);
    },
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
    notify: (...args) => { notifications.push(args); },
  });
  return { written: writes.at(-1), writes, transfers, notifications };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function expectUpstreamError({ state, pituitary, dt = 60 }, label) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'thyroid') return state;
        if (partId === 'pituitary') return pituitary;
        throw new Error(`unexpected read: ${partId}`);
      },
      actions: [],
      dt,
      simulatedSeconds: 60,
      write: (next) => { writes.push(next); },
    }),
    Error,
    label,
  );
  assert.equal(writes.length, 0, `${label}: the round must not write`);
}

test('thyroid exports the endocrine organ contract without actions or transfers', () => {
  assert.equal(id, 'thyroid');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    thyroxineRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { thyroxineRelative: 1 });

  const transfers = [];
  const notifications = [];
  const withActions = round({
    state: initialState,
    pituitary: { tshRelative: 3 },
    actions: [{ type: 'eat', energyKcal: 100 }, { type: 'drink', volumeMl: 240 }],
  });
  const withoutActions = round({ state: initialState, pituitary: { tshRelative: 3 } });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(withActions.transfers, transfers);
  assert.deepEqual(withActions.notifications, notifications);
  assert.deepEqual(Object.keys(withActions.written), ['thyroxineRelative']);
});

test('thyroid parameter defaults are a design half-time with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'thyroid');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), ['thyroid.thyroxineHalfTimeMin']);
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }
  assert.equal(byId['thyroid.thyroxineHalfTimeMin'].unit, 'min');
  assert.equal(byId['thyroid.thyroxineHalfTimeMin'].value, HALF_TIME_MIN);
  assert.deepEqual(byId['thyroid.thyroxineHalfTimeMin'].range, [1, 240]);

  assert.deepEqual(loadParameters(parametersUrl), {
    'thyroid.thyroxineHalfTimeMin': HALF_TIME_MIN,
  });
});

test('TSH drives T4 with a 60-minute half-time', () => {
  const rising = round({
    state: { thyroxineRelative: 1 },
    pituitary: { tshRelative: 3 },
    dt: 3600,
  });
  assertClose(rising.written.thyroxineRelative, 2, 'rising halfway from 1 toward 3');

  const falling = round({
    state: { thyroxineRelative: 3 },
    pituitary: { tshRelative: 0 },
    dt: 3600,
  });
  assertClose(falling.written.thyroxineRelative, 1.5, 'falling halfway from 3 toward 0');

  const mild = round({
    state: { thyroxineRelative: 1 },
    pituitary: { tshRelative: 0.5 },
    dt: 3600,
  });
  assertClose(mild.written.thyroxineRelative, 0.75, 'falling halfway from 1 toward 0.5');

  const oneMinute = round({
    state: { thyroxineRelative: 1 },
    pituitary: { tshRelative: 3 },
    dt: 60,
  });
  assertClose(
    oneMinute.written.thyroxineRelative,
    3 + (1 - 3) * 2 ** (-1 / 60),
    'one 60-second round is one minute of a 60-minute half-time',
  );
});

test('T4 approaches TSH with 2^(−dtMin / 60)', () => {
  const twoHours = round({
    state: { thyroxineRelative: 1 },
    pituitary: { tshRelative: 3 },
    dt: 7200,
  });
  assertClose(twoHours.written.thyroxineRelative, 2.5, 'two half-times leave a quarter');

  const halfHour = round({
    state: { thyroxineRelative: 1 },
    pituitary: { tshRelative: 3 },
    dt: 1800,
  });
  assertClose(
    halfHour.written.thyroxineRelative,
    3 + (1 - 3) * 2 ** (-0.5),
    'half a half-time',
  );

  const ninetyMinutes = round({
    state: { thyroxineRelative: 2.5 },
    pituitary: { tshRelative: 0 },
    dt: 5400,
  });
  assertClose(
    ninetyMinutes.written.thyroxineRelative,
    2.5 * 2 ** -1.5,
    'a fractional number of half-times',
  );
});

test('a missing pituitary keeps TSH at the neutral baseline of 1', () => {
  const fromHigh = round({ state: { thyroxineRelative: 2 }, dt: 3600 });
  assertClose(fromHigh.written.thyroxineRelative, 1.5, 'T4 decays halfway toward 1');

  const fromBaseline = round({ state: { thyroxineRelative: 1 }, dt: 3600 });
  assertClose(fromBaseline.written.thyroxineRelative, 1, 'baseline is a fixed point');

  const newBody = round();
  assertClose(newBody.written.thyroxineRelative, 1, 'missing state starts at baseline');
});

test('a loaded pituitary with an invalid TSH fails the round without writing', () => {
  const invalid = [
    ['empty pituitary', {}],
    ['NaN TSH', { tshRelative: Number.NaN }],
    ['positive infinity TSH', { tshRelative: Number.POSITIVE_INFINITY }],
    ['negative infinity TSH', { tshRelative: Number.NEGATIVE_INFINITY }],
    ['negative TSH', { tshRelative: -0.1 }],
    ['non-numeric TSH', { tshRelative: '1' }],
  ];
  for (const [label, pituitary] of invalid) {
    expectUpstreamError({ pituitary }, label);
  }
});

test('thyroid output is finite and JSON-safe', () => {
  const cases = [
    ['no upstream parts', {}],
    ['TSH high', { state: { thyroxineRelative: 1 }, pituitary: { tshRelative: 3 } }],
    ['TSH low', { state: { thyroxineRelative: 2.5 }, pituitary: { tshRelative: 0 } }],
    ['fractional dt', { state: { thyroxineRelative: 0.3 }, pituitary: { tshRelative: 2 }, dt: 90 }],
  ];

  for (const [label, input] of cases) {
    const { written, writes } = round(input);
    assert.equal(writes.length, 1, label);
    assert.ok(Number.isFinite(written.thyroxineRelative), `${label}: must be finite`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
