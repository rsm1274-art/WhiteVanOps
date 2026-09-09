// Permission predicates for saved reports. Pure module: no I/O, no DB.
//
// A single gate used by every reports route (list/get/run/export, Phase 1+), mirroring
// the canRespondToQuote() precedent in src/lib/quote.ts, so the sharing rule cannot
// drift between routes. The SavedReport/ReportFolder Prisma models land in Phase 3;
// these shapes describe only the fields permission checks need, so this module has
// nothing to import from a not-yet-existing schema.

import type { UserRole } from "@/types";
import { getField } from "./registry";
import type { ReportDefinition } from "./types";

export interface PermissionUser {
  userId: string;
  role: UserRole;
}

export interface ReportFolderRef {
  isPublic: boolean;
}

export interface SavedReportRef {
  createdById: string | null;
  isShared: boolean;
  folder?: ReportFolderRef | null;
}

const EDITOR_ROLES: readonly UserRole[] = ["admin", "superuser"];

/** Creator, or anyone if the report itself is shared, or anyone if its folder is public. */
export function canViewReport(user: PermissionUser, report: SavedReportRef): boolean {
  if (report.createdById === user.userId) return true;
  if (report.isShared) return true;
  if (report.folder?.isPublic) return true;
  return false;
}

/**
 * Creator, or admin/superuser. An orphaned report (creator account deleted —
 * createdById goes null via onDelete: SetNull) falls back to admin-only editing,
 * which EDITOR_ROLES already covers without special-casing null.
 */
export function canEditReport(user: PermissionUser, report: SavedReportRef): boolean {
  if (report.createdById === user.userId) return true;
  return EDITOR_ROLES.includes(user.role);
}

/**
 * Fields in a definition that the given role is not permitted to see. Used to refuse
 * (or strip) a definition someone tries to run with elevated field access baked in —
 * e.g. a report saved by a superuser, reopened by a lower-privileged future role.
 * Currently always empty in practice since every field defaults to admin/superuser
 * visibility (see registry.ts), but the check must exist before any role gets
 * narrower access, not be retrofitted after.
 */
export function forbiddenFieldKeys(definition: ReportDefinition, role: UserRole): string[] {
  const keys = new Set<string>();
  for (const col of definition.columns) keys.add(col.fieldKey);
  for (const group of definition.filters) {
    for (const cond of group.conditions) keys.add(cond.fieldKey);
  }
  for (const sort of definition.sort ?? []) keys.add(sort.fieldKey);

  const forbidden: string[] = [];
  for (const key of keys) {
    const field = getField(key);
    // An unknown key is definition.ts's problem (unknownFieldKeys), not a permission
    // violation — skip rather than double-report it here.
    if (field && !field.requiresRole.includes(role)) forbidden.push(key);
  }
  return forbidden;
}
