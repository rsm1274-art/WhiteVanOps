import { describe, it, expect } from "vitest";
import { signTrialUnlock, verifyTrialUnlock, timingSafeEqualStrings } from "./licenseCrypto";

describe("timingSafeEqualStrings", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStrings("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqualStrings("abc123", "xyz789")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqualStrings("short", "a-much-longer-string")).toBe(false);
  });
});

describe("signTrialUnlock / verifyTrialUnlock", () => {
  it("verifies a correctly signed payload (round-trip)", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(true);
  });

  it("verifies a payload with a non-null expiresAt", () => {
    const expiresAt = "2027-01-01T00:00:00.000Z";
    const sig = signTrialUnlock("test-machine-id", "base", expiresAt);
    const payload = { machineId: "test-machine-id", tier: "base" as const, expiresAt, notes: "note", sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(true);
  });

  it("rejects a payload whose machineId does not match the caller's machine", () => {
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

  it("rejects a non-object payload", () => {
    expect(verifyTrialUnlock(null, "test-machine-id")).toBe(false);
    expect(verifyTrialUnlock("a string", "test-machine-id")).toBe(false);
  });
});
