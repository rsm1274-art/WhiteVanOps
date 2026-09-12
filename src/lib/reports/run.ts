// Executes a compiled report definition against the database. Thin layer
// over compile.ts: owns the transaction, the statement timeout, and the
// count query — no query-shape decisions live here.

import { sql } from "kysely";
import { reportsDb } from "./kysely";
import { _executable } from "./compile";
import type { ReportDefinition } from "./types";

/**
 * Caps how long a single report's queries may run inside the transaction.
 * The bundled PostgreSQL instance also serves the field techs' PWA — a
 * pathological ad-hoc definition must not be able to pin it indefinitely.
 */
export const STATEMENT_TIMEOUT_MS = 15_000;

export interface RunReportOptions {
  limit: number;
  offset: number;
}

export interface RunReportResult {
  columns: ReportDefinition["columns"];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

/**
 * Runs a validated ReportDefinition. `def` MUST already be the output of
 * validateDefinition — this trusts it and does not re-validate.
 */
export async function runReport(def: ReportDefinition, opts: RunReportOptions): Promise<RunReportResult> {
  const rowQuery = _executable.rowQuery(def, { limit: opts.limit, offset: opts.offset });
  const countQuery = _executable.countQuery(def);

  return reportsDb.transaction().execute(async (trx) => {
    // SET/SET LOCAL don't accept a bound parameter in Postgres (syntax error at
    // or near "$1") — this constant must be inlined as a literal, not passed as
    // ${STATEMENT_TIMEOUT_MS} through the sql tag.
    await sql.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`).execute(trx);

    const [rowsResult, countResult] = await Promise.all([
      rowQuery.execute(trx) as Promise<{ rows: Record<string, unknown>[] }>,
      countQuery.execute(trx) as Promise<{ rows: { count: string | number }[] }>,
    ]);

    const totalRows = Number(countResult.rows[0]?.count ?? 0);
    return {
      columns: def.columns,
      rows: rowsResult.rows,
      totalRows,
      truncated: opts.offset + rowsResult.rows.length < totalRows,
    };
  });
}
