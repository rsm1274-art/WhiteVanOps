import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function PUT(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { action, ...payload } = await request.json();

    if (action === "add_qualification") {
      const { personnelId, tag, category, issuedBy, expiresAt, notes } = payload;
      if (!personnelId || !tag || !category) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      const qual = await prisma.personnelQualification.create({
        data: {
          personnelId,
          tag: tag.trim(),
          category,
          issuedBy: issuedBy?.trim() || null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          notes: notes?.trim() || null,
        },
      });
      await audit(user!.userId, "CREATE", "PersonnelQualification", qual.id, { personnelId, tag });
      return NextResponse.json(qual);
    }

    if (action === "remove_qualification") {
      const { qualificationId } = payload;
      if (!qualificationId) return NextResponse.json({ error: "Missing qualificationId" }, { status: 400 });
      await prisma.personnelQualification.delete({ where: { id: qualificationId } });
      await audit(user!.userId, "DELETE", "PersonnelQualification", qualificationId);
      return NextResponse.json({ ok: true });
    }

    if (action === "add_timeoff") {
      const { personnelId, type, startDate, endDate, notes } = payload;
      if (!personnelId || !type || !startDate || !endDate) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      const entry = await prisma.personnelTimeOff.create({
        data: {
          personnelId,
          type,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          notes: notes?.trim() || null,
        },
      });
      await audit(user!.userId, "CREATE", "PersonnelTimeOff", entry.id, { personnelId, type, startDate, endDate });
      return NextResponse.json(entry);
    }

    if (action === "remove_timeoff") {
      const { timeOffId } = payload;
      if (!timeOffId) return NextResponse.json({ error: "Missing timeOffId" }, { status: 400 });
      await prisma.personnelTimeOff.delete({ where: { id: timeOffId } });
      await audit(user!.userId, "DELETE", "PersonnelTimeOff", timeOffId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Personnel PUT Error:", error);
    return NextResponse.json({ error: "Failed to update personnel" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { firstName, lastName, role, certifications } = await request.json();

    if (!firstName || !lastName || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newPersonnel = await prisma.personnel.create({
      data: { firstName, lastName, role, certifications: certifications || null },
    });

    await audit(user!.userId, "CREATE", "Personnel", newPersonnel.id, { firstName, lastName, role });

    return NextResponse.json(newPersonnel);
  } catch (error) {
    console.error("Create Personnel API Error:", error);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}
