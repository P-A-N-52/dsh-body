import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

const manifestPath = fileURLToPath(new URL('../organs/presets/human-lipid/body-modules.json', import.meta.url));
const meal = { type: 'eat', volumeMl: 250, energyKcal: 220, mealKind: 'liquid', carbohydrateG: 6 };
const tolerance = 1e-9;
const parts = (run) => run.gateway.getState().parts;

async function start(t, { seedParts = {}, parameters = {}, statePath } = {}) {
  return launch(t, {
    seed: statePath ? null : { ...checkpoint({ wallTimeMs: 0, parts: seedParts }), parameters },
    statePath,
    gatewayOptions: { manifestPath, now: () => 0 },
  });
}

async function intake(run, action, callId = 'meal') {
  const result = await createBodyTools(run.gateway).body_act.execute(action, { sessionId: 'lipid', callId });
  assert.equal(result.statusCode, 202, JSON.stringify(result));
  return result.receipt.id;
}

async function tick(run) {
  const before = run.gateway.getState().simulatedSeconds;
  await run.tick();
  assert.equal(run.gateway.getState().simulatedSeconds, before + 60, run.logs.at(-1));
  return parts(run);
}

function checkLedger(p, expected, { queue = false } = {}) {
  const stocksAndExits = [
    p.stomach.solidFatG, p.stomach.nonSolidFatG,
    p.intestinalLipid.lumenTgG, p.intestinalLipid.hydrolyzedG,
    p.intestinalLymph.tgInTransitG, p.lipidCirculation.mealTgG,
    p.adipose.storedTgG, p.lipidCirculation.nefaEquivalentG,
    p.intestinalLipid.residueTotalG, p.lipidCirculation.tissueUptakeTotalG,
  ];
  if (queue) {
    for (const slice of p.stomach.mealQueue) stocksAndExits.push(slice.remainingFatG ?? 0);
  }
  assert.ok(stocksAndExits.every((q) => Number.isFinite(q) && q >= 0), JSON.stringify(stocksAndExits));
  const error = Math.abs(stocksAndExits.reduce((sum, q) => sum + q, 0) - expected);
  assert.ok(error < tolerance, `lipid ledger error ${error} g`);
  return error;
}

test('full preset propagates a 20 g meal but not a matched 0 g meal, with no water or glucose double charge', async (t) => {
  const withFat = await start(t);
  const withoutFat = await start(t);
  await intake(withFat, { ...meal, fatG: 20 });
  await intake(withoutFat, { ...meal, fatG: 0 });
  let error = 0;
  let peak = 0;
  let deposited = 0;
  let first = {};
  for (let minute = 1; minute <= 130; minute += 1) {
    const a = await tick(withFat);
    const b = await tick(withoutFat);
    error = Math.max(error, checkLedger(a, 80), checkLedger(b, 60));
    peak = Math.max(peak, a.lipidCirculation.mealTgG);
    deposited += a.lipidCirculation.storedThisRoundG;
    assert.equal(b.lipidCirculation.mealTgG, 0);
    assert.equal(b.intestinalLymph.tgInTransitG, 0);
    assert.equal(a.stomach.energyKcal, b.stomach.energyKcal);
    assert.equal(a.stomach.waterVolumeMl, b.stomach.waterVolumeMl);
    assert.deepEqual(a.smallIntestine, b.smallIntestine);
    assert.deepEqual(a.glucose, b.glucose);
    assert.ok(a.adipose.storedTgG <= a.adipose.capacityG);
    if (a.intestinalLipid.lumenTgG > 0) first.lumen ??= minute;
    if (a.intestinalLipid.hydrolyzedG > 0) first.hydrolyzed ??= minute;
    if (a.intestinalLymph.tgInTransitG > 0) first.lymph ??= minute;
    if (a.lipidCirculation.mealTgG > 0) first.circulation ??= minute;
    if (a.lipidCirculation.storedThisRoundG > 0) first.adipose ??= minute;
  }
  assert.equal(first.lumen, 2);
  assert.ok(first.lumen < first.hydrolyzed && first.hydrolyzed < first.lymph
    && first.lymph < first.circulation && first.circulation < first.adipose, JSON.stringify(first));
  assert.ok(peak > 0 && deposited > 0);
  assert.ok(parts(withFat).adipose.storedTgG > parts(withoutFat).adipose.storedTgG);
  assert.ok(parts(withoutFat).lipidCirculation.nefaEquivalentG > 0, 'fasting NEFA is separate from meal TG');
  t.diagnostic(`20 g vs 0 g: peak meal TG ${peak.toFixed(6)} vs 0 g; deposited ${deposited.toFixed(6)} g; max error ${error.toExponential(3)} g; first arrivals ${JSON.stringify(first)}`);
});

test('a longer intermeal interval replenishes the finite bile reserve and changes duct delivery', async (t) => {
  async function replay(interval) {
    const run = await start(t);
    await intake(run, { ...meal, fatG: 20 }, 'first');
    for (let i = 0; i < interval; i += 1) {
      const p = await tick(run);
      checkLedger(p, 80);
      assert.ok(p.gallbladder.stockActivityU >= 0 && p.gallbladder.stockActivityU <= 3 + 1e-12);
    }
    const { gallbladder, intestinalLipid, stomach } = parts(run);
    const reserve = gallbladder.stockActivityU;
    const startingGutG = intestinalLipid.lumenTgG + intestinalLipid.hydrolyzedG;
    const startingStomachG = stomach.solidFatG + stomach.nonSolidFatG;
    await intake(run, { ...meal, fatG: 20 }, 'second');
    let delivered = 0;
    for (let i = 0; i < 12; i += 1) {
      const prior = parts(run).gallbladder;
      const p = await tick(run);
      assert.ok(p.gallbladder.releasedActivityU <= prior.stockActivityU);
      delivered += p.gallbladder.ductDeliveredActivityU;
      checkLedger(p, 100);
    }
    return { reserve, delivered, startingGutG, startingStomachG };
  }
  const short = await replay(35);
  // A residual first meal can still drive release at intermediate intervals; give the long arm time to refill.
  const long = await replay(480);
  assert.ok(long.reserve > short.reserve, JSON.stringify({ short, long }));
  assert.ok(long.delivered > short.delivered, JSON.stringify({ short, long }));
  t.diagnostic(`35/480 min: reserve ${short.reserve.toFixed(6)}/${long.reserve.toFixed(6)} BAU; next 12 min via duct ${short.delivered.toFixed(6)}/${long.delivered.toFixed(6)} BAU`);
});

