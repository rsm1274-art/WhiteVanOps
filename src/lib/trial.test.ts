import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

// trial.ts is file-based, but license.ts (imported below for the secret)
// imports db.ts, which opens a real pg.Pool at import time — mock it.
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

import { getTrialStatus, markTrialUnlocked } from "./trial";
import { LICENSE_SIGNING_SECRET } from "./license";

const NOW = new Date("2026-07-13T12:00:00Z");
const hmac = (s: string) => crypto.createHmac("sha256", LICENSE_SIGNING_SECRET).update(s).digest("hex");

/** Fakes the app-data directory: each key is a file name, its value the contents. */
function fakeFiles(files: Record<string, string>) {
  const find = (p: fs.PathLike | number) => Object.keys(files).find((name) => String(p).endsWith(`/${name}`) || String(p).endsWith(`\\${name}`));
  vi.spyOn(fs, "existsSync").mockImplementation((p) => find(p as fs.PathLike) !== undefined);
  vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathLike) => {
    const name = find(p);
    if (!name) throw new Error(`ENOENT ${String(p)}`);
    return files[name];
  }) as typeof fs.readFileSync);
}

const anchor = (installedAt: string, machineId = "test-machine-id") =>
  JSON.stringify({ installedAt, machineId, sig: hmac(`${installedAt}:${machineId}`) });

describe("getTrialStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not a trial when no trial was ever started (office PM2 server, dev)", () => {
    fakeFiles({});
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    expect(getTrialStatus(NOW)).toEqual({ isTrial: false, daysRemaining: 0, isLocked: false, machineId: "test-machine-id" });
    expect(writeSpy).not.toHaveBeenCalled(); // never starts a trial on its own
  });

  it("is not locked within the 30-day window", () => {
    fakeFiles({ "trial.json": anchor("2026-07-01T12:00:00.000Z") });
    const status = getTrialStatus(NOW); // 12 days in
    expect(status.isTrial).toBe(true);
    expect(status.isLocked).toBe(false);
    expect(status.daysRemaining).toBe(18);
  });

  it("is locked once 30 days have elapsed", () => {
    fakeFiles({ "trial.json": anchor("2026-05-01T12:00:00.000Z") });
    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(true);
    expect(status.daysRemaining).toBe(0);
  });

  it("an activation key (license.json) ends the trial, however old it is", () => {
    const key = "WVO-TEST-1";
    fakeFiles({
      "trial.json": anchor("2026-01-01T12:00:00.000Z"),
      "license.json": JSON.stringify({ key, machineId: "test-machine-id", sig: hmac(`${key}:test-machine-id`) }),
    });
    expect(getTrialStatus(NOW)).toMatchObject({ isTrial: false, isLocked: false });
  });

  it("the offline unlock (trial-unlock.json) also ends the trial", () => {
    fakeFiles({
      "trial.json": anchor("2026-01-01T12:00:00.000Z"),
      "trial-unlock.json": JSON.stringify({ machineId: "test-machine-id", expiresAt: null, notes: null, sig: hmac("test-machine-id:") }),
    });
    expect(getTrialStatus(NOW)).toMatchObject({ isTrial: false, isLocked: false });
  });

  it("ignores a license.json signed for another machine", () => {
    const key = "WVO-TEST-1";
    fakeFiles({
      "trial.json": anchor("2026-05-01T12:00:00.000Z"),
      "license.json": JSON.stringify({ key, machineId: "other", sig: hmac(`${key}:other`) }),
    });
    expect(getTrialStatus(NOW).isLocked).toBe(true);
  });

  it("fails closed (locked) if the anchor file is corrupt", () => {
    fakeFiles({ "trial.json": "{ this is not json" });
    expect(() => getTrialStatus(NOW)).not.toThrow();
    expect(getTrialStatus(NOW).isLocked).toBe(true);
  });

  it("fails closed if the anchor was tampered with (date moved forward)", () => {
    const real = JSON.parse(anchor("2026-05-01T12:00:00.000Z"));
    fakeFiles({ "trial.json": JSON.stringify({ ...real, installedAt: "2026-07-10T12:00:00.000Z" }) });
    expect(getTrialStatus(NOW).isLocked).toBe(true);
  });

  it("fails closed if the anchor was copied from another machine", () => {
    fakeFiles({ "trial.json": anchor("2026-07-10T12:00:00.000Z", "other-machine") });
    expect(getTrialStatus(NOW).isLocked).toBe(true);
  });
});

describe("markTrialUnlocked", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes trial-unlock.json with the given payload", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    const payload = { machineId: "test-machine-id", expiresAt: null, notes: "test", sig: "x" };

    markTrialUnlocked(payload);

    expect(writeSpy).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeSpy.mock.calls[0];
    expect(String(writtenPath)).toMatch(/trial-unlock\.json$/);
    expect(JSON.parse(writtenContent as string)).toEqual(payload);
  });
});
