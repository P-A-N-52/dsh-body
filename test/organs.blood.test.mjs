import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-compartments/blood/blood.ts';

const parametersUrl = new URL(
  '../organs/human-compartments/blood/blood.parameters.json',
  import.meta.url,
);

function heartAt(cardiacOutputMlMin) {
  return { cardiacOutputMlMin };
}

function oxygenAt(spo2Percent) {
  return { spo2Percent };
}

function round({ state, heart, bloodOxygen, bodyFluid, sink = [] } = {}) {
  heartbeat({
    read: (partId) => {
      if (partId === 'blood') return state;
      if (partId === 'heart') return heart;
      if (partId === 'bloodOxygen') return bloodOxygen;
      if (partId === 'bodyFluid') return bodyFluid;
      return undefined;
    },
    write: (next) => { sink.push(next); },
  });
  return { written: sink[sink.length - 1], writes: sink };
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function expectedSystolic(cardiacOutputMlMin) {
  return clamp(
    120 * (cardiacOutputMlMin / 4900) ** 0.5,
    80,
    200,
  );
}

function expectedDiastolic(cardiacOutputMlMin) {
  return clamp(
    80 * (cardiacOutputMlMin / 4900) ** 0.3,
    40,
    120,
  );
}

test('blood exports the compartment contract without actions', () => {
  assert.equal(id, 'blood');
  assert.equal(typeof heartbeat, 'function');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    bloodVolumeMl: { unit: 'mL', mode: 'absolute' },
    cardiacOutputMlMin: { unit: 'mL/min', mode: 'absolute' },
    systolicMmHg: { unit: 'mmHg', mode: 'absolute' },
    diastolicMmHg: { unit: 'mmHg', mode: 'absolute' },
    oxygenDeliveryMlMin: { unit: 'mL/min', mode: 'absolute' },
    maxOxygenDeliveryMlPerMin: { unit: 'mL/min', mode: 'absolute' },
    gfrMlMin: { unit: 'mL/min', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    bloodVolumeMl: 5000,
    cardiacOutputMlMin: 4900,
    systolicMmHg: 120,
    diastolicMmHg: 80,
    oxygenDeliveryMlMin: 4900 * (97 * 2) / 1000,
    maxOxygenDeliveryMlPerMin: 3666.6,
    gfrMlMin: 100,
  });

  const resting = round({ state: initialState });
  assert.equal(resting.writes.length, 1);
  assert.deepEqual(Object.keys(resting.written).sort(), Object.keys(fields).sort());
});

