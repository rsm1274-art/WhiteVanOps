// Field whitelist for the report builder. Pure module: no I/O, no DB.
//
// This is the report builder's entire injection defence: a ReportDefinition never
// carries a raw column/table name, only a `key` that must resolve here. Nothing
// outside this file may construct a FieldDef.
//
// Deliberate v1 exclusions (do not add without re-reading the plan's rationale —
// docs/superpowers/plans/2026-09-09-report-builder-plus.md, Phase 0 step 2):
//   - User.passwordHash, User.failedLoginAttempts, User.lockedUntil
//   - AuditLog.* — audit trail, not report data.
//   - SyncReviewItem.body — raw queued request payloads.
//   - License.* — licensing internals.
//   - MaintenanceLog, RepairRecord — hang off Vehicle/Equipment directly, not off
//     Job, so they are unreachable from the Job-rooted graph.ts in v1. (The plan
//     doc uses MaintenanceLog.cost and RepairRecord.servicePhone as *examples* of
//     what "sensitivity" tagging looks like; neither is wired into a graph edge
//     yet, so neither can appear in the registry until a Vehicle/Equipment root
//     or an additional edge is added — a v2 concern, not this session's.)
//
// requiresRole is currently `["admin", "superuser"]` on every field: only those two
// roles can reach the dashboard at all today, and there is no pay-rate column in the
// schema, so the role check does not yet discriminate anything. Its value is
// existing *before* a pay-rate column or a read-only office role is added — see
// Open Question 6 in the plan doc. Do not treat requiresRole as a live restriction.

import type { FieldDef, FieldSensitivity } from "./types";
import type { UserRole } from "@/types";

const DEFAULT_ROLES: readonly UserRole[] = ["admin", "superuser"];

/** Sugar for the common case: everything but sensitivity and requiresRole are explicit. */
function field(def: Omit<FieldDef, "sensitivity" | "requiresRole"> & { sensitivity?: FieldSensitivity; requiresRole?: readonly UserRole[] }): FieldDef {
  return {
    sensitivity: def.sensitivity ?? "normal",
    requiresRole: def.requiresRole ?? DEFAULT_ROLES,
    ...def,
  };
}

