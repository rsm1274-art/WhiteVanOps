import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { LEGACY_PROBES, buildBundle, planMigrations, runMigrations, dumpBeforeUpgrade } from "./migrate.js";

const bundleOf = (names) => names.map((name) => ({ name, sql: `-- ${name}`, checksum: "c".repeat(64) }));
const LEGACY_NAMES = LEGACY_PROBES.map((p) => p.name);

/**
 * Minimal stand-in for a pg Client. `probes` answers the LEGACY_PROBES in
 * order; `failOn` makes that migration's SQL throw. Every statement is logged
 * so tests can assert on BEGIN/COMMIT/ROLLBACK and tracking inserts.
 */
function fakeClient({ tracked = false, hasUsers = false, probes = [], trackedRows = [], failOn = null } = {}) {
  const log = [];
  const inserted = [];
  let pendingInserts = [];
  return {
    log,
    inserted,
    async query(q) {
      const text = typeof q === "string" ? q : q.text;
      log.push(text);
      if (text.includes(`to_regclass('"_prisma_migrations"')`)) return { rows: [{ ok: tracked }] };
      if (text.includes(`to_regclass('"User"')`)) return { rows: [{ ok: hasUsers }] };
      const probeIdx = LEGACY_PROBES.findIndex((p) => p.sql === text);
      if (probeIdx >= 0) return { rows: [{ ok: probes[probeIdx] === true }] };
      if (text.startsWith('SELECT migration_name')) return { rows: trackedRows };
      if (text.startsWith('INSERT INTO "_prisma_migrations"')) {
        pendingInserts.push({ name: q.values[2], steps: q.values[3] });
        return { rows: [] };
      }
      if (text === "COMMIT") { inserted.push(...pendingInserts); pendingInserts = []; }
      if (text === "ROLLBACK") pendingInserts = [];
      if (failOn && text === `-- ${failOn}`) throw new Error("boom");
      return { rows: [] };
    },
  };
}

describe("planMigrations", () => {
  const bundle = bundleOf(["a", "b", "c"]);

  it("applies everything on an empty database", () => {
    expect(planMigrations({ bundle, appliedNames: null, legacyPrefixLength: null }))
      .toEqual({ baseline: [], pending: ["a", "b", "c"], unknown: [] });
  });

  it("applies only unrecorded migrations on a tracked database and reports unknown ones", () => {
    expect(planMigrations({ bundle, appliedNames: new Set(["a", "zz-newer"]), legacyPrefixLength: null }))
      .toEqual({ baseline: [], pending: ["b", "c"], unknown: ["zz-newer"] });
  });

  it("baselines the legacy prefix and applies the rest", () => {
    const legacyBundle = bundleOf([...LEGACY_NAMES, "29990101000000_future"]);
    const plan = planMigrations({ bundle: legacyBundle, appliedNames: null, legacyPrefixLength: 11 });
    expect(plan.baseline).toEqual(LEGACY_NAMES.slice(0, 11));
    expect(plan.pending).toEqual([...LEGACY_NAMES.slice(11), "29990101000000_future"]);
  });
});

