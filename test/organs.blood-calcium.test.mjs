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
} from '../organs/human-compartments/calcium/calcium.ts';
import {
  heartbeat as parathyroidHeartbeat,
  initialState as parathyroidInitialState,
} from '../organs/human-organs/parathyroid/parathyroid.ts';
import { heartbeat as interoceptionHeartbeat } from '../organs/human-organs/brain/interoception.ts';

const parametersUrl = new URL(
  '../organs/human-compartments/calcium/calcium.parameters.json',
  import.meta.url,
);

const MG_DL_PER_G = 1000 / 140;

function round({ state, parathyroid, blood, dt = 60, actions = [] } = {}) {
  const writes = [];
  const transfers = [];
  const notifications = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'bloodCalcium') return state;
      if (partId === 'parathyroid') return parathyroid;
      if (partId === 'blood') return blood;
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

function expectUpstreamError({ state, parathyroid, blood, dt = 60 }, label) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'bloodCalcium') return state;
        if (partId === 'parathyroid') return parathyroid;
        if (partId === 'blood') return blood;
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

function cycle({ pth, calcium, blood }) {
  let nextPth;
  let nextCalcium;
  let nextInteroception;
  parathyroidHeartbeat({
    read: (partId) => {
      if (partId === 'parathyroid') return pth;
      if (partId === 'bloodCalcium') return calcium;
      throw new Error(`unexpected read: ${partId}`);
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { nextPth = next; },
  });
  heartbeat({
    read: (partId) => {
      if (partId === 'bloodCalcium') return calcium;
      if (partId === 'parathyroid') return pth;
      if (partId === 'blood') return blood;
      throw new Error(`unexpected read: ${partId}`);
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { nextCalcium = next; },
  });
  interoceptionHeartbeat({
    read: (partId) => (partId === 'bloodCalcium' ? calcium : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { nextInteroception = next; },
  });
  return { pth: nextPth, calcium: nextCalcium, interoception: nextInteroception };
}

test('bloodCalcium exports the compartment contract at the reference baseline', () => {
  assert.equal(id, 'bloodCalcium');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    mgDl: { unit: 'mg/dL', mode: 'absolute' },
    boneStoreG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { mgDl: 9.5, boneStoreG: 100 });

  const withActions = round({
    state: initialState,
    actions: [{ type: 'eat', energyKcal: 100 }],
  });
  const withoutActions = round({ state: initialState });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(withActions.transfers, []);
  assert.deepEqual(withActions.notifications, []);
  assert.deepEqual(Object.keys(withActions.written), ['mgDl', 'boneStoreG']);
});

test('bloodCalcium parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'calcium');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'calcium.boneCapacityG',
    'calcium.boneDepositRateGPerMin',
    'calcium.boneReleaseRateGPerMin',
    'calcium.boneStoreInitialG',
    'calcium.calciumExcretionPerMlG',
    'calcium.distributionVolumeDl',
    'calcium.referenceMgDl',
    'calcium.referencePthPgMl',
  ]);
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }
  assert.equal(byId['calcium.referenceMgDl'].unit, 'mg/dL');
  assert.equal(byId['calcium.referenceMgDl'].value, 9.5);
  assert.equal(byId['calcium.boneStoreInitialG'].unit, 'g');
  assert.equal(byId['calcium.boneStoreInitialG'].value, 100);
  assert.equal(byId['calcium.boneCapacityG'].unit, 'g');
  assert.equal(byId['calcium.boneCapacityG'].value, 200);
  assert.equal(byId['calcium.boneReleaseRateGPerMin'].unit, 'g/min');
  assert.equal(byId['calcium.boneReleaseRateGPerMin'].value, 0.0004);
  assert.equal(byId['calcium.boneDepositRateGPerMin'].unit, 'g/min');
  assert.equal(byId['calcium.boneDepositRateGPerMin'].value, 0.0004);
  assert.equal(byId['calcium.calciumExcretionPerMlG'].unit, 'g/mL');
  assert.equal(byId['calcium.calciumExcretionPerMlG'].value, 0.000001);
  assert.equal(byId['calcium.distributionVolumeDl'].unit, 'dL');
  assert.equal(byId['calcium.distributionVolumeDl'].value, 140);
  assert.equal(byId['calcium.referencePthPgMl'].unit, 'pg/mL');
  assert.equal(byId['calcium.referencePthPgMl'].value, 30);

  assert.deepEqual(loadParameters(parametersUrl), {
    'calcium.boneCapacityG': 200,
    'calcium.boneDepositRateGPerMin': 0.0004,
    'calcium.boneReleaseRateGPerMin': 0.0004,
    'calcium.boneStoreInitialG': 100,
    'calcium.calciumExcretionPerMlG': 0.000001,
    'calcium.distributionVolumeDl': 140,
    'calcium.referenceMgDl': 9.5,
    'calcium.referencePthPgMl': 30,
  });
});

