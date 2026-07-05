import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { Role, setSessionCookie, signSessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  if (!process.env.SESSION_SECRET) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.active) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
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
