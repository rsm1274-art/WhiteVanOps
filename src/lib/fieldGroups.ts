import { compareByDayThenArrival } from "./arrival";

/**
 * Splits the tech's job list into Today / Upcoming / Earlier by local
 * calendar day. Today and Upcoming run soonest-first (by arrival time within
 * a day); Earlier runs most-recent-first.
 */
export interface FieldJobGroups<T> {
  today: T[];
  upcoming: T[];
  earlier: T[];
}

export function groupFieldJobs<T extends { scheduledDate: string; arrivalTime?: string | null }>(
  jobs: T[],
  todayStr: string,
  dayKey: (iso: string) => string
): FieldJobGroups<T> {
  const cmp = compareByDayThenArrival<T>(dayKey);
  const today: T[] = [];
  const upcoming: T[] = [];
  const earlier: T[] = [];
  for (const j of jobs) {
    const d = dayKey(j.scheduledDate);
    if (d === todayStr) today.push(j);
    else if (d > todayStr) upcoming.push(j);
    else earlier.push(j);
  }
  today.sort(cmp);
  upcoming.sort(cmp);
  earlier.sort((a, b) => {
    const da = dayKey(a.scheduledDate);
    const db = dayKey(b.scheduledDate);
    return da !== db ? (da < db ? 1 : -1) : cmp(a, b);
  });
  return { today, upcoming, earlier };
}
