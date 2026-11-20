export function counterSource({ id = 'counter', actionTypes = ['eat'] } = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { rounds: [], applied: [], volumeMl: 0 };
export const fields = {};

export function heartbeat(io) {
  const prev = io.read(${JSON.stringify(id)}) ?? {};
  const rounds = [...(prev.rounds ?? []), { t: io.simulatedSeconds, ids: io.actions.map((action) => action.id) }];
  const applied = [...(prev.applied ?? [])];
  let volumeMl = prev.volumeMl ?? 0;
  for (const action of io.actions) {
    if (action.type === 'eat') {
      applied.push(action.id);
      volumeMl += Number(action.volumeMl ?? 0);
    }
  }
  io.write({ ...prev, rounds, applied, volumeMl });
}
`;
}

export function blockingSource({
  id = 'blocking',
  actionTypes = ['eat'],
  startedPath,
  releasePath,
} = {}) {
  return `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { rounds: [], applied: [] };
export const fields = {};

export async function heartbeat(io) {
  mkdirSync(dirname(${JSON.stringify(startedPath)}), { recursive: true });
  writeFileSync(${JSON.stringify(startedPath)}, String(io.simulatedSeconds));
  while (!existsSync(${JSON.stringify(releasePath)})) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const prev = io.read(${JSON.stringify(id)}) ?? {};
  const rounds = [...(prev.rounds ?? []), { t: io.simulatedSeconds, ids: io.actions.map((action) => action.id) }];
  io.write({ ...prev, rounds, applied: [...(prev.applied ?? []), ...io.actions.map((action) => action.id)] });
}
`;
}

export function flakySource({
  id = 'flaky',
  actionTypes = ['eat'],
  startedPath,
  releasePath,
  countPath,
} = {}) {
  return `
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { rounds: [], applied: [] };
export const fields = {};

export async function heartbeat(io) {
  mkdirSync(dirname(${JSON.stringify(startedPath)}), { recursive: true });
  writeFileSync(${JSON.stringify(startedPath)}, String(io.simulatedSeconds));
  while (!existsSync(${JSON.stringify(releasePath)})) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  let count = 0;
  try {
    count = Number(readFileSync(${JSON.stringify(countPath)}, 'utf8')) || 0;
  } catch {}
  if (count < 1) {
    writeFileSync(${JSON.stringify(countPath)}, String(count + 1));
    throw new Error('planned failure');
  }
  const prev = io.read(${JSON.stringify(id)}) ?? {};
  const rounds = [...(prev.rounds ?? []), { t: io.simulatedSeconds, ids: io.actions.map((action) => action.id) }];
  io.write({ ...prev, rounds, applied: [...(prev.applied ?? []), ...io.actions.map((action) => action.id)] });
}
`;
}

export function hangSource({ id = 'hang', actionTypes = ['eat'] } = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { rounds: [] };
export const fields = {};

export async function heartbeat() {
  await new Promise((resolve) => setTimeout(resolve, 60000));
}
`;
}

export function notifySource({
  id = 'notify',
  actionTypes = ['eat'],
  every = 1,
  mode = 'context',
  sessionId = 'session-a',
  text = 'body notice',
} = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { rounds: 0 };
export const fields = {};

export function heartbeat(io) {
  const prev = io.read(${JSON.stringify(id)}) ?? { rounds: 0 };
  const rounds = (prev.rounds ?? 0) + 1;
  io.write({ ...prev, rounds });
  if (rounds % ${every} === 0) {
    io.notify({ mode: ${JSON.stringify(mode)}, sessionId: ${JSON.stringify(sessionId)}, text: ${JSON.stringify(text)} });
  }
}
`;
}

export function defaultsSource({ id = 'defaults', actionTypes = [] } = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { nested: { a: 1, b: 2 }, flat: 3 };
export const fields = {};

export function heartbeat(io) {
  const prev = io.read(${JSON.stringify(id)}) ?? {};
  io.write({ ...prev });
}
`;
}

export function getterSource({ id = 'getter' } = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = [];
export const initialState = { ok: true };
export const fields = {};

let first = true;
export function heartbeat(io) {
  io.write({
    get v() {
      if (first) {
        first = false;
        return 1;
      }
      return new Map([['x', 1]]);
    },
  });
}
`;
}

export function sharedSource({ id = 'shared' } = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = [];
export const initialState = { ok: true };
export const fields = {};

export function heartbeat(io) {
  const shared = { x: 1 };
  io.write({ a: shared, b: shared, list: [shared] });
}
`;
}

export function sparseActionTypesSource({ id = 'sparse' } = {}) {
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = new Array(2);
actionTypes[1] = 'eat';
export const initialState = { ok: true };
export const fields = {};

export function heartbeat(io) {
  io.write({ ok: true });
}
`;
}

export function badJsonSource({ id = 'bad', actionTypes = [], kind = 'bigint' } = {}) {
  const value = kind === 'bigint'
    ? '{ bad: 1n }'
    : kind === 'nan'
      ? '{ bad: NaN }'
      : kind === 'undefined'
        ? '{ bad: undefined }'
        : '{ bad: new Map([["a", 1]]) }';
  return `
export const id = ${JSON.stringify(id)};
export const actionTypes = ${JSON.stringify(actionTypes)};
export const initialState = { ok: true };
export const fields = {};

export function heartbeat(io) {
  io.write(${value});
}
`;
}