test('a neutral PTH with no GFR leaves calcium and the bone store unchanged', () => {
  const neutral = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 0 },
  });
  assert.deepEqual(neutral.written, { mgDl: 9.5, boneStoreG: 100 });
});

test('PTH above 30 pg/mL releases bone calcium and stops renal excretion', () => {
  const dtMin = 1;
  const releaseG = 0.0004 * (2 - 1) * dtMin;
  const { written } = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 60 },
    blood: { gfrMlMin: 100 },
  });
  assertClose(written.boneStoreG, 100 - releaseG, 'bone store loses the released mass');
  assertClose(written.mgDl, 9.5 + releaseG * MG_DL_PER_G, 'blood calcium rises by the released mass');
});

test('PTH below 30 pg/mL deposits calcium into the bone store', () => {
  const dtMin = 1;
  const depositG = 0.0004 * (1 - 0) * dtMin;
  const { written } = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 0 },
    blood: { gfrMlMin: 0 },
  });
  assertClose(written.boneStoreG, 100 + depositG, 'bone store gains the deposited mass');
  assertClose(written.mgDl, 9.5 - depositG * MG_DL_PER_G, 'blood calcium falls by the deposited mass');
});

test('release is capped by the bone store and the store cannot go below zero', () => {
  const { written } = round({
    state: { mgDl: 9.5, boneStoreG: 0.01 },
    parathyroid: { pthPgMl: 90 },
    blood: { gfrMlMin: 0 },
    dt: 60 * 60,
  });
  assert.equal(written.boneStoreG, 0);
  assertClose(written.mgDl, 9.5 + 0.01 * MG_DL_PER_G, 'only the remaining store is released');
});

test('deposit is capped by the 200 g bone capacity with mass conservation', () => {
  const { written } = round({
    state: { mgDl: 9.5, boneStoreG: 199.99 },
    parathyroid: { pthPgMl: 0 },
    blood: { gfrMlMin: 0 },
    dt: 6000,
  });
  assert.equal(written.boneStoreG, 200);
  assertClose(written.mgDl, 9.5 - 0.01 * MG_DL_PER_G, 'only the capped deposit leaves blood');

  const atCap = round({
    state: { mgDl: 9.5, boneStoreG: 200 },
    parathyroid: { pthPgMl: 0 },
    blood: { gfrMlMin: 0 },
    dt: 6000,
  });
  assert.equal(atCap.written.boneStoreG, 200);
  assert.equal(atCap.written.mgDl, 9.5, 'no phantom calcium leaves blood when bone is full');
});

test('GFR scales PTH-dependent calcium excretion and reduces blood calcium', () => {
  const depositG = 0.0004 * (1 - 0.5);
  const noGfr = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 15 },
    blood: { gfrMlMin: 0 },
  });
  const normal = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 15 },
    blood: { gfrMlMin: 100 },
  });
  const high = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 15 },
    blood: { gfrMlMin: 200 },
  });
  assertClose(noGfr.written.mgDl, 9.5 - depositG * MG_DL_PER_G, 'deposit only');
  assertClose(
    normal.written.mgDl,
    9.5 - (depositG + 0.00005) * MG_DL_PER_G,
    '100 mL/min excrete 0.00005 g at PTH 15 pg/mL',
  );
  assertClose(
    high.written.mgDl,
    9.5 - (depositG + 0.0001) * MG_DL_PER_G,
    '200 mL/min excrete twice as much',
  );
  assert.ok(high.written.mgDl < normal.written.mgDl);
  assert.ok(normal.written.mgDl < noGfr.written.mgDl);
  assertClose(noGfr.written.boneStoreG, 100 + depositG, 'deposit enters bone');
  assertClose(normal.written.boneStoreG, 100 + depositG, 'deposit enters bone');
});

