import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/interoception.ts';
import { loadParameters, setWorkerParameterConfig } from '../lib/parameters.js';

const BASELINE = {
  hunger: 50,
  fullness: 0,
  thirst: 50,
  urinaryUrgency: 0,
  discomfort: 0,
  sexualArousalMm: 0,
  dyspneaMm: 0,
  stressMm: 0,
  sleepinessMm: 0,
  dryMouthMm: 0,
  libidoMm: 0,
  bowelUrgencyMm: 0,
  heatMm: 0,
  coldMm: 0,
  hypocalcemiaMm: 0,
  hypercalcemiaMm: 0,
  hypoglycemiaMm: 0,
  palpitationMm: 0,
  sweatDampMm: 0,
  muscleFatigueMm: 0,
  uterineCrampMm: 0,
};
const parametersUrl = new URL('../organs/human-organs/brain/interoception.parameters.json', import.meta.url);
const parameterValues = loadParameters(parametersUrl);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

function round(inputs = {}) {
  const parts = {
    interoception: inputs.interoception,
    stomachSensory: inputs.sensory,
    stomachGhrelin: inputs.ghrelin,
    duodenum: inputs.duodenum,
    hypothalamusThirst: inputs.thirst,
    bladder: inputs.bladder,
    uterus: inputs.uterus,
    sexualResponse: inputs.sexualResponse,
    bloodOxygen: inputs.bloodOxygen,
    adrenal: inputs.adrenal,
    pineal: inputs.pineal,
    sleep: inputs.sleep,
    salivaryGlands: inputs.salivaryGlands,
    mammaryGlands: inputs.mammaryGlands,
    testes: inputs.testes,
    thermoregulation: inputs.thermoregulation,
    bloodCalcium: inputs.bloodCalcium,
    esophagus: inputs.esophagus,
    colon: inputs.colon,
    glucose: inputs.glucose,
    heart: inputs.heart,
    blood: inputs.blood,
    physicalActivity: inputs.physicalActivity,
    skin: inputs.skin,
    muscleHead: inputs.muscleHead,
    muscleTrunk: inputs.muscleTrunk,
    muscleLimbs: inputs.muscleLimbs,
  };
  let written;
  heartbeat({
    read: (partId) => parts[partId],
    actions: [],
    dt: inputs.dt ?? 60,
    simulatedSeconds: inputs.simulatedSeconds ?? 60,
    write: (next) => { written = next; },
  });
  return written;
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('interoception exports the organ module contract', () => {
  assert.equal(id, 'interoception');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    hunger: { unit: 'mm', mode: 'absolute' },
    fullness: { unit: 'mm', mode: 'absolute' },
    thirst: { unit: 'mm', mode: 'absolute' },
    urinaryUrgency: { unit: 'mm', mode: 'absolute' },
    discomfort: { unit: 'mm', mode: 'absolute' },
    sexualArousalMm: { unit: 'mm', mode: 'absolute' },
    dyspneaMm: { unit: 'mm', mode: 'absolute' },
    stressMm: { unit: 'mm', mode: 'absolute' },
    sleepinessMm: { unit: 'mm', mode: 'absolute' },
    dryMouthMm: { unit: 'mm', mode: 'absolute' },
    libidoMm: { unit: 'mm', mode: 'absolute' },
    bowelUrgencyMm: { unit: 'mm', mode: 'absolute' },
    heatMm: { unit: 'mm', mode: 'absolute' },
    coldMm: { unit: 'mm', mode: 'absolute' },
    hypocalcemiaMm: { unit: 'mm', mode: 'absolute' },
    hypercalcemiaMm: { unit: 'mm', mode: 'absolute' },
    hypoglycemiaMm: { unit: 'mm', mode: 'absolute' },
    palpitationMm: { unit: 'mm', mode: 'absolute' },
    sweatDampMm: { unit: 'mm', mode: 'absolute' },
    muscleFatigueMm: { unit: 'mm', mode: 'absolute' },
    uterineCrampMm: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(initialState, BASELINE);
});

test('no inputs give the fasting baseline and no thirst or bladder drive', () => {
  assert.deepEqual(round(), BASELINE);
});

test('the thirst fallback is a design parameter and drives the fallback output', () => {
  const fallback = parameterValues['interoception.thirst.fallbackMm'];
  const entry = parameterFile.parameters.find(
    (parameter) => parameter.id === 'interoception.thirst.fallbackMm',
  );
  assert.equal(fallback, 50);
  assert.equal(entry?.status, 'design');
  assert.equal(entry?.source, null);
  assert.equal(initialState.thirst, fallback);
  assert.equal(round().thirst, fallback);
  assert.equal(round({ thirst: { thirst: Number.NaN } }).thirst, fallback);
});

test('the discomfort onset is a 70 mm design parameter with no source', () => {
  const onset = parameterValues['interoception.discomfort.onsetMm'];
  const entry = parameterFile.parameters.find(
    (parameter) => parameter.id === 'interoception.discomfort.onsetMm',
  );
  assert.equal(onset, 70);
  assert.equal(entry?.unit, 'mm');
  assert.equal(entry?.status, 'design');
  assert.equal(entry?.source, null);
  assert.deepEqual(fields.discomfort, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.discomfort, 0);
});

test('ghrelin at half the fasting baseline lowers hunger and raises fullness', () => {
  assert.deepEqual(
    round({ ghrelin: { relativeConcentration: 0.5 } }),
    { ...BASELINE, hunger: 25, fullness: 25 },
  );
});

test('full mechanical input raises fullness and lowers hunger', () => {
  assert.deepEqual(
    round({ sensory: { mechanical: 1 } }),
    { ...BASELINE, hunger: 30, fullness: 100, discomfort: 100 },
  );
});

test('nutrient exposure at 10 kcal/min saturates fullness and clamps hunger at zero', () => {
  assert.deepEqual(
    round({ duodenum: { nutrientExposure: 10 } }),
    { ...BASELINE, hunger: 0, fullness: 100, discomfort: 100 },
  );
});

test('thirst passes through from the hypothalamic drive and clamps to 0-100 mm', () => {
  assert.deepEqual(
    round({ thirst: { thirst: 20 } }),
    { ...BASELINE, thirst: 20 },
  );
  assert.equal(round({ thirst: { thirst: -5 } }).thirst, 0);
  assert.equal(round({ thirst: { thirst: 250 } }).thirst, 100);
  assert.equal(round({ thirst: { thirst: 250 } }).discomfort, 100);
});

test('urinary urgency scales bladder volume against the 410 mL design anchor', () => {
  assert.equal(round({ bladder: { volumeMl: 0 } }).urinaryUrgency, 0);
  assert.equal(round({ bladder: { volumeMl: 205 } }).urinaryUrgency, 50);
  assert.equal(round({ bladder: { volumeMl: 410 } }).urinaryUrgency, 100);
  assert.equal(round({ bladder: { volumeMl: 820 } }).urinaryUrgency, 100);
  assert.equal(round({ bladder: { volumeMl: -30 } }).urinaryUrgency, 0);
});

test('urinary urgency saturates after 410 mL, so discomfort saturates there too', () => {
  assert.equal(round({ bladder: { volumeMl: 410 } }).discomfort, 100);
  assert.equal(round({ bladder: { volumeMl: 820 } }).discomfort, 100);
});

test('discomfort stays at zero at and below the 70 mm onset', () => {
  assert.equal(round({ thirst: { thirst: 70 } }).discomfort, 0);
  assert.equal(round({ thirst: { thirst: 65 } }).discomfort, 0);
  assert.equal(round({ bladder: { volumeMl: 287 } }).discomfort, 0);
  assert.equal(round({ sensory: { mechanical: 0.7 } }).discomfort, 0);
  assert.equal(round({ ghrelin: { relativeConcentration: 1.4 } }).discomfort, 0);
});

test('each feeling at 85 mm yields 50 discomfort', () => {
  assert.equal(round({ ghrelin: { relativeConcentration: 1.7 } }).hunger, 85);
  assert.equal(round({ ghrelin: { relativeConcentration: 1.7 } }).discomfort, 50);
  assert.equal(round({ sensory: { mechanical: 0.85 } }).fullness, 85);
  assert.equal(round({ sensory: { mechanical: 0.85 } }).discomfort, 50);
  assert.equal(round({ thirst: { thirst: 85 } }).discomfort, 50);
  assert.equal(round({ bladder: { volumeMl: 348.5 } }).urinaryUrgency, 85);
  assert.equal(round({ bladder: { volumeMl: 348.5 } }).discomfort, 50);
});

test('uterine cramps enter discomfort as the fifth channel and expose uterineCrampMm', () => {
  assert.deepEqual(
    round({ uterus: { crampMm: 85 } }),
    { ...BASELINE, discomfort: 50, uterineCrampMm: 85 },
  );
  assert.equal(round({ uterus: { crampMm: 70 } }).discomfort, 0);
  assert.equal(round({ uterus: { crampMm: 100 } }).discomfort, 100);
  assert.equal(round({ uterus: { crampMm: -20 } }).discomfort, 0);
  assert.equal(round({ uterus: { crampMm: 250 } }).discomfort, 100);
  assert.equal(round({ thirst: { thirst: 100 }, uterus: { crampMm: 85 } }).discomfort, 100);
});

test('missing, NaN or non-finite crampMm counts as zero', () => {
  for (const uterus of [
    {},
    { crampMm: Number.NaN },
    { crampMm: Number.POSITIVE_INFINITY },
    { crampMm: Number.NEGATIVE_INFINITY },
  ]) {
    assert.deepEqual(round({ uterus }), BASELINE);
  }
});

test('the fifth channel is inert without a uterus part', () => {
  assert.deepEqual(round(), round({ uterus: { crampMm: 0 } }));
  assert.deepEqual(
    round({ thirst: { thirst: 85 } }),
    round({ thirst: { thirst: 85 }, uterus: { crampMm: 0 } }),
  );
  assert.deepEqual(round({ uterus: undefined }), BASELINE);
});

test('esophageal choking enters discomfort as a soft read', () => {
  assert.equal(round({ esophagus: { chokingMm: 85 } }).discomfort, 50);
  assert.equal(round({ esophagus: { chokingMm: 70 } }).discomfort, 0);
  assert.equal(round({ esophagus: { chokingMm: 100 } }).discomfort, 100);
  assert.equal(round({ esophagus: { chokingMm: -20 } }).discomfort, 0);
  assert.equal(round({ esophagus: { chokingMm: 250 } }).discomfort, 100);
  assert.equal(round({ thirst: { thirst: 100 }, esophagus: { chokingMm: 85 } }).discomfort, 100);
});

test('missing, NaN or non-finite chokingMm counts as zero', () => {
  for (const esophagus of [
    undefined,
    {},
    { chokingMm: Number.NaN },
    { chokingMm: Number.POSITIVE_INFINITY },
    { chokingMm: Number.NEGATIVE_INFINITY },
  ]) {
    assert.deepEqual(round({ esophagus }), BASELINE);
  }
});

test('mammary fullness enters discomfort as the sixth channel', () => {
  assert.equal(round({ mammaryGlands: { fullnessMm: 85 } }).discomfort, 50);
  assert.equal(round({ mammaryGlands: { fullnessMm: 70 } }).discomfort, 0);
  assert.equal(round({ mammaryGlands: { fullnessMm: 65 } }).discomfort, 0);
  assert.equal(round({ mammaryGlands: { fullnessMm: 100 } }).discomfort, 100);
  assert.equal(round({ mammaryGlands: { fullnessMm: -20 } }).discomfort, 0);
  assert.equal(round({ mammaryGlands: { fullnessMm: 250 } }).discomfort, 100);
  assert.equal(
    round({ mammaryGlands: { fullnessMm: 100 } }).fullness,
    0,
    'gastric fullness is a separate readout',
  );
  assert.equal(
    round({ thirst: { thirst: 100 }, mammaryGlands: { fullnessMm: 85 } }).discomfort,
    100,
  );
});

test('missing, NaN or non-finite mammary fullness counts as zero', () => {
  for (const mammaryGlands of [
    undefined,
    {},
    { fullnessMm: Number.NaN },
    { fullnessMm: Number.POSITIVE_INFINITY },
    { fullnessMm: Number.NEGATIVE_INFINITY },
  ]) {
    assert.deepEqual(round({ mammaryGlands }), BASELINE);
  }
});

test('the sixth channel is inert without mammary glands', () => {
  assert.deepEqual(round(), round({ mammaryGlands: { fullnessMm: 0 } }));
  assert.deepEqual(
    round({ thirst: { thirst: 85 } }),
    round({ thirst: { thirst: 85 }, mammaryGlands: { fullnessMm: 0 } }),
  );
});

test('sexual arousal is a 0-100 mm readout with a zero baseline', () => {
  assert.deepEqual(fields.sexualArousalMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.sexualArousalMm, 0);
  assert.equal(round().sexualArousalMm, 0);
});

test('sexualResponse arousalMm passes through as sexualArousalMm', () => {
  assert.deepEqual(
    round({ sexualResponse: { arousalMm: 72 } }),
    { ...BASELINE, sexualArousalMm: 72 },
  );
  assert.equal(round({ sexualResponse: { arousalMm: 0 } }).sexualArousalMm, 0);
});

test('missing, missing field, NaN or non-finite sexual arousal counts as zero', () => {
  for (const sexualResponse of [
    undefined,
    {},
    { arousalMm: Number.NaN },
    { arousalMm: Number.POSITIVE_INFINITY },
    { arousalMm: Number.NEGATIVE_INFINITY },
  ]) {
    assert.deepEqual(round({ sexualResponse }), BASELINE);
  }
});

test('sexual arousal clamps to 0-100 and never enters discomfort', () => {
  assert.equal(round({ sexualResponse: { arousalMm: -5 } }).sexualArousalMm, 0);
  assert.equal(round({ sexualResponse: { arousalMm: 250 } }).sexualArousalMm, 100);
  for (const arousalMm of [72, 85, 100]) {
    const next = round({ sexualResponse: { arousalMm } });
    assert.equal(next.sexualArousalMm, arousalMm);
    assert.equal(next.discomfort, 0);
  }
});

test('sexual arousal leaves the legacy five channels point-identical', () => {
  const withoutSexual = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    uterus: { crampMm: 85 },
  });
  const withSexual = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    uterus: { crampMm: 85 },
    sexualResponse: { arousalMm: 100 },
  });
  assert.deepEqual(withoutSexual, {
    ...BASELINE,
    thirst: 85,
    urinaryUrgency: 50,
    discomfort: 50,
    uterineCrampMm: 85,
  });
  assert.deepEqual(
    { ...withSexual, sexualArousalMm: withoutSexual.sexualArousalMm },
    withoutSexual,
  );
  assert.equal(withSexual.sexualArousalMm, 100);
});

