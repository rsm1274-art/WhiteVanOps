import { describe, it, expect } from "vitest";
import { parseSeen, reconcileSeen, jobBadge } from "./fieldSeen";

const T1 = "2026-09-20T10:00:00.000Z";
const T2 = "2026-09-21T10:00:00.000Z";

describe("parseSeen", () => {
  it("returns null for missing or corrupt storage", () => {
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen("not json")).toBeNull();
    expect(parseSeen("[1,2]")).toBeNull();
  });

  it("parses a stored map", () => {
    expect(parseSeen(JSON.stringify({ a: T1 }))).toEqual({ a: T1 });
  });
});

describe("reconcileSeen", () => {
  it("marks every job seen on the first ever load", () => {
    const next = reconcileSeen(null, [{ id: "a", updatedAt: T1 }, { id: "b", updatedAt: T2 }]);
    expect(next).toEqual({ a: T1, b: T2 });
  });

  it("keeps prior seen values and does not auto-mark new jobs", () => {
    const next = reconcileSeen({ a: T1 }, [{ id: "a", updatedAt: T2 }, { id: "b", updatedAt: T2 }]);
    expect(next).toEqual({ a: T1 });
  });

  it("marks the tech's own writes as seen at the new updatedAt", () => {
    const next = reconcileSeen({ a: T1 }, [{ id: "a", updatedAt: T2 }], new Set(["a"]));
    expect(next).toEqual({ a: T2 });
  });

  it("drops jobs no longer on the list", () => {
    expect(reconcileSeen({ a: T1, gone: T1 }, [{ id: "a", updatedAt: T1 }])).toEqual({ a: T1 });
  });
});

describe("jobBadge", () => {
  it("shows no badges before the first load has been recorded", () => {
    expect(jobBadge({ id: "a", updatedAt: T2 }, null)).toBeNull();
  });

  it("flags unseen jobs as new and changed jobs as updated", () => {
    const seen = { a: T1, b: T2 };
    expect(jobBadge({ id: "new", updatedAt: T1 }, seen)).toBe("new");
    expect(jobBadge({ id: "a", updatedAt: T2 }, seen)).toBe("updated");
    expect(jobBadge({ id: "b", updatedAt: T2 }, seen)).toBeNull();
  });
});
