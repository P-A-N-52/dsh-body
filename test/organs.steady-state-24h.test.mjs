import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MANIFESTS = [
  { name: 'neutral', file: 'body-modules.json' },
  { name: 'male', file: 'body-modules.male.json' },
  { name: 'female', file: 'body-modules.female.json' },
];

async function bootManifest(t, manifestFile, { simulatedSeconds = 0, parts = {}, defaultNsfw = false } = {}) {
  let currentWallMs = simulatedSeconds * 1000;
  const app = await launch(t, {
    seed: {
      ...checkpoint({
        wallTimeMs: currentWallMs,
        simulatedSeconds,
        parts,
      }),
      profile: { timezoneOffsetMin: 0 },
    },
    autoTick: false,
    gatewayOptions: {
      manifestPath: join(root, manifestFile),
      now: () => currentWallMs,
      defaultNsfw,
    },
  });
  const baseTick = app.tick.bind(app);
  app.tick = async () => {
    currentWallMs += 60 * 1000;
    return baseTick();
  };
  return app;
}

function assertAllNumbersFinite(value, path = 'parts') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} must be finite, got ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertAllNumbersFinite(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assert.notEqual(entry, undefined, `${path}.${key} must not be undefined`);
      assertAllNumbersFinite(entry, `${path}.${key}`);
    }
  }
}

for (const manifest of MANIFESTS) {
  test(`24h (1440-round) fasting temperature and glucose proxy regression (${manifest.name})`, async (t) => {
    const app = await bootManifest(t, manifest.file);

    let minCoreTempC = Infinity;
    let maxCoreTempC = -Infinity;
    let maxGlucoseMgDl = -Infinity;
    let minGlucoseMgDl = Infinity;

    for (let round = 1; round <= 1440; round++) {
      await app.tick();
      const { parts } = app.gateway.getState();
      assertAllNumbersFinite(parts, `${manifest.name}.round${round}`);

      const tempC = parts.thermoregulation.coreTemperatureC;
      minCoreTempC = Math.min(minCoreTempC, tempC);
      maxCoreTempC = Math.max(maxCoreTempC, tempC);
      assert.ok(
        tempC >= 36.5 && tempC <= 37.5,
        `${manifest.name} round ${round}: coreTemperatureC ${tempC} out of [36.5, 37.5]`,
      );

      const glucoseMgDl = parts.glucose.concentrationMgDl;
      maxGlucoseMgDl = Math.max(maxGlucoseMgDl, glucoseMgDl);
      minGlucoseMgDl = Math.min(minGlucoseMgDl, glucoseMgDl);
      assert.ok(
        glucoseMgDl <= 105,
        `${manifest.name} round ${round}: glucose overshoot ${glucoseMgDl} > 105`,
      );
      assert.ok(
        glucoseMgDl >= 60 && glucoseMgDl <= 95,
        `${manifest.name} round ${round}: fasting glucose ${glucoseMgDl} out of [60, 95]`,
      );

      if (round === 1) {
        assert.equal(parts.blood.systolicMmHg, 120);
        assert.equal(parts.blood.diastolicMmHg, 80);
        assert.equal(parts.salivaryGlands.mouthMoistureMm, 100);
        assert.equal(parts.interoception.dryMouthMm, 0);
      }

      if (round === 360) {
        assert.ok(
          glucoseMgDl >= 85 && glucoseMgDl <= 95,
          `${manifest.name} 6h glucose ${glucoseMgDl} out of [85, 95]`,
        );
        assert.ok(
          parts.liver.glycogenG < 80,
          `${manifest.name} 6h liver.glycogenG ${parts.liver.glycogenG} should be below 80`,
        );
      }

      if (manifest.name === 'female') {
        assert.equal(parts.mammaryGlands.lactating, false, `round ${round}: lactating`);
        assert.equal(parts.mammaryGlands.galactorrhea, false, `round ${round}: galactorrhea`);
        assert.equal(parts.mammaryGlands.milkMl, 0, `round ${round}: milkMl`);
        assert.equal(parts.mammaryGlands.lactoseG, 0, `round ${round}: lactoseG`);
        assert.ok(
          parts.pituitary.prolactinNgMl >= 5 && parts.pituitary.prolactinNgMl <= 11,
          `round ${round}: prolactinNgMl ${parts.pituitary.prolactinNgMl} out of [5, 11]`,
        );
      }
    }

    assert.ok(minCoreTempC >= 36.5 && maxCoreTempC <= 37.5);
    assert.ok(minGlucoseMgDl >= 60 && maxGlucoseMgDl <= 95);
  });
}

