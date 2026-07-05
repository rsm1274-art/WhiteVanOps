import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { Role, setSessionCookie, signSessionToken } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

// Per-IP: slows down credential-stuffing across many usernames from one source.
const IP_MAX_ATTEMPTS = 20;
const IP_WINDOW_MS = 5 * 60 * 1000;

// Per-account: locks a specific account out after repeated wrong passwords,
// persisted on the User row so it survives server restarts.
const ACCOUNT_MAX_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  if (!process.env.SESSION_SECRET) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`login:${ip}`, IP_MAX_ATTEMPTS, IP_WINDOW_MS)) {
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

  const token = await signSessionToken({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as Role,
    personnelId: user.personnelId ?? undefined,
    mustChangePassword: user.mustChangePassword,
  });

  const res = NextResponse.json({
    ok: true,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  setSessionCookie(res, token);

  return res;
}
