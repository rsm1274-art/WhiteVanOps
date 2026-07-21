import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { Role, setSessionCookie, signSessionToken } from "@/lib/auth";
import { checkLoginRateLimit, getClientIp } from "@/lib/rateLimit";
import { getTrialStatus } from "@/lib/trial";

// Per-account: locks a specific account out after repeated wrong passwords,
// persisted on the User row so it survives server restarts. This is the real
// brute-force control; the in-memory limits in rateLimit.ts layer around it.
const ACCOUNT_MAX_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  // Typed explicitly: these come from untrusted JSON, and a non-string would
  // otherwise reach the rate-limit key and the Prisma lookup.
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  if (!process.env.SESSION_SECRET) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  if (!checkLoginRateLimit(getClientIp(req), username)) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.active) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `Account temporarily locked due to repeated failed attempts. Try again in ${minutesLeft} minute(s).` },
      { status: 423 }
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lockedOut = attempts >= ACCOUNT_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lockedOut ? 0 : attempts,
        lockedUntil: lockedOut ? new Date(Date.now() + ACCOUNT_LOCKOUT_MS) : null,
      },
    });

    if (lockedOut) {
      return NextResponse.json(
        { error: `Account temporarily locked due to repeated failed attempts. Try again in ${ACCOUNT_LOCKOUT_MS / 60000} minute(s).` },
        { status: 423 }
      );
    }
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  const trialStatus = getTrialStatus();

  const token = await signSessionToken({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as Role,
    personnelId: user.personnelId ?? undefined,
    mustChangePassword: user.mustChangePassword,
    trialLocked: trialStatus.isLocked,
  });

  const res = NextResponse.json({
    ok: true,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  setSessionCookie(res, token, req);

  return res;
}
