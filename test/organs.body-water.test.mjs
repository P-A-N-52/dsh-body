import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-compartments/body-water/water.ts';

const stomachStub = {
  id: 'stomach',
  initialState: { waterVolumeMl: 0 },
  fields: {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferOut: ['smallIntestine.waterVolumeMl'],
    },
  },
};

const smallIntestineStub = {
  id: 'smallIntestine',
  initialState: { waterVolumeMl: 0 },
  fields: {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['stomach.waterVolumeMl'],
      transferOut: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const bladderStub = {
  id: 'bladder',
  initialState: { volumeMl: 0 },
  fields: {
    volumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  },
};

function registry() {
  return createFieldRegistry([
    stomachStub,
    smallIntestineStub,
    bladderStub,
    { id, initialState, fields },
  ]);
}

function runHeartbeat({ fluid, kidney, dt = 60 }) {
  const transfers = [];
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'bodyFluid') return fluid;
      if (partId === 'kidney') return kidney;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => transfers.push(args),
  });
  return { written, transfers };
}

function round({ fluid, kidney, intestineInflowMl = 0, bladderVolumeMl = 0 }) {
  const fieldRegistry = registry();
  const snapshotParts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: intestineInflowMl },
    bladder: { volumeMl: bladderVolumeMl },
    bodyFluid: fluid,
    kidney,
  };
  const { written, transfers } = runHeartbeat({ fluid, kidney });
  const writtenSnapshot = structuredClone(written);
  const allTransfers = transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
    caller: id,
    fromPart,
    fromField,
    toPart,
    toField,
    amount,
  }));
  if (intestineInflowMl > 0) {
    allTransfers.push({
      caller: 'smallIntestine',
      fromPart: 'smallIntestine',
      fromField: 'waterVolumeMl',
      toPart: 'bodyFluid',
      toField: 'waterVolumeMl',
      amount: intestineInflowMl,
    });
  }
  const writes = { bodyFluid: written };
  if (intestineInflowMl > 0) writes.smallIntestine = { waterVolumeMl: intestineInflowMl };
  const next = applyOperations({ registry: fieldRegistry, snapshotParts, writes, transfers: allTransfers });
  return { written: writtenSnapshot, transfers, next };
}

test('bodyFluid exports the compartment module contract', () => {
  assert.equal(id, 'bodyFluid');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['smallIntestine.waterVolumeMl'],
      transferOut: ['bladder.volumeMl'],
    },
    waterDeficit: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { waterVolumeMl: 30000, waterDeficit: 0 });
});

test('writes the round-start volume and pays the kidney request only from it', () => {
  const { written, transfers, next } = round({
    fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 100 },
    intestineInflowMl: 200,
  });

  assert.deepEqual(written, { waterVolumeMl: 30000, waterDeficit: 0 });
  assert.deepEqual(transfers, [
    ['bodyFluid', 'waterVolumeMl', 'bladder', 'volumeMl', 100],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 30100);
  assert.equal(next.bladder.volumeMl, 100);
  assert.equal(next.bodyFluid.waterDeficit, 0);
});

test('the round-start request is not recomputed from same-round intestine inflow', () => {
  const small = round({
    fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 100 },
    intestineInflowMl: 0,
  });
  const large = round({
    fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 100 },
    intestineInflowMl: 5000,
  });

  assert.equal(small.transfers[0][4], large.transfers[0][4]);
  assert.equal(small.next.bladder.volumeMl, 100);
  assert.equal(large.next.bladder.volumeMl, 100);
  assert.equal(large.next.bodyFluid.waterVolumeMl, 34900);
});

test('clamps a request larger than the round-start volume instead of failing', () => {
  const { written, transfers, next } = round({
    fluid: { waterVolumeMl: 40, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 100 },
  });

  assert.deepEqual(written, { waterVolumeMl: 40, waterDeficit: 1 });
  assert.equal(transfers[0][4], 40);
  assert.equal(next.bodyFluid.waterVolumeMl, 0);
  assert.equal(next.bladder.volumeMl, 40);
});

test('waterDeficit is read from the round-start volume and clamped to -1..1', () => {
  const cases = [
    [30000, 0],
    [29750, 0.5],
    [30250, -0.5],
    [29000, 1],
    [31000, -1],
  ];
  for (const [waterVolumeMl, expected] of cases) {
    const { written } = runHeartbeat({
      fluid: { waterVolumeMl, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 0 },
    });
    assert.equal(written.waterDeficit, expected, `water ${waterVolumeMl}`);
    assert.equal(written.waterVolumeMl, waterVolumeMl);
  }
});

test('a missing or invalid kidney request transfers nothing', () => {
  for (const kidney of [undefined, {}, { urineProductionRequestMl: -5 }, { urineProductionRequestMl: Number.NaN }]) {
    const { transfers } = runHeartbeat({
      fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
      kidney,
    });
    assert.equal(transfers[0][4], 0);
  }
});

test('body water plus bladder is conserved over rounds without urination', () => {
  const fieldRegistry = registry();
  let parts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: 0 },
    bladder: { volumeMl: 0 },
    bodyFluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 0.7 },
  };
  const initialTotal = parts.bodyFluid.waterVolumeMl + parts.bladder.volumeMl;

  for (let index = 0; index < 50; index++) {
    const { written, transfers } = runHeartbeat({
      fluid: parts.bodyFluid,
      kidney: parts.kidney,
    });
    parts = applyOperations({
      registry: fieldRegistry,
      snapshotParts: parts,
      writes: { bodyFluid: written },
      transfers: transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
        caller: id,
        fromPart,
        fromField,
        toPart,
        toField,
        amount,
      })),
    });
    const total = parts.bodyFluid.waterVolumeMl + parts.bladder.volumeMl;
    assert.ok(Math.abs(total - initialTotal) < 1e-6, `round ${index + 1}: ${total}`);
  }
  assert.ok(parts.bladder.volumeMl > 0);
  assert.ok(parts.bodyFluid.waterVolumeMl < initialTotal);
});
