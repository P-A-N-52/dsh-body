import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/brain/notify.ts';
import { setWorkerParameterConfig } from '../lib/parameters.js';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

function levels(overrides = {}) {
  return { hunger: 0, fullness: 0, urinary: 0, thirst: 0, ...overrides };
}

function session(overrides = {}) {
  return {
    lastSentAt: null,
    backoffStep: 0,
    lastUrgentSentAt: null,
    urgentBackoffStep: 0,
    lastInvoluntaryVoidedMl: 0,
    lastLevel: 0,
    lastKind: null,
    lastSeenAt: 0,
    levels: levels(),
    sensations: {},
    ...overrides,
  };
}

function round({
  state,
  interoception = { hunger: 50, fullness: 0 },
  bladder,
  colon,
  sleep,
  blood,
  uterus,
  mammaryGlands,
  sexualResponse,
  actions = [],
  simulatedSeconds = 60,
  suppressNotifications = false,
  boundSessionId = null,
} = {}) {
  const notifications = [];
  let written;
  heartbeat({
    read: (partId) => {
      if (partId === 'brainNotify') return state;
      if (partId === 'interoception') return interoception;
      if (partId === 'bladder') return bladder;
      if (partId === 'colon') return colon;
      if (partId === 'sleep') return sleep;
      if (partId === 'blood') return blood;
      if (partId === 'uterus') return uterus;
      if (partId === 'mammaryGlands') return mammaryGlands;
      if (partId === 'sexualResponse') return sexualResponse;
      return undefined;
    },
    actions,
    dt: 60,
    simulatedSeconds,
    suppressNotifications,
    boundSessionId,
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

function assertNoDigits(notifications) {
  for (const notification of notifications) {
    assert.equal(/\d|\p{Nd}/u.test(notification.text), false, `digit found in: ${notification.text}`);
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

test('io.boundSessionId acts as fallback target and action sessionId overrides it', () => {
  const viaBound = round({
    interoception: { hunger: 70, fullness: 0 },
    actions: [],
    boundSessionId: 'bound-session',
    simulatedSeconds: 60,
  });
  assert.equal(viaBound.notifications.length, 1);
  assert.equal(viaBound.notifications[0].sessionId, 'bound-session');
  assert.equal(viaBound.written.lastSessionId, 'bound-session');

  const overridden = round({
    state: viaBound.written,
    interoception: { hunger: 70, fullness: 0, thirst: 70 },
    actions: [{ sessionId: 'action-session' }],
    boundSessionId: 'bound-session',
    simulatedSeconds: 120,
  });
  assert.equal(overridden.notifications.length, 1);
  assert.equal(overridden.notifications[0].sessionId, 'action-session');
  assert.equal(overridden.written.lastSessionId, 'action-session');
});

test('marked hunger sends one context notification with dual-track backoff schema', () => {
  const { written, notifications } = round({
    interoception: { hunger: 65, fullness: 0 },
    actions: [{ id: 'meal-1', sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });

  assert.deepEqual(notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些空，饥饿感开始明显。',
  }]);
  assertNoDigits(notifications);
  assert.equal(written.lastSessionId, 'session-a');
  assert.deepEqual(written.sessions['session-a'], {
    lastSentAt: 60,
    backoffStep: 1,
    lastUrgentSentAt: null,
    urgentBackoffStep: 0,
    lastInvoluntaryVoidedMl: 0,
    lastLevel: 2,
    lastKind: 'hunger',
    lastSeenAt: 60,
    levels: levels({ hunger: 2 }),
    sensations: {},
  });
});

test('legacy 8 single-signal Core-4 texts are preserved when a single Core-4 signal triggers', () => {
  const cases = [
    ['hunger-2', { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0 }, 'context', '身体感受：胃里有些空，饥饿感开始明显。'],
    ['hunger-3', { hunger: 85, fullness: 0, thirst: 0, urinaryUrgency: 0 }, 'wake', '身体感受：胃里很空，饥饿感很明显。'],
    ['fullness-2', { hunger: 0, fullness: 65, thirst: 0, urinaryUrgency: 0 }, 'context', '身体感受：胃里有些满，饱足感开始明显。'],
    ['fullness-3', { hunger: 0, fullness: 85, thirst: 0, urinaryUrgency: 0 }, 'wake', '身体感受：胃里很满，饱足感很明显，可能不太想再吃。'],
    ['urinary-2', { hunger: 0, fullness: 0, thirst: 0, urinaryUrgency: 65 }, 'context', '身体感受：膀胱有些满，尿意开始明显。'],
    ['urinary-3', { hunger: 0, fullness: 0, thirst: 0, urinaryUrgency: 85 }, 'wake', '身体感受：膀胱很满，尿意很明显。'],
    ['thirst-2', { hunger: 0, fullness: 0, thirst: 65, urinaryUrgency: 0 }, 'context', '身体感受：有些口渴。'],
    ['thirst-3', { hunger: 0, fullness: 0, thirst: 85, urinaryUrgency: 0 }, 'wake', '身体感受：很口渴。'],
  ];
  for (const [label, interoception, mode, text] of cases) {
    const { notifications } = round({
      interoception,
      actions: [{ sessionId: `session-${label}` }],
      simulatedSeconds: 60,
    });
    assert.deepEqual(notifications, [{ mode, sessionId: `session-${label}`, text }], label);
    assertNoDigits(notifications);
  }
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
    simulatedSeconds: 60 + 25 * MINUTE,
  });
  assert.deepEqual(later.notifications, []);
  assert.equal(later.written.sessions['session-a'].lastSentAt, 60);
  assert.equal(later.written.sessions['session-a'].backoffStep, 1);
  assert.equal(later.written.sessions['session-a'].lastLevel, 2);
});

test('a suppressed round spends no level watermark or backoff step', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({ backoffStep: 1 }),
    },
  };
  const catchUp = round({
    state: seeded,
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
    suppressNotifications: true,
  });
  assert.deepEqual(catchUp.notifications, []);
  assert.equal(catchUp.written.sessions['session-a'].lastSentAt, null);
  assert.equal(catchUp.written.sessions['session-a'].backoffStep, 1);
  assert.deepEqual(catchUp.written.sessions['session-a'].levels, levels());

  const online = round({
    state: catchUp.written,
    interoception: { hunger: 70, fullness: 0 },
    actions: [],
    simulatedSeconds: 120,
  });
  assert.equal(online.notifications.length, 1);
  assert.equal(online.notifications[0].sessionId, 'session-a');
  assert.equal(online.written.sessions['session-a'].lastSentAt, 120);
  assert.equal(online.written.sessions['session-a'].backoffStep, 2);
  assert.deepEqual(online.written.sessions['session-a'].levels, levels({ hunger: 2 }));

  const repeated = round({
    state: online.written,
    interoception: { hunger: 70, fullness: 0 },
    actions: [],
    simulatedSeconds: 180,
  });
  assert.deepEqual(repeated.notifications, []);
});

