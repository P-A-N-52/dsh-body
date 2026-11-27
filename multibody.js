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
    throw new Error(`Invalid bodies.json at ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.bodies)) {
    throw new Error(`Invalid bodies.json at ${file}: expected an object with a bodies map`);
  }
  const rawIds = Object.keys(parsed.bodies);
  const ids = rawIds.filter((id) => isValidBodyId(id) && isPlainRecord(parsed.bodies[id]));
  if (ids.length === 0 || ids.length !== rawIds.length) {
    throw new Error(`Invalid bodies.json at ${file}: expected nonempty valid body entries`);
  }
  if (parsed.default !== undefined && (typeof parsed.default !== 'string' || !ids.includes(parsed.default))) {
    throw new Error(`Invalid bodies.json at ${file}: default must match a declared body id`);
  }
  if (parsed.sessions !== undefined && !isPlainRecord(parsed.sessions)) {
    throw new Error(`Invalid bodies.json at ${file}: sessions must be a plain object`);
  }
  const defaultId = typeof parsed.default === 'string' ? parsed.default : null;
  const sessions = {};
  if (isPlainRecord(parsed.sessions)) {
    for (const [pattern, targetId] of Object.entries(parsed.sessions)) {
      if (!pattern || DISALLOWED_KEYS.has(pattern) || typeof targetId !== 'string' || !ids.includes(targetId)) {
        throw new Error(`Invalid bodies.json at ${file}: invalid session mapping for ${pattern || '<empty>'}`);
      }
      sessions[pattern] = targetId;
    }
  }
  return { file, defaultId, ids, bodies: parsed.bodies, sessions };
}

function resolveEnvBodyPort() {
  const raw = process.env.DSH_BODY_PORT;
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
}

/**
 * 统一解析所有身体挂载规格，不区分主副身体；defaultId 仅作存储/端口默认继承，不作未映射会话兜底路由。
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
      hasBodiesConfig: false,
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
  const envPort = resolveEnvBodyPort();
  const basePort = Number.isInteger(resolvedPort) && resolvedPort > 0 ? resolvedPort : (envPort ?? 3210);
  const usedPorts = new Set();
  for (const id of bodiesConfig.ids) {
    const spec = bodiesConfig.bodies[id];
    if (isValidPort(spec.port) && spec.port > 0) usedPorts.add(spec.port);
  }
  if (bodiesConfig.defaultId !== null) {
    const defaultSpec = bodiesConfig.bodies[bodiesConfig.defaultId];
    if (!isValidPort(defaultSpec?.port)) {
      const effectiveDefaultPort = Number.isInteger(resolvedPort) && resolvedPort > 0 ? resolvedPort : envPort;
      if (effectiveDefaultPort) usedPorts.add(effectiveDefaultPort);
    }
  }

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
      while (usedPorts.has(basePort + fallbackIndex)) {
        fallbackIndex += 1;
      }
      bodyPort = basePort + fallbackIndex;
      usedPorts.add(bodyPort);
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
    hasBodiesConfig: true,
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
export function createBodyFacade({ entries, defaultId, hasBodiesConfig = false, sessions = {} }) {
  const byId = new Map(entries.map((entry) => [entry.id, entry.gateway]));
  const prefixRules = Object.keys(sessions)
    .filter((pattern) => pattern.endsWith('*') && Object.hasOwn(sessions, pattern))
    .sort((a, b) => b.length - a.length);
  const requireExplicitMapping = Boolean(hasBodiesConfig || entries.length > 1 || Object.keys(sessions).length > 0);

  function resolveSessionTarget(sessionId) {
    if (typeof sessionId === 'string' && sessionId.trim() !== '') {
      const normalized = sessionId.trim();
      if (Object.hasOwn(sessions, normalized)) {
        const mapped = sessions[normalized];
        if (typeof mapped === 'string') return { id: mapped, explicitlyMapped: true };
      }
      for (const pattern of prefixRules) {
        if (normalized.startsWith(pattern.slice(0, -1))) {
          const candidate = sessions[pattern];
          if (typeof candidate === 'string') return { id: candidate, explicitlyMapped: true };
        }
      }
      if (!requireExplicitMapping) {
        return { id: defaultId ?? entries[0]?.id ?? null, explicitlyMapped: false };
      }
    }
    return { id: null, explicitlyMapped: false };
  }

  function resolveId(sessionId) {
    return resolveSessionTarget(sessionId).id;
  }

  function findBoundGateway(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
    const normalized = sessionId.trim();
    for (const entry of entries) {
      if (entry.gateway.getBoundSessionId?.() === normalized) {
        return entry.gateway;
      }
    }
    return null;
  }

  function gatewayFor(sessionId) {
    const { id } = resolveSessionTarget(sessionId);
    return id ? (byId.get(id) ?? null) : null;
  }

  function gatewayForSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return null;
    }
    const normalized = sessionId.trim();
    const target = resolveSessionTarget(normalized);
    if (target.explicitlyMapped) {
      return byId.get(target.id) ?? null;
    }
    return findBoundGateway(normalized) ?? (requireExplicitMapping ? null : (byId.get(defaultId) ?? entries[0]?.gateway ?? null));
  }

  function requireGateway(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('A nonempty sessionId is required');
    }
    const scoped = gatewayForSession(sessionId);
    if (!scoped) {
      const targetId = resolveId(sessionId);
      if (!targetId) {
        throw new Error('No body is mapped to this session');
      }
      throw new Error(`Body Gateway "${targetId}" is unavailable`);
    }
    return scoped;
  }

  return {
    resolveId,
    resolveSessionTarget,
    gatewayFor,
    findBoundGateway,
    gatewayForSession,
    ids: entries.map((entry) => entry.id),
    gateways: entries,
    defaultId,
    hasBodiesConfig: requireExplicitMapping,
    getHealth(sessionId) {
      return requireGateway(sessionId).getHealth?.();
    },
    getState(sessionId) {
      return requireGateway(sessionId).getState?.();
    },
    getCapabilities(sessionId) {
      if (typeof sessionId === 'string' && sessionId.trim()) {
        return requireGateway(sessionId).getCapabilities?.();
      }
      return mergeCapabilities(entries);
    },
    getNsfw(sessionId) {
      if (typeof sessionId === 'string' && sessionId.trim()) {
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
      return requireGateway(sessionId).unbindSession?.(sessionId);
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
