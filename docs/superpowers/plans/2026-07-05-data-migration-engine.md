# Data Migration Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-phase onboarding CLI — `analyze` sniffs a customer's CSV/Excel files and proposes a `mapping.json`; after human review, `run` validates, dry-runs, and (with `--commit`) imports master data + open jobs into a fresh WhiteVanOps database in one transaction.

**Architecture:** All logic lives in pure modules under `src/lib/import/` (unit-tested with Vitest); `scripts/import/analyze.ts` and `scripts/import/run.ts` are thin `npx tsx` CLIs. The mapping file is the contract: heuristics propose it, humans fix it, the import executes it deterministically. Spec: `docs/superpowers/specs/2026-07-05-data-migration-engine-design.md`.

**Tech Stack:** TypeScript, tsx, papaparse (CSV), exceljs (Excel), Prisma (`src/lib/db.ts`), Vitest.

## Global Constraints

- `papaparse`, `@types/papaparse`, `exceljs` are **devDependencies** — never runtime deps; the engine is not bundled into the app.
- Modules in `src/lib/import/` use **relative imports only** (no `@/` alias) so `npx tsx scripts/import/*.ts` resolves them without tsconfig-paths support.
- **No imports of `src/lib/db.ts` anywhere in `src/lib/import/`** — `execute.ts` takes the DB as a structural-typed parameter (`ImportDb`). Only `scripts/import/run.ts` touches the real client, via dynamic import after `import "dotenv/config"`.
- Dates are stored exactly like the app's write APIs: normalize to `"YYYY-MM-DD"` strings in the pipeline, `new Date(ymd)` at execute time. Never local-noon-adjust on the write side.
- Vehicle stock locations are auto-created with the exact name format from `src/app/api/fleet/route.ts:31`: `` `Van ${model} (${vin.substring(0, 4)}) Stock` ``.
- No `AuditLog` writes.
- Heuristics never silently guess: weak matches get `"confidence": "low"`, uncovered required fields go to `unresolved`, unknown enum vocab gets valueMap value `"UNRESOLVED"` — and `validateMappingShape` hard-fails on `unresolved`/`UNRESOLVED`.
- Test fixture values stay short and non-secret-shaped (pre-commit `scripts/scan-secrets.js`).
- Run tests with `npx vitest run <file>`; full suite `npm test`; type check `npx tsc --noEmit`.

---

### Task 1: File readers (`readers.ts`) + fixtures + dependencies

**Files:**
- Create: `src/lib/import/readers.ts`
- Create: `src/lib/import/__fixtures__/customers.csv`
- Create: `src/lib/import/__fixtures__/vehicles.csv`
- Create: `src/lib/import/__fixtures__/jobs.csv`
- Test: `src/lib/import/readers.test.ts`
- Modify: `package.json` (devDependencies via npm install)

**Interfaces:**
- Produces: `interface SourceRow { rowNum: number; values: Record<string, string> }`; `interface SourceTable { file: string; sheet?: string; headers: string[]; rows: SourceRow[] }`; `readCsv(filePath: string, headerRow?: number): SourceTable`; `readExcel(filePath: string, headerRow?: number): Promise<SourceTable[]>`; `readDataDir(dir: string, headerRows?: Record<string, number>): Promise<SourceTable[]>`. `rowNum` is the 1-based physical row in the file (header row = `headerRow`, first data row = `headerRow + 1`). All cell values arrive as trimmed strings; Excel date cells become `"YYYY-MM-DD"`.

- [ ] **Step 1: Install dependencies**

```powershell
npm install --save-dev papaparse @types/papaparse exceljs
```

Expected: package.json devDependencies gains all three; `npm install` exits 0.

- [ ] **Step 2: Create fixtures**

`src/lib/import/__fixtures__/customers.csv`:

```csv
Customer,Contact,Address,Terms
Acme Plumbing,Jane Doe,12 Main St,Net 30
Bolt Electric,Sam Lee,9 Oak Ave,Net 15
```

`src/lib/import/__fixtures__/vehicles.csv`:

```csv
VIN,Make,Model,Status
1FTBR3X89PKA55341,Ford,Transit 250,Active
1GCWGBFP4N1234567,Chevrolet,Express,Maintenance
```

`src/lib/import/__fixtures__/jobs.csv`:

```csv
Job #,Customer,Date,Status,Notes
1001,Acme Plumbing,7/10/2026,Open,Quarterly backflow test
1002,Bolt Electric,7/12/2026,Completed,Panel swap
1003,Acme Plumbing,7/15/2026,WIP,Rooftop unit install
```

- [ ] **Step 3: Write the failing test**

`src/lib/import/readers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { readCsv, readExcel, readDataDir } from "./readers";

const FIXTURES = path.join(__dirname, "__fixtures__");

describe("readCsv", () => {
  it("parses headers and rows with 1-based physical row numbers", () => {
    const t = readCsv(path.join(FIXTURES, "customers.csv"));
    expect(t.file).toBe("customers.csv");
    expect(t.headers).toEqual(["Customer", "Contact", "Address", "Terms"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].rowNum).toBe(2);
    expect(t.rows[0].values).toEqual({
      Customer: "Acme Plumbing", Contact: "Jane Doe", Address: "12 Main St", Terms: "Net 30",
    });
  });

  it("handles quoted fields with commas and trims cells", () => {
    const p = path.join(os.tmpdir(), `wvo-readers-${Date.now()}.csv`);
    fs.writeFileSync(p, 'Name,Notes\n" Acme, Inc. ","  hi  "\n');
    const t = readCsv(p);
    expect(t.rows[0].values).toEqual({ Name: "Acme, Inc.", Notes: "hi" });
    fs.unlinkSync(p);
  });

  it("respects headerRow > 1", () => {
    const p = path.join(os.tmpdir(), `wvo-readers-h-${Date.now()}.csv`);
    fs.writeFileSync(p, "junk line\nName,Qty\nWidget,3\n");
    const t = readCsv(p, 2);
    expect(t.headers).toEqual(["Name", "Qty"]);
    expect(t.rows[0]).toEqual({ rowNum: 3, values: { Name: "Widget", Qty: "3" } });
    fs.unlinkSync(p);
  });
});

describe("readExcel", () => {
  it("reads sheets, stringifies cells, formats dates as YYYY-MM-DD", async () => {
    const p = path.join(os.tmpdir(), `wvo-readers-${Date.now()}.xlsx`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Jobs");
    ws.addRow(["Job", "Date", "Qty"]);
    ws.addRow(["J-1", new Date(Date.UTC(2026, 6, 10)), 3]);
    await wb.xlsx.writeFile(p);
    const tables = await readExcel(p);
    expect(tables).toHaveLength(1);
    expect(tables[0].sheet).toBe("Jobs");
    expect(tables[0].headers).toEqual(["Job", "Date", "Qty"]);
    expect(tables[0].rows[0].values).toEqual({ Job: "J-1", Date: "2026-07-10", Qty: "3" });
    fs.unlinkSync(p);
  });
});

describe("readDataDir", () => {
  it("reads every csv in a directory, sorted by filename", async () => {
    const tables = await readDataDir(FIXTURES);
    expect(tables.map((t) => t.file)).toEqual(["customers.csv", "jobs.csv", "vehicles.csv"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/import/readers.test.ts`
Expected: FAIL — cannot resolve `./readers`.

- [ ] **Step 5: Implement `src/lib/import/readers.ts`**

```ts
// CSV/Excel -> uniform SourceTable for the onboarding data import engine.
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import ExcelJS from "exceljs";

export interface SourceRow {
  rowNum: number; // 1-based physical row in the file
  values: Record<string, string>;
}

export interface SourceTable {
  file: string;
  sheet?: string;
  headers: string[];
  rows: SourceRow[];
}

export function readCsv(filePath: string, headerRow = 1): SourceTable {
  const text = fs.readFileSync(filePath, "utf8");
  const noBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(noBom, { skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error in ${filePath}: ${parsed.errors[0].message}`);
  }
  const lines = parsed.data;
  if (lines.length < headerRow) throw new Error(`${filePath}: header row ${headerRow} is past end of file`);
  const headers = lines[headerRow - 1].map((h) => h.trim());
  const rows: SourceRow[] = lines.slice(headerRow).map((cells, i) => ({
    rowNum: headerRow + 1 + i,
    values: Object.fromEntries(headers.map((h, c) => [h, (cells[c] ?? "").trim()])),
  }));
  return { file: path.basename(filePath), headers, rows };
}

export async function readExcel(filePath: string, headerRow = 1): Promise<SourceTable[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const tables: SourceTable[] = [];
  wb.eachSheet((ws) => {
    const headerCells = (ws.getRow(headerRow).values ?? []) as ExcelJS.CellValue[];
    const headers: string[] = [];
    // exceljs row.values is 1-indexed (index 0 is empty)
    for (let c = 1; c < headerCells.length; c++) headers.push(cellToString(headerCells[c]));
    while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
    if (headers.length === 0) return;
    const rows: SourceRow[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum <= headerRow) return;
      const values: Record<string, string> = {};
      headers.forEach((h, i) => {
        values[h] = cellToString(row.getCell(i + 1).value);
      });
      rows.push({ rowNum, values });
    });
    tables.push({ file: path.basename(filePath), sheet: ws.name, headers, rows });
  });
  return tables;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellToString(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    return "";
  }
  return String(v).trim();
}

