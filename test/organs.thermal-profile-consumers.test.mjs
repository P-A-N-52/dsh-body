import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { heartbeat as endocrine } from '../organs/human-organs/brain/hypothalamus-endocrine.ts';
import { sweatRequestMl } from '../organs/human-organs/skin/sweat.ts';

const thermal = Object.freeze({
  baselineCoreC: 32, coreBandRelative: true, normalCoreMinC: 31.5, normalCoreMaxC: 32.5,
  ambientComfortMinC: null, ambientComfortMaxC: null,
});
const legacyThermal = Object.freeze({
  baselineCoreC: 32, coreBandRelative: false, normalCoreMinC: 32, normalCoreMaxC: 32,
  ambientComfortMinC: null, ambientComfortMaxC: null,
});

test('exercise sweating has no fixed 37 °C floor', () => {
  const sweat = sweatRequestMl({
    remainingExerciseMin: 1, intensity: 1, dtMin: 1, ambientTemperatureC: 25,
    baselineCoreC: 32, coreTemperatureC: 33, setpointC: 32,
  });
  assert.equal(sweat, 5.6);
});

test('legacy sweat keeps the fixed 37 °C floor the main gateway used', () => {
  const sweat = sweatRequestMl({
    remainingExerciseMin: 1, intensity: 1, dtMin: 1, ambientTemperatureC: 25,
    baselineCoreC: 32, coreBandRelative: false, coreTemperatureC: 33, setpointC: 32,
  });
  assert.equal(sweat, 0.6); // thermal rate = 5 × max(0, 33 − max(37, 32)) = 0; only the exercise request remains
});

test('TRH uses the static reference as a fallback for a missing dynamic target', () => {
  function trh(state, profile = thermal) {
    let output;
    endocrine({
      read: (partId) => partId === 'thermoregulation' ? state : undefined,
      getThermalProfile: () => profile,
      dt: 60, actions: [], write: (next) => { output = next; },
    });
    return output.trhRelative;
  }
  assert.equal(trh({ coreTemperatureC: 32 }), 1);
  assert.equal(trh({ coreTemperatureC: 31.4, setpointC: 31.5 }), 1);
  assert.ok(trh({ coreTemperatureC: 31.1, setpointC: 31.5 }) > 1);
  // legacy mode keeps the main fixed-37 reference: the same reading that is quiet in relative mode drives TRH.
  assert.ok(trh({ coreTemperatureC: 32 }, legacyThermal) > 1);
  assert.ok(trh({ coreTemperatureC: 36.5 }, legacyThermal) > 1);
});

test('the brain README catalog documents the thermal reference ids as consumed', () => {
  const readme = readFileSync(new URL('../organs/human-organs/brain/README.md', import.meta.url), 'utf8');
  for (const id of [
    'thermoregulation.normalCoreMinC', 'thermoregulation.normalCoreMaxC',
    'thermoregulation.ambientComfortMinC', 'thermoregulation.ambientComfortMaxC',
  ]) {
    const row = readme.split('\n').find((line) => line.includes(`\`${id}\``) && line.startsWith('| `'));
    assert.ok(row, `${id} must have a catalog row`);
    assert.match(row, /io\.getThermalProfile/u, `${id} row must name the consumption channel`);
    assert.doesNotMatch(row, /只登记/u, `${id} row must not be marked unread`);
  }
  const localRow = readme.split('\n')
    .find((line) => line.includes('`interoception.thermoregulation.setpointC`') && line.startsWith('| `'));
  assert.ok(localRow, 'local sensation setpoint must have a catalog row');
  assert.doesNotMatch(localRow, /只登记/u, 'local sensation setpoint row must not be marked unread');
});
