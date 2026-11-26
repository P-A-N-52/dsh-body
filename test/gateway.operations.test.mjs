import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpoint, launch } from '../test-support/harness.mjs';

function poolSource() {
  return `
export const id = 'pool';
export const actionTypes = [];
export const initialState = { amount: 0 };
export const fields = { amount: { unit: 'mL', mode: 'additive', contributors: ['source', 'sink'] } };

export function heartbeat(io) {
  const prev = io.read('pool') ?? {};
  io.write({ ...prev });
}
`;
}

function contributorSource({ id, deltas }) {
  const calls = deltas.map((delta) => `io.add('pool', 'amount', ${delta});`).join('\n  ');
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = [];
export const initialState = { ok: true };
export const fields = {};

export function heartbeat(io) {
  ${calls}
}
`;
}

function intruderSource() {
  return `
export const id = 'intruder';
export const actionTypes = [];
export const initialState = { ok: true };
export const fields = {};

export function heartbeat(io) {
  io.add('pool', 'amount', 1);
}
`;
}

function absoluteAddSource() {
  return `
export const id = 'source';
export const actionTypes = [];
export const initialState = { volumeMl: 0 };
export const fields = { volumeMl: { unit: 'mL', mode: 'absolute' } };

export function heartbeat(io) {
  io.add('source', 'volumeMl', 1);
}
`;
}

function transferSource({ initialMl = 300, writeMl = null, amount = 200 } = {}) {
  const write = writeMl === null ? '' : `io.write({ volumeMl: ${writeMl} });\n  `;
  return `
export const id = 'source';
export const actionTypes = [];
export const initialState = { volumeMl: ${initialMl} };
export const fields = { volumeMl: { unit: 'mL', mode: 'absolute', transferOut: ['sink.volumeMl'] } };

export function heartbeat(io) {
  ${write}io.transfer('source', 'volumeMl', 'sink', 'volumeMl', ${amount});
}
`;
}

function transferSink({ unit = 'mL' } = {}) {
  return `
export const id = 'sink';
export const actionTypes = [];
export const initialState = { volumeMl: 0 };
export const fields = { volumeMl: { unit: ${JSON.stringify(unit)}, mode: 'absolute', transferIn: ['source.volumeMl'] } };

export function heartbeat() {}
`;
}

function withoutFieldsSource() {
  return `
export const id = 'nofields';
export const actionTypes = [];
export const initialState = { ok: true };

export function heartbeat(io) {
  io.write({ ok: true });
}
`;
}

async function health(app) {
  return (await app.get('/health')).json();
}

test('add sums every delta per field: 1.0 + 0.5 - 0.3 = 1.2', async (t) => {
  const app = await launch(t, {
    modules: {
      'pool.mjs': poolSource(),
      'source.mjs': contributorSource({ id: 'source', deltas: [1.0] }),
      'sink.mjs': contributorSource({ id: 'sink', deltas: [0.5, -0.3] }),
    },
  });

  await app.tick();

  assert.equal(app.state().snapshot.parts.pool.amount, 1.2);
});

test('transfer moves the requested amount from source to target', async (t) => {
  const app = await launch(t, {
    modules: {
      'source.mjs': transferSource({ initialMl: 300, amount: 200 }),
      'sink.mjs': transferSink(),
    },
  });

  await app.tick();

  const { parts } = app.state().snapshot;
  assert.equal(parts.source.volumeMl, 100);
  assert.equal(parts.sink.volumeMl, 200);
});

test('a transfer larger than the source is fatal and commits nothing', async (t) => {
  const app = await launch(t, {
    modules: {
      'source.mjs': transferSource({ initialMl: 100, amount: 200 }),
      'sink.mjs': transferSink(),
    },
  });

  const outcome = await app.tick();
  assert.equal(outcome.failed, true);

  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 0);
  assert.equal(state.snapshot.parts.source.volumeMl, 100);
  assert.equal(state.snapshot.parts.sink.volumeMl, 0);
  assert.equal(state.activeBatch, null);

  const report = await health(app);
  assert.equal(report.ok, false);
  assert.equal(report.status, 'fatal');
  assert.equal(report.fatal.module, 'source');
  assert.equal(report.fatal.operation, 'transfer');
  assert.equal(report.fatal.partId, 'source');
  assert.equal(report.fatal.field, 'volumeMl');
  assert.equal(report.fatal.target, 'sink.volumeMl');
  assert.match(report.fatal.reason, /100/);
  assert.match(report.fatal.reason, /200/);
  assert.equal(report.batch, null);
  assert.equal(report.heartbeat.inFlight, false);

  const retried = await app.tick();
  assert.equal(retried.ran, false);
  assert.equal(app.state().snapshot.simulatedSeconds, 0);
});

test('transferring mL into kcal is rejected at startup', async (t) => {
  const app = await launch(t, {
    modules: {
      'source.mjs': transferSource(),
      'sink.mjs': transferSink({ unit: 'kcal' }),
    },
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /source/);
  assert.match(app.readyError.message, /volumeMl/);
  assert.match(app.readyError.message, /unit/);
});

test('an add from a module outside contributors is fatal', async (t) => {
  const app = await launch(t, {
    modules: {
      'pool.mjs': poolSource(),
      'intruder.mjs': intruderSource(),
    },
  });

  await app.tick();

  const state = app.state();
  assert.equal(state.snapshot.simulatedSeconds, 0);
  assert.equal(state.snapshot.parts.pool.amount, 0);

  const report = await health(app);
  assert.equal(report.status, 'fatal');
  assert.equal(report.fatal.module, 'intruder');
  assert.equal(report.fatal.operation, 'add');
  assert.equal(report.fatal.partId, 'pool');
  assert.equal(report.fatal.field, 'amount');
  assert.match(report.fatal.reason, /contributor/);
  assert.match(report.fatal.message, /Body module "intruder" add pool\.amount/);
});

test('adding to an absolute field is fatal', async (t) => {
  const app = await launch(t, {
    modules: { 'source.mjs': absoluteAddSource() },
  });

  await app.tick();

  const report = await health(app);
  assert.equal(report.status, 'fatal');
  assert.equal(report.fatal.operation, 'add');
  assert.equal(report.fatal.field, 'volumeMl');
  assert.match(report.fatal.reason, /absolute/);
  assert.equal(app.state().snapshot.simulatedSeconds, 0);
});

test('a module without a fields export is rejected at startup', async (t) => {
  const app = await launch(t, {
    modules: { 'nofields.mjs': withoutFieldsSource() },
    expectReadyReject: true,
  });

  assert.ok(app.readyError);
  assert.match(app.readyError.message, /nofields/);
  assert.match(app.readyError.message, /fields/);
});

test('a write in the same round is the base the transfer subtracts from', async (t) => {
  const app = await launch(t, {
    modules: {
      'source.mjs': transferSource({ initialMl: 100, writeMl: 300, amount: 200 }),
      'sink.mjs': transferSink(),
    },
    seed: checkpoint({ parts: { source: { volumeMl: 100 }, sink: { volumeMl: 0 } } }),
  });

  await app.tick();

  const { parts } = app.state().snapshot;
  assert.equal(parts.source.volumeMl, 100);
  assert.equal(parts.sink.volumeMl, 200);
});

test('two adds give the same total whatever the module order', async (t) => {
  const first = await launch(t, {
    modules: {
      'pool.mjs': poolSource(),
      'source.mjs': contributorSource({ id: 'source', deltas: [1.0] }),
      'sink.mjs': contributorSource({ id: 'sink', deltas: [0.5, -0.3] }),
    },
  });
  const second = await launch(t, {
    modules: {
      'pool.mjs': poolSource(),
      'sink.mjs': contributorSource({ id: 'sink', deltas: [0.5, -0.3] }),
      'source.mjs': contributorSource({ id: 'source', deltas: [1.0] }),
    },
  });

  await first.tick();
  await second.tick();

  assert.equal(first.state().snapshot.parts.pool.amount, 1.2);
  assert.equal(second.state().snapshot.parts.pool.amount, 1.2);
});

test('add and transfer overflow to non-finite numbers fail fatally instead of corrupting state', async (t) => {
  const addSumOverflow = await launch(t, {
    modules: {
      'pool.mjs': poolSource(),
      'source.mjs': contributorSource({ id: 'source', deltas: [Number.MAX_VALUE] }),
      'sink.mjs': contributorSource({ id: 'sink', deltas: [Number.MAX_VALUE] }),
    },
  });
  await addSumOverflow.tick();
  assert.equal((await health(addSumOverflow)).status, 'fatal');
  assert.equal(addSumOverflow.state().snapshot.simulatedSeconds, 0);

  const addBaseOverflow = await launch(t, {
    modules: {
      'pool.mjs': poolSource(),
      'source.mjs': contributorSource({ id: 'source', deltas: [Number.MAX_VALUE] }),
    },
    seed: checkpoint({ parts: { pool: { amount: Number.MAX_VALUE } } }),
  });
  await addBaseOverflow.tick();
  assert.equal((await health(addBaseOverflow)).status, 'fatal');
  assert.equal(addBaseOverflow.state().snapshot.simulatedSeconds, 0);

  const transferOverflow = await launch(t, {
    modules: {
      'source.mjs': transferSource({ initialMl: Number.MAX_VALUE, writeMl: Number.MAX_VALUE, amount: Number.MAX_VALUE }),
      'sink.mjs': transferSink(),
    },
    seed: checkpoint({ parts: { source: { volumeMl: Number.MAX_VALUE }, sink: { volumeMl: Number.MAX_VALUE } } }),
  });
  await transferOverflow.tick();
  assert.equal((await health(transferOverflow)).status, 'fatal');
  assert.equal(transferOverflow.state().snapshot.simulatedSeconds, 0);
});
