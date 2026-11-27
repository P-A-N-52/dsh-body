import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isPlainObject as isRecord } from './json-safe.js';

export const mealKinds = ['liquid', 'solid', 'mixed'];
export const BASE_ACTION_TYPES = [
  'drink',
  'eat',
  'urinate',
  'defecate',
  'exercise',
  'stop_exercise',
  'sleep',
  'wake_up',
];
export const NSFW_ACTION_TYPES = ['sex', 'orgasm', 'express_milk', 'breastfeed'];
export const ZERO_PAYLOAD_ACTION_TYPES = [
  'urinate',
  'defecate',
  'stop_exercise',
  'sleep',
  'wake_up',
  'orgasm',
];
export const TRANSLATABLE_ACTION_TYPES = [
  'eat',
  'drink',
  'exercise',
  'sex',
  'express_milk',
  'breastfeed',
];
export const DEFAULT_MAX_HISTORY_PER_TYPE = 100;
export const DEFAULT_SIMILAR_REFERENCE_LIMIT = 4;
export const DEFAULT_RECENT_REFERENCE_LIMIT = 2;
export const DEFAULT_MIN_SIMILARITY_SCORE = 0.15;
export const DEFAULT_TRANSLATOR_TIMEOUT_MS = 20_000;
export const DEFAULT_TRANSLATOR_MAX_ATTEMPTS = 2;
export const TRANSLATOR_TOOL_NAME = 'submit_translated_actions';
export const HISTORY_FILE_RELATIVE = join('logs', 'action-translations.json');

const QUANTITATIVE_OVERRIDE_KEYS = [
  'volumeMl',
  'energyKcal',
  'carbohydrateG',
  'mealKind',
  'durationMin',
  'intensity',
  'exertion',
  'bilateral',
];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function tryGetService(ctx, serviceName) {
  try {
    return ctx?.get?.(serviceName) ?? null;
  } catch {
    return null;
  }
}

export function validateExercise(args) {
  if (!isFiniteNumber(args.intensity) || args.intensity <= 0 || args.intensity > 1) {
    return 'intensity must be a finite number greater than 0 and at most 1';
  }
  if (!isFiniteNumber(args.durationMin) || args.durationMin <= 0) {
    return 'durationMin must be a finite number greater than 0';
  }
  if (
    args.type === 'sex'
    && args.exertion !== undefined
    && (!isFiniteNumber(args.exertion) || args.exertion < 0 || args.exertion > 1)
  ) {
    return 'exertion must be a finite number between 0 and 1';
  }
  return null;
}

export function validateLactationAction(args) {
  if (args.durationMin !== undefined && (!isFiniteNumber(args.durationMin) || args.durationMin <= 0 || args.durationMin > 120)) {
    return 'durationMin must be a finite number greater than 0 and at most 120';
  }
  if (args.bilateral !== undefined && typeof args.bilateral !== 'boolean') {
    return 'bilateral must be a boolean';
  }
  return null;
}

export function validateStructuredAction(args, extraActionTypes = [], nsfwEnabled = false) {
  if (!isRecord(args)) return 'action must be a plain object';
  if (NSFW_ACTION_TYPES.includes(args.type) && !nsfwEnabled) {
    return 'NSFW actions are disabled for this body';
  }
  if (args.type === 'orgasm') {
    if (args.continueStimulation !== undefined && typeof args.continueStimulation !== 'boolean') {
      return 'continueStimulation must be a boolean';
    }
    return null;
  }
  if (ZERO_PAYLOAD_ACTION_TYPES.includes(args.type)) {
    return null;
  }
  if (args.type === 'exercise' || args.type === 'sex') return validateExercise(args);
  if (args.type === 'express_milk' || args.type === 'breastfeed') return validateLactationAction(args);
  if (extraActionTypes.includes(args.type)) return null;
  if (args.type !== 'drink' && args.type !== 'eat') {
    const allowed = [
      ...BASE_ACTION_TYPES,
      ...(nsfwEnabled ? NSFW_ACTION_TYPES : []),
      ...extraActionTypes,
    ];
    return `type must be one of ${allowed.join(', ')}`;
  }
  if (!isFiniteNumber(args.volumeMl) || args.volumeMl <= 0) {
    return 'volumeMl must be a finite number greater than 0';
  }
  if (args.durationMin !== undefined && (!isFiniteNumber(args.durationMin) || args.durationMin < 0)) {
    return 'durationMin must be a finite number greater than or equal to 0';
  }
  if (args.carbohydrateG !== undefined && (!isFiniteNumber(args.carbohydrateG) || args.carbohydrateG < 0)) {
    return 'carbohydrateG must be a finite number greater than or equal to 0';
  }
  if (args.type === 'drink') {
    if (args.energyKcal !== undefined && (!isFiniteNumber(args.energyKcal) || args.energyKcal < 0)) {
      return 'energyKcal must be a finite number greater than or equal to 0';
    }
    return null;
  }
  if (!isFiniteNumber(args.energyKcal) || args.energyKcal < 0) {
    return 'eat requires a finite energyKcal greater than or equal to 0';
  }
  if (!mealKinds.includes(args.mealKind)) {
    return 'eat requires mealKind liquid, solid, or mixed';
  }
  return null;
}

