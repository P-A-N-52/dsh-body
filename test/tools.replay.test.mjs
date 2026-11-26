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

test('cola replay records energy intake and the design interoception readout', () => {
  const output = execFileSync(process.execPath, ['tools/replay.mjs', 'scenarios/p1-cola-330.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  assert.equal(result.scenario, 'p1-cola-330');
  assert.equal(result.actionLagRounds, 1);

  const start = result.observations.find((entry) => entry.simMin === 0);
  assert.equal(start['stomach.volumeMl'], 0);
  assert.equal(start['interoception.hunger'], 50);
  assert.equal(start['interoception.fullness'], 0);

  const atFive = result.observations.find((entry) => entry.simMin === 5);
  assert.ok(atFive['stomach.volumeMl'] > 0);
  assert.ok(atFive['stomach.energyKcal'] > 0);
  assert.ok(atFive['stomachGhrelin.relativeConcentration'] < 0.55);
  assert.ok(atFive['stomachGhrelin.relativeConcentration'] > 0.2);
  assert.ok(atFive['interoception.hunger'] < 50);
  assert.ok(atFive['interoception.fullness'] > 0);

  const atNinety = result.observations.find((entry) => entry.simMin === 90);
  assert.ok(
    atNinety['stomachGhrelin.relativeConcentration'] > atFive['stomachGhrelin.relativeConcentration'],
    'ghrelin should recover as distension and nutrient exposure fade',
  );
});

test('manifest replay runs the full 39-script water scenario without fatal operation errors', () => {
  const output = execFileSync(
    process.execPath,
    ['tools/replay.mjs', '--manifest', 'body-modules.json', 'scenarios/m1-water-240.json'],
    { cwd: root, encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  assert.equal(result.scenario, 'm1-water-240');
  assert.equal(result.actionLagRounds, 1);
  assert.deepEqual(result.manifest, { path: 'body-modules.json', scriptCount: 41 });

  const start = result.observations.find((entry) => entry.simMin === 0);
  const atThirty = result.observations.find((entry) => entry.simMin === 30);
  const atNinety = result.observations.find((entry) => entry.simMin === 90);
  assert.equal(start['stomach.volumeMl'], 35);
  assert.ok(atThirty['bodyFluid.waterVolumeMl'] > start['bodyFluid.waterVolumeMl']);
  assert.ok(atNinety['bodyFluid.waterVolumeMl'] > start['bodyFluid.waterVolumeMl']);
  for (const entry of result.observations) {
    assert.ok(
      entry['thermoregulation.coreTemperatureC'] >= 36.5
        && entry['thermoregulation.coreTemperatureC'] <= 37.5,
      `expected coreTemperatureC near 37°C at simMin ${entry.simMin}, got ${entry['thermoregulation.coreTemperatureC']}`,
    );
  }
});

test('manifest replay defaults --manifest with no path to body-modules.json on the cola scenario', () => {
  const output = execFileSync(
    process.execPath,
    ['tools/replay.mjs', '--manifest', 'scenarios/p1-cola-330.json'],
    { cwd: root, encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  assert.equal(result.scenario, 'p1-cola-330');
  assert.equal(result.actionLagRounds, 1);
  assert.deepEqual(result.manifest, { path: 'body-modules.json', scriptCount: 41 });

  const start = result.observations.find((entry) => entry.simMin === 0);
  const atNinety = result.observations.find((entry) => entry.simMin === 90);
  assert.equal(start['stomach.volumeMl'], 0);
  assert.ok(atNinety['bodyFluid.waterVolumeMl'] > start['bodyFluid.waterVolumeMl']);
  for (const entry of result.observations) {
    assert.ok(
      entry['thermoregulation.coreTemperatureC'] >= 36.5
        && entry['thermoregulation.coreTemperatureC'] <= 37.5,
      `expected coreTemperatureC near 37°C at simMin ${entry.simMin}, got ${entry['thermoregulation.coreTemperatureC']}`,
    );
  }
});
