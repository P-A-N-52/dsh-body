import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('water replay reports the one-round action lag', () => {
  const output = execFileSync(process.execPath, ['tools/replay.mjs', 'scenarios/m1-water-240.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  assert.equal(result.scenario, 'm1-water-240');
  assert.equal(result.actionLagRounds, 1);
  assert.equal(result.observations[0].simMin, 0);
  assert.equal(result.observations[0]['stomach.volumeMl'], 35);
  const atFive = result.observations.find((entry) => entry.simMin === 5);
  assert.ok(atFive['stomach.volumeMl'] > 35);
});
