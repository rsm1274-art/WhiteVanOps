import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma = {
    $transaction: vi.fn(),
  };
  return { prisma };
});

vi.mock("@/lib/fieldOps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fieldOps")>();
  return {
    ...actual,
    logTime: vi.fn(),
    setJobNotes: vi.fn(),
    setJobLineItems: vi.fn(),
    setJobStatus: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

const sessionPayload = vi.hoisted(() => ({
  current: { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" } as Record<string, unknown> | null,
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
import { logTime, setJobNotes, setJobLineItems, setJobStatus } from "@/lib/fieldOps";
import { POST } from "./route";

function makeReq(body: unknown, opId: string | null = "op_1"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opId) headers["X-WVO-Op-Id"] = opId;
  return new Request("http://localhost/api/field/ops", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn({}));
  sessionPayload.current = { userId: "u1", username: "tech1", displayName: "Tech One", role: "tech", personnelId: "per_1" };
  vi.stubEnv("SESSION_SECRET", "test-secret-32-bytes-xxxxxxxxxxxx");
});

describe("POST /api/field/ops", () => {
  it("returns 401 with no session", async () => {
    sessionPayload.current = null;
    const res = await POST(makeReq({ jobId: "job1", status: "Completed" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the X-WVO-Op-Id header is missing", async () => {
    const res = await POST(makeReq({ jobId: "job1", status: "Completed" }, null));
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("dispatches a duration body to logTime and returns 200 on applied", async () => {
    vi.mocked(logTime).mockResolvedValue({ outcome: "applied", resultId: "te1" });

    const res = await POST(makeReq({ jobId: "job1", personnelId: "per_1", date: "2026-09-01", duration: "01:00" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ outcome: "applied", resultId: "te1" });
    expect(logTime).toHaveBeenCalledWith({}, { userId: "u1", personnelId: "per_1", role: "tech" }, "op_1", expect.objectContaining({ duration: "01:00" }));
    expect(setJobNotes).not.toHaveBeenCalled();
  });

  it("dispatches a notes body to setJobNotes", async () => {
    vi.mocked(setJobNotes).mockResolvedValue({ outcome: "applied", resultId: "job1" });

    const res = await POST(makeReq({ jobId: "job1", notes: "hello" }));

    expect(res.status).toBe(200);
    expect(setJobNotes).toHaveBeenCalledWith({}, expect.any(Object), "op_1", { jobId: "job1", notes: "hello" });
  });

  it("dispatches a lineItems body to setJobLineItems", async () => {
    vi.mocked(setJobLineItems).mockResolvedValue({ outcome: "applied", resultId: "job1" });

    const res = await POST(makeReq({ jobId: "job1", lineItems: [] }));

    expect(res.status).toBe(200);
    expect(setJobLineItems).toHaveBeenCalledWith({}, expect.any(Object), "op_1", { jobId: "job1", lineItems: [] });
  });

  it("dispatches a status body to setJobStatus", async () => {
    vi.mocked(setJobStatus).mockResolvedValue({ outcome: "applied", resultId: "job1" });

    const res = await POST(makeReq({ jobId: "job1", status: "In Progress" }));

    expect(res.status).toBe(200);
    expect(setJobStatus).toHaveBeenCalledWith({}, expect.any(Object), "op_1", { jobId: "job1", status: "In Progress" });
  });

  it("returns 400 for an unrecognized body shape", async () => {
    const res = await POST(makeReq({ jobId: "job1" }));
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("maps a rejected outcome to its status/error", async () => {
    vi.mocked(setJobNotes).mockResolvedValue({ outcome: "rejected", status: 403, error: "You are not assigned to this job" });

    const res = await POST(makeReq({ jobId: "job1", notes: "hi" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe("You are not assigned to this job");
  });

  it("returns 200 for a duplicate outcome", async () => {
    vi.mocked(setJobStatus).mockResolvedValue({ outcome: "duplicate" });

    const res = await POST(makeReq({ jobId: "job1", status: "Completed" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.outcome).toBe("duplicate");
  });

  it("returns 200 for a superseded outcome", async () => {
    vi.mocked(setJobStatus).mockResolvedValue({ outcome: "superseded" });

    const res = await POST(makeReq({ jobId: "job1", status: "Completed" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.outcome).toBe("superseded");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/field/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WVO-Op-Id": "op_1" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
