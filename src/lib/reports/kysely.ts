// Kysely instance for the report builder's query layer. Shares the same
// pg.Pool as Prisma (src/lib/db.ts) rather than opening a second connection
// pool — the bundled PostgreSQL's max_connections is modest and the
// Electron app already shares one process for both.

import { Kysely, PostgresDialect } from "kysely";
import { pool } from "@/lib/db";
import type { Database } from "./dbTypes";

const globalForReportsDb = globalThis as unknown as {
  reportsDb: Kysely<Database> | undefined;
};

export const reportsDb =
  globalForReportsDb.reportsDb ??
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

if (process.env.NODE_ENV !== "production") globalForReportsDb.reportsDb = reportsDb;
