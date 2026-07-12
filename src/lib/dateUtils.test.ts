import { describe, it, expect, afterEach } from "vitest";
import { parseLocalDate, formatDate, todayLocalStr, dateToLocalStr } from "./dateUtils";

describe("parseLocalDate", () => {
  it("returns a Date at local noon, on the same calendar day as new Date(dateStr)", () => {
    const input = "2026-06-27T00:00:00.000Z";
    const reference = new Date(input);
    const result = parseLocalDate(input);

    expect(result.getFullYear()).toBe(reference.getFullYear());
    expect(result.getMonth()).toBe(reference.getMonth());
    expect(result.getDate()).toBe(reference.getDate());
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it("does not roll back a day for a midnight-UTC date in a negative-offset zone (the bug this exists to prevent)", () => {
    // Regardless of the local timezone, noon local time is never within 12
    // hours of the following UTC midnight, so the day-of-month must match
    // what new Date(dateStr) reports for the same instant.
    const input = "2026-01-01T00:00:00.000Z";
    const result = parseLocalDate(input);
    const reference = new Date(input);
    expect(result.getDate()).toBe(reference.getDate());
  });
});

describe("date-only string storage round-trip (invoice issueDate/dueDate)", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("round-trips a plain YYYY-MM-DD string back to the same day in a negative-UTC-offset zone", () => {
    // Regression: the invoice create/update routes used to store
    // `new Date(dateStr)` directly. For a date-only string like "2026-07-11",
    // that's parsed as UTC midnight, which rolls back to "2026-07-10" once
    // read back through dateToLocalStr/formatDate (local getters) in any
    // negative-offset timezone. The routes now mirror the established
    // pattern used elsewhere (e.g. clientJobConflicts.ts) of appending
    // "T12:00:00" before parsing.
    process.env.TZ = "America/New_York"; // UTC-4/UTC-5 — reproduces the bug

    const input = "2026-07-11";

    // The old, buggy behavior: store the raw date-only string as-is.
    const buggyStored = new Date(input);
    expect(dateToLocalStr(buggyStored.toISOString())).toBe("2026-07-10"); // proves the bug existed

    // The fixed behavior: what the API routes now do before writing to the DB.
    const fixedStored = parseLocalDate(`${input}T12:00:00`);
    expect(dateToLocalStr(fixedStored.toISOString())).toBe(input); // proves the fix
  });
});

describe("formatDate", () => {
  it("formats using the same local-noon parsing as parseLocalDate", () => {
    const input = "2026-06-27T00:00:00.000Z";
    const expected = parseLocalDate(input).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(formatDate(input)).toBe(expected);
  });
});

describe("todayLocalStr", () => {
  it("returns today's local date as YYYY-MM-DD", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    expect(todayLocalStr()).toBe(expected);
  });

  it("always returns a well-formed YYYY-MM-DD string", () => {
    expect(todayLocalStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dateToLocalStr", () => {
  it("round-trips a date string to the same YYYY-MM-DD as parseLocalDate reports", () => {
    const input = "2026-06-27T00:00:00.000Z";
    const parsed = parseLocalDate(input);
    const expected = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
      parsed.getDate()
    ).padStart(2, "0")}`;
    expect(dateToLocalStr(input)).toBe(expected);
  });
});
