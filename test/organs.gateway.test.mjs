import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the root manifest loads all four organ scripts', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-organ-'));
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath: join(dir, 'body-state.json'),
    port: 0,
    autoTick: false,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const info = await gateway.ready;

  const capabilities = await (await fetch(`http://127.0.0.1:${info.port}/capabilities`)).json();
  assert.deepEqual(capabilities.drink, ['stomach']);
  assert.deepEqual(capabilities.eat, ['stomach', 'stomachGhrelin']);

  const response = await fetch(`http://127.0.0.1:${info.port}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'drink-1', type: 'drink', volumeMl: 240 }),
  });
  assert.equal(response.status, 202);
  await gateway.tick();

  const state = await (await fetch(`http://127.0.0.1:${info.port}/state`)).json();
  assert.ok(state.parts.stomach.volumeMl > 0);
  assert.ok(state.parts.stomachGhrelin.relativeConcentration > 0);
  assert.ok(state.parts.stomachSensory.mechanical >= 0);
  assert.ok(state.parts.duodenum.nutrientExposure >= 0);
});