export function validateOptionalNumericOverrides(args) {
  if (!isRecord(args)) return null;
  if (args.volumeMl !== undefined && (!isFiniteNumber(args.volumeMl) || args.volumeMl <= 0)) {
    return 'volumeMl must be a finite number greater than 0';
  }
  if (args.energyKcal !== undefined && (!isFiniteNumber(args.energyKcal) || args.energyKcal < 0)) {
    return 'energyKcal must be a finite number greater than or equal to 0';
  }
  if (args.carbohydrateG !== undefined && (!isFiniteNumber(args.carbohydrateG) || args.carbohydrateG < 0)) {
    return 'carbohydrateG must be a finite number greater than or equal to 0';
  }
  if (args.mealKind !== undefined && !mealKinds.includes(args.mealKind)) {
    return 'eat requires mealKind liquid, solid, or mixed';
  }
  if (args.durationMin !== undefined) {
    const isActivity = args.type === 'exercise' || args.type === 'sex';
    const isLactation = args.type === 'express_milk' || args.type === 'breastfeed';
    if (
      !isFiniteNumber(args.durationMin)
      || (isLactation
        ? (args.durationMin <= 0 || args.durationMin > 120)
        : (isActivity ? args.durationMin <= 0 : args.durationMin < 0))
    ) {
      return isLactation
        ? 'durationMin must be a finite number greater than 0 and at most 120'
        : isActivity
          ? 'durationMin must be a finite number greater than 0'
          : 'durationMin must be a finite number greater than or equal to 0';
    }
  }
  if (args.intensity !== undefined && (!isFiniteNumber(args.intensity) || args.intensity <= 0 || args.intensity > 1)) {
    return 'intensity must be a finite number greater than 0 and at most 1';
  }
  if (args.exertion !== undefined && (!isFiniteNumber(args.exertion) || args.exertion < 0 || args.exertion > 1)) {
    return 'exertion must be a finite number between 0 and 1';
  }
  if (args.continueStimulation !== undefined && typeof args.continueStimulation !== 'boolean') {
    return 'continueStimulation must be a boolean';
  }
  if (args.bilateral !== undefined && typeof args.bilateral !== 'boolean') {
    return 'bilateral must be a boolean';
  }
  return null;
}

export function extractExplicitOverrides(args) {
  const overrides = {};
  if (!isRecord(args)) return overrides;
  for (const key of QUANTITATIVE_OVERRIDE_KEYS) {
    if (args[key] !== undefined) overrides[key] = args[key];
  }
  return overrides;
}

export function hasCompleteDirectFields(args) {
  if (!isRecord(args)) return false;
  if (args.type === 'drink') {
    return isFiniteNumber(args.volumeMl) && args.volumeMl > 0;
  }
  if (args.type === 'eat') {
    return isFiniteNumber(args.volumeMl) && args.volumeMl > 0
      && isFiniteNumber(args.energyKcal) && args.energyKcal >= 0
      && mealKinds.includes(args.mealKind);
  }
  if (args.type === 'exercise' || args.type === 'sex') {
    return isFiniteNumber(args.intensity) && args.intensity > 0 && args.intensity <= 1
      && isFiniteNumber(args.durationMin) && args.durationMin > 0;
  }
  if (args.type === 'express_milk' || args.type === 'breastfeed') {
    return isFiniteNumber(args.durationMin) && args.durationMin > 0 && args.durationMin <= 120;
  }
  return true;
}

export function stripTranslatorInputFields(args) {
  const copy = { ...args };
  delete copy.description;
  return copy;
}

export function resolveTranslationHistoryPath(gateway, options = {}) {
  if (isNonEmptyString(options?.historyPath)) {
    return options.historyPath.trim();
  }
  const statePath = typeof gateway?.getStatePath === 'function'
    ? gateway.getStatePath()
    : options?.statePath;
  if (isNonEmptyString(statePath)) {
    return join(dirname(statePath.trim()), HISTORY_FILE_RELATIVE);
  }
  return null;
}

