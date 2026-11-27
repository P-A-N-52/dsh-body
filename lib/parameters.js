import { readFileSync } from 'node:fs';
import {
  baselineCoreParameterId, isThermalRangeParameter, resolveThermalProfile, thermalParametersUrl,
} from './thermal-profile.js';

const DEFAULT_PROFILE = Object.freeze({ weightKg: 75, heightCm: 170 });
const REFERENCE_WEIGHT_KG = 75;
let activeProfile = DEFAULT_PROFILE;
let activeBodyFatPercent = null;
let activeTimezoneOffsetMin = null;
let activeProfileLactating = false;
let activeOverrides = null;
let activeNsfw = null;
let activeThermalDefaults = {};
let activeThermalProfile;
let thermalParameterDefaults;

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Tests whether a value is a number between 0 and 100, inclusive. */
export function isPercent(value) {
  return typeof value === 'number' && value >= 0 && value <= 100;
}

function normalizeProfile(raw) {
  if (raw === undefined || raw === null) return DEFAULT_PROFILE;
  if (!isPlainObject(raw)) {
    throw new Error('Body profile must be a plain object');
  }
  const weightKg = raw.weightKg ?? DEFAULT_PROFILE.weightKg;
  const heightCm = raw.heightCm ?? DEFAULT_PROFILE.heightCm;
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('Body profile weightKg must be a positive finite number');
  }
  if (typeof heightCm !== 'number' || !Number.isFinite(heightCm) || heightCm <= 0) {
    throw new Error('Body profile heightCm must be a positive finite number');
  }
  return Object.freeze({ weightKg, heightCm });
}

function normalizeTimezoneOffsetMin(raw) {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new Error('Body profile must be a plain object');
  }
  const timezoneOffsetMin = raw.timezoneOffsetMin ?? null;
  if (
    timezoneOffsetMin !== null
    && (
      typeof timezoneOffsetMin !== 'number'
      || !Number.isFinite(timezoneOffsetMin)
      || timezoneOffsetMin < -720
      || timezoneOffsetMin > 840
    )
  ) {
    throw new Error('Body profile timezoneOffsetMin must be null or a finite number in [-720, 840]');
  }
  return timezoneOffsetMin;
}

function normalizeProfileLactating(raw) {
  if (raw === undefined || raw === null) return false;
  if (!isPlainObject(raw)) {
    throw new Error('Body profile must be a plain object');
  }
  const lactating = raw.lactating;
  if (lactating === undefined || lactating === null) return false;
  if (typeof lactating !== 'boolean') {
    throw new Error('Body profile lactating must be a boolean');
  }
  return lactating;
}

function normalizeOverrides(raw) {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw new Error('Body parameters overrides must be a plain object');
  }
  const normalized = Object.create(null);
  for (const [id, value] of Object.entries(raw)) {
    if (!id || (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new Error(`Parameter override ${id || '<empty>'} must be null or a finite number`);
    }
    normalized[id] = value;
  }
  return Object.freeze(normalized);
}

function normalizeNsfw(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'boolean') {
    throw new Error('Body nsfw setting must be a boolean');
  }
  return raw;
}

/**
 * Configures body profile, sparse overrides, manifest thermal defaults and the
 * NSFW gate for the current worker before organ modules call `loadParameters()`.
 */
export function setWorkerParameterConfig({ profile, parameters, nsfw, thermalDefaults = {} } = {}) {
  const nextProfile = normalizeProfile(profile);
  const bodyFatPercent = profile?.bodyFatPercent ?? null;
  if (bodyFatPercent !== null && !isPercent(bodyFatPercent)) {
    throw new Error('Body profile bodyFatPercent must be null or a number in [0, 100]');
  }
  activeProfile = nextProfile;
  activeBodyFatPercent = bodyFatPercent;
  activeTimezoneOffsetMin = normalizeTimezoneOffsetMin(profile);
  activeProfileLactating = normalizeProfileLactating(profile);
  activeOverrides = normalizeOverrides(parameters);
  activeNsfw = normalizeNsfw(nsfw);
  activeThermalDefaults = thermalDefaults;
  activeThermalProfile = undefined;
}

/** Returns the frozen static thermal reference for this worker. */
export function getThermalProfile() {
  thermalParameterDefaults ??= readParameterDefaults(thermalParametersUrl);
  return activeThermalProfile ??= resolveThermalProfile(applyParameterConfig(thermalParameterDefaults));
}

/** Returns the authored thermal baseline before any preset or individual override. */
export function getDefaultCoreBaselineC() {
  thermalParameterDefaults ??= readParameterDefaults(thermalParametersUrl);
  return requireParameter(thermalParameterDefaults, baselineCoreParameterId);
}

/** Returns whether NSFW sexual/lactation physiology is enabled (`null` when unconfigured). */
export function getNsfwSetting() {
  return activeNsfw;
}

/** Returns whether the active body profile presets steady-state lactation (`false` when unset). */
export function getProfileLactating() {
  return activeProfileLactating;
}

/** Returns the frozen body profile (`{ weightKg, heightCm }`) for the active worker. */
export function getBodyProfile() {
  return activeProfile;
}

/** Returns the configured whole-body fat mass percentage, or `null` when unknown. */
export function getProfileBodyFatPercent() {
  return activeBodyFatPercent;
}

/** Returns configured timezone offset in minutes from UTC, or `null` when using local host timezone. */
export function getTimezoneOffsetMin() {
  return activeTimezoneOffsetMin;
}

/** Returns whether an explicit per-body override was provided for `id`. */
export function hasParameterOverride(id) {
  return activeOverrides !== null && Object.hasOwn(activeOverrides, id);
}

/** Returns the explicit per-body override value for `id`, or `undefined` when not overridden. */
export function getParameterOverride(id) {
  return hasParameterOverride(id) ? activeOverrides[id] : undefined;
}

/**
 * Scales a baseline weight-dependent value by `weightKg / 75` unless `parameterId`
 * has an explicit per-body override in the active body checkpoint.
 */
export function scaleByBodyWeight(value, parameterId) {
  const { weightKg } = getBodyProfile();
  if (weightKg === REFERENCE_WEIGHT_KG) return value;
  if (parameterId !== undefined && hasParameterOverride(parameterId)) return value;
  return value * (weightKg / REFERENCE_WEIGHT_KG);
}

/** Returns a numeric per-body override for `id`, or `undefined` if unset/non-numeric. */
export function getNumericParameterOverride(id) {
  const override = getParameterOverride(id);
  return typeof override === 'number' ? override : undefined;
}

function readParameterDefaults(parametersUrl) {
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

function applyParameterConfig(defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([id, value]) => {
    const override = getParameterOverride(id);
    // Null is a missing override only for the four optional thermal boundaries.
    if (isThermalRangeParameter(id)) return [id, override ?? activeThermalDefaults[id] ?? value];
    if (override !== undefined) return [id, override];
    return [id, activeThermalDefaults[id] ?? value];
  }));
}

export function loadParameters(parametersUrl) {
  return applyParameterConfig(readParameterDefaults(parametersUrl));
}

export function requireParameter(values, id) {
  if (!Object.hasOwn(values, id) || values[id] === null || values[id] === undefined) {
    throw new Error(`Parameter ${id} is unset; fill it before running the script`);
  }
  return values[id];
}
