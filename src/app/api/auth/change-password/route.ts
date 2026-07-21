import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUser, Role, setSessionCookie, signSessionToken } from "@/lib/auth";
import { validatePassword } from "@/lib/password";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { newPassword, confirmPassword } = await req.json();

  if (!newPassword || !confirmPassword) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const updated = await prisma.user.update({
    where: { id: user.userId },
    data: { passwordHash, mustChangePassword: false },
  });

  const token = await signSessionToken({
    userId: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    role: updated.role as Role,
    personnelId: updated.personnelId ?? undefined,
    mustChangePassword: false,
  });

  const res = NextResponse.json({ ok: true, role: updated.role });
  setSessionCookie(res, token, req);

  return res;
}
