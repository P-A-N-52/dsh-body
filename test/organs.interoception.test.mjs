import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/interoception.ts';

function round(inputs = {}) {
  const parts = {
    stomachSensory: inputs.sensory,
    stomachGhrelin: inputs.ghrelin,
    duodenum: inputs.duodenum,
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
  });
  assert.deepEqual(initialState, { hunger: 50, fullness: 0 });
});

test('no inputs give the fasting baseline', () => {
  assert.deepEqual(round(), { hunger: 50, fullness: 0 });
});

test('ghrelin at half the fasting baseline lowers hunger and raises fullness', () => {
  assert.deepEqual(
    round({ ghrelin: { relativeConcentration: 0.5 } }),
    { hunger: 25, fullness: 25 },
  );
});

test('full mechanical input raises fullness and lowers hunger', () => {
  assert.deepEqual(
    round({ sensory: { mechanical: 1 } }),
    { hunger: 30, fullness: 100 },
  );
});

test('nutrient exposure at 10 kcal/min saturates fullness and clamps hunger at zero', () => {
  assert.deepEqual(
    round({ duodenum: { nutrientExposure: 10 } }),
    { hunger: 0, fullness: 100 },
  );
});

test('does not read its own previous state', () => {
  let written;
  heartbeat({
    read: (partId) => (partId === 'interoception' ? { hunger: 100, fullness: 100 } : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  assert.deepEqual(written, { hunger: 50, fullness: 0 });
});

test('negative inputs clamp to zero before the gains', () => {
  assert.deepEqual(
    round({
      sensory: { mechanical: -5 },
      ghrelin: { relativeConcentration: -2 },
      duodenum: { nutrientExposure: -3 },
    }),
    { hunger: 0, fullness: 50 },
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
  assert.deepEqual(cases[0], { hunger: 0, fullness: 100 });
  assert.deepEqual(cases[1], { hunger: 100, fullness: 0 });
  assert.deepEqual(cases[2], { hunger: 0, fullness: 100 });
  assert.deepEqual(overflow, { hunger: 0, fullness: 100 });
  for (const next of [...cases, overflow]) {
    assert.ok(Number.isFinite(next.hunger));
    assert.ok(Number.isFinite(next.fullness));
  }
});

test('simultaneous overflow inputs fall back instead of writing NaN', () => {
  const next = round({
    ghrelin: { relativeConcentration: Number.MAX_VALUE },
    duodenum: { nutrientExposure: Number.MAX_VALUE },
  });
  assert.deepEqual(next, { hunger: 50, fullness: 0 });
});

test('NaN and missing readings fall back to 0/1/0 without producing NaN', () => {
  assert.deepEqual(
    round({
      sensory: { mechanical: Number.NaN },
      ghrelin: { relativeConcentration: Number.NaN },
      duodenum: { nutrientExposure: Number.NaN },
    }),
    { hunger: 50, fullness: 0 },
  );
  for (const next of [round({ sensory: {}, ghrelin: {}, duodenum: {} }), round()]) {
    assert.deepEqual(next, { hunger: 50, fullness: 0 });
  }
});
