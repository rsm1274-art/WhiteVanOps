import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  logTime,
  setJobNotes,
  setJobLineItems,
  setJobStatus,
  type FieldActor,
  type OpResult,
} from "@/lib/fieldOps";

/**
 * Single consolidated endpoint for all four field-module writes (time entry,
 * notes, materials/line items, status change). The old shapes were split
 * across two URLs (POST /api/time, PUT /api/jobs with three different field
 * combinations) purely because those two routes predate the offline sync
 * queue and the idempotency work — JobCard.tsx already sends one op per
 * request, never a batch, so there is no batching reason to keep the split.
 * One URL that dispatches on which field is present in the body is simpler
 * than mirroring the old split into two new routes, and it gives fieldOps.ts
 * (not this route) sole ownership of the authorization/idempotency rules —
 * exactly the "rules can't drift" goal the phase asks for.
 *
 * The op id travels in the X-WVO-Op-Id header (already sent on every field
 * write by offlineWrite.ts since Phase 2) rather than the body, so it can't
 * be confused with a real form field.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const opId = request.headers.get("X-WVO-Op-Id");
  if (!opId) {
    return NextResponse.json({ error: "Missing X-WVO-Op-Id header" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const actor: FieldActor = {
    userId: user.userId,
    personnelId: user.personnelId ?? null,
    role: user.role,
  };

  try {
    let result: OpResult;

    if (body.duration !== undefined) {
      result = await prisma.$transaction((tx) =>
        logTime(tx, actor, opId, body as { jobId: string; personnelId: string; date: string; duration: string; serviceItem?: string; payrollItem?: string })
      );
    } else if (body.notes !== undefined) {
      result = await prisma.$transaction((tx) =>
        setJobNotes(tx, actor, opId, body as { jobId: string; notes: string })
      );
    } else if (body.lineItems !== undefined) {
      result = await prisma.$transaction((tx) =>
        setJobLineItems(tx, actor, opId, body as { jobId: string; lineItems: Array<{ inventoryItemId: string; quantity: string | number; rate: string | number; description?: string }> })
      );
    } else if (body.status !== undefined) {
      result = await prisma.$transaction((tx) =>
        setJobStatus(tx, actor, opId, body as { jobId: string; status: string })
      );
    } else {
      return NextResponse.json({ error: "Unrecognized op body" }, { status: 400 });
    }

    if (result.outcome === "rejected") {
      return NextResponse.json({ error: result.error ?? "Rejected" }, { status: result.status ?? 400 });
    }

    return NextResponse.json({ outcome: result.outcome, resultId: result.resultId });
  } catch (error) {
    console.error("Field Ops API Error:", error);
    return NextResponse.json({ error: "Failed to apply field op" }, { status: 500 });
  }
}
