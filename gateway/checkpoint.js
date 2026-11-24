import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isPlainObject as isRecord } from '../json-safe.js';
import { digestAction, makeActionRecord, pruneActions, setAction } from './actions.js';
import { heartbeatSeconds, maxNotificationTextLength } from './config.js';

class CheckpointTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CHECKPOINT_TOO_LARGE';
  }
}

function loadCheckpoint(statePath) {
  let contents;
  try {
    contents = readFileSync(statePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid body checkpoint JSON at ${statePath}`, { cause: error });
  }
}

function migrateV1(saved, statePath) {
  if (!isRecord(saved)
    || !Number.isSafeInteger(saved.wallTimeMs)
    || !Number.isSafeInteger(saved.snapshot?.simulatedSeconds)
    || !isRecord(saved.snapshot.parts)
    || !Array.isArray(saved.pendingActions)
    || !isRecord(saved.receipts)) {
    throw new Error(`Invalid v1 body checkpoint at ${statePath}`);
  }
  if (saved.notifications !== undefined && !Array.isArray(saved.notifications)) {
    throw new Error(`Invalid notifications in body checkpoint at ${statePath}`);
  }
  for (const [id, part] of Object.entries(saved.snapshot.parts)) {
    if (!isRecord(part)) throw new Error(`Body part ${id} is not an object at ${statePath}`);
  }

  const actions = {};
  const pendingActionIds = [];
  for (const action of saved.pendingActions) {
    if (!isRecord(action) || typeof action.id !== 'string' || !action.id
      || typeof action.type !== 'string' || !action.type) {
      throw new Error(`Invalid pending action in body checkpoint at ${statePath}`);
    }
    if (pendingActionIds.includes(action.id)) {
      throw new Error(`Duplicate pending action ${action.id} in body checkpoint at ${statePath}`);
    }
    const receipt = saved.receipts[action.id];
    if (!isRecord(receipt) || !Number.isSafeInteger(receipt.effectiveAt) || receipt.effectiveAt < 0) {
      throw new Error(`Pending action ${action.id} has no valid receipt in body checkpoint at ${statePath}`);
    }
    setAction(actions, action.id, makeActionRecord(action, receipt.effectiveAt, {
      status: 'queued',
      receivedAtWallTimeMs: saved.wallTimeMs,
      queuedAtSimulatedSeconds: saved.snapshot.simulatedSeconds,
    }));
    pendingActionIds.push(action.id);
  }
  pendingActionIds.sort((left, right) => actions[left].effectiveAt - actions[right].effectiveAt);

  for (const [id, receipt] of Object.entries(saved.receipts)) {
    if (Object.hasOwn(actions, id)) continue;
    if (!isRecord(receipt) || !Number.isSafeInteger(receipt.effectiveAt) || receipt.effectiveAt < 0) {
      throw new Error(`Invalid receipt ${id} in body checkpoint at ${statePath}`);
    }
    const legacyAction = isRecord(receipt.action) ? structuredClone(receipt.action) : null;
    let payloadDigest = typeof receipt.payloadDigest === 'string' ? receipt.payloadDigest : null;
    if (payloadDigest === null && legacyAction) {
      try {
        payloadDigest = digestAction(legacyAction);
      } catch {
        payloadDigest = null;
      }
    }
    setAction(actions, id, {
      id,
      type: typeof receipt.type === 'string' ? receipt.type : null,
      action: legacyAction,
      payloadDigest,
      status: 'applied',
      effectiveAt: receipt.effectiveAt,
      receivedAtWallTimeMs: Number.isSafeInteger(receipt.receivedAtWallTimeMs)
        ? receipt.receivedAtWallTimeMs
        : saved.wallTimeMs,
      queuedAtSimulatedSeconds: Number.isSafeInteger(receipt.queuedAtSimulatedSeconds)
        ? receipt.queuedAtSimulatedSeconds
        : null,
      batchId: null,
      attempts: 0,
      lastError: null,
      appliedAtSimulatedSeconds: null,
      appliedAtWallTimeMs: null,
      failedReason: null,
      legacy: true,
    });
  }

  return {
    schemaVersion: 2,
    wallTimeMs: saved.wallTimeMs,
    snapshot: {
      simulatedSeconds: saved.snapshot.simulatedSeconds,
      parts: saved.snapshot.parts,
    },
    pendingActionIds,
    actions,
    activeBatch: null,
    lastEffectiveAt: pendingActionIds.length
      ? Math.max(...pendingActionIds.map((id) => actions[id].effectiveAt))
      : 0,
    notifications: saved.notifications ?? [],
    startup: saved.startup ?? null,
    ...(saved.profile !== undefined ? { profile: saved.profile } : {}),
    ...(saved.parameters !== undefined ? { parameters: saved.parameters } : {}),
  };
}

function assertPositiveFinite(value, label, statePath) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label} in body checkpoint at ${statePath}`);
  }
}

