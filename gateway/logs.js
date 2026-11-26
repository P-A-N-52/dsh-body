import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { isPlainObject as isRecord } from '../json-safe.js';

export const STATE_HISTORY_RELATIVE = join('logs', 'state-history.jsonl');
export const NOTIFICATION_HISTORY_RELATIVE = join('logs', 'notification-history.json');

const defaultMaxStateEntries = 500;
const defaultMaxNotificationEntries = 500;

export function jsonValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!jsonValuesEqual(left[index], right[index])) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !jsonValuesEqual(left[key], right[key])) return false;
  }
  return true;
}

function diffParts(prevParts, nextParts) {
  const changed = {};
  for (const [partId, nextPart] of Object.entries(nextParts ?? {})) {
    const prevPart = prevParts && Object.hasOwn(prevParts, partId) ? prevParts[partId] : undefined;
    if (!isRecord(prevPart) || !isRecord(nextPart)) {
      if (!jsonValuesEqual(prevPart, nextPart)) {
        changed[partId] = structuredClone(nextPart);
      }
      continue;
    }
    const partDiff = {};
    for (const [field, value] of Object.entries(nextPart)) {
      if (!Object.hasOwn(prevPart, field) || !jsonValuesEqual(prevPart[field], value)) {
        partDiff[field] = structuredClone(value);
      }
    }
    for (const field of Object.keys(prevPart)) {
      if (!Object.hasOwn(nextPart, field)) {
        partDiff[field] = null;
      }
    }
    if (Object.keys(partDiff).length > 0) {
      changed[partId] = partDiff;
    }
  }
  for (const partId of Object.keys(prevParts ?? {})) {
    if (!nextParts || !Object.hasOwn(nextParts, partId)) {
      changed[partId] = null;
    }
  }
  return changed;
}

function writeAtomic(filePath, contents) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(tmpPath, contents, 'utf8');
  renameSync(tmpPath, filePath);
}

function emptyNotificationHistory() {
  return { schemaVersion: 1, entries: [] };
}

function normalizeLimit(limit, fallback) {
  if (limit === undefined || limit === null) return fallback;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit must be a positive integer');
  }
  return limit;
}

