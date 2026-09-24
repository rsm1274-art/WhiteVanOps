import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    personnel: { findMany: vi.fn() },
    job: { findMany: vi.fn() },
    inventoryItem: { findMany: vi.fn() },
  },
}));

// The trial guard reads app-data files and the machine id; its own rules are
// covered in trial.test.ts. Here: off by default, on for one test.
const trialLocked = vi.hoisted(() => ({ current: false }));
vi.mock("@/lib/trialGuard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    trialExpiredResponse: () =>
      trialLocked.current ? NextResponse.json({ code: "trial_expired" }, { status: 403 }) : null,
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
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

import { prisma } from "@/lib/db";
import { GET } from "./route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

const TECH = { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" };
const ADMIN = { userId: "u2", username: "boss", displayName: "Office", role: "admin" };

const req = (qs = "") => new Request(`http://localhost/api/field${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.personnel.findMany.mockResolvedValue([]);
  mockPrisma.job.findMany.mockResolvedValue([]);
  mockPrisma.inventoryItem.findMany.mockResolvedValue([]);
  sessionPayload.current = TECH;
  trialLocked.current = false;
  vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
});

describe("GET /api/field", () => {
  it("returns 401 with no session", async () => {
    sessionPayload.current = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("forces a tech's job query to their own personnelId, ignoring the query parameter", async () => {
    await GET(req("?personnelId=someone_else"));
    const where = mockPrisma.job.findMany.mock.calls[0][0].where;
    expect(where.assignments).toEqual({ some: { personnelId: "per_1" } });
  });

  it("returns only the tech's own record for the picker", async () => {
    await GET(req());
    expect(mockPrisma.personnel.findMany.mock.calls[0][0].where).toEqual({ id: "per_1" });
  });

  it("rejects a tech account with no linked personnel record", async () => {
    sessionPayload.current = { ...TECH, personnelId: undefined };
    const res = await GET(req("?personnelId=per_1"));
    expect(res.status).toBe(403);
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });

  it("refuses to load data once the trial has ended", async () => {
    trialLocked.current = true;
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("trial_expired");
    expect(mockPrisma.personnel.findMany).not.toHaveBeenCalled();
  });

  it("lets an admin view any technician", async () => {
    sessionPayload.current = ADMIN;
    await GET(req("?personnelId=per_9"));
    const where = mockPrisma.job.findMany.mock.calls[0][0].where;
    expect(where.assignments).toEqual({ some: { personnelId: "per_9" } });

    await GET(req());
    expect(mockPrisma.personnel.findMany.mock.calls[0][0].where).toEqual({ role: "Technician" });
  });
});
