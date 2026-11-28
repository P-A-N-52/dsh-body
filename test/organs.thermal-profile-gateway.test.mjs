import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startGateway } from '../gateway.js';
import { checkpoint, makeTempDir } from '../test-support/harness.mjs';

const rootUrl = new URL('../body-modules.json', import.meta.url);
const rootManifest = JSON.parse(readFileSync(rootUrl, 'utf8'));
const fixedStart = Date.UTC(2026, 0, 1, 12);
const lowCore = {
  'thermoregulation.setpointC': 32,
  'thermoregulation.normalCoreMinC': 31.5,
  'thermoregulation.normalCoreMaxC': 32.5,
};
const lowReference = {
  baselineCoreC: 32, coreBandRelative: true, normalCoreMinC: 31.5, normalCoreMaxC: 32.5,
  ambientComfortMinC: null, ambientComfortMaxC: null,
};
const humanReference = {
  baselineCoreC: 37, coreBandRelative: false, normalCoreMinC: 37, normalCoreMaxC: 37,
  ambientComfortMinC: null, ambientComfortMaxC: null,
};

const sample = `
  export const id = 'thermalSample';
  export const initialState = { coreC: 32.25, airC: -2 };
  export const fields = {
    coreC: { unit: '°C', mode: 'absolute' }, airC: { unit: '°C', mode: 'absolute' },
  };
  export function heartbeat() {}
`;
const report = `
  export const id = 'thermalReport';
  export const initialState = { reference: null, frozen: false, coreInRange: null, airInRange: null };
  export const fields = {
    reference: { unit: 'record', mode: 'absolute' }, frozen: { unit: '1', mode: 'absolute' },
    coreInRange: { unit: '1', mode: 'absolute' }, airInRange: { unit: '1', mode: 'absolute' },
  };
  export function heartbeat(io) {
    const reference = io.getThermalProfile?.();
    if (!reference) return; // Allow the physiology regressions below to run against the pre-contract Gateway.
    const core = io.read('thermoregulation')?.coreTemperatureC ?? io.read('thermalSample')?.coreC;
    const air = io.functions ? io.functions.airC() : (io.read('thermalSample')?.airC ?? io.read('climate')?.airTemperatureC);
    const { normalCoreMinC, normalCoreMaxC, ambientComfortMinC, ambientComfortMaxC } = reference;
    io.write({
      reference,
      frozen: Object.isFrozen(reference) && !Reflect.set(reference, 'baselineCoreC', 90),
      coreInRange: Number.isFinite(core) ? core >= normalCoreMinC && core <= normalCoreMaxC : null,
      airInRange: Number.isFinite(air) && ambientComfortMinC !== null && ambientComfortMaxC !== null
        ? air >= ambientComfortMinC && air <= ambientComfortMaxC : null,
    });
  }
`;

function fixture(t, {
  human = false,
  thermalDefaults,
  modules = { 'report.mjs': report },
  entries = Object.keys(modules),
} = {}) {
  const dir = makeTempDir();
  const gateways = [];
  t.after(async () => {
    await Promise.all(gateways.map((gateway) => gateway.stop()));
    rmSync(dir, { recursive: true, force: true });
  });
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, () => {});

  function external(path) {
    return relative(dir, fileURLToPath(new URL(path, rootUrl)));
  }

  for (const [path, source] of Object.entries(modules)) writeFileSync(join(dir, path), source);
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: human ? rootManifest.startupScripts.map(external) : [],
    scripts: [...(human ? rootManifest.scripts.map(external) : []), ...entries],
    thermalDefaults,
    catchUpMinutes: 5,
  }));
  let clock = fixedStart;

  function seed(name, { parts, parameters, version = 2 } = {}) {
    const statePath = join(dir, `${name}.json`);
    const initial = {
      ...checkpoint({ wallTimeMs: clock, profile: { timezoneOffsetMin: 0 }, parts }),
      boundSessionId: name,
      parameters,
    };
    if (version === 1) {
      Object.assign(initial, { schemaVersion: 1, pendingActions: [], receipts: {} });
    }
    writeFileSync(statePath, JSON.stringify(initial));
    return statePath;
  }

  function open(statePath) {
    const gateway = startGateway({ manifestPath, statePath, port: 0, autoTick: false, now: () => clock });
    gateways.push(gateway);
    return gateway;
  }

  async function start(statePath) {
    const gateway = open(statePath);
    await gateway.ready;
    return gateway;
  }

  async function advance(...bodies) {
    clock += 60_000;
    for (const outcome of await Promise.all(bodies.map((body) => body.tick()))) {
      assert.deepEqual(outcome, { ran: true, failed: false });
    }
    return bodies.map((body) => body.getState().parts);
  }

  return { seed, open, start, advance };
}

