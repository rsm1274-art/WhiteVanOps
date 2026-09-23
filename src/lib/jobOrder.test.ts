import { describe, it, expect } from "vitest";
import { normalizeArrivalTime, formatArrivalTime, compareJobsBySchedule, groupFieldJobs } from "./jobOrder";

describe("normalizeArrivalTime", () => {
  it("accepts valid 24-hour HH:MM", () => {
    expect(normalizeArrivalTime("08:30")).toBe("08:30");
    expect(normalizeArrivalTime(" 23:59 ")).toBe("23:59");
  });

  it("treats blank or absent as clearing the field", () => {
    expect(normalizeArrivalTime(undefined)).toBeNull();
    expect(normalizeArrivalTime(null)).toBeNull();
    expect(normalizeArrivalTime("")).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(normalizeArrivalTime("8:30")).toBeUndefined();
    expect(normalizeArrivalTime("24:00")).toBeUndefined();
    expect(normalizeArrivalTime("9am")).toBeUndefined();
    expect(normalizeArrivalTime(930)).toBeUndefined();
  });
});

describe("formatArrivalTime", () => {
  it("formats to a 12-hour clock", () => {
    expect(formatArrivalTime("00:05")).toBe("12:05 AM");
    expect(formatArrivalTime("09:30")).toBe("9:30 AM");
    expect(formatArrivalTime("12:00")).toBe("12:00 PM");
    expect(formatArrivalTime("13:45")).toBe("1:45 PM");
  });

  it("returns an empty string for no time", () => {
    expect(formatArrivalTime(null)).toBe("");
    expect(formatArrivalTime(undefined)).toBe("");
    expect(formatArrivalTime("junk")).toBe("");
  });
});

describe("compareJobsBySchedule", () => {
  it("orders by day, then time, with untimed jobs last in their day", () => {
    const jobs = [
      { id: "c", scheduledDate: "2026-09-24T12:00:00.000Z", arrivalTime: null },
      { id: "b", scheduledDate: "2026-09-24T12:00:00.000Z", arrivalTime: "13:00" },
      { id: "a", scheduledDate: "2026-09-24T12:00:00.000Z", arrivalTime: "08:00" },
      { id: "z", scheduledDate: "2026-09-23T12:00:00.000Z", arrivalTime: "17:00" },
    ];
    expect([...jobs].sort(compareJobsBySchedule).map((j) => j.id)).toEqual(["z", "a", "b", "c"]);
  });
});

describe("groupFieldJobs", () => {
  it("splits into today, upcoming (soonest first) and earlier (most recent first)", () => {
    const jobs = [
      { id: "past-old", scheduledDate: "2026-09-01T12:00:00.000Z" },
      { id: "future-far", scheduledDate: "2026-10-01T12:00:00.000Z" },
      { id: "today-pm", scheduledDate: "2026-09-23T12:00:00.000Z", arrivalTime: "14:00" },
      { id: "past-recent", scheduledDate: "2026-09-22T12:00:00.000Z" },
      { id: "future-near", scheduledDate: "2026-09-24T12:00:00.000Z" },
      { id: "today-am", scheduledDate: "2026-09-23T12:00:00.000Z", arrivalTime: "08:00" },
    ];
    const g = groupFieldJobs(jobs, "2026-09-23");
    expect(g.today.map((j) => j.id)).toEqual(["today-am", "today-pm"]);
    expect(g.upcoming.map((j) => j.id)).toEqual(["future-near", "future-far"]);
    expect(g.earlier.map((j) => j.id)).toEqual(["past-recent", "past-old"]);
  });
});
