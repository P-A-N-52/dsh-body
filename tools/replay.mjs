import { readFileSync } from 'node:fs';

import * as motility from '../organs/human-organs/stomach/motility.ts';
import * as ghrelin from '../organs/human-organs/stomach/ghrelin.ts';
import * as gastricSensory from '../organs/human-organs/stomach/gastric-sensory.ts';
import * as nutrientExposure from '../organs/human-organs/duodenum/nutrient-exposure.ts';
import * as interoception from '../organs/human-organs/brain/interoception.ts';

const modules = [motility, ghrelin, gastricSensory, nutrientExposure, interoception];
const ROUND_SECONDS = 60;
const defaultScenarioUrl = new URL('../scenarios/m1-water-240.json', import.meta.url);

const scenario = JSON.parse(readFileSync(process.argv[2] ?? defaultScenarioUrl, 'utf8'));

const parts = {};
for (const module of modules) {
  parts[module.id] = structuredClone(module.initialState);
}
for (const [path, value] of Object.entries(scenario.baseline ?? {})) {
  const [partId, field] = path.split('.');
  parts[partId] ??= {};
  parts[partId][field] = value;
}

const observationMinutes = new Set([
  ...(scenario.observe.atMin ?? []),
  ...(scenario.observe.postMealMin ?? []),
]);
const maxRound = Math.max(0, ...observationMinutes);

const actionsByMinute = new Map();
for (const action of scenario.protocol.actions ?? []) {
  const bucket = actionsByMinute.get(action.atMin) ?? [];
  bucket.push(action);
  actionsByMinute.set(action.atMin, bucket);
}

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
  for (const module of modules) {
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

const result = {
  scenario: scenario.id,
  actionLagRounds: 1,
  note: note.join(' '),
  observations,
};

process.stdout.write(JSON.stringify(result, null, 2));