function assertNear(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
}

function assertQuietThermal(parts, gateway) {
  assert.equal(parts.interoception.coldMm, 0);
  assert.ok(parts.interoception.heatMm < 10);
  assert.equal(parts.sleep.sleeping, false);
  assert.equal(parts.sleep.wakeEvent, 'none');
  assert.ok(parts.autonomic.sympatheticMm < 1);
  assert.equal(parts.skin.sweatRequestMl, 0);
  assertNear(parts.lungsVentilation.ventilationMlMin, 6000, 1);
  assert.ok(!gateway.getNotifications().some(({ mode, text }) => mode === 'wake' || /发凉|冰冷|燥热|滚烫/u.test(text)));
}

test('the same human manifest and report run a legacy body and a quiet 32 °C body, with no actions', async (t) => {
  const f = fixture(t, { human: true });
  const humanPath = f.seed('human', { version: 1 });
  const lowPath = f.seed('low', { parameters: lowCore });
  const [human, low] = await Promise.all([f.start(humanPath), f.start(lowPath)]);
  assert.equal(human.getState().parts.thermoregulation.coreTemperatureC, 37);
  assert.equal(low.getState().parts.thermoregulation.coreTemperatureC, 32);
  for (let i = 0; i < 10; i++) {
    const [a, b] = await f.advance(human, low);
    assertQuietThermal(a, human);
    assertQuietThermal(b, low);
    assert.deepEqual(a.thermalReport.reference, humanReference);
    assert.deepEqual(b.thermalReport.reference, lowReference);
    assert.equal(b.thermalReport.coreInRange, true);
    assert.equal(a.thermalReport.airInRange, null);
    assert.equal(b.thermalReport.airInRange, null);
  }
  assert.equal(JSON.parse(readFileSync(humanPath)).schemaVersion, 2);
  t.diagnostic(JSON.stringify([human, low].map((gateway) => {
    const { interoception, thermoregulation, sleep } = gateway.getState().parts;
    return { coreC: thermoregulation.coreTemperatureC, coldMm: interoception.coldMm, wake: sleep.wakeEvent };
  })));
});

test('standalone ordinary and DI heartbeats resolve presets and sparse overrides without a human organ', async (t) => {
  const f = fixture(t, {
    thermalDefaults: {
      'thermoregulation.setpointC': 32.5,
      'thermoregulation.normalCoreMinC': 31.5,
      'thermoregulation.ambientComfortMinC': -5,
      'thermoregulation.ambientComfortMaxC': 24,
    },
    modules: {
      'report.mjs': report,
      'report-di.mjs': `export { heartbeat, fields, initialState } from './report.mjs'; export const id = 'diReport';`,
      'sample.mjs': sample,
    },
    entries: ['report.mjs', { path: 'report-di.mjs', inject: { airC: ['thermalSample', 'airC'] } }, 'sample.mjs'],
  });
  const left = await f.start(f.seed('combined', {
    parameters: {
      'thermoregulation.setpointC': 32,
      'thermoregulation.normalCoreMinC': null,
      'thermoregulation.ambientComfortMinC': 0,
    },
    parts: { thermalSample: { coreC: 31.75 } },
  }));
  const right = await f.start(f.seed('preset'));
  const [a, b] = await f.advance(left, right);
  for (const parts of [a, b]) {
    assert.equal(parts.thermoregulation, undefined);
    assert.deepEqual(parts.diReport, parts.thermalReport);
  }
  assert.deepEqual(a.thermalReport, {
    reference: { ...lowReference, normalCoreMaxC: 32, ambientComfortMinC: 0, ambientComfortMaxC: 24 },
    frozen: true, coreInRange: true, airInRange: false,
  });
  assert.deepEqual(b.thermalReport, {
    reference: { ...lowReference, baselineCoreC: 32.5, ambientComfortMinC: -5, ambientComfortMaxC: 24 },
    frozen: true, coreInRange: true, airInRange: true,
  });
});

