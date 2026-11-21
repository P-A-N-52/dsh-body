import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../gateway.js';
import { checkpoint } from '../test-support/harness.mjs';
import { buildActionPayload, createBodyTools, registerBodyTools } from '../tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fakeExec({ sessionId = 'session-a', callId = 'call-1' } = {}) {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
}

async function startBody(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tools-'));
  const statePath = join(dir, 'body-state.json');
  writeFileSync(statePath, JSON.stringify(checkpoint({ wallTimeMs: 0, simulatedSeconds: 0, parts: {} })));
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const gateway = startGateway({
    manifestPath: join(root, 'body-modules.json'),
    statePath,
    port: 0,
    autoTick: false,
    now: () => 0,
  });
  t.after(async () => {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await gateway.ready;
  return { gateway, statePath, tools: createBodyTools(gateway) };
}

function actionId(sessionId, callId) {
  return `body-${createHash('sha256').update(`${sessionId}\0${callId}`).digest('hex').slice(0, 32)}`;
}

test('body_act enqueues a valid drink and returns a receipt', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const exec = fakeExec();

  const result = await tools.body_act.execute({ type: 'drink', volumeMl: 330, energyKcal: 140 }, exec);
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(result.receipt.id, actionId('session-a', 'call-1'));
  assert.equal(result.receipt.type, 'drink');
  assert.equal(result.receipt.status, 'queued');

  const queued = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(queued.pendingActionIds, [result.receipt.id]);
  assert.equal(queued.actions[result.receipt.id].action.sessionId, 'session-a');

  assert.equal(gateway.getState().parts.stomach.volumeMl, 0);
  await gateway.tick();

  const state = gateway.getState();
  assert.equal(state.simulatedSeconds, 60);
  assert.ok(state.parts.stomach.volumeMl > 0);
  assert.ok(state.parts.stomach.energyKcal > 0);
  assert.equal(gateway.getReceipt(result.receipt.id).status, 'applied');
});

test('body_act rejects invalid fields and missing sessions before enqueue', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const invalid = [
    [{ type: 'sniff', volumeMl: 100 }, /type/],
    [{ type: 'drink' }, /volumeMl/],
    [{ type: 'drink', volumeMl: 0 }, /volumeMl/],
    [{ type: 'drink', volumeMl: Number.NaN }, /volumeMl/],
    [{ type: 'drink', volumeMl: 100, energyKcal: -1 }, /energyKcal/],
    [{ type: 'drink', volumeMl: 100, energyKcal: '140' }, /energyKcal/],
    [{ type: 'eat', volumeMl: 100, mealKind: 'solid' }, /energyKcal/],
    [{ type: 'eat', volumeMl: 100, energyKcal: 300 }, /mealKind/],
    [{ type: 'eat', volumeMl: 100, energyKcal: 300, mealKind: 'liquidy' }, /mealKind/],
    [{ type: 'drink', volumeMl: 100, durationMin: -1 }, /durationMin/],
  ];

  for (const [args, pattern] of invalid) {
    const result = await tools.body_act.execute(args, fakeExec());
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.receipt.error, pattern);
  }

  const withoutSession = await tools.body_act.execute(
    { type: 'drink', volumeMl: 100 },
    { callId: 'call-x', signal: new AbortController().signal },
  );
  assert.equal(withoutSession.ok, false);
  assert.equal(withoutSession.statusCode, 400);
  assert.match(withoutSession.receipt.error, /session/);

  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, []);
  assert.equal(gateway.getState().parts.stomach.volumeMl, 0);
});

test('body_act is idempotent for the same session and callId', async (t) => {
  const { gateway, statePath, tools } = await startBody(t);
  const exec = fakeExec();
  const args = { type: 'drink', volumeMl: 200, energyKcal: 80 };

  const first = await tools.body_act.execute(args, exec);
  const second = await tools.body_act.execute(args, exec);
  assert.equal(first.statusCode, 202);
  assert.equal(second.statusCode, 200);
  assert.equal(second.receipt.id, first.receipt.id);
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).pendingActionIds, [first.receipt.id]);

  const conflict = await tools.body_act.execute({ type: 'drink', volumeMl: 250 }, exec);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.statusCode, 409);
  assert.equal(gateway.getReceipt(first.receipt.id).type, 'drink');
});

test('body_state returns all parts or one part', async (t) => {
  const { gateway, tools } = await startBody(t);
  await tools.body_act.execute({ type: 'drink', volumeMl: 250 }, fakeExec());
  await gateway.tick();

  const all = await tools.body_state.execute({}, fakeExec({ callId: 'call-2' }));
  assert.equal(all.simulatedSeconds, 60);
  for (const part of ['stomach', 'stomachGhrelin', 'stomachSensory', 'duodenum', 'interoception']) {
    assert.ok(Object.hasOwn(all.parts, part), `missing part ${part}`);
  }
  assert.ok(all.parts.stomach.volumeMl > 0);

  const one = await tools.body_state.execute({ part: 'stomach' }, fakeExec({ callId: 'call-3' }));
  assert.deepEqual(one, { simulatedSeconds: 60, parts: { stomach: all.parts.stomach } });

  const missing = await tools.body_state.execute({ part: 'spleen' }, fakeExec({ callId: 'call-4' }));
  assert.deepEqual(missing, { simulatedSeconds: 60, parts: { spleen: null } });
});

test('buildActionPayload overrides id and sessionId', () => {
  const payload = buildActionPayload(
    { id: 'client-id', sessionId: 'client-session', type: 'drink', volumeMl: 200 },
    { sessionId: 'session-a', callId: 'call-1' },
  );
  assert.equal(payload.id, actionId('session-a', 'call-1'));
  assert.equal(payload.sessionId, 'session-a');
  assert.equal(payload.type, 'drink');
  assert.equal(payload.volumeMl, 200);
  assert.equal(
    payload.id,
    buildActionPayload({}, { sessionId: 'session-a', callId: 'call-1' }).id,
  );
  assert.notEqual(
    payload.id,
    buildActionPayload({}, { sessionId: 'session-a', callId: 'call-2' }).id,
  );
});

test('tool definitions expose JSON Schema and register through ctx.effect', () => {
  const gateway = { submitAction() {}, getState() {} };
  const tools = createBodyTools(gateway);
  assert.deepEqual(Object.keys(tools).sort(), ['body_act', 'body_state']);

  assert.deepEqual(tools.body_act.parameters.required, ['type']);
  assert.equal(tools.body_act.parameters.additionalProperties, true);
  assert.deepEqual(tools.body_act.output.schema.required, ['ok', 'statusCode', 'receipt']);
  assert.equal(tools.body_act.output.schema.additionalProperties, false);
  assert.equal(tools.body_state.parameters.additionalProperties, false);
  assert.deepEqual(
    tools.body_act.output.render(null, { ok: true, statusCode: 202, receipt: {} }),
    [{ type: 'text', text: JSON.stringify({ ok: true, statusCode: 202, receipt: {} }, null, 2) }],
  );

  const registered = [];
  const disposers = [];
  const ctx = {
    effect(callback) {
      disposers.push(callback());
    },
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
  };
  const registeredTools = registerBodyTools(ctx, gateway);
  assert.deepEqual(Object.keys(registeredTools).sort(), ['body_act', 'body_state']);
  assert.deepEqual(registered.map((definition) => definition.name), ['body_act', 'body_state']);
  assert.equal(registered[0], registeredTools.body_act);
  assert.equal(registered[1], registeredTools.body_state);
  assert.equal(disposers.length, 2);
});
