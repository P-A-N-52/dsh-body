import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const tempBase = join(tmpdir(), 'dsh-body');
const oneMinuteRetention = 2 ** (-1 / 60);

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

async function startBody(t, { parts = {}, simulatedSeconds = 0 } = {}) {
  mkdirSync(tempBase, { recursive: true });
  const dir = mkdtempSync(join(tempBase, 'endocrine-t6.'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds,
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

function melatoninAt(hour) {
  return Math.min(
    2,
    Math.max(0, 1 + 0.8 * Math.cos((2 * Math.PI * (hour - 2)) / 24)),
  );
}

function sleepinessAt(melatoninRelative) {
  return Math.min(
    100,
    Math.max(0, (100 * (melatoninRelative - 0.2)) / 1.6),
  );
}

test('seeded high TSH raises T4, raises basal oxygen demand and pulls TRH/TSH back', async (t) => {
  const body = await startBody(t, {
    parts: { pituitary: { tshRelative: 3, acthRelative: 1 } },
  });
  const gateway = await body.start();
  assert.equal(gateway.getState().parts.pituitary.tshRelative, 3);

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.thyroid.thyroxineRelative > 1, 'TSH must raise T4');
  assert.equal(
    first.bloodOxygen.oxygenConsumptionMlMin,
    250 * (0.6 + 0.4),
    'the oxygen consumer still sees the round-start T4 baseline',
  );

  await gateway.tick();
  const second = gateway.getState().parts;
  const expectedDemandMlMin = 250 * (0.6 + 0.4 * first.thyroid.thyroxineRelative);
  assert.ok(second.thyroid.thyroxineRelative > 1, 'T4 must stay above baseline');
  assert.ok(
    Math.abs(second.bloodOxygen.oxygenConsumptionMlMin - expectedDemandMlMin) < 1e-9,
    `basal demand ${second.bloodOxygen.oxygenConsumptionMlMin} != ${expectedDemandMlMin}`,
  );
  assert.ok(
    second.bloodOxygen.oxygenConsumptionMlMin > 250 * (0.6 + 0.4),
    'higher T4 must raise basal oxygen demand',
  );
  assert.ok(
    second.hypothalamusEndocrine.trhRelative < 1,
    'high T4 must suppress TRH',
  );
  assert.ok(
    second.pituitary.tshRelative < first.pituitary.tshRelative,
    'high T4 must pull TSH down from the seeded high value',
  );
});

test('seeded high ACTH raises cortisol, increases liver release and raises stressMm', async (t) => {
  const body = await startBody(t, {
    simulatedSeconds: 0,
    parts: {
      pituitary: { tshRelative: 1, acthRelative: 3 },
      glucose: {
        glucoseMassG: 11.28,
        concentrationMgDl: 80,
        disposedGlucoseG: 0,
        excessMassG: 0,
      },
    },
  });
  const gateway = await body.start();

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.adrenal.cortisolRelative > 1, 'high ACTH must raise cortisol');
  assert.ok(first.liver.outputG > 0, 'low glucose must start liver release');
  assert.equal(first.interoception.stressMm, 0, 'the readout still sees round-start cortisol');

  await gateway.tick();
  const second = gateway.getState().parts;
  assert.ok(
    second.adrenal.cortisolRelative > first.adrenal.cortisolRelative,
    'cortisol must keep rising toward the high ACTH signal',
  );
  assert.ok(
    second.liver.outputG > first.liver.outputG,
    `release ${second.liver.outputG} must rise with cortisol above 1`,
  );
  assert.ok(second.liver.glycogenG < 80, 'the release must spend liver glycogen');
  assert.ok(second.interoception.stressMm > 0, 'cortisol above baseline must raise stressMm');
});

test('sleepiness follows the simulated circadian melatonin curve', async (t) => {
  for (const [hour, expectedSleepiness] of [[2, 100], [8, 50], [14, 0]]) {
    const body = await startBody(t, { simulatedSeconds: hour * 3600 - 60 });
    const gateway = await body.start();

    await gateway.tick();
    const afterFirst = gateway.getState().parts;
    assert.ok(
      Math.abs(afterFirst.pineal.melatoninRelative - melatoninAt(hour)) < 1e-12,
      `hour ${hour}: melatonin ${afterFirst.pineal.melatoninRelative}`,
    );

    await gateway.tick();
    const afterSecond = gateway.getState().parts;
    assert.ok(
      Math.abs(
        afterSecond.interoception.sleepinessMm - sleepinessAt(melatoninAt(hour)),
      ) < 1e-9,
      `hour ${hour}: sleepiness ${afterSecond.interoception.sleepinessMm}`,
    );
    assert.ok(
      Math.abs(afterSecond.interoception.sleepinessMm - expectedSleepiness) < 0.1,
      `hour ${hour}: expected sleepiness near ${expectedSleepiness}`,
    );
  }
});

test('restarting on the same state path continues the HPT axis', async (t) => {
  const body = await startBody(t, {
    parts: { pituitary: { tshRelative: 3, acthRelative: 1 } },
  });
  let gateway = await body.start();
  for (let round = 1; round <= 3; round++) await gateway.tick();

  const before = gateway.getState();
  assert.notEqual(before.parts.thyroid.thyroxineRelative, 1);
  await gateway.stop();

  gateway = await body.start();
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, before.simulatedSeconds);
  assert.deepEqual(restored.parts, before.parts);

  const expectedT4 = before.parts.pituitary.tshRelative
    + (before.parts.thyroid.thyroxineRelative - before.parts.pituitary.tshRelative)
      * oneMinuteRetention;
  await gateway.tick();
  const after = gateway.getState();
  assert.equal(after.simulatedSeconds, before.simulatedSeconds + 60);
  assert.ok(
    Math.abs(after.parts.thyroid.thyroxineRelative - expectedT4) < 1e-12,
    `T4 ${after.parts.thyroid.thyroxineRelative} != ${expectedT4}`,
  );
});

test('resting baseline keeps HPT/HPA at 1.0 while cold and hypoglycemia activate TRH and CRH', async (t) => {
  const restingBody = await startBody(t);
  const resting = await restingBody.start();
  await resting.tick();
  const restingParts = resting.getState().parts;
  assert.equal(restingParts.hypothalamusEndocrine.trhRelative, 1);
  assert.equal(restingParts.hypothalamusEndocrine.crhRelative, 1);
  assert.equal(restingParts.pituitary.tshRelative, 1);
  assert.equal(restingParts.pituitary.acthRelative, 1);
  assert.equal(restingParts.thyroid.thyroxineRelative, 1);
  assert.equal(restingParts.adrenal.cortisolRelative, 1);

  const stressedBody = await startBody(t, {
    parts: {
      thermoregulation: { coreTemperatureC: 35 },
      glucose: {
        glucoseMassG: 8.46,
        concentrationMgDl: 60,
        disposedGlucoseG: 0,
        excessMassG: 0,
      },
    },
  });
  const stressed = await stressedBody.start();
  await stressed.tick();
  const stressedParts = stressed.getState().parts;
  assert.ok(stressedParts.hypothalamusEndocrine.trhRelative > 1, 'cold raises TRH');
  assert.ok(stressedParts.hypothalamusEndocrine.crhRelative > 1, 'hypoglycemia raises CRH');
});
