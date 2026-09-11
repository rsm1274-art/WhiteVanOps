import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { audit } from "@/lib/audit";

export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  const folders = await prisma.reportFolder.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(folders);
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
    const { name, isPublic } = body as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "A folder name is required" }, { status: 400 });
    }

    const folder = await prisma.reportFolder.create({
      data: { name: name.trim(), isPublic: isPublic === true, createdById: user!.userId },
    });
    await audit(user!.userId, "CREATE", "ReportFolder", folder.id);
    return NextResponse.json(folder, { status: 201 });
  } catch (error) {
    console.error("Report folder create error:", error);
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}