test('libido is a 0-100 mm readout with a zero baseline', () => {
  assert.deepEqual(fields.libidoMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.libidoMm, 0);
  assert.equal(round().libidoMm, 0);
});

test('round-start testosterone drives libidoMm and clamps to 0-100', () => {
  assert.equal(round({ testes: { testosteroneRelative: 0.3 } }).libidoMm, 0);
  assert.equal(round({ testes: { testosteroneRelative: 0.5 } }).libidoMm, 0);
  assert.equal(round({ testes: { testosteroneRelative: 1 } }).libidoMm, 50);
  assertClose(
    round({ testes: { testosteroneRelative: 1.2 } }).libidoMm,
    70,
    'testosterone 1.2',
  );
  assert.equal(round({ testes: { testosteroneRelative: 1.5 } }).libidoMm, 100);
  assert.equal(round({ testes: { testosteroneRelative: 2 } }).libidoMm, 100);
  assert.equal(round({ testes: { testosteroneRelative: -1 } }).libidoMm, 0);
});

test('missing, missing field, NaN or non-finite testosterone counts as zero libido', () => {
  for (const testes of [
    undefined,
    {},
    { testosteroneRelative: Number.NaN },
    { testosteroneRelative: Number.POSITIVE_INFINITY },
    { testosteroneRelative: Number.NEGATIVE_INFINITY },
    { testosteroneRelative: '1' },
  ]) {
    assert.equal(round({ testes }).libidoMm, 0, String(testes));
  }
});

