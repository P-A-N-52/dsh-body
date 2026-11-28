import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch } from '../test-support/harness.mjs';

const manifestPath = fileURLToPath(new URL('../organs/presets/human-lipid/body-modules.json', import.meta.url));
const roundMs = 60_000;
const weightKg = 75;
const tissueVolumeMl = 600;
const actions = [
  { id: 'humid', type: 'set_environment', airTemperatureC: 32, relativeHumidityPct: 90 },
  { id: 'shirt', type: 'wear_layer', layerId: 'tshirt' },
  { id: 'coat', type: 'wear_layer', layerId: 'jacket' },
  { id: 'fat-drink', type: 'drink', volumeMl: 240, energyKcal: 220, carbohydrateG: 6, fatG: 18, durationMin: 3 },
];

test('human-lipid keeps paced fat delivery, humidity and clothing heat, and fast thirst unchanged by composition', async (t) => {
  const wallTimeMs = Date.UTC(2026, 0, 1, 12);
  let clock = wallTimeMs;
  const bodies = [];
  for (const [bodyFatPercent, fatMassKg, fatFreeMassKg, fibroglandularVolumePct, fibroglandularVolumeMl, fatVolumeMl] of [
    [20, 15, 60, 20, 120, 480],
    [30, 22.5, 52.5, 60, 360, 240],
  ]) {
    const seed = {
      ...checkpoint({
        wallTimeMs,
        profile: { weightKg, bodyFatPercent, timezoneOffsetMin: 0 },
        parts: { bodyFluid: { waterVolumeMl: 29000 }, skin: { sweatRequestMl: 2 }, kidney: { urineProductionRequestMl: 0 } },
      }),
      parameters: {
        'thermoregulation.circadianAmplitudeC': 0,
        'thermoregulation.evaporationReferenceTemperatureC': 32,
        'thermoregulation.evaporationConductanceMlMinPerKpa': 1,
        'breastComposition.bilateralTissueVolumeMl': tissueVolumeMl,
        'breastComposition.fibroglandularVolumePct': fibroglandularVolumePct,
      },
    };
    const app = await launch(t, {
      seed, heartbeatIntervalMs: roundMs, gatewayOptions: { manifestPath, legacyStatePath: null, now: () => clock },
    });
    const expected = {
      bodyComposition: { weightKg, bodyFatPercent, fatMassKg, fatFreeMassKg },
      breastComposition: { bilateralTissueVolumeMl: tissueVolumeMl, fibroglandularVolumePct, fibroglandularVolumeMl, fatVolumeMl },
    };
    for (const action of actions) {
      const receipt = await app.post('/actions', action);
      assert.equal(receipt.status, 202, `${action.id}: ${await receipt.text()}`);
    }
    bodies.push({ app, expected });
  }

  const timeline = [];
  for (let round = 0; round <= 4; round++) {
    if (round > 0) {
      clock += roundMs;
      for (const { app } of bodies) assert.deepEqual(await app.tick(), { ran: true, failed: false });
    }
    const snapshots = bodies.map(({ app, expected }) => {
      const { simulatedSeconds, parts } = app.gateway.getState();
      const { bodyComposition, breastComposition, ...otherParts } = parts;
      assert.equal(simulatedSeconds, round * 60);
      assert.deepEqual({ bodyComposition, breastComposition }, expected);
      return otherParts;
    });
    assert.deepEqual(snapshots[0], snapshots[1], `round ${round}: only the two readouts may differ`);
    timeline.push(snapshots[0]);
  }

  const [, first, second] = timeline;
  const fatSlices = timeline.slice(1).map(({ stomach }) => stomach.explicitFatIntakeG);
  const waterSlices = timeline.slice(1).map(({ stomach }) => stomach.deliveredWaterMl);
  assert.deepEqual(fatSlices, [6, 6, 6, null]);
  assert.deepEqual(waterSlices, [80, 80, 80, 0]);
  assert.equal(first.stomach.mealQueue[0].remainingFatG, 12);
  assert.ok(second.intestinalLipid.lumenTgG > 0);
  assert.deepEqual(first.climate, { airTemperatureC: 32, relativeHumidityPct: 90 });
  assert.deepEqual(first.clothing.wornLayerIds, ['tshirt', 'jacket']);
  const previousHeat = first.thermoregulation.heatBalance;
  assert.deepEqual([previousHeat.relativeHumidityPct, previousHeat.paidSweatMl], [50, 0]);
  assert.equal(first.skin.sweatVolumeMl, 2);
  assert.equal(first.bodyFluid.waterVolumeMl, 28998);
  const heat = second.thermoregulation.heatBalance;
  assert.deepEqual([heat.relativeHumidityPct, heat.paidSweatMl], [90, 2]);
  assert.ok(Math.abs(heat.evaporationMultiplier - 0.36) < 1e-9);
  assert.ok(Math.abs(heat.evaporatedSweatMl - 0.170950) < 1e-6);
  const relief = second.interoception.oralThirstReliefFraction;
  assert.equal(first.interoception.oralThirstReliefFraction, 0);
  assert.ok(relief > 0, 'oral relief consumes the previously committed water slice');
  assert.equal(second.interoception.thirstProjectionAtSimulatedSeconds, 120);
  assert.ok(Math.abs(second.interoception.thirst - first.hypothalamusThirst.thirst * (1 - relief)) < 1e-9);
  t.diagnostic(JSON.stringify({ fatSlices, waterSlices, paidSweatMl: heat.paidSweatMl, evaporatedSweatMl: heat.evaporatedSweatMl, relief }));
});
