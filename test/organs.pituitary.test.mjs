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
} from '../organs/human-organs/brain/pituitary.ts';

const parametersUrl = new URL(
  '../organs/human-organs/brain/pituitary.parameters.json',
  import.meta.url,
);
const parameterValues = loadParameters(parametersUrl);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

const HALF_TIME_MIN = 30;
const ONE_MINUTE_RETENTION = 2 ** (-1 / HALF_TIME_MIN);

function round({
  state = { tshRelative: 1, acthRelative: 1, prolactinRelative: 1 },
  hypothalamusEndocrine,
  thyroid,
  adrenal,
  mammaryGlands,
  dt = 60,
  actions = [],
  writes = [],
} = {}) {
  const parts = {
    pituitary: state,
    hypothalamusEndocrine,
    thyroid,
    adrenal,
    mammaryGlands,
  };
  heartbeat({
    read: (partId) => parts[partId],
    actions,
    dt,
    simulatedSeconds: 60,
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

test('pituitary exports the organ module contract', () => {
  assert.equal(id, 'pituitary');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    tshRelative: { unit: '1', mode: 'absolute' },
    acthRelative: { unit: '1', mode: 'absolute' },
    prolactinRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    tshRelative: 1,
    acthRelative: 1,
    prolactinRelative: 1,
  });
});

test('pituitary parameter defaults are design values with no source', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'pituitary');
  const byId = Object.fromEntries(
    parameterFile.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'pituitary.acthFeedbackGain',
    'pituitary.tshFeedbackGain',
  ]);
  for (const [parameterId, value] of [
    ['pituitary.tshFeedbackGain', 1],
    ['pituitary.acthFeedbackGain', 1],
  ]) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, '1', `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
    assert.equal(parameterValues[parameterId], value, `${parameterId}: loader value`);
  }
});

test('TRH drives TSH and CRH drives ACTH toward their targets', () => {
  const written = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 3 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 1 },
    dt: 60,
  });
  assertClose(written.tshRelative, 2 - ONE_MINUTE_RETENTION, 'TSH one-minute step');
  assertClose(written.acthRelative, 3 - 2 * ONE_MINUTE_RETENTION, 'ACTH one-minute step');

  const lowerTrh = round({
    hypothalamusEndocrine: { trhRelative: 1.2, crhRelative: 1 },
    dt: 60,
  });
  assert.ok(lowerTrh.tshRelative < written.tshRelative, 'lower TRH must give lower TSH');

  const actions = [{ type: 'eat', energyKcal: 100 }];
  assert.deepEqual(
    round({
      hypothalamusEndocrine: { trhRelative: 2, crhRelative: 3 },
      thyroid: { thyroxineRelative: 1 },
      adrenal: { cortisolRelative: 1 },
      dt: 60,
      actions,
    }),
    written,
  );
});

test('high T4 suppresses TRH-driven TSH and high cortisol suppresses CRH-driven ACTH', () => {
  const lowFeedback = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 1 },
    dt: 1800,
  });
  assert.equal(lowFeedback.tshRelative, 1.5);
  assert.equal(lowFeedback.acthRelative, 1.5);

  const highFeedback = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 2 },
    dt: 1800,
  });
  assert.equal(highFeedback.tshRelative, 0.5);
  assert.equal(highFeedback.acthRelative, 0.5);
  assert.ok(highFeedback.tshRelative < lowFeedback.tshRelative, 'T4 must suppress TSH');
  assert.ok(highFeedback.acthRelative < lowFeedback.acthRelative, 'cortisol must suppress ACTH');

  const t4Only = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 1 },
    dt: 1800,
  });
  assert.equal(t4Only.tshRelative, 0.5);
  assert.equal(t4Only.acthRelative, 1.5, 'T4 must not drive ACTH');

  const cortisolOnly = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 2 },
    dt: 1800,
  });
  assert.equal(cortisolOnly.tshRelative, 1.5, 'cortisol must not drive TSH');
  assert.equal(cortisolOnly.acthRelative, 0.5);
});

test('both outputs approach their targets with a 30 min half-time', () => {
  const halfHour = round({
    state: { tshRelative: 3, acthRelative: 0 },
    dt: 1800,
  });
  assert.equal(halfHour.tshRelative, 2);
  assert.equal(halfHour.acthRelative, 0.5);

  const oneHour = round({
    state: { tshRelative: 3, acthRelative: 0 },
    dt: 3600,
  });
  assert.equal(oneHour.tshRelative, 1.5);
  assert.equal(oneHour.acthRelative, 0.75);

  const settled = round({
    state: { tshRelative: 1, acthRelative: 1 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 1 },
    dt: 1800,
  });
  assert.equal(settled.tshRelative, 1);
  assert.equal(settled.acthRelative, 1);
});

test('missing upstream or peripheral parts fall back to the reference 1', () => {
  assert.deepEqual(round(), { tshRelative: 1, acthRelative: 1, prolactinRelative: 1 });
  assert.deepEqual(
    round({ state: { tshRelative: 2, acthRelative: 0, prolactinRelative: 1 }, dt: 1800 }),
    { tshRelative: 1.5, acthRelative: 0.5, prolactinRelative: 1 },
  );
  assert.deepEqual(
    round({
      hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
      dt: 1800,
    }),
    { tshRelative: 1.5, acthRelative: 1.5, prolactinRelative: 1 },
  );

  const missingThyroid = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 1 },
    adrenal: { cortisolRelative: 1 },
    dt: 1800,
  });
  assert.equal(missingThyroid.tshRelative, 1.5, 'missing thyroid falls back to T4 = 1');
  assert.equal(missingThyroid.acthRelative, 1);

  const missingAdrenal = round({
    hypothalamusEndocrine: { trhRelative: 1, crhRelative: 2 },
    thyroid: { thyroxineRelative: 1 },
    dt: 1800,
  });
  assert.equal(missingAdrenal.tshRelative, 1);
  assert.equal(missingAdrenal.acthRelative, 1.5, 'missing adrenal falls back to cortisol = 1');

  const missingHypothalamus = round({
    thyroid: { thyroxineRelative: 0.5 },
    adrenal: { cortisolRelative: 0.5 },
    dt: 1800,
  });
  assert.equal(missingHypothalamus.tshRelative, 1.25, 'missing TRH falls back to 1');
  assert.equal(missingHypothalamus.acthRelative, 1.25, 'missing CRH falls back to 1');
});

test('loaded parts with missing or invalid readings fail before writing', () => {
  const invalid = [
    { label: 'empty hypothalamus', hypothalamusEndocrine: {} },
    { label: 'missing CRH', hypothalamusEndocrine: { trhRelative: 1 } },
    { label: 'NaN TRH', hypothalamusEndocrine: { trhRelative: Number.NaN, crhRelative: 1 } },
    { label: 'infinite CRH', hypothalamusEndocrine: { trhRelative: 1, crhRelative: Number.POSITIVE_INFINITY } },
    { label: 'negative T4', thyroid: { thyroxineRelative: -0.1 } },
    { label: 'NaN cortisol', adrenal: { cortisolRelative: Number.NaN } },
    { label: 'non-number cortisol', adrenal: { cortisolRelative: '1' } },
    { label: 'null thyroid', thyroid: null },
  ];

  for (const { label, hypothalamusEndocrine, thyroid, adrenal } of invalid) {
    const writes = [];
    assert.throws(
      () => round({ hypothalamusEndocrine, thyroid, adrenal, writes }),
      /pituitary/,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('targets clamp to the 0-3 band', () => {
  const high = round({
    state: { tshRelative: 3, acthRelative: 3 },
    hypothalamusEndocrine: { trhRelative: 100, crhRelative: 100 },
    thyroid: { thyroxineRelative: 0 },
    adrenal: { cortisolRelative: 10 },
    dt: 1800,
  });
  assert.equal(high.tshRelative, 3);
  assert.equal(high.acthRelative, 1.5);

  const low = round({
    state: { tshRelative: 0, acthRelative: 0 },
    hypothalamusEndocrine: { trhRelative: 0, crhRelative: 0 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolRelative: 1 },
    dt: 1800,
  });
  assert.equal(low.tshRelative, 0);
  assert.equal(low.acthRelative, 0);
});

test('mammary let-down drives prolactin toward the design target with a 30 min half-time', () => {
  const noMilk = round({ dt: 1800 });
  assert.equal(noMilk.prolactinRelative, 1, 'missing mammary keeps the reference 1');

  const zeroMilk = round({
    state: { tshRelative: 1, acthRelative: 1, prolactinRelative: 3 },
    mammaryGlands: { milkMl: 0 },
    dt: 3600,
  });
  assert.equal(zeroMilk.prolactinRelative, 1.5, 'no milk decays toward 1 with a 60 min step');

  const milk = round({
    state: { tshRelative: 1, acthRelative: 1, prolactinRelative: 1 },
    mammaryGlands: { milkMl: 0.5 },
    dt: 1800,
  });
  assert.equal(milk.prolactinRelative, 1.5, 'milk raises the target to 2 with a 30 min step');

  const high = round({
    state: { tshRelative: 1, acthRelative: 1, prolactinRelative: 3 },
    mammaryGlands: { milkMl: 0.5 },
    dt: 1800,
  });
  assert.equal(high.prolactinRelative, 2.5, 'milk pulls a high prolactin down toward 2');

  const missing = round({
    state: { tshRelative: 1, acthRelative: 1, prolactinRelative: 3 },
    dt: 1800,
  });
  assert.equal(missing.prolactinRelative, 2, 'missing mammary pulls toward the reference 1');
});

test('prolactin is independent of the hypothalamic and peripheral axes', () => {
  const milkOnly = round({
    mammaryGlands: { milkMl: 1 },
    dt: 1800,
  });
  const withAxes = round({
    hypothalamusEndocrine: { trhRelative: 3, crhRelative: 3 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolRelative: 2 },
    mammaryGlands: { milkMl: 1 },
    dt: 1800,
  });
  assert.equal(withAxes.prolactinRelative, milkOnly.prolactinRelative);
  assert.equal(withAxes.prolactinRelative, 1.5);
});

test('loaded mammary glands with an invalid milk reading fail before writing', () => {
  const invalid = [
    { label: 'null mammary', mammaryGlands: null },
    { label: 'empty mammary', mammaryGlands: {} },
    { label: 'NaN milk', mammaryGlands: { milkMl: Number.NaN } },
    { label: 'infinite milk', mammaryGlands: { milkMl: Number.POSITIVE_INFINITY } },
    { label: 'negative milk', mammaryGlands: { milkMl: -0.1 } },
    { label: 'string milk', mammaryGlands: { milkMl: '1' } },
  ];

  for (const { label, mammaryGlands } of invalid) {
    const writes = [];
    assert.throws(
      () => round({ mammaryGlands, writes }),
      /pituitary/,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('pituitary output is finite and JSON-safe', () => {
  const cases = [
    {},
    {
      hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
      thyroid: { thyroxineRelative: 1 },
      adrenal: { cortisolRelative: 1 },
      mammaryGlands: { milkMl: 0.5 },
    },
    {
      hypothalamusEndocrine: { trhRelative: 1e9, crhRelative: 1e9 },
      thyroid: { thyroxineRelative: 0 },
      adrenal: { cortisolRelative: 0 },
    },
    {
      hypothalamusEndocrine: { trhRelative: 0, crhRelative: 0 },
      thyroid: { thyroxineRelative: 1e9 },
      adrenal: { cortisolRelative: 1e9 },
    },
  ];

  for (const parts of cases) {
    const written = round(parts);
    assert.deepEqual(
      Object.keys(written),
      ['tshRelative', 'acthRelative', 'prolactinRelative'],
    );
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
