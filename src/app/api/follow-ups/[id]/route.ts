import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPlusLicense, requirePlus } from "@/lib/license";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const { id } = await params;
    const { dueDate, note, assignedToId, completed } = await request.json();

    const existing = await prisma.clientFollowUp.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
    }

    const followUp = await prisma.clientFollowUp.update({
      where: { id },
      data: {
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
        ...(note !== undefined && { note: note.trim() }),
        ...(assignedToId !== undefined && { assignedToId: assignedToId || null }),
        ...(completed !== undefined && {
          completed,
          completedAt: completed ? new Date() : null,
        }),
      },
    });

    await audit(user!.userId, "UPDATE", "ClientFollowUp", followUp.id);

    return NextResponse.json(followUp);
  } catch (error) {
    console.error("Update ClientFollowUp API Error:", error);
    return NextResponse.json({ error: "Failed to update follow-up" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const { id } = await params;
    const existing = await prisma.clientFollowUp.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
    }

    await prisma.clientFollowUp.delete({ where: { id } });
    await audit(user!.userId, "DELETE", "ClientFollowUp", id, { clientId: existing.clientId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete ClientFollowUp API Error:", error);
    return NextResponse.json({ error: "Failed to delete follow-up" }, { status: 500 });
  }
}
