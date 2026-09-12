import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { validateDefinition } from "@/lib/reports/definition";
import { canViewReport } from "@/lib/reports/permissions";
import { runReport } from "@/lib/reports/run";

// Runs a SAVED report by id. The body may only override paging/sort — it can
// never replace the stored definition. Executing a client-supplied
// definition under a saved report's identity/permissions would make the
// share/edit model meaningless (anyone who can POST here could read
// anything, dressed up as "running" someone else's report). The stored
// definition is also re-validated on every run, since the field registry
// can shrink between releases (definition drift) — see definition.ts.
//
// The base definition and the sort override are validated separately (not
// merged then validated once) so a bad override 400s as a bad request
// rather than 409ing as if the saved report itself had gone stale — the two
// are different failures and callers need to tell them apart.

const ROW_LIMIT = 200;

const notFound = () => NextResponse.json({ error: "Report not found" }, { status: 404 });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const { id } = await params;
  const report = await prisma.savedReport.findUnique({
    where: { id },
    include: { folder: { select: { isPublic: true } } },
  });
  if (!report || !canViewReport({ userId: user!.userId, role: user!.role }, report)) return notFound();

  const base = validateDefinition(report.definition, user!.role);
  if (!base.ok || !base.definition) {
    return NextResponse.json(
      { error: "This saved report is no longer valid", details: base.errors, unknownFieldKeys: base.unknownFieldKeys },
      { status: 409 }
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { offset, sort } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  let definition = base.definition;
  if (sort !== undefined) {
    const withOverride = validateDefinition({ ...base.definition, sort }, user!.role);
    if (!withOverride.ok || !withOverride.definition) {
      return NextResponse.json({ error: "Invalid sort override", details: withOverride.errors }, { status: 400 });
    }
    definition = withOverride.definition;
  }

  const safeOffset = typeof offset === "number" && Number.isInteger(offset) && offset >= 0 ? offset : 0;

  try {
    const result = await runReport(definition, { limit: ROW_LIMIT, offset: safeOffset });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Report run error:", error);
    return NextResponse.json({ error: "Failed to run report" }, { status: 500 });
  }
}
