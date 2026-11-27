import assert from 'node:assert/strict';
import test from 'node:test';
import { heartbeat as endocrine } from '../organs/human-organs/brain/hypothalamus-endocrine.ts';
import { sweatRequestMl } from '../organs/human-organs/skin/sweat.ts';

const thermal = Object.freeze({
  baselineCoreC: 32, normalCoreMinC: 31.5, normalCoreMaxC: 32.5,
  ambientComfortMinC: null, ambientComfortMaxC: null,
});

test('exercise sweating has no fixed 37 °C floor', () => {
  const sweat = sweatRequestMl({
    remainingExerciseMin: 1, intensity: 1, dtMin: 1, ambientTemperatureC: 25,
    baselineCoreC: 32, coreTemperatureC: 33, setpointC: 32,
  });
  assert.equal(sweat, 5.6);
});

test('TRH uses the static reference as a fallback for a missing dynamic target', () => {
  function trh(state) {
    let output;
    endocrine({
      read: (partId) => partId === 'thermoregulation' ? state : undefined,
      getThermalProfile: () => thermal,
      dt: 60, actions: [], write: (next) => { output = next; },
    });
    return output.trhRelative;
  }
  assert.equal(trh({ coreTemperatureC: 32 }), 1);
  assert.equal(trh({ coreTemperatureC: 31.4, setpointC: 31.5 }), 1);
  assert.ok(trh({ coreTemperatureC: 31.1, setpointC: 31.5 }) > 1);
});
