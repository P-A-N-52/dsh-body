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

function round(state, dt = 60, parts = {}) {
  let written;
  const transfers = [];
  heartbeat({
    read: (partId) => (partId === 'smallIntestine' ? state : parts[partId]),
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
const residueFraction = 0.05;
const absorbedFrom = (waterMl, dt = 60) => waterMl * (1 - 2 ** (-(dt / 60) / halfTimeMin));
const absorbedCarbohydrateFrom = (carbohydrateG, dt = 60) =>
  carbohydrateG * (1 - 2 ** (-(dt / 60) / carbohydrateHalfTimeMin));
const residueFrom = (waterMl, absorbedMl) => Math.min(
  Math.max(0, waterMl - absorbedMl),
  absorbedMl * (residueFraction / (1 - residueFraction)),
);

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

const colonStub = {
  id: 'colon',
  initialState: { residueWaterMl: 0, reclaimedWaterMl: 0 },
  fields: {
    residueWaterMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['smallIntestine.waterVolumeMl'],
    },
    reclaimedWaterMl: {
      unit: 'mL',
      mode: 'absolute',
      transferOut: ['bodyFluid.waterVolumeMl'],
    },
  },
};

test('small intestine declares the water and carbohydrate transfer pairs', () => {
  assert.equal(id, 'smallIntestine');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['stomach.waterVolumeMl'],
      transferOut: ['bodyFluid.waterVolumeMl', 'colon.residueWaterMl'],
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

test('a manifest with small intestine and body fluid but no colon fails startup', () => {
  assert.throws(
    () => createFieldRegistry([
      { id, initialState, fields },
      {
        id: 'bodyFluid',
        initialState: { waterVolumeMl: 0 },
        fields: {
          waterVolumeMl: {
            unit: 'mL',
            mode: 'absolute',
            transferIn: ['smallIntestine.waterVolumeMl'],
          },
        },
      },
    ]),
    (error) => {
      assert.match(error.message, /smallIntestine/);
      assert.match(error.message, /colon\.residueWaterMl/);
      assert.match(error.message, /not declared/);
      return true;
    },
  );
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
  const residue = residueFrom(100, expected);
  assert.equal(written.waterVolumeMl, 100);
  assert.ok(Math.abs(written.absorbedWaterMl - expected) < 1e-12);
  assert.deepEqual(transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl'), [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: expected,
  }, {
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'colon',
    toField: 'residueWaterMl',
    amount: residue,
  }]);
  assertOnlyZeroSmallIntestineCarbohydrateTransfers(transfers);
});

test('the residue transfer is flux-proportional to absorption and scales with dtMin', () => {
  const { written, transfers } = round({ ...initialState, waterVolumeMl: 1000 });
  const expected = absorbedFrom(1000);
  const residue = residueFrom(1000, expected);
  assert.ok(Math.abs(written.absorbedWaterMl - expected) < 1e-12);
  assert.deepEqual(transfers.filter((transfer) => transfer.toPart === 'colon'), [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'colon',
    toField: 'residueWaterMl',
    amount: residue,
  }]);
  assert.ok(
    Math.abs(residue / (expected + residue) - residueFraction) < 1e-12,
    'leaving flux splits 95% absorbed / 5% colon residue',
  );
  assert.equal(round({ ...initialState, waterVolumeMl: 0 }).transfers
    .find((transfer) => transfer.toPart === 'colon').amount, 0);

  const shortRound = round({ ...initialState, waterVolumeMl: 1000 }, 6);
  const shortAbsorbed = shortRound.written.absorbedWaterMl;
  const shortResidue = shortRound.transfers.find((transfer) => transfer.toPart === 'colon').amount;
  assert.ok(shortResidue < residue / 5, 'residue scales with dtMin rather than dumping 5% of pool per tick');
  assert.ok(Math.abs(shortResidue / (shortAbsorbed + shortResidue) - residueFraction) < 1e-12);
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
      waterVolumeMl: {
        unit: 'mL',
        mode: 'absolute',
        transferIn: ['smallIntestine.waterVolumeMl', 'colon.reclaimedWaterMl'],
      },
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
    colonStub,
  ]);

  const start = { ...initialState, waterVolumeMl: 100, carbohydrateG: 60 };
  const { written, transfers } = round(start);
  const expectedWaterMl = absorbedFrom(100);
  const residueWaterMl = residueFrom(100, expectedWaterMl);
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
      colon: { residueWaterMl: 0, reclaimedWaterMl: 0 },
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

  assert.ok(Math.abs(next.smallIntestine.waterVolumeMl - (100 - expectedWaterMl - residueWaterMl + 20)) < 1e-9);
  assert.ok(Math.abs(next.smallIntestine.absorbedWaterMl - expectedWaterMl) < 1e-12);
  assert.ok(Math.abs(next.bodyFluid.waterVolumeMl - (30000 + expectedWaterMl)) < 1e-9);
  assert.ok(Math.abs(next.colon.residueWaterMl - residueWaterMl) < 1e-9);
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
      fields: {
        waterVolumeMl: {
          unit: 'mL',
          mode: 'absolute',
          transferIn: ['smallIntestine.waterVolumeMl', 'colon.reclaimedWaterMl'],
        },
      },
    },
    {
      id: 'glucose',
      initialState: { glucoseMassG: 12.69 },
      fields: {
        glucoseMassG: { unit: 'g', mode: 'absolute', transferIn: ['smallIntestine.carbohydrateG'] },
      },
    },
    colonStub,
  ]);

  const start = { ...initialState, waterVolumeMl: 100 };
  const { written, transfers } = round(start);
  const expected = absorbedFrom(100);
  const residue = residueFrom(100, expected);
  assert.deepEqual(transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl'), [{
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: expected,
  }, {
    caller: 'smallIntestine',
    fromPart: 'smallIntestine',
    fromField: 'waterVolumeMl',
    toPart: 'colon',
    toField: 'residueWaterMl',
    amount: residue,
  }]);
  assertOnlyZeroSmallIntestineCarbohydrateTransfers(transfers);
  const next = applyOperations({
    registry,
    snapshotParts: {
      stomach: { waterVolumeMl: 20 },
      smallIntestine: start,
      bodyFluid: { waterVolumeMl: 30000 },
      glucose: { glucoseMassG: 12.69 },
      colon: { residueWaterMl: 0, reclaimedWaterMl: 0 },
    },
    writes: { smallIntestine: written, stomach: { waterVolumeMl: 20 } },
    transfers: [
      ...transfers,
      { caller: 'stomach', fromPart: 'stomach', fromField: 'waterVolumeMl', toPart: 'smallIntestine', toField: 'waterVolumeMl', amount: 20 },
    ],
  });

  assert.ok(Math.abs(next.smallIntestine.waterVolumeMl - (100 - expected - residue + 20)) < 1e-9);
  assert.ok(Math.abs(next.smallIntestine.absorbedWaterMl - expected) < 1e-12);
  assert.ok(Math.abs(next.bodyFluid.waterVolumeMl - (30000 + expected)) < 1e-9);
  assert.ok(Math.abs(next.colon.residueWaterMl - residue) < 1e-9);
  assert.equal(next.smallIntestine.carbohydrateG, 0);
  assert.equal(next.smallIntestine.absorbedCarbohydrateG, 0);
  assert.equal(next.glucose.glucoseMassG, 12.69);
});

