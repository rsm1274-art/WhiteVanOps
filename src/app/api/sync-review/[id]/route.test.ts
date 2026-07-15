import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    syncReviewItem: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: { userId: "u1", username: "admin", displayName: "Admin", role: "admin" } as Record<string, unknown>,
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({ payload: sessionPayload.current })),
  };
});

import { prisma } from "@/lib/db";
import { PATCH } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/sync-review/sri_1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "sri_1" });

describe("PATCH /api/sync-review/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionPayload.current = { userId: "u1", username: "admin", displayName: "Admin", role: "admin" };
    vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
  });

  it("marks the item Resolved with resolver and timestamp, and audits", async () => {
    vi.mocked(prisma.syncReviewItem.update).mockResolvedValue({ id: "sri_1" } as any);

    const res = await PATCH(makeReq({ action: "resolve" }), { params });

    expect(res.status).toBe(200);
    expect(prisma.syncReviewItem.update).toHaveBeenCalledWith({
      where: { id: "sri_1" },
      data: expect.objectContaining({ status: "Resolved", resolvedById: "u1", resolvedAt: expect.any(Date) }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "UPDATE", entity: "SyncReviewItem", entityId: "sri_1" }),
    });
  });

  it("marks the item Dismissed and audits — dismiss must leave a trail", async () => {
    vi.mocked(prisma.syncReviewItem.update).mockResolvedValue({ id: "sri_1" } as any);

    const res = await PATCH(makeReq({ action: "dismiss" }), { params });

    expect(res.status).toBe(200);
    expect(prisma.syncReviewItem.update).toHaveBeenCalledWith({
      where: { id: "sri_1" },
      data: expect.objectContaining({ status: "Dismissed" }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("forbids techs — this route is deliberately outside TECH_ALLOWED_PREFIXES too", async () => {
    sessionPayload.current = { userId: "u2", username: "tech1", displayName: "Tech", role: "tech", personnelId: "per_1" };

    const res = await PATCH(makeReq({ action: "resolve" }), { params });

    expect(res.status).toBe(403);
    expect(prisma.syncReviewItem.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown action with 400", async () => {
    const res = await PATCH(makeReq({ action: "explode" }), { params });

    expect(res.status).toBe(400);
    expect(prisma.syncReviewItem.update).not.toHaveBeenCalled();
  });
});
