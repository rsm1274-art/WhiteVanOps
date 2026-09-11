import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id: clientId } = await params;
    const { dueDate, note, assignedToId } = await request.json();

    if (!dueDate || !note || !note.trim()) {
      return NextResponse.json({ error: "Due date and note are required" }, { status: 400 });
    }
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const followUp = await prisma.clientFollowUp.create({
      data: {
        clientId,
        dueDate: new Date(dueDate),
        note: note.trim(),
        assignedToId: assignedToId || null,
      },
    });

    await audit(user!.userId, "CREATE", "ClientFollowUp", followUp.id, { clientId });

    return NextResponse.json(followUp);
  } catch (error) {
    console.error("Create ClientFollowUp API Error:", error);
    return NextResponse.json({ error: "Failed to add follow-up" }, { status: 500 });
  }
}
