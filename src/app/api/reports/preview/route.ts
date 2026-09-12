import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { validateDefinition } from "@/lib/reports/definition";
import { runReport } from "@/lib/reports/run";

// Ad-hoc preview: validates a client-supplied ReportDefinition and runs it
// at a small row cap. Read-only, so no audit() call — audit is for writes.
// POST rather than GET because a definition is far too large for a query
// string.

const PREVIEW_ROW_LIMIT = 200;

export async function POST(req: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateDefinition(body, user!.role);
  if (!validated.ok || !validated.definition) {
    return NextResponse.json({ error: "Invalid report definition", details: validated.errors, unknownFieldKeys: validated.unknownFieldKeys }, { status: 400 });
  }

  try {
    const result = await runReport(validated.definition, { limit: PREVIEW_ROW_LIMIT, offset: 0 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Report preview error:", error);
    return NextResponse.json({ error: "Failed to run report" }, { status: 500 });
  }
}
