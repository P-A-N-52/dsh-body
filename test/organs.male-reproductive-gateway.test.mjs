import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const maleManifestPath = join(root, 'body-modules.male.json');
const oneMinuteArousalRise = 1 - 2 ** (-1 / 5);

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function arousalState(arousalMm) {
  return {
    arousalMm,
    phase: 'plateau',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  };
}

function boot(statePath, { defaultNsfw = true } = {}) {
  return startGateway({
    manifestPath: maleManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
    defaultNsfw,
  });
}

async function startBody(t, { parts = {}, defaultNsfw = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-male-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);
  const gateway = boot(statePath, { defaultNsfw });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, statePath };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('the male manifest boots forty-nine parts with testes, epididymis and reward', async (t) => {
  const { gateway: safeGateway } = await startBody(t, { defaultNsfw: false });
  assert.equal(Object.hasOwn(safeGateway.getCapabilities(), 'sex'), false);
  assert.equal(Object.hasOwn(safeGateway.getCapabilities(), 'orgasm'), false);
  assert.equal(safeGateway.submitAction({ id: 'male-sex-403', type: 'sex', intensity: 1, durationMin: 10 }).statusCode, 403);
  assert.equal(safeGateway.submitAction({ id: 'male-orgasm-403', type: 'orgasm' }).statusCode, 403);

  const { gateway } = await startBody(t);
  const parts = gateway.getState().parts;

  assert.equal(Object.keys(parts).length, 49);
  assert.deepEqual(parts.testes, { testosteroneRelative: 1, sleepDebtDays: 0 });
  assert.deepEqual(parts.reward, { wantingMm: 25, hedonicMm: 15, satietyMm: 0 });
  assert.deepEqual(parts.epididymis, { spermStorageMl: 0, ejaculatedMl: 0 });
  assert.ok(parts.sexualResponse, 'sexualResponse must be loaded');
  assert.ok(parts.interoception, 'interoception must be loaded');
  const initialRegionGlycogen = {
    muscleHead: 15,
    muscleTrunk: 135,
    muscleLimbs: 150,
  };
  for (const region of ['muscleHead', 'muscleTrunk', 'muscleLimbs']) {
    assert.deepEqual(parts[region], {
      uptakeG: 0,
      glycogenG: initialRegionGlycogen[region],
      glycogenConsumedG: 0,
    }, region);
  }
  assert.deepEqual(gateway.getCapabilities().sex, ['physicalActivity', 'sexualResponse']);
  assert.deepEqual(gateway.getCapabilities().orgasm, ['sexualResponse']);
});

test('seeded high testosterone raises the arousal target and libidoMm', async (t) => {
  const baseline = await startBody(t);
  const high = await startBody(t, { parts: { testes: { testosteroneRelative: 2 } } });

  for (const [id, body] of [['baseline-sex', baseline], ['high-sex', high]]) {
    assert.equal(
      body.gateway.submitAction({ id, type: 'sex', intensity: 1, durationMin: 30 }).statusCode,
      202,
    );
    await body.gateway.tick();
  }

  const baselineParts = baseline.gateway.getState().parts;
  const highParts = high.gateway.getState().parts;
  assert.equal(baselineParts.interoception.libidoMm, 50);
  assert.equal(highParts.interoception.libidoMm, 100);

  const baselineTarget = baselineParts.sexualResponse.arousalMm / oneMinuteArousalRise;
  assertClose(baselineTarget, 100, 'relative testosterone 1 keeps the arousal target at 100', 1e-9);
  assert.ok(highParts.sexualResponse.arousalMm <= 100, 'arousal must stay clamped <= 100');
  assert.ok(
    highParts.sexualResponse.arousalMm > baselineParts.sexualResponse.arousalMm,
    'the high-testosterone arousal must rise faster in the same round',
  );
  assert.ok(
    highParts.testes.testosteroneRelative > 1.5,
    'the seeded testosterone starts decaying toward baseline',
  );
});

test('a seeded orgasm drains sperm storage one round later and recovery follows', async (t) => {
  const { gateway } = await startBody(t, {
    parts: {
      sexualResponse: arousalState(80),
      epididymis: { spermStorageMl: 3, ejaculatedMl: 0 },
    },
  });
  assert.equal(gateway.submitAction({ id: 'male-orgasm', type: 'orgasm' }).statusCode, 202);

  await gateway.tick();
  let parts = gateway.getState().parts;
  assert.equal(parts.sexualResponse.lastOrgasmAtSimMin, 1);
  assert.equal(parts.sexualResponse.phase, 'orgasm');
  assert.equal(parts.epididymis.ejaculatedMl, 0, 'the orgasm round only records the event');
  const storedBeforeEjaculation = parts.epididymis.spermStorageMl;
  assertClose(storedBeforeEjaculation, 3.002, 'the orgasm round still recovers for one minute');

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.equal(
    parts.epididymis.ejaculatedMl,
    storedBeforeEjaculation,
    'the next round drains the round-start storage',
  );
  assert.equal(parts.epididymis.spermStorageMl, 0);

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.equal(parts.epididymis.ejaculatedMl, 0);
  assertClose(parts.epididymis.spermStorageMl, 0.002, 'recovery resumes');

  await gateway.tick();
  parts = gateway.getState().parts;
  assertClose(parts.epididymis.spermStorageMl, 0.004, 'recovery keeps accumulating');
});

test('a restart continues testosterone, sperm recovery and the orgasm record', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-male-restart-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts: {
      testes: { testosteroneRelative: 2 },
      sexualResponse: arousalState(80),
      epididymis: { spermStorageMl: 3, ejaculatedMl: 0 },
    },
  })));
  silence(t);
  let gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;

  assert.equal(gateway.submitAction({ id: 'restart-orgasm', type: 'orgasm' }).statusCode, 202);
  await gateway.tick();
  await gateway.tick();
  const beforeRestart = gateway.getState();
  assert.equal(beforeRestart.parts.epididymis.spermStorageMl, 0);
  assert.equal(beforeRestart.parts.sexualResponse.lastOrgasmAtSimMin, 1);
  const testosteroneBefore = beforeRestart.parts.testes.testosteroneRelative;
  await gateway.stop();

  gateway = boot(statePath);
  await gateway.ready;
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, beforeRestart.simulatedSeconds);
  assert.deepEqual(restored.parts, beforeRestart.parts);

  await gateway.tick();
  const after = gateway.getState().parts;
  assertClose(after.epididymis.spermStorageMl, 0.002, 'recovery continues after restart');
  assert.equal(after.epididymis.ejaculatedMl, 0, 'the old orgasm must not drain twice');
  assert.equal(after.sexualResponse.lastOrgasmAtSimMin, 1);
  assert.ok(
    after.testes.testosteroneRelative < testosteroneBefore,
    'testosterone keeps decaying toward baseline',
  );
});
