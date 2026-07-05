import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

export type Role = "superuser" | "admin" | "tech";

export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  personnelId?: string;
  mustChangePassword?: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
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
