import { isPlainObject } from '../json-safe.js';

export const thermalParametersUrl = new URL(
  '../organs/human-organs/brain/thermoregulation.parameters.json', import.meta.url,
);
export const baselineCoreParameterId = 'thermoregulation.setpointC';
const coreMinId = 'thermoregulation.normalCoreMinC';
const coreMaxId = 'thermoregulation.normalCoreMaxC';
const airMinId = 'thermoregulation.ambientComfortMinC';
const airMaxId = 'thermoregulation.ambientComfortMaxC';
const rangeIds = new Set([coreMinId, coreMaxId, airMinId, airMaxId]);

export function isThermalRangeParameter(id) {
  return rangeIds.has(id);
}

export function readThermalDefaults(raw) {
  if (raw === undefined) return Object.freeze({});
  if (!isPlainObject(raw)) throw new Error('thermalDefaults must be an object keyed by thermal parameter ID');
  for (const [id, value] of Object.entries(raw)) {
    if (id !== baselineCoreParameterId && !rangeIds.has(id)) {
      throw new Error(`Unknown thermalDefaults parameter ${id}`);
    }
    if (!Number.isFinite(value)) throw new Error(`thermalDefaults.${id} must be a finite number`);
  }
  return Object.freeze({ ...raw });
}

/** Resolves the frozen static reference from already layered parameter values. */
export function resolveThermalProfile(values) {
  function read(id, whenUnset) {
    const value = values[id] ?? whenUnset;
    if (value !== null && !Number.isFinite(value)) throw new Error(`Parameter ${id} must be a finite number`);
    return value;
  }
  if (values[baselineCoreParameterId] == null) {
    throw new Error(`Parameter ${baselineCoreParameterId} is unset; fill it before running the script`);
  }
  const baselineCoreC = read(baselineCoreParameterId, null);
  const normalCoreMinC = read(coreMinId, baselineCoreC);
  const normalCoreMaxC = read(coreMaxId, baselineCoreC);
  const ambientComfortMinC = read(airMinId, null);
  const ambientComfortMaxC = read(airMaxId, null);

  if (normalCoreMinC > normalCoreMaxC) {
    throw new Error(`${coreMinId} must be <= ${coreMaxId}`);
  }
  if (baselineCoreC < normalCoreMinC || baselineCoreC > normalCoreMaxC) {
    throw new Error(`${baselineCoreParameterId} must be within [${coreMinId}, ${coreMaxId}]`);
  }
  if ((ambientComfortMinC === null) !== (ambientComfortMaxC === null)) {
    throw new Error(`${ambientComfortMinC === null ? airMinId : airMaxId} is required when its other boundary is set`);
  }
  if (ambientComfortMinC !== null && ambientComfortMaxC !== null && ambientComfortMinC > ambientComfortMaxC) {
    throw new Error(`${airMinId} must be <= ${airMaxId}`);
  }
  return Object.freeze({ baselineCoreC, normalCoreMinC, normalCoreMaxC, ambientComfortMinC, ambientComfortMaxC });
}
