import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/sexual-response/response.ts';

const parametersUrl = new URL(
  '../organs/human-organs/sexual-response/response.parameters.json',
  import.meta.url,
);
const parameterFile = JSON.parse(readFileSync(parametersUrl, 'utf8'));

function round({ state, actions = [], dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  heartbeat({
    read: (partId) => (partId === 'sexualResponse' ? state : undefined),
    actions,
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function sex(intensity, durationMin) {
  return { type: 'sex', intensity, durationMin };
}

function assertClose(actual, expected, label, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('sexualResponse exports the organ module contract', () => {
  assert.equal(id, 'sexualResponse');
  assert.deepEqual(actionTypes, ['sex', 'orgasm']);
  assert.deepEqual(fields, {
    arousalMm: { unit: 'mm', mode: 'absolute' },
    phase: { unit: '-', mode: 'absolute' },
    remainingSexMin: { unit: 'min', mode: 'absolute' },
    sexIntensity: { unit: '1', mode: 'absolute' },
    lastOrgasmAtSimMin: { unit: 'min', mode: 'absolute' },
  });
  assert.deepEqual(initialState, {
    arousalMm: 0,
    phase: 'rest',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  });

  const { written, writes } = round();
  assert.equal(writes.length, 1);
  assert.deepEqual(written, initialState);
});

test('the six response parameters are design defaults with no source', () => {
  assert.equal(parameterFile.schemaVersion, 1);
  assert.equal(parameterFile.owner, 'sexualResponse');

  const expected = {
    'sexualResponse.arousalHalfTimeMin': { unit: 'min', value: 5 },
    'sexualResponse.resolutionHalfTimeMin': { unit: 'min', value: 15 },
    'sexualResponse.orgasmAllowedMm': { unit: 'mm', value: 70 },
    'sexualResponse.orgasmForcedMm': { unit: 'mm', value: 95 },
    'sexualResponse.orgasmDurationMin': { unit: 'min', value: 1 },
    'sexualResponse.refractoryMin': { unit: 'min', value: 20 },
  };
  const byId = Object.fromEntries(
    parameterFile.parameters.map((parameter) => [parameter.id, parameter]),
  );
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expected).sort());

  for (const [parameterId, { unit, value }] of Object.entries(expected)) {
    const parameter = byId[parameterId];
    assert.equal(parameter.unit, unit, parameterId);
    assert.equal(parameter.value, value, parameterId);
    assert.equal(parameter.status, 'design', parameterId);
    assert.equal(parameter.source, null, parameterId);
  }

  assert.deepEqual(loadParameters(parametersUrl), {
    'sexualResponse.arousalHalfTimeMin': 5,
    'sexualResponse.resolutionHalfTimeMin': 15,
    'sexualResponse.orgasmAllowedMm': 70,
    'sexualResponse.orgasmForcedMm': 95,
    'sexualResponse.orgasmDurationMin': 1,
    'sexualResponse.refractoryMin': 20,
  });
});

test('a valid sex action replaces the remaining minutes and raises arousal into excitement', () => {
  const { written, writes } = round({ actions: [sex(0.8, 30)] });
  assert.equal(writes.length, 1);
  assert.equal(written.remainingSexMin, 30);
  assert.equal(written.sexIntensity, 0.8);
  assert.equal(written.phase, 'excitement');
  assert.equal(written.lastOrgasmAtSimMin, null);
  // 目标 100 × 0.8 = 80 mm，唤醒半时 5 min，轮末 1 min。
  assertClose(written.arousalMm, 80 * (1 - 2 ** (-1 / 5)), 'first minute');
  assert.ok(written.arousalMm > 0);

  let state = written;
  for (let minute = 2; minute <= 6; minute++) {
    const next = round({ state, simulatedSeconds: minute * 60 }).written;
    assert.ok(next.arousalMm > state.arousalMm, `minute ${minute}: arousal rises`);
    assert.ok(next.arousalMm < 80, `minute ${minute}: arousal stays below target`);
    assert.equal(next.remainingSexMin, 31 - minute, `minute ${minute}: remaining`);
    state = next;
  }
});

test('the last valid sex action wins and payload extras are ignored', () => {
  const { written } = round({
    state: { arousalMm: 0, phase: 'rest', remainingSexMin: 4, sexIntensity: 0.5, lastOrgasmAtSimMin: null },
    actions: [sex(0.2, 10), { type: 'drink', volumeMl: 240 }, sex(0.9, 20)],
    simulatedSeconds: 120,
  });
  assert.equal(written.remainingSexMin, 20);
  assert.equal(written.sexIntensity, 0.9);

  const extras = round({
    actions: [{ type: 'sex', intensity: 0.4, durationMin: 7, volumeMl: 500, energyKcal: 40 }],
  }).written;
  assert.equal(extras.remainingSexMin, 7);
  assert.equal(extras.sexIntensity, 0.4);
});

test('sustained high intensity no longer records an orgasm by itself', () => {
  let state = initialState;
  const history = [];
  for (let minute = 1; minute <= 20; minute++) {
    const actions = minute === 1 ? [sex(1, 30)] : [];
    state = round({ state, actions, simulatedSeconds: minute * 60 }).written;
    history.push({ minute, state });
  }

  // 目标 100、半时 5 min：第 17 轮 arousal = 90.53 mm，但释放只由动作或强制阈值触发。
  assert.ok(history[16].state.arousalMm >= 90);
  assert.equal(history[16].state.phase, 'plateau');
  for (const { minute, state: current } of history) {
    assert.equal(current.lastOrgasmAtSimMin, null, `minute ${minute}: no auto release`);
  }
});

test('an orgasm action at round-start arousal 80 releases once and enters refractory', () => {
  const state = {
    arousalMm: 80,
    phase: 'plateau',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  };
  const release = round({
    state,
    actions: [{ type: 'orgasm' }],
    simulatedSeconds: 60,
  }).written;

  assert.equal(release.lastOrgasmAtSimMin, 1);
  assert.equal(release.phase, 'orgasm');
  // 无活动时目标为 0，释放轮仍先按消退半时计算唤醒。
  assertClose(release.arousalMm, 80 * 2 ** (-1 / 15), 'release round');

  const next = round({ state: release, simulatedSeconds: 120 }).written;
  assert.equal(next.phase, 'refractory');
  assert.equal(next.lastOrgasmAtSimMin, 1);
  assert.ok(next.arousalMm < release.arousalMm, 'arousal falls in refractory');

  let current = next;
  for (let minute = 3; minute <= 21; minute++) {
    current = round({ state: current, simulatedSeconds: minute * 60 }).written;
    assert.equal(current.lastOrgasmAtSimMin, 1, `minute ${minute}: recorded once`);
  }
  assert.equal(current.phase, 'resolution', '20 minutes after the release');
});

test('voluntary release is judged on round-start arousal, not the end-of-round value', () => {
  const beforeThreshold = {
    arousalMm: 69.9,
    phase: 'plateau',
    remainingSexMin: 10,
    sexIntensity: 1,
    lastOrgasmAtSimMin: null,
  };
  const ignored = round({
    state: beforeThreshold,
    actions: [{ type: 'orgasm' }],
    simulatedSeconds: 60,
  }).written;
  assert.ok(ignored.arousalMm > 70, 'the end-of-round arousal can cross 70');
  assert.equal(ignored.lastOrgasmAtSimMin, null);
  assert.equal(ignored.phase, 'plateau');

  const atThreshold = round({
    state: { ...beforeThreshold, arousalMm: 70 },
    actions: [{ type: 'orgasm' }],
    simulatedSeconds: 60,
  }).written;
  assert.equal(atThreshold.lastOrgasmAtSimMin, 1);
  assert.equal(atThreshold.phase, 'orgasm');
});

test('an orgasm action below orgasmAllowedMm is ignored and changes nothing', () => {
  const state = {
    arousalMm: 60,
    phase: 'plateau',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  };
  const baseline = round({ state, simulatedSeconds: 60 }).written;
  const ignored = round({
    state,
    actions: [{ type: 'orgasm', intensity: 99, durationMin: 99 }],
    simulatedSeconds: 60,
  }).written;

  assert.deepEqual(ignored, baseline);
  assert.equal(ignored.lastOrgasmAtSimMin, null);
  assert.equal(ignored.phase, 'resolution');
  assertClose(ignored.arousalMm, 60 * 2 ** (-1 / 15), 'one minute of resolution');
});

test('round-start arousal at orgasmForcedMm releases without any action', () => {
  const state = {
    arousalMm: 95,
    phase: 'plateau',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  };
  const release = round({ state, simulatedSeconds: 60 }).written;
  assert.equal(release.lastOrgasmAtSimMin, 1);
  assert.equal(release.phase, 'orgasm');
  assertClose(release.arousalMm, 95 * 2 ** (-1 / 15), 'forced release round');

  const next = round({ state: release, simulatedSeconds: 120 }).written;
  assert.equal(next.phase, 'refractory');
  assert.equal(next.lastOrgasmAtSimMin, 1);

  const below = round({
    state: { ...state, arousalMm: 94.9 },
    simulatedSeconds: 60,
  }).written;
  assert.equal(below.lastOrgasmAtSimMin, null);
  assert.notEqual(below.phase, 'orgasm');
});

test('a sex action during refractory replaces remaining minutes but arousal keeps falling', () => {
  const refractoryState = {
    arousalMm: 92,
    phase: 'orgasm',
    remainingSexMin: 5,
    sexIntensity: 1,
    lastOrgasmAtSimMin: 10,
  };
  const { written } = round({
    state: refractoryState,
    actions: [sex(0.9, 30)],
    simulatedSeconds: 12 * 60,
  });

  assert.equal(written.remainingSexMin, 30);
  assert.equal(written.sexIntensity, 0.9);
  assert.equal(written.phase, 'refractory');
  assert.ok(written.arousalMm < refractoryState.arousalMm, 'no rise during refractory');
  assert.equal(written.lastOrgasmAtSimMin, 10);

  let state = written;
  let previous = written;
  for (let minute = 13; minute <= 30; minute++) {
    previous = state;
    state = round({ state, simulatedSeconds: minute * 60 }).written;
    if (minute < 30) {
      assert.equal(state.phase, 'refractory', `minute ${minute}: still refractory`);
      assert.ok(state.arousalMm < previous.arousalMm, `minute ${minute}: arousal falls`);
    }
  }
  // 第 30 min 距记录（第 10 min）20 min，不应期结束；剩余活动仍在，回到兴奋。
  assert.equal(state.phase, 'excitement');
  assert.ok(state.arousalMm > previous.arousalMm, 'arousal rises again after refractory');
  assert.equal(state.lastOrgasmAtSimMin, 10);
});

test('without activity the phase resolves and returns to rest', () => {
  const state = {
    arousalMm: 20,
    phase: 'excitement',
    remainingSexMin: 0,
    sexIntensity: 0,
    lastOrgasmAtSimMin: null,
  };
  const first = round({ state }).written;
  assert.equal(first.phase, 'resolution');
  assertClose(first.arousalMm, 20 * 2 ** (-1 / 15), 'one minute of resolution');

  let current = first;
  let sawRest = false;
  for (let minute = 2; minute <= 30; minute++) {
    current = round({ state: current, simulatedSeconds: minute * 60 }).written;
    if (current.arousalMm < 10) {
      assert.equal(current.phase, 'rest', `minute ${minute}: phase`);
      sawRest = true;
      break;
    }
    assert.equal(current.phase, 'resolution', `minute ${minute}: phase`);
  }
  assert.ok(sawRest, 'resolution must end in rest');

  const rest = round({
    state: { arousalMm: 9.9, phase: 'resolution', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null },
  }).written;
  assert.equal(rest.phase, 'rest');
});

test('an active plateau is labelled when arousal is at least 60 mm', () => {
  const state = {
    arousalMm: 65,
    phase: 'excitement',
    remainingSexMin: 10,
    sexIntensity: 1,
    lastOrgasmAtSimMin: null,
  };
  const plateau = round({ state }).written;
  assert.ok(plateau.arousalMm >= 60);
  assert.equal(plateau.phase, 'plateau');

  const excitement = round({ state: { ...state, arousalMm: 40 } }).written;
  assert.equal(excitement.phase, 'excitement');
});

test('invalid sex actions are ignored and leave the state evolution unchanged', () => {
  const state = {
    arousalMm: 42,
    phase: 'excitement',
    remainingSexMin: 12,
    sexIntensity: 0.4,
    lastOrgasmAtSimMin: null,
  };
  const baseline = round({ state, simulatedSeconds: 120 }).written;

  const invalid = [
    ['zero intensity', sex(0, 30)],
    ['negative intensity', sex(-0.2, 30)],
    ['intensity above one', sex(1.5, 30)],
    ['NaN intensity', sex(Number.NaN, 30)],
    ['positive infinite intensity', sex(Number.POSITIVE_INFINITY, 30)],
    ['string intensity', sex('0.5', 30)],
    ['zero duration', sex(0.8, 0)],
    ['negative duration', sex(0.8, -10)],
    ['NaN duration', sex(0.8, Number.NaN)],
    ['positive infinite duration', sex(0.8, Number.POSITIVE_INFINITY)],
    ['string duration', sex(0.8, '30')],
    ['missing fields', { type: 'sex' }],
    ['orgasm below threshold', { type: 'orgasm' }],
  ];

  for (const [label, action] of invalid) {
    const { written, writes } = round({ state, actions: [action], simulatedSeconds: 120 });
    assert.equal(writes.length, 1, label);
    assert.deepEqual(written, baseline, label);
  }

  const nonSex = round({
    state,
    actions: [{ type: 'drink', volumeMl: 240 }, { type: 'exercise', intensity: 0.5, durationMin: 10 }],
    simulatedSeconds: 120,
  }).written;
  assert.deepEqual(nonSex, baseline);
});

test('an invalid sex action does not override an earlier valid one in the same round', () => {
  const { written } = round({
    state: { arousalMm: 0, phase: 'rest', remainingSexMin: 12, sexIntensity: 0.4, lastOrgasmAtSimMin: null },
    actions: [sex(0.7, 15), sex(0, 30)],
    simulatedSeconds: 120,
  });
  assert.equal(written.remainingSexMin, 15);
  assert.equal(written.sexIntensity, 0.7);
});

test('lastOrgasmAtSimMin null survives JSON round-trip and restart', () => {
  assertJsonValue(initialState);
  assert.deepEqual(JSON.parse(JSON.stringify(initialState)), initialState);

  const savedBeforeOrgasm = JSON.parse(JSON.stringify({
    arousalMm: 30,
    phase: 'excitement',
    remainingSexMin: 8,
    sexIntensity: 0.6,
    lastOrgasmAtSimMin: null,
  }));
  const afterRestart = round({ state: savedBeforeOrgasm, simulatedSeconds: 600 }).written;
  assert.equal(afterRestart.lastOrgasmAtSimMin, null);
  assert.notEqual(afterRestart.lastOrgasmAtSimMin, 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(afterRestart)),
    afterRestart,
  );

  const savedAfterOrgasm = JSON.parse(JSON.stringify({
    arousalMm: 92,
    phase: 'orgasm',
    remainingSexMin: 4,
    sexIntensity: 1,
    lastOrgasmAtSimMin: 7,
  }));
  const refractory = round({ state: savedAfterOrgasm, simulatedSeconds: 8 * 60 }).written;
  assert.equal(refractory.lastOrgasmAtSimMin, 7);
  assert.equal(refractory.phase, 'refractory');
});

test('sexualResponse output is finite and JSON-safe across the cycle', () => {
  const cases = [
    { label: 'initial', options: {} },
    { label: 'after sex', options: { actions: [sex(0.8, 30)] } },
    {
      label: 'resolution',
      options: {
        state: { arousalMm: 25, phase: 'resolution', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null },
        simulatedSeconds: 300,
      },
    },
    {
      label: 'voluntary release',
      options: {
        state: { arousalMm: 80, phase: 'plateau', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null },
        actions: [{ type: 'orgasm' }],
      },
    },
    {
      label: 'forced release',
      options: {
        state: { arousalMm: 95, phase: 'plateau', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null },
      },
    },
    {
      label: 'ignored orgasm action',
      options: {
        state: { arousalMm: 60, phase: 'plateau', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: null },
        actions: [{ type: 'orgasm' }],
      },
    },
    {
      label: 'refractory',
      options: {
        state: { arousalMm: 92, phase: 'orgasm', remainingSexMin: 0, sexIntensity: 0, lastOrgasmAtSimMin: 7 },
        simulatedSeconds: 480,
      },
    },
    {
      label: 'fractional dt',
      options: {
        state: { arousalMm: 50, phase: 'excitement', remainingSexMin: 3, sexIntensity: 0.5, lastOrgasmAtSimMin: null },
        dt: 90,
        simulatedSeconds: 90,
      },
    },
    {
      label: 'finished activity',
      options: {
        state: { arousalMm: 12, phase: 'resolution', remainingSexMin: 0.25, sexIntensity: 0.5, lastOrgasmAtSimMin: null },
      },
    },
  ];

  for (const { label, options } of cases) {
    const { written, writes } = round(options);
    assert.equal(writes.length, 1, label);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written, label);
    for (const key of ['arousalMm', 'remainingSexMin', 'sexIntensity']) {
      assert.ok(Number.isFinite(written[key]), `${label}: ${key} must be finite`);
    }
    assert.ok(
      written.lastOrgasmAtSimMin === null || Number.isFinite(written.lastOrgasmAtSimMin),
      `${label}: lastOrgasmAtSimMin must be null or finite`,
    );
  }
});
