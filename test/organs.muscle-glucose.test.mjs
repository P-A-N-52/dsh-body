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
} from '../organs/human-organs/skeletal-muscle/glucose-uptake.ts';

const parametersUrl = new URL(
  '../organs/human-organs/skeletal-muscle/glucose-uptake.parameters.json',
  import.meta.url,
);

const allRegions = {
  muscleHead: { uptakeG: 0, glycogenG: 0, glycogenConsumedG: 0 },
  muscleTrunk: { uptakeG: 0, glycogenG: 0, glycogenConsumedG: 0 },
  muscleLimbs: { uptakeG: 0, glycogenG: 0, glycogenConsumedG: 0 },
};

function round({
  state,
  regions = allRegions,
  glucose = { excessMassG: 0 },
  pancreas,
  dt = 60,
  simulatedSeconds = 60,
} = {}) {
  const writes = [];
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'muscleGlucose') return state;
      if (partId === 'glucose') return glucose === null ? undefined : glucose;
      if (partId === 'pancreasEndocrine') return pancreas;
      if (Object.hasOwn(regions, partId)) return regions[partId];
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

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function expectMuscleError({
  activity,
  state,
  regions,
  glucose = { excessMassG: 0 },
  pancreas,
} = {}, label) {
  const writes = [];
  const transfers = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'muscleGlucose') return state;
        if (partId === 'glucose') return glucose === null ? undefined : glucose;
        if (partId === 'pancreasEndocrine') return pancreas;
        if (activity !== undefined && partId === 'physicalActivity') return activity;
        if (regions !== undefined && Object.hasOwn(regions, partId)) return regions[partId];
        return undefined;
      },
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

test('muscleGlucose exports the request and regional distribution contract', () => {
  assert.equal(id, 'muscleGlucose');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    uptakeG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
      transferOut: [
        'muscleHead.uptakeG',
        'muscleTrunk.uptakeG',
        'muscleLimbs.uptakeG',
      ],
    },
    uptakeRequestG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });

  const { written } = round();
  assert.deepEqual(written, {
    uptakeG: 0,
    uptakeRequestG: 0,
  });
});

test('the parameters keep the shared uptake and glycogen use design defaults', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.owner, 'muscleGlucose');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId), [
    'muscleGlucose.glycogenUseRateGPerMin',
    'muscleGlucose.maxUptakeRateGPerMin',
    'muscleGlucose.halfMaxExcessG',
    'muscleGlucose.insulinSensitivity',
    'muscleGlucose.exerciseUptakeRateGPerMin',
  ]);

  const useRate = byId['muscleGlucose.glycogenUseRateGPerMin'];
  assert.equal(useRate.value, 0.5);
  assert.equal(useRate.unit, 'g/min');
  assert.equal(useRate.status, 'design');
  assert.equal(useRate.source, null);
  assert.deepEqual(useRate.range, [0, 5]);

  const expected = {
    'muscleGlucose.maxUptakeRateGPerMin': [0.5, 'g/min', [0, 5]],
    'muscleGlucose.halfMaxExcessG': [20, 'g', [0.1, 500]],
    'muscleGlucose.insulinSensitivity': [1, '1', [0, 5]],
    'muscleGlucose.exerciseUptakeRateGPerMin': [0.15, 'g/min', [0, 1]],
  };
  for (const [parameterId, [value, unit, range]] of Object.entries(expected)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
    assert.deepEqual(parameter.range, range, `${parameterId}: range`);
  }

  assert.deepEqual(loadParameters(parametersUrl), {
    'muscleGlucose.glycogenUseRateGPerMin': 0.5,
    'muscleGlucose.maxUptakeRateGPerMin': 0.5,
    'muscleGlucose.halfMaxExcessG': 20,
    'muscleGlucose.insulinSensitivity': 1,
    'muscleGlucose.exerciseUptakeRateGPerMin': 0.15,
  });
});

