import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { assertJsonValue, isPlainObject as isRecord } from './json-safe.js';

const heartbeatSeconds = 60;
const defaultHeartbeatIntervalMs = 60_000;
const defaultCatchUpMinutes = 720;
const defaultScriptTimeoutMs = 10_000;
const defaultPort = 3210;
const defaultMaxCheckpointBytes = 2 * 1024 * 1024;
const host = '127.0.0.1';
const maxBodyBytes = 64 * 1024;
const maxNotificationTextLength = 4000;
const maxActionIdLength = 256;
const maxActionTypeLength = 64;
const maxPendingActions = 1000;
const defaultMaxActionRecords = 2000;
const defaultActionRetentionMs = 30 * 24 * 60 * 60 * 1000;
const defaultMaxNotifications = 200;
const defaultManifestPath = fileURLToPath(new URL('./body-modules.json', import.meta.url));
const workerUrl = new URL('./script-worker.js', import.meta.url);

class CheckpointTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CHECKPOINT_TOO_LARGE';
  }
}

function resolveDefaultPort() {
  const configured = process.env.DSH_BODY_PORT;
  if (configured === undefined || configured === '') return defaultPort;
  return Number(configured);
}

function readManifest(path) {
  const { startupScripts = [], scripts, catchUpMinutes = defaultCatchUpMinutes, scriptTimeoutMs = defaultScriptTimeoutMs } =
    JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(scripts) || !Array.isArray(startupScripts)) {
    throw new Error('scripts and startupScripts must be arrays of paths relative to the manifest');
  }
  if (!Number.isSafeInteger(catchUpMinutes) || catchUpMinutes < 0) {
    throw new Error('catchUpMinutes must be a nonnegative integer');
  }
  if (!Number.isInteger(scriptTimeoutMs) || scriptTimeoutMs < 1 || scriptTimeoutMs > 2_147_483_647) {
    throw new Error('scriptTimeoutMs must be a positive integer within the timer range');
  }
  const directory = dirname(path);
  const scriptUrl = (relativePath) => {
    if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
      throw new Error('Script paths must be relative to the manifest');
    }
    return pathToFileURL(resolve(directory, relativePath)).href;
  };
  return {
    initializers: startupScripts.map(scriptUrl),
    moduleUrls: scripts.map(scriptUrl),
    catchUpMinutes,
    scriptTimeoutMs,
  };
}

async function finishScripts(tasks) {
  const outcomes = await Promise.allSettled(tasks);
  const failures = outcomes.filter(({ status }) => status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(({ reason }) => reason), 'Body scripts failed');
  return outcomes.map(({ value }) => value);
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

function digestAction(action) {
  return `sha256:${createHash('sha256').update(canonicalJson(action)).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function setAction(actions, id, record) {
  Object.defineProperty(actions, id, {
    value: record,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function makeActionRecord(action, effectiveAt, { status, receivedAtWallTimeMs, queuedAtSimulatedSeconds }) {
  return {
    id: action.id,
    type: action.type,
    action: structuredClone(action),
    payloadDigest: digestAction(action),
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
  };
}

function migrateCheckpoint(saved, statePath) {
  if (!isRecord(saved)) throw new Error(`Invalid body checkpoint at ${statePath}`);
  const version = saved.schemaVersion ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Invalid body checkpoint schemaVersion ${String(saved.schemaVersion)} at ${statePath}`);
  }
  if (version > 2) {
    throw new Error(`Unsupported body checkpoint schemaVersion ${version} at ${statePath}`);
  }
  return version === 1 ? migrateV1(saved, statePath) : saved;
}

