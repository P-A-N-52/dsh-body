import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-compartments/glucose/glucose.ts';
import * as bladder from '../organs/human-organs/bladder/storage.ts';
import * as bodyFluid from '../organs/human-compartments/body-water/water.ts';
import * as skin from '../organs/human-organs/skin/sweat.ts';
import * as smallIntestine from '../organs/human-organs/small-intestine/water-absorption.ts';
import * as stomachHydration from '../organs/human-organs/stomach/hydration.ts';

const baselineMassG = 12.69;
const distributionVolumeDl = 141;
const disposalHalfTimeMin = 60;

const kidneyGlucoseStub = {
  id: 'kidneyGlucose',
  initialState: { excretionRequestG: 0, excretedGlucoseG: 0 },
  fields: {
    excretionRequestG: { unit: 'g', mode: 'absolute' },
    excretedGlucoseG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
  },
};

function snapshotFor(state, { insulin, request, withPancreas = true, withKidney = true } = {}) {
  const parts = { glucose: state };
  if (withPancreas) {
    parts.pancreasEndocrine = { insulinRelative: insulin ?? 1 };
  }
  if (withKidney) {
    parts.kidneyGlucose = { excretionRequestG: request ?? 0, excretedGlucoseG: 0 };
  }
  return parts;
}

function round(state, { dt = 60, insulin, request, withPancreas = true, withKidney = true } = {}) {
  const parts = snapshotFor(state, { insulin, request, withPancreas, withKidney });
  const transfers = [];
  let written;
  heartbeat({
    read: (partId) => parts[partId],
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written, transfers };
}

function renalTransferG(transfers) {
  return transfers
    .filter(([fromPart, fromField, toPart, toField]) => fromPart === 'glucose'
      && fromField === 'glucoseMassG'
      && toPart === 'kidneyGlucose'
      && toField === 'excretedGlucoseG')
    .reduce((sum, [, , , , amount]) => sum + amount, 0);
}

function registry() {
  return createFieldRegistry([
    {
      id: 'smallIntestine',
      initialState: { carbohydrateG: 0 },
      fields: {
        carbohydrateG: {
          unit: 'g',
          mode: 'absolute',
          transferOut: ['glucose.glucoseMassG'],
        },
      },
    },
    kidneyGlucoseStub,
    { id, initialState, fields },
  ]);
}

function applyRound({ state, insulin = 1, request = 0, kidneyRequestAfter = 0, inflowG = 0 }) {
  const { written, transfers } = round(state, { insulin, request });
  const writtenBeforeTransfer = structuredClone(written);
  const next = applyOperations({
    registry: registry(),
    snapshotParts: {
      glucose: state,
      kidneyGlucose: { excretionRequestG: request, excretedGlucoseG: 0 },
      smallIntestine: { carbohydrateG: inflowG },
    },
    writes: {
      glucose: written,
      kidneyGlucose: { excretionRequestG: kidneyRequestAfter, excretedGlucoseG: 0 },
      smallIntestine: { carbohydrateG: inflowG },
    },
    transfers: [
      ...transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
        caller: id,
        fromPart,
        fromField,
        toPart,
        toField,
        amount,
      })),
      ...(inflowG > 0
        ? [{
          caller: 'smallIntestine',
          fromPart: 'smallIntestine',
          fromField: 'carbohydrateG',
          toPart: 'glucose',
          toField: 'glucoseMassG',
          amount: inflowG,
        }]
        : []),
    ],
  });
  return { written: writtenBeforeTransfer, transfers, next };
}

test('glucose exports the compartment contract and starts at the 90 mg/dL baseline', () => {
  assert.equal(id, 'glucose');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    glucoseMassG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['smallIntestine.carbohydrateG'],
      transferOut: ['kidneyGlucose.excretedGlucoseG'],
    },
    concentrationMgDl: { unit: 'mg/dL', mode: 'absolute' },
    disposedGlucoseG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(
    Object.keys(initialState).sort(),
    ['concentrationMgDl', 'disposedGlucoseG', 'glucoseMassG'],
  );
  assert.ok(Math.abs(initialState.glucoseMassG - baselineMassG) < 1e-9);
  assert.ok(Math.abs(initialState.concentrationMgDl - 90) < 1e-9);
  assert.ok(
    Math.abs(initialState.glucoseMassG * 1000 / initialState.concentrationMgDl - distributionVolumeDl) < 1e-9,
  );
  assert.equal(initialState.disposedGlucoseG, 0);
});

