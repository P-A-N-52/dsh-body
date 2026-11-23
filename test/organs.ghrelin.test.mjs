import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fields, heartbeat, initialState } from '../organs/human-organs/stomach/ghrelin.ts';

function round(state, actions = [], parts = {}) {
  let written;
  heartbeat({
    read: (partId) => (partId === 'stomachGhrelin' ? state : parts[partId]),
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

test('water does not suppress ghrelin', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [{ type: 'drink', volumeMl: 240 }]);
  assert.equal(next.relativeConcentration, 1);
});

test('an energy-bearing eat lowers ghrelin below nadir by the intake dose', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  assert.ok(Math.abs(next.relativeConcentration - 0.34) < 1e-12);
  assert.equal(next.minutesSinceEnergyIntake, 0);
});

test('a zero-energy eat does not suppress', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [
    { type: 'eat', volumeMl: 100, energyKcal: 0, mealKind: 'liquid' },
  ]);
  assert.equal(next.relativeConcentration, 1);
});

test('an energy-bearing drink lowers ghrelin below nadir by the intake dose', () => {
  const next = round({ ...initialState }, [{ type: 'drink', volumeMl: 330, energyKcal: 140 }]);
  assert.ok(Math.abs(next.relativeConcentration - 0.276) < 1e-12);
  assert.equal(next.minutesSinceEnergyIntake, 0);
});

test('a zero-energy drink does not suppress', () => {
  const next = round({ ...initialState, relativeConcentration: 1 }, [
    { type: 'drink', volumeMl: 330, energyKcal: 0 },
  ]);
  assert.equal(next.relativeConcentration, 1);
});

test('a drink with negative or non-finite energy does not suppress', () => {
  for (const energyKcal of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const next = round({ ...initialState, relativeConcentration: 1 }, [
      { type: 'drink', volumeMl: 330, energyKcal },
    ]);
    assert.equal(next.relativeConcentration, 1);
  }
});

test('recovery reaches 0.75 exactly after 90 rounds', () => {
  let state = { relativeConcentration: 0.5 };
  for (let i = 0; i < 90; i++) state = round(state);
  assert.ok(Math.abs(state.relativeConcentration - 0.75) < 1e-12);
});

test('a new energy intake lowers a value already below nadir', () => {
  const next = round({ ...initialState, relativeConcentration: 0.3 }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  assert.ok(Math.abs(next.relativeConcentration - 0.14) < 1e-12);
  assert.equal(next.minutesSinceEnergyIntake, 0);
});

test('ghrelin exports the fasting clock field', () => {
  assert.deepEqual(initialState, { relativeConcentration: 1, minutesSinceEnergyIntake: 0 });
  assert.deepEqual(fields, {
    relativeConcentration: { unit: '1', mode: 'absolute' },
    minutesSinceEnergyIntake: { unit: 'min', mode: 'absolute' },
  });
});

test('missing, negative and non-finite fasting clocks fall back to zero', () => {
  const cases = [
    { relativeConcentration: 1 },
    { relativeConcentration: 1, minutesSinceEnergyIntake: -5 },
    { relativeConcentration: 1, minutesSinceEnergyIntake: Number.NaN },
    { relativeConcentration: 1, minutesSinceEnergyIntake: Number.POSITIVE_INFINITY },
    { relativeConcentration: 1, minutesSinceEnergyIntake: Number.NEGATIVE_INFINITY },
  ];

  for (const state of cases) {
    const next = round(state);
    assert.equal(next.minutesSinceEnergyIntake, 1);
    assert.equal(next.relativeConcentration, 1);
    for (const value of Object.values(next)) assert.ok(Number.isFinite(value));
  }
});

test('the fasting target holds recovery to baseline until onset', () => {
  let state = { relativeConcentration: 0.5, minutesSinceEnergyIntake: 0 };
  for (let i = 0; i < 180; i++) state = round(state);
  assert.equal(state.minutesSinceEnergyIntake, 180);
  assert.ok(Math.abs(state.relativeConcentration - 0.875) < 1e-12);
});

test('the fasting target starts rising at onset and stays below the peak', () => {
  const atOnset = round({ relativeConcentration: 1, minutesSinceEnergyIntake: 179 });
  assert.equal(atOnset.minutesSinceEnergyIntake, 180);
  assert.equal(atOnset.relativeConcentration, 1);

  const afterOnset = round(atOnset);
  assert.equal(afterOnset.minutesSinceEnergyIntake, 181);
  assert.ok(afterOnset.relativeConcentration > 1);
  assert.ok(afterOnset.relativeConcentration <= 1.8);
});

test('twenty hours without energy intake raises ghrelin toward the peak', () => {
  let state = { ...initialState };
  for (let i = 0; i < 1200; i++) state = round(state);
  assert.equal(state.minutesSinceEnergyIntake, 1200);
  assert.ok(state.relativeConcentration >= 1.7);
  assert.ok(state.relativeConcentration <= 1.8);
});

test('an energy intake resets the clock and suppresses in the same round', () => {
  const suppressed = round(
    { relativeConcentration: 1.7, minutesSinceEnergyIntake: 500 },
    [{ type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' }],
  );
  assert.equal(suppressed.minutesSinceEnergyIntake, 0);
  assert.ok(Math.abs(suppressed.relativeConcentration - 0.34) < 1e-12);

  const alreadyLower = round(
    { relativeConcentration: 0.3, minutesSinceEnergyIntake: 500 },
    [{ type: 'drink', volumeMl: 330, energyKcal: 140 }],
  );
  assert.equal(alreadyLower.minutesSinceEnergyIntake, 0);
  assert.ok(Math.abs(alreadyLower.relativeConcentration - 0.076) < 1e-12);
});

test('water and non-energy actions keep the same fasting state as no action', () => {
  const control = round({ relativeConcentration: 1.2, minutesSinceEnergyIntake: 200 });
  const nonEnergyActions = [
    [{ type: 'drink', volumeMl: 240 }],
    [{ type: 'drink', volumeMl: 330, energyKcal: 0 }],
    [{ type: 'eat', volumeMl: 100, energyKcal: 0, mealKind: 'liquid' }],
    [{ type: 'drink', volumeMl: 330, energyKcal: -1 }],
    [{ type: 'drink', volumeMl: 330, energyKcal: Number.NaN }],
    [{ type: 'drink', volumeMl: 330, energyKcal: Number.POSITIVE_INFINITY }],
  ];

  for (const actions of nonEnergyActions) {
    assert.deepEqual(
      round({ relativeConcentration: 1.2, minutesSinceEnergyIntake: 200 }, actions),
      control,
    );
  }
});

test('gastric distension suppresses ghrelin over the recovery half-time', () => {
  let state = { ...initialState };
  for (let i = 0; i < 90; i++) {
    state = round(state, [], { stomachSensory: { mechanical: 1 } });
  }
  assert.ok(Math.abs(state.relativeConcentration - 0.85) < 1e-12);
});

test('duodenum nutrient exposure suppresses ghrelin without any intake', () => {
  let state = { ...initialState };
  for (let i = 0; i < 90; i++) {
    state = round(state, [], { duodenum: { nutrientExposure: 1 } });
  }
  assert.ok(Math.abs(state.relativeConcentration - 0.85) < 1e-12);
});

test('intake suppression is dose dependent and can reach zero', () => {
  const doses = [100, 250, 500].map((energyKcal) => round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal, mealKind: 'liquid' },
  ]).relativeConcentration);
  assert.ok(Math.abs(doses[0] - 0.34) < 1e-12);
  assert.ok(Math.abs(doses[1] - 0.1) < 1e-12);
  assert.ok(Math.abs(doses[2]) < 1e-12);
});

