import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_FILE = 'bodies.json';
const DISALLOWED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidBodyId(id) {
  return typeof id === 'string' && id !== '' && !DISALLOWED_KEYS.has(id) && !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..';
}

function isValidPort(value) {
  return Number.isInteger(value) && value >= 0 && value <= 65535;
}

/**
 * 读取多身体配置。bodies.json 不存在时返回 null，沿用单身体配置。
 */
export function readBodiesConfig(statePath) {
  if (typeof statePath !== 'string' || !statePath) return null;
  const file = join(dirname(resolve(statePath)), DEFAULT_FILE);
  if (!existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn('[dsh-body] 无法解析 bodies.json，回退单身体模式', error instanceof Error ? error.message : String(error));
    return null;
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.bodies)) return null;
  const ids = Object.keys(parsed.bodies).filter((id) => isValidBodyId(id) && isPlainRecord(parsed.bodies[id]));
  if (ids.length === 0) return null;
  const defaultId = typeof parsed.default === 'string' && ids.includes(parsed.default) ? parsed.default : ids[0];
  const sessions = {};
  if (isPlainRecord(parsed.sessions)) {
    for (const [pattern, targetId] of Object.entries(parsed.sessions)) {
      if (pattern && !DISALLOWED_KEYS.has(pattern) && typeof targetId === 'string' && ids.includes(targetId)) {
        sessions[pattern] = targetId;
      }
    }
  }
  return { file, defaultId, ids, bodies: parsed.bodies, sessions };
}

/**
 * 统一解析所有身体挂载规格，不区分主副身体；defaultId 仅作未映射会话的默认路由目标。
 */
export function resolveBodySpecs({
  resolvedStatePath,
  resolvedPort,
  manifestPath,
  nsfw,
}) {
  const bodiesConfig = readBodiesConfig(resolvedStatePath);
  if (!bodiesConfig) {
    return {
      defaultId: 'main',
      sessions: {},
      specs: [{
        id: 'main',
        statePath: resolvedStatePath,
        port: resolvedPort,
        manifestPath,
        nsfw: Boolean(nsfw),
      }],
    };
  }

  const baseDir = dirname(resolve(resolvedStatePath));
  const basePort = Number.isInteger(resolvedPort) && resolvedPort > 0 ? resolvedPort : 3210;
  let fallbackIndex = 1;
  const specs = bodiesConfig.ids.map((id) => {
    const spec = bodiesConfig.bodies[id];
    const bodyStatePath = typeof spec.statePath === 'string' && spec.statePath !== ''
      ? spec.statePath
      : (id === bodiesConfig.defaultId
        ? resolvedStatePath
        : join(baseDir, 'bodies', id, 'body-state.json'));

    let bodyPort;
    if (isValidPort(spec.port)) {
      bodyPort = spec.port;
    } else if (id === bodiesConfig.defaultId) {
      bodyPort = resolvedPort;
    } else if (resolvedPort === 0) {
      bodyPort = 0;
    } else {
      bodyPort = basePort + fallbackIndex;
      fallbackIndex += 1;
    }

    const bodyManifestPath = typeof spec.manifestPath === 'string' && spec.manifestPath !== ''
      ? spec.manifestPath
      : manifestPath;

    return {
      id,
      statePath: bodyStatePath,
      port: bodyPort,
      manifestPath: bodyManifestPath,
      nsfw: Boolean(spec.nsfw ?? nsfw),
    };
  });

  return {
    defaultId: bodiesConfig.defaultId,
    sessions: bodiesConfig.sessions,
    specs,
  };
}

function mergeCapabilities(entries) {
  const merged = {};
  for (const entry of entries) {
    const caps = entry.gateway.getCapabilities?.();
    if (!isPlainRecord(caps)) continue;
    for (const [actionType, parts] of Object.entries(caps)) {
      if (!Array.isArray(parts)) continue;
      if (!Object.hasOwn(merged, actionType)) {
        merged[actionType] = [...parts];
      } else {
        const set = new Set([...merged[actionType], ...parts]);
        merged[actionType] = [...set];
      }
    }
  }
  return merged;
}

/**
 * 统一多身体门面：按会话路由到对应的身体实例，所有身体在挂载与运行期完全对等。
 */