test('libido is a readout: other readings and discomfort stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const withLibido = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    testes: { testosteroneRelative: 2 },
  });
  assert.equal(withLibido.libidoMm, 100);
  assert.equal(withLibido.discomfort, baseline.discomfort);
  assert.deepEqual({ ...withLibido, libidoMm: baseline.libidoMm }, baseline);
});

test('blood oxygen deficit drives a 0-100 mm dyspnea readout', () => {
  assert.deepEqual(fields.dyspneaMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.dyspneaMm, 0);
  assert.equal(round().dyspneaMm, 0);
  assert.equal(round({ bloodOxygen: { oxygenDeficit: 0.2 } }).dyspneaMm, 20);
  assert.equal(round({ bloodOxygen: { oxygenDeficit: 1 } }).dyspneaMm, 100);
  assert.equal(round({ bloodOxygen: { oxygenDeficit: 1.5 } }).dyspneaMm, 100);
  assert.equal(round({ bloodOxygen: { oxygenDeficit: -0.2 } }).dyspneaMm, 0);
  assert.equal(round({ bloodOxygen: { oxygenDeficit: 1 } }).discomfort, 0);
});

test('missing, missing field, NaN or non-finite oxygen deficit counts as zero dyspnea', () => {
  for (const bloodOxygen of [
    undefined,
    {},
    { oxygenDeficit: Number.NaN },
    { oxygenDeficit: Number.POSITIVE_INFINITY },
    { oxygenDeficit: Number.NEGATIVE_INFINITY },
  ]) {
    assert.deepEqual(round({ bloodOxygen }), BASELINE);
  }
});

