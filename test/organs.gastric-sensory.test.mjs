import test from 'node:test';
import assert from 'node:assert/strict';
import { heartbeat } from '../organs/human-organs/stomach/gastric-sensory.ts';

function round(stomach) {
  let written;
  heartbeat({
    read: (id) => (id === 'stomach' ? stomach : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  return written;
}

test('empty stomach maps to zero', () => {
  assert.equal(round({ volumeMl: 0 }).mechanical, 0);
});

test('reference volume maps to one', () => {
  assert.equal(round({ volumeMl: 1000 }).mechanical, 1);
});

test('half reference maps to 0.5', () => {
  assert.ok(Math.abs(round({ volumeMl: 500 }).mechanical - 0.5) < 1e-12);
});

test('volume above reference clamps to one', () => {
  assert.equal(round({ volumeMl: 2000 }).mechanical, 1);
});

test('missing stomach and NaN volume map to zero', () => {
  assert.equal(round(undefined).mechanical, 0);
  assert.equal(round({ volumeMl: Number.NaN }).mechanical, 0);
  assert.equal(round({ volumeMl: -100 }).mechanical, 0);
});
