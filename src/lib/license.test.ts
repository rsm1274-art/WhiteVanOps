import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

// license.ts imports db.ts, which opens a real pg.Pool at import time — mock it.
vi.mock("@/lib/db", () => ({
  prisma: {
    license: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("node-machine-id", () => ({
  machineIdSync: vi.fn(() => "test-machine-id"),
}));

import { prisma } from "@/lib/db";
import {
  isLicenseExpired,
  isPlusActive,
  getLicense,
  hasPlusLicense,
  requirePlus,
  LICENSE_ROW_ID,
  LICENSE_SIGNING_SECRET,
  verifyPlusLicense,
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

describe("verifyPlusLicense", () => {
  const baseKey = "WVO-KEY-1234";

  it("returns true for a valid signed plus license", () => {
    const expiresAt = "2027-12-31T23:59:59.999Z";
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${baseKey}:plus:${expiresAt}`)
      .digest("hex");

    const plusData = {
      licenseKey: baseKey,
      tier: "plus",
      expiresAt,
      notes: "Test Notes",
      sig,
    };

    expect(verifyPlusLicense(plusData, baseKey)).toBe(true);
  });

  it("returns false if signature is invalid", () => {
    const plusData = {
      licenseKey: baseKey,
      tier: "plus",
      expiresAt: null,
      notes: "Test Notes",
      sig: "invalid_sig",
    };

    expect(verifyPlusLicense(plusData, baseKey)).toBe(false);
  });

  it("returns false if licenseKey does not match baseKey", () => {
    const plusData = {
      licenseKey: "DIFFERENT-KEY",
      tier: "plus",
      expiresAt: null,
      notes: "Test Notes",
      sig: "some_sig",
    };

    expect(verifyPlusLicense(plusData, baseKey)).toBe(false);
  });
});

describe("getLicense / hasPlusLicense in test mode bypass", () => {
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

  it("hasPlusLicense is true for an unexpired plus row when bypassing files in test environment", async () => {
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
});

describe("getLicense with cryptographic validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("auto-upgrades database to plus when valid plus_license.json is found", async () => {
    const baseKey = "WVO-KEY-123";
    const sigBase = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${baseKey}:test-machine-id`)
      .digest("hex");

    const sigPlus = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${baseKey}:plus:`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const pathStr = p.toString();
      if (pathStr.endsWith("plus_license.json")) return true;
      if (pathStr.endsWith("license.json")) return true;
      return false;
    });

    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      const pathStr = p.toString();
      if (pathStr.endsWith("plus_license.json")) {
        return JSON.stringify({ licenseKey: baseKey, tier: "plus", expiresAt: null, notes: "Test notes", sig: sigPlus });
      }
      if (pathStr.endsWith("license.json")) {
        return JSON.stringify({ key: baseKey, machineId: "test-machine-id", sig: sigBase });
      }
      throw new Error("File not found");
    });

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

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: baseKey,
      notes: "Test notes",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("plus");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "plus", licenseKey: baseKey }),
      })
    );
  });

  it("self-heals / auto-downgrades database to base when DB tier is plus but no valid Plus license file exists", async () => {
    const baseKey = "WVO-KEY-123";
    const sigBase = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${baseKey}:test-machine-id`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => {
      const pathStr = p.toString();
      if (pathStr.endsWith("license.json")) return true;
      return false;
    });

    vi.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      const pathStr = p.toString();
      if (pathStr.endsWith("license.json")) {
        return JSON.stringify({ key: baseKey, machineId: "test-machine-id", sig: sigBase });
      }
      throw new Error("File not found");
    });

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "WVO-KEY-123",
      notes: "Tampered Notes",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: "WVO-KEY-123",
      notes: "Tampered Notes",
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("base");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "base", activatedAt: null }),
      })
    );
  });

  it("bypasses files and activates plus when WVO_DEFAULT_TIER environment variable is plus", async () => {
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

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

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("plus");
    expect(license.notes).toBe("Activated via Plus Installer Build");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "plus", licenseKey: "PRE-ACTIVATED-PLUS-BUILD" }),
      })
    );
    vi.unstubAllEnvs();
  });

  it("a valid trial-unlock.json for tier 'plus' wins over the trial's pre-activated-Plus default", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

    const expiresAt = "2027-06-01T00:00:00.000Z";
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`test-machine-id:plus:${expiresAt}`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "test-machine-id", tier: "plus", expiresAt, notes: "Converted to Plus", sig })
    );

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

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: null,
      notes: "Converted to Plus",
      activatedAt: new Date(),
      expiresAt: new Date(expiresAt),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("plus");
    expect(license.notes).toBe("Converted to Plus");
    expect(license.expiresAt?.toISOString()).toBe(expiresAt);
  });

  it("a valid trial-unlock.json for tier 'base' overrides the trial's pre-activated-Plus default and self-heals a tampered plus DB row", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update("test-machine-id:base:")
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "test-machine-id", tier: "base", expiresAt: null, notes: "Converted to Base", sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("base");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "base", activatedAt: null }),
      })
    );
  });

  it("with no trial-unlock.json, an unconverted trial build still forces plus", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

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

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("plus");
    expect(license.notes).toBe("Activated via Plus Installer Build");
  });

  it("ignores a trial-unlock.json signed for a different machine and self-heals a tampered plus DB row to base", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    // WVO_DEFAULT_TIER intentionally left unset ("base") to isolate the
    // trial-unlock-ignored path from the separate unconverted-trial force.

    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update("some-other-machine:base:")
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "some-other-machine", tier: "base", expiresAt: null, notes: null, sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "WVO-KEY-123",
      notes: "Tampered Notes",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: "WVO-KEY-123",
      notes: "Tampered Notes",
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("base");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "base", activatedAt: null }),
      })
    );
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
