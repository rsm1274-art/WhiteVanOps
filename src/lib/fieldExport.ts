/**
 * Field-work export/import file format (Phase 5 of the v2.0 plan).
 *
 * A tech can export a snapshot of their queued, stuck, and recently-synced
 * work to a JSON file as a manual backup/recovery path — independent of
 * WiFi sync, so work is never lost even if the phone's storage is wiped
 * before it drains, or the office database itself needs to be rebuilt from
 * a tech's own copy.
 *
 * This module is pure and environment-agnostic (no DOM, no Node builtins) so
 * it runs unmodified in the browser (building the export) and on the server
 * (verifying one on import) — see fieldOps.ts / the /api/field/import route.
 *
 * No SubtleCrypto: the field module runs on a plain-http LAN origin, which is
 * not a secure context, so `crypto.subtle` is unavailable. There is also no
 * adversarial threat model here — this file moves by hand (email, USB,
 * AirDrop) between a tech's phone and an admin's desktop, not across a
 * security boundary — so a deterministic, non-cryptographic FNV-1a checksum
 * is sufficient. Its job is catching corruption/mangling (a re-saved file
 * with different line endings, a truncated copy), not tamper-proofing.
 */

import { parseRecordedRequest } from "@/lib/recordedRequest";

export const EXPORT_SCHEMA_VERSION = 1;

export type ExportedOpSource = "queue" | "stuck" | "history";

export interface ExportedOp {
  opId: string;
  url: string;
  method: string;
  body: unknown;
  /** The original timestamp the op was queued (or, for history, when it was first queued). */
  queuedAt: number;
  source: ExportedOpSource;
}

export interface FieldExportSummary {
  timeEntries: number;
  statusChanges: number;
  notes: number;
  materials: number;
}

export interface FieldExport {
  schemaVersion: number;
  exportedAt: number;
  techId: string | null;
  techName: string;
  summary: FieldExportSummary;
  ops: ExportedOp[];
  checksum: string;
}

// ---------------------------------------------------------------------------
// FNV-1a 32-bit checksum
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Deterministic, non-cryptographic 32-bit hash of a string, as 8-char lowercase hex. */
export function fnv1aChecksum(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime using Math.imul to stay in 32-bit arithmetic.
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Force unsigned, then pad to 8 hex chars.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Checksum over an ops array, independent of input order: sorts a shallow
 * copy by opId first, then hashes the canonical JSON. opIds are ULIDs
 * (unique per op), so sorting by opId alone is a stable, total order.
 */
export function checksumForOps(ops: ExportedOp[]): string {
  const sorted = [...ops].sort((a, b) => (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0));
  return fnv1aChecksum(JSON.stringify(sorted));
}

// ---------------------------------------------------------------------------
// buildExport — merges queue + stuck + history into one ops array
// ---------------------------------------------------------------------------

interface QueueLikeOp {
  opId: string;
  url: string;
  method: string;
  body: unknown;
  timestamp: number;
}

interface StuckLikeOp {
  opId: string;
  url: string;
  method: string;
  body: unknown;
  queuedAt: number;
}

interface HistoryLikeOp {
  opId: string;
  url: string;
  method: string;
  body: unknown;
  queuedAt: number;
}

export interface BuildExportParams {
  techId: string | null;
  techName: string;
  queue: QueueLikeOp[];
  stuck: StuckLikeOp[];
  history: HistoryLikeOp[];
}

function emptySummary(): FieldExportSummary {
  return { timeEntries: 0, statusChanges: 0, notes: 0, materials: 0 };
}

function tallyOp(summary: FieldExportSummary, op: ExportedOp): void {
  const parsed = parseRecordedRequest({ url: op.url, method: op.method, body: op.body });
  if (!parsed) return;
  if (parsed.opType === "time") summary.timeEntries++;
  else if (parsed.opType === "status") summary.statusChanges++;
  else if (parsed.opType === "notes") summary.notes++;
  else if (parsed.opType === "lineItems") summary.materials++;
}

export function buildExport(params: BuildExportParams): FieldExport {
  const ops: ExportedOp[] = [
    ...params.queue.map((o): ExportedOp => ({
      opId: o.opId, url: o.url, method: o.method, body: o.body, queuedAt: o.timestamp, source: "queue",
    })),
    ...params.stuck.map((o): ExportedOp => ({
      opId: o.opId, url: o.url, method: o.method, body: o.body, queuedAt: o.queuedAt, source: "stuck",
    })),
    ...params.history.map((o): ExportedOp => ({
      opId: o.opId, url: o.url, method: o.method, body: o.body, queuedAt: o.queuedAt, source: "history",
    })),
  ];

  const summary = emptySummary();
  for (const op of ops) tallyOp(summary, op);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    techId: params.techId,
    techName: params.techName,
    summary,
    ops,
    checksum: checksumForOps(ops),
  };
}

// ---------------------------------------------------------------------------
// verifyExport — the single validation entry point for the import side
// ---------------------------------------------------------------------------

export type VerifyExportResult = { ok: true; data: FieldExport } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidExportedOp(v: unknown): v is ExportedOp {
  if (!isPlainObject(v)) return false;
  if (typeof v.opId !== "string" || !v.opId) return false;
  if (typeof v.url !== "string") return false;
  if (typeof v.method !== "string") return false;
  if (!("body" in v)) return false;
  if (typeof v.queuedAt !== "number") return false;
  if (v.source !== "queue" && v.source !== "stuck" && v.source !== "history") return false;
  return true;
}

/**
 * Validates and returns a parsed export, or a clear rejection reason.
 * Never throws — malformed input of any shape (not an object, wrong types,
 * missing fields) is reported as a structural error rather than propagating
 * an exception. A bad checksum is ALWAYS a hard rejection; there is no
 * "accept anyway" path.
 */
export function verifyExport(data: unknown): VerifyExportResult {
  if (!isPlainObject(data)) {
    return { ok: false, error: "File is not a valid WhiteVanOps export (not a JSON object)." };
  }

  if (data.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported export schema version (${String(data.schemaVersion)}). This app only reads version ${EXPORT_SCHEMA_VERSION}.`,
    };
  }

  if (typeof data.exportedAt !== "number") {
    return { ok: false, error: "File is missing a valid exportedAt timestamp." };
  }
  if (data.techId !== null && typeof data.techId !== "string") {
    return { ok: false, error: "File is missing a valid techId." };
  }
  if (typeof data.techName !== "string") {
    return { ok: false, error: "File is missing a valid techName." };
  }
  if (!isPlainObject(data.summary)) {
    return { ok: false, error: "File is missing a valid summary." };
  }
  if (!Array.isArray(data.ops)) {
    return { ok: false, error: "File is missing a valid ops array." };
  }
  if (typeof data.checksum !== "string") {
    return { ok: false, error: "File is missing a valid checksum." };
  }

  for (const op of data.ops) {
    if (!isValidExportedOp(op)) {
      return { ok: false, error: "File contains a malformed operation record." };
    }
  }

  const ops = data.ops as ExportedOp[];
  const recomputed = checksumForOps(ops);
  if (recomputed !== data.checksum) {
    return {
      ok: false,
      error: "This file's checksum does not match its contents — it appears to be corrupted or was altered after export.",
    };
  }

  return {
    ok: true,
    data: {
      schemaVersion: data.schemaVersion,
      exportedAt: data.exportedAt,
      techId: data.techId as string | null,
      techName: data.techName,
      summary: data.summary as unknown as FieldExportSummary,
      ops,
      checksum: data.checksum,
    },
  };
}
