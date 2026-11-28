/**
 * M12 A 日程（docs/superpowers/plans/2026-11-28-muscle-conservative-allocation.md:11）：
 * 75 kg 默认人体、当地 2026-11-20 06:00 UTC+8 起、60 s 轮长，共 4320 轮（72 h）。
 *
 * 本模块只做纯数据与构造：不 import Gateway、不做仿真。事件在各自生效分钟的前一轮提交
 * （`simulatedSeconds === (atMin − 1) × ROUND_SECONDS` 时入队），由真实 Gateway 在
 * `effectiveAt === atMin × ROUND_SECONDS` 的批次结算一次；日程本身不含时间推进逻辑。
 */

export const INTEGRATED_START_EPOCH_MS = Date.UTC(2026, 10, 19, 22, 0, 0); // 2026-11-20 06:00 UTC+8
export const ROUND_SECONDS = 60;
export const SCHEDULE_DAYS = 3;
export const ROUNDS_PER_DAY = 1440;
export const TOTAL_ROUNDS = ROUNDS_PER_DAY * SCHEDULE_DAYS; // 4320 轮 = 72 h
export const ORIGINAL_M12_ROUND = 2606; // M12 修复前的浮点透支轮；整合回放必须原路经过

/** 每日当地时间事件（分钟自当日 00:00 计）；顺序即批次内投递顺序。 */
const DAILY_TEMPLATE = [
  { minuteOfDay: 390, kind: 'wake_up' }, // 06:30 唤醒
  { minuteOfDay: 395, kind: 'urinate' }, // 06:35 排尿
  { minuteOfDay: 405, kind: 'water' }, // 06:45 白水 300 mL
  { minuteOfDay: 435, kind: 'defecate' }, // 07:15 排便
  { minuteOfDay: 450, kind: 'meal', volumeMl: 420, energyKcal: 650, carbohydrateG: 76 }, // 07:30 早
  { minuteOfDay: 570, kind: 'water' }, // 09:30
  { minuteOfDay: 630, kind: 'urinate' }, // 10:30
  { minuteOfDay: 735, kind: 'water' }, // 12:15
  { minuteOfDay: 750, kind: 'meal', volumeMl: 500, energyKcal: 750, carbohydrateG: 92 }, // 12:30 午
  { minuteOfDay: 780, kind: 'urinate' }, // 13:00
  { minuteOfDay: 900, kind: 'water' }, // 15:00
  { minuteOfDay: 1080, kind: 'water' }, // 18:00
  { minuteOfDay: 1110, kind: 'meal', volumeMl: 450, energyKcal: 700, carbohydrateG: 82 }, // 18:30 晚
  { minuteOfDay: 1110, kind: 'urinate' }, // 18:30 排尿（同分钟，晚于餐入队）
  { minuteOfDay: 1260, kind: 'water' }, // 21:00
  { minuteOfDay: 1345, kind: 'urinate' }, // 22:25
  { minuteOfDay: 1350, kind: 'sleep' }, // 22:30 入睡
];

export const ACTIONS_PER_DAY = DAILY_TEMPLATE.length; // 17

function actionPayload(kind, detail) {
  switch (kind) {
    case 'water':
      return { type: 'drink', volumeMl: 300, energyKcal: 0, carbohydrateG: 0, durationMin: 5 };
    case 'meal':
      return {
        type: 'eat',
        volumeMl: detail.volumeMl,
        energyKcal: detail.energyKcal,
        carbohydrateG: detail.carbohydrateG,
        mealKind: 'solid',
        durationMin: 15,
      };
    case 'sleep':
      return { type: 'sleep' };
    case 'wake_up':
      return { type: 'wake_up' };
    case 'urinate':
      return { type: 'urinate' };
    case 'defecate':
      return { type: 'defecate' };
    default:
      throw new Error(`unknown schedule kind ${kind}`);
  }
}

function localClockLabel(minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
}

/**
 * 构造整段日程：`days` 天、每天 ACTIONS_PER_DAY 个事件，按 `atMin`（距仿真起点的分钟数）
 * 升序排列。同一分钟内保持模板声明顺序（餐先于同分钟排尿）。
 */
export function buildIntegratedSchedule({ days = SCHEDULE_DAYS } = {}) {
  if (!Number.isInteger(days) || days < 1) throw new Error('days must be a positive integer');
  const events = [];
  for (let day = 1; day <= days; day += 1) {
    const dayOffsetMin = (day - 1) * ROUNDS_PER_DAY;
    for (const entry of DAILY_TEMPLATE) {
      const atMin = dayOffsetMin + (entry.minuteOfDay - 360); // 起点 06:00 当地
      if (atMin < 1) {
        throw new Error(`schedule event ${entry.kind} on day ${day} lands before the first round`);
      }
      events.push({
        id: `m12a-d${day}-${localClockLabel(entry.minuteOfDay)}-${entry.kind}`,
        atMin,
        kind: entry.kind,
        action: actionPayload(entry.kind, entry),
      });
    }
  }
  events.sort((left, right) => left.atMin - right.atMin);
  return events;
}

/** 事件应在当前轮次入队：生效分钟的前一轮。 */
export function eventsDueForSubmission(events, simulatedSeconds) {
  return events.filter((event) => (event.atMin - 1) * ROUND_SECONDS === simulatedSeconds);
}

/** 单个事件的结算契约：恰好一次，且发生在生效分钟整的批次。 */
export function assertEventSettledOnce(receipt, event) {
  const appliedAt = event.atMin * ROUND_SECONDS;
  if (!receipt) throw new Error(`${event.id}: no receipt recorded`);
  if (receipt.status !== 'applied') throw new Error(`${event.id}: status ${receipt.status}, expected applied`);
  if (receipt.effectiveAt !== appliedAt) {
    throw new Error(`${event.id}: effectiveAt ${receipt.effectiveAt}, expected ${appliedAt}`);
  }
  if (receipt.appliedAtSimulatedSeconds !== appliedAt) {
    throw new Error(
      `${event.id}: applied at ${receipt.appliedAtSimulatedSeconds}, expected exactly once at ${appliedAt}`,
    );
  }
  if (receipt.attempts !== 0) throw new Error(`${event.id}: settled after ${receipt.attempts} attempt(s)`);
  if (receipt.lastError !== null) throw new Error(`${event.id}: applied with lastError ${receipt.lastError}`);
  if (receipt.failedReason !== null) throw new Error(`${event.id}: applied with failedReason ${receipt.failedReason}`);
}
