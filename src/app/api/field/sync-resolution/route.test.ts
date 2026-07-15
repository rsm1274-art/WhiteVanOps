import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma = {
    syncReviewItem: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  // Interactive transaction: hand the callback the same mocked client.
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  return { prisma };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" },
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({ payload: sessionPayload.current })),
  };
});

import { prisma } from "@/lib/db";
import { POST } from "./route";

const validBody = {
  action: "discard",
  op: { url: "/api/time", method: "POST", body: { jobId: "job_abc", duration: "01:30" }, queuedAt: 1752537600000 },
  rejection: { status: 404, message: "Job not found", rejectedAt: 1752624000000 },
};

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/field/sync-resolution", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/field/sync-resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma));
    sessionPayload.current = { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" };
    vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
  });

  it("discard writes an audit row carrying the full op and rejection, then returns 200", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(200);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        action: "DELETE",
        entity: "StuckSyncOp",
        details: expect.stringContaining("job_abc"),
      }),
    });
  });

  it("discard returns 500 when the audit write fails — a discard with no trail must not be acknowledged", async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("db down"));

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(500);
  });

  it("handoff creates the SyncReviewItem and its audit in one transaction, deriving personnelId from the session", async () => {
    vi.mocked(prisma.syncReviewItem.create).mockResolvedValue({ id: "sri_1" } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

    const res = await POST(makeReq({ ...validBody, action: "handoff", op: { ...validBody.op, body: { jobId: "job_abc", personnelId: "someone-else" } } }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("sri_1");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.syncReviewItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        personnelId: "per_1", // session, never the body's claimed value
        userId: "u1",
        url: "/api/time",
        rejectionStatus: 404,
        rejectionMessage: "Job not found",
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CREATE", entity: "SyncReviewItem", entityId: "sri_1" }),
    });
  });

  it("retarget writes an UPDATE audit including the new job id", async () => {
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

    const res = await POST(makeReq({ ...validBody, action: "retarget", newJobId: "job_new" }));

    expect(res.status).toBe(200);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entity: "StuckSyncOp",
        details: expect.stringContaining("job_new"),
      }),
    });
  });

  it("rejects an unknown action with 400 and writes nothing", async () => {
    const res = await POST(makeReq({ ...validBody, action: "explode" }));

    expect(res.status).toBe(400);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.syncReviewItem.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed op with 400", async () => {
    const res = await POST(makeReq({ ...validBody, op: { url: 42 } }));

    expect(res.status).toBe(400);
  });
});
