import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/kidney/urine-production.ts';

function runHeartbeat({ adh, dt = 60 }) {
  const transfers = [];
  let written;
  heartbeat({
    read: (partId) => (partId === 'hypothalamusAdh' ? adh : undefined),
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => transfers.push(args),
  });
  return { written, transfers };
}

test('kidney exports the request-only module contract', () => {
  assert.equal(id, 'kidney');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    urineProductionRequestMl: { unit: 'mL', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { urineProductionRequestMl: 0 });
});

test('ADH 0.5, 1 and 2 produce 1.5, 1 and 0.25 mL requests over 60 s', () => {
  const cases = [
    [0.5, 1.5],
    [1, 1],
    [2, 0.25],
  ];
  for (const [relativeConcentration, expected] of cases) {
    const { written } = runHeartbeat({ adh: { relativeConcentration } });
    assert.deepEqual(written, { urineProductionRequestMl: expected });
  }
});

test('scales the request with io.dt instead of a hard-coded 60 s round', () => {
  const { written } = runHeartbeat({ adh: { relativeConcentration: 2 }, dt: 30 });
  assert.equal(written.urineProductionRequestMl, 0.125);
});

test('a missing or non-finite ADH signal falls back to the baseline request', () => {
  for (const adh of [undefined, {}, { relativeConcentration: Number.NaN }]) {
    const { written } = runHeartbeat({ adh });
    assert.equal(written.urineProductionRequestMl, 1);
  }
});

test('a negative ADH reading clamps to zero before the gain', () => {
  const { written } = runHeartbeat({ adh: { relativeConcentration: -1 } });
  assert.equal(written.urineProductionRequestMl, 2);
});

test('the high-ADH rate clamps at minRelativeRate and never goes negative', () => {
  const { written } = runHeartbeat({ adh: { relativeConcentration: 10 } });
  assert.equal(written.urineProductionRequestMl, 0.25);
});

test('the kidney writes only its own request and never transfers water', () => {
  const { written, transfers } = runHeartbeat({ adh: { relativeConcentration: 1 } });
  assert.deepEqual(Object.keys(written), ['urineProductionRequestMl']);
  assert.deepEqual(transfers, []);
});

async function variantContract(modulePath) {
  const module = await import(modulePath);
  assert.equal(module.id, 'kidney');
  assert.deepEqual(module.actionTypes, []);
  assert.deepEqual(module.fields, {
    urineProductionRequestMl: { unit: 'mL', mode: 'absolute' },
  });
  assert.deepEqual(module.initialState, { urineProductionRequestMl: 0 });
  return module;
}

function runVariant(heartbeat, { adh, dt = 60, reads = true } = {}) {
  const transfers = [];
  let written;
  heartbeat({
    read: (partId) => {
      if (!reads) throw new Error(`unexpected read: ${partId}`);
      return partId === 'hypothalamusAdh' ? adh : undefined;
    },
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => transfers.push(args),
  });
  return { written, transfers };
}

test('central DI kidney keeps the kidney contract and widens only the low-ADH range', async () => {
  const central = await variantContract('../organs/human-organs/kidney/urine-production-di-central.ts');

  assert.equal(runVariant(central.heartbeat, { adh: { relativeConcentration: 0 } }).written.urineProductionRequestMl, 4);
  assert.equal(runVariant(central.heartbeat, { adh: { relativeConcentration: 1 } }).written.urineProductionRequestMl, 1);
  assert.equal(runVariant(central.heartbeat, { adh: { relativeConcentration: 3 } }).written.urineProductionRequestMl, 0.25);
  assert.equal(runVariant(central.heartbeat, { adh: { relativeConcentration: 10 } }).written.urineProductionRequestMl, 0.25);
  assert.equal(runVariant(central.heartbeat, { adh: { relativeConcentration: 0 }, dt: 30 }).written.urineProductionRequestMl, 2);
  assert.equal(runVariant(central.heartbeat, { adh: undefined }).written.urineProductionRequestMl, 1);
  assert.equal(runVariant(central.heartbeat, { adh: { relativeConcentration: -1 } }).written.urineProductionRequestMl, 4);

  const { written, transfers } = runVariant(central.heartbeat, { adh: { relativeConcentration: 0 } });
  assert.deepEqual(Object.keys(written), ['urineProductionRequestMl']);
  assert.deepEqual(transfers, []);
});

test('nephrogenic DI kidney keeps the kidney contract and ignores ADH entirely', async () => {
  const nephrogenic = await variantContract('../organs/human-organs/kidney/urine-production-di-nephrogenic.ts');

  for (const adh of [undefined, {}, { relativeConcentration: 0 }, { relativeConcentration: 1 }, { relativeConcentration: 10 }]) {
    const { written, transfers } = runVariant(nephrogenic.heartbeat, { adh, reads: false });
    assert.deepEqual(written, { urineProductionRequestMl: 4 });
    assert.deepEqual(transfers, []);
  }
  assert.equal(runVariant(nephrogenic.heartbeat, { adh: undefined, dt: 30, reads: false }).written.urineProductionRequestMl, 2);
  assert.ok(4 * 1440 > 3000, 'four mL/min is a DI-like daily output above 3 L/day');
});
