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
} from '../organs/human-organs/adrenal/cortisol.ts';

const parametersUrl = new URL(
  '../organs/human-organs/adrenal/cortisol.parameters.json',
  import.meta.url,
);
const halfTimeMin = 15;

function pituitaryAt(acthRelative) {
  return { tshRelative: 1, acthRelative };
}

function round({ state, pituitary, dt = 60, actions = [] } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'adrenal') return state;
      if (partId === 'pituitary') return pituitary;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function expectedCortisol(prevCortisol, acthRelative, dtMin) {
  return acthRelative
    + (prevCortisol - acthRelative) * 2 ** (-dtMin / halfTimeMin);
}

test('adrenal exports the cortisol signal contract without actions', () => {
  assert.equal(id, 'adrenal');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    cortisolRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { cortisolRelative: 1 });

  const withoutActions = round({
    state: initialState,
    pituitary: pituitaryAt(2),
  });
  const withActions = round({
    state: initialState,
    pituitary: pituitaryAt(2),
    actions: [
      { type: 'exercise', intensity: 1, durationMin: 10 },
      { type: 'eat', energyKcal: 100 },
    ],
  });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(Object.keys(withActions.written), ['cortisolRelative']);
});

test('the adrenal parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'adrenal');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), ['adrenal.responseHalfTimeMin']);

  const halfTime = byId['adrenal.responseHalfTimeMin'];
  assert.equal(halfTime.value, 15);
  assert.equal(halfTime.unit, 'min');
  assert.equal(halfTime.status, 'design');
  assert.equal(halfTime.source, null);

  assert.deepEqual(loadParameters(parametersUrl), {
    'adrenal.responseHalfTimeMin': 15,
  });
});

test('ACTH drives cortisol with a 15 min half-time', () => {
  const oneMinute = round({
    state: { cortisolRelative: 1 },
    pituitary: pituitaryAt(3),
  });
  assertClose(
    oneMinute.written.cortisolRelative,
    expectedCortisol(1, 3, 1),
    'one-minute response',
  );
  assert.equal(oneMinute.writes.length, 1);

  const fifteenMinutes = round({
    state: { cortisolRelative: 1 },
    pituitary: pituitaryAt(3),
    dt: 900,
  });
  assertClose(fifteenMinutes.written.cortisolRelative, 2, '15 min half-time');

  const thirtyMinutes = round({
    state: { cortisolRelative: 1 },
    pituitary: pituitaryAt(3),
    dt: 1800,
  });
  assertClose(thirtyMinutes.written.cortisolRelative, 2.5, '30 min');
});

test('ACTH below baseline pulls cortisol down toward the target', () => {
  const { written } = round({
    state: { cortisolRelative: 2 },
    pituitary: pituitaryAt(0.5),
    dt: 900,
  });
  assertClose(written.cortisolRelative, 1.25, 'half-time pull down');

  const baseline = round({
    state: initialState,
    pituitary: pituitaryAt(1),
  });
  assert.equal(baseline.written.cortisolRelative, 1);
});

test('a zero-length round keeps the previous cortisol', () => {
  const { written } = round({
    state: { cortisolRelative: 1.7 },
    pituitary: pituitaryAt(3),
    dt: 0,
  });
  assertClose(written.cortisolRelative, 1.7, 'dt 0');
});

test('a missing pituitary falls back to acthRelative 1', () => {
  const { written } = round({ state: { cortisolRelative: 2 } });
  assertClose(
    written.cortisolRelative,
    expectedCortisol(2, 1, 1),
    'missing pituitary',
  );

  const baseline = round({ state: initialState });
  assert.equal(baseline.written.cortisolRelative, 1);
});

test('a missing adrenal state starts from the baseline 1', () => {
  const { written } = round({ pituitary: pituitaryAt(3) });
  assertClose(
    written.cortisolRelative,
    expectedCortisol(1, 3, 1),
    'initial state',
  );
});

test('a loaded pituitary with an invalid ACTH fails the round without writes', () => {
  const invalid = [
    ['missing acthRelative', {}],
    ['NaN', pituitaryAt(Number.NaN)],
    ['positive infinity', pituitaryAt(Number.POSITIVE_INFINITY)],
    ['negative infinity', pituitaryAt(Number.NEGATIVE_INFINITY)],
    ['negative', pituitaryAt(-0.1)],
    ['non-number', pituitaryAt('1')],
  ];

  for (const [label, pituitary] of invalid) {
    const writes = [];
    assert.throws(
      () => round({ state: initialState, pituitary, writes }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('adrenal output is finite and JSON-safe', () => {
  const cases = [
    {
      label: 'missing upstream',
      options: { state: initialState },
    },
    {
      label: 'driven one minute',
      options: { state: { cortisolRelative: 1 }, pituitary: pituitaryAt(3) },
    },
    {
      label: 'fractional dt',
      options: {
        state: { cortisolRelative: 1.2 },
        pituitary: pituitaryAt(0.7),
        dt: 90,
      },
    },
    {
      label: 'long round',
      options: {
        state: { cortisolRelative: 0.2 },
        pituitary: pituitaryAt(2.5),
        dt: 3600,
      },
    },
    {
      label: 'zero dt',
      options: {
        state: { cortisolRelative: 1.4 },
        pituitary: pituitaryAt(0),
        dt: 0,
      },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});

test('adrenal guards malformed prev and clamps cortisol to [0, 3]', () => {
  const fromNaN = round({ state: { cortisolRelative: Number.NaN } }).written;
  assert.equal(fromNaN.cortisolRelative, 1);

  const clampedHigh = round({
    state: { cortisolRelative: 10 },
    pituitary: pituitaryAt(10),
    dt: 900,
  }).written;
  assert.equal(clampedHigh.cortisolRelative, 3);

  const clampedLow = round({
    state: { cortisolRelative: -3 },
    pituitary: pituitaryAt(0),
    dt: 0,
  }).written;
  assert.equal(clampedLow.cortisolRelative, 0);

  const writes = [];
  assert.throws(() => round({ state: initialState, pituitary: null, writes }), Error);
  assert.equal(writes.length, 0);
});
