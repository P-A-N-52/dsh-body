import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  balanceOxygen,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-compartments/blood-oxygen/oxygen.ts';

const parametersUrl = new URL(
  '../organs/human-compartments/blood-oxygen/oxygen.parameters.json',
  import.meta.url,
);

const BASELINE = {
  oxygenConsumptionMlMin: 250,
  oxygenSupplyMlMin: 250,
  spo2Percent: 97,
  oxygenDeficit: 0,
};

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function round({ activity, duodenum, lungsVentilation, thyroid, blood } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'physicalActivity') return activity;
      if (partId === 'duodenum') return duodenum;
      if (partId === 'lungsVentilation') return lungsVentilation;
      if (partId === 'thyroid') return thyroid;
      if (partId === 'blood') return blood;
      return undefined;
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
  });
  return { written: writes.at(-1), writes };
}

function expectUpstreamError(
  { activity, duodenum, lungsVentilation, thyroid, blood },
  label,
) {
  const writes = [];
  assert.throws(
    () => heartbeat({
      read: (partId) => {
        if (partId === 'physicalActivity') return activity;
        if (partId === 'duodenum') return duodenum;
        if (partId === 'lungsVentilation') return lungsVentilation;
        if (partId === 'thyroid') return thyroid;
        if (partId === 'blood') return blood;
        return undefined;
      },
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { writes.push(next); },
    }),
    Error,
    label,
  );
  assert.equal(writes.length, 0, `${label}: the round must not write`);
}

test('bloodOxygen exports the compartment contract at the resting baseline', () => {
  assert.equal(id, 'bloodOxygen');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    oxygenConsumptionMlMin: { unit: 'mL/min', mode: 'absolute' },
    oxygenSupplyMlMin: { unit: 'mL/min', mode: 'absolute' },
    spo2Percent: { unit: '%', mode: 'absolute' },
    oxygenDeficit: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, BASELINE);
});

test('the blood oxygen parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'bloodOxygen');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), [
    'bloodOxygen.activityGainMlMin',
    'bloodOxygen.basalMlMin',
    'bloodOxygen.baselineSpo2Percent',
    'bloodOxygen.digestionGain',
  ]);
  for (const parameter of data.parameters) {
    assert.equal(parameter.status, 'design', `${parameter.id}: status`);
    assert.equal(parameter.source, null, `${parameter.id}: source`);
  }
  assert.equal(byId['bloodOxygen.basalMlMin'].unit, 'mL/min');
  assert.equal(byId['bloodOxygen.activityGainMlMin'].unit, 'mL/min');
  assert.equal(byId['bloodOxygen.digestionGain'].unit, '1');
  assert.equal(byId['bloodOxygen.baselineSpo2Percent'].unit, '%');

  assert.deepEqual(loadParameters(parametersUrl), {
    'bloodOxygen.activityGainMlMin': 1000,
    'bloodOxygen.basalMlMin': 250,
    'bloodOxygen.baselineSpo2Percent': 97,
    'bloodOxygen.digestionGain': 0.1,
  });
});

test('resting demand is basal plus the digestion term', () => {
  assert.deepEqual(round().written, BASELINE);
  assert.equal(
    round({ duodenum: { nutrientExposure: 0 } }).written.oxygenConsumptionMlMin,
    250,
    'zero exposure adds nothing',
  );
  const digested = round({ duodenum: { nutrientExposure: 0.5 } }).written;
  assert.equal(digested.oxygenConsumptionMlMin, 262.5);
  assert.equal(digested.oxygenSupplyMlMin, 262.5);
  assert.equal(digested.oxygenDeficit, 0);
  assert.equal(digested.spo2Percent, 97);
});

test('thyroid T4 scales basal demand and a missing thyroid keeps the neutral factor', () => {
  assert.equal(round().written.oxygenConsumptionMlMin, 250, 'missing thyroid is neutral');
  assertClose(
    round({ thyroid: { thyroxineRelative: 0 } }).written.oxygenConsumptionMlMin,
    200,
    'T4 0 gives factor 0.8',
  );
  assertClose(
    round({ thyroid: { thyroxineRelative: 0.5 } }).written.oxygenConsumptionMlMin,
    250,
    'T4 0.5 gives factor 1.0',
  );
  assertClose(
    round({ thyroid: { thyroxineRelative: 1 } }).written.oxygenConsumptionMlMin,
    300,
    'T4 1 gives factor 1.2 by the design formula',
  );
  assertClose(
    round({ thyroid: { thyroxineRelative: 2 } }).written.oxygenConsumptionMlMin,
    400,
    'T4 2 gives factor 1.6',
  );
  assertClose(
    round({ thyroid: { thyroxineRelative: 3 } }).written.oxygenConsumptionMlMin,
    500,
    'T4 3 gives factor 2.0',
  );

  const active = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    thyroid: { thyroxineRelative: 2 },
  }).written;
  assertClose(active.oxygenConsumptionMlMin, 1400, 'activity gain is not T4-scaled');
  assertClose(active.oxygenSupplyMlMin, 1400, 'supply follows demand');
  assert.equal(active.spo2Percent, 97);

  const digested = round({
    duodenum: { nutrientExposure: 0.5 },
    thyroid: { thyroxineRelative: 2 },
  }).written;
  assertClose(digested.oxygenConsumptionMlMin, 412.5, 'digestion term stays on basalMlMin');
});

