export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

export function assertJsonValue(value, path = 'value', ancestors = new Set(), depth = 0) {
  if (depth > 64) throw new Error(`${path} is nested too deeply`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} must be JSON-safe`);
  if (ancestors.has(value)) throw new Error(`${path} contains a cycle`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new Error(`${path}[${index}] is a hole`);
      assertJsonValue(value[index], `${path}[${index}]`, ancestors, depth + 1);
    }
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`${path}.${key} is undefined`);
      assertJsonValue(item, `${path}.${key}`, ancestors, depth + 1);
    }
  } else {
    throw new Error(`${path} must be a plain object or array`);
  }
  ancestors.delete(value);
}