test('subdivided drink survives checkpoint/restart and preserves unknown vs explicit zero', async (t) => {
  let run = await start(t);
  const action = { type: 'drink', volumeMl: 120, energyKcal: 60, carbohydrateG: 6, fatG: 7.7, durationMin: 2.5 };
  const id = await intake(run, action);
  await intake(run, { type: 'drink', volumeMl: 40, energyKcal: 40 }, 'unknown');
  await intake(run, { type: 'drink', volumeMl: 40, energyKcal: 40, fatG: 0 }, 'known-zero');
  const before = await tick(run);
  assert.equal(run.gateway.getReceipt(id).status, 'applied');
  assert.equal(before.stomach.explicitFatIntakeG, 7.7 / 3);
  assert.equal(before.stomach.unknownFatIntakeSlices, 1);
  assert.equal(before.stomach.waterVolumeMl, 120);
  assert.equal(before.stomach.carbohydrateG, 2);
  assert.equal(before.stomach.energyKcal, 100);
  assert.equal(before.stomach.mealQueue.length, 1);
  checkLedger(before, 67.7, { queue: true });

  const { statePath } = run;
  await run.gateway.stop();
  run = await start(t, { statePath });
  assert.deepEqual(parts(run).stomach, before.stomach);
  for (let i = 0; i < 2; i += 1) {
    const p = await tick(run);
    assert.ok(Math.abs(p.stomach.explicitFatIntakeG - 7.7 / 3) < tolerance);
    assert.equal(p.stomach.unknownFatIntakeSlices, 0);
    checkLedger(p, 67.7, { queue: true });
  }
  assert.deepEqual(parts(run).stomach.mealQueue, []);
  await intake(run, { type: 'drink', volumeMl: 20, energyKcal: 80, fatG: 0 }, 'zero-only');
  let p = await tick(run);
  assert.equal(p.stomach.explicitFatIntakeG, 0);
  assert.equal(p.stomach.unknownFatIntakeSlices, 0);
  await intake(run, { type: 'drink', volumeMl: 20, energyKcal: 80 }, 'unknown-only');
  p = await tick(run);
  assert.equal(p.stomach.explicitFatIntakeG, null);
  assert.equal(p.stomach.unknownFatIntakeSlices, 1);
  checkLedger(p, 67.7);
});

test('each digestive aid is required and a full adipose depot cannot spend or refill from same-round arrivals', async (t) => {
  for (const parameters of [{ 'liverBile.supplyActivityUPerMin': 0 }, { 'pancreasExocrine.maxLipaseActivityU': 0 }]) {
    const run = await start(t, {
      parameters,
      seedParts: { gallbladder: { stockActivityU: 0 }, adipose: { storedTgG: 150 }, lipidCirculation: { mealTgG: 1 } },
    });
    await intake(run, { ...meal, fatG: 20 });
    let prev = parts(run);
    for (let i = 0; i < 36; i += 1) {
      const p = await tick(run);
      checkLedger(p, 171);
      assert.equal(p.intestinalLipid.hydrolyzedG, 0);
      assert.equal(p.intestinalLymph.tgInTransitG, 0);
      assert.ok(p.gallbladder.releasedActivityU <= prev.gallbladder.stockActivityU);
      assert.ok(p.adipose.mobilizedG <= prev.adipose.storedTgG);
      assert.ok(p.lipidCirculation.storedThisRoundG <= prev.adipose.capacityG - prev.adipose.storedTgG);
      assert.ok(p.lipidCirculation.nefaUptakeG <= prev.lipidCirculation.nefaEquivalentG);
      prev = p;
    }
    assert.ok(prev.intestinalLipid.lumenTgG > 0 && prev.intestinalLipid.residueTotalG > 0);
  }
});

test('an elevated endocrine signal suppresses next-round net mobilization without creating or spending new NEFA', async (t) => {
  const basal = await start(t);
  const elevated = await start(t, { parameters: { 'pancreasEndocrine.insulin.basalPmolL': 180 } });
  const firstBasal = await tick(basal);
  const firstElevated = await tick(elevated);
  assert.equal(firstElevated.adipose.mobilizedG, firstBasal.adipose.mobilizedG);
  assert.equal(firstElevated.lipidCirculation.nefaUptakeG, 0);
  assert.ok(firstElevated.adipose.insulinRelative > firstBasal.adipose.insulinRelative);
  const secondBasal = await tick(basal);
  const secondElevated = await tick(elevated);
  assert.ok(secondElevated.adipose.mobilizedG < secondBasal.adipose.mobilizedG);
  assert.ok(secondElevated.adipose.storageFraction > secondBasal.adipose.storageFraction);
  assert.equal(secondElevated.lipidCirculation.nefaUptakeG, secondBasal.lipidCirculation.nefaUptakeG);
  checkLedger(secondBasal, 60);
  checkLedger(secondElevated, 60);
});
