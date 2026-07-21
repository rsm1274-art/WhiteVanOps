import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  getClientIp,
  checkLoginRateLimit,
  resetRateLimits,
  LOGIN_IDENTITY_MAX_ATTEMPTS,
  LOGIN_IP_CEILING_MAX_ATTEMPTS,
} from "./rateLimit";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/auth/login", { headers });
}

beforeEach(() => {
  resetRateLimits();
});

describe("checkRateLimit", () => {
  it("allows up to maxRequests within the window, then refuses", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("k", 3, 60_000)).toBe(true);
    }
    expect(checkRateLimit("k", 3, 60_000)).toBe(false);
  });

  it("keeps separate budgets per key", () => {
    expect(checkRateLimit("a", 1, 60_000)).toBe(true);
    expect(checkRateLimit("a", 1, 60_000)).toBe(false);
    expect(checkRateLimit("b", 1, 60_000)).toBe(true);
  });
});

describe("getClientIp", () => {
  it("prefers CF-Connecting-IP, which the tunnel sets to the real client address", () => {
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 203.0.113.7",
    });
    expect(getClientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to the first entry of X-Forwarded-For", () => {
    const req = reqWith({ "x-forwarded-for": "198.51.100.1, 10.0.0.5" });
    expect(getClientIp(req)).toBe("198.51.100.1");
  });

  it("falls back to X-Real-IP when no forwarded chain is present", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "192.0.2.9" }))).toBe("192.0.2.9");
  });

  it("returns null rather than a shared constant when the IP is unknown", () => {
    expect(getClientIp(reqWith({}))).toBeNull();
  });

  it("returns null for a header present but blank, instead of an empty-string key", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "  ,  " }))).toBeNull();
  });
});

describe("checkLoginRateLimit", () => {
  it("does not let one user's failures consume another user's budget on the same IP", () => {
    for (let i = 0; i < LOGIN_IDENTITY_MAX_ATTEMPTS; i++) {
      expect(checkLoginRateLimit("203.0.113.7", "alice")).toBe(true);
    }
    expect(checkLoginRateLimit("203.0.113.7", "alice")).toBe(false);
    expect(checkLoginRateLimit("203.0.113.7", "bob")).toBe(true);
  });

  it("does not let one IP consume another IP's budget for the same user", () => {
    for (let i = 0; i < LOGIN_IDENTITY_MAX_ATTEMPTS; i++) {
      checkLoginRateLimit("203.0.113.7", "alice");
    }
    expect(checkLoginRateLimit("203.0.113.7", "alice")).toBe(false);
    expect(checkLoginRateLimit("198.51.100.4", "alice")).toBe(true);
  });

  it("treats usernames case-insensitively so casing can't mint fresh buckets", () => {
    for (let i = 0; i < LOGIN_IDENTITY_MAX_ATTEMPTS; i++) {
      checkLoginRateLimit("203.0.113.7", "alice");
    }
    expect(checkLoginRateLimit("203.0.113.7", "ALICE")).toBe(false);
  });

  it("applies a per-IP ceiling across many usernames from one source", () => {
    let allowed = 0;
    // Each username gets its own identity bucket, so only the IP ceiling can stop this.
    for (let i = 0; i < LOGIN_IP_CEILING_MAX_ATTEMPTS + 10; i++) {
      if (checkLoginRateLimit("203.0.113.7", `user${i}`)) allowed++;
    }
    expect(allowed).toBe(LOGIN_IP_CEILING_MAX_ATTEMPTS);
  });

  it("sets the IP ceiling well above the per-identity limit so shared NATs don't lock out techs", () => {
    expect(LOGIN_IP_CEILING_MAX_ATTEMPTS).toBeGreaterThan(LOGIN_IDENTITY_MAX_ATTEMPTS * 3);
  });

  it("falls back to a per-username bucket when the IP is unknown, never a shared one", () => {
    for (let i = 0; i < LOGIN_IDENTITY_MAX_ATTEMPTS; i++) {
      expect(checkLoginRateLimit(null, "alice")).toBe(true);
    }
    expect(checkLoginRateLimit(null, "alice")).toBe(false);
    // The whole company must not share one budget just because the IP is unknown.
    expect(checkLoginRateLimit(null, "bob")).toBe(true);
  });
});
