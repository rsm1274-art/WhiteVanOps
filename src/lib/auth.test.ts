import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const mockCookieStore = {
  get: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import {
  getSessionCookieOptions,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  unauthorized,
  forbidden,
  requireRole,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from "./auth";

const testUser: SessionUser = {
  userId: "user-1",
  username: "dispatcher",
  displayName: "Dispatch Office",
  role: "admin",
};

describe("getSessionCookieOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is not secure when NODE_ENV is not production, regardless of REQUIRE_HTTPS", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REQUIRE_HTTPS", "true");
    expect(getSessionCookieOptions().secure).toBe(false);
  });

  it("is not secure in production when REQUIRE_HTTPS is unset (the Port Forwarding + DDNS default)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUIRE_HTTPS", undefined);
    expect(getSessionCookieOptions().secure).toBe(false);
  });

  it("is secure only when both NODE_ENV=production and REQUIRE_HTTPS=true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REQUIRE_HTTPS", "true");
    expect(getSessionCookieOptions().secure).toBe(true);
  });

  it("always sets httpOnly, sameSite=lax, and a 7-day maxAge", () => {
    const opts = getSessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.maxAge).toBe(60 * 60 * 24 * 7);
    expect(opts.path).toBe("/");
  });
});

describe("signSessionToken / getSessionUser round trip", () => {
  const originalSecret = process.env.SESSION_SECRET;
  beforeEach(() => {
    process.env.SESSION_SECRET = "unit-test-fixture";
    mockCookieStore.get.mockReset();
  });
  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("signs a token that independently verifies with the same secret and payload", async () => {
    const token = await signSessionToken(testUser);
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const { payload } = await jwtVerify(token, key);
    expect(payload.userId).toBe(testUser.userId);
    expect(payload.username).toBe(testUser.username);
    expect(payload.role).toBe(testUser.role);
  });

  it("throws if SESSION_SECRET is not configured", async () => {
    delete process.env.SESSION_SECRET;
    await expect(signSessionToken(testUser)).rejects.toThrow("SESSION_SECRET is not configured");
  });

  it("getSessionUser returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const result = await getSessionUser();
    expect(result).toBeNull();
  });

  it("getSessionUser returns null for a token signed with a different secret (tampered/stale)", async () => {
    const token = await signSessionToken(testUser);
    mockCookieStore.get.mockReturnValue({ value: token });
    process.env.SESSION_SECRET = "a-different-secret";
    const result = await getSessionUser();
    expect(result).toBeNull();
  });

  it("getSessionUser returns the payload for a validly signed token", async () => {
    const token = await signSessionToken(testUser);
    mockCookieStore.get.mockReturnValue({ value: token });
    const result = await getSessionUser();
    expect(result?.userId).toBe(testUser.userId);
    expect(result?.role).toBe(testUser.role);
  });
});

describe("setSessionCookie / clearSessionCookie", () => {
  it("setSessionCookie sets the session cookie with the signed token", () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, "fake-token-value");
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("fake-token-value");
  });

  it("clearSessionCookie empties the session cookie", () => {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("");
  });
});

describe("unauthorized / forbidden", () => {
  it("unauthorized returns a 401", () => {
    expect(unauthorized().status).toBe(401);
  });

  it("forbidden returns a 403", () => {
    expect(forbidden().status).toBe(403);
  });
});

describe("requireRole", () => {
  it("returns 401 when there is no user", () => {
    const res = requireRole(null, "admin");
    expect(res?.status).toBe(401);
  });

  it("returns 403 when the user's role is not in the allowed list", () => {
    const res = requireRole(testUser, "superuser");
    expect(res?.status).toBe(403);
  });

  it("returns null (allowed) when the user's role is in the allowed list", () => {
    const res = requireRole(testUser, "admin", "superuser");
    expect(res).toBeNull();
  });
});

describe("SessionUser trialLocked claim round-trips through signSessionToken", () => {
  it("preserves trialLocked: true through sign and verify", async () => {
    process.env.SESSION_SECRET = "test-secret-at-least-32-bytes-long";
    const token = await signSessionToken({
      userId: "u1",
      username: "admin",
      displayName: "Admin",
      role: "superuser",
      trialLocked: true,
    });
    expect(typeof token).toBe("string");
    const [, payloadB64] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    expect(decoded.trialLocked).toBe(true);
  });
});
