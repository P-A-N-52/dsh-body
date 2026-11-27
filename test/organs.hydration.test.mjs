import test from 'node:test';
import assert from 'node:assert/strict';
import * as hydration from '../organs/human-organs/stomach/hydration.ts';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';

// Mirrors the Gateway: every module writes its full next part first, then the
// transfer requests are applied to the written snapshot in the same round.
function tick(parts, actions = []) {
  const writes = {};
  const transfers = [];
  hydration.heartbeat({
    read: (partId) => parts[partId],
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { writes.stomach = next; },
    transfer: (fromPart, fromField, toPart, toField, amount) => {
      transfers.push({ fromPart, fromField, toPart, toField, amount });
    },
  });
  const nextParts = { ...parts, ...writes };
  for (const { fromPart, fromField, toPart, toField, amount } of transfers) {
    nextParts[fromPart] = { ...nextParts[fromPart], [fromField]: nextParts[fromPart][fromField] - amount };
    nextParts[toPart] = { ...(nextParts[toPart] ?? {}), [toField]: (nextParts[toPart]?.[toField] ?? 0) + amount };
  }
  return { parts: nextParts, written: writes.stomach, transfers };
}

const smallIntestineStub = {
  id: 'smallIntestine',
  initialState: { waterVolumeMl: 0, carbohydrateG: 0 },
  fields: {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['stomach.waterVolumeMl'],
      transferOut: ['bodyFluid.waterVolumeMl'],
    },
    carbohydrateG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['stomach.carbohydrateG'],
      transferOut: ['glucose.glucoseMassG'],
    },
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
  initialState: { glucoseMassG: 12.69, disposedGlucoseG: 0 },
  fields: {
    glucoseMassG: { unit: 'g', mode: 'absolute', transferIn: ['smallIntestine.carbohydrateG'] },
  },
};

// Mirrors the Gateway with the real operation applier: writes are committed first,
// then transfers are resolved against the written snapshot.
function operationRound(parts, actions = []) {
  const registry = createFieldRegistry([
    hydration,
    smallIntestineStub,
    bodyFluidStub,
    glucoseStub,
  ]);
  const writes = {};
  const transfers = [];
  hydration.heartbeat({
    read: (partId) => parts[partId],
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { writes.stomach = next; },
    transfer: (fromPart, fromField, toPart, toField, amount) => {
      transfers.push({ caller: hydration.id, fromPart, fromField, toPart, toField, amount });
    },
  });
  const written = structuredClone(writes.stomach);
  const next = {
    ...parts,
    ...applyOperations({
      registry,
      snapshotParts: parts,
      writes,
      transfers,
    }),
  };
  return { written, transfers, parts: next };
}

function initialParts() {
  return {
    stomach: { ...hydration.initialState },
    smallIntestine: { ...smallIntestineStub.initialState },
    bodyFluid: { ...bodyFluidStub.initialState },
    glucose: { ...glucoseStub.initialState },
  };
}

function assertCarbohydrateAccount(parts, intakeG) {
  const queuedG = parts.stomach.mealQueue.reduce(
    (sum, meal) => sum + (meal.remainingCarbohydrateG ?? 0),
    0,
  );
  const accountedG = parts.stomach.carbohydrateG
    + queuedG
    + parts.smallIntestine.carbohydrateG
    + (parts.glucose.glucoseMassG - glucoseStub.initialState.glucoseMassG)
    + (parts.glucose.disposedGlucoseG ?? 0);
  assert.ok(Math.abs(accountedG - intakeG) < 1e-6, `accounted ${accountedG} g vs intake ${intakeG} g`);
}

function assertOnlyZeroStomachCarbohydrateTransfers(transfers) {
  for (const transfer of transfers) {
    if (transfer.fromField === 'waterVolumeMl') continue;
    assert.deepEqual(
      [transfer.fromPart, transfer.fromField, transfer.toPart, transfer.toField],
      ['stomach', 'carbohydrateG', 'smallIntestine', 'carbohydrateG'],
    );
    assert.equal(transfer.amount, 0);
  }
}

