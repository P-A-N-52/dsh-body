import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpoint, launch } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const now = 600_000;
const modules = Object.fromEntries(['climate', 'clothing'].map((id) => [
  `${id}.ts`, `export * from '${new URL(`../organs/body-inputs/${id}.ts`, import.meta.url)}';`,
]));
const legacySkin = 'skin.sweat.ambientTemperatureC';
const legacyThermo = 'thermoregulation.ambientTemperatureC';
const defaults = { airTemperatureC: 25, relativeHumidityPct: 50 };

function boot(t, options = {}) {
  const { gatewayOptions, ...rest } = options;
  return launch(t, { modules, ...rest, gatewayOptions: { now: () => now, ...gatewayOptions } });
}

const environment = (id, airTemperatureC, relativeHumidityPct) => ({
  id, type: 'set_environment', airTemperatureC, relativeHumidityPct,
});
const layer = (id, type, layerId) => ({ id, type, layerId });
const parts = (body) => body.gateway.getState().parts;

async function post(body, payload, status = 202) {
  const res = await body.post('/actions', payload);
  assert.equal(res.status, status, `${payload.id}: ${await res.clone().text()}`);
  return res.json();
}

async function tick(body) {
  assert.deepEqual(await body.tick(), { ran: true, failed: false });
}

test('a fresh body keeps both initial climate values from its enabled owner', async (t) => {
  const preset = { airTemperatureC: 16, relativeHumidityPct: 80 };
  const body = await boot(t, {
    modules: {
      ...modules,
      'climate.ts': `${modules['climate.ts']}\nexport const initialState = ${JSON.stringify(preset)};`,
    },
  });
  assert.equal(body.state().startup.hasSavedState, false);
  assert.deepEqual(parts(body).climate, preset);
  await tick(body);
  assert.deepEqual(parts(body).climate, preset);
});

test('only complete valid climate pairs take effect, last valid in queue order', async (t) => {
  const body = await boot(t);
  assert.deepEqual(parts(body).climate, defaults);
  for (const action of [
    environment('first', 16, 100),
    environment('last', 32, 0),
    environment('incomplete', 30),
    environment('string-temp', '18', 20),
    environment('too-humid', 22, 101),
    environment('negative-rh', 18, -1),
  ]) {
    // Omit the missing key exactly as a real HTTP JSON payload does.
    const receipt = await post(body, action);
    assert.equal(receipt.status, 'queued');
    assert.equal(receipt.effectiveAt, 60);
  }
  assert.deepEqual(parts(body).climate, defaults);
  await tick(body);
  assert.deepEqual(parts(body).climate, { airTemperatureC: 32, relativeHumidityPct: 0 });
  assert.equal(body.gateway.getReceipt('too-humid').status, 'applied');
  await post(body, environment('saturated', 21, 100));
  await tick(body);
  assert.deepEqual(parts(body).climate, { airTemperatureC: 21, relativeHumidityPct: 100 });
});

test('clothing is an ordered set, and restart keeps both committed inputs despite old overrides', async (t) => {
  const body = await boot(t, { seed: { ...checkpoint({ wallTimeMs: now }), parameters: { [legacyThermo]: 28 } } });
  await post(body, environment('cool-room', 16, 50));
  for (const action of [
    layer('short-sleeves', 'wear_layer', 'tshirt'),
    layer('coat-1', 'wear_layer', 'jacket'),
    layer('coat-2', 'wear_layer', 'jacket'),
    layer('unknown', 'wear_layer', 'toString'),
    layer('missing', 'remove_layer'),
    layer('off', 'remove_layer', 'jacket'),
    layer('off-again', 'remove_layer', 'jacket'),
    layer('coat-3', 'wear_layer', 'jacket'),
  ]) await post(body, action);
  await tick(body);
  assert.deepEqual(parts(body).clothing.wornLayerIds, ['tshirt', 'jacket']);

  const original = await post(body, layer('coat-1', 'wear_layer', 'jacket'), 200);
  assert.equal(original.status, 'applied');
  assert.equal(original.appliedAtSimulatedSeconds, 60);
  await post(body, layer('coat-1', 'remove_layer', 'jacket'), 409);
  await body.gateway.stop();

  const restarted = await boot(t, { statePath: body.statePath });
  assert.deepEqual(parts(restarted).climate, { airTemperatureC: 16, relativeHumidityPct: 50 });
  assert.deepEqual(parts(restarted).clothing.wornLayerIds, ['tshirt', 'jacket']);
  await post(restarted, layer('coat-off', 'remove_layer', 'jacket'));
  await tick(restarted);
  assert.deepEqual(parts(restarted).clothing.wornLayerIds, ['tshirt']);
  assert.deepEqual(await post(restarted, layer('coat-1', 'wear_layer', 'jacket'), 200), original);
  await tick(restarted);
  assert.deepEqual(parts(restarted).clothing.wornLayerIds, ['tshirt']);
});

