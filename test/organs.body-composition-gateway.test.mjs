import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch } from '../test-support/harness.mjs';

function boot(t, manifest = '', options = {}) {
  return launch(t, {
    ...options,
    heartbeatIntervalMs: 60_000,
    gatewayOptions: {
      manifestPath: fileURLToPath(new URL(`../body-modules${manifest}.json`, import.meta.url)),
      legacyStatePath: null,
      now: () => 0,
    },
  });
}

function observedParts({ bodyFluid, glucose, mammaryGlands }) {
  return { bodyFluid, glucose, mammaryGlands };
}

test('adult Gateway manifests keep weight, body fat and organ selection independent', async (t) => {
  for (const manifest of ['.male', '.female']) {
    for (const [weightKg, referenceWaterMl, referenceGlucoseG, masses] of [
      [65, 26000, 10.998, [[20, 13, 52], [30, 19.5, 45.5]]],
      [75, 30000, 12.69, [[20, 15, 60], [30, 22.5, 52.5]]],
    ]) {
      await t.test(`${manifest.slice(1)}, ${weightKg} kg, paired 20/30%`, async (pair) => {
        const results = [];
        for (const [bodyFatPercent, fatMassKg, fatFreeMassKg] of masses) {
          const profile = { weightKg, heightCm: 170, bodyFatPercent };
          const app = await boot(pair, manifest, { seed: checkpoint({ wallTimeMs: 0, profile }) });
          const start = app.gateway.getState().parts;
          const expected = { weightKg, bodyFatPercent, fatMassKg, fatFreeMassKg };
          assert.deepEqual(start.bodyComposition, expected);
          assert.equal(Object.hasOwn(start, 'testes'), manifest === '.male');
          assert.equal(Object.hasOwn(start, 'ovaries'), manifest === '.female');
          assert.equal(Object.hasOwn(start, 'mammaryGlands'), manifest === '.female');
          assert.equal(start.mammaryGlands?.storedMilkMl ?? 0, 0);
          assert.ok(Math.abs(start.bodyFluid.waterVolumeMl - referenceWaterMl) < 1e-9);
          assert.ok(Math.abs(start.glucose.glucoseMassG - referenceGlucoseG) < 1e-9);
          assert.equal(start.glucose.concentrationMgDl, 90);

          const trajectory = [observedParts(start)];
          for (let round = 1; round <= 3; round++) {
            assert.deepEqual(await app.tick(), { ran: true, failed: false });
            const { parts, simulatedSeconds } = app.gateway.getState();
            assert.equal(simulatedSeconds, 60 * round);
            assert.deepEqual(parts.bodyComposition, expected);
            assert.equal(parts.mammaryGlands?.milkMl ?? 0, 0);
            trajectory.push(observedParts(parts));
          }
          assert.deepEqual(app.gateway.getNotifications(), []);
          results.push(trajectory);
        }
        assert.deepEqual(results[0], results[1], 'only body composition should differ within a pair');
      });
    }
  }
});

test('root Gateway upgrades a legacy save and derives its readout again when restarting', async (t) => {
  const legacy = {
    wallTimeMs: 0,
    snapshot: {
      simulatedSeconds: 0,
      parts: {
        bodyFluid: { waterVolumeMl: 28750 },
        glucose: { glucoseMassG: 12, concentrationMgDl: 85 },
      },
    },
    pendingActions: [],
    receipts: {},
  };
  let app = await boot(t, '', { seed: legacy });
  const state = await app.get('/state');
  assert.equal(state.status, 200);
  assert.deepEqual((await state.json()).parts.bodyComposition, {
    weightKg: 75, bodyFatPercent: null, fatMassKg: null, fatFreeMassKg: null,
  });
  const originalParts = observedParts(app.gateway.getState().parts);
  assert.equal(originalParts.bodyFluid.waterVolumeMl, 28750);
  assert.equal(originalParts.glucose.glucoseMassG, 12);
  assert.equal(originalParts.glucose.concentrationMgDl, 85);
  assert.equal(app.state().schemaVersion, 2);

  for (const [bodyFatPercent, fatMassKg, fatFreeMassKg] of [
    [22.5, 16.875, 58.125], [0, 0, 75], [100, 75, 0], [null, null, null],
  ]) {
    await app.gateway.stop();
    const saved = app.state();
    const profile = { bodyFatPercent };
    writeFileSync(app.statePath, JSON.stringify({ ...saved, profile }));
    app = await boot(t, '', { statePath: app.statePath });
    const { parts, simulatedSeconds } = app.gateway.getState();
    assert.equal(simulatedSeconds, 0, 'no heartbeat needed to replace the cached readout');
    assert.deepEqual(parts.bodyComposition, { weightKg: 75, bodyFatPercent, fatMassKg, fatFreeMassKg });
    assert.deepEqual(observedParts(parts), originalParts, 'restart does not reset the old pools');
    assert.deepEqual(app.state().profile, profile);
  }
});
