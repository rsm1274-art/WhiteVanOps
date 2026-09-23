import { describe, it, expect } from "vitest";
import { jobBadge, reconcileSeen } from "./jobSeen";

const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-09-01T11:00:00.000Z";
const none = new Set<string>();

describe("jobBadge", () => {
  it("shows nothing before any baseline exists", () => {
    expect(jobBadge({ id: "a", updatedAt: T1 }, null, none)).toBeNull();
  });
  it("flags an unseen job as new", () => {
    expect(jobBadge({ id: "a", updatedAt: T1 }, {}, none)).toBe("new");
  });
  it("flags a job changed since last seen as updated", () => {
    expect(jobBadge({ id: "a", updatedAt: T2 }, { a: T1 }, none)).toBe("updated");
    expect(jobBadge({ id: "a", updatedAt: T1 }, { a: T1 }, none)).toBeNull();
  });
  it("never badges a job the tech just wrote to", () => {
    expect(jobBadge({ id: "a", updatedAt: T2 }, { a: T1 }, new Set(["a"]))).toBeNull();
  });
});

describe("reconcileSeen", () => {
  it("baselines every job on first run", () => {
    const r = reconcileSeen(null, [{ id: "a", updatedAt: T1 }], [], none);
    expect(r.seen).toEqual({ a: T1 });
  });
  it("keeps unseen jobs unseen and prunes vanished ones", () => {
    const r = reconcileSeen({ a: T1, gone: T1 }, [{ id: "a", updatedAt: T2 }, { id: "b", updatedAt: T1 }], [], none);
    expect(r.seen).toEqual({ a: T1 });
  });
  it("re-stamps self-touched jobs once their writes have synced", () => {
    const r = reconcileSeen({ a: T1 }, [{ id: "a", updatedAt: T2 }], ["a"], none);
    expect(r.seen).toEqual({ a: T2 });
    expect(r.selfTouched).toEqual([]);
  });
  it("holds self-touched jobs while writes are still queued", () => {
    const r = reconcileSeen({ a: T1 }, [{ id: "a", updatedAt: T1 }], ["a"], new Set(["a"]));
    expect(r.seen).toEqual({ a: T1 });
    expect(r.selfTouched).toEqual(["a"]);
  });
});
