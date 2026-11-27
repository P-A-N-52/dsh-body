import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceStomach, stomachInitialState } from '../organs/human-organs/stomach/motility-core.ts';

const options = { trackWater: true, trackCarbohydrate: true, trackFat: true };

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≉ ${expected}`);
}

test('fat follows the same ingestion slices and the corresponding round-start solid/non-solid volume', () => {
  const meal = { type: 'eat', volumeMl: 123, energyKcal: 303, mealKind: 'solid', durationMin: 2.5, carbohydrateG: 9, fatG: 20 };
  const drink = { type: 'drink', volumeMl: 150, energyKcal: 120, carbohydrateG: 8, fatG: 5, fatGSource: 'estimate' };
  const first = advanceStomach(stomachInitialState, [meal, drink], 60, 60, options);
  const withoutFat = advanceStomach(stomachInitialState, [meal, drink], 60, 60, { ...options, trackFat: false });
  assert.equal(first.state.energyKcal, withoutFat.state.energyKcal);
  assert.equal(first.state.volumeMl, withoutFat.state.volumeMl);
  assert.equal(first.deliveredWaterMl, 150);
  assert.deepEqual(first.carbohydrate, withoutFat.carbohydrate);
  assert.equal(first.fat.state.emptiedFatG, 0);
  assert.equal(first.fat.state.explicitFatIntakeG, 20 / 3);
  assert.equal(first.fat.state.estimatedFatIntakeG, 5);
  assert.equal(first.state.mealQueue.length, 1);
  assert.equal(first.state.mealQueue[0].remainingFatG, 20 - 20 / 3);
  assert.equal(Object.hasOwn(withoutFat.state.mealQueue[0], 'remainingFatG'), false);

  const before = { ...first.state, ...first.fat.state };
  const second = advanceStomach(before, [], 60, 120, options);
  near(second.fat.emptiedSolidFatG, before.solidFatG * (1 - 2 ** (-1 / 68.7)));
  const nonSolidVolumeMl = before.volumeMl - before.solidVolumeMl;
  near(second.fat.emptiedNonSolidFatG, before.nonSolidFatG * second.emptiedNonSolidMl / nonSolidVolumeMl);
  assert.equal(second.fat.state.explicitFatIntakeG, 20 / 3);
  assert.equal(second.fat.state.estimatedFatIntakeG, null);
});

test('explicit zero, an unknown old queued slice, and idle have different observations', () => {
  const legacy = advanceStomach(stomachInitialState, [{ type: 'drink', volumeMl: 40, durationMin: 2 }], 60, 60, {});
  const next = advanceStomach(legacy.state, [{ type: 'drink', volumeMl: 20, fatG: 0 }], 60, 120, options);
  assert.equal(next.fat.state.explicitFatIntakeG, 0);
  assert.equal(next.fat.state.estimatedFatIntakeG, null);
  assert.equal(next.fat.state.unknownFatIntakeSlices, 1);
  assert.equal(next.fat.state.solidFatG + next.fat.state.nonSolidFatG, 0);
  const idle = advanceStomach(next.state, [], 60, 180, options);
  assert.equal(idle.fat.state.explicitFatIntakeG, null);
  assert.equal(idle.fat.state.unknownFatIntakeSlices, 0);
});
