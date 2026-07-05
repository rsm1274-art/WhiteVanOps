// Heuristic schema interpretation: propose a Mapping from raw SourceTables.
// Never silently guesses — weak matches get confidence "low", uncovered
// required fields go to unresolved, unknown enum vocab gets UNRESOLVED.
import type { SourceTable } from "./readers";
import {
  ENTITY_META, UNRESOLVED,
  type ColumnMapping, type EntityName, type FileMapping, type Mapping,
} from "./mappingSchema";
import type { TransformName } from "./transforms";
import { applyTransform } from "./transforms";

export interface AnalyzeResult {
  mapping: Mapping;
  notes: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Normalized header synonyms per entity field.
const FIELD_SYNONYMS: Partial<Record<EntityName, Record<string, string[]>>> = {
  Client: {
    name: ["customer", "client", "company", "account", "business", "customername", "clientname"],
    contactName: ["contact", "contactperson", "contactname", "attn", "attention"],
    locationAddress: ["address", "location", "site", "serviceaddress", "street", "siteaddress"],
    paymentTerms: ["terms", "paymentterms", "netterms"],
  },
  Personnel: {
    firstName: ["first", "firstname", "fname", "givenname"],
    lastName: ["last", "lastname", "lname", "surname"],
    role: ["role", "title", "position", "jobtitle"],
    certifications: ["certs", "certifications", "licenses", "qualifications"],
  },
  PersonnelQualification: {
    personnelId: ["tech", "technician", "employee", "person", "name", "personnel"],
    tag: ["tag", "qualification", "cert", "certification", "license", "skill"],
    category: ["category", "type", "kind"],
    issuedBy: ["issuedby", "issuer", "authority"],
    expiresAt: ["expires", "expiration", "expiry", "expiresat", "expirationdate"],
    notes: ["notes", "comments"],
  },
  Vehicle: {
    vin: ["vin", "vinnumber", "vehicleid"],
    make: ["make", "manufacturer", "brand"],
    model: ["model"],
    status: ["status", "state", "condition"],
  },
  StockLocation: {
    name: ["location", "locationname", "warehouse", "name", "site"],
    type: ["type", "kind"],
  },
  Equipment: {
    name: ["equipment", "name", "tool", "asset", "equipmentname", "assetname"],
    serialNumber: ["serial", "serialnumber", "serialno", "sn"],
    status: ["status", "state", "condition"],
  },
  InventoryItem: {
    name: ["item", "itemname", "part", "partname", "product", "name"],
    category: ["category", "type"],
    subCategory: ["subcategory", "subtype", "subgroup"],
    defaultRate: ["rate", "price", "unitprice", "cost", "defaultrate"],
  },
  StockLevel: {
    inventoryItemId: ["item", "itemname", "part", "sku", "product"],
    stockLocationId: ["location", "warehouse", "site", "van"],
    quantity: ["qty", "quantity", "onhand", "count", "stock", "onhandqty"],
    minThreshold: ["min", "minimum", "reorder", "threshold", "minqty", "reorderpoint"],
  },
  Job: {
    clientId: ["customer", "client", "account", "company"],
    assignedVehicleId: ["vehicle", "van", "truck", "vin"],
    status: ["status", "stage", "state"],
    scheduledDate: ["date", "scheduled", "scheduledate", "scheduleddate", "startdate", "duedate", "servicedate"],
    notes: ["notes", "description", "scope", "details", "workdescription"],
  },
  JobAssignment: {
    jobId: ["job", "jobno", "jobnumber", "jobid", "workorder", "wo", "ticket"],
    personnelId: ["tech", "technician", "employee", "person", "assignee", "name", "crew"],
  },
  JobEquipment: {
    jobId: ["job", "jobno", "jobnumber", "jobid", "workorder", "wo", "ticket"],
    equipmentId: ["equipment", "tool", "asset", "serial", "serialnumber"],
  },
  JobLineItem: {
    jobId: ["job", "jobno", "jobnumber", "jobid", "workorder", "wo", "ticket"],
    inventoryItemId: ["item", "part", "sku", "product", "itemname"],
    quantity: ["qty", "quantity"],
    rate: ["rate", "price", "unitprice"],
    description: ["description", "desc", "detail", "lineitem"],
  },
};

const SOURCE_KEY_SYNONYMS = ["job", "jobno", "jobnumber", "jobid", "workorder", "wo", "ticket", "ticketno", "invoiceno"];

// Filename/sheet-name hints. Order matters: more specific patterns first.
const FILENAME_HINTS: [RegExp, EntityName][] = [
  [/client|customer|account/, "Client"],
  [/qualif|cert|license/, "PersonnelQualification"],
  [/personnel|employee|tech|staff|roster/, "Personnel"],
  [/vehicle|van|truck|fleet/, "Vehicle"],
  [/equipment|tool|asset/, "Equipment"],
  [/stocklevel|onhand|stockqty/, "StockLevel"],
  [/inventory|item|part|catalog|price/, "InventoryItem"],
  [/location|warehouse/, "StockLocation"],
  [/assign|crew/, "JobAssignment"],
  [/lineitem|jobitem|invoiceline/, "JobLineItem"],
  [/job|workorder|schedule|ticket/, "Job"],
];

const DEFAULT_SUGGESTIONS: Record<string, string> = {
  "Client.paymentTerms": "Net 30",
  "Personnel.role": "Technician",
  "Vehicle.status": "Active",
  "Equipment.status": "Active",
  "StockLocation.type": "Warehouse",
};

// Common source-vocab -> WhiteVanOps enum translations, keyed by norm(value).
const COMMON_ENUM_MAPS: Record<string, Record<string, string>> = {
  "Job.status": {
    open: "Scheduled", scheduled: "Scheduled", pending: "Scheduled", booked: "Scheduled", new: "Scheduled",
    inprogress: "In Progress", wip: "In Progress", started: "In Progress", working: "In Progress", dispatched: "In Progress",
    complete: "Completed", completed: "Completed", done: "Completed", closed: "Completed", finished: "Completed", invoiced: "Completed",
    cancelled: "Cancelled", canceled: "Cancelled", void: "Cancelled",
  },
  "Vehicle.status": {
    active: "Active", available: "Active", inservice: "Active",
    maintenance: "In Maintenance", inmaintenance: "In Maintenance", shop: "In Maintenance", repair: "In Maintenance",
    retired: "Retired", sold: "Retired", inactive: "Retired",
  },
  "Equipment.status": {
    active: "Active", available: "Active",
    inuse: "In Use", checkedout: "In Use", assigned: "In Use",
    maintenance: "Maintenance", repair: "Maintenance", broken: "Maintenance",
  },
  "PersonnelQualification.category": {
    certification: "Certification", cert: "Certification",
    license: "License", skill: "Skill", other: "Other",
  },
};

const tableLabel = (t: SourceTable) => `${t.file}${t.sheet ? `#${t.sheet}` : ""}`;

function findHeaderForField(headers: string[], entity: EntityName, field: string): string | undefined {
  const syns = new Set([norm(field), ...(FIELD_SYNONYMS[entity]?.[field] ?? [])]);
  return headers.find((h) => syns.has(norm(h)));
}

function scoreEntity(table: SourceTable, entity: EntityName): { score: number; matched: number } {
  let matched = 0;
  for (const field of Object.keys(ENTITY_META[entity].fields)) {
    if (findHeaderForField(table.headers, entity, field)) matched++;
  }
  const base = norm(`${table.file.replace(/\.(csv|xlsx)$/i, "")} ${table.sheet ?? ""}`);
  const hint = FILENAME_HINTS.find(([re]) => re.test(base));
  return { score: matched + (hint && hint[1] === entity ? 2 : 0), matched };
}

function columnValues(table: SourceTable, header: string): string[] {
  return table.rows.map((r) => r.values[header] ?? "").filter((v) => v !== "");
}

function detectDateTransform(values: string[]): { transform: TransformName; ambiguous: boolean } | null {
  if (values.length === 0) return null;
  if (values.every((v) => applyTransform("date-iso", v).ok)) return { transform: "date-iso", ambiguous: false };
  const parts = values.map((v) => v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/));
  if (parts.some((m) => !m)) return null;
  if (parts.some((m) => +m![1] > 12)) return { transform: "date-dmy", ambiguous: false };
  if (parts.some((m) => +m![2] > 12)) return { transform: "date-mdy", ambiguous: false };
  return { transform: "date-mdy", ambiguous: true };
}

