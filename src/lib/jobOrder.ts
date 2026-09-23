import { dateToLocalStr } from "./dateUtils";

/**
 * Ordering helpers for a day with more than one job on it. Scheduling stays
 * day-granular (conflicts are checked per day, see jobConflicts.ts); the
 * optional `arrivalTime` ("HH:MM", 24-hour) only orders jobs within a day
 * and tells the tech/customer when to expect the van.
 */

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates an arrivalTime from a request body.
 * Returns the "HH:MM" string, `null` when blank/absent (clears the field),
 * or `undefined` when the value is present but malformed — callers 400 on that.
 */
export function normalizeArrivalTime(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return HH_MM.test(trimmed) ? trimmed : undefined;
}

/** "13:30" → "1:30 PM". Empty string for no time. Locale-independent on purpose. */
export function formatArrivalTime(value: string | null | undefined): string {
  if (!value || !HH_MM.test(value)) return "";
  const [h, m] = value.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

interface Schedulable {
  scheduledDate: string;
  arrivalTime?: string | null;
}

/** Sort by day, then arrival time within the day; jobs with no time go last in their day. */
export function compareJobsBySchedule(a: Schedulable, b: Schedulable): number {
  const day = dateToLocalStr(a.scheduledDate).localeCompare(dateToLocalStr(b.scheduledDate));
  if (day !== 0) return day;
  const at = a.arrivalTime || "99:99";
  const bt = b.arrivalTime || "99:99";
  return at.localeCompare(bt);
}

export interface FieldJobGroups<T> {
  today: T[];
  upcoming: T[];
  earlier: T[];
}

/**
 * Splits a tech's job list into Today / Upcoming / Earlier for the field page.
 * `today` is a "yyyy-mm-dd" local date string (todayLocalStr()). Today and
 * Upcoming run soonest-first; Earlier runs most-recent-first so an overdue
 * job from yesterday sits above one from last month.
 */
export function groupFieldJobs<T extends Schedulable>(jobs: T[], today: string): FieldJobGroups<T> {
  const sorted = [...jobs].sort(compareJobsBySchedule);
  const groups: FieldJobGroups<T> = { today: [], upcoming: [], earlier: [] };
  for (const job of sorted) {
    const day = dateToLocalStr(job.scheduledDate);
    if (day === today) groups.today.push(job);
    else if (day > today) groups.upcoming.push(job);
    else groups.earlier.push(job);
  }
  groups.earlier.reverse();
  return groups;
}
