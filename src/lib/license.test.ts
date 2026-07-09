import { describe, it, expect, vi, beforeEach } from "vitest";

// license.ts imports db.ts, which opens a real pg.Pool at import time — mock it.
vi.mock("@/lib/db", () => ({
  prisma: {
    license: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  isLicenseExpired,
  isPlusActive,
  getLicense,
  hasPlusLicense,
  requirePlus,
  LICENSE_ROW_ID,
} from "./license";

const NOW = new Date("2026-07-09T12:00:00Z");

describe("isLicenseExpired", () => {
  it("never expires with a null expiresAt", () => {
    expect(isLicenseExpired(null, NOW)).toBe(false);
  });

  it("is not expired when expiresAt is in the future", () => {
    expect(isLicenseExpired(new Date("2027-01-01"), NOW)).toBe(false);
  });

  it("is expired when expiresAt is in the past", () => {
    expect(isLicenseExpired(new Date("2026-01-01"), NOW)).toBe(true);
  });

  it("accepts ISO string dates", () => {
    expect(isLicenseExpired("2026-01-01T00:00:00Z", NOW)).toBe(true);
    expect(isLicenseExpired("2027-01-01T00:00:00Z", NOW)).toBe(false);
  });
});

describe("isPlusActive", () => {
  it("is active for an unexpired plus tier", () => {
    expect(isPlusActive({ tier: "plus", expiresAt: null }, NOW)).toBe(true);
    expect(isPlusActive({ tier: "plus", expiresAt: new Date("2027-01-01") }, NOW)).toBe(true);
  });

  it("is inactive for base tier even with no expiry", () => {
    expect(isPlusActive({ tier: "base", expiresAt: null }, NOW)).toBe(false);
  });

  it("is inactive for an expired plus tier", () => {
    expect(isPlusActive({ tier: "plus", expiresAt: new Date("2026-01-01") }, NOW)).toBe(false);
  });
});

describe("getLicense / hasPlusLicense", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("upserts the singleton row on read (self-healing)", async () => {
    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("base");
    expect(prisma.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LICENSE_ROW_ID } })
    );
  });

  it("hasPlusLicense is true for an unexpired plus row", async () => {
    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "abc",
      notes: null,
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await hasPlusLicense()).toBe(true);
  });

  it("hasPlusLicense is false once the plus row has expired", async () => {
    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "abc",
      notes: null,
      activatedAt: new Date("2025-01-01"),
      expiresAt: new Date("2025-12-31"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await hasPlusLicense()).toBe(false);
  });
});

describe("requirePlus", () => {
  it("returns null when licensed", () => {
    expect(requirePlus(true)).toBeNull();
  });

  it("returns a 403 response when not licensed", () => {
    const res = requirePlus(false);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
