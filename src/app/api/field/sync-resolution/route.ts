import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";

// Server side of stuck-record resolution. Lives under /api/field on purpose:
// TECH_ALLOWED_PREFIXES in src/middleware.ts matches by startsWith, so techs
// reach it with no middleware change. Not Plus-gated — a Base customer losing
// a tech's hours is the same bug.
//
// Audits here use prisma.auditLog.create directly, NOT the fire-and-forget
// audit() helper: the device deletes its local copy on a 200, so a swallowed
// audit failure would make a discard with no trail possible. The audit write
// must fail the request.

interface ResolutionOp {
  url: string;
  method: string;
  body: unknown;
  queuedAt: number;
}

interface ResolutionRejection {
  status: number;
  message: string;
  rejectedAt: number;
}

function isValidOp(op: unknown): op is ResolutionOp {
  const o = op as ResolutionOp;
  return !!o && typeof o.url === "string" && typeof o.method === "string" && typeof o.queuedAt === "number";
}

function isValidRejection(r: unknown): r is ResolutionRejection {
  const rej = r as ResolutionRejection;
  return !!rej && typeof rej.status === "number" && typeof rej.message === "string" && typeof rej.rejectedAt === "number";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  const denied = requireRole(user, "tech", "admin", "superuser");
  if (denied) return denied;

  let payload: {
    action?: string;
    op?: unknown;
    rejection?: unknown;
    newJobId?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, op, rejection, newJobId } = payload;
  if (
    (action !== "discard" && action !== "retarget" && action !== "handoff") ||
    !isValidOp(op) ||
    !isValidRejection(rejection)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (action === "retarget" && typeof newJobId !== "string") {
    return NextResponse.json({ error: "newJobId is required for retarget" }, { status: 400 });
  }

  // Re-derive from the session, never the body, matching the tech surface.
  const personnelId = user!.personnelId ?? null;

  try {
    if (action === "handoff") {
      const item = await prisma.$transaction(async (tx) => {
        const created = await tx.syncReviewItem.create({
          data: {
            personnelId,
            userId: user!.userId,
            url: op.url,
            method: op.method,
            body: (op.body ?? {}) as object,
            queuedAt: new Date(op.queuedAt),
            rejectedAt: new Date(rejection.rejectedAt),
            rejectionStatus: rejection.status,
            rejectionMessage: rejection.message,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user!.userId,
            action: "CREATE",
            entity: "SyncReviewItem",
            entityId: created.id,
            details: JSON.stringify({ op, rejection }),
          },
        });
        return created;
      });
      return NextResponse.json({ ok: true, id: item.id });
    }

    // discard / retarget: there is no server-side row to point at — the op only
    // ever existed on the device. The audit's value lives entirely in details,
    // which carries the full payload so an admin can re-enter the work.
    await prisma.auditLog.create({
      data: {
        userId: user!.userId,
        action: action === "discard" ? "DELETE" : "UPDATE",
        entity: "StuckSyncOp",
        entityId: "device-local",
        details: JSON.stringify(
          action === "retarget" ? { op, rejection, newJobId } : { op, rejection }
        ),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sync resolution failed:", error);
    return NextResponse.json({ error: "Failed to record resolution" }, { status: 500 });
  }
}