export async function readDataDir(
  dir: string,
  headerRows: Record<string, number> = {}
): Promise<SourceTable[]> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(csv|xlsx)$/i.test(f))
    .sort();
  const tables: SourceTable[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const hr = headerRows[f] ?? 1;
    if (/\.csv$/i.test(f)) tables.push(readCsv(full, hr));
    else tables.push(...(await readExcel(full, hr)));
  }
  return tables;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/import/readers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json src/lib/import/
git commit -m "feat(import): CSV/Excel readers with row provenance for migration engine"
```

---

### Task 2: Transforms (`transforms.ts`)

**Files:**
- Create: `src/lib/import/transforms.ts`
- Test: `src/lib/import/transforms.test.ts`

**Interfaces:**
- Produces: `type TransformName = "date-iso" | "date-mdy" | "date-dmy" | "currency" | "int"`; `const TRANSFORM_NAMES: TransformName[]`; `type TransformResult = { ok: true; value: string } | { ok: false; reason: string }`; `applyTransform(name: TransformName, raw: string): TransformResult`; `collapseWhitespace(s: string): string`; `applyValueMap(valueMaps: Record<string, Record<string, string>> | undefined, target: string, value: string): string`. Date transforms output `"YYYY-MM-DD"`; `currency`/`int` output numeric strings (coercion to numbers happens in the pipeline).

- [ ] **Step 1: Write the failing test**

`src/lib/import/transforms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyTransform, applyValueMap, collapseWhitespace } from "./transforms";

describe("date transforms", () => {
  it("date-iso passes through valid ISO dates", () => {
    expect(applyTransform("date-iso", "2026-07-10")).toEqual({ ok: true, value: "2026-07-10" });
    expect(applyTransform("date-iso", "2026-7-3")).toEqual({ ok: true, value: "2026-07-03" });
  });
  it("date-mdy converts US dates, expanding 2-digit years", () => {
    expect(applyTransform("date-mdy", "7/10/2026")).toEqual({ ok: true, value: "2026-07-10" });
    expect(applyTransform("date-mdy", "12-31-26")).toEqual({ ok: true, value: "2026-12-31" });
  });
  it("date-dmy converts day-first dates", () => {
    expect(applyTransform("date-dmy", "10/7/2026")).toEqual({ ok: true, value: "2026-07-10" });
  });
  it("rejects impossible calendar dates and garbage", () => {
    expect(applyTransform("date-mdy", "2/30/2026").ok).toBe(false);
    expect(applyTransform("date-iso", "soon").ok).toBe(false);
  });
});

describe("currency and int", () => {
  it("currency strips $ and commas", () => {
    expect(applyTransform("currency", "$1,234.50")).toEqual({ ok: true, value: "1234.5" });
    expect(applyTransform("currency", "n/a").ok).toBe(false);
  });
  it("int accepts whole numbers only", () => {
    expect(applyTransform("int", "1,200")).toEqual({ ok: true, value: "1200" });
    expect(applyTransform("int", "3.5").ok).toBe(false);
  });
});

