import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const organModules = [
  ['legacy stomach motility', 'stomach', '../organs/human-organs/stomach/motility.ts'],
  ['esophagus', 'esophagus', '../organs/human-organs/esophagus/esophagus.ts'],
  ['stomach hydration', 'stomach', '../organs/human-organs/stomach/hydration.ts'],
  ['stomach ghrelin', 'stomachGhrelin', '../organs/human-organs/stomach/ghrelin.ts'],
  ['gastric sensory', 'stomachSensory', '../organs/human-organs/stomach/gastric-sensory.ts'],
  ['duodenum', 'duodenum', '../organs/human-organs/duodenum/nutrient-exposure.ts'],
  ['salivary glands', 'salivaryGlands', '../organs/human-organs/salivary-glands/saliva.ts'],
  ['small intestine', 'smallIntestine', '../organs/human-organs/small-intestine/water-absorption.ts'],
    ['body fluid', 'bodyFluid', '../organs/human-compartments/body-water/water.ts'],
  ['heart', 'heart', '../organs/human-organs/heart/heart.ts'],
  ['blood', 'blood', '../organs/human-compartments/blood/blood.ts'],
  ['blood oxygen', 'bloodOxygen', '../organs/human-compartments/blood-oxygen/oxygen.ts'],
  ['glucose', 'glucose', '../organs/human-compartments/glucose/glucose.ts'],
  ['liver', 'liver', '../organs/human-organs/liver/glycogen.ts'],
  ['kidney gluconeogenesis', 'kidneyGluconeogenesis', '../organs/human-organs/kidney/gluconeogenesis.ts'],
  ['pancreas endocrine', 'pancreasEndocrine', '../organs/human-organs/pancreas/insulin.ts'],
  ['kidney glucose', 'kidneyGlucose', '../organs/human-organs/kidney/glucose-excretion.ts'],
  ['hypothalamus ADH', 'hypothalamusAdh', '../organs/human-organs/brain/hypothalamus-adh.ts'],
  ['hypothalamus thirst', 'hypothalamusThirst', '../organs/human-organs/brain/hypothalamus-thirst.ts'],
  ['hypothalamus endocrine', 'hypothalamusEndocrine', '../organs/human-organs/brain/hypothalamus-endocrine.ts'],
  ['pituitary', 'pituitary', '../organs/human-organs/brain/pituitary.ts'],
  ['thyroid', 'thyroid', '../organs/human-organs/thyroid/thyroid.ts'],
  ['adrenal', 'adrenal', '../organs/human-organs/adrenal/cortisol.ts'],
  ['pineal', 'pineal', '../organs/human-organs/pineal/melatonin.ts'],
  ['kidney', 'kidney', '../organs/human-organs/kidney/urine-production.ts'],
  ['bladder', 'bladder', '../organs/human-organs/bladder/storage.ts'],
  ['interoception', 'interoception', '../organs/human-organs/brain/interoception.ts'],
  ['thermoregulation', 'thermoregulation', '../organs/human-organs/brain/thermoregulation.ts'],
  ['brain notify', 'brainNotify', '../organs/human-organs/brain/notify.ts'],
  ['skeletal muscle activity', 'physicalActivity', '../organs/human-organs/skeletal-muscle/activity.ts'],
  ['skeletal muscle glucose uptake', 'muscleGlucose', '../organs/human-organs/skeletal-muscle/glucose-uptake.ts'],
  ['skeletal muscle head region', 'muscleHead', '../organs/human-organs/skeletal-muscle/regions/head.ts'],
  ['skeletal muscle trunk region', 'muscleTrunk', '../organs/human-organs/skeletal-muscle/regions/trunk.ts'],
  ['skeletal muscle limb region', 'muscleLimbs', '../organs/human-organs/skeletal-muscle/regions/limbs.ts'],
  ['mammary glands', 'mammaryGlands', '../organs/human-organs/mammary-glands/milk.ts'],
  ['testes', 'testes', '../organs/human-organs/testes/testosterone.ts'],
  ['epididymis', 'epididymis', '../organs/human-organs/epididymis/storage.ts'],
  ['sexual response', 'sexualResponse', '../organs/human-organs/sexual-response/response.ts'],
  ['skin sweat', 'skin', '../organs/human-organs/skin/sweat.ts'],
  ['lungs respiratory water loss', 'lungs', '../organs/human-organs/lungs/respiratory-water-loss.ts'],
  ['lungs ventilation', 'lungsVentilation', '../organs/human-organs/lungs/ventilation.ts'],
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

test('the root manifest lists thirty-eight scripts with the bowel slice, activity, sweat, lung water loss, circulation, thermoregulation, liver glycogen, renal gluconeogenesis, the endocrine axes and salivary glands', () => {
  const manifest = JSON.parse(readFileSync(new URL('../body-modules.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.length, 38);
  assert.ok(manifest.scripts.includes('./organs/human-organs/esophagus/esophagus.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/colon/colon.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/stomach/hydration.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-compartments/glucose/glucose.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/liver/glycogen.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/kidney/gluconeogenesis.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/pancreas/insulin.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/kidney/glucose-excretion.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/activity.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/glucose-uptake.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/regions/head.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/regions/trunk.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/regions/limbs.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/sexual-response/response.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skin/sweat.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/lungs/respiratory-water-loss.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/heart/heart.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-compartments/blood/blood.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-compartments/blood-oxygen/oxygen.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/lungs/ventilation.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/brain/thermoregulation.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/brain/hypothalamus-endocrine.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/brain/pituitary.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/thyroid/thyroid.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/adrenal/cortisol.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/pineal/melatonin.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/salivary-glands/saliva.ts'));
  assert.equal(manifest.scripts.includes('./organs/human-organs/stomach/motility.ts'), false);
  assert.equal(manifest.scripts.includes('./organs/human-organs/mammary-glands/milk.ts'), false);
  assert.equal(manifest.scripts.includes('./organs/human-organs/testes/testosterone.ts'), false);
  assert.equal(manifest.scripts.includes('./organs/human-organs/epididymis/storage.ts'), false);
});

test('the female manifest lists forty-one scripts with the glucose variant and mammary glands', () => {
  const manifest = JSON.parse(readFileSync(new URL('../body-modules.female.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.length, 41);
  assert.ok(manifest.scripts.includes('./organs/human-compartments/glucose/glucose.female.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/kidney/gluconeogenesis.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/regions/head.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/regions/trunk.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/skeletal-muscle/regions/limbs.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/mammary-glands/milk.ts'));
  assert.equal(manifest.scripts.includes('./organs/human-compartments/glucose/glucose.ts'), false);
});

test('the male manifest adds only testes and epididymis to the root list', () => {
  const rootManifest = JSON.parse(readFileSync(new URL('../body-modules.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../body-modules.male.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.length, 40);
  assert.equal(manifest.scripts.length, rootManifest.scripts.length + 2);
  assert.ok(manifest.scripts.includes('./organs/human-organs/testes/testosterone.ts'));
  assert.ok(manifest.scripts.includes('./organs/human-organs/epididymis/storage.ts'));
  assert.deepEqual(
    manifest.scripts.filter((entry) => !rootManifest.scripts.includes(entry)).sort(),
    [
      './organs/human-organs/epididymis/storage.ts',
      './organs/human-organs/testes/testosterone.ts',
    ],
  );
  for (const femaleEntry of [
    './organs/human-compartments/glucose/glucose.female.ts',
    './organs/human-compartments/body-water/water.female.ts',
    './organs/human-organs/ovaries/menstrual-cycle.ts',
    './organs/human-organs/uterus/uterus.ts',
    './organs/human-organs/mammary-glands/milk.ts',
  ]) {
    assert.equal(manifest.scripts.includes(femaleEntry), false, `male manifest must not load ${femaleEntry}`);
  }
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

function duodenumRound(heartbeat, { stomach, salivaryGlands, state, dt = 60 } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => {
      if (partId === 'duodenum') return state;
      if (partId === 'stomach') return stomach;
      if (partId === 'salivaryGlands') return salivaryGlands;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds: dt,
    write: (next) => { writes.push(next); },
  });
  return writes[writes.length - 1];
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('duodenum applies the salivary amylase gain to carbohydrate meals', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  const base = 10 * (1 - Math.exp(-0.1));

  const basal = duodenumRound(heartbeat, {
    stomach: { emptiedKcal: 10, emptiedCarbohydrateG: 5 },
    salivaryGlands: { salivaRateMlPerMin: 0.5 },
  });
  assertClose(basal.nutrientExposure, base * 1.05, 'basal saliva gain');

  const stimulated = duodenumRound(heartbeat, {
    stomach: { emptiedKcal: 10, emptiedCarbohydrateG: 5 },
    salivaryGlands: { salivaRateMlPerMin: 1.5 },
  });
  assertClose(stimulated.nutrientExposure, base * 1.15, 'stimulated saliva gain');

  const second = duodenumRound(heartbeat, {
    stomach: { emptiedKcal: 10, emptiedCarbohydrateG: 5 },
    salivaryGlands: { salivaRateMlPerMin: 1.5 },
    state: stimulated,
  });
  assertClose(
    second.nutrientExposure,
    stimulated.nutrientExposure
      + (1 - Math.exp(-0.1)) * (10 * 1.15 - stimulated.nutrientExposure),
    'gain applies to arrival rather than compounding on the state',
  );
});

test('duodenum leaves non-carbohydrate meals unchanged', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  const base = 10 * (1 - Math.exp(-0.1));
  for (const [label, stomach] of [
    ['no carbohydrate field', { emptiedKcal: 10 }],
    ['zero carbohydrate', { emptiedKcal: 10, emptiedCarbohydrateG: 0 }],
    ['invalid carbohydrate', { emptiedKcal: 10, emptiedCarbohydrateG: Number.NaN }],
  ]) {
    const written = duodenumRound(heartbeat, {
      stomach,
      salivaryGlands: { salivaRateMlPerMin: 1.5 },
    });
    assertClose(written.nutrientExposure, base, label);
  }
});

test('duodenum uses zero salivary gain when salivaryGlands is missing', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  const base = 10 * (1 - Math.exp(-0.1));
  for (const salivaryGlands of [undefined, null]) {
    const written = duodenumRound(heartbeat, {
      stomach: { emptiedKcal: 10, emptiedCarbohydrateG: 5 },
      salivaryGlands,
    });
    assertClose(written.nutrientExposure, base, String(salivaryGlands));
  }
  assertClose(
    duodenumRound(heartbeat, {
      stomach: { emptiedKcal: 10, emptiedCarbohydrateG: 5 },
    }).nutrientExposure,
    base,
    'absent read',
  );
});

test('duodenum rejects an invalid saliva rate for carbohydrate meals', async () => {
  const { heartbeat } = await import('../organs/human-organs/duodenum/nutrient-exposure.ts');
  for (const [label, salivaryGlands] of [
    ['empty part', {}],
    ['string rate', { salivaRateMlPerMin: '1.5' }],
    ['NaN rate', { salivaRateMlPerMin: Number.NaN }],
    ['infinite rate', { salivaRateMlPerMin: Number.POSITIVE_INFINITY }],
    ['negative rate', { salivaRateMlPerMin: -0.1 }],
    ['non-object part', 'salivaryGlands'],
  ]) {
    const writes = [];
    assert.throws(
      () => heartbeat({
        read: (partId) => {
          if (partId === 'stomach') return { emptiedKcal: 10, emptiedCarbohydrateG: 5 };
          if (partId === 'salivaryGlands') return salivaryGlands;
          return undefined;
        },
        actions: [],
        dt: 60,
        simulatedSeconds: 60,
        write: (next) => { writes.push(next); },
      }),
      /salivaryGlands/,
      label,
    );
    assert.equal(writes.length, 0, `${label}: must not write`);
  }
});
