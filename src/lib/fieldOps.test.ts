import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { logTime, setJobNotes, setJobLineItems, setJobStatus, classifyOpForImport, type FieldActor } from "./fieldOps";

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(),
}));

import { audit } from "@/lib/audit";

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

/** A structural fake of Prisma.TransactionClient covering only what fieldOps.ts calls. */
function makeTx() {
  return {
    appliedOp: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    jobAssignment: {
      findFirst: vi.fn(),
    },
    job: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    jobLineItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    timeEntry: {
      create: vi.fn(),
    },
    stockLocation: {
      findUnique: vi.fn(),
    },
    stockLevel: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
}

const techActor: FieldActor = { userId: "u_tech", personnelId: "per_1", role: "tech" };
const adminActor: FieldActor = { userId: "u_admin", personnelId: null, role: "admin" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("logTime", () => {
  it("rejects an invalid duration format with 400", async () => {
    const tx = makeTx();
    const res = await logTime(tx as unknown as Prisma.TransactionClient, adminActor, "op1", {
      jobId: "job1",
      personnelId: "per_1",
      date: "2026-09-01",
      duration: "9:30",
    });
    expect(res).toEqual({ outcome: "rejected", status: 400, error: expect.stringMatching(/HH:MM/) });
    expect(tx.timeEntry.create).not.toHaveBeenCalled();
  });

  it("rejects missing required fields with 400", async () => {
    const tx = makeTx();
    const res = await logTime(tx as unknown as Prisma.TransactionClient, adminActor, "op1", {
      jobId: "",
      personnelId: "per_1",
      date: "2026-09-01",
      duration: "01:00",
    });
    expect(res.outcome).toBe("rejected");
    expect(res.status).toBe(400);
  });

  it("rejects a tech logging time for someone else", async () => {
    const tx = makeTx();
    const res = await logTime(tx as unknown as Prisma.TransactionClient, techActor, "op1", {
      jobId: "job1",
      personnelId: "per_other",
      date: "2026-09-01",
      duration: "01:00",
    });
    expect(res).toEqual({ outcome: "rejected", status: 403, error: "You can only log time for yourself" });
    expect(tx.jobAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a tech not assigned to the job", async () => {
    const tx = makeTx();
    tx.jobAssignment.findFirst.mockResolvedValue(null);
    const res = await logTime(tx as unknown as Prisma.TransactionClient, techActor, "op1", {
      jobId: "job1",
      personnelId: "per_1",
      date: "2026-09-01",
      duration: "01:00",
    });
    expect(res).toEqual({ outcome: "rejected", status: 403, error: "You are not assigned to this job" });
    expect(tx.timeEntry.create).not.toHaveBeenCalled();
  });

  it("applies successfully for an assigned tech", async () => {
    const tx = makeTx();
    tx.jobAssignment.findFirst.mockResolvedValue({ id: "a1" });
    tx.timeEntry.create.mockResolvedValue({ id: "te1" });

    const res = await logTime(tx as unknown as Prisma.TransactionClient, techActor, "op1", {
      jobId: "job1",
      personnelId: "per_1",
      date: "2026-09-01",
      duration: "01:00",
    });

    expect(res).toEqual({ outcome: "applied", resultId: "te1" });
    expect(tx.timeEntry.create).toHaveBeenCalledWith({
      data: {
        jobId: "job1",
        personnelId: "per_1",
        date: new Date("2026-09-01T12:00:00"),
        duration: "01:00",
        serviceItem: "Field Labor",
        payrollItem: "Regular Pay",
        qbTimeSyncStatus: "Pending",
      },
    });
    expect(audit).toHaveBeenCalledWith("u_tech", "CREATE", "TimeEntry", "te1", expect.any(Object));
  });

  it("admin bypasses the assignment check entirely", async () => {
    const tx = makeTx();
    tx.timeEntry.create.mockResolvedValue({ id: "te1" });

    const res = await logTime(tx as unknown as Prisma.TransactionClient, adminActor, "op1", {
      jobId: "job1",
      personnelId: "per_someone",
      date: "2026-09-01",
      duration: "01:00",
    });

    expect(res.outcome).toBe("applied");
    expect(tx.jobAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("returns duplicate and writes nothing on a repeated opId", async () => {
    const tx = makeTx();
    tx.appliedOp.create.mockRejectedValue(uniqueConstraintError());

    const res = await logTime(tx as unknown as Prisma.TransactionClient, adminActor, "op1", {
      jobId: "job1",
      personnelId: "per_1",
      date: "2026-09-01",
      duration: "01:00",
    });

    expect(res).toEqual({ outcome: "duplicate" });
    expect(tx.timeEntry.create).not.toHaveBeenCalled();
  });
});

describe("setJobNotes", () => {
  it("rejects a tech not assigned to the job", async () => {
    const tx = makeTx();
    tx.jobAssignment.findFirst.mockResolvedValue(null);
    const res = await setJobNotes(tx as unknown as Prisma.TransactionClient, techActor, "op1", { jobId: "job1", notes: "hi" });
    expect(res.outcome).toBe("rejected");
    expect(res.status).toBe(403);
    expect(tx.job.update).not.toHaveBeenCalled();
  });

  it("an assigned tech can successfully save notes — the bug this phase fixes", async () => {
    const tx = makeTx();
    tx.jobAssignment.findFirst.mockResolvedValue({ id: "a1" });
    tx.job.findUnique.mockResolvedValue({ id: "job1" });
    tx.appliedOp.findFirst.mockResolvedValue(null);
    tx.job.update.mockResolvedValue({ id: "job1" });

    const res = await setJobNotes(tx as unknown as Prisma.TransactionClient, techActor, "op1", { jobId: "job1", notes: "site notes" });

    expect(res).toEqual({ outcome: "applied", resultId: "job1" });
    expect(tx.job.update).toHaveBeenCalledWith({ where: { id: "job1" }, data: { notes: "site notes" } });
    expect(audit).toHaveBeenCalledWith("u_tech", "UPDATE", "Job", "job1", expect.any(Object));
  });

  it("returns 404 when the job does not exist", async () => {
    const tx = makeTx();
    tx.job.findUnique.mockResolvedValue(null);
    const res = await setJobNotes(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "ghost", notes: "x" });
    expect(res).toEqual({ outcome: "rejected", status: 404, error: "Job not found" });
  });

  it("returns duplicate on a repeated opId without touching the job", async () => {
    const tx = makeTx();
    tx.job.findUnique.mockResolvedValue({ id: "job1" });
    tx.appliedOp.create.mockRejectedValue(uniqueConstraintError());

    const res = await setJobNotes(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", notes: "x" });

    expect(res).toEqual({ outcome: "duplicate" });
    expect(tx.job.update).not.toHaveBeenCalled();
  });

  it("supersedes an older opId arriving after a newer one already applied", async () => {
    const tx = makeTx();
    tx.job.findUnique.mockResolvedValue({ id: "job1" });
    tx.appliedOp.findFirst.mockResolvedValue({ opId: "ZZZZZZZZZZZZZZZZZZZZZZZZZZ" });

    const res = await setJobNotes(tx as unknown as Prisma.TransactionClient, adminActor, "AAAAAAAAAAAAAAAAAAAAAAAAAA", { jobId: "job1", notes: "stale" });

    expect(res).toEqual({ outcome: "superseded" });
    expect(tx.job.update).not.toHaveBeenCalled();
    expect(tx.appliedOp.update).toHaveBeenCalledWith({
      where: { opId: "AAAAAAAAAAAAAAAAAAAAAAAAAA" },
      data: { outcome: "superseded" },
    });
  });
});

describe("setJobLineItems", () => {
  it("an assigned tech can successfully save materials — the bug this phase fixes", async () => {
    const tx = makeTx();
    tx.jobAssignment.findFirst.mockResolvedValue({ id: "a1" });
    tx.job.findUnique.mockResolvedValue({ id: "job1" });
    tx.appliedOp.findFirst.mockResolvedValue(null);

    const res = await setJobLineItems(tx as unknown as Prisma.TransactionClient, techActor, "op1", {
      jobId: "job1",
      lineItems: [{ inventoryItemId: "item1", quantity: "3", rate: "4.5", description: "widgets" }],
    });

    expect(res).toEqual({ outcome: "applied", resultId: "job1" });
    expect(tx.jobLineItem.deleteMany).toHaveBeenCalledWith({ where: { jobId: "job1" } });
    expect(tx.jobLineItem.createMany).toHaveBeenCalledWith({
      data: [{ jobId: "job1", inventoryItemId: "item1", quantity: 3, rate: 4.5, description: "widgets" }],
    });
  });

  it("rejects a tech not assigned to the job", async () => {
    const tx = makeTx();
    tx.jobAssignment.findFirst.mockResolvedValue(null);
    const res = await setJobLineItems(tx as unknown as Prisma.TransactionClient, techActor, "op1", { jobId: "job1", lineItems: [] });
    expect(res.outcome).toBe("rejected");
    expect(res.status).toBe(403);
  });
});

describe("setJobStatus — stock deduction and idempotency", () => {
  function makeCompletingTx() {
    const tx = makeTx();
    tx.appliedOp.findFirst.mockResolvedValue(null);
    tx.job.findUnique.mockResolvedValue({
      id: "job1",
      status: "In Progress",
      assignedVehicleId: "veh1",
      lineItems: [{ inventoryItemId: "item1", quantity: 5 }],
    });
    tx.job.update.mockResolvedValue({ id: "job1" });
    tx.stockLocation.findUnique.mockResolvedValue({ id: "loc1" });
    return tx;
  }

  it("admin bypasses the assignment check", async () => {
    const tx = makeCompletingTx();
    tx.stockLevel.findUnique.mockResolvedValue({ id: "sl1", quantity: 10 });

    const res = await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", status: "Completed" });

    expect(res.outcome).toBe("applied");
    expect(tx.jobAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("deducts stock when completing a job (decrement when a StockLevel exists)", async () => {
    const tx = makeCompletingTx();
    tx.stockLevel.findUnique.mockResolvedValue({ id: "sl1", quantity: 10 });

    await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", status: "Completed" });

    expect(tx.stockLevel.update).toHaveBeenCalledWith({
      where: { id: "sl1" },
      data: { quantity: { decrement: 5 } },
    });
    expect(tx.stockLevel.create).not.toHaveBeenCalled();
  });

  it("creates a negative StockLevel when completing a job with no existing level", async () => {
    const tx = makeCompletingTx();
    tx.stockLevel.findUnique.mockResolvedValue(null);

    await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", status: "Completed" });

    expect(tx.stockLevel.create).toHaveBeenCalledWith({
      data: { inventoryItemId: "item1", stockLocationId: "loc1", quantity: -5, minThreshold: 0 },
    });
  });

  it("restores stock when reopening a Completed job", async () => {
    const tx = makeTx();
    tx.appliedOp.findFirst.mockResolvedValue(null);
    tx.job.findUnique.mockResolvedValue({
      id: "job1",
      status: "Completed",
      assignedVehicleId: "veh1",
      lineItems: [{ inventoryItemId: "item1", quantity: 5 }],
    });
    tx.job.update.mockResolvedValue({ id: "job1" });
    tx.stockLocation.findUnique.mockResolvedValue({ id: "loc1" });
    tx.stockLevel.findUnique.mockResolvedValue({ id: "sl1", quantity: 0 });

    const res = await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", status: "In Progress" });

    expect(res.outcome).toBe("applied");
    expect(tx.job.update).toHaveBeenCalledWith({ where: { id: "job1" }, data: { status: "In Progress", completionDate: null } });
    expect(tx.stockLevel.update).toHaveBeenCalledWith({
      where: { id: "sl1" },
      data: { quantity: { increment: 5 } },
    });
  });

  it("calling setJobStatus twice with the SAME opId only deducts stock once", async () => {
    const tx = makeCompletingTx();
    tx.stockLevel.findUnique.mockResolvedValue({ id: "sl1", quantity: 10 });

    const first = await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", status: "Completed" });
    expect(first.outcome).toBe("applied");
    expect(tx.stockLevel.update).toHaveBeenCalledTimes(1);

    // Second delivery of the identical op: the AppliedOp primary key rejects it.
    tx.appliedOp.create.mockRejectedValue(uniqueConstraintError());
    const second = await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "job1", status: "Completed" });

    expect(second).toEqual({ outcome: "duplicate" });
    // Still only ever called once across both deliveries.
    expect(tx.stockLevel.update).toHaveBeenCalledTimes(1);
    expect(tx.job.update).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the job does not exist", async () => {
    const tx = makeTx();
    tx.job.findUnique.mockResolvedValue(null);
    const res = await setJobStatus(tx as unknown as Prisma.TransactionClient, adminActor, "op1", { jobId: "ghost", status: "Completed" });
    expect(res).toEqual({ outcome: "rejected", status: 404, error: "Job not found" });
    expect(tx.appliedOp.create).not.toHaveBeenCalled();
  });
});

describe("classifyOpForImport", () => {
  function makeReadClient() {
    return {
      appliedOp: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
    };
  }

  it("classifies a never-seen opId as new", async () => {
    const client = makeReadClient();
    client.appliedOp.findUnique.mockResolvedValue(null);
    client.appliedOp.findFirst.mockResolvedValue(null);

    const result = await classifyOpForImport(client, "notes", "job1", "01NEW");

    expect(result).toBe("new");
    expect(client.appliedOp.findUnique).toHaveBeenCalledWith({ where: { opId: "01NEW" } });
  });

  it("classifies an opId matching an existing AppliedOp as duplicate", async () => {
    const client = makeReadClient();
    client.appliedOp.findUnique.mockResolvedValue({ opId: "01DUP" });

    const result = await classifyOpForImport(client, "status", "job1", "01DUP");

    expect(result).toBe("duplicate");
    // Duplicate short-circuits — no need to run the ordering check at all.
    expect(client.appliedOp.findFirst).not.toHaveBeenCalled();
  });

  it("classifies an older opId for a targetKey with a newer applied op as superseded", async () => {
    const client = makeReadClient();
    client.appliedOp.findUnique.mockResolvedValue(null);
    client.appliedOp.findFirst.mockResolvedValue({ opId: "01ZZZZZZZZZZZZZZZZZZZZZZZZ" });

    const result = await classifyOpForImport(client, "notes", "job1", "01AAAAAAAAAAAAAAAAAAAAAAAA");

    expect(result).toBe("superseded");
  });

  it("classifies a newer opId for a targetKey with an older applied op as new", async () => {
    const client = makeReadClient();
    client.appliedOp.findUnique.mockResolvedValue(null);
    client.appliedOp.findFirst.mockResolvedValue({ opId: "01AAAAAAAAAAAAAAAAAAAAAAAA" });

    const result = await classifyOpForImport(client, "notes", "job1", "01ZZZZZZZZZZZZZZZZZZZZZZZZ");

    expect(result).toBe("new");
  });

  it("classifies a non-duplicate time op as new with no ordering check performed", async () => {
    const client = makeReadClient();
    client.appliedOp.findUnique.mockResolvedValue(null);

    const result = await classifyOpForImport(client, "time", "job1", "01TIME");

    expect(result).toBe("new");
    expect(client.appliedOp.findFirst).not.toHaveBeenCalled();
  });
});
