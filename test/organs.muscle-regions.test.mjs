import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJsonValue } from '../json-safe.js';
import * as head from '../organs/human-organs/skeletal-muscle/regions/head.ts';
import * as limbs from '../organs/human-organs/skeletal-muscle/regions/limbs.ts';
import * as trunk from '../organs/human-organs/skeletal-muscle/regions/trunk.ts';

const regions = [
  ['head', 'muscleHead', head, 0.05, 15],
  ['trunk', 'muscleTrunk', trunk, 0.45, 135],
  ['limbs', 'muscleLimbs', limbs, 0.5, 150],
];

function regionRound(regionModule, { state, activity, dt = 60, simulatedSeconds = 60 } = {}) {
  const writes = [];
  regionModule.heartbeat({
    read: (partId) => {
      if (partId === regionModule.id) return state;
      if (partId === 'physicalActivity') return activity;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds,
    write: (next) => { writes.push(next); },
  });
  return { written: writes[writes.length - 1], writes };
}

function active(remainingExerciseMin = 10, intensity = 1) {
  return { remainingExerciseMin, intensity };
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('each region exports its own uptake, glycogen and consumption contract', () => {
  for (const [label, expectedId, regionModule, , initialGlycogenG] of regions) {
    assert.equal(regionModule.id, expectedId, label);
    assert.deepEqual(regionModule.actionTypes, [], label);
    assert.deepEqual(regionModule.fields, {
      uptakeG: {
        unit: 'g',
        mode: 'absolute',
        transferIn: ['muscleGlucose.uptakeG'],
      },
      glycogenG: { unit: 'g', mode: 'absolute' },
      glycogenConsumedG: { unit: 'g', mode: 'absolute' },
    }, label);
    assert.deepEqual(regionModule.initialState, {
      uptakeG: 0,
      glycogenG: initialGlycogenG,
      glycogenConsumedG: 0,
    }, label);

    const { written } = regionRound(regionModule);
    assert.deepEqual(written, {
      uptakeG: 0,
      glycogenG: initialGlycogenG,
      glycogenConsumedG: 0,
    }, label);
  }
});

test('each region books the previous uptake into its own glycogen and zeroes the flux', () => {
  for (const [label, , regionModule] of regions) {
    const { written } = regionRound(regionModule, {
      state: { uptakeG: 1.2, glycogenG: 10 },
    });
    assert.deepEqual(written, {
      uptakeG: 0,
      glycogenG: 11.2,
      glycogenConsumedG: 0,
    }, label);
  }
});

test('exercise consumes glycogen at the share-scaled rate times intensity and dt', () => {
  let totalOneMinConsumedG = 0;
  for (const [label, , regionModule, share] of regions) {
    const rate = 0.5 * share;
    const oneMinute = regionRound(regionModule, {
      state: { uptakeG: 0, glycogenG: 10 },
      activity: active(30, 1),
      dt: 60,
    });
    assertClose(oneMinute.written.glycogenConsumedG, rate, `${label}: one minute`);
    assertClose(oneMinute.written.glycogenG, 10 - rate, `${label}: glycogen after one minute`);
    totalOneMinConsumedG += oneMinute.written.glycogenConsumedG;

    const twoMinutes = regionRound(regionModule, {
      state: { uptakeG: 0, glycogenG: 10 },
      activity: active(30, 1),
      dt: 120,
    });
    assertClose(twoMinutes.written.glycogenConsumedG, 2 * rate, `${label}: two minutes`);
    assertClose(twoMinutes.written.glycogenG, 10 - 2 * rate, `${label}: glycogen after two minutes`);

    const halfMinuteLeft = regionRound(regionModule, {
      state: { uptakeG: 0, glycogenG: 10 },
      activity: active(0.5, 1),
      dt: 60,
    });
    assertClose(
      halfMinuteLeft.written.glycogenConsumedG,
      rate,
      `${label}: the last partial minute still consumes the whole dt`,
    );

    const scaled = regionRound(regionModule, {
      state: { uptakeG: 0, glycogenG: 10 },
      activity: active(30, 0.5),
      dt: 60,
    });
    assertClose(scaled.written.glycogenConsumedG, 0.5 * rate, `${label}: intensity 0.5 halves the rate`);
  }
  assertClose(totalOneMinConsumedG, 0.5, 'sum across all three regions equals 0.5 g/min');
});

test('the same round books uptake and consumes from the combined available pool', () => {
  for (const [label, , regionModule, share] of regions) {
    const rate = 0.5 * share;
    const { written } = regionRound(regionModule, {
      state: { uptakeG: 1.2, glycogenG: 10 },
      activity: active(30, 1),
      dt: 60,
    });
    assertClose(written.glycogenConsumedG, rate, `${label}: consumption`);
    assertClose(written.glycogenG, 10 + 1.2 - rate, `${label}: 10 + 1.2 - rate`);
    assert.equal(written.uptakeG, 0, `${label}: uptake flux resets`);
  }
});

test('consumption is clamped to the glycogen available this round', () => {
  for (const [label, , regionModule] of regions) {
    const lowGlycogen = regionRound(regionModule, {
      state: { uptakeG: 0, glycogenG: 0.01 },
      activity: active(30, 1),
      dt: 60,
    });
    assertClose(lowGlycogen.written.glycogenConsumedG, 0.01, `${label}: only the stored glycogen`);
    assert.equal(lowGlycogen.written.glycogenG, 0, label);

    const uptakeOnly = regionRound(regionModule, {
      state: { uptakeG: 0.015, glycogenG: 0 },
      activity: active(30, 1),
      dt: 60,
    });
    assertClose(uptakeOnly.written.glycogenConsumedG, 0.015, `${label}: uptake can pay consumption`);
    assert.equal(uptakeOnly.written.glycogenG, 0, label);
  }
});

test('a missing physicalActivity books uptake and consumes nothing', () => {
  for (const [label, , regionModule] of regions) {
    const { written } = regionRound(regionModule, {
      state: { uptakeG: 0.4, glycogenG: 10 },
    });
    assert.deepEqual(written, {
      uptakeG: 0,
      glycogenG: 10.4,
      glycogenConsumedG: 0,
    }, label);
  }
});

test('a loaded activity with finished exercise consumes nothing', () => {
  for (const [label, , regionModule] of regions) {
    const { written } = regionRound(regionModule, {
      state: { uptakeG: 0, glycogenG: 10 },
      activity: active(0, 1),
    });
    assert.equal(written.glycogenConsumedG, 0, label);
    assert.equal(written.glycogenG, 10, label);
  }
});

test('a loaded activity part with missing or invalid fields fails with zero writes', () => {
  const invalid = [
    ['empty part', {}],
    ['missing intensity', { remainingExerciseMin: 10 }],
    ['missing remaining minutes', { intensity: 1 }],
    ['non-finite remaining minutes', { remainingExerciseMin: Number.NaN, intensity: 1 }],
    ['negative remaining minutes', { remainingExerciseMin: -1, intensity: 1 }],
    ['intensity below zero', { remainingExerciseMin: 10, intensity: -0.1 }],
    ['intensity above one', { remainingExerciseMin: 10, intensity: 1.5 }],
    ['non-finite intensity', { remainingExerciseMin: 10, intensity: Number.POSITIVE_INFINITY }],
  ];

  for (const [label, , regionModule] of regions) {
    for (const [caseLabel, activity] of invalid) {
      const writes = [];
      assert.throws(
        () => regionModule.heartbeat({
          read: (partId) => {
            if (partId === 'physicalActivity') return activity;
            return undefined;
          },
          actions: [],
          dt: 60,
          simulatedSeconds: 60,
          write: (next) => { writes.push(next); },
        }),
        Error,
        `${label}: ${caseLabel}`,
      );
      assert.equal(writes.length, 0, `${label}: ${caseLabel}: the round must not write`);
    }
  }
});

test('each region output is finite and JSON-safe across activity states', () => {
  const cases = [
    { label: 'missing state and activity', options: {} },
    {
      label: 'active with uptake',
      options: { state: { uptakeG: 1.2, glycogenG: 10 }, activity: active() },
    },
    {
      label: 'fractional activity and dt',
      options: {
        state: { uptakeG: 0.3, glycogenG: 7.5 },
        activity: active(10, 0.37),
        dt: 90,
      },
    },
    {
      label: 'old state and short activity',
      options: { state: { uptakeG: 0.1, glycogenG: 0.1 }, activity: active(0.5, 1) },
    },
    {
      label: 'finished activity',
      options: { state: { uptakeG: 0, glycogenG: 0 }, activity: active(0, 1) },
    },
  ];

  for (const [label, , regionModule] of regions) {
    for (const { label: caseLabel, options } of cases) {
      const { written, writes } = regionRound(regionModule, options);
      assert.equal(writes.length, 1, `${label}: ${caseLabel}`);
      for (const [field, value] of Object.entries(written)) {
        assert.ok(Number.isFinite(value), `${label}: ${caseLabel}: ${field} must be finite`);
      }
      assertJsonValue(written);
      assert.deepEqual(JSON.parse(JSON.stringify(written)), written, `${label}: ${caseLabel}`);
    }
  }
});
