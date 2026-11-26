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

const TSH_HALF_TIME_MIN = 53.9;
const ACTH_HALF_TIME_MIN = 20;
const PRL_HALF_TIME_MIN = 34.6;
const OT_HALF_TIME_MIN = 3.8;

function round({
  state = { tshRelative: 1, acthPgMl: 12, prolactinNgMl: 8, oxytocinPgMl: 2 },
  hypothalamusEndocrine,
  thyroid,
  adrenal,
  mammaryGlands,
  sleep,
  sexualResponse,
  dt = 60,
  simulatedSeconds = 60,
  wallTimeMs,
  actions = [],
  writes = [],
} = {}) {
  const parts = {
    pituitary: state,
    hypothalamusEndocrine,
    thyroid,
    adrenal,
    mammaryGlands,
    sleep,
    sexualResponse,
  };
  heartbeat({
    read: (partId) => parts[partId],
    actions,
    dt,
    simulatedSeconds,
    ...(wallTimeMs !== undefined ? { wallTimeMs } : {}),
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
    acthPgMl: { unit: 'pg/mL', mode: 'absolute' },
    prolactinNgMl: { unit: 'ng/mL', mode: 'absolute' },
    oxytocinPgMl: { unit: 'pg/mL', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    tshRelative: 1,
    acthPgMl: 12,
    prolactinNgMl: 8,
    oxytocinPgMl: 2,
  });
});

test('pituitary parameter defaults match priors and design constants', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'pituitary');
  const byId = Object.fromEntries(
    parameterFile.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.equal(Object.keys(byId).length, 16);
  assert.equal(byId['pituitary.tshHalfTimeMin'].value, 53.9);
  assert.equal(byId['pituitary.tshHalfTimeMin'].status, 'prior');
  assert.equal(byId['pituitary.tshHalfTimeMin'].source, 'SRC-ODELL-1967');
  assert.equal(byId['pituitary.acthHalfTimeMin'].value, 20);
  assert.equal(byId['pituitary.acthHalfTimeMin'].status, 'prior');
  assert.equal(byId['pituitary.acthHalfTimeMin'].source, 'SRC-KEENAN-2004');
  assert.equal(byId['pituitary.prolactinCircadianAmplitudeNgMl'].value, 2.1);
  assert.equal(byId['pituitary.prolactinCircadianAmplitudeNgMl'].status, 'prior');
  assert.equal(byId['pituitary.prolactinCircadianAmplitudeNgMl'].source, 'SRC-VELDHUIS-1988');
  assert.equal(byId['pituitary.oxytocinHalfTimeMin'].value, 3.8);
  assert.equal(byId['pituitary.oxytocinHalfTimeMin'].source, 'SRC-FABIAN-1969');
  assert.equal(parameterValues['pituitary.prolactinBasalNgMl'], 8);
  assert.equal(parameterValues['pituitary.acthBasalPgMl'], 12);
});

test('TRH drives TSH and CRH drives ACTH toward their targets', () => {
  const written = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 3 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolNmolL: 180 },
    dt: 60,
  });
  assertClose(written.tshRelative, 2 - 2 ** (-1 / TSH_HALF_TIME_MIN), 'TSH one-minute step');
  assertClose(
    written.acthPgMl,
    36 + (12 - 36) * 2 ** (-1 / ACTH_HALF_TIME_MIN),
    'ACTH one-minute step',
  );

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
      adrenal: { cortisolNmolL: 180 },
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
    adrenal: { cortisolNmolL: 180 },
    dt: 600 * 60,
  });
  assertClose(lowFeedback.tshRelative, 2, 'low T4 TSH target', 1e-3);
  assertClose(lowFeedback.acthPgMl, 24, 'low cortisol ACTH target', 1e-4);

  const highFeedback = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolNmolL: 360 },
    dt: 600 * 60,
  });
  assertClose(highFeedback.tshRelative, 0, 'high T4 suppresses TSH', 1e-3);
  assertClose(highFeedback.acthPgMl, 0, 'high cortisol suppresses ACTH', 1e-4);

  const t4Only = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolNmolL: 180 },
    dt: 600 * 60,
  });
  assertClose(t4Only.tshRelative, 0, 'T4 suppresses TSH', 1e-3);
  assertClose(t4Only.acthPgMl, 24, 'T4 must not drive ACTH', 1e-4);

  const cortisolOnly = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 2 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolNmolL: 360 },
    dt: 600 * 60,
  });
  assertClose(cortisolOnly.tshRelative, 2, 'cortisol must not drive TSH', 1e-3);
  assertClose(cortisolOnly.acthPgMl, 0, 'cortisol suppresses ACTH', 1e-4);
});