test('T4-scaled demand follows the same capacity and SpO2 logic', () => {
  const capped = round({
    thyroid: { thyroxineRelative: 2 },
    lungsVentilation: { alveolarO2CapacityMlMin: 200 },
  }).written;
  assertClose(capped.oxygenConsumptionMlMin, 400, 'capped demand');
  assertClose(capped.oxygenSupplyMlMin, 200, 'capped supply');
  assertClose(capped.oxygenDeficit, 0.5, 'capped deficit');
  assertClose(capped.spo2Percent, 48.5, 'capped SpO2');

  const adequate = round({
    thyroid: { thyroxineRelative: 2 },
    lungsVentilation: { alveolarO2CapacityMlMin: 9000 },
  }).written;
  assertClose(adequate.oxygenConsumptionMlMin, 400, 'adequate demand');
  assertClose(adequate.oxygenSupplyMlMin, 400, 'adequate supply');
  assert.equal(adequate.oxygenDeficit, 0);
  assert.equal(adequate.spo2Percent, 97);
});

test('activity adds the intensity-scaled oxygen gain only while exercise remains', () => {
  const active = round({ activity: { remainingExerciseMin: 10, intensity: 1 } }).written;
  assert.equal(active.oxygenConsumptionMlMin, 1250);
  assert.equal(active.oxygenSupplyMlMin, 1250);
  assert.equal(active.oxygenDeficit, 0);
  assert.equal(active.spo2Percent, 97);

  assert.equal(
    round({ activity: { remainingExerciseMin: 10, intensity: 0.5 } }).written
      .oxygenConsumptionMlMin,
    750,
  );
  assert.equal(
    round({ activity: { remainingExerciseMin: 0, intensity: 1 } }).written
      .oxygenConsumptionMlMin,
    250,
    'finished exercise adds nothing even if intensity is stale',
  );
  assert.equal(
    round({ activity: { remainingExerciseMin: 10, intensity: 0 } }).written
      .oxygenConsumptionMlMin,
    250,
    'zero intensity adds nothing',
  );

  const combined = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    duodenum: { nutrientExposure: 0.5 },
  }).written;
  assert.equal(combined.oxygenConsumptionMlMin, 1262.5);
});

test('capacity at or above demand keeps SpO2 at baseline and caps supply at demand', () => {
  const adequate = round({
    lungsVentilation: { alveolarO2CapacityMlMin: 9000 },
  }).written;
  assert.deepEqual(adequate, BASELINE);

  const active = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    lungsVentilation: { alveolarO2CapacityMlMin: 9000 },
  }).written;
  assert.deepEqual(active, {
    oxygenConsumptionMlMin: 1250,
    oxygenSupplyMlMin: 1250,
    spo2Percent: 97,
    oxygenDeficit: 0,
  });

  const exact = round({
    lungsVentilation: { alveolarO2CapacityMlMin: 250 },
  }).written;
  assert.deepEqual(exact, BASELINE);
});

test('capacity below demand produces a proportional deficit and SpO2 drop', () => {
  const half = round({ lungsVentilation: { alveolarO2CapacityMlMin: 125 } }).written;
  assert.deepEqual(half, {
    oxygenConsumptionMlMin: 250,
    oxygenSupplyMlMin: 125,
    spo2Percent: 48.5,
    oxygenDeficit: 0.5,
  });

  const cappedAtActivityStart = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    lungsVentilation: { alveolarO2CapacityMlMin: 900 },
  }).written;
  assert.deepEqual(cappedAtActivityStart, {
    oxygenConsumptionMlMin: 1250,
    oxygenSupplyMlMin: 900,
    spo2Percent: 69.84,
    oxygenDeficit: 0.28,
  });

  const activeHalf = round({
    activity: { remainingExerciseMin: 5, intensity: 0.5 },
    lungsVentilation: { alveolarO2CapacityMlMin: 375 },
  }).written;
  assert.equal(activeHalf.oxygenConsumptionMlMin, 750);
  assert.equal(activeHalf.oxygenSupplyMlMin, 375);
  assert.equal(activeHalf.oxygenDeficit, 0.5);
  assert.equal(activeHalf.spo2Percent, 48.5);

  const starved = round({ lungsVentilation: { alveolarO2CapacityMlMin: 0 } }).written;
  assert.equal(starved.oxygenSupplyMlMin, 0);
  assert.equal(starved.oxygenDeficit, 1);
  assert.equal(starved.spo2Percent, 0);
});

