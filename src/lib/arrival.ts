/**
 * Optional within-day ordering for jobs (Job.arrivalTime / Job.arrivalWindow).
 * Scheduling conflicts stay day-level (see jobConflicts.ts) — these fields
 * only order and label a tech's stops, they are never used for conflict math.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate an arrival time from a request body. Returns the "HH:MM" string,
 * null for empty/absent (clears it), or undefined when the value is invalid.
 */
export function normalizeArrivalTime(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (v === "") return null;
  return HHMM.test(v) ? v : undefined;
}

/** "14:30" → "2:30 PM". Returns the input unchanged if it isn't HH:MM. */
export function formatArrivalTime(time: string): string {
  if (!HHMM.test(time)) return time;
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Display label combining both fields, e.g. "8:00 AM · 8–10 AM window". Empty string if neither is set. */
export function arrivalLabel(job: { arrivalTime?: string | null; arrivalWindow?: string | null }): string {
  const parts: string[] = [];
  if (job.arrivalTime) parts.push(formatArrivalTime(job.arrivalTime));
  if (job.arrivalWindow) parts.push(job.arrivalWindow);
  return parts.join(" · ");
}

/**
 * Sort comparator: by scheduled calendar day, then by arrival time within
 * the day. Jobs with no arrival time sort after timed ones on the same day.
 * `dayKey` must map a job to a sortable local-date string (yyyy-mm-dd).
 */
export function compareByDayThenArrival<T extends { scheduledDate: string; arrivalTime?: string | null }>(
  dayKey: (iso: string) => string
) {
  return (a: T, b: T): number => {
    const da = dayKey(a.scheduledDate);
    const db = dayKey(b.scheduledDate);
    if (da !== db) return da < db ? -1 : 1;
    const ta = a.arrivalTime || "99:99";
    const tb = b.arrivalTime || "99:99";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  };
}
