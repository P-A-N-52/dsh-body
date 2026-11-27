import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function boot(statePath) {
  return startGateway({
    manifestPath: rootManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
}

function createBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-thermoregulation-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);
  const gateways = [];
  t.after(async () => {
    for (const gateway of gateways) await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    statePath,
    async start() {
      const gateway = boot(statePath);
      gateways.push(gateway);
      await gateway.ready;
      return gateway;
    },
  };
}

function exercise(gateway, id, durationMin = 10) {
  assert.equal(
    gateway.submitAction({ id, type: 'exercise', intensity: 1, durationMin }).statusCode,
    202,
  );
}

test('resting body stays at ~37 C without hyperthermia runaway or sweating', async (t) => {
  const body = createBody(t);
  const gateway = await body.start();

  for (let round = 1; round <= 60; round++) {
    await gateway.tick();
  }
  const parts = gateway.getState().parts;
  assert.ok(
    Math.abs(parts.thermoregulation.coreTemperatureC - parts.thermoregulation.setpointC) < 0.15,
    `resting core temp should track setpoint (${parts.thermoregulation.setpointC}), got ${parts.thermoregulation.coreTemperatureC}`,
  );
  assert.equal(parts.skin.sweatRequestMl, 0);
  assert.equal(parts.skin.sweatVolumeMl, 0);
  assert.ok(
    Math.abs(parts.lungsVentilation.ventilationMlMin - 6000) < 1,
    `resting ventilation should stay near 6000 mL/min, got ${parts.lungsVentilation.ventilationMlMin}`,
  );
});

test('exercise raises core temperature, stabilizes below 39.5 C, and sweating damps the rise', async (t) => {
  const body = createBody(t);
  const gateway = await body.start();
  exercise(gateway, 'exercise-thermoregulation', 120);

  const temperatures = [gateway.getState().parts.thermoregulation.coreTemperatureC];
  const sweatRequests = [gateway.getState().parts.skin.sweatRequestMl];
  const sweatVolumes = [gateway.getState().parts.skin.sweatVolumeMl];
  for (let round = 1; round <= 10; round++) {
    await gateway.tick();
    const parts = gateway.getState().parts;
    temperatures.push(parts.thermoregulation.coreTemperatureC);
    sweatRequests.push(parts.skin.sweatRequestMl);
    sweatVolumes.push(parts.skin.sweatVolumeMl);
  }

  for (let round = 3; round < temperatures.length; round++) {
    assert.ok(
      temperatures[round] > temperatures[round - 1],
      `round ${round}: core temperature must rise`,
    );
  }
  assert.ok(
    temperatures[10] > gateway.getState().parts.thermoregulation.setpointC + 0.5,
    'exercise must warm the core well above the setpoint',
  );
  assert.ok(
    sweatRequests[4] > sweatRequests[3],
    `sweat request ${sweatRequests[4]} must exceed ${sweatRequests[3]}`,
  );
  assert.ok(sweatRequests[5] > sweatRequests[4]);
  assert.ok(sweatVolumes[4] > 0, 'paid sweat must appear after the request');

  const riseWithoutSweat = (0.005 * 1250 - 0.104167 * (temperatures[9] - 25)) / 60;
  const actualRise = temperatures[10] - temperatures[9];
  assert.ok(
    actualRise < riseWithoutSweat,
    `evaporative loss must reduce the rise: ${actualRise} < ${riseWithoutSweat}`,
  );
  assert.ok(actualRise < temperatures[3] - temperatures[2], 'sweat must damp the rise');
  assert.ok(gateway.getState().parts.interoception.heatMm > 0);
  assert.equal(gateway.getState().parts.interoception.coldMm, 0);

  for (let round = 11; round <= 120; round++) {
    await gateway.tick();
  }
  const steadyTemp = gateway.getState().parts.thermoregulation.coreTemperatureC;
  assert.ok(steadyTemp > 38 && steadyTemp < 39.5, `hard exercise stabilizes < 39.5 C, got ${steadyTemp}`);
});

test('a preseeded hot save at rest triggers sweating and panting while cooling down', async (t) => {
  const body = createBody(t, {
    parts: {
      thermoregulation: { coreTemperatureC: 39 },
      skin: { sweatRequestMl: 0, sweatVolumeMl: 20 },
    },
  });
  const gateway = await body.start();
  assert.equal(gateway.getState().parts.thermoregulation.coreTemperatureC, 39);
  assert.equal(gateway.getState().parts.skin.sweatVolumeMl, 20);

  await gateway.tick();
  const parts = gateway.getState().parts;
  assert.ok(parts.thermoregulation.coreTemperatureC < 39);
  assert.ok(parts.thermoregulation.coreTemperatureC > 37);
  assert.ok(parts.skin.sweatRequestMl > 0, 'resting hyperthermia must trigger sweat request');
  assert.ok(parts.lungsVentilation.ventilationMlMin > 6000, 'resting hyperthermia must trigger panting');
  assert.ok(parts.lungsVentilation.respiratoryRatePerMin > 12, 'panting must raise respiratory rate');
  assert.equal(parts.interoception.heatMm, 100);
  assert.equal(parts.interoception.coldMm, 0);
});

test('a preseeded cold save shivers, warms and reduces cold discomfort', async (t) => {
  const body = createBody(t, {
    parts: { thermoregulation: { coreTemperatureC: 35 } },
  });
  const gateway = await body.start();
  assert.equal(gateway.getState().parts.thermoregulation.coreTemperatureC, 35);

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.thermoregulation.coreTemperatureC > 35);
  assert.equal(first.interoception.coldMm, 100);
  assert.equal(first.interoception.heatMm, 0);

  await gateway.tick();
  const second = gateway.getState().parts;
  assert.ok(second.thermoregulation.coreTemperatureC > first.thermoregulation.coreTemperatureC);
  assert.ok(second.interoception.coldMm < first.interoception.coldMm);

  await gateway.tick();
  const third = gateway.getState().parts;
  assert.ok(third.thermoregulation.coreTemperatureC > second.thermoregulation.coreTemperatureC);
  assert.ok(third.interoception.coldMm < second.interoception.coldMm);
});

test('restarting on the same state path continues the temperature trajectory', async (t) => {
  const body = createBody(t);
  let gateway = await body.start();
  exercise(gateway, 'exercise-thermoregulation-restart');
  for (let round = 1; round <= 3; round++) await gateway.tick();

  const before = gateway.getState();
  assert.ok(before.parts.thermoregulation.coreTemperatureC > 37);
  assert.ok(before.parts.skin.sweatVolumeMl > 0);
  await gateway.stop();

  gateway = await body.start();
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  assert.ok(
    after.thermoregulation.coreTemperatureC > before.parts.thermoregulation.coreTemperatureC,
  );
  assert.equal(
    after.interoception.heatMm,
    50 * (before.parts.thermoregulation.coreTemperatureC - 37),
  );
  assert.equal(
    after.physicalActivity.remainingExerciseMin,
    before.parts.physicalActivity.remainingExerciseMin - 1,
  );
});
