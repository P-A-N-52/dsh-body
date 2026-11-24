import { isPlainObject as isRecord } from '../json-safe.js';

// A FatalOperationError stops scheduling: the batch is not retried, it is
// abandoned and reported through /health. Transient failures (script errors,
// timeouts) keep the existing retry behaviour.
export class FatalOperationError extends Error {
  constructor(detail) {
    super(fatalMessage(detail));
    this.name = 'FatalOperationError';
    this.fatal = detail;
  }
}

function siteOf({ partId, field, target }) {
  return target ? `${partId}.${field} -> ${target}` : `${partId}.${field}`;
}

function fatalMessage(detail) {
  return `Body module "${detail.module}" ${detail.operation} ${siteOf(detail)}: ${detail.reason}`;
}

function fail(detail) {
  throw new FatalOperationError({ target: null, ...detail });
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function readRefs(value, label, id, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((ref) => !isNonemptyString(ref))) {
    throw new Error(`Body module "${id}" field "${field}": ${label} must be an array of "partId.field" references`);
  }
  return value;
}

function splitRef(ref, id, field, label) {
  const parts = ref.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Body module "${id}" field "${field}": ${label} entry "${ref}" is not a "partId.field" reference`);
  }
  return parts;
}

function readFields(id, initialState, fields) {
  if (fields === undefined) {
    throw new Error(`Body module "${id}" must export a fields object`);
  }
  if (!isRecord(fields)) {
    throw new Error(`Body module "${id}": fields must be an object`);
  }
  const declared = new Map();
  for (const [field, declaration] of Object.entries(fields)) {
    const where = `Body module "${id}" field "${field}"`;
    if (!Object.hasOwn(initialState, field)) {
      throw new Error(`${where}: field is not defined in initialState`);
    }
    if (!isRecord(declaration)) {
      throw new Error(`${where}: declaration must be an object`);
    }
    const { unit, mode, contributors, transferOut, transferIn } = declaration;
    if (!isNonemptyString(unit)) {
      throw new Error(`${where}: unit must be a nonempty string`);
    }
    if (mode !== 'absolute' && mode !== 'additive') {
      throw new Error(`${where}: mode must be "absolute" or "additive"`);
    }
    if (mode === 'additive') {
      if (!Array.isArray(contributors) || contributors.length === 0
        || contributors.some((partId) => !isNonemptyString(partId))
        || new Set(contributors).size !== contributors.length) {
        throw new Error(`${where}: additive fields must declare contributors as an array of unique part ids`);
      }
      if (transferOut !== undefined || transferIn !== undefined) {
        throw new Error(`${where}: additive fields cannot declare transferOut or transferIn`);
      }
    } else if (contributors !== undefined) {
      throw new Error(`${where}: contributors is only valid for additive fields`);
    }
    declared.set(field, {
      owner: id,
      unit,
      mode,
      contributors: contributors ?? [],
      transferOut: readRefs(transferOut, 'transferOut', id, field),
      transferIn: readRefs(transferIn, 'transferIn', id, field),
    });
  }
  return declared;
}

function readTransferPair(registry, id, field, unit, ref, direction) {
  const toward = direction === 'transferOut' ? 'target' : 'source';
  const [partId, targetField] = splitRef(ref, id, field, direction);
  const declaration = registry.get(partId)?.get(targetField);
  const where = `Body module "${id}" field "${field}"`;
  if (!declaration) {
    throw new Error(`${where}: ${direction} ${toward} "${ref}" is not declared`);
  }
  if (declaration.mode !== 'absolute') {
    throw new Error(`${where}: ${direction} ${toward} "${ref}" must be an absolute field`);
  }
  if (declaration.unit !== unit) {
    throw new Error(`${where}: ${direction} ${toward} "${ref}" has unit "${declaration.unit}", expected "${unit}"`);
  }
  const reciprocal = direction === 'transferOut' ? declaration.transferIn : declaration.transferOut;
  if (!reciprocal.includes(`${id}.${field}`)) {
    throw new Error(`${where}: ${direction} ${toward} "${ref}" must declare ${direction === 'transferOut' ? 'transferIn' : 'transferOut'} ["${id}.${field}"]`);
  }
}

// Builds the field registry and validates every declaration. Missing fields,
// fields outside initialState, invalid modes, unpaired transfers and mismatched
// units all reject startup with the module id and field name.
export function createFieldRegistry(descriptions) {
  const registry = new Map();
  for (const { id, initialState, fields } of descriptions) {
    if (registry.has(id)) throw new Error(`Body module "${id}" is declared more than once`);
    registry.set(id, readFields(id, initialState ?? {}, fields));
  }
  for (const [id, declared] of registry) {
    for (const [field, declaration] of declared) {
      for (const ref of declaration.transferOut) {
        readTransferPair(registry, id, field, declaration.unit, ref, 'transferOut');
      }
      for (const ref of declaration.transferIn) {
        readTransferPair(registry, id, field, declaration.unit, ref, 'transferIn');
      }
    }
  }
  return registry;
}

export function applyOperations({ registry, snapshotParts, writes, adds = [], transfers = [] }) {
  const next = { ...writes };

  function lookup(partId, field) {
    if (typeof partId !== 'string' || typeof field !== 'string') return null;
    return registry.get(partId)?.get(field) ?? null;
  }

  function claimPart(partId, detail) {
    if (Object.hasOwn(next, partId)) return next[partId];
    const current = snapshotParts[partId];
    if (!isRecord(current)) fail({ ...detail, partId, reason: 'body part is not loaded' });
    const copy = structuredClone(current);
    next[partId] = copy;
    return copy;
  }

  const sums = new Map();
  for (const request of adds) {
    const { caller, partId, field, delta } = request ?? {};
    const declaration = lookup(partId, field);
    if (!declaration) fail({ module: caller, operation: 'add', partId, field, reason: 'field is not declared' });
    if (declaration.mode !== 'additive') {
      fail({
        module: caller,
        operation: 'add',
        partId,
        field,
        reason: `field mode is "${declaration.mode}"; only additive fields accept add`,
      });
    }
    if (caller !== declaration.owner && !declaration.contributors.includes(caller)) {
      fail({ module: caller, operation: 'add', partId, field, reason: 'module is not a declared contributor' });
    }
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      fail({ module: caller, operation: 'add', partId, field, reason: 'delta must be a finite number' });
    }
    const key = `${partId}.${field}`;
    const group = sums.get(key);
    if (group) {
      group.delta += delta;
      if (!Number.isFinite(group.delta)) {
        fail({ module: caller, operation: 'add', partId, field, reason: 'accumulated delta is not a finite number' });
      }
    } else {
      sums.set(key, { partId, field, delta });
    }
  }
  for (const { partId, field, delta } of sums.values()) {
    const declaration = lookup(partId, field);
    const detail = { module: declaration.owner, operation: 'add', partId, field };
    const part = claimPart(partId, detail);
    const base = part[field];
    if (typeof base !== 'number' || !Number.isFinite(base)) {
      fail({ ...detail, reason: 'field value is not a finite number' });
    }
    const nextValue = base + delta;
    if (!Number.isFinite(nextValue)) {
      fail({ ...detail, reason: 'field value after add is not a finite number' });
    }
    part[field] = nextValue;
  }

  const pairs = new Map();
  for (const request of transfers) {
    const { caller, fromPart, fromField, toPart, toField, amount } = request ?? {};
    const target = `${toPart}.${toField}`;
    const detail = { module: caller, operation: 'transfer', partId: fromPart, field: fromField, target };
    const source = lookup(fromPart, fromField);
    if (!source) fail({ ...detail, reason: 'source field is not declared' });
    if (!lookup(toPart, toField)) fail({ ...detail, reason: 'target field is not declared' });
    if (source.owner !== caller) fail({ ...detail, reason: 'only the owner of the source part may transfer out' });
    if (!source.transferOut.includes(target)) fail({ ...detail, reason: 'transfer is not declared in transferOut' });
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      fail({ ...detail, reason: 'amount must be a nonnegative finite number' });
    }
    const key = `${fromPart}.${fromField}->${target}`;
    const pair = pairs.get(key);
    if (pair) {
      pair.amount += amount;
      if (!Number.isFinite(pair.amount)) {
        fail({ ...detail, reason: 'accumulated transfer amount is not a finite number' });
      }
    } else {
      pairs.set(key, { caller, fromPart, fromField, toPart, toField, amount });
    }
  }
  const ordered = [...pairs.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  for (const [, { caller, fromPart, fromField, toPart, toField, amount }] of ordered) {
    const target = `${toPart}.${toField}`;
    const detail = { module: caller, operation: 'transfer', partId: fromPart, field: fromField, target };
    const sourcePart = claimPart(fromPart, detail);
    const available = sourcePart[fromField];
    if (typeof available !== 'number' || !Number.isFinite(available)) {
      fail({ ...detail, reason: 'source value is not a finite number' });
    }
    if (available < amount) {
      fail({ ...detail, reason: `source value is ${available} but the transfer needs ${amount}` });
    }
    sourcePart[fromField] = available - amount;
    const targetPart = claimPart(toPart, { ...detail, partId: toPart, field: toField });
    const targetValue = targetPart[toField];
    if (typeof targetValue !== 'number' || !Number.isFinite(targetValue)) {
      fail({ ...detail, partId: toPart, field: toField, reason: 'target value is not a finite number' });
    }
    const nextTarget = targetValue + amount;
    if (!Number.isFinite(nextTarget)) {
      fail({ ...detail, partId: toPart, field: toField, reason: 'target value after transfer is not a finite number' });
    }
    targetPart[toField] = nextTarget;
  }

  return next;
}
