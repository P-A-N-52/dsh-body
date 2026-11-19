import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../test-support/harness.mjs';
import { badJsonSource } from '../test-support/models.mjs';

for (const kind of ['bigint', 'nan', 'undefined', 'map']) {
  test(`a module writing ${kind} output fails the round without committing`, async (t) => {
    const app = await launch(t, {
      modules: { 'bad.mjs': badJsonSource({ kind }) },
      scriptTimeoutMs: 1000,
    });

    await app.tick();

    const state = app.state();
    assert.equal(state.snapshot.simulatedSeconds, 0);
    assert.equal(state.activeBatch.attempts, 1);
    assert.match(state.activeBatch.lastError, /JSON-safe|finite number|undefined|plain object or array/);
  });
}
