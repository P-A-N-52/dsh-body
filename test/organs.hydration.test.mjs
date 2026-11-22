import test from 'node:test';
import assert from 'node:assert/strict';
import * as hydration from '../organs/human-organs/stomach/hydration.ts';

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

test('the hydration entry keeps the stomach id and declares the water transfer', () => {
  assert.equal(hydration.id, 'stomach');
  assert.deepEqual(hydration.actionTypes, ['drink', 'eat']);
  assert.equal(hydration.initialState.waterVolumeMl, 0);
  assert.equal(hydration.initialState.emptiedWaterMl, 0);
  assert.equal(hydration.fields.waterVolumeMl.unit, 'mL');
  assert.deepEqual(hydration.fields.waterVolumeMl.transferOut, ['smallIntestine.waterVolumeMl']);
  assert.equal(hydration.fields.emptiedWaterMl.unit, 'mL');
});

test('a first 240 mL drink becomes stomach water and empties nothing', () => {
  const { written, transfers } = tick({ stomach: { ...hydration.initialState } }, [
    { type: 'drink', volumeMl: 240 },
  ]);
  assert.equal(written.waterVolumeMl, 240);
  assert.equal(written.emptiedWaterMl, 0);
  assert.equal(written.volumeMl, 240);
  assert.equal(written.energyKcal, 0);
  assert.equal(transfers.length, 0);
});

test('the second round writes the pre-transfer water baseline and transfers the non-solid share', () => {
  const first = tick({ stomach: { ...hydration.initialState } }, [{ type: 'drink', volumeMl: 240 }]);
  const second = tick(first.parts);
  const emptiedWaterMl = 240 * (1 - 2 ** (-1 / 13));

  assert.equal(second.written.waterVolumeMl, 240);
  assert.ok(Math.abs(second.written.emptiedWaterMl - emptiedWaterMl) < 1e-12);
  assert.equal(second.transfers.length, 1);
  const [transfer] = second.transfers;
  assert.deepEqual(
    [transfer.fromPart, transfer.fromField, transfer.toPart, transfer.toField],
    ['stomach', 'waterVolumeMl', 'smallIntestine', 'waterVolumeMl'],
  );
  assert.ok(Math.abs(transfer.amount - emptiedWaterMl) < 1e-12);
  assert.ok(Math.abs(second.parts.stomach.waterVolumeMl - (240 - emptiedWaterMl)) < 1e-12);
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
  assert.equal(transfers.length, 1);
  assert.ok(Math.abs(transfers[0].amount - nonSolidEmptiedMl / 2) < 1e-9);
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
    assert.equal(transfers.length, 0, mealKind);
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
  assert.equal(transfers.length, 0);
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