describe("helpers", () => {
  it("collapseWhitespace trims and collapses runs", () => {
    expect(collapseWhitespace("  a   b \t c ")).toBe("a b c");
  });
  it("applyValueMap translates when a map exists, else passes through", () => {
    const maps = { "Job.status": { Open: "Scheduled" } };
    expect(applyValueMap(maps, "Job.status", "Open")).toBe("Scheduled");
    expect(applyValueMap(maps, "Job.status", "Odd")).toBe("Odd");
    expect(applyValueMap(undefined, "Job.status", "Open")).toBe("Open");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/import/transforms.test.ts`
Expected: FAIL — cannot resolve `./transforms`.

- [ ] **Step 3: Implement `src/lib/import/transforms.ts`**

```ts
// Named, deterministic value transforms for the import pipeline.
export type TransformName = "date-iso" | "date-mdy" | "date-dmy" | "currency" | "int";
export const TRANSFORM_NAMES: TransformName[] = ["date-iso", "date-mdy", "date-dmy", "currency", "int"];

export type TransformResult = { ok: true; value: string } | { ok: false; reason: string };

const ok = (value: string): TransformResult => ({ ok: true, value });
const fail = (reason: string): TransformResult => ({ ok: false, reason });

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const SLASH_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

export function applyTransform(name: TransformName, raw: string): TransformResult {
  const v = collapseWhitespace(raw);
  switch (name) {
    case "date-iso": {
      const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) return fail(`"${v}" is not an ISO date (YYYY-MM-DD)`);
      return toYmd(+m[1], +m[2], +m[3], v);
    }
    case "date-mdy": {
      const m = v.match(SLASH_DATE);
      if (!m) return fail(`"${v}" is not a M/D/Y date`);
      return toYmd(expandYear(+m[3]), +m[1], +m[2], v);
    }
    case "date-dmy": {
      const m = v.match(SLASH_DATE);
      if (!m) return fail(`"${v}" is not a D/M/Y date`);
      return toYmd(expandYear(+m[3]), +m[2], +m[1], v);
    }
    case "currency": {
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (v === "" || !Number.isFinite(n)) return fail(`"${v}" is not a currency amount`);
      return ok(String(n));
    }
    case "int": {
      const n = Number(v.replace(/,/g, ""));
      if (v === "" || !Number.isInteger(n)) return fail(`"${v}" is not a whole number`);
      return ok(String(n));
    }
  }
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function toYmd(y: number, mo: number, d: number, raw: string): TransformResult {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return fail(`"${raw}" is not a real calendar date`);
  }
  return ok(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
}

export function applyValueMap(
  valueMaps: Record<string, Record<string, string>> | undefined,
  target: string,
  value: string
): string {
  return valueMaps?.[target]?.[value] ?? value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/import/transforms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/import/transforms.ts src/lib/import/transforms.test.ts
git commit -m "feat(import): named date/currency/int transforms and valueMap application"
```

---

### Task 3: Mapping types, entity metadata, validators (`mappingSchema.ts` + `keys.ts`)

**Files:**
- Create: `src/lib/import/mappingSchema.ts`
- Create: `src/lib/import/keys.ts`
- Test: `src/lib/import/mappingSchema.test.ts`

**Interfaces:**
- Consumes: `SourceTable` (Task 1, type-only), `TransformName`/`TRANSFORM_NAMES` (Task 2).
- Produces (used by every later task):
  - `type EntityName = "Client" | "Personnel" | "PersonnelQualification" | "Vehicle" | "StockLocation" | "Equipment" | "InventoryItem" | "StockLevel" | "Job" | "JobAssignment" | "JobEquipment" | "JobLineItem"`
  - `interface FieldMeta { required: boolean; kind: "string" | "float" | "int" | "date" | "enum"; enumValues?: readonly string[]; resolvesTo?: EntityName }`
  - `interface EntityMeta { insertOrder: number; naturalKey?: readonly string[]; childOfJob?: boolean; fields: Record<string, FieldMeta> }`
  - `const ENTITY_META: Record<EntityName, EntityMeta>`; `const JOB_IMPORT_STATUSES = ["Scheduled", "In Progress"]`; `const UNRESOLVED = "UNRESOLVED"`
  - `interface ColumnMapping { field?: string; role?: "sourceKey"; transform?: TransformName; resolveBy?: string; confidence?: "low" }`
  - `interface FileMapping { file: string; sheet?: string; entity: EntityName; headerRow: number; columns: Record<string, ColumnMapping>; defaults?: Record<string, string>; unmapped: string[]; unresolved: string[] }`
  - `interface Mapping { version: 1; files: FileMapping[]; valueMaps?: Record<string, Record<string, string>>; unrecognized?: string[] }`
  - `validateMappingShape(mapping: Mapping): string[]` (empty array = valid); `validateMappingAgainstTables(mapping: Mapping, tables: SourceTable[]): string[]`; `findTable(tables: SourceTable[], fm: { file: string; sheet?: string }): SourceTable | undefined`
  - From `keys.ts`: `normKey(s: string): string` (trim, lowercase, collapse whitespace); `naturalKeyOf(entity: EntityName, data: Record<string, unknown>): string | null` (normKey'd join of naturalKey fields with a space, null when entity has no naturalKey); `vehicleStockLocationName(model: string, vin: string): string`

- [ ] **Step 1: Write the failing test**

`src/lib/import/mappingSchema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ENTITY_META, Mapping, validateMappingShape, validateMappingAgainstTables } from "./mappingSchema";
import { naturalKeyOf, normKey, vehicleStockLocationName } from "./keys";
import type { SourceTable } from "./readers";

const clientFile = (over: Partial<Mapping["files"][0]> = {}): Mapping["files"][0] => ({
  file: "customers.csv",
  entity: "Client",
  headerRow: 1,
  columns: {
    Customer: { field: "name" },
    Contact: { field: "contactName" },
    Address: { field: "locationAddress" },
    Terms: { field: "paymentTerms" },
  },
  unmapped: [],
  unresolved: [],
  ...over,
});

const valid = (): Mapping => ({ version: 1, files: [clientFile()] });

describe("validateMappingShape", () => {
  it("accepts a complete mapping", () => {
    expect(validateMappingShape(valid())).toEqual([]);
  });

  it("rejects unresolved entries", () => {
    const m: Mapping = { version: 1, files: [clientFile({ unresolved: ["locationAddress"] })] };
    expect(validateMappingShape(m).join()).toMatch(/unresolved required fields: locationAddress/);
  });

  it("rejects unknown fields and unknown transforms", () => {
    const m = valid();
    m.files[0].columns["Customer"] = { field: "fullName" };
    m.files[0].columns["Contact"] = { field: "contactName", transform: "shout" as never };
    const errs = validateMappingShape(m);
    expect(errs.join()).toMatch(/unknown field Client.fullName/);
    expect(errs.join()).toMatch(/unknown transform "shout"/);
  });

  it("rejects a required field with no column and no default, accepts one with a default", () => {
    const m = valid();
    delete m.files[0].columns["Terms"];
    expect(validateMappingShape(m).join()).toMatch(/Client.paymentTerms has no column and no default/);
    m.files[0].defaults = { paymentTerms: "Net 30" };
    expect(validateMappingShape(m)).toEqual([]);
  });

  it("rejects UNRESOLVED and out-of-vocab valueMap targets", () => {
    const m = valid();
    m.valueMaps = { "Job.status": { Open: "UNRESOLVED", WIP: "Working" } };
    const errs = validateMappingShape(m);
    expect(errs.join()).toMatch(/"Open" is UNRESOLVED/);
    expect(errs.join()).toMatch(/"WIP" .* not one of/);
  });

  it("requires a sourceKey column on Job when child sheets exist", () => {
    const m: Mapping = {
      version: 1,
      files: [
        {
          file: "jobs.csv", entity: "Job", headerRow: 1,
          columns: {
            Customer: { field: "clientId" },
            Date: { field: "scheduledDate", transform: "date-mdy" },
            Status: { field: "status" },
          },
          unmapped: [], unresolved: [],
        },
        {
          file: "crew.csv", entity: "JobAssignment", headerRow: 1,
          columns: { Job: { field: "jobId" }, Tech: { field: "personnelId" } },
          unmapped: [], unresolved: [],
        },
      ],
    };
    expect(validateMappingShape(m).join()).toMatch(/needs a sourceKey column/);
  });

  it("rejects sourceKey on non-Job sheets", () => {
    const m = valid();
    m.files[0].columns["Ref"] = { role: "sourceKey" };
    expect(validateMappingShape(m).join()).toMatch(/sourceKey role is only valid on Job sheets/);
  });
});

describe("validateMappingAgainstTables", () => {
  const tables: SourceTable[] = [
    { file: "customers.csv", headers: ["Customer", "Contact", "Address", "Terms"], rows: [] },
  ];
  it("passes when file and columns exist", () => {
    expect(validateMappingAgainstTables(valid(), tables)).toEqual([]);
  });
  it("flags missing files and missing columns", () => {
    const m = valid();
    m.files[0].columns["Fax"] = { field: "contactName" };
    m.files.push(clientFile({ file: "ghost.csv" }));
    const errs = validateMappingAgainstTables(m, tables);
    expect(errs.join()).toMatch(/column "Fax" not found/);
    expect(errs.join()).toMatch(/ghost.csv.*not found/);
  });
});

describe("keys", () => {
  it("normKey lowercases, trims, collapses spaces", () => {
    expect(normKey("  Acme   Plumbing ")).toBe("acme plumbing");
  });
  it("naturalKeyOf joins Personnel first+last, returns null for Job", () => {
    expect(naturalKeyOf("Personnel", { firstName: "Jane", lastName: "Doe" })).toBe("jane doe");
    expect(naturalKeyOf("Client", { name: "Acme" })).toBe("acme");
    expect(naturalKeyOf("Job", {})).toBeNull();
  });
  it("vehicleStockLocationName mirrors the fleet route format", () => {
    expect(vehicleStockLocationName("Transit 250", "1FTBR3X89PKA55341")).toBe("Van Transit 250 (1FTB) Stock");
  });
  it("every ENTITY_META resolvesTo target has a naturalKey or is Job", () => {
    for (const meta of Object.values(ENTITY_META)) {
      for (const f of Object.values(meta.fields)) {
        if (f.resolvesTo && f.resolvesTo !== "Job") {
          expect(ENTITY_META[f.resolvesTo].naturalKey).toBeDefined();
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/import/mappingSchema.test.ts`
Expected: FAIL — cannot resolve `./mappingSchema`.

- [ ] **Step 3: Implement `src/lib/import/mappingSchema.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/lib/import/keys.ts`**

```ts
// Natural-key helpers shared by resolve and execute.
import { ENTITY_META, type EntityName } from "./mappingSchema";

export function normKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function naturalKeyOf(entity: EntityName, data: Record<string, unknown>): string | null {
  const nk = ENTITY_META[entity].naturalKey;
  if (!nk) return null;
  return normKey(nk.map((f) => String(data[f] ?? "")).join(" "));
}

// Mirrors the create_vehicle action in src/app/api/fleet/route.ts
export function vehicleStockLocationName(model: string, vin: string): string {
  return `Van ${model} (${vin.substring(0, 4)}) Stock`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/import/mappingSchema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/import/mappingSchema.ts src/lib/import/keys.ts src/lib/import/mappingSchema.test.ts
git commit -m "feat(import): mapping types, entity metadata, and mapping validators"
```

---

### Task 4: Heuristic analyzer (`detect.ts`)

**Files:**
- Create: `src/lib/import/detect.ts`
- Test: `src/lib/import/detect.test.ts`

**Interfaces:**
- Consumes: `SourceTable` (Task 1), `TransformName` (Task 2), everything from `mappingSchema.ts` (Task 3).
- Produces: `interface AnalyzeResult { mapping: Mapping; notes: string[] }`; `buildMappingProposal(tables: SourceTable[]): AnalyzeResult`. Guarantees: every proposed mapping either passes `validateMappingShape` or fails it **only** via `unresolved` entries / `UNRESOLVED` valueMaps (never malformed structure). Unrecognized tables land in `mapping.unrecognized` and a note.

- [ ] **Step 1: Write the failing test**

`src/lib/import/detect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMappingProposal } from "./detect";
import { validateMappingShape } from "./mappingSchema";
import type { SourceTable } from "./readers";

const table = (file: string, headers: string[], rows: string[][]): SourceTable => ({
  file,
  headers,
  rows: rows.map((cells, i) => ({
    rowNum: i + 2,
    values: Object.fromEntries(headers.map((h, c) => [h, cells[c] ?? ""])),
  })),
});

const customers = table("customers.csv", ["Customer", "Contact", "Address", "Terms"], [
  ["Acme Plumbing", "Jane Doe", "12 Main St", "Net 30"],
]);
const vehicles = table("vehicles.csv", ["VIN", "Make", "Model", "Status"], [
  ["1FTBR3X89PKA55341", "Ford", "Transit 250", "Active"],
]);
const jobs = table("jobs.csv", ["Job #", "Customer", "Date", "Status", "Notes"], [
  ["1001", "Acme Plumbing", "7/10/2026", "Open", "Backflow test"],
  ["1003", "Acme Plumbing", "7/15/2026", "WIP", "RTU install"],
]);

describe("buildMappingProposal", () => {
  it("detects Client / Vehicle / Job sheets and maps their columns", () => {
    const { mapping } = buildMappingProposal([customers, vehicles, jobs]);
    const byEntity = Object.fromEntries(mapping.files.map((f) => [f.entity, f]));
    expect(byEntity.Client.file).toBe("customers.csv");
    expect(byEntity.Client.columns["Customer"]).toMatchObject({ field: "name" });
    expect(byEntity.Client.columns["Terms"]).toMatchObject({ field: "paymentTerms" });
    expect(byEntity.Vehicle.columns["VIN"]).toMatchObject({ field: "vin" });
    expect(byEntity.Job.columns["Job #"]).toMatchObject({ role: "sourceKey" });
    expect(byEntity.Job.columns["Customer"]).toMatchObject({ field: "clientId", resolveBy: "Client.name" });
    expect(byEntity.Job.columns["Date"]).toMatchObject({ field: "scheduledDate", transform: "date-mdy" });
  });

  it("proposes valueMaps for unknown enum vocab using common translations", () => {
    const { mapping } = buildMappingProposal([jobs]);
    expect(mapping.valueMaps?.["Job.status"]).toMatchObject({ Open: "Scheduled", WIP: "In Progress" });
  });

  it("marks truly unknown enum values UNRESOLVED and notes them", () => {
    const weird = table("jobs.csv", ["Job #", "Customer", "Date", "Status"], [
      ["1", "Acme", "7/10/2026", "Vibing"],
    ]);
    const { mapping, notes } = buildMappingProposal([weird]);
    expect(mapping.valueMaps?.["Job.status"]?.["Vibing"]).toBe("UNRESOLVED");
    expect(notes.join()).toMatch(/Vibing/);
  });

  it("puts uncovered required fields in unresolved unless a default suggestion exists", () => {
    const noTerms = table("customers.csv", ["Customer", "Contact", "Address"], [
      ["Acme", "Jane", "12 Main St"],
    ]);
    const { mapping } = buildMappingProposal([noTerms]);
    const fm = mapping.files[0];
    expect(fm.defaults).toMatchObject({ paymentTerms: "Net 30" }); // suggested default
    expect(fm.unresolved).toEqual([]);
    const bare = table("customers.csv", ["Customer", "Contact"], [["Acme", "Jane"]]);
    const { mapping: m2 } = buildMappingProposal([bare]);
    expect(m2.files[0].unresolved).toContain("locationAddress");
  });

  it("detects day-first dates from values and flags ambiguous ones", () => {
    const dmy = table("jobs.csv", ["Job #", "Customer", "Date", "Status"], [
      ["1", "Acme", "25/7/2026", "Open"],
    ]);
    expect(buildMappingProposal([dmy]).mapping.files[0].columns["Date"].transform).toBe("date-dmy");
    const ambiguous = table("jobs.csv", ["Job #", "Customer", "Date", "Status"], [
      ["1", "Acme", "3/4/2026", "Open"],
    ]);
    const r = buildMappingProposal([ambiguous]);
    expect(r.mapping.files[0].columns["Date"]).toMatchObject({ transform: "date-mdy", confidence: "low" });
    expect(r.notes.join()).toMatch(/ambiguous/i);
  });

  it("lists unrecognizable tables in unrecognized instead of guessing", () => {
    const junk = table("misc.csv", ["Foo", "Bar"], [["1", "2"]]);
    const { mapping, notes } = buildMappingProposal([junk]);
    expect(mapping.files).toHaveLength(0);
    expect(mapping.unrecognized).toEqual(["misc.csv"]);
    expect(notes.join()).toMatch(/misc.csv/);
  });

  it("emits proposals that are structurally valid per validateMappingShape", () => {
    const { mapping } = buildMappingProposal([customers, vehicles, jobs]);
    const errs = validateMappingShape(mapping).filter((e) => !/unresolved|UNRESOLVED/.test(e));
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/import/detect.test.ts`
Expected: FAIL — cannot resolve `./detect`.

- [ ] **Step 3: Implement `src/lib/import/detect.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/import/detect.test.ts`
Expected: PASS. If the Job sheet detection test fails because `scoreEntity` prefers another entity, print the scores for each entity in the failing test to diagnose the synonym table — do not lower the recognition threshold.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/import/detect.ts src/lib/import/detect.test.ts
git commit -m "feat(import): heuristic mapping proposal (entity detection, column matching, valueMaps)"
```

---

### Task 5: Pipeline + reference resolution (`pipeline.ts`, `resolve.ts`)

**Files:**
- Create: `src/lib/import/pipeline.ts`
- Create: `src/lib/import/resolve.ts`
- Test: `src/lib/import/pipeline.test.ts`
- Test: `src/lib/import/resolve.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`SourceTable`, transforms, `ENTITY_META`, `findTable`, `JOB_IMPORT_STATUSES`, keys helpers).
- Produces (in `pipeline.ts`):
  - `interface RowIssue { file: string; row: number; entity: EntityName; reason: string }`
  - `interface PlannedRecord { entity: EntityName; data: Record<string, string | number>; refs: Record<string, { entity: EntityName; key: string }>; source: { file: string; row: number }; sourceKey?: string }`
  - `interface ImportPlan { entities: Partial<Record<EntityName, PlannedRecord[]>>; rejected: RowIssue[]; skipped: RowIssue[]; skippedJobSourceKeys: Set<string>; summary: Record<string, { planned: number; rejected: number; skipped: number }> }`
  - `buildImportPlan(mapping: Mapping, tables: SourceTable[]): ImportPlan` — assumes the mapping already passed both validators.
  - In `data`, date fields are `"YYYY-MM-DD"` strings; int/float fields are numbers. Ref fields live in `refs`, never in `data`.
- Produces (in `resolve.ts`): `resolveReferences(plan: ImportPlan): void` — mutates the plan: moves records with dangling refs to `rejected`, children of out-of-scope jobs to `skipped`. Registers auto-created vehicle stock location names in the StockLocation index.

- [ ] **Step 1: Write the failing resolve test**

`src/lib/import/resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveReferences } from "./resolve";
import type { ImportPlan, PlannedRecord } from "./pipeline";
import type { EntityName } from "./mappingSchema";

const rec = (entity: EntityName, over: Partial<PlannedRecord> = {}): PlannedRecord => ({
  entity,
  data: {},
  refs: {},
  source: { file: "f.csv", row: 2 },
  ...over,
});

const emptyPlan = (): ImportPlan => ({
  entities: {},
  rejected: [],
  skipped: [],
  skippedJobSourceKeys: new Set(),
  summary: {},
});

describe("resolveReferences", () => {
  it("keeps records whose refs match planned natural keys (case-insensitive)", () => {
    const plan = emptyPlan();
    plan.entities.Client = [rec("Client", { data: { name: "Acme Plumbing" } })];
    plan.entities.Job = [
      rec("Job", {
        data: { status: "Scheduled", scheduledDate: "2026-07-10" },
        refs: { clientId: { entity: "Client", key: "ACME plumbing" } },
        sourceKey: "1001",
      }),
    ];
    resolveReferences(plan);
    expect(plan.entities.Job).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects records with dangling refs", () => {
    const plan = emptyPlan();
    plan.entities.Job = [
      rec("Job", { data: { status: "Scheduled" }, refs: { clientId: { entity: "Client", key: "Ghost Co" } }, sourceKey: "9" }),
    ];
    resolveReferences(plan);
    expect(plan.entities.Job).toEqual([]);
    expect(plan.rejected[0].reason).toMatch(/no Client matching "Ghost Co"/);
  });

  it("skips children of out-of-scope jobs but rejects children of unknown jobs", () => {
    const plan = emptyPlan();
    plan.skippedJobSourceKeys.add("1002");
    plan.entities.Personnel = [rec("Personnel", { data: { firstName: "Jane", lastName: "Doe" } })];
    plan.entities.JobAssignment = [
      rec("JobAssignment", { refs: { jobId: { entity: "Job", key: "1002" }, personnelId: { entity: "Personnel", key: "Jane Doe" } } }),
      rec("JobAssignment", { refs: { jobId: { entity: "Job", key: "777" }, personnelId: { entity: "Personnel", key: "Jane Doe" } } }),
    ];
    resolveReferences(plan);
    expect(plan.entities.JobAssignment).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/out of scope/);
    expect(plan.rejected[0].reason).toMatch(/unknown job reference "777"/);
  });

  it("resolves StockLevel refs against auto-created vehicle stock location names", () => {
    const plan = emptyPlan();
    plan.entities.Vehicle = [rec("Vehicle", { data: { vin: "1FTBR3X89PKA55341", make: "Ford", model: "Transit 250", status: "Active" } })];
    plan.entities.InventoryItem = [rec("InventoryItem", { data: { name: "Widget", category: "A", subCategory: "B", defaultRate: 5 } })];
    plan.entities.StockLevel = [
      rec("StockLevel", {
        data: { quantity: 3, minThreshold: 1 },
        refs: {
          inventoryItemId: { entity: "InventoryItem", key: "Widget" },
          stockLocationId: { entity: "StockLocation", key: "Van Transit 250 (1FTB) Stock" },
        },
      }),
    ];
    resolveReferences(plan);
    expect(plan.entities.StockLevel).toHaveLength(1);
    expect(plan.rejected).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing pipeline test**

`src/lib/import/pipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildImportPlan } from "./pipeline";
import type { Mapping } from "./mappingSchema";
import type { SourceTable } from "./readers";

const table = (file: string, headers: string[], rows: string[][]): SourceTable => ({
  file,
  headers,
  rows: rows.map((cells, i) => ({
    rowNum: i + 2,
    values: Object.fromEntries(headers.map((h, c) => [h, cells[c] ?? ""])),
  })),
});

const mapping: Mapping = {
  version: 1,
  files: [
    {
      file: "customers.csv", entity: "Client", headerRow: 1,
      columns: {
        Customer: { field: "name" },
        Contact: { field: "contactName" },
        Address: { field: "locationAddress" },
      },
      defaults: { paymentTerms: "Net 30" },
      unmapped: [], unresolved: [],
    },
    {
      file: "jobs.csv", entity: "Job", headerRow: 1,
      columns: {
        "Job #": { role: "sourceKey" },
        Customer: { field: "clientId", resolveBy: "Client.name" },
        Date: { field: "scheduledDate", transform: "date-mdy" },
        Status: { field: "status" },
        Notes: { field: "notes" },
      },
      unmapped: [], unresolved: [],
    },
  ],
  valueMaps: { "Job.status": { Open: "Scheduled", WIP: "In Progress" } },
};

const customers = table("customers.csv", ["Customer", "Contact", "Address"], [
  ["Acme Plumbing", "Jane Doe", "12 Main St"],
  ["Acme Plumbing", "Dup Row", "99 Elm St"],
  ["", "No Name", "1 Void Ln"],
]);

const jobs = table("jobs.csv", ["Job #", "Customer", "Date", "Status", "Notes"], [
  ["1001", "Acme Plumbing", "7/10/2026", "Open", "Backflow test"],
  ["1002", "Acme Plumbing", "7/12/2026", "Completed", "Panel swap"],
  ["1003", "Acme Plumbing", "13/45/2026", "Open", "Bad date"],
  ["1004", "Ghost Co", "7/20/2026", "Open", "Dangling client"],
  ["1005", "Acme Plumbing", "7/22/2026", "Odd", "Unmapped status"],
]);

describe("buildImportPlan", () => {
  const plan = buildImportPlan(mapping, [customers, jobs]);

  it("plans clean rows with defaults applied and dates normalized", () => {
    expect(plan.entities.Client).toHaveLength(1);
    expect(plan.entities.Client![0].data).toEqual({
      name: "Acme Plumbing", contactName: "Jane Doe", locationAddress: "12 Main St", paymentTerms: "Net 30",
    });
    expect(plan.entities.Job).toHaveLength(1);
    expect(plan.entities.Job![0].data.scheduledDate).toBe("2026-07-10");
    expect(plan.entities.Job![0].sourceKey).toBe("1001");
    expect(plan.entities.Job![0].refs.clientId).toEqual({ entity: "Client", key: "Acme Plumbing" });
  });

  it("rejects duplicate natural keys, missing required fields, bad transforms, bad enums, dangling refs", () => {
    const reasons = plan.rejected.map((r) => `${r.file}:${r.row} ${r.reason}`).join("\n");
    expect(reasons).toMatch(/customers.csv:3 .*duplicate/);
    expect(reasons).toMatch(/customers.csv:4 .*missing required name/);
    expect(reasons).toMatch(/jobs.csv:4 .*not a M\/D\/Y date/);
    expect(reasons).toMatch(/jobs.csv:5 .*no Client matching "Ghost Co"/);
    expect(reasons).toMatch(/jobs.csv:6 .*"Odd" is not one of/);
  });

  it("skips completed jobs as out of scope and tracks their sourceKeys", () => {
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ file: "jobs.csv", row: 3, entity: "Job" });
    expect(plan.skippedJobSourceKeys.has("1002")).toBe(true);
  });

  it("computes a per-entity summary", () => {
    expect(plan.summary.Client).toEqual({ planned: 1, rejected: 2, skipped: 0 });
    expect(plan.summary.Job).toEqual({ planned: 1, rejected: 3, skipped: 1 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/import/resolve.test.ts src/lib/import/pipeline.test.ts`
Expected: FAIL — cannot resolve `./resolve` / `./pipeline`.

- [ ] **Step 4: Implement `src/lib/import/pipeline.ts`**

```ts
// Deterministic mapping execution: SourceTables + Mapping -> ImportPlan.
// Row problems are collected, never thrown. Assumes the mapping passed
// validateMappingShape and validateMappingAgainstTables.
import type { SourceRow, SourceTable } from "./readers";
import {
  ENTITY_META, JOB_IMPORT_STATUSES, findTable,
  type EntityName, type FieldMeta, type FileMapping, type Mapping,
} from "./mappingSchema";
import { applyTransform, applyValueMap, collapseWhitespace } from "./transforms";
import { normKey } from "./keys";
import { resolveReferences } from "./resolve";

export interface RowIssue {
  file: string;
  row: number;
  entity: EntityName;
  reason: string;
}

export interface PlannedRecord {
  entity: EntityName;
  data: Record<string, string | number>;
  refs: Record<string, { entity: EntityName; key: string }>;
  source: { file: string; row: number };
  sourceKey?: string;
}

export interface ImportPlan {
  entities: Partial<Record<EntityName, PlannedRecord[]>>;
  rejected: RowIssue[];
  skipped: RowIssue[];
  skippedJobSourceKeys: Set<string>;
  summary: Record<string, { planned: number; rejected: number; skipped: number }>;
}

export function buildImportPlan(mapping: Mapping, tables: SourceTable[]): ImportPlan {
  const plan: ImportPlan = {
    entities: {},
    rejected: [],
    skipped: [],
    skippedJobSourceKeys: new Set(),
    summary: {},
  };
  const seenKeys = new Map<EntityName, Set<string>>();
  const ordered = [...mapping.files].sort(
    (a, b) => ENTITY_META[a.entity].insertOrder - ENTITY_META[b.entity].insertOrder
  );
  for (const fm of ordered) {
    const table = findTable(tables, fm)!;
    for (const row of table.rows) {
      const rec = buildRecord(fm, row, mapping, plan);
      if (!rec) continue;
      const key = dupKey(rec);
      if (key !== null) {
        let set = seenKeys.get(fm.entity);
        if (!set) {
          set = new Set();
          seenKeys.set(fm.entity, set);
        }
        if (set.has(key)) {
          plan.rejected.push({ ...rec.source, entity: fm.entity, reason: `duplicate ${fm.entity} key "${key}"` });
          continue;
        }
        set.add(key);
      }
      (plan.entities[fm.entity] ??= []).push(rec);
    }
  }
  resolveReferences(plan);
  computeSummary(plan, mapping);
  return plan;
}

function buildRecord(fm: FileMapping, row: SourceRow, mapping: Mapping, plan: ImportPlan): PlannedRecord | null {
  const entity = fm.entity;
  const meta = ENTITY_META[entity];
  const source = { file: fm.file, row: row.rowNum };
  const data: PlannedRecord["data"] = {};
  const refs: PlannedRecord["refs"] = {};
  const problems: string[] = [];
  const covered = new Set<string>();
  let sourceKey: string | undefined;

  for (const [header, cm] of Object.entries(fm.columns)) {
    const raw = collapseWhitespace(row.values[header] ?? "");
    if (cm.role === "sourceKey") {
      sourceKey = raw;
      if (!raw) problems.push(`empty sourceKey ("${header}")`);
      continue;
    }
    const field = cm.field!;
    const f = meta.fields[field];
    covered.add(field);
    let v = raw;
    if (v !== "" && cm.transform) {
      const r = applyTransform(cm.transform, v);
      if (!r.ok) {
        problems.push(`${field}: ${r.reason}`);
        continue;
      }
      v = r.value;
    }
    v = applyValueMap(mapping.valueMaps, `${entity}.${field}`, v);
    if (v === "") {
      const d = fm.defaults?.[field];
      if (d !== undefined) v = d;
      else if (f.required) {
        problems.push(`missing required ${field}`);
        continue;
      } else continue;
    }
    place(v, f, field, data, refs, problems);
  }

  for (const [field, d] of Object.entries(fm.defaults ?? {})) {
    if (covered.has(field)) continue;
    place(d, meta.fields[field], field, data, refs, problems);
  }

  if (problems.length > 0) {
    plan.rejected.push({ ...source, entity, reason: problems.join("; ") });
    return null;
  }
  if (entity === "Job" && !JOB_IMPORT_STATUSES.includes(String(data.status))) {
    plan.skipped.push({ ...source, entity, reason: `out of scope: status "${data.status}"` });
    if (sourceKey) plan.skippedJobSourceKeys.add(normKey(sourceKey));
    return null;
  }
  return { entity, data, refs, source, ...(sourceKey !== undefined ? { sourceKey } : {}) };
}

function place(
  v: string,
  f: FieldMeta,
  field: string,
  data: PlannedRecord["data"],
  refs: PlannedRecord["refs"],
  problems: string[]
): void {
  const coerced = coerce(v, f, field, problems);
  if (coerced === undefined) return;
  if (f.resolvesTo) refs[field] = { entity: f.resolvesTo, key: String(coerced) };
  else data[field] = coerced;
}

function coerce(v: string, f: FieldMeta, field: string, problems: string[]): string | number | undefined {
  switch (f.kind) {
    case "string":
      return v;
    case "enum":
      if (!f.enumValues!.includes(v)) {
        problems.push(`${field}: "${v}" is not one of ${f.enumValues!.join(", ")} (add a valueMaps entry)`);
        return undefined;
      }
      return v;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        problems.push(`${field}: "${v}" is not YYYY-MM-DD (add a date transform)`);
        return undefined;
      }
      return v;
    case "int": {
      const n = Number(v);
      if (!Number.isInteger(n)) {
        problems.push(`${field}: "${v}" is not a whole number`);
        return undefined;
      }
      return n;
    }
    case "float": {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        problems.push(`${field}: "${v}" is not a number`);
        return undefined;
      }
      return n;
    }
  }
}

function dupKey(rec: PlannedRecord): string | null {
  const nk = ENTITY_META[rec.entity].naturalKey;
  if (nk) return normKey(nk.map((f) => String(rec.data[f] ?? rec.refs[f]?.key ?? "")).join(" "));
  if (rec.entity === "Job") return rec.sourceKey ? `job:${normKey(rec.sourceKey)}` : null;
  if (rec.entity === "JobAssignment" || rec.entity === "JobEquipment") {
    return Object.values(rec.refs).map((r) => normKey(r.key)).join("|");
  }
  return null; // JobLineItem / PersonnelQualification have no unique constraint
}

function computeSummary(plan: ImportPlan, mapping: Mapping): void {
  for (const entity of new Set(mapping.files.map((f) => f.entity))) {
    plan.summary[entity] = {
      planned: plan.entities[entity]?.length ?? 0,
      rejected: plan.rejected.filter((r) => r.entity === entity).length,
      skipped: plan.skipped.filter((r) => r.entity === entity).length,
    };
  }
}
```

- [ ] **Step 5: Implement `src/lib/import/resolve.ts`**

```ts
// In-memory FK resolution over an ImportPlan (fresh-DB import: every
// reference must resolve to another planned record).
import { type EntityName } from "./mappingSchema";
import { naturalKeyOf, normKey, vehicleStockLocationName } from "./keys";
import type { ImportPlan, PlannedRecord } from "./pipeline";

export function resolveReferences(plan: ImportPlan): void {
  const index = new Map<EntityName, Set<string>>();
  const add = (e: EntityName, k: string) => {
    let set = index.get(e);
    if (!set) {
      set = new Set();
      index.set(e, set);
    }
    set.add(k);
  };

  for (const [entity, records] of Object.entries(plan.entities) as [EntityName, PlannedRecord[]][]) {
    for (const r of records) {
      const k = naturalKeyOf(entity, r.data);
      if (k) add(entity, k);
      if (entity === "Vehicle") {
        add("StockLocation", normKey(vehicleStockLocationName(String(r.data.model), String(r.data.vin))));
      }
    }
  }
  const jobKeys = new Set((plan.entities.Job ?? []).map((r) => normKey(r.sourceKey ?? "")));

  for (const [entity, records] of Object.entries(plan.entities) as [EntityName, PlannedRecord[]][]) {
    const kept: PlannedRecord[] = [];
    for (const r of records) {
      let verdict: "ok" | "skip" | "reject" = "ok";
      let reason = "";
      for (const [field, ref] of Object.entries(r.refs)) {
        const k = normKey(ref.key);
        if (ref.entity === "Job") {
          if (jobKeys.has(k)) continue;
          if (plan.skippedJobSourceKeys.has(k)) {
            verdict = "skip";
            reason = `parent job "${ref.key}" is out of scope`;
          } else {
            verdict = "reject";
            reason = `unknown job reference "${ref.key}"`;
          }
          break;
        }
        if (!index.get(ref.entity)?.has(k)) {
          verdict = "reject";
          reason = `${field}: no ${ref.entity} matching "${ref.key}"`;
          break;
        }
      }
      if (verdict === "ok") kept.push(r);
      else (verdict === "skip" ? plan.skipped : plan.rejected).push({ ...r.source, entity, reason });
    }
    plan.entities[entity] = kept;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/import/resolve.test.ts src/lib/import/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/import/pipeline.ts src/lib/import/resolve.ts src/lib/import/pipeline.test.ts src/lib/import/resolve.test.ts
git commit -m "feat(import): pipeline (extract/transform/validate) and in-memory FK resolution"
```

---

### Task 6: Transactional executor (`execute.ts`)

**Files:**
- Create: `src/lib/import/execute.ts`
- Test: `src/lib/import/execute.test.ts`

**Interfaces:**
- Consumes: `ENTITY_META`, keys helpers, `ImportPlan` (type-only).
- Produces:
  - `interface ImportTx { client, personnel, personnelQualification, vehicle, stockLocation, equipment, inventoryItem, stockLevel, job, jobAssignment, jobEquipment, jobLineItem }` — each `{ create(args: { data: Record<string, unknown> }): Promise<{ id: string }> }`
  - `interface ImportDb { $transaction<T>(fn: (tx: ImportTx) => Promise<T>): Promise<T>; client/personnel/vehicle/equipment/inventoryItem/stockLocation/job: { count(): Promise<number> } }` — the real `PrismaClient` satisfies this structurally.
  - `assertEmptyDatabase(db: ImportDb): Promise<void>` — throws if any counted table is non-empty (User/AuditLog intentionally not counted; bootstrap's admin may exist).
  - `interface ImportResult { created: Partial<Record<EntityName, number>>; jobs: { sourceKey: string; id: string }[] }`
  - `executeImport(db: ImportDb, plan: ImportPlan): Promise<ImportResult>` — one `$transaction`, dependency order, date strings become `new Date(ymd)`, refs become created ids, vehicles auto-create their stock location.

- [ ] **Step 1: Write the failing test**

`src/lib/import/execute.test.ts` (fake DB via structural typing — no `vi.mock`, no real client):

```ts
import { describe, it, expect } from "vitest";
import { assertEmptyDatabase, executeImport, type ImportDb, type ImportTx } from "./execute";
import type { ImportPlan, PlannedRecord } from "./pipeline";
import type { EntityName } from "./mappingSchema";

interface CreatedRow { model: string; data: Record<string, unknown> }

function fakeDb(counts: Partial<Record<string, number>> = {}) {
  const createdRows: CreatedRow[] = [];
  let seq = 0;
  const delegate = (model: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdRows.push({ model, data });
      return { id: `${model}-${++seq}` };
    },
  });
  const counter = (model: string) => ({ count: async () => counts[model] ?? 0 });
  const tx = {
    client: delegate("client"), personnel: delegate("personnel"),
    personnelQualification: delegate("personnelQualification"),
    vehicle: delegate("vehicle"), stockLocation: delegate("stockLocation"),
    equipment: delegate("equipment"), inventoryItem: delegate("inventoryItem"),
    stockLevel: delegate("stockLevel"), job: delegate("job"),
    jobAssignment: delegate("jobAssignment"), jobEquipment: delegate("jobEquipment"),
    jobLineItem: delegate("jobLineItem"),
  } satisfies ImportTx;
  const db: ImportDb = {
    $transaction: async (fn) => fn(tx),
    client: counter("client"), personnel: counter("personnel"), vehicle: counter("vehicle"),
    equipment: counter("equipment"), inventoryItem: counter("inventoryItem"),
    stockLocation: counter("stockLocation"), job: counter("job"),
  };
  return { db, createdRows };
}

const rec = (entity: EntityName, over: Partial<PlannedRecord> = {}): PlannedRecord => ({
  entity, data: {}, refs: {}, source: { file: "f.csv", row: 2 }, ...over,
});

const plan = (): ImportPlan => ({
  entities: {
    Job: [rec("Job", {
      data: { status: "Scheduled", scheduledDate: "2026-07-10", notes: "n" },
      refs: { clientId: { entity: "Client", key: "ACME plumbing" }, assignedVehicleId: { entity: "Vehicle", key: "1FTBR3X89PKA55341" } },
      sourceKey: "1001",
    })],
    Client: [rec("Client", { data: { name: "Acme Plumbing", contactName: "J", locationAddress: "A", paymentTerms: "Net 30" } })],
    Vehicle: [rec("Vehicle", { data: { vin: "1FTBR3X89PKA55341", make: "Ford", model: "Transit 250", status: "Active" } })],
    JobAssignment: [rec("JobAssignment", {
      refs: { jobId: { entity: "Job", key: "1001" }, personnelId: { entity: "Personnel", key: "jane doe" } },
    })],
    Personnel: [rec("Personnel", { data: { firstName: "Jane", lastName: "Doe", role: "Technician" } })],
    StockLevel: [rec("StockLevel", {
      data: { quantity: 3, minThreshold: 1 },
      refs: {
        inventoryItemId: { entity: "InventoryItem", key: "Widget" },
        stockLocationId: { entity: "StockLocation", key: "Van Transit 250 (1FTB) Stock" },
      },
    })],
    InventoryItem: [rec("InventoryItem", { data: { name: "Widget", category: "A", subCategory: "B", defaultRate: 5 } })],
  },
  rejected: [], skipped: [], skippedJobSourceKeys: new Set(), summary: {},
});

describe("assertEmptyDatabase", () => {
  it("passes on an empty database", async () => {
    await expect(assertEmptyDatabase(fakeDb().db)).resolves.toBeUndefined();
  });
  it("throws when any imported table has rows", async () => {
    await expect(assertEmptyDatabase(fakeDb({ job: 3 }).db)).rejects.toThrow(/not empty/);
  });
});

describe("executeImport", () => {
  it("inserts in dependency order inside one transaction", async () => {
    const { db, createdRows } = fakeDb();
    await executeImport(db, plan());
    const order = createdRows.map((r) => r.model);
    expect(order.indexOf("client")).toBeLessThan(order.indexOf("job"));
    expect(order.indexOf("vehicle")).toBeLessThan(order.indexOf("stockLevel"));
    expect(order.indexOf("job")).toBeLessThan(order.indexOf("jobAssignment"));
  });

  it("wires refs to created ids, converts dates, auto-creates vehicle stock locations", async () => {
    const { db, createdRows } = fakeDb();
    const result = await executeImport(db, plan());
    const idOf = (model: string) => `${model}-${createdRows.findIndex((r) => r.model === model) + 1}`;
    const job = createdRows.find((r) => r.model === "job")!.data;
    expect(job.clientId).toBe(idOf("client"));
    expect(job.assignedVehicleId).toBe(idOf("vehicle"));
    expect(job.scheduledDate).toEqual(new Date("2026-07-10"));
    const autoLoc = createdRows.find((r) => r.model === "stockLocation")!;
    expect(autoLoc.data).toMatchObject({ name: "Van Transit 250 (1FTB) Stock", type: "Vehicle" });
    const level = createdRows.find((r) => r.model === "stockLevel")!.data;
    expect(level.stockLocationId).toBe(idOf("stockLocation"));
    expect(result.created).toMatchObject({ Client: 1, Vehicle: 1, StockLocation: 1, Job: 1, JobAssignment: 1, StockLevel: 1 });
    expect(result.jobs).toEqual([{ sourceKey: "1001", id: expect.stringMatching(/^job-/) }]);
    expect(createdRows.find((r) => r.model === "client")!.data.name).toBe("Acme Plumbing");
  });

  it("throws on an unresolved ref reaching execute (internal error)", async () => {
    const p = plan();
    p.entities.Job![0].refs.clientId = { entity: "Client", key: "Ghost" };
    await expect(executeImport(fakeDb().db, p)).rejects.toThrow(/internal: unresolved Client "Ghost"/);
  });
});
```

Note: the `level.stockLocationId` assertion above is awkwardly defensive; simplify it during implementation to assert against the actual id the fake produced for the stockLocation row (e.g. capture it and `expect(level.stockLocationId).toBe(locId)`). The intent: the StockLevel row's FK equals the auto-created location's id.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/import/execute.test.ts`
Expected: FAIL — cannot resolve `./execute`.

- [ ] **Step 3: Implement `src/lib/import/execute.ts`**

```ts
// Transactional executor: writes an ImportPlan to the database in
// dependency order. The db parameter is structurally typed so unit tests
// pass a fake and scripts/import/run.ts passes the real PrismaClient.
import { ENTITY_META, type EntityName } from "./mappingSchema";
import { naturalKeyOf, normKey, vehicleStockLocationName } from "./keys";
import type { ImportPlan } from "./pipeline";

interface CreateDelegate {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
}
interface CountDelegate {
  count(): Promise<number>;
}

export interface ImportTx {
  client: CreateDelegate;
  personnel: CreateDelegate;
  personnelQualification: CreateDelegate;
  vehicle: CreateDelegate;
  stockLocation: CreateDelegate;
  equipment: CreateDelegate;
  inventoryItem: CreateDelegate;
  stockLevel: CreateDelegate;
  job: CreateDelegate;
  jobAssignment: CreateDelegate;
  jobEquipment: CreateDelegate;
  jobLineItem: CreateDelegate;
}

export interface ImportDb {
  $transaction<T>(fn: (tx: ImportTx) => Promise<T>): Promise<T>;
  client: CountDelegate;
  personnel: CountDelegate;
  vehicle: CountDelegate;
  equipment: CountDelegate;
  inventoryItem: CountDelegate;
  stockLocation: CountDelegate;
  job: CountDelegate;
}

export interface ImportResult {
  created: Partial<Record<EntityName, number>>;
  jobs: { sourceKey: string; id: string }[];
}

const DELEGATE: Record<EntityName, keyof ImportTx> = {
  Client: "client",
  Personnel: "personnel",
  PersonnelQualification: "personnelQualification",
  Vehicle: "vehicle",
  StockLocation: "stockLocation",
  Equipment: "equipment",
  InventoryItem: "inventoryItem",
  StockLevel: "stockLevel",
  Job: "job",
  JobAssignment: "jobAssignment",
  JobEquipment: "jobEquipment",
  JobLineItem: "jobLineItem",
};

const INSERT_ORDER = (Object.keys(ENTITY_META) as EntityName[]).sort(
  (a, b) => ENTITY_META[a].insertOrder - ENTITY_META[b].insertOrder
);

export async function assertEmptyDatabase(db: ImportDb): Promise<void> {
  const counts = await Promise.all([
    db.client.count(), db.personnel.count(), db.vehicle.count(), db.equipment.count(),
    db.inventoryItem.count(), db.stockLocation.count(), db.job.count(),
  ]);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total > 0) {
    throw new Error(
      `target database is not empty (${total} existing rows) — refusing to import. ` +
        `Wipe-and-retry: npx prisma migrate reset; npx tsx prisma/bootstrap.ts; rerun with --commit.`
    );
  }
}

export async function executeImport(db: ImportDb, plan: ImportPlan): Promise<ImportResult> {
  return db.$transaction(async (tx) => {
    const created: ImportResult["created"] = {};
    const jobs: ImportResult["jobs"] = [];
    const ids = new Map<EntityName, Map<string, string>>();

    const remember = (e: EntityName, key: string | null, id: string) => {
      if (!key) return;
      let m = ids.get(e);
      if (!m) {
        m = new Map();
        ids.set(e, m);
      }
      m.set(key, id);
    };
    const idFor = (e: EntityName, key: string): string => {
      const id = ids.get(e)?.get(normKey(key));
      if (!id) throw new Error(`internal: unresolved ${e} "${key}" reached executeImport`);
      return id;
    };

    for (const entity of INSERT_ORDER) {
      for (const r of plan.entities[entity] ?? []) {
        const data: Record<string, unknown> = {};
        for (const [f, v] of Object.entries(r.data)) {
          data[f] = ENTITY_META[entity].fields[f].kind === "date" ? new Date(String(v)) : v;
        }
        for (const [f, ref] of Object.entries(r.refs)) {
          data[f] = idFor(ref.entity, ref.key);
        }
        const row = await tx[DELEGATE[entity]].create({ data });
        created[entity] = (created[entity] ?? 0) + 1;
        remember(entity, naturalKeyOf(entity, r.data), row.id);
        if (entity === "Job" && r.sourceKey) {
          remember("Job", normKey(r.sourceKey), row.id);
          jobs.push({ sourceKey: r.sourceKey, id: row.id });
        }
        if (entity === "Vehicle") {
          const name = vehicleStockLocationName(String(r.data.model), String(r.data.vin));
          const loc = await tx.stockLocation.create({
            data: { name, type: "Vehicle", vehicleId: row.id },
          });
          created.StockLocation = (created.StockLocation ?? 0) + 1;
          remember("StockLocation", normKey(name), loc.id);
        }
      }
    }
    return { created, jobs };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/import/execute.test.ts`
Expected: PASS (after simplifying the awkward assertion flagged in Step 1).

- [ ] **Step 5: Run the whole suite and type check**

Run: `npm test` then `npx tsc --noEmit`
Expected: all tests pass; no type errors.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/import/execute.ts src/lib/import/execute.test.ts
git commit -m "feat(import): transactional executor with empty-db guard and vehicle stock locations"
```

---

### Task 7: `analyze` CLI

**Files:**
- Create: `scripts/import/analyze.ts`

**Interfaces:**
- Consumes: `readDataDir` (Task 1), `buildMappingProposal` (Task 4).
- Produces: `npx tsx scripts/import/analyze.ts <data-dir> [--force]` — writes `<data-dir>/mapping.json`, prints per-file detection summary, unrecognized files, and notes. Refuses to overwrite an existing mapping.json without `--force`. No DB access, no env vars needed.

- [ ] **Step 1: Implement `scripts/import/analyze.ts`**

```ts
// Onboarding data import, phase 1: propose <data-dir>/mapping.json from
// the customer's CSV/Excel files. Review/edit the file, then run:
//   npx tsx scripts/import/run.ts <data-dir>
import fs from "node:fs";
import path from "node:path";
import { readDataDir } from "../../src/lib/import/readers";
import { buildMappingProposal } from "../../src/lib/import/detect";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: npx tsx scripts/import/analyze.ts <data-dir> [--force]");
    process.exit(1);
  }
  const mappingPath = path.join(dir, "mapping.json");
  if (fs.existsSync(mappingPath) && !force) {
    console.error(`${mappingPath} already exists — pass --force to overwrite`);
    process.exit(1);
  }
  const tables = await readDataDir(dir);
  if (tables.length === 0) {
    console.error(`no .csv or .xlsx files found in ${dir}`);
    process.exit(1);
  }
  const { mapping, notes } = buildMappingProposal(tables);
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + "\n");
  console.log(`wrote ${mappingPath}\n`);
  for (const fm of mapping.files) {
    const low = Object.values(fm.columns).filter((c) => c.confidence === "low").length;
    console.log(
      `  ${fm.file}${fm.sheet ? `#${fm.sheet}` : ""} -> ${fm.entity}` +
        ` (${Object.keys(fm.columns).length} columns` +
        `${low ? `, ${low} low-confidence` : ""}` +
        `${fm.unresolved.length ? `, UNRESOLVED: ${fm.unresolved.join(", ")}` : ""})`
    );
  }
  for (const u of mapping.unrecognized ?? []) console.log(`  unrecognized: ${u}`);
  if (notes.length) {
    console.log("\nnotes:");
    for (const n of notes) console.log(`  - ${n}`);
  }
  console.log("\nreview mapping.json (fix unresolved fields and UNRESOLVED valueMaps), then dry-run:");
  console.log(`  npx tsx scripts/import/run.ts ${dir}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test against the fixtures**

```powershell
$smoke = Join-Path $env:TEMP "wvo-import-smoke"
Remove-Item -Recurse -Force $smoke -ErrorAction SilentlyContinue
New-Item -ItemType Directory $smoke | Out-Null
Copy-Item src/lib/import/__fixtures__/*.csv $smoke
npx tsx scripts/import/analyze.ts $smoke
Get-Content (Join-Path $smoke "mapping.json")
```

Expected: exit 0; summary lines mapping customers.csv → Client, vehicles.csv → Vehicle, jobs.csv → Job; `mapping.json` contains a `Job.status` valueMap with `"Open": "Scheduled"` and `"WIP": "In Progress"`, and no `UNRESOLVED` anywhere. Rerunning without `--force` exits 1 with the overwrite warning.

- [ ] **Step 3: Commit**

```powershell
git add scripts/import/analyze.ts
git commit -m "feat(import): analyze CLI — propose mapping.json from a customer data dir"
```

---

### Task 8: `run` CLI (dry-run / commit)

**Files:**
- Create: `scripts/import/run.ts`

**Interfaces:**
- Consumes: `readDataDir` (Task 1), validators + `Mapping` (Task 3), `buildImportPlan` (Task 5), `assertEmptyDatabase`/`executeImport` (Task 6), and `prisma` from `src/lib/db.ts` via dynamic import.
- Produces: `npx tsx scripts/import/run.ts <data-dir> [--commit] [--skip-rejected]`. Dry-run default: validates, plans, writes `<data-dir>/import-report.json`, exits 1 if mapping invalid or (dry-run) any rows rejected, else 0. `--commit`: refuses when rejects exist unless `--skip-rejected`; guards empty DB; single transaction; report updated with `committed: true`, created counts, and the job sourceKey→id table.

- [ ] **Step 1: Implement `scripts/import/run.ts`**

```ts
// Onboarding data import, phase 2: validate mapping.json, build the plan,
// report, and (with --commit) write to the database in one transaction.
// Dry-run by default. dotenv/config loads .env for DATABASE_URL, matching
// the Prisma CLI convention (prisma.config.ts).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { readDataDir } from "../../src/lib/import/readers";
import {
  validateMappingShape, validateMappingAgainstTables, type Mapping,
} from "../../src/lib/import/mappingSchema";
import { buildImportPlan, type ImportPlan } from "../../src/lib/import/pipeline";
import { assertEmptyDatabase, executeImport } from "../../src/lib/import/execute";

function writeReport(dir: string, report: Record<string, unknown>): void {
  const p = path.join(dir, "import-report.json");
  fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n");
  console.log(`report: ${p}`);
}

function printSummary(plan: ImportPlan): void {
  console.log("entity                 planned  rejected  skipped");
  for (const [entity, s] of Object.entries(plan.summary)) {
    console.log(`${entity.padEnd(24)}${String(s.planned).padStart(7)}${String(s.rejected).padStart(10)}${String(s.skipped).padStart(9)}`);
  }
  for (const r of plan.rejected) console.log(`  REJECTED ${r.file}:${r.row} [${r.entity}] ${r.reason}`);
  for (const s of plan.skipped) console.log(`  skipped  ${s.file}:${s.row} [${s.entity}] ${s.reason}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const skipRejected = args.includes("--skip-rejected");
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: npx tsx scripts/import/run.ts <data-dir> [--commit] [--skip-rejected]");
    process.exit(1);
  }
  const mappingPath = path.join(dir, "mapping.json");
  if (!fs.existsSync(mappingPath)) {
    console.error(`${mappingPath} not found — run analyze.ts first`);
    process.exit(1);
  }
  const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as Mapping;
  const headerRows = Object.fromEntries(mapping.files.map((f) => [f.file, f.headerRow]));
  const tables = await readDataDir(dir, headerRows);
  const errors = [...validateMappingShape(mapping), ...validateMappingAgainstTables(mapping, tables)];
  if (errors.length > 0) {
    console.error("mapping is not ready:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const plan = buildImportPlan(mapping, tables);
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    dataDir: path.resolve(dir),
    committed: false,
    summary: plan.summary,
    rejected: plan.rejected,
    skipped: plan.skipped,
  };
  printSummary(plan);

  if (!commit) {
    writeReport(dir, report);
    console.log("\ndry run only — pass --commit to write to the database.");
    process.exit(plan.rejected.length > 0 ? 1 : 0);
  }
  if (plan.rejected.length > 0 && !skipRejected) {
    writeReport(dir, report);
    console.error(`\n${plan.rejected.length} rejected rows — fix them, or pass --skip-rejected to import only clean rows.`);
    process.exit(1);
  }

  const { prisma } = await import("../../src/lib/db");
  await assertEmptyDatabase(prisma);
  const result = await executeImport(prisma, plan);
  report.committed = true;
  report.created = result.created;
  report.jobs = result.jobs;
  writeReport(dir, report);
  console.log("\nimport committed:");
  for (const [e, n] of Object.entries(result.created)) console.log(`  ${e}: ${n}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test the dry run (no DB needed)**

Using the smoke dir from Task 7 Step 2 (re-create it if gone, including re-running analyze):

```powershell
$smoke = Join-Path $env:TEMP "wvo-import-smoke"
npx tsx scripts/import/run.ts $smoke
Get-Content (Join-Path $smoke "import-report.json")
```

Expected: exit 0. Summary shows Client planned 2; Vehicle planned 2; Job planned 2, skipped 1 (job 1002, "Completed" out of scope), rejected 0. `import-report.json` has `"committed": false` and the skipped row with file/row/reason. The commit path is deliberately **not** smoke-tested here (it needs an empty database); it is covered by the Task 6 unit tests and exercised for real during the first onboarding.

- [ ] **Step 3: Verify mapping-gate failure mode**

```powershell
$m = Join-Path $smoke "mapping.json"
(Get-Content $m -Raw) -replace '"unresolved": \[\]', '"unresolved": ["contactName"]' | Set-Content $m -Encoding utf8
npx tsx scripts/import/run.ts $smoke
```

Expected: exit 1, output contains `unresolved required fields: contactName`. Restore afterwards: `npx tsx scripts/import/analyze.ts $smoke --force`.

- [ ] **Step 4: Commit**

```powershell
git add scripts/import/run.ts
git commit -m "feat(import): run CLI — validate, dry-run report, transactional --commit"
```

---

### Task 9: Documentation + final verification

**Files:**
- Modify: `MANUAL_Setup_Installation.md` (append a new top-level section; match the manual's existing heading style and numbering)
- Modify: `CLAUDE.md` (Commands block + short architecture note)

**Interfaces:**
- Consumes: the CLI behaviors from Tasks 7–8 (docs must match actual flags and outputs).

- [ ] **Step 1: Add the manual section**

Append to `MANUAL_Setup_Installation.md` (adjust the section number to follow the last existing section, and mirror the manual's formatting conventions):

```markdown
## §N. Onboarding Data Import (migrating a customer's existing data)

Imports a new customer's master data (clients, personnel, vehicles, equipment,
inventory, stock) and open/scheduled jobs from CSV/Excel files into a fresh
WhiteVanOps database. Run from a project checkout on the machine that can
reach the customer's database (`DATABASE_URL` in `.env`, same as the Prisma
CLI). Completed/cancelled job history is intentionally not imported.

1. **Collect the data** into one folder as `.csv`/`.xlsx`. Convert PDFs or
   other FSM exports to spreadsheets first.
2. **Analyze:** `npx tsx scripts/import/analyze.ts <folder>` — writes
   `<folder>/mapping.json` (which file feeds which entity, column mappings,
   date formats, status translations).
3. **Review `mapping.json`.** The import refuses to run while any
   `"unresolved"` entries or `"UNRESOLVED"` valueMap values remain — map a
   column, add a `"defaults"` entry, or translate the value. Low-confidence
   guesses are marked `"confidence": "low"`; verify them.
4. **Dry-run:** `npx tsx scripts/import/run.ts <folder>` — writes
   `<folder>/import-report.json` listing what would be imported, every
   rejected row with its file:row and reason, and out-of-scope skips
   (completed/cancelled jobs). No database access needed for a dry run.
5. **Commit:** `npx tsx scripts/import/run.ts <folder> --commit` — refuses if
   the database is not empty or if any rows were rejected (pass
   `--skip-rejected` to import only the clean rows). Runs as a single
   all-or-nothing transaction.
6. **If a run goes wrong:** `npx prisma migrate reset`, then
   `npx tsx prisma/bootstrap.ts`, fix the data or mapping, and rerun.

Keep `mapping.json` and `import-report.json` with the customer's onboarding
records — they are the audit trail of what was imported. Design details:
`docs/superpowers/specs/2026-07-05-data-migration-engine-design.md`.
```

- [ ] **Step 2: Update CLAUDE.md**

In the Commands block, after the Database group, add:

```bash
# Onboarding data import (migrating a customer's existing data — see MANUAL_Setup_Installation.md)
npx tsx scripts/import/analyze.ts <data-dir>   # Propose <data-dir>/mapping.json from customer CSV/Excel files
npx tsx scripts/import/run.ts <data-dir>       # Validate + dry-run report; add --commit to import (fresh DB only)
```

In the Architecture section, add a short subsection after "QuickBooks sync":

```markdown
### Onboarding data import

`scripts/import/analyze.ts` + `scripts/import/run.ts` (both `npx tsx`) migrate a new
customer's spreadsheets into a fresh database. All logic is in pure modules under
`src/lib/import/` (relative imports only — no `@/` alias, so tsx resolves them; nothing
there imports `src/lib/db.ts` — the executor takes the DB as a parameter). The
`mapping.json` proposed by analyze and reviewed by hand is the contract; `run.ts` is
dry-run by default, all-or-nothing on `--commit`, and refuses a non-empty database.
Spec: `docs/superpowers/specs/2026-07-05-data-migration-engine-design.md`.
```

- [ ] **Step 3: Final verification**

Run: `npm test` — expected: full suite passes.
Run: `npx tsc --noEmit` — expected: no errors.
Run: `npm run lint` — expected: no new errors in `src/lib/import/` or `scripts/import/`.

- [ ] **Step 4: Commit**

```powershell
git add MANUAL_Setup_Installation.md CLAUDE.md
git commit -m "docs: onboarding data import section in setup manual and CLAUDE.md"
```
