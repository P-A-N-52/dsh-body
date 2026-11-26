import { getTimezoneOffsetMin } from './parameters.js';

/**
 * Computes the local circadian clock hour in `[0, periodHours)` from `wallTimeMs`.
 *
 * Uses `profile.timezoneOffsetMin` when explicitly configured (enabling timezone-independent
 * tests and fixed-timezone profiles), otherwise falls back to the host's local timezone offset
 * at `wallTimeMs` so restarts or >12h dormancy immediately realign to local wall-clock time.
 */
export function resolveCircadianHour(
  wallTimeMs,
  {
    periodHours = 24,
    phaseShiftHours = 0,
    timezoneOffsetMin,
  } = {},
) {
  const safePeriod = typeof periodHours === 'number' && Number.isFinite(periodHours) && periodHours > 0
    ? periodHours
    : 24;
  const safeShift = typeof phaseShiftHours === 'number' && Number.isFinite(phaseShiftHours)
    ? phaseShiftHours
    : 0;
  const effectiveWallMs = typeof wallTimeMs === 'number' && Number.isFinite(wallTimeMs)
    ? wallTimeMs
    : 0;
  const profileOffset = getTimezoneOffsetMin();
  const effectiveOffsetMin = typeof timezoneOffsetMin === 'number' && Number.isFinite(timezoneOffsetMin)
    ? timezoneOffsetMin
    : (typeof profileOffset === 'number' && Number.isFinite(profileOffset)
      ? profileOffset
      : -new Date(effectiveWallMs).getTimezoneOffset());
  const totalHours = effectiveWallMs / 3_600_000 + effectiveOffsetMin / 60 + safeShift;
  const wrapped = ((totalHours % safePeriod) + safePeriod) % safePeriod;
  return wrapped === safePeriod ? 0 : wrapped;
}