test('dyspnea is a readout: other readings and discomfort stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const withDeficit = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    bloodOxygen: { oxygenDeficit: 1 },
  });
  assert.equal(withDeficit.dyspneaMm, 100);
  assert.equal(withDeficit.discomfort, baseline.discomfort);
  assert.deepEqual({ ...withDeficit, dyspneaMm: 0 }, baseline);
});

test('discomfort takes the strongest feeling instead of summing them', () => {
  const allAt85 = round({
    sensory: { mechanical: 1 },
    ghrelin: { relativeConcentration: 2.9 },
    duodenum: { nutrientExposure: 8 },
    thirst: { thirst: 85 },
    bladder: { volumeMl: 348.5 },
  });
  assert.deepEqual(
    allAt85,
    { ...BASELINE, hunger: 85, fullness: 85, thirst: 85, urinaryUrgency: 85, discomfort: 50 },
  );

  const oneAt100 = round({
    sensory: { mechanical: 1 },
    ghrelin: { relativeConcentration: 2.9 },
    duodenum: { nutrientExposure: 8 },
    thirst: { thirst: 100 },
    bladder: { volumeMl: 348.5 },
  });
  assert.deepEqual(
    oneAt100,
    { ...BASELINE, hunger: 85, fullness: 85, thirst: 100, urinaryUrgency: 85, discomfort: 100 },
  );
});

test('thirst and bladder readings leave hunger and fullness untouched', () => {
  assert.deepEqual(
    round({ thirst: { thirst: 0 }, bladder: { volumeMl: 410 } }),
    { ...BASELINE, thirst: 0, urinaryUrgency: 100, discomfort: 100 },
  );
});

test('core temperature drives heat and cold readouts with a zero baseline', () => {
  assert.deepEqual(fields.heatMm, { unit: 'mm', mode: 'absolute' });
  assert.deepEqual(fields.coldMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.heatMm, 0);
  assert.equal(initialState.coldMm, 0);
  assert.equal(round().heatMm, 0);
  assert.equal(round().coldMm, 0);
});

test('hot core temperatures raise heatMm and clamp at 100', () => {
  assert.equal(round({ thermoregulation: { coreTemperatureC: 37 } }).heatMm, 0);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 38 } }).heatMm, 50);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 38.5 } }).heatMm, 75);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 39 } }).heatMm, 100);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 40 } }).heatMm, 100);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 36 } }).heatMm, 0);
});

test('cold core temperatures raise coldMm and clamp at 100', () => {
  assert.equal(round({ thermoregulation: { coreTemperatureC: 37 } }).coldMm, 0);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 36 } }).coldMm, 50);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 35.5 } }).coldMm, 75);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 35 } }).coldMm, 100);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 30 } }).coldMm, 100);
  assert.equal(round({ thermoregulation: { coreTemperatureC: 38 } }).coldMm, 0);
});

test('missing or invalid thermoregulation counts as zero heat and cold', () => {
  for (const thermoregulation of [
    undefined,
    null,
    {},
    { coreTemperatureC: null },
    { coreTemperatureC: Number.NaN },
    { coreTemperatureC: Number.POSITIVE_INFINITY },
    { coreTemperatureC: Number.NEGATIVE_INFINITY },
    { coreTemperatureC: '38' },
    42,
  ]) {
    const next = round({ thermoregulation });
    assert.equal(next.heatMm, 0, String(thermoregulation));
    assert.equal(next.coldMm, 0, String(thermoregulation));
    assert.deepEqual(next, BASELINE);
  }
});

test('heat and cold are readouts: discomfort and other readings stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const hot = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    thermoregulation: { coreTemperatureC: 40 },
  });
  const cold = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    thermoregulation: { coreTemperatureC: 34 },
  });
  assert.equal(hot.heatMm, 100);
  assert.equal(cold.coldMm, 100);
  assert.equal(hot.discomfort, baseline.discomfort);
  assert.equal(cold.discomfort, baseline.discomfort);
  assert.deepEqual({ ...hot, heatMm: 0, coldMm: 0 }, baseline);
  assert.deepEqual({ ...cold, heatMm: 0, coldMm: 0 }, baseline);
});