test('only an active body with an invalid effective interval fails boot, before loading scripts or catching up', async (t) => {
  const f = fixture(t, {
    thermalDefaults: { 'thermoregulation.normalCoreMinC': 36, 'thermoregulation.normalCoreMaxC': 38 },
    modules: { 'not-loaded.mjs': `throw new Error('script imported before thermal validation');` },
  });
  for (const [label, parameters, field] of [
    ['inverted-core', { 'thermoregulation.normalCoreMaxC': 35 }, /thermoregulation\.normalCoreMinC.*thermoregulation\.normalCoreMaxC/u],
    ['excludes-base', { 'thermoregulation.setpointC': 32 }, /thermoregulation\.setpointC.*thermoregulation\.normalCoreMinC/u],
    ['missing-air-max', { 'thermoregulation.ambientComfortMinC': 0 }, /thermoregulation\.ambientComfortMaxC/u],
    ['inverted-air', { 'thermoregulation.ambientComfortMinC': 19, 'thermoregulation.ambientComfortMaxC': 12 }, /thermoregulation\.ambientComfortMinC.*thermoregulation\.ambientComfortMaxC/u],
  ]) {
    const path = f.seed(label, { parameters });
    const saved = readFileSync(path, 'utf8');
    await assert.rejects(f.open(path).ready, (error) => field.test(error.message) && !error.message.includes('script imported'));
    assert.equal(readFileSync(path, 'utf8'), saved);
  }
});

test('the real thermal owner seeds a manifest baseline exactly as the script reads it; explicit null remains invalid', async (t) => {
  const f = fixture(t, { human: true, thermalDefaults: { 'thermoregulation.setpointC': 32 } });
  // An explicit null must fail even when the manifest has a valid preset.
  await assert.rejects(f.open(f.seed('unset', {
    parameters: { 'thermoregulation.setpointC': null },
  })).ready, /thermoregulation\.setpointC.*unset/u);
  const gateway = await f.start(f.seed('inherited'));
  assert.equal(gateway.getState().parts.thermoregulation.coreTemperatureC, 32);
  const [parts] = await f.advance(gateway);
  assert.equal(parts.thermalReport.reference.baselineCoreC, 32);
  assert.equal(parts.thermalReport.reference.normalCoreMinC, 32);
  assert.equal(parts.thermalReport.reference.normalCoreMaxC, 32);
  assert.ok(parts.thermoregulation.setpointC > 32 && parts.thermoregulation.setpointC < 32.25);
});

test('manifest thermal defaults reject malformed presets and misspelled parameter ids', (t) => {
  const f = fixture(t, { thermalDefaults: { 'thermoregulation.baselineCoreC': 32 } });
  assert.throws(() => f.open(f.seed('bad-key')), /thermalDefaults.*thermoregulation\.baselineCoreC/u);
});

const flatLowCore = { ...lowCore, 'thermoregulation.circadianAmplitudeC': 0 };
const atCore = (coreTemperatureC) => ({ thermoregulation: { coreTemperatureC } });

test('a low-baseline human model still feels and defends against departures, then recovers without a clamp', async (t) => {
  const f = fixture(t, { human: true });
  const cold = await f.start(f.seed('chilled', { parameters: flatLowCore, parts: atCore(31) }));
  const warm = await f.start(f.seed('heated', { parameters: flatLowCore, parts: atCore(33.5) }));
  const [a, b] = await f.advance(cold, warm);
  assert.equal(a.interoception.coldMm, 25);
  assert.equal(a.interoception.heatMm, 0);
  assert.equal(b.interoception.coldMm, 0);
  assert.equal(b.interoception.heatMm, 50);
  assert.ok(a.autonomic.sympatheticMm > 1);
  assert.ok(a.hypothalamusEndocrine.trhRelative > 1);
  assert.equal(a.skin.sweatRequestMl, 0);
  assertNear(b.skin.sweatRequestMl, 6.25);
  assertNear(b.lungsVentilation.ventilationMlMin, 7050.034285910205);
  assert.ok(a.thermoregulation.coreTemperatureC > 31 && a.thermoregulation.coreTemperatureC < 31.5);
  assert.ok(b.thermoregulation.coreTemperatureC < 33.5 && b.thermoregulation.coreTemperatureC > 32.5);

  let [c, d] = [a, b];
  for (let i = 0; i < 20; i++) [c, d] = await f.advance(cold, warm);
  assert.ok(c.thermoregulation.coreTemperatureC > a.thermoregulation.coreTemperatureC);
  assert.ok(d.thermoregulation.coreTemperatureC < b.thermoregulation.coreTemperatureC);
  assert.ok(c.interoception.coldMm < a.interoception.coldMm);
  assert.ok(d.interoception.heatMm < b.interoception.heatMm);
  assert.equal(d.interoception.coldMm, 0);
});

