import { once } from 'node:events';
import { createServer } from 'node:http';
import { isPlainObject as isRecord } from '../json-safe.js';

export const host = '127.0.0.1';
const maxBodyBytes = 64 * 1024;

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

export function createBodyHttpServer({ store, getHealth, getCapabilities, enqueue, ackNotification }) {
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
    const { port } = server.address();
    const hostHeader = request.headers.host;
    const allowedHosts = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
    ]);
    if (!hostHeader || !allowedHosts.has(hostHeader)) {
      return { statusCode: 403, body: { error: 'Unexpected Host header' } };
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.origin !== undefined) {
      const allowedOrigins = new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
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
    const checkpoint = store.current;
    if (!checkpoint) return reply(response, 503, { error: 'Body Gateway is starting', starting: true });

    let pathname;
    try {
      pathname = new URL(request.url, `http://${host}`).pathname;
    } catch {
      return reply(response, 400, { error: 'Invalid request URL' });
    }

    if (pathname === '/health') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, getHealth(server.address().port));
    }
    if (pathname === '/state') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, checkpoint.snapshot);
    }
    if (pathname === '/capabilities') {
      if (request.method !== 'GET') return methodNotAllowed(response, 'GET');
      return reply(response, 200, getCapabilities());
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

  async function listen(port) {
    server.listen(port, host);
    await once(server, 'listening');
    return server.address();
  }

  async function close() {
    if (!server.listening) return;
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }

  return {
    listen,
    close,
    get port() { return server.address()?.port ?? null; },
  };
}