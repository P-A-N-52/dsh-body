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
