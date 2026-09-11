import { describe, test, expect } from "vitest";
import { targetKeyFor, shouldApply } from "@/lib/opOrdering";

describe("targetKeyFor", () => {
  test("time ops get a unique per-op key — inserts never collide", () => {
    const k1 = targetKeyFor("time", "job1", "OP1");
    const k2 = targetKeyFor("time", "job1", "OP2");
    expect(k1).toBe("job:job1:time:OP1");
    expect(k2).toBe("job:job1:time:OP2");
    expect(k1).not.toBe(k2);
  });

  test.each(["notes", "lineItems", "status"] as const)(
    "%s ops share one per-job-per-field key regardless of opId",
    (opType) => {
      const k1 = targetKeyFor(opType, "job1", "OP1");
      const k2 = targetKeyFor(opType, "job1", "OP2");
      expect(k1).toBe(`job:job1:${opType}`);
      expect(k1).toBe(k2);
    }
  );

  test("different jobs never share a target key", () => {
    expect(targetKeyFor("status", "job1", "OP1")).not.toBe(targetKeyFor("status", "job2", "OP1"));
  });
});

describe("shouldApply", () => {
  test("accepts the first-ever op for a target (null prior)", () => {
    expect(shouldApply("01ABCDEFGH0123456789ABCDEF", null)).toBe(true);
  });

  test("accepts a newer opId arriving after an older one", () => {
    expect(shouldApply("01BBBBBBBB0123456789ABCDEF", "01AAAAAAAA0123456789ABCDEF")).toBe(true);
  });

  test("rejects an older opId arriving after a newer one", () => {
    expect(shouldApply("01AAAAAAAA0123456789ABCDEF", "01BBBBBBBB0123456789ABCDEF")).toBe(false);
  });

  test("rejects an exact-duplicate opId — equal is never newer", () => {
    const id = "01AAAAAAAA0123456789ABCDEF";
    expect(shouldApply(id, id)).toBe(false);
  });

  test("the scenario this exists to prevent: an older 'In Progress' status op arriving after a newer 'Completed' one is rejected", () => {
    // Op A: status -> "In Progress", generated first (older opId).
    const inProgressOpId = "01H0000000AAAAAAAAAAAAAAAA";
    // Op B: status -> "Completed", generated later (newer opId) but delivered
    // to the server first (e.g. op A was queued offline and replayed late).
    const completedOpId = "01H0000001BBBBBBBBBBBBBBBB";

    // Completed applies first — nothing applied yet for this target.
    expect(shouldApply(completedOpId, null)).toBe(true);

    // In Progress arrives after Completed was already applied: must be
    // rejected, or the job would regress from Completed back to In Progress.
    expect(shouldApply(inProgressOpId, completedOpId)).toBe(false);
  });
});
