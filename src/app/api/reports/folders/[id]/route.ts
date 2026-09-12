import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Every caller reaching this route is already admin/superuser (requireRole
// below) — the same set permissions.ts's canEditReport treats as universal
// editors for the report-builder feature. No creator-only folder lock, so
// no additional per-row edit check is needed beyond "does it exist."

const notFound = () => NextResponse.json({ error: "Folder not found" }, { status: 404 });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const { id } = await params;
  const existing = await prisma.reportFolder.findUnique({ where: { id } });
  if (!existing) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { name, isPublic } = body as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "A folder name is required" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (isPublic !== undefined) data.isPublic = isPublic === true;

  const updated = await prisma.reportFolder.update({ where: { id }, data });
  await audit(user!.userId, "UPDATE", "ReportFolder", id);
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const { id } = await params;
  const existing = await prisma.reportFolder.findUnique({ where: { id } });
  if (!existing) return notFound();

  await prisma.reportFolder.delete({ where: { id } });
  await audit(user!.userId, "DELETE", "ReportFolder", id);
  return NextResponse.json({ ok: true });
}