function transformForField(
  entity: EntityName, field: string, table: SourceTable, header: string, notes: string[]
): Pick<ColumnMapping, "transform" | "confidence"> {
  const kind = ENTITY_META[entity].fields[field].kind;
  if (kind === "date") {
    const d = detectDateTransform(columnValues(table, header));
    if (!d) return {};
    if (d.ambiguous) {
      notes.push(`${tableLabel(table)} "${header}": date format ambiguous (all values fit M/D/Y and D/M/Y) — assumed date-mdy, verify`);
      return { transform: d.transform, confidence: "low" };
    }
    return { transform: d.transform };
  }
  if (kind === "float") return { transform: "currency" };
  if (kind === "int") return { transform: "int" };
  return {};
}

function resolveByFor(entity: EntityName, field: string): string | undefined {
  const target = ENTITY_META[entity].fields[field].resolvesTo;
  if (!target) return undefined;
  if (target === "Job") return "Job.sourceKey";
  return `${target}.${(ENTITY_META[target].naturalKey ?? []).join("+")}`;
}

function buildFileMapping(table: SourceTable, entity: EntityName, mapping: Mapping, notes: string[]): FileMapping {
  const meta = ENTITY_META[entity];
  const columns: Record<string, ColumnMapping> = {};
  const used = new Set<string>();

  if (entity === "Job") {
    const sk = table.headers.find((h) => SOURCE_KEY_SYNONYMS.includes(norm(h)));
    if (sk) {
      columns[sk] = { role: "sourceKey" };
      used.add(sk);
    }
  }

  for (const field of Object.keys(meta.fields)) {
    const header = findHeaderForField(table.headers.filter((h) => !used.has(h)), entity, field);
    if (!header) continue;
    used.add(header);
    columns[header] = {
      field,
      ...transformForField(entity, field, table, header, notes),
      ...(resolveByFor(entity, field) ? { resolveBy: resolveByFor(entity, field) } : {}),
    };
  }

  // Value-shape fallback: an unclaimed date-shaped column can cover an
  // uncovered date field (low confidence).
  const coveredFields = new Set(Object.values(columns).map((c) => c.field).filter(Boolean) as string[]);
  for (const [field, f] of Object.entries(meta.fields)) {
    if (f.kind !== "date" || coveredFields.has(field)) continue;
    const header = table.headers.find((h) => !used.has(h) && detectDateTransform(columnValues(table, h)) !== null);
    if (!header) continue;
    used.add(header);
    coveredFields.add(field);
    const d = detectDateTransform(columnValues(table, header))!;
    columns[header] = { field, transform: d.transform, confidence: "low" };
    notes.push(`${tableLabel(table)} "${header}": matched ${entity}.${field} by value shape only — verify`);
  }

  const defaults: Record<string, string> = {};
  const unresolved: string[] = [];
  for (const [field, f] of Object.entries(meta.fields)) {
    if (!f.required || coveredFields.has(field)) continue;
    if (f.resolvesTo) {
      unresolved.push(field);
      continue;
    }
    const suggestion = DEFAULT_SUGGESTIONS[`${entity}.${field}`];
    if (suggestion !== undefined) defaults[field] = suggestion;
    else unresolved.push(field);
  }

  // Propose valueMaps for enum columns whose values are outside the vocab.
  for (const [header, cm] of Object.entries(columns)) {
    if (!cm.field) continue;
    const f = meta.fields[cm.field];
    if (f.kind !== "enum") continue;
    const target = `${entity}.${cm.field}`;
    for (const value of new Set(columnValues(table, header))) {
      if (f.enumValues!.includes(value)) continue;
      const guess = COMMON_ENUM_MAPS[target]?.[norm(value)];
      mapping.valueMaps ??= {};
      mapping.valueMaps[target] ??= {};
      if (mapping.valueMaps[target][value] !== undefined) continue;
      mapping.valueMaps[target][value] = guess ?? UNRESOLVED;
      if (!guess) notes.push(`${tableLabel(table)} "${header}": unknown ${target} value "${value}" — fill in valueMaps`);
    }
  }

  return {
    file: table.file,
    ...(table.sheet ? { sheet: table.sheet } : {}),
    entity,
    headerRow: 1,
    columns,
    ...(Object.keys(defaults).length ? { defaults } : {}),
    unmapped: table.headers.filter((h) => !used.has(h)),
    unresolved,
  };
}

export function buildMappingProposal(tables: SourceTable[]): AnalyzeResult {
  const notes: string[] = [];
  const mapping: Mapping = { version: 1, files: [], unrecognized: [] };
  for (const table of tables) {
    let best: EntityName | null = null;
    let bestScore = 0;
    for (const entity of Object.keys(ENTITY_META) as EntityName[]) {
      const { score, matched } = scoreEntity(table, entity);
      if (matched >= 1 && score >= 2 && score > bestScore) {
        best = entity;
        bestScore = score;
      }
    }
    if (!best) {
      mapping.unrecognized!.push(tableLabel(table));
      notes.push(`could not recognize ${tableLabel(table)} as any entity — add it to mapping.json by hand if needed`);
      continue;
    }
    mapping.files.push(buildFileMapping(table, best, mapping, notes));
  }
  mapping.files.sort((a, b) => ENTITY_META[a.entity].insertOrder - ENTITY_META[b.entity].insertOrder);
  if (mapping.unrecognized!.length === 0) delete mapping.unrecognized;
  return { mapping, notes };
}