function normalizeDescriptionText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function tokenizeForSimilarity(text) {
  const normalized = normalizeDescriptionText(text);
  const unigrams = new Set();
  const bigrams = new Set();
  const segments = normalized.match(/[\p{Letter}\p{Number}]+/gu) ?? [];
  for (const segment of segments) {
    const chars = [...segment];
    for (const ch of chars) unigrams.add(ch);
    for (let i = 0; i < chars.length - 1; i += 1) {
      bigrams.add(`${chars[i]}${chars[i + 1]}`);
    }
    if (/[a-z0-9]/i.test(segment) && chars.length > 2) {
      bigrams.add(`w:${segment}`);
    }
  }
  return { normalized, unigrams, bigrams };
}

function setDiceSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const item of smaller) {
    if (larger.has(item)) intersection += 1;
  }
  return (2 * intersection) / (setA.size + setB.size);
}

export function scoreDescriptionSimilarity(query, candidate) {
  const a = tokenizeForSimilarity(query);
  const b = tokenizeForSimilarity(candidate);
  if (!a.normalized || !b.normalized) return 0;
  if (a.normalized === b.normalized) return 1;
  const bigramDice = setDiceSimilarity(a.bigrams, b.bigrams);
  const unigramDice = setDiceSimilarity(a.unigrams, b.unigrams);
  const score = (a.bigrams.size > 0 && b.bigrams.size > 0)
    ? 0.7 * bigramDice + 0.3 * unigramDice
    : unigramDice;
  const shorterLen = Math.min(a.normalized.length, b.normalized.length);
  if (shorterLen >= 2 && (a.normalized.includes(b.normalized) || b.normalized.includes(a.normalized))) {
    return Math.min(1, Math.max(score, 0.55));
  }
  return score;
}

function emptyHistoryDocument() {
  return { version: 1, byType: {} };
}

function normalizeHistoryEntry(entry) {
  if (!isRecord(entry) || !isNonEmptyString(entry.type) || !isNonEmptyString(entry.description)) {
    return null;
  }
  if (!Array.isArray(entry.actions) || entry.actions.length === 0) return null;
  return {
    type: entry.type,
    description: entry.description.trim(),
    actions: entry.actions.map((action) => ({ ...action })),
    ...(isFiniteNumber(entry.simulatedSeconds) ? { simulatedSeconds: entry.simulatedSeconds } : {}),
    ...(isFiniteNumber(entry.wallTimeMs) ? { wallTimeMs: entry.wallTimeMs } : {}),
  };
}

const DISALLOWED_HISTORY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeHistoryDocument(raw, maxEntriesPerType) {
  if (!isRecord(raw) || !isRecord(raw.byType)) return emptyHistoryDocument();
  const byType = {};
  for (const type of Object.keys(raw.byType)) {
    if (DISALLOWED_HISTORY_KEYS.has(type)) continue;
    const rawList = raw.byType[type];
    if (!Array.isArray(rawList)) continue;
    const normalized = rawList
      .map(normalizeHistoryEntry)
      .filter((item) => item !== null && item.type === type);
    if (normalized.length > 0) {
      byType[type] = normalized.slice(-maxEntriesPerType);
    }
  }
  return { version: 1, byType };
}

