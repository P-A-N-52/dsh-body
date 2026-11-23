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
const initialBodyWaterMl = 30000;

const esophagusInitial = {
  bolusVolumeMl: 0,
  transitMin: 0,
  chokingMm: 0,
};

function silence(t) {
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, () => {});
    } catch {
      // A previous gateway in the same test already mocked this method.
    }
  }
}

function boot(manifestPath, statePath) {
  return startGateway({
    manifestPath,
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
}

async function startBody(t, { parts = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bowel-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts })));
  silence(t);
  const gateway = boot(rootManifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, dir, statePath };
}

function queuedWaterMl(stomach) {
  return stomach.mealQueue.reduce((sum, meal) => sum + (meal.remainingWaterMl ?? 0), 0);
}

function waterLedgerMl(parts, { voidedMl, sweatMl, lungsMl }) {
  return parts.stomach.waterVolumeMl
    + queuedWaterMl(parts.stomach)
    + parts.smallIntestine.waterVolumeMl
    + parts.colon.residueWaterMl
    + (parts.bodyFluid.waterVolumeMl - initialBodyWaterMl)
    + parts.bladder.volumeMl
    + voidedMl
    + sweatMl
    + lungsMl;
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('a large drink forms an esophageal bolus and clears after the transit minute', async (t) => {
  const { gateway } = await startBody(t);
  assert.equal(
    gateway.submitAction({ id: 'bowel-drink', type: 'drink', volumeMl: 500 }).statusCode,
    202,
  );

  await gateway.tick();
  const first = gateway.getState().parts;
  assert.equal(first.esophagus.bolusVolumeMl, 500);
  assert.equal(first.esophagus.transitMin, 0.2);
  assertClose(first.esophagus.chokingMm, 50, 'choking proxy');
  assert.equal(first.interoception.bowelUrgencyMm, 0);

  await gateway.tick();
  const second = gateway.getState().parts;
  assert.deepEqual(second.esophagus, esophagusInitial);
  assert.equal(second.interoception.discomfort, 0, 'a 50 mm choking readout stays below the onset');
});

test('intestinal residue reaches the colon, is reclaimed into body fluid and keeps the water ledger', async (t) => {
  const { gateway } = await startBody(t);
  assert.equal(
    gateway.submitAction({ id: 'bowel-residue-drink', type: 'drink', volumeMl: 500 }).statusCode,
    202,
  );

  let voidedMl = 0;
  let sweatMl = 0;
  let lungsMl = 0;
  let peakResidueMl = 0;
  let cumulativeReclaimedMl = 0;

  for (let round = 1; round <= 30; round++) {
    const before = gateway.getState().parts;
    await gateway.tick();
    const after = gateway.getState().parts;

    voidedMl += after.bladder.voidedMl;
    sweatMl += after.skin.sweatVolumeMl;
    lungsMl += after.lungs.respiratoryWaterLossMl;

    const absorbedMl = after.smallIntestine.absorbedWaterMl;
    const residueInMl = 0.05 * Math.max(
      0,
      before.smallIntestine.waterVolumeMl - absorbedMl,
    );
    const reclaimedMl = Math.min(
      before.colon.residueWaterMl * 0.001,
      before.colon.residueWaterMl,
    );
    const kidneyMl = Math.min(
      before.kidney.urineProductionRequestMl,
      before.bodyFluid.waterVolumeMl,
    );

    cumulativeReclaimedMl += reclaimedMl;
    peakResidueMl = Math.max(peakResidueMl, after.colon.residueWaterMl);

    assertClose(
      after.colon.residueWaterMl,
      before.colon.residueWaterMl - reclaimedMl + residueInMl,
      `round ${round}: colon residue`,
    );
    assertClose(
      after.bodyFluid.waterVolumeMl,
      before.bodyFluid.waterVolumeMl - kidneyMl + absorbedMl + reclaimedMl,
      `round ${round}: body fluid inflow`,
    );
    assertClose(
      waterLedgerMl(after, { voidedMl, sweatMl, lungsMl }),
      500,
      `round ${round}: water ledger`,
      1e-6,
    );
  }

  assert.ok(peakResidueMl > 0, 'the colon must receive intestinal residue');
  assert.ok(cumulativeReclaimedMl > 0, 'the colon must reclaim residue water');
  assert.ok(
    gateway.getState().parts.bodyFluid.waterVolumeMl > initialBodyWaterMl - 100,
    'reclaimed water must reach body fluid instead of leaving the body',
  );
});

test('defecate clears the stool and bowel urgency falls one round later', async (t) => {
  const { gateway } = await startBody(t, {
    parts: {
      colon: {
        residueWaterMl: 0,
        stoolG: 100,
        defecatedG: 0,
        reclaimedWaterMl: 0,
        bowelUrgencyMm: 0,
      },
    },
  });

  await gateway.tick();
  let parts = gateway.getState().parts;
  assert.equal(parts.interoception.bowelUrgencyMm, 50);
  assert.ok(parts.colon.stoolG > 100);

  await gateway.tick();
  parts = gateway.getState().parts;
  const stoolBeforeDefecate = parts.colon.stoolG;
  assert.ok(stoolBeforeDefecate > 100);

  assert.equal(gateway.submitAction({ id: 'bowel-defecate', type: 'defecate' }).statusCode, 202);
  await gateway.tick();
  parts = gateway.getState().parts;
  assert.equal(parts.colon.stoolG, 0);
  assertClose(parts.colon.defecatedG, stoolBeforeDefecate, 'defecated flux');
  assertClose(
    parts.interoception.bowelUrgencyMm,
    stoolBeforeDefecate / 2,
    'urgency still reads the pre-defecate stool',
  );

  await gateway.tick();
  parts = gateway.getState().parts;
  assert.equal(parts.interoception.bowelUrgencyMm, 0);
  assert.equal(parts.colon.stoolG, 0.01);
  assert.equal(parts.colon.defecatedG, 0);
});

test('a manifest without colon fails at startup on the undeclared residue target', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bowel-no-colon-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    ...rootManifest,
    startupScripts: rootManifest.startupScripts.map((path) => relative(dir, join(root, path))),
    scripts: rootManifest.scripts
      .filter((path) => !path.includes('/colon/'))
      .map((path) => relative(dir, join(root, path))),
  }));
  silence(t);

  const gateway = boot(manifestPath, statePath);
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  await assert.rejects(
    gateway.ready,
    /transferOut target "colon\.residueWaterMl" is not declared/,
  );
});