test('outputs approach their targets with empirical half-times', () => {
  const tshHalf = round({
    state: { tshRelative: 3, acthPgMl: 12, prolactinNgMl: 8, oxytocinPgMl: 2 },
    dt: TSH_HALF_TIME_MIN * 60,
  });
  assertClose(tshHalf.tshRelative, 2, 'TSH halves distance at 53.9 min');

  const acthHalf = round({
    state: { tshRelative: 1, acthPgMl: 0, prolactinNgMl: 8, oxytocinPgMl: 2 },
    dt: ACTH_HALF_TIME_MIN * 60,
  });
  assertClose(acthHalf.acthPgMl, 6, 'ACTH halves distance at 20 min');

  const settled = round({
    state: initialState,
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolNmolL: 180 },
    dt: 1800,
  });
  assert.deepEqual(settled, initialState);
});

test('missing upstream or peripheral parts fall back to baselines', () => {
  assert.deepEqual(round(), { tshRelative: 1, acthPgMl: 12, prolactinNgMl: 8, oxytocinPgMl: 2 });
  assert.deepEqual(
    round({
      state: { tshRelative: 2, acthPgMl: 0, prolactinNgMl: 8, oxytocinPgMl: 2 },
      dt: ACTH_HALF_TIME_MIN * 60,
    }).acthPgMl,
    6,
  );

  const missingThyroid = round({
    hypothalamusEndocrine: { trhRelative: 2, crhRelative: 1 },
    adrenal: { cortisolNmolL: 180 },
    dt: TSH_HALF_TIME_MIN * 60,
  });
  assertClose(missingThyroid.tshRelative, 1.5, 'missing thyroid falls back to T4 = 1');
  assert.equal(missingThyroid.acthPgMl, 12);

  const missingAdrenal = round({
    hypothalamusEndocrine: { trhRelative: 1, crhRelative: 2 },
    thyroid: { thyroxineRelative: 1 },
    dt: ACTH_HALF_TIME_MIN * 60,
  });
  assert.equal(missingAdrenal.tshRelative, 1);
  assertClose(missingAdrenal.acthPgMl, 18, 'missing adrenal falls back to 180 nmol/L');

  const missingHypothalamus = round({
    thyroid: { thyroxineRelative: 0.5 },
    adrenal: { cortisolNmolL: 90 },
    dt: ACTH_HALF_TIME_MIN * 60,
  });
  assert.ok(missingHypothalamus.tshRelative > 1, 'missing TRH falls back to 1');
  assertClose(missingHypothalamus.acthPgMl, 15, 'missing CRH falls back to 1');
});