export const REGISTRY: readonly FieldDef[] = [
  // --- Job (root, path: []) ------------------------------------------------
  field({
    key: "job.status",
    label: "Job Status",
    group: "Job",
    type: "enum",
    enumValues: ["Scheduled", "In Progress", "Completed", "Cancelled"],
    source: { entity: "job", column: "status" },
    path: { edges: [] },
    operators: ["eq", "neq", "in"],
    cardinality: "one",
  }),
  field({
    key: "job.scheduledDate",
    label: "Scheduled Date",
    group: "Job",
    type: "date",
    source: { entity: "job", column: "scheduledDate" },
    path: { edges: [] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "one",
  }),
  field({
    key: "job.completionDate",
    label: "Completion Date",
    group: "Job",
    type: "date",
    source: { entity: "job", column: "completionDate" },
    path: { edges: [] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between", "isNull", "isNotNull"],
    cardinality: "one",
  }),
  field({
    key: "job.notes",
    label: "Job Notes",
    group: "Job",
    type: "string",
    source: { entity: "job", column: "notes" },
    path: { edges: [] },
    operators: ["contains", "isNull", "isNotNull"],
    cardinality: "one",
  }),
  field({
    key: "job.qbInvoiceSyncStatus",
    label: "QuickBooks Sync Status",
    group: "Job",
    type: "enum",
    enumValues: ["Pending", "Exported"],
    source: { entity: "job", column: "qbInvoiceSyncStatus" },
    path: { edges: [] },
    operators: ["eq", "neq"],
    cardinality: "one",
  }),
  field({
    key: "job.createdAt",
    label: "Job Created",
    group: "Job",
    type: "date",
    source: { entity: "job", column: "createdAt" },
    path: { edges: [] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "one",
  }),

  // --- Client (path: ["client"]) --------------------------------------------
  field({
    key: "client.name",
    label: "Client Name",
    group: "Client",
    type: "string",
    source: { entity: "client", column: "name" },
    path: { edges: ["client"] },
    operators: ["eq", "contains"],
    cardinality: "one",
    linkTo: { target: "client", idField: "client.id" },
  }),
  field({
    key: "client.contactName",
    label: "Client Contact",
    group: "Client",
    type: "string",
    source: { entity: "client", column: "contactName" },
    path: { edges: ["client"] },
    operators: ["eq", "contains"],
    cardinality: "one",
    sensitivity: "pii",
  }),
  field({
    key: "client.locationAddress",
    label: "Client Address",
    group: "Client",
    type: "string",
    source: { entity: "client", column: "locationAddress" },
    path: { edges: ["client"] },
    operators: ["contains"],
    cardinality: "one",
    sensitivity: "pii",
  }),
  field({
    key: "client.paymentTerms",
    label: "Payment Terms",
    group: "Client",
    type: "string",
    source: { entity: "client", column: "paymentTerms" },
    path: { edges: ["client"] },
    operators: ["eq"],
    cardinality: "one",
  }),

  // --- Vehicle (path: ["vehicle"]) -------------------------------------------
  field({
    key: "vehicle.vin",
    label: "Vehicle VIN",
    group: "Vehicle",
    type: "string",
    source: { entity: "vehicle", column: "vin" },
    path: { edges: ["vehicle"] },
    operators: ["eq", "contains"],
    cardinality: "one",
  }),
  field({
    key: "vehicle.make",
    label: "Vehicle Make",
    group: "Vehicle",
    type: "string",
    source: { entity: "vehicle", column: "make" },
    path: { edges: ["vehicle"] },
    operators: ["eq", "contains"],
    cardinality: "one",
  }),
  field({
    key: "vehicle.model",
    label: "Vehicle Model",
    group: "Vehicle",
    type: "string",
    source: { entity: "vehicle", column: "model" },
    path: { edges: ["vehicle"] },
    operators: ["eq", "contains"],
    cardinality: "one",
  }),
  field({
    key: "vehicle.status",
    label: "Vehicle Status",
    group: "Vehicle",
    type: "enum",
    enumValues: ["Active", "In Maintenance", "Retired"],
    source: { entity: "vehicle", column: "status" },
    path: { edges: ["vehicle"] },
    operators: ["eq", "neq"],
    cardinality: "one",
  }),

  // --- Technicians (path: ["assignments", "personnel"], many) ----------------
  field({
    key: "personnel.firstName",
    label: "Technician First Name",
    group: "Technicians",
    type: "string",
    source: { entity: "personnel", column: "firstName" },
    path: { edges: ["assignments", "personnel"] },
    operators: ["eq", "contains"],
    cardinality: "many",
  }),
  field({
    key: "personnel.lastName",
    label: "Technician Last Name",
    group: "Technicians",
    type: "string",
    source: { entity: "personnel", column: "lastName" },
    path: { edges: ["assignments", "personnel"] },
    operators: ["eq", "contains"],
    cardinality: "many",
  }),
  field({
    key: "personnel.role",
    label: "Technician Role",
    group: "Technicians",
    type: "string",
    source: { entity: "personnel", column: "role" },
    path: { edges: ["assignments", "personnel"] },
    operators: ["eq"],
    cardinality: "many",
  }),

  // --- Parts & Materials (path: ["lineItems"] / ["lineItems","inventoryItem"], many) --
  field({
    key: "lineItem.quantity",
    label: "Line Item Quantity",
    group: "Parts & Materials",
    type: "number",
    source: { entity: "jobLineItem", column: "quantity" },
    path: { edges: ["lineItems"] },
    operators: ["eq", "gt", "gte", "lt", "lte"],
    cardinality: "many",
  }),
  field({
    key: "lineItem.rate",
    label: "Line Item Rate",
    group: "Parts & Materials",
    type: "number",
    source: { entity: "jobLineItem", column: "rate" },
    path: { edges: ["lineItems"] },
    operators: ["eq", "gt", "gte", "lt", "lte"],
    cardinality: "many",
    sensitivity: "money",
  }),
  field({
    key: "lineItem.description",
    label: "Line Item Description",
    group: "Parts & Materials",
    type: "string",
    source: { entity: "jobLineItem", column: "description" },
    path: { edges: ["lineItems"] },
    operators: ["contains"],
    cardinality: "many",
  }),
  field({
    key: "inventoryItem.name",
    label: "Part / Material Name",
    group: "Parts & Materials",
    type: "string",
    source: { entity: "inventoryItem", column: "name" },
    path: { edges: ["lineItems", "inventoryItem"] },
    operators: ["eq", "contains"],
    cardinality: "many",
  }),
  field({
    key: "inventoryItem.category",
    label: "Part / Material Category",
    group: "Parts & Materials",
    type: "string",
    source: { entity: "inventoryItem", column: "category" },
    path: { edges: ["lineItems", "inventoryItem"] },
    operators: ["eq"],
    cardinality: "many",
  }),
  field({
    key: "inventoryItem.defaultRate",
    label: "Part / Material Default Rate",
    group: "Parts & Materials",
    type: "number",
    source: { entity: "inventoryItem", column: "defaultRate" },
    path: { edges: ["lineItems", "inventoryItem"] },
    operators: ["eq", "gt", "gte", "lt", "lte"],
    cardinality: "many",
    sensitivity: "money",
  }),

  // --- Time (path: ["timeEntries"], many) -------------------------------------
  field({
    key: "timeEntry.date",
    label: "Time Entry Date",
    group: "Time",
    type: "date",
    source: { entity: "timeEntry", column: "date" },
    path: { edges: ["timeEntries"] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "many",
  }),
  field({
    key: "timeEntry.duration",
    label: "Time Entry Duration",
    group: "Time",
    type: "string",
    source: { entity: "timeEntry", column: "duration" },
    path: { edges: ["timeEntries"] },
    operators: ["eq"],
    cardinality: "many",
  }),
  field({
    key: "timeEntry.serviceItem",
    label: "Service Item",
    group: "Time",
    type: "string",
    source: { entity: "timeEntry", column: "serviceItem" },
    path: { edges: ["timeEntries"] },
    operators: ["eq"],
    cardinality: "many",
  }),
  field({
    key: "timeEntry.payrollItem",
    label: "Payroll Item",
    group: "Time",
    type: "string",
    source: { entity: "timeEntry", column: "payrollItem" },
    path: { edges: ["timeEntries"] },
    operators: ["eq"],
    cardinality: "many",
  }),
  field({
    key: "timeEntry.qbTimeSyncStatus",
    label: "Time Entry Sync Status",
    group: "Time",
    type: "enum",
    enumValues: ["Pending", "Exported"],
    source: { entity: "timeEntry", column: "qbTimeSyncStatus" },
    path: { edges: ["timeEntries"] },
    operators: ["eq", "neq"],
    cardinality: "many",
  }),

  // --- Equipment (path: ["equipmentAssignments", "equipment"], many) ---------
  field({
    key: "equipment.name",
    label: "Equipment Name",
    group: "Equipment",
    type: "string",
    source: { entity: "equipment", column: "name" },
    path: { edges: ["equipmentAssignments", "equipment"] },
    operators: ["eq", "contains"],
    cardinality: "many",
  }),
  field({
    key: "equipment.serialNumber",
    label: "Equipment Serial Number",
    group: "Equipment",
    type: "string",
    source: { entity: "equipment", column: "serialNumber" },
    path: { edges: ["equipmentAssignments", "equipment"] },
    operators: ["eq"],
    cardinality: "many",
  }),
  field({
    key: "equipment.status",
    label: "Equipment Status",
    group: "Equipment",
    type: "enum",
    enumValues: ["Active", "In Use", "Maintenance"],
    source: { entity: "equipment", column: "status" },
    path: { edges: ["equipmentAssignments", "equipment"] },
    operators: ["eq", "neq"],
    cardinality: "many",
  }),

  // --- Invoicing (path: ["invoices"], many, Plus only) ------------------------
  field({
    key: "invoice.invoiceNumber",
    label: "Invoice Number",
    group: "Invoicing",
    type: "string",
    source: { entity: "invoice", column: "invoiceNumber" },
    path: { edges: ["invoices"] },
    operators: ["eq"],
    cardinality: "many",
    linkTo: { target: "invoice", idField: "invoice.id" },
  }),
  field({
    key: "invoice.status",
    label: "Invoice Status",
    group: "Invoicing",
    type: "enum",
    enumValues: ["Draft", "Sent", "PartiallyPaid", "Paid", "Void"],
    source: { entity: "invoice", column: "status" },
    path: { edges: ["invoices"] },
    operators: ["eq", "neq", "in"],
    cardinality: "many",
  }),
  field({
    key: "invoice.issueDate",
    label: "Invoice Issue Date",
    group: "Invoicing",
    type: "date",
    source: { entity: "invoice", column: "issueDate" },
    path: { edges: ["invoices"] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "many",
  }),
  field({
    key: "invoice.dueDate",
    label: "Invoice Due Date",
    group: "Invoicing",
    type: "date",
    source: { entity: "invoice", column: "dueDate" },
    path: { edges: ["invoices"] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "many",
  }),

  // --- Quotes (path: ["quotes"], many, Plus only) ------------------------------
  field({
    key: "quote.quoteNumber",
    label: "Quote Number",
    group: "Quotes",
    type: "string",
    source: { entity: "quote", column: "quoteNumber" },
    path: { edges: ["quotes"] },
    operators: ["eq"],
    cardinality: "many",
    linkTo: { target: "quote", idField: "quote.id" },
  }),
  field({
    key: "quote.status",
    label: "Quote Status",
    group: "Quotes",
    type: "enum",
    enumValues: ["Draft", "Sent", "Approved", "Declined", "Expired", "Converted"],
    source: { entity: "quote", column: "status" },
    path: { edges: ["quotes"] },
    operators: ["eq", "neq", "in"],
    cardinality: "many",
  }),
  field({
    key: "quote.issueDate",
    label: "Quote Issue Date",
    group: "Quotes",
    type: "date",
    source: { entity: "quote", column: "issueDate" },
    path: { edges: ["quotes"] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "many",
  }),
  field({
    key: "quote.expiryDate",
    label: "Quote Expiry Date",
    group: "Quotes",
    type: "date",
    source: { entity: "quote", column: "expiryDate" },
    path: { edges: ["quotes"] },
    operators: ["eq", "gt", "gte", "lt", "lte", "between"],
    cardinality: "many",
  }),
];

const REGISTRY_BY_KEY: ReadonlyMap<string, FieldDef> = new Map(REGISTRY.map((f) => [f.key, f]));

export function getField(key: string): FieldDef | undefined {
  return REGISTRY_BY_KEY.get(key);
}

/** Fields a given role is permitted to see, in registry order. */
export function fieldsForRole(role: UserRole): readonly FieldDef[] {
  return REGISTRY.filter((f) => f.requiresRole.includes(role));
}

/** Group names in first-appearance registry order, for stable UI ordering. */
export function allGroups(): readonly string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const f of REGISTRY) {
    if (!seen.has(f.group)) {
      seen.add(f.group);
      groups.push(f.group);
    }
  }
  return groups;
}
