import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActionQueue } from './gateway/actions.js';
import { createCheckpointStore } from './gateway/checkpoint.js';
import { readManifest } from './gateway/config.js';
import { createBodyHttpServer, host } from './gateway/http.js';
import { createBodyRunner, formatError } from './gateway/runner.js';
import { createBodySimulation } from './gateway/simulation.js';

const defaultHeartbeatIntervalMs = 60_000;
const defaultPort = 3210;
const defaultMaxCheckpointBytes = 2 * 1024 * 1024;
const defaultMaxActionRecords = 2000;
const defaultActionRetentionMs = 30 * 24 * 60 * 60 * 1000;
const defaultMaxNotifications = 200;
const defaultManifestPath = fileURLToPath(new URL('./body-modules.json', import.meta.url));

function resolveDefaultPort() {
  const configured = process.env.DSH_BODY_PORT;
  if (configured === undefined || configured === '') return defaultPort;
  return Number(configured);
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
  requireBinding = false,
  defaultNsfw = false,
} = {}) {
  if (typeof requireBinding !== 'boolean') throw new TypeError('requireBinding must be a boolean');
  if (typeof defaultNsfw !== 'boolean') throw new TypeError('defaultNsfw must be a boolean');
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
  const absoluteManifestPath = resolve(manifestPath);
  const manifest = readManifest(absoluteManifestPath);
  const destination = resolve(statePath);
  const store = createCheckpointStore({
    statePath: destination,
    legacyStatePath: join(dirname(absoluteManifestPath), 'body-state.json'),
    maxCheckpointBytes,
    maxActionRecords,
    actionRetentionMs,
    now,
  });
  const activeNsfw = (checkpoint) => Boolean(checkpoint?.nsfw ?? defaultNsfw);
  const actions = createActionQueue({
    store,
    now,
    heartbeatIntervalMs,
    requireBinding,
    isNsfwEnabled: activeNsfw,
  });
  const runner = createBodyRunner(manifest);
  let stopping = false;
  let shutdown;
  const simulation = createBodySimulation({
    store,
    actions,
    runner,
    now,
    autoTick,
    heartbeatIntervalMs,
    catchUpMinutes: manifest.catchUpMinutes,
    maxNotifications,
    isStopping: () => stopping,
    requireBinding,
    getNsfw: activeNsfw,
  });
  async function bindSession(sessionId) {
    requireReady();
    if (stopping) throw new Error('Body Gateway is stopping');
    const updated = await simulation.bind(sessionId);
    return {
      ok: true,
      active: updated.active,
      dormant: simulation.isDormant(updated),
      boundSessionId: updated.boundSessionId ?? null,
      nsfw: activeNsfw(updated),
    };
  }
  async function unbindSession() {
    requireReady();
    if (stopping) throw new Error('Body Gateway is stopping');
    const updated = await simulation.unbind();
    return {
      ok: true,
      active: updated.active,
      dormant: simulation.isDormant(updated),
      boundSessionId: updated.boundSessionId ?? null,
      nsfw: activeNsfw(updated),
    };
  }
  const http = createBodyHttpServer({
    store,
    getHealth: simulation.health,
    getCapabilities: actions.capabilities,
    enqueue,
    ackNotification,
    bindSession,
    unbindSession,
  });

  function requireReady() {
    if (!store.current) throw new Error('Body Gateway is not ready');
    return store.current;
  }

  function enqueue(payload) {
    if (stopping) return { statusCode: 503, body: { error: 'Body Gateway is stopping' } };
    return actions.enqueue(payload);
  }

  function ackNotification(id) {
    requireReady();
    if (stopping) throw new Error('Body Gateway is stopping');
    return store.ackNotification(id);
  }

  async function boot() {
    const saved = store.load();
    let modules = [];
    if (saved?.active !== false) {
      try {
        modules = await runner.describe({
          profile: saved?.profile ?? null,
          parameters: saved?.parameters ?? null,
          nsfw: activeNsfw(saved),
        });
      } catch (error) {
        throw new Error(`Failed to load body modules: ${formatError(error)}`, { cause: error });
      }
      actions.register(modules);
    }

    if (stopping) return null;
    const initial = await simulation.restore(saved, modules, manifest.initializers);
    if (stopping) return null;

    const address = await http.listen(port);
    if (stopping) {
      await http.close();
      return null;
    }
    store.commit(initial);
    const info = {
      port: address.port,
      host,
      url: `http://${host}:${address.port}`,
      statePath: destination,
      active: initial.active,
    };
    console.log(`DSH Body Gateway listening at ${info.url}`);
    if (!initial.active) {
      console.log('Body is paused (active=false); no body scripts were loaded');
    } else if (simulation.isDormant(initial)) {
      console.log(`Loaded ${modules.length} heartbeat script(s); body is dormant until bound to a session`);
    } else {
      console.log(`Loaded ${modules.length} heartbeat script(s) and ${manifest.initializers.length} startup script(s) configured`);
    }
    console.log(`Body startup ${JSON.stringify(initial.startup)}`);
    simulation.start();
    return info;
  }

  const ready = boot().catch(async (error) => {
    await Promise.allSettled([http.close(), runner.close()]);
    if (!stopping) throw error;
    return null;
  });

  function stop() {
    stopping = true;
    shutdown ??= Promise.allSettled([ready, simulation.stop(), http.close(), runner.close()])
      .then(() => undefined);
    return shutdown;
  }

  return {
    ready,
    stop,
    tick: simulation.tick,
    submitAction(payload) {
      requireReady();
      return enqueue(payload);
    },
    getState() {
      return structuredClone(requireReady().snapshot);
    },
    getReceipt(id) {
      const { actions } = requireReady();
      return Object.hasOwn(actions, id) ? structuredClone(actions[id]) : null;
    },
    getCapabilities() {
      requireReady();
      return actions.capabilities();
    },
    getNotifications() {
      return structuredClone(requireReady().notifications);
    },
    ackNotification,
    bindSession,
    unbindSession,
    getHealth() {
      requireReady();
      return simulation.health(http.port);
    },
    isDormant() {
      return simulation.isDormant(requireReady());
    },
    getNsfw() {
      return activeNsfw(store.current);
    },
    getBoundSessionId() {
      return store.current?.boundSessionId ?? null;
    },
    getStatePath() {
      return destination;
    },
    get port() { return http.port; },
  };
}
