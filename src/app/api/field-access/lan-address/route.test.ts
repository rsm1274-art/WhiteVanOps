import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "os";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(),
  requireRole: vi.fn(),
}));

import { GET } from "./route";
import { getSessionUser, requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

describe("GET /api/field-access/lan-address", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("403s a tech", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", role: "tech" } as never);
    vi.mocked(requireRole).mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns private IPv4 addresses and omits loopback and IPv6", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", role: "admin" } as never);
    vi.mocked(requireRole).mockReturnValue(null);
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never],
      Ethernet: [
        { address: "192.168.1.20", family: "IPv4", internal: false } as never,
        { address: "fe80::1", family: "IPv6", internal: false } as never,
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ addresses: ["192.168.1.20"] });
  });

  it("prefers a private LAN address over a public one", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", role: "admin" } as never);
    vi.mocked(requireRole).mockReturnValue(null);
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      WAN: [{ address: "203.0.113.5", family: "IPv4", internal: false } as never],
      LAN: [{ address: "10.0.0.8", family: "IPv4", internal: false } as never],
    });

    const res = await GET();
    await expect(res.json()).resolves.toEqual({ addresses: ["10.0.0.8", "203.0.113.5"] });
  });
});
