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
} from '../organs/human-organs/epididymis/storage.ts';

const parametersUrl = new URL(
  '../organs/human-organs/epididymis/storage.parameters.json',
  import.meta.url,
);

const recoveryMlPerMin = 0.002;
const capacityMl = 5;

function round({
  state,
  sexualResponse,
  dt = 60,
  simulatedSeconds = 60,
  actions = [],
  writes = [],
} = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'epididymis') return state;
      if (partId === 'sexualResponse') return sexualResponse;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function orgasmAt(simMin) {
  return {
    arousalMm: 0,
    phase: 'orgasm',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: simMin,
  };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('epididymis exports the storage contract without actions', () => {
  assert.equal(id, 'epididymis');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    spermStorageMl: { unit: 'mL', mode: 'absolute' },
    ejaculatedMl: { unit: 'mL', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { spermStorageMl: 0, ejaculatedMl: 0 });

  const withoutActions = round({
    state: { spermStorageMl: 1, ejaculatedMl: 0 },
    simulatedSeconds: 120,
  });
  const withActions = round({
    state: { spermStorageMl: 1, ejaculatedMl: 0 },
    simulatedSeconds: 120,
    actions: [
      { type: 'orgasm' },
      { type: 'sex', intensity: 1, durationMin: 10 },
    ],
  });
  assert.deepEqual(withActions.written, withoutActions.written);
  assert.deepEqual(Object.keys(withActions.written), ['spermStorageMl', 'ejaculatedMl']);
});

test('the epididymis parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'epididymis');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expectedParameters = {
    'epididymis.recoveryMlPerMin': { value: 0.002, unit: 'mL/min' },
    'epididymis.capacityMl': { value: 5, unit: 'mL' },
  };
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expectedParameters).sort());

  for (const [parameterId, { value, unit }] of Object.entries(expectedParameters)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
    assert.ok(Array.isArray(parameter.range), `${parameterId}: range`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expectedParameters).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('storage recovers at 0.002 mL per minute without an orgasm', () => {
  const oneMinute = round({ state: initialState });
  assertClose(oneMinute.written.spermStorageMl, recoveryMlPerMin, 'one minute');
  assert.equal(oneMinute.written.ejaculatedMl, 0);
  assert.equal(oneMinute.writes.length, 1);

  const tenMinutes = round({
    state: { spermStorageMl: 0.5, ejaculatedMl: 0 },
    dt: 600,
    simulatedSeconds: 660,
  });
  assertClose(tenMinutes.written.spermStorageMl, 0.52, 'ten minutes');

  const zeroDt = round({
    state: { spermStorageMl: 0.5, ejaculatedMl: 0 },
    dt: 0,
  });
  assertClose(zeroDt.written.spermStorageMl, 0.5, 'zero-length round');
});

test('storage never exceeds the 5 mL capacity', () => {
  const justBelow = round({
    state: { spermStorageMl: 4.999, ejaculatedMl: 0 },
    simulatedSeconds: 120,
  });
  assert.equal(justBelow.written.spermStorageMl, capacityMl, 'rounds up to the cap');

  const atCapacity = round({
    state: { spermStorageMl: capacityMl, ejaculatedMl: 0 },
    dt: 600,
    simulatedSeconds: 660,
  });
  assert.equal(atCapacity.written.spermStorageMl, capacityMl, 'stays at the cap');

  const longRound = round({
    state: { spermStorageMl: 4, ejaculatedMl: 0 },
    dt: 24 * 3600,
    simulatedSeconds: 24 * 3600,
  });
  assert.equal(longRound.written.spermStorageMl, capacityMl, 'a day of recovery caps');
});

test('an orgasm recorded in the previous round empties the round-start storage', () => {
  const { written, writes } = round({
    state: { spermStorageMl: 3, ejaculatedMl: 0 },
    sexualResponse: orgasmAt(1),
    simulatedSeconds: 120,
  });
  assert.equal(writes.length, 1);
  assert.equal(written.ejaculatedMl, 3);
  assert.equal(written.spermStorageMl, 0);

  const empty = round({
    state: initialState,
    sexualResponse: orgasmAt(1),
    simulatedSeconds: 120,
  }).written;
  assert.equal(empty.ejaculatedMl, 0);
  assert.equal(empty.spermStorageMl, 0);
});

test('orgasm detection uses the round-start snapshot rather than the round-end clock', () => {
  const { written } = round({
    state: { spermStorageMl: 2, ejaculatedMl: 0 },
    sexualResponse: orgasmAt(1),
    dt: 120,
    simulatedSeconds: 180,
  });
  assert.equal(written.ejaculatedMl, 2);
  assert.equal(written.spermStorageMl, 0);
});

test('the round after ejaculation recovers without ejaculating again', () => {
  const after = round({
    state: { spermStorageMl: 0, ejaculatedMl: 3 },
    sexualResponse: orgasmAt(1),
    simulatedSeconds: 180,
  }).written;
  assert.equal(after.ejaculatedMl, 0);
  assertClose(after.spermStorageMl, recoveryMlPerMin, 'first recovery round');

  const later = round({
    state: after,
    sexualResponse: orgasmAt(1),
    simulatedSeconds: 240,
  }).written;
  assert.equal(later.ejaculatedMl, 0);
  assertClose(later.spermStorageMl, 2 * recoveryMlPerMin, 'second recovery round');
});

test('a missing or non-matching sexualResponse leaves storage alone', () => {
  const cases = [
    ['missing part', undefined, 120],
    ['never orgasmed', orgasmAt(null), 120],
    ['older orgasm', orgasmAt(1), 300],
    ['orgasm in the future', orgasmAt(10), 120],
  ];

  for (const [label, sexualResponse, simulatedSeconds] of cases) {
    const { written } = round({
      state: { spermStorageMl: 1, ejaculatedMl: 1 },
      sexualResponse,
      simulatedSeconds,
    });
    assert.equal(written.ejaculatedMl, 0, `${label}: no ejaculation`);
    assertClose(
      written.spermStorageMl,
      1 + recoveryMlPerMin,
      `${label}: recovery continues`,
    );
  }
});

test('a loaded sexualResponse with an invalid lastOrgasmAtSimMin fails the round without writes', () => {
  const invalid = [
    ['missing field', {}],
    ['undefined', orgasmAt(undefined)],
    ['NaN', orgasmAt(Number.NaN)],
    ['positive infinity', orgasmAt(Number.POSITIVE_INFINITY)],
    ['negative infinity', orgasmAt(Number.NEGATIVE_INFINITY)],
    ['negative', orgasmAt(-1)],
    ['non-number', orgasmAt('1')],
    ['boolean', orgasmAt(true)],
  ];

  for (const [label, sexualResponse] of invalid) {
    const writes = [];
    assert.throws(
      () => round({ state: initialState, sexualResponse, simulatedSeconds: 120, writes }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('epididymis output is finite and JSON-safe', () => {
  const cases = [
    {
      label: 'missing upstream',
      options: { state: initialState },
    },
    {
      label: 'fractional dt',
      options: { state: { spermStorageMl: 0.5, ejaculatedMl: 0 }, dt: 90, simulatedSeconds: 90 },
    },
    {
      label: 'capacity',
      options: { state: { spermStorageMl: capacityMl, ejaculatedMl: 0 } },
    },
    {
      label: 'orgasm',
      options: {
        state: { spermStorageMl: 3, ejaculatedMl: 0 },
        sexualResponse: orgasmAt(1),
        simulatedSeconds: 120,
      },
    },
    {
      label: 'zero-storage orgasm',
      options: {
        state: initialState,
        sexualResponse: orgasmAt(1),
        simulatedSeconds: 120,
      },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    assert.deepEqual(Object.keys(written), ['spermStorageMl', 'ejaculatedMl']);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
