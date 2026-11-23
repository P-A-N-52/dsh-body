/*
 * DSH 会话工具：`body_act` 把结构化摄入或排尿动作提交给 Gateway，`body_state` 读取最近一次提交的快照。
 * 动作 id 由会话 ID 与工具调用 ID 稳定生成，同一调用重试复用同一个 id。
 * 回执里的 202 queued 只表示入队；动作在后续轮次提交后才反映到 `body_state`。
 */
import { createHash } from 'node:crypto';

const mealKinds = ['liquid', 'solid', 'mixed'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildActionPayload(args, { sessionId, callId }) {
  const digest = createHash('sha256').update(`${sessionId}\0${callId}`).digest('hex');
  return { ...args, id: `body-${digest.slice(0, 32)}`, sessionId };
}

function validateExercise(args) {
  if (!isFiniteNumber(args.intensity) || args.intensity <= 0 || args.intensity > 1) {
    return 'intensity must be a finite number greater than 0 and at most 1';
  }
  if (!isFiniteNumber(args.durationMin) || args.durationMin <= 0) {
    return 'durationMin must be a finite number greater than 0';
  }
  return null;
}

function validateAction(args) {
  if (args.type === 'urinate') return null;
  if (args.type === 'orgasm') return null;
  if (args.type === 'exercise' || args.type === 'sex') return validateExercise(args);
  if (args.type !== 'drink' && args.type !== 'eat') {
    return 'type must be drink, eat, urinate, exercise, sex, or orgasm';
  }
  if (!isFiniteNumber(args.volumeMl) || args.volumeMl <= 0) {
    return 'volumeMl must be a finite number greater than 0';
  }
  if (args.durationMin !== undefined && (!isFiniteNumber(args.durationMin) || args.durationMin < 0)) {
    return 'durationMin must be a finite number greater than or equal to 0';
  }
  if (args.carbohydrateG !== undefined && (!isFiniteNumber(args.carbohydrateG) || args.carbohydrateG < 0)) {
    return 'carbohydrateG must be a finite number greater than or equal to 0';
  }
  if (args.type === 'drink') {
    if (args.energyKcal !== undefined && (!isFiniteNumber(args.energyKcal) || args.energyKcal < 0)) {
      return 'energyKcal must be a finite number greater than or equal to 0';
    }
    return null;
  }
  if (!isFiniteNumber(args.energyKcal) || args.energyKcal < 0) {
    return 'eat requires a finite energyKcal greater than or equal to 0';
  }
  if (!mealKinds.includes(args.mealKind)) {
    return 'eat requires mealKind liquid, solid, or mixed';
  }
  return null;
}

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

export function createBodyTools(gateway) {
  return {
    body_act: {
      name: 'body_act',
      description: 'Submit a structured body action (drink, eat, urinate, exercise, sex, or orgasm) to the Gateway. '
        + 'A 202 queued receipt only means the action is queued; it takes effect in a later heartbeat, '
        + 'so read body_state afterwards. Retrying the same session and tool call reuses the same action id.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['drink', 'eat', 'urinate', 'exercise', 'sex', 'orgasm'] },
          volumeMl: { type: 'number', description: 'Intake volume in milliliters.' },
          energyKcal: { type: 'number', description: 'Intake energy in kilocalories.' },
          carbohydrateG: {
            type: 'number',
            description: 'Digestible carbohydrate intake in grams, as glucose equivalents; omit when unknown.',
          },
          mealKind: { type: 'string', enum: mealKinds },
          durationMin: {
            type: 'number',
            description: 'Exercise or sex duration in minutes when type is exercise or sex; intake duration otherwise.',
          },
          intensity: {
            type: 'number',
            description: 'Relative exercise or sex intensity, greater than 0 and at most 1.',
          },
        },
        required: ['type'],
        additionalProperties: true,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            statusCode: { type: 'number' },
            receipt: { type: 'object' },
          },
          required: ['ok', 'statusCode', 'receipt'],
          additionalProperties: false,
        },
        render: renderJson,
      },
      async execute(args = {}, exec) {
        const sessionId = exec.agent?.session?.id;
        if (typeof sessionId !== 'string' || sessionId === '') {
          return { ok: false, statusCode: 400, receipt: { error: 'body_act requires an agent session id' } };
        }
        const invalid = validateAction(args);
        if (invalid !== null) {
          return { ok: false, statusCode: 400, receipt: { error: invalid } };
        }
        const payload = buildActionPayload(args, { sessionId, callId: exec.callId });
        const { statusCode, body } = gateway.submitAction(payload);
        return {
          ok: statusCode >= 200 && statusCode < 300,
          statusCode,
          receipt: body,
        };
      },
    },
    body_state: {
      name: 'body_state',
      description: 'Read the latest committed body state snapshot. '
        + 'Pass part to read one body part, or omit it to read every part. '
        + 'Actions still queued with 202 do not appear until a later heartbeat commits them.',
      parameters: {
        type: 'object',
        properties: {
          part: { type: 'string', description: 'Body part id, for example stomach.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            simulatedSeconds: { type: 'number' },
            parts: { type: 'object', additionalProperties: true },
          },
          required: ['simulatedSeconds', 'parts'],
          additionalProperties: false,
        },
        render: renderJson,
      },
      async execute(args = {}) {
        const state = gateway.getState();
        const parts = typeof args.part === 'string'
          ? { [args.part]: state.parts[args.part] ?? null }
          : state.parts;
        return { simulatedSeconds: state.simulatedSeconds, parts };
      },
    },
  };
}

export function registerBodyTools(ctx, gateway) {
  const tools = createBodyTools(gateway);
  for (const definition of Object.values(tools)) {
    ctx.effect(() => ctx.tools.register(definition));
  }
  return tools;
}
