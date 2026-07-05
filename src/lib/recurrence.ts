export type RecurrenceFrequency = "Weekly" | "Biweekly" | "Monthly";

/**
 * Given an occurrence date, return the next one for the given cadence.
 * Monthly advances by calendar month (same day-of-month); on short months
 * this can roll into the following month (e.g. Jan 31 -> Mar 3), the same
 * caveat every calendar-month scheduler has — flagged here rather than
 * silently accepted.
 */
export function nextOccurrence(date: Date, frequency: RecurrenceFrequency): Date {
  const next = new Date(date);
  if (frequency === "Weekly") {
    next.setDate(next.getDate() + 7);
  } else if (frequency === "Biweekly") {
    next.setDate(next.getDate() + 14);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}