describe("runMigrations", () => {
  it("applies all migrations on an empty database without a backup", async () => {
    const client = fakeClient();
    let backups = 0;
    const res = await runMigrations({ client, bundle: bundleOf(["a", "b"]), beforeApply: async () => { backups++; } });
    expect(res.state).toBe("empty");
    expect(res.applied).toEqual(["a", "b"]);
    expect(client.inserted).toEqual([{ name: "a", steps: 1 }, { name: "b", steps: 1 }]);
    expect(backups).toBe(0);
  });

  it("uses the longest passing prefix, so a removal probe passing on an old DB doesn't inflate the baseline", async () => {
    // Probes 1-3 pass, 4 (Invoice table) fails, but the "tier absent" removal
    // probe (index 8) also passes because the column never existed.
    const probes = LEGACY_NAMES.map((_, i) => i < 3 || i === 8);
    const client = fakeClient({ hasUsers: true, probes });
    const pending = [];
    const res = await runMigrations({
      client,
      bundle: bundleOf(LEGACY_NAMES),
      beforeApply: async (p) => { pending.push(...p); },
    });
    expect(res.state).toBe("legacy");
    expect(res.baseline).toEqual(LEGACY_NAMES.slice(0, 3));
    expect(res.applied).toEqual(LEGACY_NAMES.slice(3));
    expect(pending[0]).toBe(LEGACY_NAMES[3]);
    expect(client.inserted.filter((r) => r.steps === 0).map((r) => r.name)).toEqual(LEGACY_NAMES.slice(0, 3));
  });

  it("refuses a non-empty database it can't recognise", async () => {
    const client = fakeClient({ hasUsers: true, probes: [] });
    await expect(runMigrations({ client, bundle: bundleOf(LEGACY_NAMES) })).rejects.toThrow(/not one WhiteVanOps recognises/);
    expect(client.log).not.toContain("BEGIN");
  });

  it("is a no-op when everything is recorded", async () => {
    const client = fakeClient({ tracked: true, trackedRows: [{ migration_name: "a", finished_at: new Date(), rolled_back_at: null }] });
    let backups = 0;
    const res = await runMigrations({ client, bundle: bundleOf(["a"]), beforeApply: async () => { backups++; } });
    expect(res.applied).toEqual([]);
    expect(client.log).not.toContain("BEGIN");
    expect(backups).toBe(0);
  });

  it("rolls back and names the failing migration; earlier ones stay committed", async () => {
    const client = fakeClient({ tracked: true, trackedRows: [], failOn: "b" });
    await expect(runMigrations({ client, bundle: bundleOf(["a", "b", "c"]) }))
      .rejects.toThrow(/failed at migration b: boom.*Migrations applied before it: a/);
    expect(client.inserted.map((r) => r.name)).toEqual(["a"]);
    expect(client.log).toContain("ROLLBACK");
  });

  it("does not touch the schema when the pre-upgrade backup fails", async () => {
    const client = fakeClient({ tracked: true, trackedRows: [] });
    await expect(runMigrations({
      client,
      bundle: bundleOf(["a"]),
      beforeApply: async () => { throw new Error("backup failed"); },
    })).rejects.toThrow("backup failed");
    expect(client.log).not.toContain("BEGIN");
  });

  it("refuses to continue past a migration Prisma recorded as failed", async () => {
    const client = fakeClient({ tracked: true, trackedRows: [{ migration_name: "a", finished_at: null, rolled_back_at: null }] });
    await expect(runMigrations({ client, bundle: bundleOf(["a"]) })).rejects.toThrow(/recorded as failed/);
  });
});

describe("buildBundle", () => {
  it("covers every repo migration, sorted, with Prisma's sha256 checksum", () => {
    const dir = path.join(__dirname, "..", "prisma", "migrations");
    const bundle = buildBundle(dir);
    const folders = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "migration.sql"))).sort();
    expect(bundle.map((m) => m.name)).toEqual(folders);
    const first = bundle[0];
    const expected = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, first.name, "migration.sql"))).digest("hex");
    expect(first.checksum).toBe(expected);
  });

  it("every legacy probe names a real migration, in order", () => {
    const names = buildBundle(path.join(__dirname, "..", "prisma", "migrations")).map((m) => m.name);
    expect(names.slice(0, LEGACY_NAMES.length)).toEqual(LEGACY_NAMES);
  });
});

describe("dumpBeforeUpgrade", () => {
  it("aborts when pg_dump is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wvo-dump-"));
    expect(() => dumpBeforeUpgrade({
      pgDumpExe: path.join(dir, "no-such-pg_dump"), port: 1, user: "u", password: "p", dbName: "d", dir, label: "x",
    })).toThrow(/pg_dump not found/);
  });
});
