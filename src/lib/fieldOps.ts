/**
 * Idempotent, role-authorized appliers for field-module writes.
 *
 * Each exported function takes an already-open Prisma transaction client, an
 * actor, an opId, and the write's body, and returns an OpResult describing
 * what happened rather than throwing on a business-rule rejection — only a
 * genuine unexpected error (a DB error the caller didn't ask for, an FK
 * violation on a garbage id) propagates as a thrown exception, mirroring how
 * jobs/route.ts and time/route.ts let those fall through to their outer
 * try/catch today.
 *
 * Idempotency / transaction semantics (read this before changing step 3):
 *
 * `AppliedOp.opId` is the primary key, so `tx.appliedOp.create(...)` is the
 * idempotency check AND the record of it in one statement — a second call
 * with the same opId hits the primary-key unique constraint. We deliberately
 * do NOT wrap that create in a nested transaction/savepoint. Instead: on a
 * P2002 we catch the error in JS and return `{outcome: "duplicate"}`
 * immediately, performing no further reads or writes in this call.
 *
 * Why that's safe: Postgres marks a transaction "aborted" after any
 * statement fails, and every later statement on that same connection would
 * itself fail with "current transaction is aborted" — so the instant a
 * P2002 happens, this transaction can do nothing else useful anyway; it can
 * only end. Prisma's interactive transaction then tries to COMMIT the
 * (aborted) transaction, which Postgres silently downgrades to a ROLLBACK.
 * No exception reaches the caller and nothing is persisted from this call —
 * which is exactly what "duplicate" should do, since the row proving the op
 * already applied was already committed by the FIRST call. Never issue a
 * query after a caught P2002 in the same tx.
 *
 * The ordering guard (step 4) runs its own read (`appliedOp.findFirst`)
 * AFTER the create succeeds, so it never touches an aborted transaction.
 * When it decides an op is superseded, it updates the just-inserted
 * AppliedOp row's outcome rather than deleting it — the row must stay as
 * the durable "this opId was seen" record, just marked as not the one that
 * won.
 */

import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { targetKeyFor, shouldApply, type FieldOpType } from "@/lib/opOrdering";

export type PrismaTransactionClient = Prisma.TransactionClient;

export interface FieldActor {
  userId: string;
  personnelId: string | null;
  role: "tech" | "admin" | "superuser";
}

export type OpOutcome = "applied" | "superseded" | "duplicate" | "rejected";

export interface OpResult {
  outcome: OpOutcome;
  resultId?: string;
  /** Set when outcome is "rejected" — becomes the HTTP error message. */
  error?: string;
  /** HTTP status to use when outcome is "rejected" (403/404/etc). */
  status?: number;
}

function isUniqueConstraintError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

/** Insert the AppliedOp row for this opId. Returns null on a duplicate. */
async function recordApplied(
  tx: PrismaTransactionClient,
  opId: string,
  opType: FieldOpType,
  targetKey: string
): Promise<"inserted" | "duplicate"> {
  try {
    await tx.appliedOp.create({
      data: { opId, opType, targetKey, outcome: "applied", via: "lan" },
    });
    return "inserted";
  } catch (e) {
    if (isUniqueConstraintError(e)) return "duplicate";
    throw e;
  }
}

/**
 * Ordering guard for replace-semantics ops (notes/lineItems/status). Returns
 * true if this op should apply, false if it was superseded by an
 * already-applied newer op — in which case it also flips the just-inserted
 * AppliedOp row to "superseded" so the row's outcome reflects reality.
 */
async function checkOrdering(
  tx: PrismaTransactionClient,
  opId: string,
  targetKey: string
): Promise<boolean> {
  const prior = await tx.appliedOp.findFirst({
    where: { targetKey, outcome: "applied", opId: { not: opId } },
    orderBy: { opId: "desc" },
  });
  if (shouldApply(opId, prior?.opId ?? null)) return true;

  await tx.appliedOp.update({
    where: { opId },
    data: { outcome: "superseded" },
  });
  return false;
}