test('240 mL water drink — 2-hour (120-round) absorption dynamics (neutral)', async (t) => {
  async function runWaterScenario(withDrink) {
    const app = await bootManifest(t, 'body-modules.json');
    if (withDrink) {
      const res = await app.post('/actions', { id: 'drink-240', type: 'drink', volumeMl: 240 });
      assert.equal(res.status, 202);
    }

    let cumVoidedMl = 0;
    let cumSweatMl = 0;
    let cumLungsMl = 0;
    let cumRoutedToColonMl = 0;
    let prevSmallIntestineWaterMl = 0;

    for (let round = 1; round <= 120; round++) {
      await app.tick();
      const { parts } = app.gateway.getState();
      cumVoidedMl += parts.bladder.voidedMl;
      cumSweatMl += parts.skin.sweatVolumeMl;
      cumLungsMl += parts.lungs.respiratoryWaterLossMl;

      const absorbedMl = parts.smallIntestine.absorbedWaterMl;
      const remainingBeforeColonMl = Math.max(0, prevSmallIntestineWaterMl - absorbedMl);
      const routedThisRoundMl = Math.min(remainingBeforeColonMl, absorbedMl * (0.05 / 0.95));
      cumRoutedToColonMl += routedThisRoundMl;
      prevSmallIntestineWaterMl = parts.smallIntestine.waterVolumeMl;
    }

    const finalParts = app.gateway.getState().parts;
    const systemWaterMl = finalParts.bodyFluid.waterVolumeMl
      + finalParts.bladder.volumeMl
      + cumVoidedMl
      + cumSweatMl
      + cumLungsMl;

    return { finalParts, systemWaterMl, cumRoutedToColonMl };
  }

  const baseline = await runWaterScenario(false);
  const drinkRun = await runWaterScenario(true);

  const absorbedToSystemMl = drinkRun.systemWaterMl - baseline.systemWaterMl;

  assert.ok(
    drinkRun.finalParts.smallIntestine.waterVolumeMl < 10,
    `smallIntestine.waterVolumeMl ${drinkRun.finalParts.smallIntestine.waterVolumeMl} >= 10`,
  );
  assert.ok(
    drinkRun.finalParts.colon.residueWaterMl < 20,
    `colon.residueWaterMl ${drinkRun.finalParts.colon.residueWaterMl} >= 20`,
  );
  assert.ok(
    drinkRun.cumRoutedToColonMl < 20,
    `cumRoutedToColonMl ${drinkRun.cumRoutedToColonMl} >= 20`,
  );
  assert.ok(
    absorbedToSystemMl > 200,
    `absorbedToSystemMl ${absorbedToSystemMl} <= 200`,
  );
});