test('a lagged low delivery readout does not desaturate at activity start', () => {
  const active = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    blood: {
      oxygenDeliveryMlMin: 970,
      maxOxygenDeliveryMlPerMin: 3666.6,
    },
  }).written;
  assert.deepEqual(active, {
    oxygenConsumptionMlMin: 1250,
    oxygenSupplyMlMin: 1250,
    spo2Percent: 97,
    oxygenDeficit: 0,
  });

  const withVentilation = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    lungsVentilation: { alveolarO2CapacityMlMin: 9000 },
    blood: {
      oxygenDeliveryMlMin: 970,
      maxOxygenDeliveryMlPerMin: 3666.6,
    },
  }).written;
  assert.deepEqual(withVentilation, active);
});

test('maximum oxygen delivery caps supply as a third limit', () => {
  const half = round({ blood: { maxOxygenDeliveryMlPerMin: 125 } }).written;
  assert.deepEqual(half, {
    oxygenConsumptionMlMin: 250,
    oxygenSupplyMlMin: 125,
    spo2Percent: 48.5,
    oxygenDeficit: 0.5,
  });

  const starved = round({ blood: { maxOxygenDeliveryMlPerMin: 0 } }).written;
  assert.equal(starved.oxygenSupplyMlMin, 0);
  assert.equal(starved.oxygenDeficit, 1);
  assert.equal(starved.spo2Percent, 0);

  const ample = round({ blood: { maxOxygenDeliveryMlPerMin: 9000 } }).written;
  assert.deepEqual(ample, BASELINE);

  const active = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    blood: { maxOxygenDeliveryMlPerMin: 900 },
  }).written;
  assert.equal(active.oxygenSupplyMlMin, 900);
  assert.equal(active.oxygenDeficit, 0.28);
  assertClose(active.spo2Percent, 69.84, 'circulation-limited SpO2');
});

test('the tightest of ventilation and circulation caps the supply', () => {
  const ventilationTight = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    lungsVentilation: { alveolarO2CapacityMlMin: 1000 },
    blood: { maxOxygenDeliveryMlPerMin: 2000 },
  }).written;
  assert.equal(ventilationTight.oxygenSupplyMlMin, 1000);
  assertClose(ventilationTight.oxygenDeficit, 0.2, 'ventilation-limited deficit');
  assertClose(ventilationTight.spo2Percent, 77.6, 'ventilation-limited SpO2');

  const circulationTight = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    lungsVentilation: { alveolarO2CapacityMlMin: 5000 },
    blood: { maxOxygenDeliveryMlPerMin: 250 },
  }).written;
  assert.equal(circulationTight.oxygenSupplyMlMin, 250);
  assertClose(circulationTight.oxygenDeficit, 0.8, 'circulation-limited deficit');
  assertClose(circulationTight.spo2Percent, 19.4, 'circulation-limited SpO2');
});

test('a missing blood part keeps the ventilation-only cap', () => {
  const cappedByLungs = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
    lungsVentilation: { alveolarO2CapacityMlMin: 900 },
  }).written;
  assert.equal(cappedByLungs.oxygenSupplyMlMin, 900);
  assert.equal(cappedByLungs.oxygenDeficit, 0.28);

  const uncapped = round({
    activity: { remainingExerciseMin: 10, intensity: 1 },
  }).written;
  assert.equal(uncapped.oxygenSupplyMlMin, 1250);
  assert.equal(uncapped.spo2Percent, 97);
});

test('zero demand is a balanced edge and never produces NaN', () => {
  assert.deepEqual(balanceOxygen(0, 0), { oxygenDeficit: 0, spo2Percent: 97 });
  assert.deepEqual(balanceOxygen(0, 100), { oxygenDeficit: 0, spo2Percent: 97 });
});

test('a missing lungsVentilation means full supply from demand and baseline SpO2', () => {
  for (const written of [
    round().written,
    round({ activity: { remainingExerciseMin: 10, intensity: 1 } }).written,
    round({ duodenum: { nutrientExposure: 0.5 } }).written,
  ]) {
    assert.equal(written.oxygenSupplyMlMin, written.oxygenConsumptionMlMin);
    assert.equal(written.oxygenDeficit, 0);
    assert.equal(written.spo2Percent, 97);
  }
});

