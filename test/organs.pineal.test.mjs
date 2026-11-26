import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertJsonValue } from '../json-safe.js';
import { loadParameters, setWorkerParameterConfig } from '../lib/parameters.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-organs/pineal/melatonin.ts';

const parametersUrl = new URL(
  '../organs/human-organs/pineal/melatonin.parameters.json',
  import.meta.url,
);

function round(simulatedSeconds, wallTimeMs) {
  let written;
  heartbeat({
    read: () => undefined,
    actions: [],
    dt: 60,
    simulatedSeconds,
    ...(wallTimeMs !== undefined ? { wallTimeMs } : {}),
    write: (next) => { written = next; },
  });
  return written;
}

function atLocalHour(hour) {
  setWorkerParameterConfig({ profile: { timezoneOffsetMin: 0 } });
  return round(0, hour * 3600 * 1000);
}

function assertClose(actual, expected, label, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
}

test('pineal exports the melatonin contract without actions', () => {
  assert.equal(id, 'pineal');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    melatoninRelative: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(initialState, { melatoninRelative: 1 });
});

test('the pineal parameters are all design values with no source', () => {
  const data = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.owner, 'pineal');

  const byId = Object.fromEntries(
    data.parameters.map((parameter) => [parameter.id, parameter]),
  );
  const expected = {
    'pineal.melatoninBaseRelative': { value: 1, unit: '1' },
    'pineal.melatoninAmplitudeRelative': { value: 0.8, unit: '1' },
    'pineal.melatoninPeakHour': { value: 2, unit: 'h' },
    'pineal.melatoninPeriodHours': { value: 24, unit: 'h' },
    'pineal.phaseShiftHours': { value: 0, unit: 'h' },
    'pineal.photicHalfMaxLux': { value: 100, unit: 'lx', source: 'SRC-ZEITZER-2000' },
    'pineal.awakeNightRoomLux': { value: 120, unit: 'lx' },
    'pineal.daylightPeakLux': { value: 1000, unit: 'lx' },
    'pineal.eyelidTransmittance': { value: 0.05, unit: '1' },
    'pineal.responseHalfTimeMin': { value: 39.4, unit: 'min' },
  };
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(expected).sort());

  for (const [parameterId, { value, unit, source = null }] of Object.entries(expected)) {
    assert.equal(byId[parameterId].value, value, `${parameterId}: value`);
    assert.equal(byId[parameterId].unit, unit, `${parameterId}: unit`);
    assert.equal(byId[parameterId].status, 'design', `${parameterId}: status`);
    assert.equal(byId[parameterId].source, source, `${parameterId}: source`);
    assert.ok(Array.isArray(byId[parameterId].range), `${parameterId}: range`);
  }

  assert.deepEqual(
    loadParameters(parametersUrl),
    Object.fromEntries(
      Object.entries(expected).map(([parameterId, { value }]) => [parameterId, value]),
    ),
  );
});

test('the design curve peaks at local 02:00 and bottoms out at 14:00', (t) => {
  t.after(() => setWorkerParameterConfig({}));
  assertClose(atLocalHour(2).melatoninRelative, 1.8, '02:00 peak');
  assertClose(atLocalHour(14).melatoninRelative, 0.2, '14:00 trough');
  assertClose(atLocalHour(8).melatoninRelative, 1, '08:00 midpoint');
  assertClose(
    atLocalHour(0).melatoninRelative,
    1 + 0.8 * Math.cos((2 * Math.PI * (0 - 2)) / 24),
    'midnight is not a special case',
  );
});

test('the curve follows wallTimeMs and repeats every 24 hours', (t) => {
  t.after(() => setWorkerParameterConfig({}));
  for (const hour of [0, 1.5, 2, 8, 14, 23.75]) {
    const first = atLocalHour(hour);
    assert.deepEqual(atLocalHour(hour + 24), first, `hour ${hour} + 24 h`);
    assert.deepEqual(atLocalHour(hour + 72), first, `hour ${hour} + 72 h`);
  }

  assert.notDeepEqual(round(2 * 3600), round(14 * 3600));
  assert.deepEqual(round(120), round(120));
});

test('the curve stays inside 0-2 and every write is finite and JSON-safe', (t) => {
  t.after(() => setWorkerParameterConfig({}));
  for (let hour = 0; hour < 48; hour += 0.5) {
    const written = atLocalHour(hour);
    assert.ok(
      written.melatoninRelative >= 0 && written.melatoninRelative <= 2,
      `hour ${hour}: range`,
    );
    assert.ok(Number.isFinite(written.melatoninRelative), `hour ${hour}: finite`);
    assertJsonValue(written);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});

test('the circadian target uses the 39.4 minute response even without sleep', (t) => {
  t.after(() => setWorkerParameterConfig({}));
  setWorkerParameterConfig({ profile: { timezoneOffsetMin: 0 } });
  let written;
  heartbeat({
    read: (partId) => (partId === 'pineal' ? { melatoninRelative: 1.8 } : undefined),
    actions: [],
    dt: 60,
    simulatedSeconds: 0,
    wallTimeMs: 14 * 3600 * 1000,
    write: (next) => { written = next; },
  });
  assertClose(
    written.melatoninRelative,
    0.2 + 1.6 * 2 ** (-1 / 39.4),
    'one minute from peak toward the afternoon trough',
  );
});

test('when sleep module is loaded, nocturnal room light suppresses melatonin vs dark sleep', (t) => {
  t.after(() => setWorkerParameterConfig({}));
  setWorkerParameterConfig({ profile: { timezoneOffsetMin: 0 } });
  const runAt = (sleeping, hour = 2) => {
    let written;
    heartbeat({
      read: (partId) => (partId === 'sleep' ? { sleeping } : undefined),
      actions: [],
      dt: 60,
      simulatedSeconds: 0,
      wallTimeMs: hour * 3600 * 1000,
      write: (next) => { written = next; },
    });
    return written;
  };
  const awakeNight = runAt(false, 2);
  const asleepNight = runAt(true, 2);
  assert.ok(asleepNight.melatoninRelative > 1.75, 'darkness sleep allows peak melatonin');
  assert.ok(awakeNight.melatoninRelative < 1.1, 'awake indoor light suppresses nocturnal melatonin');
  assert.ok(awakeNight.melatoninRelative < asleepNight.melatoninRelative);
});
