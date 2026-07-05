import { describe, it, expect } from "vitest";
import { applyTransform, applyValueMap, collapseWhitespace } from "./transforms";

describe("date transforms", () => {
  it("date-iso passes through valid ISO dates", () => {
    expect(applyTransform("date-iso", "2026-07-10")).toEqual({ ok: true, value: "2026-07-10" });
    expect(applyTransform("date-iso", "2026-7-3")).toEqual({ ok: true, value: "2026-07-03" });
  });
  it("date-mdy converts US dates, expanding 2-digit years", () => {
    expect(applyTransform("date-mdy", "7/10/2026")).toEqual({ ok: true, value: "2026-07-10" });
    expect(applyTransform("date-mdy", "12-31-26")).toEqual({ ok: true, value: "2026-12-31" });
  });
  it("date-dmy converts day-first dates", () => {
    expect(applyTransform("date-dmy", "10/7/2026")).toEqual({ ok: true, value: "2026-07-10" });
  });
  it("rejects impossible calendar dates and garbage", () => {
    expect(applyTransform("date-mdy", "2/30/2026").ok).toBe(false);
    expect(applyTransform("date-iso", "soon").ok).toBe(false);
  });
  it("labels calendar-invalid dates with the transform's format", () => {
    const r = applyTransform("date-mdy", "13/45/2026");
    expect(r).toEqual({ ok: false, reason: '"13/45/2026" is not a M/D/Y date' });
  });
});

describe("currency and int", () => {
  it("currency strips $ and commas", () => {
    expect(applyTransform("currency", "$1,234.50")).toEqual({ ok: true, value: "1234.5" });
    expect(applyTransform("currency", "n/a").ok).toBe(false);
  });
  it("int accepts whole numbers only", () => {
    expect(applyTransform("int", "1,200")).toEqual({ ok: true, value: "1200" });
    expect(applyTransform("int", "3.5").ok).toBe(false);
  });
});

describe("helpers", () => {
  it("collapseWhitespace trims and collapses runs", () => {
    expect(collapseWhitespace("  a   b \t c ")).toBe("a b c");
  });
  it("applyValueMap translates when a map exists, else passes through", () => {
    const maps = { "Job.status": { Open: "Scheduled" } };
    expect(applyValueMap(maps, "Job.status", "Open")).toBe("Scheduled");
    expect(applyValueMap(maps, "Job.status", "Odd")).toBe("Odd");
    expect(applyValueMap(undefined, "Job.status", "Open")).toBe("Open");
  });
});