async function recordResultId(
  tx: PrismaTransactionClient,
  opId: string,
  resultId: string
): Promise<void> {
  await tx.appliedOp.update({ where: { opId }, data: { resultId } });
}

// ---------------------------------------------------------------------------
// logTime — mirrors POST /api/time
// ---------------------------------------------------------------------------

export async function logTime(
  tx: PrismaTransactionClient,
  actor: FieldActor,
  opId: string,
  body: {
    jobId: string;
    personnelId: string;
    date: string;
    duration: string;
    serviceItem?: string;
    payrollItem?: string;
  }
): Promise<OpResult> {
  const { jobId, personnelId, date, duration, serviceItem, payrollItem } = body;

  if (!jobId || !personnelId || !date || !duration) {
    return { outcome: "rejected", status: 400, error: "Missing required fields" };
  }

  if (actor.role === "tech") {
    if (!actor.personnelId || personnelId !== actor.personnelId) {
      return { outcome: "rejected", status: 403, error: "You can only log time for yourself" };
    }
    const assignment = await tx.jobAssignment.findFirst({ where: { jobId, personnelId } });
    if (!assignment) {
      return { outcome: "rejected", status: 403, error: "You are not assigned to this job" };
    }
  }

  const durationRegex = /^\d{2}:\d{2}$/;
  if (!durationRegex.test(duration)) {
    return {
      outcome: "rejected",
      status: 400,
      error: "Duration must be in strict [HH:MM] format (e.g., '08:30' or '00:45')",
    };
  }

  // Insert semantics: no ordering guard — every time entry is its own row,
  // and targetKeyFor("time", ...) already embeds this opId so it can never
  // collide with another op's target.
  const targetKey = targetKeyFor("time", jobId, opId);
  const recorded = await recordApplied(tx, opId, "time", targetKey);
  if (recorded === "duplicate") return { outcome: "duplicate" };

  const newEntry = await tx.timeEntry.create({
    data: {
      jobId,
      personnelId,
      date: new Date(date),
      duration,
      serviceItem: serviceItem || "Field Labor",
      payrollItem: payrollItem || "Regular Pay",
      qbTimeSyncStatus: "Pending",
    },
  });

  await recordResultId(tx, opId, newEntry.id);
  await audit(actor.userId, "CREATE", "TimeEntry", newEntry.id, { jobId, personnelId, date, duration });

  return { outcome: "applied", resultId: newEntry.id };
}

// ---------------------------------------------------------------------------
// Shared assignment check for the three replace-semantics job ops.
// ---------------------------------------------------------------------------