function assertCarbohydrateTransfer(result) {
  const carbTransfers = result.transfers.filter(
    (transfer) => transfer.fromField === 'carbohydrateG' || transfer.toField === 'carbohydrateG',
  );
  if (result.written.emptiedCarbohydrateG > 0) {
    assert.equal(carbTransfers.length, 1, 'exactly one stomach -> intestine carbohydrate transfer');
    const [transfer] = carbTransfers;
    assert.deepEqual(
      [transfer.fromPart, transfer.fromField, transfer.toPart, transfer.toField],
      ['stomach', 'carbohydrateG', 'smallIntestine', 'carbohydrateG'],
    );
    assert.ok(Math.abs(transfer.amount - result.written.emptiedCarbohydrateG) < 1e-12);
    return;
  }
  assert.ok(carbTransfers.length <= 1, 'at most one zero-amount carbohydrate transfer');
  for (const transfer of carbTransfers) {
    assert.deepEqual(
      [transfer.fromPart, transfer.fromField, transfer.toPart, transfer.toField],
      ['stomach', 'carbohydrateG', 'smallIntestine', 'carbohydrateG'],
    );
    assert.equal(transfer.amount, 0);
  }
}

function assertCarbohydrateLedger(result, cumulativeEmptiedG) {
  const { written, parts } = result;
  assert.ok(
    Math.abs(parts.stomach.carbohydrateG - (written.carbohydrateG - written.emptiedCarbohydrateG)) < 1e-12,
    'stomach carbohydrate must drop by exactly the written emptied amount',
  );
  assert.ok(
    Math.abs(parts.stomach.solidCarbohydrateG - written.solidCarbohydrateG) < 1e-12,
    'solid subtotal is written pre-transfer and must not change at transfer',
  );
  assert.ok(
    Math.abs(parts.smallIntestine.carbohydrateG - cumulativeEmptiedG) < 1e-12,
    'intestine holds exactly the cumulative stomach transfers before absorption',
  );
}

test('the hydration entry keeps the stomach id and declares the water transfer', () => {
  assert.equal(hydration.id, 'stomach');
  assert.deepEqual(hydration.actionTypes, ['drink', 'eat']);
  assert.equal(hydration.initialState.waterVolumeMl, 0);
  assert.equal(hydration.initialState.emptiedWaterMl, 0);
  assert.equal(hydration.initialState.deliveredWaterMl, 0);
  assert.deepEqual(hydration.fields.deliveredWaterMl, { unit: 'mL', mode: 'absolute' });
  assert.equal(hydration.fields.waterVolumeMl.unit, 'mL');
  assert.deepEqual(hydration.fields.waterVolumeMl.transferOut, ['smallIntestine.waterVolumeMl']);
  assert.equal(hydration.fields.emptiedWaterMl.unit, 'mL');
});

test('the hydration entry declares the carbohydrate fields and stomach -> intestine pair', () => {
  assert.equal(hydration.initialState.carbohydrateG, 0);
  assert.equal(hydration.initialState.solidCarbohydrateG, 0);
  assert.equal(hydration.initialState.emptiedCarbohydrateG, 0);
  assert.deepEqual(hydration.fields.carbohydrateG, {
    unit: 'g',
    mode: 'absolute',
    transferOut: ['smallIntestine.carbohydrateG'],
  });
  assert.deepEqual(hydration.fields.solidCarbohydrateG, { unit: 'g', mode: 'absolute' });
  assert.deepEqual(hydration.fields.emptiedCarbohydrateG, { unit: 'g', mode: 'absolute' });
});

