import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { assertJsonValue, isPlainObject as isRecord } from '../json-safe.js';
import { maxNotificationTextLength } from './config.js';
import { createFieldRegistry } from './operations.js';

const modules = new Map();
const frozenObjects = new WeakSet();
let descriptions;

function freezeJson(value) {
  if (value === null || typeof value !== 'object' || frozenObjects.has(value)) return value;
  frozenObjects.add(value);
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

function describe({ id, heartbeat, step, actionTypes = [], functions = {}, initialState = {}, resetOnStart = [], fields }) {
  if (typeof id !== 'string' || !id || typeof (heartbeat ?? step) !== 'function' || !isRecord(initialState)) {
    throw new Error('Expected an id, a heartbeat function (or legacy step) and an object for initialState');
  }
  if (!isRecord(fields)) {
    throw new Error(`Body module "${id}" must export a fields object`);
  }
  if (!isRecord(functions) || !Object.values(functions).every((fn) => typeof fn === 'function')) {
    throw new Error('functions must be an object of functions');
  }
  if (!Array.isArray(actionTypes) || actionTypes.length > 32) {
    throw new Error('actionTypes must be an array of unique nonempty strings');
  }
  for (let index = 0; index < actionTypes.length; index++) {
    const type = actionTypes[index];
    if (!(index in actionTypes) || typeof type !== 'string' || !type || type.length > 64) {
      throw new Error('actionTypes must be an array of unique nonempty strings');
    }
  }
  if (new Set(actionTypes).size !== actionTypes.length) {
    throw new Error('actionTypes must be an array of unique nonempty strings');
  }
  if (!Array.isArray(resetOnStart) || resetOnStart.some((field) => typeof field !== 'string' || !Object.hasOwn(initialState, field))) {
    throw new Error('resetOnStart must list fields defined in initialState');
  }

  const initialStateCopy = structuredClone(initialState);
  assertJsonValue(initialStateCopy, 'initialState');
  const fieldsCopy = structuredClone(fields);
  assertJsonValue(fieldsCopy, 'fields');
  return {
    id,
    initialState: initialStateCopy,
    resetOnStart,
    actionTypes,
    fields: fieldsCopy,
  };
}

function initialPatches(script, snapshot, context) {
  const { initialize } = script;
  if (typeof initialize !== 'function') throw new Error('Expected an initialize function');
  const patches = initialize(freezeJson(snapshot), freezeJson(context)) ?? {};
  const patchesCopy = structuredClone(patches);
  if (!isRecord(patchesCopy) || !Object.values(patchesCopy).every(isRecord)) {
    throw new Error('initialize must return an object of body part patches');
  }
  assertJsonValue(patchesCopy, 'initialize patches');
  return patchesCopy;
}

async function runScript(operation, url, run) {
  const label = `${operation} ${fileURLToPath(url)}`;
  parentPort.postMessage({ label });
  try {
    return await run();
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new Error(`${label} failed`, { cause });
  }
}

async function describeModules() {
  if (descriptions) return descriptions;
  for (const { url, inject } of workerData.scripts) {
    await runScript('describe', url, async () => {
      const script = await import(url);
      const description = describe(script);
      if (modules.has(description.id)) throw new Error('Heartbeat script ids must be unique');
      const { heartbeat, step, functions = {} } = script;
      modules.set(description.id, { url, heartbeat, step, functions, inject, description });
    });
  }

  descriptions = [...modules.values()].map(({ description }) => description);
  createFieldRegistry(descriptions);
  return descriptions;
}

async function initialize({ url, snapshot, context }) {
  return runScript('initialize', url, async () => initialPatches(await import(url), snapshot, context));
}

function readStatePath(parts, path) {
  let value = parts;
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

async function heartbeat({ snapshot, actions, dt, simulatedSeconds, wallTimeMs, suppressNotifications = false }) {
  await describeModules();
  freezeJson(snapshot);
  freezeJson(actions);

  function read(id) {
    if (id === undefined) return snapshot;
    return Object.hasOwn(snapshot.parts, id) ? snapshot.parts[id] : undefined;
  }

  const contexts = new Map();
  const common = { read, actions, dt, simulatedSeconds, wallTimeMs, suppressNotifications };
  const legacyContext = Object.freeze({
    ...common,
    call(id, name, ...args) {
      const functions = modules.get(id)?.functions;
      if (!functions || !Object.hasOwn(functions, name)) throw new Error(`Unknown body function ${id}.${name}`);
      return functions[name](contexts.get(id), ...args);
    },
  });
  for (const [id, { inject }] of modules) {
    if (inject === null) {
      contexts.set(id, legacyContext);
      continue;
    }
    const functions = Object.create(null);
    for (const [alias, path] of inject) {
      const value = readStatePath(snapshot.parts, path);
      functions[alias] = () => value;
    }
    contexts.set(id, Object.freeze({ ...common, functions: Object.freeze(functions) }));
  }

  const updates = [];
  const notifications = [];
  const adds = [];
  const transfers = [];

  function notify({ mode, sessionId, text }) {
    if ((mode !== 'context' && mode !== 'wake') || typeof sessionId !== 'string' || !sessionId
      || typeof text !== 'string' || !text.trim()) {
      throw new Error('notify expects a mode, sessionId and nonempty text');
    }
    if (sessionId.length > 256) throw new Error('notify sessionId is too long');
    if (text.length > maxNotificationTextLength) {
      throw new Error(`notify text is too long (maximum ${maxNotificationTextLength} characters)`);
    }
    notifications.push({ mode, sessionId, text });
  }

  for (const [id, { url, heartbeat: advance, step }] of modules) {
    await runScript('heartbeat', url, async () => {
      let part;
      function write(value) {
        const copy = structuredClone(value);
        if (!isRecord(copy)) throw new Error('write expects the next state as an object');
        assertJsonValue(copy, 'part');
        part = copy;
      }

      function add(partId, field, delta) {
        adds.push({ caller: id, partId, field, delta });
      }

      function transfer(fromPart, fromField, toPart, toField, amount) {
        transfers.push({ caller: id, fromPart, fromField, toPart, toField, amount });
      }

      if (advance != null) {
        await advance(Object.freeze({ ...contexts.get(id), write, notify, add, transfer }));
      } else {
        write(await step(snapshot, dt, actions));
      }
      if (part !== undefined) updates.push([id, part]);
    });
  }
  return { parts: Object.fromEntries(updates), notifications, adds, transfers };
}

const operations = { describe: describeModules, initialize, heartbeat };
parentPort.on('message', async ({ operation, input }) => {
  try {
    parentPort.postMessage({ result: await operations[operation](input) });
  } catch (error) {
    parentPort.postMessage({ error });
  }
});