async function authorizeTechForJob(
  tx: PrismaTransactionClient,
  actor: FieldActor,
  jobId: string
): Promise<OpResult | null> {
  if (actor.role !== "tech") return null;
  if (!actor.personnelId) {
    return { outcome: "rejected", status: 403, error: "Your account is not linked to a personnel record" };
  }
  const assignment = await tx.jobAssignment.findFirst({ where: { jobId, personnelId: actor.personnelId } });
  if (!assignment) {
    return { outcome: "rejected", status: 403, error: "You are not assigned to this job" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// setJobNotes — mirrors the notes branch of PUT /api/jobs
// ---------------------------------------------------------------------------

export async function setJobNotes(
  tx: PrismaTransactionClient,
  actor: FieldActor,
  opId: string,
  body: { jobId: string; notes: string }
): Promise<OpResult> {
  const { jobId, notes } = body;

  if (!jobId) {
    return { outcome: "rejected", status: 400, error: "Missing job ID" };
  }

  const authErr = await authorizeTechForJob(tx, actor, jobId);
  if (authErr) return authErr;

  const job = await tx.job.findUnique({ where: { id: jobId } });
  if (!job) return { outcome: "rejected", status: 404, error: "Job not found" };

  const targetKey = targetKeyFor("notes", jobId, opId);
  const recorded = await recordApplied(tx, opId, "notes", targetKey);
  if (recorded === "duplicate") return { outcome: "duplicate" };

  const applies = await checkOrdering(tx, opId, targetKey);
  if (!applies) return { outcome: "superseded" };

  const updated = await tx.job.update({ where: { id: jobId }, data: { notes: notes || null } });

  await recordResultId(tx, opId, updated.id);
  await audit(actor.userId, "UPDATE", "Job", updated.id, { notes });

  return { outcome: "applied", resultId: updated.id };
}

// ---------------------------------------------------------------------------
// setJobLineItems — mirrors the lineItems branch of PUT /api/jobs
// ---------------------------------------------------------------------------

export async function setJobLineItems(
  tx: PrismaTransactionClient,
  actor: FieldActor,
  opId: string,
  body: {
    jobId: string;
    lineItems: Array<{ inventoryItemId: string; quantity: string | number; rate: string | number; description?: string }>;
  }
): Promise<OpResult> {
  const { jobId, lineItems } = body;

  if (!jobId) {
    return { outcome: "rejected", status: 400, error: "Missing job ID" };
  }
  if (!Array.isArray(lineItems)) {
    return { outcome: "rejected", status: 400, error: "lineItems must be an array" };
  }

  const authErr = await authorizeTechForJob(tx, actor, jobId);
  if (authErr) return authErr;

  const job = await tx.job.findUnique({ where: { id: jobId } });
  if (!job) return { outcome: "rejected", status: 404, error: "Job not found" };

  const targetKey = targetKeyFor("lineItems", jobId, opId);
  const recorded = await recordApplied(tx, opId, "lineItems", targetKey);
  if (recorded === "duplicate") return { outcome: "duplicate" };

  const applies = await checkOrdering(tx, opId, targetKey);
  if (!applies) return { outcome: "superseded" };

  await tx.jobLineItem.deleteMany({ where: { jobId } });
  if (lineItems.length > 0) {
    await tx.jobLineItem.createMany({
      data: lineItems.map((li) => ({
        jobId,
        inventoryItemId: li.inventoryItemId,
        quantity: parseInt(String(li.quantity), 10) || 1,
        rate: parseFloat(String(li.rate)) || 0,
        description: li.description || "",
      })),
    });
  }

  await recordResultId(tx, opId, jobId);
  await audit(actor.userId, "UPDATE", "Job", jobId, { lineItems });

  return { outcome: "applied", resultId: jobId };
}

// ---------------------------------------------------------------------------
// setJobStatus — mirrors the status branches of PUT /api/jobs, including
// both stock-deduction blocks (L136-225 of the original route), relocated
// verbatim in logic and adapted to this module's own tx/idempotency wrapper.
// ---------------------------------------------------------------------------

export async function setJobStatus(
  tx: PrismaTransactionClient,
  actor: FieldActor,
  opId: string,
  body: { jobId: string; status: string }
): Promise<OpResult> {
  const { jobId, status } = body;

  if (!jobId) {
    return { outcome: "rejected", status: 400, error: "Missing job ID" };
  }
  if (!status) {
    return { outcome: "rejected", status: 400, error: "Missing status" };
  }

  // Techs may set any status string on a job they're assigned to — no
  // additional status-transition restriction exists in the original route,
  // and none is added here.
  const authErr = await authorizeTechForJob(tx, actor, jobId);
  if (authErr) return authErr;

  const currentJob = await tx.job.findUnique({
    where: { id: jobId },
    include: { lineItems: true },
  });
  if (!currentJob) return { outcome: "rejected", status: 404, error: "Job not found" };

  const targetKey = targetKeyFor("status", jobId, opId);
  const recorded = await recordApplied(tx, opId, "status", targetKey);
  if (recorded === "duplicate") return { outcome: "duplicate" };

  const applies = await checkOrdering(tx, opId, targetKey);
  if (!applies) return { outcome: "superseded" };

  let updatedId: string;

  if (currentJob.status === "Completed" && status !== "Completed") {
    // Reopening a Completed job: restore vehicle stock consumed by its line items.
    const updated = await tx.job.update({
      where: { id: jobId },
      data: { status, completionDate: null },
    });

    if (currentJob.assignedVehicleId) {
      const vehicleStockLocation = await tx.stockLocation.findUnique({
        where: { vehicleId: currentJob.assignedVehicleId },
      });

      if (vehicleStockLocation) {
        for (const item of currentJob.lineItems) {
          const stockLevel = await tx.stockLevel.findUnique({
            where: {
              inventoryItemId_stockLocationId: {
                inventoryItemId: item.inventoryItemId,
                stockLocationId: vehicleStockLocation.id,
              },
            },
          });

          if (stockLevel) {
            await tx.stockLevel.update({
              where: { id: stockLevel.id },
              data: { quantity: { increment: item.quantity } },
            });
          }
        }
      }
    }

    updatedId = updated.id;
  } else if (status === "Completed" && currentJob.status !== "Completed") {
    // Completing a job: deduct vehicle stock for its line items.
    const updated = await tx.job.update({
      where: { id: jobId },
      data: { status: "Completed", completionDate: new Date() },
    });

    if (currentJob.assignedVehicleId) {
      const vehicleStockLocation = await tx.stockLocation.findUnique({
        where: { vehicleId: currentJob.assignedVehicleId },
      });

      if (vehicleStockLocation) {
        for (const item of currentJob.lineItems) {
          const stockLevel = await tx.stockLevel.findUnique({
            where: {
              inventoryItemId_stockLocationId: {
                inventoryItemId: item.inventoryItemId,
                stockLocationId: vehicleStockLocation.id,
              },
            },
          });

          if (stockLevel) {
            await tx.stockLevel.update({
              where: { id: stockLevel.id },
              data: { quantity: { decrement: item.quantity } },
            });
          } else {
            await tx.stockLevel.create({
              data: {
                inventoryItemId: item.inventoryItemId,
                stockLocationId: vehicleStockLocation.id,
                quantity: -item.quantity,
                minThreshold: 0,
              },
            });
          }
        }
      }
    }

    updatedId = updated.id;
  } else {
    // Plain status change (e.g. Scheduled -> In Progress), no stock effect.
    const updated = await tx.job.update({ where: { id: jobId }, data: { status } });
    updatedId = updated.id;
  }

  await recordResultId(tx, opId, updatedId);
  await audit(actor.userId, "UPDATE", "Job", updatedId, { status });

  return { outcome: "applied", resultId: updatedId };
}

// ---------------------------------------------------------------------------
// classifyOpForImport — read-only preview for the file-recovery import
// (Phase 5). Reuses targetKeyFor/shouldApply exactly as the appliers above
// do, but performs no writes at all — safe to call repeatedly while an admin
// previews an import file before committing to it.
// ---------------------------------------------------------------------------

export type OpClassification = "new" | "duplicate" | "superseded";

/** Either a PrismaClient or an open Prisma.TransactionClient — this only reads. */
type ReadableClient = {
  appliedOp: {
    findUnique: (args: { where: { opId: string } }) => Promise<{ opId: string } | null>;
    findFirst: (args: {
      where: { targetKey: string; outcome: string; opId: { not: string } };
      orderBy: { opId: "desc" };
    }) => Promise<{ opId: string } | null>;
  };
};

/**
 * Classifies what would happen if this op were applied right now, without
 * applying it. Mirrors the idempotency/ordering checks the four appliers
 * above perform (AppliedOp primary key for duplicates, targetKeyFor +
 * shouldApply for replace-semantics ordering), but as pure reads.
 *
 * "time" is insert semantics (see opOrdering.ts) — a non-duplicate time op is
 * always "new", with no ordering check, exactly as logTime itself has none.
 */
export async function classifyOpForImport(
  client: ReadableClient,
  opType: FieldOpType,
  jobId: string,
  opId: string
): Promise<OpClassification> {
  const targetKey = targetKeyFor(opType, jobId, opId);

  const existing = await client.appliedOp.findUnique({ where: { opId } });
  if (existing) return "duplicate";

  if (opType === "time") return "new";

  const prior = await client.appliedOp.findFirst({
    where: { targetKey, outcome: "applied", opId: { not: opId } },
    orderBy: { opId: "desc" },
  });
  return shouldApply(opId, prior?.opId ?? null) ? "new" : "superseded";
}
