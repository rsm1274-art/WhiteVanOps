import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";

export type Role = "superuser" | "admin" | "tech";

export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  personnelId?: string;
  mustChangePassword?: boolean;
  /** Stamped at login for WVO_IS_TRIAL builds whose 30-day trial has expired with no unlock key applied. */
  trialLocked?: boolean;
}

export const SESSION_COOKIE_NAME = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

// `secure` is a PER-REQUEST property, not a deployment setting. One server
// answers both http://localhost:3000 (the Electron desktop window) and the
// https:// tunnel the field techs come in on, so any single global flag is
// guaranteed to be wrong for one of them — and a wrong value fails silently:
// the browser refuses to persist a Secure cookie over http://, so login
// appears to submit and then bounces straight back to /login with no error.
//
// A tunnel or reverse proxy sets X-Forwarded-Proto on the way in; a direct
// plain-http request has no such header. Only the first hop matters — it is
// the one that faced the client.
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  return proto?.split(",")[0]?.trim().toLowerCase() === "https";
}

export function getSessionCookieOptions(req: Request) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  };
}

export async function signSessionToken(payload: SessionUser): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(key);
}

export function setSessionCookie(res: NextResponse, token: string, req: Request): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions(req));
}

// Clears using the same options the cookie was set with, so the two can't drift.
// Note on what actually matters: a browser identifies a cookie by (name, domain,
// path) only — `secure`/`httpOnly`/`sameSite` are NOT part of that identity, so
// omitting them does not break the delete. `path` is the attribute that must
// match, and it is the one this shares. Deriving the whole set from one place
// means a future change to `path` (or an added `domain`) stays in sync here.
export function clearSessionCookie(res: NextResponse, req: Request): void {
  res.cookies.set(SESSION_COOKIE_NAME, "", { ...getSessionCookieOptions(req), maxAge: 0 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** Returns an error response if the user doesn't have one of the required roles, otherwise null. */
export function requireRole(user: SessionUser | null, ...roles: Role[]): NextResponse | null {
  if (!user) return unauthorized();
  if (!roles.includes(user.role)) return forbidden();
  return null;
}