test('high calcium with low PTH deposits and excretes more than neutral PTH', () => {
  const lowPth = round({
    state: { mgDl: 11, boneStoreG: 100 },
    parathyroid: { pthPgMl: 0 },
    blood: { gfrMlMin: 100 },
  });
  const neutral = round({
    state: { mgDl: 11, boneStoreG: 100 },
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 100 },
  });
  assertClose(lowPth.written.boneStoreG, 100.0004, 'low PTH adds the deposit to bone');
  assertClose(lowPth.written.mgDl, 11 - 0.0005 * MG_DL_PER_G, 'deposit plus excretion');
  assertClose(neutral.written.boneStoreG, 100, 'neutral PTH does not deposit');
  assert.equal(neutral.written.mgDl, 11, 'neutral PTH has no excretion');
  assert.ok(lowPth.written.mgDl < neutral.written.mgDl, 'deposition adds to excretion');
});

test('PTH is a fixed point at 30 pg/mL and a missing parathyroid falls back to 30 pg/mL', () => {
  const missing = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    blood: { gfrMlMin: 100 },
  });
  const neutral = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 100 },
  });
  assert.deepEqual(neutral.written, { mgDl: 9.5, boneStoreG: 100 });
  assert.deepEqual(missing.written, neutral.written);
});

test('a missing blood part falls back to a GFR of 100', () => {
  const missing = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 30 },
  });
  const explicit = round({
    state: { mgDl: 9.5, boneStoreG: 100 },
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 100 },
  });
  assert.deepEqual(missing.written, explicit.written);
});

test('missing own state starts at the reference calcium and initial bone store', () => {
  const newBody = round({
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 0 },
  });
  assert.deepEqual(newBody.written, { mgDl: 9.5, boneStoreG: 100 });

  const partial = round({
    state: { mgDl: Number.NaN },
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 0 },
  });
  assert.deepEqual(partial.written, { mgDl: 9.5, boneStoreG: 100 });
});

test('blood calcium and bone store clamp to their 0-20 mg/dL and 0-200 g ranges', () => {
  const floor = round({
    state: { mgDl: 0, boneStoreG: 100 },
    parathyroid: { pthPgMl: 30 },
    blood: { gfrMlMin: 100 },
  });
  assert.equal(floor.written.mgDl, 0);
  assert.equal(floor.written.boneStoreG, 100);

  const ceiling = round({
    state: { mgDl: 20, boneStoreG: 100 },
    parathyroid: { pthPgMl: 90 },
    blood: { gfrMlMin: 0 },
  });
  assert.equal(ceiling.written.mgDl, 20);
  assertClose(ceiling.written.boneStoreG, 100 - 0.0008, 'release still leaves the store');
});

test('a loaded parathyroid or blood with an invalid field fails the round without writing', () => {
  const invalidParathyroid = [
    ['empty parathyroid', {}],
    ['legacy pthRelative only', { pthRelative: 1 }],
    ['null PTH', { pthPgMl: null }],
    ['NaN PTH', { pthPgMl: Number.NaN }],
    ['positive infinity PTH', { pthPgMl: Number.POSITIVE_INFINITY }],
    ['negative infinity PTH', { pthPgMl: Number.NEGATIVE_INFINITY }],
    ['negative PTH', { pthPgMl: -0.1 }],
    ['non-numeric PTH', { pthPgMl: '30' }],
    ['null parathyroid', null],
    ['non-object parathyroid', 42],
  ];
  for (const [label, parathyroid] of invalidParathyroid) {
    expectUpstreamError({ parathyroid }, label);
  }

  const invalidBlood = [
    ['empty blood', {}],
    ['null GFR', { gfrMlMin: null }],
    ['NaN GFR', { gfrMlMin: Number.NaN }],
    ['positive infinity GFR', { gfrMlMin: Number.POSITIVE_INFINITY }],
    ['negative infinity GFR', { gfrMlMin: Number.NEGATIVE_INFINITY }],
    ['negative GFR', { gfrMlMin: -0.1 }],
    ['non-numeric GFR', { gfrMlMin: '100' }],
    ['null blood', null],
    ['non-object blood', 42],
  ];
  for (const [label, blood] of invalidBlood) {
    expectUpstreamError({ blood }, label);
  }
});

