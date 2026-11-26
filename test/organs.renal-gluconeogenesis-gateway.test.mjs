import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifestPath = join(root, 'body-modules.json');
const distributionVolumeDl = 141;
const baselineConcentrationMgDl = 90;
const maxOutputRateGPerMin = 0.5;
const maxOutputPerRoundG = 0.6;
const basalConsumptionGPerMin = 0.12;

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function boot(statePath) {
  return startGateway({
    manifestPath: rootManifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-renal-gluconeogenesis-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: 0,
    simulatedSeconds: 0,
    parts,
  })));
  silence(t);
  const gateway = boot(statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, statePath };
}

function lowGlucoseParts({ glycogenG }) {
  return {
    glucose: {
      glucoseMassG: 6,
      concentrationMgDl: 6 * 1000 / distributionVolumeDl,
      disposedGlucoseG: 0,
    },
    liver: {
      glycogenCapacityG: 100,
      glycogenG,
      storageG: 0,
      outputG: 0,
    },
    pancreasEndocrine: { insulinPmolL: 60, glucagonRelative: 1 },
  };
}

function renalOutputG(parts) {
  const concentrationMgDl = parts.glucose?.concentrationMgDl ?? baselineConcentrationMgDl;
  const glucagonRelative = parts.pancreasEndocrine?.glucagonRelative ?? 1;
  const deficitMgDl = Math.max(0, baselineConcentrationMgDl - concentrationMgDl);
  const excessMgDl = Math.max(0, concentrationMgDl - baselineConcentrationMgDl);
  const suppression = 1 / (1 + excessMgDl / 30);
  const rawRate = 0.024 * suppression
    + 0.005 * deficitMgDl
    + 0.05 * Math.max(0, glucagonRelative - 1);
  return Math.min(maxOutputPerRoundG, Math.min(maxOutputRateGPerMin, Math.max(0, rawRate)));
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

test('low glucose without liver glycogen is refilled by kidney gluconeogenesis', async (t) => {
  const { gateway } = await startBody(t, { parts: lowGlucoseParts({ glycogenG: 0 }) });
  assert.deepEqual(gateway.getState().parts.kidneyGluconeogenesis, { glucoseOutputG: 0 });

  let previousMassG = 6;
  for (let round = 1; round <= 40; round++) {
    const before = gateway.getState().parts;
    const expectedOutputG = renalOutputG(before);
    assert.ok(expectedOutputG > 0.024, `round ${round}: low glucose must drive above-basal output`);

    await gateway.tick();
    const parts = gateway.getState().parts;
    assert.equal(parts.liver.outputG, 0, `round ${round}: the empty liver must not release`);
    assert.equal(parts.liver.glycogenG, 0, `round ${round}: liver glycogen must stay empty`);
    assert.deepEqual(
      parts.kidneyGluconeogenesis,
      { glucoseOutputG: 0 },
      `round ${round}: the transfer must drain the kidney output field`,
    );
    assertClose(
      parts.glucose.glucoseMassG,
      previousMassG - parts.glucose.disposedGlucoseG + expectedOutputG,
      `round ${round}: net change equals kidney output minus basal consumption`,
    );
    previousMassG = parts.glucose.glucoseMassG;
  }

  const parts = gateway.getState().parts;
  assert.ok(parts.glucose.glucoseMassG > 6, 'glucose must recover toward baseline');
  assert.ok(
    parts.glucose.concentrationMgDl > 65 && parts.glucose.concentrationMgDl <= baselineConcentrationMgDl,
    `concentration ${parts.glucose.concentrationMgDl} must recover smoothly without overshooting`,
  );
});

test('liver glycogen and kidney gluconeogenesis both refill low glucose', async (t) => {
  const { gateway } = await startBody(t, { parts: lowGlucoseParts({ glycogenG: 80 }) });

  const before = gateway.getState().parts;
  const expectedKidneyOutputG = renalOutputG(before);
  assert.ok(expectedKidneyOutputG > 0.2);

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.liver.outputG > 0, 'the liver must release from its store');
  assertClose(first.liver.glycogenG, 80 - first.liver.outputG, 'the liver release spends glycogen');
  assert.deepEqual(first.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assertClose(
    first.glucose.glucoseMassG,
    6 - first.glucose.disposedGlucoseG + first.liver.outputG + expectedKidneyOutputG,
    'both transfers and basal consumption must enter glucoseMassG',
  );

  const secondBefore = gateway.getState().parts;
  const secondKidneyOutputG = renalOutputG(secondBefore);
  await gateway.tick();
  const second = gateway.getState().parts;
  assert.ok(second.liver.outputG > 0, 'the liver must keep releasing while glucose is low');
  assert.ok(secondKidneyOutputG > 0.15);
  assertClose(
    second.glucose.glucoseMassG,
    first.glucose.glucoseMassG - second.glucose.disposedGlucoseG + second.liver.outputG + secondKidneyOutputG,
    'round 2 must also receive both sources minus basal consumption',
  );
});

test('high glucose smoothly suppresses kidney output', async (t) => {
  const { gateway } = await startBody(t, {
    parts: {
      glucose: {
        glucoseMassG: 30,
        concentrationMgDl: 30 * 1000 / distributionVolumeDl,
        disposedGlucoseG: 0,
      },
      liver: {
        glycogenCapacityG: 100,
        glycogenG: 80,
        storageG: 0,
        outputG: 0,
      },
      pancreasEndocrine: { insulinPmolL: 60, glucagonRelative: 1 },
    },
  });

  const before = gateway.getState().parts;
  const expectedKidney1 = renalOutputG(before);
  assert.ok(expectedKidney1 > 0 && expectedKidney1 < 0.024, 'high glucose suppresses kidney output below basal');

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.liver.outputG > 0 && first.liver.outputG < 0.096, 'high glucose suppresses liver output below basal');
  assert.deepEqual(first.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assertClose(
    first.glucose.glucoseMassG + first.glucose.disposedGlucoseG - first.liver.outputG - expectedKidney1,
    30,
    'round 1 pool balance includes suppressed EGP and disposal',
  );

  const disposedFirstG = first.glucose.disposedGlucoseG;
  const liverOutput1G = first.liver.outputG;
  const expectedKidney2 = renalOutputG(first);
  await gateway.tick();
  const second = gateway.getState().parts;
  assert.deepEqual(second.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assertClose(
    second.glucose.glucoseMassG
      + disposedFirstG
      + second.glucose.disposedGlucoseG
      + second.liver.storageG
      + second.muscleGlucose.uptakeG
      + second.kidneyGlucose.excretedGlucoseG
      - liverOutput1G
      - second.liver.outputG
      - expectedKidney1
      - expectedKidney2,
    30,
    'settled sinks, disposals and suppressed EGP must account for the whole start mass',
  );
});

test('a manifest without kidneyGluconeogenesis fails at startup on the undeclared source', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-renal-gluconeogenesis-missing-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts
      .filter((path) => !path.includes('gluconeogenesis'))
      .map((path) => relative(dir, join(root, path))),
  }));
  silence(t);

  const gateway = startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    gateway.ready,
    /transferIn source "kidneyGluconeogenesis\.glucoseOutputG" is not declared/,
  );
});