test('a hydrated body without kidney glucose fails on the glucose transfer target', () => {
  const modules = [
    { id: stomachHydration.id, initialState: stomachHydration.initialState, fields: stomachHydration.fields },
    { id: smallIntestine.id, initialState: smallIntestine.initialState, fields: smallIntestine.fields },
    { id: bodyFluid.id, initialState: bodyFluid.initialState, fields: bodyFluid.fields },
    { id: skin.id, initialState: skin.initialState, fields: skin.fields },
    { id, initialState, fields },
    { id: bladder.id, initialState: bladder.initialState, fields: bladder.fields },
  ];
  assert.throws(
    () => createFieldRegistry(modules),
    (error) => {
      assert.match(error.message, /kidneyGlucose/, 'the error must name the missing target part');
      assert.match(error.message, /excretedGlucoseG/, 'the error must name the missing target field');
      assert.match(error.message, /glucose/, 'the error must name the source part');
      assert.match(error.message, /glucoseMassG/, 'the error must name the source field');
      assert.equal(
        error.message.includes('smallIntestine'),
        false,
        'the complete small intestine pair must not be reported as missing',
      );
      return true;
    },
  );
});

test('I=1 exactly reproduces the original 60 minute apparent disposal', () => {
  const cases = [
    { massG: baselineMassG, dt: 60, excessG: 0 },
    { massG: 42.69, dt: 60, excessG: 30 },
    { massG: 42.69, dt: 120, excessG: 30 },
    { massG: 6, dt: 60, excessG: 0 },
  ];
  for (const { massG, dt, excessG } of cases) {
    const label = `${massG} g over ${dt} s`;
    const { written } = round(
      { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
      { dt, insulin: 1 },
    );
    const expectedDisposedG = excessG * (1 - 2 ** (-(dt / 60) / disposalHalfTimeMin));
    assert.equal(
      written.concentrationMgDl,
      massG * 1000 / distributionVolumeDl,
      `concentration at ${label}`,
    );
    assert.equal(written.disposedGlucoseG, expectedDisposedG, `disposed at ${label}`);
    assert.equal(written.glucoseMassG, massG - expectedDisposedG, `mass at ${label}`);
  }
});

test('insulin relative signal scales disposal without touching baseline or low mass', () => {
  const massG = baselineMassG + 30;
  const state = { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const disposedAt = (insulin) => round(state, { dt: 60, insulin }).written.disposedGlucoseG;

  const d0 = disposedAt(0);
  const d05 = disposedAt(0.5);
  const d1 = disposedAt(1);
  const d2 = disposedAt(2);

  assert.ok(Math.abs(d2 - 30 * (1 - 2 ** (-2 / disposalHalfTimeMin))) < 1e-12);
  assert.ok(Math.abs(d1 - 30 * (1 - 2 ** (-1 / disposalHalfTimeMin))) < 1e-12);
  assert.ok(Math.abs(d05 - 30 * (1 - 2 ** (-0.5 / disposalHalfTimeMin))) < 1e-12);
  assert.equal(d0, 0);
  assert.ok(d2 > d1, `${d2} > ${d1}`);
  assert.ok(d1 > d05, `${d1} > ${d05}`);
  assert.ok(d05 > d0, `${d05} > ${d0}`);

  for (const [label, startMassG] of [['baseline', baselineMassG], ['low', 6]]) {
    const { written } = round(
      { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 },
      { dt: 60, insulin: 2 },
    );
    assert.equal(written.glucoseMassG, startMassG, `${label} mass`);
    assert.equal(written.disposedGlucoseG, 0, `${label} disposal`);
    assert.ok(
      Math.abs(written.concentrationMgDl - startMassG * 1000 / distributionVolumeDl) < 1e-9,
      `${label} concentration`,
    );
  }
});

test('missing pancreas falls back to I=1 while invalid signals fail the round', () => {
  const state = { glucoseMassG: 42.69, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const withPancreas = round(state, { insulin: 1 }).written;
  const withoutPancreas = round(state, { withPancreas: false }).written;
  assert.ok(
    Math.abs(withoutPancreas.glucoseMassG - withPancreas.glucoseMassG) < 1e-15,
    'missing pancreas must not change the baseline disposal',
  );
  assert.ok(
    Math.abs(withoutPancreas.disposedGlucoseG - withPancreas.disposedGlucoseG) < 1e-15,
  );

  for (const insulin of [Number.NaN, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '2']) {
    assert.throws(
      () => round(state, { insulin }),
      `insulin ${String(insulin)} must fail the round`,
    );
  }
});

test('missing kidney glucose means no transfer while invalid requests fail the round', () => {
  const state = { glucoseMassG: 42.69, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const { written, transfers } = round(state, { withKidney: false });
  assert.equal(renalTransferG(transfers), 0);
  assert.equal(written.disposedGlucoseG, 30 * (1 - 2 ** (-1 / disposalHalfTimeMin)));

  for (const request of [Number.NaN, -1, Number.POSITIVE_INFINITY, '1']) {
    assert.throws(
      () => round(state, { request }),
      `request ${String(request)} must fail the round`,
    );
  }
  assert.equal(renalTransferG(round(state, { request: 0 }).transfers), 0);
});

test('a round-start renal request is settled after non-renal disposal and clamped to the remaining mass', () => {
  const startMassG = baselineMassG + 30;
  const expectedDisposedG = 30 * (1 - 2 ** (-1 / disposalHalfTimeMin));
  const afterDisposalG = startMassG - expectedDisposedG;
  const state = { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 };

  const { written, transfers, next } = applyRound({ state, request: 100 });

  assert.ok(Math.abs(written.disposedGlucoseG - expectedDisposedG) < 1e-12);
  assert.ok(Math.abs(written.glucoseMassG - afterDisposalG) < 1e-12);
  assert.ok(Math.abs(renalTransferG(transfers) - afterDisposalG) < 1e-12);
  assert.ok(Math.abs(next.glucose.glucoseMassG) < 1e-12);
  assert.ok(Math.abs(next.glucose.disposedGlucoseG - expectedDisposedG) < 1e-12);
  assert.ok(Math.abs(next.kidneyGlucose.excretedGlucoseG - afterDisposalG) < 1e-12);
  assert.ok(
    Math.abs(
      next.glucose.glucoseMassG
        + next.kidneyGlucose.excretedGlucoseG
        + next.glucose.disposedGlucoseG
        - startMassG,
    ) < 1e-9,
  );
});

test('a same-round intestinal inflow cannot pay the round-start renal request', () => {
  const startMassG = baselineMassG + 1;
  const inflowG = 10;
  const expectedDisposedG = 1 * (1 - 2 ** (-1 / disposalHalfTimeMin));
  const afterDisposalG = startMassG - expectedDisposedG;
  const state = { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 };

  const { transfers, next } = applyRound({ state, request: 20, inflowG });

  assert.ok(Math.abs(renalTransferG(transfers) - afterDisposalG) < 1e-12);
  assert.ok(Math.abs(next.glucose.glucoseMassG - inflowG) < 1e-12);
  assert.ok(Math.abs(next.glucose.disposedGlucoseG - expectedDisposedG) < 1e-12);
  assert.ok(Math.abs(next.kidneyGlucose.excretedGlucoseG - afterDisposalG) < 1e-12);
  assert.ok(
    Math.abs(
      next.glucose.glucoseMassG
        + next.kidneyGlucose.excretedGlucoseG
        + next.glucose.disposedGlucoseG
        - (startMassG + inflowG),
    ) < 1e-9,
  );
});

test('a request written this round is not paid in the same round', () => {
  const startMassG = baselineMassG + 1;
  const state = { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const { written, transfers } = round(state, { request: 0 });
  assert.equal(renalTransferG(transfers), 0);

  const next = applyOperations({
    registry: registry(),
    snapshotParts: {
      glucose: state,
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    },
    writes: {
      glucose: written,
      kidneyGlucose: { excretionRequestG: 20, excretedGlucoseG: 0 },
    },
    transfers: [],
  });
  assert.equal(next.kidneyGlucose.excretionRequestG, 20);
  assert.equal(next.kidneyGlucose.excretedGlucoseG, 0);
  assert.ok(Math.abs(next.glucose.glucoseMassG - written.glucoseMassG) < 1e-12);
});

test('a negative stored mass is clamped to zero and disposes nothing', () => {
  const { written } = round({ glucoseMassG: -5, concentrationMgDl: 0, disposedGlucoseG: 0 });
  assert.equal(written.glucoseMassG, 0);
  assert.equal(written.concentrationMgDl, 0);
  assert.equal(written.disposedGlucoseG, 0);
});

test('same-round intestine inflow lands after write, so concentration rises only next round', () => {
  const smallIntestine = {
    id: 'smallIntestine',
    initialState: { carbohydrateG: 0 },
    fields: {
      carbohydrateG: { unit: 'g', mode: 'absolute', transferOut: ['glucose.glucoseMassG'] },
    },
  };
  const fieldRegistry = createFieldRegistry([
    smallIntestine,
    kidneyGlucoseStub,
    { id, initialState, fields },
  ]);

  const start = { ...initialState };
  const { written } = round(start);
  assert.ok(Math.abs(written.concentrationMgDl - 90) < 1e-9);

  const next = applyOperations({
    registry: fieldRegistry,
    snapshotParts: {
      smallIntestine: { carbohydrateG: 10 },
      glucose: start,
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    },
    writes: {
      glucose: written,
      smallIntestine: { carbohydrateG: 10 },
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    },
    transfers: [{
      caller: 'smallIntestine',
      fromPart: 'smallIntestine',
      fromField: 'carbohydrateG',
      toPart: 'glucose',
      toField: 'glucoseMassG',
      amount: 10,
    }],
  });

  assert.ok(Math.abs(next.glucose.glucoseMassG - (baselineMassG + 10)) < 1e-9);
  assert.ok(Math.abs(next.glucose.concentrationMgDl - 90) < 1e-9);

  const later = round(next.glucose);
  assert.ok(
    Math.abs(later.written.concentrationMgDl - ((baselineMassG + 10) * 1000 / distributionVolumeDl)) < 1e-9,
  );
  const expectedDisposedG = 10 * (1 - 2 ** (-1 / disposalHalfTimeMin));
  assert.ok(Math.abs(later.written.disposedGlucoseG - expectedDisposedG) < 1e-12);
  assert.ok(Math.abs(later.written.glucoseMassG - (baselineMassG + 10 - expectedDisposedG)) < 1e-12);
});

test('disposed mass plus remaining above-baseline mass conserves the initial excess', () => {
  let state = { glucoseMassG: baselineMassG + 30, concentrationMgDl: 90, disposedGlucoseG: 0 };
  let disposedG = 0;
  for (let index = 0; index < 200; index++) {
    const { written } = round(state);
    disposedG += written.disposedGlucoseG;
    state = written;
    assert.ok(state.glucoseMassG >= baselineMassG - 1e-9, `round ${index + 1} fell below baseline`);
  }
  assert.ok(Math.abs((state.glucoseMassG - baselineMassG) + disposedG - 30) < 1e-6);
});

test('glucose output is finite and JSON-safe', () => {
  const cases = [
    { state: { ...initialState }, options: {} },
    { state: { glucoseMassG: baselineMassG + 30, concentrationMgDl: 0, disposedGlucoseG: 0 }, options: { insulin: 2, request: 5 } },
    { state: { glucoseMassG: 6, concentrationMgDl: 0, disposedGlucoseG: 0 }, options: { insulin: 0, request: 0 } },
    { state: { glucoseMassG: -5, concentrationMgDl: 0, disposedGlucoseG: 0 }, options: {} },
  ];
  for (const { state, options } of cases) {
    const { written } = round(state, options);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
