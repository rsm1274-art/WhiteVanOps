/**
 * Parses a recorded field-write request (queued in IndexedDB, or replayed
 * from a stuck-op export in a later phase) into a normalized op shape.
 *
 * Understands both the legacy per-field-endpoint shapes that existed before
 * this phase (POST /api/time, PUT /api/jobs with one of three field
 * combinations) and the new consolidated POST /api/field/ops shape, so a
 * phone that queued a write against the old URLs before this deploy can
 * still be understood after it. This module does not submit or replay
 * anything itself — it is a pure parser reused by later phases (export/
 * import). Returns null for anything unrecognized rather than throwing, so a
 * malformed or unexpected record is safely skippable rather than a crash.
 */

export interface ParsedFieldOp {
  opType: "time" | "notes" | "lineItems" | "status";
  jobId: string;
  body: Record<string, unknown>;
}

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripQuery(url: string): string {
  const qIndex = url.indexOf("?");
  return qIndex === -1 ? url : url.slice(0, qIndex);
}

/** Matches the URL against a path, ignoring any scheme/host prefix and query string. */
function pathMatches(url: string, path: string): boolean {
  const stripped = stripQuery(url);
  return stripped === path || stripped.endsWith(path);
}

export function parseRecordedRequest(req: RecordedRequest): ParsedFieldOp | null {
  if (!req || typeof req.url !== "string" || typeof req.method !== "string") return null;
  if (!isPlainObject(req.body)) return null;

  const method = req.method.toUpperCase();
  const body = req.body;
  const jobId = body.jobId;
  if (typeof jobId !== "string" || !jobId) return null;

  // New consolidated shape: POST /api/field/ops, dispatched on which field is present.
  if (pathMatches(req.url, "/api/field/ops") && method === "POST") {
    if (typeof body.duration === "string") {
      return { opType: "time", jobId, body };
    }
    if (typeof body.notes === "string") {
      return { opType: "notes", jobId, body };
    }
    if (Array.isArray(body.lineItems)) {
      return { opType: "lineItems", jobId, body };
    }
    if (typeof body.status === "string") {
      return { opType: "status", jobId, body };
    }
    return null;
  }

  // Legacy shape: POST /api/time — { jobId, personnelId, date, duration, ... }
  if (pathMatches(req.url, "/api/time") && method === "POST") {
    if (typeof body.duration !== "string") return null;
    return { opType: "time", jobId, body };
  }

  // Legacy shapes: PUT /api/jobs, distinguished by which field is present.
  if (pathMatches(req.url, "/api/jobs") && method === "PUT") {
    if (typeof body.notes === "string") {
      return { opType: "notes", jobId, body };
    }
    if (Array.isArray(body.lineItems)) {
      return { opType: "lineItems", jobId, body };
    }
    if (typeof body.status === "string") {
      return { opType: "status", jobId, body };
    }
    return null;
  }

  return null;
}
