import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildActionPayload, createBodyTools } from '../tools.js';

function fakeExec({ sessionId = 'session-a', callId = 'call-1' } = {}) {
  return {
    agent: { session: { id: sessionId } },
    callId,
    signal: new AbortController().signal,
  };
}

function actionId(sessionId, callId) {
  return `body-${createHash('sha256').update(`${sessionId}\0${callId}`).digest('hex').slice(0, 32)}`;
}

function fakeGateway() {
  const submitted = [];
  const receipt = { id: actionId('session-a', 'call-1'), type: 'urinate', status: 'queued', attempts: 0 };
  return {
    submitted,
    receipt,
    submitAction(payload) {
      submitted.push(payload);
      return { statusCode: 202, body: receipt };
    },
    getState() {
      return { simulatedSeconds: 0, parts: {} };
    },
  };
}

test('body_act accepts urinate without volume, energy, mealKind or duration', async () => {
  const gateway = fakeGateway();
  const tools = createBodyTools(gateway);

  const result = await tools.body_act.execute({ type: 'urinate' }, fakeExec());
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(result.receipt, gateway.receipt);

  assert.equal(gateway.submitted.length, 1);
  const [payload] = gateway.submitted;
  assert.deepEqual(payload, {
    type: 'urinate',
    id: actionId('session-a', 'call-1'),
    sessionId: 'session-a',
  });
  for (const key of ['volumeMl', 'energyKcal', 'mealKind', 'durationMin']) {
    assert.equal(Object.hasOwn(payload, key), false, `urinate payload must not add ${key}`);
  }
});

test('urinate reuses the same session and callId action id as drink and eat', () => {
  const exec = { sessionId: 'session-a', callId: 'call-1' };
  const urinatePayload = buildActionPayload({ type: 'urinate' }, exec);
  assert.equal(urinatePayload.id, actionId('session-a', 'call-1'));
  assert.equal(urinatePayload.id, buildActionPayload({ type: 'drink', volumeMl: 240 }, exec).id);
  assert.equal(
    urinatePayload.id,
    buildActionPayload({ type: 'eat', volumeMl: 300, energyKcal: 200, mealKind: 'solid' }, exec).id,
  );

  assert.equal(
    buildActionPayload({ type: 'urinate' }, { sessionId: 'session-a', callId: 'call-1' }).id,
    buildActionPayload({ type: 'urinate' }, { sessionId: 'session-a', callId: 'call-1' }).id,
  );
  assert.notEqual(
    urinatePayload.id,
    buildActionPayload({ type: 'urinate' }, { sessionId: 'session-a', callId: 'call-2' }).id,
  );
});

test('repeating urinate with the same session and callId submits the same payload id', async () => {
  const gateway = fakeGateway();
  const tools = createBodyTools(gateway);
  const exec = fakeExec();

  await tools.body_act.execute({ type: 'urinate' }, exec);
  await tools.body_act.execute({ type: 'urinate' }, exec);
  assert.deepEqual(gateway.submitted.map((payload) => payload.id), [
    actionId('session-a', 'call-1'),
    actionId('session-a', 'call-1'),
  ]);
});

test('the tool schema lists urinate and keeps the other tool and payload shape', () => {
  const tools = createBodyTools(fakeGateway());
  assert.deepEqual(Object.keys(tools).sort(), ['body_act', 'body_state']);
  assert.deepEqual(tools.body_act.parameters.properties.type.enum, ['drink', 'eat', 'urinate', 'exercise']);
  assert.deepEqual(tools.body_act.parameters.required, ['type']);
  assert.equal(tools.body_act.parameters.additionalProperties, true);
  assert.match(tools.body_act.description, /urinate/);
  assert.deepEqual(tools.body_act.output.schema.required, ['ok', 'statusCode', 'receipt']);
  assert.equal(tools.body_act.output.schema.additionalProperties, false);
  assert.equal(tools.body_state.name, 'body_state');
});

test('accepting urinate does not loosen the drink and eat validation', async () => {
  const gateway = fakeGateway();
  const tools = createBodyTools(gateway);
  const invalid = [
    [{ type: 'sniff', volumeMl: 100 }, /type/],
    [{ type: 'drink' }, /volumeMl/],
    [{ type: 'drink', volumeMl: 100, energyKcal: -1 }, /energyKcal/],
    [{ type: 'eat', volumeMl: 100, mealKind: 'solid' }, /energyKcal/],
    [{ type: 'eat', volumeMl: 100, energyKcal: 300 }, /mealKind/],
  ];
  for (const [args, pattern] of invalid) {
    const result = await tools.body_act.execute(args, fakeExec());
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.receipt.error, pattern);
  }
  assert.equal(gateway.submitted.length, 0);
});
