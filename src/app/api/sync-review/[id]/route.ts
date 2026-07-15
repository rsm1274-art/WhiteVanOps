import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";

// Admin disposition of handed-off sync records. Deliberately NOT under
// /api/field: techs must not resolve or dismiss office review items.
// Not Plus-gated.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const denied = requireRole(user, "admin", "superuser");
  if (denied) return denied;

  const { id } = await params;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "resolve" && body.action !== "dismiss") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    const item = await prisma.syncReviewItem.update({
      where: { id },
      data: {
        status: body.action === "resolve" ? "Resolved" : "Dismissed",
        resolvedById: user!.userId,
        resolvedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: user!.userId,
        action: "UPDATE",
        entity: "SyncReviewItem",
        entityId: item.id,
        details: JSON.stringify({ disposition: body.action }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sync review update failed:", error);
    return NextResponse.json({ error: "Failed to update review item" }, { status: 500 });
  }
}
