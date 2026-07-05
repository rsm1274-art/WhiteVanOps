// Mapping-file types, importable-entity metadata, and mapping validation.
// Pure module: no I/O, no DB.
import { TRANSFORM_NAMES, type TransformName } from "./transforms";
import type { SourceTable } from "./readers";

export type EntityName =
  | "Client" | "Personnel" | "PersonnelQualification" | "Vehicle"
  | "StockLocation" | "Equipment" | "InventoryItem" | "StockLevel"
  | "Job" | "JobAssignment" | "JobEquipment" | "JobLineItem";

export interface FieldMeta {
  required: boolean;
  kind: "string" | "float" | "int" | "date" | "enum";
  enumValues?: readonly string[];
  resolvesTo?: EntityName;
}

export interface EntityMeta {
  insertOrder: number;
  naturalKey?: readonly string[];
  childOfJob?: boolean;
  fields: Record<string, FieldMeta>;
}

export const JOB_IMPORT_STATUSES: readonly string[] = ["Scheduled", "In Progress"];
export const UNRESOLVED = "UNRESOLVED";

export const ENTITY_META: Record<EntityName, EntityMeta> = {
  Client: {
    insertOrder: 1,
    naturalKey: ["name"],
    fields: {
      name: { required: true, kind: "string" },
      contactName: { required: true, kind: "string" },
      locationAddress: { required: true, kind: "string" },
      paymentTerms: { required: true, kind: "string" },
    },
  },
  Personnel: {
    insertOrder: 2,
    naturalKey: ["firstName", "lastName"],
    fields: {
      firstName: { required: true, kind: "string" },
      lastName: { required: true, kind: "string" },
      role: { required: true, kind: "string" },
      certifications: { required: false, kind: "string" },
    },
  },
  PersonnelQualification: {
    insertOrder: 3,
    fields: {
      personnelId: { required: true, kind: "string", resolvesTo: "Personnel" },
      tag: { required: true, kind: "string" },
      category: { required: true, kind: "enum", enumValues: ["Certification", "License", "Skill", "Other"] },
      issuedBy: { required: false, kind: "string" },
      expiresAt: { required: false, kind: "date" },
      notes: { required: false, kind: "string" },
    },
  },
  Vehicle: {
    insertOrder: 4,
    naturalKey: ["vin"],
    fields: {
      vin: { required: true, kind: "string" },
      make: { required: true, kind: "string" },
      model: { required: true, kind: "string" },
      status: { required: true, kind: "enum", enumValues: ["Active", "In Maintenance", "Retired"] },
    },
  },
  StockLocation: {
    insertOrder: 5,
    naturalKey: ["name"],
    fields: {
      name: { required: true, kind: "string" },
      // Vehicle stock locations are auto-created from Vehicle rows; only
      // warehouses are imported directly.
      type: { required: true, kind: "enum", enumValues: ["Warehouse"] },
    },
  },
  Equipment: {
    insertOrder: 6,
    naturalKey: ["serialNumber"],
    fields: {
      name: { required: true, kind: "string" },
      serialNumber: { required: true, kind: "string" },
      status: { required: true, kind: "enum", enumValues: ["Active", "In Use", "Maintenance"] },
    },
  },
  InventoryItem: {
    insertOrder: 7,
    naturalKey: ["name"],
    fields: {
      name: { required: true, kind: "string" },
      category: { required: true, kind: "string" },
      subCategory: { required: true, kind: "string" },
      defaultRate: { required: true, kind: "float" },
    },
  },
  StockLevel: {
    insertOrder: 8,
    naturalKey: ["inventoryItemId", "stockLocationId"],
    fields: {
      inventoryItemId: { required: true, kind: "string", resolvesTo: "InventoryItem" },
      stockLocationId: { required: true, kind: "string", resolvesTo: "StockLocation" },
      quantity: { required: true, kind: "int" },
      minThreshold: { required: true, kind: "int" },
    },
  },
  Job: {
    insertOrder: 9,
    fields: {
      clientId: { required: true, kind: "string", resolvesTo: "Client" },
      assignedVehicleId: { required: false, kind: "string", resolvesTo: "Vehicle" },
      status: { required: true, kind: "enum", enumValues: ["Scheduled", "In Progress", "Completed", "Cancelled"] },
      scheduledDate: { required: true, kind: "date" },
      notes: { required: false, kind: "string" },
    },
  },
  JobAssignment: {
    insertOrder: 10,
    childOfJob: true,
    fields: {
      jobId: { required: true, kind: "string", resolvesTo: "Job" },
      personnelId: { required: true, kind: "string", resolvesTo: "Personnel" },
    },
  },
  JobEquipment: {
    insertOrder: 11,
    childOfJob: true,
    fields: {
      jobId: { required: true, kind: "string", resolvesTo: "Job" },
      equipmentId: { required: true, kind: "string", resolvesTo: "Equipment" },
    },
  },
  JobLineItem: {
    insertOrder: 12,
    childOfJob: true,
    fields: {
      jobId: { required: true, kind: "string", resolvesTo: "Job" },
      inventoryItemId: { required: true, kind: "string", resolvesTo: "InventoryItem" },
      quantity: { required: true, kind: "int" },
      rate: { required: true, kind: "float" },
      description: { required: true, kind: "string" },
    },
  },
};