function assertCheckpoint(checkpoint, statePath, limitBytes = defaultMaxCheckpointBytes) {
  if (!isRecord(checkpoint) || checkpoint.schemaVersion !== 2) {
    throw new Error(`Invalid body checkpoint at ${statePath}`);
  }
  if (!Number.isSafeInteger(checkpoint.wallTimeMs) || checkpoint.wallTimeMs < 0) {
    throw new Error(`Invalid wallTimeMs in body checkpoint at ${statePath}`);
  }
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
    || checkpoint.pendingActionIds.some((id) => typeof id !== 'string' || !id)
    || new Set(checkpoint.pendingActionIds).size !== checkpoint.pendingActionIds.length) {
    throw new Error(`Invalid pendingActionIds in body checkpoint at ${statePath}`);
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
    if (record.status !== 'queued' && checkpoint.pendingActionIds.includes(id)) {
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
      if (!checkpoint.pendingActionIds.includes(id)) {
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

  const size = Buffer.byteLength(JSON.stringify(checkpoint)) + 1;
  if (size > limitBytes) {
    throw new CheckpointTooLargeError(
      `Body checkpoint is ${size} bytes, over the ${limitBytes} byte limit at ${statePath}`,
    );
  }
  return checkpoint;
}

function withDefaults(defaults, saved, label = 'body part') {
  if (saved === undefined) return structuredClone(defaults);
  if (!isRecord(saved)) throw new Error(`${label} is not an object`);
  const result = { ...saved };
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(result, key)) {
      result[key] = structuredClone(value);
    } else if (isRecord(value) && isRecord(result[key])) {
      result[key] = withDefaults(value, result[key]);
    }
  }
  return result;
}

function emptyCheckpoint(nowMs) {
  return {
    schemaVersion: 2,
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

function errorText(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current.message) parts.push(String(current.message));
    current = current.cause;
  }
  return parts.length ? parts.join(': ') : String(error);
}

function formatError(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => errorText(cause)).join('; ');
  }
  return errorText(error);
}

function truncateError(error) {
  return formatError(error).slice(0, 500);
}

