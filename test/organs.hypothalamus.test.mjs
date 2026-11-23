import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters } from '../lib/parameters.js';
import {
  actionTypes as adhActionTypes,
  fields as adhFields,
  heartbeat as adhHeartbeat,
  id as adhId,
  initialState as adhInitialState,
} from '../organs/human-organs/brain/hypothalamus-adh.ts';
import {
  actionTypes as thirstActionTypes,
  fields as thirstFields,
  heartbeat as thirstHeartbeat,
  id as thirstId,
  initialState as thirstInitialState,
} from '../organs/human-organs/brain/hypothalamus-thirst.ts';
import {
  actionTypes as centralActionTypes,
  fields as centralFields,
  heartbeat as centralHeartbeat,
  id as centralId,
  initialState as centralInitialState,
} from '../organs/human-organs/brain/hypothalamus-adh-di-central.ts';

const APPROACH = 1 - Math.exp(-0.1);

function adhRound(previous, deficit, blood) {
  let written;
  adhHeartbeat({
    read: (partId) => {
      if (partId === 'hypothalamusAdh') return previous;
      if (partId === 'blood') return blood;
      if (partId === 'bodyFluid') return deficit === undefined ? undefined : { waterDeficit: deficit };
      throw new Error(`unexpected read: ${partId}`);
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    notify: () => { throw new Error('ADH must not notify'); },
  });
  return written;
}

function thirstRound(deficit) {
  let written;
  thirstHeartbeat({
    read: (partId) => {
      if (partId !== 'bodyFluid') throw new Error(`unexpected read: ${partId}`);
      return deficit === undefined ? undefined : { waterDeficit: deficit };
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    notify: () => { throw new Error('thirst must not notify'); },
  });
  return written;
}

test('hypothalamus ADH exports the organ module contract', () => {
  assert.equal(adhId, 'hypothalamusAdh');
  assert.deepEqual(adhActionTypes, []);
  assert.deepEqual(adhFields, {
    relativeConcentration: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(adhInitialState, { relativeConcentration: 1 });
});

test('hypothalamus thirst exports the organ module contract', () => {
  assert.equal(thirstId, 'hypothalamusThirst');
  assert.deepEqual(thirstActionTypes, []);
  assert.deepEqual(thirstFields, {
    thirst: { unit: 'mm', mode: 'absolute' },
  });
  assert.deepEqual(thirstInitialState, { thirst: 50 });
});

test('deficit -0.6 moves ADH toward 0.4 and thirst to 20 mm', () => {
  const next = adhRound(adhInitialState, -0.6);
  assert.ok(Math.abs(next.relativeConcentration - (1 + APPROACH * (0.4 - 1))) < 1e-12);
  assert.deepEqual(thirstRound(-0.6), { thirst: 20 });
});

test('deficit 1 moves ADH toward 2 and thirst to 100 mm', () => {
  const next = adhRound(adhInitialState, 1);
  assert.ok(Math.abs(next.relativeConcentration - (1 + APPROACH * (2 - 1))) < 1e-12);
  assert.deepEqual(thirstRound(1), { thirst: 100 });
});

test('ADH eases from its previous value instead of jumping to the target', () => {
  const next = adhRound({ relativeConcentration: 2.5 }, 0);
  assert.ok(Math.abs(next.relativeConcentration - (2.5 + APPROACH * (1 - 2.5))) < 1e-12);
});

test('ADH converges to the target after many rounds', () => {
  let high = adhInitialState;
  let low = adhInitialState;
  for (let i = 0; i < 200; i++) {
    high = adhRound(high, 1);
    low = adhRound(low, -0.6);
  }
  assert.ok(Math.abs(high.relativeConcentration - 2) < 1e-6);
  assert.ok(Math.abs(low.relativeConcentration - 0.4) < 1e-6);
});

test('missing or non-finite water deficit defaults to 0', () => {
  for (const reading of [undefined, {}, { waterDeficit: Number.NaN }]) {
    let adhWritten;
    adhHeartbeat({
      read: (partId) => {
        if (partId === 'hypothalamusAdh') return adhInitialState;
        if (partId === 'blood') return undefined;
        return reading;
      },
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { adhWritten = next; },
      notify: () => { throw new Error('ADH must not notify'); },
    });
    assert.deepEqual(adhWritten, { relativeConcentration: 1 });

    let thirstWritten;
    thirstHeartbeat({
      read: () => reading,
      actions: [],
      dt: 60,
      simulatedSeconds: 60,
      write: (next) => { thirstWritten = next; },
      notify: () => { throw new Error('thirst must not notify'); },
    });
    assert.deepEqual(thirstWritten, { thirst: 50 });
  }
});

test('more body water lowers ADH and thirst monotonically', () => {
  const deficits = [1, 0.5, 0, -0.5, -1];
  assert.deepEqual(deficits.map((deficit) => thirstRound(deficit).thirst), [100, 75, 50, 25, 0]);
  const adh = deficits.map((deficit) => adhRound(adhInitialState, deficit).relativeConcentration);
  for (let index = 1; index < adh.length; index++) {
    assert.ok(adh[index] < adh[index - 1], `ADH should fall as water deficit falls: ${adh}`);
  }
});

test('ADH target and thirst respect their declared bounds', () => {
  const high = adhRound(adhInitialState, 5);
  assert.ok(Math.abs(high.relativeConcentration - (1 + APPROACH * (3 - 1))) < 1e-12);
  const low = adhRound(adhInitialState, -5);
  assert.ok(Math.abs(low.relativeConcentration - (1 + APPROACH * (0 - 1))) < 1e-12);
  assert.deepEqual(thirstRound(-5), { thirst: 0 });
  assert.deepEqual(thirstRound(5), { thirst: 100 });
});

test('the volume gain parameter is a design default with no source', () => {
  const url = new URL(
    '../organs/human-organs/brain/hypothalamus-adh.parameters.json',
    import.meta.url,
  );
  const data = JSON.parse(readFileSync(url, 'utf8'));
  const gain = data.parameters.find((parameter) => parameter.id === 'hypothalamusAdh.volumeGain');
  assert.ok(gain, 'hypothalamusAdh.volumeGain must be declared');
  assert.equal(gain.value, 0.5);
  assert.equal(gain.status, 'design');
  assert.equal(gain.source, null);
  assert.equal(loadParameters(url)['hypothalamusAdh.volumeGain'], 0.5);
});

test('a low blood volume raises the ADH target by volumeGain × (1 − volume / 5000)', () => {
  const atReference = adhRound(adhInitialState, 0, { bloodVolumeMl: 5000 });
  assert.deepEqual(atReference, { relativeConcentration: 1 });

  const cases = [
    [4000, 0.5 * 0.2],
    [2500, 0.5 * 0.5],
    [1000, 0.5 * 0.8],
    [6000, 0.5 * -0.2],
  ];
  for (const [bloodVolumeMl, term] of cases) {
    const next = adhRound(adhInitialState, 0, { bloodVolumeMl });
    assert.ok(
      Math.abs(next.relativeConcentration - (1 + APPROACH * term)) < 1e-12,
      `${bloodVolumeMl} mL: ${next.relativeConcentration} != ${1 + APPROACH * term}`,
    );
  }
});

test('a missing blood part leaves the water-deficit target unchanged', () => {
  assert.deepEqual(adhRound(adhInitialState, 0), { relativeConcentration: 1 });
  assert.deepEqual(
    adhRound(adhInitialState, 1),
    adhRound(adhInitialState, 1, { bloodVolumeMl: 5000 }),
  );
});

test('the volume term adds to the water-deficit target before the bounds clamp', () => {
  const combined = adhRound(adhInitialState, 1, { bloodVolumeMl: 4000 });
  assert.ok(Math.abs(combined.relativeConcentration - (1 + APPROACH * 1.1)) < 1e-12);

  const clampedHigh = adhRound(adhInitialState, 5, { bloodVolumeMl: 1000 });
  assert.ok(Math.abs(clampedHigh.relativeConcentration - (1 + APPROACH * (3 - 1))) < 1e-12);

  const clampedLow = adhRound(adhInitialState, -5, { bloodVolumeMl: 20000 });
  assert.ok(Math.abs(clampedLow.relativeConcentration - (1 + APPROACH * (0 - 1))) < 1e-12);
});

test('an invalid loaded blood reading fails the ADH round without writing', () => {
  const invalid = [
    ['empty blood', {}],
    ['missing volume', { cardiacOutputMlMin: 4900 }],
    ['NaN volume', { bloodVolumeMl: Number.NaN }],
    ['infinite volume', { bloodVolumeMl: Number.POSITIVE_INFINITY }],
    ['negative volume', { bloodVolumeMl: -1 }],
    ['non-numeric volume', { bloodVolumeMl: '5000' }],
    ['null volume', { bloodVolumeMl: null }],
    ['null blood', null],
    ['non-object blood', 42],
  ];
  for (const [label, blood] of invalid) {
    const writes = [];
    assert.throws(
      () => adhHeartbeat({
        read: (partId) => {
          if (partId === 'hypothalamusAdh') return adhInitialState;
          if (partId === 'blood') return blood;
          return { waterDeficit: 0 };
        },
        actions: [],
        dt: 60,
        simulatedSeconds: 60,
        write: (next) => { writes.push(next); },
        notify: () => { throw new Error('ADH must not notify'); },
      }),
      Error,
      label,
    );
    assert.equal(writes.length, 0, `${label}: the round must not write`);
  }
});

test('the two scripts only write their own part and never act or notify', () => {
  const actions = [{ type: 'drink', volumeMl: 240, energyKcal: 0, sessionId: 'session-a' }];
  const notifications = [];

  let adhWritten;
  adhHeartbeat({
    read: (partId) => {
      assert.ok(
        partId === 'hypothalamusAdh' || partId === 'bodyFluid' || partId === 'blood',
        `unexpected read: ${partId}`,
      );
      if (partId === 'blood') return { bloodVolumeMl: 5000 };
      return partId === 'bodyFluid' ? { waterDeficit: -0.5 } : adhInitialState;
    },
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { adhWritten = next; },
    notify: (notification) => notifications.push(notification),
  });
  assert.deepEqual(Object.keys(adhWritten), ['relativeConcentration']);

  let thirstWritten;
  thirstHeartbeat({
    read: (partId) => {
      assert.equal(partId, 'bodyFluid');
      return { waterDeficit: -0.5 };
    },
    actions,
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { thirstWritten = next; },
    notify: (notification) => notifications.push(notification),
  });
  assert.deepEqual(Object.keys(thirstWritten), ['thirst']);
  assert.deepEqual(notifications, []);
});

function centralRound(previous, reading) {
  let written;
  centralHeartbeat({
    read: (partId) => {
      throw new Error(`central DI ADH must not read ${partId}`);
    },
    actions: [],
    dt: 60,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    notify: () => { throw new Error('central DI ADH must not notify'); },
  });
  return written;
}

test('central DI ADH keeps the same part contract and fixes the relative level at zero', () => {
  assert.equal(centralId, 'hypothalamusAdh');
  assert.deepEqual(centralActionTypes, []);
  assert.deepEqual(centralFields, {
    relativeConcentration: { unit: '1', mode: 'absolute' },
  });
  assert.deepEqual(centralInitialState, { relativeConcentration: 0 });
});

test('central DI ADH writes zero for any water deficit and any previous value', () => {
  for (const reading of [undefined, {}, { waterDeficit: -1 }, { waterDeficit: 0 }, { waterDeficit: 1 }, { waterDeficit: Number.NaN }]) {
    for (const previous of [centralInitialState, { relativeConcentration: 2.5 }]) {
      assert.deepEqual(centralRound(previous, reading), { relativeConcentration: 0 });
    }
  }
});
