import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { audit } from "@/lib/audit";
import { validateDefinition } from "@/lib/reports/definition";
import { canViewReport } from "@/lib/reports/permissions";

// List/create saved reports. GET filters to what the caller may see
// (canViewReport: creator, shared report, or a public folder) rather than
// relying on the client to hide anything — the UI check in
// SavedReportsPanel.tsx is convenience only.

const REPORT_INCLUDE = { folder: { select: { isPublic: true } } } as const;

export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  const reports = await prisma.savedReport.findMany({
    include: REPORT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  const visible = reports.filter((r) => canViewReport({ userId: user!.userId, role: user!.role }, r));
  return NextResponse.json(visible);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const body = await req.json();
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { name, description, definition, folderId, isShared } = body as Record<string, unknown>;

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "A report name is required" }, { status: 400 });
    }

    const validated = validateDefinition(definition, user!.role);
    if (!validated.ok || !validated.definition) {
      return NextResponse.json(
        { error: "Invalid report definition", details: validated.errors, unknownFieldKeys: validated.unknownFieldKeys },
        { status: 400 }
      );
    }

    let resolvedFolderId: string | null = null;
    if (typeof folderId === "string" && folderId.length > 0) {
      const folder = await prisma.reportFolder.findUnique({ where: { id: folderId } });
      if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      resolvedFolderId = folder.id;
    }

    const report = await prisma.savedReport.create({
      data: {
        name: name.trim(),
        description: typeof description === "string" ? description : null,
        definition: validated.definition as unknown as object,
        folderId: resolvedFolderId,
        isShared: isShared === true,
        createdById: user!.userId,
      },
      include: REPORT_INCLUDE,
    });

    await audit(user!.userId, "CREATE", "SavedReport", report.id);
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error("Saved report create error:", error);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }
}