test('the uptake request follows the saturating excess and insulin response formula', () => {
  const baseline = round({
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 1 },
    dt: 60,
  });
  assertClose(
    baseline.written.uptakeRequestG,
    0.5 * (20 / 40),
    '20 g excess at baseline insulin over one minute',
  );

  const doubled = round({
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 2 },
    dt: 60,
  });
  assertClose(
    doubled.written.uptakeRequestG,
    0.5 * (20 / 40) * 2,
    'insulin sensitivity 1 doubles the response at relative 2',
  );

  const fractionalMinute = round({
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 2 },
    dt: 30,
  });
  assertClose(
    fractionalMinute.written.uptakeRequestG,
    0.5 * (20 / 40) * 2 * 0.5,
    'the request scales with dt',
  );

  const noExcess = round({
    glucose: { excessMassG: 0 },
    pancreas: { insulinRelative: 2 },
    dt: 60,
  });
  assert.equal(noExcess.written.uptakeRequestG, 0, 'no excess yields no request');

  const saturating = round({
    glucose: { excessMassG: 60 },
    pancreas: { insulinRelative: 1 },
    dt: 60,
  });
  assertClose(
    saturating.written.uptakeRequestG,
    0.5 * (60 / 80),
    'the half-max excess keeps the response below the maximum rate',
  );
});

test('the request is rewritten every round from the round-start snapshot', () => {
  const zeroed = round({
    state: { uptakeG: 0, uptakeRequestG: 3 },
    glucose: { excessMassG: 0 },
    pancreas: { insulinRelative: 1 },
  });
  assert.equal(zeroed.written.uptakeRequestG, 0, 'the old request is not carried over');

  const recomputed = round({
    state: { uptakeG: 0, uptakeRequestG: 0 },
    glucose: { excessMassG: 20 },
    pancreas: { insulinRelative: 2 },
  });
  assertClose(recomputed.written.uptakeRequestG, 0.5, 'the new request uses this round inputs');
});

test('a missing glucose or pancreas part falls back without hiding invalid loaded data', () => {
  const noGlucose = round({ glucose: null, pancreas: { insulinRelative: 1 } });
  assert.equal(noGlucose.written.uptakeRequestG, 0, 'no glucose part means no excess signal');

  const noPancreas = round({ glucose: { excessMassG: 20 }, pancreas: undefined });
  assertClose(
    noPancreas.written.uptakeRequestG,
    0.5 * (20 / 40),
    'a missing pancreas part reads baseline insulin',
  );
});

test('settled uptake is distributed to the three regions by their shares', () => {
  const { written, transfers } = round({
    state: { uptakeG: 1.2, uptakeRequestG: 0 },
  });

  assert.equal(transfers.length, 3);
  const amounts = Object.fromEntries(
    transfers.map(([, , toPart, toField, amount]) => {
      assert.equal(toField, 'uptakeG');
      return [toPart, amount];
    }),
  );
  assertClose(amounts.muscleHead, 1.2 * 0.05, 'head share');
  assertClose(amounts.muscleTrunk, 1.2 * 0.45, 'trunk share');
  assertClose(amounts.muscleLimbs, 1.2 * 0.5, 'limbs share');
  assertClose(
    amounts.muscleHead + amounts.muscleTrunk + amounts.muscleLimbs,
    1.2,
    'the shares add up to the settled uptake',
  );

  for (const transfer of transfers) {
    assert.equal(transfer[0], 'muscleGlucose');
    assert.equal(transfer[1], 'uptakeG');
  }
  assert.equal(
    written.uptakeG,
    1.2,
    'write returns the pre-transfer balance so the Gateway can subtract the transfers',
  );
  assert.equal('glycogenG' in written, false, 'muscleGlucose no longer stores glycogen');
  assert.equal('glycogenConsumedG' in written, false);
});

