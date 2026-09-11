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
import { isLicenseExpired, getLicense, getBaseLicense, LICENSE_ROW_ID, LICENSE_SIGNING_SECRET } from "./license";

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

describe("getBaseLicense — machine-binding and anti-tamper", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });

  it("returns a verified license for a correctly signed current-format file", () => {
    const key = "WVO-KEY-123";
    const sig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`${key}:test-machine-id`).digest("hex");

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key, machineId: "test-machine-id", sig }));

    const license = getBaseLicense();
    expect(license).toEqual({ key, machineId: "test-machine-id", sig });
  });

  // Pre-v2.0 installs signed key:machineId only, with no tier component ever
  // existing in the payload for the truly legacy format. That's now identical
  // to the current signature — this asserts it still verifies.
  it("accepts a legacy license.json signed the same way as the current format", () => {
    const key = "WVO-LEGACY-KEY";
    const legacySig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`${key}:test-machine-id`).digest("hex");

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key, machineId: "test-machine-id", sig: legacySig }));

    const license = getBaseLicense();
    expect(license).not.toBeNull();
    expect(license!.key).toBe(key);
  });

  it("rejects a license.json bound to a different machine", () => {
    const key = "WVO-KEY-123";
    const sig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`${key}:other-machine`).digest("hex");

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key, machineId: "other-machine", sig }));

    expect(getBaseLicense()).toBeNull();
  });

  it("rejects a license.json with a tampered signature", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ key: "WVO-KEY-123", machineId: "test-machine-id", sig: "bogus" })
    );

    expect(getBaseLicense()).toBeNull();
  });

  it("rejects a license.json with a hand-edited key but stale signature", () => {
    const originalKey = "WVO-ORIGINAL";
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${originalKey}:test-machine-id`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    // Key changed to a different value after the signature was minted.
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ key: "WVO-EDITED", machineId: "test-machine-id", sig })
    );

    expect(getBaseLicense()).toBeNull();
  });

  it("returns null when no license.json exists", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(getBaseLicense()).toBeNull();
  });
});

describe("getLicense", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("upserts the singleton row on read (self-healing)", async () => {
    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.licenseKey).toBeNull();
    expect(prisma.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LICENSE_ROW_ID } })
    );
  });

  it("reconciles the DB row's licenseKey/activatedAt from a verified license.json", async () => {
    const key = "WVO-KEY-123";
    const sig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`${key}:test-machine-id`).digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("license.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key, machineId: "test-machine-id", sig }));

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: key,
      notes: "Activated",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.licenseKey).toBe(key);
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ licenseKey: key }),
      })
    );
  });

  it("does not write to the DB when the reconciled state already matches it", async () => {
    const key = "WVO-KEY-123";
    const sig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`${key}:test-machine-id`).digest("hex");
    const activatedAt = new Date("2026-01-01T00:00:00Z");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("license.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key, machineId: "test-machine-id", sig }));

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: key,
      notes: "Activated",
      activatedAt,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.licenseKey).toBe(key);
    expect(prisma.license.update).not.toHaveBeenCalled();
  });

  it("accepts a legacy untiered license.json", async () => {
    const key = "WVO-LEGACY-KEY";
    const legacySig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`${key}:test-machine-id`).digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("license.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ key, machineId: "test-machine-id", sig: legacySig }));

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: key,
      notes: "Activated",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.licenseKey).toBe(key);
  });

  it("a valid trial-unlock.json reconciles the DB with its key/expiry/notes", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");

    const expiresAt = "2027-06-01T00:00:00.000Z";
    const sig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(`test-machine-id:${expiresAt}`).digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "test-machine-id", expiresAt, notes: "Converted", sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: null,
      notes: "Converted",
      activatedAt: new Date(),
      expiresAt: new Date(expiresAt),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.notes).toBe("Converted");
    expect(license.expiresAt?.toISOString()).toBe(expiresAt);
  });

  // A forged unlock (signed for someone else's machine) must not affect the
  // DB — it falls back to whatever the trial's own state already resolves to.
  it("ignores a trial-unlock.json signed for a different machine", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");

    const sig = crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update("some-other-machine:").digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "some-other-machine", expiresAt: null, notes: null, sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: "TRIAL-ACTIVE",
      notes: "30-Day Evaluation Period",
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      licenseKey: "TRIAL-ACTIVE",
      notes: "30-Day Evaluation Period",
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.licenseKey).toBe("TRIAL-ACTIVE");
    expect(license.notes).toBe("30-Day Evaluation Period");
  });
});