test('the blood parameters are design defaults with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'blood');

  const expected = {
    'blood.referenceBloodVolumeMl': { value: 5000, unit: 'mL' },
    'blood.baselineSystolicMmHg': { value: 120, unit: 'mmHg' },
    'blood.baselineDiastolicMmHg': { value: 80, unit: 'mmHg' },
    'blood.baselineGfrMlMin': { value: 100, unit: 'mL/min' },
    'blood.oxygenContentPerPercentMlPerL': { value: 2, unit: 'mL/L/%' },
  };
  assert.deepEqual(
    data.parameters.map((parameter) => parameter.id),
    Object.keys(expected),
  );

  for (const [parameterId, { value, unit }] of Object.entries(expected)) {
    const parameter = data.parameters.find((entry) => entry.id === parameterId);
    assert.ok(parameter, `${parameterId} must be declared`);
    assert.equal(parameter.value, value, `${parameterId}: value`);
    assert.equal(parameter.unit, unit, `${parameterId}: unit`);
    assert.equal(parameter.status, 'design', `${parameterId}: status`);
    assert.equal(parameter.source, null, `${parameterId}: source`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expected).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('a missing heart falls back to the 4900 mL/min reference output', () => {
  const { written } = round({
    state: initialState,
    bloodOxygen: oxygenAt(97),
  });

  assert.equal(written.cardiacOutputMlMin, 4900);
  assert.equal(written.systolicMmHg, 120);
  assert.equal(written.diastolicMmHg, 80);
  assert.equal(written.oxygenDeliveryMlMin, 4900 * (97 * 2) / 1000);
  assert.equal(written.gfrMlMin, 100);
});

test('a missing bloodOxygen falls back to 97% saturation', () => {
  const { written } = round({
    state: initialState,
    heart: heartAt(10000),
  });

  assert.equal(written.oxygenDeliveryMlMin, 10000 * (97 * 2) / 1000);
  assert.equal(written.maxOxygenDeliveryMlPerMin, 3666.6);
});

test('the compartment reads round-start heart output', () => {
  for (const cardiacOutputMlMin of [4900, 8000, 12345.5]) {
    const { written } = round({
      state: initialState,
      heart: heartAt(cardiacOutputMlMin),
      bloodOxygen: oxygenAt(97),
    });
    assert.equal(written.cardiacOutputMlMin, cardiacOutputMlMin);
  }
});

test('oxygen delivery is cardiac output multiplied by arterial content', () => {
  const cases = [
    ['baseline', 5000, 97],
    ['resting heart', 4900, 97],
    ['exercise', 15925, 97],
    ['desaturation', 5000, 50],
    ['zero output', 0, 97],
    ['maximal activity', 18900, 90],
  ];

  for (const [label, cardiacOutputMlMin, spo2Percent] of cases) {
    const { written } = round({
      state: initialState,
      heart: heartAt(cardiacOutputMlMin),
      bloodOxygen: oxygenAt(spo2Percent),
    });
    assertClose(
      written.oxygenDeliveryMlMin,
      cardiacOutputMlMin * (spo2Percent * 2) / 1000,
      label,
    );
  }
});

test('maximum oxygen delivery is the cardiac capacity at maximum drive', () => {
  const maxDrive = 1 + 1.5 + 0.5 * (3 - 1);
  const expectedBaseline = 180 * 70 * (1 + 0.2 * (maxDrive - 1)) * (97 * 2) / 1000;
  assertClose(expectedBaseline, 3666.6, 'design value');

  for (const cardiacOutputMlMin of [0, 4900, 18900]) {
    const { written } = round({
      state: initialState,
      heart: heartAt(cardiacOutputMlMin),
      bloodOxygen: oxygenAt(97),
    });
    assertClose(
      written.maxOxygenDeliveryMlPerMin,
      expectedBaseline,
      `independent of current output ${cardiacOutputMlMin}`,
    );
  }

  const desaturated = round({
    state: initialState,
    heart: heartAt(4900),
    bloodOxygen: oxygenAt(50),
  }).written;
  assertClose(
    desaturated.maxOxygenDeliveryMlPerMin,
    180 * 70 * 1.5 * (50 * 2) / 1000,
    'scales with round-start saturation',
  );

  const resting = round({
    state: initialState,
    heart: heartAt(4900),
    bloodOxygen: oxygenAt(97),
  }).written;
  assert.ok(
    resting.maxOxygenDeliveryMlPerMin > resting.oxygenDeliveryMlMin,
    'capacity exceeds the lagged rest delivery',
  );
});

test('systolic and diastolic are power proxies of cardiac output with clamps', () => {
  const cases = [
    ['baseline', 4900],
    ['half output', 2450],
    ['low output', 1225],
    ['very low output', 100],
    ['high output', 10000],
    ['very high output', 20000],
  ];

  for (const [label, cardiacOutputMlMin] of cases) {
    const { written } = round({
      state: initialState,
      heart: heartAt(cardiacOutputMlMin),
      bloodOxygen: oxygenAt(97),
    });
    assertClose(
      written.systolicMmHg,
      expectedSystolic(cardiacOutputMlMin),
      `${label}: systolic`,
    );
    assertClose(
      written.diastolicMmHg,
      expectedDiastolic(cardiacOutputMlMin),
      `${label}: diastolic`,
    );
  }

  const exercise = round({
    state: initialState,
    heart: heartAt(15925),
    bloodOxygen: oxygenAt(97),
  }).written;
  const resting = round({
    state: initialState,
    heart: heartAt(4900),
    bloodOxygen: oxygenAt(97),
  }).written;
  assert.equal(resting.systolicMmHg, 120);
  assert.equal(resting.diastolicMmHg, 80);
  assert.ok(exercise.systolicMmHg > resting.systolicMmHg, 'systolic rises with output');
  assert.ok(exercise.diastolicMmHg > resting.diastolicMmHg, 'diastolic rises with output');

  assert.equal(round({
    state: initialState,
    heart: heartAt(20000),
    bloodOxygen: oxygenAt(97),
  }).written.systolicMmHg, 200, 'systolic upper clamp');
  assert.equal(round({
    state: initialState,
    heart: heartAt(20000),
    bloodOxygen: oxygenAt(97),
  }).written.diastolicMmHg, 120, 'diastolic upper clamp');
  assert.equal(round({
    state: initialState,
    heart: heartAt(100),
    bloodOxygen: oxygenAt(97),
  }).written.systolicMmHg, 80, 'systolic lower clamp');
  assert.equal(round({
    state: initialState,
    heart: heartAt(100),
    bloodOxygen: oxygenAt(97),
  }).written.diastolicMmHg, 40, 'diastolic lower clamp');
});

test('GFR scales with blood volume between the 0.5 and 1.2 clamps', () => {
  const cases = [
    ['reference', 5000, 100],
    ['moderate loss', 4200, 84],
    ['loss', 3000, 60],
    ['half volume', 2500, 50],
    ['severe loss', 1000, 50],
    ['expansion', 7000, 120],
    ['large expansion', 12000, 120],
  ];

  for (const [label, bloodVolumeMl, expectedGfr] of cases) {
    const { written } = round({
      state: { ...initialState, bloodVolumeMl },
      heart: heartAt(5000),
      bloodOxygen: oxygenAt(97),
    });
    assertClose(written.gfrMlMin, expectedGfr, label);
    assert.equal(written.bloodVolumeMl, bloodVolumeMl, `${label}: volume persists`);
  }
});

test('a missing blood state starts from the reference volume', () => {
  const { written } = round({
    heart: heartAt(4900),
    bloodOxygen: oxygenAt(97),
  });

  assert.equal(written.bloodVolumeMl, 5000);
  assert.equal(written.gfrMlMin, 100);
});

test('bodyFluid waterVolumeMl couples bloodVolumeMl within [2500, 6000] when present', () => {
  const normal = round({ state: initialState, bodyFluid: { waterVolumeMl: 30000 } }).written;
  assert.equal(normal.bloodVolumeMl, 5000);

  const dehydrated = round({ state: initialState, bodyFluid: { waterVolumeMl: 21000 } }).written;
  assert.equal(dehydrated.bloodVolumeMl, 3500);
  assert.equal(dehydrated.gfrMlMin, 70);

  const lowClamp = round({ state: initialState, bodyFluid: { waterVolumeMl: 5000 } }).written;
  assert.equal(lowClamp.bloodVolumeMl, 2500);

  const highClamp = round({ state: initialState, bodyFluid: { waterVolumeMl: 50000 } }).written;
  assert.equal(highClamp.bloodVolumeMl, 6000);

  for (const bodyFluid of [{}, { waterVolumeMl: -1 }, { waterVolumeMl: Number.NaN }]) {
    const sink = [];
    assert.throws(() => round({ state: initialState, bodyFluid, sink }), /bodyFluid/);
    assert.equal(sink.length, 0);
  }
});

test('a loaded heart with an invalid output fails the round without writes', () => {
  const invalid = [
    ['empty part', {}],
    ['missing output', { other: 1 }],
    ['NaN output', heartAt(Number.NaN)],
    ['infinite output', heartAt(Number.POSITIVE_INFINITY)],
    ['negative infinite output', heartAt(Number.NEGATIVE_INFINITY)],
    ['negative output', heartAt(-1)],
    ['null output', { cardiacOutputMlMin: null }],
    ['string output', heartAt('5000')],
  ];

  for (const [label, heart] of invalid) {
    const sink = [];
    assert.throws(
      () => round({ state: initialState, heart, bloodOxygen: oxygenAt(97), sink }),
      Error,
      label,
    );
    assert.equal(sink.length, 0, `${label}: the round must not write`);
  }
});

test('a loaded bloodOxygen with an invalid saturation fails the round without writes', () => {
  const invalid = [
    ['empty part', {}],
    ['missing saturation', { other: 1 }],
    ['NaN saturation', oxygenAt(Number.NaN)],
    ['infinite saturation', oxygenAt(Number.POSITIVE_INFINITY)],
    ['negative saturation', oxygenAt(-0.1)],
    ['null saturation', { spo2Percent: null }],
    ['string saturation', oxygenAt('97')],
  ];

  for (const [label, bloodOxygen] of invalid) {
    const sink = [];
    assert.throws(
      () => round({ state: initialState, heart: heartAt(5000), bloodOxygen, sink }),
      Error,
      label,
    );
    assert.equal(sink.length, 0, `${label}: the round must not write`);
  }
});

test('blood output is finite and JSON-safe', () => {
  const cases = [
    { label: 'missing upstream', options: {} },
    { label: 'saved initial state', options: { state: initialState } },
    {
      label: 'exercise',
      options: {
        state: initialState,
        heart: heartAt(15925),
        bloodOxygen: oxygenAt(97),
      },
    },
    {
      label: 'low volume',
      options: {
        state: { ...initialState, bloodVolumeMl: 1500 },
        heart: heartAt(3000),
        bloodOxygen: oxygenAt(80),
      },
    },
    {
      label: 'zero output',
      options: {
        state: { ...initialState, bloodVolumeMl: 0 },
        heart: heartAt(0),
        bloodOxygen: oxygenAt(0),
      },
    },
    {
      label: 'high output',
      options: {
        state: { ...initialState, bloodVolumeMl: 9000 },
        heart: heartAt(50000),
        bloodOxygen: oxygenAt(100),
      },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${label}: ${field} must be finite`);
    }
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
  }
});
