import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { checkpoint } from '../test-support/harness.mjs';
import { counterSource } from '../test-support/models.mjs';

function makeContext(home, agentsMap) {
  const registeredTools = new Map();
  const disposers = [];
  const ctx = {
    get(service) {
      if (service === 'profileContext') return { home };
      if (service === 'agents') return agentsMap;
      throw new Error(`Unknown service: ${service}`);
    },
    effect(callback) {
      const disposer = callback();
      disposers.push(disposer);
      return disposer;
    },
    tools: {
      register(definition) {
        registeredTools.set(definition.name, definition);
        return () => {
          registeredTools.delete(definition.name);
        };
      },
    },
  };
  return {
    ctx,
    registeredTools,
    async disposeAll() {
      for (const disposer of [...disposers].reverse()) {
        await disposer?.();
      }
    },
  };
}

function setupManifest(dir) {
  const modulesDir = join(dir, 'modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(modulesDir, 'counter.mjs'), counterSource());
  const manifestPath = join(dir, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts: [],
    scripts: ['./modules/counter.mjs'],
    catchUpMinutes: 0,
    scriptTimeoutMs: 2000,
  }));
  return manifestPath;
}

test('apply boots Gateway, registers tools, delivers and acks notifications, and cleans up via ctx.effect', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-'));
  const home = join(dir, 'profile');
  const statePath = join(dir, 'state', 'body-state.json');
  const manifestPath = setupManifest(dir);

  const delivered = [];
  const agents = new Map([
    ['session-a', {
      async inject(message) {
        delivered.push({ method: 'inject', message });
      },
      async followup(message) {
        delivered.push({ method: 'followup', message });
      },
    }],
  ]);

  const notification = {
    id: 'n1',
    mode: 'wake',
    sessionId: 'session-a',
    text: '身体感受：口渴。',
    createdAtSimulatedSeconds: 60,
    createdAtWallTimeMs: Date.now(),
  };
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(statePath, JSON.stringify(checkpoint({
    wallTimeMs: Date.now(),
    notifications: [notification],
  })));

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const clearIntervalMock = t.mock.method(globalThis, 'clearInterval');

  const { ctx, registeredTools, disposeAll } = makeContext(home, agents);
  let disposed = false;
  t.after(async () => {
    if (!disposed) await disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, statePath, port: 0 });

  assert.deepEqual([...registeredTools.keys()].sort(), ['body_act', 'body_state']);

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].method, 'followup');
  assert.equal(delivered[0].message.content[0].text, '身体感受：口渴。');
  assert.equal(delivered[0].message.source.kind, 'body-notify');

  const afterAck = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(afterAck.notifications, []);

  const actResult = await registeredTools.get('body_act').execute(
    { type: 'eat', volumeMl: 200, energyKcal: 100, mealKind: 'liquid' },
    { agent: { session: { id: 'session-a' } }, callId: 'call-1' },
  );
  assert.equal(actResult.ok, true);
  assert.equal(actResult.statusCode, 202);

  const stateResult = await registeredTools.get('body_state').execute({ part: 'counter' });
  assert.equal(stateResult.simulatedSeconds, 0);
  assert.ok(stateResult.parts.counter);

  await disposeAll();
  disposed = true;

  assert.equal(clearIntervalMock.mock.callCount(), 1);
  assert.equal(registeredTools.size, 0);
});

test('apply handles empty string port and defaults statePath under profileContext home', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-index-env-'));
  const home = join(dir, 'profile');
  const manifestPath = setupManifest(dir);
  const previousPort = process.env.DSH_BODY_PORT;
  process.env.DSH_BODY_PORT = '0';

  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const { ctx, registeredTools, disposeAll } = makeContext(home, new Map());
  t.after(async () => {
    await disposeAll();
    if (previousPort === undefined) delete process.env.DSH_BODY_PORT;
    else process.env.DSH_BODY_PORT = previousPort;
    rmSync(dir, { recursive: true, force: true });
  });

  await apply(ctx, { manifestPath, port: '' });

  assert.deepEqual([...registeredTools.keys()].sort(), ['body_act', 'body_state']);
  assert.equal(existsSync(join(home, 'dsh-body', 'body-state.json')), true);
});
