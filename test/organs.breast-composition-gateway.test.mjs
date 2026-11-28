import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch } from '../test-support/harness.mjs';

const volumeId = 'breastComposition.bilateralTissueVolumeMl';
const percentId = 'breastComposition.fibroglandularVolumePct';

function boot(t, manifest, options) {
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

function readout(bilateralTissueVolumeMl, fibroglandularVolumePct, fibroglandularVolumeMl, fatVolumeMl) {
  return { bilateralTissueVolumeMl, fibroglandularVolumePct, fibroglandularVolumeMl, fatVolumeMl };
}

test('ordinary adult manifests expose only the breast composition inputs that are known', async (t) => {
  for (const [manifest, parameters, want] of [
    ['', undefined, readout(null, null, null, null)],
    ['.male', { [volumeId]: 500.5 }, readout(500.5, null, null, null)],
    ['.female', { [percentId]: 37.5 }, readout(null, 37.5, null, null)],
    ['.male', { [volumeId]: 800, [percentId]: 37.5 }, readout(800, 37.5, 300, 500)],
  ]) {
    const seed = { ...checkpoint({ wallTimeMs: 0, profile: { bodyFatPercent: 30 } }), parameters };
    const app = await boot(t, manifest, { seed });
    assert.deepEqual(app.gateway.getState().parts.breastComposition, want);
    assert.equal(app.gateway.getNsfw(), false);
    assert.equal(Object.hasOwn(app.gateway.getCapabilities(), 'express_milk'), false);
    assert.equal(Object.hasOwn(app.gateway.getCapabilities(), 'breastfeed'), false);

    assert.deepEqual(await app.tick(), { ran: true, failed: false });
    const { parts } = app.gateway.getState();
    assert.deepEqual(parts.breastComposition, want);
    assert.equal(Object.hasOwn(parts, 'mammaryGlands'), manifest === '.female');
    assert.equal(parts.mammaryGlands?.lactating ?? false, false);
    assert.equal(parts.mammaryGlands?.milkMl ?? 0, 0);
    assert.deepEqual(app.gateway.getNotifications(), []);
    await app.gateway.stop();
  }
});

test('at equal bilateral volume changing FGT alters only the breast composition readout', async (t) => {
  const observations = [];
  for (const [parameters, want] of [
    [{}, readout(null, null, null, null)],
    [{ [volumeId]: 600, [percentId]: 20 }, readout(600, 20, 120, 480)],
    [{ [volumeId]: 600, [percentId]: 60 }, readout(600, 60, 360, 240)],
  ]) {
    const seed = {
      ...checkpoint({ wallTimeMs: 0, profile: { weightKg: 75, bodyFatPercent: 20, lactating: true } }),
      parameters,
      nsfw: true,
    };
    const app = await boot(t, '.female', { seed });
    const capabilities = app.gateway.getCapabilities();
    assert.equal(capabilities.express_milk?.includes('mammaryGlands'), true);
    const trajectory = [];
    for (let round = 0; round <= 3; round++) {
      if (round > 0) assert.deepEqual(await app.tick(), { ran: true, failed: false });
      const { breastComposition, ...otherParts } = app.gateway.getState().parts;
      assert.deepEqual(breastComposition, want);
      assert.deepEqual(otherParts.bodyComposition, {
        weightKg: 75, bodyFatPercent: 20, fatMassKg: 15, fatFreeMassKg: 60,
      });
      assert.equal(otherParts.mammaryGlands.lactating, true);
      if (round === 0) assert.equal(otherParts.mammaryGlands.storedMilkMl, 120);
      if (round === 2) assert.ok(otherParts.mammaryGlands.milkMl > 0, 'compare actual milk payout, not just zeros');
      trajectory.push(otherParts);
    }
    observations.push({ capabilities, trajectory, notifications: app.gateway.getNotifications() });
    await app.gateway.stop();
  }
  assert.deepEqual(observations[1], observations[0]);
  assert.deepEqual(observations[2], observations[0]);
});

test('breast overrides (including null and endpoints) replace cached readouts on restart', async (t) => {
  const seed = {
    ...checkpoint({
      wallTimeMs: 0,
      profile: { weightKg: 65 },
      parts: { breastComposition: readout(600, 20, 120, 480) },
    }),
    parameters: { [volumeId]: 800, [percentId]: 0 },
  };
  let app = await boot(t, '', { seed });
  assert.deepEqual(app.gateway.getState().parts.breastComposition, readout(800, 0, 0, 800));

  for (const [parameters, want] of [
    [{ [volumeId]: 800, [percentId]: 100 }, readout(800, 100, 800, 0)],
    [{ [volumeId]: null, [percentId]: 100 }, readout(null, 100, null, null)],
  ]) {
    await app.gateway.stop();
    writeFileSync(app.statePath, JSON.stringify({ ...app.state(), parameters }));
    app = await boot(t, '', { statePath: app.statePath });
    assert.equal(app.gateway.getState().simulatedSeconds, 0);
    assert.deepEqual(app.gateway.getState().parts.breastComposition, want);
    assert.deepEqual(app.state().parameters, parameters);
  }
});

test('a loaded breast composition module rejects invalid explicit ranges instead of clamping', async (t) => {
  for (const [id, value] of [[volumeId, 0], [volumeId, -0.1], [percentId, -0.01], [percentId, 100.01]]) {
    const seed = { ...checkpoint({ wallTimeMs: 0 }), parameters: { [id]: value } };
    const app = await boot(t, '', { seed, expectReadyReject: true });
    assert.ok(app.readyError?.message.includes(id), `${id}=${value} must fail startup with the parameter ID`);
    assert.deepEqual(app.state(), seed, 'invalid config must not replace the save');
  }
});