test('the existing pool plus cumulative absorption and residue is conserved with a 95/5 split over 200 rounds', () => {
  let state = { ...initialState, waterVolumeMl: 200 };
  let absorbed = 0;
  let residue = 0;
  for (let i = 0; i < 200; i++) {
    const { written, transfers } = round(state);
    absorbed += written.absorbedWaterMl;
    residue += transfers.find((transfer) => transfer.toPart === 'colon').amount;
    state = {
      waterVolumeMl: written.waterVolumeMl - written.absorbedWaterMl
        - transfers.find((transfer) => transfer.toPart === 'colon').amount,
      absorbedWaterMl: written.absorbedWaterMl,
    };
  }
  assert.ok(Math.abs(state.waterVolumeMl + absorbed + residue - 200) < 1e-6);
  assert.ok(Math.abs(absorbed / (absorbed + residue) - 0.95) < 1e-9);
  assert.ok(Math.abs(residue / (absorbed + residue) - 0.05) < 1e-9);
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

test('dehydration mildly preserves/aids water absorption without dumping into the colon', () => {
  const start = { ...initialState, waterVolumeMl: 100 };
  const baseline = absorbedFrom(100);
  const fullDeficit = round(start, 60, { bodyFluid: { waterDeficit: 1 } }).written;
  assert.ok(Math.abs(fullDeficit.absorbedWaterMl - baseline * 1.1) < 1e-12);
  const halfDeficit = round(start, 60, { bodyFluid: { waterDeficit: 0.5 } }).written;
  assert.ok(Math.abs(halfDeficit.absorbedWaterMl - baseline * 1.05) < 1e-12);
});

test('water deficit clamps to the unit interval and missing bodyFluid keeps the rate', () => {
  const start = { ...initialState, waterVolumeMl: 100 };
  const baseline = round(start).written;
  assert.deepEqual(round(start, 60, { bodyFluid: { waterDeficit: 2 } }).written,
    round(start, 60, { bodyFluid: { waterDeficit: 1 } }).written);
  assert.deepEqual(round(start, 60, { bodyFluid: { waterDeficit: -1 } }).written, baseline);
  assert.deepEqual(round(start, 60, { bodyFluid: { waterDeficit: 0 } }).written, baseline);
});

test('hyperglycemia lowers carbohydrate absorption via negative gradient feedback while insulin is neutral', () => {
  const start = { ...initialState, carbohydrateG: 60 };
  const baseline = absorbedCarbohydrateFrom(60);
  const both = round(start, 60, {
    pancreasEndocrine: { insulinPmolL: 120 },
    glucose: { concentrationMgDl: 180 },
  }).written;
  assert.ok(Math.abs(both.absorbedCarbohydrateG - baseline * 0.8) < 1e-12);

  const insulinOnly = round(start, 60, {
    pancreasEndocrine: { insulinPmolL: 120 },
    glucose: { concentrationMgDl: 90 },
  }).written;
  assert.ok(Math.abs(insulinOnly.absorbedCarbohydrateG - baseline) < 1e-12);

  const highGlucoseOnly = round(start, 60, {
    pancreasEndocrine: { insulinPmolL: 60 },
    glucose: { concentrationMgDl: 180 },
  }).written;
  assert.ok(Math.abs(highGlucoseOnly.absorbedCarbohydrateG - baseline * 0.8) < 1e-12);

  const lowGlucose = round(start, 60, {
    pancreasEndocrine: { insulinPmolL: 60 },
    glucose: { concentrationMgDl: 45 },
  }).written;
  assert.ok(Math.abs(lowGlucose.absorbedCarbohydrateG - baseline * 1.1) < 1e-12);

  const baselineRound = round(start, 60, {
    pancreasEndocrine: { insulinPmolL: 60 },
    glucose: { concentrationMgDl: 90 },
  }).written;
  assert.ok(Math.abs(baselineRound.absorbedCarbohydrateG - baseline) < 1e-12);
});

test('absorption factors and transfers clamp to non-negative and never overdraft the pool', () => {
  const extremeHyperglycemia = round(
    { ...initialState, carbohydrateG: 60 },
    60,
    { glucose: { concentrationMgDl: 900 } },
  );
  assert.equal(extremeHyperglycemia.written.absorbedCarbohydrateG, 0);
  assert.equal(
    extremeHyperglycemia.transfers.find((t) => t.fromField === 'carbohydrateG').amount,
    0,
  );

  const hugeDtCarb = round(
    { ...initialState, carbohydrateG: 60 },
    60 * 1000,
    { glucose: { concentrationMgDl: 0 } },
  );
  assert.equal(hugeDtCarb.written.absorbedCarbohydrateG, 60);
  assert.equal(
    hugeDtCarb.transfers.find((t) => t.fromField === 'carbohydrateG').amount,
    60,
  );

  const hugeDtWater = round(
    { ...initialState, waterVolumeMl: 100 },
    60 * 1000,
    { bodyFluid: { waterDeficit: 1 } },
  );
  assert.equal(hugeDtWater.written.absorbedWaterMl, 100);
  assert.equal(hugeDtWater.transfers.find((t) => t.toPart === 'bodyFluid').amount, 100);
  assert.equal(hugeDtWater.transfers.find((t) => t.toPart === 'colon').amount, 0);
});

test('missing glucose and pancreas parts keep the original carbohydrate rate', () => {
  const start = { ...initialState, carbohydrateG: 60 };
  assert.deepEqual(round(start).written, round(start, 60, {
    glucose: undefined,
    pancreasEndocrine: undefined,
  }).written);
});

test('invalid upstream readings throw before writing or transferring', () => {
  const cases = [
    ['bodyFluid', {}],
    ['bodyFluid', { waterDeficit: Number.NaN }],
    ['bodyFluid', { waterDeficit: Number.POSITIVE_INFINITY }],
    ['glucose', {}],
    ['glucose', { concentrationMgDl: Number.NaN }],
    ['glucose', { concentrationMgDl: -1 }],
    ['pancreasEndocrine', {}],
    ['pancreasEndocrine', { insulinPmolL: Number.NaN }],
    ['pancreasEndocrine', { insulinPmolL: Number.POSITIVE_INFINITY }],
    ['pancreasEndocrine', { insulinPmolL: -1 }],
  ];
  for (const [partId, reading] of cases) {
    let written;
    const transfers = [];
    assert.throws(() => {
      heartbeat({
        read: (id) => (id === 'smallIntestine'
          ? { ...initialState, waterVolumeMl: 100, carbohydrateG: 60 }
          : id === partId ? reading : undefined),
        actions: [],
        dt: 60,
        simulatedSeconds: 60,
        write: (next) => { written = next; },
        transfer: (...args) => transfers.push(args),
      });
    }, new RegExp(`${partId}\\.`));
    assert.equal(written, undefined);
    assert.equal(transfers.length, 0);
  }
});

test('absorption feedback parameters are design placeholders', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/small-intestine/water-absorption.parameters.json', import.meta.url),
    'utf8',
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  for (const [parameterId, value, unit] of [
    ['smallIntestine.waterAbsorptionDehydrationFactor', 0.1, '1'],
    ['smallIntestine.carbAbsorptionInsulinGain', 0, '1'],
    ['smallIntestine.carbAbsorptionGradientGain', 0.2, '1'],
  ]) {
    const parameter = byId[parameterId];
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
});
