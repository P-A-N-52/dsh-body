import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the root manifest loads all twelve body parts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const info = await gateway.ready;

  const capabilities = await (await fetch(`http://127.0.0.1:${info.port}/capabilities`)).json();
  assert.deepEqual(capabilities.drink, ['stomach', 'stomachGhrelin']);
  assert.deepEqual(capabilities.eat, ['stomach', 'stomachGhrelin']);
  assert.deepEqual(capabilities.urinate, ['bladder']);
  assert.deepEqual(Object.keys(capabilities).sort(), ['drink', 'eat', 'urinate']);

  const response = await fetch(`http://127.0.0.1:${info.port}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'cola-1', type: 'drink', volumeMl: 330, energyKcal: 140 }),
  });
  assert.equal(response.status, 202);
  await gateway.tick();

  const first = await (await fetch(`http://127.0.0.1:${info.port}/state`)).json();
  assert.deepEqual(Object.keys(first.parts).sort(), [
    'bladder',
    'bodyFluid',
    'brainNotify',
    'duodenum',
    'hypothalamusAdh',
    'hypothalamusThirst',
    'interoception',
    'kidney',
    'smallIntestine',
    'stomach',
    'stomachGhrelin',
    'stomachSensory',
  ]);
  assert.equal(first.parts.stomach.volumeMl, 330);
  assert.equal(first.parts.stomach.waterVolumeMl, 330);
  assert.equal(first.parts.stomach.emptiedWaterMl, 0);
  assert.equal(first.parts.smallIntestine.waterVolumeMl, 0);
  assert.ok(first.parts.stomach.energyKcal > 0);
  assert.ok(first.parts.stomachGhrelin.relativeConcentration < 1);
  assert.ok(first.parts.stomachSensory.mechanical >= 0);
  assert.ok(first.parts.duodenum.nutrientExposure >= 0);
  assert.ok(Number.isFinite(first.parts.interoception.hunger));
  assert.ok(Number.isFinite(first.parts.interoception.fullness));
  assert.equal(first.parts.interoception.thirst, 50);
  assert.ok(Number.isFinite(first.parts.interoception.urinaryUrgency));
  assert.equal(first.parts.bodyFluid.waterVolumeMl, 30000);
  assert.equal(first.parts.bodyFluid.waterDeficit, 0);
  assert.equal(first.parts.hypothalamusAdh.relativeConcentration, 1);
  assert.equal(first.parts.hypothalamusThirst.thirst, 50);
  assert.equal(first.parts.kidney.urineProductionRequestMl, 1);
  assert.equal(first.parts.bladder.volumeMl, 0);
  assert.equal(first.parts.brainNotify.lastSessionId, null);
  assert.deepEqual(first.parts.brainNotify.sessions, {});

  await gateway.tick();

  const second = await (await fetch(`http://127.0.0.1:${info.port}/state`)).json();
  assert.ok(second.parts.stomach.volumeMl < first.parts.stomach.volumeMl);
  assert.ok(second.parts.stomach.emptiedWaterMl > 0);
  assert.ok(second.parts.smallIntestine.waterVolumeMl > 0);
  assert.ok(second.parts.bodyFluid.waterVolumeMl < 30000);
  assert.equal(second.parts.bladder.volumeMl, 1);
  assert.equal(second.parts.hypothalamusThirst.thirst, 50);
  assert.ok(second.parts.interoception.fullness > 0);
  assert.ok(second.parts.interoception.hunger < 50);
});
