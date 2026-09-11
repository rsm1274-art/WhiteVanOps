import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { allGroups, fieldsForRole } from "@/lib/reports/registry";
import { manyEdgeKeys } from "@/lib/reports/graph";

// Serves the report builder's field catalog, filtered to the caller's role
// server-side — the catalog must never be bundled client-side, or the role
// filter would be trivially bypassable by reading the JS bundle.

export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  return NextResponse.json({
    fields: fieldsForRole(user!.role),
    groups: allGroups(),
    expandableRelations: manyEdgeKeys(),
  });
}
