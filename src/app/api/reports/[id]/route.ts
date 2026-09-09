import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { audit } from "@/lib/audit";
import { validateDefinition } from "@/lib/reports/definition";
import { canEditReport, canViewReport } from "@/lib/reports/permissions";

// A report the caller may not even view returns the same 404 as one that
// doesn't exist, matching the uniform-404 discipline in
// src/app/api/public/quotes/[token]/route.ts — a 403 would confirm the
// report's existence to someone who can't see it.

const REPORT_INCLUDE = { folder: { select: { isPublic: true } } } as const;

const notFound = () => NextResponse.json({ error: "Report not found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  const { id } = await params;
  const report = await prisma.savedReport.findUnique({ where: { id }, include: REPORT_INCLUDE });
  if (!report || !canViewReport({ userId: user!.userId, role: user!.role }, report)) return notFound();

  return NextResponse.json(report);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  const { id } = await params;
  const existing = await prisma.savedReport.findUnique({ where: { id }, include: REPORT_INCLUDE });
  if (!existing || !canViewReport({ userId: user!.userId, role: user!.role }, existing)) return notFound();
  if (!canEditReport({ userId: user!.userId, role: user!.role }, existing)) return notFound();

  try {
    const body = await req.json();
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { name, description, definition, folderId, isShared } = body as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json({ error: "A report name is required" }, { status: 400 });
      }
      data.name = name.trim();
    }
    if (description !== undefined) data.description = typeof description === "string" ? description : null;
    if (folderId !== undefined) {
      if (typeof folderId === "string" && folderId.length > 0) {
        const folder = await prisma.reportFolder.findUnique({ where: { id: folderId } });
        if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
        data.folderId = folder.id;
      } else {
        data.folderId = null;
      }
    }
    if (isShared !== undefined) data.isShared = isShared === true;
    if (definition !== undefined) {
      const validated = validateDefinition(definition, user!.role);
      if (!validated.ok || !validated.definition) {
        return NextResponse.json(
          { error: "Invalid report definition", details: validated.errors, unknownFieldKeys: validated.unknownFieldKeys },
          { status: 400 }
        );
      }
      data.definition = validated.definition as unknown as object;
    }

    const updated = await prisma.savedReport.update({ where: { id }, data, include: REPORT_INCLUDE });
    await audit(user!.userId, "UPDATE", "SavedReport", id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Saved report update error:", error);
    return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  const { id } = await params;
  const existing = await prisma.savedReport.findUnique({ where: { id }, include: REPORT_INCLUDE });
  if (!existing || !canViewReport({ userId: user!.userId, role: user!.role }, existing)) return notFound();
  if (!canEditReport({ userId: user!.userId, role: user!.role }, existing)) return notFound();

  try {
    await prisma.savedReport.delete({ where: { id } });
    await audit(user!.userId, "DELETE", "SavedReport", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Saved report delete error:", error);
    return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
  }
}
