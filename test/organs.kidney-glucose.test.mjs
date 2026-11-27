import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/kidney/glucose-excretion.ts';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { checkpoint, launch } from '../test-support/harness.mjs';

const thresholdConcentrationMgDl = 339 / 1.88;
const request60sAt360MgDl = 0.0126675;
const previousState = { excretionRequestG: 9, excretedGlucoseG: 5 };

function round({ glucose, state = initialState, dt = 60, simulatedSeconds = 60 } = {}) {
  let written;
  const transfers = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'glucose') return glucose;
      if (partId === 'kidneyGlucose') return state;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds,
    write: (next) => { written = next; },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written, transfers };
}

test('kidneyGlucose exports the two-field request and actual-flux contract', () => {
  assert.equal(id, 'kidneyGlucose');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    excretionRequestG: { unit: 'g', mode: 'absolute' },
    excretedGlucoseG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
  });
  assert.deepEqual(initialState, {
    excretionRequestG: 0,
    excretedGlucoseG: 0,
  });
});

test('the request is exactly zero at the concentration matching 339 mg/kg', () => {
  const { written, transfers } = round({
    glucose: { concentrationMgDl: thresholdConcentrationMgDl },
    state: previousState,
  });
  assert.equal(written.excretionRequestG, 0);
  assert.equal(written.excretedGlucoseG, 0);
  assert.deepEqual(transfers, []);
});

test('one millionth of a mg/dL below the threshold is zero and above is positive', () => {
  const below = round({
    glucose: { concentrationMgDl: thresholdConcentrationMgDl - 1e-6 },
    state: previousState,
  });
  assert.equal(below.written.excretionRequestG, 0);
  assert.equal(below.written.excretedGlucoseG, 0);
  assert.deepEqual(below.transfers, []);

  const above = round({
    glucose: { concentrationMgDl: thresholdConcentrationMgDl + 1e-6 },
    state: previousState,
  });
  assert.ok(above.written.excretionRequestG > 0);
  assert.equal(above.written.excretedGlucoseG, 0);
  assert.deepEqual(above.transfers, []);
});

test('concentrations below the threshold request no glucose', () => {
  for (const concentrationMgDl of [0, 90, 180]) {
    const { written, transfers } = round({
      glucose: { concentrationMgDl },
      state: previousState,
    });
    assert.equal(written.excretionRequestG, 0, `request at C=${concentrationMgDl}`);
    assert.equal(written.excretedGlucoseG, 0, `actual at C=${concentrationMgDl}`);
    assert.deepEqual(transfers, []);
  }
});

test('a concentration just above the threshold requests a positive mass', () => {
  const { written, transfers } = round({
    glucose: { concentrationMgDl: 180.4 },
    state: previousState,
  });
  assert.ok(Math.abs(written.excretionRequestG - 5.7e-6) < 1e-12);
  assert.equal(written.excretedGlucoseG, 0);
  assert.deepEqual(transfers, []);
});

test('C=360 mg/dL converts 676.8 mg/kg over 75 kg to 0.0126675 g per 60 s', () => {
  const { written } = round({ glucose: { concentrationMgDl: 360 } });
  assert.ok(Math.abs(written.excretionRequestG - request60sAt360MgDl) < 1e-12);
  assert.equal(written.excretedGlucoseG, 0);
});

test('a concentration-only glucose producer keeps the custom legacy kidney conversion', async (t) => {
  const kidneyScript = new URL('../organs/human-organs/kidney/glucose-excretion.ts', import.meta.url);
  const { gateway } = await launch(t, {
    modules: {
      'glucose.js': `
        export const id = 'glucose';
        export const initialState = { glucoseMassG: 24, concentrationMgDl: 180 };
        export const fields = {
          glucoseMassG: { unit: 'g', mode: 'absolute', transferOut: ['kidneyGlucose.excretedGlucoseG'] },
          concentrationMgDl: { unit: 'mg/dL', mode: 'absolute' },
        };
        export function heartbeat() {}
      `,
      'kidney-glucose.js': `export * from ${JSON.stringify(kidneyScript.href)};`,
    },
    seed: {
      ...checkpoint({ wallTimeMs: 0, profile: { weightKg: 55 } }),
      parameters: {
        'kidneyGlucose.distributionVolumeDlPerKg': 2.1,
        'kidneyGlucose.referenceBodyMassKg': 65,
      },
    },
    gatewayOptions: { now: () => 0 },
  });
  await gateway.tick();
  const kidney = gateway.getState().parts.kidneyGlucose;
  assert.ok(Math.abs(kidney.excretionRequestG - 0.0012675) < 1e-12);
  assert.equal(kidney.excretedGlucoseG, 0);
});

