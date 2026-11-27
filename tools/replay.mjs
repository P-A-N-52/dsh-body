import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maxNotificationTextLength, readManifest } from '../gateway/config.js';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { assertJsonValue, isPlainObject as isRecord } from '../json-safe.js';
import { getThermalProfile, setWorkerParameterConfig } from '../lib/parameters.js';
import * as motility from '../organs/human-organs/stomach/motility.ts';
import * as ghrelin from '../organs/human-organs/stomach/ghrelin.ts';
import * as gastricSensory from '../organs/human-organs/stomach/gastric-sensory.ts';
import * as nutrientExposure from '../organs/human-organs/duodenum/nutrient-exposure.ts';
import * as interoception from '../organs/human-organs/brain/interoception.ts';

const legacyModules = [motility, ghrelin, gastricSensory, nutrientExposure, interoception];
const ROUND_SECONDS = 60;
const defaultScenarioUrl = new URL('../scenarios/m1-water-240.json', import.meta.url);
const defaultManifestPath = fileURLToPath(new URL('../body-modules.json', import.meta.url));

function looksLikeScenarioFile(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
    return isRecord(parsed)
      && !Array.isArray(parsed.scripts)
      && (isRecord(parsed.observe) || isRecord(parsed.protocol));
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  let useManifest = false;
  let manifestArg = null;
  const extraSignals = [];
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') {
      useManifest = true;
      const next = argv[i + 1];
      const hasLaterPositional = argv.slice(i + 2).some((item) => !item.startsWith('-'));
      if (
        next !== undefined
        && !next.startsWith('-')
        && (positionals.length > 0 || hasLaterPositional || !looksLikeScenarioFile(next))
      ) {
        manifestArg = next;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      useManifest = true;
      const value = arg.slice('--manifest='.length);
      manifestArg = value || null;
      continue;
    }
    if (arg === '--signals' && argv[i + 1] !== undefined) {
      extraSignals.push(...argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
      continue;
    }
    if (arg.startsWith('--signals=')) {
      extraSignals.push(
        ...arg.slice('--signals='.length).split(',').map((s) => s.trim()).filter(Boolean),
      );
      continue;
    }
    positionals.push(arg);
  }

  return {
    useManifest,
    manifestArg,
    scenarioInput: positionals[0] ?? defaultScenarioUrl,
    extraSignals,
  };
}

function applyBaseline(parts, baseline) {
  for (const [path, value] of Object.entries(baseline ?? {})) {
    const [partId, field] = path.split('.');
    parts[partId] ??= {};
    parts[partId][field] = value;
  }
}

function buildActionsByMinute(actions) {
  const actionsByMinute = new Map();
  for (const action of actions ?? []) {
    const bucket = actionsByMinute.get(action.atMin) ?? [];
    bucket.push(action);
    actionsByMinute.set(action.atMin, bucket);
  }
  return actionsByMinute;
}

