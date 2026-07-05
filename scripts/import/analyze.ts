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
