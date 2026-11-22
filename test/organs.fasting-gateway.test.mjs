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
const sessionId = 'fasting-session';

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function startAt(t, dir) {
  const gateway = startGateway({
    manifestPath: rootManifestPath,
    statePath: join(dir, 'body-state.json'),
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
  });
  return gateway;
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fasting-'));
  writeFileSync(
    join(dir, 'body-state.json'),
    JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })),
  );
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const gateway = startAt(t, dir);
  await gateway.ready;
  return { gateway, dir };
}

function hungerNotifications(notifications) {
  return notifications.filter((notification) => notification.text.includes('饥饿'));
}

test('1200 rounds without energy intake raises hunger and an energy drink resets it', async (t) => {
  silence(t);
  const { gateway } = await startBody(t);

  assert.equal(gateway.submitAction({
    id: 'water-seed',
    type: 'drink',
    volumeMl: 240,
    energyKcal: 0,
    sessionId,
  }).statusCode, 202);

  for (let round = 1; round <= 1200; round++) await gateway.tick();

  const fasted = gateway.getState().parts;
  assert.equal(fasted.stomachGhrelin.minutesSinceEnergyIntake, 1200);
  assert.ok(fasted.stomachGhrelin.relativeConcentration >= 1.7);
  assert.ok(fasted.stomachGhrelin.relativeConcentration <= 1.8);
  assert.ok(fasted.interoception.hunger >= 85);

  const fastingNotifications = hungerNotifications(gateway.getNotifications());
  assert.ok(fastingNotifications.length > 0);
  assert.ok(fastingNotifications.every((notification) => notification.sessionId === sessionId));
  assert.ok(fastingNotifications.some((notification) => notification.mode === 'wake'));

  const beforeDrinkCount = gateway.getNotifications().length;
  assert.equal(gateway.submitAction({
    id: 'energy-drink',
    type: 'drink',
    volumeMl: 330,
    energyKcal: 140,
    sessionId,
  }).statusCode, 202);

  await gateway.tick();
  const suppressed = gateway.getState().parts;
  assert.equal(suppressed.stomachGhrelin.relativeConcentration, 0.5);
  assert.equal(suppressed.stomachGhrelin.minutesSinceEnergyIntake, 0);

  await gateway.tick();
  const recovered = gateway.getState().parts;
  assert.ok(recovered.interoception.hunger < 40);
  assert.deepEqual(
    hungerNotifications(gateway.getNotifications().slice(beforeDrinkCount)),
    [],
  );
});

test('an old checkpoint without the fasting clock starts at zero and keeps it across restarts', async (t) => {
  silence(t);
  const { gateway: first, dir } = await startBody(t, {
    parts: { stomachGhrelin: { relativeConcentration: 1 } },
  });

  const loaded = first.getState().parts;
  assert.equal(loaded.stomachGhrelin.relativeConcentration, 1);
  assert.equal(loaded.stomachGhrelin.minutesSinceEnergyIntake, 0);

  await first.tick();
  const afterFirstRound = first.getState().parts;
  assert.equal(afterFirstRound.stomachGhrelin.minutesSinceEnergyIntake, 1);
  assert.equal(afterFirstRound.stomachGhrelin.relativeConcentration, 1);
  assert.equal(afterFirstRound.interoception.hunger, 50);
  assert.deepEqual(first.getNotifications(), []);

  await first.stop();
  const second = startAt(t, dir);
  await second.ready;

  const restarted = second.getState().parts;
  assert.equal(restarted.stomachGhrelin.minutesSinceEnergyIntake, 1);
  await second.tick();

  const afterRestart = second.getState().parts;
  assert.equal(afterRestart.stomachGhrelin.minutesSinceEnergyIntake, 2);
  assert.equal(afterRestart.stomachGhrelin.relativeConcentration, 1);
  assert.equal(afterRestart.interoception.hunger, 50);
  assert.deepEqual(second.getNotifications(), []);
});
