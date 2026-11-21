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

function round({
  state,
  interoception = { hunger: 50, fullness: 0 },
  actions = [],
  simulatedSeconds = 60,
} = {}) {
  const notifications = [];
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'brainNotify') return state;
      if (partId === 'interoception') return interoception;
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
    interoception: { hunger: 10, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(dropped.notifications, []);
  assert.equal(dropped.written.sessions['session-a'].lastLevel, 0);

  const blocked = round({
    state: dropped.written,
    interoception: { hunger: 70, fullness: 0 },
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
