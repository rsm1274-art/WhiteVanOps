import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import * as trial from "./trial.js";
import { LICENSE_SIGNING_SECRET, signTrialAnchor as serverSignAnchor, signTrialUnlock as serverSignUnlock } from "../src/lib/licenseCrypto";

const SECRET = LICENSE_SIGNING_SECRET;
const MACHINE = "machine-1";
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wvo-trial-"));

describe("signature parity with src/lib/licenseCrypto.ts", () => {
  // main.js writes trial.json and the server verifies it — if these drift,
  // every trial reads as tampered and locks on day one.
  it("anchor signature is byte-identical", () => {
    expect(trial.signTrialAnchor(SECRET, "2026-09-24T10:00:00.000Z", MACHINE))
      .toBe(serverSignAnchor("2026-09-24T10:00:00.000Z", MACHINE));
  });

  it("offline-unlock signature is verified the same way", () => {
    const dir = tmpDir();
    const sig = serverSignUnlock(MACHINE, null);
    fs.writeFileSync(path.join(dir, "trial-unlock.json"), JSON.stringify({ machineId: MACHINE, expiresAt: null, notes: null, sig }));
    expect(trial.hasValidTrialUnlock(SECRET, dir, MACHINE)).toBe(true);
    expect(trial.hasValidTrialUnlock(SECRET, dir, "other-machine")).toBe(false);
  });
});

describe("anchor file", () => {
  it("round-trips, and rejects tampering or another machine", () => {
    const dir = tmpDir();
    trial.writeAnchorFile(SECRET, dir, "2026-09-01T00:00:00.000Z", MACHINE);
    expect(trial.readAnchorFile(SECRET, dir, MACHINE).installedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(trial.readAnchorFile(SECRET, dir, "other-machine")).toBeNull();

    const file = path.join(dir, "trial.json");
    const edited = { ...JSON.parse(fs.readFileSync(file, "utf8")), installedAt: "2026-09-20T00:00:00.000Z" };
    fs.writeFileSync(file, JSON.stringify(edited));
    expect(trial.readAnchorFile(SECRET, dir, MACHINE)).toBeNull();
    expect(trial.trialFileExists(dir)).toBe(true); // main.js treats this as an expired trial
  });
});

describe("trialState", () => {
  const start = "2026-09-01T00:00:00.000Z";
  it("counts down, then expires at exactly 30 days", () => {
    expect(trial.trialState(start, new Date("2026-09-01T00:00:00.000Z"))).toEqual({ expired: false, daysRemaining: 30 });
    expect(trial.trialState(start, new Date("2026-09-30T12:00:00.000Z"))).toEqual({ expired: false, daysRemaining: 1 });
    expect(trial.trialState(start, new Date("2026-10-01T00:00:00.000Z"))).toEqual({ expired: true, daysRemaining: 0 });
  });
});

describe("pickEarliest", () => {
  const a = { installedAt: "2026-08-01T00:00:00.000Z" };
  const b = { installedAt: "2026-09-01T00:00:00.000Z" };
  it("keeps the earliest start, whichever side it is on", () => {
    expect(trial.pickEarliest(a, b)).toBe(a);
    expect(trial.pickEarliest(b, a)).toBe(a);
    expect(trial.pickEarliest(null, b)).toBe(b);
    expect(trial.pickEarliest(a, null)).toBe(a);
    expect(trial.pickEarliest(null, null)).toBeNull();
  });
});

/** A pg client holding one SystemSetting row in memory. */
function fakeDb(initialValue) {
  const state = { value: initialValue, writes: 0 };
  return {
    state,
    async query(text, params) {
      if (text.startsWith("SELECT value")) return { rows: state.value === undefined ? [] : [{ value: state.value }] };
      if (text.startsWith('INSERT INTO "SystemSetting"')) {
        state.value = params[2];
        state.writes++;
        return { rows: [] };
      }
      throw new Error(`unexpected query ${text}`);
    },
  };
}

describe("reconcileWithDb", () => {
  const args = (client, dir) => ({ client, secret: SECRET, dir, machineId: MACHINE });

  it("copies a new trial's start date into the database", async () => {
    const dir = tmpDir();
    trial.writeAnchorFile(SECRET, dir, "2026-09-20T00:00:00.000Z", MACHINE);
    const db = fakeDb(undefined);
    const eff = await trial.reconcileWithDb(args(db, dir));
    expect(eff.installedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(JSON.parse(db.state.value).installedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("restores a deleted trial.json from the database — deleting the file doesn't reset the clock", async () => {
    const dir = tmpDir();
    const old = { installedAt: "2026-07-01T00:00:00.000Z", machineId: MACHINE, sig: trial.signTrialAnchor(SECRET, "2026-07-01T00:00:00.000Z", MACHINE) };
    const db = fakeDb(JSON.stringify(old));
    // "New" trial started after deleting trial.json:
    trial.writeAnchorFile(SECRET, dir, "2026-09-20T00:00:00.000Z", MACHINE);
    const eff = await trial.reconcileWithDb(args(db, dir));
    expect(eff.installedAt).toBe(old.installedAt);
    expect(trial.readAnchorFile(SECRET, dir, MACHINE).installedAt).toBe(old.installedAt);
    expect(db.state.writes).toBe(0);
  });

  it("ignores a forged database value", async () => {
    const dir = tmpDir();
    trial.writeAnchorFile(SECRET, dir, "2026-09-20T00:00:00.000Z", MACHINE);
    const db = fakeDb(JSON.stringify({ installedAt: "2030-01-01T00:00:00.000Z", machineId: MACHINE, sig: "forged" }));
    const eff = await trial.reconcileWithDb(args(db, dir));
    expect(eff.installedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(JSON.parse(db.state.value).installedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("returns null when this install never started a trial", async () => {
    expect(await trial.reconcileWithDb(args(fakeDb(undefined), tmpDir()))).toBeNull();
  });
});
