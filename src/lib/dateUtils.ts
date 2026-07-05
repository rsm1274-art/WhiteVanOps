// Parse a date string (e.g. "2026-06-27T00:00:00.000Z") as local noon to
// prevent UTC midnight rolling back to the previous day in negative-offset zones.
export function parseLocalDate(dateStr: string): Date {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

export function formatDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function todayLocalStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function dateToLocalStr(dateStr: string): string {
  return parseLocalDate(dateStr)
    .toISOString()
    .split("T")[0];
}