test('new climate and clothing actions use the existing paused and session binding gates', async (t) => {
  const seed = checkpoint({ wallTimeMs: now });
  const paused = await boot(t, { seed: { ...seed, active: false } });
  await post(paused, environment('paused', 16, 50), 409);
  const dormant = await boot(t, { seed, gatewayOptions: { requireBinding: true } });
  await post(dormant, environment('dormant', 16, 50), 409);
  await dormant.gateway.bindSession('owner');
  await post(dormant, { ...environment('wrong-session', 16, 50), sessionId: 'other' }, 403);
  await post(dormant, layer('missing-session', 'wear_layer', 'jacket'), 403);
  const { body_act } = createBodyTools(dormant.gateway);
  const reply = await body_act.execute(
    { type: 'set_environment', airTemperatureC: 16, relativeHumidityPct: 50 },
    { sessionId: 'owner', callId: 'scene-1' },
  );
  assert.equal(reply.statusCode, 202);
  await post(dormant, { ...layer('owner-coat', 'wear_layer', 'jacket'), sessionId: 'owner' });
  await tick(dormant);
  assert.deepEqual(parts(dormant).climate, { airTemperatureC: 16, relativeHumidityPct: 50 });
  assert.deepEqual(parts(dormant).clothing.wornLayerIds, ['jacket']);
});

test('old climate saves fill only missing keys with the specified override precedence', async (t) => {
  for (const [label, overrides, savedParts, expected, conflict] of [
    ['without overrides', { [legacySkin]: null }, {}, defaults],
    ['skin only', { [legacySkin]: 31 }, {}, { airTemperatureC: 31, relativeHumidityPct: 50 }],
    ['thermo only', { [legacyThermo]: 17 }, {}, { airTemperatureC: 17, relativeHumidityPct: 50 }],
    ['same', { [legacySkin]: 19, [legacyThermo]: 19 }, {}, { airTemperatureC: 19, relativeHumidityPct: 50 }],
    ['conflict', { [legacySkin]: 31, [legacyThermo]: 18 }, { climate: { relativeHumidityPct: 0 } },
      { airTemperatureC: 18, relativeHumidityPct: 0 },
      { skinAirTemperatureC: 31, thermoregulationAirTemperatureC: 18, selectedAirTemperatureC: 18 }],
    ['already saved', { [legacySkin]: 31, [legacyThermo]: 18 },
      { climate: { airTemperatureC: 0 }, clothing: { wornLayerIds: ['tshirt'] } },
      { airTemperatureC: 0, relativeHumidityPct: 50 }],
  ]) {
    const preserved = { thermoregulation: { coreTemperatureC: 38.2 }, skin: { sweatVolumeMl: 1.75 }, bodyFluid: { waterVolumeMl: 29900 } };
    const saved = checkpoint({ wallTimeMs: now, simulatedSeconds: 360, parts: { ...preserved, ...savedParts } });
    const body = await boot(t, { seed: { ...saved, parameters: overrides } });
    assert.deepEqual(parts(body), {
      ...preserved, climate: expected, clothing: savedParts.clothing ?? { wornLayerIds: [] },
    }, label);
    assert.equal(body.gateway.getState().simulatedSeconds, 360, label);
    assert.equal(body.state().wallTimeMs, now, label);
    assert.deepEqual(body.state().parameters, overrides, label);
    assert.deepEqual(body.state().startup.climateTemperatureMigration, conflict, label);
  }
});

test('old climate is resolved before the first startup catch-up round', async (t) => {
  const body = await boot(t, {
    seed: { ...checkpoint({ wallTimeMs: now - 25 }), parameters: { [legacyThermo]: 16 } },
    catchUpMinutes: 1,
    modules: {
      ...modules,
      'observer.mjs': `
        export const id = 'observer';
        export const initialState = { airTemperatureC: null };
        export const fields = { airTemperatureC: { unit: '°C', mode: 'absolute' } };
        export function heartbeat(io) { io.write({ airTemperatureC: io.read('climate')?.airTemperatureC ?? null }); }
      `,
    },
  });
  assert.equal(body.state().startup.caughtUpSeconds, 60);
  assert.equal(parts(body).observer.airTemperatureC, 16);
});

test('a failed batch commits no input; startup retries it once before later queued actions', async (t) => {
  const body = await boot(t, {
    modules: {
      ...modules,
      'failure.mjs': `
        export const id = 'failure';
        export const fields = {};
        export function heartbeat() { throw new Error('ordinary heartbeat failure'); }
      `,
    },
  });
  await post(body, environment('pending-room', 32, 90));
  await post(body, layer('pending-coat', 'wear_layer', 'jacket'));
  const inFlight = body.tick();
  assert.equal(body.gateway.getHealth().heartbeat.inFlight, true);
  const late = body.gateway.submitAction(environment('later-room', 16, 50));
  assert.equal(late.statusCode, 202);
  assert.equal(late.body.effectiveAt, 120);
  assert.deepEqual(await inFlight, { ran: true, failed: true });
  assert.deepEqual(parts(body).climate, defaults);
  assert.deepEqual(parts(body).clothing.wornLayerIds, []);
  assert.equal(body.state().activeBatch.targetSimulatedSeconds, 60);
  assert.equal(body.gateway.getReceipt('pending-room').attempts, 1);
  await body.gateway.stop();

  const resumed = await boot(t, {
    statePath: body.statePath,
    catchUpMinutes: 1,
    gatewayOptions: { now: () => now + 25 },
  });
  assert.equal(resumed.state().startup.caughtUpSeconds, 60);
  assert.deepEqual(parts(resumed).climate, { airTemperatureC: 32, relativeHumidityPct: 90 });
  assert.deepEqual(parts(resumed).clothing.wornLayerIds, ['jacket']);
  const repeat = await post(resumed, environment('pending-room', 32, 90), 200);
  assert.equal(repeat.appliedAtSimulatedSeconds, 60);
  assert.equal(repeat.attempts, 1);
  await tick(resumed);
  assert.deepEqual(parts(resumed).climate, { airTemperatureC: 16, relativeHumidityPct: 50 });
  assert.deepEqual(resumed.state().pendingActionIds, []);
});
