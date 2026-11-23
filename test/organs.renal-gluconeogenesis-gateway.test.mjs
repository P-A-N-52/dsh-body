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
const maxOutputRateGPerMin = 0.3;
const maxOutputPerRoundG = 0.3;

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
    pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
  };
}

function renalOutputG(parts) {
  const concentrationMgDl = parts.glucose?.concentrationMgDl ?? baselineConcentrationMgDl;
  const glucagonRelative = parts.pancreasEndocrine?.glucagonRelative ?? 1;
  const active = concentrationMgDl < baselineConcentrationMgDl || glucagonRelative > 1;
  return active
    ? Math.min(maxOutputRateGPerMin * glucagonRelative, maxOutputPerRoundG)
    : 0;
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
  for (let round = 1; round <= 22; round++) {
    const before = gateway.getState().parts;
    const expectedOutputG = renalOutputG(before);
    assert.equal(expectedOutputG, 0.3, `round ${round}: low glucose must drive the maximum rate`);

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
      previousMassG + expectedOutputG,
      `round ${round}: kidney output must be the only source`,
    );
    previousMassG = parts.glucose.glucoseMassG;
  }

  const parts = gateway.getState().parts;
  assertClose(parts.glucose.glucoseMassG, 12.6, '22 rounds of 0.3 g');
  assertClose(
    parts.glucose.concentrationMgDl,
    (12.6 - maxOutputPerRoundG) * 1000 / distributionVolumeDl,
    'concentration reflects the round-start mass before the final transfer',
  );
  assert.ok(
    parts.glucose.concentrationMgDl > 85 && parts.glucose.concentrationMgDl < baselineConcentrationMgDl,
    `concentration ${parts.glucose.concentrationMgDl} must recover toward baseline without overshooting`,
  );
});

test('liver glycogen and kidney gluconeogenesis both refill low glucose', async (t) => {
  const { gateway } = await startBody(t, { parts: lowGlucoseParts({ glycogenG: 80 }) });

  const before = gateway.getState().parts;
  const expectedKidneyOutputG = renalOutputG(before);
  assert.equal(expectedKidneyOutputG, 0.3);

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.ok(first.liver.outputG > 0, 'the liver must release from its store');
  assertClose(first.liver.glycogenG, 80 - first.liver.outputG, 'the liver release spends glycogen');
  assert.deepEqual(first.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assertClose(
    first.glucose.glucoseMassG,
    6 + first.liver.outputG + expectedKidneyOutputG,
    'both transfers must enter glucoseMassG',
  );

  const secondBefore = gateway.getState().parts;
  const secondKidneyOutputG = renalOutputG(secondBefore);
  await gateway.tick();
  const second = gateway.getState().parts;
  assert.ok(second.liver.outputG > 0, 'the liver must keep releasing while glucose is low');
  assert.equal(secondKidneyOutputG, 0.3);
  assertClose(
    second.glucose.glucoseMassG,
    first.glucose.glucoseMassG + second.liver.outputG + secondKidneyOutputG,
    'round 2 must also receive both sources',
  );
});

test('high glucose produces no kidney output', async (t) => {
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
      pancreasEndocrine: { insulinRelative: 1, glucagonRelative: 1 },
    },
  });

  const before = gateway.getState().parts;
  assert.equal(renalOutputG(before), 0, 'high glucose with baseline glucagon must not trigger output');

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.equal(first.liver.outputG, 0, 'high glucose must not trigger liver release');
  assert.deepEqual(first.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assertClose(
    first.glucose.glucoseMassG + first.glucose.disposedGlucoseG,
    30,
    'round 1 may only dispose mass, not add kidney output',
  );

  const disposedFirstG = first.glucose.disposedGlucoseG;
  await gateway.tick();
  const second = gateway.getState().parts;
  assert.deepEqual(second.kidneyGluconeogenesis, { glucoseOutputG: 0 });
  assertClose(
    second.glucose.glucoseMassG
      + disposedFirstG
      + second.glucose.disposedGlucoseG
      + second.liver.storageG
      + second.muscleGlucose.uptakeG
      + second.kidneyGlucose.excretedGlucoseG,
    30,
    'settled sinks and disposals must account for the whole start mass',
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

  for (let round = 1; round <= 5; round++) await first.tick();
  const beforeRestart = first.getState().parts;
  assertClose(beforeRestart.glucose.glucoseMassG, 7.5, 'five rounds of 0.3 g');
  assert.equal(first.getState().simulatedSeconds, 300);
  await first.stop();

  const second = boot(statePath);
  t.after(async () => {
    await second.stop();
  });
  await second.ready;

  const loaded = second.getState().parts;
  assert.equal(second.getState().simulatedSeconds, 300);
  assertClose(loaded.glucose.glucoseMassG, 7.5, 'the restart must keep the committed mass');
  assert.deepEqual(loaded.kidneyGluconeogenesis, { glucoseOutputG: 0 });

  const expectedOutputG = renalOutputG(loaded);
  await second.tick();
  const after = second.getState().parts;
  assert.equal(second.getState().simulatedSeconds, 360);
  assertClose(after.glucose.glucoseMassG, 7.5 + expectedOutputG, 'the next round keeps producing');
  assert.deepEqual(after.kidneyGluconeogenesis, { glucoseOutputG: 0 });
});
