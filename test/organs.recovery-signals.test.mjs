import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkpoint, launch } from '../test-support/harness.mjs';
import { createBodyTools } from '../tools.js';

function organ(path) {
  return `export * from ${JSON.stringify(new URL(`../organs/${path}`, import.meta.url).href)};`;
}

const fatigueModules = {
  'interoception.mjs': organ('human-organs/brain/interoception.ts'),
  'activity.mjs': organ('human-organs/skeletal-muscle/activity.ts'),
};

function launchFatigue(t, { parts, statePath } = {}) {
  return launch(t, {
    modules: fatigueModules,
    seed: parts === undefined ? null : checkpoint({ wallTimeMs: 0, parts }),
    statePath,
    gatewayOptions: { now: () => 0 },
  });
}

async function advance(app, minutes = 1) {
  const before = app.gateway.getState().simulatedSeconds;
  for (let minute = 0; minute < minutes; minute += 1) await app.tick();
  const snapshot = app.gateway.getState();
  assert.equal(snapshot.simulatedSeconds, before + minutes * 60);
  return snapshot.parts;
}

function closeTo(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('a legacy 45 mm reading with fixed 10% depletion recovers to 30.2 mm across a restart', async (t) => {
  // Hold one region at 90% of its 15 g baseline to isolate decay from glycogen turnover.
  const parts = { muscleHead: { glycogenG: 13.5 } };
  const legacy = await launchFatigue(t, { parts: { ...parts, interoception: { muscleFatigueMm: 45 } } });
  const control = await launchFatigue(t, {
    // A stored acute burden takes precedence even when the old readout differs.
    parts: { ...parts, interoception: { muscleFatigueAcuteMm: 40, muscleFatigueMm: 100 } },
  });
  const halfway = (await advance(legacy, 10)).interoception;
  await legacy.gateway.stop();
  const restarted = await launchFatigue(t, { statePath: legacy.statePath });
  const recovered = (await advance(restarted, 10)).interoception;
  closeTo(recovered.muscleFatigueMm, 30.1984209979);
  closeTo(halfway.muscleFatigueMm, 36.7480210394);
  assert.deepEqual(restarted.state().snapshot.parts.interoception, recovered);
  assert.deepEqual(recovered, (await advance(control, 20)).interoception);
});

test('a real exercise action builds acute fatigue for the active fraction of the minute even without muscle regions', async (t) => {
  const app = await launchFatigue(t);
  const queued = app.gateway.submitAction({ id: 'short-activity', type: 'exercise', intensity: 1, durationMin: 1.5 });
  assert.equal(queued.statusCode, 202);
  const started = await advance(app);
  assert.equal(app.gateway.getReceipt('short-activity').status, 'applied');
  assert.equal(started.interoception.muscleFatigueMm, 0, 'activity becomes visible in the following round');
  const active = (await advance(app)).interoception;
  closeTo(active.muscleFatigueMm, 2.07592561724);
  assert.equal(active.muscleFatigueMm, active.muscleFatigueAcuteMm, 'no regions means no depletion contribution');
  const finished = await advance(app);
  assert.equal(finished.physicalActivity.remainingExerciseMin, 0);
  closeTo(finished.interoception.muscleFatigueMm, 3.06047877763);
});

const manifestPath = fileURLToPath(new URL('../body-modules.json', import.meta.url));
const dehydrated = {
  bodyFluid: { waterVolumeMl: 28_000, waterDeficit: 1 },
  hypothalamusThirst: { thirst: 100 },
  interoception: { thirst: 0 }, // Old save: no committed subjective-thirst projection.
};

function launchThirst(t, statePath = null) {
  return launch(t, {
    seed: statePath === null ? checkpoint({ wallTimeMs: 0, parts: dehydrated }) : null,
    statePath,
    gatewayOptions: { manifestPath, now: () => 0 },
  });
}

function enqueue(app, action) {
  assert.equal(app.gateway.submitAction({ id: 'intake', ...action }).statusCode, 202);
}

test('a committed sip is felt before hydration, and thirst returns as the quick relief fades', async (t) => {
  const drinking = await launchThirst(t);
  const control = await launchThirst(t);
  const { body_state } = createBodyTools(drinking.gateway);
  const focus = async () => (await body_state.execute(
    { focus: 'thirst' }, { agent: { session: { id: 'recovery' } } },
  )).feelings.find(({ feeling }) => feeling.includes('口渴'))?.level;
  assert.equal(await focus(), 'strong', 'before the first new projection, use the legacy slow readout');
  await advance(drinking, 2);
  await advance(control, 2);

  enqueue(drinking, { type: 'drink', volumeMl: 20 });
  // The same volume of liquid food stimulates saliva without counting as water in the existing model.
  enqueue(control, { type: 'eat', volumeMl: 20, energyKcal: 0, mealKind: 'liquid' });
  const delivered = await advance(drinking);
  await advance(control);
  assert.equal(drinking.gateway.getReceipt('intake').status, 'applied');
  assert.equal(delivered.interoception.thirst, 100, 'no action-round shortcut');

  const relieved = await advance(drinking);
  const plain = await advance(control);
  closeTo(relieved.interoception.thirst, 64.6446609407);
  closeTo(relieved.interoception.oralThirstReliefFraction, 0.3535533906);
  assert.equal(delivered.stomach.deliveredWaterMl, 20);
  assert.equal(relieved.stomach.deliveredWaterMl, 0);
  assert.equal(plain.stomach.deliveredWaterMl, 0);
  for (const part of ['hypothalamusThirst', 'hypothalamusAdh', 'bodyFluid', 'kidney']) {
    assert.deepEqual(relieved[part], plain[part], `${part} does not react to the sensation`);
  }
  assert.equal(relieved.interoception.dryMouthMm, plain.interoception.dryMouthMm);
  assert.equal(await focus(), 'marked', 'the existing body_state shows subjective relief, not the slow drive');

  const rebound = await advance(drinking, 8);
  assert.ok(rebound.interoception.thirst > 95, 'a sip cannot satisfy sustained dehydration');
  assert.equal(rebound.interoception.dryMouthMm, 50, 'residual quick relief does not suppress dry mouth');
  assert.equal(await focus(), 'strong');
  assert.deepEqual(Object.keys(drinking.state().actions), ['intake'], 'no automatic intake or new action');
});

test('equal-dose instant and paced drinks use only each settled slice, including across restart', async (t) => {
  const instant = await launchThirst(t);
  let paced = await launchThirst(t);
  enqueue(instant, { type: 'drink', volumeMl: 20 });
  enqueue(paced, { type: 'drink', volumeMl: 20, durationMin: 2 });
  for (const [index, [instantMl, pacedMl, instantRelief, pacedRelief]] of [
    [20, 10, 0, 0],
    [0, 10, 0.3535533906, 0.2071067812],
    [0, 0, 0.25, 0.3106601718],
    [0, 0, 0.1767766953, 0.2196699141],
  ].entries()) {
    const a = await advance(instant);
    const b = await advance(paced);
    assert.equal(a.stomach.deliveredWaterMl, instantMl);
    assert.equal(b.stomach.deliveredWaterMl, pacedMl);
    closeTo(a.interoception.oralThirstReliefFraction, instantRelief);
    closeTo(b.interoception.oralThirstReliefFraction, pacedRelief);
    if (index === 1) {
      // Save with both nonzero relief and a newly committed 10 mL slice still to be read.
      await paced.gateway.stop();
      paced = await launchThirst(t, paced.statePath);
    }
  }
});