test('restart continues the esophageal bolus, colon residue and bowel urgency', async (t) => {
  const { gateway: first, statePath } = await startBody(t, {
    parts: {
      colon: {
        residueWaterMl: 1000,
        stoolG: 100,
        defecatedG: 0,
        reclaimedWaterMl: 0,
        bowelUrgencyMm: 0,
      },
    },
  });
  assert.equal(
    first.submitAction({ id: 'bowel-restart-drink', type: 'drink', volumeMl: 500 }).statusCode,
    202,
  );
  await first.tick();
  const beforeRestart = first.getState().parts;
  assert.equal(beforeRestart.esophagus.bolusVolumeMl, 500);
  assert.equal(beforeRestart.interoception.bowelUrgencyMm, 50);
  assertClose(beforeRestart.colon.residueWaterMl, 999, 'reclaim from the seeded residue');
  assert.equal(first.getState().simulatedSeconds, 60);
  await first.stop();

  const second = boot(rootManifestPath, statePath);
  t.after(async () => {
    await second.stop();
  });
  await second.ready;

  const loaded = second.getState().parts;
  assert.equal(second.getState().simulatedSeconds, 60);
  assert.equal(loaded.esophagus.bolusVolumeMl, 500);
  assert.equal(loaded.esophagus.transitMin, 0.2);
  assertClose(loaded.colon.residueWaterMl, 999, 'the restart must keep the committed residue');
  assert.equal(loaded.colon.stoolG, 100.01);
  assert.equal(loaded.interoception.bowelUrgencyMm, 50);

  await second.tick();
  const after = second.getState().parts;
  assert.equal(second.getState().simulatedSeconds, 120);
  assert.deepEqual(after.esophagus, esophagusInitial);
  assertClose(after.colon.residueWaterMl, 999 * 0.999, 'reclaim continues after restart');
  assertClose(after.colon.stoolG, 100.02, 'stool formation continues after restart');
});
