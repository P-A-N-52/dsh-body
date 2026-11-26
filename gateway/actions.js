import { createHash } from 'node:crypto';
import { assertJsonValue, isPlainObject as isRecord } from '../json-safe.js';
import { heartbeatSeconds } from './config.js';

const maxActionIdLength = 256;
const maxActionTypeLength = 64;
const maxPendingActions = 1000;

export function digestAction(action) {
  return `sha256:${createHash('sha256').update(canonicalJson(action)).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function setAction(actions, id, record) {
  Object.defineProperty(actions, id, {
    value: record,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function makeActionRecord(action, effectiveAt, { status, receivedAtWallTimeMs, queuedAtSimulatedSeconds, payloadDigest = digestAction(action) }) {
  return {
    id: action.id,
    type: action.type,
    action,
    payloadDigest,
    status,
    effectiveAt,
    receivedAtWallTimeMs,
    queuedAtSimulatedSeconds,
    batchId: null,
    attempts: 0,
    lastError: null,
    appliedAtSimulatedSeconds: null,
    appliedAtWallTimeMs: null,
    failedReason: null,
  };
}

export function pruneActions(current, nowMs, maxActionRecords, actionRetentionMs) {
  const keep = new Set(current.pendingActionIds);
  if (current.activeBatch) {
    for (const id of current.activeBatch.actionIds) keep.add(id);
  }
  const candidates = Object.entries(current.actions)
    .filter(([id]) => !keep.has(id))
    .sort((left, right) => (
      (right[1].appliedAtWallTimeMs ?? right[1].receivedAtWallTimeMs ?? 0)
      - (left[1].appliedAtWallTimeMs ?? left[1].receivedAtWallTimeMs ?? 0)
    ));
  const remove = new Set();
  for (const [index, [id, record]] of candidates.entries()) {
    const stamp = record.appliedAtWallTimeMs ?? record.receivedAtWallTimeMs ?? nowMs;
    if (index >= maxActionRecords || nowMs - stamp > actionRetentionMs) remove.add(id);
  }
  if (remove.size === 0) return current;
  const actions = Object.fromEntries(
    Object.entries(current.actions).filter(([id]) => !remove.has(id)),
  );
  return { ...current, actions };
}

const NSFW_ACTIONS = new Set(['sex', 'orgasm', 'express_milk', 'breastfeed']);

export function createActionQueue({
  store,
  now,
  heartbeatIntervalMs,
  requireBinding = false,
  isNsfwEnabled = () => false,
}) {
  const actionHandlers = new Map();

  function register(modules) {
    for (const { id, actionTypes } of modules) {
      for (const type of actionTypes) {
        if (!actionHandlers.has(type)) actionHandlers.set(type, []);
        actionHandlers.get(type).push(id);
      }
    }
  }

  function capabilities() {
    const allowNsfw = Boolean(isNsfwEnabled(store.current));
    return Object.fromEntries(
      [...actionHandlers]
        .filter(([type]) => allowNsfw || !NSFW_ACTIONS.has(type))
        .map(([type, ids]) => [type, [...ids]]),
    );
  }

  function receiptView(record) {
    return {
      id: record.id,
      type: record.type,
      status: record.status,
      effectiveAt: record.effectiveAt,
      attempts: record.attempts,
      lastError: record.lastError,
      appliedAtSimulatedSeconds: record.appliedAtSimulatedSeconds,
      appliedAtWallTimeMs: record.appliedAtWallTimeMs,
      failedReason: record.failedReason,
    };
  }

  function enqueue(payload) {
    const checkpoint = store.current;
    let action;
    try {
      action = structuredClone(payload);
    } catch {
      return { statusCode: 400, body: { error: 'Action must be JSON-safe' } };
    }
    if (!isRecord(action)) return { statusCode: 400, body: { error: 'Expected a JSON object' } };
    try {
      assertJsonValue(action, 'action');
    } catch {
      return { statusCode: 400, body: { error: 'Action must be JSON-safe' } };
    }
    if (typeof action.id !== 'string' || !action.id) {
      return { statusCode: 400, body: { error: 'Expected a nonempty id' } };
    }
    if (action.id.length > maxActionIdLength) {
      return { statusCode: 400, body: { error: `Action id must be at most ${maxActionIdLength} characters` } };
    }
    if (typeof action.type !== 'string' || !action.type) {
      return { statusCode: 400, body: { error: 'An action needs a nonempty type' } };
    }
    if (action.type.length > maxActionTypeLength) {
      return { statusCode: 400, body: { error: `Action type must be at most ${maxActionTypeLength} characters` } };
    }

    let digest;
    try {
      digest = digestAction(action);
    } catch {
      return { statusCode: 400, body: { error: 'Action must be JSON-safe' } };
    }

    const existing = Object.hasOwn(checkpoint.actions, action.id)
      ? checkpoint.actions[action.id]
      : undefined;
    if (existing) {
      let same = false;
      if (existing.payloadDigest !== null) {
        same = existing.payloadDigest === digest;
      } else if (isRecord(existing.action)) {
        try {
          same = digestAction(existing.action) === digest;
        } catch {
          same = false;
        }
      }
      if (same) return { statusCode: 200, body: receiptView(existing) };
      return {
        statusCode: 409,
        body: { error: 'Action id already used with a different payload', existing: receiptView(existing) },
      };
    }

    if (!checkpoint.active) {
      return { statusCode: 409, body: { error: 'Body Gateway is paused', active: false } };
    }
    if (requireBinding && !checkpoint.boundSessionId) {
      return {
        statusCode: 409,
        body: { error: 'Body Gateway is dormant until bound to a session', dormant: true, boundSessionId: null },
      };
    }
    if (NSFW_ACTIONS.has(action.type) && !isNsfwEnabled(checkpoint)) {
      return {
        statusCode: 403,
        body: { error: `Action ${action.type} is disabled when nsfw is false`, nsfw: false },
      };
    }
    if (!actionHandlers.has(action.type)) {
      return {
        statusCode: 422,
        body: {
          error: 'No module handles this action type',
          type: action.type,
          supportedActionTypes: [...actionHandlers.keys()].sort(),
        },
      };
    }
    if (checkpoint.pendingActionIds.length >= maxPendingActions) {
      return { statusCode: 429, body: { error: 'Too many pending actions' } };
    }

    const nowMs = now();
    const elapsed = Math.max(0, Math.floor((nowMs - checkpoint.wallTimeMs) / heartbeatIntervalMs));
    const batchFloor = Math.max(
      checkpoint.snapshot.simulatedSeconds,
      checkpoint.activeBatch?.targetSimulatedSeconds ?? checkpoint.snapshot.simulatedSeconds + elapsed * heartbeatSeconds,
    );
    const effectiveAt = Math.max(batchFloor + heartbeatSeconds, checkpoint.lastEffectiveAt ?? 0);
    const record = makeActionRecord(action, effectiveAt, {
      status: 'queued',
      receivedAtWallTimeMs: nowMs,
      payloadDigest: digest,
      queuedAtSimulatedSeconds: checkpoint.snapshot.simulatedSeconds,
    });
    const next = {
      ...checkpoint,
      pendingActionIds: [...checkpoint.pendingActionIds, action.id],
      actions: { ...checkpoint.actions, [action.id]: record },
      lastEffectiveAt: effectiveAt,
    };
    try {
      store.commit(next, { reserveForAction: true });
    } catch (error) {
      if (error.code === 'CHECKPOINT_TOO_LARGE') {
        return { statusCode: 413, body: { error: 'Body checkpoint is too large' } };
      }
      throw error;
    }
    return { statusCode: 202, body: receiptView(record) };
  }

  function reconcileActions(current) {
    const pendingActionIds = [];
    const actions = { ...current.actions };
    let changed = false;
    for (const id of current.pendingActionIds) {
      const record = actions[id];
      if (!actionHandlers.has(record.type)) {
        setAction(actions, id, {
          ...record,
          status: 'failed',
          failedReason: 'no-handler',
          appliedAtSimulatedSeconds: null,
          appliedAtWallTimeMs: null,
        });
        changed = true;
      } else {
        pendingActionIds.push(id);
      }
    }
    let activeBatch = current.activeBatch;
    if (activeBatch) {
      const actionIds = activeBatch.actionIds.filter((id) => pendingActionIds.includes(id));
      if (actionIds.length !== activeBatch.actionIds.length) {
        activeBatch = { ...activeBatch, actionIds };
        changed = true;
      }
    }
    return changed ? { ...current, pendingActionIds, actions, activeBatch } : current;
  }

  return { register, capabilities, enqueue, reconcile: reconcileActions };
}