test('memoryless readouts stay independent of previous interoception while sweatDampMm and muscleFatigueMm decay', () => {
  let written;
  heartbeat({
    read: (partId) => (
      partId === 'interoception'
        ? {
          hunger: 100,
          fullness: 100,
          thirst: 100,
          urinaryUrgency: 100,
          discomfort: 100,
          sexualArousalMm: 100,
          dyspneaMm: 100,
          stressMm: 100,
          sleepinessMm: 100,
          dryMouthMm: 100,
          libidoMm: 100,
          bowelUrgencyMm: 100,
          heatMm: 100,
          coldMm: 100,
          hypocalcemiaMm: 100,
          hypercalcemiaMm: 100,
          hypoglycemiaMm: 100,
          palpitationMm: 100,
          uterineCrampMm: 100,
          sweatDampMm: 80,
          muscleFatigueMm: 80,
        }
        : undefined
    ),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  const expectedSweat = 80 * Math.pow(0.5, 1 / 20);
  const expectedFatigue = 80 * Math.pow(0.5, 1 / 30);
  assertClose(written.sweatDampMm, expectedSweat, 'sweatDampMm 20-min half-time decay');
  assertClose(written.muscleFatigueMm, expectedFatigue, 'muscleFatigueMm 30-min half-time decay');
  assert.deepEqual(
    { ...written, sweatDampMm: 0, muscleFatigueMm: 0 },
    BASELINE,
  );
});

test('negative inputs clamp to zero before the gains', () => {
  assert.deepEqual(
    round({
      sensory: { mechanical: -5 },
      ghrelin: { relativeConcentration: -2 },
      duodenum: { nutrientExposure: -3 },
    }),
    { ...BASELINE, hunger: 0, fullness: 50 },
  );
});

test('oversized inputs clamp outputs to the 0-100 band and stay finite', () => {
  const cases = [
    round({
      sensory: { mechanical: 5 },
      ghrelin: { relativeConcentration: 10 },
      duodenum: { nutrientExposure: 1e9 },
    }),
    round({ ghrelin: { relativeConcentration: 10 } }),
    round({ duodenum: { nutrientExposure: 1e9 } }),
  ];
  const overflow = round({ duodenum: { nutrientExposure: Number.MAX_VALUE } });
  assert.deepEqual(cases[0], { ...BASELINE, hunger: 0, fullness: 100, discomfort: 100 });
  assert.deepEqual(cases[1], { ...BASELINE, hunger: 100, fullness: 0, discomfort: 100 });
  assert.deepEqual(cases[2], { ...BASELINE, hunger: 0, fullness: 100, discomfort: 100 });
  assert.deepEqual(overflow, { ...BASELINE, hunger: 0, fullness: 100, discomfort: 100 });
  for (const next of [...cases, overflow]) {
    assert.ok(Number.isFinite(next.hunger));
    assert.ok(Number.isFinite(next.fullness));
    assert.ok(Number.isFinite(next.thirst));
    assert.ok(Number.isFinite(next.urinaryUrgency));
    assert.ok(Number.isFinite(next.discomfort));
    assert.ok(Number.isFinite(next.sexualArousalMm));
    assert.ok(Number.isFinite(next.dyspneaMm));
  }
});

test('simultaneous overflow inputs fall back instead of writing NaN', () => {
  const next = round({
    ghrelin: { relativeConcentration: Number.MAX_VALUE },
    duodenum: { nutrientExposure: Number.MAX_VALUE },
  });
  assert.deepEqual(next, BASELINE);
});

test('NaN and missing readings fall back without producing NaN', () => {
  assert.deepEqual(
    round({
      sensory: { mechanical: Number.NaN },
      ghrelin: { relativeConcentration: Number.NaN },
      duodenum: { nutrientExposure: Number.NaN },
      thirst: { thirst: Number.NaN },
      bladder: { volumeMl: Number.NaN },
      adrenal: { cortisolRelative: Number.NaN },
      pineal: { melatoninRelative: Number.NaN },
    }),
    BASELINE,
  );
  for (const next of [
    round({ sensory: {}, ghrelin: {}, duodenum: {}, thirst: {}, bladder: {} }),
    round(),
  ]) {
    assert.deepEqual(next, BASELINE);
  }
});

test('stress and sleepiness are 0-100 mm readouts with a zero baseline', () => {
  assert.deepEqual(fields.stressMm, { unit: 'mm', mode: 'absolute' });
  assert.deepEqual(fields.sleepinessMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.stressMm, 0);
  assert.equal(initialState.sleepinessMm, 0);
  assert.equal(round().stressMm, 0);
  assert.equal(round().sleepinessMm, 0);
});

test('cortisol above the relative baseline drives stressMm and clamps at 0-100', () => {
  assert.equal(round({ adrenal: { cortisolRelative: 0.5 } }).stressMm, 0);
  assert.equal(round({ adrenal: { cortisolRelative: 1 } }).stressMm, 0);
  assert.equal(round({ adrenal: { cortisolRelative: 2 } }).stressMm, 50);
  assert.equal(round({ adrenal: { cortisolRelative: 3 } }).stressMm, 100);
  assert.equal(round({ adrenal: { cortisolRelative: 4 } }).stressMm, 100);
});

test('melatonin above the 0.2 trough drives sleepinessMm and clamps at 0-100', () => {
  assert.equal(round({ pineal: { melatoninRelative: 0 } }).sleepinessMm, 0);
  assert.equal(round({ pineal: { melatoninRelative: 0.2 } }).sleepinessMm, 0);
  assertClose(
    round({ pineal: { melatoninRelative: 1 } }).sleepinessMm,
    50,
    'relative concentration 1',
  );
  assertClose(
    round({ pineal: { melatoninRelative: 1.8 } }).sleepinessMm,
    100,
    '02:00 peak',
  );
  assert.equal(round({ pineal: { melatoninRelative: 2 } }).sleepinessMm, 100);
});

test('missing, missing field, NaN or non-finite adrenal and pineal readings count as zero', () => {
  for (const adrenal of [
    undefined,
    {},
    { cortisolRelative: Number.NaN },
    { cortisolRelative: Number.POSITIVE_INFINITY },
    { cortisolRelative: Number.NEGATIVE_INFINITY },
  ]) {
    assert.equal(round({ adrenal }).stressMm, 0, `adrenal ${String(adrenal)}`);
  }
  for (const pineal of [
    undefined,
    {},
    { melatoninRelative: Number.NaN },
    { melatoninRelative: Number.POSITIVE_INFINITY },
    { melatoninRelative: Number.NEGATIVE_INFINITY },
  ]) {
    assert.equal(round({ pineal }).sleepinessMm, 0, `pineal ${String(pineal)}`);
  }
});

test('stress and sleepiness are readouts: other readings and discomfort stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const withAxes = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    adrenal: { cortisolRelative: 3 },
    pineal: { melatoninRelative: 1.8 },
  });
  assert.equal(withAxes.stressMm, 100);
  assertClose(withAxes.sleepinessMm, 100, 'sleepiness at the melatonin peak');
  assert.equal(withAxes.discomfort, baseline.discomfort);
  assert.deepEqual(
    { ...withAxes, stressMm: 0, sleepinessMm: 0 },
    baseline,
  );
});

test('dry mouth is a 0-100 mm readout with a zero baseline', () => {
  assert.deepEqual(fields.dryMouthMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.dryMouthMm, 0);
  assert.equal(round().dryMouthMm, 0);
});

test('salivary mouth moisture drives dry mouth and clamps to 0-100 mm', () => {
  assert.equal(round({ salivaryGlands: { mouthMoistureMm: 100 } }).dryMouthMm, 0);
  assert.equal(round({ salivaryGlands: { mouthMoistureMm: 40 } }).dryMouthMm, 60);
  assert.equal(round({ salivaryGlands: { mouthMoistureMm: 0 } }).dryMouthMm, 100);
  assert.equal(round({ salivaryGlands: { mouthMoistureMm: 250 } }).dryMouthMm, 0);
  assert.equal(round({ salivaryGlands: { mouthMoistureMm: -20 } }).dryMouthMm, 100);
});

