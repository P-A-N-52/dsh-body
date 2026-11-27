import { randomUUID } from 'node:crypto';
import { isPlainObject as isRecord } from '../json-safe.js';
import { defaultClimate, legacyAirTemperature } from '../organs/body-inputs/climate-state.js';
import { setAction } from './actions.js';
import { emptyCheckpoint } from './checkpoint.js';
import { heartbeatSeconds } from './config.js';
import { applyOperations, createFieldRegistry } from './operations.js';
import { formatError } from './runner.js';

function truncateError(error) {
  return formatError(error).slice(0, 500);
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

export function createBodySimulation({
  store,
  actions,
  runner,
  logs = null,
  now,
  autoTick,
  heartbeatIntervalMs,
  catchUpMinutes,
  maxNotifications,
  isStopping,
  requireBinding = false,
  getNsfw = (checkpoint) => Boolean(checkpoint?.nsfw),
}) {
  const isDormant = (checkpoint = store.current) => Boolean(requireBinding && !checkpoint?.boundSessionId);
  let heartbeatWork;
  let timer;
  let registry = new Map();
  // The last successful round's values, separate from startup patches and worker lifetime.
  let publishedParts = {};
  let fatalFailure = null;
  let lastHeartbeat = {
    lastSuccessAtMs: null,
    lastErrorAtMs: null,
    lastError: null,
    consecutiveFailures: 0,
  };

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

  async function runHeartbeat(current, batch) {
    const suppressNotifications = batch.suppressNotifications === true;
    const { parts, notifications, adds, transfers } = await runner.heartbeat({
      snapshot: current.snapshot,
      actions: batch.actionIds.map((id) => current.actions[id].action),
      dt: heartbeatSeconds,
      simulatedSeconds: batch.targetSimulatedSeconds,
      wallTimeMs: batch.targetWallTimeMs,
      suppressNotifications,
      boundSessionId: current.boundSessionId ?? null,
      publishedParts,
    });
    const nextParts = applyOperations({
      registry,
      snapshotParts: current.snapshot.parts,
      writes: parts,
      adds,
      transfers,
    });
    return {
      publishedPartIds: Object.keys(parts),
      snapshot: {
        simulatedSeconds: batch.targetSimulatedSeconds,
        parts: { ...current.snapshot.parts, ...nextParts },
      },
      notifications: suppressNotifications ? [] : notifications.map((notification) => ({
        id: randomUUID(),
        ...notification,
        createdAtSimulatedSeconds: batch.targetSimulatedSeconds,
        createdAtWallTimeMs: batch.targetWallTimeMs,
      })),
    };
  }

  function recordPublications({ publishedPartIds, snapshot }) {
    publishedParts = Object.fromEntries(publishedPartIds.map((id) => [id, snapshot.parts[id]]));
  }

  function recordFatal(error, batchTargetSimulatedSeconds) {
    const atMs = now();
    const { module = null, operation = null, partId = null, field = null, target = null, reason = null } = error.fatal;
    fatalFailure = {
      module,
      operation,
      partId,
      field,
      target,
      reason,
      message: truncateError(error),
      atWallTimeMs: atMs,
      batchTargetSimulatedSeconds,
    };
    lastHeartbeat = { ...lastHeartbeat, lastErrorAtMs: atMs, lastError: truncateError(error) };
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
    const appliedIds = new Set(batch.actionIds);
    const pendingActionIds = current.pendingActionIds.filter((id) => !appliedIds.has(id));
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
    return {
      ...current,
      wallTimeMs: Math.min(batch.targetWallTimeMs, appliedAtWallTimeMs),
      snapshot: result.snapshot,
      pendingActionIds,
      actions,
      activeBatch: null,
      notifications,
    };
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

  async function catchUp(current, nowMs, limit) {
    if (nowMs < current.wallTimeMs) return { checkpoint: { ...current, wallTimeMs: nowMs }, catchUpError: null };
    const elapsed = Math.floor((nowMs - current.wallTimeMs) / heartbeatIntervalMs);
    if (elapsed === 0) return { checkpoint: current, catchUpError: null };

    let next = current;
    let remaining = Math.min(elapsed, limit);
    try {
      if (next.activeBatch) {
        const batch = { ...next.activeBatch, suppressNotifications: true };
        next = { ...next, activeBatch: batch };
        const result = await runHeartbeat(next, batch);
        next = store.prune(applyBatch(next, result, batch));
        recordPublications(result);
        remaining -= 1;
        if (remaining <= 0) {
          const elapsedAfter = Math.floor((nowMs - next.wallTimeMs) / heartbeatIntervalMs);
          return {
            checkpoint: {
              ...next,
              wallTimeMs: next.wallTimeMs + Math.max(0, elapsedAfter) * heartbeatIntervalMs,
            },
            catchUpError: null,
          };
        }
      }

      const elapsedAfter = Math.floor((nowMs - next.wallTimeMs) / heartbeatIntervalMs);
      const replay = Math.min(elapsedAfter, remaining);
      next = {
        ...next,
        wallTimeMs: next.wallTimeMs + (elapsedAfter - replay) * heartbeatIntervalMs,
      };
      for (let index = 0; index < replay; index++) {
        const batch = { ...makeBatch(next), suppressNotifications: true };
        next = { ...next, activeBatch: batch };
        const result = await runHeartbeat(next, batch);
        next = store.prune(applyBatch(next, result, batch));
        recordPublications(result);
      }
      return { checkpoint: next, catchUpError: null };
    } catch (error) {
      if (error?.fatal) {
        recordFatal(error, next.activeBatch?.targetSimulatedSeconds ?? null);
        return { checkpoint: { ...next, activeBatch: null }, catchUpError: truncateError(error) };
      }
      return { checkpoint: failBatch(next, error), catchUpError: truncateError(error) };
    }
  }

  function startupRecord({ startedAtMs, saved, active, resumedFromPause, caughtUpSeconds, catchUpError }) {
    const previousStartedAtMs = Number.isSafeInteger(saved?.startup?.startedAtMs)
      ? saved.startup.startedAtMs
      : null;
    return {
      startedAtMs,
      previousStartedAtMs,
      sincePreviousStartMs: previousStartedAtMs === null ? null : Math.max(0, startedAtMs - previousStartedAtMs),
      hasSavedState: saved !== null,
      sinceCheckpointMs: resumedFromPause
        ? 0
        : saved ? Math.max(0, startedAtMs - saved.wallTimeMs) : null,
      caughtUpSeconds,
      catchUpError,
      active,
      resumedFromPause,
    };
  }

  async function restore(saved, modules, initializers) {
    const startedAtMs = now();
    registry = createFieldRegistry(modules);
    publishedParts = {};
    const current = saved ?? emptyCheckpoint(startedAtMs);
    const { active } = current;
    const resumedFromPause = active && saved?.startup?.active === false;
    if (!active) {
      const { catchUpError: _ignored, ...cleanCurrent } = current;
      return {
        ...cleanCurrent,
        startup: startupRecord({
          startedAtMs,
          saved,
          active: false,
          resumedFromPause: false,
          caughtUpSeconds: 0,
          catchUpError: null,
        }),
      };
    }

    const { catchUpError: _ignored, ...reconciled } = actions.reconcile(current);
    const initialParts = Object.fromEntries(modules.map(({ id, initialState }) => [id, initialState]));
    const loadedParts = Object.fromEntries(modules.map(({ id, initialState }) => [
      id, withDefaults(initialState, reconciled.snapshot.parts[id], `Body part ${id}`),
    ]));
    let climateTemperatureMigration = null;
    if (saved !== null) {
      const savedClimate = saved.snapshot.parts.climate ?? {};
      const savedClothing = saved.snapshot.parts.clothing ?? {};
      if (Object.hasOwn(initialParts.climate ?? {}, 'airTemperatureC') && !Object.hasOwn(savedClimate, 'airTemperatureC')) {
        const { airTemperatureC, conflict } = legacyAirTemperature(reconciled.parameters);
        loadedParts.climate.airTemperatureC = airTemperatureC;
        climateTemperatureMigration = conflict;
      }
      if (registry.get('climate')?.has('relativeHumidityPct') && !Object.hasOwn(savedClimate, 'relativeHumidityPct')) {
        loadedParts.climate.relativeHumidityPct = defaultClimate.relativeHumidityPct;
      }
      if (registry.get('clothing')?.has('wornLayerIds') && !Object.hasOwn(savedClothing, 'wornLayerIds')) {
        loadedParts.clothing.wornLayerIds = [];
      }
    }
    const thermo = loadedParts.thermoregulation;
    if (Object.hasOwn(initialParts.thermoregulation ?? {}, 'effectiveSetpointC')) {
      thermo.feverSetpointOffsetC = 0;
      thermo.effectiveSetpointC = Number.isFinite(thermo.setpointC)
        ? thermo.setpointC : initialParts.thermoregulation.setpointC;
    }
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

    const dormantOnBoot = isDormant(seeded);
    const { checkpoint: restored, catchUpError } = (resumedFromPause || dormantOnBoot)
      ? {
        checkpoint: {
          ...seeded,
          wallTimeMs: startedAtMs,
          activeBatch: seeded.activeBatch
            ? { ...seeded.activeBatch, targetWallTimeMs: startedAtMs + heartbeatIntervalMs }
            : null,
        },
        catchUpError: null,
      }
      : await catchUp(seeded, startedAtMs, catchUpMinutes);

    const startup = startupRecord({
      startedAtMs,
      saved,
      active: true,
      resumedFromPause,
      caughtUpSeconds: restored.snapshot.simulatedSeconds - seeded.snapshot.simulatedSeconds,
      catchUpError,
    });

    let snapshot = restored.snapshot;
    if (!catchUpError && !restored.activeBatch) {
      const context = {
        ...startup,
        initialParts,
        resetOnStart: Object.fromEntries(modules.map(({ id, resetOnStart }) => [id, resetOnStart])),
      };
      for (const url of initializers) {
        const patches = await runner.initialize(url, snapshot, context);
        const updates = Object.fromEntries(Object.entries(patches).map(([id, part]) => [
          id, { ...snapshot.parts[id], ...part },
        ]));
        snapshot = { ...snapshot, parts: { ...snapshot.parts, ...updates } };
      }
    }
    return {
      ...restored,
      snapshot,
      startup: climateTemperatureMigration ? { ...startup, climateTemperatureMigration } : startup,
    };
  }

  function health(port) {
    const checkpoint = store.current;
    const degraded = lastHeartbeat.consecutiveFailures > 0
      || (checkpoint.activeBatch?.attempts ?? 0) > 0;
    const status = fatalFailure ? 'fatal' : degraded ? 'degraded' : 'ok';
    return {
      ok: status === 'ok',
      status,
      active: checkpoint.active,
      dormant: isDormant(checkpoint),
      boundSessionId: checkpoint.boundSessionId ?? null,
      nsfw: Boolean(getNsfw(checkpoint)),
      port,
      simulatedSeconds: checkpoint.snapshot.simulatedSeconds,
      wallTimeMs: checkpoint.wallTimeMs,
      pendingActions: checkpoint.pendingActionIds.length,
      notifications: checkpoint.notifications.length,
      fatal: fatalFailure,
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

  async function heartbeatOnce({ force = false } = {}) {
    if (isStopping() || !store.current) return { ran: false, failed: false };
    if (!store.current.active) return { ran: false, failed: false, paused: true };
    if (isDormant(store.current)) return { ran: false, failed: false, dormant: true };
    if (fatalFailure) return { ran: false, failed: true, fatal: true };
    let warning;
    let failed = false;
    try {
      const nowMs = now();
      if (nowMs < store.current.wallTimeMs) {
        store.commit({ ...store.current, wallTimeMs: nowMs });
        if (!force) return { ran: false, failed: false };
      }
      if (!force && nowMs < store.current.wallTimeMs + heartbeatIntervalMs) {
        return { ran: false, failed: false };
      }

      let batch = store.current.activeBatch;
      if (!batch) {
        batch = makeBatch(store.current);
        store.commit({ ...store.current, activeBatch: batch });
      }
      warning = setTimeout(
        () => console.warn(`Heartbeat ${batch.targetSimulatedSeconds}s is still running after ${heartbeatIntervalMs}ms`),
        heartbeatIntervalMs,
      );

      const result = await runHeartbeat(store.current, batch);
      if (isStopping()) return { ran: true, failed: false };
      store.commit(applyBatch(store.current, result, batch));
      recordPublications(result);
      logs?.recordStateCommit(store.current, { reason: 'heartbeat', actionIds: batch.actionIds });
      logs?.recordNotificationsQueued(result.notifications);
      lastHeartbeat = {
        lastSuccessAtMs: now(),
        lastErrorAtMs: lastHeartbeat.lastErrorAtMs,
        lastError: null,
        consecutiveFailures: 0,
      };
    } catch (error) {
      failed = true;
      if (!isStopping()) {
        console.error('Heartbeat failed', error);
        if (error?.fatal) {
          recordFatal(error, store.current.activeBatch?.targetSimulatedSeconds ?? null);
          try {
            if (store.current.activeBatch) {
              store.commit({ ...store.current, activeBatch: null });
            }
          } catch (commitError) {
            console.error('Failed to persist the state after a fatal operation', commitError);
          }
        } else {
          if (store.current.activeBatch) {
            try {
              store.commit(failBatch(store.current, error));
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
    if (isStopping() || fatalFailure) return;
    const wait = delay ?? Math.max(0, store.current.wallTimeMs + heartbeatIntervalMs - now());
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

  function start() {
    const checkpoint = store.current;
    if (!checkpoint.active || isDormant(checkpoint) || fatalFailure) return;
    const lastError = checkpoint.startup.catchUpError;
    lastHeartbeat = {
      lastSuccessAtMs: lastError ? null : now(),
      lastErrorAtMs: lastError ? now() : null,
      lastError,
      consecutiveFailures: lastError ? 1 : 0,
    };
    if (autoTick) scheduleHeartbeat();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
    return heartbeatWork;
  }

  async function bind(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new TypeError('sessionId must be a nonempty string');
    }
    const normalized = sessionId.trim();
    const pendingWork = stop();
    if (pendingWork) await pendingWork.catch(() => undefined);
    const current = store.current;
    if (!current) throw new Error('Body Gateway is not ready');
    const wasDormant = isDormant(current);
    if (current.boundSessionId === normalized) {
      start();
      return current;
    }
    if (current.boundSessionId && current.boundSessionId !== normalized) {
      start();
      const error = new Error('Body Gateway is already bound to another session');
      error.statusCode = 409;
      throw error;
    }
    const nowMs = now();
    const next = {
      ...current,
      boundSessionId: normalized,
      ...(wasDormant && current.active
        ? {
          wallTimeMs: nowMs,
          activeBatch: current.activeBatch
            ? { ...current.activeBatch, targetWallTimeMs: nowMs + heartbeatIntervalMs }
            : null,
        }
        : {}),
    };
    store.commit(next);
    start();
    return next;
  }

  async function unbind(expectedSessionId = null) {
    let expected = null;
    if (expectedSessionId !== null && expectedSessionId !== undefined) {
      if (typeof expectedSessionId !== 'string' || !expectedSessionId.trim()) {
        throw new TypeError('expectedSessionId must be a nonempty string');
      }
      expected = expectedSessionId.trim();
    }
    const pendingWork = stop();
    if (pendingWork) await pendingWork.catch(() => undefined);
    const current = store.current;
    if (!current) throw new Error('Body Gateway is not ready');
    if (!current.boundSessionId) return current;
    if (expected !== null && current.boundSessionId !== expected) {
      start();
      const error = new Error('Body Gateway is bound to a different session');
      error.statusCode = 409;
      throw error;
    }
    const unboundSessionId = current.boundSessionId;
    const remainingNotifications = Array.isArray(current.notifications)
      ? current.notifications.filter((notification) => notification?.sessionId !== unboundSessionId)
      : [];
    const next = {
      ...current,
      boundSessionId: null,
      notifications: remainingNotifications,
    };
    store.commit(next);
    return next;
  }

  return { restore, health, start, stop, tick, bind, unbind, isDormant };
}
