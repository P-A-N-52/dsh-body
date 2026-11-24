import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/notify.ts';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

function session(overrides = {}) {
  return {
    lastSentAt: null,
    lastLevel: 0,
    lastKind: null,
    hourStartedAt: 0,
    hourCount: 0,
    dayStartedAt: 0,
    dayCount: 0,
    lastSeenAt: 0,
    ...overrides,
  };
}

function levels(overrides = {}) {
  return { hunger: 0, fullness: 0, urinary: 0, thirst: 0, ...overrides };
}

function round({
  state,
  interoception = { hunger: 50, fullness: 0 },
  bladder,
  actions = [],
  simulatedSeconds = 60,
} = {}) {
  const notifications = [];
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'brainNotify') return state;
      if (partId === 'interoception') return interoception;
      if (partId === 'bladder') return bladder;
      return undefined;
    },
    actions,
    dt: 60,
    simulatedSeconds,
    notify: (notification) => { notifications.push(notification); },
    write: (next) => { written = next; },
  });
  return { written, notifications };
}

function assertJsonSafe(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `non-finite number: ${value}`);
    return;
  }
  assert.ok(value && typeof value === 'object', `unexpected value: ${String(value)}`);
  assert.ok(!Array.isArray(value), 'unexpected array');
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(child, undefined, `undefined at ${key}`);
    assertJsonSafe(child);
  }
}

test('brainNotify exports the organ module contract', () => {
  assert.equal(id, 'brainNotify');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(initialState, { lastSessionId: null, sessions: {} });
  assert.deepEqual(fields, {
    lastSessionId: { unit: '1', mode: 'absolute' },
    sessions: { unit: '1', mode: 'absolute' },
  });
});

test('no session id means no notification', () => {
  const { written, notifications } = round({
    interoception: { hunger: 100, fullness: 100 },
    actions: [
      { id: 'meal-1', type: 'eat', sessionId: '' },
      { id: 'meal-2', type: 'eat', sessionId: 42 },
    ],
  });
  assert.deepEqual(notifications, []);
  assert.deepEqual(written, { lastSessionId: null, sessions: {} });
});

test('marked hunger sends one context notification', () => {
  const { written, notifications } = round({
    interoception: { hunger: 65, fullness: 0 },
    actions: [{ id: 'meal-1', type: 'eat', sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });

  assert.deepEqual(notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
  }]);
  assert.equal(written.lastSessionId, 'session-a');
  assert.deepEqual(written.sessions['session-a'], {
    lastSentAt: 60,
    lastLevel: 2,
    lastKind: 'hunger',
    hourStartedAt: 60,
    hourCount: 1,
    dayStartedAt: 60,
    dayCount: 1,
    lastSeenAt: 60,
    levels: levels({ hunger: 2 }),
  });
});

test('the last action carrying a session id wins', () => {
  const { notifications } = round({
    interoception: { hunger: 70, fullness: 0 },
    actions: [
      { sessionId: 'session-a' },
      { sessionId: '' },
      { sessionId: 'session-b' },
      { id: 'no-session' },
    ],
    simulatedSeconds: 60,
  });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].sessionId, 'session-b');
});