test('restart continues renal gluconeogenesis from the committed state', async (t) => {
  const { gateway: first, statePath } = await startBody(t, {
    parts: lowGlucoseParts({ glycogenG: 0 }),
  });

  let expectedMassG = 6;
  for (let round = 1; round <= 5; round++) {
    const before = first.getState().parts;
    const expectedOutputG = renalOutputG(before);
    await first.tick();
    const after = first.getState().parts;
    expectedMassG = expectedMassG - after.glucose.disposedGlucoseG + expectedOutputG;
  }
  const beforeRestart = first.getState().parts;
  assertClose(beforeRestart.glucose.glucoseMassG, expectedMassG, 'five rounds mass conservation');
  assert.equal(first.getState().simulatedSeconds, 300);
  await first.stop();

  const second = boot(statePath);
  t.after(async () => {
    await second.stop();
  });
  await second.ready;

  const loaded = second.getState().parts;
  assert.equal(second.getState().simulatedSeconds, 300);
  assertClose(loaded.glucose.glucoseMassG, expectedMassG, 'the restart must keep the committed mass');
  assert.deepEqual(loaded.kidneyGluconeogenesis, { glucoseOutputG: 0 });

  const expectedOutputG = renalOutputG(loaded);
  await second.tick();
  const after = second.getState().parts;
  assert.equal(second.getState().simulatedSeconds, 360);
  assertClose(
    after.glucose.glucoseMassG,
    expectedMassG - after.glucose.disposedGlucoseG + expectedOutputG,
    'the next round keeps producing',
  );
  assert.deepEqual(after.kidneyGluconeogenesis, { glucoseOutputG: 0 });
});
