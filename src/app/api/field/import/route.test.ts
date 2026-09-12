import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { buildExport, type FieldExport } from "@/lib/fieldExport";

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

// ---------------------------------------------------------------------------
// Stateful fake Prisma client. Unlike a plain vi.fn() mock, this actually
// persists AppliedOp/Job/TimeEntry/StockLevel rows across calls within a
// test — required to prove the double-import guarantee (a second apply of
// the same op must see the first call's AppliedOp row and reject with a
// real P2002-shaped error, exactly like the live Postgres primary key
// would). Mirrors the makeTx() pattern in src/lib/fieldOps.test.ts, widened
// to also stand in for the top-level `prisma` client the route reads job
// labels through and calls $transaction on.
// ---------------------------------------------------------------------------
function makeStatefulPrisma() {
  const appliedOps = new Map<string, { opId: string; opType: string; targetKey: string; outcome: string; resultId?: string }>();
  const jobs = new Map<string, { id: string; status: string; notes: string | null; assignedVehicleId: string | null; lineItems: Array<{ inventoryItemId: string; quantity: number }> }>();
  const stockLevels = new Map<string, { id: string; quantity: number }>();
  const timeEntries: Array<Record<string, unknown>> = [];

  jobs.set("job1", { id: "job1", status: "In Progress", notes: null, assignedVehicleId: "veh1", lineItems: [{ inventoryItemId: "item1", quantity: 2 }] });
  stockLevels.set("loc1:item1", { id: "sl1", quantity: 10 });

  const client: any = {
    appliedOp: {
      create: vi.fn(async ({ data }: any) => {
        if (appliedOps.has(data.opId)) throw uniqueConstraintError();
        appliedOps.set(data.opId, { ...data });
        return data;
      }),
      findUnique: vi.fn(async ({ where }: any) => appliedOps.get(where.opId) ?? null),
      findFirst: vi.fn(async ({ where }: any) => {
        const candidates = [...appliedOps.values()].filter(
          (r) => r.targetKey === where.targetKey && r.outcome === "applied" && r.opId !== where.opId.not
        );
        candidates.sort((a, b) => (a.opId < b.opId ? 1 : a.opId > b.opId ? -1 : 0));
        return candidates[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = appliedOps.get(where.opId);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    job: {
      findUnique: vi.fn(async ({ where }: any) => {
        const j = jobs.get(where.id);
        if (!j) return null;
        return { ...j, client: { name: "Acme Co" } };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const j = jobs.get(where.id);
        Object.assign(j!, data);
        return { id: j!.id };
      }),
    },
    jobAssignment: { findFirst: vi.fn(async () => ({ id: "a1" })) },
    jobLineItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    timeEntry: {
      create: vi.fn(async ({ data }: any) => {
        const entry = { id: `te_${timeEntries.length + 1}`, ...data };
        timeEntries.push(entry);
        return entry;
      }),
    },
    stockLocation: { findUnique: vi.fn(async () => ({ id: "loc1" })) },
    stockLevel: {
      findUnique: vi.fn(async () => stockLevels.get("loc1:item1") ?? null),
      update: vi.fn(async ({ data }: any) => {
        const sl = stockLevels.get("loc1:item1")!;
        if (data.quantity?.decrement) sl.quantity -= data.quantity.decrement;
        if (data.quantity?.increment) sl.quantity += data.quantity.increment;
        return sl;
      }),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(client)),
    _internal: { appliedOps, jobs, stockLevels, timeEntries },
  };
  return client;
}

const sharedPrisma = vi.hoisted(() => ({ current: null as any }));

vi.mock("@/lib/db", () => ({
  get prisma() {
    return sharedPrisma.current;
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: { userId: "u_admin", username: "admin1", displayName: "Admin One", role: "admin" } as Record<string, unknown> | null,
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => {
      if (!sessionPayload.current) throw new Error("no session");
      return { payload: sessionPayload.current };
    }),
  };
});

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/field/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validExport(): FieldExport {
  return buildExport({
    techId: "per_1",
    techName: "Jane Tech",
    queue: [
      { opId: "01Q_STATUS_B", url: "/api/field/ops", method: "POST", body: { jobId: "job1", status: "Completed" }, timestamp: 200 },
      { opId: "01Q_TIME_A", url: "/api/field/ops", method: "POST", body: { jobId: "job1", personnelId: "per_1", date: "2026-09-01", duration: "01:00" }, timestamp: 100 },
    ],
    stuck: [],
    history: [],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  sharedPrisma.current = makeStatefulPrisma();
  sessionPayload.current = { userId: "u_admin", username: "admin1", displayName: "Admin One", role: "admin" };
  vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
});

describe("POST /api/field/import", () => {
  it("returns 403 for a non-admin (tech) session", async () => {
    sessionPayload.current = { userId: "u_tech", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" };
    const res = await POST(makeReq({ mode: "preview", export: validExport() }));
    expect(res.status).toBe(403);
  });

  it("rejects a bad checksum with 400 before anything else happens", async () => {
    const exp = validExport();
    (exp as any).checksum = "deadbeef";

    const res = await POST(makeReq({ mode: "apply", export: exp }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/checksum/i);
    expect(sharedPrisma.current.$transaction).not.toHaveBeenCalled();
    expect(sharedPrisma.current.job.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unsupported schema version with 400", async () => {
    const exp = { ...validExport(), schemaVersion: 999 };
    const res = await POST(makeReq({ mode: "preview", export: exp }));
    expect(res.status).toBe(400);
  });

  it("preview mode makes zero writes", async () => {
    const res = await POST(makeReq({ mode: "preview", export: validExport() }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.classifications).toHaveLength(2);
    // Sorted ascending by opId: 01Q_STATUS_B < 01Q_TIME_A.
    expect(json.classifications.map((c: any) => c.opId)).toEqual(["01Q_STATUS_B", "01Q_TIME_A"]);
    expect(json.classifications.every((c: any) => c.classification === "new")).toBe(true);

    const p = sharedPrisma.current;
    expect(p.appliedOp.create).not.toHaveBeenCalled();
    expect(p.job.update).not.toHaveBeenCalled();
    expect(p.timeEntry.create).not.toHaveBeenCalled();
    expect(p.stockLevel.update).not.toHaveBeenCalled();
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("apply mode processes ops in opId ascending order even when the input array is out of order", async () => {
    // Two notes ops on the same job (replace semantics): put the NEWER opId
    // (lexicographically greater — "01NOTES_B" > "01NOTES_A") first in the
    // array. If the route applied array order instead of sorting by opId,
    // the older op would incorrectly win.
    const exp = buildExport({
      techId: "per_1",
      techName: "Jane Tech",
      queue: [
        { opId: "01NOTES_B", url: "/api/field/ops", method: "POST", body: { jobId: "job1", notes: "second" }, timestamp: 200 },
        { opId: "01NOTES_A", url: "/api/field/ops", method: "POST", body: { jobId: "job1", notes: "first" }, timestamp: 100 },
      ],
      stuck: [],
      history: [],
    });

    const res = await POST(makeReq({ mode: "apply", export: exp }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Both processed opId-ascending: A applied first (new), then B applied (also new,
    // since it's strictly newer than the just-applied A).
    expect(json.details.map((d: any) => d.opId)).toEqual(["01NOTES_A", "01NOTES_B"]);
    expect(json.details.map((d: any) => d.outcome)).toEqual(["applied", "applied"]);
    expect(sharedPrisma.current._internal.jobs.get("job1").notes).toBe("second");
  });

  it("apply mode called twice with the SAME export produces applied the first time and duplicate every time after — no double-counted stock deduction or duplicate TimeEntry", async () => {
    const exp = validExport();

    const first = await POST(makeReq({ mode: "apply", export: exp }));
    const firstJson = await first.json();

    expect(first.status).toBe(200);
    expect(firstJson.tally).toEqual({ applied: 2, superseded: 0, duplicate: 0, rejected: 0, invalid: 0 });

    const second = await POST(makeReq({ mode: "apply", export: exp }));
    const secondJson = await second.json();

    expect(second.status).toBe(200);
    expect(secondJson.tally).toEqual({ applied: 0, superseded: 0, duplicate: 2, rejected: 0, invalid: 0 });

    const p = sharedPrisma.current;
    // The status op deducted stock exactly once across both calls.
    expect(p.stockLevel.update).toHaveBeenCalledTimes(1);
    expect(p._internal.stockLevels.get("loc1:item1").quantity).toBe(8); // 10 - 2
    // The time op created exactly one TimeEntry across both calls.
    expect(p.timeEntry.create).toHaveBeenCalledTimes(1);
    expect(p._internal.timeEntries).toHaveLength(1);
  });

  it("records an invalid op without aborting the rest of the import", async () => {
    const exp = validExport();
    exp.ops.push({
      opId: "01GARBAGE",
      url: "/api/unknown",
      method: "POST",
      body: { nonsense: true },
      queuedAt: 300,
      source: "queue",
    });
    // Recompute checksum by rebuilding via buildExport-equivalent — simplest is
    // to just re-verify through the same helper used elsewhere.
    const { checksumForOps } = await import("@/lib/fieldExport");
    exp.checksum = checksumForOps(exp.ops);

    const res = await POST(makeReq({ mode: "apply", export: exp }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tally.invalid).toBe(1);
    expect(json.tally.applied).toBe(2);
  });
});
