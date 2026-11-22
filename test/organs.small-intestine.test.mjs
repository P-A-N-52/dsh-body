import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  id,
  actionTypes,
  fields,
  initialState,
  heartbeat,
} from '../organs/human-organs/small-intestine/water-absorption.ts';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';

function round(state, dt = 60) {
  let written;
  const transfers = [];
  heartbeat({
    read: () => state,
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (fromPart, fromField, toPart, toField, amount) => {
      transfers.push({ caller: id, fromPart, fromField, toPart, toField, amount });
    },
  });
  return { written, transfers };
}

const halfTimeMin = 20;
const carbohydrateHalfTimeMin = 20;
const absorbedFrom = (waterMl, dt = 60) => waterMl * (1 - 2 ** (-(dt / 60) / halfTimeMin));
const absorbedCarbohydrateFrom = (carbohydrateG, dt = 60) =>
  carbohydrateG * (1 - 2 ** (-(dt / 60) / carbohydrateHalfTimeMin));

function assertOnlyZeroSmallIntestineCarbohydrateTransfers(transfers) {
  for (const transfer of transfers) {
    if (transfer.fromField === 'waterVolumeMl') continue;
    assert.deepEqual(
      [transfer.fromPart, transfer.fromField, transfer.toPart, transfer.toField],
      ['smallIntestine', 'carbohydrateG', 'glucose', 'glucoseMassG'],
    );
    assert.equal(transfer.amount, 0);
  }
}

test('small intestine declares the water and carbohydrate transfer pairs', () => {
  assert.equal(id, 'smallIntestine');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['stomach.waterVolumeMl'],
      transferOut: ['bodyFluid.waterVolumeMl'],
    },
    absorbedWaterMl: { unit: 'mL', mode: 'absolute' },
    carbohydrateG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['stomach.carbohydrateG'],
      transferOut: ['glucose.glucoseMassG'],
    },
    absorbedCarbohydrateG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    waterVolumeMl: 0,
    absorbedWaterMl: 0,
    carbohydrateG: 0,
    absorbedCarbohydrateG: 0,
  });
});

test('the absorption parameter is a design time scale, not a reported half-time', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url),
    'utf8',
  ));
  const parameter = data.parameters.find((entry) => entry.id === 'smallIntestine.absorption.halfTimeMin');
  assert.ok(parameter, 'smallIntestine.absorption.halfTimeMin must be declared');
  assert.equal(parameter.unit, 'min');
  assert.equal(parameter.value, 20);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, 'SRC-PERONNET-2012');
  assert.deepEqual(parameter.range, [1, 120]);
});

test('carbohydrate absorption has its own 20 minute design half-time', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url),
    'utf8',
  ));
  const parameter = data.parameters.find(
    (entry) => entry.id === 'smallIntestine.carbohydrateAbsorption.halfTimeMin',
  );
  assert.ok(parameter, 'smallIntestine.carbohydrateAbsorption.halfTimeMin must be declared');
  assert.equal(parameter.unit, 'min');
  assert.equal(parameter.value, 20);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
});

test('one 60 s round absorbs from the round-start pool and writes it before transferring', () => {
  const { written, transfers } = round({ ...initialState, waterVolumeMl: 100 });
  const expected = absorbedFrom(100);
  assert.equal(written.waterVolumeMl, 100);
  assert.ok(Math.abs(written.absorbedWaterMl - expected) < 1e-12);
  assert.deepEqual(transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl'), [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: expected,
  }]);
  assertOnlyZeroSmallIntestineCarbohydrateTransfers(transfers);
});

test('one round absorbs carbohydrate from the round-start pool and transfers it to glucose', () => {
  const { written, transfers } = round({ ...initialState, carbohydrateG: 60 });
  const expected = absorbedCarbohydrateFrom(60);
  assert.equal(written.carbohydrateG, 60);
  assert.ok(Math.abs(written.absorbedCarbohydrateG - expected) < 1e-12);
  assert.deepEqual(
    transfers.filter((transfer) => transfer.fromField === 'carbohydrateG'),
    [{
      caller: 'smallIntestine',
      fromPart: 'smallIntestine',
      fromField: 'carbohydrateG',
      toPart: 'glucose',
      toField: 'glucoseMassG',
      amount: expected,
    }],
  );
});