export interface ColumnMapping {
  field?: string;
  role?: "sourceKey";
  transform?: TransformName;
  resolveBy?: string;
  confidence?: "low";
}

export interface FileMapping {
  file: string;
  sheet?: string;
  entity: EntityName;
  headerRow: number;
  columns: Record<string, ColumnMapping>;
  defaults?: Record<string, string>;
  unmapped: string[];
  unresolved: string[];
}

export interface Mapping {
  version: 1;
  files: FileMapping[];
  valueMaps?: Record<string, Record<string, string>>;
  unrecognized?: string[];
}

const label = (fm: { file: string; sheet?: string }) => `${fm.file}${fm.sheet ? `#${fm.sheet}` : ""}`;

export function validateMappingShape(mapping: Mapping): string[] {
  const errors: string[] = [];
  if (mapping.version !== 1) errors.push(`unsupported mapping version: ${mapping.version}`);
  const hasJobChildren = mapping.files.some((f) => ENTITY_META[f.entity]?.childOfJob);
  for (const fm of mapping.files) {
    const where = label(fm);
    const meta = ENTITY_META[fm.entity];
    if (!meta) {
      errors.push(`${where}: unknown entity "${fm.entity}"`);
      continue;
    }
    if (fm.unresolved.length > 0) {
      errors.push(`${where}: unresolved required fields: ${fm.unresolved.join(", ")} — map a column or add a default`);
    }
    const covered = new Set<string>(Object.keys(fm.defaults ?? {}));
    let hasSourceKey = false;
    for (const [header, cm] of Object.entries(fm.columns)) {
      if (cm.role === "sourceKey") {
        if (fm.entity !== "Job") errors.push(`${where}: sourceKey role is only valid on Job sheets ("${header}")`);
        hasSourceKey = true;
        continue;
      }
      if (!cm.field) {
        errors.push(`${where}: column "${header}" has neither field nor role`);
        continue;
      }
      const f = meta.fields[cm.field];
      if (!f) {
        errors.push(`${where}: "${header}" maps to unknown field ${fm.entity}.${cm.field}`);
        continue;
      }
      if (cm.transform && !TRANSFORM_NAMES.includes(cm.transform)) {
        errors.push(`${where}: unknown transform "${cm.transform}" on "${header}"`);
      }
      if (f.resolvesTo && cm.resolveBy) {
        const expected =
          f.resolvesTo === "Job"
            ? "Job.sourceKey"
            : `${f.resolvesTo}.${(ENTITY_META[f.resolvesTo].naturalKey ?? []).join("+")}`;
        if (cm.resolveBy !== expected) errors.push(`${where}: "${header}" resolveBy must be "${expected}"`);
      }
      covered.add(cm.field);
    }
    for (const [field, f] of Object.entries(meta.fields)) {
      if (f.required && !covered.has(field)) {
        errors.push(`${where}: required field ${fm.entity}.${field} has no column and no default`);
      }
    }
    for (const field of Object.keys(fm.defaults ?? {})) {
      if (!meta.fields[field]) errors.push(`${where}: default for unknown field ${fm.entity}.${field}`);
    }
    if (fm.entity === "Job" && hasJobChildren && !hasSourceKey) {
      errors.push(`${where}: Job sheet needs a sourceKey column because child sheets (assignments/equipment/line items) exist`);
    }
  }
  for (const [target, map] of Object.entries(mapping.valueMaps ?? {})) {
    const [entity, field] = target.split(".") as [EntityName, string];
    const f = ENTITY_META[entity]?.fields?.[field];
    if (!f) {
      errors.push(`valueMaps: unknown target "${target}"`);
      continue;
    }
    for (const [from, to] of Object.entries(map)) {
      if (to === UNRESOLVED) errors.push(`valueMaps ${target}: "${from}" is UNRESOLVED — pick a target value`);
      else if (f.kind === "enum" && !f.enumValues!.includes(to)) {
        errors.push(`valueMaps ${target}: "${from}" -> "${to}" is not one of ${f.enumValues!.join(", ")}`);
      }
    }
  }
  return errors;
}

export function findTable(tables: SourceTable[], fm: { file: string; sheet?: string }): SourceTable | undefined {
  return tables.find((t) => t.file === fm.file && (fm.sheet === undefined || t.sheet === fm.sheet));
}

export function validateMappingAgainstTables(mapping: Mapping, tables: SourceTable[]): string[] {
  const errors: string[] = [];
  for (const fm of mapping.files) {
    const table = findTable(tables, fm);
    if (!table) {
      errors.push(`${label(fm)}: file/sheet not found in the data directory`);
      continue;
    }
    for (const header of Object.keys(fm.columns)) {
      if (!table.headers.includes(header)) {
        errors.push(`${label(fm)}: column "${header}" not found (headers: ${table.headers.join(", ")})`);
      }
    }
  }
  return errors;
}
