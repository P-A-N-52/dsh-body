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
const referenceCortisolNmolL = 180;
const referenceActhPgMl = 12;
const acthEc50PgMl = 26;
const maxSecretionNmolLPerMin = 10;
const hillExponent = 1.85;
const eliminationHalfTimeMin = 49;
const kElim = Math.LN2 / eliminationHalfTimeMin;

function hill(acthPgMl) {
  if (acthPgMl <= 0) return 0;
  const p = acthPgMl ** hillExponent;
  return p / (acthEc50PgMl ** hillExponent + p);
}

const basalSecretion = (referenceCortisolNmolL * kElim - maxSecretionNmolLPerMin * hill(referenceActhPgMl))
  / (1 - hill(referenceActhPgMl));

function expectedCortisol(prevCortisol, acthPgMl, dtMin) {
  const secretion = basalSecretion + (maxSecretionNmolLPerMin - basalSecretion) * hill(acthPgMl);
  const target = secretion / kElim;
  return Math.min(800, Math.max(0, target + (prevCortisol - target) * 2 ** (-dtMin / eliminationHalfTimeMin)));
}

function pituitaryAt(acthPgMl) {
  return { tshRelative: 1, acthPgMl, prolactinNgMl: 8, oxytocinPgMl: 2 };
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

test('adrenal exports the cortisol signal contract without actions', () => {
  assert.equal(id, 'adrenal');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    cortisolNmolL: { unit: 'nmol/L', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { cortisolNmolL: 180 });

  const withoutActions = round({
    state: initialState,
    pituitary: pituitaryAt(24),
  });
  const withActions = round({
    state: initialState,
    pituitary: pituitaryAt(24),
    actions: [
      { type: 'exercise', intensity: 1, durationMin: 10 },
      { type: 'eat', energyKcal: 100 },
    ],
  });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(Object.keys(withActions.written), ['cortisolNmolL']);
});

test('the adrenal parameters keep Keenan Hill kinetics priors and reference design constants', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'adrenal');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'adrenal.acthEc50PgMl',
    'adrenal.eliminationHalfTimeMin',
    'adrenal.hillExponent',
    'adrenal.maxSecretionNmolLPerMin',
    'adrenal.referenceActhPgMl',
    'adrenal.referenceCortisolNmolL',
  ]);
  assert.equal(byId['adrenal.acthEc50PgMl'].status, 'prior');
  assert.equal(byId['adrenal.acthEc50PgMl'].source, 'SRC-KEENAN-2004');
  assert.equal(byId['adrenal.eliminationHalfTimeMin'].status, 'prior');
  assert.equal(byId['adrenal.eliminationHalfTimeMin'].source, 'SRC-KEENAN-2004');
  assert.equal(byId['adrenal.maxSecretionNmolLPerMin'].status, 'prior');
  assert.equal(byId['adrenal.maxSecretionNmolLPerMin'].source, 'SRC-KEENAN-2004');
  assert.equal(byId['adrenal.hillExponent'].status, 'design');
  assert.equal(byId['adrenal.hillExponent'].source, null);

  assert.deepEqual(loadParameters(parametersUrl), {
    'adrenal.referenceCortisolNmolL': 180,
    'adrenal.referenceActhPgMl': 12,
    'adrenal.acthEc50PgMl': 26,
    'adrenal.maxSecretionNmolLPerMin': 10,
    'adrenal.hillExponent': 1.85,
    'adrenal.eliminationHalfTimeMin': 49,
  });
});

test('ACTH drives cortisol nonlinearly with a 49 min elimination half-time', () => {
  const oneMinute = round({
    state: { cortisolNmolL: 180 },
    pituitary: pituitaryAt(36),
  });
  assertClose(
    oneMinute.written.cortisolNmolL,
    expectedCortisol(180, 36, 1),
    'one-minute response',
  );
  assert.equal(oneMinute.writes.length, 1);

  const halfTime = round({
    state: { cortisolNmolL: 180 },
    pituitary: pituitaryAt(36),
    dt: eliminationHalfTimeMin * 60,
  });
  assertClose(halfTime.written.cortisolNmolL, expectedCortisol(180, 36, eliminationHalfTimeMin), '49 min half-time');

  const saturationCheck = round({
    state: { cortisolNmolL: 180 },
    pituitary: pituitaryAt(80),
    dt: 600 * 60,
  });
  assertClose(saturationCheck.written.cortisolNmolL, expectedCortisol(180, 80, 600), 'high ACTH saturation');
});

test('ACTH below baseline pulls cortisol down and basal 12 pg/mL holds 180 nmol/L', () => {
  const { written } = round({
    state: { cortisolNmolL: 360 },
    pituitary: pituitaryAt(4),
    dt: eliminationHalfTimeMin * 60,
  });
  assertClose(written.cortisolNmolL, expectedCortisol(360, 4, eliminationHalfTimeMin), 'half-time pull down');

  const baseline = round({
    state: initialState,
    pituitary: pituitaryAt(referenceActhPgMl),
  });
  assertClose(baseline.written.cortisolNmolL, 180, 'basal holds steady');
});

test('a zero-length round keeps the previous cortisol', () => {
  const { written } = round({
    state: { cortisolNmolL: 306 },
    pituitary: pituitaryAt(36),
    dt: 0,
  });
  assertClose(written.cortisolNmolL, 306, 'dt 0');
});

test('a missing pituitary falls back to basal acthPgMl 12', () => {
  const { written } = round({ state: { cortisolNmolL: 360 } });
  assertClose(
    written.cortisolNmolL,
    expectedCortisol(360, referenceActhPgMl, 1),
    'missing pituitary',
  );

  const baseline = round({ state: initialState });
  assertClose(baseline.written.cortisolNmolL, 180, 'baseline');
});

test('a missing adrenal state starts from basal 180 nmol/L and migrates legacy cortisolRelative', () => {
  const { written } = round({ pituitary: pituitaryAt(36) });
  assertClose(
    written.cortisolNmolL,
    expectedCortisol(180, 36, 1),
    'initial state',
  );

  const migrated = round({ state: { cortisolRelative: 2 }, dt: 0 });
  assert.equal(migrated.written.cortisolNmolL, 360, 'legacy cortisolRelative migrates as ratio * 180');
});

test('a loaded pituitary with an invalid ACTH fails the round without writes', () => {
  const invalid = [
    ['missing acthPgMl', {}],
    ['NaN', pituitaryAt(Number.NaN)],
    ['positive infinity', pituitaryAt(Number.POSITIVE_INFINITY)],
    ['negative infinity', pituitaryAt(Number.NEGATIVE_INFINITY)],
    ['negative', pituitaryAt(-0.1)],
    ['non-number', pituitaryAt('12')],
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
      options: { state: { cortisolNmolL: 180 }, pituitary: pituitaryAt(36) },
    },
    {
      label: 'fractional dt',
      options: {
        state: { cortisolNmolL: 220 },
        pituitary: pituitaryAt(8),
        dt: 90,
      },
    },
    {
      label: 'long round',
      options: {
        state: { cortisolNmolL: 40 },
        pituitary: pituitaryAt(40),
        dt: 3600,
      },
    },
    {
      label: 'zero dt',
      options: {
        state: { cortisolNmolL: 250 },
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

test('adrenal clamps extreme ACTH secretion to [0, 800] nmol/L', () => {
  const clampedHigh = round({
    state: initialState,
    pituitary: pituitaryAt(1000),
    dt: 60000,
  }).written;
  assert.ok(clampedHigh.cortisolNmolL > 650 && clampedHigh.cortisolNmolL <= 800);
});
