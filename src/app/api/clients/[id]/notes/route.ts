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
    const { body } = await request.json();

    if (!body || !body.trim()) {
      return NextResponse.json({ error: "Note body is required" }, { status: 400 });
    }
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const note = await prisma.clientNote.create({
      data: { clientId, authorId: user!.userId, body: body.trim() },
    });

    await audit(user!.userId, "CREATE", "ClientNote", note.id, { clientId });

    return NextResponse.json(note);
  } catch (error) {
    console.error("Create ClientNote API Error:", error);
    return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
  }
}
