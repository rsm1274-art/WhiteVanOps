import { describe, it, expect } from "vitest";
import { normalizeArrivalTime, formatArrivalTime, arrivalLabel, compareByDayThenArrival } from "./arrival";

describe("normalizeArrivalTime", () => {
  it("accepts HH:MM", () => {
    expect(normalizeArrivalTime("08:00")).toBe("08:00");
    expect(normalizeArrivalTime(" 23:59 ")).toBe("23:59");
  });
  it("treats empty/absent as a clear", () => {
    expect(normalizeArrivalTime("")).toBeNull();
    expect(normalizeArrivalTime(null)).toBeNull();
    expect(normalizeArrivalTime(undefined)).toBeNull();
  });
  it("rejects anything else", () => {
    expect(normalizeArrivalTime("8:00")).toBeUndefined();
    expect(normalizeArrivalTime("24:00")).toBeUndefined();
    expect(normalizeArrivalTime("morning")).toBeUndefined();
    expect(normalizeArrivalTime(800)).toBeUndefined();
  });
});

describe("formatArrivalTime / arrivalLabel", () => {
  it("formats 12-hour", () => {
    expect(formatArrivalTime("00:05")).toBe("12:05 AM");
    expect(formatArrivalTime("12:00")).toBe("12:00 PM");
    expect(formatArrivalTime("14:30")).toBe("2:30 PM");
  });
  it("combines time and window", () => {
    expect(arrivalLabel({ arrivalTime: "08:00", arrivalWindow: "8–10 AM" })).toBe("8:00 AM · 8–10 AM");
    expect(arrivalLabel({ arrivalWindow: "PM" })).toBe("PM");
    expect(arrivalLabel({})).toBe("");
  });
});

describe("compareByDayThenArrival", () => {
  const cmp = compareByDayThenArrival((iso: string) => iso.slice(0, 10));
  it("orders by day, then time, untimed last", () => {
    const jobs = [
      { id: "c", scheduledDate: "2026-09-02T12:00:00Z", arrivalTime: "07:00" },
      { id: "u", scheduledDate: "2026-09-01T12:00:00Z", arrivalTime: null },
      { id: "b", scheduledDate: "2026-09-01T12:00:00Z", arrivalTime: "13:00" },
      { id: "a", scheduledDate: "2026-09-01T12:00:00Z", arrivalTime: "08:30" },
    ];
    expect([...jobs].sort(cmp).map((j) => j.id)).toEqual(["a", "b", "u", "c"]);
  });
});