test('loaded parts with missing or invalid readings fail before writing', () => {
  const invalid = [
    { label: 'empty hypothalamus', hypothalamusEndocrine: {} },
    { label: 'missing CRH', hypothalamusEndocrine: { trhRelative: 1 } },
    { label: 'NaN TRH', hypothalamusEndocrine: { trhRelative: Number.NaN, crhRelative: 1 } },
    { label: 'infinite CRH', hypothalamusEndocrine: { trhRelative: 1, crhRelative: Number.POSITIVE_INFINITY } },
    { label: 'negative T4', thyroid: { thyroxineRelative: -0.1 } },
    { label: 'NaN cortisol', adrenal: { cortisolNmolL: Number.NaN } },
    { label: 'non-number cortisol', adrenal: { cortisolNmolL: '180' } },
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

test('targets clamp to physiological bounds', () => {
  const high = round({
    state: { tshRelative: 3, acthPgMl: 120, prolactinNgMl: 8, oxytocinPgMl: 2 },
    hypothalamusEndocrine: { trhRelative: 100, crhRelative: 100 },
    thyroid: { thyroxineRelative: 0 },
    adrenal: { cortisolNmolL: 1800 },
    dt: 1800,
  });
  assert.equal(high.tshRelative, 3);
  assertClose(high.acthPgMl, 120 * 2 ** (-30 / ACTH_HALF_TIME_MIN), 'high cortisol clamps CRH-driven ACTH target to 0');

  const low = round({
    state: { tshRelative: 0, acthPgMl: 0, prolactinNgMl: 8, oxytocinPgMl: 2 },
    hypothalamusEndocrine: { trhRelative: 0, crhRelative: 0 },
    thyroid: { thyroxineRelative: 1 },
    adrenal: { cortisolNmolL: 180 },
    dt: 1800,
  });
  assert.equal(low.tshRelative, 0);
  assert.equal(low.acthPgMl, 0);
});

test('mammary suckling stimulation, lactation floor, orgasm, and sleep drive prolactin and oxytocin', () => {
  const baseline = round({ dt: 1800 });
  assert.equal(baseline.prolactinNgMl, 8, 'missing mammary keeps basal 8 ng/mL');
  assert.equal(baseline.oxytocinPgMl, 2, 'missing stimulation keeps basal 2 pg/mL');

  const passiveMilkOnly = round({
    mammaryGlands: { lactating: false, milkMl: 5, stimulationMin: 0 },
    dt: PRL_HALF_TIME_MIN * 60,
  });
  assert.equal(passiveMilkOnly.prolactinNgMl, 8, 'passive milkMl without stimulation must not spike prolactin');

  const suckling = round({
    mammaryGlands: { lactating: true, milkMl: 0, stimulationMin: 8 },
    dt: PRL_HALF_TIME_MIN * 60,
  });
  assertClose(suckling.prolactinNgMl, 8 + (35 + 82 - 8) * 0.5, 'suckling stimulation drives prolactin toward 35 + 82');
  assertClose(suckling.oxytocinPgMl, 2 + 14 * (1 - 2 ** (-PRL_HALF_TIME_MIN / OT_HALF_TIME_MIN)), 'suckling drives oxytocin burst', 1e-6);

  const actionTriggered = round({
    mammaryGlands: { lactating: false, stimulationMin: 0 },
    actions: [{ type: 'express_milk' }],
    dt: OT_HALF_TIME_MIN * 60,
  });
  assertClose(actionTriggered.oxytocinPgMl, 9, 'express_milk immediately halves distance toward basal 2 + 14 boost');

  const orgasmSpike = round({
    sexualResponse: { phase: 'orgasm', arousalMm: 100, lastOrgasmAtSimMin: 1 },
    simulatedSeconds: 60,
    dt: OT_HALF_TIME_MIN * 60,
  });
  assertClose(orgasmSpike.oxytocinPgMl, 16, 'orgasm adds arousal 6 + orgasm 22 = 30 target -> halfway 16 at 3.8 min');
  assert.ok(orgasmSpike.prolactinNgMl > 8, 'orgasm adds PRL surge');
});

test('prolactin stimulation is independent of thyroid/adrenal axes while reading mammary stimulation', () => {
  const stimOnly = round({
    mammaryGlands: { lactating: true, stimulationMin: 8 },
    dt: 1800,
  });
  const withAxes = round({
    hypothalamusEndocrine: { trhRelative: 3, crhRelative: 3 },
    thyroid: { thyroxineRelative: 2 },
    adrenal: { cortisolNmolL: 360 },
    mammaryGlands: { lactating: true, stimulationMin: 8 },
    dt: 1800,
  });
  assert.equal(withAxes.prolactinNgMl, stimOnly.prolactinNgMl);
  assert.equal(withAxes.oxytocinPgMl, stimOnly.oxytocinPgMl);
});

test('loaded mammary glands with missing or invalid stimulation fail before writing', () => {
  const invalid = [
    { label: 'empty mammary', mammaryGlands: {} },
    { label: 'NaN stimulationMin', mammaryGlands: { stimulationMin: Number.NaN } },
    { label: 'infinite stimulationMin', mammaryGlands: { stimulationMin: Number.POSITIVE_INFINITY } },
    { label: 'negative stimulationMin', mammaryGlands: { stimulationMin: -0.1 } },
    { label: 'string stimulationMin', mammaryGlands: { stimulationMin: '1' } },
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
      adrenal: { cortisolNmolL: 180 },
      mammaryGlands: { lactating: true, stimulationMin: 5 },
    },
    {
      hypothalamusEndocrine: { trhRelative: 1e9, crhRelative: 1e9 },
      thyroid: { thyroxineRelative: 0 },
      adrenal: { cortisolNmolL: 0 },
    },
    {
      hypothalamusEndocrine: { trhRelative: 0, crhRelative: 0 },
      thyroid: { thyroxineRelative: 1e9 },
      adrenal: { cortisolNmolL: 1e9 },
    },
  ];

  for (const parts of cases) {
    const written = round(parts);
    assert.deepEqual(
      Object.keys(written),
      ['tshRelative', 'acthPgMl', 'prolactinNgMl', 'oxytocinPgMl'],
    );
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
