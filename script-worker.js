import { parentPort, workerData } from 'node:worker_threads';
import { assertJsonValue, isPlainObject as isRecord } from './json-safe.js';

const frozenObjects = new WeakSet();

function freezeJson(value) {
  if (value === null || typeof value !== 'object' || frozenObjects.has(value)) return value;
  frozenObjects.add(value);
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

function describe({ id, heartbeat, step, actionTypes = [], functions = {}, initialState = {}, resetOnStart = [] }) {
  if (typeof id !== 'string' || !id || typeof (heartbeat ?? step) !== 'function' || !isRecord(initialState)) {
    throw new Error('Expected an id, a heartbeat function (or legacy step) and an object for initialState');
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
  return {
    id,
    initialState: initialStateCopy,
    resetOnStart,
    hasFunctions: Object.keys(functions).length > 0,
    actionTypes,
  };
}

function initialize(script, { snapshot, context }) {
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

async function heartbeat(script, { snapshot, actions, dt, simulatedSeconds, wallTimeMs, helperModules }) {
  freezeJson(snapshot);
  freezeJson(actions);
  const read = (id) => {
    if (id === undefined) return snapshot;
    return Object.hasOwn(snapshot.parts, id) ? snapshot.parts[id] : undefined;
  };
  const readOnly = Object.freeze({ read, actions, dt, simulatedSeconds, wallTimeMs });
  const helpers = new Map(await Promise.all(helperModules.map(async ([id, url]) => [id, (await import(url)).functions])));
  const call = (id, name, ...args) => {
    const functions = helpers.get(id);
    if (!functions || !Object.hasOwn(functions, name)) throw new Error(`Unknown body function ${id}.${name}`);
    return functions[name](readOnly, ...args);
  };

  let part;
  const notifications = [];
  const write = (value) => {
    const valueCopy = structuredClone(value);
    if (!isRecord(valueCopy)) throw new Error('write expects the next state as an object');
    assertJsonValue(valueCopy, 'part');
    part = valueCopy;
  };
  const notify = ({ mode, sessionId, text }) => {
    if ((mode !== 'context' && mode !== 'wake') || typeof sessionId !== 'string' || !sessionId
      || typeof text !== 'string' || !text.trim()) {
      throw new Error('notify expects a mode, sessionId and nonempty text');
    }
    if (sessionId.length > 256) throw new Error('notify sessionId is too long');
    if (text.length > 4000) throw new Error('notify text is too long');
    notifications.push({ mode, sessionId, text });
  };

  const { heartbeat, step } = script;
  if (heartbeat != null) {
    await heartbeat(Object.freeze({ ...readOnly, write, call, notify }));
  } else {
    write(await step(snapshot, dt, actions));
  }
  return { part, notifications };
}

const operations = { describe, initialize, heartbeat };
const { url, operation, input } = workerData;
const script = await import(url);
parentPort.postMessage(await operations[operation](script, input));