export function createBodyFacade({ entries, defaultId, sessions = {} }) {
  const byId = new Map(entries.map((entry) => [entry.id, entry.gateway]));
  const prefixRules = Object.keys(sessions)
    .filter((pattern) => pattern.endsWith('*') && Object.hasOwn(sessions, pattern))
    .sort((a, b) => b.length - a.length);
  let stickySessionId = null;

  function resolveSessionTarget(sessionId) {
    if (typeof sessionId === 'string' && sessionId) {
      if (Object.hasOwn(sessions, sessionId)) {
        const mapped = sessions[sessionId];
        if (typeof mapped === 'string') return { id: mapped, explicitlyMapped: true };
      }
      for (const pattern of prefixRules) {
        if (sessionId.startsWith(pattern.slice(0, -1))) {
          const candidate = sessions[pattern];
          if (typeof candidate === 'string') return { id: candidate, explicitlyMapped: true };
        }
      }
    }
    return { id: defaultId, explicitlyMapped: false };
  }

  function resolveId(sessionId) {
    return resolveSessionTarget(sessionId).id;
  }

  function findBoundGateway(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    for (const entry of entries) {
      if (entry.gateway.getBoundSessionId?.() === sessionId) {
        return entry.gateway;
      }
    }
    return null;
  }

  function gatewayFor(sessionId) {
    const { id } = resolveSessionTarget(sessionId);
    return byId.get(id) ?? null;
  }

  function gatewayForSession(sessionId) {
    if (typeof sessionId === 'string' && sessionId) {
      return findBoundGateway(sessionId) ?? gatewayFor(sessionId);
    }
    if (typeof stickySessionId === 'string' && stickySessionId) {
      const stickyGateway = findBoundGateway(stickySessionId) ?? gatewayFor(stickySessionId);
      if (stickyGateway) return stickyGateway;
    }
    return byId.get(defaultId) ?? entries[0]?.gateway ?? null;
  }

  function requireGateway(sessionId) {
    const scoped = gatewayForSession(sessionId);
    if (!scoped) {
      const targetId = resolveId(sessionId);
      throw new Error(`Body Gateway "${targetId}" is unavailable`);
    }
    return scoped;
  }

  return {
    resolveId,
    gatewayFor,
    findBoundGateway,
    gatewayForSession,
    useSession(sessionId) {
      if (typeof sessionId === 'string' && sessionId) stickySessionId = sessionId;
      return stickySessionId;
    },
    stickySessionId() {
      return stickySessionId;
    },
    ids: entries.map((entry) => entry.id),
    gateways: entries,
    defaultId,
    getHealth(sessionId) {
      return requireGateway(sessionId).getHealth?.();
    },
    getState(sessionId) {
      return requireGateway(sessionId).getState?.();
    },
    getCapabilities(sessionId) {
      if (typeof sessionId === 'string' && sessionId) {
        return requireGateway(sessionId).getCapabilities?.();
      }
      return mergeCapabilities(entries);
    },
    getNsfw(sessionId) {
      if (typeof sessionId === 'string' && sessionId) {
        return Boolean(requireGateway(sessionId).getNsfw?.());
      }
      return entries.some((entry) => Boolean(entry.gateway.getNsfw?.()));
    },
    isDormant(sessionId) {
      return requireGateway(sessionId).isDormant?.();
    },
    getBoundSessionId(sessionId) {
      return requireGateway(sessionId).getBoundSessionId?.();
    },
    getStatePath(sessionId) {
      return requireGateway(sessionId).getStatePath?.();
    },
    submitAction(payload) {
      return requireGateway(payload?.sessionId).submitAction(payload);
    },
    bindSession(sessionId) {
      return requireGateway(sessionId).bindSession(sessionId);
    },
    unbindSession(sessionId) {
      return requireGateway(sessionId).unbindSession?.();
    },
    getAction(id, sessionId) {
      return requireGateway(sessionId).getAction?.(id);
    },
    getReceipt(id, sessionId) {
      return requireGateway(sessionId).getReceipt?.(id);
    },
    getNotifications(sessionId) {
      return requireGateway(sessionId).getNotifications?.();
    },
    ackNotification(id, meta, sessionId) {
      return requireGateway(sessionId).ackNotification?.(id, meta);
    },
    confirmNotificationInserted(payload, sessionId) {
      return requireGateway(sessionId).confirmNotificationInserted?.(payload);
    },
    getStateHistory(options, sessionId) {
      return requireGateway(sessionId).getStateHistory?.(options);
    },
    getNotificationHistory(options, sessionId) {
      return requireGateway(sessionId).getNotificationHistory?.(options);
    },
    stop() {
      return Promise.allSettled(entries.map((entry) => entry.gateway.stop?.())).then(() => undefined);
    },
  };
}
