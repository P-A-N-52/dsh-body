import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/colon/colon.ts';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { assertJsonValue } from '../json-safe.js';

const bodyFluid = { waterVolumeMl: 30000 };

function round(state, actions = [], { dt = 60, fluid = bodyFluid } = {}) {
  let written;
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'colon') return state;
      if (partId === 'bodyFluid') return fluid;
      return undefined;
    },
    actions,
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => transfers.push(args),
  });
  return { written, transfers };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('colon exports the organ module contract', () => {
  assert.equal(id, 'colon');
  assert.deepEqual(actionTypes, ['defecate']);
  assert.deepEqual(fields, {
    residueWaterMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['smallIntestine.waterVolumeMl'],
    },
    stoolG: { unit: 'g', mode: 'absolute' },
    defecatedG: { unit: 'g', mode: 'absolute' },
    reclaimedWaterMl: {
      unit: 'mL',
      mode: 'absolute',
      transferOut: ['bodyFluid.waterVolumeMl'],
    },
    bowelUrgencyMm: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    residueWaterMl: 0,
    stoolG: 0,
    defecatedG: 0,
    reclaimedWaterMl: 0,
    bowelUrgencyMm: 0,
  });
});

test('the colon parameters are design placeholders with no source', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/colon/colon.parameters.json', import.meta.url),
    'utf8',
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  for (const [parameterId, value, unit] of [
    ['colon.reclamationRatePerMin', 0.001, '1/min'],
    ['colon.stoolFormationGPerMin', 0.01, 'g/min'],
    ['colon.referenceStoolG', 200, 'g'],
  ]) {
    const parameter = byId[parameterId];
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
});

