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
import { loadParameters } from '../lib/parameters.js';

const BASELINE = {
  hunger: 50,
  fullness: 0,
  thirst: 50,
  urinaryUrgency: 0,
  discomfort: 0,
  sexualArousalMm: 0,
};
const parametersUrl = new URL('../organs/human-organs/brain/interoception.parameters.json', import.meta.url);
const parameterValues = loadParameters(parametersUrl);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

function round(inputs = {}) {
  const parts = {
    stomachSensory: inputs.sensory,
    stomachGhrelin: inputs.ghrelin,
    duodenum: inputs.duodenum,
    hypothalamusThirst: inputs.thirst,
    bladder: inputs.bladder,
    uterus: inputs.uterus,
    sexualResponse: inputs.sexualResponse,
  };
  let written;
  heartbeat({
    read: (partId) => parts[partId],
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
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
    { hunger: 25, fullness: 25, thirst: 50, urinaryUrgency: 0, discomfort: 0, sexualArousalMm: 0 },
  );
});

test('full mechanical input raises fullness and lowers hunger', () => {
  assert.deepEqual(
    round({ sensory: { mechanical: 1 } }),
    { hunger: 30, fullness: 100, thirst: 50, urinaryUrgency: 0, discomfort: 100, sexualArousalMm: 0 },
  );
});

test('nutrient exposure at 10 kcal/min saturates fullness and clamps hunger at zero', () => {
  assert.deepEqual(
    round({ duodenum: { nutrientExposure: 10 } }),
    { hunger: 0, fullness: 100, thirst: 50, urinaryUrgency: 0, discomfort: 100, sexualArousalMm: 0 },
  );
});

test('thirst passes through from the hypothalamic drive and clamps to 0-100 mm', () => {
  assert.deepEqual(
    round({ thirst: { thirst: 20 } }),
    { hunger: 50, fullness: 0, thirst: 20, urinaryUrgency: 0, discomfort: 0, sexualArousalMm: 0 },
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

test('uterine cramps enter discomfort as the fifth channel', () => {
  assert.deepEqual(
    round({ uterus: { crampMm: 85 } }),
    { hunger: 50, fullness: 0, thirst: 50, urinaryUrgency: 0, discomfort: 50, sexualArousalMm: 0 },
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
    hunger: 50,
    fullness: 0,
    thirst: 85,
    urinaryUrgency: 50,
    discomfort: 50,
    sexualArousalMm: 0,
  });
  assert.deepEqual(
    { ...withSexual, sexualArousalMm: withoutSexual.sexualArousalMm },
    withoutSexual,
  );
  assert.equal(withSexual.sexualArousalMm, 100);
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
    { hunger: 85, fullness: 85, thirst: 85, urinaryUrgency: 85, discomfort: 50, sexualArousalMm: 0 },
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
    { hunger: 85, fullness: 85, thirst: 100, urinaryUrgency: 85, discomfort: 100, sexualArousalMm: 0 },
  );
});

test('thirst and bladder readings leave hunger and fullness untouched', () => {
  assert.deepEqual(
    round({ thirst: { thirst: 0 }, bladder: { volumeMl: 410 } }),
    { hunger: 50, fullness: 0, thirst: 0, urinaryUrgency: 100, discomfort: 100, sexualArousalMm: 0 },
  );
});

test('does not read its own previous state', () => {
  let written;
  heartbeat({
    read: (partId) => (
      partId === 'interoception'
        ? { hunger: 100, fullness: 100, thirst: 100, urinaryUrgency: 100, discomfort: 100 }
        : undefined
    ),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  assert.deepEqual(written, BASELINE);
});

test('negative inputs clamp to zero before the gains', () => {
  assert.deepEqual(
    round({
      sensory: { mechanical: -5 },
      ghrelin: { relativeConcentration: -2 },
      duodenum: { nutrientExposure: -3 },
    }),
    { hunger: 0, fullness: 50, thirst: 50, urinaryUrgency: 0, discomfort: 0, sexualArousalMm: 0 },
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
  assert.deepEqual(cases[0], { hunger: 0, fullness: 100, thirst: 50, urinaryUrgency: 0, discomfort: 100, sexualArousalMm: 0 });
  assert.deepEqual(cases[1], { hunger: 100, fullness: 0, thirst: 50, urinaryUrgency: 0, discomfort: 100, sexualArousalMm: 0 });
  assert.deepEqual(cases[2], { hunger: 0, fullness: 100, thirst: 50, urinaryUrgency: 0, discomfort: 100, sexualArousalMm: 0 });
  assert.deepEqual(overflow, { hunger: 0, fullness: 100, thirst: 50, urinaryUrgency: 0, discomfort: 100, sexualArousalMm: 0 });
  for (const next of [...cases, overflow]) {
    assert.ok(Number.isFinite(next.hunger));
    assert.ok(Number.isFinite(next.fullness));
    assert.ok(Number.isFinite(next.thirst));
    assert.ok(Number.isFinite(next.urinaryUrgency));
    assert.ok(Number.isFinite(next.discomfort));
    assert.ok(Number.isFinite(next.sexualArousalMm));
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