test('a range-only edit on restart changes the sensation, not saved core temperature, stock, or the other body', async (t) => {
  const f = fixture(t, { human: true });
  const parts = { ...atCore(32.375), bodyFluid: { waterVolumeMl: 29995 } };
  const changedPath = f.seed('edited', { parameters: flatLowCore, parts });
  const [control, original] = await Promise.all([
    f.start(f.seed('control', { parameters: flatLowCore, parts })), f.start(changedPath),
  ]);
  const [a, b] = await f.advance(control, original);
  assert.equal(a.interoception.heatMm, 0);
  assert.equal(b.interoception.heatMm, 0);
  assertNear(b.skin.sweatRequestMl, 0.625); // rest daytime band is +0.25, not the +0.45 night band
  await original.stop();

  const saved = JSON.parse(readFileSync(changedPath, 'utf8'));
  const newUpperC = 32.25;
  saved.parameters['thermoregulation.normalCoreMaxC'] = newUpperC;
  writeFileSync(changedPath, JSON.stringify(saved));
  const changed = await f.start(changedPath);
  assert.deepEqual(changed.getState().parts.thermoregulation, b.thermoregulation);
  assert.equal(changed.getState().parts.bodyFluid.waterVolumeMl, b.bodyFluid.waterVolumeMl);
  const [c, d] = await f.advance(control, changed);
  assert.deepEqual(c.thermalReport.reference, lowReference);
  assert.deepEqual(d.thermalReport.reference, { ...lowReference, normalCoreMaxC: newUpperC });
  assert.equal(c.interoception.heatMm, 0);
  assertNear(d.interoception.heatMm, 50 * (b.thermoregulation.coreTemperatureC - newUpperC));
  assert.equal(d.interoception.coldMm, 0);
  for (const id of ['thermoregulation', 'skin', 'bodyFluid', 'lungsVentilation']) assert.deepEqual(d[id], c[id]);
});

test('explicit local sensation and autonomic cold thresholds remain intentional individual overrides', async (t) => {
  const f = fixture(t, { human: true });
  const body = await f.start(f.seed('local', { parameters: {
    ...flatLowCore,
    'interoception.thermoregulation.setpointC': 32.75,
    'autonomic.coldThresholdC': 32.4,
  } }));
  const [parts] = await f.advance(body);
  // Normal bounds are offsets around the explicit sensation reference; the awake autonomic threshold is absolute.
  assertNear(parts.interoception.coldMm, 12.5);
  assert.ok(parts.autonomic.sympatheticMm > 1 && parts.autonomic.sympatheticMm < 10);
  assert.deepEqual(parts.thermalReport.reference, lowReference);
});

test('a pre-contract 36.7 °C archive keeps the main trajectories until a core band is set', async (t) => {
  const f = fixture(t, { human: true });
  const base = { 'thermoregulation.setpointC': 36.7, 'thermoregulation.circadianAmplitudeC': 0 };
  const seedParts = { thermoregulation: { coreTemperatureC: 37.93, setpointC: 36.7 } };
  const legacy = await f.start(f.seed('legacy-36', { parameters: base, parts: seedParts }));
  const relative = await f.start(f.seed('relative-36', { parameters: {
    ...base, 'thermoregulation.normalCoreMinC': 36.2, 'thermoregulation.normalCoreMaxC': 37.2,
  }, parts: seedParts }));
  const airOnly = await f.start(f.seed('air-only-36', { parameters: {
    ...base, 'thermoregulation.ambientComfortMinC': 10, 'thermoregulation.ambientComfortMaxC': 26,
  }, parts: seedParts }));
  const [x, y, z] = await f.advance(legacy, relative, airOnly);
  assert.equal(x.thermalReport.reference.coreBandRelative, false);
  assert.equal(y.thermalReport.reference.coreBandRelative, true);
  assert.equal(z.thermalReport.reference.coreBandRelative, false);
  assertNear(x.interoception.heatMm, 50 * (37.93 - 37)); // main: fixed 37 sensation reference
  assertNear(y.interoception.heatMm, 50 * (37.93 - 37.2)); // band offset 37.2 − 36.7 above the dynamic target
  assertNear(z.interoception.heatMm, x.interoception.heatMm);
  assertNear(x.skin.sweatRequestMl, 3.9); // setpointC < 37 picks the night band 36.7 + 0.45
  assertNear(y.skin.sweatRequestMl, 4.9); // setpointC = B picks the interthreshold band 36.7 + 0.25
  assertNear(z.skin.sweatRequestMl, x.skin.sweatRequestMl);
  assertNear(x.lungsVentilation.ventilationMlMin, 6195.034285910205); // max(37, 36.7) + 0.8
  assertNear(y.lungsVentilation.ventilationMlMin, 6645.034285910205); // max(36.7, 36.7) + 0.8
  assertNear(z.lungsVentilation.ventilationMlMin, x.lungsVentilation.ventilationMlMin);
  // The air-only body still reads its comfort band for its own judgments while consumers stay legacy.
  assert.equal(z.thermalReport.airInRange, true);
  assert.equal(z.thermalReport.coreInRange, false);
});