test('a missing saved part falls back to zero and transfers zero', () => {
  const { written, transfers } = round(undefined);
  assert.deepEqual(written, {
    residueWaterMl: 0,
    stoolG: 0.01,
    defecatedG: 0,
    reclaimedWaterMl: 0,
    bowelUrgencyMm: 0.005,
  });
  assert.deepEqual(transfers, [['colon', 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', 0]]);
});

test('one round reclaims 0.1% of the round-start residue and sends it to body fluid', () => {
  const { written, transfers } = round({ ...initialState, residueWaterMl: 1000 });
  assertClose(written.residueWaterMl, 999, 'residue after reclaim');
  assertClose(written.reclaimedWaterMl, 1, 'reclaimed');
  assertClose(written.stoolG, 0.01, 'stool');
  assert.equal(written.defecatedG, 0);
  assertClose(written.bowelUrgencyMm, 0.005, 'urgency');
  assert.deepEqual(transfers, [['colon', 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', 1]]);
});

test('reclaim is proportional to the round-start residue and never exceeds it', () => {
  const tiny = round({ ...initialState, residueWaterMl: 0.0005 });
  assertClose(tiny.written.reclaimedWaterMl, 5e-7, 'tiny reclaimed');
  assertClose(tiny.written.residueWaterMl, 0.0004995, 'tiny residue');
  assert.deepEqual(
    tiny.transfers,
    [['colon', 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', 5e-7]],
  );

  const capped = round({ ...initialState, residueWaterMl: 0.0005 }, [], { dt: 120000 });
  assertClose(capped.written.reclaimedWaterMl, 0.0005, 'capped reclaimed');
  assert.equal(capped.written.residueWaterMl, 0);
  assert.deepEqual(
    capped.transfers,
    [['colon', 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', 0.0005]],
  );

  const empty = round({ ...initialState, residueWaterMl: 0 });
  assert.equal(empty.written.residueWaterMl, 0);
  assert.equal(empty.written.reclaimedWaterMl, 0);
  assert.deepEqual(empty.transfers, [['colon', 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', 0]]);
});

test('stool forms at the design rate and drives bowel urgency', () => {
  const { written } = round({ ...initialState, stoolG: 100 });
  assertClose(written.stoolG, 100.01, 'stool');
  assert.equal(written.defecatedG, 0);
  assertClose(written.bowelUrgencyMm, 50.005, 'urgency');

  assert.equal(round({ ...initialState, stoolG: 0 }).written.bowelUrgencyMm, 0.005);
  assertClose(round({ ...initialState, stoolG: 100 }).written.bowelUrgencyMm, 50.005, 'urgency at 100 g');
  assert.equal(round({ ...initialState, stoolG: 200 }).written.bowelUrgencyMm, 100);
  assert.equal(round({ ...initialState, stoolG: 400 }).written.bowelUrgencyMm, 100);
});

test('a defecate action clears the round-start stool and the urgency', () => {
  const { written, transfers } = round(
    { ...initialState, stoolG: 100 },
    [{ type: 'defecate' }],
  );
  assert.equal(written.defecatedG, 100);
  assert.equal(written.stoolG, 0);
  assert.equal(written.bowelUrgencyMm, 0);
  assert.deepEqual(transfers, [['colon', 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', 0]]);

  const twice = round({ ...initialState, stoolG: 100 }, [{ type: 'defecate' }, { type: 'defecate' }]);
  assert.equal(twice.written.defecatedG, 100);
  assert.equal(twice.written.stoolG, 0);
});

test('defecatedG is a per-round flux and resets on the next round', () => {
  const first = round({ ...initialState, stoolG: 100 }, [{ type: 'defecate' }]).written;
  assert.equal(first.defecatedG, 100);
  const second = round(first).written;
  assert.equal(second.defecatedG, 0);
  assertClose(second.stoolG, 0.01, 'new stool');
  assertClose(second.bowelUrgencyMm, 0.005, 'new urgency');
});

test('a non-defecate action does not clear stool', () => {
  const { written } = round({ ...initialState, stoolG: 50 }, [{ type: 'urinate' }, { type: 'drink' }]);
  assertClose(written.stoolG, 50.01, 'stool');
  assert.equal(written.defecatedG, 0);
});

test('an invalid body fluid target throws before writing or transferring', () => {
  for (const fluid of [
    {},
    { waterVolumeMl: Number.NaN },
    { waterVolumeMl: Number.POSITIVE_INFINITY },
    { waterVolumeMl: -1 },
    5,
  ]) {
    let written;
    const transfers = [];
    assert.throws(() => {
      heartbeat({
        read: (partId) => {
          if (partId === 'colon') return { ...initialState, residueWaterMl: 100, stoolG: 50 };
          if (partId === 'bodyFluid') return fluid;
          return undefined;
        },
        actions: [{ type: 'defecate' }],
        dt: 60,
        simulatedSeconds: 60,
        write: (next) => { written = next; },
        transfer: (...args) => transfers.push(args),
      });
    }, /bodyFluid/);
    assert.equal(written, undefined);
    assert.equal(transfers.length, 0);
  }
});

test('the output stays finite and JSON-safe for corrupt state and oversized pools', () => {
  const corrupt = round({
    residueWaterMl: Number.NaN,
    stoolG: Number.POSITIVE_INFINITY,
    defecatedG: Number.NaN,
    reclaimedWaterMl: Number.NaN,
    bowelUrgencyMm: Number.NaN,
  });
  assert.equal(corrupt.written.residueWaterMl, 0);
  assert.equal(corrupt.written.reclaimedWaterMl, 0);
  assert.equal(corrupt.written.stoolG, 0.01);
  assert.equal(corrupt.written.defecatedG, 0);
  assert.equal(corrupt.written.bowelUrgencyMm, 0.005);
  assertJsonValue(corrupt.written);

  const oversized = round({
    ...initialState,
    residueWaterMl: Number.MAX_VALUE,
    stoolG: Number.MAX_VALUE,
  });
  assert.ok(Number.isFinite(oversized.written.residueWaterMl));
  assert.ok(Number.isFinite(oversized.written.reclaimedWaterMl));
  assert.ok(Number.isFinite(oversized.written.stoolG));
  assert.equal(oversized.written.bowelUrgencyMm, 100);
  assertJsonValue(oversized.written);
});

test('reclaimed water flows into body fluid while incoming residue lands after the write', () => {
  const smallIntestineStub = {
    id: 'smallIntestine',
    initialState: { waterVolumeMl: 0 },
    fields: {
      waterVolumeMl: {
        unit: 'mL',
        mode: 'absolute',
        transferOut: ['colon.residueWaterMl'],
      },
    },
  };
  const bodyFluidStub = {
    id: 'bodyFluid',
    initialState: { waterVolumeMl: 30000 },
    fields: {
      waterVolumeMl: {
        unit: 'mL',
        mode: 'absolute',
        transferIn: ['colon.reclaimedWaterMl'],
      },
    },
  };
  const registry = createFieldRegistry([
    smallIntestineStub,
    bodyFluidStub,
    { id, initialState, fields },
  ]);

  const start = { ...initialState, residueWaterMl: 1000 };
  const { written, transfers } = round(start);
  const next = applyOperations({
    registry,
    snapshotParts: {
      colon: start,
      bodyFluid: { waterVolumeMl: 30000 },
      smallIntestine: { waterVolumeMl: 5 },
    },
    writes: { colon: written },
    transfers: [
      ...transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
        caller: id,
        fromPart,
        fromField,
        toPart,
        toField,
        amount,
      })),
      {
        caller: 'smallIntestine',
        fromPart: 'smallIntestine',
        fromField: 'waterVolumeMl',
        toPart: 'colon',
        toField: 'residueWaterMl',
        amount: 5,
      },
    ],
  });

  assertClose(next.bodyFluid.waterVolumeMl, 30001, 'body fluid inflow');
  assertClose(next.colon.residueWaterMl, 1004, 'residue after reclaim and inflow');
  assert.equal(next.colon.reclaimedWaterMl, 0);
  assertClose(next.smallIntestine.waterVolumeMl, 0, 'small intestine after transfer');
});
