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
