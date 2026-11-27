import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { makeTempDir } from '../test-support/harness.mjs';

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

test('manifest replay runs the full 47-script water scenario without fatal operation errors', () => {
  const output = execFileSync(
    process.execPath,
    ['tools/replay.mjs', '--manifest', 'body-modules.json', 'scenarios/m1-water-240.json'],
    { cwd: root, encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  assert.equal(result.scenario, 'm1-water-240');
  assert.equal(result.actionLagRounds, 1);
  assert.deepEqual(result.manifest, { path: 'body-modules.json', scriptCount: 47 });

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
  assert.deepEqual(result.manifest, { path: 'body-modules.json', scriptCount: 47 });

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

test('manifest replay exposes the same frozen thermal preset to an independent heartbeat', (t) => {
  const dir = makeTempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifest = join(dir, 'manifest.json');
  const scenario = join(dir, 'scenario.json');
  writeFileSync(manifest, JSON.stringify({
    scripts: [{ path: './thermal.mjs', inject: {} }],
    thermalDefaults: { 'thermoregulation.setpointC': 32, 'thermoregulation.normalCoreMaxC': 32.75 },
  }));
  writeFileSync(scenario, JSON.stringify({
    id: 'thermal', protocol: { actions: [] },
    observe: { atMin: [1], signals: ['report.upperMarginC', 'report.ambientComfortMaxC'] },
  }));
  writeFileSync(join(dir, 'thermal.mjs'), `
    export const id = 'report';
    export const initialState = { upperMarginC: null, ambientComfortMaxC: null };
    export const fields = {
      upperMarginC: { unit: '°C', mode: 'absolute' }, ambientComfortMaxC: { unit: '°C', mode: 'absolute' },
    };
    export function heartbeat(io) {
      const config = io.getThermalProfile();
      if (!Object.isFrozen(config)) throw new Error('mutable thermal config');
      io.write({ upperMarginC: config.normalCoreMaxC - config.baselineCoreC,
        ambientComfortMaxC: config.ambientComfortMaxC });
    }
  `);
  const result = JSON.parse(execFileSync(process.execPath, ['tools/replay.mjs', '--manifest', manifest, scenario], {
    cwd: root, encoding: 'utf8',
  }));
  assert.deepEqual(result.observations[1], {
    simMin: 1, 'report.upperMarginC': 0.75, 'report.ambientComfortMaxC': null,
  });
});