test('the request uses io.dt rather than io.simulatedSeconds', () => {
  const cases = [
    { dt: 60, simulatedSeconds: 120, expectedG: request60sAt360MgDl },
    { dt: 120, simulatedSeconds: 60, expectedG: 0.025335 },
  ];
  for (const { dt, simulatedSeconds, expectedG } of cases) {
    const { written, transfers } = round({
      glucose: { concentrationMgDl: 360 },
      state: previousState,
      dt,
      simulatedSeconds,
    });
    assert.ok(
      Math.abs(written.excretionRequestG - expectedG) < 1e-12,
      `request for dt=${dt}, simulatedSeconds=${simulatedSeconds}`,
    );
    assert.equal(written.excretedGlucoseG, 0, `actual for dt=${dt}`);
    assert.deepEqual(transfers, []);
  }
});

test('a missing upstream glucose part requests zero', () => {
  const { written, transfers } = round({ glucose: undefined, state: previousState });
  assert.deepEqual(written, {
    excretionRequestG: 0,
    excretedGlucoseG: 0,
  });
  assert.deepEqual(transfers, []);
});

test('a loaded glucose part without concentrationMgDl fails instead of requesting zero', () => {
  assert.throws(() => round({ glucose: {} }));
});

test('non-finite or negative concentrations fail the round', () => {
  for (const concentrationMgDl of [Number.NaN, Infinity, -Infinity, -1]) {
    assert.throws(
      () => round({ glucose: { concentrationMgDl } }),
      `C=${concentrationMgDl} must fail`,
    );
  }
});

test('a present glucose conversion basis must be a complete pair of positive finite numbers', () => {
  for (const concentrationBasis of [null, [2], [2, 75, 1], [0, 75], [NaN, 75], [2, -1], [2, Infinity], [2, '75']]) {
    assert.throws(
      () => round({ glucose: { concentrationMgDl: 180, concentrationBasis } }),
      /glucose\.concentrationBasis/,
    );
  }
});

test('each round zeroes excretedGlucoseG and only a transfer adds mass', () => {
  const start = previousState;
  const { written, transfers } = round({
    glucose: { concentrationMgDl: 360 },
    state: start,
  });
  assert.deepEqual(transfers, []);
  assert.deepEqual(Object.keys(written).sort(), ['excretedGlucoseG', 'excretionRequestG']);
  assert.equal(written.excretedGlucoseG, 0);
  assert.ok(Math.abs(written.excretionRequestG - request60sAt360MgDl) < 1e-12);

  const registry = createFieldRegistry([
    {
      id: 'glucose',
      initialState: { glucoseMassG: 100 },
      fields: {
        glucoseMassG: {
          unit: 'g',
          mode: 'absolute',
          transferOut: ['kidneyGlucose.excretedGlucoseG'],
        },
      },
    },
    { id, initialState, fields },
  ]);

  const withoutTransfer = applyOperations({
    registry,
    snapshotParts: { glucose: { glucoseMassG: 100 }, kidneyGlucose: start },
    writes: { kidneyGlucose: written },
  });
  assert.equal(withoutTransfer.kidneyGlucose.excretedGlucoseG, 0);

  const amountG = request60sAt360MgDl;
  const afterTransfer = applyOperations({
    registry,
    snapshotParts: { glucose: { glucoseMassG: 100 }, kidneyGlucose: start },
    writes: { kidneyGlucose: written },
    transfers: [{
      caller: 'glucose',
      fromPart: 'glucose',
      fromField: 'glucoseMassG',
      toPart: 'kidneyGlucose',
      toField: 'excretedGlucoseG',
      amount: amountG,
    }],
  });
  assert.ok(Math.abs(afterTransfer.kidneyGlucose.excretedGlucoseG - amountG) < 1e-12);
  assert.equal(afterTransfer.kidneyGlucose.excretionRequestG, written.excretionRequestG);
  assert.ok(Math.abs(afterTransfer.glucose.glucoseMassG - (100 - amountG)) < 1e-12);
});
