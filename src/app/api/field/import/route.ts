import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { verifyExport, type FieldExport, type ExportedOp } from "@/lib/fieldExport";
import { parseRecordedRequest } from "@/lib/recordedRequest";
import {
  logTime,
  setJobNotes,
  setJobLineItems,
  setJobStatus,
  classifyOpForImport,
  type FieldActor,
  type OpResult,
  type OpOutcome,
} from "@/lib/fieldOps";

/**
 * Admin-facing recovery import for a field-work export file (Phase 5).
 *
 * This is a desktop/admin tool, not a field-tech action — gated to
 * admin/superuser, unlike the tech-facing /api/field/ops route.
 *
 * Two modes, chosen by the request body:
 *   - "preview": read-only. Classifies every op (new/duplicate/superseded/
 *     invalid) without writing anything, so an admin can safely re-run it.
 *   - "apply": writes. Processes ops STRICTLY SEQUENTIALLY, one fresh
 *     prisma.$transaction call per op — never a shared outer transaction —
 *     because a caught P2002 duplicate poisons the rest of that Postgres
 *     transaction (see the comment block at the top of fieldOps.ts).
 *
 * The client already validates the file locally with verifyExport before
 * ever showing a preview, but that is never trusted alone here: this route
 * calls verifyExport again server-side, first, in both modes.
 */

type ImportBody = { mode?: unknown; export?: unknown };

type ClassificationDetail = {
  opId: string;
  opType: string | null;
  jobId: string;
  jobLabel: string | null;
  classification: "new" | "duplicate" | "superseded" | "invalid";
  reason?: string;
};

function sortByOpId(ops: ExportedOp[]): ExportedOp[] {
  return [...ops].sort((a, b) => (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
}

async function buildJobLabelLookup(jobIds: Set<string>): Promise<Map<string, string | null>> {
  const labels = new Map<string, string | null>();
  for (const jobId of jobIds) {
    if (labels.has(jobId)) continue;
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true },
    });
    labels.set(jobId, job ? `${job.client?.name ?? "Unknown client"} — ${jobId}` : null);
  }
  return labels;
}

async function runPreview(exp: FieldExport): Promise<{ classifications: ClassificationDetail[] }> {
  const ops = sortByOpId(exp.ops);

  const jobIds = new Set<string>();
  const parsedByOpId = new Map<string, ReturnType<typeof parseRecordedRequest>>();
  for (const op of ops) {
    const parsed = parseRecordedRequest({ url: op.url, method: op.method, body: op.body });
    parsedByOpId.set(op.opId, parsed);
    if (parsed) jobIds.add(parsed.jobId);
  }
  const jobLabels = await buildJobLabelLookup(jobIds);

  const classifications: ClassificationDetail[] = [];
  for (const op of ops) {
    const parsed = parsedByOpId.get(op.opId);
    if (!parsed) {
      classifications.push({
        opId: op.opId,
        opType: null,
        jobId: "",
        jobLabel: null,
        classification: "invalid",
        reason: "Could not parse this record as a known field operation.",
      });
      continue;
    }

    const jobLabel = jobLabels.get(parsed.jobId) ?? null;
    if (jobLabel === null) {
      classifications.push({
        opId: op.opId,
        opType: parsed.opType,
        jobId: parsed.jobId,
        jobLabel: null,
        classification: "invalid",
        reason: "The job this operation refers to no longer exists.",
      });
      continue;
    }

    // Read-only: no $transaction, no .create/.update/.delete anywhere below.
    const classification = await classifyOpForImport(prisma, parsed.opType, parsed.jobId, op.opId);
    classifications.push({
      opId: op.opId,
      opType: parsed.opType,
      jobId: parsed.jobId,
      jobLabel,
      classification,
    });
  }

  return { classifications };
}

async function runApply(
  exp: FieldExport,
  actor: FieldActor
): Promise<{ tally: Record<OpOutcome | "invalid", number>; details: Array<{ opId: string; outcome: OpOutcome | "invalid"; error?: string }> }> {
  const ops = sortByOpId(exp.ops);

  const tally: Record<OpOutcome | "invalid", number> = {
    applied: 0,
    superseded: 0,
    duplicate: 0,
    rejected: 0,
    invalid: 0,
  };
  const details: Array<{ opId: string; outcome: OpOutcome | "invalid"; error?: string }> = [];

  // Strictly sequential — not Promise.all — so replace-semantics ordering
  // (notes/lineItems/status) and stock-affecting status transitions land in
  // opId order, and so each op gets its own isolated transaction.
  for (const op of ops) {
    const parsed = parseRecordedRequest({ url: op.url, method: op.method, body: op.body });
    if (!parsed) {
      tally.invalid++;
      details.push({ opId: op.opId, outcome: "invalid", error: "Could not parse this record as a known field operation." });
      continue;
    }

    let result: OpResult;
    try {
      if (parsed.opType === "time") {
        result = await prisma.$transaction((tx) =>
          logTime(tx, actor, op.opId, parsed.body as { jobId: string; personnelId: string; date: string; duration: string; serviceItem?: string; payrollItem?: string })
        );
      } else if (parsed.opType === "notes") {
        result = await prisma.$transaction((tx) =>
          setJobNotes(tx, actor, op.opId, parsed.body as { jobId: string; notes: string })
        );
      } else if (parsed.opType === "lineItems") {
        result = await prisma.$transaction((tx) =>
          setJobLineItems(tx, actor, op.opId, parsed.body as { jobId: string; lineItems: Array<{ inventoryItemId: string; quantity: string | number; rate: string | number; description?: string }> })
        );
      } else {
        result = await prisma.$transaction((tx) =>
          setJobStatus(tx, actor, op.opId, parsed.body as { jobId: string; status: string })
        );
      }
    } catch (error) {
      console.error("Field import: op failed", op.opId, error);
      tally.rejected++;
      details.push({ opId: op.opId, outcome: "rejected", error: "Unexpected error applying this operation." });
      continue;
    }

    if (result.outcome === "rejected") {
      tally.rejected++;
      details.push({ opId: op.opId, outcome: "rejected", error: result.error });
    } else {
      tally[result.outcome]++;
      details.push({ opId: op.opId, outcome: result.outcome });
    }
  }

  return { tally, details };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const roleError = requireRole(user, "admin", "superuser");
  if (roleError) return roleError;

  let body: ImportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== "preview" && mode !== "apply") {
    return NextResponse.json({ error: "mode must be \"preview\" or \"apply\"" }, { status: 400 });
  }

  const verified = verifyExport(body.export);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  if (mode === "preview") {
    const preview = await runPreview(verified.data);
    return NextResponse.json(preview);
  }

  const actor: FieldActor = {
    userId: user!.userId,
    personnelId: null,
    role: user!.role === "superuser" ? "superuser" : "admin",
  };

  const { tally, details } = await runApply(verified.data, actor);

  // AuditLog.entityId is a required column and there is no single entity this
  // import summary belongs to (it may touch many jobs/time entries) — "summary"
  // is a sentinel, mirroring how a bulk operation with no natural id is audited.
  await audit(user!.userId, "CREATE", "FieldImport", "summary", {
    techName: verified.data.techName,
    opCount: verified.data.ops.length,
    tally,
  });

  return NextResponse.json({ tally, details });
}
