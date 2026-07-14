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

// The session cookie is only marked Secure (HTTPS-only) when REQUIRE_HTTPS=true.
// Browsers refuse to persist Secure cookies over plain http:// on a non-localhost
// origin. The documented field-access path (MANUAL_Setup_Installation.md §7) is
// router Port Forwarding + Dynamic DNS, which is plain http:// by design — leave
// REQUIRE_HTTPS unset for that setup. Only set it to true if a real HTTPS front
// end (e.g. a reverse proxy) is in front of the app.
function isHttpsRequired(): boolean {
  return process.env.NODE_ENV === "production" && process.env.REQUIRE_HTTPS === "true";
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isHttpsRequired(),
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

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
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