test('a drop below resetBelow resets backoff and allows immediate re-arm', () => {
  const first = round({
    interoception: { hunger: 70, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.written.sessions['session-a'].backoffStep, 1);

  const dropped = round({
    state: first.written,
    interoception: { hunger: 10, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(dropped.notifications, []);
  assert.equal(dropped.written.sessions['session-a'].lastLevel, 0);
  assert.equal(dropped.written.sessions['session-a'].backoffStep, 0);
  assert.equal(dropped.written.sessions['session-a'].lastSentAt, null);

  const reArmed = round({
    state: dropped.written,
    interoception: { hunger: 70, fullness: 0, thirst: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 180,
  });
  assert.equal(reArmed.notifications.length, 1);
  assert.equal(reArmed.notifications[0].mode, 'context');
  assert.equal(reArmed.written.sessions['session-a'].lastSentAt, 180);
  assert.equal(reArmed.written.sessions['session-a'].backoffStep, 1);
});

test('normal lane enforces 20 -> 40 -> 80 -> 160 -> 240 min escalating backoff capped at 240 min', () => {
  const signals = [
    { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0 },
    { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0, dryMouthMm: 65 },
    { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0, dryMouthMm: 65, sweatDampMm: 65 },
    { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0, dryMouthMm: 65, sweatDampMm: 65, muscleFatigueMm: 65 },
    { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0, dryMouthMm: 65, sweatDampMm: 65, muscleFatigueMm: 65, bowelUrgencyMm: 65 },
    { hunger: 65, fullness: 0, thirst: 0, urinaryUrgency: 0, dryMouthMm: 65, sweatDampMm: 65, muscleFatigueMm: 65, bowelUrgencyMm: 65, stressMm: 65 },
  ];
  // Start with lastSentAt=60, backoffStep=0 (e.g. after an urgent wake updated lastSentAt)
  // so every step 0..4 plus the 240-min cap is exercised directly.
  const expectedWaitsMin = [20, 40, 80, 160, 240, 240];

  let now = 60;
  let state = {
    lastSessionId: 'session-backoff',
    sessions: {
      'session-backoff': session({ lastSentAt: 60, backoffStep: 0, lastSeenAt: 60 }),
    },
  };
  for (let i = 0; i < signals.length; i += 1) {
    const waitMin = expectedWaitsMin[i];
    const blocked = round({
      state,
      interoception: signals[i],
      actions: [{ sessionId: 'session-backoff' }],
      simulatedSeconds: now + (waitMin - 1) * MINUTE,
    });
    assert.deepEqual(blocked.notifications, [], `step ${i} blocked before ${waitMin} min`);
    state = blocked.written;

    now += waitMin * MINUTE;
    const sent = round({
      state,
      interoception: signals[i],
      actions: [{ sessionId: 'session-backoff' }],
      simulatedSeconds: now,
    });
    assert.equal(sent.notifications.length, 1, `step ${i} fires at ${waitMin} min`);
    assert.equal(sent.notifications[0].mode, 'context');
    assertNoDigits(sent.notifications);
    assert.equal(sent.written.sessions['session-backoff'].lastSentAt, now);
    assert.equal(sent.written.sessions['session-backoff'].backoffStep, Math.min(4, i + 1));
    state = sent.written;
  }
});

test('urgent lane enforces 5 -> 10 -> 20 -> 40 -> 60 min escalating backoff capped at 60 min', () => {
  const signals = [
    { hunger: 85, fullness: 0, thirst: 0, urinaryUrgency: 0 },
    { hunger: 85, fullness: 0, thirst: 85, urinaryUrgency: 0 },
    { hunger: 85, fullness: 0, thirst: 85, urinaryUrgency: 0, dyspneaMm: 90 },
    { hunger: 85, fullness: 0, thirst: 85, urinaryUrgency: 0, dyspneaMm: 90, heatMm: 85 },
    { hunger: 85, fullness: 0, thirst: 85, urinaryUrgency: 0, dyspneaMm: 90, heatMm: 85, coldMm: 85 },
    { hunger: 85, fullness: 0, thirst: 85, urinaryUrgency: 0, dyspneaMm: 90, heatMm: 85, coldMm: 85, hypoglycemiaMm: 85 },
  ];
  const expectedWaitsMin = [5, 10, 20, 40, 60, 60];

  let now = 60;
  let state = {
    lastSessionId: 'session-urgent',
    sessions: {
      'session-urgent': session({ lastUrgentSentAt: 60, urgentBackoffStep: 0, lastSeenAt: 60 }),
    },
  };
  for (let i = 0; i < signals.length; i += 1) {
    const waitMin = expectedWaitsMin[i];
    const blocked = round({
      state,
      interoception: signals[i],
      actions: [{ sessionId: 'session-urgent' }],
      simulatedSeconds: now + (waitMin - 1) * MINUTE,
    });
    assert.deepEqual(blocked.notifications, [], `urgent step ${i} blocked before ${waitMin} min`);
    state = blocked.written;

    now += waitMin * MINUTE;
    const sent = round({
      state,
      interoception: signals[i],
      actions: [{ sessionId: 'session-urgent' }],
      simulatedSeconds: now,
    });
    assert.equal(sent.notifications.length, 1, `urgent step ${i} fires at ${waitMin} min`);
    assert.equal(sent.notifications[0].mode, 'wake');
    assertNoDigits(sent.notifications);
    assert.equal(sent.written.sessions['session-urgent'].lastUrgentSentAt, now);
    assert.equal(sent.written.sessions['session-urgent'].urgentBackoffStep, Math.min(4, i + 1));
    assert.equal(sent.written.sessions['session-urgent'].lastSentAt, now);
    state = sent.written;
  }
});

test('urgent lane penetrates normal cooldown without incrementing normal backoffStep', () => {
  const first = round({
    interoception: { hunger: 65, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications[0].mode, 'context');
  assert.equal(first.written.sessions['session-a'].backoffStep, 1);
  assert.equal(first.written.sessions['session-a'].urgentBackoffStep, 0);

  // Only 1 minute later (well inside 40-min normal cooldown), strong hunger penetrates as wake
  const urgent = round({
    state: first.written,
    interoception: { hunger: 85, fullness: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(urgent.notifications, [{
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：胃里很空，饥饿感很明显。',
  }]);
  assert.equal(urgent.written.sessions['session-a'].lastSentAt, 120);
  assert.equal(urgent.written.sessions['session-a'].backoffStep, 1);
  assert.equal(urgent.written.sessions['session-a'].lastUrgentSentAt, 120);
  assert.equal(urgent.written.sessions['session-a'].urgentBackoffStep, 1);

  // Next urgent signal at urgentBackoffStep=1 waits 10 min (blocked at 9 min, fires at 10 min)
  const blocked = round({
    state: urgent.written,
    interoception: { hunger: 85, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120 + 9 * MINUTE,
  });
  assert.deepEqual(blocked.notifications, []);

  const ready = round({
    state: blocked.written,
    interoception: { hunger: 85, fullness: 0, thirst: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 120 + 10 * MINUTE,
  });
  assert.equal(ready.notifications.length, 1);
  assert.equal(ready.notifications[0].mode, 'wake');
  assert.equal(ready.written.sessions['session-a'].urgentBackoffStep, 2);
});

test('unlimited daily reminders fire without hour/day quota caps while backoff remains per session', () => {
  const channels = [
    'dyspneaMm',
    'palpitationMm',
    'hypoglycemiaMm',
    'heatMm',
    'coldMm',
    'bowelUrgencyMm',
    'dryMouthMm',
    'uterineCrampMm',
    'muscleFatigueMm',
    'sweatDampMm',
  ];

  let state;
  let now = 60;
  let count = 0;
  let lastInteroception = { hunger: 0, fullness: 0, thirst: 0, urinaryUrgency: 0 };
  for (let i = 0; i < channels.length; i += 1) {
    const interoception = { ...lastInteroception, [channels[i]]: 90 };
    lastInteroception = interoception;
    const res = round({
      state,
      interoception,
      actions: [{ sessionId: 'session-a' }],
      simulatedSeconds: now,
    });
    assert.equal(res.notifications.length, 1, `reminder ${i + 1} within 1 day must not be capped`);
    assert.equal(res.notifications[0].mode, 'wake');
    assertNoDigits(res.notifications);
    count += 1;
    state = res.written;
    now += 60 * MINUTE;
  }
  assert.equal(count, 10);
  assert.ok(now - 60 < DAY);

  // Backoff on session-a (while keeping existing signals >= 40) does not block session-b
  const blockedA = round({
    state,
    interoception: { ...lastInteroception, hunger: 85 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: now - 59 * MINUTE,
  });
  assert.deepEqual(blockedA.notifications, []);

  const freshB = round({
    state: blockedA.written,
    interoception: { hunger: 85, fullness: 0 },
    actions: [{ sessionId: 'session-b' }],
    simulatedSeconds: now - 59 * MINUTE,
  });
  assert.equal(freshB.notifications.length, 1);
  assert.equal(freshB.notifications[0].sessionId, 'session-b');
});

test('all relief actions and physiological clearance reset backoff tracks', () => {
  // 1. eat resets normal & urgent backoff when hunger/hypoglycemia were active
  const afterEat = round({
    state: {
      lastSessionId: 's1',
      sessions: {
        s1: session({
          lastSentAt: 60,
          backoffStep: 3,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 2,
          levels: levels({ hunger: 3 }),
        }),
      },
    },
    interoception: { hunger: 85, fullness: 0 },
    actions: [{ type: 'eat', sessionId: 's1' }],
    simulatedSeconds: 120,
  });
  assert.equal(afterEat.written.sessions.s1.backoffStep, 0);
  assert.equal(afterEat.written.sessions.s1.lastSentAt, null);
  assert.equal(afterEat.written.sessions.s1.urgentBackoffStep, 0);
  assert.equal(afterEat.written.sessions.s1.lastUrgentSentAt, null);

  // 2. drink resets normal & urgent backoff when thirst/dryMouth were active
  const afterDrink = round({
    state: {
      lastSessionId: 's2',
      sessions: {
        s2: session({
          lastSentAt: 60,
          backoffStep: 3,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 2,
          sensations: { dryMouth: 3 },
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, dryMouthMm: 85 },
    actions: [{ type: 'drink', sessionId: 's2' }],
    simulatedSeconds: 120,
  });
  assert.equal(afterDrink.written.sessions.s2.backoffStep, 0);
  assert.equal(afterDrink.written.sessions.s2.urgentBackoffStep, 0);

  // 3. urinate resets urinary watermark + backoff
  const afterUrinate = round({
    state: {
      lastSessionId: 's3',
      sessions: {
        s3: session({
          lastSentAt: 60,
          backoffStep: 2,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 2,
          levels: levels({ urinary: 3 }),
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 90 },
    actions: [{ type: 'urinate', sessionId: 's3' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(afterUrinate.notifications, []);
  assert.equal(afterUrinate.written.sessions.s3.levels.urinary, 0);
  assert.equal(afterUrinate.written.sessions.s3.backoffStep, 0);
  assert.equal(afterUrinate.written.sessions.s3.urgentBackoffStep, 0);

  // 4. defecate resets bowelUrgency watermark + backoff
  const afterDefecate = round({
    state: {
      lastSessionId: 's4',
      sessions: {
        s4: session({
          lastSentAt: 60,
          backoffStep: 2,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 1,
          sensations: { bowelUrgency: 3 },
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, bowelUrgencyMm: 85 },
    actions: [{ type: 'defecate', sessionId: 's4' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(afterDefecate.notifications, []);
  assert.equal(afterDefecate.written.sessions.s4.sensations.bowelUrgency, undefined);
  assert.equal(afterDefecate.written.sessions.s4.backoffStep, 0);
  assert.equal(afterDefecate.written.sessions.s4.urgentBackoffStep, 0);

  // 5. sleep resets sleepiness watermark + backoff
  const afterSleep = round({
    state: {
      lastSessionId: 's5',
      sessions: {
        s5: session({
          lastSentAt: 60,
          backoffStep: 2,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 1,
          sensations: { sleepiness: 3 },
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, sleepinessMm: 85 },
    actions: [{ type: 'sleep', sessionId: 's5' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(afterSleep.notifications, []);
  assert.equal(afterSleep.written.sessions.s5.sensations.sleepiness, undefined);
  assert.equal(afterSleep.written.sessions.s5.backoffStep, 0);
  assert.equal(afterSleep.written.sessions.s5.urgentBackoffStep, 0);

  // 6. wake_up resets sleepiness & normal backoff (and urgent backoff if sleepiness was >= 3)
  const afterWake = round({
    state: {
      lastSessionId: 's6',
      sessions: {
        s6: session({
          lastSentAt: 60,
          backoffStep: 2,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 2,
          sensations: { sleepiness: 3 },
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, sleepinessMm: 50 },
    sleep: { sleeping: true },
    actions: [{ type: 'wake_up', sessionId: 's6' }],
    simulatedSeconds: 120,
  });
  assert.equal(afterWake.written.sessions.s6.sensations.sleepiness, undefined);
  assert.equal(afterWake.written.sessions.s6.backoffStep, 0);
  assert.equal(afterWake.written.sessions.s6.urgentBackoffStep, 0);

  // 7. stop_exercise resets backoff when exercise channels (muscleFatigue/sweatDamp/dyspnea/palpitation) were active
  const afterStopExercise = round({
    state: {
      lastSessionId: 's7',
      sessions: {
        s7: session({
          lastSentAt: 60,
          backoffStep: 3,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 2,
          sensations: { muscleFatigue: 3, sweatDamp: 2 },
        }),
      },
    },
    interoception: { hunger: 0, fullness: 0, muscleFatigueMm: 85, sweatDampMm: 70 },
    actions: [{ type: 'stop_exercise', sessionId: 's7' }],
    simulatedSeconds: 120,
  });
  assert.equal(afterStopExercise.written.sessions.s7.backoffStep, 0);
  assert.equal(afterStopExercise.written.sessions.s7.lastSentAt, null);
  assert.equal(afterStopExercise.written.sessions.s7.urgentBackoffStep, 0);
  assert.equal(afterStopExercise.written.sessions.s7.lastUrgentSentAt, null);
});

test('emergency overrides normal and important candidates so only emergency is shown, while non-emergency multi-sensation still aggregates', () => {
  const emergencyOnly = round({
    interoception: {
      hunger: 85,
      fullness: 65,
      thirst: 65,
      urinaryUrgency: 65,
      hypoglycemiaMm: 85,
    },
    actions: [{ sessionId: 'session-multi' }],
    simulatedSeconds: 60,
  });

  assert.equal(emergencyOnly.notifications.length, 1);
  assert.equal(emergencyOnly.notifications[0].mode, 'wake');
  assertNoDigits(emergencyOnly.notifications);
  assert.equal(
    emergencyOnly.notifications[0].text,
    '身体感受：脑子发昏、手脚发软发慌，整个人很虚脱。',
  );
  // Normal and important levels were NOT marked sent when suppressed by emergency
  assert.deepEqual(emergencyOnly.written.sessions['session-multi'].levels, levels());
  assert.deepEqual(emergencyOnly.written.sessions['session-multi'].sensations, { hypoglycemia: 3 });

  const importantMulti = round({
    interoception: {
      hunger: 85,
      fullness: 65,
      thirst: 65,
      urinaryUrgency: 65,
    },
    actions: [{ sessionId: 'session-multi-important' }],
    simulatedSeconds: 60,
  });
  assert.equal(importantMulti.notifications.length, 1);
  assert.equal(importantMulti.notifications[0].mode, 'wake');
  assertNoDigits(importantMulti.notifications);
  assert.equal(
    importantMulti.notifications[0].text,
    '身体感受：胃里空得难受，饥饿感很强烈；隐约有尿意了；有些口渴了；胃里有些满，饱足感比较明显。',
  );
  assert.deepEqual(
    importantMulti.written.sessions['session-multi-important'].levels,
    levels({ hunger: 3, fullness: 2, thirst: 2, urinary: 2 }),
  );
});

test('missing interoception falls back to baseline without NaN', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        backoffStep: 1,
        lastLevel: 2,
        lastKind: 'hunger',
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

test('bladder involuntaryVoidedMl triggers a rising-edge wake alert and re-arms after clearing', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 10 },
    bladder: { volumeMl: 50, involuntaryVoidedMl: 550 },
    actions: [{ sessionId: 'session-void' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.notifications[0].mode, 'wake');
  assert.equal(first.notifications[0].text, '身体感受：身体一阵失控热流，刚才意外漏尿了。');
  assertNoDigits(first.notifications);
  assert.equal(first.written.sessions['session-void'].lastInvoluntaryVoidedMl, 550);
  assert.equal(first.written.sessions['session-void'].urgentBackoffStep, 1);

  // Sustained non-zero involuntaryVoidedMl on next round does not re-trigger
  const sustained = round({
    state: first.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 10 },
    bladder: { volumeMl: 50, involuntaryVoidedMl: 550 },
    actions: [{ sessionId: 'session-void' }],
    simulatedSeconds: 60 + 10 * MINUTE,
  });
  assert.deepEqual(sustained.notifications, []);

  // Clears when involuntaryVoidedMl drops to 0
  const cleared = round({
    state: sustained.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 10 },
    bladder: { volumeMl: 50, involuntaryVoidedMl: 0 },
    actions: [{ sessionId: 'session-void' }],
    simulatedSeconds: 60 + 11 * MINUTE,
  });
  assert.deepEqual(cleared.notifications, []);
  assert.equal(cleared.written.sessions['session-void'].lastInvoluntaryVoidedMl, 0);

  // New rising edge triggers again after urgent cooldown (5 min)
  const secondEdge = round({
    state: cleared.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 10 },
    bladder: { volumeMl: 50, involuntaryVoidedMl: 420 },
    actions: [{ sessionId: 'session-void' }],
    simulatedSeconds: 60 + 20 * MINUTE,
  });
  assert.equal(secondEdge.notifications.length, 1);
  assert.equal(secondEdge.notifications[0].mode, 'wake');
});

test('a submitted void drops the urinary level watermark and re-arms after it clears', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': session({
        lastSentAt: 60,
        backoffStep: 1,
        lastLevel: 2,
        lastKind: 'urinary',
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
    simulatedSeconds: 60 + 20 * MINUTE,
  });
  assert.deepEqual(voided.notifications, []);
  assert.equal(voided.written.sessions['session-a'].lastSentAt, null);
  assert.equal(voided.written.sessions['session-a'].backoffStep, 0);
  assert.deepEqual(voided.written.sessions['session-a'].levels, levels());
  assertJsonSafe(voided.written);

  const afterVoid = round({
    state: voided.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    bladder: { volumeMl: 40, voidedMl: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 21 * MINUTE,
  });
  assert.deepEqual(afterVoid.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(afterVoid.written.sessions['session-a'].levels, levels({ urinary: 2 }));

  const otherCandidate = round({
    state: {
      lastSessionId: 'session-d',
      sessions: {
        'session-d': session({
          lastSentAt: 60,
          backoffStep: 1,
          lastLevel: 2,
          lastKind: 'hunger',
          lastSeenAt: 60,
          levels: levels({ hunger: 2 }),
        }),
      },
    },
    interoception: { hunger: 85, fullness: 0, urinaryUrgency: 100 },
    bladder: { volumeMl: 1, voidedMl: 409 },
    actions: [{ sessionId: 'session-d' }],
    simulatedSeconds: 60 + 20 * MINUTE,
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
          backoffStep: 1,
          lastLevel: 2,
          lastKind: 'urinary',
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
    simulatedSeconds: 60 + 20 * MINUTE,
  });
  assert.deepEqual(urinaryOnly.notifications, []);
  assert.deepEqual(urinaryOnly.written.sessions['session-a'].levels, levels());

  const hungerWins = round({
    state: armedSession('session-b', { fullness: 2 }),
    interoception: { hunger: 85, fullness: 65, urinaryUrgency: 100 },
    bladder: { volumeMl: 400, voidedMl: 0 },
    actions: [{ type: 'urinate', sessionId: 'session-b' }],
    simulatedSeconds: 60 + 20 * MINUTE,
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
});

test('the urinary level watermark stays latched across 40-64 mm and clears below 40 mm', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);

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
    simulatedSeconds: 60 + 40 * MINUTE,
  });
  assert.deepEqual(backToMarkedWithoutReset.notifications, []);

  const belowReset = round({
    state: backToMarkedWithoutReset.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 39 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 41 * MINUTE,
  });
  assert.deepEqual(belowReset.notifications, []);
  assert.deepEqual(belowReset.written.sessions['session-a'].levels, levels());

  const repeated = round({
    state: belowReset.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 42 * MINUTE,
  });
  assert.deepEqual(repeated.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
});

test('3 -> 2 step-down clears urgent watermark and allows re-triggering on climb back to 3', () => {
  const first = round({
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 85 },
    actions: [{ sessionId: 'session-stepdown' }],
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications[0].mode, 'wake');
  assert.equal(first.written.sessions['session-stepdown'].levels.urinary, 3);
  assert.equal(first.written.sessions['session-stepdown'].urgentBackoffStep, 1);

  const steppedDown = round({
    state: first.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-stepdown' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(steppedDown.notifications, []);
  assert.equal(steppedDown.written.sessions['session-stepdown'].levels.urinary, 2);
  assert.equal(steppedDown.written.sessions['session-stepdown'].urgentBackoffStep, 0);
  assert.equal(steppedDown.written.sessions['session-stepdown'].lastUrgentSentAt, null);

  const climbedBack = round({
    state: steppedDown.written,
    interoception: { hunger: 0, fullness: 0, urinaryUrgency: 86 },
    actions: [{ sessionId: 'session-stepdown' }],
    simulatedSeconds: 180,
  });
  assert.equal(climbedBack.notifications.length, 1);
  assert.equal(climbedBack.notifications[0].mode, 'wake');
  assert.equal(climbedBack.written.sessions['session-stepdown'].levels.urinary, 3);
});

test('thirst shares normal and urgent backoff tracks with other signals', () => {
  const thirstFirst = round({
    interoception: { hunger: 0, fullness: 0, thirst: 65 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60,
  });
  assert.equal(thirstFirst.notifications.length, 1);
  assert.equal(thirstFirst.written.sessions['session-a'].backoffStep, 1);

  // Keep thirst at 50 (in [40, 65) band so it doesn't reset normal backoff) while fullness rises to 65.
  // At backoffStep=1, normal cooldown is 40 min.
  const blockedNormal = round({
    state: thirstFirst.written,
    interoception: { hunger: 0, fullness: 65, thirst: 50 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 39 * MINUTE,
  });
  assert.deepEqual(blockedNormal.notifications, []);
  assert.equal(blockedNormal.written.sessions['session-a'].lastSentAt, 60);

  const readyNormal = round({
    state: blockedNormal.written,
    interoception: { hunger: 0, fullness: 65, thirst: 50 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 40 * MINUTE,
  });
  assert.deepEqual(readyNormal.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：胃里有些满，饱足感开始明显。',
  }]);
  assert.deepEqual(readyNormal.written.sessions['session-a'].levels, levels({ fullness: 2, thirst: 2 }));
  assert.equal(readyNormal.written.sessions['session-a'].backoffStep, 2);
});

test('missing or non-finite thirst stays below the marked tier without notifying', () => {
  function seeded(sessionId) {
    return {
      lastSessionId: sessionId,
      sessions: {
        [sessionId]: session({
          lastSentAt: 60,
          backoffStep: 1,
          lastUrgentSentAt: 60,
          urgentBackoffStep: 1,
          lastLevel: 3,
          lastKind: 'thirst',
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
      simulatedSeconds: 60 + 25 * MINUTE,
    });
    assert.deepEqual(notifications, [], `${label}: must not notify`);
    assert.deepEqual(written.sessions[sessionId].levels, levels({ thirst: 0 }));
    assert.equal(written.sessions[sessionId].lastLevel, 0);
    assertJsonSafe(written);
  }
});

test('esophagus choking and discomfort NEVER trigger notifications', () => {
  const { written, notifications } = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      discomfort: 100,
      chokingMm: 100,
    },
    actions: [{ sessionId: 'session-discomfort' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(notifications, []);
  assert.deepEqual(written.sessions['session-discomfort'].levels, levels());
  assert.equal(written.sessions['session-discomfort'].backoffStep, 0);
  assert.equal(written.sessions['session-discomfort'].urgentBackoffStep, 0);
});

test('legacy lastKind and lastLevel migrate into per-signal levels', () => {
  const seeded = {
    lastSessionId: 'session-a',
    sessions: {
      'session-a': {
        lastSentAt: 60,
        lastLevel: 2,
        lastKind: 'hunger',
        lastSeenAt: 60,
      },
    },
  };

  const sameSignal = round({
    state: seeded,
    interoception: { hunger: 70, fullness: 0, urinaryUrgency: 0 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 20 * MINUTE,
  });
  assert.deepEqual(sameSignal.notifications, []);
  assert.deepEqual(sameSignal.written.sessions['session-a'].levels, levels({ hunger: 2 }));

  const newSignal = round({
    state: sameSignal.written,
    interoception: { hunger: 70, fullness: 0, urinaryUrgency: 70 },
    actions: [{ sessionId: 'session-a' }],
    simulatedSeconds: 60 + 21 * MINUTE,
  });
  assert.deepEqual(newSignal.notifications, [{
    mode: 'context',
    sessionId: 'session-a',
    text: '身体感受：膀胱有些满，尿意开始明显。',
  }]);
  assert.deepEqual(
    newSignal.written.sessions['session-a'].levels,
    levels({ hunger: 2, urinary: 2 }),
  );
});

test('sleep raises important wake threshold, accumulates normal/resolved episodes into sleepBacklog, flushes on wake, and lets emergency startle override', () => {
  // 1. While sleeping (light): 70 mm normal AND 86 mm non-emergency (< 92 mm) stay suppressed and enter sleepBacklog
  const sleepingQuiet = round({
    interoception: { hunger: 70, fullness: 0, thirst: 86, sweatDampMm: 70, sleepinessMm: 95 },
    sleep: { sleeping: true, sleepStage: 'light' },
    actions: [{ sessionId: 'session-sleep' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(sleepingQuiet.notifications, []);
  assert.deepEqual(sleepingQuiet.written.sessions['session-sleep'].levels, levels());
  assert.ok(sleepingQuiet.written.sessions['session-sleep'].sleepBacklog.hunger);
  assert.ok(sleepingQuiet.written.sessions['session-sleep'].sleepBacklog.thirst);
  assert.ok(sleepingQuiet.written.sessions['session-sleep'].sleepBacklog.sweatDamp);

  // 2. While still sleeping, sweatDamp resolves (< 65 mm) -> marked stillActive: false in sleepBacklog
  const sleepingResolved = round({
    state: sleepingQuiet.written,
    interoception: { hunger: 70, fullness: 0, thirst: 86, sweatDampMm: 20, sleepinessMm: 95 },
    sleep: { sleeping: true, sleepStage: 'light' },
    actions: [{ sessionId: 'session-sleep' }],
    simulatedSeconds: 120,
  });
  assert.deepEqual(sleepingResolved.notifications, []);
  assert.equal(sleepingResolved.written.sessions['session-sleep'].sleepBacklog.sweatDamp.stillActive, false);

  // 3. In deep sleep, 93 mm is STILL suppressed (< 95 mm deep sleep threshold)
  const deepBlocked = round({
    state: sleepingResolved.written,
    interoception: { hunger: 70, fullness: 0, thirst: 86, urinaryUrgency: 93 },
    sleep: { sleeping: true, sleepStage: 'deep' },
    actions: [{ sessionId: 'session-sleep' }],
    simulatedSeconds: 180,
  });
  assert.deepEqual(deepBlocked.notifications, []);

  // 4. Crossing raised sleep threshold (96 mm >= 95 mm) triggers important wake + flushes sleepBacklog + resolved episode summary
  const sleepingImportantWake = round({
    state: deepBlocked.written,
    interoception: { hunger: 70, fullness: 0, thirst: 86, urinaryUrgency: 96 },
    sleep: { sleeping: true, sleepStage: 'deep' },
    actions: [{ sessionId: 'session-sleep' }],
    simulatedSeconds: 240,
  });
  assert.equal(sleepingImportantWake.notifications.length, 1);
  assert.equal(sleepingImportantWake.notifications[0].mode, 'wake');
  assertNoDigits(sleepingImportantWake.notifications);
  assert.ok(sleepingImportantWake.notifications[0].text.includes('脱离了睡眠状态'));
  assert.ok(sleepingImportantWake.notifications[0].text.includes('尿意'));
  assert.ok(sleepingImportantWake.notifications[0].text.includes('口渴'));
  assert.ok(sleepingImportantWake.notifications[0].text.includes('出过汗'));
  assert.equal(sleepingImportantWake.written.sessions['session-sleep'].sleepBacklog, undefined);

  // 5. Severe hypotension (< 78 mmHg) triggers emergency startle wake even during deep sleep, overriding normal signals
  const sleepingHypotension = round({
    state: sleepingQuiet.written,
    interoception: { hunger: 70, fullness: 0, palpitationMm: 70 },
    blood: { systolicMmHg: 74 },
    sleep: { sleeping: true, sleepStage: 'deep' },
    actions: [{ sessionId: 'session-sleep' }],
    simulatedSeconds: 300,
  });
  assert.equal(sleepingHypotension.notifications.length, 1);
  assert.equal(sleepingHypotension.notifications[0].mode, 'wake');
  assert.ok(sleepingHypotension.notifications[0].text.includes('惊醒'));
  assert.equal(sleepingHypotension.notifications[0].text.includes('饥饿'), false);

  // 6. Natural wake after sleepingQuiet flushes accumulated sleepBacklog as wake!
  const awakeAfterSleep = round({
    state: sleepingQuiet.written,
    interoception: { hunger: 70, fullness: 0, thirst: 0 },
    sleep: { sleeping: false, wakeEvent: 'natural' },
    actions: [{ sessionId: 'session-sleep' }],
    simulatedSeconds: 360,
  });
  assert.equal(awakeAfterSleep.notifications.length, 1);
  assert.equal(awakeAfterSleep.notifications[0].mode, 'wake');
  assert.ok(awakeAfterSleep.notifications[0].text.includes('自然睡醒'));
  assert.ok(awakeAfterSleep.notifications[0].text.includes('饿'));
});

test('nsfw setting gates sexualArousal, libido, mammaryFullness, orgasm text, and nsfw extensible sensations', (t) => {
  t.after(() => setWorkerParameterConfig());

  setWorkerParameterConfig({ nsfw: false });
  const hidden = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      sexualArousalMm: 90,
      libidoMm: 90,
      mammaryFullnessMm: 90,
      sensations: {
        'custom.arousal': {
          intensityMm: 90,
          nsfw: true,
          wakeText: '敏感的潮热涌动起来。',
        },
      },
    },
    mammaryGlands: { fullnessMm: 90 },
    sexualResponse: { phase: 'orgasm' },
    actions: [{ sessionId: 'session-nsfw' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(hidden.notifications, []);

  setWorkerParameterConfig({ nsfw: true });
  const shown = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      sexualArousalMm: 90,
      libidoMm: 70,
      sensations: {
        'custom.arousal': {
          intensityMm: 70,
          nsfw: true,
          contextText: '特殊部位传来一阵细微酥麻。',
        },
      },
    },
    mammaryGlands: { fullnessMm: 85 },
    sexualResponse: { phase: 'orgasm' },
    actions: [{ sessionId: 'session-nsfw' }],
    simulatedSeconds: 60,
  });
  assert.equal(shown.notifications.length, 1);
  assert.equal(shown.notifications[0].mode, 'wake');
  assert.match(shown.notifications[0].text, /刚经历过一阵释放余韵/);
  assert.match(shown.notifications[0].text, /胸部胀痛沉重得十分明显/);
  assertNoDigits(shown.notifications);
});

test('extensible sensations support 3 -> 2 step-down, urgent flag, nsfw gating, and zero digits', (t) => {
  t.after(() => setWorkerParameterConfig());
  setWorkerParameterConfig({ nsfw: true });

  const r1 = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      sensations: {
        'wings.wingStrain': {
          intensityMm: 70,
          contextText: '翅膀有些发酸沉重。',
          wakeText: '翅膀传来强烈的牵拉不适。',
        },
      },
    },
    actions: [{ sessionId: 'session-ext' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(r1.notifications, [{
    mode: 'context',
    sessionId: 'session-ext',
    text: '翅膀有些发酸沉重。',
  }]);
  assert.deepEqual(r1.written.sessions['session-ext'].sensationLevels, {
    'wings.wingStrain': 2,
  });

  // Escalate to level 3
  const r2 = round({
    state: r1.written,
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      sensations: {
        'wings.wingStrain': {
          intensityMm: 90,
          contextText: '翅膀有些发酸沉重。',
          wakeText: '翅膀传来强烈的牵拉不适。',
        },
      },
    },
    actions: [{ sessionId: 'session-ext' }],
    simulatedSeconds: 60 + 10 * MINUTE,
  });
  assert.deepEqual(r2.notifications, [{
    mode: 'wake',
    sessionId: 'session-ext',
    text: '翅膀传来强烈的牵拉不适。',
  }]);
  assert.deepEqual(r2.written.sessions['session-ext'].sensationLevels, {
    'wings.wingStrain': 3,
  });

  // 3 -> 2 step-down resets urgent backoff and lowers watermark to 2
  const steppedDown = round({
    state: r2.written,
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      sensations: {
        'wings.wingStrain': {
          intensityMm: 70,
          contextText: '翅膀有些发酸沉重。',
          wakeText: '翅膀传来强烈的牵拉不适。',
        },
      },
    },
    actions: [{ sessionId: 'session-ext' }],
    simulatedSeconds: 60 + 11 * MINUTE,
  });
  assert.deepEqual(steppedDown.notifications, []);
  assert.deepEqual(steppedDown.written.sessions['session-ext'].sensationLevels, {
    'wings.wingStrain': 2,
  });
  assert.equal(steppedDown.written.sessions['session-ext'].urgentBackoffStep, 0);

  // Climbing back to 3 re-triggers wake immediately
  const reClimbed = round({
    state: steppedDown.written,
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      sensations: {
        'wings.wingStrain': {
          intensityMm: 90,
          contextText: '翅膀有些发酸沉重。',
          wakeText: '翅膀传来强烈的牵拉不适。',
        },
      },
    },
    actions: [{ sessionId: 'session-ext' }],
    simulatedSeconds: 60 + 12 * MINUTE,
  });
  assert.deepEqual(reClimbed.notifications, [{
    mode: 'wake',
    sessionId: 'session-ext',
    text: '翅膀传来强烈的牵拉不适。',
  }]);

  // urgent: true at level 2 triggers wake using wakeText
  const urgentExt = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      sensations: {
        'gills.dryness': {
          intensityMm: 70,
          urgent: true,
          contextText: '鳃丝略微发干。',
          wakeText: '鳃丝干涩发紧，急需湿润。',
        },
      },
    },
    actions: [{ sessionId: 'session-ext-urgent' }],
    simulatedSeconds: 60,
  });
  assert.deepEqual(urgentExt.notifications, [{
    mode: 'wake',
    sessionId: 'session-ext-urgent',
    text: '鳃丝干涩发紧，急需湿润。',
  }]);

  // Numeric extensible text is sanitized to qualitative fallback
  const numericSanitized = round({
    interoception: {
      hunger: 0,
      fullness: 0,
      thirst: 0,
      urinaryUrgency: 0,
      sensations: {
        'wings.wingStrain': {
          intensityMm: 90,
          contextText: '70mm',
          wakeText: '疼痛达到90分！',
        },
      },
    },
    actions: [{ sessionId: 'session-other' }],
    simulatedSeconds: 120,
  });
  assert.equal(numericSanitized.notifications[0].mode, 'wake');
  assertNoDigits(numericSanitized.notifications);
});


test('orgasm timestamps notify once per release without repeating a stored edge', () => {
  const first = round({
    sexualResponse: { phase: 'orgasm', lastOrgasmAtSimMin: 1 },
    boundSessionId: 'orgasm-session',
    simulatedSeconds: 60,
  });
  assert.equal(first.notifications.length, 1);
  assert.match(first.notifications[0].text, /释放|高潮/);
  assertNoDigits(first.notifications);
  assert.equal(first.written.sessions['orgasm-session'].lastOrgasmAtSimMin, 1);

  const repeated = round({
    state: first.written,
    sexualResponse: { phase: 'orgasm', lastOrgasmAtSimMin: 1 },
    boundSessionId: 'orgasm-session',
    simulatedSeconds: 120,
  });
  assert.deepEqual(repeated.notifications, []);

  const nextRelease = round({
    state: repeated.written,
    sexualResponse: { phase: 'orgasm', lastOrgasmAtSimMin: 61 },
    boundSessionId: 'orgasm-session',
    simulatedSeconds: 61 * 60,
  });
  assert.equal(nextRelease.notifications.length, 1);
  assertNoDigits(nextRelease.notifications);
  assert.equal(nextRelease.written.sessions['orgasm-session'].lastOrgasmAtSimMin, 61);
});

test('hypocalcemia and hypercalcemia emit zero-digit context/wake alerts and wake from sleep above sleep threshold', () => {
  const hypoMarked = round({
    interoception: { hunger: 0, fullness: 0, thirst: 0, hypocalcemiaMm: 65 },
    boundSessionId: 'session-ca',
    simulatedSeconds: 60,
  });
  assert.equal(hypoMarked.notifications.length, 1);
  assert.equal(hypoMarked.notifications[0].mode, 'context');
  assert.match(hypoMarked.notifications[0].text, /发麻|抽紧/);
  assertNoDigits(hypoMarked.notifications);
  assert.equal(hypoMarked.written.sessions['session-ca'].sensations.hypocalcemia, 2);

  const hypoStrong = round({
    state: hypoMarked.written,
    interoception: { hunger: 0, fullness: 0, thirst: 0, hypocalcemiaMm: 85 },
    boundSessionId: 'session-ca',
    simulatedSeconds: 120,
  });
  assert.equal(hypoStrong.notifications.length, 1);
  assert.equal(hypoStrong.notifications[0].mode, 'wake');
  assert.match(hypoStrong.notifications[0].text, /麻木|抽搐/);
  assertNoDigits(hypoStrong.notifications);
  assert.equal(hypoStrong.written.sessions['session-ca'].sensations.hypocalcemia, 3);

  const resetLow = round({
    state: hypoStrong.written,
    interoception: { hunger: 0, fullness: 0, thirst: 0, hypocalcemiaMm: 35 },
    boundSessionId: 'session-ca',
    simulatedSeconds: 180,
  });
  assert.deepEqual(resetLow.notifications, []);
  assert.equal(resetLow.written.sessions['session-ca'].sensations.hypocalcemia, undefined);

  const hyperMarked = round({
    interoception: { hunger: 0, fullness: 0, thirst: 0, hypercalcemiaMm: 70 },
    boundSessionId: 'session-hyper',
    simulatedSeconds: 60,
  });
  assert.equal(hyperMarked.notifications.length, 1);
  assert.equal(hyperMarked.notifications[0].mode, 'context');
  assert.match(hyperMarked.notifications[0].text, /倦怠|发沉/);
  assertNoDigits(hyperMarked.notifications);

  const hyperSleepWake = round({
    interoception: { hunger: 0, fullness: 0, thirst: 0, hypercalcemiaMm: 95 },
    sleep: { sleeping: true, sleepStage: 'deep', sleepPressureMm: 40, sleepDurationMin: 30 },
    boundSessionId: 'session-hyper-sleep',
    simulatedSeconds: 60,
  });
  assert.equal(hyperSleepWake.notifications.length, 1);
  assert.equal(hyperSleepWake.notifications[0].mode, 'wake');
  assertNoDigits(hyperSleepWake.notifications);
});
