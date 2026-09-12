import { describe, it, expect } from "vitest";
import {
  EXPORT_SCHEMA_VERSION,
  fnv1aChecksum,
  checksumForOps,
  buildExport,
  verifyExport,
  type ExportedOp,
} from "./fieldExport";

function op(overrides: Partial<ExportedOp> = {}): ExportedOp {
  return {
    opId: "01AAAAAAAAAAAAAAAAAAAAAAAA",
    url: "/api/field/ops",
    method: "POST",
    body: { jobId: "job1", status: "Completed" },
    queuedAt: 1000,
    source: "queue",
    ...overrides,
  };
}

describe("fnv1aChecksum", () => {
  it("is deterministic for the same input", () => {
    expect(fnv1aChecksum("hello world")).toBe(fnv1aChecksum("hello world"));
  });

  it("produces different hashes for different input", () => {
    expect(fnv1aChecksum("hello world")).not.toBe(fnv1aChecksum("hello world!"));
  });

  it("returns an 8-char lowercase hex string", () => {
    const h = fnv1aChecksum("anything");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("checksumForOps", () => {
  it("is order-independent", () => {
    const ops = [
      op({ opId: "01AAAAAAAAAAAAAAAAAAAAAAAA" }),
      op({ opId: "01BBBBBBBBBBBBBBBBBBBBBBBB" }),
      op({ opId: "01CCCCCCCCCCCCCCCCCCCCCCCC" }),
    ];
    const shuffled = [ops[2], ops[0], ops[1]];
    expect(checksumForOps(ops)).toBe(checksumForOps(shuffled));
  });

  it("changes if an op's content changes", () => {
    const a = [op({ body: { jobId: "job1", status: "Completed" } })];
    const b = [op({ body: { jobId: "job1", status: "In Progress" } })];
    expect(checksumForOps(a)).not.toBe(checksumForOps(b));
  });
});

describe("buildExport", () => {
  it("tags each op's source and computes summary counts from a mixed fixture", () => {
    const result = buildExport({
      techId: "per_1",
      techName: "Jane Tech",
      queue: [
        { opId: "01Q1", url: "/api/field/ops", method: "POST", body: { jobId: "job1", duration: "01:00" }, timestamp: 100 },
        { opId: "01Q2", url: "/api/field/ops", method: "POST", body: { jobId: "job1", notes: "hi" }, timestamp: 200 },
      ],
      stuck: [
        { opId: "01S1", url: "/api/field/ops", method: "POST", body: { jobId: "job1", status: "Completed" }, queuedAt: 300 },
      ],
      history: [
        { opId: "01H1", url: "/api/field/ops", method: "POST", body: { jobId: "job1", lineItems: [] }, queuedAt: 400 },
      ],
    });

    expect(result.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(result.techId).toBe("per_1");
    expect(result.techName).toBe("Jane Tech");
    expect(result.ops).toHaveLength(4);

    const bySource = Object.fromEntries(result.ops.map((o) => [o.opId, o.source]));
    expect(bySource["01Q1"]).toBe("queue");
    expect(bySource["01Q2"]).toBe("queue");
    expect(bySource["01S1"]).toBe("stuck");
    expect(bySource["01H1"]).toBe("history");

    expect(result.summary).toEqual({ timeEntries: 1, statusChanges: 1, notes: 1, materials: 1 });
  });

  it("sets a checksum that verifies", () => {
    const result = buildExport({
      techId: null,
      techName: "Unknown",
      queue: [{ opId: "01Q1", url: "/api/field/ops", method: "POST", body: { jobId: "job1", duration: "01:00" }, timestamp: 100 }],
      stuck: [],
      history: [],
    });
    const verified = verifyExport(result);
    expect(verified.ok).toBe(true);
  });

  it("does not tally an unparseable op into the summary", () => {
    const result = buildExport({
      techId: null,
      techName: "Unknown",
      queue: [{ opId: "01Q1", url: "/api/garbage", method: "POST", body: { foo: "bar" }, timestamp: 100 }],
      stuck: [],
      history: [],
    });
    expect(result.summary).toEqual({ timeEntries: 0, statusChanges: 0, notes: 0, materials: 0 });
    expect(result.ops).toHaveLength(1);
  });
});

describe("verifyExport", () => {
  function validExport() {
    return buildExport({
      techId: "per_1",
      techName: "Jane Tech",
      queue: [{ opId: "01Q1", url: "/api/field/ops", method: "POST", body: { jobId: "job1", duration: "01:00" }, timestamp: 100 }],
      stuck: [],
      history: [],
    });
  }

  it("accepts a valid export", () => {
    const result = verifyExport(validExport());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ops).toHaveLength(1);
    }
  });

  it("rejects a wrong schemaVersion", () => {
    const data = { ...validExport(), schemaVersion: 2 };
    const result = verifyExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/schema version/i);
  });

  it("rejects a tampered checksum (op body mutated after building)", () => {
    const data = validExport();
    data.ops[0].body = { jobId: "job1", duration: "99:99" };
    const result = verifyExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/checksum/i);
  });

  it("rejects non-object input without throwing", () => {
    expect(() => verifyExport("not an object")).not.toThrow();
    expect(verifyExport("not an object").ok).toBe(false);
    expect(() => verifyExport(null)).not.toThrow();
    expect(verifyExport(null).ok).toBe(false);
    expect(() => verifyExport([1, 2, 3])).not.toThrow();
    expect(verifyExport([1, 2, 3]).ok).toBe(false);
  });

  it("rejects when ops is not an array", () => {
    const data = { ...validExport(), ops: "not an array" };
    const result = verifyExport(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ops array/i);
  });

  it("rejects when an op is missing required fields", () => {
    const data = validExport();
    // @ts-expect-error deliberately malformed for the test
    data.ops[0] = { opId: "01Q1" };
    const result = verifyExport(data);
    expect(result.ok).toBe(false);
  });
});
