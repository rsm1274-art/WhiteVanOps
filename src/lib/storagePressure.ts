/**
 * Decide whether the field module should show a storage-pressure warning.
 *
 * `navigator.storage.estimate()` is the primary signal: once usage crosses
 * ~80% of quota, IndexedDB writes can start failing (QuotaExceededError),
 * which would silently drop queued work. When the estimate is unavailable —
 * it requires a secure context, which a plain-http LAN origin (Base tier's
 * whole transport) doesn't have, and even where it exists the method can be
 * missing on older browsers — fall back to a queue-depth threshold.
 *
 * 25 is the fallback threshold: a normal day's work is a handful of ops
 * (status change, notes, a couple of line-item edits, a time entry) per job
 * across maybe 5-8 assigned jobs, so a normal unsynced day sits well under
 * 25. A tech who hasn't reached office WiFi in several days is the case this
 * is meant to catch.
 */
export const STORAGE_PRESSURE_RATIO = 0.8;
export const PENDING_COUNT_FALLBACK_THRESHOLD = 25;

export function shouldWarnAboutStorage(
  estimate: { usage: number; quota: number } | null,
  pendingCount: number
): boolean {
  if (estimate === null) return pendingCount > PENDING_COUNT_FALLBACK_THRESHOLD;
  if (!(estimate.quota > 0)) return pendingCount > PENDING_COUNT_FALLBACK_THRESHOLD;
  return estimate.usage / estimate.quota > STORAGE_PRESSURE_RATIO;
}
