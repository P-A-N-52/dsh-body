/*
 * DSH 会话工具：`body_bind` 管理身体与会话的显式绑定/休眠，
 * `body_state` 把已提交快照转为纯定性体感描述（零数字、零单位，受 nsfw 开关门控），
 * `body_act` 以自然语言 description 为主入口调用后台 LLM 翻译官转换为结构化生理动作提交 Gateway（也支持直接传入完整数值字段直通）。
 * 动作 id 由会话 ID 与工具调用 ID 稳定生成，同一调用重试复用同一个 id。
 * 回执里的 202 queued 只表示入队；动作在后续轮次提交后才反映到 `body_state`。
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  BASE_ACTION_TYPES,
  NSFW_ACTION_TYPES,
  TRANSLATABLE_ACTION_TYPES,
  createBodyActionTranslator,
  extractExplicitOverrides,
  hasCompleteDirectFields,
  mealKinds,
  stripTranslatorInputFields,
  validateOptionalNumericOverrides,
  validateStructuredAction,
} from './action-translator.js';

export { mealKinds };

const DISALLOWED_PART_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const NSFW_ONLY_FOCUS_ALIASES = new Set([
  'nsfw',
  'sex',
  'orgasm',
  'sexual',
  'sexualresponse',
  'mammary',
  'mammaryglands',
  'milk',
  'breastfeed',
  'express_milk',
  'testes',
  'epididymis',
  'arousal',
  'libido',
  'lactation',
]);

const FOCUS_AREA_ALIASES = new Map([
  ['all', 'all'],
  ['interoception', 'all'],
  ['brainnotify', 'all'],
  ['hunger', 'hunger'],
  ['fullness', 'hunger'],
  ['appetite', 'hunger'],
  ['stomach', 'hunger'],
  ['stomachghrelin', 'hunger'],
  ['stomachsensory', 'hunger'],
  ['duodenum', 'hunger'],
  ['digestion', 'hunger'],
  ['thirst', 'thirst'],
  ['hydration', 'thirst'],
  ['water', 'thirst'],
  ['bodyfluid', 'thirst'],
  ['salivaryglands', 'thirst'],
  ['hypothalamusthirst', 'thirst'],
  ['hypothalamusadh', 'thirst'],
  ['smallintestine', 'thirst'],
  ['drymouth', 'thirst'],
  ['urinary', 'urinary'],
  ['bladder', 'urinary'],
  ['kidney', 'urinary'],
  ['urine', 'urinary'],
  ['bowel', 'bowel'],
  ['colon', 'bowel'],
  ['stool', 'bowel'],
  ['defecation', 'bowel'],
  ['respiration', 'respiration'],
  ['lungs', 'respiration'],
  ['lungsventilation', 'respiration'],
  ['bloodoxygen', 'respiration'],
  ['oxygen', 'respiration'],
  ['breathing', 'respiration'],
  ['dyspnea', 'respiration'],
  ['circulation', 'circulation'],
  ['heart', 'circulation'],
  ['blood', 'circulation'],
  ['cardiovascular', 'circulation'],
  ['pulse', 'circulation'],
  ['palpitation', 'circulation'],
  ['temperature', 'temperature'],
  ['thermoregulation', 'temperature'],
  ['heat', 'temperature'],
  ['cold', 'temperature'],
  ['skin', 'temperature'],
  ['sweat', 'temperature'],
  ['thermal', 'temperature'],
  ['sleep', 'sleep'],
  ['sleepiness', 'sleep'],
  ['pineal', 'sleep'],
  ['rest', 'sleep'],
  ['activity', 'activity'],
  ['physicalactivity', 'activity'],
  ['exercise', 'activity'],
  ['fatigue', 'fatigue'],
  ['muscle', 'fatigue'],
  ['muscles', 'fatigue'],
  ['musclehead', 'fatigue'],
  ['muscletrunk', 'fatigue'],
  ['musclelimbs', 'fatigue'],
  ['muscleglucose', 'fatigue'],
  ['strength', 'fatigue'],
  ['metabolism', 'metabolism'],
  ['glucose', 'metabolism'],
  ['liver', 'metabolism'],
  ['pancreasendocrine', 'metabolism'],
  ['kidneyglucose', 'metabolism'],
  ['kidneygluconeogenesis', 'metabolism'],
  ['energy', 'metabolism'],
  ['bloodsugar', 'metabolism'],
  ['hypoglycemia', 'metabolism'],
  ['bloodcalcium', 'metabolism'],
  ['parathyroid', 'metabolism'],
  ['thyroid', 'metabolism'],
  ['endocrine', 'metabolism'],
  ['stress', 'stress'],
  ['adrenal', 'stress'],
  ['pituitary', 'stress'],
  ['autonomic', 'stress'],
  ['reward', 'stress'],
  ['hypothalamusendocrine', 'stress'],
  ['tension', 'stress'],
  ['cortisol', 'stress'],
  ['esophagus', 'discomfort'],
  ['discomfort', 'discomfort'],
  ['reproductive', 'reproductive'],
  ['uterus', 'reproductive'],
  ['ovaries', 'reproductive'],
  ['cramp', 'reproductive'],
  ['menstrual', 'reproductive'],
  ['nsfw', 'nsfw'],
  ['sex', 'sexual'],
  ['orgasm', 'sexual'],
  ['sexual', 'sexual'],
  ['sexualresponse', 'sexual'],
  ['arousal', 'sexual'],
  ['libido', 'sexual'],
  ['testes', 'sexual'],
  ['epididymis', 'sexual'],
  ['mammary', 'mammary'],
  ['mammaryglands', 'mammary'],
  ['lactation', 'mammary'],
  ['milk', 'mammary'],
  ['breastfeed', 'mammary'],
  ['express_milk', 'mammary'],
]);

const LEVEL_RANK = {
  urgent: 4,
  strong: 3,
  marked: 2,
  steady: 1,
  mild: 0,
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeNoDigits(text, fallback = '身体出现异样感受。') {
  if (typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (!/[\d０-９]/.test(trimmed)) return trimmed;
  return fallback;
}

function sanitizeFocusLabel(rawFocus) {
  if (typeof rawFocus !== 'string') return 'all';
  const trimmed = rawFocus.trim();
  if (!trimmed) return 'all';
  return /[\d０-９]/.test(trimmed) ? 'unknown' : trimmed;
}

function isNsfwEnabled(gateway) {
  return Boolean(gateway?.getNsfw?.());
}

function getGatewayHealthSafe(gateway) {
  if (typeof gateway?.getHealth !== 'function') return null;
  try {
    return gateway.getHealth();
  } catch {
    return null;
  }
}

function readPart(parts, id) {
  if (!isPlainRecord(parts) || !Object.hasOwn(parts, id)) return undefined;
  return isPlainRecord(parts[id]) ? parts[id] : undefined;
}

function readMm(partObj, field) {
  if (!partObj || !Object.hasOwn(partObj, field)) return undefined;
  const value = partObj[field];
  return isFiniteNumber(value) ? clamp(value, 0, 100) : undefined;
}

function readNum(partObj, field) {
  if (!partObj || !Object.hasOwn(partObj, field)) return undefined;
  const value = partObj[field];
  return isFiniteNumber(value) ? value : undefined;
}

function bandOf(mm, marked = 65, strong = 85, mild = 40) {
  if (!isFiniteNumber(mm)) return 0;
  if (mm >= strong) return 3;
  if (mm >= marked) return 2;
  if (mm >= mild) return 1;
  return 0;
}

function bandToLevel(band) {
  if (band >= 3) return 'strong';
  if (band === 2) return 'marked';
  if (band === 1) return 'mild';
  return 'steady';
}

function resolveExecSessionId(exec) {
  const candidate = exec?.agent?.session?.id
    ?? exec?.agent?.id
    ?? exec?.session?.id
    ?? exec?.sessionId;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
}

function resolveBindTargetSessionId(args, exec) {
  const execSessionId = resolveExecSessionId(exec);
  const argSessionId = typeof args?.sessionId === 'string' && args.sessionId.trim() !== ''
    ? args.sessionId.trim()
    : null;
  if (execSessionId !== null) {
    if (argSessionId !== null && argSessionId !== execSessionId) {
      return { sessionId: null, mismatch: true };
    }
    return { sessionId: execSessionId, mismatch: false };
  }
  return { sessionId: argSessionId, mismatch: false };
}

function redactUnownedFocus(rawFocus) {
  const trimmed = typeof rawFocus === 'string' ? rawFocus.trim() : '';
  if (!trimmed) return 'all';
  if (NSFW_ONLY_FOCUS_ALIASES.has(trimmed.toLowerCase())) return 'redacted';
  return sanitizeFocusLabel(trimmed);
}

export function buildActionPayload(args, { sessionId, callId }) {
  const digest = createHash('sha256').update(`${sessionId}\0${callId}`).digest('hex');
  return { ...args, id: `body-${digest.slice(0, 32)}`, sessionId };
}

function getExtraActionTypes(gateway) {
  if (typeof gateway?.getCapabilities !== 'function') return [];
  let capabilities;
  try {
    capabilities = gateway.getCapabilities();
  } catch {
    return [];
  }
  if (!capabilities || typeof capabilities !== 'object') return [];
  return Object.keys(capabilities)
    .filter((type) => type
      && !BASE_ACTION_TYPES.includes(type)
      && !NSFW_ACTION_TYPES.includes(type)
      && Array.isArray(capabilities[type])
      && capabilities[type].length > 0)
    .sort();
}

function getAllowedActionTypes(gateway) {
  const nsfwEnabled = isNsfwEnabled(gateway);
  return [
    ...BASE_ACTION_TYPES,
    ...(nsfwEnabled ? NSFW_ACTION_TYPES : []),
    ...getExtraActionTypes(gateway),
  ];
}

function validateAction(args, extraActionTypes = [], nsfwEnabled = false) {
  return validateStructuredAction(args, extraActionTypes, nsfwEnabled);
}

function collectCustomSensations(parts, nsfwEnabled) {
  const entries = new Map();
  const interoception = readPart(parts, 'interoception');
  const rawInteroSensations = interoception?.sensations;

  if (isPlainRecord(parts)) {
    for (const partId of Object.keys(parts).sort()) {
      if (partId === 'interoception' || DISALLOWED_PART_KEYS.has(partId)) continue;
      const partObj = readPart(parts, partId);
      if (!partObj || !isPlainRecord(partObj.sensations)) continue;
      for (const key of Object.keys(partObj.sensations).sort()) {
        if (!key || DISALLOWED_PART_KEYS.has(key)) continue;
        const entry = partObj.sensations[key];
        if (!isPlainRecord(entry) || !isFiniteNumber(entry.intensityMm)) continue;
        if (entry.nsfw === true && !nsfwEnabled) continue;
        entries.set(`${partId}.${key}`, {
          partId,
          intensityMm: clamp(entry.intensityMm, 0, 100),
          urgent: entry.urgent === true,
          contextText: entry.contextText,
          wakeText: entry.wakeText,
        });
      }
    }
  }

  if (isPlainRecord(rawInteroSensations)) {
    for (const fullKey of Object.keys(rawInteroSensations).sort()) {
      if (!fullKey || DISALLOWED_PART_KEYS.has(fullKey)) continue;
      const entry = rawInteroSensations[fullKey];
      if (!isPlainRecord(entry) || !isFiniteNumber(entry.intensityMm)) continue;
      if (entry.nsfw === true && !nsfwEnabled) continue;
      const dotIndex = fullKey.indexOf('.');
      const partId = dotIndex > 0 ? fullKey.slice(0, dotIndex) : fullKey;
      if (!entries.has(fullKey)) {
        entries.set(fullKey, {
          partId,
          intensityMm: clamp(entry.intensityMm, 0, 100),
          urgent: entry.urgent === true,
          contextText: entry.contextText,
          wakeText: entry.wakeText,
        });
      }
    }
  }

  return [...entries.values()];
}

function evaluateAllAreas(snapshot, nsfwEnabled) {
  const parts = isPlainRecord(snapshot?.parts) ? snapshot.parts : {};
  const intero = readPart(parts, 'interoception');
  const sleepPart = readPart(parts, 'sleep');
  const activityPart = readPart(parts, 'physicalActivity');

  const sleeping = sleepPart?.sleeping === true;
  const sleepPressureMm = readMm(sleepPart, 'sleepPressureMm');
  const sleepStage = typeof sleepPart?.sleepStage === 'string' ? sleepPart.sleepStage : undefined;
  const sleepInertiaMm = readMm(sleepPart, 'sleepInertiaMm') ?? 0;
  const wakeEvent = typeof sleepPart?.wakeEvent === 'string' ? sleepPart.wakeEvent : 'none';
  const autonomicPart = readPart(parts, 'autonomic');
  const sympatheticMm = readMm(autonomicPart, 'sympatheticMm') ?? 0;
  const startleActive = autonomicPart?.startleActive === true;
  const remainingExerciseMin = Math.max(0, readNum(activityPart, 'remainingExerciseMin') ?? 0);
  const exerciseIntensity = clamp(readNum(activityPart, 'intensity') ?? 0, 0, 1);
  const exercising = remainingExerciseMin > 0 && exerciseIntensity > 0;

  const hungerMm = readMm(intero, 'hunger');
  const fullnessMm = readMm(intero, 'fullness');
  const thirstPart = readPart(parts, 'hypothalamusThirst');
  const thirstMm = thirstPart !== undefined
    ? (readMm(thirstPart, 'thirst') ?? readMm(intero, 'thirst'))
    : readMm(intero, 'thirst');
  const salivaryPart = readPart(parts, 'salivaryGlands');
  const mouthMoistureMm = readMm(salivaryPart, 'mouthMoistureMm');
  const mealStimulusMin = readNum(salivaryPart, 'mealStimulusMin') ?? 0;
  const salivaRateMlMin = readNum(salivaryPart, 'salivaRateMlPerMin') ?? 0;
  const dryMouthMm = readMm(intero, 'dryMouthMm')
    ?? (mouthMoistureMm !== undefined ? clamp(100 - mouthMoistureMm, 0, 100) : undefined);

  const bladderPart = readPart(parts, 'bladder');
  const involuntaryVoid = (readNum(bladderPart, 'involuntaryVoidedMl') ?? 0) > 0;
  const voluntaryVoidMl = readNum(bladderPart, 'voluntaryVoidedMl') ?? 0;
  const bladderVol = readNum(bladderPart, 'volumeMl');
  const urinaryMm = readMm(intero, 'urinaryUrgency')
    ?? (bladderVol !== undefined ? clamp((100 * Math.max(0, bladderVol)) / 410, 0, 100) : undefined);

  const colonPart = readPart(parts, 'colon');
  const defecatedG = readNum(colonPart, 'defecatedG') ?? 0;
  const stoolG = readNum(colonPart, 'stoolG');
  const bowelMm = readMm(intero, 'bowelUrgencyMm')
    ?? readMm(colonPart, 'bowelUrgencyMm')
    ?? (stoolG !== undefined ? clamp((100 * Math.max(0, stoolG)) / 200, 0, 100) : undefined);

  const lungVentPart = readPart(parts, 'lungsVentilation');
  const respRatePerMin = readNum(lungVentPart, 'respiratoryRatePerMin');
  const ventilationMlMin = readNum(lungVentPart, 'ventilationMlMin');
  const oxygenDeficit = readNum(readPart(parts, 'bloodOxygen'), 'oxygenDeficit');
  const dyspneaMm = readMm(intero, 'dyspneaMm')
    ?? (oxygenDeficit !== undefined ? clamp(100 * oxygenDeficit, 0, 100) : undefined);

  const hr = readNum(readPart(parts, 'heart'), 'heartRatePerMin');
  const sbp = readNum(readPart(parts, 'blood'), 'systolicMmHg');
  const moderateOrHigherExercise = exercising && exerciseIntensity >= 0.2;
  const palpitationMm = readMm(intero, 'palpitationMm')
    ?? (hr !== undefined || sbp !== undefined || sympatheticMm > 25
      ? Math.max(
        !moderateOrHigherExercise && hr !== undefined ? clamp((hr - 115) * 1.5, 0, 100) : 0,
        sbp !== undefined ? clamp((95 - sbp) * 5, 0, 100) : 0,
        !moderateOrHigherExercise ? clamp((sympatheticMm - 25) * 1.2, 0, 100) : 0,
      )
      : undefined);
  const severeHypotension = sbp !== undefined && sbp < 78;

  const thermoPart = readPart(parts, 'thermoregulation');
  const coreTempC = readNum(thermoPart, 'coreTemperatureC');
  const thermoSetpointC = readNum(thermoPart, 'setpointC') ?? 37;
  const heatMm = readMm(intero, 'heatMm')
    ?? (coreTempC !== undefined ? clamp(50 * (coreTempC - thermoSetpointC), 0, 100) : undefined);
  const coldMm = readMm(intero, 'coldMm')
    ?? (coreTempC !== undefined ? clamp(50 * (thermoSetpointC - coreTempC), 0, 100) : undefined);
  const sweatVolumeMl = readNum(readPart(parts, 'skin'), 'sweatVolumeMl');
  const sweatDampMm = readMm(intero, 'sweatDampMm')
    ?? (sweatVolumeMl !== undefined ? clamp(15 * Math.max(0, sweatVolumeMl), 0, 100) : undefined);

  const melatonin = readNum(readPart(parts, 'pineal'), 'melatoninRelative');
  const sleepinessMm = readMm(intero, 'sleepinessMm')
    ?? (melatonin !== undefined || sleepPressureMm !== undefined
      ? (() => {
        const melatoninMm = melatonin !== undefined ? clamp((100 * (melatonin - 0.2)) / 1.6, 0, 100) : 0;
        const base = melatonin !== undefined && sleepPressureMm !== undefined
          ? clamp(0.4 * melatoninMm + 0.8 * sleepPressureMm, 0, 100)
          : (melatonin !== undefined ? melatoninMm : clamp(sleepPressureMm ?? 0, 0, 100));
        const antagonism = sleeping ? 0 : (0.55 * sympatheticMm + (exercising ? 25 * exerciseIntensity : 0));
        const effInertia = sleeping ? 0 : sleepInertiaMm * clamp(1 - sympatheticMm / 100, 0, 1) * (exercising ? 0.4 : 1);
        return clamp(base - antagonism + 0.6 * effInertia, 0, 100);
      })()
      : undefined);

  const muscleFatigueMm = readMm(intero, 'muscleFatigueMm')
    ?? (() => {
      const regions = ['muscleHead', 'muscleTrunk', 'muscleLimbs']
        .map((id) => readPart(parts, id))
        .filter(Boolean);
      if (regions.length === 0) return undefined;
      const totalGlycogen = regions.reduce(
        (sum, region) => sum + Math.max(0, readNum(region, 'glycogenG') ?? 0),
        0,
      );
      const depletion = clamp(1 - totalGlycogen / 300, 0, 1);
      return clamp(depletion * 120 + (exercising ? exerciseIntensity * 45 : 0), 0, 100);
    })();

  const glucoseMgDl = readNum(readPart(parts, 'glucose'), 'concentrationMgDl');
  const hypoglycemiaMm = readMm(intero, 'hypoglycemiaMm')
    ?? (glucoseMgDl !== undefined ? clamp((75 - glucoseMgDl) * 4, 0, 100) : undefined);
  const hypocalcemiaMm = readMm(intero, 'hypocalcemiaMm');
  const hypercalcemiaMm = readMm(intero, 'hypercalcemiaMm');

  const adrenalPart = readPart(parts, 'adrenal');
  const rawCortisolNmolL = readNum(adrenalPart, 'cortisolNmolL');
  const cortisol = rawCortisolNmolL !== undefined ? rawCortisolNmolL / 180 : undefined;
  const stressMm = readMm(intero, 'stressMm')
    ?? (cortisol !== undefined ? clamp((100 * (cortisol - 1)) / 2, 0, 100) : undefined);
  const rewardPart = readPart(parts, 'reward');
  const wantingMm = readMm(rewardPart, 'wantingMm');
  const rewardSatietyMm = readMm(rewardPart, 'satietyMm');
  const hedonicCalmMm = readMm(intero, 'hedonicCalmMm');

  const uterusPart = readPart(parts, 'uterus');
  const ovariesPart = readPart(parts, 'ovaries');
  const uterineCrampMm = readMm(uterusPart, 'crampMm') ?? readMm(intero, 'uterineCrampMm');

  const feelings = [];
  const push = (area, level, feeling) => {
    feelings.push({ area, level, feeling: sanitizeNoDigits(feeling) });
  };

  if (sleeping) {
    const sleepFeeling = sleepStage === 'deep'
      ? '正在沉睡之中，身体深度休息、恢复精力。'
      : sleepStage === 'rem'
        ? '正在浅睡与做梦阶段交替中，睡意在慢慢消退。'
        : (sleepPressureMm ?? 0) >= 65
          ? '正在沉睡中，身体仍在深切地恢复精力。'
          : (sleepPressureMm ?? 0) >= 30
            ? '正在安稳睡眠中，睡意在慢慢消退。'
            : '正在睡眠中，精神已经恢复得比较充足，接近自然转醒。';
    push('sleep', 'steady', sleepFeeling);
  } else {
    const sleepBand = bandOf(sleepinessMm);
    const wakeNoticeHandled = wakeEvent !== 'none' && wakeEvent !== 'startle';
    if (wakeEvent === 'important') {
      push('sleep', 'marked', '刚才被明显的身体不适从睡眠中唤醒，人还带着醒后沉重。');
    } else if (wakeEvent === 'speech') {
      push('sleep', 'mild', '刚从睡眠中被说话举动打断醒来，意识还有些迷糊。');
    } else if (wakeEvent === 'action') {
      push('sleep', 'mild', '刚从睡眠中被身体活动唤醒，正从迷糊中慢慢回神。');
    } else if (wakeEvent === 'natural') {
      push('sleep', 'steady', '刚自然睡醒脱离睡眠，精力恢复得比较充分。');
    }
    if (sleepBand === 3) push('sleep', 'strong', '困意极重，上下眼皮直打架，几乎撑不住。');
    else if (sleepBand === 2) push('sleep', 'marked', '眼皮有些发沉，脑子开始明显犯困。');
    else if (sleepInertiaMm >= 40 && wakeEvent !== 'important') {
      push('sleep', 'marked', '刚醒过来脑子还有些发懵发沉，尚在缓神中。');
    } else if (sleepBand === 1) push('sleep', 'mild', '略微有些犯困，精神稍微发沉。');
    else if (sleepInertiaMm >= 12 && !wakeNoticeHandled) {
      push('sleep', 'mild', '刚醒来还有些轻微犯迷糊，正慢慢清醒。');
    }
  }

  const startleStressShown = !sleeping && (wakeEvent === 'startle' || (startleActive && sympatheticMm >= 35));
  if (startleStressShown) {
    push('stress', sympatheticMm >= 70 ? 'strong' : 'marked', '刚被突发状况惊醒，交感神经高度活跃，心跳很快、整个人瞬间警醒。');
  }

  if (exercising) {
    const activityFeeling = exerciseIntensity >= 0.75
      ? '正在进行高强度体力活动，身体热起来、呼吸与心跳都在加快。'
      : exerciseIntensity >= 0.4
        ? '正在进行中等强度体力活动，身体微微发力发热。'
        : exerciseIntensity >= 0.15
          ? '正在进行轻度活动，四肢在轻微发力。'
          : '正在轻轻活动身体，整体体力负担很轻。';
    push('activity', 'steady', activityFeeling);
  }

  const hungerBand = bandOf(hungerMm);
  if (hungerBand === 3) push('hunger', 'strong', '胃里空得难受，饥饿感非常强烈。');
  else if (hungerBand === 2) push('hunger', 'marked', '胃里有些空，开始觉得明显饿了。');
  else if (hungerBand === 1) push('hunger', 'mild', '胃部略微空荡，隐约有点想吃东西。');

  const fullnessBand = bandOf(fullnessMm);
  if (fullnessBand === 3) push('hunger', 'strong', '胃里很胀，撑得有些难受。');
  else if (fullnessBand === 2) push('hunger', 'marked', '胃里有些满，饱足感比较明显。');
  else if (fullnessBand === 1) push('hunger', 'mild', '胃里有一定充实感，不太需要再进食。');

  const thirstBand = bandOf(thirstMm, 40, 65, 15);
  if (thirstBand === 3) push('thirst', 'strong', '非常口渴，急切想要喝水。');
  else if (thirstBand === 2) push('thirst', 'marked', '有些口渴了，需要补充水分。');
  else if (thirstBand === 1) push('thirst', 'mild', '隐约有一点微渴。');

  const dryMouthBand = bandOf(dryMouthMm);
  if (dryMouthBand === 3) push('thirst', 'strong', '口腔干涩发紧，咽口水都不太顺畅。');
  else if (dryMouthBand === 2) push('thirst', 'marked', '嘴里和舌头有些发干。');
  else if (dryMouthBand === 1) push('thirst', 'mild', '口腔略微有点发干。');
  else if (!sleeping && mealStimulusMin > 0 && salivaRateMlMin >= 0.9) {
    push('thirst', 'steady', '口腔分泌出明显唾液，嘴里湿润生津。');
  }

  if (involuntaryVoid) {
    push('urinary', 'urgent', '刚才膀胱失控溢出了尿液，下身一阵温热潮湿，十分难堪不适。');
  } else if (voluntaryVoidMl > 0) {
    push('urinary', 'steady', '刚完成排尿，膀胱明显轻松下来。');
  } else {
    const urinaryBand = bandOf(urinaryMm);
    if (urinaryBand === 3) push('urinary', 'strong', '膀胱胀满发紧，尿意非常迫切，几乎憋不住了。');
    else if (urinaryBand === 2) push('urinary', 'marked', '小腹有些微胀，开始有明显的尿意。');
    else if (urinaryBand === 1) push('urinary', 'mild', '隐约有一丝尿意。');
  }

  if (defecatedG > 0) {
    push('bowel', 'steady', '刚完成排便，下腹坠胀感明显缓解。');
  } else {
    const bowelBand = bandOf(bowelMm);
    if (bowelBand === 3) push('bowel', 'strong', '下腹坠胀明显，便意迫切，需要尽快排便。');
    else if (bowelBand === 2) push('bowel', 'marked', '肚子有些发沉发胀，开始有明显的便意。');
    else if (bowelBand === 1) push('bowel', 'mild', '下腹隐约有些微沉，略有一点便意。');
  }

  if ((dyspneaMm ?? 0) >= 90) {
    push('respiration', 'urgent', '呼吸极度困难，胸口像被压住一样窒息发闷，急需停下来缓气。');
  } else {
    const dyspneaBand = bandOf(dyspneaMm);
    if (dyspneaBand === 3) push('respiration', 'strong', '呼吸困难、喘不上气，胸口发闷。');
    else if (dyspneaBand === 2) push('respiration', 'marked', '呼吸变得有些急促，胸口微微发闷。');
    else if (dyspneaBand === 1) push('respiration', 'mild', '呼吸比平时略深略快，有一丝轻微气短。');
    else if (!sleeping && ((respRatePerMin !== undefined && respRatePerMin >= 24) || (ventilationMlMin !== undefined && ventilationMlMin >= 22000))) {
      if ((respRatePerMin ?? 0) >= 36 || (ventilationMlMin ?? 0) >= 45000) {
        push('respiration', 'strong', '呼吸又深又快，胸廓大幅起伏喘息着换气。');
      } else if ((respRatePerMin ?? 0) >= 28 || (ventilationMlMin ?? 0) >= 28000) {
        push('respiration', 'marked', '呼吸明显加深加快，正在大口喘气。');
      } else {
        push('respiration', 'mild', '呼吸比平时更深更沉，换气加快。');
      }
    }
  }

  if (severeHypotension || (palpitationMm ?? 0) >= 90) {
    push('circulation', 'urgent', '心跳剧烈发慌、阵阵头晕眼前发黑，几乎站立不稳。');
  } else {
    const palpBand = bandOf(palpitationMm);
    if (palpBand === 3) push('circulation', 'strong', '心跳剧烈发慌、头晕乏力，感觉站不太稳。');
    else if (palpBand === 2) push('circulation', 'marked', '觉得心跳有些乱或偏快，头部略微发沉。');
    else if (palpBand === 1) push('circulation', 'mild', '隐约感觉到心跳比平时稍重或偏快一些。');
    else if (!moderateOrHigherExercise && !sleeping && hr !== undefined && hr >= 100) {
      push('circulation', 'mild', '安静状态下心跳偏快，胸口能感到清晰搏动。');
    }
  }

  const heatBand = bandOf(heatMm);
  if (heatBand === 3) push('temperature', 'urgent', '浑身滚烫发昏，热得十分难受。');
  else if (heatBand === 2) push('temperature', 'marked', '身上有些燥热冒温。');
  else if (heatBand === 1) push('temperature', 'mild', '体表略感温热。');

  const coldBand = bandOf(coldMm);
  if (coldBand === 3) push('temperature', 'urgent', '浑身冰冷打颤，手脚僵硬发抖。');
  else if (coldBand === 2) push('temperature', 'marked', '身上觉得有些发凉起鸡皮疙瘩。');
  else if (coldBand === 1) push('temperature', 'mild', '皮肤隐约有一点凉意。');

  const skinPart = readPart(parts, 'skin');
  const activelySweating = (readNum(skinPart, 'sweatVolumeMl') ?? 0) >= 0.5
    || (readNum(skinPart, 'sweatRequestMl') ?? 0) >= 0.5;
  const sweatBand = bandOf(sweatDampMm);
  if (sweatBand === 3) {
    push(
      'temperature',
      'strong',
      activelySweating
        ? '浑身被汗水浸湿粘腻，汗流个不停。'
        : '身上还是汗津津、湿漉漉的，潮意还没散透。',
    );
  } else if (sweatBand === 2) {
    push(
      'temperature',
      'marked',
      activelySweating
        ? '后背和皮肤明显在出汗，有些潮湿黏腻。'
        : '皮肤上还带着刚才出汗留下的潮意，正在慢慢退去。',
    );
  } else if (sweatBand === 1) {
    push(
      'temperature',
      'mild',
      activelySweating
        ? '皮肤微微泛潮，渗出些许薄汗。'
        : '皮肤还残留一点微凉的湿意。',
    );
  }

  const fatigueBand = bandOf(muscleFatigueMm);
  if (fatigueBand === 3) push('fatigue', 'strong', '肌肉酸痛发软，四肢沉重疲乏得使不上力。');
  else if (fatigueBand === 2) push('fatigue', 'marked', '四肢和躯干肌肉有些发酸发沉，感到疲累。');
  else if (fatigueBand === 1) push('fatigue', 'mild', '肌肉略微有一点酸沉感。');

  const hypoBand = bandOf(hypoglycemiaMm);
  if (hypoBand === 3) {
    push('metabolism', 'urgent', '脑子发昏、手脚发软发慌、冒虚汗，整个人十分虚脱，急需补充糖分或进食。');
  } else if (hypoBand === 2) {
    push('metabolism', 'marked', '觉得心慌发虚、精神有些发晃，急切想吃点有能量的东西。');
  } else if (hypoBand === 1) {
    push('metabolism', 'mild', '身体隐约有些发虚，精力略微跟不上。');
  }

  if ((hypocalcemiaMm ?? 0) >= 85) push('metabolism', 'urgent', '四肢与口周明显麻木抽紧。');
  else if ((hypocalcemiaMm ?? 0) >= 65) push('metabolism', 'marked', '手脚指尖隐约有些发麻发紧。');
  if ((hypercalcemiaMm ?? 0) >= 85) push('metabolism', 'urgent', '浑身极度沉重无力，精神混浊、恶心烦躁。');
  else if ((hypercalcemiaMm ?? 0) >= 65) push('metabolism', 'marked', '浑身有些倦怠发沉，口干无力。');

  if (!startleStressShown) {
    const stressBand = bandOf(stressMm);
    if (stressBand === 3) push('stress', 'strong', '心头焦躁紧绷得很，神经高度紧张，难以平静下来。');
    else if (stressBand === 2) push('stress', 'marked', '心神有些紧绷发焦，感到明显压力。');
    else if (stressBand === 1) push('stress', 'mild', '隐约有一点紧张感，心情不算完全放松。');
    else if (!sleeping && (hedonicCalmMm ?? 0) >= 50) {
      push(
        'stress',
        'steady',
        hedonicCalmMm >= 75
          ? '身心格外舒畅愉悦，紧绷感消散得很快。'
          : '神清气爽，心绪柔和放松。',
      );
    } else if (!sleeping && (rewardSatietyMm ?? 0) >= 65) {
      push('stress', 'steady', '内心感到饱足惬意，渴望感明显平息下来。');
    }
  }
  if (!sleeping && (wantingMm ?? 0) >= 70) {
    if ((hungerMm ?? 0) >= 60) {
      push('hunger', 'marked', '心里正涌起明显的进食渴求，很想吃点可口的东西。');
    } else if (!nsfwEnabled) {
      push('stress', 'marked', '心里升起一阵强烈的期待与渴求感，情绪跃跃欲试。');
    }
  }

  const crampBand = bandOf(uterineCrampMm);
  if (crampBand === 3) push('reproductive', 'strong', '小腹一阵阵绞痛得厉害，整个人直不起腰。');
  else if (crampBand === 2) push('reproductive', 'marked', '下腹有些隐隐发坠发紧。');
  else if (crampBand === 1) push('reproductive', 'mild', '下腹略微有些沉胀发紧。');

  const bleedingMl = readNum(uterusPart, 'bleedingMl') ?? 0;
  if (bleedingMl > 0) {
    push('reproductive', 'mild', '处于经期，下身有温热经血流出感，需留意更换护理用品。');
  }
  const ovaryPhase = typeof ovariesPart?.phase === 'string' ? ovariesPart.phase : undefined;
  if (ovaryPhase === 'ovulatory') {
    push('reproductive', 'steady', '处于排卵窗口期，小腹一侧隐约有轻微牵扯感。');
  }

  if (nsfwEnabled) {
    const uterineContractionMm = readMm(uterusPart, 'contractionMm') ?? 0;
    if (uterineContractionMm >= 50) {
      push('reproductive', 'marked', '小腹深处伴随节律性收紧与收缩感。');
    } else if (uterineContractionMm >= 22) {
      push('reproductive', 'mild', '下腹隐约传来轻微收缩紧绷感。');
    }
    const pelvicCongestionMm = readMm(uterusPart, 'pelvicCongestionMm') ?? 0;
    if (pelvicCongestionMm >= 55) {
      push('reproductive', 'mild', '盆腔与下腹一阵温热充盈沉胀。');
    }

    const sexualPart = readPart(parts, 'sexualResponse');
    const phase = typeof sexualPart?.phase === 'string' ? sexualPart.phase : undefined;
    const arousalMm = readMm(sexualPart, 'arousalMm') ?? readMm(intero, 'sexualArousalMm');
    const afterglowMm = readMm(sexualPart, 'afterglowMm') ?? 0;
    const epididymisPart = readPart(parts, 'epididymis');
    const ejaculatedMl = readNum(epididymisPart, 'ejaculatedMl') ?? 0;
    const testosterone = readNum(readPart(parts, 'testes'), 'testosteroneRelative');
    const libidoMm = readMm(intero, 'libidoMm')
      ?? (testosterone !== undefined ? clamp(100 * (testosterone - 0.5), 0, 100) : undefined);
    const mammaryPart = readPart(parts, 'mammaryGlands');
    const mammaryFullnessMm = readMm(mammaryPart, 'fullnessMm') ?? readMm(intero, 'mammaryFullnessMm');
    const ejectedMilkMl = readNum(mammaryPart, 'ejectedMilkMl') ?? 0;
    const pendingEjectionCount = Array.isArray(mammaryPart?.pendingEjections)
      ? mammaryPart.pendingEjections.length
      : 0;
    const mammaryLactating = mammaryPart?.lactating === true;
    const galactorrhea = mammaryPart?.galactorrhea === true;

    const lastOrgasmMin = readNum(sexualPart, 'lastOrgasmAtSimMin');
    const lastAttemptMin = readNum(sexualPart, 'lastAttemptedOrgasmAtSimMin');
    const blockReason = typeof sexualPart?.lastOrgasmBlockReason === 'string'
      ? sexualPart.lastOrgasmBlockReason
      : 'none';
    const currentSimSeconds = readNum(snapshot, 'simulatedSeconds');
    const recentBlockedOrgasm = lastAttemptMin !== undefined
      && currentSimSeconds !== undefined
      && (currentSimSeconds / 60) - lastAttemptMin <= 3
      && (lastOrgasmMin === undefined || lastAttemptMin > lastOrgasmMin)
      && (blockReason === 'below_threshold' || blockReason === 'refractory');

    if (ejaculatedMl > 0) {
      push('sexual', 'strong', '刚经历过强烈的射精排出，下身阵阵抽动后随之松弛下来。');
    }
    if (phase === 'orgasm') {
      push('sexual', 'strong', '体内正经历强烈的快感波峰，感官高度集中，呼吸紊乱。');
    } else if (phase === 'refractory') {
      push('sexual', 'mild', '处于高潮过后的余韵与不应期，身体慵懒微热，反应趋于平缓。');
    } else if (phase === 'resolution') {
      if (afterglowMm >= 35) {
        push('sexual', 'mild', '兴奋退潮后温热余韵尚存，呼吸渐缓、周身松软舒适。');
      } else if ((arousalMm ?? 0) >= 65) {
        push('sexual', 'mild', '方才的燥热余波尚未完全平息，感官仍有些敏锐。');
      } else if ((arousalMm ?? 0) >= 25) {
        push('sexual', 'mild', '刚才积起的温热敏感正在慢慢回落散去。');
      }
    } else if (phase === 'plateau' || (arousalMm ?? 0) >= 85) {
      if ((arousalMm ?? 0) >= 75) {
        push('sexual', 'strong', '体内翻涌着炽热而饱满的冲动，敏感得仿佛临近顶点，随时可能推过去。');
      } else {
        push('sexual', 'marked', '兴奋已积蓄成饱满紧绷的高台，局部阵阵发麻发紧。');
      }
    } else if (phase === 'excitement' || (arousalMm ?? 0) >= 65) {
      if ((arousalMm ?? 0) >= 45) {
        push('sexual', 'marked', '明显的燥热与悸动在蔓延，感官变得相当敏锐。');
      } else if ((arousalMm ?? 0) >= 25) {
        push('sexual', 'mild', '体内的温热和躁动感正在稳步爬升，敏感度逐渐加深。');
      } else {
        push('sexual', 'mild', '身体刚刚泛起一点轻热与敏感的悸动，唤起才刚开始蓄积。');
      }
    } else if ((arousalMm ?? 0) >= 40) {
      push('sexual', 'mild', '隐约有一点温热悸动的感觉。');
    } else if ((libidoMm ?? 0) >= 85) {
      push('sexual', 'strong', '体内的欲求感很强，容易泛起冲动。');
    } else if ((libidoMm ?? 0) >= 65) {
      push('sexual', 'marked', '隐约有些欲念浮动。');
    } else if ((libidoMm ?? 0) >= 45) {
      push('sexual', 'mild', '心底隐约浮现温热渴望。');
    }

    if (recentBlockedOrgasm) {
      push(
        'sexual',
        'mild',
        blockReason === 'refractory'
          ? '刚才试图再推一次高潮，但身体仍处在不应余缓期里，没能立刻叠上去。'
          : '刚才试着往顶点推了一下，但目前的唤起火候还不够深，没能跨过释放门槛。',
      );
    }

    const mammaryBand = bandOf(mammaryFullnessMm);
    if (ejectedMilkMl > 0) {
      push('mammary', 'mild', '正在顺利排乳，温热乳汁涌出后胸部胀重感明显舒缓。');
    } else if (pendingEjectionCount > 0) {
      push('mammary', 'mild', '胸部正承受持续的刺激与牵拉感，伴随隐约发麻的排乳前兆。');
    } else if (mammaryBand === 3) {
      push('mammary', 'strong', '胸部胀痛沉重得十分明显。');
    } else if (mammaryBand === 2) {
      push('mammary', 'marked', '胸口觉得有些发胀沉重。');
    } else if (mammaryBand === 1) {
      push('mammary', 'mild', '胸部略微有一点发胀感。');
    } else if (galactorrhea) {
      push('mammary', 'mild', '乳头偶尔渗出少许稀薄乳汁。');
    } else if (mammaryLactating) {
      push('mammary', 'steady', '胸部有温和产乳充实感，目前没有发胀不适。');
    }
  }

  const customSensations = collectCustomSensations(parts, nsfwEnabled);
  for (const item of customSensations) {
    const band = bandOf(item.intensityMm);
    if (!item.urgent && band === 0) continue;
    const level = item.urgent ? 'urgent' : bandToLevel(band);
    const rawText = (item.urgent || band >= 3)
      ? (item.wakeText ?? item.contextText)
      : item.contextText;
    push(item.partId, level, sanitizeNoDigits(rawText, '身体该部位出现明显异样感受。'));
  }

  const esophagealChokingMm = readMm(readPart(parts, 'esophagus'), 'chokingMm') ?? 0;
  if (esophagealChokingMm >= 70) {
    push('discomfort', bandOf(esophagealChokingMm) >= 3 ? 'strong' : 'marked', '咽喉和胸口深处隐约有些闷堵不适。');
  }

  feelings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  return {
    status: sleeping ? 'sleeping' : 'active',
    exercising,
    sleeping,
    feelings,
    customSensations,
  };
}

function steadyMessageForArea(area, { sleeping, exercising, nsfwEnabled }) {
  switch (area) {
    case 'hunger': return '胃部舒缓平稳，既不饿也不撑。';
    case 'thirst': return '口腔湿润，目前不觉得口渴。';
    case 'urinary': return '膀胱轻松，目前没有明显尿意。';
    case 'bowel': return '腹部轻松，目前没有便意。';
    case 'respiration': return '呼吸顺畅平稳，胸口轻松。';
    case 'circulation':
      return exercising
        ? '活动时心跳有力地加快，循环平稳。'
        : '心跳平稳有力，没有心慌或头晕的感觉。';
    case 'temperature': return '体温适中，皮肤干爽舒适，不冷也不热。';
    case 'sleep': return sleeping ? '正在安稳睡眠中。' : '头脑清醒，目前不困。';
    case 'activity':
      return exercising ? '正在进行体力活动。' : '目前处于静息状态，没有在进行体力活动。';
    case 'fatigue': return '四肢肌肉轻松有力，没有酸痛疲乏感。';
    case 'metabolism': return '精力平稳，没有头晕发虚或低血糖乏力感。';
    case 'stress': return '神情平缓放松，没有紧张焦虑感。';
    case 'discomfort': return '目前没有明显的呛咳、梗堵或躯体不适感。';
    case 'reproductive': return '下腹平稳舒适，没有坠胀或绞痛感。';
    case 'sexual':
      return nsfwEnabled
        ? '当前处于平静休息状态，没有明显的兴奋或悸动。'
        : '该感知功能当前未开启。';
    case 'mammary':
      return nsfwEnabled
        ? '胸部感觉轻松平稳，没有明显发胀。'
        : '该感知功能当前未开启。';
    case 'nsfw':
      return nsfwEnabled
        ? '当前处于平静休息状态，没有明显的兴奋或胀痛感。'
        : '该感知功能当前未开启。';
    default:
      return '这个部位目前感觉平稳，没有明显异样。';
  }
}

function buildSummaryLine(status, feelings, { sleeping, exercising, isTargeted }) {
  if (feelings.length === 0) {
    return status === 'sleeping'
      ? '当前正在安稳睡眠中，身体各方面感受平稳舒适。'
      : exercising
        ? '当前正在进行体力活动，其余身体感受平稳。'
        : '当前清醒静息，身体各方面感受平稳舒适。';
  }
  if (isTargeted) {
    return feelings.map((item) => item.feeling).join(' ');
  }
  const phrases = feelings.slice(0, 4).map((item) => item.feeling.replace(/[。；]+$/u, ''));
  if (sleeping) {
    const hasSleepEntry = feelings.some((item) => item.area === 'sleep');
    const body = phrases.join('；');
    return hasSleepEntry ? `${body}。` : `当前正在睡眠中；${body}。`;
  }
  if (exercising) {
    return `${phrases.join('；')}。`;
  }
  return `当前清醒静息；${phrases.join('；')}。`;
}

export function buildBodyFeelingsSummary(
  snapshot,
  { focus = 'all', part, nsfw = false, dormant = false, active = true } = {},
) {
  const nsfwEnabled = Boolean(nsfw);
  const rawFocus = typeof part === 'string' ? part : focus;
  const trimmedFocus = typeof rawFocus === 'string' ? rawFocus.trim() : '';
  const lowerFocus = trimmedFocus.toLowerCase();

  if (DISALLOWED_PART_KEYS.has(trimmedFocus) || DISALLOWED_PART_KEYS.has(lowerFocus)) {
    return {
      status: active ? (dormant ? 'dormant' : 'active') : 'paused',
      focus: trimmedFocus,
      feelings: null,
      summary: '没有感知到这个部位或区域。',
    };
  }

  const safeFocus = sanitizeFocusLabel(trimmedFocus || 'all');
  const resolvedFocus = safeFocus === 'all' ? 'all' : safeFocus;

  if (!active) {
    return {
      status: 'paused',
      focus: NSFW_ONLY_FOCUS_ALIASES.has(lowerFocus) && !nsfwEnabled ? 'redacted' : resolvedFocus,
      feelings: [],
      summary: '身体当前处于手动暂停状态，生理时钟未在推进，无法感知实时变化。',
    };
  }

  if (dormant) {
    return {
      status: 'dormant',
      focus: NSFW_ONLY_FOCUS_ALIASES.has(lowerFocus) && !nsfwEnabled ? 'redacted' : resolvedFocus,
      feelings: [],
      summary: '身体当前处于未绑定休眠状态，生理时钟已冻结，默认未绑定当前会话。',
    };
  }

  if (NSFW_ONLY_FOCUS_ALIASES.has(lowerFocus) && !nsfwEnabled) {
    return {
      status: snapshot?.parts?.sleep?.sleeping === true ? 'sleeping' : 'active',
      focus: resolvedFocus,
      feelings: null,
      summary: '该感知功能当前未开启。',
    };
  }

  const parts = isPlainRecord(snapshot?.parts) ? snapshot.parts : {};
  const mappedArea = lowerFocus ? FOCUS_AREA_ALIASES.get(lowerFocus) : 'all';
  const hasCustomPart = Boolean(trimmedFocus) && Object.hasOwn(parts, trimmedFocus);

  if (trimmedFocus !== '' && mappedArea === undefined && !hasCustomPart) {
    return {
      status: parts.sleep?.sleeping === true ? 'sleeping' : 'active',
      focus: resolvedFocus,
      feelings: null,
      summary: '没有感知到这个部位或区域。',
    };
  }

  const evaluation = evaluateAllAreas(snapshot, nsfwEnabled);
  const { status, exercising, sleeping, feelings } = evaluation;

  if (!mappedArea || mappedArea === 'all') {
    const summary = sanitizeNoDigits(
      buildSummaryLine(status, feelings, { sleeping, exercising, isTargeted: false }),
      '当前身体状态平稳。',
    );
    return {
      status,
      focus: 'all',
      feelings,
      summary,
    };
  }

  let matched;
  if (mappedArea) {
    if (mappedArea === 'nsfw') {
      matched = feelings.filter((item) => item.area === 'sexual' || item.area === 'mammary');
    } else if (mappedArea === 'reproductive' && nsfwEnabled) {
      matched = feelings.filter(
        (item) => item.area === 'reproductive' || item.area === 'sexual' || item.area === 'mammary',
      );
    } else if (mappedArea === 'discomfort') {
      const discomfortSources = new Set([
        'discomfort',
        'hunger',
        'thirst',
        'urinary',
        'reproductive',
        ...(nsfwEnabled ? ['mammary'] : []),
      ]);
      const interoDiscomfortMm = readMm(readPart(parts, 'interoception'), 'discomfort') ?? 0;
      matched = feelings.filter(
        (item) => item.area === 'discomfort'
          || (interoDiscomfortMm >= 25 && (item.level === 'strong' || item.level === 'urgent') && discomfortSources.has(item.area)),
      );
      if (matched.length === 0 && interoDiscomfortMm >= 25) {
        matched = [{
          area: 'discomfort',
          level: bandToLevel(bandOf(interoDiscomfortMm)),
          feeling: sanitizeNoDigits('身体正因过饱、憋闷、缺水或局部疼痛而明显不适。'),
        }];
      }
    } else {
      matched = feelings.filter((item) => item.area === mappedArea);
    }
  } else {
    matched = feelings.filter((item) => item.area === trimmedFocus);
  }

  if (matched.length === 0) {
    const steadyText = steadyMessageForArea(mappedArea ?? trimmedFocus, {
      sleeping,
      exercising,
      nsfwEnabled,
    });
    const steadyEntry = {
      area: mappedArea ?? resolvedFocus,
      level: 'steady',
      feeling: sanitizeNoDigits(steadyText),
    };
    return {
      status,
      focus: resolvedFocus,
      feelings: [steadyEntry],
      summary: steadyEntry.feeling,
    };
  }

  return {
    status,
    focus: resolvedFocus,
    feelings: matched,
    summary: sanitizeNoDigits(
      buildSummaryLine(status, matched, { sleeping, exercising, isTargeted: true }),
      '当前该部位有明显感受。',
    ),
  };
}

export function formatBodyFeelingsContext(
  snapshot,
  { nsfw = false, dormant = false, active = true } = {},
) {
  const result = buildBodyFeelingsSummary(snapshot, {
    focus: 'all',
    nsfw,
    dormant,
    active,
  });
  if (result.status === 'dormant' || result.status === 'paused') return '';
  return sanitizeNoDigits(`[身体背景感受] ${result.summary}`, '[身体背景感受] 当前状态平稳。');
}

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function currentBindStatus(gateway) {
  const health = getGatewayHealthSafe(gateway);
  const boundSessionId = health?.boundSessionId ?? gateway?.getBoundSessionId?.() ?? null;
  const dormant = Boolean(gateway?.isDormant?.() ?? health?.dormant ?? false);
  const active = health?.active !== false;
  const nsfw = Boolean(gateway?.getNsfw?.() ?? health?.nsfw ?? false);
  return {
    bound: typeof boundSessionId === 'string' && boundSessionId !== '',
    dormant,
    active,
    nsfw,
    boundSessionId,
  };
}

function buildGateErrorResponse(gateway, sessionId = null) {
  const status = currentBindStatus(gateway);
  if (!status.active) {
    return {
      ok: false,
      statusCode: 409,
      receipt: { error: 'Body Gateway is paused', active: false },
    };
  }
  if (status.bound && status.boundSessionId !== sessionId) {
    return {
      ok: false,
      statusCode: 403,
      receipt: {
        error: 'Body Gateway is bound to another session',
        boundToAnotherSession: true,
      },
    };
  }
  if (status.dormant) {
    return {
      ok: false,
      statusCode: 409,
      receipt: {
        error: 'Body Gateway is dormant because no session is bound',
        dormant: true,
        boundSessionId: null,
      },
    };
  }
  return null;
}

function digestTranslatorCallInput(type, description, explicitConstraints) {
  return createHash('sha256')
    .update(JSON.stringify({ type, description: description.trim(), explicitConstraints }))
    .digest('hex');
}

function rememberCallCache(cache, key, value, maxSize = 200) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function resolveScopedGateway(gateway, sessionId) {
  if (typeof gateway?.gatewayForSession === 'function') {
    return gateway.gatewayForSession(sessionId);
  }
  return gateway;
}

export function createBodyTools(gateway, options = {}) {
  const translatorsByGateway = new Map();
  function getTranslator(targetGateway) {
    if (typeof options?.translator?.translate === 'function') {
      return options.translator;
    }
    if (!translatorsByGateway.has(targetGateway)) {
      translatorsByGateway.set(targetGateway, createBodyActionTranslator({
        ctx: options?.ctx ?? null,
        gateway: targetGateway,
        config: isPlainRecord(options?.translatorConfig)
          ? options.translatorConfig
          : (isPlainRecord(options?.translator) ? options.translator : {}),
        historyPath: options?.historyPath ?? null,
      }));
    }
    return translatorsByGateway.get(targetGateway);
  }
  const translatedCallCache = new Map();

  const typeProperty = { type: 'string' };
  Object.defineProperty(typeProperty, 'enum', {
    enumerable: true,
    configurable: true,
    get() {
      return getAllowedActionTypes(gateway);
    },
  });

  const durationMinProperty = { type: 'number' };
  Object.defineProperty(durationMinProperty, 'description', {
    enumerable: true,
    configurable: true,
    get() {
      return isNsfwEnabled(gateway)
        ? 'Optional explicit override: exercise, sex, express_milk, or breastfeed duration in minutes; intake duration otherwise. Omit when passing description.'
        : 'Optional explicit override: exercise duration in minutes when type is exercise; intake duration otherwise. Omit when passing description.';
    },
  });

  const intensityProperty = { type: 'number' };
  Object.defineProperty(intensityProperty, 'description', {
    enumerable: true,
    configurable: true,
    get() {
      return isNsfwEnabled(gateway)
        ? 'Optional explicit override: relative exercise or sex intensity, greater than 0 and at most 1. Omit when passing description.'
        : 'Optional explicit override: relative exercise intensity, greater than 0 and at most 1. Omit when passing description.';
    },
  });

  const bodyAct = {
    name: 'body_act',
    parameters: {
      type: 'object',
      properties: {
        type: typeProperty,
        description: {
          type: 'string',
          description: 'Natural-language description of what you eat, drink, exercise, or do '
            + '(e.g. "吃了一口米饭配红烧肉", "喝了两口温水", "慢跑了二十分钟"). '
            + 'For quantitative actions, pass this qualitative description and omit numeric fields unless exact values are explicitly known.',
        },
        volumeMl: {
          type: 'number',
          description: 'Optional explicit override: intake volume in milliliters. Omit when passing description.',
        },
        energyKcal: {
          type: 'number',
          description: 'Optional explicit override: intake energy in kilocalories. Omit when passing description.',
        },
        carbohydrateG: {
          type: 'number',
          description: 'Optional explicit override: digestible carbohydrate intake in grams, as glucose equivalents; omit when unknown or passing description.',
        },
        mealKind: {
          type: 'string',
          enum: mealKinds,
          description: 'Optional explicit override for eat meal texture (liquid, solid, or mixed); omit when passing description.',
        },
        durationMin: durationMinProperty,
        intensity: intensityProperty,
        exertion: {
          type: 'number',
          description: 'Optional explicit override for sex: whole-body skeletal-muscle exertion in [0, 1]. Omit when passing description.',
        },
        continueStimulation: {
          type: 'boolean',
          description: 'Optional boolean for orgasm: true to keep ongoing sex stimulation running after climax instead of ending it.',
        },
        bilateral: {
          type: 'boolean',
          description: 'Optional explicit override for express_milk or breastfeed: true when both breasts are stimulated; omit when passing description.',
        },
      },
      required: ['type'],
      additionalProperties: true,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          statusCode: { type: 'number' },
          receipt: { type: 'object' },
          tasteFeedback: { type: 'string' },
        },
        required: ['ok', 'statusCode', 'receipt'],
        additionalProperties: false,
      },
      render: renderJson,
    },
    async execute(args = {}, exec) {
      const input = isPlainRecord(args) ? args : {};
      const sessionId = resolveExecSessionId(exec);
      if (sessionId === null) {
        return { ok: false, statusCode: 400, receipt: { error: 'body_act requires an agent session id' } };
      }
      const target = resolveScopedGateway(gateway, sessionId);
      if (!target) {
        const hasMappedTarget = typeof gateway?.resolveId === 'function' ? Boolean(gateway.resolveId(sessionId)) : true;
        return hasMappedTarget
          ? { ok: false, statusCode: 503, receipt: { error: 'Target body gateway is unavailable' } }
          : { ok: false, statusCode: 403, receipt: { error: 'No body is mapped to this session' } };
      }
      const gateError = buildGateErrorResponse(target, sessionId);
      if (gateError) return gateError;
      const nsfwEnabled = isNsfwEnabled(target);
      const extraActionTypes = getExtraActionTypes(target);
      if (NSFW_ACTION_TYPES.includes(input.type) && !nsfwEnabled) {
        return { ok: false, statusCode: 400, receipt: { error: 'NSFW actions are disabled for this body' } };
      }

      const explicitCallId = typeof exec?.callId === 'string' && exec.callId !== '' ? exec.callId : null;
      const callId = explicitCallId ?? randomUUID();
      const rawDescription = typeof input.description === 'string' ? input.description.trim() : '';
      const isTranslatable = TRANSLATABLE_ACTION_TYPES.includes(input.type);

      if (isTranslatable && rawDescription !== '' && !hasCompleteDirectFields(input)) {
        const overrideInvalid = validateOptionalNumericOverrides(input);
        if (overrideInvalid !== null) {
          return { ok: false, statusCode: 400, receipt: { error: overrideInvalid } };
        }

        const explicitConstraints = extractExplicitOverrides(input);
        const cacheKey = explicitCallId ? `${sessionId}\0${explicitCallId}` : null;
        const requestDigest = digestTranslatorCallInput(input.type, rawDescription, explicitConstraints);
        if (cacheKey && translatedCallCache.has(cacheKey)) {
          const cached = translatedCallCache.get(cacheKey);
          if (cached.requestDigest !== requestDigest) {
            const existingReceipt = target?.getReceipt?.(cached.primaryId) ?? cached.primaryReceipt;
            return {
              ok: false,
              statusCode: 409,
              receipt: { error: 'Action id already used with a different payload', existing: existingReceipt },
            };
          }
          const replayResults = cached.payloads.map((payload) => target.submitAction(payload));
          const replayFailed = replayResults.find((res) => res.statusCode < 200 || res.statusCode >= 300);
          if (replayFailed) {
            return { ok: false, statusCode: replayFailed.statusCode, receipt: replayFailed.body };
          }
          const replayReceipt = replayResults.length === 1
            ? replayResults[0].body
            : { ...replayResults[0].body, receipts: replayResults.map((res) => res.body) };
          return {
            ok: true,
            statusCode: replayResults[0].statusCode,
            receipt: replayReceipt,
            ...(cached.tasteFeedback ? { tasteFeedback: cached.tasteFeedback } : {}),
          };
        }

        const bodyTranslator = getTranslator(target);
        const translation = await bodyTranslator.translate({
          type: input.type,
          description: rawDescription,
          explicitConstraints,
          nsfwEnabled,
        }, exec);
        if (!translation.ok) {
          return {
            ok: false,
            statusCode: translation.statusCode ?? 502,
            receipt: { error: translation.error },
          };
        }

        const payloads = translation.actions.map((action, index) => buildActionPayload(
          action,
          { sessionId, callId: index === 0 ? callId : `${callId}#${index}` },
        ));
        const submitResults = [];
        for (const payload of payloads) {
          const submitted = target.submitAction(payload);
          if (submitted.statusCode < 200 || submitted.statusCode >= 300) {
            if (cacheKey && submitResults.length > 0) {
              rememberCallCache(translatedCallCache, cacheKey, {
                requestDigest,
                payloads,
                primaryId: payloads[0].id,
                primaryReceipt: submitResults[0].body,
              });
            }
            return { ok: false, statusCode: submitted.statusCode, receipt: submitted.body };
          }
          submitResults.push(submitted);
        }

        if (cacheKey) {
          rememberCallCache(translatedCallCache, cacheKey, {
            requestDigest,
            payloads,
            primaryId: payloads[0].id,
            primaryReceipt: submitResults[0].body,
            ...(translation.tasteFeedback ? { tasteFeedback: translation.tasteFeedback } : {}),
          });
        }

        if (submitResults.some((res) => res.statusCode === 202) && typeof bodyTranslator.recordHistory === 'function') {
          let simulatedSeconds;
          try {
            simulatedSeconds = target.getState?.()?.simulatedSeconds;
          } catch {
            simulatedSeconds = undefined;
          }
          await bodyTranslator.recordHistory({
            type: input.type,
            description: rawDescription,
            actions: translation.actions,
            ...(typeof simulatedSeconds === 'number' && Number.isFinite(simulatedSeconds) ? { simulatedSeconds } : {}),
            wallTimeMs: Date.now(),
          });
        }

        const receipt = submitResults.length === 1
          ? submitResults[0].body
          : { ...submitResults[0].body, receipts: submitResults.map((res) => res.body) };
        return {
          ok: true,
          statusCode: submitResults[0].statusCode,
          receipt,
          ...(translation.tasteFeedback ? { tasteFeedback: translation.tasteFeedback } : {}),
        };
      }

      const invalid = validateAction(input, extraActionTypes, nsfwEnabled);
      if (invalid !== null) {
        return { ok: false, statusCode: 400, receipt: { error: invalid } };
      }
      const directInput = stripTranslatorInputFields(input);
      const payload = buildActionPayload(directInput, { sessionId, callId });
      const { statusCode, body } = target.submitAction(payload);
      const receipt = body;

      if (statusCode === 202 && isTranslatable && rawDescription !== '') {
        const bodyTranslator = getTranslator(target);
        if (typeof bodyTranslator.recordHistory === 'function') {
          let simulatedSeconds;
          try {
            simulatedSeconds = target.getState?.()?.simulatedSeconds;
          } catch {
            simulatedSeconds = undefined;
          }
          const recordedAction = { type: directInput.type, ...extractExplicitOverrides(directInput) };
          await bodyTranslator.recordHistory({
            type: directInput.type,
            description: rawDescription,
            actions: [recordedAction],
            ...(typeof simulatedSeconds === 'number' && Number.isFinite(simulatedSeconds) ? { simulatedSeconds } : {}),
            wallTimeMs: Date.now(),
          });
        }
      }

      return {
        ok: statusCode >= 200 && statusCode < 300,
        statusCode,
        receipt,
      };
    },
  };

  Object.defineProperty(bodyAct, 'description', {
    enumerable: true,
    configurable: true,
    get() {
      const allowed = getAllowedActionTypes(gateway).join(', ');
      const translatableHint = isNsfwEnabled(gateway)
        ? 'eat, drink, exercise, sex, express_milk, or breastfeed'
        : 'eat, drink, or exercise';
      return `Submit a body action (${allowed}) to the Gateway. `
        + `For ${translatableHint}, pass natural-language description and omit physiology numbers unless exact measurements are known; `
        + 'the background translator converts description into structured parameters using this body\'s recent references. '
        + 'Also supports any additional declared organ actions from gateway capabilities. '
        + 'A 202 queued receipt only means the action is queued; it takes effect in a later heartbeat, '
        + 'so read body_state afterwards. Retrying the same session and tool call reuses the same action id.';
    },
  });

  const bodyState = {
    name: 'body_state',
    description: 'Sense your current subjective qualitative bodily feelings without raw numbers or measurements. '
      + 'Pass part or focus (such as all, hunger, thirst, urinary, bowel, respiration, circulation, '
      + 'temperature, sleep, activity, fatigue, metabolism, stress, discomfort, reproductive, or a body part id) '
      + 'to focus on one sensation area, or omit it to sense the whole body. Actions still queued with 202 take effect in a later heartbeat.',
    parameters: {
      type: 'object',
      properties: {
        part: {
          type: 'string',
          description: 'Optional sensation area or part id, for example all, hunger, thirst, bladder, or sleep.',
        },
        focus: {
          type: 'string',
          description: 'Alias of part: optional sensation area or part id.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'sleeping', 'dormant', 'paused'] },
          focus: { type: 'string' },
          feelings: {
            oneOf: [
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    area: { type: 'string' },
                    level: { type: 'string', enum: ['steady', 'mild', 'marked', 'strong', 'urgent'] },
                    feeling: { type: 'string' },
                  },
                  required: ['area', 'level', 'feeling'],
                  additionalProperties: false,
                },
              },
              { type: 'null' },
            ],
          },
          summary: { type: 'string' },
        },
        required: ['status', 'focus', 'feelings', 'summary'],
        additionalProperties: false,
      },
      render: renderJson,
    },
    async execute(args = {}, exec) {
      const input = isPlainRecord(args) ? args : {};
      const sessionId = resolveExecSessionId(exec);
      const rawFocus = input.focus ?? input.part;
      if (sessionId === null) {
        return {
          status: 'dormant',
          focus: redactUnownedFocus(rawFocus),
          feelings: [],
          summary: '当前会话缺少有效会话标识，无法感知身体状态。',
        };
      }
      const target = resolveScopedGateway(gateway, sessionId);
      if (!target) {
        const hasMappedTarget = typeof gateway?.resolveId === 'function' ? Boolean(gateway.resolveId(sessionId)) : true;
        return hasMappedTarget
          ? {
            status: 'paused',
            focus: sanitizeFocusLabel(rawFocus),
            feelings: null,
            summary: '当前身体网关暂不可用。',
          }
          : {
            status: 'dormant',
            focus: redactUnownedFocus(rawFocus),
            feelings: [],
            summary: '当前会话未绑定身体，无法感知身体状态。',
          };
      }
      const health = getGatewayHealthSafe(target);
      if (health?.fatal) {
        return {
          status: 'paused',
          focus: sanitizeFocusLabel(rawFocus),
          feelings: [],
          summary: '身体因内部脚本异常已停机，当前无法读取实时体感。',
        };
      }
      const bindStatus = currentBindStatus(target);
      if (bindStatus.bound && bindStatus.boundSessionId !== sessionId) {
        return {
          status: 'dormant',
          focus: redactUnownedFocus(rawFocus),
          feelings: [],
          summary: '当前会话未绑定身体，无法感知身体状态。',
        };
      }
      const active = bindStatus.active;
      const dormant = bindStatus.dormant;
      const nsfw = bindStatus.nsfw;
      const snapshot = dormant || !active ? null : target.getState();
      return buildBodyFeelingsSummary(snapshot, {
        focus: input.focus,
        part: input.part,
        nsfw,
        dormant,
        active,
      });
    },
  };

  const bodyBind = {
    name: 'body_bind',
    description: 'Bind, unbind, or inspect the conversation session attached to this body. '
      + 'Sessions stay unbound by default; do not call body_bind proactively unless the user explicitly asks to bind.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['bind', 'unbind', 'status'],
          description: "Operation to perform: 'bind' (default), 'unbind', or 'status'.",
        },
        sessionId: {
          type: 'string',
          description: 'Optional session id; must match the current tool context session id when present.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          bound: { type: 'boolean' },
          dormant: { type: 'boolean' },
          active: { type: 'boolean' },
          nsfw: { type: 'boolean' },
          boundSessionId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          error: { type: 'string' },
          feeling: { type: 'string' },
        },
        required: ['ok', 'bound', 'dormant', 'active', 'nsfw', 'boundSessionId'],
        additionalProperties: false,
      },
      render: renderJson,
    },
    async execute(args = {}, exec) {
      const input = isPlainRecord(args) ? args : {};
      const action = input.action ?? 'bind';
      const { sessionId, mismatch } = resolveBindTargetSessionId(input, exec);
      if (mismatch) {
        return {
          ok: false,
          bound: false,
          dormant: true,
          active: true,
          nsfw: false,
          boundSessionId: null,
          error: 'Cannot operate on another session',
        };
      }
      if (sessionId === null) {
        return {
          ok: false,
          bound: false,
          dormant: true,
          active: true,
          nsfw: false,
          boundSessionId: null,
          error: 'body_bind requires a nonempty sessionId',
        };
      }
      const target = resolveScopedGateway(gateway, sessionId);
      if (!target) {
        const hasMappedTarget = typeof gateway?.resolveId === 'function' ? Boolean(gateway.resolveId(sessionId)) : true;
        return {
          ok: false,
          bound: false,
          dormant: true,
          active: false,
          nsfw: false,
          boundSessionId: null,
          error: hasMappedTarget ? 'Target body gateway is unavailable' : 'No body is mapped to this session',
        };
      }
      const status = currentBindStatus(target);

      if (status.bound && status.boundSessionId !== sessionId) {
        return {
          ok: false,
          bound: false,
          dormant: true,
          active: status.active,
          nsfw: false,
          boundSessionId: null,
          error: action === 'unbind'
            ? 'Cannot unbind a body bound to another session'
            : (action === 'bind' ? 'Body is already bound to another session' : 'Body is bound to another session'),
        };
      }

      if (action === 'status') {
        return { ok: true, ...status };
      }

      if (action === 'unbind') {
        if (typeof target?.unbindSession !== 'function') {
          return { ok: false, ...status, error: 'Binding is not supported by this Gateway' };
        }
        try {
          const updated = await target.unbindSession(sessionId);
          const boundSessionId = updated?.boundSessionId ?? null;
          return {
            ok: true,
            bound: typeof boundSessionId === 'string' && boundSessionId !== '',
            dormant: Boolean(updated?.dormant ?? target?.isDormant?.() ?? true),
            active: updated?.active !== false,
            nsfw: Boolean(updated?.nsfw ?? isNsfwEnabled(target)),
            boundSessionId,
          };
        } catch (error) {
          const latest = currentBindStatus(target);
          if (latest.bound && latest.boundSessionId !== sessionId) {
            return {
              ok: false,
              bound: false,
              dormant: true,
              active: latest.active,
              nsfw: false,
              boundSessionId: null,
              error: 'Cannot unbind a body bound to another session',
            };
          }
          return {
            ok: false,
            ...latest,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      if (action === 'bind') {
        if (typeof target?.bindSession !== 'function') {
          return { ok: false, ...status, error: 'Binding is not supported by this Gateway' };
        }
        if (!status.active) {
          return {
            ok: false,
            ...status,
            error: 'Body Gateway is paused (active=false)',
          };
        }
        try {
          const updated = await target.bindSession(sessionId);
          const boundSessionId = updated?.boundSessionId ?? sessionId;
          const active = updated?.active !== false;
          const dormant = Boolean(updated?.dormant ?? target?.isDormant?.() ?? false);
          const nsfw = Boolean(updated?.nsfw ?? isNsfwEnabled(target));
          let feeling;
          if (active && !dormant && typeof target?.getState === 'function') {
            try {
              const summary = formatBodyFeelingsContext(target.getState(), { nsfw, dormant, active });
              if (summary) feeling = summary;
            } catch {
              feeling = undefined;
            }
          }
          return {
            ok: true,
            bound: typeof boundSessionId === 'string' && boundSessionId !== '',
            dormant,
            active,
            nsfw,
            boundSessionId,
            ...(feeling ? { feeling } : {}),
          };
        } catch (error) {
          const latest = currentBindStatus(target);
          if (latest.bound && latest.boundSessionId !== sessionId) {
            return {
              ok: false,
              bound: false,
              dormant: true,
              active: latest.active,
              nsfw: false,
              boundSessionId: null,
              error: 'Body is already bound to another session',
            };
          }
          return {
            ok: false,
            ...latest,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        ok: false,
        ...status,
        error: "action must be 'bind', 'unbind', or 'status'",
      };
    },
  };

  return {
    body_act: bodyAct,
    body_state: bodyState,
    body_bind: bodyBind,
  };
}

export function registerBodyTools(ctx, gateway, options = {}) {
  const tools = createBodyTools(gateway, { ...options, ctx });
  for (const definition of Object.values(tools)) {
    ctx.effect(() => ctx.tools.register(definition));
  }
  return tools;
}
