import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSeventyTwoHourMetrics,
  repoRoot,
  runSeventyTwoHourReplay,
  verifyIntegratedScenario,
  verifyThermalPair,
} from '../tools/verify-integrated-body.mjs';

const LIPID_PRESET_MANIFEST = join(repoRoot, 'organs/presets/human-lipid/body-modules.json');
// 72 h 联合回放在完整套件里默认跳过（避免拖慢 npm test）；用
// `DSH_BODY_INTEGRATED_72H=1 node --test test/organs.integrated-body.test.mjs` 或
// `node tools/verify-integrated-body.mjs` 显式运行。跳过不是通过：入口每次都会实跑。
const fullReplayRequested = process.env.DSH_BODY_INTEGRATED_72H === '1';

test('the same external script reads a 37 °C human and a fictional 32 °C body without cross-talk', async () => {
  const result = await verifyThermalPair();
  assert.equal(result.human.reference.baselineCoreC, 37);
  assert.equal(result.human.reference.coreBandRelative, false);
  assert.equal(result.low.reference.baselineCoreC, 32);
  assert.equal(result.low.reference.coreBandRelative, true);
  assert.equal(result.low.coldMm, 0, 'the fictional 32 °C body must not feel cold at rest');
});

test('the lipid preset settles a known-fat meal, water, humid heat and a pause/restart twin', async () => {
  const result = await verifyIntegratedScenario({ manifestPath: LIPID_PRESET_MANIFEST });
  assert.equal(result.water.deliveredMl.join(','), '300,300,800');
  assert.ok(result.thirst.compositeAfterRelief < result.thirst.slowAfterSeed);
  assert.ok(result.sweat.restrictedExample.limitMl < result.sweat.restrictedExample.paidMl);
  assert.ok(result.fat.storedTgG <= result.fat.capacityG);
  assert.ok(Math.abs(result.fat.chainInventoryG - 80) <= 1e-3);
});

test('the M12 A schedule replays 72 h across 4320 real Gateway rounds', { skip: fullReplayRequested ? false : 'default-off: run via DSH_BODY_INTEGRATED_72H=1 or node tools/verify-integrated-body.mjs' }, async () => {
  const metrics = await runSeventyTwoHourReplay();
  assertSeventyTwoHourMetrics(metrics);
});