test('low calcium raises PTH, releases bone calcium, and lowers hypocalcemia', () => {
  const releaseAtTargetG = 0.0004 * (1.75 - 1);
  const excretionAtTargetG = 100 * 0.000001 * Math.max(0, 1 - 1.75);
  assert.ok(releaseAtTargetG > 0, 'release at 8 mg/dL is positive');
  assert.equal(excretionAtTargetG, 0, 'excretion vanishes above PTH 30 pg/mL');

  let pth = { ...parathyroidInitialState };
  let calcium = { mgDl: 8, boneStoreG: 100 };
  let interoception;

  for (let roundIndex = 0; roundIndex < 60; roundIndex++) {
    const next = cycle({
      pth,
      calcium,
      blood: { gfrMlMin: 100 },
    });
    pth = next.pth;
    calcium = next.calcium;
    interoception = next.interoception;
  }

  assert.ok(pth.pthPgMl > 30, 'PTH rises above baseline');
  assert.ok(calcium.boneStoreG < 100, 'bone releases calcium');
  assert.ok(calcium.mgDl > 8, 'blood calcium recovers above the low seed');
  assert.ok(calcium.mgDl < 9.5, 'it is still below the reference after 60 rounds');
  assert.ok(interoception.hypocalcemiaMm < 75, 'the hypocalcemia readout falls');
  assert.equal(interoception.hypercalcemiaMm, 0);
});

test('high calcium lowers PTH, deposits bone calcium, and raises the hypercalcemia readout', () => {
  let pth = { ...parathyroidInitialState };
  let calcium = { mgDl: 11, boneStoreG: 100 };
  let interoception;

  for (let roundIndex = 0; roundIndex < 60; roundIndex++) {
    const next = cycle({
      pth,
      calcium,
      blood: { gfrMlMin: 100 },
    });
    pth = next.pth;
    calcium = next.calcium;
    interoception = next.interoception;
  }

  assert.ok(pth.pthPgMl < 30, 'PTH falls below baseline');
  assert.ok(calcium.boneStoreG > 100, 'bone stores the deposit');
  assert.ok(calcium.mgDl < 11, 'blood calcium falls from the high seed');
  assert.ok(calcium.mgDl > 9.5, 'it is still above the reference after 60 rounds');
  assert.ok(interoception.hypercalcemiaMm < 75, 'the hypercalcemia readout falls');
  assert.equal(interoception.hypocalcemiaMm, 0);
});

test('the 9.5 mg/dL reference is a stable setpoint with zero calcium readouts', () => {
  let pth = { ...parathyroidInitialState };
  let calcium = { mgDl: 9.5, boneStoreG: 100 };
  let interoception;

  for (let roundIndex = 0; roundIndex < 60; roundIndex++) {
    const next = cycle({
      pth,
      calcium,
      blood: { gfrMlMin: 100 },
    });
    assert.equal(
      next.calcium.mgDl,
      9.5,
      `round ${roundIndex + 1}: mgDl stays at the reference`,
    );
    assert.equal(
      next.interoception.hypocalcemiaMm,
      0,
      `round ${roundIndex + 1}: hypocalcemiaMm stays zero`,
    );
    assert.equal(
      next.interoception.hypercalcemiaMm,
      0,
      `round ${roundIndex + 1}: hypercalcemiaMm stays zero`,
    );
    pth = next.pth;
    calcium = next.calcium;
    interoception = next.interoception;
  }

  assert.equal(pth.pthPgMl, 30);
  assert.deepEqual(calcium, { mgDl: 9.5, boneStoreG: 100 });
  assert.equal(interoception.hypocalcemiaMm, 0);
  assert.equal(interoception.hypercalcemiaMm, 0);
});

test('blood calcium output is finite and JSON-safe', () => {
  const cases = [
    ['no upstream parts', {}],
    ['release', {
      state: { mgDl: 9.5, boneStoreG: 100 },
      parathyroid: { pthPgMl: 60 },
      blood: { gfrMlMin: 0 },
    }],
    ['deposit', {
      state: { mgDl: 9.5, boneStoreG: 100 },
      parathyroid: { pthPgMl: 0 },
    }],
    ['high GFR', {
      state: { mgDl: 11, boneStoreG: 100 },
      parathyroid: { pthPgMl: 7.5 },
      blood: { gfrMlMin: 200 },
    }],
    ['fractional dt', {
      state: { mgDl: 8, boneStoreG: 0.2 },
      parathyroid: { pthPgMl: 75 },
      blood: { gfrMlMin: 37 },
      dt: 90,
    }],
  ];

  for (const [label, input] of cases) {
    const { written, writes } = round(input);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