test('invalid loaded upstream fields fail the round without writing', () => {
  const invalidActivity = [
    ['empty activity', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining minutes', { intensity: 1 }],
    ['non-finite remaining minutes', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['negative remaining minutes', { remainingExerciseMin: -1, intensity: 1 }],
    ['intensity below zero', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above one', { remainingExerciseMin: 10, intensity: 1.0001 }],
    ['non-numeric intensity', { remainingExerciseMin: 10, intensity: '1' }],
  ];
  for (const [label, activity] of invalidActivity) {
    expectUpstreamError({ activity }, label);
  }

  const invalidDuodenum = [
    ['empty duodenum', {}],
    ['non-finite exposure', { nutrientExposure: Number.NaN }],
    ['infinite exposure', { nutrientExposure: Number.POSITIVE_INFINITY }],
    ['negative exposure', { nutrientExposure: -0.1 }],
    ['non-numeric exposure', { nutrientExposure: '0.5' }],
  ];
  for (const [label, duodenum] of invalidDuodenum) {
    expectUpstreamError({ duodenum }, label);
  }

  const invalidLungs = [
    ['empty lungs ventilation', {}],
    ['old supply readout without capacity', { alveolarO2MlMin: 125 }],
    ['non-finite capacity', { alveolarO2CapacityMlMin: Number.NaN }],
    ['infinite capacity', { alveolarO2CapacityMlMin: Number.POSITIVE_INFINITY }],
    ['negative capacity', { alveolarO2CapacityMlMin: -1 }],
    ['non-numeric capacity', { alveolarO2CapacityMlMin: '9000' }],
  ];
  for (const [label, lungsVentilation] of invalidLungs) {
    expectUpstreamError({ lungsVentilation }, label);
  }

  const invalidThyroid = [
    ['empty thyroid', {}],
    ['NaN T4', { thyroxineRelative: Number.NaN }],
    ['positive infinity T4', { thyroxineRelative: Number.POSITIVE_INFINITY }],
    ['negative infinity T4', { thyroxineRelative: Number.NEGATIVE_INFINITY }],
    ['negative T4', { thyroxineRelative: -0.1 }],
    ['non-numeric T4', { thyroxineRelative: '1' }],
  ];
  for (const [label, thyroid] of invalidThyroid) {
    expectUpstreamError({ thyroid }, label);
  }

  const invalidBlood = [
    ['empty blood', {}],
    ['old delivery readout without capacity', {
      oxygenDeliveryMlMin: 970,
      cardiacOutputMlMin: 5000,
      spo2Percent: 97,
    }],
    ['NaN capacity', { maxOxygenDeliveryMlPerMin: Number.NaN }],
    ['infinite capacity', { maxOxygenDeliveryMlPerMin: Number.POSITIVE_INFINITY }],
    ['negative infinity capacity', { maxOxygenDeliveryMlPerMin: Number.NEGATIVE_INFINITY }],
    ['negative capacity', { maxOxygenDeliveryMlPerMin: -1 }],
    ['non-numeric capacity', { maxOxygenDeliveryMlPerMin: '900' }],
    ['null capacity', { maxOxygenDeliveryMlPerMin: null }],
    ['null blood', null],
    ['non-object blood', 42],
  ];
  for (const [label, blood] of invalidBlood) {
    expectUpstreamError({ blood }, label);
  }
});

test('blood oxygen output is finite and JSON-safe', () => {
  const cases = [
    ['no upstream parts', {}],
    [
      'activity, digestion and adequate capacity',
      {
        activity: { remainingExerciseMin: 10, intensity: 0.37 },
        duodenum: { nutrientExposure: 0.5 },
        lungsVentilation: { alveolarO2CapacityMlMin: 9000 },
        thyroid: { thyroxineRelative: 1.5 },
      },
    ],
    ['high T4 and zero capacity', {
      thyroid: { thyroxineRelative: 2 },
      lungsVentilation: { alveolarO2CapacityMlMin: 0 },
    }],
    [
      'capacity below active demand',
      {
        activity: { remainingExerciseMin: 0.5, intensity: 1 },
        lungsVentilation: { alveolarO2CapacityMlMin: 900 },
      },
    ],
    [
      'circulation below active demand',
      {
        activity: { remainingExerciseMin: 0.5, intensity: 1 },
        blood: { maxOxygenDeliveryMlPerMin: 400 },
      },
    ],
  ];

  for (const [label, input] of cases) {
    const { written, writes } = round(input);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
