/**
 * Pure ordering logic for field-write ops. Does NOT apply anything — that's
 * Phase 3's job (a fieldOps.ts caller looks up the newest already-applied
 * opId for a targetKey and calls shouldApply before writing). This module is
 * only the decision function plus the target-key shape it decides against.
 */

export type FieldOpType = "time" | "notes" | "lineItems" | "status";

/**
 * The AppliedOp identity an op competes against.
 *
 * "time" is insert semantics — every time entry is its own row, so each op
 * gets a unique target key that can never collide with another op.
 *
 * "notes" | "lineItems" | "status" are replace semantics — there is one
 * current value per job per field, so all ops for the same job+field share a
 * target key and the newest opId (by string comparison) wins.
 */
export function targetKeyFor(opType: FieldOpType, jobId: string, opId: string): string {
  if (opType === "time") {
    return `job:${jobId}:time:${opId}`;
  }
  return `job:${jobId}:${opType}`;
}

/**
 * True if this op should be applied against a replace-semantics target:
 * either nothing has been applied for the target yet, or this op is
 * strictly newer than the prior applied op.
 *
 * ULIDs sort correctly as plain strings — compare them as strings, never
 * parse them. An exact-equal opId (a re-delivered duplicate) is rejected:
 * duplicates are handled by AppliedOp's primary key, not by this function,
 * and "equal" must never be treated as "newer".
 */
export function shouldApply(opId: string, priorAppliedOpId: string | null): boolean {
  if (priorAppliedOpId === null) return true;
  return opId > priorAppliedOpId;
}
