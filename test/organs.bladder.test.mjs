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

function assertVoidParts(next, { voluntaryMl, involuntaryMl }) {
  assert.equal(next.voluntaryVoidedMl, voluntaryMl);
  assert.equal(next.involuntaryVoidedMl, involuntaryMl);
  assert.equal(next.voidedMl, voluntaryMl + involuntaryMl);
}

test('bladder declares the body fluid transfer pair, storage and voiding fields', () => {
  assert.equal(id, 'bladder');
  assert.deepEqual(actionTypes, ['urinate']);
  assert.deepEqual(initialState, {
    volumeMl: 0,
    voidedMl: 0,
    voluntaryVoidedMl: 0,
    involuntaryVoidedMl: 0,
  });
  assert.deepEqual(fields, {
    volumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
    voidedMl: { unit: 'mL', mode: 'absolute' },
    voluntaryVoidedMl: { unit: 'mL', mode: 'absolute' },
    involuntaryVoidedMl: { unit: 'mL', mode: 'absolute' },
  });
});

test('the post-void residual parameter is a design zero, not a measured normal', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/bladder/storage.parameters.json', import.meta.url),
    'utf8',
  ));
  assert.equal(data.owner, 'bladder');
  const parameter = data.parameters.find(({ id: parameterId }) => (
    parameterId === 'bladder.voiding.postVoidResidualMl'
  ));
  assert.ok(parameter, 'postVoidResidualMl parameter is declared');
  assert.equal(parameter.unit, 'mL');
  assert.equal(parameter.value, 0);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
  assert.deepEqual(parameter.range, [0, 200]);
});

test('the involuntary threshold is a design 600 mL trigger, not a clinical capacity', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/bladder/storage.parameters.json', import.meta.url),
    'utf8',
  ));
  const parameter = data.parameters.find(({ id: parameterId }) => (
    parameterId === 'bladder.voiding.involuntaryThresholdMl'
  ));
  assert.ok(parameter, 'involuntaryThresholdMl parameter is declared');
  assert.equal(parameter.unit, 'mL');
  assert.equal(parameter.value, 600);
  assert.equal(parameter.status, 'design');
  assert.equal(parameter.source, null);
});

test('one urinate voids the round-start volume and writes it before transferring', () => {
  const start = { ...initialState, volumeMl: 250 };
  const { written, transfers } = round(start, [urinate('action-a')]);
  assert.deepEqual(transfers, []);
  assert.equal(written.volumeMl, 0);
  assertVoidParts(written, { voluntaryMl: 250, involuntaryMl: 0 });

  const next = settle(start, { actions: [urinate('action-a')] });
  assert.equal(next.volumeMl, 0);
  assertVoidParts(next, { voluntaryMl: 250, involuntaryMl: 0 });
});

test('urine arriving in the same round stays in the bladder after voiding', () => {
  const start = { ...initialState, volumeMl: 250 };
  const next = settle(start, { actions: [urinate('action-a')], inflowMl: 40 });
  assert.equal(next.volumeMl, 40);
  assertVoidParts(next, { voluntaryMl: 250, involuntaryMl: 0 });
});

test('a round without urinate records no voiding and keeps the stored volume', () => {
  const start = { ...initialState, volumeMl: 180 };
  const next = settle(start);
  assert.equal(next.volumeMl, 180);
  assertVoidParts(next, { voluntaryMl: 0, involuntaryMl: 0 });
});

test('two different urinate actions in one round void only once', () => {
  const start = { ...initialState, volumeMl: 250 };
  const { written } = round(start, [urinate('action-a'), urinate('action-b')]);
  assertVoidParts(written, { voluntaryMl: 250, involuntaryMl: 0 });
  assert.equal(written.volumeMl, 0);

  const next = settle(start, { actions: [urinate('action-a'), urinate('action-b')] });
  assert.equal(next.volumeMl, 0);
  assertVoidParts(next, { voluntaryMl: 250, involuntaryMl: 0 });
});

test('urinating an empty bladder voids nothing', () => {
  const next = settle({ ...initialState }, { actions: [urinate('action-a')] });
  assert.equal(next.volumeMl, 0);
  assertVoidParts(next, { voluntaryMl: 0, involuntaryMl: 0 });
});

test('only urinate triggers voluntary voiding; other actions leave the bladder alone', () => {
  const start = { ...initialState, volumeMl: 250 };
  const next = settle(start, { actions: [{ id: 'action-a', type: 'drink', volumeMl: 240 }] });
  assert.equal(next.volumeMl, 250);
  assertVoidParts(next, { voluntaryMl: 0, involuntaryMl: 0 });
});

test('a volume above 600 mL voids involuntarily without any action', () => {
  const start = { ...initialState, volumeMl: 650 };
  const { written, transfers } = round(start);
  assert.deepEqual(transfers, []);
  assert.equal(written.volumeMl, 0);
  assertVoidParts(written, { voluntaryMl: 0, involuntaryMl: 650 });

  const next = settle(start);
  assert.equal(next.volumeMl, 0);
  assertVoidParts(next, { voluntaryMl: 0, involuntaryMl: 650 });
});

test('exactly 600 mL does not trigger involuntary voiding', () => {
  const start = { ...initialState, volumeMl: 600 };
  const next = settle(start);
  assert.equal(next.volumeMl, 600);
  assertVoidParts(next, { voluntaryMl: 0, involuntaryMl: 0 });
});

test('urine arriving in the same round stays after involuntary voiding', () => {
  const start = { ...initialState, volumeMl: 650 };
  const next = settle(start, { inflowMl: 40 });
  assert.equal(next.volumeMl, 40);
  assertVoidParts(next, { voluntaryMl: 0, involuntaryMl: 650 });
});

test('a urinate action takes priority over involuntary voiding above the threshold', () => {
  const start = { ...initialState, volumeMl: 650 };
  const next = settle(start, { actions: [urinate('action-a'), urinate('action-b')] });
  assert.equal(next.volumeMl, 0);
  assertVoidParts(next, { voluntaryMl: 650, involuntaryMl: 0 });
});

test('an old bladder state without the subtotal fields gains design zeros', () => {
  const { written } = round({ volumeMl: 120, voidedMl: 0 });
  assert.deepEqual(written, {
    volumeMl: 120,
    voidedMl: 0,
    voluntaryVoidedMl: 0,
    involuntaryVoidedMl: 0,
  });
});
