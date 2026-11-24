import { readFileSync } from 'node:fs';

export function loadParameters(parametersUrl) {
  const { schemaVersion, owner, parameters } = JSON.parse(readFileSync(parametersUrl, 'utf8'));
  if (schemaVersion !== 1) throw new Error(`Unsupported parameters schemaVersion: ${schemaVersion}`);
  if (typeof owner !== 'string' || !owner) throw new Error('Parameters owner must be a non-empty string');
  if (!Array.isArray(parameters)) throw new Error('parameters must be an array');

  const values = {};
  for (const parameter of parameters) {
    if (typeof parameter?.id !== 'string' || !parameter.id.startsWith(`${owner}.`)) {
      throw new Error(`Parameter id must start with ${owner}.`);
    }
    if (Object.hasOwn(values, parameter.id)) throw new Error(`Duplicate parameter ${parameter.id}`);
    if (parameter.value === undefined) {
      throw new Error(`Parameter ${parameter.id} is missing value`);
    }
    if ((parameter.value === null) !== (parameter.status === 'unset')) {
      throw new Error(`Parameter ${parameter.id}: status unset and value null must match`);
    }
    values[parameter.id] = parameter.value;
  }
  return values;
}

export function requireParameter(values, id) {
  if (!Object.hasOwn(values, id) || values[id] === null || values[id] === undefined) {
    throw new Error(`Parameter ${id} is unset; fill it before running the script`);
  }
  return values[id];
}