export function selectReferenceTranslations(
  historyDoc,
  type,
  description,
  {
    scanLimit = DEFAULT_MAX_HISTORY_PER_TYPE,
    maxSimilar = DEFAULT_SIMILAR_REFERENCE_LIMIT,
    maxRecent = DEFAULT_RECENT_REFERENCE_LIMIT,
    minScore = DEFAULT_MIN_SIMILARITY_SCORE,
  } = {},
) {
  const entries = Array.isArray(historyDoc?.byType?.[type])
    ? historyDoc.byType[type].slice(-scanLimit)
    : [];
  if (entries.length === 0) {
    return { similar: [], recent: [] };
  }

  const scored = [];
  for (let idx = 0; idx < entries.length; idx += 1) {
    const entry = entries[idx];
    const score = scoreDescriptionSimilarity(description, entry.description);
    if (score >= minScore) {
      scored.push({ entry, idx, score });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || (b.idx - a.idx));

  const chosenIndices = new Set();
  const similar = [];
  for (const item of scored.slice(0, maxSimilar)) {
    chosenIndices.add(item.idx);
    similar.push({
      ...item.entry,
      similarity: Number(item.score.toFixed(3)),
    });
  }

  const recent = [];
  for (let idx = entries.length - 1; idx >= 0 && recent.length < maxRecent; idx -= 1) {
    if (chosenIndices.has(idx)) continue;
    recent.push({ ...entries[idx] });
  }
  recent.reverse();

  return { similar, recent };
}

export function createBodyTranslationStore(
  historyPath,
  { maxEntriesPerType = DEFAULT_MAX_HISTORY_PER_TYPE } = {},
) {
  if (!Number.isInteger(maxEntriesPerType) || maxEntriesPerType < 1) {
    throw new TypeError('maxEntriesPerType must be a positive integer');
  }
  let memoryDoc = emptyHistoryDocument();
  let writeQueue = Promise.resolve();

  function loadCurrentDoc() {
    if (!historyPath) return memoryDoc;
    if (!existsSync(historyPath)) return emptyHistoryDocument();
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'));
      return normalizeHistoryDocument(parsed, maxEntriesPerType);
    } catch {
      return emptyHistoryDocument();
    }
  }

  function saveDoc(doc) {
    if (!historyPath) {
      memoryDoc = doc;
      return;
    }
    const dir = dirname(historyPath);
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, `.${basename(historyPath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      writeFileSync(tmpPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      renameSync(tmpPath, historyPath);
    } catch (error) {
      rmSync(tmpPath, { force: true });
      throw error;
    }
  }

  async function withLock(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  }

  return {
    historyPath,
    maxEntriesPerType,
    async getReferences(type, description, options = {}) {
      return withLock(() => selectReferenceTranslations(
        loadCurrentDoc(),
        type,
        description,
        { scanLimit: maxEntriesPerType, ...options },
      ));
    },
    async record(entry) {
      const normalized = normalizeHistoryEntry(entry);
      if (!normalized) return null;
      return withLock(() => {
        const doc = loadCurrentDoc();
        const current = Array.isArray(doc.byType[normalized.type]) ? doc.byType[normalized.type] : [];
        const updated = [...current, normalized].slice(-maxEntriesPerType);
        const nextDoc = {
          version: 1,
          byType: {
            ...doc.byType,
            [normalized.type]: updated,
          },
        };
        saveDoc(nextDoc);
        return nextDoc.byType[normalized.type].length;
      });
    },
  };
}

export function buildTranslatorToolSchema(allowedQuantitativeTypes) {
  const allowed = allowedQuantitativeTypes.length > 0
    ? [...allowedQuantitativeTypes]
    : ['eat', 'drink', 'exercise'];
  return {
    name: TRANSLATOR_TOOL_NAME,
    description: 'Submit 1 to 4 quantitative somatic action objects translated from the natural-language description.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Ordered list of 1 to 4 concrete physiological actions.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: allowed },
              volumeMl: { type: 'number', description: 'Intake volume in mL (> 0, required for eat/drink).' },
              energyKcal: { type: 'number', description: 'Intake energy in kcal (>= 0, required for eat, optional for drink).' },
              carbohydrateG: {
                type: 'number',
                description: 'Digestible carbohydrate in grams as glucose equivalents (>= 0; omit only if unknown).',
              },
              mealKind: {
                type: 'string',
                enum: mealKinds,
                description: 'Required for eat: solid, liquid, or mixed.',
              },
              durationMin: {
                type: 'number',
                description: 'Duration in minutes (> 0 required for exercise/sex; > 0 optional for express_milk/breastfeed; >= 0 optional for eat/drink).',
              },
              intensity: {
                type: 'number',
                description: 'Relative intensity in (0, 1] (required for exercise/sex; for sex this represents arousal/sensory stimulation intensity).',
              },
              exertion: {
                type: 'number',
                description: 'Optional whole-body skeletal-muscle exertion in [0, 1] for sex (0–0.08 for lying/solo stimulation or foreplay, 0.30–0.65 for active partnered intercourse).',
              },
              bilateral: {
                type: 'boolean',
                description: 'Optional for express_milk/breastfeed: true if expressing or nursing from both breasts.',
              },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        tasteFeedback: {
          type: 'string',
          description: 'Optional only when eat or drink actions are included: short digit-free qualitative Chinese sensory/flavor/temperature/texture taste description. Omit for non-intake actions.',
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
  };
}

export function buildTranslatorSystemPrompt({ nsfwEnabled = false } = {}) {
  const lines = [
    '你是虚拟身体 Gateway 的“动作定量翻译官”。你的唯一职责是把自然语言身体动作描述精准翻译为客观生理参数，并通过调用 submit_translated_actions 工具提交。',
    '严禁直接回复正文或解释说明，必须调用 submit_translated_actions 一次。',
    '',
    '各动作类型与单位约定（全部仅填客观数值与枚举）：',
    '- eat：必填 volumeMl（> 0，食团总体积 mL）、energyKcal（>= 0，kcal）、mealKind（solid | liquid | mixed）；推荐填 carbohydrateG（>= 0，可消化葡萄糖当量克数 g）；可选 durationMin（>= 0，进食耗时 min，如一口约 0.5、加餐约 5、正餐约 15）。',
    '- drink：必填 volumeMl（> 0，mL）；纯水/无糖茶/黑咖啡等可设 energyKcal = 0 或省略，含糖/奶/酒饮品给出 energyKcal（>= 0）与 carbohydrateG（>= 0）；可选 durationMin（>= 0）。',
    '- exercise：必填 intensity（0 < intensity <= 1）与 durationMin（> 0，min）。强度参考：散步慢走 0.15–0.25，快走/家务 0.30–0.45，慢跑/中速骑行 0.50–0.65，高强度跑/HIIT 0.75–0.90，极限冲刺 0.95–1.0。',
  ];
  if (nsfwEnabled) {
    lines.push('- sex：必填 intensity（0 < intensity <= 1，代表局部/感官性刺激强度：温和 0.25–0.40、中等 0.45–0.65、剧烈 0.70–0.85）、durationMin（> 0，min）与 exertion（0 <= exertion <= 1，代表全身骨骼肌体力负荷：躺卧轻抚或单人轻柔自慰设 0–0.08，非插入伴侣爱抚设 0.08–0.20，主动伴侣性交设 0.30–0.65）。');
    lines.push('- express_milk / breastfeed：可选 durationMin（0 < durationMin <= 120，单次吸奶/哺乳耗时 min，如简短 8–10、常规 15–20）与 bilateral（boolean，是否双侧）。');
  }
  lines.push(
    '',
    '常见份量锚点参考：',
    '- 一小口米饭 ≈ volumeMl: 25, energyKcal: 32, carbohydrateG: 7, mealKind: "solid", durationMin: 0.5',
    '- 一小碗米饭（~150 g 熟饭）≈ volumeMl: 180, energyKcal: 175, carbohydrateG: 40, mealKind: "solid", durationMin: 8',
    '- 一碗带汤牛肉面 ≈ volumeMl: 550, energyKcal: 520, carbohydrateG: 65, mealKind: "mixed", durationMin: 15',
    '- 一小口水/茶 ≈ volumeMl: 25, energyKcal: 0, durationMin: 0.2；一杯水 ≈ volumeMl: 220, energyKcal: 0, durationMin: 1',
    '- 半听/半瓶可乐（~165 mL）≈ volumeMl: 165, energyKcal: 70, carbohydrateG: 17.5, durationMin: 2',
    '',
    '一致性与拆分原则：',
    '1. 若提供了同身体“相似历史参考”或“近期连续参考”，在相同食物/习惯和连续指代（如“又吃了一口”“把剩下的喝完”）上保持量级与比例严格一致。',
    '2. 若单条吃喝描述里明显同时包含固体餐食和伴随饮品（如“吃了半碗饭，喝了两口可乐”），可拆为有序多条（如 eat + drink，最多 4 条）；单一动作不要无故拆分。',
    '3. 若调用方给出了 explicitConstraints（如指定了 durationMin），输出须严格遵循。',
    '4. 仅当动作包含 eat 或 drink 时，顺手在顶层 tasteFeedback 给出一句简短纯定性、严禁包含任何阿拉伯或全角数字的中文味道与口感反馈（风味、酸甜苦辣咸鲜、冷热温度感、脆嫩滑腻与余味）；非吃喝动作不要填 tasteFeedback，也不要因味觉追加不存在的生理字段。',
  );
  return lines.join('\n');
}

export function buildTranslatorUserPrompt({
  type,
  description,
  explicitConstraints = {},
  similar = [],
  recent = [],
  retryError = null,
}) {
  const parts = [
    '请把以下身体动作描述翻译为定量动作参数，并立即调用 submit_translated_actions：',
    `当前请求动作类型：${type}`,
    `当前动作描述：${JSON.stringify(description)}`,
  ];
  if (Object.keys(explicitConstraints).length > 0) {
    parts.push(`调用方已明确的约束字段（须严格保持一致）：${JSON.stringify(explicitConstraints)}`);
  }
  if (similar.length > 0) {
    parts.push('同身体、同类型动作的相似历史参考（优先对齐估算口径）：');
    for (const ref of similar) {
      parts.push(`- 描述 ${JSON.stringify(ref.description)} (相似度 ${ref.similarity}) -> ${JSON.stringify(ref.actions)}`);
    }
  }
  if (recent.length > 0) {
    parts.push('同身体、同类型动作的最近连续记录（用于理解“又一口/剩下/继续”）：');
    for (const ref of recent) {
      parts.push(`- 描述 ${JSON.stringify(ref.description)} -> ${JSON.stringify(ref.actions)}`);
    }
  }
  if (isNonEmptyString(retryError)) {
    parts.push(`注意：上一次转换校验失败（${retryError}），请修正后严格按 schema 调用 submit_translated_actions。`);
  }
  return parts.join('\n');
}

export function resolveLlmRoute(ctx, exec, config = {}) {
  if (isNonEmptyString(config?.provider) && isNonEmptyString(config?.model)) {
    return { provider: config.provider.trim(), model: config.model.trim() };
  }
  const headerConfig = exec?.agent?.session?.requestHeader?.()?.config;
  if (isNonEmptyString(headerConfig?.provider) && isNonEmptyString(headerConfig?.model)) {
    return { provider: headerConfig.provider.trim(), model: headerConfig.model.trim() };
  }
  const agentOptions = exec?.agent?.options;
  if (isNonEmptyString(agentOptions?.provider) && isNonEmptyString(agentOptions?.model)) {
    return { provider: agentOptions.provider.trim(), model: agentOptions.model.trim() };
  }
  const defaultModel = tryGetService(ctx, 'agentDefaultModel');
  const selection = typeof defaultModel?.currentSelection === 'function'
    ? defaultModel.currentSelection()
    : null;
  if (isNonEmptyString(selection?.provider) && isNonEmptyString(selection?.model)) {
    return { provider: selection.provider.trim(), model: selection.model.trim() };
  }
  return null;
}

async function resolveOptionalReasoningEffort(llm, route, config, signal) {
  if (isNonEmptyString(config?.reasoningEffort)) {
    return config.reasoningEffort.trim();
  }
  if (typeof llm?.resolveModelInfo !== 'function') {
    return undefined;
  }
  try {
    const info = await llm.resolveModelInfo(route.provider, route.model, signal);
    if (Array.isArray(info?.supportedReasoningEfforts) && info.supportedReasoningEfforts.includes('off')) {
      return 'off';
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function collectStreamBlocks(stream, signal) {
  const order = [];
  const partials = new Map();
  let finish = { kind: 'stop' };

  function ensure(index, blockType) {
    let partial = partials.get(index);
    if (!partial) {
      partial = { blockType, text: '', toolCallName: '', toolCallArguments: '' };
      partials.set(index, partial);
      order.push(index);
    }
    return partial;
  }

  for await (const chunk of stream) {
    if (signal?.aborted) {
      const err = new Error('Action translation aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (!chunk || typeof chunk !== 'object') continue;
    switch (chunk.type) {
      case 'block-start': {
        if (!partials.has(chunk.index)) {
          order.push(chunk.index);
          partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: '',
            toolCallName: '',
            toolCallArguments: '',
          });
        }
        break;
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning');
        if (!partial.block && typeof chunk.text === 'string') partial.text += chunk.text;
        break;
      }
      case 'tool-call-delta': {
        const partial = ensure(chunk.index, 'tool-call');
        if (!partial.block) {
          if (chunk.id !== undefined) partial.toolCallId = chunk.id;
          if (typeof chunk.name === 'string' && chunk.name) partial.toolCallName = chunk.name;
          if (typeof chunk.argumentsDelta === 'string') partial.toolCallArguments += chunk.argumentsDelta;
        }
        break;
      }
      case 'block-end': {
        const partial = ensure(chunk.index, chunk.block?.type ?? 'text');
        if (!partial.block && chunk.block) partial.block = chunk.block;
        break;
      }
      case 'finish': {
        if (chunk.reason) finish = chunk.reason;
        break;
      }
      default:
        break;
    }
  }

  const blocks = order.map((index) => {
    const partial = partials.get(index);
    if (partial.block) return partial.block;
    if (partial.blockType === 'tool-call') {
      return {
        type: 'tool-call',
        id: partial.toolCallId ?? `call-${index}`,
        name: partial.toolCallName ?? '',
        arguments: partial.toolCallArguments ?? '',
      };
    }
    return { type: partial.blockType, text: partial.text ?? '' };
  });

  return { finish, blocks };
}

function sanitizeTranslatedAction(rawAction, requestedType, nsfwEnabled, explicitConstraints, applyExplicit) {
  if (!isRecord(rawAction)) {
    return { error: 'Each translated action must be an object' };
  }
  const type = rawAction.type;
  const allowedForTool = TRANSLATABLE_ACTION_TYPES.filter(
    (t) => nsfwEnabled || !NSFW_ACTION_TYPES.includes(t),
  );
  if (!allowedForTool.includes(type)) {
    return { error: `Translated action type "${String(type)}" is not allowed` };
  }
  const isIntakeRequest = requestedType === 'eat' || requestedType === 'drink';
  if (isIntakeRequest && type !== 'eat' && type !== 'drink') {
    return { error: `Translated action type "${type}" is incompatible with requested type "${requestedType}"` };
  }
  if (!isIntakeRequest && type !== requestedType) {
    return { error: `Translated action type "${type}" must match requested type "${requestedType}"` };
  }

  const clean = { type };
  for (const key of QUANTITATIVE_OVERRIDE_KEYS) {
    if (rawAction[key] !== undefined) clean[key] = rawAction[key];
  }
  if (applyExplicit) {
    for (const [key, value] of Object.entries(explicitConstraints)) {
      if (value !== undefined) clean[key] = value;
    }
  }

  if (type === 'exercise' || type === 'sex') {
    delete clean.volumeMl;
    delete clean.energyKcal;
    delete clean.carbohydrateG;
    delete clean.mealKind;
    delete clean.bilateral;
    if (type === 'exercise') delete clean.exertion;
  } else if (type === 'express_milk' || type === 'breastfeed') {
    delete clean.volumeMl;
    delete clean.energyKcal;
    delete clean.carbohydrateG;
    delete clean.mealKind;
    delete clean.intensity;
    delete clean.exertion;
  } else if (type === 'drink') {
    delete clean.intensity;
    delete clean.exertion;
    delete clean.mealKind;
    delete clean.bilateral;
  } else if (type === 'eat') {
    delete clean.intensity;
    delete clean.exertion;
    delete clean.bilateral;
  }

  const invalid = validateStructuredAction(clean, [], nsfwEnabled);
  if (invalid !== null) {
    return { error: invalid };
  }
  return { action: clean };
}

function parseTranslatedResult({ blocks, finish }, requestedType, nsfwEnabled, explicitConstraints) {
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    const message = finish.failure?.message || `LLM stream finished with ${finish.kind}`;
    return { error: message, terminalKind: finish.kind };
  }
  if (finish?.kind === 'max-tokens') {
    return { error: 'Translator output reached maxTokens before completing tool call' };
  }
  const toolCall = blocks.find(
    (block) => block?.type === 'tool-call' && block.name === TRANSLATOR_TOOL_NAME,
  );
  if (!toolCall) {
    return { error: `Translator did not invoke ${TRANSLATOR_TOOL_NAME}` };
  }

  let parsedArgs;
  if (typeof toolCall.arguments === 'string') {
    try {
      parsedArgs = JSON.parse(toolCall.arguments);
    } catch {
      return { error: `${TRANSLATOR_TOOL_NAME} arguments were not valid JSON` };
    }
  } else if (isRecord(toolCall.arguments)) {
    parsedArgs = toolCall.arguments;
  } else {
    return { error: `${TRANSLATOR_TOOL_NAME} arguments must be a JSON object` };
  }

  const rawActions = parsedArgs?.actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    return { error: `${TRANSLATOR_TOOL_NAME} requires a non-empty actions array` };
  }
  if (rawActions.length > 4) {
    return { error: `${TRANSLATOR_TOOL_NAME} returned too many actions (${rawActions.length} > 4)` };
  }

  const applyExplicitOnSingle = rawActions.length === 1 && rawActions[0]?.type === requestedType;
  const hasExplicitConstraints = Object.keys(explicitConstraints).length > 0;
  let appliedExplicitToMatchingType = false;
  const normalized = [];
  for (let i = 0; i < rawActions.length; i += 1) {
    const applyExplicitHere = applyExplicitOnSingle
      || (!appliedExplicitToMatchingType && hasExplicitConstraints && rawActions[i]?.type === requestedType);
    if (applyExplicitHere) appliedExplicitToMatchingType = true;
    const checked = sanitizeTranslatedAction(
      rawActions[i],
      requestedType,
      nsfwEnabled,
      explicitConstraints,
      applyExplicitHere,
    );
    if (checked.error) {
      return { error: `actions[${i}]: ${checked.error}` };
    }
    normalized.push(checked.action);
  }

  const hasIntake = normalized.some((action) => action.type === 'eat' || action.type === 'drink');
  const rawTaste = typeof parsedArgs?.tasteFeedback === 'string' ? parsedArgs.tasteFeedback.trim() : '';
  const tasteFeedback = hasIntake && rawTaste !== '' && !/[\d０-９]/u.test(rawTaste)
    ? rawTaste
    : undefined;

  return tasteFeedback ? { actions: normalized, tasteFeedback } : { actions: normalized };
}

function createAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Body action translation timed out after ${timeoutMs} ms`));
  }, timeoutMs);
  timer.unref?.();

  let cleanupParent = null;
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      const onParentAbort = () => controller.abort(parentSignal.reason);
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
      cleanupParent = () => parentSignal.removeEventListener('abort', onParentAbort);
    }
  }

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      cleanupParent?.();
    },
  };
}