test('30-minute hard exercise + 60-minute recovery (neutral)', async (t) => {
  const app = await bootManifest(t, 'body-modules.json');
  const res = await app.post('/actions', {
    id: 'exercise-30',
    type: 'exercise',
    intensity: 1,
    durationMin: 30,
  });
  assert.equal(res.status, 202);

  let peakTempC = -Infinity;
  let maxGlucoseMgDl = -Infinity;
  const burnedG = { muscleHead: 0, muscleTrunk: 0, muscleLimbs: 0 };
  let activeResponseSeen = false;
  let ventilationResponseSeen = false;

  for (let round = 1; round <= 90; round++) {
    await app.tick();
    const { parts } = app.gateway.getState();

    peakTempC = Math.max(peakTempC, parts.thermoregulation.coreTemperatureC);
    maxGlucoseMgDl = Math.max(maxGlucoseMgDl, parts.glucose.concentrationMgDl);

    for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
      burnedG[region] += parts[region].glycogenConsumedG;
    }

    // Round 2 is the first round where heart & bloodOxygen read active physicalActivity;
    // round 3 is the first round where lungsVentilation reads elevated bloodOxygen demand.
    if (round === 2) {
      assert.ok(parts.heart.heartRatePerMin > 140, `round 2 HR ${parts.heart.heartRatePerMin}`);
      assert.equal(parts.bloodOxygen.spo2Percent, 97);
      activeResponseSeen = true;
    }
    if (round === 3) {
      assert.ok(
        parts.lungsVentilation.ventilationMlMin > 20000,
        `round 3 ventilation ${parts.lungsVentilation.ventilationMlMin}`,
      );
      ventilationResponseSeen = true;
    }

    assert.ok(
      parts.thermoregulation.coreTemperatureC < 39.5,
      `round ${round}: coreTemperatureC ${parts.thermoregulation.coreTemperatureC} >= 39.5`,
    );
    assert.ok(
      parts.glucose.concentrationMgDl <= 105,
      `round ${round}: glucose ${parts.glucose.concentrationMgDl} > 105`,
    );
  }

  assert.ok(activeResponseSeen && ventilationResponseSeen);

  const finalTempC = app.gateway.getState().parts.thermoregulation.coreTemperatureC;
  assert.ok(peakTempC > 37, `peakTempC ${peakTempC} should rise above 37`);
  assert.ok(peakTempC < 39.5);
  assert.ok(finalTempC < peakTempC, `recovery temp ${finalTempC} must be < peak ${peakTempC}`);
  assert.ok(maxGlucoseMgDl <= 105);

  const totalBurnedG = burnedG.muscleHead + burnedG.muscleTrunk + burnedG.muscleLimbs;
  assert.ok(Math.abs(burnedG.muscleHead - 0.75) < 1e-6, `head burned ${burnedG.muscleHead}`);
  assert.ok(Math.abs(burnedG.muscleTrunk - 6.75) < 1e-6, `trunk burned ${burnedG.muscleTrunk}`);
  assert.ok(Math.abs(burnedG.muscleLimbs - 7.5) < 1e-6, `limbs burned ${burnedG.muscleLimbs}`);
  assert.ok(Math.abs(totalBurnedG - 15) < 1e-6, `total burned ${totalBurnedG}`);
});

test('male continuous sex (intensity: 1, durationMin: 30) at 08:00 (male)', async (t) => {
  const safeApp = await bootManifest(t, 'body-modules.male.json', {
    simulatedSeconds: 8 * 3600,
  });
  const blocked = await safeApp.post('/actions', {
    id: 'sex-blocked',
    type: 'sex',
    intensity: 1,
    durationMin: 30,
  });
  assert.equal(blocked.status, 403, 'default nsfw: false must block sex');

  const app = await bootManifest(t, 'body-modules.male.json', {
    simulatedSeconds: 8 * 3600,
    defaultNsfw: true,
  });
  const res = await app.post('/actions', {
    id: 'sex-30',
    type: 'sex',
    intensity: 1,
    durationMin: 30,
  });
  assert.equal(res.status, 202);

  let prevLastOrgasm = null;
  const orgasmMinutes = [];
  const phases = new Set();
  let maxArousalMm = 0;

  for (let round = 1; round <= 40; round++) {
    await app.tick();
    const { parts } = app.gateway.getState();
    const sr = parts.sexualResponse;

    assert.ok(parts.testes.testosteroneRelative > 1, `round ${round}: testosterone <= 1`);
    assert.ok(sr.arousalMm >= 0 && sr.arousalMm <= 100, `round ${round}: arousal ${sr.arousalMm}`);
    maxArousalMm = Math.max(maxArousalMm, sr.arousalMm);
    phases.add(sr.phase);

    if (sr.lastOrgasmAtSimMin !== null && sr.lastOrgasmAtSimMin !== prevLastOrgasm) {
      orgasmMinutes.push(sr.lastOrgasmAtSimMin);
      prevLastOrgasm = sr.lastOrgasmAtSimMin;
    }
  }

  assert.ok(maxArousalMm <= 100 && maxArousalMm > 0);
  assert.ok(orgasmMinutes.length >= 1, 'expected at least one orgasm');
  assert.ok(phases.has('orgasm'), 'expected orgasm phase');
  assert.ok(phases.has('refractory'), 'expected refractory phase');

  for (let i = 1; i < orgasmMinutes.length; i++) {
    assert.ok(
      orgasmMinutes[i] - orgasmMinutes[i - 1] >= 20,
      `double orgasm inside 20 min window: ${orgasmMinutes[i - 1]} -> ${orgasmMinutes[i]}`,
    );
  }
});