function readStatePath(parts, path) {
  let value = parts;
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

async function runLegacyReplay(scenario) {
  const parts = {};
  for (const module of legacyModules) {
    parts[module.id] = structuredClone(module.initialState);
  }
  applyBaseline(parts, scenario.baseline);

  const observationMinutes = new Set([
    ...(scenario.observe.atMin ?? []),
    ...(scenario.observe.postMealMin ?? []),
  ]);
  const maxRound = Math.max(0, ...observationMinutes);
  const actionsByMinute = buildActionsByMinute(scenario.protocol.actions);

  const observations = [];
  function observe(simMin) {
    const entry = { simMin };
    for (const signal of scenario.observe.signals) {
      const [partId, field] = signal.split('.');
      entry[signal] = parts[partId]?.[field] ?? null;
    }
    observations.push(entry);
  }

  observe(0);

  for (let round = 1; round <= maxRound; round += 1) {
    const start = structuredClone(parts);
    const writes = new Map();
    for (const module of legacyModules) {
      await module.heartbeat({
        read: (id) => (id === undefined ? start : start[id]),
        actions: actionsByMinute.get(round - 1) ?? [],
        dt: ROUND_SECONDS,
        simulatedSeconds: round * ROUND_SECONDS,
        write: (next) => { writes.set(module.id, next); },
      });
    }
    for (const [id, next] of writes) parts[id] = next;
    if (observationMinutes.has(round)) observe(round);
  }

  const note = [
    '动作在下一轮生效：第 t 轮投递 atMin = t - 1 的动作（actionLagRounds = 1），atMin = 0 的动作在第 1 轮生效；观察值取轮末已提交状态。',
    'P1 产出体感：interoception.hunger / fullness 是 design 线性代理读出，不是论文 VAS 拟合。',
  ];

  return {
    scenario: scenario.id,
    actionLagRounds: 1,
    note: note.join(' '),
    observations,
  };
}

async function runManifestReplay(scenario, { manifestArg, extraSignals }) {
  const resolvedManifestPath = manifestArg ? resolve(manifestArg) : defaultManifestPath;
  const manifest = readManifest(resolvedManifestPath);
  setWorkerParameterConfig({ thermalDefaults: manifest.thermalDefaults });
  const thermalProfile = getThermalProfile();

  const loaded = [];
  const byId = new Map();
  for (const { url, inject } of manifest.scripts) {
    const script = await import(url);
    if (typeof script.id !== 'string' || !script.id || typeof (script.heartbeat ?? script.step) !== 'function') {
      throw new Error(`Invalid body module at ${url}`);
    }
    if (byId.has(script.id)) {
      throw new Error(`Heartbeat script ids must be unique: ${script.id}`);
    }
    const entry = {
      id: script.id,
      initialState: structuredClone(script.initialState ?? {}),
      fields: structuredClone(script.fields),
      heartbeat: script.heartbeat,
      step: script.step,
      functions: script.functions ?? {},
      inject,
    };
    byId.set(entry.id, entry);
    loaded.push(entry);
  }

  const registry = createFieldRegistry(loaded);

  let parts = {};
  for (const entry of loaded) {
    parts[entry.id] = structuredClone(entry.initialState);
  }
  applyBaseline(parts, scenario.baseline);

  const signals = [...scenario.observe.signals];
  for (const defaultSignal of ['bodyFluid.waterVolumeMl', 'thermoregulation.coreTemperatureC']) {
    const [partId] = defaultSignal.split('.');
    if (byId.has(partId) && !signals.includes(defaultSignal)) {
      signals.push(defaultSignal);
    }
  }
  for (const signal of extraSignals) {
    if (!signals.includes(signal)) signals.push(signal);
  }

  const observationMinutes = new Set([
    ...(scenario.observe.atMin ?? []),
    ...(scenario.observe.postMealMin ?? []),
  ]);
  const maxRound = Math.max(0, ...observationMinutes);
  const actionsByMinute = buildActionsByMinute(scenario.protocol.actions);

  const observations = [];
  const notifications = [];

  function observe(simMin) {
    const entry = { simMin };
    for (const signal of signals) {
      const [partId, field] = signal.split('.');
      entry[signal] = parts[partId]?.[field] ?? null;
    }
    observations.push(entry);
  }

  observe(0);

  for (let round = 1; round <= maxRound; round += 1) {
    const simulatedSeconds = round * ROUND_SECONDS;
    const wallTimeMs = simulatedSeconds * 1000;
    const snapshot = { simulatedSeconds, parts: structuredClone(parts) };
    const actions = actionsByMinute.get(round - 1) ?? [];

    function read(id) {
      if (id === undefined) return snapshot;
      return Object.hasOwn(snapshot.parts, id) ? snapshot.parts[id] : undefined;
    }

    const contexts = new Map();
    const common = { read, getThermalProfile: () => thermalProfile, actions, dt: ROUND_SECONDS, simulatedSeconds, wallTimeMs };
    const legacyContext = Object.freeze({
      ...common,
      call(id, name, ...args) {
        const functions = byId.get(id)?.functions;
        if (!functions || !Object.hasOwn(functions, name)) {
          throw new Error(`Unknown body function ${id}.${name}`);
        }
        return functions[name](contexts.get(id), ...args);
      },
    });
    for (const entry of loaded) {
      if (entry.inject === null) {
        contexts.set(entry.id, legacyContext);
        continue;
      }
      const functions = Object.create(null);
      for (const [alias, path] of entry.inject) {
        const value = readStatePath(snapshot.parts, path);
        functions[alias] = () => value;
      }
      contexts.set(entry.id, Object.freeze({ ...common, functions: Object.freeze(functions) }));
    }

    const writes = {};
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
      notifications.push({ simMin: round, mode, sessionId, text });
    }

    for (const entry of loaded) {
      function write(value) {
        const copy = structuredClone(value);
        if (!isRecord(copy)) throw new Error('write expects the next state as an object');
        assertJsonValue(copy, 'part');
        writes[entry.id] = copy;
      }

      function add(partId, field, delta) {
        adds.push({ caller: entry.id, partId, field, delta });
      }

      function transfer(fromPart, fromField, toPart, toField, amount) {
        transfers.push({ caller: entry.id, fromPart, fromField, toPart, toField, amount });
      }

      if (entry.heartbeat != null) {
        await entry.heartbeat(Object.freeze({ ...contexts.get(entry.id), write, notify, add, transfer }));
      } else {
        write(await entry.step(snapshot, ROUND_SECONDS, actions));
      }
    }

    const nextParts = applyOperations({
      registry,
      snapshotParts: snapshot.parts,
      writes,
      adds,
      transfers,
    });
    parts = { ...snapshot.parts, ...nextParts };
    if (observationMinutes.has(round)) observe(round);
  }

  return {
    scenario: scenario.id,
    manifest: {
      path: manifestArg ?? 'body-modules.json',
      scriptCount: loaded.length,
    },
    actionLagRounds: 1,
    note: '全清单仿真回放：第 t 轮投递 atMin = t - 1 的动作（actionLagRounds = 1），按 createFieldRegistry 与 applyOperations 整轮原子提交 write/add/transfer 与 notify。',
    observations,
    notifications,
  };
}

const args = parseArgs(process.argv.slice(2));
const scenario = JSON.parse(readFileSync(args.scenarioInput, 'utf8'));
const result = args.useManifest
  ? await runManifestReplay(scenario, args)
  : await runLegacyReplay(scenario);

process.stdout.write(JSON.stringify(result, null, 2));