test('distension, nutrient exposure and intake add to the suppression', () => {
  const intakeOnly = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ]);
  const combined = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 100, mealKind: 'liquid' },
  ], {
    stomachSensory: { mechanical: 1 },
    duodenum: { nutrientExposure: 1 },
  });
  assert.ok(combined.relativeConcentration < intakeOnly.relativeConcentration);
  assert.equal(combined.relativeConcentration, 0);
});

test('missing upstream parts and zero readings keep the original trajectory', () => {
  const control = round({ relativeConcentration: 1.2, minutesSinceEnergyIntake: 200 });
  assert.deepEqual(round({ ...initialState, relativeConcentration: 1.2, minutesSinceEnergyIntake: 200 }, [], {
    stomachSensory: { mechanical: 0 },
    duodenum: { nutrientExposure: 0 },
  }), control);
});

test('invalid upstream readings throw before writing state', () => {
  const cases = [
    ['stomachSensory', {}],
    ['stomachSensory', { mechanical: Number.NaN }],
    ['stomachSensory', { mechanical: Number.POSITIVE_INFINITY }],
    ['stomachSensory', { mechanical: -0.1 }],
    ['duodenum', {}],
    ['duodenum', { nutrientExposure: Number.NaN }],
    ['duodenum', { nutrientExposure: Number.POSITIVE_INFINITY }],
    ['duodenum', { nutrientExposure: -1 }],
  ];
  for (const [partId, reading] of cases) {
    let written;
    assert.throws(() => {
      heartbeat({
        read: (id) => (id === 'stomachGhrelin' ? { ...initialState } : id === partId ? reading : undefined),
        actions: [],
        dt: 60,
        simulatedSeconds: 60,
        write: (next) => { written = next; },
      });
    }, new RegExp(`${partId}\\.`));
    assert.equal(written, undefined);
  }
});

test('ghrelin feedback parameters are design placeholders', () => {
  const data = JSON.parse(readFileSync(
    new URL('../organs/human-organs/stomach/ghrelin.parameters.json', import.meta.url),
    'utf8',
  ));
  const byId = Object.fromEntries(data.parameters.map((parameter) => [parameter.id, parameter]));
  for (const [parameterId, value] of [
    ['stomachGhrelin.distensionGain', 0.3],
    ['stomachGhrelin.nutrientGain', 0.3],
    ['stomachGhrelin.intakeGain', 0.4],
    ['stomachGhrelin.referenceIntakeKcal', 250],
  ]) {
    const parameter = byId[parameterId];
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }
});

test('maximum distension, exposure and a 500 kcal intake reach zero', () => {
  const next = round({ ...initialState }, [
    { type: 'eat', volumeMl: 100, energyKcal: 500, mealKind: 'liquid' },
  ], {
    stomachSensory: { mechanical: 1 },
    duodenum: { nutrientExposure: 1 },
  });
  assert.equal(next.relativeConcentration, 0);
});