test('same level does not repeat', () => {
  const first = round({
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);

  const later = round({
    state: first.written,
    interoception: { hunger: 72, fullness: 0 },
    actions: [],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(later.notifications, []);
  assert.equal(later.written.sessions['session-a'].lastSentAt, 60);
  assert.equal(later.written.sessions['session-a'].lastLevel, 2);
  assert.equal(later.written.sessions['session-a'].hourCount, 1);
  assert.equal(later.written.sessions['session-a'].dayCount, 1);
});

test('a drop below reset allows a later rise after cooldown', () => {
  const first = round({
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);

  const dropped = round({
    state: first.written,
    interoception: { hunger: 10, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(dropped.notifications, []);
  assert.equal(dropped.written.sessions['session-a'].lastLevel, 0);

  const blocked = round({
    state: dropped.written,
    interoception: { hunger: 70, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 180,
  });
  assert.deepEqual(blocked.notifications, []);
  assert.equal(blocked.written.sessions['session-a'].lastLevel, 0);
  assert.equal(blocked.written.sessions['session-a'].lastSentAt, 60);

  const repeated = round({
    state: blocked.written,
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.equal(repeated.notifications.length, 1);
  assert.equal(repeated.notifications[0].mode, 'context');
  assert.equal(repeated.written.sessions['session-a'].lastSentAt, 60 + 45 * MINUTE);
});

test('strong fullness uses wake when wakeAtLevel is 3', () => {
  const { notifications } = round({
    interoception: { hunger: 0, fullness: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很满，饱足感很明显，可能不太想再吃。',
  }]);
});

test('equal hunger and fullness levels prefer fullness', () => {
  const { notifications } = round({
    interoception: { hunger: 65, fullness: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].mode, 'context');
  assert.equal(notifications[0].text, '身体感受：胃里有些满，饱足感开始明显。');
});

test('hour and day quotas are per session', () => {
  const exhaustedHour = round({
    state: {
      lastSessionId: 'session-a',
      sessions: {
        'session-a': session({
          hourStartedAt: 60,
          hourCount: 2,
          dayStartedAt: 60,
          dayCount: 2,
          lastSeenAt: 60,
        }),
      },
    },
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(exhaustedHour.notifications, []);

  const freshSession = round({
    state: exhaustedHour.written,
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-b' }],
    simulatedSeconds: 120,
  });
  assert.equal(freshSession.notifications.length, 1);
  assert.equal(freshSession.notifications[0].sessionId, 'session-b');

  const exhaustedDay = round({
    state: {
      lastSessionId: 'session-c',
      sessions: {
        'session-c': session({
          hourStartedAt: 60,
          hourCount: 0,
          dayStartedAt: 60,
          dayCount: 6,
          lastSeenAt: 60,
        }),
      },
    },
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-c' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(exhaustedDay.notifications, []);
});

test('hour and day counters reset at their boundaries', () => {
  const refreshed = round({
    state: {
      lastSessionId: 'session-a',
      sessions: {
        'session-a': session({
          hourStartedAt: HOUR,
          hourCount: 2,
          dayStartedAt: DAY,
          dayCount: 6,
          lastSeenAt: HOUR,
        }),
      },
    },
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 2 * DAY,
  });
  assert.equal(refreshed.notifications.length, 1);
  assert.equal(refreshed.written.sessions['session-a'].hourCount, 1);
  assert.equal(refreshed.written.sessions['session-a'].dayCount, 1);
});

test('missing interoception falls back to baseline without NaN', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        lastLevel: 2,
        lastKind: 'hunger',
        hourStartedAt: 60,
        hourCount: 1,
        dayStartedAt: 60,
        dayCount: 1,
        lastSeenAt: 60,
      }),
    },
  };

  const missing = round({
    state: seeded,
    interoception: undefined,
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(missing.notifications, []);
  assert.equal(missing.written.sessions['session-a'].lastLevel, 1);
  assertJsonSafe(missing.written);

  const nonFinite = round({
    state: seeded,
    interoception: { hunger: Number.NaN, fullness: Number.POSITIVE_INFINITY },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(nonFinite.notifications, []);
  assert.equal(nonFinite.written.sessions['session-a'].lastLevel, 1);
  assertJsonSafe(nonFinite.written);
});

test('notify state stays JSON-safe across rounds', () => {
  let state;
  const rounds = [
    {
      interoception: { hunger: 66, fullness: 0 },
      actions: [{ sessionId: 'session-a' }],
      simulatedSeconds: 60,
    },
    {
      interoception: { hunger: 0, fullness: 90 },
      actions: [{ sessionId: 'session-b' }],
      simulatedSeconds: 120,
    },
    {
      interoception: { hunger: 50, fullness: 0 },
      actions: [],
      simulatedSeconds: 180,
    },
    {
      interoception: { hunger: Number.NaN, fullness: Number.NaN },
      actions: [{ sessionId: 'session-c' }],
      simulatedSeconds: 240,
    },
  ];

  for (const input of rounds) {
    const { written } = round({ ...input, state });
    assertJsonSafe(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
    state = written;
  }
});

test('sessions are pruned to the most recent maxTrackedSessions', () => {
  const sessions = {};
  for (let index = 0; index < 33; index += 1) {
    sessions[`old-${index}`] = session({ lastSeenAt: index });
  }

  const { written } = round({
    state: { lastSessionId: 'session-new', sessions },
    interoception: { hunger: 50, fullness: 0 },
    actions: [{ sessionId: 'session-new' }],
    simulatedSeconds: 1000,
  });

  assert.equal(Object.keys(written.sessions).length, 32);
  assert.ok(written.sessions['session-new']);
  assert.equal(written.sessions['old-0'], undefined);
});

test('session ids longer than 256 characters are not notified', () => {
  const { notifications } = round({
    interoception: { hunger: 90, fullness: 0 },
    actions: [{ sessionId: 'x'.repeat(257) }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(notifications, []);
});

test('a strong hunger crossing after marked hunger waits for the cooldown', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        lastLevel: 2,
        lastKind: 'hunger',
        hourStartedAt: 60,
        hourCount: 1,
        dayStartedAt: 60,
        dayCount: 1,
        lastSeenAt: 60,
      }),
    },
  };

  const early = round({
    state: seeded,
    interoception: { hunger: 85, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 44 * MINUTE,
  });
  assert.deepEqual(early.notifications, []);
  assert.equal(early.written.sessions['session-a'].lastLevel, 2);
  assert.equal(early.written.sessions['session-a'].lastSentAt, 60);

  const ready = round({
    state: early.written,
    interoception: { hunger: 85, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(ready.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.equal(ready.written.sessions['session-a'].lastLevel, 3);
  assert.equal(ready.written.sessions['session-a'].lastKind, 'hunger');
  assert.equal(ready.written.sessions['session-a'].lastSentAt, 60 + 45 * MINUTE);
  assert.equal(ready.written.sessions['session-a'].hourCount, 2);
  assert.equal(ready.written.sessions['session-a'].dayCount, 2);
});

test('urinary urgency uses 65 mm context and 85 mm wake thresholds', () => {
  const marked = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 65 },
    actions: [{ sessionId: 'session-marked' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(marked.notifications, [{
    mode: 'context',
    sessionId: 'session-marked',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.equal(marked.written.sessions['session-marked'].lastKind, 'urinary');
  assert.equal(marked.written.sessions['session-marked'].lastLevel, 2);
  assert.deepEqual(marked.written.sessions['session-marked'].levels, levels({ urinary: 2 }));

  const strong = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 85 },
    actions: [{ sessionId: 'session-strong' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(strong.notifications, [{
    mode: 'wake',
    sessionId: 'session-strong',
    text: '身体感受：膀胱很满，尿意很明显。',
  }]);
  assert.equal(strong.written.sessions['session-strong'].lastKind, 'urinary');
  assert.equal(strong.written.sessions['session-strong'].lastLevel, 3);
  assert.deepEqual(strong.written.sessions['session-strong'].levels, levels({ urinary: 3 }));

  const below = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 64 },
    actions: [{ sessionId: 'session-low' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(below.notifications, []);
  assert.deepEqual(below.written.sessions['session-low'].levels, levels());
});

test('urinary hysteresis repeats only after a drop below reset', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);
  assert.deepEqual(first.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const sameLevel = round({
    state: first.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 72 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(sameLevel.notifications, []);
  assert.equal(sameLevel.written.sessions['session-a'].lastSentAt, 60);
  assert.deepEqual(sameLevel.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const dropped = round({
    state: sameLevel.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 10 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 46 * MINUTE,
  });
  assert.deepEqual(dropped.notifications, []);
  assert.deepEqual(dropped.written.sessions['session-a'].levels, levels());

  const repeated = round({
    state: dropped.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 47 * MINUTE,
  });
  assert.equal(repeated.notifications.length, 1);
  assert.equal(repeated.notifications[0].mode, 'context');
  assert.equal(repeated.written.sessions['session-a'].lastSentAt, 60 + 47 * MINUTE);
  assert.deepEqual(repeated.written.sessions['session-a'].levels, levels({ urinary: 2 }));
});

test('urinary and hunger share the 45 minute cooldown without consuming water', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);
  assert.deepEqual(first.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const early = round({
    state: first.written,
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 10 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 44 * MINUTE,
  });
  assert.deepEqual(early.notifications, []);
  assert.equal(early.written.sessions['session-a'].lastSentAt, 60);
  assert.deepEqual(early.written.sessions['session-a'].levels, levels());

  const ready = round({
    state: early.written,
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 10 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(ready.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.deepEqual(ready.written.sessions['session-a'].levels, levels({ hunger: 3 }));
});

test('a notified hunger does not suppress a later urinary notification and vice versa', () => {
  const hungerFirst = round({
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(hungerFirst.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.deepEqual(hungerFirst.written.sessions['session-a'].levels, levels({ hunger: 3 }));

  const urinarySecond = round({
    state: hungerFirst.written,
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(urinarySecond.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：膀胱很满，尿意很明显。',
  }]);
  assert.equal(urinarySecond.written.sessions['session-a'].lastKind, 'urinary');
  assert.deepEqual(
    urinarySecond.written.sessions['session-a'].levels,
    levels({ hunger: 3, urinary: 3 }),
  );
  assert.equal(urinarySecond.written.sessions['session-a'].hourCount, 2);
  assert.equal(urinarySecond.written.sessions['session-a'].dayCount, 2);

  const urinaryFirst = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 85 },
    actions: [{ sessionId: 'session-b' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(urinaryFirst.notifications, [{
    mode: 'wake',
    sessionId: 'session-b',
    text: '身体感受：膀胱很满，尿意很明显。',
  }]);
  assert.deepEqual(urinaryFirst.written.sessions['session-b'].levels, levels({ urinary: 3 }));

  const hungerSecond = round({
    state: urinaryFirst.written,
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 85 },
    actions: [{ sessionId: 'session-b' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(hungerSecond.notifications, [{
    mode: 'wake',
    sessionId: 'session-b',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.equal(hungerSecond.written.sessions['session-b'].lastKind, 'hunger');
  assert.deepEqual(
    hungerSecond.written.sessions['session-b'].levels,
    levels({ hunger: 3, urinary: 3 }),
  );
  assert.equal(hungerSecond.written.sessions['session-b'].hourCount, 2);
  assert.equal(hungerSecond.written.sessions['session-b'].dayCount, 2);
});

test('the highest level wins and a lower candidate keeps its water level', () => {
  const first = round({
    interoception: { hunger: 85, fullness: 65, urinaryUrgency: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(first.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.deepEqual(first.written.sessions['session-a'].levels, levels({ hunger: 3 }));

  const later = round({
    state: first.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(later.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(later.written.sessions['session-a'].levels, levels({ urinary: 2 }));
});

test('equal levels prefer urinary over fullness and hunger without consuming their water', () => {
  const first = round({
    interoception: { hunger: 65, fullness: 65, urinaryUrgency: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(first.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(first.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const fullnessNext = round({
    state: first.written,
    interoception: { hunger: 65, fullness: 65, urinaryUrgency: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(fullnessNext.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些满，饱足感开始明显。',
  }]);
  assert.deepEqual(fullnessNext.written.sessions['session-a'].levels, levels({ fullness: 2 }));
});

test('legacy lastKind and lastLevel migrate into per-signal levels', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        lastLevel: 2,
        lastKind: 'hunger',
        hourStartedAt: 60,
        hourCount: 1,
        dayStartedAt: 60,
        dayCount: 1,
        lastSeenAt: 60,
      }),
    },
  };

  const sameSignal = round({
    state: seeded,
    interoception: { hunger: 70, fullness: 0, urinaryUrgency: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(sameSignal.notifications, []);
  assert.deepEqual(sameSignal.written.sessions['session-a'].levels, levels({ hunger: 2 }));

  const newSignal = round({
    state: sameSignal.written,
    interoception: { hunger: 70, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 90 * MINUTE,
  });
  assert.deepEqual(newSignal.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.equal(newSignal.written.sessions['session-a'].lastKind, 'urinary');
  assert.deepEqual(
    newSignal.written.sessions['session-a'].levels,
    levels({ hunger: 2, urinary: 2 }),
  );
});

test('missing or non-finite urinary urgency falls back to zero', () => {
  const missing = round({
    interoception: { hunger: 65, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(missing.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
  }]);
  assert.deepEqual(missing.written.sessions['session-a'].levels, levels({ hunger: 2 }));
  assertJsonSafe(missing.written);

  const nonFinite = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: Number.NaN },
    actions: [{ sessionId: 'session-b' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(nonFinite.notifications, []);
  assert.deepEqual(nonFinite.written.sessions['session-b'].levels, levels());
  assertJsonSafe(nonFinite.written);

  const infinite = round({
    interoception: { hunger: 65, fullness: 0, urinaryUrgency: Number.POSITIVE_INFINITY },
    actions: [{ sessionId: 'session-c' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(infinite.notifications, [{
    mode: 'context',
    sessionId: 'session-c',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
  }]);
  assert.deepEqual(infinite.written.sessions['session-c'].levels, levels({ hunger: 2 }));
  assertJsonSafe(infinite.written);

  const negativeInfinite = round({
    interoception: { hunger: 65, fullness: 0, urinaryUrgency: Number.NEGATIVE_INFINITY },
    actions: [{ sessionId: 'session-d' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(negativeInfinite.notifications, [{
    mode: 'context',
    sessionId: 'session-d',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
  }]);
  assert.deepEqual(negativeInfinite.written.sessions['session-d'].levels, levels({ hunger: 2 }));
  assertJsonSafe(negativeInfinite.written);
});

test('a submitted void drops the urinary water level and re-arms after it clears', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        lastLevel: 2,
        lastKind: 'urinary',
        hourStartedAt: 60,
        hourCount: 1,
        dayStartedAt: 60,
        dayCount: 1,
        lastSeenAt: 60,
        levels: levels({ urinary: 2 }),
      }),
    },
  };

  const voided = round({
    state: seeded,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 100 },
    bladder: { volumeMl: 1, voidedMl: 409 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(voided.notifications, []);
  assert.equal(voided.written.sessions['session-a'].lastSentAt, 60);
  assert.deepEqual(voided.written.sessions['session-a'].levels, levels());
  assertJsonSafe(voided.written);

  const afterVoid = round({
    state: voided.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    bladder: { volumeMl: 40, voidedMl: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 46 * MINUTE,
  });
  assert.deepEqual(afterVoid.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(afterVoid.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const otherSignal = round({
    state: {
      lastSessionId: 'session-c',
      sessions: {
        'session-c': session({
          lastSentAt: 60,
          lastLevel: 3,
          lastKind: 'hunger',
          hourStartedAt: 60,
          hourCount: 1,
          dayStartedAt: 60,
          dayCount: 1,
          lastSeenAt: 60,
          levels: levels({ hunger: 3, urinary: 2 }),
        }),
      },
    },
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 100 },
    bladder: { volumeMl: 1, voidedMl: 409 },
    actions: [{ sessionId: 'session-c' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(otherSignal.notifications, []);
  assert.deepEqual(otherSignal.written.sessions['session-c'].levels, levels({ hunger: 3 }));
  assert.equal(otherSignal.written.sessions['session-c'].lastSentAt, 60);

  const otherCandidate = round({
    state: {
      lastSessionId: 'session-d',
      sessions: {
        'session-d': session({
          lastSentAt: 60,
          lastLevel: 2,
          lastKind: 'hunger',
          hourStartedAt: 60,
          hourCount: 1,
          dayStartedAt: 60,
          dayCount: 1,
          lastSeenAt: 60,
          levels: levels({ hunger: 2 }),
        }),
      },
    },
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 100 },
    bladder: { volumeMl: 1, voidedMl: 409 },
    actions: [{ sessionId: 'session-d' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(otherCandidate.notifications, [{
    mode: 'wake',
    sessionId: 'session-d',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.deepEqual(otherCandidate.written.sessions['session-d'].levels, levels({ hunger: 3 }));
});

test('a urinate action in the current round suppresses the urinary candidate', () => {
  function armedSession(sessionId, extraLevels = {}) {
    return {
      lastSessionId: sessionId,
      sessions: {
        [sessionId]: session({
          lastSentAt: 60,
          lastLevel: 2,
          lastKind: 'urinary',
          hourStartedAt: 60,
          hourCount: 1,
          dayStartedAt: 60,
          dayCount: 1,
          lastSeenAt: 60,
          levels: levels({ urinary: 2, ...extraLevels }),
        }),
      },
    };
  }

  const urinaryOnly = round({
    state: armedSession('session-a'),
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 100 },
    bladder: { volumeMl: 400, voidedMl: 0 },
    actions: [{ type: 'urinate', sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(urinaryOnly.notifications, []);
  assert.deepEqual(urinaryOnly.written.sessions['session-a'].levels, levels());

  const hungerWins = round({
    state: armedSession('session-b', { fullness: 2 }),
    interoception: { hunger: 85, fullness: 65, urinaryUrgency: 100 },
    bladder: { volumeMl: 400, voidedMl: 0 },
    actions: [{ type: 'urinate', sessionId: 'session-b' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(hungerWins.notifications, [{
    mode: 'wake',
    sessionId: 'session-b',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.equal(hungerWins.written.sessions['session-b'].lastKind, 'hunger');
  assert.deepEqual(
    hungerWins.written.sessions['session-b'].levels,
    levels({ hunger: 3, fullness: 2 }),
  );

  const fullnessWins = round({
    state: armedSession('session-c'),
    interoception: { hunger: 0, fullness: 85, urinaryUrgency: 100 },
    bladder: { volumeMl: 400, voidedMl: 0 },
    actions: [{ type: 'urinate', sessionId: 'session-c' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(fullnessWins.notifications, [{
    mode: 'wake',
    sessionId: 'session-c',
    text: '身体感受：胃里很满，饱足感很明显，可能不太想再吃。',
  }]);
  assert.equal(fullnessWins.written.sessions['session-c'].lastKind, 'fullness');
  assert.deepEqual(fullnessWins.written.sessions['session-c'].levels, levels({ fullness: 3 }));

  const nonUrinating = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 100 },
    bladder: { volumeMl: 400, voidedMl: 0 },
    actions: [{ type: 'eat', sessionId: 'session-d' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(nonUrinating.notifications, [{
    mode: 'wake',
    sessionId: 'session-d',
    text: '身体感受：膀胱很满，尿意很明显。',
  }]);
  assert.deepEqual(nonUrinating.written.sessions['session-d'].levels, levels({ urinary: 3 }));
});

test('urinary water stays latched across 40-64 mm and clears below 40 mm', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.notifications[0].mode, 'context');
  assert.deepEqual(first.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const fellToFifty = round({
    state: first.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 50 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 20 * MINUTE,
  });
  assert.deepEqual(fellToFifty.notifications, []);
  assert.deepEqual(fellToFifty.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const backToMarkedWithoutReset = round({
    state: fellToFifty.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(backToMarkedWithoutReset.notifications, []);
  assert.deepEqual(backToMarkedWithoutReset.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const belowReset = round({
    state: backToMarkedWithoutReset.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 39 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 46 * MINUTE,
  });
  assert.deepEqual(belowReset.notifications, []);
  assert.deepEqual(belowReset.written.sessions['session-a'].levels, levels());

  const repeated = round({
    state: belowReset.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 47 * MINUTE,
  });
  assert.deepEqual(repeated.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(repeated.written.sessions['session-a'].levels, levels({ urinary: 2 }));
});

test('thirst stays quiet at 64 mm and uses context at 65 mm and wake at 85 mm', () => {
  const below = round({
    interoception: { hunger: 0, fullness: 0, thirst: 64 },
    actions: [{ sessionId: 'session-low' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(below.notifications, []);
  assert.deepEqual(below.written.sessions['session-low'].levels, levels());
  assert.equal(below.written.sessions['session-low'].lastLevel, 0);

  const marked = round({
    interoception: { hunger: 0, fullness: 0, thirst: 65 },
    actions: [{ sessionId: 'session-marked' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(marked.notifications, [{
    mode: 'context',
    sessionId: 'session-marked',
    text: '身体感受：有些口渴。',
  }]);
  assert.equal(marked.written.sessions['session-marked'].lastKind, 'thirst');
  assert.equal(marked.written.sessions['session-marked'].lastLevel, 2);
  assert.deepEqual(marked.written.sessions['session-marked'].levels, levels({ thirst: 2 }));
  assert.equal(marked.written.sessions['session-marked'].hourCount, 1);
  assert.equal(marked.written.sessions['session-marked'].dayCount, 1);

  const strong = round({
    interoception: { hunger: 0, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-strong' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(strong.notifications, [{
    mode: 'wake',
    sessionId: 'session-strong',
    text: '身体感受：很口渴。',
  }]);
  assert.equal(strong.written.sessions['session-strong'].lastKind, 'thirst');
  assert.equal(strong.written.sessions['session-strong'].lastLevel, 3);
  assert.deepEqual(strong.written.sessions['session-strong'].levels, levels({ thirst: 3 }));

  const repeatedStrong = round({
    state: strong.written,
    interoception: { hunger: 0, fullness: 0, thirst: 90 },
    actions: [{ sessionId: 'session-strong' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(repeatedStrong.notifications, []);
  assert.equal(repeatedStrong.written.sessions['session-strong'].lastSentAt, 60);
  assert.deepEqual(
    repeatedStrong.written.sessions['session-strong'].levels,
    levels({ thirst: 3 }),
  );
});

test('thirst repeats only after dropping below 40 mm', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);

  const sameLevel = round({
    state: first.written,
    interoception: { hunger: 0, fullness: 0, thirst: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(sameLevel.notifications, []);
  assert.equal(sameLevel.written.sessions['session-a'].lastSentAt, 60);
  assert.deepEqual(sameLevel.written.sessions['session-a'].levels, levels({ thirst: 2 }));

  const dropped = round({
    state: sameLevel.written,
    interoception: { hunger: 0, fullness: 0, thirst: 39 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 46 * MINUTE,
  });
  assert.deepEqual(dropped.notifications, []);
  assert.deepEqual(dropped.written.sessions['session-a'].levels, levels());
  assert.equal(dropped.written.sessions['session-a'].lastLevel, 0);

  const repeated = round({
    state: dropped.written,
    interoception: { hunger: 0, fullness: 0, thirst: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 47 * MINUTE,
  });
  assert.deepEqual(repeated.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：有些口渴。',
  }]);
  assert.equal(repeated.written.sessions['session-a'].lastSentAt, 60 + 47 * MINUTE);
  assert.deepEqual(repeated.written.sessions['session-a'].levels, levels({ thirst: 2 }));
});

test('missing or non-finite thirst stays below the marked tier without notifying', () => {
  function seeded(sessionId) {
    return {
      lastSessionId: sessionId,
      sessions: {
        [sessionId]: session({
          lastSentAt: 60,
          lastLevel: 3,
          lastKind: 'thirst',
          hourStartedAt: 60,
          hourCount: 1,
          dayStartedAt: 60,
          dayCount: 1,
          lastSeenAt: 60,
          levels: levels({ thirst: 3 }),
        }),
      },
    };
  }

  const cases = [
    ['missing', { hunger: 0, fullness: 0 }],
    ['NaN', { hunger: 0, fullness: 0, thirst: Number.NaN }],
    ['Infinity', { hunger: 0, fullness: 0, thirst: Number.POSITIVE_INFINITY }],
    ['-Infinity', { hunger: 0, fullness: 0, thirst: Number.NEGATIVE_INFINITY }],
  ];

  for (const [label, interoception] of cases) {
    const sessionId = `session-${label}`;
    const { written, notifications } = round({
      state: seeded(sessionId),
      interoception,
      actions: [{ sessionId }],
      simulatedSeconds: 60 + 45 * MINUTE,
    });
    assert.deepEqual(notifications, [], `${label}: must not notify`);
    assert.deepEqual(written.sessions[sessionId].levels, levels({ thirst: 3 }), `${label}: thirst water stays latched at fallback 50 mm`);
    assert.equal(written.sessions[sessionId].lastLevel, 1, `${label}: fallback stays below marked`);
    assert.equal(written.sessions[sessionId].lastSentAt, 60, `${label}: must not send`);
    assertJsonSafe(written);
  }
});

test('discomfort alone does not notify or consume any signal water', () => {
  const { written, notifications } = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      discomfort: 100,
    },
    actions: [{ sessionId: 'session-discomfort' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(notifications, []);
  assert.deepEqual(written.sessions['session-discomfort'].levels, levels());
  assert.equal(written.sessions['session-discomfort'].hourCount, 0);
  assert.equal(written.sessions['session-discomfort'].dayCount, 0);
});

test('the highest level wins over signal order', () => {
  const hungerWins = round({
    interoception: { hunger: 85, fullness: 65, urinaryUrgency: 65, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(hungerWins.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.deepEqual(hungerWins.written.sessions['session-a'].levels, levels({ hunger: 3 }));

  const thirstWins = round({
    state: hungerWins.written,
    interoception: { hunger: 85, fullness: 85, urinaryUrgency: 0, thirst: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(thirstWins.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：很口渴。',
  }]);
  assert.equal(thirstWins.written.sessions['session-a'].lastKind, 'thirst');
  assert.equal(thirstWins.written.sessions['session-a'].lastLevel, 3);
  assert.equal(thirstWins.written.sessions['session-a'].hourCount, 2);
  assert.deepEqual(
    thirstWins.written.sessions['session-a'].levels,
    levels({ hunger: 3, thirst: 3 }),
  );
});

test('equal marked thirst outranks fullness and hunger without consuming their water', () => {
  const thirstFirst = round({
    interoception: { hunger: 65, fullness: 65, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(thirstFirst.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：有些口渴。',
  }]);
  assert.deepEqual(thirstFirst.written.sessions['session-a'].levels, levels({ thirst: 2 }));

  const fullnessNext = round({
    state: thirstFirst.written,
    interoception: { hunger: 65, fullness: 65, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(fullnessNext.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些满，饱足感开始明显。',
  }]);
  assert.deepEqual(fullnessNext.written.sessions['session-a'].levels, levels({ fullness: 2 }));

  const hungerNext = round({
    state: fullnessNext.written,
    interoception: { hunger: 70, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 90 * MINUTE,
  });
  assert.deepEqual(hungerNext.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
  }]);
  assert.deepEqual(hungerNext.written.sessions['session-a'].levels, levels({ hunger: 2 }));
});

test('equal marked and strong urinary outrank thirst', () => {
  const urinaryFirst = round({
    interoception: { hunger: 65, fullness: 65, urinaryUrgency: 65, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(urinaryFirst.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(urinaryFirst.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const thirstNext = round({
    state: urinaryFirst.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 0, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(thirstNext.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：有些口渴。',
  }]);
  assert.deepEqual(thirstNext.written.sessions['session-a'].levels, levels({ thirst: 2 }));

  const urinaryStrong = round({
    state: thirstNext.written,
    interoception: { hunger: 85, fullness: 85, urinaryUrgency: 85, thirst: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 90 * MINUTE,
  });
  assert.deepEqual(urinaryStrong.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：膀胱很满，尿意很明显。',
  }]);
  assert.deepEqual(
    urinaryStrong.written.sessions['session-a'].levels,
    levels({ urinary: 3, thirst: 2 }),
  );
});

test('an existing levels object gains thirst=0 without changing other water levels', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        lastLevel: 2,
        lastKind: 'fullness',
        hourStartedAt: 60,
        hourCount: 1,
        dayStartedAt: 60,
        dayCount: 1,
        lastSeenAt: 60,
        levels: { hunger: 0, fullness: 2, urinary: 0 },
      }),
    },
  };

  const blocked = round({
    state: seeded,
    interoception: { hunger: 0, fullness: 65, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 10 * MINUTE,
  });
  assert.deepEqual(blocked.notifications, []);
  assert.deepEqual(blocked.written.sessions['session-a'].levels, levels({ fullness: 2 }));
  assert.equal(blocked.written.sessions['session-a'].lastSentAt, 60);

  const notified = round({
    state: blocked.written,
    interoception: { hunger: 0, fullness: 65, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(notified.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：有些口渴。',
  }]);
  assert.deepEqual(
    notified.written.sessions['session-a'].levels,
    levels({ fullness: 2, thirst: 2 }),
  );
  assert.equal(notified.written.sessions['session-a'].hourCount, 2);
  assert.equal(notified.written.sessions['session-a'].dayCount, 2);
});

test('thirst shares the cooldown and quotas with other signals', () => {
  const thirstFirst = round({
    interoception: { hunger: 0, fullness: 0, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(thirstFirst.notifications.length, 1);

  const blocked = round({
    state: thirstFirst.written,
    interoception: { hunger: 85, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 44 * MINUTE,
  });
  assert.deepEqual(blocked.notifications, []);
  assert.deepEqual(blocked.written.sessions['session-a'].levels, levels());
  assert.equal(blocked.written.sessions['session-a'].lastSentAt, 60);

  const hungerReady = round({
    state: blocked.written,
    interoception: { hunger: 85, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(hungerReady.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.deepEqual(hungerReady.written.sessions['session-a'].levels, levels({ hunger: 3 }));

  const hourBlocked = round({
    state: {
      lastSessionId: 'session-hour',
      sessions: {
        'session-hour': session({
          hourStartedAt: 60,
          hourCount: 2,
          dayStartedAt: 60,
          dayCount: 2,
          lastSeenAt: 60,
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-hour' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(hourBlocked.notifications, []);
  assert.deepEqual(hourBlocked.written.sessions['session-hour'].levels, levels());

  const dayBlocked = round({
    state: {
      lastSessionId: 'session-day',
      sessions: {
        'session-day': session({
          hourStartedAt: 60,
          hourCount: 0,
          dayStartedAt: 60,
          dayCount: 6,
          lastSeenAt: 60,
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-day' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(dayBlocked.notifications, []);
  assert.deepEqual(dayBlocked.written.sessions['session-day'].levels, levels());
});

test('legacy lastKind thirst and lastLevel migrate into the thirst water level', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        lastLevel: 3,
        lastKind: 'thirst',
        hourStartedAt: 60,
        hourCount: 1,
        dayStartedAt: 60,
        dayCount: 1,
        lastSeenAt: 60,
      }),
    },
  };

  const sameLevel = round({
    state: seeded,
    interoception: { hunger: 0, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 45 * MINUTE,
  });
  assert.deepEqual(sameLevel.notifications, []);
  assert.deepEqual(sameLevel.written.sessions['session-a'].levels, levels({ thirst: 3 }));
  assert.equal(sameLevel.written.sessions['session-a'].lastSentAt, 60);

  const dropped = round({
    state: sameLevel.written,
    interoception: { hunger: 0, fullness: 0, thirst: 30 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 46 * MINUTE,
  });
  assert.deepEqual(dropped.notifications, []);
  assert.deepEqual(dropped.written.sessions['session-a'].levels, levels());

  const repeated = round({
    state: dropped.written,
    interoception: { hunger: 0, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 47 * MINUTE,
  });
  assert.deepEqual(repeated.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：很口渴。',
  }]);
  assert.deepEqual(repeated.written.sessions['session-a'].levels, levels({ thirst: 3 }));
  assert.equal(repeated.written.sessions['session-a'].lastSentAt, 60 + 47 * MINUTE);
});

test('thirst notify state stays JSON-safe across rounds', () => {
  let state;
  const rounds = [
    {
      interoception: { hunger: 0, fullness: 0, thirst: 65 },
      actions: [{ sessionId: 'session-a' }],
      simulatedSeconds: 60,
    },
    {
      interoception: { hunger: 0, fullness: 0, thirst: Number.NaN },
      actions: [{ sessionId: 'session-a' }],
      simulatedSeconds: 120,
    },
    {
      interoception: { hunger: 0, fullness: 0, thirst: Number.POSITIVE_INFINITY },
      actions: [{ sessionId: 'session-b' }],
      simulatedSeconds: 180,
    },
    {
      interoception: { hunger: 0, fullness: 0, thirst: Number.NEGATIVE_INFINITY },
      actions: [],
      simulatedSeconds: 240,
    },
    {
      interoception: { hunger: 0, fullness: 0, thirst: 30 },
      actions: [{ sessionId: 'session-a' }],
      simulatedSeconds: 300,
    },
  ];

  for (const input of rounds) {
    const { written } = round({ ...input, state });
    assertJsonSafe(written);
    for (const stored of Object.values(written.sessions)) {
      assert.equal(typeof stored.levels.thirst, 'number', 'thirst water level must be present');
    }
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
    state = written;
  }
});
