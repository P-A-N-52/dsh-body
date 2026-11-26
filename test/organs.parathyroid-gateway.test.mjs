import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempBase = join(tmpdir(), 'dsh-body');

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

async function startBody(t, {
  manifest = 'body-modules.json',
  parts = {},
  simulatedSeconds = 0,
  wallTimeMs = 0,
} = {}) {
  mkdirSync(tempBase, { recursive: true });
  const dir = mkdtempSync(join(tempBase, 'parathyroid-gateway.'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs,
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
    statePath,
    async start() {
      const gateway = startGateway({
        manifestPath: join(root, manifest),
        statePath,
        port: 0,
        autoTick: false,
        now: () => wallTimeMs,
      });
      gateways.push(gateway);
      await gateway.ready;
      return gateway;
    },
  };
}

for (const manifest of ['body-modules.json', 'body-modules.female.json', 'body-modules.male.json']) {
  test(`${manifest} mounts parathyroid and bloodCalcium cleanly at resting baseline`, async (t) => {
    const body = await startBody(t, { manifest });
    const gateway = await body.start();

    await gateway.tick();
    const { parts } = gateway.getState();
    assert.deepEqual(parts.parathyroid, { pthPgMl: 30 });
    assert.deepEqual(parts.bloodCalcium, { mgDl: 9.5, boneStoreG: 100 });
    assert.equal(parts.interoception.hypocalcemiaMm, 0);
    assert.equal(parts.interoception.hypercalcemiaMm, 0);
  });
}

test('seeded hypocalcemia triggers interoception, raises PTH on round 1, and mobilizes bone calcium on round 2', async (t) => {
  const body = await startBody(t, {
    parts: {
      bloodCalcium: { mgDl: 8, boneStoreG: 100 },
    },
  });
  const gateway = await body.start();

  await gateway.tick();
  const round1 = gateway.getState().parts;
  assert.equal(round1.interoception.hypocalcemiaMm, 75);
  assert.equal(round1.interoception.hypercalcemiaMm, 0);
  assert.ok(round1.parathyroid.pthPgMl > 30, 'low calcium must raise PTH on round 1');
  assert.deepEqual(round1.bloodCalcium, { mgDl: 8, boneStoreG: 100 });

  await gateway.tick();
  const round2 = gateway.getState().parts;
  assert.ok(round2.bloodCalcium.boneStoreG < 100, 'elevated PTH must release bone calcium on round 2');
  assert.ok(round2.bloodCalcium.mgDl > 8, 'bone calcium release must raise bloodCalcium.mgDl on round 2');
});

test('seeded hypercalcemia triggers interoception, lowers PTH on round 1, and deposits/excretes calcium on round 2', async (t) => {
  const body = await startBody(t, {
    parts: {
      bloodCalcium: { mgDl: 11, boneStoreG: 100 },
    },
  });
  const gateway = await body.start();

  await gateway.tick();
  const round1 = gateway.getState().parts;
  assert.equal(round1.interoception.hypercalcemiaMm, 75);
  assert.equal(round1.interoception.hypocalcemiaMm, 0);
  assert.ok(round1.parathyroid.pthPgMl < 30, 'high calcium must lower PTH on round 1');
  assert.deepEqual(round1.bloodCalcium, { mgDl: 11, boneStoreG: 100 });

  await gateway.tick();
  const round2 = gateway.getState().parts;
  assert.ok(round2.bloodCalcium.boneStoreG > 100, 'suppressed PTH must deposit calcium into bone on round 2');
  assert.ok(round2.bloodCalcium.mgDl < 11, 'bone deposition and renal excretion must lower bloodCalcium.mgDl');
});

test('restarting on the same state path preserves parathyroid and bloodCalcium feedback', async (t) => {
  const body = await startBody(t, {
    parts: {
      bloodCalcium: { mgDl: 8.5, boneStoreG: 100 },
    },
  });
  let gateway = await body.start();
  await gateway.tick();
  await gateway.tick();
  const beforeRestart = gateway.getState();
  await gateway.stop();

  gateway = await body.start();
  const restored = gateway.getState();
  assert.equal(restored.simulatedSeconds, beforeRestart.simulatedSeconds);
  assert.deepEqual(restored.parts.parathyroid, beforeRestart.parts.parathyroid);
  assert.deepEqual(restored.parts.bloodCalcium, beforeRestart.parts.bloodCalcium);

    await gateway.tick();
    const afterRestart = gateway.getState();
    assert.equal(afterRestart.simulatedSeconds, beforeRestart.simulatedSeconds + 60);
    assert.ok(afterRestart.parts.bloodCalcium.mgDl > beforeRestart.parts.bloodCalcium.mgDl);
    assert.ok(afterRestart.parts.bloodCalcium.boneStoreG < beforeRestart.parts.bloodCalcium.boneStoreG);
});

test('severe hypocalcemia and hypercalcemia trigger brainNotify wake notifications and sleep important wake', async (t) => {
  const dirHypo = mkdtempSync(join(tempBase, 'parathyroid-notify-hypo.'));
  const dirHyper = mkdtempSync(join(tempBase, 'parathyroid-notify-hyper.'));
  t.after(() => {
    rmSync(dirHypo, { recursive: true, force: true });
    rmSync(dirHyper, { recursive: true, force: true });
  });
  silence(t);

  for (const [dir, mgDl, pattern] of [
    [dirHypo, 7.5, /麻木|抽搐/],
    [dirHyper, 11.5, /倦怠|反胃/],
  ]) {
    const statePath = join(dir, 'body-state.json');
    writeFileSync(statePath, JSON.stringify({
      ...checkpoint({
        wallTimeMs: 0,
        simulatedSeconds: 0,
        parts: {
          bloodCalcium: { mgDl, boneStoreG: 100 },
          sleep: { sleeping: true, sleepStage: 'deep', sleepPressureMm: 40, sleepDurationMin: 20, wakeEvent: 'none' },
        },
      }),
      boundSessionId: 'session-ca-gw',
    }));
    const gw = startGateway({
      manifestPath: join(root, 'body-modules.json'),
      statePath,
      port: 0,
      autoTick: false,
      now: () => 0,
    });
    t.after(() => gw.stop());
    await gw.ready;

    await gw.tick();
    assert.equal(gw.getNotifications().length, 0);

    await gw.tick();
    const parts = gw.getState().parts;
    assert.equal(parts.sleep.sleeping, false);
    assert.equal(parts.sleep.wakeEvent, 'important');
    const notifications = gw.getNotifications();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].mode, 'wake');
    assert.match(notifications[0].text, pattern);
    assert.equal(/\d|\p{Nd}/u.test(notifications[0].text), false);
  }
});
