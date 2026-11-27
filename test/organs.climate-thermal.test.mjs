import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch, makeTempDir } from '../test-support/harness.mjs';

const manifestUrl = new URL('../body-modules.json', import.meta.url);
const engineScripts = JSON.parse(readFileSync(manifestUrl, 'utf8')).scripts;
const fixedStart = Date.UTC(2026, 0, 1, 12);
const roundMs = 60_000;
const flatSetpoint = { 'thermoregulation.circadianAmplitudeC': 0 };
const evaporationFixture = {
  ...flatSetpoint,
  'thermoregulation.evaporationReferenceTemperatureC': 32,
  'thermoregulation.evaporationConductanceMlMinPerKpa': 1,
};

async function start(t, {
  parts = {}, parameters = flatSetpoint, extras = {}, statePath, seed, now = fixedStart,
  catchUpMinutes = 0, withStartupReset = false,
} = {}) {
  let clock = now;
  const useRealManifest = !withStartupReset && Object.keys(extras).length === 0;
  const modules = useRealManifest ? {} : {
    ...Object.fromEntries(engineScripts.map((entry, i) => [
      `real-${i}.ts`, `export * from '${new URL(entry, manifestUrl)}';`,
    ])),
    ...extras,
  };
  const dir = withStartupReset ? makeTempDir() : undefined;
  if (dir) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const startupScripts = dir ? [relative(dir, fileURLToPath(new URL('../startup/reset-parts.js', import.meta.url)))] : [];
  const body = await launch(t, {
    dir, startupScripts, modules, statePath, catchUpMinutes, heartbeatIntervalMs: roundMs,
    seed: statePath || seed === null ? null : (seed ?? {
      ...checkpoint({ wallTimeMs: now, parts, profile: { timezoneOffsetMin: 0 } }), parameters,
    }),
    gatewayOptions: { now: () => clock, ...(useRealManifest && { manifestPath: fileURLToPath(manifestUrl) }) },
  });
  return {
    ...body,
    parts: () => body.gateway.getState().parts,
    async advance() {
      clock += roundMs;
      assert.deepEqual(await body.tick(), { ran: true, failed: false });
      return body.gateway.getState().parts;
    },
  };
}

const climate = (airTemperatureC, relativeHumidityPct) => ({ airTemperatureC, relativeHumidityPct });
const shirt = { wornLayerIds: ['tshirt'] };
const thermo = (coreTemperatureC, setpointC = 37) => ({ coreTemperatureC, setpointC });
const totalLoss = (balance) => balance.dryHeatLossKcal + balance.evaporativeHeatLossKcal;
const balanceOf = (parts) => parts.thermoregulation.heatBalance;
const coreOf = (parts) => parts.thermoregulation.coreTemperatureC;

