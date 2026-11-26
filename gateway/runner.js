import { Worker } from 'node:worker_threads';

export function formatError(error) {
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

export function createBodyRunner({ scripts, scriptTimeoutMs }) {
  let workerConfig = { profile: null, parameters: null, nsfw: false };
  let worker;
  let pending;
  let termination;
  let closed = false;

  function settle(error, result) {
    if (!pending) return;
    const { timer, reject, resolve } = pending;
    pending = null;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(result);
  }

  function discard(instance, error) {
    if (worker !== instance) return;
    worker = null;
    termination = instance.terminate();
    settle(error);
  }

  function deadline(instance, label) {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      discard(instance, new Error(`${label} timed out after ${scriptTimeoutMs} ms`));
    }, scriptTimeoutMs);
  }

  function open() {
    const instance = new Worker(new URL('./body-worker.js', import.meta.url), {
      workerData: {
        scripts,
        profile: workerConfig.profile,
        parameters: workerConfig.parameters,
        nsfw: workerConfig.nsfw,
      },
      name: 'dsh-body',
    });
    instance.on('message', ({ label, error, result }) => {
      if (worker !== instance || !pending) return;
      if (label) deadline(instance, label);
      else if (error) discard(instance, error);
      else settle(null, result);
    });
    instance.on('error', (error) => discard(instance, error));
    instance.on('exit', (code) => {
      if (worker !== instance) return;
      worker = null;
      settle(new Error(`BodyWorker exited without a result (code ${code})`));
    });
    return instance;
  }

  async function request(operation, input) {
    if (termination) await termination;
    if (closed) throw new Error('Body Gateway is stopping');
    if (pending) throw new Error('BodyWorker already has a request in progress');
    worker ??= open();
    const instance = worker;
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, timer: undefined };
      deadline(instance, operation);
      try {
        instance.postMessage({ operation, input });
      } catch (error) {
        discard(instance, error);
      }
    });
  }

  async function close() {
    closed = true;
    if (worker) discard(worker, new Error('Body Gateway is stopping'));
    await termination;
  }

  return {
    describe: (config) => {
      if (config !== undefined) {
        workerConfig = {
          profile: config?.profile ?? null,
          parameters: config?.parameters ?? null,
          nsfw: Boolean(config?.nsfw),
        };
      }
      return request('describe');
    },
    initialize: (url, snapshot, context) => request('initialize', { url, snapshot, context }),
    heartbeat: (input) => request('heartbeat', input),
    close,
  };
}
