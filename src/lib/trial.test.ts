import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

// trial.ts imports license.ts, which imports db.ts (opens a real pg.Pool at
// import time and throws without DATABASE_URL) — mock it, same as license.test.ts.
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

import {
  getTrialStatus,
  verifyTrialUnlock,
  signTrialUnlock,
  markTrialUnlocked,
} from "./trial";
import { LICENSE_SIGNING_SECRET } from "./license";

const NOW = new Date("2026-07-13T12:00:00Z");

describe("getTrialStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
    vi.unstubAllEnvs();
  });

  it("is a no-op for non-trial builds", () => {
    vi.stubEnv("WVO_IS_TRIAL", "");
    vi.spyOn(fs, "existsSync").mockReturnValue(true); // would blow up if read
    const status = getTrialStatus(NOW);
    expect(status).toEqual({ isTrial: false, daysRemaining: 0, isLocked: false, machineId: null });
  });

  it("creates a signed anchor file on first read", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);

    const status = getTrialStatus(NOW);

    expect(writeSpy).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeSpy.mock.calls[0];
    expect(String(writtenPath)).toMatch(/trial\.json$/);
    const anchor = JSON.parse(writtenContent as string);
    expect(anchor.installedAt).toBe(NOW.toISOString());
    expect(anchor.machineId).toBe("test-machine-id");
    expect(status.isTrial).toBe(true);
    expect(status.isLocked).toBe(false);
    expect(status.daysRemaining).toBe(30);
  });

  it("is not locked within the 30-day window", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    const installedAt = new Date("2026-07-01T12:00:00Z").toISOString();
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${installedAt}:test-machine-id`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("trial.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ installedAt, machineId: "test-machine-id", sig })
    );

    const status = getTrialStatus(NOW); // 12 days after install
    expect(status.isLocked).toBe(false);
    expect(status.daysRemaining).toBe(18);
  });

  it("is locked once 30 days have elapsed with no unlock file", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    const installedAt = new Date("2026-05-01T12:00:00Z").toISOString();
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${installedAt}:test-machine-id`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("trial.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ installedAt, machineId: "test-machine-id", sig })
    );

    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(true);
    expect(status.daysRemaining).toBe(0);
  });

  it("is never locked once a valid trial-unlock.json exists, regardless of elapsed time", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("trial-unlock.json"));

    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(false);
  });

  it("fails closed (locked) if the anchor file signature has been tampered with", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    const installedAt = new Date("2026-07-01T12:00:00Z").toISOString();

    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => String(p).endsWith("trial.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ installedAt, machineId: "test-machine-id", sig: "tampered" })
    );

    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(true);
  });
});

describe("verifyTrialUnlock / signTrialUnlock", () => {
  it("verifies a correctly signed payload", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(true);
  });

  it("rejects a payload signed for a different machine", () => {
    const sig = signTrialUnlock("other-machine", "plus", null);
    const payload = { machineId: "other-machine", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig: "bogus" };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects an invalid tier", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "enterprise", expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });
});

describe("markTrialUnlocked", () => {
  it("writes trial-unlock.json with the given payload", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    const payload = { machineId: "test-machine-id", tier: "base" as const, expiresAt: null, notes: "test", sig: "x" };

    markTrialUnlocked(payload);

    expect(writeSpy).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeSpy.mock.calls[0];
    expect(String(writtenPath)).toMatch(/trial-unlock\.json$/);
    expect(JSON.parse(writtenContent as string)).toEqual(payload);
  });
});