test('carbohydrate delivered by the stomach in the same round is added after absorption', () => {
  const stomachStub = {
    id: 'stomach',
    initialState: { waterVolumeMl: 0, carbohydrateG: 0 },
    fields: {
      waterVolumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['smallIntestine.waterVolumeMl'] },
      carbohydrateG: { unit: 'g', mode: 'absolute', transferOut: ['smallIntestine.carbohydrateG'] },
    },
  };
  const bodyFluidStub = {
    id: 'bodyFluid',
    initialState: { waterVolumeMl: 30000 },
    fields: {
      waterVolumeMl: { unit: 'mL', mode: 'absolute', transferIn: ['smallIntestine.waterVolumeMl'] },
    },
  };
  const glucoseStub = {
    id: 'glucose',
    initialState: { glucoseMassG: 12.69 },
    fields: {
      glucoseMassG: { unit: 'g', mode: 'absolute', transferIn: ['smallIntestine.carbohydrateG'] },
    },
  };
  const registry = createFieldRegistry([
    stomachStub,
    { id, initialState, fields },
    bodyFluidStub,
    glucoseStub,
  ]);

  const start = { ...initialState, waterVolumeMl: 100, carbohydrateG: 60 };
  const { written, transfers } = round(start);
  const expectedWaterMl = absorbedFrom(100);
  const expectedCarbohydrateG = absorbedCarbohydrateFrom(60);
  const carbTransfers = transfers.filter((transfer) => transfer.fromField === 'carbohydrateG');
  assert.deepEqual(carbTransfers, [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'carbohydrateG',
    toPart: 'glucose',
    toField: 'glucoseMassG',
    amount: expectedCarbohydrateG,
  }]);
  const next = applyOperations({
    registry,
    snapshotParts: {
      stomach: { waterVolumeMl: 20, carbohydrateG: 30 },
      smallIntestine: start,
      bodyFluid: { waterVolumeMl: 30000 },
      glucose: { glucoseMassG: 12.69 },
    },
    writes: {
      smallIntestine: written,
      stomach: { waterVolumeMl: 20, carbohydrateG: 30 },
    },
    transfers: [
      ...transfers,
      {
        caller: 'stomach',
        fromPart: 'stomach',
        fromField: 'waterVolumeMl',
        toPart: 'smallIntestine',
        toField: 'waterVolumeMl',
        amount: 20,
      },
      {
        caller: 'stomach',
        fromPart: 'stomach',
        fromField: 'carbohydrateG',
        toPart: 'smallIntestine',
        toField: 'carbohydrateG',
        amount: 30,
      },
    ],
  });

  assert.ok(Math.abs(next.smallIntestine.waterVolumeMl - (100 - expectedWaterMl + 20)) < 1e-9);
  assert.ok(Math.abs(next.smallIntestine.absorbedWaterMl - expectedWaterMl) < 1e-12);
  assert.ok(Math.abs(next.bodyFluid.waterVolumeMl - (30000 + expectedWaterMl)) < 1e-9);
  assert.ok(Math.abs(next.smallIntestine.carbohydrateG - (60 - expectedCarbohydrateG + 30)) < 1e-9);
  assert.ok(Math.abs(next.smallIntestine.absorbedCarbohydrateG - expectedCarbohydrateG) < 1e-12);
  assert.ok(Math.abs(next.glucose.glucoseMassG - (12.69 + expectedCarbohydrateG)) < 1e-9);
});

test('an old state without carbohydrate fields absorbs zero carbohydrate', () => {
  const { written } = round({ waterVolumeMl: 100 });
  assert.equal(written.carbohydrateG, 0);
  assert.equal(written.absorbedCarbohydrateG, 0);
});

test('water delivered by the stomach in the same round is added after absorption', () => {
  const registry = createFieldRegistry([
    {
      id: 'stomach',
      initialState: { waterVolumeMl: 0, carbohydrateG: 0 },
      fields: {
        waterVolumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['smallIntestine.waterVolumeMl'] },
        carbohydrateG: { unit: 'g', mode: 'absolute', transferOut: ['smallIntestine.carbohydrateG'] },
      },
    },
    { id, initialState, fields },
    {
      id: 'bodyFluid',
      initialState: { waterVolumeMl: 0 },
      fields: { waterVolumeMl: { unit: 'mL', mode: 'absolute', transferIn: ['smallIntestine.waterVolumeMl'] } },
    },
    {
      id: 'glucose',
      initialState: { glucoseMassG: 12.69 },
      fields: {
        glucoseMassG: { unit: 'g', mode: 'absolute', transferIn: ['smallIntestine.carbohydrateG'] },
      },
    },
  ]);

  const start = { ...initialState, waterVolumeMl: 100 };
  const { written, transfers } = round(start);
  const expected = absorbedFrom(100);
  assert.deepEqual(transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl'), [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: expected,
  }]);
  assertOnlyZeroSmallIntestineCarbohydrateTransfers(transfers);
  const next = applyOperations({
    registry,
    snapshotParts: {
      stomach: { waterVolumeMl: 20 },
      smallIntestine: start,
      bodyFluid: { waterVolumeMl: 30000 },
      glucose: { glucoseMassG: 12.69 },
    },
    writes: { smallIntestine: written, stomach: { waterVolumeMl: 20 } },
    transfers: [
      ...transfers,
      { caller: 'stomach', fromPart: 'stomach', fromField: 'waterVolumeMl', toPart: 'smallIntestine', toField: 'waterVolumeMl', amount: 20 },
    ],
  });

  assert.ok(Math.abs(next.smallIntestine.waterVolumeMl - (100 - expected + 20)) < 1e-9);
  assert.ok(Math.abs(next.smallIntestine.absorbedWaterMl - expected) < 1e-12);
  assert.ok(Math.abs(next.bodyFluid.waterVolumeMl - (30000 + expected)) < 1e-9);
  assert.equal(next.smallIntestine.carbohydrateG, 0);
  assert.equal(next.smallIntestine.absorbedCarbohydrateG, 0);
  assert.equal(next.glucose.glucoseMassG, 12.69);
});

test('the existing pool plus cumulative absorption is conserved over 200 rounds', () => {
  let state = { ...initialState, waterVolumeMl: 200 };
  let absorbed = 0;
  for (let i = 0; i < 200; i++) {
    const { written } = round(state);
    absorbed += written.absorbedWaterMl;
    state = {
      waterVolumeMl: written.waterVolumeMl - written.absorbedWaterMl,
      absorbedWaterMl: written.absorbedWaterMl,
    };
  }
  assert.ok(Math.abs(state.waterVolumeMl + absorbed - 200) < 1e-6);
});

test('the carbohydrate pool plus cumulative absorption is conserved over 200 rounds', () => {
  let state = { ...initialState, carbohydrateG: 60 };
  let absorbed = 0;
  for (let i = 0; i < 200; i++) {
    const { written } = round(state);
    absorbed += written.absorbedCarbohydrateG;
    state = {
      ...written,
      carbohydrateG: written.carbohydrateG - written.absorbedCarbohydrateG,
    };
  }
  assert.ok(Math.abs(state.carbohydrateG + absorbed - 60) < 1e-6);
});