test('missing, missing field, NaN or non-finite mouth moisture counts as zero dry mouth', () => {
  for (const salivaryGlands of [
    undefined,
    {},
    { mouthMoistureMm: Number.NaN },
    { mouthMoistureMm: Number.POSITIVE_INFINITY },
    { mouthMoistureMm: Number.NEGATIVE_INFINITY },
  ]) {
    assert.equal(round({ salivaryGlands }).dryMouthMm, 0, String(salivaryGlands));
  }
});

test('dry mouth is a readout: other readings and discomfort stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const withDryMouth = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    salivaryGlands: { mouthMoistureMm: 0 },
  });
  assert.equal(withDryMouth.dryMouthMm, 100);
  assert.equal(withDryMouth.discomfort, baseline.discomfort);
  assert.deepEqual(
    { ...withDryMouth, dryMouthMm: baseline.dryMouthMm },
    baseline,
  );
});

test('colon bowelUrgencyMm is preferred when finite, falling back to stool mass when absent', () => {
  assert.deepEqual(fields.bowelUrgencyMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.bowelUrgencyMm, 0);
  assert.equal(round().bowelUrgencyMm, 0);
  assert.equal(round({ colon: { bowelUrgencyMm: 42, stoolG: 0 } }).bowelUrgencyMm, 42);
  assert.equal(round({ colon: { bowelUrgencyMm: -10, stoolG: 100 } }).bowelUrgencyMm, 0);
  assert.equal(round({ colon: { bowelUrgencyMm: 150, stoolG: 0 } }).bowelUrgencyMm, 100);
  assert.equal(round({ colon: { bowelUrgencyMm: Number.NaN, stoolG: 100 } }).bowelUrgencyMm, 50);
  assert.equal(round({ colon: { stoolG: 0 } }).bowelUrgencyMm, 0);
  assert.equal(round({ colon: { stoolG: 100 } }).bowelUrgencyMm, 50);
  assert.equal(round({ colon: { stoolG: 200 } }).bowelUrgencyMm, 100);
  assert.equal(round({ colon: { stoolG: 400 } }).bowelUrgencyMm, 100);
  assert.equal(round({ colon: { stoolG: -20 } }).bowelUrgencyMm, 0);
});

test('missing, missing field, NaN or non-finite stool mass counts as zero bowel urgency', () => {
  for (const colon of [
    undefined,
    {},
    { stoolG: Number.NaN },
    { stoolG: Number.POSITIVE_INFINITY },
    { stoolG: Number.NEGATIVE_INFINITY },
    { stoolG: '100' },
  ]) {
    assert.equal(round({ colon }).bowelUrgencyMm, 0, String(colon));
  }
});

test('bowel urgency is a readout: other readings and discomfort stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const withBowelUrgency = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    colon: { stoolG: 200 },
  });
  assert.equal(withBowelUrgency.bowelUrgencyMm, 100);
  assert.equal(withBowelUrgency.discomfort, baseline.discomfort);
  assert.deepEqual(
    { ...withBowelUrgency, bowelUrgencyMm: baseline.bowelUrgencyMm },
    baseline,
  );
});

test('blood calcium drives hypocalcemia and hypercalcemia readouts with a zero baseline', () => {
  assert.deepEqual(fields.hypocalcemiaMm, { unit: 'mm', mode: 'absolute' });
  assert.deepEqual(fields.hypercalcemiaMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.hypocalcemiaMm, 0);
  assert.equal(initialState.hypercalcemiaMm, 0);
  assert.equal(round().hypocalcemiaMm, 0);
  assert.equal(round().hypercalcemiaMm, 0);
  assert.equal(round({ bloodCalcium: { mgDl: 9.5 } }).hypocalcemiaMm, 0);
  assert.equal(round({ bloodCalcium: { mgDl: 9.5 } }).hypercalcemiaMm, 0);
});

test('low blood calcium raises hypocalcemiaMm and clamps at 100', () => {
  assert.equal(round({ bloodCalcium: { mgDl: 9 } }).hypocalcemiaMm, 25);
  assert.equal(round({ bloodCalcium: { mgDl: 8 } }).hypocalcemiaMm, 75);
  assert.equal(round({ bloodCalcium: { mgDl: 7.5 } }).hypocalcemiaMm, 100);
  assert.equal(round({ bloodCalcium: { mgDl: 5 } }).hypocalcemiaMm, 100);
  assert.equal(round({ bloodCalcium: { mgDl: 8 } }).hypercalcemiaMm, 0);
});

test('high blood calcium raises hypercalcemiaMm and clamps at 100', () => {
  assert.equal(round({ bloodCalcium: { mgDl: 10 } }).hypercalcemiaMm, 25);
  assert.equal(round({ bloodCalcium: { mgDl: 11 } }).hypercalcemiaMm, 75);
  assert.equal(round({ bloodCalcium: { mgDl: 11.5 } }).hypercalcemiaMm, 100);
  assert.equal(round({ bloodCalcium: { mgDl: 14 } }).hypercalcemiaMm, 100);
  assert.equal(round({ bloodCalcium: { mgDl: 11 } }).hypocalcemiaMm, 0);
});

test('missing, missing field, NaN or non-finite blood calcium counts as zero readouts', () => {
  for (const bloodCalcium of [
    undefined,
    null,
    {},
    { mgDl: null },
    { mgDl: Number.NaN },
    { mgDl: Number.POSITIVE_INFINITY },
    { mgDl: Number.NEGATIVE_INFINITY },
    { mgDl: '8' },
    42,
  ]) {
    const next = round({ bloodCalcium });
    assert.equal(next.hypocalcemiaMm, 0, String(bloodCalcium));
    assert.equal(next.hypercalcemiaMm, 0, String(bloodCalcium));
    assert.deepEqual(next, BASELINE);
  }
});