test('the shares are normalized over the regions that are loaded', () => {
  const headAndTrunk = round({
    state: { uptakeG: 1, uptakeRequestG: 0 },
    regions: { muscleHead: {}, muscleTrunk: {} },
  });
  assert.equal(headAndTrunk.transfers.length, 2);
  assertClose(headAndTrunk.transfers[0][4], 0.1, 'head renormalized to 0.1');
  assertClose(headAndTrunk.transfers[1][4], 0.9, 'trunk renormalized to 0.9');
  assertClose(
    headAndTrunk.transfers[0][4] + headAndTrunk.transfers[1][4],
    1,
    'head and trunk still distribute the whole uptake',
  );

  const limbsOnly = round({
    state: { uptakeG: 0.7, uptakeRequestG: 0 },
    regions: { muscleLimbs: {} },
  });
  assert.deepEqual(limbsOnly.transfers, [
    ['muscleGlucose', 'uptakeG', 'muscleLimbs', 'uptakeG', 0.7],
  ]);
  assert.equal(limbsOnly.written.uptakeG, 0.7);
});

test('uptake stays pending when no region is loaded', () => {
  const { written, transfers } = round({
    state: { uptakeG: 0.7, uptakeRequestG: 0 },
    regions: {},
  });
  assert.deepEqual(transfers, []);
  assert.equal(written.uptakeG, 0.7, 'the balance is kept for a later round');
});

test('zero settled uptake produces no transfers', () => {
  const { written, transfers } = round({
    state: { uptakeG: 0, uptakeRequestG: 0 },
  });
  assert.deepEqual(transfers, []);
  assert.equal(written.uptakeG, 0);
});

test('the per-region amounts never exceed the settled uptake', () => {
  const { transfers } = round({
    state: { uptakeG: 0.3, uptakeRequestG: 0 },
    regions: { muscleHead: {}, muscleTrunk: {}, muscleLimbs: {} },
  });
  const total = transfers.reduce((sum, [, , , , amount]) => sum + amount, 0);
  assert.ok(total <= 0.3, `transfers ${total} exceed the settled uptake`);
  assertClose(total, 0.3, 'the whole uptake is distributed');
});

test('a loaded glucose or pancreas part with invalid fields fails with zero writes', () => {
  const invalid = [
    ['missing excess', { glucose: {} }],
    ['non-number excess', { glucose: { excessMassG: '20' } }],
    ['non-finite excess', { glucose: { excessMassG: Number.NaN } }],
    ['infinite excess', { glucose: { excessMassG: Number.POSITIVE_INFINITY } }],
    ['negative excess', { glucose: { excessMassG: -0.1 } }],
    ['missing insulin', { pancreas: {} }],
    ['non-number insulin', { pancreas: { insulinRelative: '1' } }],
    ['non-finite insulin', { pancreas: { insulinRelative: Number.NaN } }],
    ['negative insulin', { pancreas: { insulinRelative: -1 } }],
  ];

  for (const [label, parts] of invalid) {
    expectMuscleError(parts, label);
  }
});

test('muscleGlucose output is finite and JSON-safe with or without regions', () => {
  const cases = [
    { label: 'missing state and regions', options: { regions: {} } },
    {
      label: 'all regions with a request and settled uptake',
      options: {
        state: { uptakeG: 1.2, uptakeRequestG: 0.3 },
        glucose: { excessMassG: 20 },
        pancreas: { insulinRelative: 2 },
      },
    },
    {
      label: 'renormalized partial regions',
      options: {
        state: { uptakeG: 0.7, uptakeRequestG: 0 },
        regions: { muscleHead: {}, muscleLimbs: {} },
        glucose: { excessMassG: 7.5 },
        pancreas: { insulinRelative: 1.5 },
        dt: 90,
      },
    },
    {
      label: 'pending uptake without regions',
      options: { state: { uptakeG: 0.1, uptakeRequestG: 0 }, regions: {} },
    },
    {
      label: 'legacy glycogen fields are not written back',
      options: { state: { uptakeG: 0.4, glycogenG: 10, glycogenConsumedG: 0.5 } },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes, transfers } = round(options);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    for (const transfer of transfers) {
      assert.ok(Number.isFinite(transfer[4]), `${label}: transfer amount must be finite`);
      assert.ok(transfer[4] >= 0, `${label}: transfer amount must not be negative`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
