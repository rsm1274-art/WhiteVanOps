import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

vi.mock("@/lib/db", () => ({
  prisma: {
    license: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("node-machine-id", () => ({
  machineIdSync: vi.fn(() => "test-machine-id"),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({
      payload: { userId: "u1", username: "admin", displayName: "Admin", role: "superuser" },
    })),
  };
});

import { prisma } from "@/lib/db";
import { LICENSE_SIGNING_SECRET } from "@/lib/license";
import { POST } from "./route";

function signUnlock(machineId: string, tier: "base" | "plus", expiresAt: string | null): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${machineId}:${tier}:${expiresAt || ""}`)
    .digest("hex");
}

describe("POST /api/license — unlock-trial action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });

  it("accepts a validly signed base-tier unlock key and downgrades to base", async () => {
    const sig = signUnlock("test-machine-id", "base", null);
    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: "singleton",
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const req = new Request("http://localhost/api/license", {
      method: "POST",
      body: JSON.stringify({
        action: "unlock-trial",
        licenseKey: JSON.stringify({ machineId: "test-machine-id", tier: "base", expiresAt: null, notes: "Base purchase", sig }),
      }),
    });

    const res = await POST(req as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tier).toBe("base");
    expect(prisma.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ tier: "base" }) })
    );
  });

  it("rejects a key signed for a different machine", async () => {
    const sig = signUnlock("someone-elses-machine", "plus", null);
    const req = new Request("http://localhost/api/license", {
      method: "POST",
      body: JSON.stringify({
        action: "unlock-trial",
        licenseKey: JSON.stringify({ machineId: "someone-elses-machine", tier: "plus", expiresAt: null, notes: null, sig }),
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(prisma.license.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON in licenseKey", async () => {
    const req = new Request("http://localhost/api/license", {
      method: "POST",
      body: JSON.stringify({ action: "unlock-trial", licenseKey: "not json" }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});
