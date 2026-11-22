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
const absorbedFrom = (waterMl, dt = 60) => waterMl * (1 - 2 ** (-(dt / 60) / halfTimeMin));

test('small intestine declares the stomach -> body fluid water pair', () => {
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
  });
});

test('the absorption parameter is a design time scale, not a reported half-time', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url),
    'utf8',
  ));
  const [parameter] = data.parameters;
  assert.equal(parameter.id, 'smallIntestine.absorption.halfTimeMin');
  assert.equal(parameter.unit, 'min');
  assert.equal(parameter.value, 20);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, 'SRC-PERONNET-2012');
  assert.deepEqual(parameter.range, [1, 120]);
});

test('one 60 s round absorbs from the round-start pool and writes it before transferring', () => {
  const { written, transfers } = round({ ...initialState, waterVolumeMl: 100 });
  const expected = absorbedFrom(100);
  assert.equal(written.waterVolumeMl, 100);
  assert.ok(Math.abs(written.absorbedWaterMl - expected) < 1e-12);
  assert.deepEqual(transfers, [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: expected,
  }]);
});

test('water delivered by the stomach in the same round is added after absorption', () => {
  const registry = createFieldRegistry([
    {
      id: 'stomach',
      initialState: { waterVolumeMl: 0 },
      fields: { waterVolumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['smallIntestine.waterVolumeMl'] } },
    },
    { id, initialState, fields },
    {
      id: 'bodyFluid',
      initialState: { waterVolumeMl: 0 },
      fields: { waterVolumeMl: { unit: 'mL', mode: 'absolute', transferIn: ['smallIntestine.waterVolumeMl'] } },
    },
  ]);

  const start = { ...initialState, waterVolumeMl: 100 };
  const { written, transfers } = round(start);
  const expected = absorbedFrom(100);
  const next = applyOperations({
    registry,
    snapshotParts: {
      stomach: { waterVolumeMl: 20 },
      smallIntestine: start,
      bodyFluid: { waterVolumeMl: 30000 },
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