test('drink and eat carbohydrateG enter the stomach and default to zero', () => {
  const cases = [
    { action: { type: 'drink', volumeMl: 240, carbohydrateG: 30 }, expected: 30 },
    { action: { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid', carbohydrateG: 30 }, expected: 30 },
    { action: { type: 'drink', volumeMl: 240 }, expected: 0 },
    { action: { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' }, expected: 0 },
  ];
  for (const { action, expected } of cases) {
    const { written } = tick({ stomach: { ...hydration.initialState } }, [action]);
    assert.equal(written.carbohydrateG, expected, action.type);
    assert.equal(written.solidCarbohydrateG, 0, action.type);
    assert.equal(written.emptiedCarbohydrateG, 0, action.type);
  }
});

test('an invalid carbohydrateG invalidates the whole drink or meal', () => {
  const actions = [
    { type: 'drink', volumeMl: 240 },
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ];
  for (const carbohydrateG of [-1, Number.NaN, Number.POSITIVE_INFINITY, '30']) {
    for (const action of actions) {
      const label = `${action.type} ${String(carbohydrateG)}`;
      const { written } = tick({ stomach: { ...hydration.initialState } }, [{ ...action, carbohydrateG }]);
      assert.equal(written.volumeMl, 0, label);
      assert.equal(written.energyKcal, 0, label);
      assert.equal(written.lastIntakeAt, null, label);
      assert.equal(written.carbohydrateG, 0, label);
      assert.equal(written.solidCarbohydrateG, 0, label);
      assert.equal(written.emptiedCarbohydrateG, 0, label);
      assert.equal(written.mealQueue.length, 0, label);
    }
  }
});

test('write and transfer split stomach carbohydrate with the existing solid and non-solid rates', () => {
  const prev = {
    ...hydration.initialState,
    volumeMl: 500,
    energyKcal: 200,
    solidVolumeMl: 200,
    solidEnergyKcal: 100,
    waterVolumeMl: 0,
    carbohydrateG: 60,
    solidCarbohydrateG: 20,
  };
  const { written, transfers, parts } = operationRound(
    { ...initialParts(), stomach: prev },
    [{ type: 'drink', volumeMl: 240, carbohydrateG: 30 }],
  );

  const nonSolidVolumeMl = 300;
  const nonSolidHalfTimeMin = 13 + 53.75 * (100 / nonSolidVolumeMl);
  const emptiedNonSolidMl = nonSolidVolumeMl * (1 - 2 ** (-1 / nonSolidHalfTimeMin));
  const solidFraction = 1 - 2 ** (-1 / 68.7);
  const emptiedSolidCarbohydrateG = 20 * solidFraction;
  const emptiedNonSolidCarbohydrateG = emptiedNonSolidMl * (60 - 20) / nonSolidVolumeMl;
  const emptiedCarbohydrateG = emptiedNonSolidCarbohydrateG + emptiedSolidCarbohydrateG;

  assert.equal(written.carbohydrateG, 60 + 30);
  assert.ok(Math.abs(written.solidCarbohydrateG - (20 - emptiedSolidCarbohydrateG)) < 1e-12);
  assert.ok(Math.abs(written.emptiedCarbohydrateG - emptiedCarbohydrateG) < 1e-12);
  assert.ok(Math.abs(parts.stomach.carbohydrateG - (60 + 30 - emptiedCarbohydrateG)) < 1e-12);
  assert.ok(Math.abs(parts.stomach.solidCarbohydrateG - (20 - emptiedSolidCarbohydrateG)) < 1e-12);
  assert.ok(parts.stomach.solidCarbohydrateG >= 0);
  assert.ok(parts.stomach.solidCarbohydrateG <= parts.stomach.carbohydrateG);

  assertCarbohydrateTransfer({ written, transfers });
  assertCarbohydrateLedger({ written, parts }, emptiedCarbohydrateG);
});

test('a three-round solid meal releases the carbohydrate tail without losing mass', () => {
  const solidFraction = 1 - 2 ** (-1 / 68.7);
  const intakeG = 90;
  let cumulativeEmptiedG = 0;
  let parts = initialParts();

  let result = operationRound(parts, [
    { type: 'eat', volumeMl: 300, energyKcal: 200, mealKind: 'solid', durationMin: 3, carbohydrateG: intakeG },
  ]);
  parts = result.parts;
  assert.equal(result.written.carbohydrateG, 30);
  assert.equal(result.written.solidCarbohydrateG, 30);
  assert.equal(result.written.emptiedCarbohydrateG, 0);
  assert.equal(result.written.mealQueue.length, 1);
  assert.equal(result.written.mealQueue[0].remainingCarbohydrateG, 60);
  assert.equal(result.written.mealQueue[0].rateCarbohydrateGPerRound, 30);
  assert.equal(result.written.mealQueue[0].remainingRounds, 2);
  assertCarbohydrateTransfer(result);
  cumulativeEmptiedG += result.written.emptiedCarbohydrateG;
  assertCarbohydrateLedger(result, cumulativeEmptiedG);
  assertCarbohydrateAccount(parts, intakeG);

  const firstEmptiedG = 30 * solidFraction;
  result = operationRound(parts);
  parts = result.parts;
  assert.ok(Math.abs(result.written.carbohydrateG - 60) < 1e-12);
  assert.ok(Math.abs(result.written.solidCarbohydrateG - (60 - firstEmptiedG)) < 1e-12);
  assert.ok(Math.abs(result.written.emptiedCarbohydrateG - firstEmptiedG) < 1e-12);
  assert.equal(result.written.mealQueue[0].remainingCarbohydrateG, 30);
  assert.equal(result.written.mealQueue[0].rateCarbohydrateGPerRound, 30);
  assertCarbohydrateTransfer(result);
  cumulativeEmptiedG += result.written.emptiedCarbohydrateG;
  assertCarbohydrateLedger(result, cumulativeEmptiedG);
  assertCarbohydrateAccount(parts, intakeG);

  const secondStartG = 60 - firstEmptiedG;
  const secondEmptiedG = secondStartG * solidFraction;
  result = operationRound(parts);
  parts = result.parts;
  assert.ok(Math.abs(result.written.carbohydrateG - (90 - firstEmptiedG)) < 1e-12);
  assert.ok(Math.abs(result.written.solidCarbohydrateG - (90 - firstEmptiedG - secondEmptiedG)) < 1e-12);
  assert.ok(Math.abs(result.written.emptiedCarbohydrateG - secondEmptiedG) < 1e-12);
  assert.equal(result.written.mealQueue.length, 0);
  assertCarbohydrateTransfer(result);
  cumulativeEmptiedG += result.written.emptiedCarbohydrateG;
  assertCarbohydrateLedger(result, cumulativeEmptiedG);
  assertCarbohydrateAccount(parts, intakeG);

  result = operationRound(parts);
  parts = result.parts;
  assert.equal(result.written.mealQueue.length, 0);
  assertCarbohydrateTransfer(result);
  cumulativeEmptiedG += result.written.emptiedCarbohydrateG;
  assertCarbohydrateLedger(result, cumulativeEmptiedG);
  assertCarbohydrateAccount(parts, intakeG);
});

test('a final queue slice with only carbohydrate left still releases and is removed', () => {
  const queued = {
    ...hydration.initialState,
    mealQueue: [{
      remainingMl: 0,
      remainingKcal: 0,
      rateMlPerRound: 0,
      rateKcalPerRound: 0,
      remainingRounds: 1,
      mealKind: 'solid',
      remainingCarbohydrateG: 30,
      rateCarbohydrateGPerRound: 30,
    }],
  };
  const result = operationRound({ ...initialParts(), stomach: queued });

  assert.equal(result.written.carbohydrateG, 30);
  assert.equal(result.written.solidCarbohydrateG, 30);
  assert.equal(result.written.emptiedCarbohydrateG, 0);
  assert.equal(result.written.volumeMl, 0);
  assert.equal(result.written.energyKcal, 0);
  assert.equal(result.written.mealQueue.length, 0);
  assert.equal(result.parts.stomach.carbohydrateG, 30);
  assert.equal(result.parts.smallIntestine.carbohydrateG, 0);
});

test('old stomach and queue state without carbohydrate metadata reads zero carbohydrate', () => {
  const old = {
    volumeMl: 240,
    energyKcal: 0,
    solidVolumeMl: 0,
    solidEnergyKcal: 0,
    emptiedMl: 0,
    emptiedKcal: 0,
    lastIntakeAt: null,
    waterVolumeMl: 0,
    mealQueue: [],
  };
  const { written } = tick({ stomach: old });
  assert.equal(written.carbohydrateG, 0);
  assert.equal(written.solidCarbohydrateG, 0);
  assert.equal(written.emptiedCarbohydrateG, 0);

  const queued = {
    ...hydration.initialState,
    mealQueue: [{
      remainingMl: 100,
      remainingKcal: 0,
      rateMlPerRound: 50,
      rateKcalPerRound: 0,
      remainingRounds: 3,
      mealKind: 'liquid',
    }],
  };
  const { written: next } = tick({ stomach: queued });
  assert.equal(next.carbohydrateG, 0);
  assert.equal(next.solidCarbohydrateG, 0);
  assert.equal(next.emptiedCarbohydrateG, 0);
  assert.equal(next.volumeMl, 50);
  assert.equal(next.mealQueue.length, 1);
  assert.equal(next.mealQueue[0].remainingCarbohydrateG ?? 0, 0);
});

test('a first 240 mL drink becomes stomach water and empties nothing', () => {
  const { written, transfers } = tick({ stomach: { ...hydration.initialState } }, [
    { type: 'drink', volumeMl: 240 },
  ]);
  assert.equal(written.waterVolumeMl, 240);
  assert.equal(written.emptiedWaterMl, 0);
  assert.equal(written.volumeMl, 240);
  assert.equal(written.energyKcal, 0);
  const waterTransfers = transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl');
  assert.equal(waterTransfers.length, 0);
  assertOnlyZeroStomachCarbohydrateTransfers(transfers);
});

test('the second round writes the pre-transfer water baseline and transfers the non-solid share', () => {
  const first = tick({ stomach: { ...hydration.initialState } }, [{ type: 'drink', volumeMl: 240 }]);
  const second = tick(first.parts);
  const emptiedWaterMl = 240 * (1 - 2 ** (-1 / 13));

  assert.equal(second.written.waterVolumeMl, 240);
  assert.ok(Math.abs(second.written.emptiedWaterMl - emptiedWaterMl) < 1e-12);
  const waterTransfers = second.transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl');
  assert.equal(waterTransfers.length, 1);
  const [transfer] = waterTransfers;
  assert.deepEqual(
    [transfer.fromPart, transfer.fromField, transfer.toPart, transfer.toField],
    ['stomach', 'waterVolumeMl', 'smallIntestine', 'waterVolumeMl'],
  );
  assert.ok(Math.abs(transfer.amount - emptiedWaterMl) < 1e-12);
  assert.ok(Math.abs(second.parts.stomach.waterVolumeMl - (240 - emptiedWaterMl)) < 1e-12);
  assertOnlyZeroStomachCarbohydrateTransfers(second.transfers);
});

test('with solid content present the emptied water is half of the non-solid emptying', () => {
  const prev = {
    ...hydration.initialState,
    volumeMl: 500,
    energyKcal: 0,
    solidVolumeMl: 200,
    solidEnergyKcal: 0,
    waterVolumeMl: 150,
  };
  const { written, transfers } = tick({ stomach: prev });
  const nonSolidEmptiedMl = 300 * (1 - 2 ** (-1 / 13));
  const solidEmptiedMl = 200 * (1 - 2 ** (-1 / 68.7));

  assert.ok(Math.abs(written.emptiedMl - (nonSolidEmptiedMl + solidEmptiedMl)) < 1e-9);
  assert.ok(Math.abs(written.emptiedWaterMl - nonSolidEmptiedMl / 2) < 1e-9);
  assert.ok(Math.abs(written.emptiedWaterMl / (written.emptiedMl - solidEmptiedMl) - 0.5) < 1e-12);
  assert.equal(written.waterVolumeMl, 150);
  const waterTransfers = transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl');
  assert.equal(waterTransfers.length, 1);
  assert.ok(Math.abs(waterTransfers[0].amount - nonSolidEmptiedMl / 2) < 1e-9);
  assertOnlyZeroStomachCarbohydrateTransfers(transfers);
});

test('a 240 mL drink over 3 minutes adds only 80 mL of water per round', () => {
  let parts = { stomach: { ...hydration.initialState } };
  const increments = [];
  for (let i = 0; i < 3; i++) {
    const previousWaterMl = parts.stomach.waterVolumeMl;
    const result = tick(parts, i === 0 ? [{ type: 'drink', volumeMl: 240, durationMin: 3 }] : []);
    if (i === 0) {
      assert.equal(result.written.mealQueue.length, 1);
      assert.equal(result.written.mealQueue[0].remainingWaterMl, 160);
      assert.equal(result.written.mealQueue[0].rateWaterMl, 80);
      assert.equal(result.written.mealQueue[0].remainingMl, 160);
    }
    increments.push(result.written.waterVolumeMl - previousWaterMl);
    parts = result.parts;
  }
  for (const increment of increments) assert.ok(Math.abs(increment - 80) < 1e-9);
  assert.equal(parts.stomach.mealQueue.length, 0);

  const smallIntestineMl = parts.smallIntestine?.waterVolumeMl ?? 0;
  assert.ok(Math.abs(parts.stomach.waterVolumeMl + smallIntestineMl - 240) < 1e-9);
});

test('eat never adds water, including liquid, solid and mixed meals', () => {
  for (const mealKind of ['liquid', 'solid', 'mixed']) {
    const { written, transfers } = tick({ stomach: { ...hydration.initialState } }, [
      { type: 'eat', volumeMl: 300, energyKcal: 200, mealKind, durationMin: 3 },
    ]);
    assert.equal(written.waterVolumeMl, 0, mealKind);
    assert.equal(written.emptiedWaterMl, 0, mealKind);
    assert.equal(written.volumeMl, 100, mealKind);
    assert.equal(written.mealQueue[0].remainingWaterMl, 0, mealKind);
    assert.equal(written.mealQueue[0].rateWaterMl, 0, mealKind);
    assert.equal(
      transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl').length,
      0,
      mealKind,
    );
    assertOnlyZeroStomachCarbohydrateTransfers(transfers);
  }
});

test('an old stomach state without the water field starts with zero water', () => {
  const old = {
    volumeMl: 240,
    energyKcal: 0,
    emptiedMl: 0,
    emptiedKcal: 0,
    lastIntakeAt: null,
    mealQueue: [],
  };
  const { written, transfers } = tick({ stomach: old });
  assert.equal(written.waterVolumeMl, 0);
  assert.equal(written.emptiedWaterMl, 0);
  assert.equal(
    transfers.filter((transfer) => transfer.fromField === 'waterVolumeMl').length,
    0,
  );
  assertOnlyZeroStomachCarbohydrateTransfers(transfers);
  assert.ok(Math.abs(written.volumeMl - 240 * 2 ** (-1 / 13)) < 1e-9);
  assert.equal(written.solidVolumeMl, 0);
  assert.equal(written.solidEnergyKcal, 0);
});

test('old queue entries without water metadata deliver no water', () => {
  const old = {
    ...hydration.initialState,
    mealQueue: [{
      remainingMl: 100,
      remainingKcal: 0,
      rateMlPerRound: 50,
      rateKcalPerRound: 0,
      remainingRounds: 3,
      mealKind: 'liquid',
    }],
  };
  const { written } = tick({ stomach: old });
  assert.equal(written.volumeMl, 50);
  assert.equal(written.waterVolumeMl, 0);
  assert.equal(written.deliveredWaterMl, 0, 'legacy liquid volume does not establish a water dose');
  assert.equal(written.emptiedWaterMl, 0);
  assert.equal(written.mealQueue[0].remainingRounds, 2);
});

test('the water subset is clamped into the non-solid stomach volume', () => {
  const { written } = tick({
    stomach: { ...hydration.initialState, volumeMl: 300, waterVolumeMl: 500 },
  });
  const nonSolidEmptiedMl = 300 * (1 - 2 ** (-1 / 13));
  assert.equal(written.waterVolumeMl, 300);
  assert.ok(Math.abs(written.emptiedWaterMl - nonSolidEmptiedMl) < 1e-9);
});
