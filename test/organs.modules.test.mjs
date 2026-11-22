import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const organModules = [
  ['legacy stomach motility', 'stomach', '../organs/human-organs/stomach/motility.ts'],
  ['stomach hydration', 'stomach', '../organs/human-organs/stomach/hydration.ts'],
  ['stomach ghrelin', 'stomachGhrelin', '../organs/human-organs/stomach/ghrelin.ts'],
  ['gastric sensory', 'stomachSensory', '../organs/human-organs/stomach/gastric-sensory.ts'],
  ['duodenum', 'duodenum', '../organs/human-organs/duodenum/nutrient-exposure.ts'],
  ['small intestine', 'smallIntestine', '../organs/human-organs/small-intestine/water-absorption.ts'],
  ['body fluid', 'bodyFluid', '../organs/human-compartments/body-water/water.ts'],
  ['hypothalamus ADH', 'hypothalamusAdh', '../organs/human-organs/brain/hypothalamus-adh.ts'],
  ['hypothalamus thirst', 'hypothalamusThirst', '../organs/human-organs/brain/hypothalamus-thirst.ts'],
  ['kidney', 'kidney', '../organs/human-organs/kidney/urine-production.ts'],
  ['bladder', 'bladder', '../organs/human-organs/bladder/storage.ts'],
  ['interoception', 'interoception', '../organs/human-organs/brain/interoception.ts'],
  ['brain notify', 'brainNotify', '../organs/human-organs/brain/notify.ts'],
  ['hypothalamus ADH central DI', 'hypothalamusAdh', '../organs/human-organs/brain/hypothalamus-adh-di-central.ts'],
  ['kidney central DI', 'kidney', '../organs/human-organs/kidney/urine-production-di-central.ts'],
  ['kidney nephrogenic DI', 'kidney', '../organs/human-organs/kidney/urine-production-di-nephrogenic.ts'],
];

for (const [label, expectedId, modulePath] of organModules) {
  test(`${label} exports the organ module contract`, async () => {
    const module = await import(modulePath);
    assert.equal(module.id, expectedId);
    assert.equal(typeof module.heartbeat, 'function');
    assert.ok(module.initialState && typeof module.initialState === 'object');
    assert.ok(module.fields && typeof module.fields === 'object');
    assert.ok(Array.isArray(module.actionTypes));
  });
}

test('the root manifest lists twelve scripts with hydration instead of legacy motility', () => {
  const manifest = JSON.parse(readFileSync(new URL('../body-modules.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.length, 12);
  assert.ok(manifest.scripts.includes('./organs/human-organs/stomach/hydration.ts'));
  assert.equal(manifest.scripts.includes('./organs/human-organs/stomach/motility.ts'), false);
});

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
