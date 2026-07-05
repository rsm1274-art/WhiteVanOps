import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "superuser");
  if (err) return err;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      personnelId: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      personnel: { select: { firstName: true, lastName: true } },
    },
  });

  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "superuser");
  if (err) return err;

  const { username, displayName, role, password, personnelId } = await request.json();

  if (!username || !displayName || !role || !password) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!["superuser", "admin", "tech"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "Username already exists" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const newUser = await prisma.user.create({
    data: {
      username,
      displayName,
      role,
      passwordHash,
      personnelId: personnelId || null,
    },
  });

  await audit(user!.userId, "CREATE", "User", newUser.id, { username, role });

  return NextResponse.json({ id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role });
}

export async function PUT(request: Request) {
  const sessionUser = await getSessionUser();
  const err = requireRole(sessionUser, "superuser");
  if (err) return err;

  const { id, displayName, role, password, personnelId, active } = await request.json();

  if (!id) return NextResponse.json({ error: "Missing user ID" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (role !== undefined) {
    if (!["superuser", "admin", "tech"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    updateData.role = role;
  }
  if (personnelId !== undefined) updateData.personnelId = personnelId || null;
  if (active !== undefined) updateData.active = active;
  if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

  const updated = await prisma.user.update({ where: { id }, data: updateData });

  await audit(sessionUser!.userId, "UPDATE", "User", id, { changes: Object.keys(updateData) });

  return NextResponse.json({ id: updated.id, username: updated.username, displayName: updated.displayName, role: updated.role, active: updated.active });
}