test('calcium readouts do not enter discomfort and other readings stay point-identical', () => {
  const baseline = round({ thirst: { thirst: 85 }, bladder: { volumeMl: 205 } });
  const low = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    bloodCalcium: { mgDl: 8 },
  });
  const high = round({
    thirst: { thirst: 85 },
    bladder: { volumeMl: 205 },
    bloodCalcium: { mgDl: 11 },
  });
  assert.equal(low.hypocalcemiaMm, 75);
  assert.equal(high.hypercalcemiaMm, 75);
  assert.equal(low.discomfort, baseline.discomfort);
  assert.equal(high.discomfort, baseline.discomfort);
  assert.deepEqual({ ...low, hypocalcemiaMm: 0, hypercalcemiaMm: 0 }, baseline);
  assert.deepEqual({ ...high, hypocalcemiaMm: 0, hypercalcemiaMm: 0 }, baseline);
});

test('interoception aggregates extensible organ discomfortMm and sensations without breaking legacy snapshots', () => {
  let written;
  heartbeat({
    read(partId) {
      if (partId === undefined) {
        return {
          simulatedSeconds: 60,
          parts: {
            interoception: BASELINE,
            wings: {
              discomfortMm: 85,
              sensations: {
                wingStrain: {
                  intensityMm: 90,
                  discomfort: true,
                  contextText: '翅膀有些发酸。',
                  wakeText: '翅膀传来明显的牵拉刺痛感。',
                },
                featherRuffle: {
                  intensityMm: 30,
                },
              },
            },
          },
        };
      }
      return undefined;
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });

  assertClose(written.discomfort, (100 * (90 - 70)) / 30, 'extensible discomfort');
  assert.deepEqual(written.sensations, {
    'wings.wingStrain': {
      intensityMm: 90,
      contextText: '翅膀有些发酸。',
      wakeText: '翅膀传来明显的牵拉刺痛感。',
    },
    'wings.featherRuffle': {
      intensityMm: 30,
    },
  });
});

test('hypoglycemiaMm scales below 75 mg/dL and ignores invalid glucose readings', () => {
  assert.deepEqual(fields.hypoglycemiaMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.hypoglycemiaMm, 0);
  assert.equal(round({ glucose: { concentrationMgDl: 90 } }).hypoglycemiaMm, 0);
  assert.equal(round({ glucose: { concentrationMgDl: 75 } }).hypoglycemiaMm, 0);
  assert.equal(round({ glucose: { concentrationMgDl: 60 } }).hypoglycemiaMm, 60);
  assert.equal(round({ glucose: { concentrationMgDl: 53.75 } }).hypoglycemiaMm, 85);
  assert.equal(round({ glucose: { concentrationMgDl: 50 } }).hypoglycemiaMm, 100);
  assert.equal(round({ glucose: { concentrationMgDl: 25 } }).hypoglycemiaMm, 100);
  assert.equal(round({ glucose: { concentrationMgDl: 40 } }).discomfort, 0);

  for (const glucose of [
    undefined,
    null,
    {},
    { concentrationMgDl: Number.NaN },
    { concentrationMgDl: Number.POSITIVE_INFINITY },
    { concentrationMgDl: '60' },
  ]) {
    assert.equal(round({ glucose }).hypoglycemiaMm, 0);
  }
});

test('palpitationMm suppresses exercise tachycardia while preserving resting tachycardia and hypotension triggers', () => {
  assert.deepEqual(fields.palpitationMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.palpitationMm, 0);

  // Resting tachycardia above 115 bpm
  assert.equal(round({ heart: { heartRatePerMin: 115 } }).palpitationMm, 0);
  assert.equal(round({ heart: { heartRatePerMin: 135 } }).palpitationMm, 30);
  assert.equal(round({ heart: { heartRatePerMin: 185 } }).palpitationMm, 100);

  // Exercise tachycardia (intensity >= 0.2 and remainingExerciseMin > 0) suppresses HR component
  assert.equal(
    round({
      heart: { heartRatePerMin: 165 },
      blood: { systolicMmHg: 120 },
      physicalActivity: { remainingExerciseMin: 15, intensity: 0.5 },
    }).palpitationMm,
    0,
  );

  // Low-intensity or expired exercise does not suppress resting tachycardia
  assert.equal(
    round({
      heart: { heartRatePerMin: 135 },
      physicalActivity: { remainingExerciseMin: 15, intensity: 0.19 },
    }).palpitationMm,
    30,
  );
  assert.equal(
    round({
      heart: { heartRatePerMin: 135 },
      physicalActivity: { remainingExerciseMin: 0, intensity: 0.8 },
    }).palpitationMm,
    30,
  );

  // Hypotension (< 95 mmHg) triggers palpitationMm even during moderate/vigorous exercise
  assert.equal(round({ blood: { systolicMmHg: 95 } }).palpitationMm, 0);
  assert.equal(round({ blood: { systolicMmHg: 85 } }).palpitationMm, 50);
  assert.equal(round({ blood: { systolicMmHg: 75 } }).palpitationMm, 100);
  assert.equal(
    round({
      heart: { heartRatePerMin: 165 },
      blood: { systolicMmHg: 83 },
      physicalActivity: { remainingExerciseMin: 10, intensity: 0.6 },
    }).palpitationMm,
    60,
  );

  // Takes max(hrPart, bpPart)
  assert.equal(
    round({
      heart: { heartRatePerMin: 135 },
      blood: { systolicMmHg: 85 },
    }).palpitationMm,
    50,
  );
});

test('sweatDampMm builds up from sweat volume and decays with a 20-minute half-time', () => {
  assert.deepEqual(fields.sweatDampMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.sweatDampMm, 0);

  // Buildup: rate * 4 * dtMin = 4 * sweatVolumeMl
  assert.equal(round({ skin: { sweatVolumeMl: 5 }, dt: 60 }).sweatDampMm, 20);
  assert.equal(round({ skin: { sweatVolumeMl: 5 }, dt: 300 }).sweatDampMm, 20);
  assert.equal(round({ skin: { sweatVolumeMl: 40 }, dt: 60 }).sweatDampMm, 100);

  // 20-minute half-time decay with zero new sweat
  assertClose(
    round({
      interoception: { sweatDampMm: 80 },
      skin: { sweatVolumeMl: 0 },
      dt: 20 * 60,
    }).sweatDampMm,
    40,
    '20-min half-time decay',
  );

  // Combined decay + new sweat
  assertClose(
    round({
      interoception: { sweatDampMm: 40 },
      skin: { sweatVolumeMl: 5 },
      dt: 20 * 60,
    }).sweatDampMm,
    40,
    '20 + 20 combined',
  );
});

test('muscleFatigueMm builds up with exercise, decays with 30-min half-time, and tracks weight-scaled regional glycogen depletion', (t) => {
  t.after(() => setWorkerParameterConfig());
  assert.deepEqual(fields.muscleFatigueMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.muscleFatigueMm, 0);

  // Buildup during exercise: 2.1 * intensity * dtMin
  assertClose(
    round({
      physicalActivity: { remainingExerciseMin: 10, intensity: 0.8 },
      dt: 600,
    }).muscleFatigueMm,
    16.8,
    '10-min exercise fatigue buildup',
  );

  // 30-min half-time decay at rest
  assertClose(
    round({
      interoception: { muscleFatigueMm: 80 },
      physicalActivity: { remainingExerciseMin: 0, intensity: 0 },
      dt: 30 * 60,
    }).muscleFatigueMm,
    40,
    '30-min half-time recovery',
  );

  // Default 75 kg regional baselines (15 + 135 + 150 = 300 g): 50% depletion adds 25 mm
  assert.equal(
    round({
      muscleHead: { glycogenG: 15 },
      muscleTrunk: { glycogenG: 135 },
      muscleLimbs: { glycogenG: 150 },
    }).muscleFatigueMm,
    0,
  );
  assert.equal(
    round({
      muscleHead: { glycogenG: 7.5 },
      muscleTrunk: { glycogenG: 67.5 },
      muscleLimbs: { glycogenG: 75 },
    }).muscleFatigueMm,
    25,
  );

  // Partial manifest without muscleLimbs: only loaded regions (15 + 135 = 150 g) count toward baseline
  assert.equal(
    round({
      muscleHead: { glycogenG: 15 },
      muscleTrunk: { glycogenG: 135 },
    }).muscleFatigueMm,
    0,
  );
  assert.equal(
    round({
      muscleHead: { glycogenG: 7.5 },
      muscleTrunk: { glycogenG: 67.5 },
    }).muscleFatigueMm,
    25,
  );

  // scaleByBodyWeight at 50 kg (2/3 of 75 kg -> baselines 10, 90, 100 = 200 g total)
  setWorkerParameterConfig({ profile: { weightKg: 50, heightCm: 165 } });
  assert.equal(
    round({
      muscleHead: { glycogenG: 10 },
      muscleTrunk: { glycogenG: 90 },
      muscleLimbs: { glycogenG: 100 },
    }).muscleFatigueMm,
    0,
  );
  assert.equal(
    round({
      muscleHead: { glycogenG: 5 },
      muscleTrunk: { glycogenG: 45 },
      muscleLimbs: { glycogenG: 50 },
    }).muscleFatigueMm,
    25,
  );
});

test('uterineCrampMm exposes clamped uterus.crampMm and handles missing or invalid values', () => {
  assert.deepEqual(fields.uterineCrampMm, { unit: 'mm', mode: 'absolute' });
  assert.equal(initialState.uterineCrampMm, 0);
  assert.equal(round({ uterus: { crampMm: 45 } }).uterineCrampMm, 45);
  assert.equal(round({ uterus: { crampMm: -10 } }).uterineCrampMm, 0);
  assert.equal(round({ uterus: { crampMm: 140 } }).uterineCrampMm, 100);
  assert.equal(round({ uterus: { crampMm: Number.NaN } }).uterineCrampMm, 0);
});

test('sleepinessMm uses pure pineal when sleep is absent and blends when sleep is present', () => {
  // Without sleep: pure pineal (melatoninRelative 1.0 -> 50 mm)
  assertClose(
    round({ pineal: { melatoninRelative: 1 } }).sleepinessMm,
    50,
    'sleep absent uses pure pineal',
  );

  // With sleep and pineal: 0.4 * melatoninMm + 0.8 * sleepPressureMm
  assertClose(
    round({
      pineal: { melatoninRelative: 1 },
      sleep: { sleeping: false, sleepPressureMm: 50 },
    }).sleepinessMm,
    0.4 * 50 + 0.8 * 50,
    'sleep + pineal blended',
  );

  // With sleep and no pineal: pure sleepPressureMm
  assert.equal(
    round({
      sleep: { sleeping: false, sleepPressureMm: 72 },
    }).sleepinessMm,
    72,
  );
});

test('getNsfwSetting hides sexualArousalMm, libidoMm, and mammary fullness from discomfort when false while preserving choking discomfort', (t) => {
  t.after(() => setWorkerParameterConfig());

  setWorkerParameterConfig({ nsfw: false });
  const hidden = round({
    sexualResponse: { arousalMm: 90 },
    testes: { testosteroneRelative: 1.5 },
    mammaryGlands: { fullnessMm: 95 },
  });
  assert.equal(hidden.sexualArousalMm, 0);
  assert.equal(hidden.libidoMm, 0);
  assert.equal(hidden.discomfort, 0);

  // Choking still feeds discomfort even when nsfw is false
  const choked = round({
    sexualResponse: { arousalMm: 90 },
    mammaryGlands: { fullnessMm: 95 },
    esophagus: { chokingMm: 85 },
  });
  assert.equal(choked.sexualArousalMm, 0);
  assert.equal(choked.discomfort, 50);

  setWorkerParameterConfig({ nsfw: true });
  const shown = round({
    sexualResponse: { arousalMm: 90 },
    testes: { testosteroneRelative: 1.5 },
    mammaryGlands: { fullnessMm: 85 },
  });
  assert.equal(shown.sexualArousalMm, 90);
  assert.equal(shown.libidoMm, 100);
  assert.equal(shown.discomfort, 50);
});