export function createBodyLogStore({
  statePath,
  now = Date.now,
  maxStateEntries = defaultMaxStateEntries,
  maxNotificationEntries = defaultMaxNotificationEntries,
}) {
  if (typeof statePath !== 'string' || !statePath) {
    throw new TypeError('statePath is required');
  }
  if (!Number.isInteger(maxStateEntries) || maxStateEntries < 1) {
    throw new TypeError('maxStateEntries must be a positive integer');
  }
  if (!Number.isInteger(maxNotificationEntries) || maxNotificationEntries < 1) {
    throw new TypeError('maxNotificationEntries must be a positive integer');
  }

  const bodyDir = dirname(resolve(statePath));
  const stateHistoryPath = join(bodyDir, STATE_HISTORY_RELATIVE);
  const notificationHistoryPath = join(bodyDir, NOTIFICATION_HISTORY_RELATIVE);

  let baselineSnapshot = null;
  let stateLineCount = null;
  let notificationHistory = null;
  const notificationById = new Map();
  const notificationIdByMessageId = new Map();

  function seedBaseline(snapshot) {
    baselineSnapshot = isRecord(snapshot) ? structuredClone(snapshot) : null;
  }

  function ensureStateLineCount() {
    if (stateLineCount !== null) return;
    if (!existsSync(stateHistoryPath)) {
      stateLineCount = 0;
      return;
    }
    const raw = readFileSync(stateHistoryPath, 'utf8');
    stateLineCount = raw ? raw.split('\n').filter(Boolean).length : 0;
  }

  function trimStateHistoryIfNeeded() {
    if (stateLineCount < maxStateEntries * 2) return;
    const raw = readFileSync(stateHistoryPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const trimmed = lines.slice(-maxStateEntries);
    writeAtomic(stateHistoryPath, trimmed.length ? `${trimmed.join('\n')}\n` : '');
    stateLineCount = trimmed.length;
  }

  function recordStateCommit(checkpoint, { reason = 'heartbeat', actionIds = [] } = {}) {
    const snapshot = checkpoint?.snapshot;
    if (!isRecord(snapshot) || !isRecord(snapshot.parts)) return false;

    const isInitial = baselineSnapshot === null;
    const changedParts = isInitial
      ? structuredClone(snapshot.parts)
      : diffParts(baselineSnapshot.parts, snapshot.parts);
    const hasPartChanges = Object.keys(changedParts).length > 0;
    const hasActions = Array.isArray(actionIds) && actionIds.length > 0;

    if (!isInitial && !hasPartChanges && !hasActions) {
      baselineSnapshot = structuredClone(snapshot);
      return false;
    }

    const entry = {
      timestampWallTimeMs: now(),
      reason,
      simulatedSeconds: snapshot.simulatedSeconds,
      wallTimeMs: checkpoint.wallTimeMs,
      actionIds: Array.isArray(actionIds) ? [...actionIds] : [],
      changedParts,
    };

    ensureStateLineCount();
    mkdirSync(dirname(stateHistoryPath), { recursive: true });
    appendFileSync(stateHistoryPath, `${JSON.stringify(entry)}\n`, 'utf8');
    stateLineCount += 1;
    trimStateHistoryIfNeeded();
    baselineSnapshot = structuredClone(snapshot);
    return true;
  }

  function rebuildNotificationIndices() {
    notificationById.clear();
    notificationIdByMessageId.clear();
    for (const entry of notificationHistory.entries) {
      notificationById.set(entry.id, entry);
      if (typeof entry.messageId === 'string' && entry.messageId) {
        notificationIdByMessageId.set(entry.messageId, entry.id);
      }
    }
  }

  function ensureNotificationHistoryLoaded() {
    if (notificationHistory !== null) return;
    if (!existsSync(notificationHistoryPath)) {
      notificationHistory = emptyNotificationHistory();
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(notificationHistoryPath, 'utf8'));
      const entries = Array.isArray(parsed?.entries)
        ? parsed.entries.filter((entry) => isRecord(entry) && typeof entry.id === 'string' && entry.id)
        : [];
      notificationHistory = {
        schemaVersion: 1,
        entries: entries.slice(-maxNotificationEntries),
      };
    } catch {
      notificationHistory = emptyNotificationHistory();
    }
    rebuildNotificationIndices();
  }

  function flushNotificationHistory() {
    if (notificationHistory.entries.length > maxNotificationEntries) {
      notificationHistory.entries = notificationHistory.entries.slice(-maxNotificationEntries);
      rebuildNotificationIndices();
    }
    writeAtomic(notificationHistoryPath, `${JSON.stringify(notificationHistory, null, 2)}\n`);
  }

  function upsertNotificationEntry(source) {
    let entry = notificationById.get(source.id);
    if (!entry) {
      entry = {
        id: source.id,
        mode: source.mode === 'wake' || source.mode === 'context' ? source.mode : null,
        sessionId: typeof source.sessionId === 'string' ? source.sessionId : null,
        text: typeof source.text === 'string' ? source.text : null,
        createdAtSimulatedSeconds: Number.isSafeInteger(source.createdAtSimulatedSeconds)
          ? source.createdAtSimulatedSeconds
          : null,
        createdAtWallTimeMs: Number.isSafeInteger(source.createdAtWallTimeMs)
          ? source.createdAtWallTimeMs
          : null,
        status: 'queued',
        messageId: null,
        ackedAtWallTimeMs: null,
        insertedAtWallTimeMs: null,
      };
      notificationHistory.entries.push(entry);
      notificationById.set(entry.id, entry);
    } else {
      if (entry.mode === null && (source.mode === 'wake' || source.mode === 'context')) {
        entry.mode = source.mode;
      }
      if (entry.sessionId === null && typeof source.sessionId === 'string') {
        entry.sessionId = source.sessionId;
      }
      if (entry.text === null && typeof source.text === 'string') {
        entry.text = source.text;
      }
      if (entry.createdAtSimulatedSeconds === null && Number.isSafeInteger(source.createdAtSimulatedSeconds)) {
        entry.createdAtSimulatedSeconds = source.createdAtSimulatedSeconds;
      }
      if (entry.createdAtWallTimeMs === null && Number.isSafeInteger(source.createdAtWallTimeMs)) {
        entry.createdAtWallTimeMs = source.createdAtWallTimeMs;
      }
    }
    return entry;
  }

  function recordNotificationsQueued(notifications) {
    if (!Array.isArray(notifications) || notifications.length === 0) return;
    ensureNotificationHistoryLoaded();
    for (const notification of notifications) {
      if (!isRecord(notification) || typeof notification.id !== 'string' || !notification.id) continue;
      upsertNotificationEntry(notification);
    }
    flushNotificationHistory();
  }

  function recordNotificationAck(
    notificationSnapshot,
    { messageId = null, ackedAtWallTimeMs = now(), insertedAtWallTimeMs = null } = {},
  ) {
    if (!isRecord(notificationSnapshot) || typeof notificationSnapshot.id !== 'string' || !notificationSnapshot.id) {
      return null;
    }
    ensureNotificationHistoryLoaded();
    const entry = upsertNotificationEntry(notificationSnapshot);
    if (typeof messageId === 'string' && messageId) {
      entry.messageId = messageId;
      notificationIdByMessageId.set(messageId, entry.id);
    }
    if (entry.ackedAtWallTimeMs === null && Number.isSafeInteger(ackedAtWallTimeMs) && ackedAtWallTimeMs >= 0) {
      entry.ackedAtWallTimeMs = ackedAtWallTimeMs;
    }
    if (
      entry.insertedAtWallTimeMs === null
      && Number.isSafeInteger(insertedAtWallTimeMs)
      && insertedAtWallTimeMs >= 0
    ) {
      entry.insertedAtWallTimeMs = insertedAtWallTimeMs;
    }
    entry.status = entry.insertedAtWallTimeMs !== null ? 'inserted' : 'acked';
    flushNotificationHistory();
    return structuredClone(entry);
  }

  function recordNotificationInserted({
    messageId = null,
    notificationId = null,
    insertedAtWallTimeMs = now(),
  } = {}) {
    ensureNotificationHistoryLoaded();
    const resolvedNotificationId = (typeof notificationId === 'string' && notificationId)
      ? notificationId
      : (typeof messageId === 'string' && messageId ? notificationIdByMessageId.get(messageId) ?? null : null);

    let entry = resolvedNotificationId ? notificationById.get(resolvedNotificationId) ?? null : null;
    if (!entry && typeof messageId === 'string' && messageId) {
      for (let index = notificationHistory.entries.length - 1; index >= 0; index--) {
        if (notificationHistory.entries[index].messageId === messageId) {
          entry = notificationHistory.entries[index];
          notificationIdByMessageId.set(messageId, entry.id);
          break;
        }
      }
    }
    if (!entry) {
      return {
        matched: false,
        notificationId: resolvedNotificationId,
        messageId: typeof messageId === 'string' && messageId ? messageId : null,
        insertedAtWallTimeMs: null,
      };
    }

    const alreadyInserted = entry.status === 'inserted' && entry.insertedAtWallTimeMs !== null;
    if (!alreadyInserted) {
      entry.insertedAtWallTimeMs = Number.isSafeInteger(insertedAtWallTimeMs) && insertedAtWallTimeMs >= 0
        ? insertedAtWallTimeMs
        : now();
      entry.status = 'inserted';
      flushNotificationHistory();
    }
    return {
      matched: true,
      alreadyInserted,
      notificationId: entry.id,
      messageId: entry.messageId,
      insertedAtWallTimeMs: entry.insertedAtWallTimeMs,
    };
  }

  function getStateHistory({ limit } = {}) {
    const resolvedLimit = normalizeLimit(limit, maxStateEntries);
    if (!existsSync(stateHistoryPath)) return [];
    const lines = readFileSync(stateHistoryPath, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-resolvedLimit).map((line) => JSON.parse(line));
  }

  function getNotificationHistory({ limit } = {}) {
    const resolvedLimit = normalizeLimit(limit, maxNotificationEntries);
    ensureNotificationHistoryLoaded();
    return structuredClone(notificationHistory.entries.slice(-resolvedLimit));
  }

  return {
    stateHistoryPath,
    notificationHistoryPath,
    seedBaseline,
    recordStateCommit,
    recordNotificationsQueued,
    recordNotificationAck,
    recordNotificationInserted,
    getStateHistory,
    getNotificationHistory,
  };
}
