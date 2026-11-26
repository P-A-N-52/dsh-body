import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startGateway } from '../gateway.js';

export function checkpoint({
  wallTimeMs = Date.now(),
  simulatedSeconds = 0,
  parts = {},
  pendingActionIds = [],
  actions = {},
  activeBatch = null,
  lastEffectiveAt = 0,
  notifications = [],
  profile,
} = {}) {
  return {
    schemaVersion: 2,
    wallTimeMs,
    snapshot: { simulatedSeconds, parts },
    pendingActionIds,
    actions,
    activeBatch,
    lastEffectiveAt,
    notifications,
    startup: null,
    ...(profile === undefined ? {} : { profile }),
  };
}

export function rawRequest(base, {
  method = 'GET',
  path = '/health',
  headers = {},
  body = null,
} = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname,
      port: url.port,
      method,
      path,
      headers: { host: url.host, ...headers },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('raw request timed out')));
    if (body !== null) req.write(body);
    req.end();
  });
}

export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-body-'));
}

export async function until(check, { timeout = 4000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('until: timed out');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function launch(t, {
  modules = {},
  startupScripts = [],
  seed = null,
  catchUpMinutes = 0,
  scriptTimeoutMs = 2000,
  heartbeatIntervalMs = 25,
  autoTick = false,
  statePath = null,
  dir = null,
  expectReadyReject = false,
  gatewayOptions = {},
} = {}) {
  const root = dir ?? makeTempDir();
  const moduleDir = join(root, 'modules');
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  for (const [name, source] of Object.entries(modules)) {
    const file = join(moduleDir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }

  const manifestPath = join(root, 'body-modules.json');
  writeFileSync(manifestPath, JSON.stringify({
    startupScripts,
    scripts: Object.keys(modules).map((name) => `./modules/${name}`),
    catchUpMinutes,
    scriptTimeoutMs,
  }, null, 2));

  const resolvedStatePath = statePath ?? join(root, 'state', 'body-state.json');
  if (seed) {
    mkdirSync(dirname(resolvedStatePath), { recursive: true });
    writeFileSync(resolvedStatePath, JSON.stringify(seed));
  }

  const logs = [];
  for (const method of ['log', 'error', 'warn']) {
    try {
      t.mock.method(console, method, (...args) => logs.push(args.join(' ')));
    } catch {
      // A second launch in the same test may already have mocked this method.
    }
  }

  const gateway = startGateway({
    manifestPath,
    statePath: resolvedStatePath,
    port: 0,
    heartbeatIntervalMs,
    autoTick,
    ...gatewayOptions,
  });

  t.after(async () => {
    await gateway.stop();
    if (!dir) rmSync(root, { recursive: true, force: true });
  });

  let info = null;
  let readyError = null;
  try {
    info = await gateway.ready;
  } catch (error) {
    readyError = error;
  }
  if (readyError && !expectReadyReject) throw readyError;

  const base = info ? `http://127.0.0.1:${info.port}` : null;

  return {
    root,
    dir: root,
    manifestPath,
    statePath: resolvedStatePath,
    gateway,
    info,
    readyError,
    base,
    logs,
    state: () => JSON.parse(readFileSync(resolvedStatePath, 'utf8')),
    exists: (path) => existsSync(path),
    async post(path, body, headers = {}) {
      return fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    },
    async get(path, headers = {}) {
      return fetch(base + path, { headers });
    },
    async tick() {
      return gateway.tick();
    },
  };
}