function assertCheckpointProfile(profile, statePath) {
  if (profile === undefined) return;
  if (!isRecord(profile)) {
    throw new Error(`Invalid profile in body checkpoint at ${statePath}`);
  }
  if (profile.weightKg !== undefined) {
    assertPositiveFinite(profile.weightKg, 'profile.weightKg', statePath);
  }
  if (profile.heightCm !== undefined) {
    assertPositiveFinite(profile.heightCm, 'profile.heightCm', statePath);
  }
}

function assertCheckpointParameters(parameters, statePath) {
  if (parameters === undefined) return;
  if (!isRecord(parameters)) {
    throw new Error(`Invalid parameters in body checkpoint at ${statePath}`);
  }
  for (const [id, value] of Object.entries(parameters)) {
    if (!id || (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new Error(`Invalid parameter override ${id || '<empty>'} in body checkpoint at ${statePath}`);
    }
  }
}

function checkpointActive(saved, statePath) {
  if (saved.active === undefined) return true;
  if (typeof saved.active !== 'boolean') {
    throw new Error(`Invalid active flag in body checkpoint at ${statePath}`);
  }
  return saved.active;
}

function migrateCheckpoint(saved, statePath) {
  if (!isRecord(saved)) throw new Error(`Invalid body checkpoint at ${statePath}`);
  const active = checkpointActive(saved, statePath);
  assertCheckpointProfile(saved.profile, statePath);
  assertCheckpointParameters(saved.parameters, statePath);
  const version = saved.schemaVersion ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Invalid body checkpoint schemaVersion ${String(saved.schemaVersion)} at ${statePath}`);
  }
  if (version > 2) {
    throw new Error(`Unsupported body checkpoint schemaVersion ${version} at ${statePath}`);
  }
  const migrated = version === 1 ? migrateV1(saved, statePath) : saved;
  return { ...migrated, active };
}

function encodeCheckpoint(checkpoint, statePath, limitBytes, serialized) {
  if (!isRecord(checkpoint) || checkpoint.schemaVersion !== 2) {
    throw new Error(`Invalid body checkpoint at ${statePath}`);
  }
  if (typeof checkpoint.active !== 'boolean') {
    throw new Error(`Invalid active flag in body checkpoint at ${statePath}`);
  }
  if (!Number.isSafeInteger(checkpoint.wallTimeMs) || checkpoint.wallTimeMs < 0) {
    throw new Error(`Invalid wallTimeMs in body checkpoint at ${statePath}`);
  }
  assertCheckpointProfile(checkpoint.profile, statePath);
  assertCheckpointParameters(checkpoint.parameters, statePath);
  const snapshot = checkpoint.snapshot;
  if (!isRecord(snapshot)
    || !Number.isSafeInteger(snapshot.simulatedSeconds)
    || snapshot.simulatedSeconds < 0
    || !isRecord(snapshot.parts)) {
    throw new Error(`Invalid snapshot in body checkpoint at ${statePath}`);
  }
  for (const [id, part] of Object.entries(snapshot.parts)) {
    if (!isRecord(part)) throw new Error(`Body part ${id} is not an object at ${statePath}`);
  }
  if (!Array.isArray(checkpoint.pendingActionIds)
    || checkpoint.pendingActionIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error(`Invalid pendingActionIds in body checkpoint at ${statePath}`);
  }
  const pendingIds = new Set(checkpoint.pendingActionIds);
  if (pendingIds.size !== checkpoint.pendingActionIds.length) {
    throw new Error(`Duplicate pending action IDs in body checkpoint at ${statePath}`);
  }
  if (!isRecord(checkpoint.actions)) {
    throw new Error(`Invalid actions in body checkpoint at ${statePath}`);
  }

  let previousEffectiveAt = -Infinity;
  for (const id of checkpoint.pendingActionIds) {
    const record = Object.hasOwn(checkpoint.actions, id) ? checkpoint.actions[id] : undefined;
    if (!isRecord(record) || record.id !== id) {
      throw new Error(`Pending action ${id} has no action record at ${statePath}`);
    }
    if (record.status !== 'queued') {
      throw new Error(`Pending action ${id} is not queued at ${statePath}`);
    }
    if (!Number.isSafeInteger(record.effectiveAt) || record.effectiveAt < 0) {
      throw new Error(`Pending action ${id} has an invalid effectiveAt at ${statePath}`);
    }
    if (record.effectiveAt < previousEffectiveAt) {
      throw new Error(`Pending action ${id} goes backwards in effectiveAt at ${statePath}`);
    }
    previousEffectiveAt = record.effectiveAt;
  }

  for (const [id, record] of Object.entries(checkpoint.actions)) {
    if (!isRecord(record) || record.id !== id) {
      throw new Error(`Invalid action record ${id} at ${statePath}`);
    }
    if (record.status !== 'queued' && record.status !== 'applied' && record.status !== 'failed') {
      throw new Error(`Invalid action status for ${id} at ${statePath}`);
    }
    if (!Number.isSafeInteger(record.effectiveAt) || record.effectiveAt < 0) {
      throw new Error(`Invalid effectiveAt for action ${id} at ${statePath}`);
    }
    if (!Number.isSafeInteger(record.attempts) || record.attempts < 0) {
      throw new Error(`Invalid attempts for action ${id} at ${statePath}`);
    }
    if (record.lastError !== null && typeof record.lastError !== 'string') {
      throw new Error(`Invalid lastError for action ${id} at ${statePath}`);
    }
    if (record.status === 'queued'
      && (typeof record.type !== 'string' || !record.type || !isRecord(record.action))) {
      throw new Error(`Queued action ${id} is missing its type or payload at ${statePath}`);
    }
    if (record.type !== null && typeof record.type !== 'string') {
      throw new Error(`Invalid type for action ${id} at ${statePath}`);
    }
    if (record.action !== null && !isRecord(record.action)) {
      throw new Error(`Invalid payload for action ${id} at ${statePath}`);
    }
    if (record.payloadDigest !== null && typeof record.payloadDigest !== 'string') {
      throw new Error(`Invalid payloadDigest for action ${id} at ${statePath}`);
    }
    if (record.status !== 'queued' && pendingIds.has(id)) {
      throw new Error(`Action ${id} is ${record.status} but still pending at ${statePath}`);
    }
  }

  const batch = checkpoint.activeBatch;
  if (batch !== null) {
    if (!isRecord(batch)
      || !Number.isSafeInteger(batch.id)
      || !Number.isSafeInteger(batch.targetSimulatedSeconds)
      || batch.targetSimulatedSeconds !== snapshot.simulatedSeconds + heartbeatSeconds
      || !Number.isSafeInteger(batch.targetWallTimeMs)
      || batch.targetWallTimeMs < 0
      || !Number.isSafeInteger(batch.startedAtWallTimeMs)
      || batch.startedAtWallTimeMs < 0
      || !Array.isArray(batch.actionIds)
      || batch.actionIds.some((id) => typeof id !== 'string' || !id)
      || new Set(batch.actionIds).size !== batch.actionIds.length
      || !Number.isSafeInteger(batch.attempts)
      || batch.attempts < 0
      || (batch.lastError !== null && typeof batch.lastError !== 'string')) {
      throw new Error(`Invalid active batch in body checkpoint at ${statePath}`);
    }
    for (const id of batch.actionIds) {
      if (!pendingIds.has(id)) {
        throw new Error(`Active batch action ${id} is not pending at ${statePath}`);
      }
    }
  }

  if (!Number.isSafeInteger(checkpoint.lastEffectiveAt) || checkpoint.lastEffectiveAt < 0) {
    throw new Error(`Invalid lastEffectiveAt in body checkpoint at ${statePath}`);
  }
  if (checkpoint.pendingActionIds.length
    && checkpoint.lastEffectiveAt < Math.max(...checkpoint.pendingActionIds.map((id) => checkpoint.actions[id].effectiveAt))) {
    throw new Error(`lastEffectiveAt is behind pending actions at ${statePath}`);
  }

  if (!Array.isArray(checkpoint.notifications)) {
    throw new Error(`Invalid notifications in body checkpoint at ${statePath}`);
  }
  const notificationIds = new Set();
  for (const notification of checkpoint.notifications) {
    if (!isRecord(notification)
      || typeof notification.id !== 'string'
      || !notification.id
      || notificationIds.has(notification.id)
      || (notification.mode !== 'context' && notification.mode !== 'wake')
      || typeof notification.sessionId !== 'string'
      || !notification.sessionId
      || typeof notification.text !== 'string'
      || !notification.text.trim()
      || notification.text.length > maxNotificationTextLength) {
      throw new Error(`Invalid notification in body checkpoint at ${statePath}`);
    }
    notificationIds.add(notification.id);
  }

  const json = serialized ?? JSON.stringify(checkpoint);
  assertSize(json, statePath, limitBytes);
  return json;
}

function assertSize(json, statePath, limitBytes) {
  const size = Buffer.byteLength(json) + 1;
  if (size > limitBytes) {
    throw new CheckpointTooLargeError(
      `Body checkpoint is ${size} bytes, over the ${limitBytes} byte limit at ${statePath}`,
    );
  }
}

export function emptyCheckpoint(nowMs) {
  return {
    schemaVersion: 2,
    active: true,
    wallTimeMs: nowMs,
    snapshot: { simulatedSeconds: 0, parts: {} },
    pendingActionIds: [],
    actions: {},
    activeBatch: null,
    lastEffectiveAt: 0,
    notifications: [],
    startup: null,
  };
}

export function createCheckpointStore({
  statePath,
  legacyStatePath,
  maxCheckpointBytes,
  maxActionRecords,
  actionRetentionMs,
  now,
}) {
  const directory = dirname(statePath);
  const temporaryPath = `${statePath}.tmp`;
  const actionReserveBytes = Math.min(64 * 1024, Math.floor(maxCheckpointBytes / 4));
  let current;

  function load() {
    const saved = loadCheckpoint(statePath)
      ?? (statePath === legacyStatePath ? null : loadCheckpoint(legacyStatePath));
    if (saved === null) return null;

    const checkpoint = migrateCheckpoint(saved, statePath);
    encodeCheckpoint(checkpoint, statePath, maxCheckpointBytes);
    return checkpoint;
  }

  function prune(next) {
    return next.active ? pruneActions(next, now(), maxActionRecords, actionRetentionMs) : next;
  }

  function commit(next, { reserveForAction = false } = {}) {
    const pruned = prune(next);
    const serialized = reserveForAction ? JSON.stringify(pruned) : undefined;
    if (reserveForAction) assertSize(serialized, statePath, maxCheckpointBytes - actionReserveBytes);

    const contents = encodeCheckpoint(pruned, statePath, maxCheckpointBytes, serialized);
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporaryPath, `${contents}\n`);
    renameSync(temporaryPath, statePath);
    current = pruned;
  }

  function ackNotification(id) {
    const notifications = current.notifications.filter((notification) => notification.id !== id);
    const acked = notifications.length !== current.notifications.length;
    if (acked) commit({ ...current, notifications });
    return { id, acked };
  }

  return {
    load,
    prune,
    commit,
    ackNotification,
    get current() { return current; },
  };
}