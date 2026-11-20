import test from 'node:test';
import assert from 'node:assert/strict';

const organModules = [
  ['stomach', '../organs/human-organs/stomach/motility.ts'],
  ['duodenum', '../organs/human-organs/duodenum/nutrient-exposure.ts'],
];

for (const [expectedId, modulePath] of organModules) {
  test(`${expectedId} exports the organ module contract`, async () => {
    const module = await import(modulePath);
    assert.equal(module.id, expectedId);
    assert.equal(typeof module.heartbeat, 'function');
    assert.ok(module.initialState && typeof module.initialState === 'object');
    assert.ok(module.fields && typeof module.fields === 'object');
    assert.ok(Array.isArray(module.actionTypes));
  });
}

test('duodenum treats a missing or invalid stomach reading as zero exposure', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  for (const stomach of [undefined, { emptiedKcal: -5 }, { emptiedKcal: Number.NaN }]) {
    let written;
    heartbeat({
      read: (id) => (id === 'stomach' ? stomach : undefined),
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { written = next; },
    });
    assert.equal(written.nutrientExposure, 0);
  }
});

test('duodenum filters 10 kcal/min with the 10 min time constant', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  let written;
  heartbeat({
    read: (id) => (id === 'stomach' ? { emptiedKcal: 10 } : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
  });
  assert.ok(Math.abs(written.nutrientExposure - 10 * (1 - Math.exp(-0.1))) < 1e-12);
});