function reply(response, status, value, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return;
  let body;
  try {
    body = JSON.stringify(value) ?? 'null';
  } catch {
    status = 500;
    body = JSON.stringify({ error: 'Gateway failed to serialize the response' });
  }
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

function methodNotAllowed(response, allow) {
  return reply(response, 405, { error: 'Method not allowed' }, { allow });
}

export function startGateway({
  manifestPath = defaultManifestPath,
  statePath,
  port = resolveDefaultPort(),
  heartbeatIntervalMs = defaultHeartbeatIntervalMs,
  autoTick = true,
  now = Date.now,
  maxActionRecords = defaultMaxActionRecords,
  actionRetentionMs = defaultActionRetentionMs,
  maxNotifications = defaultMaxNotifications,
  maxCheckpointBytes = defaultMaxCheckpointBytes,
} = {}) {
  if (typeof statePath !== 'string' || !statePath) {
    throw new TypeError('statePath is required');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port must be an integer between 0 and 65535');
  }
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 || heartbeatIntervalMs > 2_147_483_647) {
    throw new TypeError('heartbeatIntervalMs must be a positive integer within the timer range');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isInteger(maxActionRecords) || maxActionRecords < 1) {
    throw new TypeError('maxActionRecords must be a positive integer');
  }
  if (!Number.isInteger(actionRetentionMs) || actionRetentionMs < 0) {
    throw new TypeError('actionRetentionMs must be a nonnegative integer');
  }
  if (!Number.isInteger(maxNotifications) || maxNotifications < 1) {
    throw new TypeError('maxNotifications must be a positive integer');
  }
  if (!Number.isInteger(maxCheckpointBytes) || maxCheckpointBytes < 1024) {
    throw new TypeError('maxCheckpointBytes must be an integer of at least 1024');
  }
  const checkpointReserveBytes = Math.min(64 * 1024, Math.floor(maxCheckpointBytes / 4));

  const absoluteManifestPath = resolve(manifestPath);
  const legacyStatePath = join(dirname(absoluteManifestPath), 'body-state.json');
  const { initializers, moduleUrls, catchUpMinutes, scriptTimeoutMs } = readManifest(absoluteManifestPath);
  const destination = resolve(statePath);
  const activeWorkers = new Set();

  let modules;
  let helperModules;
  let actionHandlers = new Map();
  let checkpoint;
  let heartbeatWork;
  let timer;
  let stopping = false;
  let lastHeartbeat = {
    lastSuccessAtMs: null,
    lastErrorAtMs: null,
    lastError: null,
    consecutiveFailures: 0,
  };

  function getPort() {
    return server.address()?.port ?? port;
  }

  async function runScript(url, operation, input) {
    if (stopping) throw new Error('Body Gateway is stopping');
    return new Promise((resolvePromise, rejectPromise) => {
      const worker = new Worker(workerUrl, { workerData: { url, operation, input } });
      activeWorkers.add(worker);

      let output;
      let failure;
      const label = `${operation} ${fileURLToPath(url)}`;
      const timeout = setTimeout(() => {
        failure = new Error(`${label} timed out after ${scriptTimeoutMs} ms`);
        void worker.terminate();
      }, scriptTimeoutMs);

      worker.once('message', (result) => {
        output = result;
        clearTimeout(timeout);
        void worker.terminate();
      });
      worker.once('error', (cause) => {
        failure ??= new Error(`${label} failed`, { cause });
      });
      worker.once('exit', (code) => {
        clearTimeout(timeout);
        activeWorkers.delete(worker);
        if (failure) rejectPromise(failure);
        else if (output === undefined) rejectPromise(new Error(`${label} exited without a result (code ${code})`));
        else resolvePromise(output);
      });
    });
  }

  function commit(next) {
    pruneActions(next);
    assertCheckpoint(next, destination, maxCheckpointBytes);
    mkdirSync(dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(next)}\n`);
    renameSync(temporaryPath, destination);
    checkpoint = next;
  }

  function capabilitiesView() {
    return Object.fromEntries([...actionHandlers.entries()].map(([type, ids]) => [type, [...ids]]));
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

  function catchUpHorizon() {
    const elapsed = Math.max(0, Math.floor((now() - checkpoint.wallTimeMs) / heartbeatIntervalMs));
    return checkpoint.snapshot.simulatedSeconds + elapsed * heartbeatSeconds;
  }

  function enqueue(payload) {
    if (stopping) return { statusCode: 503, body: { error: 'Body Gateway is stopping' } };
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

    const batchFloor = Math.max(
      checkpoint.snapshot.simulatedSeconds,
      checkpoint.activeBatch ? checkpoint.activeBatch.targetSimulatedSeconds : catchUpHorizon(),
    );
    const effectiveAt = Math.max(batchFloor + heartbeatSeconds, checkpoint.lastEffectiveAt ?? 0);
    const record = makeActionRecord(action, effectiveAt, {
      status: 'queued',
      receivedAtWallTimeMs: now(),
      queuedAtSimulatedSeconds: checkpoint.snapshot.simulatedSeconds,
    });
    const next = {
      ...checkpoint,
      pendingActionIds: [...checkpoint.pendingActionIds, action.id],
      actions: { ...checkpoint.actions, [action.id]: record },
      lastEffectiveAt: effectiveAt,
    };
    const projectedSize = Buffer.byteLength(JSON.stringify(next)) + 1;
    if (projectedSize > maxCheckpointBytes - checkpointReserveBytes) {
      return { statusCode: 413, body: { error: 'Body checkpoint is too large' } };
    }
    try {
      commit(next);
    } catch (error) {
      if (error.code === 'CHECKPOINT_TOO_LARGE') {
        return { statusCode: 413, body: { error: 'Body checkpoint is too large' } };
      }
      throw error;
    }
    return { statusCode: 202, body: receiptView(record) };
  }

  function ackNotification(id) {
    if (stopping) throw new Error('Body Gateway is stopping');
    const before = checkpoint.notifications.length;
    const notifications = checkpoint.notifications.filter((notification) => notification.id !== id);
    if (notifications.length !== before) {
      commit({ ...checkpoint, notifications });
    }
    return { id, acked: notifications.length !== before };
  }

  function pruneActions(current) {
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
    const nowMs = now();
    const remove = new Set();
    for (const [index, [id, record]] of candidates.entries()) {
      const stamp = record.appliedAtWallTimeMs ?? record.receivedAtWallTimeMs ?? nowMs;
      if (index >= maxActionRecords || nowMs - stamp > actionRetentionMs) remove.add(id);
    }
    if (remove.size) {
      current.actions = Object.fromEntries(
        Object.entries(current.actions).filter(([id]) => !remove.has(id)),
      );
    }
    return current;
  }

  function makeBatch(current) {
    const targetSimulatedSeconds = current.snapshot.simulatedSeconds + heartbeatSeconds;
    return {
      id: targetSimulatedSeconds,
      targetSimulatedSeconds,
      targetWallTimeMs: current.wallTimeMs + heartbeatIntervalMs,
      actionIds: current.pendingActionIds.filter(
        (id) => current.actions[id].effectiveAt <= targetSimulatedSeconds,
      ),
      attempts: 0,
      lastError: null,
      startedAtWallTimeMs: now(),
    };
  }

  async function runHeartbeat(current, batch, { suppressNotifications = false } = {}) {
    const actions = batch.actionIds.map((id) => current.actions[id].action);
    const input = {
      snapshot: current.snapshot,
      actions,
      dt: heartbeatSeconds,
      simulatedSeconds: batch.targetSimulatedSeconds,
      wallTimeMs: batch.targetWallTimeMs,
      helperModules,
    };
    const outputs = await finishScripts(modules.map(({ url }) => runScript(url, 'heartbeat', input)));

    const updates = [];
    const notifications = [];
    let droppedNotifications = 0;
    for (const [index, output] of outputs.entries()) {
      if (output.part !== undefined) updates.push([modules[index].id, output.part]);
      for (const notification of output.notifications) {
        if (suppressNotifications) {
          droppedNotifications += 1;
          continue;
        }
        notifications.push({
          id: randomUUID(),
          ...notification,
          createdAtSimulatedSeconds: batch.targetSimulatedSeconds,
          createdAtWallTimeMs: batch.targetWallTimeMs,
        });
      }
    }

    return {
      snapshot: {
        simulatedSeconds: batch.targetSimulatedSeconds,
        parts: { ...current.snapshot.parts, ...Object.fromEntries(updates) },
      },
      notifications,
      droppedNotifications,
    };
  }

  function applyBatch(current, result, batch) {
    const appliedAtWallTimeMs = now();
    const actions = { ...current.actions };
    for (const id of batch.actionIds) {
      setAction(actions, id, {
        ...actions[id],
        status: 'applied',
        batchId: batch.id,
        attempts: batch.attempts,
        lastError: null,
        appliedAtSimulatedSeconds: batch.targetSimulatedSeconds,
        appliedAtWallTimeMs,
      });
    }
    const pendingActionIds = current.pendingActionIds.filter((id) => !batch.actionIds.includes(id));
    const overdue = pendingActionIds.filter(
      (id) => actions[id].effectiveAt <= batch.targetSimulatedSeconds,
    );
    if (overdue.length) {
      console.warn(
        `Batch ${batch.targetSimulatedSeconds}s committed with due actions outside the batch: ${overdue.join(', ')}`,
      );
    }
    let notifications = [...current.notifications, ...result.notifications];
    if (notifications.length > maxNotifications) {
      notifications = notifications.slice(-maxNotifications);
    }
    const next = {
      ...current,
      wallTimeMs: Math.min(batch.targetWallTimeMs, appliedAtWallTimeMs),
      snapshot: result.snapshot,
      pendingActionIds,
      actions,
      activeBatch: null,
      notifications,
    };
    return pruneActions(next);
  }

  function failBatch(current, error) {
    if (!current.activeBatch) return current;
    const attempts = current.activeBatch.attempts + 1;
    const lastError = truncateError(error);
    const actions = { ...current.actions };
    for (const id of current.activeBatch.actionIds) {
      setAction(actions, id, { ...actions[id], attempts, lastError });
    }
    return {
      ...current,
      actions,
      activeBatch: {
        ...current.activeBatch,
        attempts,
        lastError,
      },
    };
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

  async function catchUp(current, nowMs, limit) {
    if (nowMs < current.wallTimeMs) return { ...current, wallTimeMs: nowMs };
    const elapsed = Math.floor((nowMs - current.wallTimeMs) / heartbeatIntervalMs);
    if (elapsed === 0) return current;

    let next = current;
    let remaining = Math.min(elapsed, limit);
    try {
      if (next.activeBatch) {
        const batch = next.activeBatch;
        next = applyBatch(next, await runHeartbeat(next, batch, { suppressNotifications: true }), batch);
        remaining -= 1;
        if (remaining <= 0) return next;
      }

      const elapsedAfter = Math.floor((nowMs - next.wallTimeMs) / heartbeatIntervalMs);
      const replay = Math.min(elapsedAfter, remaining);
      next = {
        ...next,
        wallTimeMs: next.wallTimeMs + (elapsedAfter - replay) * heartbeatIntervalMs,
      };
      for (let index = 0; index < replay; index++) {
        const batch = makeBatch(next);
        next = { ...next, activeBatch: batch };
        next = applyBatch(next, await runHeartbeat(next, batch, { suppressNotifications: true }), batch);
      }
      return next;
    } catch (error) {
      const failed = failBatch(next, error);
      return { ...failed, catchUpError: truncateError(error) };
    }
  }

  async function initializeCheckpoint() {
    const startedAtMs = now();
    const saved = loadCheckpoint(destination)
      ?? (destination === legacyStatePath ? null : loadCheckpoint(legacyStatePath));
    const migrated = saved ? migrateCheckpoint(saved, destination) : emptyCheckpoint(startedAtMs);
    const current = assertCheckpoint(migrated, destination, maxCheckpointBytes);
    const reconciled = reconcileActions(current);

    const initialParts = Object.fromEntries(modules.map(({ id, initialState }) => [id, initialState]));
    const loadedParts = Object.fromEntries(modules.map(({ id, initialState }) => [
      id, withDefaults(initialState, reconciled.snapshot.parts[id], `Body part ${id}`),
    ]));
    const highestPendingEffectiveAt = reconciled.pendingActionIds.length
      ? Math.max(...reconciled.pendingActionIds.map((id) => reconciled.actions[id].effectiveAt))
      : 0;
    const seeded = {
      ...reconciled,
      notifications: reconciled.notifications ?? [],
      lastEffectiveAt: Math.max(reconciled.lastEffectiveAt ?? 0, highestPendingEffectiveAt, 0),
      snapshot: {
        ...reconciled.snapshot,
        parts: { ...reconciled.snapshot.parts, ...loadedParts },
      },
    };

    const restored = await catchUp(seeded, startedAtMs, catchUpMinutes);
    const previousStartedAtMs = Number.isSafeInteger(saved?.startup?.startedAtMs)
      ? saved.startup.startedAtMs
      : null;
    const startup = {
      startedAtMs,
      previousStartedAtMs,
      sincePreviousStartMs: previousStartedAtMs === null ? null : Math.max(0, startedAtMs - previousStartedAtMs),
      hasSavedState: saved !== null,
      sinceCheckpointMs: saved ? Math.max(0, startedAtMs - saved.wallTimeMs) : null,
      caughtUpSeconds: restored.snapshot.simulatedSeconds - seeded.snapshot.simulatedSeconds,
      catchUpError: restored.catchUpError ?? null,
    };

    let snapshot = restored.snapshot;
    if (!restored.catchUpError) {
      const context = {
        ...startup,
        initialParts,
        resetOnStart: Object.fromEntries(modules.map(({ id, resetOnStart }) => [id, resetOnStart])),
      };
      for (const url of initializers) {
        const patches = await runScript(url, 'initialize', { snapshot, context });
        const updates = Object.fromEntries(Object.entries(patches).map(([id, part]) => [
          id, { ...snapshot.parts[id], ...part },
        ]));
        snapshot = { ...snapshot, parts: { ...snapshot.parts, ...updates } };
      }
    }
    return { ...restored, snapshot, startup };
  }

  function healthView() {
    const degraded = lastHeartbeat.consecutiveFailures > 0
      || (checkpoint.activeBatch?.attempts ?? 0) > 0;
    return {
      ok: !degraded,
      status: degraded ? 'degraded' : 'ok',
      port: getPort(),
      simulatedSeconds: checkpoint.snapshot.simulatedSeconds,
      wallTimeMs: checkpoint.wallTimeMs,
      pendingActions: checkpoint.pendingActionIds.length,
      notifications: checkpoint.notifications.length,
      heartbeat: {
        lastSuccessAtMs: lastHeartbeat.lastSuccessAtMs,
        lastErrorAtMs: lastHeartbeat.lastErrorAtMs,
        lastError: lastHeartbeat.lastError,
        consecutiveFailures: lastHeartbeat.consecutiveFailures,
        inFlight: checkpoint.activeBatch !== null,
      },
      batch: checkpoint.activeBatch
        ? {
          targetSimulatedSeconds: checkpoint.activeBatch.targetSimulatedSeconds,
          attempts: checkpoint.activeBatch.attempts,
        }
        : null,
    };
  }

  async function readJsonBody(request) {
    const type = String(request.headers['content-type'] ?? '');
    if (!/^application\/json\s*(;|$)/i.test(type)) {
      request.resume();
      const error = new Error('Expected application/json');
      error.statusCode = 415;
      throw error;
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      request.resume();
      const error = new Error('Body too large');
      error.statusCode = 413;
      throw error;
    }
    request.setEncoding('utf8');
    let contents = '';
    for await (const chunk of request) {
      contents += chunk;
      if (Buffer.byteLength(contents, 'utf8') > maxBodyBytes) {
        request.resume();
        const error = new Error('Body too large');
        error.statusCode = 413;
        throw error;
      }
    }
    try {
      return JSON.parse(contents);
    } catch {
      const error = new Error('Expected a JSON object');
      error.statusCode = 400;
      throw error;
    }
  }

  function checkRequest(request) {
    const portValue = getPort();
    const hostHeader = request.headers.host;
    const allowedHosts = new Set([
      `127.0.0.1:${portValue}`,
      `localhost:${portValue}`,
    ]);
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      return { statusCode: 403, body: { error: 'Unexpected Host header' } };
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.origin !== undefined) {
      const allowedOrigins = new Set([
        `http://127.0.0.1:${portValue}`,
        `http://localhost:${portValue}`,
      ]);
      if (!allowedOrigins.has(request.headers.origin)) {
        return { statusCode: 403, body: { error: 'Unexpected Origin' } };
      }
    }
    return null;
  }

  async function handleActionPost(request, response) {
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch (error) {
      return reply(response, error.statusCode ?? 400, { error: error.message });
    }
    const result = enqueue(payload);
    return reply(response, result.statusCode, result.body);
  }

  async function handleAckPost(request, response) {
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch (error) {
      return reply(response, error.statusCode ?? 400, { error: error.message });
    }
    if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id) {
      return reply(response, 400, { error: 'Expected a nonempty id' });
    }
    return reply(response, 200, ackNotification(payload.id));
  }

  async function handleRequest(request, response) {
    const denied = checkRequest(request);
    if (denied) {
      request.resume();
      return reply(response, denied.statusCode, denied.body);
    }
    if (!checkpoint) return reply(response, 503, { error: 'Body Gateway is starting', starting: true });

    let pathname;
    try {
      pathname = new URL(request.url, `http://${host}`).pathname;
    } catch {
      return reply(response, 400, { error: 'Invalid request URL' });
    }

    if (pathname === '/health') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, healthView());
    }
    if (pathname === '/state') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, checkpoint.snapshot);
    }
    if (pathname === '/capabilities') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, capabilitiesView());
    }
    if (pathname === '/notifications') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, checkpoint.notifications);
    }
    if (pathname === '/notifications/ack') {
      if (request.method !== 'POST') return methodNotAllowed(response, 'POST');
      return handleAckPost(request, response);
    }
    if (pathname === '/actions') {
      if (request.method !== 'POST') return methodNotAllowed(response, 'POST');
      return handleActionPost(request, response);
    }
    if (pathname.startsWith('/actions/')) {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      let id;
      try {
        id = decodeURIComponent(pathname.slice('/actions/'.length));
      } catch {
        return reply(response, 400, { error: 'Invalid action id encoding' });
      }
      const record = Object.hasOwn(checkpoint.actions, id) ? checkpoint.actions[id] : undefined;
      if (!record) return reply(response, 404, { error: 'Unknown action' });
      return reply(response, 200, record);
    }
    return reply(response, 404, { error: 'Unknown route' });
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(`Gateway failed to handle ${request.method} ${request.url}`, error);
      reply(response, 500, { error: 'Gateway failed to handle the request' });
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;

  async function heartbeatOnce({ force = false } = {}) {
    if (stopping) return { ran: false, failed: false };
    let warning;
    let failed = false;
    try {
      const nowMs = now();
      if (nowMs < checkpoint.wallTimeMs) {
        commit({ ...checkpoint, wallTimeMs: nowMs });
        if (!force) return { ran: false, failed: false };
      }
      if (!force && nowMs < checkpoint.wallTimeMs + heartbeatIntervalMs) {
        return { ran: false, failed: false };
      }

      let batch = checkpoint.activeBatch;
      if (!batch) {
        batch = makeBatch(checkpoint);
        commit({ ...checkpoint, activeBatch: batch });
      }
      warning = setTimeout(
        () => console.warn(`Heartbeat ${batch.targetSimulatedSeconds}s is still running after ${heartbeatIntervalMs}ms`),
        heartbeatIntervalMs,
      );

      const result = await runHeartbeat(checkpoint, batch);
      if (stopping) return { ran: true, failed: false };
      commit(applyBatch(checkpoint, result, batch));
      lastHeartbeat = {
        lastSuccessAtMs: now(),
        lastErrorAtMs: lastHeartbeat.lastErrorAtMs,
        lastError: null,
        consecutiveFailures: 0,
      };
    } catch (error) {
      failed = true;
      if (!stopping) {
        console.error('Heartbeat failed', error);
        if (checkpoint.activeBatch) {
          try {
            commit(failBatch(checkpoint, error));
          } catch (commitError) {
            console.error('Failed to persist the failed batch', commitError);
          }
        }
        lastHeartbeat = {
          ...lastHeartbeat,
          lastErrorAtMs: now(),
          lastError: truncateError(error),
          consecutiveFailures: lastHeartbeat.consecutiveFailures + 1,
        };
      }
    } finally {
      clearTimeout(warning);
    }
    return { ran: true, failed };
  }

  function tick() {
    if (heartbeatWork) return heartbeatWork;
    heartbeatWork = heartbeatOnce({ force: true }).finally(() => {
      heartbeatWork = null;
    });
    return heartbeatWork;
  }

  function scheduleHeartbeat(delay) {
    if (stopping) return;
    const wait = delay ?? Math.max(0, checkpoint.wallTimeMs + heartbeatIntervalMs - now());
    timer = setTimeout(() => {
      if (heartbeatWork) {
        scheduleHeartbeat(heartbeatIntervalMs);
        return;
      }
      heartbeatWork = heartbeatOnce()
        .then((outcome) => {
          scheduleHeartbeat(outcome.failed ? heartbeatIntervalMs : undefined);
          return outcome;
        })
        .finally(() => {
          heartbeatWork = null;
        });
    }, wait);
  }

  async function closeServer() {
    if (!server.listening) return;
    const closed = new Promise((resolvePromise) => server.close(resolvePromise));
    server.closeAllConnections();
    await closed;
  }

  async function stop() {
    stopping = true;
    clearTimeout(timer);
    for (const worker of activeWorkers) void worker.terminate();
    await Promise.allSettled([ready, heartbeatWork, closeServer()]);
  }

  async function boot() {
    try {
      modules = await finishScripts(moduleUrls.map(async (url) => ({
        url,
        ...await runScript(url, 'describe'),
      })));
    } catch (error) {
      throw new Error(`Failed to load body modules: ${formatError(error)}`, { cause: error });
    }
    const moduleIds = new Set(modules.map(({ id }) => id));
    if (moduleIds.size !== modules.length) throw new Error('Heartbeat script ids must be unique');
    actionHandlers = new Map();
    for (const { id, actionTypes = [] } of modules) {
      for (const type of actionTypes) {
        if (!actionHandlers.has(type)) actionHandlers.set(type, []);
        actionHandlers.get(type).push(id);
      }
    }
    helperModules = modules.filter(({ hasFunctions }) => hasFunctions).map(({ id, url }) => [id, url]);

    if (stopping) return null;
    const initial = await initializeCheckpoint();
    if (stopping) return null;

    server.listen(port, host);
    await once(server, 'listening');
    if (stopping) {
      await closeServer();
      return null;
    }

    commit(initial);
    const address = server.address();
    const info = {
      port: address.port,
      host,
      url: `http://${host}:${address.port}`,
      statePath: destination,
    };
    lastHeartbeat = {
      lastSuccessAtMs: now(),
      lastErrorAtMs: initial.startup?.catchUpError ? now() : null,
      lastError: initial.startup?.catchUpError ?? null,
      consecutiveFailures: initial.startup?.catchUpError ? 1 : 0,
    };
    console.log(`DSH Body Gateway listening at ${info.url}`);
    console.log(`Loaded ${modules.length} heartbeat script(s) and ran ${initializers.length} startup script(s)`);
    console.log(`Body startup ${JSON.stringify(checkpoint.startup)}`);
    if (autoTick) scheduleHeartbeat();
    return info;
  }

  const ready = boot().catch(async (error) => {
    await closeServer();
    if (!stopping) throw error;
    return null;
  });

  return {
    ready,
    stop,
    tick,
    submitAction(payload) {
      if (!checkpoint) throw new Error('Body Gateway is not ready');
      return enqueue(payload);
    },
    getState() {
      if (!checkpoint) throw new Error('Body Gateway is not ready');
      return structuredClone(checkpoint.snapshot);
    },
    getReceipt(id) {
      if (!checkpoint) throw new Error('Body Gateway is not ready');
      return Object.hasOwn(checkpoint.actions, id) ? structuredClone(checkpoint.actions[id]) : null;
    },
    getCapabilities() {
      if (!checkpoint) throw new Error('Body Gateway is not ready');
      return capabilitiesView();
    },
    getNotifications() {
      if (!checkpoint) throw new Error('Body Gateway is not ready');
      return structuredClone(checkpoint.notifications);
    },
    ackNotification(id) {
      if (!checkpoint) throw new Error('Body Gateway is not ready');
      return ackNotification(id);
    },
    get port() {
      return server.address()?.port ?? null;
    },
  };
}
