import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  id,
  actionTypes,
  fields,
  initialState,
  heartbeat,
} from '../organs/human-organs/bladder/storage.ts';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';

const registry = createFieldRegistry([
  {
    id: 'bodyFluid',
    initialState: { waterVolumeMl: 0 },
    fields: { waterVolumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['bladder.volumeMl'] } },
  },
  { id, initialState, fields },
]);

function round(state, actions = []) {
  let written;
  const transfers = [];
  heartbeat({
    read: () => state,
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written, transfers };
}

function settle(state, { actions = [], inflowMl = 0 } = {}) {
  const { written, transfers } = round(state, actions);
  assert.deepEqual(transfers, []);
  return applyOperations({
    registry,
    snapshotParts: { bladder: state, bodyFluid: { waterVolumeMl: inflowMl } },
    writes: { bladder: written },
    transfers: inflowMl > 0
      ? [{
        caller: 'bodyFluid',
        fromPart: 'bodyFluid',
        fromField: 'waterVolumeMl',
        toPart: 'bladder',
        toField: 'volumeMl',
        amount: inflowMl,
      }]
      : [],
  }).bladder;
}

const urinate = (actionId) => ({ id: actionId, type: 'urinate' });

test('bladder declares the body fluid transfer pair, storage and voiding fields', () => {
  assert.equal(id, 'bladder');
  assert.deepEqual(actionTypes, ['urinate']);
  assert.deepEqual(initialState, { volumeMl: 0, voidedMl: 0 });
  assert.deepEqual(fields, {
    volumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
    voidedMl: { unit: 'mL', mode: 'absolute' },
  });
});

test('the post-void residual parameter is a design zero, not a measured normal', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/bladder/storage.parameters.json', import.meta.url),
    'utf8',
  ));
  assert.equal(data.owner, 'bladder');
  const [parameter] = data.parameters;
  assert.equal(parameter.id, 'bladder.voiding.postVoidResidualMl');
  assert.equal(parameter.unit, 'mL');
  assert.equal(parameter.value, 0);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
  assert.deepEqual(parameter.range, [0, 200]);
});

test('one urinate voids the round-start volume and writes it before transferring', () => {
  const start = { ...initialState, volumeMl: 250 };
  const { written } = round(start, [urinate('action-a')]);
  assert.equal(written.volumeMl, 0);
  assert.equal(written.voidedMl, 250);

  const next = settle(start, { actions: [urinate('action-a')] });
  assert.equal(next.volumeMl, 0);
  assert.equal(next.voidedMl, 250);
});

test('urine arriving in the same round stays in the bladder after voiding', () => {
  const start = { ...initialState, volumeMl: 250 };
  const next = settle(start, { actions: [urinate('action-a')], inflowMl: 40 });
  assert.equal(next.volumeMl, 40);
  assert.equal(next.voidedMl, 250);
});

test('a round without urinate records no voiding and keeps the stored volume', () => {
  const start = { ...initialState, volumeMl: 180 };
  const next = settle(start);
  assert.equal(next.volumeMl, 180);
  assert.equal(next.voidedMl, 0);
});

test('two different urinate actions in one round void only once', () => {
  const start = { ...initialState, volumeMl: 250 };
  const { written } = round(start, [urinate('action-a'), urinate('action-b')]);
  assert.equal(written.voidedMl, 250);
  assert.equal(written.volumeMl, 0);

  const next = settle(start, { actions: [urinate('action-a'), urinate('action-b')] });
  assert.equal(next.volumeMl, 0);
  assert.equal(next.voidedMl, 250);
});

test('urinating an empty bladder voids nothing', () => {
  const next = settle({ ...initialState }, { actions: [urinate('action-a')] });
  assert.equal(next.volumeMl, 0);
  assert.equal(next.voidedMl, 0);
});

test('only urinate triggers voiding; other actions leave the bladder alone', () => {
  const start = { ...initialState, volumeMl: 250 };
  const next = settle(start, { actions: [{ id: 'action-a', type: 'drink', volumeMl: 240 }] });
  assert.equal(next.volumeMl, 250);
  assert.equal(next.voidedMl, 0);
});
