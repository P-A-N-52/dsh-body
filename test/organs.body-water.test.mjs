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

const skinStub = {
  id: 'skin',
  initialState: { sweatRequestMl: 0, sweatVolumeMl: 0 },
  fields: {
    sweatRequestMl: { unit: 'mL', mode: 'absolute' },
    sweatVolumeMl: {
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
    skinStub,
    { id, initialState, fields },
  ]);
}

function runHeartbeat({ fluid, kidney, skin, dt = 60 }) {
  const transfers = [];
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'bodyFluid') return fluid;
      if (partId === 'kidney') return kidney;
      if (partId === 'skin') return skin;
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

function round({
  fluid,
  kidney,
  skin = { sweatRequestMl: 0, sweatVolumeMl: 0 },
  intestineInflowMl = 0,
  bladderVolumeMl = 0,
}) {
  const fieldRegistry = registry();
  const snapshotParts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: intestineInflowMl },
    bladder: { volumeMl: bladderVolumeMl },
    bodyFluid: fluid,
    kidney,
    skin: { sweatVolumeMl: 0, ...skin },
  };
  const { written, transfers } = runHeartbeat({ fluid, kidney, skin });
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
      transferOut: ['bladder.volumeMl', 'skin.sweatVolumeMl'],
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
    ['bodyFluid', 'waterVolumeMl', 'skin', 'sweatVolumeMl', 0],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 30100);
  assert.equal(next.bladder.volumeMl, 100);
  assert.equal(next.skin.sweatVolumeMl, 0);
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

test('kidney is paid first and sweat takes only the remaining round-start water', () => {
  const { written, transfers, next } = round({
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 60 },
    skin: { sweatRequestMl: 60, sweatVolumeMl: 0 },
  });

  assert.deepEqual(written, { waterVolumeMl: 100, waterDeficit: 1 });
  assert.deepEqual(transfers, [
    ['bodyFluid', 'waterVolumeMl', 'bladder', 'volumeMl', 60],
    ['bodyFluid', 'waterVolumeMl', 'skin', 'sweatVolumeMl', 40],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 0);
  assert.equal(next.bladder.volumeMl, 60);
  assert.equal(next.skin.sweatVolumeMl, 40);
  assert.ok(next.bladder.volumeMl + next.skin.sweatVolumeMl <= 100);
});

test('sweat receives nothing when the kidney request already uses all round-start water', () => {
  const { transfers, next } = round({
    fluid: { waterVolumeMl: 40, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 100 },
    skin: { sweatRequestMl: 50, sweatVolumeMl: 0 },
  });

  assert.deepEqual(transfers, [
    ['bodyFluid', 'waterVolumeMl', 'bladder', 'volumeMl', 40],
    ['bodyFluid', 'waterVolumeMl', 'skin', 'sweatVolumeMl', 0],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 0);
  assert.equal(next.bladder.volumeMl, 40);
  assert.equal(next.skin.sweatVolumeMl, 0);
});

test('same-round intestine inflow cannot pay the sweat transfer', () => {
  const { transfers, next } = round({
    fluid: { waterVolumeMl: 30, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 20 },
    skin: { sweatRequestMl: 20, sweatVolumeMl: 0 },
    intestineInflowMl: 100,
  });

  assert.deepEqual(transfers, [
    ['bodyFluid', 'waterVolumeMl', 'bladder', 'volumeMl', 20],
    ['bodyFluid', 'waterVolumeMl', 'skin', 'sweatVolumeMl', 10],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 100);
  assert.equal(next.bladder.volumeMl, 20);
  assert.equal(next.skin.sweatVolumeMl, 10);
  assert.equal(next.bodyFluid.waterDeficit, 1);
});

test('an actual sweat transfer does not overwrite the round-start request field', () => {
  const { next } = round({
    fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 10 },
    skin: { sweatRequestMl: 0.6, sweatVolumeMl: 0 },
  });

  assert.equal(next.skin.sweatVolumeMl, 0.6);
  assert.equal(next.skin.sweatRequestMl, 0.6);
});

test('a missing, negative, non-finite, or non-numeric sweat request transfers nothing', () => {
  const requests = [
    {},
    { sweatRequestMl: -5 },
    { sweatRequestMl: Number.NaN },
    { sweatRequestMl: Number.POSITIVE_INFINITY },
    { sweatRequestMl: '0.6' },
  ];
  for (const skin of requests) {
    const { transfers, next } = round({
      fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 10 },
      skin,
    });
    assert.equal(transfers[0][4], 10);
    assert.equal(transfers[1][4], 0);
    assert.equal(next.skin.sweatVolumeMl, 0);
    assert.equal(next.bodyFluid.waterVolumeMl, 29990);
  }
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
    assert.equal(transfers.length, 2);
    assert.equal(transfers[0][4], 0);
    assert.equal(transfers[1][4], 0);
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
    skin: { sweatRequestMl: 0, sweatVolumeMl: 0 },
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