function close(actual, expected, label, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${label}: ${actual} ≠ ${expected}`);
}

async function action(body, payload) {
  const response = await body.post('/actions', payload);
  assert.equal(response.status, 202, `${payload.id}: ${await response.clone().text()}`);
}

function scene(body, id, temperature, humidity) {
  return action(body, { id, type: 'set_environment', ...climate(temperature, humidity) });
}

function verifyHeatRound(before, after) {
  const balance = balanceOf(after);
  assert.ok(balance);
  assert.equal(balance.dtMin, 1);
  assert.equal(balance.coreTemperatureStartC, coreOf(before));
  assert.equal(balance.airTemperatureC, before.climate.airTemperatureC);
  assert.equal(balance.relativeHumidityPct, before.climate.relativeHumidityPct);
  assert.equal(balance.paidSweatMl, before.skin.sweatVolumeMl);
  assert.equal(balance.evaporatedSweatMl, Math.min(balance.paidSweatMl, balance.evaporationLimitMl));
  close(balance.evaporativeHeatLossKcal, balance.evaporatedSweatMl * 0.58, 'latent heat');
  close(balance.netHeatKcal, balance.metabolicHeatKcal + balance.shiveringHeatKcal - totalLoss(balance), 'net heat');
  assert.equal(balance.clamped, false);
  close(coreOf(after), coreOf(before) + balance.netHeatKcal / balance.heatCapacityKcalPerC, 'temperature integration');
  return balance;
}

test('legacy catch-up uses compatibility defaults instead of the new body scene preset', async (t) => {
  const extras = Object.fromEntries(Object.entries({
    './organs/body-inputs/climate.ts': climate(16, 80),
    './organs/body-inputs/clothing.ts': { wornLayerIds: ['jacket'] },
  }).map(([entry, initialState]) => [
    `real-${engineScripts.indexOf(entry)}.ts`,
    `export * from '${new URL(entry, manifestUrl)}';\nexport const initialState = ${JSON.stringify(initialState)};`,
  ]));

  await t.test('no checkpoint keeps both new body presets', async (t) => {
    const fresh = await start(t, { extras, seed: null });
    assert.equal(fresh.state().startup.hasSavedState, false);
    assert.deepEqual(fresh.parts().climate, climate(16, 80));
    assert.deepEqual(fresh.parts().clothing.wornLayerIds, ['jacket']);
  });

  for (const fixture of [
    { name: 'no saved climate or clothing', parts: {}, expected: climate(25, 50), layers: [] },
    { name: 'air only, with an interrupted batch', parts: { climate: { airTemperatureC: 21 } },
      expected: climate(21, 50), layers: [], retry: true },
    { name: 'saved zero humidity and empty layers', parts: { climate: climate(21, 0), clothing: { wornLayerIds: [] } },
      expected: climate(21, 0), layers: [] },
    { name: 'saved zero humidity, shirt, and conflicting old temperatures',
      parts: { climate: { relativeHumidityPct: 0 }, clothing: shirt },
      parameters: { 'skin.sweat.ambientTemperatureC': 31, 'thermoregulation.ambientTemperatureC': 18 },
      expected: climate(18, 0), layers: ['tshirt'] },
  ]) {
    await t.test(fixture.name, async (t) => {
      const wallTimeMs = fixedStart - roundMs;
      const seed = {
        ...checkpoint({
          wallTimeMs,
          simulatedSeconds: 360,
          parts: fixture.parts,
          profile: { timezoneOffsetMin: 0 },
          activeBatch: fixture.retry ? {
            id: 420, targetSimulatedSeconds: 420, targetWallTimeMs: fixedStart,
            actionIds: [], attempts: 1, lastError: 'ordinary failure', startedAtWallTimeMs: wallTimeMs,
          } : null,
        }),
        parameters: { ...flatSetpoint, ...fixture.parameters },
      };
      const stock = await start(t, { seed, catchUpMinutes: 1 });
      const preset = await start(t, { extras, seed, catchUpMinutes: 1 });
      for (const body of [stock, preset]) {
        assert.equal(body.state().startup.caughtUpSeconds, 60);
        assert.equal(body.gateway.getState().simulatedSeconds, 420);
        assert.equal(body.state().activeBatch, null);
      }
      const actual = preset.parts();
      const balance = balanceOf(actual);
      const stockDryHeatLossKcal = balanceOf(stock.parts()).dryHeatLossKcal;
      t.diagnostic(JSON.stringify({ climate: actual.climate, layers: actual.clothing.wornLayerIds,
        dryMultiplier: balance.dryExchangeMultiplier, evaporationMultiplier: balance.evaporationMultiplier,
        dryHeatLossKcal: balance.dryHeatLossKcal, stockDryHeatLossKcal }));
      assert.deepEqual(actual.climate, fixture.expected);
      assert.deepEqual(actual.clothing.wornLayerIds, fixture.layers);
      assert.equal(balance.airTemperatureC, fixture.expected.airTemperatureC);
      assert.equal(balance.relativeHumidityPct, fixture.expected.relativeHumidityPct);
      assert.equal(balance.dryExchangeMultiplier, fixture.layers.length ? 0.85 : 1);
      assert.equal(balance.evaporationMultiplier, fixture.layers.length ? 0.8 : 1);
      assert.equal(balance.dryHeatLossKcal, stockDryHeatLossKcal);
    });
  }
});

test('32 °C / 90% RH strictly caps the same paid sweat that fully evaporates at 35% RH', async (t) => {
  const parts = { skin: { sweatRequestMl: 2 }, physicalActivity: { intensity: 0.4, remainingExerciseMin: 6 } };
  const dry = await start(t, { parts, parameters: evaporationFixture });
  const humid = await start(t, { parts, parameters: evaporationFixture });
  await Promise.all([scene(dry, 'dry', 32, 35), scene(humid, 'humid', 32, 90)]);
  const [dryPaid, humidPaid] = await Promise.all([dry.advance(), humid.advance()]);
  assert.equal(coreOf(humidPaid), coreOf(dryPaid));
  assert.equal(dryPaid.skin.sweatRequestMl, 0.24);
  assert.equal(humidPaid.skin.sweatRequestMl, dryPaid.skin.sweatRequestMl);
  for (const paid of [dryPaid, humidPaid]) {
    assert.equal(paid.skin.sweatVolumeMl, 2);
    assert.equal(paid.bodyFluid.waterVolumeMl, 29998);
  }
  const [dryEnd, humidEnd] = await Promise.all([dry.advance(), humid.advance()]);
  const a = verifyHeatRound(dryPaid, dryEnd);
  const b = verifyHeatRound(humidPaid, humidEnd);
  assert.ok(b.evaporationLimitMl < 2 && a.evaporationLimitMl >= 2);
  assert.equal(a.evaporatedSweatMl, 2);
  close(b.evaporatedSweatMl, 0.475, '90% RH evaporation', 0.003);
  assert.ok(totalLoss(b) < totalLoss(a));
  assert.ok(coreOf(humidEnd) > coreOf(dryEnd));
  assert.equal(humidEnd.bodyFluid.waterVolumeMl, dryEnd.bodyFluid.waterVolumeMl);
  close(dryEnd.skin.sweatRequestMl, 0.3072, 'skin first reads new temperature after commit');
  t.diagnostic(JSON.stringify({ dry: a, humid: b, dryEndC: coreOf(dryEnd), humidEndC: coreOf(humidEnd) }));
});

test('cold room layering changes the next dry exchange without changing same-round temperature', async (t) => {
  const parts = { climate: climate(16, 50), clothing: shirt };
  // Keep both arms in net heat loss, including the better insulated arm.
  const parameters = { ...flatSetpoint, 'bloodOxygen.basalMlMin': 160 };
  const control = await start(t, { parts, parameters });
  const coat = await start(t, { parts, parameters });
  await action(coat, { id: 'on', type: 'wear_layer', layerId: 'jacket' });
  const [shirt1, coat1] = await Promise.all([control.advance(), coat.advance()]);
  assert.deepEqual(coat1.clothing.wornLayerIds, ['tshirt', 'jacket']);
  assert.deepEqual(coat1.thermoregulation, shirt1.thermoregulation);
  const [shirt2, coat2] = await Promise.all([control.advance(), coat.advance()]);
  const a = verifyHeatRound(shirt1, shirt2);
  const b = verifyHeatRound(coat1, coat2);
  assert.equal(a.paidSweatMl, 0);
  assert.equal(b.paidSweatMl, 0);
  close(b.dryExchangeMultiplier, 0.4675, 'dry layers multiply');
  close(b.evaporationMultiplier, 0.36, 'evaporation layers multiply separately');
  close(b.dryHeatLossKcal, a.dryHeatLossKcal * 0.55, 'dry insulation');
  assert.ok(coreOf(shirt2) < coreOf(coat2) && coreOf(coat2) < coreOf(coat1),
    `both must lose net heat: shirt ${a.netHeatKcal} kcal, coat ${b.netHeatKcal} kcal`);
  await action(coat, { id: 'off', type: 'remove_layer', layerId: 'jacket' });
  const coat3 = await coat.advance();
  assert.deepEqual(coat3.clothing.wornLayerIds, ['tshirt']);
  close(verifyHeatRound(coat2, coat3).dryExchangeMultiplier, 0.4675, 'removal still uses old layers');
  const coat4 = await coat.advance();
  close(verifyHeatRound(coat3, coat4).dryExchangeMultiplier, 0.85, 'removal changes the following round');
  t.diagnostic(JSON.stringify({ shirtLoss: a.dryHeatLossKcal, coatLoss: b.dryHeatLossKcal,
    cores: [coreOf(coat1), coreOf(shirt2), coreOf(coat2), coreOf(coat3), coreOf(coat4)] }));
});

test('open vasodilation cannot create an outward dry flux at equal or hotter air temperature', async (t) => {
  for (const [air, expected] of [[38, 0], [40, -0.29166733333333334]]) {
    const body = await start(t, { parts: { climate: climate(air, 50), thermoregulation: thermo(38) } });
    const before = body.parts();
    const after = await body.advance();
    const balance = verifyHeatRound(before, after);
    assert.ok(balance.vasodilationConductanceKcalMinPerC > 0);
    close(balance.dryHeatLossKcal, expected, 'signed dry exchange');
    assert.equal(balance.evaporativeHeatLossKcal, 0);
    t.diagnostic(`${air} °C air: dry ${balance.dryHeatLossKcal} kcal, core ${coreOf(after)} °C`);
  }
});

test('water-limited actual sweat is paid once even with zero evaporation capacity', async (t) => {
  const body = await start(t, {
    parameters: evaporationFixture,
    parts: {
      climate: climate(32, 100), skin: { sweatRequestMl: 2 }, bodyFluid: { waterVolumeMl: 0.75 },
      kidney: { urineProductionRequestMl: 0 },
    },
  });
  const paid = await body.advance();
  assert.equal(paid.bodyFluid.waterVolumeMl, 0);
  assert.equal(paid.skin.sweatVolumeMl, 0.75);
  await scene(body, 'vent-room', 32, 0);
  const saturated = await body.advance();
  const b = verifyHeatRound(paid, saturated);
  assert.equal(b.paidSweatMl, 0.75);
  assert.equal(b.evaporationLimitMl, 0);
  assert.equal(b.evaporativeHeatLossKcal, 0);
  assert.equal(saturated.skin.sweatVolumeMl, 0);
  const aired = await body.advance();
  const a = verifyHeatRound(saturated, aired);
  assert.ok(a.evaporationLimitMl > 0);
  assert.equal(a.evaporatedSweatMl, 0);
  assert.equal(aired.bodyFluid.waterVolumeMl, 0);
  t.diagnostic(`paid ${b.paidSweatMl} mL, evaporated ${b.evaporatedSweatMl} → ${a.evaporatedSweatMl} mL`);
});

const feverDrive = (heartbeat, initialOffsetC = 1, resetOnStart = []) => ({
  'fever.mjs': `
    export const id = 'feverDrive';
    export const initialState = { setpointOffsetC: ${initialOffsetC} };
    export const resetOnStart = ${JSON.stringify(resetOnStart)};
    export const fields = { setpointOffsetC: { unit: '°C', mode: 'absolute' } };
    export function heartbeat(io) { ${heartbeat} }
  `,
});
const provider = (offset, publicationRound = 60) => feverDrive(
  `if (io.simulatedSeconds === ${publicationRound}) io.write({ setpointOffsetC: ${offset} });`,
);
const adoptedOffsets = (rounds) => rounds.map(({ thermoregulation }) => thermoregulation.feverSetpointOffsetC);

test('a fever pulse expires after one successful round, with one more round of downstream sensation', async (t) => {
  const pulse = await start(t, { extras: provider(2) });
  const explicitZero = await start(t, {
    extras: feverDrive('io.write({ setpointOffsetC: io.simulatedSeconds === 60 ? 2 : 0 });'),
  });
  const continuous = await start(t, { extras: feverDrive('io.write({ setpointOffsetC: 2 });') });
  const traces = [[], [], []];
  for (let round = 0; round < 5; round++) {
    const states = await Promise.all([pulse.advance(), explicitZero.advance(), continuous.advance()]);
    for (const [index, state] of states.entries()) traces[index].push(state);
  }
  const [silent, zero, sustained] = traces;
  t.diagnostic(JSON.stringify({ pulse: adoptedOffsets(silent), explicitZero: adoptedOffsets(zero),
    continuous: adoptedOffsets(sustained), pulseColdMm: silent.map((state) => state.interoception.coldMm) }));
  assert.deepEqual(adoptedOffsets(zero), [0, 2, 0, 0, 0]);
  assert.deepEqual(adoptedOffsets(silent), [0, 2, 0, 0, 0]);
  assert.deepEqual(adoptedOffsets(sustained), [0, 2, 2, 2, 2]);
  assert.equal(silent[4].feverDrive.setpointOffsetC, 2, 'stored part stays intact but is not a fresh publication');
  assert.ok(silent[2].interoception.coldMm > 80, 'consumer uses the offset thermoregulation adopted in round 2');
  assert.equal(silent[3].interoception.coldMm, 0);
  for (let round = 0; round < silent.length; round++) {
    for (const id of ['thermoregulation', 'interoception', 'skin', 'lungsVentilation']) {
      assert.deepEqual(silent[round][id], zero[round][id], `${id} in round ${round + 1}`);
    }
  }
});

test('a failed round does not expire the prior publication, and a later publication takes effect', async (t) => {
  const body = await start(t, {
    extras: {
      ...feverDrive(`
        if (io.simulatedSeconds === 60) io.write({ setpointOffsetC: 2 });
        if (io.simulatedSeconds === 180) io.write({ setpointOffsetC: 1 });
      `),
      'failure.mjs': `
        import { existsSync, writeFileSync } from 'node:fs';
        const marker = new URL('./failed-once', import.meta.url);
        export const id = 'failure';
        export const fields = {};
        export function heartbeat(io) {
          if (io.simulatedSeconds !== 120 || existsSync(marker)) return;
          writeFileSync(marker, '');
          throw new Error('retry round 2');
        }
      `,
    },
  });
  const first = await body.advance();
  assert.deepEqual(await body.tick(), { ran: true, failed: true });
  assert.equal(body.state().activeBatch.attempts, 1);
  assert.equal(body.gateway.getState().simulatedSeconds, 60);
  const retry = await body.advance();
  assert.equal(body.state().activeBatch, null);
  assert.equal(body.gateway.getState().simulatedSeconds, 120);
  assert.equal(retry.thermoregulation.feverSetpointOffsetC, 2, 'retry sees the last committed publication');
  const rounds = [first, retry, await body.advance(), await body.advance(), await body.advance()];
  assert.deepEqual(adoptedOffsets(rounds), [0, 2, 0, 1, 0]);
});

test('resetOnStart after catch-up does not replace a committed fever publication', async (t) => {
  const body = await start(t, {
    now: fixedStart + roundMs,
    seed: { ...checkpoint({ wallTimeMs: fixedStart, profile: { timezoneOffsetMin: 0 } }), parameters: flatSetpoint },
    catchUpMinutes: 1,
    withStartupReset: true,
    extras: feverDrive('io.write({ setpointOffsetC: 0 });', 2, ['setpointOffsetC']),
  });
  assert.equal(body.state().startup.caughtUpSeconds, 60);
  assert.equal(body.parts().feverDrive.setpointOffsetC, 2, 'stock initializer reset the ordinary snapshot');
  const after = await body.advance();
  t.diagnostic(JSON.stringify({ resetSnapshotOffsetC: 2,
    adoptedOffsetC: after.thermoregulation.feverSetpointOffsetC, shiveringKcal: balanceOf(after).shiveringHeatKcal }));
  assert.equal(after.thermoregulation.feverSetpointOffsetC, 0, 'only the actual catch-up publication can affect the next round');
  assert.equal(after.thermoregulation.effectiveSetpointC, 37);
  close(balanceOf(after).shiveringHeatKcal, 0, 'no shivering from reset-only offset', 1e-6);
});

test('a fresh fever publication raises the target before cold sensation, not the HPA/autonomic threshold', async (t) => {
  const low = await start(t, { extras: provider(0) });
  const high = await start(t, { extras: provider(1) });
  const [low1, high1] = await Promise.all([low.advance(), high.advance()]);
  assert.deepEqual(low1.thermoregulation, high1.thermoregulation);
  assert.equal(high1.thermoregulation.feverSetpointOffsetC, 0);
  const [low2, high2] = await Promise.all([low.advance(), high.advance()]);
  assert.equal(high2.thermoregulation.setpointC, 37);
  assert.equal(high2.thermoregulation.effectiveSetpointC, 38);
  assert.ok(verifyHeatRound(high1, high2).shiveringHeatKcal > verifyHeatRound(low1, low2).shiveringHeatKcal);
  assert.equal(high2.interoception.coldMm, low2.interoception.coldMm);
  const [low3, high3] = await Promise.all([low.advance(), high.advance()]);
  assert.ok(high3.interoception.coldMm > low3.interoception.coldMm);
  assert.deepEqual(high3.hypothalamusEndocrine, low3.hypothalamusEndocrine);
  assert.deepEqual(high3.autonomic, low3.autonomic);
  t.diagnostic(JSON.stringify({ baseline: 37, effective: 38,
    coreRound2: coreOf(high2), coldMmRound3: [low3.interoception.coldMm, high3.interoception.coldMm] }));
});

test('fever shifts heat and rest panting thresholds without changing the baseline bin', async (t) => {
  const parts = { thermoregulation: thermo(37.93, 36.7) };
  const parameters = { ...flatSetpoint, 'thermoregulation.setpointC': 36.7 };
  const low = await start(t, { parts, parameters, extras: provider(0) });
  const high = await start(t, { parts, parameters, extras: provider(1) });
  await Promise.all([low.advance(), high.advance()]);
  const [, adopted] = await Promise.all([low.advance(), high.advance()]);
  assert.ok(adopted.thermoregulation.setpointC < 37 && adopted.thermoregulation.effectiveSetpointC > 37);
  const [a, b] = await Promise.all([low.advance(), high.advance()]);
  assert.equal(b.thermoregulation.feverSetpointOffsetC, 0, 'the pulse has expired for thermoregulation');
  assert.ok(a.interoception.heatMm > 0 && a.lungsVentilation.ventilationMlMin > 6001);
  assert.ok(a.skin.sweatRequestMl > 0);
  assert.equal(b.interoception.heatMm, 0);
  close(b.lungsVentilation.ventilationMlMin, 6000.034285910205, 'metabolic ventilation only');
  assert.equal(b.skin.sweatRequestMl, 0);
});

test('removal and a silent provider both ignore saved drive while retrying the first catch-up batch', async (t) => {
  const original = await start(t, {
    parts: { thermoregulation: thermo(38.1), skin: { sweatVolumeMl: 1.75 } },
    extras: {
      ...provider(2),
      'failure.mjs': `
        export const id = 'failure';
        export const fields = {};
        export function heartbeat(io) {
          if (io.simulatedSeconds === 180) throw new Error('ordinary failure in round 3');
        }
      `,
    },
  });
  await original.advance();
  const committed = await original.advance();
  assert.equal(committed.thermoregulation.effectiveSetpointC, 39);
  assert.ok(committed.skin.sweatVolumeMl > 0);
  assert.deepEqual(await original.tick(), { ran: true, failed: true });
  const failed = original.state();
  assert.equal(failed.activeBatch.attempts, 1);
  await original.gateway.stop();

  const options = { catchUpMinutes: 1, now: fixedStart + 3 * roundMs };
  const zeroSeed = structuredClone(failed);
  zeroSeed.snapshot.parts.feverDrive.setpointOffsetC = 0;
  zeroSeed.snapshot.parts.thermoregulation.feverSetpointOffsetC = 0;
  zeroSeed.snapshot.parts.thermoregulation.effectiveSetpointC = 37;
  const zero = await start(t, { ...options, seed: zeroSeed });
  const removed = await start(t, { ...options, statePath: original.statePath });
  const silent = await start(t, { ...options, seed: failed, extras: provider(2, -1) });
  for (const body of [removed, silent]) {
    assert.equal(body.state().startup.caughtUpSeconds, 60);
    assert.equal(body.state().activeBatch, null);
    assert.equal(body.gateway.getState().simulatedSeconds, 180);
    const result = body.parts();
    for (const key of ['skin', 'bodyFluid', 'thermoregulation', 'interoception', 'lungsVentilation']) {
      assert.deepEqual(result[key], zero.parts()[key], key);
    }
    assert.equal(result.thermoregulation.effectiveSetpointC, 37);
    verifyHeatRound(committed, result);
  }
  t.diagnostic(JSON.stringify({ savedOffsetC: 2, resumedOffsetC: 0, paidSweatMl: committed.skin.sweatVolumeMl,
    coreStartC: coreOf(committed), coreEndC: coreOf(removed.parts()) }));
});

function waterLedger(parts, outflow) {
  return parts.stomach.waterVolumeMl
    + parts.stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0)
    + parts.smallIntestine.waterVolumeMl + parts.colon.residueWaterMl
    + parts.bodyFluid.waterVolumeMl + parts.bladder.volumeMl + outflow;
}

test('real sweat and the water ledger close while core deviation shrinks within 90 min of withdrawal', async (t) => {
  const control = await start(t);
  const humid = await start(t);
  for (const body of [control, humid]) {
    await action(body, { id: 'same-ride', type: 'exercise', durationMin: 25, intensity: 0.7 });
  }
  await scene(humid, 'hot', 32, 90);
  const fixtures = [control, humid].map((body) => ({
    body, last: body.parts(), outflow: 0, paid: 0, evaporated: 0, integral: 0, residual: 0, constrained: 0,
  }));
  for (const f of fixtures) f.initialWater = waterLedger(f.last, 0);

  async function advance(f) {
    const next = await f.body.advance();
    const b = verifyHeatRound(f.last, next);
    f.outflow += next.skin.sweatVolumeMl + next.lungs.respiratoryWaterLossMl + next.bladder.voidedMl;
    f.paid += next.skin.sweatVolumeMl;
    f.evaporated += b.evaporatedSweatMl;
    f.integral += b.netHeatKcal;
    f.residual = Math.max(f.residual, Math.abs(waterLedger(next, f.outflow) - f.initialWater));
    assert.ok(f.residual < 1e-8, `water residual ${f.residual} mL`);
    if (b.evaporatedSweatMl < b.paidSweatMl) f.constrained++;
    f.last = next;
  }

  for (let i = 1; i <= 25; i++) await Promise.all(fixtures.map(advance));
  await scene(humid, 'return', 25, 50);
  await Promise.all(fixtures.map(advance)); // round 26 commits the withdrawal, still using the old rates
  const withdrawal = fixtures.map(({ last }) => coreOf(last));
  const initialGap = withdrawal[1] - withdrawal[0];
  assert.ok(initialGap > 0.1);
  assert.ok(fixtures[1].constrained > 0);
  for (let i = 1; i <= 90; i++) await Promise.all(fixtures.map(advance));
  const recovered = fixtures.map(({ last }) => coreOf(last));
  assert.ok(Math.abs(recovered[1] - recovered[0]) < 0.6 * initialGap);
  for (const f of fixtures) close(coreOf(f.last), 37 + f.integral / 60, 'integrated net heat');
  t.diagnostic(JSON.stringify({ withdrawal, recovered, ledgers: fixtures.map(({ paid, evaporated, integral, residual, constrained }) => ({
    paid, evaporated, integral, residual, constrained,
  })) }));
});