export function createBodyActionTranslator({
  ctx = null,
  gateway,
  config = {},
  historyStore = null,
  historyPath = null,
} = {}) {
  const resolvedHistoryPath = historyStore
    ? historyStore.historyPath
    : (historyPath ?? resolveTranslationHistoryPath(gateway, config));
  const store = historyStore ?? createBodyTranslationStore(resolvedHistoryPath, {
    maxEntriesPerType: Number.isInteger(config?.maxHistoryPerType) && config.maxHistoryPerType > 0
      ? config.maxHistoryPerType
      : DEFAULT_MAX_HISTORY_PER_TYPE,
  });

  const timeoutMs = Number.isInteger(config?.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : DEFAULT_TRANSLATOR_TIMEOUT_MS;
  const maxAttempts = Number.isInteger(config?.maxAttempts) && config.maxAttempts > 0
    ? config.maxAttempts
    : DEFAULT_TRANSLATOR_MAX_ATTEMPTS;

  async function translate({ type, description, explicitConstraints = {}, nsfwEnabled = false }, exec) {
    const llm = tryGetService(ctx, 'llm');
    if (!llm || typeof llm.stream !== 'function') {
      return {
        ok: false,
        statusCode: 503,
        error: 'Body action translator requires ctx.llm service; refusing to fabricate numeric values',
      };
    }
    const route = resolveLlmRoute(ctx, exec, config);
    if (!route) {
      return {
        ok: false,
        statusCode: 503,
        error: 'No LLM provider/model route available for body action translation',
      };
    }

    const { similar, recent } = await store.getReferences(type, description, {
      maxSimilar: config?.maxSimilarReferences ?? DEFAULT_SIMILAR_REFERENCE_LIMIT,
      maxRecent: config?.maxRecentReferences ?? DEFAULT_RECENT_REFERENCE_LIMIT,
    });

    const allowedQuantitativeTypes = TRANSLATABLE_ACTION_TYPES.filter(
      (t) => nsfwEnabled || !NSFW_ACTION_TYPES.includes(t),
    );
    const system = buildTranslatorSystemPrompt({ nsfwEnabled });
    const tools = [buildTranslatorToolSchema(allowedQuantitativeTypes)];
    const deadline = createAbortSignal(exec?.signal, timeoutMs);

    try {
      const reasoningEffort = await resolveOptionalReasoningEffort(llm, route, config, deadline.signal);
      let lastError = 'Translation failed';

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (deadline.signal.aborted) {
          return {
            ok: false,
            statusCode: deadline.wasTimedOut() ? 504 : 499,
            error: deadline.wasTimedOut()
              ? `Body action translation timed out after ${timeoutMs} ms`
              : 'Body action translation was aborted',
          };
        }

        const userText = buildTranslatorUserPrompt({
          type,
          description,
          explicitConstraints,
          similar,
          recent,
          retryError: attempt > 1 ? lastError : null,
        });

        const options = {
          provider: route.provider,
          model: route.model,
          ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
          system,
          messages: [{
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: userText }],
            source: { kind: 'plugin', plugin: 'dsh-body' },
          }],
          tools,
          temperature: typeof config?.temperature === 'number' ? config.temperature : 0.1,
          maxTokens: Number.isInteger(config?.maxTokens) && config.maxTokens > 0 ? config.maxTokens : 512,
          signal: deadline.signal,
        };

        let collected;
        try {
          collected = await collectStreamBlocks(llm.stream(options), deadline.signal);
        } catch (error) {
          if (deadline.signal.aborted) {
            return {
              ok: false,
              statusCode: deadline.wasTimedOut() ? 504 : 499,
              error: deadline.wasTimedOut()
                ? `Body action translation timed out after ${timeoutMs} ms`
                : 'Body action translation was aborted',
            };
          }
          lastError = error?.message || String(error);
          if (attempt < maxAttempts) continue;
          return {
            ok: false,
            statusCode: 502,
            error: `Body action translation failed: ${lastError}`,
          };
        }

        const parsed = parseTranslatedResult(collected, type, nsfwEnabled, explicitConstraints);
        if (parsed.actions) {
          return parsed.tasteFeedback
            ? { ok: true, actions: parsed.actions, tasteFeedback: parsed.tasteFeedback }
            : { ok: true, actions: parsed.actions };
        }
        lastError = parsed.error;
      }

      return {
        ok: false,
        statusCode: 502,
        error: `Body action translation failed validation after ${maxAttempts} attempts: ${lastError}`,
      };
    } finally {
      deadline.dispose();
    }
  }

  return {
    historyStore: store,
    translate,
    async recordHistory(entry) {
      return store.record(entry);
    },
  };
}
